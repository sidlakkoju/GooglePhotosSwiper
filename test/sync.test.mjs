import test from 'node:test';
import assert from 'node:assert/strict';
import {canUndoReview,decideReview,finishReviewAlbum,reconcileReviewTrash,mergeReviewPage,reviewQueue,reviewTrashCandidates,sendReviewAlbum} from '../lib/userscript-core.mjs';
import {hash} from '../worker/src/pairing.mjs';
import {syncRequest} from '../worker/src/sync.mjs';
import {createSyncClient,markSyncChanges,validateSyncSettings,reviewSyncProgress,rebuildSyncedReview} from '../lib/userscript-sync.mjs';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
class FakeD1 {
 constructor(){this.sqlite=new DatabaseSync(':memory:');for(const file of ['0001_init.sql','0002_pairing.sql','0003_review_items.sql','0004_google_sync.sql'])this.sqlite.exec(readFileSync(new URL(`../worker/migrations/${file}`,import.meta.url),'utf8'));}
 prepare(sql){
  const statement=this.sqlite.prepare(sql);
  const bound=args=>({all:async()=>({results:statement.all(...args)}),first:async()=>statement.get(...args)||null,run:async()=>statement.run(...args),execute:()=>({results:statement.all(...args),meta:{changes:Number(this.sqlite.prepare('SELECT changes() AS n').get().n)}})});
  return {...bound([]),bind:(...args)=>{if(args.some(Array.isArray))throw Error('D1_TYPE_ERROR');return bound(args);}};
 }
 async batch(statements){this.sqlite.exec('BEGIN');try{const results=statements.map(statement=>statement.execute());this.sqlite.exec('COMMIT');return results;}catch(error){this.sqlite.exec('ROLLBACK');throw error;}}
}
const env=()=>({SYNC_TOKEN:'test-secret',PAIRING_IP_KEY:'qa-ip-key',DB:new FakeD1()});
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
test('sync timeouts show a friendly status and only the first sync retries',async()=>{
 const statuses=[];let requests=0;
 const client=createSyncClient({status:value=>statuses.push(value),fetch:async()=>{requests++;throw new DOMException('signal timed out','TimeoutError');}});
 const settings={url:'https://sync.example',token:'synthetic-token'},state={items:[],history:[],syncPending:{synthetic:'keep'}};
 client.configure(settings);
 const save=async()=>{throw Error('Unexpected save');};
 assert.equal(await client.sync('qa',state,save),state);
 assert.equal(requests,2);
 assert.match(statuses.at(-1),/^Sync timed out.*saved locally/);
 assert.doesNotMatch(statuses.join(' '),/signal timed out/);
 await client.sync('qa',state,save);
 assert.equal(requests,3);
 client.configure(settings);
 await client.sync('qa',state,save);
 assert.equal(requests,5);
});
test('first sync retries a timed-out request and saves the successful response',async()=>{
 const statuses=[],signals=[];let requests=0;
 const client=createSyncClient({status:value=>statuses.push(value),fetch:async(url,options)=>{
  signals.push(options.signal);
  if(++requests===1)throw new DOMException('signal timed out','TimeoutError');
  return Response.json(options.method==='PUT'?{items:JSON.parse(options.body).items}:{decisions:[{id:'synthetic',decision:'keep'}],history:[],progress:{}});
 }});
 client.configure({url:'https://sync.example',token:'synthetic-token'});
 let saves=0;
 const result=await client.sync('qa',{items:[{mediaKey:'synthetic',decision:null}],history:[]},async value=>{saves++;return value;});
 assert.equal(requests,3);
 assert.equal(saves,1);
 assert.notEqual(signals[0],signals[1]);
 assert.equal(result.items[0].decision,'keep');
 assert.equal(statuses.at(-1),'Synced · 1 reviewed IDs');
 assert.equal(statuses.some(value=>value.includes('timed out')),false);
});
test('an expired request signal normalizes browser AbortError text',async t=>{
 t.mock.method(AbortSignal,'timeout',()=>AbortSignal.abort(new DOMException('signal timed out','TimeoutError')));
 const statuses=[];
 const client=createSyncClient({status:value=>statuses.push(value),fetch:async()=>{throw new DOMException('The operation was aborted','AbortError');}});
 client.configure({url:'https://sync.example',token:'synthetic-token'});
 await client.sync('qa',{items:[],history:[]},async value=>value);
 assert.equal(statuses.at(-1),'Sync timed out · saved locally; retry on next action');
});
test('non-timeout sync failures do not retry and preserve clear error messages',async()=>{
 for(const [error,message] of [[Error('Offline'),'Offline'],[new DOMException('The operation was aborted','AbortError'),'Sync cancelled']]){
  const statuses=[];let requests=0;
  const client=createSyncClient({status:value=>statuses.push(value),fetch:async()=>{requests++;throw error;}});
  client.configure({url:'https://sync.example',token:'synthetic-token'});
  await client.sync('qa',{items:[],history:[]},async value=>value);
  assert.equal(requests,1);
  assert.equal(statuses.at(-1),`${message} · saved locally; retry on next action`);
 }
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
 assert.equal(statuses.at(-1),'This device was unpaired.');
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
 assert.equal(requests.length,2);assert.equal(new URL(requests[0].url).pathname,'/api/decisions');assert.equal(new URL(requests[1].url).pathname,'/api/progress');
 assert.equal(JSON.parse(requests[0].options.body).decisions.length,10);assert.deepEqual(result.syncPending,{});
 assert.equal((await (await call(e,'state?scope=account')).json()).decisions.length,10);
 const before=e.DB.sqlite.prepare('SELECT * FROM decisions').all();
 assert.equal((await call(e,'decisions','PUT',{decisions:[{id:'valid',decision:'keep'},{id:'bad',decision:'trash'}]})).status,400);
 assert.deepEqual(e.DB.sqlite.prepare('SELECT * FROM decisions').all(),before);
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
  assert.deepEqual(state.syncPending,{});assert.equal(e.DB.sqlite.prepare('SELECT count(*) AS n FROM decisions').get().n,2100);
  assert.equal(requests.at(-1).at(-1).decision,null);
 }
});

