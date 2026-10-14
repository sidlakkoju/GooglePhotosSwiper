import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {syncRequest,digest} from '../worker/src/sync.mjs';
import {createSyncClient,heartbeatSync,historyPatch,mergeSyncResult,SYNC_POLL_MS,SYNC_IDLE_POLL_MS,SYNC_IDLE_AFTER_MS,SYNC_BACKOFF_MS,SYNC_BACKOFF_MAX_MS} from '../lib/userscript-sync.mjs';

const large=['decisions','decision_versions','decision_keeps','review_items'];
class CountingD1 {
 constructor(){
  this.sqlite=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('../worker/migrations/',import.meta.url)).sort())this.sqlite.exec(readFileSync(new URL(`../worker/migrations/${file}`,import.meta.url),'utf8'));
  this.reset();
 }
 reset(){this.stats={queries:0,rowsRead:0,unbounded:[]};}
 measure(sql,args,rows){
  this.stats.queries++;
  const aliases=new Map();
  for(const [,table,alias] of sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)(?:\s+(?:AS\s+)?(?!ON\b|WHERE\b|LEFT\b|JOIN\b|SET\b|SELECT\b|VALUES\b)(\w+))?/gi)){aliases.set(table,table);if(alias)aliases.set(alias,table);}
  let whole=0;
  for(const {detail} of this.sqlite.prepare('EXPLAIN QUERY PLAN '+sql).all(...args)){
   const step=/^(SCAN|SEARCH) (\w+)(?: USING (?:COVERING )?(?:INDEX \w+|PRIMARY KEY|INTEGER PRIMARY KEY) \(([^)]*)\))?/.exec(detail);
   if(!step||detail.includes('VIRTUAL TABLE'))continue;
   const table=aliases.get(step[2])||step[2];
   if(!large.includes(table))continue;
   const scoped=step[1]==='SEARCH'&&step[3]==='scope=?';
   if(step[1]==='SCAN'||scoped&&!/\bMAX\(/i.test(sql)){whole+=this.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;this.stats.unbounded.push(sql);}
  }
  this.stats.rowsRead+=Math.max(rows,whole?whole:rows);
 }
 prepare(sql){
  const statement=this.sqlite.prepare(sql);
  const bound=args=>{
   const run=()=>{const results=statement.all(...args),changes=/^\s*SELECT/i.test(sql)?0:Number(this.sqlite.prepare('SELECT changes() AS n').get().n);this.measure(sql,args,Math.max(results.length,changes));return {results,meta:{changes}};};
   return {all:async()=>({results:run().results}),first:async()=>run().results[0]||null,run:async()=>{run();return {};},execute:run};
  };
  return {...bound([]),bind:(...args)=>bound(args)};
 }
 async batch(statements){this.sqlite.exec('BEGIN');try{const results=statements.map(statement=>statement.execute());this.sqlite.exec('COMMIT');return results;}catch(error){this.sqlite.exec('ROLLBACK');throw error;}}
}
const env=()=>({SYNC_TOKEN:'synthetic-secret',PAIRING_IP_KEY:'synthetic-ip-key',DB:new CountingD1()});
const call=(e,path,method='GET',value)=>syncRequest(new Request(`https://sync.example/api/${path}`,{method,headers:{Authorization:'Bearer synthetic-secret'},...(value!==undefined?{body:JSON.stringify(value)}:{})}),e);
const clientFor=(e,requests=[])=>{const client=createSyncClient({fetch:(url,options)=>{requests.push({url:new URL(url),options});return syncRequest(new Request(url,options),e);}});client.configure({url:'https://sync.example',token:'synthetic-secret'});return client;};
const save=async value=>value;
function seed(e,count){
 const old=Date.now()-86400000,insert=(sql,rows)=>{const statement=e.DB.sqlite.prepare(sql);e.DB.sqlite.exec('BEGIN');for(const row of rows)statement.run(...row);e.DB.sqlite.exec('COMMIT');};
 const keys=Array.from({length:count},(_,index)=>`synthetic-${index}`);
 insert("INSERT INTO decisions (scope,id,decision) VALUES ('default',?,?)",keys.map((key,index)=>[key,index%2?'keep':'remove']));
 insert("INSERT INTO decision_versions (scope,id,device_id,updated_at,changed_at) VALUES ('default',?,'legacy',?,?)",keys.map(key=>[key,old,old]));
 insert("INSERT INTO review_items (scope,id,data,updated_at) VALUES ('default',?,?,?)",keys.map(key=>[key,JSON.stringify({mediaKey:key,type:'photo',state:'active',revision:1,lastDecisionAt:old}),old]));
 e.DB.sqlite.prepare("INSERT INTO review_state (scope,progress,history) VALUES ('default',?,'[]')").run(JSON.stringify({started:true,reviewed:count,items:[],swipeCount:count}));
 e.DB.sqlite.prepare("INSERT INTO review_state (scope,progress,history) VALUES ('default:device:legacy','{}',?)").run(JSON.stringify(keys.slice(-1500).map(key=>({key,previous:null,decision:'keep',revision:1}))));
}

