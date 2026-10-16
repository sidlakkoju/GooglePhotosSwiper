import test from 'node:test';
import assert from 'node:assert/strict';
import {openReviewDatabase,CHUNK_SIZE} from '../lib/userscript-db.mjs';

function recordingIndexedDB(){
 const stores=new Map(),log=[];
 const database={
  objectStoreNames:{contains:name=>stores.has(name)},
  createObjectStore:name=>stores.set(name,new Map()),close(){},
  transaction(name){
   const staged=new Map(stores.get(name)),writes=[];let pending=0,aborted=false,done=false;
   const settle=()=>queueMicrotask(()=>{if(pending||aborted||done)return;done=true;stores.set(name,staged);log.push(...writes);tx.oncomplete?.();});
   const tx={objectStore:()=>({
    get(key){const request={};pending++;queueMicrotask(()=>{request.result=structuredClone(staged.get(key));request.onsuccess?.();pending--;settle();});return request;},
    put(value,key){staged.set(key,structuredClone(value));writes.push(['put',name,key]);},
    delete(key){staged.delete(key);writes.push(['delete',name,key]);}
   }),abort(){aborted=true;queueMicrotask(()=>tx.onabort?.());}};
   return tx;
  }
 };
 return {stores,log,indexedDB:{open(){const request={result:database};queueMicrotask(()=>{request.onupgradeneeded?.();request.onsuccess();});return request;}}};
}
const item=index=>({mediaKey:`item-${index}`,decision:null,state:'active',revision:0});
const accountPuts=(log,from)=>log.slice(from).filter(([op,store])=>op==='put'&&store==='accounts').map(([,,key])=>key);

test('a decision rewrites only the chunk holding the changed item',async()=>{
 const {log,indexedDB}=recordingIndexedDB(),db=await openReviewDatabase(indexedDB);
 const items=Array.from({length:CHUNK_SIZE*3+10},(_,index)=>item(index));
 const first=await db.save('account',{revision:0,history:[],items});
 assert.deepEqual(accountPuts(log,0).sort(),['revision:account','v2:account','v2:account:00000','v2:account:00001','v2:account:00002','v2:account:00003']);
 const before=log.length,changed=first.items.map((row,index)=>index===CHUNK_SIZE+7?{...row,decision:'remove',revision:1}:row);
 const second=await db.save('account',{...first,items:changed});
 assert.deepEqual(accountPuts(log,before).sort(),['revision:account','v2:account','v2:account:00001']);
 const reopened=await openReviewDatabase(indexedDB),read=await reopened.read('account');
 assert.deepEqual(read,second);assert.equal(read.items[CHUNK_SIZE+7].decision,'remove');assert.equal(read.items.length,items.length);
 const afterRead=log.length;
 await reopened.save('account',{...read,items:read.items.map((row,index)=>index===3?{...row,decision:'keep'}:row)});
 assert.deepEqual(accountPuts(log,afterRead).sort(),['revision:account','v2:account','v2:account:00000']);
});

test('a shrinking library deletes trailing chunks',async()=>{
 const {log,stores,indexedDB}=recordingIndexedDB(),db=await openReviewDatabase(indexedDB);
 const saved=await db.save('account',{revision:0,items:Array.from({length:CHUNK_SIZE*2+1},(_,index)=>item(index))});
 await db.save('account',{...saved,items:saved.items.slice(0,10)});
 assert.ok(log.some(([op,,key])=>op==='delete'&&key==='v2:account:00002'));
 assert.deepEqual([...stores.get('accounts').keys()].filter(key=>key.startsWith('v2:account:')),['v2:account:00000']);
 assert.equal((await (await openReviewDatabase(indexedDB)).read('account')).items.length,10);
});

test('a legacy single-record library migrates on the next save and the old copy is removed',async()=>{
 const {stores,indexedDB}=recordingIndexedDB(),db=await openReviewDatabase(indexedDB);
 const legacy={revision:4,history:[{key:'item-1'}],cursor:'next',items:Array.from({length:12},(_,index)=>item(index))};
 stores.get('accounts').set('account',structuredClone(legacy));
 const read=await db.read('account');assert.deepEqual(read,legacy);
 const saved=await db.save('account',{...read,items:read.items.map((row,index)=>index===2?{...row,decision:'keep'}:row)});
 assert.equal(saved.revision,5);assert.equal(stores.get('accounts').has('account'),false);
 const migrated=await (await openReviewDatabase(indexedDB)).read('account');
 assert.deepEqual(migrated,saved);assert.equal(migrated.cursor,'next');assert.equal(migrated.items[2].decision,'keep');
 await assert.rejects(db.save('account',read),/another tab/);
});

test('resume rewrites the large Flashbacks lists only when they change and reads them back whole',async()=>{
 const {log,indexedDB}=recordingIndexedDB(),db=await openReviewDatabase(indexedDB);
 const keys=Array.from({length:3000},(_,index)=>`item-${index}`),starts=['item-0','item-40'];
 const settingsPuts=from=>log.slice(from).filter(([op,store])=>op==='put'&&store==='settings').map(([,,key])=>key);
 await db.saveResume('account',{currentId:'item-0',sort:'flashbacks',flashbacks:{keys,starts,seen:[],keptOff:false}});
 assert.deepEqual(settingsPuts(0).sort(),['resume-lists:account','resume:account']);
 const before=log.length;
 await db.saveResume('account',{currentId:'item-1',sort:'flashbacks',flashbacks:{keys,starts,seen:['item-0'],keptOff:false}});
 assert.deepEqual(settingsPuts(before),['resume:account']);
 const reopened=await openReviewDatabase(indexedDB),resume=await reopened.resume('account');
 assert.deepEqual(resume,{currentId:'item-1',sort:'flashbacks',flashbacks:{keys,starts,seen:['item-0'],keptOff:false}});
 const afterRead=log.length,reordered=[...keys].reverse();
 await reopened.saveResume('account',{...resume,flashbacks:{...resume.flashbacks}});
 assert.deepEqual(settingsPuts(afterRead),['resume:account']);
 await reopened.saveResume('account',{...resume,flashbacks:{...resume.flashbacks,keys:reordered}});
 assert.equal((await (await openReviewDatabase(indexedDB)).resume('account')).flashbacks.keys[0],'item-2999');
});

test('a resume saved by an older release keeps its inline Flashbacks lists',async()=>{
 const {stores,indexedDB}=recordingIndexedDB(),db=await openReviewDatabase(indexedDB);
 stores.get('settings').set('resume:account',{currentId:'a',flashbacks:{keys:['a','b'],starts:['a'],seen:[]}});
 assert.deepEqual(await db.resume('account'),{currentId:'a',flashbacks:{keys:['a','b'],starts:['a'],seen:[]}});
});

test('blocked browser storage gives one clear message, while a newer database version keeps its own error',async()=>{
 const message=/^Error: Photos Swipe couldn’t open its storage in this browser\. Use a normal window or allow site data for photos\.google\.com, then reload\.$/;
 const failing=error=>({open(){const request={};queueMicrotask(()=>{request.error=error;request.onerror?.();});return request;}});
 await assert.rejects(openReviewDatabase(undefined),message);
 await assert.rejects(openReviewDatabase({open(){throw new DOMException('A mutation operation was attempted on a database that did not allow mutations.','InvalidStateError');}}),message);
 await assert.rejects(openReviewDatabase(failing(new DOMException('The user denied permission to access the database.','SecurityError'))),message);
 const newer=new DOMException('The requested version (2) is less than the existing version (3).','VersionError');
 await assert.rejects(openReviewDatabase(failing(newer)),error=>error===newer);
});
