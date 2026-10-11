import test from 'node:test';
import assert from 'node:assert/strict';
import {canUndoReview,decideReview,finishReviewAlbum,reconcileReviewTrash,mergeReviewPage} from '../lib/userscript-core.mjs';
import {syncRequest} from '../worker/src/sync.mjs';
import {createSyncClient,markSyncChanges,validateSyncSettings} from '../lib/userscript-sync.mjs';
class FakeD1 {
 decisions=new Map();records=new Map();
 batch(statements){return Promise.all(statements.map(statement=>statement.run()));}
 prepare(sql){return {bind:(...args)=>{
 const execute=()=>{
 const [a,b,c,d]=args;
 if(sql.startsWith('SELECT id'))return {results:[...this.decisions.values()].filter(row=>row.scope===a).map(({id,decision})=>({id,decision}))};
 if(sql.startsWith('SELECT progress'))return this.records.get(a)||null;
 if(sql.startsWith('INSERT INTO decisions'))this.decisions.set(`${a}:${b}`,{scope:a,id:b,decision:c});
 if(sql.startsWith('DELETE'))this.decisions.delete(`${a}:${b}`);
 if(sql.startsWith('INSERT OR IGNORE')){if(!this.records.has(a))this.records.set(a,{progress:'{}',history:'[]'});}
 if(sql.startsWith('UPDATE review_state SET progress'))this.records.get(b).progress=a;
 if(sql.startsWith('UPDATE review_state SET history = ?'))this.records.get(b).history=a;
 if(sql.includes('CASE WHEN')){const record=this.records.get(c),history=JSON.parse(record.history);if(a==='push'){if(history.length>=2000)return null;history.push(JSON.parse(b));}else history.pop();record.history=JSON.stringify(history);return record;}
 return {success:true};
 };
 return {all:async()=>execute(),first:async()=>execute(),run:async()=>execute()};
 }};}
}
const env=()=>({SYNC_TOKEN:'test-secret',DB:new FakeD1()});
const call=(environment,path,method='GET',value,headers={})=>syncRequest(new Request(`https://sync.example/api/${path}`,{method,headers:{Authorization:'Bearer test-secret',Origin:'https://photos.google.com',...headers},...(value!==undefined?{body:JSON.stringify(value)}:{})}),environment);
test('API requires configured secret and exact bearer authentication',async()=>{
 assert.equal((await call({},'state')).status,500);
 for(const Authorization of ['', 'Bearer wrong','Basic test-secret','Bearer test-secretx'])assert.equal((await call(env(),'state','GET',undefined,{Authorization})).status,401);
 assert.equal((await call(env(),'state')).status,200);
});
test('CORS allows Photos preflight without credentials and denies other origins',async()=>{
 const response=await call(env(),'state','OPTIONS',undefined,{Authorization:''});assert.equal(response.status,204);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://photos.google.com');assert.match(response.headers.get('Access-Control-Allow-Headers'),/Authorization/);
 assert.equal((await call(env(),'state','OPTIONS',undefined,{Origin:'https://evil.example'})).status,403);
 assert.equal((await call(env(),'state','GET',undefined,{Origin:'https://evil.example'})).headers.get('Access-Control-Allow-Origin'),null);
});
test('D1 routes persist decisions, progress and undo within scopes',async()=>{
 const e=env();assert.equal((await call(e,'decisions/item','PUT',{decision:'keep'})).status,200);
 await call(e,'progress','PUT',{started:true,reviewed:1});
 const entry={key:'item',previous:null,decision:'keep',revision:1};await call(e,'undo','POST',{action:'push',entry});
 assert.deepEqual(await (await call(e,'state')).json(),{decisions:[{id:'item',decision:'keep'}],progress:{started:true,reviewed:1},history:[entry]});
 assert.deepEqual(await (await call(e,'state?scope=another')).json(),{decisions:[],progress:{},history:[]});
 await call(e,'undo','POST',{action:'pop'});await call(e,'decisions/item','DELETE');
 assert.deepEqual((await (await call(e,'state')).json()).history,[]);
 assert.deepEqual(await (await call(e,'progress')).json(),{started:true,reviewed:1});
 await call(e,'undo','PUT',{history:[entry]});assert.equal((await (await call(e,'state')).json()).history.length,1);
});
test('API rejects invalid decisions, leaked metadata, oversized input and unknown routes',async()=>{
 for(const [path,value] of [['decisions/item',{decision:'trash'}],['decisions/item',{decision:'keep',url:'https://example.com'}],['progress',{started:true,reviewed:1,cursor:'token'}],['undo',{history:[{key:'item',url:'image'}]}],['decisions/item',{decision:'x'.repeat(262145)}]])assert.equal((await call(env(),path,'PUT',value)).status,400);
 assert.equal((await call(env(),'missing')).status,404);
});
test('sync uses authenticated page fetch, merges remote IDs, and retries local offline changes',async()=>{
 const e=env(),requests=[],statuses=[];
 await call(e,'decisions/remote?scope=account','PUT',{decision:'remove'});
 let offline=true;
 const client=createSyncClient({status:value=>statuses.push(value),fetch:async(url,options)=>{requests.push({url,options});if(offline)throw Error('Offline');return syncRequest(new Request(url,{...options,headers:{...options.headers,Origin:'https://photos.google.com'}}),e);}});
 client.configure(validateSyncSettings('https://sync.example','test-secret'));
 let state={revision:0,started:true,history:[],items:[{mediaKey:'local',decision:null,thumbUrl:'secret-image'},{mediaKey:'remote',decision:null}]};
 state=markSyncChanges(state,{...state,items:state.items.map(item=>item.mediaKey==='local'?{...item,decision:'keep'}:item)});
 const save=async value=>({...value,revision:value.revision+1});
 state=await client.sync('account',state,save);assert.equal(state.syncPending.local,'keep');offline=false;
 state=await client.sync('account',state,save);assert.equal(state.items[1].decision,'remove');assert.deepEqual(state.syncPending,{});
 assert.equal(requests.some(({options})=>options.body?.includes('secret-image')),false);
 assert.equal(requests[0].options.credentials,'omit');assert.equal(statuses.at(-1),'Synced · 2 reviewed IDs');
 client.configure({});const count=requests.length;await client.sync('account',state,save);assert.equal(requests.length,count);
});
test('remote undo clears a previously synced decision on another device',async()=>{
 const e=env(),client=createSyncClient({fetch:(url,options)=>syncRequest(new Request(url,options),e)});
 client.configure({url:'https://sync.example',token:'test-secret'});
 await call(e,'decisions/item?scope=account','PUT',{decision:'keep'});
 let state={revision:0,started:true,history:[],items:[{mediaKey:'item',decision:null}],syncDecisions:{},syncPending:{}};
 const save=async value=>({...value,revision:value.revision+1});
 state=await client.sync('account',state,save);assert.equal(state.items[0].decision,'keep');
 await call(e,'decisions/item?scope=account','DELETE');
 state=await client.sync('account',state,save);assert.equal(state.items[0].decision,null);
});
test('HTTP rejection preserves pending changes and settings reject insecure or credentialed URLs',async()=>{
 const statuses=[],client=createSyncClient({status:value=>statuses.push(value),fetch:async()=>new Response('{}',{status:401})});
 client.configure({url:'https://sync.example',token:'wrong'});
 const state={items:[],history:[],syncPending:{item:'remove'},syncDirty:true};
 assert.equal(await client.sync('account',state,()=>{throw Error('Unexpected save');}),state);
 assert.match(statuses.at(-1),/401.*saved locally/);
 for(const url of ['http://sync.example','https://user:pass@sync.example','https://sync.example/api/','https://sync.example/?token=secret'])assert.throws(()=>validateSyncSettings(url,'secret'));
 assert.deepEqual(validateSyncSettings('',''),{url:'',token:''});
});

