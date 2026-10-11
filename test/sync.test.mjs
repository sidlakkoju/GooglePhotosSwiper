import test from 'node:test';
import assert from 'node:assert/strict';
import {canUndoReview,decideReview,finishReviewAlbum,reconcileReviewTrash,mergeReviewPage} from '../lib/userscript-core.mjs';
import {hash} from '../worker/src/pairing.mjs';
import {syncRequest} from '../worker/src/sync.mjs';
import {createSyncClient,markSyncChanges,validateSyncSettings} from '../lib/userscript-sync.mjs';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
class FakeD1 {
 constructor(){this.sqlite=new DatabaseSync(':memory:');for(const file of ['0001_init.sql','0002_pairing.sql'])this.sqlite.exec(readFileSync(new URL(`../worker/migrations/${file}`,import.meta.url),'utf8'));}
 prepare(sql){
  const statement=this.sqlite.prepare(sql);
  const bound=args=>({all:async()=>({results:statement.all(...args)}),first:async()=>statement.get(...args)||null,run:async()=>statement.run(...args),execute:()=>({results:statement.all(...args),meta:{changes:Number(this.sqlite.prepare('SELECT changes() AS n').get().n)}})});
  return {...bound([]),bind:(...args)=>bound(args.map(value=>Array.isArray(value)?new Uint8Array(value):value))};
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

const claim=(e,value,ip='192.0.2.1')=>call(e,'pair/claim','POST',{name:'QA phone',platform:'test',...value},{Authorization:'','CF-Connecting-IP':ip});
const start=async e=>{const response=await call(e,'pair/start','POST');assert.equal(response.status,200);return response.json();};
const withToken=token=>({Authorization:`Bearer ${token}`});
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
 const wrong=pairing.short==='000000'?'000001':'000000';
 const responses=await Promise.all(Array.from({length:8},(_,index)=>claim(e,{short:wrong},`198.51.100.${index+1}`)));
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