test('steady-state syncs read rows in proportion to changes, not to the library',async()=>{
 const e=env(),count=3000;seed(e,count);
 const requests=[],client=clientFor(e,requests);
 e.DB.reset();
 let state=await client.sync('default',{started:true,items:[],history:[]},save);
 assert.equal(Object.keys(state.syncDecisions).length,count);
 assert.ok(e.DB.stats.rowsRead>=2*count,`bootstrap reads the library once (${e.DB.stats.rowsRead})`);
 assert.match(state.syncCursor.at,/^\d+\.[0-9a-z]+$/);

 e.DB.reset();requests.length=0;
 state=await client.sync('default',state,save);
 assert.deepEqual(requests.map(({url,options})=>`${options.method||'GET'} ${url.pathname}`),['GET /api/state']);
 assert.deepEqual(e.DB.stats.unbounded,[]);
 assert.ok(e.DB.stats.queries<=5,`idle pull queries: ${e.DB.stats.queries}`);
 assert.ok(e.DB.stats.rowsRead<=10,`idle pull rows read: ${e.DB.stats.rowsRead}`);

 const swiped=state.items.find(item=>item.decision==='keep');
 const entry={key:swiped.mediaKey,previous:'keep',decision:'remove',revision:2};
 state={...state,items:state.items.map(item=>item===swiped?{...item,decision:'remove',revision:2,lastDecisionAt:Date.now()}:item),history:[...state.history,entry],syncPending:{[swiped.mediaKey]:'remove'},syncPendingTimes:{[swiped.mediaKey]:Date.now()},syncDirty:true};
 e.DB.reset();requests.length=0;
 state=await client.sync('default',state,save);
 assert.deepEqual(requests.map(({url,options})=>`${options.method||'GET'} ${url.pathname}`),['GET /api/state','PUT /api/decisions','POST /api/undo','PUT /api/progress']);
 assert.deepEqual(e.DB.stats.unbounded,[]);
 assert.ok(e.DB.stats.queries<=30,`swipe sync queries: ${e.DB.stats.queries}`);
 assert.ok(e.DB.stats.rowsRead<=60,`swipe sync rows read: ${e.DB.stats.rowsRead}`);
 assert.equal(state.syncDecisions[swiped.mediaKey],'remove');assert.equal(state.syncDirty,false);
 assert.ok(requests.every(({options})=>!options.body||options.body.length<4096));

 e.DB.reset();
 requests.length=0;
 await client.sync('default',state,save,{pull:false});
 assert.deepEqual(requests,[]);
 assert.equal(e.DB.stats.queries,0);
});

test('old clients keep the full response shapes while new clients receive deltas',async()=>{
 const e=env();seed(e,20);
 const full=await (await call(e,'state')).json();
 assert.equal(full.decisions.length,20);assert.equal(full.delta,undefined);assert.equal(full.cursor,undefined);assert.ok(Number.isSafeInteger(full.itemsCursor));
 const merged=await (await call(e,'decisions','PUT',{decisions:[{id:'synthetic-0',decision:'keep'}]})).json();
 assert.equal(merged.merged,true);assert.equal(merged.decisions.length,20);
 const bootstrap=await (await call(e,'state?cursor=')).json();
 assert.equal(bootstrap.decisions.length,20);assert.equal(bootstrap.delta,undefined);assert.match(bootstrap.cursor,/^\d+\.[0-9a-z]+$/);
 const quiet=await (await call(e,`state?cursor=${bootstrap.cursor}`)).json();
 assert.equal(quiet.delta,true);assert.deepEqual(quiet.decisions,[]);assert.deepEqual(quiet.progress.items,[]);assert.equal(quiet.history,undefined);
 e.DB.sqlite.exec("UPDATE decision_versions SET changed_at = changed_at - 5000; UPDATE review_items SET updated_at = updated_at - 5000");
 const before=Number(bootstrap.cursor.split('.')[0])-4000;
 await call(e,'decisions/synthetic-1','DELETE');
 const pushed=await (await call(e,'decisions?delta=1','PUT',{decisions:[{id:'synthetic-2',decision:'keep'},{id:'synthetic-3',decision:'remove'}]})).json();
 assert.deepEqual(pushed,{ok:true,delta:true,decisions:[{id:'synthetic-2',decision:'remove'},{id:'synthetic-3',decision:'remove'}]});
 const delta=await (await call(e,`state?cursor=${before}.${bootstrap.cursor.split('.')[1]}`)).json();
 assert.deepEqual(delta.decisions.sort((a,b)=>a.id.localeCompare(b.id)),[{id:'synthetic-1',decision:null},{id:'synthetic-3',decision:'remove'}]);
 const otherScope=await (await call(e,`state?scope=other&cursor=${bootstrap.cursor}`)).json();
 assert.equal(otherScope.delta,undefined);assert.match(otherScope.cursor,new RegExp(`\\.${digest('other')}$`));
 for(const cursor of ['abc','1.','1.UPPER','.abc','1.abcdefgh'])assert.equal((await call(e,`state?cursor=${cursor}`)).status,400);
});