test('partial batches retain history deletions until the undo upload succeeds',async()=>{
 const e=env(),removed={key:'removed',previous:null,decision:'keep',revision:1},kept={key:'last',previous:null,decision:'remove',revision:1};
 await call(e,'undo','PUT',{history:[removed]});
 let batches=0,fail=true;
 const client=createSyncClient({fetch:(url,options)=>{
  if(new URL(url).pathname==='/api/decisions'&&++batches===2&&fail)return new Response('{}',{status:503});
  return syncRequest(new Request(url,options),e);
 }});
 client.configure({url:'https://sync.example',token:'test-secret'});
 let state={started:true,items:[],history:[kept],syncDecisions:{removed:'keep'},syncDirty:true,syncPending:{removed:null,...Object.fromEntries(Array.from({length:2000},(_,index)=>[`id-${index}`,'keep'])),last:'remove'}};
 state=await client.sync('default',state,async value=>value);
 assert.equal(Object.hasOwn(state.syncPending,'removed'),false);
 fail=false;state=await client.sync('default',state,async value=>value);
 assert.deepEqual(state.history,[kept]);assert.deepEqual((await (await call(e,'state')).json()).history,[kept]);
});

const claim=(e,value,ip='192.0.2.1')=>call(e,'pair/claim','POST',{name:'QA phone',platform:'test',...value},{Authorization:'','CF-Connecting-IP':ip});
const start=async e=>{const response=await call(e,'pair/start','POST');assert.equal(response.status,200);return response.json();};
const withToken=token=>({Authorization:`Bearer ${token}`});
test('pairing hashes bind as D1 blobs and plain arrays are rejected',async()=>{
 const db=new FakeD1(),digest=await hash('abc');
 assert.ok(digest instanceof Uint8Array);
 assert.equal(Buffer.from(digest).toString('hex'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
 assert.throws(()=>db.prepare('SELECT ?').bind(Array.from(digest)),/D1_TYPE_ERROR/);
 const row=await db.prepare('SELECT typeof(?) AS type, hex(?) AS digest').bind(digest,digest).first();
 assert.equal(row.type,'blob');
 assert.equal(row.digest,Buffer.from(digest).toString('hex').toUpperCase());
});
test('pairing round trip, status ownership, replay and hash-only storage',async()=>{
 const e=env();await call(e,'decisions/preserved','PUT',{decision:'keep'});
 const pairing=await start(e);
 assert.match(pairing.code,/^[A-Za-z0-9_-]{22}$/);assert.match(pairing.short,/^\d{6}$/);
 const response=await claim(e,{code:pairing.code});assert.equal(response.status,200);
 const device=await response.json();assert.match(device.token,/^[A-Za-z0-9_-]{43}$/);
 assert.equal((await call(e,'state','GET',undefined,withToken(device.token))).status,200);
 assert.deepEqual(await (await call(e,`pair/status?id=${pairing.id}`)).json(),{claimed:true,name:'QA phone'});
 assert.equal((await call(e,`pair/status?id=${pairing.id}`,'GET',undefined,withToken(device.token))).status,404);
 assert.deepEqual(await (await claim(e,{code:pairing.code})).json(),{error:'expired_or_used'});
 const stored=e.DB.sqlite.prepare('SELECT hex(code_hash) AS code,hex(short_hash) AS short FROM pairing_codes').get();
 assert.equal(stored.code.length,64);assert.equal(stored.short.length,64);
 const tokenRow=e.DB.sqlite.prepare('SELECT hex(token_hash) AS token FROM devices WHERE id = ?').get(device.deviceId);assert.equal(tokenRow.token.length,64);
 assert.equal(JSON.stringify([stored,tokenRow]).includes(device.token),false);
 assert.equal((await (await call(e,'state')).json()).decisions[0].id,'preserved');
});
test('pairing stores code, token and IP HMAC digests as D1 blobs',async()=>{
 const e=env(),pairing=await start(e),ip='203.0.113.42';
 const response=await claim(e,{code:pairing.code},ip);
 assert.equal(response.status,200);
 const device=await response.json();
 const stored=e.DB.sqlite.prepare('SELECT typeof(code_hash) AS codeType, typeof(short_hash) AS shortType, hex(code_hash) AS code, hex(short_hash) AS short FROM pairing_codes WHERE id = ?').get(pairing.id);
 assert.equal(stored.codeType,'blob');
 assert.equal(stored.shortType,'blob');
 assert.equal(stored.code,Buffer.from(await hash(pairing.code)).toString('hex').toUpperCase());
 assert.equal(stored.short,Buffer.from(await hash(pairing.short)).toString('hex').toUpperCase());
 const token=e.DB.sqlite.prepare('SELECT typeof(token_hash) AS type, hex(token_hash) AS digest FROM devices WHERE id = ?').get(device.deviceId);
 assert.equal(token.type,'blob');
 assert.equal(token.digest,Buffer.from(await hash(device.token)).toString('hex').toUpperCase());
 const encoder=new TextEncoder(),key=await crypto.subtle.importKey('raw',encoder.encode(e.PAIRING_IP_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const ipDigest=new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(ip)));
 const attempt=e.DB.sqlite.prepare('SELECT typeof(ip_hash) AS type, count FROM pair_attempts WHERE ip_hash = ?').get(ipDigest);
 assert.equal(attempt.type,'blob');
 assert.equal(attempt.count,1);
 assert.equal((await call(e,'state','GET',undefined,withToken(device.token))).status,200);
});
test('50 concurrent claims create exactly one device',async()=>{
 const e=env(),pairing=await start(e);
 const responses=await Promise.all(Array.from({length:50},(_,index)=>claim(e,{code:pairing.code},`192.0.2.${index+1}`)));
 assert.equal(responses.filter(response=>response.status===200).length,1);
 assert.equal(responses.filter(response=>response.status===400).length,49);
 assert.equal(e.DB.sqlite.prepare('SELECT count(*) AS n FROM devices WHERE is_legacy = 0').get().n,1);
});
test('expiry, replacement and five wrong short guesses burn codes without an existence oracle',async()=>{
 const e=env();const old=await start(e),pairing=await start(e);
 assert.equal((await (await claim(e,{code:old.code})).json()).error,'expired_or_used');
 const wrong=pairing.short==='000000'?'000001':'000000';
 for(let index=0;index<5;index++)assert.deepEqual(await (await claim(e,{short:wrong})).json(),{error:'invalid'});
 assert.deepEqual(await (await claim(e,{short:pairing.short})).json(),{error:'invalid'});
 assert.equal((await (await claim(e,{code:pairing.code})).json()).error,'expired_or_used');
 const expired=await start(e);const original=Date.now;
 try{Date.now=()=>original()+300001;assert.equal((await (await claim(e,{code:expired.code})).json()).error,'expired_or_used');}finally{Date.now=original;}
});
test('short claim works and per-IP, global short and start limits return Retry-After',async()=>{
 const e=env(),pairing=await start(e);
 assert.equal((await claim(e,{short:pairing.short})).status,200);
 for(let index=1;index<30;index++)await claim(e,{code:'a'.repeat(22)});
 const ipLimited=await claim(e,{code:'a'.repeat(22)});assert.equal(ipLimited.status,429);assert.ok(Number(ipLimited.headers.get('Retry-After'))>0);
 const g=env();
 for(let index=0;index<100;index++)assert.equal((await claim(g,{short:'999999'},`192.0.2.${index}`)).status,400);
 const live=await start(g);assert.equal((await claim(g,{short:live.short},'198.51.100.1')).status,429);
 assert.equal((await claim(g,{code:live.code},'198.51.100.1')).status,200);
 const s=env();for(let index=0;index<10;index++)await start(s);
 assert.equal((await call(s,'pair/start','POST')).status,429);
 const serialized=JSON.stringify(g.DB.sqlite.prepare('SELECT hex(ip_hash) AS key FROM pair_attempts').all());assert.equal(serialized.includes('192.0.2.'),false);
 g.DB.sqlite.prepare('INSERT INTO pair_attempts VALUES (?,0,1)').run(new Uint8Array([1]));await claim(g,{code:'a'.repeat(22)},'203.0.113.1');assert.equal(g.DB.sqlite.prepare('SELECT count(*) AS n FROM pair_attempts WHERE window_start = 0').get().n,0);
});
test('device management revokes immediately, legacy stays revoked and last_seen is throttled',async()=>{
 const e=env(),pairing=await start(e),device=await (await claim(e,{code:pairing.code})).json(),headers=withToken(device.token);
 const list=await (await call(e,'devices')).json();assert.equal(list.suggestRevokeLegacy,true);assert.equal(list.devices.find(row=>row.id==='legacy').is_legacy,1);assert.equal(JSON.stringify(list).includes('token_hash'),false);
 await call(e,`devices/${device.deviceId}`,'PATCH',{name:'Renamed'});
 assert.equal((await (await call(e,'devices')).json()).devices.find(row=>row.id===device.deviceId).name,'Renamed');
 const initial=e.DB.sqlite.prepare('SELECT last_seen_at FROM devices WHERE id = ?').get(device.deviceId).last_seen_at;
 await call(e,'state','GET',undefined,headers);assert.equal(e.DB.sqlite.prepare('SELECT last_seen_at FROM devices WHERE id = ?').get(device.deviceId).last_seen_at,initial);
 const original=Date.now;try{Date.now=()=>original()+61000;await call(e,'state','GET',undefined,headers);assert.ok(e.DB.sqlite.prepare('SELECT last_seen_at FROM devices WHERE id = ?').get(device.deviceId).last_seen_at>initial);}finally{Date.now=original;}
 await call(e,'devices/legacy','DELETE',undefined,headers);assert.equal((await call(e,'state')).status,401);
 assert.equal((await call(e,'state','GET',undefined,headers)).status,200);
 delete e.SYNC_TOKEN;assert.equal((await call(e,'state','GET',undefined,headers)).status,200);
 await call(e,`devices/${device.deviceId}`,'DELETE',undefined,headers);assert.equal((await call(e,'state','GET',undefined,headers)).status,401);
});
test('revoke others preserves current device and pairing CORS supports PATCH',async()=>{
 const e=env(),device=await (await claim(e,{code:(await start(e)).code})).json(),headers=withToken(device.token);
 assert.equal((await call(e,'devices/revoke-others','POST',undefined,headers)).status,200);
 assert.equal((await call(e,'state')).status,401);assert.equal((await call(e,'state','GET',undefined,headers)).status,200);
 const preflight=await call(e,'pair/claim','OPTIONS');assert.match(preflight.headers.get('Access-Control-Allow-Methods'),/PATCH/);
 assert.equal((await claim(e,{code:'a'.repeat(22)})).headers.get('Access-Control-Allow-Origin'),'https://photos.google.com');
});

test('pairing migration preserves populated sync tables and Worker never logs secrets',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec(readFileSync(new URL('../worker/migrations/0001_init.sql',import.meta.url),'utf8'));
 db.exec("INSERT INTO decisions VALUES ('qa','item','keep'); INSERT INTO review_state VALUES ('qa','{\"started\":true}','[]');");
 const before=[db.prepare('SELECT * FROM decisions').all(),db.prepare('SELECT * FROM review_state').all()];
 db.exec(readFileSync(new URL('../worker/migrations/0002_pairing.sql',import.meta.url),'utf8'));
 assert.deepEqual([db.prepare('SELECT * FROM decisions').all(),db.prepare('SELECT * FROM review_state').all()],before);
 for(const file of ['sync.mjs','pairing.mjs','index.mjs'])assert.doesNotMatch(readFileSync(new URL(`../worker/src/${file}`,import.meta.url),'utf8'),/console\s*\./);
});
test('revoking an issuer prevents outstanding pairing claims',async()=>{
 const e=env(),device=await (await claim(e,{code:(await start(e)).code})).json();
 const pending=await start(e);
 await call(e,'devices/legacy','DELETE',undefined,withToken(device.token));
 assert.equal((await claim(e,{code:pending.code})).status,400);
});

test('concurrent short failures at the global cap burn live codes only once',async()=>{
 const e=env(),pairing=await start(e),window=Math.floor(Date.now()/3600000)*3600;
 e.DB.sqlite.prepare('INSERT INTO pair_attempts VALUES (?,?,99)').run(new Uint8Array(await hash('global-short-failures')),window);
 const prepare=e.DB.prepare.bind(e.DB),claimCount=8;
 let reads=0,release;
 const allRead=new Promise(resolve=>release=resolve);
 e.DB.prepare=sql=>{
  const statement=prepare(sql);
  if(sql!=='SELECT count FROM pair_attempts WHERE ip_hash = ? AND window_start = ?')return statement;
  return {...statement,bind:(...args)=>{
   const bound=statement.bind(...args);
   return {...bound,first:async()=>{
    const result=await bound.first();
    if(++reads===claimCount)release();
    await allRead;
    return result;
   }};
  }};
 };
 const wrong=pairing.short==='000000'?'000001':'000000';
 const responses=await Promise.all(Array.from({length:claimCount},(_,index)=>claim(e,{short:wrong},`198.51.100.${index+1}`)));
 assert.equal(reads,claimCount);
 assert.equal(responses.filter(response=>response.status===400).length,1);
 assert.equal(responses.filter(response=>response.status===429).length,7);
 for(const response of responses.filter(response=>response.status===429))assert.ok(Number(response.headers.get('Retry-After'))>0);
 const stored=e.DB.sqlite.prepare('SELECT failed_attempts,used_at FROM pairing_codes WHERE id = ?').get(pairing.id);
 assert.equal(stored.failed_attempts,1);
 assert.equal(stored.used_at,null);
 assert.equal(e.DB.sqlite.prepare('SELECT count FROM pair_attempts WHERE ip_hash = ? AND window_start = ?').get(new Uint8Array(await hash('global-short-failures')),window).count,100);
 assert.equal((await claim(e,{code:pairing.code},'203.0.113.1')).status,200);
});
test('device mutations report unknown IDs and revocation remains idempotent',async()=>{
 const e=env(),device=await (await claim(e,{code:(await start(e)).code})).json();
 for(const method of ['PATCH','DELETE']){
  const response=await call(e,'devices/missing',method,method==='PATCH'?{name:'Renamed'}:undefined);
  assert.equal(response.status,404);
  assert.deepEqual(await response.json(),{error:'Not found'});
 }
 assert.equal((await call(e,`devices/${device.deviceId}`,'PATCH',{name:'QA phone'})).status,200);
 assert.equal((await call(e,`devices/${device.deviceId}`,'DELETE')).status,200);
 const revoked=e.DB.sqlite.prepare('SELECT revoked_at FROM devices WHERE id = ?').get(device.deviceId).revoked_at;
 const original=Date.now;
 try{
  Date.now=()=>original()+61000;
  assert.equal((await call(e,`devices/${device.deviceId}`,'DELETE')).status,200);
  assert.equal(e.DB.sqlite.prepare('SELECT revoked_at FROM devices WHERE id = ?').get(device.deviceId).revoked_at,revoked);
 }finally{Date.now=original;}
});
test('pairing cancellation burns both codes and respects device ownership',async()=>{
 const e=env(),pairing=await start(e);
 const other=await start(e),device=await (await claim(e,{code:other.code})).json();
 const active=await start(e);
 assert.equal((await call(e,'pair/start','DELETE',{id:active.id},withToken(device.token))).status,200);
 assert.equal((await claim(e,{code:active.code})).status,200);
 const cancelled=await start(e);
 assert.equal((await call(e,'pair/start','DELETE',{id:cancelled.id})).status,200);
 assert.equal((await claim(e,{code:cancelled.code})).status,400);
 assert.equal((await claim(e,{short:cancelled.short})).status,400);
 assert.equal((await claim(e,{code:pairing.code})).status,400);
});


test('device names are trimmed plain text of 1–40 characters and lists are newest first',async()=>{
 const e=env(),device=await (await claim(e,{code:(await start(e)).code})).json();
 for(const name of ['', ' ', 'x'.repeat(41), '<img>', 'line\nname', 'hidden\u202ename'])assert.equal((await call(e,`devices/${device.deviceId}`,'PATCH',{name})).status,400);
 assert.equal((await call(e,`devices/${device.deviceId}`,'PATCH',{name:"  QA's phone  "})).status,200);
 e.DB.sqlite.prepare('UPDATE devices SET created_at = 1 WHERE id = ?').run('legacy');
 const list=await (await call(e,'devices')).json();assert.equal(list.devices[0].id,device.deviceId);assert.equal(list.devices[0].name,"QA's phone");
 await call(e,`devices/${device.deviceId}`,'DELETE');
 for(const [path,method,value] of [['devices','GET'],['devices/legacy','PATCH',{name:'Guess'}],['devices/legacy','DELETE'],['devices/revoke-others','POST']])assert.equal((await call(e,path,method,value,withToken(device.token))).status,401);
});

test('401 at a pending write stops further requests and re-pairing merges retained decisions',async()=>{
 const e=env();let requests=0,revocations=0,reject=true;
 const client=createSyncClient({unpaired:()=>{revocations++;},fetch:(url,options)=>{requests++;if(reject&&options.method==='PUT')return new Response('{}',{status:401});return syncRequest(new Request(url,options),e);}});
 client.configure({url:'https://sync.example',token:'test-secret'});
 let state={started:true,items:[{mediaKey:'synthetic',decision:'remove'}],history:[],syncPending:{synthetic:'remove'},syncDirty:true};
 assert.equal(await client.sync('qa',state,async()=>{throw Error('Unexpected save');}),state);
 const count=requests;await client.sync('qa',state,async value=>value);assert.equal(requests,count);assert.equal(revocations,1);assert.equal(state.syncPending.synthetic,'remove');
 reject=false;client.configure({url:'https://sync.example',token:'test-secret'});state=await client.sync('qa',state,async value=>value);
 assert.deepEqual(state.syncPending,{});assert.equal((await (await call(e,'state?scope=qa')).json()).decisions[0].decision,'remove');
});

test('device management rejects missing credentials without making requests',async()=>{
 let requests=0;
 const client=createSyncClient({fetch:async()=>{requests++;throw Error('Unexpected request');}});
 for(const settings of [{},{url:'https://sync.example'},{token:'synthetic-token'}]){
  client.configure(settings);
  for(const action of [()=>client.devices(),()=>client.rename('caller','Browser'),()=>client.revoke('caller'),()=>client.revokeOthers()])await assert.rejects(action,/Configure sync to manage paired devices/);
 }
 assert.equal(requests,0);
});


test('progress checkpoints persist only recovery metadata and reject private or malformed fields',async()=>{
 const e=env(),state={started:true,lifetimeFreed:224000,items:[{mediaKey:'QA-TRASH',type:'photo',size:112000,spaceTaken:112000,takesUpSpace:true,state:'in_trash',revision:2,queueSent:true,thumbUrl:'https://example.test/private',dedupKey:'private',name:'private',location:[1,2]}]};
 const progress=reviewSyncProgress(state,{'QA-TRASH':'remove'});
 assert.equal((await call(e,'progress','PUT',progress)).status,200);
 assert.deepEqual((await (await call(e,'state')).json()).progress,progress);
 for(const field of ['thumbUrl','dedupKey','name','location'])assert.equal(JSON.stringify(progress).includes(field),false);
 for(const change of [{thumbUrl:'https://example.test/private'},{revision:-1},{size:-1},{state:'unknown'},{queueSent:'yes'},{mediaKey:'invalid/id'}]){
  assert.equal((await call(e,'progress','PUT',{...progress,items:[{...progress.items[0],...change}]})).status,400);
 }
 for(const lifetimeFreed of [-1,'112000',null])assert.equal((await call(e,'progress','PUT',{...progress,lifetimeFreed})).status,400);
});

test('legacy state recovery restores reviewed IDs and Undo revisions before the first library card',async()=>{
 const statuses=[],client=createSyncClient({status:value=>statuses.push(value),fetch:async()=>new Response(JSON.stringify({decisions:[{id:'QA-KEEP',decision:'keep'}],history:[{key:'QA-KEEP',previous:null,decision:'keep',revision:3}],progress:{started:true,reviewed:1}}))});
 client.configure({url:'https://sync.example',token:'synthetic-token'});
 let rebuilt=false,saved=false;
 const state=await client.sync('qa',{started:false,items:[],history:[],revision:0},async value=>{assert.equal(rebuilt,true);saved=true;return value;},async value=>{
  const result=await rebuildSyncedReview(value,async()=>({items:[{mediaKey:'QA-KEEP',thumbUrl:'https://example.test/synthetic'},{mediaKey:'QA-FRESH',thumbUrl:'https://example.test/synthetic'}],nextPageId:null}));
  rebuilt=true;return result;
 });
 assert.equal(saved,true);assert.equal(state.started,true);assert.equal(state.items[0].decision,'keep');assert.equal(canUndoReview(state,state.history[0]),true);
 assert.deepEqual(state.items.filter(item=>!item.decision).map(item=>item.mediaKey),['QA-FRESH']);assert.match(statuses.at(-1),/^Synced/);
});

test('recovery scan failures save remote state and preserve unseen undo targets',async()=>{
 const statuses=[],client=createSyncClient({status:value=>statuses.push(value),fetch:async()=>new Response(JSON.stringify({decisions:[{id:'QA-KEEP',decision:'keep'}],history:[],progress:{started:true,reviewed:1}}))});
 client.configure({url:'https://sync.example',token:'synthetic-token'});
 const empty={started:false,items:[],history:[],revision:0,cursor:null};let saves=0;
 const save=async value=>{saves++;return value;};
 const restored=await client.sync('qa',empty,save,()=>{throw Error('Synthetic preview failure');});
 assert.equal(saves,1);assert.equal(restored.started,true);assert.equal(restored.items[0].decision,'keep');
 const loaded=mergeReviewPage(restored,{items:[{mediaKey:'QA-FRESH'}],nextPageId:null},null);
 const retried=await client.sync('qa',loaded,save);assert.equal(retried.items.find(item=>item.mediaKey==='QA-KEEP').decision,'keep');
});

test('a partial device checkpoint preserves remote trash rows through a wiped-store restore',async()=>{
 const e=env(),trash={mediaKey:'remote-trash',state:'in_trash',spaceTaken:112000,revision:2,queueSent:true};
 await call(e,'decisions/remote-trash','PUT',{decision:'remove'});
 await call(e,'progress','PUT',{started:true,reviewed:1,items:[trash],lifetimeFreed:112000});
 const client=createSyncClient({fetch:(url,options)=>syncRequest(new Request(url,options),e)});
 client.configure({url:'https://sync.example',token:'test-secret'});
 const local={started:true,items:[{mediaKey:'local',state:'active',revision:0}],history:[],syncDecisions:{},syncPending:{}};
 const synced=await client.sync('default',local,async value=>value);
 assert.ok(synced.syncCheckpoint);
 const restored=await client.sync('default',{started:false,items:[],history:[]},async value=>value);
 assert.deepEqual(restored.items.find(item=>item.mediaKey===trash.mediaKey),{...trash,name:trash.mediaKey,type:'photo',decision:'remove',needsPreview:true});
 assert.equal(restored.lifetimeFreed,112000);
 assert.equal((await call(e,'progress','PUT',{started:true,reviewed:0,items:[{...trash,state:'active',revision:3,queueSent:false}],lifetimeFreed:112000})).status,200);
 const progress=await (await call(e,'progress')).json();
 assert.equal(progress.items.length,2);
 assert.equal(progress.items.find(item=>item.mediaKey===trash.mediaKey).state,'active');
});

for(const [name,count,keyLength] of [['row limit',2101,10],['byte limit',1200,256],['D1 storage limit',6500,256]])test(`large checkpoints batch within the ${name} and restore all rows`,async()=>{
 const e=env(),writes=[],statuses=[];
 e.DB.sqlite.exec("CREATE TRIGGER progress_size_limit BEFORE UPDATE ON review_state WHEN length(CAST(NEW.progress AS BLOB)) + length(CAST(NEW.history AS BLOB)) > 2000000 BEGIN SELECT RAISE(ABORT, 'D1 row too large'); END");
 const client=createSyncClient({status:value=>statuses.push(value),fetch:async(url,options)=>{
  if(new URL(url).pathname==='/api/progress')writes.push(options.body);
  return syncRequest(new Request(url,options),e);
 }});
 client.configure({url:'https://sync.example',token:'test-secret'});
 const items=Array.from({length:count},(_,index)=>({mediaKey:String(index).padStart(keyLength,'x'),state:'in_trash',type:'photo',revision:1,spaceTaken:1000,queueSent:true}));
 items[0]={...items[0],state:'active',queueSent:false};
 const history=[{key:items[0].mediaKey,previous:null,decision:'remove',revision:1}];
 const state={started:true,items,history,syncDirty:true,syncDecisions:{},syncPending:{[items[0].mediaKey]:'remove'},lifetimeFreed:count*1000};
 const saved=await client.sync('default',state,async value=>value);
 assert.notEqual(saved,state);assert.equal(saved.syncDirty,false);assert.deepEqual(saved.syncPending,{});
 assert.match(statuses.at(-1),/^Synced/);assert.ok(writes.length>1);
 for(const body of writes){assert.ok(new TextEncoder().encode(body).length<=262144);assert.ok(JSON.parse(body).items.length<=2000);}
 assert.equal(saved.syncCheckpoint.items.length,count);
 assert.ok(Buffer.byteLength(e.DB.sqlite.prepare('SELECT progress FROM review_state').get().progress)<2000000);
 assert.equal(e.DB.sqlite.prepare('SELECT COUNT(*) AS count FROM review_items').get().count,count);
 if(name==='D1 storage limit')assert.ok(Buffer.byteLength(JSON.stringify(saved.syncCheckpoint))>2000000);
 const restored=await client.sync('default',{started:false,items:[],history:[]},async value=>value);
 assert.equal(restored.items.length,count);assert.deepEqual(restored.history,history);
 assert.equal(canUndoReview(restored,history[0]),true);
 assert.equal(restored.lifetimeFreed,count*1000);
 const writeCount=writes.length;
 await client.sync('default',saved,async value=>value);
 assert.equal(writes.length,writeCount);
});

for(const checkpoint of [false,true])test(`unsighted restored removes stay out of album and Trash actions with ${checkpoint?'item':'legacy'} progress`,async()=>{
 const remote={decisions:[{id:'seen',decision:'remove'},{id:'unseen',decision:'remove'}],history:[],progress:{started:true,reviewed:2,...(checkpoint?{items:[{mediaKey:'seen',state:'active'},{mediaKey:'unseen',state:'active'}]}:{})}};
 const client=createSyncClient({fetch:async()=>new Response(JSON.stringify(remote))});
 client.configure({url:'https://sync.example',token:'synthetic-token'});
 let state=await client.sync('default',{started:false,items:[],history:[]},async value=>value,value=>rebuildSyncedReview(value,async()=>({items:[{mediaKey:'seen',dedupKey:'seen-trash'},...Array.from({length:50},(_,index)=>({mediaKey:`fresh-${index}`}))],nextPageId:'older'})));
 assert.equal(state.exhausted,false);
 assert.equal(state.items.find(item=>item.mediaKey==='unseen').needsPreview,true);
 assert.deepEqual(reviewQueue(state).map(item=>item.mediaKey),['seen']);
 assert.deepEqual(reviewTrashCandidates(state).map(item=>item.dedupKey),['seen-trash']);
 const added=[];
 await sendReviewAlbum({read:async()=>state,save:async value=>{assert.ok(!value.job?.mediaKeys.includes('unseen'));state=value;return value;},title:'Review',call:async(action,args)=>{
  if(action==='findAlbum')return {albumKey:'album'};
  if(action==='albumMembers')return {keys:added,dedupKeys:[]};
  if(action==='addToAlbum'){added.push(...args.mediaKeys);return {};}
  throw Error(`Unexpected action ${action}`);
 }});
 assert.deepEqual(added,['seen']);
 assert.equal(state.job,null);
 state=mergeReviewPage(state,{items:[{mediaKey:'unseen',dedupKey:'unseen-trash'}],nextPageId:null},'older');
 assert.deepEqual(reviewQueue(state).map(item=>item.mediaKey),['unseen']);
 assert.deepEqual(reviewTrashCandidates(state).map(item=>item.dedupKey),['seen-trash','unseen-trash']);
});

test('item storage migration preserves legacy checkpoints and keeps metadata-only scopes unchanged',async()=>{
 const db=new DatabaseSync(':memory:');
 db.exec(readFileSync(new URL('../worker/migrations/0001_init.sql',import.meta.url),'utf8'));
 const items=[{mediaKey:'old',state:'in_trash',revision:2,queueSent:true},{mediaKey:'other',state:'active'}];
 db.prepare('INSERT INTO review_state VALUES (?, ?, ?)').run('legacy',JSON.stringify({started:true,reviewed:2,items,lifetimeFreed:100}),'[]');
 db.prepare('INSERT INTO review_state VALUES (?, ?, ?)').run('metadata',JSON.stringify({started:true,reviewed:1}),'[]');
 db.exec(readFileSync(new URL('../worker/migrations/0003_review_items.sql',import.meta.url),'utf8'));
 assert.deepEqual(db.prepare('SELECT data FROM review_items WHERE scope = ? ORDER BY rowid').all('legacy').map(row=>JSON.parse(row.data)),items);
 assert.deepEqual(JSON.parse(db.prepare('SELECT progress FROM review_state WHERE scope = ?').get('legacy').progress),{started:true,reviewed:2,items:[],lifetimeFreed:100});
 assert.deepEqual(JSON.parse(db.prepare('SELECT progress FROM review_state WHERE scope = ?').get('metadata').progress),{started:true,reviewed:1});
 db.close();
});

 test('stale and equal checkpoint revisions cannot overwrite newer trash, while newer restores can',async()=>{
 const e=env(),trash={mediaKey:'synthetic-trash',state:'in_trash',revision:4,spaceTaken:120,queueSent:true};
 const put=items=>call(e,'progress','PUT',{started:true,reviewed:0,items,lifetimeFreed:120});
 await put([trash]);
 for(const revision of [0,3,4]){
  assert.equal((await put([{...trash,state:'active',revision}])).status,200);
  assert.deepEqual((await (await call(e,'state')).json()).progress.items,[trash]);
 }
 const client=createSyncClient({fetch:(url,options)=>syncRequest(new Request(url,options),e)});
 client.configure({url:'https://sync.example',token:'test-secret'});
 const stale={started:true,history:[],items:[{...trash,state:'active',revision:1},{mediaKey:'synthetic-local',state:'active',revision:1}],syncDecisions:{},syncDirty:true};
 const synced=await client.sync('default',stale,async value=>value);
 assert.equal(synced.items[0].state,'in_trash');assert.equal(synced.items[0].revision,4);
 const restored=await client.sync('default',{started:false,history:[],items:[]},async value=>value);
 assert.equal(restored.items.find(item=>item.mediaKey===trash.mediaKey).state,'in_trash');
 await put([{...trash,state:'active',revision:5}]);
 assert.equal((await (await call(e,'state')).json()).progress.items[0].state,'active');
 });

 test('failed library scans retain trash totals, history and unseen undo eligibility after Load more',async()=>{
 const entry={key:'synthetic-unseen',previous:null,decision:'keep',revision:3};
 const remote={decisions:[{id:entry.key,decision:'keep'}],history:[entry],progress:{started:true,lifetimeFreed:120,items:[{mediaKey:'synthetic-trash',state:'in_trash',revision:4,spaceTaken:120},{mediaKey:entry.key,state:'active',revision:3}]}};
 const client=createSyncClient({fetch:async()=>new Response(JSON.stringify(remote))});
 client.configure({url:'https://sync.example',token:'synthetic-token'});
 let saved;
 const restored=await client.sync('default',{started:false,items:[],history:[],cursor:null},async value=>{saved=value;return value;},value=>rebuildSyncedReview(value,async()=>{throw Error('Synthetic scan failure');}));
 assert.equal(restored,saved);assert.deepEqual(restored.history,[entry]);assert.equal(restored.lifetimeFreed,120);
 const loaded=mergeReviewPage(restored,{items:[{mediaKey:'synthetic-page'}],nextPageId:null},null);
 const next=await client.sync('default',loaded,async value=>value);
 assert.equal(next.items.find(item=>item.mediaKey==='synthetic-trash').spaceTaken,120);
 assert.equal(canUndoReview(next,entry),true);
 });

 for(const failure of ['timeout',400,500])test(`checkpoint ${failure} preserves pulled decisions and retries the checkpoint`,async()=>{
 const e=env(),entry={key:'synthetic-remote',previous:null,decision:'keep',revision:2};
 await call(e,'decisions/synthetic-remote','PUT',{decision:'keep'});await call(e,'undo','PUT',{history:[entry]});
 let reject=true,writes=0;
 const client=createSyncClient({fetch:(url,options)=>{
  if(new URL(url).pathname==='/api/progress'){writes++;if(reject){if(failure==='timeout')throw Error('Synthetic timeout');return new Response('{}',{status:failure});}}
  return syncRequest(new Request(url,options),e);
 }});
 client.configure({url:'https://sync.example',token:'test-secret'});
 const state={started:true,items:[{mediaKey:entry.key,decision:null}],history:[],syncDecisions:{}};
 const pulled=await client.sync('default',state,async value=>value);
 assert.equal(pulled.items[0].decision,'keep');assert.deepEqual(pulled.history,[entry]);assert.equal(canUndoReview(pulled,entry),true);assert.equal(pulled.syncCheckpoint,undefined);
 reject=false;const retried=await client.sync('default',pulled,async value=>value);
 assert.equal(writes,2);assert.ok(retried.syncCheckpoint);
 });

 test('remote checkpoint revisions retain undo locks when unseen rows join a populated store',async()=>{
 const entry={key:'synthetic-locked',previous:null,decision:'keep',revision:2};
 const remote={decisions:[{id:entry.key,decision:'keep'}],history:[entry],progress:{started:true,items:[{mediaKey:entry.key,state:'active',revision:3,queueSent:true}]}};
 const client=createSyncClient({fetch:async()=>new Response(JSON.stringify(remote))});
 client.configure({url:'https://sync.example',token:'synthetic-token'});
 const state=await client.sync('default',{started:true,items:[{mediaKey:'synthetic-loaded',state:'active'}],history:[],syncDecisions:{}},async value=>value);
 assert.equal(state.items.find(item=>item.mediaKey===entry.key).revision,3);assert.equal(canUndoReview(state,entry),false);
 });

test('equal revision sync adopts the server trash row before review and checkpointing',async()=>{
 const e=env(),trash={mediaKey:'synthetic-tie',state:'in_trash',revision:4,spaceTaken:120};
 await call(e,'progress','PUT',{started:true,reviewed:0,items:[trash],lifetimeFreed:120});
 const rejected=await (await call(e,'progress','PUT',{started:true,reviewed:0,items:[{...trash,state:'active',queueSent:false}],lifetimeFreed:120})).json();
 assert.deepEqual(rejected.items,[trash]);
 const client=createSyncClient({fetch:(url,options)=>syncRequest(new Request(url,options),e)});
 client.configure({url:'https://sync.example',token:'test-secret'});
 const local={started:true,history:[],items:[{...trash,state:'active',decision:null,queueSent:false,name:'Synthetic photo'}],syncDecisions:{},syncDirty:true};
 const synced=await client.sync('default',local,async value=>value);
 assert.equal(synced.items[0].state,'in_trash');
 assert.equal(synced.items[0].name,'Synthetic photo');
 assert.equal(Object.hasOwn(synced.items[0],'queueSent'),false);
 assert.deepEqual(synced.syncCheckpoint.items,[trash]);
 assert.throws(()=>decideReview(synced,trash.mediaKey,'keep',null,4));
 await client.sync('default',synced,async value=>value);
 const restored=await client.sync('default',{started:false,history:[],items:[]},async value=>value);
 assert.equal(restored.items[0].state,'in_trash');
});

test('progress PUT reconciles a server tie introduced after the client pull',async()=>{
 const e=env(),trash={mediaKey:'synthetic-race',state:'in_trash',revision:4,queueSent:true};
 let raced=false;
 const client=createSyncClient({fetch:async(url,options)=>{
  if(options.method==='PUT'&&new URL(url).pathname==='/api/progress'&&!raced){
   raced=true;
   await call(e,'progress','PUT',{started:true,reviewed:0,items:[trash],lifetimeFreed:0});
  }
  return syncRequest(new Request(url,options),e);
 }});
 client.configure({url:'https://sync.example',token:'test-secret'});
 const local={started:true,history:[],items:[{mediaKey:trash.mediaKey,state:'active',revision:4,decision:null}],syncDecisions:{},syncDirty:true};
 const synced=await client.sync('default',local,async value=>value);
 assert.equal(raced,true);
 assert.equal(synced.items[0].state,'in_trash');
 assert.deepEqual(synced.syncCheckpoint.items,[trash]);
 assert.deepEqual(synced.syncCheckpoint,(await (await call(e,'progress')).json()));
 assert.throws(()=>decideReview(synced,trash.mediaKey,'keep',null,4));
 const restored=await client.sync('default',{started:false,history:[],items:[]},async value=>value);
 assert.equal(restored.items[0].state,'in_trash');
});

test('legacy token bootstraps short-code pairing and the new token reads and writes sync state',async()=>{
 const e=env(),pairing=await start(e);
 const response=await claim(e,{short:pairing.short});
 assert.equal(response.status,200);
 const device=await response.json();
 assert.match(device.deviceId,/^[0-9a-f-]{36}$/);
 assert.match(device.token,/^[A-Za-z0-9_-]{43}$/);
 const headers=withToken(device.token);
 assert.equal((await call(e,'state','GET',undefined,headers)).status,200);
 const decisions=[{id:'paired-device-item',decision:'keep'}];
 assert.equal((await call(e,'decisions','PUT',{decisions},headers)).status,200);
 const state=await call(e,'state','GET',undefined,headers);
 assert.equal(state.status,200);
 assert.deepEqual((await state.json()).decisions,decisions);
});

test('claim reports pairing misconfiguration when the IP key is unset',async()=>{
 const e=env(),pairing=await start(e);
 delete e.PAIRING_IP_KEY;
 const response=await claim(e,{short:pairing.short});
 assert.equal(response.status,500);
 assert.deepEqual(await response.json(),{error:'pairing_misconfigured'});
 assert.equal(e.DB.sqlite.prepare('SELECT count(*) AS n FROM devices WHERE is_legacy = 0').get().n,0);
 assert.equal(e.DB.sqlite.prepare('SELECT used_at FROM pairing_codes WHERE id = ?').get(pairing.id).used_at,null);
});