test('first sync backfills decisions after unrelated saves and preserves pending overrides',async()=>{
 const e=env(),requests=[],client=createSyncClient({fetch:(url,options)=>{requests.push({url,options});return syncRequest(new Request(url,options),e);}});
 client.configure({url:'https://sync.example',token:'test-secret'});
 await call(e,'decisions/conflict','PUT',{decision:'remove'});
 await call(e,'decisions/deleted','PUT',{decision:'keep'});
 const remoteEntry={key:'remote',previous:null,decision:'keep',revision:1};
 await call(e,'undo','PUT',{history:[remoteEntry]});
 let state={history:[],items:[{mediaKey:'conflict',decision:'keep'},{mediaKey:'missing',decision:'remove'},{mediaKey:'deleted',decision:'keep'},{mediaKey:'edited',decision:'keep'}],syncPending:{deleted:null,edited:'remove'}};
 state=markSyncChanges(state,{...state,cursor:'next',albumKey:'album'});
 assert.equal(state.syncDirty,false);
 state=await client.sync('default',state,async value=>value);
 assert.deepEqual(state.syncDecisions,{conflict:'keep',missing:'remove',edited:'remove'});
 assert.equal(state.items.find(item=>item.mediaKey==='deleted').decision,null);
 assert.equal(state.items.find(item=>item.mediaKey==='edited').decision,'remove');
 assert.deepEqual(state.history,[remoteEntry]);
 assert.equal(requests.some(({url,options})=>new URL(url).pathname==='/api/undo'&&options.method==='PUT'),false);
});
test('unrelated saves retain clean history and history edits retain dirty status',()=>{
 const state={history:[{key:'item',previous:null,decision:'keep',revision:1}],items:[{mediaKey:'item',decision:'keep'}],syncDecisions:{item:'keep'},syncPending:{}};
 assert.equal(markSyncChanges(state,{...state,cursor:'next'}).syncDirty,false);
 const changed=markSyncChanges(state,{...state,history:[]});
 assert.equal(changed.syncDirty,true);
 assert.equal(markSyncChanges(changed,{...changed,albumKey:'album'}).syncDirty,true);
});
test('clean pulls preserve album, trash and library restore revision locks',async()=>{
 const e=env(),client=createSyncClient({fetch:(url,options)=>syncRequest(new Request(url,options),e)});
 client.configure({url:'https://sync.example',token:'test-secret'});
 const entry={key:'item',previous:null,decision:'remove',revision:1};
 await call(e,'decisions/item','PUT',{decision:'remove'});
 await call(e,'undo','PUT',{history:[entry]});
 const original={history:[entry],items:[{mediaKey:'item',decision:'remove',revision:1,state:'active'}],syncDecisions:{item:'remove'},syncPending:{}};
 const album=finishReviewAlbum({...original,job:{albumKey:'album',mediaKeys:['item']}},{keys:['item'],dedupKeys:[]});
 const trash=await reconcileReviewTrash(original,async()=>({items:[{mediaKey:'item'}],nextPageId:null}));
 const restored=mergeReviewPage(trash,{items:[{mediaKey:'item'}],nextPageId:null},null,true);
 for(const locked of [album,trash,restored]){
  let state=markSyncChanges(original,locked);
  state=await client.sync('default',state,async value=>value);
  state=await client.sync('default',state,async value=>value);
  assert.equal(state.items[0].revision,locked.items[0].revision);
  assert.equal(canUndoReview(state,entry),false);
  assert.throws(()=>decideReview(state,'item',null,'remove',entry.revision));
 }
});
test('pulled decisions initialize undo revisions for changed or uninitialized items',async()=>{
 const e=env(),client=createSyncClient({fetch:(url,options)=>syncRequest(new Request(url,options),e)});
 client.configure({url:'https://sync.example',token:'test-secret'});
 const entry={key:'item',previous:null,decision:'keep',revision:3};
 await call(e,'decisions/item','PUT',{decision:'keep'});
 await call(e,'undo','PUT',{history:[entry]});
 for(const item of [{mediaKey:'item',decision:null,revision:8},{mediaKey:'item',decision:'keep',revision:0},{mediaKey:'item',decision:'keep'}]){
  const state=await client.sync('default',{history:[],items:[item],syncDecisions:{item:'keep'}},async value=>value);
  assert.equal(state.items[0].revision,3);
  assert.equal(canUndoReview(state,entry),true);
 }
});
test('empty pending maps after offline cursor saves still backfill existing decisions',async()=>{
 const e=env();let offline=true;
 const client=createSyncClient({fetch:(url,options)=>{if(offline)throw Error('Offline');return syncRequest(new Request(url,options),e);}});
 client.configure({url:'https://sync.example',token:'test-secret'});
 await call(e,'decisions/item','PUT',{decision:'remove'});
 let state={history:[],items:[{mediaKey:'item',decision:'keep'}]};
 state=markSyncChanges(state,{...state,cursor:'next'});
 assert.deepEqual(state.syncPending,{});
 state=await client.sync('default',state,async value=>value);
 assert.equal(state.items[0].decision,'keep');
 offline=false;
 state=await client.sync('default',state,async value=>value);
 assert.equal(state.syncDecisions.item,'keep');
 assert.equal(state.items[0].decision,'keep');
});

