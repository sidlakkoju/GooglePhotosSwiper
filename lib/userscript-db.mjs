import {emptyReview} from "./userscript-core.mjs";
export const LEASE_HEARTBEAT_MS=4000;
export const CHUNK_SIZE=500;
export const LEASE_EXPIRY_MS=12000;
export async function createLeaseOwner(window,crypto) {
 const key='photos-swipe-lease-owner';
 let owner=crypto.randomUUID(),saved;
 try{saved=window.sessionStorage.getItem(key);window.sessionStorage.removeItem(key);}catch{}
 let handoff=saved||owner;
 window.addEventListener?.('pagehide',()=>{try{window.sessionStorage.setItem(key,handoff);}catch{}});
 window.addEventListener?.('pageshow',()=>{try{window.sessionStorage.removeItem(key);}catch{}});
 const locks=window.navigator?.locks;
 if(locks){
  const claim=candidate=>new Promise((resolve,reject)=>{
   locks.request(`photos-swipe-owner:${candidate}`,{ifAvailable:true},lock=>{
    resolve(!!lock);
    if(lock)return new Promise(()=>{});
   }).catch(reject);
  });
  try{if(saved&&await claim(saved))owner=saved;else await claim(owner);}catch{owner=crypto.randomUUID();}
 }
 handoff=owner;
 return owner;
}
export async function openReviewDatabase(indexedDB) {
 const unavailable=()=>Error('Photos Swipe can’t use storage in this browser. Use a normal window or allow site data for photos.google.com, then reload.');
 const db=await new Promise((resolve,reject)=>{
  let request;
  try{request=indexedDB.open('photos-swipe-userscript',2);}catch{reject(unavailable());return;}
  request.onupgradeneeded=()=>{for(const name of ['accounts','leases','settings'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name);};
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error?.name==='VersionError'?request.error:unavailable());
  request.onblocked=()=>reject(Error('Close other Photos Swipe tabs to open local storage.'));
 });
 db.onversionchange=()=>db.close();
 const loaded=new Map(),legacyAccounts=new Set(),resumeLists=new Map(),metaKey=account=>`v2:${account}`,chunkKey=(account,index)=>`v2:${account}:${String(index).padStart(5,'0')}`;
 function transaction(store,key,change) {
  return new Promise((resolve,reject)=>{
   const tx=db.transaction(store,change?'readwrite':'readonly'),table=tx.objectStore(store),request=table.get(key);let result,failure;
   request.onsuccess=()=>{
    try {result=change?change(request.result):request.result;if(change){if(result===undefined)table.delete(key);else table.put(result,key)};}catch(error){failure=error;tx.abort();}
   };
   tx.oncomplete=()=>resolve(result);
   tx.onabort=()=>reject(failure||tx.error||Error('Local storage transaction failed.'));
   tx.onerror=()=>{};
  });
 }
 return {
  resume:account=>new Promise((resolve,reject)=>{
   const tx=db.transaction('settings','readonly'),table=tx.objectStore('settings'),request=table.get(`resume:${account}`);let result={};
   request.onsuccess=()=>{result=request.result||{};if(!result.flashbacks?.split)return;const lists=table.get(`resume-lists:${account}`);lists.onsuccess=()=>{const {split:_split,...flashbacks}=result.flashbacks;result={...result,flashbacks:{...flashbacks,...(lists.result||{})}};resumeLists.set(account,lists.result||null);};};
   tx.oncomplete=()=>resolve(result);
   tx.onabort=()=>reject(tx.error||Error('Local storage transaction failed.'));
   tx.onerror=()=>{};
  }),
  saveResume:(account,value)=>new Promise((resolve,reject)=>{
   const tx=db.transaction('settings','readwrite'),table=tx.objectStore('settings'),{flashbacks}=value;
   const lists=flashbacks?{keys:flashbacks.keys,starts:flashbacks.starts}:null,last=resumeLists.get(account),changed=lists&&(!last||last.keys!==lists.keys||last.starts!==lists.starts);
   const request=table.get(`resume:${account}`);
   request.onsuccess=()=>{table.put(flashbacks?{...value,flashbacks:{...flashbacks,keys:undefined,starts:undefined,split:true}}:value,`resume:${account}`);if(changed)table.put(lists,`resume-lists:${account}`);};
   tx.oncomplete=()=>{if(changed)resumeLists.set(account,lists);resolve(value);};
   tx.onabort=()=>reject(tx.error||Error('Local storage transaction failed.'));
   tx.onerror=()=>{};
  }),
  settings:async()=>await transaction('settings','sync')||{},
  deleteSettings:()=>transaction('settings','sync',()=>undefined),
  saveSettings:value=>transaction('settings','sync',()=>value),
  read:account=>new Promise((resolve,reject)=>{
   const tx=db.transaction('accounts','readonly'),table=tx.objectStore('accounts'),meta=table.get(metaKey(account));let result;
   meta.onsuccess=()=>{
    const value=meta.result;
    if(value&&Number.isSafeInteger(value.chunks)){
     const chunks=Array(value.chunks);let pending=value.chunks;
     const finish=()=>{const {chunks:_count,format:_format,...rest}=value;result={...rest,items:chunks.flat()};loaded.set(account,chunks);};
     if(!pending)finish();
     for(let index=0;index<value.chunks;index++){const request=table.get(chunkKey(account,index));request.onsuccess=()=>{chunks[index]=request.result||[];if(!--pending)finish();};}
     return;
    }
    const legacy=table.get(account);legacy.onsuccess=()=>{result=legacy.result||emptyReview();loaded.delete(account);if(legacy.result)legacyAccounts.add(account);};
   };
   tx.oncomplete=()=>resolve(result);
   tx.onabort=()=>reject(tx.error||Error('Local storage transaction failed.'));
   tx.onerror=()=>{};
  }),
  save:(account,state)=>new Promise((resolve,reject)=>{
   const tx=db.transaction('accounts','readwrite'),table=tx.objectStore('accounts'),revisionKey=`revision:${account}`,request=table.get(revisionKey);let result,failure,written;
   const commit=current=>{try{
    if((current||0)!==state.revision)throw Error('Progress changed in another tab. Reopen Photos Swipe and retry.');
    result={...state,revision:state.revision+1};
    const {items=[],...rest}=result,previous=loaded.get(account)||[];written=[];
    for(let index=0;index*CHUNK_SIZE<items.length;index++){
     const chunk=items.slice(index*CHUNK_SIZE,(index+1)*CHUNK_SIZE),old=previous[index];
     if(!old||old.length!==chunk.length||chunk.some((item,position)=>item!==old[position]))table.put(chunk,chunkKey(account,index));
     written.push(chunk);
    }
    for(let index=written.length;index<previous.length;index++)table.delete(chunkKey(account,index));
    table.put({...rest,chunks:written.length,format:2},metaKey(account));table.put(result.revision,revisionKey);
    if(legacyAccounts.has(account))table.delete(account);
   }catch(error){failure=error;tx.abort();}};
   request.onsuccess=()=>{if(Number.isSafeInteger(request.result)){commit(request.result);return;}const meta=table.get(metaKey(account));meta.onsuccess=()=>{if(meta.result){commit(meta.result.revision);return;}const full=table.get(account);full.onsuccess=()=>commit(full.result?.revision);};};
   tx.oncomplete=()=>{loaded.set(account,written);legacyAccounts.delete(account);resolve(result);};
   tx.onabort=()=>reject(failure||tx.error||Error('Local storage transaction failed.'));
   tx.onerror=()=>{};
  }),
  readLease:account=>transaction('leases',account),
  lease:(account,owner,release=false,takeover=true,claim=false)=>transaction('leases',account,current=>{
   if(release&&current?.owner!==owner)return current;
   if(!release&&!claim&&current?.owner!==owner&&current?.expires>Date.now()){
    if(!takeover)return current;
    throw Error('Photos Swipe is busy in another tab. Try again when it finishes.');
   }
   return {owner,expires:release?0:Date.now()+LEASE_EXPIRY_MS};
  })
 };
}
