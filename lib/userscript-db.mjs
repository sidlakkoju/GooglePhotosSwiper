import {emptyReview} from "./userscript-core.mjs";
export const LEASE_HEARTBEAT_MS=4000;
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
 const db=await new Promise((resolve,reject)=>{
  const request=indexedDB.open('photos-swipe-userscript',2);
  request.onupgradeneeded=()=>{for(const name of ['accounts','leases','settings'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name);};
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
  request.onblocked=()=>reject(Error('Close other Photos Swipe tabs to open local storage.'));
 });
 db.onversionchange=()=>db.close();
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
  resume:async account=>await transaction('settings',`resume:${account}`)||{},
  saveResume:(account,value)=>transaction('settings',`resume:${account}`,()=>value),
  settings:async()=>await transaction('settings','sync')||{},
  deleteSettings:()=>transaction('settings','sync',()=>undefined),
  saveSettings:value=>transaction('settings','sync',()=>value),
  read:async account=>(await transaction('accounts',account))||emptyReview(),
  save:(account,state)=>new Promise((resolve,reject)=>{
   const tx=db.transaction('accounts','readwrite'),table=tx.objectStore('accounts'),revisionKey=`revision:${account}`,request=table.get(revisionKey);let result,failure;
   const commit=current=>{try{if((current||0)!==state.revision)throw Error('Progress changed in another tab. Reopen Photos Swipe and retry.');result={...state,revision:state.revision+1};table.put(result,account);table.put(result.revision,revisionKey);}catch(error){failure=error;tx.abort();}};
   request.onsuccess=()=>{if(Number.isSafeInteger(request.result)){commit(request.result);return;}const full=table.get(account);full.onsuccess=()=>commit(full.result?.revision);};
   tx.oncomplete=()=>resolve(result);
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