test('ten decisions push as one atomic batch without a state pull',async()=>{
 const e=env(),requests=[];
 const client=createSyncClient({fetch:(url,options)=>{requests.push({url,options});return syncRequest(new Request(url,options),e);}});
 client.configure({url:'https://sync.example',token:'test-secret'});
 const items=Array.from({length:10},(_,index)=>({mediaKey:`item-${index}`,decision:'keep'}));
 const state={started:true,items,history:[],syncDecisions:{},syncPending:Object.fromEntries(items.map(item=>[item.mediaKey,item.decision]))};
 const result=await client.sync('account',state,async value=>value,{pull:false});
 assert.equal(requests.length,1);assert.equal(new URL(requests[0].url).pathname,'/api/decisions');
 assert.equal(JSON.parse(requests[0].options.body).decisions.length,10);assert.deepEqual(result.syncPending,{});
 assert.equal((await (await call(e,'state?scope=account')).json()).decisions.length,10);
 const before=[...e.DB.decisions];
 assert.equal((await call(e,'decisions','PUT',{decisions:[{id:'valid',decision:'keep'},{id:'bad',decision:'trash'}]})).status,400);
 assert.deepEqual([...e.DB.decisions],before);
 await call(e,'decisions?scope=account','PUT',{decisions:[{id:'item-0',decision:null}]});
 assert.equal((await (await call(e,'state?scope=account')).json()).decisions.length,9);
});