test('an unchanged delta pull is answered by one index-only check',async()=>{
 const e=env();seed(e,500);
 const {cursor}=await (await call(e,'state?cursor=')).json();
 e.DB.reset();const executed=[];const prepare=e.DB.prepare.bind(e.DB);e.DB.prepare=sql=>{executed.push(sql);return prepare(sql);};
 await call(e,`state?cursor=${cursor}`);
 assert.equal(executed.filter(sql=>/FROM (decisions|decision_versions|review_items)\b/.test(sql)&&!/MAX\(/.test(sql)).length,0);
 assert.ok(e.DB.stats.rowsRead<=6,`rows read ${e.DB.stats.rowsRead}`);
});

test('progress uploads write each item once and read back only rejected rows',async()=>{
 const e=env(),reads=[];
 const prepare=e.DB.prepare.bind(e.DB);e.DB.prepare=sql=>{if(/^SELECT data FROM review_items WHERE scope = \? AND id = \?$/.test(sql))reads.push(sql);return prepare(sql);};
 const items=Array.from({length:2000},(_,index)=>({mediaKey:`synthetic-${index}`,type:'photo',state:'active',revision:2}));
 e.DB.reset();
 const response=await (await call(e,'progress','PUT',{started:true,reviewed:0,items})).json();
 assert.deepEqual(response.items,items);
 assert.equal(reads.length,0);
 assert.ok(e.DB.stats.queries<=2010,`queries ${e.DB.stats.queries}`);
 e.DB.sqlite.exec(`UPDATE review_items SET data = json_set(data,'$.revision',9) WHERE id = 'synthetic-7'`);
 const next=items.slice(0,10).map(item=>({...item,revision:3}));
 const stale=await (await call(e,'progress','PUT',{started:true,reviewed:0,items:next})).json();
 assert.equal(stale.items.find(item=>item.mediaKey==='synthetic-7').revision,9);
 assert.deepEqual(stale.items.map(item=>item.mediaKey),next.map(item=>item.mediaKey));
 assert.ok(stale.items.filter(item=>item.mediaKey!=='synthetic-7').every(item=>item.revision===3));
 assert.equal(reads.length,1);
});

test('trash safety checks read only the checked rows',async()=>{
 const e=env();seed(e,1000);
 const ids=Array.from({length:25},(_,index)=>`synthetic-${index*2}`);
 e.DB.reset();
 assert.equal((await (await call(e,'trash-check','POST',{ids})).json()).safe,true);
 assert.deepEqual(e.DB.stats.unbounded,[]);assert.ok(e.DB.stats.rowsRead<=40,`rows read ${e.DB.stats.rowsRead}`);
 assert.equal((await (await call(e,'trash-check','POST',{ids:[...ids.slice(1),'synthetic-1']})).json()).safe,false);
});

test('undo uploads send only the changed tail and fall back to a full upload when the base differs',async()=>{
 const entry=index=>({key:`synthetic-${index}`,previous:null,decision:index%2?'keep':'remove',revision:index+1});
 const base=Array.from({length:2000},(_,index)=>entry(index));
 assert.deepEqual(historyPatch(base,[...base.slice(1),entry(2000)]),{start:1,end:2000,append:[entry(2000)]});
 assert.deepEqual(historyPatch(base,base.slice(0,-1)),{start:0,end:1999,append:[]});
 assert.equal(historyPatch([],[entry(0)]),null);
 const e=env(),requests=[],client=clientFor(e,requests);
 await call(e,'undo','PUT',{history:base});
 let state=await client.sync('default',{started:true,items:[],history:[],syncDecisions:{}},save);
 assert.equal(state.history.length,2000);
 state=await client.sync('default',{...state,history:[...state.history.slice(1),entry(2000)],syncDirty:true},save);
 const patch=requests.find(({url,options})=>url.pathname==='/api/undo'&&options.method==='POST');
 assert.ok(patch.options.body.length<300,`patch body ${patch.options.body.length}`);
 assert.deepEqual(JSON.parse(e.DB.sqlite.prepare("SELECT history FROM review_state WHERE scope LIKE '%:device:%'").get().history),[...base.slice(1),entry(2000)]);
 e.DB.sqlite.prepare("UPDATE review_state SET history = '[]' WHERE scope LIKE '%:device:%'").run();
 requests.length=0;
 state=await client.sync('default',{...state,history:state.history.slice(0,-1),syncDirty:true},save,{pull:false});
 assert.deepEqual(requests.filter(({url})=>url.pathname==='/api/undo').map(({options})=>options.method),['POST','PUT']);
 assert.equal(JSON.parse(e.DB.sqlite.prepare("SELECT history FROM review_state WHERE scope LIKE '%:device:%'").get().history).length,1999);
 assert.equal((await call(e,'undo','POST',{action:'patch',base:'zzz',start:0,end:0,append:[]})).status,409);
 for(const body of [{action:'patch',base:'x',start:2,end:1,append:[]},{action:'patch',base:'x',start:0,end:0},{action:'patch',base:'BAD',start:0,end:0,append:[]},{action:'patch',base:'x',start:0,end:0,append:[],extra:1}])assert.equal((await call(e,'undo','POST',body)).status,400);
});

test('a failed progress batch keeps the accepted batches checkpointed',async()=>{
 const e=env(),requests=[];let fail=true,batches=0;
 const client=createSyncClient({fetch:(url,options)=>{
  const path=new URL(url).pathname;
  if(path==='/api/progress'){requests.push(JSON.parse(options.body).items.map(item=>item.mediaKey));if(++batches===2&&fail)return Promise.resolve(new Response('{}',{status:503}));}
  return syncRequest(new Request(url,options),e);
 }});
 client.configure({url:'https://sync.example',token:'synthetic-secret'});
 const items=Array.from({length:2500},(_,index)=>({mediaKey:`synthetic-${index}`,type:'photo',state:'active',revision:1,lastDecisionAt:index+1}));
 let state=await client.sync('default',{started:true,items,history:[],syncDecisions:{},syncPending:{}},save);
 assert.equal(requests.length,2);assert.equal(requests[0].length,2000);
 assert.equal(state.syncCheckpoint.items.length,2000);
 assert.equal(client.ready(),false);
 fail=false;requests.length=0;
 state=await client.sync('default',state,save);
 assert.deepEqual(requests.map(batch=>batch.length),[500]);
 assert.equal(state.syncCheckpoint.items.length,2500);
 assert.equal(client.ready(),true);
});

test('failed syncs back off exponentially and recover on success',async t=>{
 let now=1_000_000,fail=true;
 t.mock.method(Date,'now',()=>now);
 const e=env(),client=createSyncClient({fetch:(url,options)=>fail?Promise.resolve(new Response('{}',{status:500})):syncRequest(new Request(url,options),e)});
 client.configure({url:'https://sync.example',token:'synthetic-secret'});
 const state={started:true,items:[],history:[],syncDecisions:{},syncPending:{synthetic:'keep'}};
 const delays=[];
 for(let attempt=0;attempt<9;attempt++){
  assert.equal(client.ready(),true);
  await client.sync('default',state,save);
  let wait=0;while(!client.ready(now+wait))wait+=1000;
  delays.push(wait);now+=wait;
 }
 assert.deepEqual(delays.slice(0,4),[SYNC_BACKOFF_MS,SYNC_BACKOFF_MS*2,SYNC_BACKOFF_MS*4,SYNC_BACKOFF_MS*8]);
 assert.equal(delays.at(-1),SYNC_BACKOFF_MAX_MS);
 fail=false;
 await client.sync('default',state,save);
 assert.equal(client.ready(),true);
});

test('polling slows down while idle and pushes only pending work between polls',()=>{
 const clean={syncPending:{}},now=10_000_000;
 assert.equal(heartbeatSync(clean,now-SYNC_POLL_MS,now,now),'pull');
 assert.equal(heartbeatSync(clean,now-SYNC_POLL_MS,now,now-SYNC_IDLE_AFTER_MS),null);
 assert.equal(heartbeatSync(clean,now-SYNC_IDLE_POLL_MS,now,now-SYNC_IDLE_AFTER_MS),'pull');
 assert.equal(heartbeatSync({syncPending:{synthetic:'keep'}},now,now,now-SYNC_IDLE_AFTER_MS),'push');
 assert.equal(heartbeatSync(clean,now-SYNC_POLL_MS,now),'pull');
});

test('the UI merge keeps the new sync cursor and undo base',()=>{
 const snapshot={items:[],history:[],syncDecisions:{},syncPending:{}};
 const synced={...snapshot,syncCursor:{key:'k',at:'5.abc'},syncHistory:[],syncProgress:{},syncCheckpoint:{}};
 const merged=mergeSyncResult({...snapshot,syncCursor:{key:'k',at:'1.abc'}},snapshot,synced);
 assert.deepEqual(merged.syncCursor,{key:'k',at:'5.abc'});assert.deepEqual(merged.syncHistory,[]);
});
