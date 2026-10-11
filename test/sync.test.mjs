import test from 'node:test';
import assert from 'node:assert/strict';
import {syncRequest} from '../worker/src/sync.mjs';
import {createSyncClient,markSyncChanges,validateSyncSettings} from '../lib/userscript-sync.mjs';
class FakeD1 {
 decisions=new Map();records=new Map();
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