test('concurrent sync merges remote decisions and undo history around a local swipe',async()=>{
 const {mergeSyncResult}=await import('../lib/userscript-sync.mjs');
 const snapshot={items:[{mediaKey:'local',decision:null,revision:0},{mediaKey:'remote',decision:null,revision:0}],history:[],syncDecisions:{},syncPending:{}};
 const localEntry={key:'local',previous:null,decision:'keep',revision:1},remoteEntry={key:'remote',previous:null,decision:'remove',revision:4};
 const current=markSyncChanges(snapshot,{...snapshot,items:[{...snapshot.items[0],decision:'keep',revision:1},snapshot.items[1]],history:[localEntry]});
 const synced={...snapshot,items:[snapshot.items[0],{...snapshot.items[1],decision:'remove',revision:4}],history:[remoteEntry],syncDecisions:{remote:'remove'},syncDirty:false};
 const merged=mergeSyncResult(current,snapshot,synced);
 assert.deepEqual(merged.items.map(item=>item.decision),['keep','remove']);
 assert.deepEqual(merged.history,[remoteEntry,localEntry]);assert.deepEqual(merged.syncPending,{local:'keep'});assert.equal(merged.syncDirty,true);
 const e=env(),client=createSyncClient({fetch:(url,options)=>syncRequest(new Request(url,options),e)});
 client.configure({url:'https://sync.example',token:'test-secret'});
 await client.sync('default',merged,async value=>value,{pull:false});
 assert.deepEqual((await (await call(e,'state')).json()).history,[remoteEntry,localEntry]);
});
test('large decision uploads fit count and byte limits and resume after partial failure',async()=>{
 for(const long of [false,true]){
  const e=env(),requests=[];let fail=true;
  const client=createSyncClient({fetch:(url,options)=>{
   if(new URL(url).pathname==='/api/decisions'){
    requests.push(JSON.parse(options.body).decisions);
    assert.ok(Buffer.byteLength(options.body)<=262144);assert.ok(requests.at(-1).length<=2000);
    if(requests.length===2&&fail)return new Response('{}',{status:503});
   }
   return syncRequest(new Request(url,options),e);
  }});
  client.configure({url:'https://sync.example',token:'test-secret'});
  const pending=Object.fromEntries(Array.from({length:2101},(_,index)=>[`${long?'x'.repeat(245):'item'}-${index}`,index===2100?null:'keep']));
  let state={started:true,items:[],history:[],syncDecisions:{},syncPending:pending};
  state=await client.sync('default',state,async value=>value,{pull:false});
  assert.equal(Object.keys(state.syncPending).length,2101-requests[0].length);
  fail=false;state=await client.sync('default',state,async value=>value,{pull:false});
  assert.deepEqual(state.syncPending,{});assert.equal(e.DB.decisions.size,2100);
  assert.equal(requests.at(-1).at(-1).decision,null);
 }
});
