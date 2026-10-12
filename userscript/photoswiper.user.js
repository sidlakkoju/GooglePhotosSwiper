// ==UserScript==
// @name Photos Swipe
// @author sidlakkoju
// @namespace https://github.com/sidlakkoju/GooglePhotosSwiper
// @version 1.2.46
// @description Review Google Photos with local swipe decisions and verified review albums. RPC formats adapted from Google Photos Toolkit by xob0t.
// @match https://photos.google.com/*
// @run-at document-idle
// @grant GM.getValue
// @grant GM.setValue
// @grant GM.deleteValue
// @grant unsafeWindow
// @inject-into content
// @noframes
// @updateURL https://photoswiper-sync.sidlakkoju.workers.dev/photoswiper.user.js
// @downloadURL https://photoswiper-sync.sidlakkoju.workers.dev/photoswiper.user.js
// @license MIT
// ==/UserScript==

(function () {
'use strict';
if(document.documentElement.dataset.psLoaded)return;
document.documentElement.dataset.psLoaded='1';
async function photosOperation(operation,args={},environment=globalThis) {
 const {window,location,fetch,crypto}=environment;
 const AbortController=environment.AbortController;
 const setTimeout=environment.setTimeout.bind(environment),clearTimeout=environment.clearTimeout.bind(environment);
 try {
  if(location.origin!=='https://photos.google.com')throw Error('Open Google Photos before connecting.');
  const global=window.WIZ_global_data;
  if(!global?.SNlM0e||!global?.oPEP7c)throw Error('Google Photos is not signed in or its page format changed. Reload Google Photos.');
  const pageToken=global.SNlM0e;
  const label=String(global.oPEP7c).trim().toLowerCase();
  const account=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(label)))).map(b=>b.toString(16).padStart(2,'0')).join('');
  if(args.account&&args.account!==account)throw Error('Google account changed. Close and reopen Photos Swipe in the intended account.');
  if(operation==='identity')return {ok:true,data:{account,label}};
  const path=global.eptZe;
  if(typeof path!=='string'||!/^\/(?:u\/\d+\/|_\/PhotosUi\/(?:u\/\d+\/)?)?$/.test(path))throw Error('Unsupported Google Photos account path.');
  const validKey=k=>typeof k==='string'&&/^[a-zA-Z0-9_-]{1,250}$/.test(k);
  const safeMediaUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='photos.fife.usercontent.google.com'||u.hostname.endsWith('.googleusercontent.com'))&&!u.username&&!u.password&&!u.port;}catch{return false;}};
  function requireSamePage(){const current=window.WIZ_global_data;if(!current||String(current.oPEP7c).trim().toLowerCase()!==label||current.SNlM0e!==pageToken)throw Error('Google account or page authentication changed. Reload and retry.');}
  async function rpc(id,payload) {
   requireSamePage();
   const query=new URLSearchParams({rpcids:id,'source-path':location.pathname,'f.sid':String(global.FdrFJe),bl:String(global.cfb2h),pageId:'none',rt:'c'});
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
   try {
   const response=await fetch(`https://photos.google.com${path}data/batchexecute?${query}`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:new URLSearchParams({'f.req':JSON.stringify([[[id,JSON.stringify(payload),null,'generic']]]),at:pageToken}),credentials:'include',signal:controller.signal});
   if(!response.ok)throw Error(`Google Photos request failed (${response.status}). Reload its tab and try again.`);
   const raw=await response.text();requireSamePage();let envelope;
   for(const line of raw.split('\n')) {if(!line.includes('wrb.fr'))continue;try {const parsed=JSON.parse(line);envelope=parsed.find(e=>Array.isArray(e)&&e[0]==='wrb.fr'&&e[1]===id);if(envelope)break;}catch{}}
   if(!envelope||typeof envelope[2]!=='string')throw Error('Google returned an unexpected response. No changes were confirmed.');
   let data;try{data=JSON.parse(envelope[2]);}catch{throw Error('Google response could not be read.');}return data;
   } finally {clearTimeout(timer);}
  }
  if(operation==='library') {
   const data=await rpc('lcxiM',[args.cursor||null,null,50,null,1,1]);
   if(!Array.isArray(data)||!(data[0]==null||Array.isArray(data[0]))||!(data[1]==null||typeof data[1]==='string'&&data[1].length>0&&data[1].length<=4000))throw Error('Google library format changed.');
   const rawItems=data[0]||[];
   let details=new Map(),metadataWarning='';
   if(rawItems.length){try{
    const keys=rawItems.map(i=>[i[0]]);
    const fields=Array(36).fill(null);fields[24]=[];fields[35]=[];
    const bulk=await rpc('EWgK9e',[[[keys],[fields]]]);
    if(!Array.isArray(bulk?.[0]?.[1]))throw Error();
    details=new Map(bulk[0][1].map(i=>[i[0],{name:i[1]?.[3],size:i[1]?.[9],spaceTaken:i[1]?.at(-1)?.[1],takesUpSpace:i[1]?.at(-1)?.[0]===undefined?null:i[1]?.at(-1)?.[0]===1}]));
   }catch{metadataWarning='Extra file sizes could not be read. Photos can still be reviewed.';}}
   const items=rawItems.map(i=>{if(!validKey(i[0])||!safeMediaUrl(i[1]?.[0]))throw Error('Google media format changed.');const extra=i.at(-1)||{},duration=extra[76647426]?.[0],info=details.get(i[0])||{},timestamp=Number(i[2]);return {...info,mediaKey:i[0],dedupKey:i[3],name:info.name||extra[396644657]?.[0]||`Memory ${new Date(timestamp).toLocaleDateString()}`,type:duration!=null?'video':'photo',date:Number.isFinite(timestamp)?new Date(timestamp).toISOString():null,thumbUrl:i[1][0],width:i[1][1],height:i[1][2],duration,timezoneOffset:Number.isFinite(i[4])?i[4]:null,location:Array.isArray(extra[129168200]?.[1]?.[0])?extra[129168200][1][0].slice(0,2):null};});
   return {ok:true,data:{items,nextPageId:data[1]||null,metadataWarning}};
  }
  if(operation==='trashPage') {
   const data=await rpc('zy0IHe',[args.cursor||null]);if(!Array.isArray(data)||!(data[0]==null||Array.isArray(data[0]))||!(data[1]==null||typeof data[1]==='string'))throw Error('Google Trash format changed. No deletion state was updated.');
   const items=(data[0]||[]).map(row=>{if(!validKey(row?.[0])||!(row[3]==null||typeof row[3]==='string'))throw Error('Google Trash item format changed.');return {mediaKey:row[0],dedupKey:row[3]||null};});return {ok:true,data:{items,nextPageId:data[1]||null}};
  }
  if(operation==='itemState') {
   if(!validKey(args.mediaKey))throw Error('Invalid media identifier.');const data=await rpc('VrseUb',[args.mediaKey,null,null,null,null]);
   if(data?.[0]?.[0]!==args.mediaKey)return {ok:true,data:{state:'unknown'}};
   const extra=data[0].find(value=>value&&typeof value==='object'&&!Array.isArray(value)&&['76647426','163238866','225032867','318563170','525000000'].some(k=>Object.hasOwn(value,k)));
   if(!extra)return {ok:true,data:{state:'unknown'}};
   const timestamp=extra[225032867]?.[0];return {ok:true,data:{state:Number(timestamp)>0?'in_trash':'active'}};
  }
  if(operation==='findAlbum') {
   let page=null;const seen=new Set();
   do {const data=await rpc('Z5xsfc',[page,null,null,null,1,null,null,100,[2],5]);if(!Array.isArray(data)||!(data[0]==null||Array.isArray(data[0])))throw Error('Google album format changed.');const matching=(data[0]||[]).filter(i=>i.at(-1)?.[72930366]?.[1]===args.title);if(matching.length>1)throw Error('Multiple review albums have the same name. Resolve the duplicate albums first.');if(matching.length)return {ok:true,data:{albumKey:matching[0][0]}};page=data[1]||null;if(page&&seen.has(page))throw Error('Google repeated an album page.');seen.add(page);if(seen.size>1000)throw Error('Google scan exceeded its safety limit.');}while(page);
   return {ok:true,data:{albumKey:null}};
  }
  if(operation==='createAlbum') {
   if(typeof args.title!=='string'||!(args.title==='Photos Swipe \u00b7 Review'||args.title.startsWith('Photos Swipe \u00b7 Review \u00b7 '))||args.title.length>150)throw Error('Invalid review album title.');
   const data=await rpc('OXvT9d',[args.title,null,2]);const albumKey=data?.[0]?.[0];if(!validKey(albumKey))throw Error('Album creation was not confirmed. Retry to look for the album before creating another.');return {ok:true,data:{albumKey}};
  }
  if(operation==='albumMembers') {
   if(!validKey(args.albumKey))throw Error('Invalid album.');let page=null,keys=[],dedupKeys=[],seen=new Set();
   do{const data=await rpc('snAcKc',[args.albumKey,page,null,null]);if(!Array.isArray(data)||!(data[1]==null||Array.isArray(data[1]))||data[3]?.[0]!==args.albumKey)throw Error('Unable to verify the review album.');keys.push(...(data[1]||[]).map(i=>i[0]));dedupKeys.push(...(data[1]||[]).map(i=>i[3]).filter(k=>typeof k==='string'&&k));page=data[2]||null;if(page&&seen.has(page))throw Error('Google repeated an album page.');seen.add(page);if(seen.size>1000)throw Error('Google scan exceeded its safety limit.');}while(page);
   return {ok:true,data:{keys,dedupKeys}};
  }
  if(operation==='addToAlbum') {
   if(!validKey(args.albumKey)||!Array.isArray(args.mediaKeys)||!args.mediaKeys.length||args.mediaKeys.length>25||args.mediaKeys.some(k=>!validKey(k)))throw Error('Invalid album batch.');
   await rpc('E1Cajb',[args.mediaKeys,args.albumKey]);return {ok:true,data:{requested:args.mediaKeys.length}};
  }
  if(operation==='moveToTrash') {
   if(args.confirmed!==true||!Array.isArray(args.dedupKeys)||!args.dedupKeys.length||args.dedupKeys.length>25||new Set(args.dedupKeys).size!==args.dedupKeys.length||args.dedupKeys.some(key=>!validKey(key)))throw Error('Invalid confirmed Trash batch.');
   await rpc('XwAOJf',[null,1,args.dedupKeys,3]);return {ok:true,data:{requested:args.dedupKeys.length}};
  }
  if(operation==='video'||operation==='mediaURL') {
   if(!validKey(args.mediaKey))throw Error('Invalid media identifier.');const data=await rpc('VrseUb',[args.mediaKey,null,null,null,null]);
   const url=operation==='mediaURL'?data?.[0]?.[1]?.[0]:data?.[1];
   if(data?.[0]?.[0]!==args.mediaKey||!safeMediaUrl(url))throw Error('Media preview unavailable. Open it in Google Photos.');return {ok:true,data:{url}};
  }
  throw Error('Unsupported Google Photos operation.');
 }catch(e){return {ok:false,error:e.message||'Google Photos request failed.'};}
}

function sampleSwipe(samples,event){
  const time=Number.isFinite(event.timeStamp)?event.timeStamp:0;
  samples.push({x:event.clientX,time});
  while(samples.length>1&&samples[0].time<time-100)samples.shift();
  return samples;
}
function releaseSwipe(samples,event,startX,width,cancel=false){
  sampleSwipe(samples,event);
  const dx=event.clientX-startX,first=samples[0],last=samples.at(-1),elapsed=last.time-first.time;
  const velocity=elapsed>0?(last.x-first.x)/elapsed:0;
  return {dx,velocity,commit:!cancel&&(Math.abs(dx)>width/3||(Math.abs(velocity)>.5&&velocity*dx>0)),duration:Math.round(Math.max(180,Math.min(300,300-Math.abs(velocity)*60)))};
}
function animateSwipe(element,dx,commit,duration=320){
  if(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return commit?element.animate?.([{opacity:1},{opacity:0}],{duration:150,easing:'ease-out'}):undefined;
  const start=element.style.transform||'translateX(0px)',direction=dx>0?1:-1;
  const distance=(globalThis.innerWidth||1000)+(Number.parseFloat(element.style.width)||350);
  return element.animate?.([{transform:start,opacity:1},{transform:commit?`translateX(${direction*distance}px) rotate(${direction*18}deg)`:'translateX(0px)',opacity:commit?0:1}],{duration,easing:commit?'ease-out':'cubic-bezier(.2,1.5,.5,1)'});
}
function throwSwipe(element,dx,duration,bounds){
  if(!element.cloneNode||!element.ownerDocument?.body)return;
  const transform=element.style.transform,transition=element.style.transition;
  let rect=bounds;
  if(!rect){
    element.style.transition='none';
    element.style.transform='none';
    rect=element.getBoundingClientRect();
    element.style.transform=transform;
    element.style.transition=transition;
  }
  const copy=element.cloneNode(true);
  copy.removeAttribute('id');
  for(const child of copy.querySelectorAll('[id]')){if(child.getAttribute?.('id')==='media')child.classList.add('swipe-media');child.removeAttribute('id');}
  copy.setAttribute('aria-hidden','true');
  copy.inert=true;
  Object.assign(copy.style,{position:'fixed',left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`,margin:'0',boxSizing:'border-box',right:'auto',bottom:'auto',transform:globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'none':transform,pointerEvents:'none',zIndex:'2147483647',transition:'none',willChange:''});
  (element.parentNode||element.ownerDocument.body).append(copy);
  const animation=animateSwipe(copy,dx,true,duration);
  if(animation)animation.finished.then(()=>copy.remove(),()=>copy.remove());
  else copy.remove();
  return animation;
}

function buildPhotosRequest(tokens,location,id,payload) {
 const path=tokens.eptZe;
 if(location.origin!=='https://photos.google.com'||typeof path!=='string'||!/^\/(?:u\/\d+\/|_\/PhotosUi\/(?:u\/\d+\/)?)?$/.test(path)||!tokens.SNlM0e)throw Error('Unsupported Google Photos page tokens.');
 const query=new URLSearchParams({rpcids:id,'source-path':location.pathname,'f.sid':String(tokens.FdrFJe),bl:String(tokens.cfb2h),pageId:'none',rt:'c'});
 return {url:`https://photos.google.com${path}data/batchexecute?${query}`,options:{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:new URLSearchParams({'f.req':JSON.stringify([[[id,JSON.stringify(payload),null,'generic']]]),at:tokens.SNlM0e}),credentials:'include'}};
}
function parsePhotosResponse(raw,id) {
 for(const line of raw.split('\n')) {
  let parsed;
  try {parsed=JSON.parse(line);}catch {continue;}
  if(!Array.isArray(parsed))continue;
  const envelope=parsed.find(entry=>Array.isArray(entry)&&entry[0]==='wrb.fr'&&entry[1]===id);
  if(!envelope)continue;
  if(typeof envelope[2]!=='string')throw Error('Google returned an unexpected response. No changes were confirmed.');
  try {return JSON.parse(envelope[2]);}catch {throw Error('Google response could not be read.');}
 }
 throw Error('Google returned an unexpected response. No changes were confirmed.');
}
function createPhotosAPI(environment) {
 return (operation,args={})=>photosOperation(operation,args,environment);
}

const emptyReview = () => ({revision:0,history:[],items:[],cursor:null,started:false,exhausted:false,albumKey:null,job:null});
const reviewDeck = state => state.items.filter(item=>!item.decision&&!item.needsPreview&&item.state!=='in_trash');
const reviewQueue = state => state.items.filter(item=>item.decision==='remove'&&!item.needsPreview&&!item.queueSent&&item.state!=='in_trash');
const reviewTrashCandidates = state => state.items.filter(item=>item.decision==='remove'&&!item.needsPreview&&item.state!=='in_trash');
function reviewStorage(items) {
 return items.reduce((total,item)=>{
  const bytes=item.takesUpSpace===false?0:item.spaceTaken??item.size;
  if(Number.isFinite(bytes)&&bytes>=0)total.bytes+=bytes;else total.unknown++;
  return total;
 },{bytes:0,unknown:0});
}
function mergeReviewPage(state,page,requestCursor,refresh=false) {
 if(!refresh&&state.cursor!==requestCursor)throw Error('Library progress changed. Retry Load more.');
 if(page.nextPageId&&page.nextPageId===requestCursor)throw Error('Google repeated a page. Reload before retrying.');
 const items=new Map(state.items.map(item=>[item.mediaKey,item]));
 for(const item of page.items){const old=items.get(item.mediaKey);items.set(item.mediaKey,{...old,...item,urlFetchedAt:Date.now(),decision:old?.decision??null,queueSent:old?.queueSent??false,albumKey:old?.albumKey??null,state:'active',needsPreview:false,revision:(old?.revision||0)+(old&&old.state!=='active'?1:0)});}
 const progress=!refresh||!state.started?{cursor:page.nextPageId,exhausted:!page.nextPageId,started:true}:{};
 return {...state,...progress,items:[...items.values()]};
}
function canUndoReview(state,entry) {
 const item=state.items.find(item=>item.mediaKey===entry.key);
 return !!item&&item.state!=='in_trash'&&item.decision===entry.decision&&(item.revision||0)===entry.revision&&!state.job?.mediaKeys.includes(entry.key);
}
function decideReview(state,key,decision,expected,expectedRevision) {
 if(![null,'keep','remove'].includes(decision))throw Error('Invalid decision.');
 if(state.job?.mediaKeys.includes(key))throw Error('Finish the saved album operation before changing this item.');
 const item=state.items.find(item=>item.mediaKey===key);
 if(!item||item.state==='in_trash'||item.decision!==expected||(expectedRevision!==undefined&&(item.revision||0)!==expectedRevision))throw Error('This item changed. Refresh and try again.');
 return {...state,items:state.items.map(item=>item.mediaKey===key?{...item,decision,queueSent:false,revision:(item.revision||0)+1}:item)};
}
const albumMatches = (members,item) => members.keys.includes(item.mediaKey)||!!item.dedupKey&&members.dedupKeys.includes(item.dedupKey);
function finishReviewAlbum(state,members) {
 if(!state.job||!state.job.albumKey)throw Error('No saved album operation.');
 const keys=new Set(state.job.mediaKeys);
 const items=state.items.filter(item=>keys.has(item.mediaKey));
 if(items.length!==keys.size||items.some(item=>!albumMatches(members,item)))throw Error('Not every candidate was verified. Retry the saved album operation.');
 return {...state,albumKey:state.job.albumKey,albumTitle:state.job.albumTitle===undefined?state.job.title:state.job.albumTitle,job:null,items:state.items.map(item=>keys.has(item.mediaKey)?{...item,queueSent:true,albumKey:state.job.albumKey,revision:(item.revision||0)+1}:item)};
}
async function sendReviewAlbum({read,save,call,title}) {
 let state=await read();
 if(!state.job){const mediaKeys=reviewQueue(state).map(item=>item.mediaKey);if(!mediaKeys.length)throw Error('The removal queue is empty.');state=await save({...state,job:{title,mediaKeys,albumKey:state.albumKey,albumTitle:state.albumKey?state.albumTitle||null:title}});}
 let members;
 if(state.job.albumKey){
  try{members=await call('albumMembers',{albumKey:state.job.albumKey});}catch(error){
   const found=await call('findAlbum',{title:state.job.title});
   const albumTitle=state.job.albumTitle===undefined?state.job.title:state.job.albumTitle;
   if(found.albumKey||albumTitle!==state.job.title)throw error;
   const albumKey=(await call('createAlbum',{title:state.job.title})).albumKey;
   state=await save({...state,job:{...state.job,albumKey,albumTitle:state.job.title}});
  }
 }
 if(!state.job.albumKey){const found=await call('findAlbum',{title:state.job.title});const albumKey=found.albumKey||(await call('createAlbum',{title:state.job.title})).albumKey;state=await save({...state,job:{...state.job,albumKey,albumTitle:state.job.title}});}
 const albumKey=state.job.albumKey;
 members ||= await call('albumMembers',{albumKey});
 const candidates=state.items.filter(item=>state.job.mediaKeys.includes(item.mediaKey));
 const missing=candidates.filter(item=>!albumMatches(members,item));
 for(let index=0;index<missing.length;index+=25){
  const batch=missing.slice(index,index+25);let writeError;
  try{await call('addToAlbum',{albumKey,mediaKeys:batch.map(item=>item.mediaKey)});}catch(error){writeError=error;}
  members=await call('albumMembers',{albumKey});
  if(batch.some(item=>!albumMatches(members,item)))throw writeError||Error('Some additions were not confirmed. Retry the saved album operation.');
 }
 return save(finishReviewAlbum(state,members));
}
async function readReviewTrash(call) {
 const keys=new Set(),dedupKeys=new Set(),seen=new Set();let cursor=null;
 do {
  const page=await call('trashPage',{cursor});
  for(const item of page.items){keys.add(item.mediaKey);if(item.dedupKey)dedupKeys.add(item.dedupKey);}
  cursor=page.nextPageId;
  if(cursor&&seen.has(cursor))throw Error('Google repeated a Trash page. Nothing was updated.');
  seen.add(cursor);if(seen.size>1000)throw Error('Trash scan exceeded its safety limit.');
 }while(cursor);
 return {keys,dedupKeys};
}
async function reconcileReviewTrash(state,call) {
 if(state.job)throw Error('Finish the saved album operation before checking Trash.');
 const trash=await readReviewTrash(call),items=[];
 for(const item of state.items){
  let next=item.state;
  if(trash.keys.has(item.mediaKey))next='in_trash';
  else if(item.state==='in_trash'||item.dedupKey&&trash.dedupKeys.has(item.dedupKey)){const result=await call('itemState',{mediaKey:item.mediaKey});if(['active','in_trash'].includes(result.state))next=result.state;}
  items.push({...item,state:next,revision:(item.revision||0)+(next!==item.state?1:0)});
 }
 const newlyTrashed=items.filter(item=>item.state==='in_trash'&&state.items.find(previous=>previous.mediaKey===item.mediaKey)?.state!=='in_trash');
 return {...state,items,lifetimeFreed:(state.lifetimeFreed||reviewStorage(state.items.filter(item=>item.state==='in_trash')).bytes)+reviewStorage(newlyTrashed).bytes};
}
async function loadReviewPages({read,save,call,refresh=false,progress=()=>{},target=50,maxPages=Infinity}) {
 let state=await read();
 const before=new Set(reviewDeck(state).map(item=>item.mediaKey)),seen=new Set(state.cursor?[state.cursor]:[]);
 let scanned=0,added=0,warning='',limited=false;
 if(!refresh&&state.exhausted)return {scanned,added,warning,limited,exhausted:true};
 for(let count=0;count<maxPages;count++){
  progress(scanned);
  const cursor=refresh?null:state.cursor,page=await call('library',{cursor});
  if(!refresh&&page.nextPageId&&seen.has(page.nextPageId))throw Error('Google repeated a library page. Reload before retrying.');
  state=await save(mergeReviewPage(await read(),page,cursor,refresh),page,cursor,refresh);scanned+=page.items.length;warning=page.metadataWarning||warning;added=reviewDeck(state).filter(item=>!before.has(item.mediaKey)).length;
  if(refresh||state.exhausted||added>=target)break;
  seen.add(state.cursor);limited=count===maxPages-1;
 }
 return {scanned,added,warning,limited,exhausted:state.exhausted};
}

const LEASE_HEARTBEAT_MS=4000;
const LEASE_EXPIRY_MS=12000;
async function openReviewDatabase(indexedDB) {
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
  save:(account,state)=>transaction('accounts',account,current=>{
   if((current?.revision||0)!==state.revision)throw Error('Progress changed in another tab. Reopen Photos Swipe and retry.');
   return {...state,revision:state.revision+1};
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

const fields=['mediaKey','type','size','spaceTaken','takesUpSpace','state','revision','queueSent'];
function mergeProgressItem(item,checkpoint) {
 return {...Object.fromEntries(Object.entries(item).filter(([field])=>!fields.includes(field))),...checkpoint};
}
function createSyncClient({fetch,status=()=>{},unpaired=()=>{}}) {
 let settings={},blocked=false,firstSync=true;
 const configure=value=>{settings=value||{};blocked=false;firstSync=true;status(settings.url&&settings.token?'Sync ready':'Sync off \u00b7 saved locally');};
 async function request(scope,path,method='GET',value) {
  if(blocked)throw Error('This device was unpaired.');
  if(!settings.url||!settings.token)throw Error('Configure sync to manage paired devices.');
  const url=new URL(path,settings.url.replace(/\/$/,'')+'/');url.searchParams.set('scope',scope);
  const signal=AbortSignal.timeout(10000);
  try {
   const response=await fetch(url.href,{method,headers:{Authorization:`Bearer ${settings.token}`,...(value?{'Content-Type':'application/json'}:{})},...(value?{body:JSON.stringify(value)}:{}),credentials:'omit',referrerPolicy:'no-referrer',signal});
   if(response.status===401){blocked=true;status('This device was unpaired.');await unpaired();throw Error('This device was unpaired.');}
   if(!response.ok)throw Error(`Sync HTTP ${response.status}`);
   return await response.json();
  }catch(error){
   if(signal.aborted||error.name==='TimeoutError')throw Object.assign(Error('Sync timed out'),{name:'TimeoutError'});
   if(error.name==='AbortError')throw Error('Sync cancelled');
   throw error;
  }
 }
 async function sync(scope,state,save,options={}) {
  const {pull=true,rebuild=async value=>value}=typeof options==='function'?{rebuild:options}:options;
  if(blocked||!settings.url||!settings.token)return state;
  let retryAvailable=firstSync;firstSync=false;
  const syncRequest=async(...args)=>{
   try{return await request(...args);}catch(error){
    if(error.name!=='TimeoutError'||!retryAvailable)throw error;
    retryAvailable=false;return request(...args);
   }
  };
  status('Syncing\u2026');
  let checkpoint=state;
  try {
   const remote=pull?await syncRequest(scope,'api/state'):{decisions:Object.entries(state.syncDecisions||{}).map(([id,decision])=>({id,decision})),history:state.history,progress:state.syncProgress||{}};
   const decisions={...Object.fromEntries(remote.decisions.map(item=>[item.id,item.decision]))};
   const pending={...state.syncPending};
   if(state.syncDecisions==null)for(const item of state.items)if(item.decision&&!Object.hasOwn(pending,item.mediaKey))pending[item.mediaKey]=item.decision;
   const dirty=state.syncDirty||!state.syncDecisions&&state.history.length>0;
   const historyKeys=new Set([...(state.syncHistoryKeys||[]),...Object.keys(pending),...(dirty?state.history.map(entry=>entry.key):[])]);
   const remaining={...pending};
   for(const batch of decisionBatches(pending)){
    await syncRequest(scope,'api/decisions','PUT',{decisions:batch});
    for(const {id,decision} of batch){delete remaining[id];if(decision===null)delete decisions[id];else decisions[id]=decision;}
    checkpoint={...state,syncDecisions:{...decisions},syncPending:{...remaining},syncDirty:dirty,syncHistoryKeys:[...historyKeys]};
   }
   const history=(dirty?mergeHistory(remote.history,state.history,historyKeys):remote.history).slice(-2000);
   const checkpointItems=new Map((remote.progress.items||[]).map(item=>[item.mediaKey,item]));
   const checkpointRevisions=new Map([...checkpointItems].map(([key,item])=>[key,item.revision||0]));
   const mergedItems=state.items.map(item=>{
    const checkpoint=checkpointItems.get(item.mediaKey);checkpointItems.delete(item.mediaKey);
    return checkpoint&&(checkpoint.revision||0)>=(item.revision||0)?mergeProgressItem(item,checkpoint):item;
   });
   for(const item of checkpointItems.values())mergedItems.push({...item,name:item.mediaKey,type:item.type||'photo',needsPreview:true});
   const items=mergedItems.map(item=>{
    const value=Object.hasOwn(pending,item.mediaKey)?pending[item.mediaKey]:decisions[item.mediaKey]??(Object.hasOwn(state.syncDecisions||{},item.mediaKey)?null:item.decision);
    const entry=history.findLast(entry=>entry.key===item.mediaKey&&entry.decision===value);
    return {...item,decision:value,revision:!dirty&&entry&&(value!==item.decision||!item.revision)?Math.max(entry.revision,checkpointRevisions.get(item.mediaKey)||0):item.revision};
   });
   let next={...state,history,items,syncDecisions:decisions,lifetimeFreed:Math.max(state.lifetimeFreed||0,remote.progress.lifetimeFreed||0,reviewStorage(items.filter(item=>item.state==='in_trash')).bytes)};
   if(!state.started&&!state.items.length&&!state.history.length&&!dirty&&Object.keys(pending).length===0&&(remote.progress.started||Object.keys(decisions).length)){
    const restored=remote.progress.items?.map(item=>({...item}))||Object.keys(decisions).map(mediaKey=>({mediaKey,revision:history.findLast(entry=>entry.key===mediaKey)?.revision||0,state:'active'}));
    for(const mediaKey of Object.keys(decisions))if(!restored.some(item=>item.mediaKey===mediaKey))restored.push({mediaKey,revision:history.findLast(entry=>entry.key===mediaKey)?.revision||0,state:'active'});
    next={...next,started:!!remote.progress.started,items:restored.map(item=>({...item,name:item.mediaKey,type:item.type||'photo',decision:decisions[item.mediaKey]??null,needsPreview:true})),lifetimeFreed:remote.progress.lifetimeFreed||0};
    try{next=await rebuild(next);}catch(error){status(`${error.message} \u00b7 checkpoint recovered; retry loading the library`);}
   }
   let progress=reviewSyncProgress(next,decisions);
   const progressDirty=dirty||JSON.stringify(progress)!==JSON.stringify(state.syncCheckpoint)&&state.items.length>0;
   let writeError=null;
   try{
    if(dirty)await syncRequest(scope,'api/undo','PUT',{history});
    if(progressDirty){
     const accepted=new Map();
     for(const batch of progressBatches(progress)){
      const result=await syncRequest(scope,'api/progress','PUT',batch);
      const items=result.items||(await syncRequest(scope,'api/state')).progress.items;
      if(!Array.isArray(items)||batch.items.some(item=>!items.some(row=>row.mediaKey===item.mediaKey)))throw Error('Unconfirmed sync');
      for(const item of items)accepted.set(item.mediaKey,item);
     }
     next={...next,items:next.items.map(item=>accepted.has(item.mediaKey)?mergeProgressItem(item,accepted.get(item.mediaKey)):item)};
     progress.items=reviewSyncProgress(next,decisions).items;
    }
   }catch(error){writeError=error;}
   next=await save({...next,syncPending:{},syncDirty:writeError?!!dirty:false,syncHistoryKeys:writeError?[...historyKeys]:[],syncProgress:remote.progress,syncCheckpoint:writeError?state.syncCheckpoint:progress});
   if(writeError){if(!blocked)status(`${writeError.message} \u00b7 pull saved locally; retry on next action`);return next;}
   status(`Synced \u00b7 ${Object.keys(decisions).length} reviewed IDs${remote.suggestRevokeLegacy?' \u00b7 Device paired; retire the exposed shared sync token.':''}`);return next;
  }catch(error){if(!blocked)status(`${error.message} \u00b7 saved locally; retry on next action`);return checkpoint===state?state:await save(checkpoint);}
 }
 return {configure,sync,devices:()=>request('default','api/devices'),rename:(id,name)=>request('default',`api/devices/${encodeURIComponent(id)}`,'PATCH',{name}),revoke:id=>request('default',`api/devices/${encodeURIComponent(id)}`,'DELETE'),revokeOthers:()=>request('default','api/devices/revoke-others','POST'),async pair(url,code,name,platform){
  let worker;try{worker=new URL(url);}catch{throw Error('Enter a valid HTTPS Worker origin.');}
  if(worker.protocol!=='https:'||worker.username||worker.password)throw Error('Enter a valid HTTPS Worker origin.');
  if(!/^\d{6}$/.test(code))throw Error('Enter a six-digit pairing code.');
  const response=await fetch(new URL('/api/pair/claim',worker.origin).href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({short:code,name,platform}),credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error(response.status>=500?'Pairing is unavailable on the sync server (server misconfigured)':'Code expired or unavailable. Ask the paired device for a new code.');
  return response.json();
 }};
}
function markSyncChanges(previous,next) {
 const pending={...previous.syncPending};
 const old=new Map(previous.items.map(item=>[item.mediaKey,item.decision]));
 let dirty=!!previous.syncDirty||JSON.stringify(previous.history)!==JSON.stringify(next.history);
 const items=next.items.map(item=>{
  if(!old.has(item.mediaKey)&&previous.syncDecisions?.[item.mediaKey])return {...item,decision:previous.syncDecisions[item.mediaKey],revision:previous.history.findLast(entry=>entry.key===item.mediaKey)?.revision||item.revision||0};
  if((old.get(item.mediaKey)??null)!==(item.decision??null)){pending[item.mediaKey]=item.decision??null;dirty=true;}
  return item;
 });
 return {...next,items,syncPending:pending,syncDirty:dirty};
}
function validateSyncSettings(url,token) {
 if(!url&&!token)return {url:'',token:''};
 const parsed=new URL(url);
 if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=='/'||token.length>4096||!token||/[\r\n]/.test(token))throw Error('Enter an HTTPS Worker origin and sync token.');
 return {url:parsed.origin,token};
}

function progressBatches(progress) {
 const {items,...metadata}=progress,encoder=new TextEncoder(),batches=[];
 let batch=[],bytes=encoder.encode(JSON.stringify({...metadata,items:[]})).length;
 const baseBytes=bytes;
 for(const item of items){
  const itemBytes=encoder.encode(JSON.stringify(item)).length;
  if(batch.length&&(batch.length===2000||bytes+itemBytes+1>262144)){
   batches.push({...metadata,items:batch});batch=[];bytes=baseBytes;
  }
  bytes+=itemBytes+(batch.length?1:0);batch.push(item);
 }
 if(batch.length||!batches.length)batches.push({...metadata,items:batch});
 return batches;
}
function reviewSyncProgress(state,decisions=state.syncDecisions||{}) {
 return {started:!!state.started,reviewed:Object.keys(decisions).length,items:state.items.map(item=>Object.fromEntries(fields.filter(field=>item[field]!==undefined).map(field=>[field,item[field]]))),lifetimeFreed:state.lifetimeFreed||reviewStorage(state.items.filter(item=>item.state==='in_trash')).bytes};
}
async function rebuildSyncedReview(state,call) {
 const items=new Map(state.items.map(item=>[item.mediaKey,item])),seen=new Set();let cursor=null,exhausted=false;
 for(let count=0;count<12;count++){
  const page=await call('library',{cursor});
  for(const item of page.items){const old=items.get(item.mediaKey),storage=Object.fromEntries(['size','spaceTaken','takesUpSpace'].map(field=>[field,item[field]??old?.[field]]));items.set(item.mediaKey,{...old,...item,...storage,decision:state.syncDecisions[item.mediaKey]??null,state:old?.state||'active',revision:old?.revision||0,needsPreview:false});}
  if(page.nextPageId&&(page.nextPageId===cursor||seen.has(page.nextPageId)))throw Error('Google repeated a library page during sync recovery.');
  cursor=page.nextPageId;exhausted=!cursor;seen.add(cursor);
  if(exhausted||[...items.values()].filter(item=>!item.decision&&!item.needsPreview&&item.state!=='in_trash').length>=50)break;
 }
 return {...state,items:[...items.values()],started:true,cursor,exhausted};
}

function mergeHistory(remote,local,keys) {
 return [...remote.filter(entry=>!keys.has(entry.key)),...local.filter(entry=>keys.has(entry.key))];
}
function mergeSyncResult(current,snapshot,synced) {
 const before=new Map(snapshot.items.map(item=>[item.mediaKey,item]));
 const incoming=new Map(synced.items.map(item=>[item.mediaKey,item]));
 const changed=new Set(current.items.filter(item=>{const old=before.get(item.mediaKey);return !old||item.revision!==old.revision||item.decision!==old.decision;}).map(item=>item.mediaKey));
 for(const key of new Set([...snapshot.history,...current.history].map(entry=>entry.key)))if(JSON.stringify(snapshot.history.filter(entry=>entry.key===key))!==JSON.stringify(current.history.filter(entry=>entry.key===key)))changed.add(key);
 const pending={...synced.syncPending};
 for(const key of changed)if(Object.hasOwn(current.syncPending||{},key))pending[key]=current.syncPending[key];
 const history=mergeHistory(synced.history,current.history,changed).slice(-2000);
 const items=current.items.map(item=>changed.has(item.mediaKey)?item:incoming.get(item.mediaKey)||item);
 const existing=new Set(items.map(item=>item.mediaKey));
 for(const item of synced.items)if(!existing.has(item.mediaKey))items.push(item);
 const recovered=!snapshot.started&&!snapshot.items.length&&synced.started;
 return {...current,...(recovered?{started:synced.started,cursor:synced.cursor,exhausted:synced.exhausted}:{}),lifetimeFreed:Math.max(current.lifetimeFreed||0,synced.lifetimeFreed||0),syncProgress:synced.syncProgress,syncCheckpoint:synced.syncCheckpoint,items,history,syncDecisions:synced.syncDecisions,syncPending:pending,syncHistoryKeys:[...new Set([...(synced.syncHistoryKeys||[]),...changed])],syncDirty:!!synced.syncDirty||JSON.stringify(history)!==JSON.stringify(synced.history)};
}
function decisionBatches(pending) {
 const batches=[];let batch=[],bytes=16;
 for(const [id,decision] of Object.entries(pending)){
  const entry={id,decision},size=new TextEncoder().encode(JSON.stringify(entry)).length;
  if(batch.length&&(batch.length===2000||bytes+size+1>262144)){batches.push(batch);batch=[];bytes=16;}
  if(bytes+size>262144)throw Error('Decision exceeds sync input limit');
  bytes+=size+(batch.length?1:0);batch.push(entry);
 }
 if(batch.length)batches.push(batch);
 return batches;
}

async function createPairingStore({GM,database,crypto}) {
 const durable=!!GM&&['getValue','setValue','deleteValue'].every(name=>typeof GM[name]==='function');
 const key='photos-swipe-pairing';
 const dismissalKey='photos-swipe-onboarding-dismissed';
 const complete=value=>typeof value?.url==='string'&&!!value.url&&typeof value?.token==='string'&&!!value.token;
 const select=value=>Object.fromEntries(['url','token','deviceId','deviceName'].filter(name=>typeof value?.[name]==='string').map(name=>[name,value[name]]));
 async function settings() {
  const db=await database();
  if(!durable)return db.settings();
  let value=await GM.getValue(key);
  const legacy=await db.settings();
  if(!complete(value)&&complete(legacy)){
   value={...select(legacy),deviceId:legacy.deviceId||crypto.randomUUID()};
   await GM.setValue(key,value);
  }
  if(complete(value)&&(legacy.token||legacy.url||legacy.deviceId||legacy.deviceName)){await db.deleteSettings();if(legacy.onboardingDismissed)await db.saveSettings({onboardingDismissed:true});}
  return {...(!complete(value)?select({...legacy,token:undefined}):{}),...select(value),onboardingDismissed:await GM.getValue(dismissalKey),unpaired:legacy.unpaired};
 }
 async function saveSettings(value) {
  const db=await database();
  if(!durable)return db.saveSettings(value);
  if(value.url&&value.token)await GM.setValue(key,{...select(value),deviceId:value.deviceId||crypto.randomUUID()});
  else await GM.deleteValue(key);
  if(value.onboardingDismissed)await GM.setValue(dismissalKey,true);
  else await GM.deleteValue(dismissalKey);
  await db.saveSettings({...(!(value.url&&value.token)?select({...value,token:undefined}):{}),...(value.onboardingDismissed?{onboardingDismissed:true}:{}),...(value.unpaired?{unpaired:true}:{})});
 }
 return {durable,settings,saveSettings};
}

function createPagePhotosBridge({window,document,crypto,setTimeout,clearTimeout}) {
 const channel=crypto.randomUUID();
 const pending=new Map();
 window.addEventListener('message',event=>{
  if(event.source!==window||event.data?.channel!==channel||!['photos-result','photos-accepted'].includes(event.data?.kind))return;
  const entry=pending.get(event.data.id);
  if(!entry)return;
  clearTimeout(entry.timer);
  if(event.data.kind==='photos-accepted'){entry.timer=setTimeout(entry.expire,entry.duration);return;}
  pending.delete(event.data.id);entry.resolve(event.data.result);
 });
 const script=document.createElement('script');
 const nonce=document.querySelector('script[nonce]')?.nonce;
 if(nonce)script.setAttribute('nonce',nonce);
 script.textContent=`(${function(channel,operation){
  window.addEventListener('message',async event=>{
   if(event.source!==window||event.data?.channel!==channel||event.data?.kind!=='photos-call')return;
   const {id,name,args}=event.data;
   window.postMessage({channel,kind:'photos-accepted',id},location.origin);
   const result=await operation(name,args);
   window.postMessage({channel,kind:'photos-result',id,result},location.origin);
  });
 }.toString()})(${JSON.stringify(channel)},${photosOperation.toString()});`;
 document.documentElement.append(script);script.remove();
 return (name,args={})=>new Promise(resolve=>{
  const id=crypto.randomUUID();
  const duration=(['findAlbum','albumMembers'].includes(name)?1001:name==='library'?2:1)*30000+5000;
  const expire=()=>{pending.delete(id);resolve({ok:false,error:'Google Photos page bridge unavailable. Reload or check userscript injection permissions.'});};
  const timer=setTimeout(expire,35000);
  pending.set(id,{resolve,timer,expire,duration});
  window.postMessage({channel,kind:'photos-call',id,name,args},'https://photos.google.com');
 });
}

function createSwipeFeedback({window,targets,card,under,keep,remove,canSwipe,onDecide,playbackOnClick=false}) {
 let gesture=null,frame=null,animation=null,dismissing=false,finished=Promise.resolve(),cardWidth=300;
 const motionPreference=window.matchMedia?.('(prefers-reduced-motion: reduce)');
 const reduced=()=>motionPreference?.matches===true;
 const eligible=({dx,dy})=>Math.abs(dx)>Math.abs(dy)*1.5;
 const commits=value=>value.locked&&eligible(value)&&(Math.abs(value.dx)>=value.width*.33||Math.abs(value.velocity)>.5&&Math.sign(value.velocity)===Math.sign(value.dx))&&canSwipe();
 const paint=()=>{
  frame=null;
  if(!gesture)return;
  if(gesture.cancelled){reset();return;}
  if(!gesture.locked)return;
  card.style.willChange=reduced()?'':'transform';
  const {dx,dy,width}=gesture,progress=eligible(gesture)?Math.min(1,Math.abs(dx)/(width*.33)):0;
  card.style.transform=reduced()?'':`translate3d(${dx}px,${dy*.2}px,0) rotate(${Math.max(-15,Math.min(15,dx/width*15))}deg) scale(1.02)`;
  keep.style.opacity=String(dx>0?progress:0);
  remove.style.opacity=String(dx<0?progress:0);
  under.style.transform=reduced()?'':`scale(${.94+.06*progress})`;
 };
 const release=()=>{
  const previous=gesture;
  gesture=null;
  if(frame!==null)window.cancelAnimationFrame?.(frame);
  frame=null;
  card.style.willChange='';
  if(previous?.target.hasPointerCapture?.(previous.id))previous.target.releasePointerCapture(previous.id);
 };
 const reset=()=>{
  release();animation?.cancel();animation=null;dismissing=false;finished=Promise.resolve();
  card.style.transform='';card.style.willChange='';card.style.visibility='';
  keep.style.opacity='0';remove.style.opacity='0';under.style.transform=reduced()?'':'scale(.94)';
 };
 const animate=transform=>{
  const start=card.style.transform||'none';
  animation?.cancel();animation=null;
  card.style.transform=transform;
  if(!reduced()&&card.animate){animation=card.animate([{transform:start},{transform:transform||'none'}],{duration:180,easing:'ease-out'});finished=animation.finished.catch(()=>{});}
  else finished=Promise.resolve();
  return finished;
 };
 const dismiss=decision=>{
  if(dismissing)return finished;
  dismissing=true;const width=gesture?.width||cardWidth;release();
  const direction=decision==='keep'?1:-1;
  keep.style.opacity=decision==='keep'?'1':'0';remove.style.opacity=decision==='remove'?'1':'0';under.style.transform=reduced()?'':'scale(1)';
  const destination=reduced()?'':`translate3d(${direction*(Math.max(window.innerWidth||0,width)*1.5)}px,0,0) rotate(${direction*15}deg)`;
  if(card.cloneNode&&card.parentNode){
   const outgoing=card.cloneNode(true);
   outgoing.setAttribute('aria-hidden','true');outgoing.inert=true;
   for(const element of outgoing.querySelectorAll?.('[id]')||[])element.removeAttribute('id');
   outgoing.removeAttribute?.('id');outgoing.style.willChange='';outgoing.style.transform=reduced()?'':card.style.transform;
   outgoing.style.position='absolute';outgoing.style.inset='0';outgoing.style.pointerEvents='none';outgoing.style.zIndex='3';
   card.parentNode.append(outgoing);
   card.style.visibility='hidden';
   const flight=outgoing.animate?.(reduced()?[{opacity:1},{opacity:0}]:[{transform:card.style.transform||'none',opacity:1},{transform:destination,opacity:0}],{duration:reduced()?150:180,easing:'ease-out'});
   outgoing.style.transform=destination;
   finished=flight?flight.finished.catch(()=>{}).then(()=>outgoing.remove()):Promise.resolve(outgoing.remove());
   return finished;
  }
  return animate(destination);
 };
 const cancelGesture=()=>{
  if(!gesture)return;
  gesture.suppressClick();
  const transform=gesture.locked?card.style.transform:null;
  reset();
  if(transform){card.style.transform=transform;animate('');}
 };
 const update=event=>{
  if(!gesture||event.pointerId!==gesture.id)return;
  const dx=event.clientX-gesture.x,time=event.timeStamp;
  if(Number.isFinite(time)){
   gesture.samples.push({dx,time});
   while(gesture.samples.length>1&&gesture.samples[0].time<time-80)gesture.samples.shift();
   const first=gesture.samples[0],elapsed=time-first.time;
   gesture.velocity=elapsed>=16?(dx-first.dx)/elapsed:0;
  }
  gesture.dx=dx;gesture.dy=event.clientY-gesture.y;
  if(!gesture.locked){
   if(Math.hypot(gesture.dx,gesture.dy)<10)return;
   if(Math.abs(gesture.dy)>=Math.abs(gesture.dx))gesture.cancelled=true;
   else {gesture.locked=true;gesture.target.setPointerCapture(gesture.id);}
  }
  gesture.suppressClick();
  if(!gesture.cancelled)event.preventDefault?.();
  if(frame===null){if(window.requestAnimationFrame)frame=window.requestAnimationFrame(paint);else paint();}
 };
 const finishGesture=event=>{
   if(!gesture||event.pointerId!==gesture.id)return;
   update(event);
   if(!gesture)return;
   const value=gesture,commit=!value.cancelled&&commits(value);
   if(commit){if(frame!==null)window.cancelAnimationFrame?.(frame);frame=null;paint();release();dismiss(value.dx>0?'keep':'remove');onDecide(value.dx>0?'keep':'remove');}
   else {
    const transform=card.style.transform;
    reset();card.style.transform=transform;animate('');
    if(!playbackOnClick&&!value.locked&&Math.hypot(value.dx,value.dy)<10&&value.video){if(value.video.paused)value.video.play().catch(()=>{});else value.video.pause();}
   }
 };
 window.addEventListener?.('pointermove',update,true);
 window.addEventListener?.('pointerup',finishGesture,true);
 window.addEventListener?.('pointercancel',event=>{if(gesture&&event.pointerId===gesture.id)cancelGesture();},true);
 for(const target of targets){
  let suppressClick=false;
  target.addEventListener('pointerdown',event=>{
   if(gesture||dismissing||!canSwipe()||event.isPrimary===false||event.button!==0)return;
   suppressClick=false;animation?.cancel();animation=null;
   cardWidth=card.getBoundingClientRect?.().width||card.offsetWidth||300;
   gesture={id:event.pointerId,x:event.clientX,y:event.clientY,dx:0,dy:0,samples:Number.isFinite(event.timeStamp)?[{dx:0,time:event.timeStamp}]:[],velocity:0,width:cardWidth,target,suppressClick:()=>{suppressClick=true;},video:event.target.tagName==='VIDEO'?event.target:null,locked:false};
   if(event.pointerType==='mouse')target.setPointerCapture(event.pointerId);
  });
  target.addEventListener('pointermove',update);
  target.addEventListener('pointerup',finishGesture);
  for(const type of ['pointercancel'])target.addEventListener(type,event=>{if(gesture&&event.pointerId===gesture.id){suppressClick=true;cancelGesture();}});
  target.addEventListener('touchmove',event=>{if(gesture?.locked&&event.cancelable)event.preventDefault();},{passive:false});
  target.addEventListener('lostpointercapture',event=>{if(event.target===target&&gesture?.id===event.pointerId){suppressClick=true;reset();}});
  target.addEventListener('click',event=>{
   if(suppressClick){event.preventDefault();event.stopImmediatePropagation();suppressClick=false;return;}
   if(event.target.closest?.('button'))return;
   const video=playbackOnClick&&target.querySelector?.('video');
   if(video&&!video.controls){if(video.paused)video.play().catch(()=>{});else video.pause();}
  });
 }
 reset();
 return {reset,dismiss,get finished(){return finished;}};
}

function pairingQR(value) {
 const bytes=new TextEncoder().encode(value);
 if(bytes.length>84)throw Error('Pairing URL too long');
 const bits=[],push=(value,length)=>{for(let i=length-1;i>=0;i--)bits.push(value>>>i&1);};
 push(4,4);push(bytes.length,8);for(const byte of bytes)push(byte,8);
 push(0,Math.min(4,688-bits.length));while(bits.length%8)bits.push(0);
 const data=[];for(let i=0;i<bits.length;i+=8)data.push(bits.slice(i,i+8).reduce((a,b)=>a*2+b,0));
 while(data.length<86)data.push(data.length%2===Math.ceil(bits.length/8)%2?236:17);
 const multiply=(a,b)=>{let result=0;for(let i=0;i<8;i++){if(b&1)result^=a;b>>>=1;a<<=1;if(a&256)a^=285;}return result;};
 let generator=[1],power=1;
 for(let i=0;i<24;i++){const next=Array(generator.length+1).fill(0);generator.forEach((v,j)=>{next[j]^=v;next[j+1]^=multiply(v,power);});generator=next;power=multiply(power,2);}
 const blocks=[data.slice(0,43),data.slice(43)],parity=blocks.map(block=>{const remainder=[...block,...Array(24).fill(0)];for(let i=0;i<43;i++){const factor=remainder[i];for(let j=0;j<generator.length;j++)remainder[i+j]^=multiply(generator[j],factor);}return remainder.slice(43);});
 const stream=[];for(let i=0;i<43;i++)for(const block of blocks)pushByte(block[i]);for(let i=0;i<24;i++)for(const block of parity)pushByte(block[i]);
 function pushByte(byte){for(let i=7;i>=0;i--)stream.push(byte>>>i&1);}
 const size=37,matrix=Array.from({length:size},()=>Array(size).fill(false)),reserved=Array.from({length:size},()=>Array(size).fill(false));
 const set=(x,y,dark)=>{if(x>=0&&y>=0&&x<size&&y<size){matrix[y][x]=!!dark;reserved[y][x]=true;}};
 for(const [cx,cy] of [[3,3],[33,3],[3,33]])for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const distance=Math.max(Math.abs(dx),Math.abs(dy));set(cx+dx,cy+dy,distance!==2&&distance!==4);}
 for(let i=8;i<size-8;i++){set(i,6,i%2===0);set(6,i,i%2===0);}
 for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)set(30+dx,30+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);
 const format=0x5412;
 for(let i=0;i<=5;i++)set(8,i,format>>>i&1);
 set(8,7,format>>>6&1);set(8,8,format>>>7&1);set(7,8,format>>>8&1);
 for(let i=9;i<15;i++)set(14-i,8,format>>>i&1);
 for(let i=0;i<8;i++)set(size-1-i,8,format>>>i&1);
 for(let i=8;i<15;i++)set(8,size-15+i,format>>>i&1);
 set(8,size-8,true);
 let index=0,up=true;
 for(let right=size-1;right>=1;right-=2){if(right===6)right=5;for(let vertical=0;vertical<size;vertical++){const y=up?size-1-vertical:vertical;for(let offset=0;offset<2;offset++){const x=right-offset;if(!reserved[y][x])matrix[y][x]=!!((stream[index++]||0)^((x+y)%2===0));}}up=!up;}
 return matrix;
}
function renderPairingQR(document,value) {
 const matrix=pairingQR(value),canvas=document.createElement('canvas');canvas.width=canvas.height=270;
 const context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,270,270);context.fillStyle='black';
 matrix.forEach((row,y)=>row.forEach((dark,x)=>{if(dark)context.fillRect((x+4)*6,(y+4)*6,6,6);}));
 canvas.setAttribute('aria-label','Scan to pair another device');return canvas;
}

const pairingServerError='Pairing is unavailable on the sync server (server misconfigured)';
function createPairingModal({document,parent,fetch,settings,setTimeout,clearTimeout,now=Date.now,onClose=()=>{},renderQR=renderPairingQR}) {
 const modal=document.createElement('section');modal.hidden=true;modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','Pair another device');modal.className='pairing-issuer settings-sheet';modal.style.cssText='z-index:9;pointer-events:auto';
 const status=document.createElement('p'),qr=document.createElement('div'),short=document.createElement('p'),countdown=document.createElement('p'),cancel=document.createElement('button'),renew=document.createElement('button'),devices=document.createElement('button');
 status.setAttribute('role','status');cancel.textContent='Cancel';renew.textContent='New code';devices.textContent='View devices';modal.append(status,qr,short,countdown,cancel,renew,devices);parent.append(modal);
 let generation=0,current=null,timer=null,credentials=null,nextPollAt=0,polling=false,pendingStatus=null;
 const request=async(path,method='GET',body)=>{
  const response=await fetch(new URL('/api/'+path,credentials.url).href,{method,headers:{Authorization:`Bearer ${credentials.token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error(response.status>=500?pairingServerError:response.status===401?'Pair this device first.':`Pairing request failed (${response.status})`);
  return response.json();
 };
 const reset=()=>{clearTimeout(timer);qr.replaceChildren();short.textContent='';countdown.textContent='';renew.hidden=true;devices.hidden=true;};
 const burn=async id=>{await request('pair/start','DELETE',{id});};
 const showClaim=result=>{reset();modal.hidden=false;status.textContent='New device paired: '+result.name;devices.hidden=false;current=null;};
 const finish=async id=>{
  const pending=pendingStatus;await burn(id);
  const previous=await pending?.catch(()=>null);
  try{const result=await request('pair/status?id='+encodeURIComponent(id));return result.claimed?result:previous;}catch(error){if(previous?.claimed)return previous;throw error;}
 };
 const tick=async version=>{
  if(version!==generation||modal.hidden||!current)return;
  const seconds=Math.max(0,Math.ceil((current.expiresAt-now())/1000));countdown.textContent=`${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;
  timer=setTimeout(()=>tick(version),250);
  if(!seconds){const id=current.id,finalVersion=++generation;reset();status.textContent='Code expired';renew.hidden=false;try{const result=await finish(id);if(finalVersion===generation){if(result?.claimed)showClaim(result);else current=null;}}catch(error){if(finalVersion===generation)status.textContent='Code expired. '+error.message;}return;}
  if(polling)return;
  try {
   if(now()>=nextPollAt){polling=true;pendingStatus=request('pair/status?id='+encodeURIComponent(current.id));const result=await pendingStatus;if(version!==generation||!current)return;polling=false;if(result.claimed){showClaim(result);return;}nextPollAt=now()+2500;}
  }catch(error){if(version!==generation||!current)return;polling=false;nextPollAt=now()+2500;status.textContent=error.message;}
 };
 const open=async()=>{
  if(!modal.hidden)return;
  modal.hidden=false;cancel.focus();await start();
 };
 const start=async()=>{
  const version=++generation;reset();status.textContent='Loading pairing code\u2026';
  try{
   credentials=await settings();if(!credentials.url||!credentials.token)throw Error('Pair this device first.');
   const result=await request('pair/start','POST');
   if(version!==generation){try{await burn(result.id);}catch(error){current=result;modal.hidden=false;status.textContent='Could not cancel pairing code. '+error.message;cancel.focus();}return;}
   current=result;polling=false;pendingStatus=null;nextPollAt=now()+2500;qr.append(renderQR(document,new URL('/pair',credentials.url).href+'#'+result.code));short.textContent=result.short.slice(0,3)+' '+result.short.slice(3);status.textContent='Scan this QR or enter the code on your other device.';tick(version);
  }catch(error){if(version===generation){reset();status.textContent=error.message;renew.hidden=error.message==='Pair this device first.';}}
 };
 const close=async()=>{
  const version=++generation;reset();const id=current?.id;
  if(id)try{const result=await finish(id);if(version!==generation)return;if(result?.claimed){showClaim(result);return;}}catch(error){if(version===generation){status.textContent=error.message;renew.hidden=false;}return;}
  if(version===generation){current=null;modal.hidden=true;onClose();}
 };
 cancel.onclick=close;renew.onclick=start;modal.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
 devices.onclick=async()=>{try{const result=await request('devices');status.textContent='Devices';qr.replaceChildren();for(const device of result.devices.filter(device=>!device.revoked_at)){const row=document.createElement('p');row.textContent=device.name+' ('+device.platform+')';qr.append(row);}}catch(error){status.textContent=error.message;}};
 return {open,close,modal};
}
function receivePairingLink({document,parent,location,window,fetch,saveSettings,onPaired,onClose=()=>{},manual=false,url='https://photoswiper-sync.sidlakkoju.workers.dev'}) {
 const match=location.hash?.match(/^#pswipe-pair=([A-Za-z0-9_-]{22})(?:&origin=([^&]+))?$/);if(!match&&!manual)return;
 if(match)window.history.replaceState(null,'',location.pathname+location.search);
 const panel=document.createElement('section'),name=document.createElement('input'),button=document.createElement('button'),status=document.createElement('p'),shortCode=document.createElement('input'),origin=document.createElement('input'),cancel=document.createElement('button');
 panel.className='pairing-receiver settings-sheet';
 const title=document.createElement('h2');title.textContent='Pair this device';panel.append(title);
 const field=(input,id,text,parent=panel)=>{const label=document.createElement('label');label.textContent=text;label.setAttribute('for',id);input.setAttribute('id',id);parent.append(label,input);};
 name.value=/iPhone/.test(window.navigator?.userAgent||'')?'iPhone (Safari)':'New browser';field(name,'pairing-device-name','Device name');
 if(manual){
  field(shortCode,'pairing-short-code','6-digit code from a paired device');shortCode.setAttribute('inputmode','numeric');shortCode.setAttribute('pattern','[0-9]{6}');shortCode.setAttribute('autocomplete','one-time-code');shortCode.oninput=()=>{shortCode.value=shortCode.value.replace(/[^0-9]/g,'').slice(0,6);};
  const hint=document.createElement('p');hint.setAttribute('id','pairing-code-hint');hint.textContent="Get a code from Settings > Sync on a device that's already paired";shortCode.setAttribute('aria-describedby','pairing-code-hint');panel.append(hint);
  const advanced=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Advanced';advanced.open=false;advanced.append(summary);origin.type='url';origin.value=url;field(origin,'pairing-server','Sync server',advanced);panel.append(advanced);
 }
 const actions=document.createElement('div');actions.className='toolbar';button.textContent='Pair this device';cancel.textContent='Cancel';actions.append(button,cancel);status.setAttribute('role','status');panel.append(actions,status);
 cancel.onclick=()=>{panel.hidden=true;onClose();};panel.onkeydown=event=>{if(event.key==='Escape')cancel.onclick();};panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Pair this device');parent.append(panel);(manual?shortCode:name).focus();
 button.onclick=async()=>{button.disabled=true;try{const worker=new URL(match?.[2]?decodeURIComponent(match[2]):manual?origin.value:url);if(worker.protocol!=='https:'||worker.username||worker.password)throw Error('Enter a valid HTTPS Worker origin.');const claimedURL=worker.origin;const response=await fetch(claimedURL+'/api/pair/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...(match?{code:match[1]}:{short:shortCode.value.replace(/\s/g,'')}),name:name.value,platform:window.navigator?.platform||'browser'}),credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error(response.status>=500?pairingServerError:'Code expired or unavailable. Ask the paired device for a new code.');const result=await response.json();await saveSettings({url:claimedURL,token:result.token,onboardingDismissed:true});panel.hidden=true;onClose();await onPaired();}catch(error){status.textContent=error.message;button.disabled=false;}};
 return panel;
}

function reviewPreviewWindow(items,current,compact=false) {
 const index=items.findIndex(item=>item.mediaKey===current?.mediaKey),ahead=index<0?[]:items.slice(index+1);
 return [...(current?[current]:[]),...ahead.filter(item=>item.type!=='video').slice(0,compact?2:3),...ahead.filter(item=>item.type==='video').slice(0,compact?1:2)];
}
const reviewURLStale = (item,now=Date.now()) => !item.urlFetchedAt||now-item.urlFetchedAt>=40*60*1000;
function createReviewPreloader({createImage,createVideo,videoURL,previewURL,playbackURL}) {
 const entries=new Map();
 const active=entry=>entries.get(entry.key)===entry;
 function dispose(entry){
  entry.image?.removeAttribute('src');
  if(entry.video){entry.video.pause();entry.video.removeAttribute('src');entry.video.removeAttribute('poster');entry.video.load();}
 }
 function update(items,current,{width,height,compact=false}={}) {
  const windowItems=reviewPreviewWindow(items,current,compact),ahead=windowItems.filter(item=>item.mediaKey!==current?.mediaKey);
  const photos=ahead.filter(item=>item.type!=='video'),videos=ahead.filter(item=>item.type==='video');
  const wanted=new Map();
  for(const item of [...(current?[current]:[]),...photos,...videos]){
   try{const url=previewURL(item.thumbUrl,{width,height});wanted.set(item.mediaKey,{item,url});}catch{}
  }
  for(const [key,entry] of entries)if(wanted.get(key)?.url!==entry.preview){entries.delete(key);dispose(entry);}
  for(const {item,url} of [...photos,...videos].map(item=>wanted.get(item.mediaKey)).filter(Boolean)){
   if(entries.has(item.mediaKey))continue;
   const entry={key:item.mediaKey,preview:url};entries.set(entry.key,entry);
   Promise.resolve().then(async()=>{
    if(!active(entry))return;
    const image=createImage();entry.image=image;image.src=url;
    const decoded=image.decode();
    const warming=item.type==='video'?(entry.request=(async()=>{
     const result=await videoURL(item.mediaKey);
     if(!active(entry))return;
     const source=playbackURL(result.url),video=createVideo();entry.video=video;entry.source=source;
     video.preload='metadata';video.muted=true;video.poster=url;video.src=source;video.load();
     video.onerror=()=>{if(active(entry)){entries.delete(entry.key);dispose(entry);}};
     return source;
    })()):Promise.resolve();
    await Promise.all([decoded,warming]);
   }).catch(()=>{if(active(entry)){entries.delete(entry.key);dispose(entry);}});
  }
 }
 return {update,videoSource:key=>entries.get(key)?.source||entries.get(key)?.request,clear(){for(const entry of entries.values())dispose(entry);entries.clear();}};
}

function previewURL(value,{width=512,height=512,dpr=1,mobile=false,expanded=false,authuser='0',video=false}={}) {
 const url=new URL(value);
 if(url.protocol!=='https:'||!(url.hostname==='photos.fife.usercontent.google.com'||url.hostname.endsWith('.googleusercontent.com'))||url.username||url.password||url.port)throw Error('Unexpected preview host.');
 if(!video){
  const ratio=Math.min(dpr||1,2),pixels=Math.ceil(Math.max(width,height)*ratio);
  const bucket=[512,768,1024,1600].find(size=>size>=pixels)||1600;
  const size=mobile?Math.min(bucket,1024):bucket;
  url.pathname=url.pathname.replace(/=.+$/,'')+(expanded?`=w${Math.min(Math.ceil(width*ratio),mobile?1024:Infinity)}-h${Math.min(Math.ceil(height*ratio),mobile?1024:Infinity)}-k-no`:`=w${size}-h${size}-k-no`);
  url.searchParams.set('authuser',authuser);
 }
 return url.href;
}
function createPreloadBuffer({load,concurrency=2,size=3}) {
 const entries=new Map();let active=0,generation=0;
 function pump(){
  for(const entry of entries.values()){
   if(active>=concurrency)break;
   if(entry.state!=='queued')continue;
   entry.state='loading';active++;
   Promise.resolve().then(()=>load(entry.item,entry.controller.signal)).then(el=>{
    if(entries.get(entry.key)===entry&&entry.generation===generation&&!entry.controller.signal.aborted){entry.el=el;entry.state='ready';}
   },()=>{entry.state='failed';}).finally(()=>{active--;pump();});
  }
 }
 function update(items,previous){
  const wanted=items.slice(0,size),keys=new Set(wanted.map(item=>item.mediaKey));
  if(previous)keys.add(previous);
  for(const [key,entry] of entries)if(!keys.has(key)){entry.controller.abort();if(entry.el)entry.el.src='';entries.delete(key);}
  for(const item of wanted)if(!entries.has(item.mediaKey)||entries.get(item.mediaKey).state==='failed')entries.set(item.mediaKey,{key:item.mediaKey,item,state:'queued',controller:new AbortController(),generation});
  pump();
 }
 function clear(){generation++;for(const entry of entries.values()){entry.controller.abort();if(entry.el)entry.el.src='';}entries.clear();}
 return {update,clear,retain(item,el){const existing=entries.get(item.mediaKey);if(existing?.el!==el)existing?.controller.abort();entries.set(item.mediaKey,{key:item.mediaKey,item,el,state:'ready',controller:new AbortController(),generation});},get:key=>entries.get(key)?.state==='ready'?entries.get(key).el:null,take(key){const entry=entries.get(key);if(entry?.state!=='ready')return null;entries.delete(key);return entry.el;},entries};
}
function createWriteQueue({write,snapshot,committed,error=()=>{}}) {
 let pending=false,running=null;
 function flush(){
  if(running)return running;
  if(!pending)return Promise.resolve();
  running=Promise.resolve().then(async()=>{
   while(pending){
    pending=false;
    try{const value=snapshot();const started=Date.now();const saved=await write(value);committed(saved,value,Date.now()-started);}
    catch(failure){pending=true;error(failure);break;}
   }
  }).finally(()=>{running=null;});
  return running;
 }
 return {enqueue(){pending=true;return flush();},flush,get flushing(){return !!running;},get pending(){return pending;}};
}

function mountPhotosSwipe(environment) {
 const {window,document,location}=environment;
 if(window.top!==window||location.origin!=='https://photos.google.com'||document.getElementById('photos-swipe-userscript-host'))return;
 const rawCall=environment.photosCall||createPhotosAPI(environment),owner=environment.crypto.randomUUID();
 const host=document.createElement('div');host.id='photos-swipe-userscript-host';
 host.style.cssText='position:fixed;inset:0;z-index:2147483647;pointer-events:none';
 const root=host.attachShadow({mode:'open'});
 const styleElement1=document.createElement('style');
 root.append(styleElement1);
 styleElement1.append(document.createTextNode(":host{all:initial;--ps-bg:#F2F2F7;--ps-surface:rgba(255,255,255,.72);--ps-surface-solid:#FFF;--ps-fill:rgba(120,120,128,.12);--ps-label:#000;--ps-label2:rgba(60,60,67,.6);--ps-sep:rgba(60,60,67,.18);--ps-accent:#007AFF;--ps-destructive:#FF3B30;--ps-on-action:#FFF;--ps-shadow-color:rgba(0,0,0,.12);--ps-r-sm:10px;--ps-r-md:16px;--ps-r-lg:24px;--ps-r-pill:999px;--ps-s1:4px;--ps-s2:8px;--ps-s3:12px;--ps-s4:16px;--ps-s5:24px;--ps-s6:32px;--ps-font:-apple-system,BlinkMacSystemFont,\"SF Pro Text\",system-ui,Inter,sans-serif;--ps-t-large:600 28px/34px var(--ps-font);--ps-t-title:600 20px/25px var(--ps-font);--ps-t-body:400 17px/22px var(--ps-font);--ps-t-callout:500 15px/20px var(--ps-font);--ps-t-caption:400 12px/16px var(--ps-font);font:var(--ps-t-body);color:var(--ps-label);color-scheme:light}@media(prefers-color-scheme:dark){:host{--ps-bg:#000;--ps-surface:rgba(28,28,30,.72);--ps-surface-solid:#1C1C1E;--ps-fill:rgba(120,120,128,.24);--ps-label:#FFF;--ps-label2:rgba(235,235,245,.6);--ps-sep:rgba(84,84,88,.6);--ps-accent:#0A84FF;--ps-destructive:#FF453A;--ps-shadow-color:rgba(0,0,0,.5);color-scheme:dark}}*{box-sizing:border-box}button,select,input{font:var(--ps-t-callout);appearance:none;-webkit-appearance:none;color:var(--ps-label);background:var(--ps-surface-solid);border:1px solid var(--ps-sep);border-radius:var(--ps-r-sm);padding:var(--ps-s2) var(--ps-s3);accent-color:var(--ps-accent)}button,a,select{touch-action:manipulation}button{min-height:44px;border:0;background:var(--ps-fill);padding:10px 16px;cursor:pointer}button:disabled{opacity:.5;cursor:wait}button:focus-visible,a:focus-visible,select:focus-visible,input:focus-visible{outline:3px solid var(--ps-accent);outline-offset:2px}a{color:var(--ps-accent)}p{margin:8px 0;overflow-wrap:anywhere}[hidden]{display:none!important}.launcher{pointer-events:auto;position:absolute;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));background:var(--ps-accent);color:var(--ps-on-action);box-shadow:0 3px 20px var(--ps-shadow-color)}.overlay{pointer-events:auto;position:absolute;inset:0;background:var(--ps-bg);overflow:auto;overscroll-behavior:contain;padding:calc(12px + env(safe-area-inset-top)) 12px calc(18px + env(safe-area-inset-bottom))}.content{max-width:850px;margin:auto}header,.actions,.toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}header{justify-content:space-between}h1{font:var(--ps-t-large);margin:0}.account{font:var(--ps-t-caption);color:var(--ps-label2)}.card{touch-action:none;user-select:none;-webkit-user-select:none;-webkit-user-drag:none;-webkit-touch-callout:none;margin-top:12px;background:var(--ps-surface-solid);border-radius:var(--ps-r-lg);position:relative}.media{touch-action:none;height:48vh;height:48dvh;min-height:180px;display:flex;align-items:center;justify-content:center;overflow:auto}.media[aria-busy=true]{background:var(--ps-surface-solid)}.media[aria-busy=true]::after{content:'Loading\u2026';position:absolute;color:var(--ps-label);background:var(--ps-surface);padding:8px;border-radius:8px}.media img,.media video{display:block;max-width:100%;max-height:100%;object-fit:contain}.media img{pointer-events:none;-webkit-user-drag:none}.card.zoomed,.card.zoomed .media{touch-action:pan-x pan-y pinch-zoom}.card.zoomed .media img{pointer-events:auto}.card.expanded .media img{pointer-events:auto}.card.expanded .media{height:72vh;height:72dvh}.caption{padding:10px 14px}.swipe{color:var(--ps-label2);text-align:center;padding:12px;touch-action:none;background:var(--ps-fill)}.actions{justify-content:center;margin:12px 0}.stats{padding:12px;background:var(--ps-fill);border-radius:var(--ps-r-sm);margin:12px 0}.toolbar{margin:10px 0}select{max-width:100%;min-height:44px}details{margin:16px 0}#sync-local{display:block}#sync-settings>label{display:block;width:100%;margin:12px 0}#sync-settings>label>input{display:block;width:100%;min-width:0;margin-top:4px}.queue{display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px}.queue button{padding:6px;overflow:hidden}.queue img{width:100%;height:75px;object-fit:cover}.queue span{display:block;font:var(--ps-t-caption);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.status{min-height:24px}.zoom-control,.trash-toggle{display:flex;align-items:center;gap:8px;white-space:nowrap}#zoom{width:120px;min-width:0;min-height:44px}#history-list li{overflow-wrap:anywhere}#undo-preview{font-size:13px;min-width:0;flex-basis:100%} @media(max-width:599px){.overlay{scrollbar-gutter:stable;padding-right:18px}.actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.actions button{padding:8px}#undo-preview{grid-column:1 / -1;grid-row:2;margin:0}.zoom-control{grid-column:span 2}.zoom-control input{flex:1}.library-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.library-controls>*{width:100%;min-width:0}.album-controls{position:relative;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;padding:8px 0 calc(8px + env(safe-area-inset-bottom));margin-bottom:0}.album-controls button{padding:8px;font-size:14px;min-width:0;white-space:normal;overflow-wrap:anywhere}.album-controls a,.album-explanation{grid-column:1 / -1;min-width:0}.album-explanation{margin:0;font-size:13px}.trash-toggle{min-height:44px;font-size:14px;white-space:normal;min-width:0}.trash-toggle input{flex-shrink:0}.media{height:32vh;height:32dvh}.stats{font-size:14px;padding:8px}} @media(min-width:800px){.media{height:55vh}.overlay{padding:24px}}h2{font:var(--ps-t-title)}.status,#sync-status,.album-explanation{color:var(--ps-label2)}select{padding-right:var(--ps-s6);background-image:linear-gradient(45deg,transparent 50%,var(--ps-label2) 50%),linear-gradient(135deg,var(--ps-label2) 50%,transparent 50%);background-position:calc(100% - 15px) 50%,calc(100% - 10px) 50%;background-size:5px 5px;background-repeat:no-repeat}input[type=checkbox]{width:22px;height:22px;min-width:22px;padding:0;display:grid;place-content:center}input[type=checkbox]:checked{background:var(--ps-accent);border-color:var(--ps-accent)}input[type=checkbox]:checked::before{content:'\u2713';color:var(--ps-on-action)}input[type=range]{padding:0;background:transparent;border:0}input[type=range]::-webkit-slider-runnable-track{height:4px;background:var(--ps-fill);border-radius:var(--ps-r-pill)}input[type=range]::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:22px;height:22px;margin-top:-9px;border:0;border-radius:var(--ps-r-pill);background:var(--ps-accent)}input[type=range]::-moz-range-track{height:4px;background:var(--ps-fill);border-radius:var(--ps-r-pill)}input[type=range]::-moz-range-thumb{width:22px;height:22px;border:0;border-radius:var(--ps-r-pill);background:var(--ps-accent)}.keep,.remove{background:var(--ps-surface-solid)}.keep{color:var(--ps-accent)}.remove{color:var(--ps-destructive)}#move-trash{background:var(--ps-destructive);color:var(--ps-on-action)}.album-controls,#sync-settings{background:var(--ps-surface-solid);border-radius:var(--ps-r-md)}#sync-settings{padding:var(--ps-s3)}@supports ((backdrop-filter:blur(20px)) or (-webkit-backdrop-filter:blur(20px))){.album-controls,#sync-settings{background:var(--ps-surface);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}}"));
 const launcherElement=document.createElement('button');
 launcherElement.setAttribute("class","launcher");
 launcherElement.setAttribute("id","launcher");
 root.append(launcherElement);
 launcherElement.append(document.createTextNode("Photos Swipe"));
 const overlayElement=document.createElement('section');
 overlayElement.setAttribute("class","overlay");
 overlayElement.setAttribute("id","overlay");
 overlayElement.hidden=true;
 overlayElement.setAttribute("role","dialog");
 overlayElement.setAttribute("aria-modal","true");
 overlayElement.setAttribute("aria-label","Photos Swipe");
 root.append(overlayElement);
 const divElement4=document.createElement('div');
 divElement4.setAttribute("class","content");
 overlayElement.append(divElement4);
 const headerElement5=document.createElement('header');
 divElement4.append(headerElement5);
 const h1Element6=document.createElement('h1');
 headerElement5.append(h1Element6);
 h1Element6.append(document.createTextNode("Photos Swipe"));
 const versionElement=document.createElement('span');
 versionElement.setAttribute('id','running-version');
 versionElement.setAttribute('class','version-label');
 versionElement.textContent=`v${environment.version}`;
 h1Element6.append(document.createTextNode(' '),versionElement);
 const closeElement=document.createElement('button');
 closeElement.setAttribute("id","close");
 headerElement5.append(closeElement);
 closeElement.append(document.createTextNode("Close"));
 const accountElement=document.createElement('p');
 accountElement.setAttribute("class","account");
 accountElement.setAttribute("id","account");
 divElement4.append(accountElement);
 const cardElement=document.createElement('div');
 cardElement.setAttribute("class","card");
 cardElement.setAttribute("id","card");
 divElement4.append(cardElement);
 const mediaElement=document.createElement('div');
 mediaElement.setAttribute("class","media");
 mediaElement.setAttribute("id","media");
 const topCard=document.createElement('div');topCard.setAttribute('class','top-card');cardElement.append(topCard);topCard.append(mediaElement);
 const underCard=document.createElement('div');underCard.setAttribute('id','next-card');underCard.setAttribute('class','media under-card');underCard.setAttribute('aria-hidden','true');underCard.hidden=true;
 cardElement.insertBefore(underCard,topCard);
 const stamps=['KEEP','REMOVE'].map(label=>{const stamp=document.createElement('span');stamp.setAttribute('class',`swipe-stamp stamp-${label.toLowerCase()}`);stamp.textContent=label;stamp.setAttribute('aria-hidden','true');topCard.append(stamp);return stamp;});
 const feedbackStyles=document.createElement('style');feedbackStyles.textContent='.card{overflow:hidden}.top-card{position:relative;z-index:1;background:var(--ps-surface-solid)}.media{position:relative;z-index:1;background:var(--ps-surface-solid);border-radius:var(--ps-r-lg);-webkit-user-select:none;-webkit-touch-callout:none}.media .video-poster{width:100%;height:100%;min-width:0;min-height:0;object-fit:contain}.under-card{position:absolute;inset:0 0 auto;z-index:0;pointer-events:none;transform:scale(.94)}.swipe-stamp{position:absolute;top:24px;z-index:2;padding:8px 14px;border:4px solid currentColor;border-radius:8px;font-size:28px;font-weight:800;opacity:0;pointer-events:none}.stamp-keep{left:24px;color:var(--ps-accent);transform:rotate(-12deg)}.stamp-remove{right:24px;color:var(--ps-destructive);transform:rotate(12deg)}';root.append(feedbackStyles);
 const swipeElement=document.createElement('div');
 swipeElement.setAttribute("class","swipe");
 swipeElement.setAttribute("id","swipe");
 cardElement.append(swipeElement);
 swipeElement.append(document.createTextNode("Swipe left to queue \u00b7 right to keep \u00b7 Tap video to play/pause"));
 const captionElement=document.createElement('p');
 captionElement.setAttribute("class","caption");
 captionElement.setAttribute("id","caption");
 divElement4.append(captionElement);
 captionElement.append(document.createTextNode("Load a batch to start reviewing."));
 const divElement13=document.createElement('div');
 divElement13.setAttribute("class","actions");
 divElement4.append(divElement13);
 const removeElement=document.createElement('button');
 removeElement.setAttribute("class","remove");
 removeElement.setAttribute("id","remove");
 divElement13.append(removeElement);
 removeElement.append(document.createTextNode("\u00d7 Queue"));
 const undoElement=document.createElement('button');
 undoElement.setAttribute("id","undo");
 divElement13.append(undoElement);
 undoElement.append(document.createTextNode("Undo"));
 const keepElement=document.createElement('button');
 keepElement.setAttribute("class","keep");
 keepElement.setAttribute("id","keep");
 divElement13.append(keepElement);
 keepElement.append(document.createTextNode("\u2713 Keep"));
 const enlargeElement=document.createElement('button');
 enlargeElement.setAttribute("id","enlarge");
 divElement13.append(enlargeElement);
 enlargeElement.append(document.createTextNode("Enlarge"));
 const labelElement18=document.createElement('label');
 labelElement18.setAttribute('class','zoom-control');
 divElement13.append(labelElement18);
 labelElement18.append(document.createTextNode("Zoom "));
 const zoomElement=document.createElement('input');
 zoomElement.setAttribute("id","zoom");
 zoomElement.setAttribute("type","range");
 zoomElement.setAttribute("min","1");
 zoomElement.setAttribute("max","3");
 zoomElement.setAttribute("step","0.25");
 zoomElement.setAttribute("value","1");
 labelElement18.append(zoomElement);
 const statsElement=document.createElement('div');
 statsElement.setAttribute("class","stats");
 statsElement.setAttribute("id","stats");
 divElement4.append(statsElement);
 const divElement21=document.createElement('div');
 divElement21.setAttribute("class","toolbar library-controls");
 divElement4.append(divElement21);
 const loadElement=document.createElement('button');
 loadElement.setAttribute("id","load");
 divElement21.append(loadElement);
 loadElement.append(document.createTextNode("Load 50 more"));
 const refreshElement=document.createElement('button');
 refreshElement.setAttribute("id","refresh");
 divElement21.append(refreshElement);
 refreshElement.append(document.createTextNode("Refresh latest"));
 const filterElement=document.createElement('select');
 filterElement.setAttribute("id","filter");
 filterElement.setAttribute("aria-label","Media filter");
 divElement21.append(filterElement);
 const optionElement25=document.createElement('option');
 optionElement25.setAttribute("value","all");
 filterElement.append(optionElement25);
 optionElement25.append(document.createTextNode("All media"));
 const optionElement26=document.createElement('option');
 optionElement26.setAttribute("value","photo");
 filterElement.append(optionElement26);
 optionElement26.append(document.createTextNode("Photos"));
 const optionElement27=document.createElement('option');
 optionElement27.setAttribute("value","video");
 filterElement.append(optionElement27);
 optionElement27.append(document.createTextNode("Videos"));
 const sortElement=document.createElement('select');
 sortElement.setAttribute("id","sort");
 sortElement.setAttribute("aria-label","Review order");
 divElement21.append(sortElement);
 const optionElement29=document.createElement('option');
 optionElement29.setAttribute("value","original");
 sortElement.append(optionElement29);
 optionElement29.append(document.createTextNode("Library order"));
 const optionElement30=document.createElement('option');
 optionElement30.setAttribute("value","oldest");
 sortElement.append(optionElement30);
 optionElement30.append(document.createTextNode("Oldest first"));
 const optionElement31=document.createElement('option');
 optionElement31.setAttribute("value","largest");
 sortElement.append(optionElement31);
 optionElement31.append(document.createTextNode("Largest first"));
 const statusElement=document.createElement('p');
 statusElement.setAttribute("role","status");
 statusElement.setAttribute("aria-live","polite");
 statusElement.setAttribute("class","status");
 statusElement.setAttribute("id","status");
 divElement4.append(statusElement);
 const queue_detailsElement=document.createElement('details');
 queue_detailsElement.setAttribute("id","queue-details");
 divElement4.append(queue_detailsElement);
 const queue_titleElement=document.createElement('summary');
 queue_titleElement.setAttribute("id","queue-title");
 queue_detailsElement.append(queue_titleElement);
 queue_titleElement.append(document.createTextNode("Removal queue"));
 const queueElement=document.createElement('div');
 queueElement.setAttribute("class","queue");
 queueElement.setAttribute("id","queue");
 queue_detailsElement.append(queueElement);
 const divElement36=document.createElement('div');
 divElement36.setAttribute("class","toolbar album-controls");
 const sendElement=document.createElement('button');
 sendElement.setAttribute("id","send");
 divElement36.append(sendElement);
 sendElement.append(document.createTextNode("Send to review album"));
 const trashElement=document.createElement('button');
 trashElement.setAttribute("id","trash");
 divElement36.append(trashElement);
 trashElement.append(document.createTextNode("Check deleted items"));
 const albumElement=document.createElement('a');
 albumElement.setAttribute("id","album");
 albumElement.setAttribute("target","_blank");
 albumElement.setAttribute("rel","noopener");
 albumElement.hidden=true;
 divElement36.append(albumElement);
 albumElement.append(document.createTextNode("Open review album \u2197"));
 const pElement40=document.createElement('p');
 pElement40.setAttribute('class','album-explanation');
 divElement36.append(pElement40);
 pElement40.append(document.createTextNode("Swipes never delete media. Send candidates to a review album, or explicitly enable Move to Trash."));
 const trashOptIn=document.createElement('input');trashOptIn.setAttribute('id','trash-opt-in');trashOptIn.type='checkbox';
 const trashLabel=document.createElement('label');trashLabel.setAttribute('class','trash-toggle');trashLabel.append(trashOptIn,document.createTextNode('Enable Move to Trash'));
 const moveTrash=document.createElement('button');moveTrash.setAttribute('id','move-trash');moveTrash.hidden=true;
 const trashCandidates=document.createElement('section');trashCandidates.setAttribute('id','trash-candidates');trashCandidates.hidden=true;
 const trashTitle=document.createElement('h2');trashTitle.setAttribute('id','trash-candidates-title');
 const trashExplanation=document.createElement('p');trashExplanation.textContent='These exact items will move to Trash, including candidates already sent to the review album. Select a thumbnail to inspect it or choose Keep instead.';
 const trashList=document.createElement('div');trashList.setAttribute('id','trash-candidates-list');trashList.setAttribute('class','queue');
 trashCandidates.append(trashTitle,trashExplanation,trashList);
 divElement4.append(trashCandidates);
 divElement4.append(divElement36);
 divElement36.append(trashLabel,moveTrash);
 const settingsPanel=document.createElement('details');settingsPanel.setAttribute('id','sync-settings');const settingsTitle=document.createElement('summary');settingsTitle.textContent='Sync settings';settingsPanel.append(settingsTitle);
 const syncExplanation=document.createElement('p');syncExplanation.textContent='Optional sync shares decisions and undo history between devices. Enter your Worker URL and token, or continue locally on this browser.';settingsPanel.append(syncExplanation);
 const onboarding=document.createElement('section');onboarding.setAttribute('id','pair-onboarding');onboarding.hidden=true;
 const onboardingTitle=document.createElement('h2');onboardingTitle.textContent='Pair this device';
 const onboardingText=document.createElement('p');onboardingText.textContent='Open Photos Swipe on a paired device (e.g. your Mac), choose Pair a device, then scan the QR or enter the 6-digit code here';
 const onboardPair=document.createElement('button');onboardPair.textContent='Pair this device';onboardPair.onclick=()=>receivePairing(true);onboarding.append(onboardingTitle,onboardingText,onboardPair);divElement4.insertBefore(onboarding,cardElement);
 const syncLocal=document.createElement('button');syncLocal.setAttribute('id','sync-local');syncLocal.textContent='Continue locally';onboarding.append(syncLocal);
 for(const [id,title,type] of [['sync-url','Sync URL','url'],['sync-token','Sync token','password']]){const label=document.createElement('label'),input=document.createElement('input');label.textContent=title+' ';input.setAttribute('id',id);input.type=type;input.autocomplete='off';label.append(input);settingsPanel.append(label);}
 const syncSave=document.createElement('button');syncSave.setAttribute('id','sync-save');syncSave.textContent='Save and sync';settingsPanel.append(syncSave);
 const pairAnother=document.createElement('button');pairAnother.textContent='Pair a device';pairAnother.setAttribute('id','pair-another');settingsPanel.append(pairAnother);
 let viewerShortcutsBlockedUntil=0;
 const suppressViewerShortcuts=()=>{viewerShortcutsBlockedUntil=Date.now()+500;};
 const pairingModal=createPairingModal({document,parent:divElement4,fetch:environment.syncFetch||environment.fetch,settings:async()=>(await pairingPromise).settings(),onClose:suppressViewerShortcuts,setTimeout:environment.setTimeout,clearTimeout:environment.clearTimeout});pairAnother.onclick=pairingModal.open;
 const syncStatus=document.createElement('p');syncStatus.setAttribute('id','sync-status');syncStatus.setAttribute('role','status');divElement4.insertBefore(settingsPanel,cardElement);divElement4.insertBefore(syncStatus,cardElement);
 const unpairedBanner=document.createElement('div');unpairedBanner.setAttribute('id','unpaired-banner');unpairedBanner.setAttribute('role','alert');unpairedBanner.hidden=true;
 const unpairedText=document.createElement('span');unpairedText.textContent='This device was unpaired.';
 const pairAgain=document.createElement('button');pairAgain.setAttribute('id','pair-again');pairAgain.textContent='Pair again';
 const dismissUnpaired=document.createElement('button');dismissUnpaired.setAttribute('id','dismiss-unpaired');dismissUnpaired.textContent='Dismiss';unpairedBanner.append(unpairedText,pairAgain,dismissUnpaired);divElement4.insertBefore(unpairedBanner,cardElement);
 const pairingPanel=document.createElement('details');pairingPanel.setAttribute('id','enter-pairing-code');const pairingTitle=document.createElement('summary');pairingTitle.textContent='Enter pairing code';pairingPanel.append(pairingTitle);
 for(const [id,title] of [['pair-code','Pairing code'],['pair-name','Device name']]){const label=document.createElement('label'),input=document.createElement('input');input.setAttribute('id',id);label.textContent=title;label.append(input);pairingPanel.append(label);}
 const pairSubmit=document.createElement('button');pairSubmit.setAttribute('id','pair-submit');pairSubmit.textContent='Pair and sync';pairingPanel.append(pairSubmit);const pairFeedback=document.createElement('p');pairFeedback.setAttribute('role','status');pairingPanel.append(pairFeedback);settingsPanel.append(pairingPanel);
 const devicesPanel=document.createElement('details');devicesPanel.setAttribute('id','paired-devices');const devicesTitle=document.createElement('summary');devicesTitle.textContent='Paired devices';
 const devicesList=document.createElement('div');devicesList.setAttribute('id','devices-list');const refreshDevices=document.createElement('button');refreshDevices.setAttribute('id','refresh-devices');refreshDevices.textContent='Refresh devices';
 const revokeOthers=document.createElement('button');revokeOthers.setAttribute('id','revoke-other-devices');revokeOthers.textContent='Revoke all other devices';devicesPanel.append(devicesTitle,refreshDevices,devicesList,revokeOthers);settingsPanel.append(devicesPanel);
 const pairedNotice=document.createElement('button');pairedNotice.setAttribute('id','paired-notice');pairedNotice.textContent='New device paired \u00b7 View paired devices';pairedNotice.hidden=true;divElement4.insertBefore(pairedNotice,cardElement);
 const historyPanel=document.createElement('details');historyPanel.setAttribute('id','history-details');
 const historyTitle=document.createElement('summary');historyTitle.textContent='Decision history';
 const undoPreview=document.createElement('p');undoPreview.setAttribute('id','undo-preview');
 const historyList=document.createElement('ol');historyList.setAttribute('id','history-list');
 historyPanel.append(historyTitle,historyList);divElement13.insertBefore(undoPreview,enlargeElement);divElement4.insertBefore(historyPanel,queue_detailsElement);
 const shellStyle=document.createElement('style');shellStyle.textContent='.overlay{scrollbar-gutter:auto;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);padding:24px}.content{display:flex;flex-direction:column;position:relative;width:540px;max-width:100%;max-height:calc(100dvh - 48px);overflow:auto;margin:0;background:var(--ps-bg);border-radius:28px;padding:20px}.content>*{flex-shrink:0}.content .card{display:flex;flex-direction:column;flex-shrink:1;min-height:0;overflow:hidden}.content .top-card{display:flex;flex-direction:column;flex:1 1 auto;min-height:0}.content .media{flex:1 1 auto;min-height:0}.content .caption{flex-shrink:0;margin:0;border-radius:0 0 var(--ps-r-lg) var(--ps-r-lg)}.content .under-card{max-height:100%;overflow:hidden}.content header{flex-wrap:nowrap}.content header button{flex-shrink:0}.content h1{flex-basis:100%;order:-1;font:var(--ps-t-title)}.content header{flex-wrap:wrap}.version-label{font:var(--ps-t-caption);color:var(--ps-label2)}.media{height:56dvh}.caption{position:relative;overflow-wrap:anywhere;background:var(--ps-surface-solid);pointer-events:none}.actions{display:flex}.actions #remove,.actions #keep{width:72px;height:72px;border-radius:50%;font-size:30px}.actions #undo,.actions #enlarge{border-radius:50%}.settings-sheet{position:absolute;inset:0;z-index:5;overflow:auto;padding:0 20px 20px;background:var(--ps-surface-solid);border-radius:28px}.settings-sheet .settings-header{position:sticky;top:0;z-index:1;flex-wrap:nowrap;margin:0 -20px;padding:20px;background:var(--ps-surface-solid)}.settings-header h2{margin:0}.settings-sheet .group{padding:12px;background:var(--ps-fill);border-radius:16px;margin:12px 0}.settings-sheet label{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:8px 0}.settings-sheet input{max-width:100%;min-width:0}.settings-sheet #sync-settings{margin:0}.settings-sheet #sync-settings label{display:block}.settings-sheet #sync-settings input{width:100%}.settings-sheet #stats{margin:0}.gear-error::after{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--ps-destructive)}#sync-status,#undo-preview,.swipe,.zoom-control{display:none}.counter{font:var(--ps-t-callout);border-radius:999px;background:var(--ps-fill);padding:8px;white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis}.status:empty{visibility:hidden}.status{position:relative;height:60px;min-height:60px;overflow:auto;margin:0;background:var(--ps-surface);border-radius:16px;padding:8px;text-align:center}.review-panel{padding:12px;background:var(--ps-surface-solid);border-radius:16px;margin-top:12px}@supports(backdrop-filter:blur(20px)){.settings-sheet{background:var(--ps-surface);backdrop-filter:blur(20px)}}@media(max-width:599px){.overlay{padding:0}.content{width:100%;max-height:100dvh;border-radius:0;padding:16px}.settings-sheet{border-radius:0}.content h1{position:absolute;width:1px;height:1px;overflow:hidden}.content header{flex-wrap:nowrap;gap:6px}.content header button{padding:10px 12px}.counter{font:var(--ps-t-caption)}.media{height:56dvh}.actions{display:flex}}';root.append(shellStyle);
 const pairingStyle=document.createElement('style');pairingStyle.textContent='.pairing-receiver{position:fixed;inset:0;z-index:6;overflow:auto;pointer-events:auto;background:var(--ps-bg);color:var(--ps-label);padding:var(--ps-s5);border-radius:0}.pairing-receiver label{display:block;margin:var(--ps-s3) 0 var(--ps-s1)}.pairing-receiver input{display:block;width:100%;min-width:0;min-height:44px}.pairing-receiver p{color:var(--ps-label2)}.pairing-receiver summary{cursor:pointer;min-height:44px;padding:var(--ps-s3) 0}.pairing-receiver .toolbar{margin-top:var(--ps-s4)}';root.append(pairingStyle);
 const gear=document.createElement('button');gear.setAttribute('id','settings');gear.textContent='\u2699';gear.setAttribute('aria-label','Settings');gear.setAttribute('aria-haspopup','dialog');headerElement5.insertBefore(gear,h1Element6);
 const counter=document.createElement('span');counter.setAttribute('class','counter');headerElement5.insertBefore(counter,closeElement);
 const reviewButton=document.createElement('button');reviewButton.setAttribute('id','review');reviewButton.setAttribute('aria-label','Review marked items');headerElement5.insertBefore(reviewButton,closeElement);
 closeElement.textContent='\u2715';closeElement.setAttribute('aria-label','Close Photos Swipe');
 const sheet=document.createElement('section');sheet.setAttribute('id','settings-sheet');sheet.setAttribute('class','settings-sheet');sheet.hidden=true;sheet.setAttribute('role','dialog');sheet.setAttribute('aria-label','Settings');
 const sheetHeader=document.createElement('header');sheetHeader.setAttribute('class','settings-header');sheet.append(sheetHeader);
 const sheetClose=document.createElement('button');sheetClose.textContent='Done';sheetClose.setAttribute('aria-label','Close settings');
 const sheetTitle=document.createElement('h2');sheetTitle.textContent='Settings';sheetHeader.append(sheetTitle,sheetClose);divElement4.append(sheet);
 const group=(title,...children)=>{const section=document.createElement('section');section.setAttribute('class','group');const heading=document.createElement('h2');heading.textContent=title;section.append(heading,...children);sheet.append(section);return section;};
 settingsTitle.textContent='Sync';settingsPanel.open=true;settingsPanel.insertBefore(accountElement,syncExplanation);settingsPanel.append(unpairedBanner,pairedNotice);group('Sync',settingsPanel);group('Show',filterElement);group('Order',sortElement);
 const reviewEvery=document.createElement('input');reviewEvery.setAttribute('id','review-every');reviewEvery.type='number';reviewEvery.min='1';reviewEvery.max='10000';reviewEvery.value='25';reviewEvery.setAttribute('aria-label','Review every N marked');reviewEvery.hidden=true;
 group('History',historyPanel);
 const deleteMethod=document.createElement('select');deleteMethod.setAttribute('id','delete-method');deleteMethod.setAttribute('aria-label','Delete method');for(const [value,label] of [['trash','Trash']]){const option=document.createElement('option');option.value=value;option.textContent=label;deleteMethod.append(option);}deleteMethod.hidden=true;const lifetime=document.createElement('p');lifetime.setAttribute('id','lifetime-freed');group('Lifetime freed',lifetime);statsElement.hidden=true;sheet.append(statsElement);group('Refresh',refreshElement,loadElement,trashElement);group('Previous transfer',sendElement,albumElement).hidden=true;
 const settingsVersion=document.createElement('p');settingsVersion.setAttribute('id','settings-version');settingsVersion.setAttribute('class','version-label');settingsVersion.textContent=`Photos Swipe v${environment.version}`;sheet.append(settingsVersion);
 const reviewPanel=document.createElement('section');reviewPanel.setAttribute('class','review-panel');reviewPanel.setAttribute('id','review-panel');reviewPanel.hidden=true;reviewPanel.append(queue_detailsElement,trashCandidates,divElement36);divElement4.append(reviewPanel);queue_detailsElement.open=true;trashLabel.hidden=true;trashOptIn.checked=true;pElement40.textContent='Review marked items before moving them to Google Photos Trash.';
 const openSettings=()=>{sheet.hidden=false;settingsPanel.open=true;gear.setAttribute('aria-expanded','true');sheetClose.focus();};const closeSettings=()=>{suppressViewerShortcuts();sheet.hidden=true;gear.setAttribute('aria-expanded','false');gear.focus();};gear.onclick=openSettings;sheetClose.onclick=closeSettings;
 const openReview=()=>{swipeFeedback.reset();const video=mediaElement.querySelector('video');if(video&&!video.paused){video.pause();resumeReviewPlayback=true;}reviewItems=reviewTrashCandidates(state).map(item=>({...item,legacy:!!item.queueSent}));previewKey=null;reviewPanel.hidden=false;reviewStatus.textContent='';reviewStatus.hidden=true;renderTrashReview();moveTrash.focus();};reviewButton.onclick=openReview;
 overlayElement.addEventListener('click',event=>{if(event.target===overlayElement){if(!pairingModal.modal.hidden)return pairingModal.close();if(activePairingDialog())return;return close();}});
 document.documentElement.append(host);
 const icon=(button,label,paths)=>{button.replaceChildren();button.setAttribute('aria-label',label);const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'2','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(key,value);for(const path of paths){const element=document.createElementNS('http://www.w3.org/2000/svg','path');element.setAttribute('d',path);svg.append(element);}button.append(svg);};
 icon(removeElement,'Mark for deletion',['M6 6l12 12M18 6L6 18']);icon(keepElement,'Keep',['M12 21s-10-6-10-12a5 5 0 0 1 10-3 5 5 0 0 1 10 3c0 6-10 12-10 12Z']);icon(undoElement,'Undo',['M9 14L4 9l5-5','M4 9h10.5a5.5 5.5 0 0 1 0 11H11']);icon(enlargeElement,'Fullscreen photo',['M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7']);icon(closeElement,'Close Photos Swipe',['M6 6l12 12M18 6L6 18']);icon(gear,'Settings',['M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2','M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0']);icon(reviewButton,'Going to Trash',['M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13']);
 const trashBadge=document.createElement('span');trashBadge.setAttribute('class','trash-badge');trashBadge.textContent='0';reviewButton.append(trashBadge);topCard.append(enlargeElement);
 const queuePill=document.createElement('div');queuePill.setAttribute('class','queue-pill');queuePill.hidden=true;const queueThumbs=document.createElement('span');queueThumbs.setAttribute('class','queue-thumbs');const queuePillText=document.createElement('span'),queueGrowth=document.createElement('span'),queueReview=document.createElement('button');queueGrowth.setAttribute('class','queue-growth');queueReview.textContent='Review';queueReview.onclick=openReview;queuePill.append(queueThumbs,queuePillText,queueGrowth,queueReview);divElement4.insertBefore(queuePill,divElement13);
 const redesignStyle=document.createElement('style');redesignStyle.textContent=`.overlay{padding:0}.content{width:440px;height:min(860px,90vh);max-height:90dvh;padding:8px 0 0;overflow:hidden;border-radius:24px}.content header{height:48px;flex:none;flex-wrap:nowrap;gap:8px;padding:0 12px}.content h1{position:absolute;width:1px;height:1px;overflow:hidden}.content header button{position:relative;width:36px;height:36px;min-height:36px;padding:8px;border-radius:50%;flex:none}.content svg{width:100%;height:100%}.counter{flex:1;text-align:center;background:none;padding:0;font-size:12px}.trash-badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 4px;border-radius:9px;background:var(--ps-accent);color:#fff;font:600 11px/18px var(--ps-font)}.content .card{flex:1;min-height:0;margin:4px 8px 0;border-radius:20px;background:var(--ps-surface-solid);overflow:hidden}.content .top-card{height:100%}.content .media,.content .card.expanded .media{height:100%;min-height:0;overflow:hidden;border-radius:20px}.content .media img,.content .media video{width:100%;height:100%;object-fit:contain}.content .caption{position:relative;flex:none;order:1;margin:0;padding:8px 14px;background:var(--ps-surface-solid);color:var(--ps-label);font-size:12px;overflow-wrap:anywhere}.content .actions{flex:none;display:flex;align-items:center;gap:28px;margin:0;padding:14px 0 calc(env(safe-area-inset-bottom) + 10px)}.actions #remove,.actions #keep{width:72px;height:72px;min-height:72px;padding:21px;box-shadow:0 10px 30px var(--ps-shadow-color)}.actions #remove{color:var(--ps-label);background:var(--ps-surface)}.actions #keep{background:var(--ps-accent);color:#fff}.actions #undo{width:48px;height:48px;min-height:48px;padding:13px;border-radius:50%;background:var(--ps-fill)}#undo:disabled{opacity:.3;cursor:default}.actions button,#enlarge{transition:transform .35s cubic-bezier(.34,1.56,.64,1)}.actions button:active:not(:disabled),#enlarge:active{transform:scale(.92)}#enlarge{position:absolute;top:12px;right:12px;z-index:3;width:36px;height:36px;min-height:36px;padding:9px;border-radius:50%;background:rgba(30,30,30,.35);color:#fff;border:.5px solid rgba(255,255,255,.25);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}.content .card.expanded{position:relative;inset:auto;z-index:4;margin:4px 0 0;border-radius:0}.content .card.expanded .caption{display:none}.content .status{position:relative;order:2;flex:none;height:24px;min-height:24px;margin:0 8px;padding:2px 6px;background:none;font-size:12px}.content .actions{order:4}.queue-pill{order:3}.trash-review-status{margin:0;padding:8px 16px;color:var(--ps-label2);font-size:13px}.content .status:empty{visibility:hidden}.queue-pill{flex:none;display:flex;gap:8px;align-items:center;align-self:center;max-width:calc(100% - 16px);margin-top:10px;padding:6px 10px;border-radius:999px;background:var(--ps-surface);backdrop-filter:blur(20px);font-size:12px}.queue-pill button{color:var(--ps-accent);background:none;padding:6px;min-height:32px}.queue-thumbs{display:flex;padding-left:8px}.queue-thumbs img{width:26px;height:30px;object-fit:cover;border:2px solid var(--ps-bg);border-radius:6px;margin-left:-8px;transform:rotate(-8deg)}.queue-growth{background:var(--ps-accent);color:#fff;border-radius:12px;padding:3px 5px}.review-panel{position:absolute;inset:0;z-index:7;margin:0;padding:0;border-radius:24px;background:var(--ps-bg);display:flex;flex-direction:column;overflow:hidden}.trash-nav{height:48px;flex:none;display:flex;justify-content:space-between;align-items:center;padding:0 12px}.trash-nav button{background:none;color:var(--ps-accent);padding:8px}.trash-scroll{flex:1;min-height:0;overflow:auto}.content .trash-heading{position:static;width:auto;height:auto;overflow:visible;flex-basis:auto;order:0;font:700 30px/36px var(--ps-font);padding:4px 16px 0;margin:0}.trash-size{padding:8px 16px 0;color:var(--ps-accent);font:800 44px/46px var(--ps-font)}.trash-size small{display:block;color:var(--ps-label2);font:600 13px/18px var(--ps-font);text-transform:uppercase;letter-spacing:.6px}.trash-subtitle{padding:2px 16px 12px;color:var(--ps-label2);font-size:15px}.trash-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:2px}.trash-tile{position:relative;aspect-ratio:1;min-width:0}.trash-photo{position:absolute;inset:0;width:100%;height:100%;padding:0;border-radius:0;background:var(--ps-fill)}.trash-photo img{width:100%;height:100%;object-fit:cover;display:block}.trash-tile.kept .trash-photo{opacity:.45}.trash-check{position:absolute;right:6px;bottom:6px;width:26px;height:26px;min-height:26px;padding:4px;border-radius:50%;border:2px solid #fff;background:var(--ps-accent);color:#fff}.trash-tile.kept .trash-check{background:rgba(0,0,0,.2)}.trash-tile.kept .trash-check svg{visibility:hidden}.trash-duration{position:absolute;left:6px;bottom:6px;color:#fff;font-size:12px;text-shadow:0 1px 2px #000;pointer-events:none}.trash-legacy{position:absolute;left:6px;top:6px;border-radius:6px;padding:2px 4px;background:rgba(0,0,0,.6);color:#fff;font-size:10px;pointer-events:none}.trash-help{padding:12px 16px;text-align:center;color:var(--ps-label2);font-size:13px}.trash-bar{flex:none;display:flex;gap:10px;padding:12px 16px calc(env(safe-area-inset-bottom) + 12px);background:var(--ps-surface);border-top:1px solid var(--ps-sep)}.trash-bar button{flex:1;height:50px;border-radius:14px;font-weight:600}.trash-bar #move-trash,.trash-bar .preview-trash{background:var(--ps-destructive);color:#fff}.trash-preview{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--ps-bg);z-index:1}.trash-preview-media{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;background:var(--ps-surface-solid)}.trash-preview-media img,.trash-preview-media video{width:100%;height:100%;object-fit:contain}.trash-preview-caption{text-align:center;font-size:15px;padding:10px 12px 0}.trash-preview-caption small{display:block;color:var(--ps-label2);font-size:12px}.trash-strip{display:flex;gap:3px;overflow:auto;padding:8px;flex:none}.trash-strip button{width:34px;height:34px;min-height:34px;padding:0;flex:none;border-radius:4px;opacity:.6}.trash-strip button.active{opacity:1;outline:2px solid var(--ps-accent)}.trash-strip img{width:100%;height:100%;object-fit:cover}.settings-sheet{z-index:8}@media(max-width:600px){.overlay{position:fixed;inset:0;height:100vh;height:100dvh;background:var(--ps-bg);backdrop-filter:none;-webkit-backdrop-filter:none;overflow:hidden}.content{width:100%;height:100vh;height:100dvh;max-height:none;border-radius:0;padding:env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left)}.review-panel{position:fixed;border-radius:0;padding-top:env(safe-area-inset-top)}.trash-preview{padding-top:env(safe-area-inset-top)}.settings-sheet{position:fixed;padding-top:0}.settings-sheet .settings-header{height:auto;padding-top:calc(env(safe-area-inset-top) + 20px)}}@media(prefers-reduced-motion:reduce){.actions button,#enlarge{transition:none}}`;root.append(redesignStyle);
 reviewPanel.replaceChildren();reviewPanel.setAttribute('role','dialog');reviewPanel.setAttribute('aria-label','Going to Trash');
 const reviewNav=document.createElement('div');reviewNav.setAttribute('class','trash-nav');const reviewBack=document.createElement('button'),selectAll=document.createElement('button');reviewBack.textContent='\u2039 Back';selectAll.textContent='Select All';reviewBack.onclick=()=>{reviewPanel.hidden=true;previewKey=null;renderTrashReview();reviewButton.focus();};reviewNav.append(reviewBack,selectAll);
 const reviewScroll=document.createElement('div');reviewScroll.setAttribute('class','trash-scroll');const reviewHeading=document.createElement('h1');reviewHeading.setAttribute('class','trash-heading');reviewHeading.textContent='Going to Trash';const reviewSubtitle=document.createElement('p');reviewSubtitle.setAttribute('class','trash-subtitle');reviewSubtitle.setAttribute('id','trash-review-subtitle');const reviewGrid=document.createElement('div');reviewGrid.setAttribute('class','trash-grid');reviewGrid.setAttribute('id','trash-review-grid');const reviewHelp=document.createElement('p');reviewHelp.setAttribute('class','trash-help');reviewHelp.textContent='Tap a photo to preview. Untick to keep it. Items stay in Google Photos Trash for 60 days.';const reviewSize=document.createElement('div');reviewSize.setAttribute('class','trash-size');const sizeLabel=document.createElement('small'),sizeValue=document.createElement('span');sizeLabel.textContent='Free up';reviewSize.append(sizeLabel,sizeValue);reviewScroll.append(reviewHeading,reviewSize,reviewSubtitle,reviewGrid,reviewHelp);
 const reviewBar=document.createElement('div');reviewBar.setAttribute('class','trash-bar');const reviewCancel=document.createElement('button');reviewCancel.textContent='Cancel';reviewCancel.onclick=reviewBack.onclick;const reviewStatus=document.createElement('p');reviewStatus.setAttribute('role','status');reviewStatus.setAttribute('class','trash-review-status');reviewStatus.hidden=true;moveTrash.hidden=false;reviewBar.append(reviewCancel,moveTrash);reviewPanel.append(reviewNav,reviewScroll,reviewStatus,reviewBar);
 const settingsReview=document.createElement('button');settingsReview.textContent='Going to Trash';settingsReview.onclick=()=>{closeSettings();openReview();};group('Going to Trash',settingsReview);sheet.append(settingsVersion);
 let reviewItems=[],previewKey=null,reviewSignature='',previewVideo=null,previewGeneration=0,pageLock=null,resumeReviewPlayback=false;
 function lockPage(){
  if(pageLock)return;
  const viewport=document.querySelector('meta[name="viewport"]'),created=!viewport,meta=viewport||document.createElement('meta');
  pageLock={html:document.documentElement.style.cssText,body:document.body.style.cssText,x:window.scrollX,y:window.scrollY,meta,content:meta.getAttribute('content'),created};
  if(created){meta.setAttribute('name','viewport');document.head.append(meta);}
  meta.setAttribute('content',`${(pageLock.content||'width=device-width, initial-scale=1').replace(/,?\s*viewport-fit\s*=\s*[^,\s]+/gi,'')}, viewport-fit=cover`);
  document.documentElement.style.overflow='hidden';document.documentElement.style.overscrollBehavior='none';Object.assign(document.body.style,{overflow:'hidden',overscrollBehavior:'none',position:'fixed',top:`-${pageLock.y}px`,left:`-${pageLock.x}px`,width:'100%'});
 }
 function unlockPage(){if(!pageLock)return;const saved=pageLock;pageLock=null;document.documentElement.style.cssText=saved.html;document.body.style.cssText=saved.body;if(saved.created)saved.meta.remove();else if(saved.content===null)saved.meta.removeAttribute('content');else saved.meta.setAttribute('content',saved.content);window.scrollTo(saved.x,saved.y);}
 const $=id=>root.getElementById(id);
 let resume={},resumeWrite=Promise.resolve(),videoSavedAt=0;
 let dbPromise,db,state=emptyReview(),identity,busy=false,inspected=null,focused=null,shown=null,generation=0,leaseError=null,leaseRecoveryPending=false,lockedAccount=null,syncEnabled=false,syncSummary='Sync off \u00b7 saved locally';
 const database=()=>dbPromise||(dbPromise=openReviewDatabase(environment.indexedDB).catch(error=>{dbPromise=null;throw error;}));
 const pairingNotice=document.createElement('p');settingsPanel.append(pairingNotice);
 const pairingPromise=createPairingStore({GM:environment.GM,database,crypto:environment.crypto}).then(async store=>{
  if(!store.durable)pairingNotice.textContent='Pairing may not persist in this browser';
  try{await store.settings();}catch(error){pairingNotice.textContent=`Pairing storage unavailable: ${error.message}`;}
  return store;
 });
 const clearCredentials=async()=>{const settings=await (await pairingPromise).settings();await (await pairingPromise).saveSettings({...settings,token:'',unpaired:true});$('sync-token').value='';syncEnabled=false;unpairedBanner.hidden=false;};
 const syncClient=createSyncClient({fetch:environment.syncFetch||environment.fetch,unpaired:clearCredentials,status:value=>{syncSummary=value;syncStatus.textContent=value;const failed=/saved locally; retry|unpaired/i.test(value);gear.classList.toggle('gear-error',failed);gear.setAttribute('aria-label',failed?'Settings \u00b7 sync error':'Settings');if(failed)message(value);pairedNotice.hidden=!value.includes('Device paired');}});
 async function showDevices(){
  const result=await syncClient.devices();devicesList.replaceChildren();
  for(const device of result.devices.filter(device=>device.revoked_at==null).sort((a,b)=>b.created_at-a.created_at)){
   const row=document.createElement('div'),label=document.createElement('p'),rename=document.createElement('button'),revoke=document.createElement('button');
   const minutes=Math.max(0,Math.floor((Date.now()/1000-device.last_seen_at)/60));
   label.textContent=`${device.name} \u00b7 ${device.platform} \u00b7 Paired ${new Date(device.created_at*1000).toLocaleDateString('en-US',{month:'short',day:'numeric'})} \u00b7 Last seen ${minutes<1?'just now':`${minutes} min ago`}${device.id===result.deviceId?' \u00b7 This device':''}${device.is_legacy?' \u00b7 Legacy shared token \u00b7 Shared in chat; revoke once your devices are paired.':''}`;
   rename.textContent='Rename';rename.onclick=()=>{const input=document.createElement('input'),submit=document.createElement('button');input.value=device.name;input.maxLength=40;input.setAttribute('aria-label','Device name');submit.textContent='Save name';submit.onclick=()=>run(async()=>{const name=input.value.trim();if(!name||name.length>40||/[\p{Cc}\p{Cf}<>]/u.test(name))throw Error('Enter a plain text name of 1\u201340 characters.');await syncClient.rename(device.id,name);await showDevices();});row.append(input,submit);rename.disabled=true;};
   revoke.textContent='Revoke';revoke.onclick=()=>{if(window.confirm(`Revoke ${device.name}? It will stop syncing immediately.`))return run(async()=>{await syncClient.revoke(device.id);if(device.id===result.deviceId){await clearCredentials();syncClient.configure({});devicesList.replaceChildren();}else await showDevices();});};row.append(label,rename,revoke);devicesList.append(row);
  }
 }
 refreshDevices.onclick=()=>run(showDevices);devicesPanel.ontoggle=()=>{if(devicesPanel.open&&syncEnabled)return run(showDevices);};
 revokeOthers.onclick=()=>{if(window.confirm('Revoke all other devices? They will stop syncing immediately, including the legacy shared token.'))return run(async()=>{await syncClient.revokeOthers();await showDevices();});};
 pairAgain.onclick=()=>{openSettings();settingsPanel.open=true;pairingPanel.open=true;$('pair-code').focus();};dismissUnpaired.onclick=()=>{unpairedBanner.hidden=true;};pairedNotice.onclick=()=>{openSettings();settingsPanel.open=true;devicesPanel.open=true;return run(showDevices);};
 let pendingPairSettings;
 pairSubmit.onclick=async()=>{
  if(busy||pairSubmit.disabled){pairFeedback.textContent='Pairing is already in progress.';return;}
  busy=true;controls();pairFeedback.textContent='Pairing\u2026';
  activeOperation=(async()=>{
  try{
   if(!pendingPairSettings){
    const previous=await (await pairingPromise).settings(),url=$('sync-url').value.trim()||previous.url||'https://photoswiper-sync.sidlakkoju.workers.dev',code=$('pair-code').value.replace(/\s/g,''),name=$('pair-name').value.trim()||'New browser';
    const result=await syncClient.pair(url,code,name,window.navigator?.platform||'Browser');
    pendingPairSettings={url:new URL(url).origin,token:result.token,onboardingDismissed:true};
   }
   await syncRunning;
   const settings=pendingPairSettings,wasSyncEnabled=syncEnabled;syncEnabled=false;
   try{await (await pairingPromise).saveSettings(settings);}catch(error){syncEnabled=wasSyncEnabled;throw error;}
   pendingPairSettings=null;
   $('sync-url').value=settings.url;$('sync-token').value='';$('sync-token').placeholder='Leave blank to keep saved token';syncClient.configure(settings);syncEnabled=true;onboarding.hidden=true;syncLocal.hidden=true;unpairedBanner.hidden=true;
   message(idleMessage());
   pairFeedback.textContent='Device paired. Sync will resume when this tab can access local progress.';
   if(!leaseError&&lockedAccount)await synchronize();
  }catch(error){pairFeedback.textContent=pendingPairSettings?`${error.message}. Device claimed; choose Pair and sync to retry saving.`:error.message;}finally{busy=false;controls();}
  })();
  await activeOperation;activeOperation=null;
 };
 let pageActive=true,suspendingPromise=null,resumeOpening=false;
 let sessionClosing=false;
 let leaseTimer,syncTimer,openingPromise=null,closingPromise=null,activeOperation=null,syncRunning=null,decisionCount=0,writeRevision=0,leaseTicks=0,writeConflict=null,leaseGeneration=0,acquiringAccount=null,otherTab=false;
 const useHere=document.createElement('button');useHere.setAttribute('id','use-here');useHere.textContent='Use here';useHere.hidden=true;$('status').append(useHere);useHere.onclick=()=>open(true);
 const createWrites=()=>createWriteQueue({snapshot:()=>({...state,revision:writeRevision}),write:async next=>{await assertSaveAccount();if(writeConflict)throw writeConflict;if(leaseError)throw leaseError;return db.save(identity.account,next);},committed:(saved,value,duration)=>{if(window.localStorage?.psDebug==='1')window.console?.table({persistenceMs:duration});writeRevision=saved.revision;state={...state,revision:writeRevision};persistedItems=value.items;while(refreshedItems.has(persistedItems))persistedItems=refreshedItems.get(persistedItems);if(state.items===persistedItems)persistResume();},error:error=>{if(error.message.includes('Progress changed in another tab'))writeConflict=error;message(leaseError?leaseError.message:writeConflict?'Local save conflict. Unsaved decisions remain visible. Reload the page to read the other tab\u2019s progress; unsaved decisions will be lost.':`Local save failed: ${error.message} \u00b7 pending changes will retry.`);}});
 const refreshedItems=new WeakMap();
 let writes=createWrites(),persistedItems=null;
 const synchronize=(pull=true)=>{
  if(!identity||!syncEnabled||otherTab||leaseError||writeConflict||leaseRecoveryPending||!lockedAccount)return Promise.resolve();
  if(syncRunning)return syncRunning.then(()=>synchronize(pull));
  const account=identity.account,token=leaseGeneration;let version;
  syncRunning=(async()=>{
   await writes.flush();if(writes.pending)return;
   if(!await renewLease())return;
   if(token!==leaseGeneration||otherTab||leaseError||writeConflict||lockedAccount!==account||identity?.account!==account)return;
   version=state;
   const next=await syncClient.sync(account,version,async value=>value,{pull,rebuild:next=>rebuildSyncedReview(next,call)});
   if(token!==leaseGeneration||leaseRecoveryPending)return;
   await refreshLease();
   if(token===leaseGeneration&&!otherTab&&!leaseError&&identity?.account===account&&next!==version){
    state={...mergeSyncResult(state,version,next),revision:writeRevision};
    await writes.enqueue();render();
   }
  })().finally(()=>{syncRunning=null;});
  return syncRunning;
 };
 function scheduleSync(){
  if(!syncEnabled||sessionClosing||otherTab)return;
  window.clearTimeout(syncTimer);
  if(++decisionCount>=10&&!busy&&!activeOperation){decisionCount=0;synchronize(false);}
  else syncTimer=window.setTimeout(()=>{decisionCount=0;if(!busy&&!activeOperation)synchronize(false);},2000);
  syncTimer?.unref?.();
 }
 function apply(next,removedKey){state=markSyncChanges(state,next);if(removedKey&&deckCache){deckCache=deckCache.filter(item=>item.mediaKey!==removedKey);deckItems=state.items;}render();writes.enqueue();scheduleSync();}
 const readyMessage=()=>gear.classList.contains('gear-error')?syncSummary:'';
 const idleMessage=()=>state.job?'A saved album operation is ready to retry.':readyMessage();
 const message=value=>{$('status').textContent=otherTab?'Open in another tab':value;reviewStatus.textContent=reviewPanel.hidden?'':value;reviewStatus.hidden=!reviewStatus.textContent;if(otherTab){useHere.hidden=false;$('status').append(useHere);}else useHere.hidden=true;};
 function persistResume(){if(otherTab||!identity||!db||state.items!==persistedItems)return;const account=identity.account,item=current();resume={...resume,currentId:item?.mediaKey||null,inspected:!!inspected,filter:$('filter').value,sort:$('sort').value,reviewEvery:Number(reviewEvery.value)||25,deleteMethod:deleteMethod.value};const value=structuredClone(resume);resumeWrite=resumeWrite.catch(()=>{}).then(()=>db.saveResume(account,value)).catch(error=>message(`Could not save resume: ${error.message}`));}
 function captureVideo(){const video=$('media').querySelector('video');if(video&&video.dataset.resumeReady!=='pending'&&shown&&Number.isFinite(video.currentTime)){resume={...resume,video:{key:shown,time:video.currentTime}};persistResume();}}
 async function call(operation,args={}) {
  if(!pageActive||document.hidden)throw Error('Session changed. Close and reopen Photos Swipe.');
  if(leaseError)throw leaseError;
  const token=leaseGeneration;
  const result=await rawCall(operation,{...args,...(identity?{account:identity.account}:{})});
  if(!result.ok)throw Error(result.error);
  if(!pageActive||document.hidden||token!==leaseGeneration)throw Error('Session changed. Close and reopen Photos Swipe.');
  if(leaseError)throw leaseError;
  return result.data;
 }
 function releaseLease(){
  leaseGeneration++;
  clearInterval(leaseTimer);leaseTimer=null;
  const account=lockedAccount||acquiringAccount;lockedAccount=null;acquiringAccount=null;
  return account?db.lease(account,owner,true).catch(()=>{}):Promise.resolve();
 }
 async function assertAccount(){
  const token=leaseGeneration,account=identity?.account;
  if(!account)throw Error('Close and reopen Photos Swipe after signing into Google Photos.');
  const response=await rawCall('identity');
  if(token!==leaseGeneration||account!==identity?.account)throw Error('Session changed. Close and reopen Photos Swipe.');
  if(!response.ok)throw Error(response.error);
  if(response.data.account!==account){
   leaseError=Error('Google account changed. Close and reopen Photos Swipe.');
   releaseLease();message(leaseError.message);throw leaseError;
  }
 }
 async function assertSaveAccount(){
  if(!lockedAccount||lockedAccount!==identity?.account)throw Error('Session changed. Close and reopen Photos Swipe.');
  await assertAccount();
  try{await db.lease(identity.account,owner);}catch(error){lockedAccount=null;leaseError=error;startRenewal();message(error.message);throw error;}
  if(!lockedAccount||lockedAccount!==identity?.account)throw Error('Session changed. Close and reopen Photos Swipe.');
 }
 async function save(next){await syncRunning;await assertSaveAccount();state=markSyncChanges(state,next);await writes.enqueue();if(writes.pending)throw leaseError||Error('Local changes have not been saved.');return state;}
 function controls(){pairSubmit.disabled=busy;for(const button of root.querySelectorAll('button,select'))if(!['close','launcher','pair-submit'].includes(button.id)&&!pairingModal.modal.contains(button)&&!receivingPanel?.contains(button))button.disabled=busy||!identity||(otherTab&&button!==useHere)||(button.id==='undo'&&!historyView().nextUndo)||(button.id==='move-trash'&&!reviewRows().some(item=>item.decision==='remove'))||(!syncEnabled&&['refresh-devices','revoke-other-devices'].includes(button.id));$('overlay').setAttribute('aria-busy',String(busy));}
 function startRenewal(){
  if(leaseTimer||sessionClosing||!pageActive||document.hidden||$('overlay').hidden)return;
  leaseTimer=setInterval(()=>refreshLease(),LEASE_HEARTBEAT_MS);
  leaseTimer?.unref?.();
 }
 function pauseForOtherTab(){
  if(!sheet.hidden)closeSettings();reviewPanel.hidden=true;previewKey=null;resumeReviewPlayback=false;renderTrashReview();$('close').focus();
  leaseGeneration++;cancelLibraryFill();window.clearTimeout(syncTimer);syncTimer=null;libraryFailure=null;otherTab=true;acquiringAccount=null;swipeFeedback.reset();leaseError=Error('Open in another tab');lockedAccount=null;clearInterval(leaseTimer);leaseTimer=null;message(leaseError.message);controls();
 }
 async function renewLease(takeover=false,claim=false){
  const token=leaseGeneration,account=identity?.account;
  if(!account||otherTab||!pageActive||document.hidden)return false;
  try{
   await assertAccount();
   if(token!==leaseGeneration||otherTab||account!==identity?.account)return false;
   acquiringAccount=account;
   let lease=await db.lease(account,owner,false,takeover||!!leaseError||activeOperation||writes.pending||state.items!==persistedItems,claim);
   if(token!==leaseGeneration||otherTab||account!==identity?.account)return false;
   if(lease.owner!==owner&&(activeOperation||writes.pending||state.items!==persistedItems))lease=await db.lease(account,owner,false,true);
   if(token!==leaseGeneration||otherTab||account!==identity?.account)return false;
   if(lease.owner!==owner){pauseForOtherTab();return false;}
   lockedAccount=account;leaseError=null;startRenewal();return true;
  }catch(error){
   if(token===leaseGeneration){lockedAccount=null;leaseError=error;message(error.message);startRenewal();}
   return false;
  }finally{if(token===leaseGeneration)acquiringAccount=null;}
 }
 async function refreshLease(){
  await suspendingPromise;
  if(otherTab||sessionClosing||!pageActive||document.hidden||$('overlay').hidden)return;
  const token=leaseGeneration,recovering=leaseRecoveryPending||!!leaseError;
  const account=identity?.account;
  if(!account)return;
  if(recovering)leaseRecoveryPending=true;
  if(!await renewLease()||token!==leaseGeneration)return;
  if(recovering){if(busy||activeOperation||syncRunning||closingPromise||$('overlay').hidden)return;await open();return;}
  if(!busy&&!activeOperation&&!syncRunning){writes.flush();refill();}
  if(++leaseTicks%15===0&&syncEnabled&&!busy&&!activeOperation&&!syncRunning&&!$('overlay').hidden)synchronize();
 }
 async function recoverLease(){
  if(!identity)return true;
  return renewLease();
 }
 async function withAccountLease(task) {
  if(!await renewLease(true))throw leaseError||Error('Session changed. Close and reopen Photos Swipe.');
  await writes.flush();if(writes.pending)throw Error('Save pending local changes before this operation.');
  await task();scheduleSync();
 }
 async function run(task) {
  if(busy)return;
  busy=true;controls();
  activeOperation=(async()=>{
   try {
    db=await database();
    await libraryLoading;await syncRunning;
    await assertAccount();
    await withAccountLease(task);
   }catch(error){message(error.message);}finally{
    busy=false;render();controls();
   }
  })();
  await activeOperation;activeOperation=null;
 }
 const bytes=value=>value>=1e9?`${(value/1e9).toFixed(1)} GB`:value>=1e6?`${(value/1e6).toFixed(1)} MB`:`${Math.round(value/1e3)} KB`;
 const itemSize=item=>Number.isFinite(item.size)&&item.size>=0?bytes(item.size):'Unknown size';
 const estimate=items=>{const total=reviewStorage(items);return `${bytes(total.bytes)}${total.unknown?` + ${total.unknown} unknown`:''}`;};
 let deckCache=null,deckItems=null,deckFilter=null,deckSort=null;
 function deck(){if(deckItems===state.items&&deckFilter===$('filter').value&&deckSort===$('sort').value)return deckCache;deckItems=state.items;deckFilter=$('filter').value;deckSort=$('sort').value;const items=reviewDeck(state).filter(item=>$('filter').value==='all'||item.type===$('filter').value);if($('sort').value==='oldest')items.sort((a,b)=>new Date(a.date||0)-new Date(b.date||0));if($('sort').value==='largest')items.sort((a,b)=>(b.size||0)-(a.size||0));deckCache=items;return items;}
 function current(){return inspected?state.items.find(item=>item.mediaKey===inspected):deck().find(item=>item.mediaKey===focused)||deck()[0];}
 function mediaURL(value,video=false,expanded=false) {
  if(typeof expanded==='object'){const url=new URL(previewURL(value,{video,authuser:location.pathname.match(/^\/u\/(\d+)/)?.[1]||'0'}));if(!video)url.pathname=url.pathname.replace(/=.+$/,'')+`=w${Math.max(1,Math.ceil(expanded.width))}-h${Math.max(1,Math.ceil(expanded.height))}-k-no`;return url.href;}
  return previewURL(value,{video,expanded,width:expanded?(window.innerWidth||512):($('media').getBoundingClientRect?.().width||window.innerWidth||512),height:expanded?(window.innerHeight||800):($('media').getBoundingClientRect?.().height||Math.round((window.innerHeight||800)*.48)),dpr:window.devicePixelRatio,mobile:/iPhone|iPad/.test(window.navigator?.userAgent||''),authuser:location.pathname.match(/^\/u\/(\d+)/)?.[1]||'0'});
 }
 const preloader=createReviewPreloader({createImage:()=>document.createElement('img'),createVideo:()=>document.createElement('video'),videoURL:async mediaKey=>({url:await videoURL(state.items.find(item=>item.mediaKey===mediaKey))}),previewURL:(url,size)=>mediaURL(url,false,size),playbackURL:url=>mediaURL(url,true)});
 function previewSize(){const {width,height}=$('media').getBoundingClientRect();return {width:width||1,height:height||1,compact:!!window.matchMedia?.('(max-width:760px), (pointer:coarse)').matches};}
 function preloadReview(item){const size=previewSize(),items=reviewPreviewWindow(deck(),item,size.compact).filter(candidate=>candidate.mediaKey===item?.mediaKey||!reviewURLStale(candidate));preloader.update($('overlay').hidden||inspected?[]:items,$('overlay').hidden?null:item,size);}
 const urlRefreshes=new Map();
 async function refreshItemURL(item) {
  const account=identity?.account,key=`${account}:${item.mediaKey}`;
  if(urlRefreshes.has(key))return urlRefreshes.get(key);
  const request=(async()=>{
   const response=await rawCall('mediaURL',{mediaKey:item.mediaKey,account});
   if(!response.ok)throw Error(response.error);
   const result=response.data;mediaURL(result.url);
   if(identity?.account!==account)return item;
   const fresh={...item,thumbUrl:result.url,urlFetchedAt:Date.now()};
   const previousItems=state.items;
   state={...state,items:state.items.map(saved=>saved.mediaKey===item.mediaKey?{...saved,thumbUrl:fresh.thumbUrl,urlFetchedAt:fresh.urlFetchedAt}:saved)};
   refreshedItems.set(previousItems,state.items);
   if(persistedItems===previousItems)persistedItems=state.items;
   return fresh;
  })();
  urlRefreshes.set(key,request);
  try{return await request;}finally{urlRefreshes.delete(key);}
 }
 async function refreshStalePreviews() {
  if($('overlay').hidden||!identity)return;
  const item=current(),account=identity.account;
  const windowItems=reviewPreviewWindow(inspected?[]:deck(),item,previewSize().compact);
  const results=await Promise.allSettled(windowItems.filter(item=>reviewURLStale(item)).map(refreshItemURL));
  if($('overlay').hidden||identity?.account!==account)return;
  if(results.some(result=>result.status==='fulfilled')){preloader.clear();buffer.clear();if(current()?.mediaKey===item?.mediaKey)display(current());preloadReview(current());}
 }
  const mobile=/iPhone|iPad/.test(window.navigator?.userAgent||'');
 const smallBuffer=mobile||window.navigator?.deviceMemory<=4||window.navigator?.connection?.saveData;
 let previousKey=null,swipeAt=null,idlePending=false;
 const metrics={paint:[],hits:0,misses:0};
 const buffer=createPreloadBuffer({size:smallBuffer?2:3,load:(item,signal)=>new Promise((resolve,reject)=>{
  const image=window.Image?new window.Image():document.createElement('img');
  const abort=()=>{image.src='';reject(Error('Aborted'));};
  signal.addEventListener('abort',abort,{once:true});
  image.onload=async()=>{try{if(image.decode)await image.decode();signal.removeEventListener('abort',abort);if(!signal.aborted)resolve(image);}catch(error){reject(error);}};
  image.onerror=()=>reject(Error('Preview unavailable'));
  image.src=mediaURL(item.thumbUrl);
 })});
 const videoURLs=new Map();let videoRPC=null,warmedVideo=null,warmedKey=null;
 function videoURL(item){
  const account=identity?.account;const cached=videoURLs.get(item.mediaKey);
  if(cached&&Date.now()-cached.fetchedAt<1800000)return Promise.resolve(cached.url);
  if(videoRPC)return videoRPC.then(()=>videoURL(item),()=>videoURL(item));
  videoRPC=call('video',{mediaKey:item.mediaKey}).then(result=>{const url=mediaURL(result.url,true);if(identity?.account===account){videoURLs.set(item.mediaKey,{url,fetchedAt:Date.now()});if(videoURLs.size>32)videoURLs.delete(videoURLs.keys().next().value);}return url;}).finally(()=>{videoRPC=null;});
  return videoRPC;
 }
 let libraryLoading=null,libraryFailure=null,cancelLibraryLoading=null;
 function cancelLibraryFill(){cancelLibraryLoading?.();cancelLibraryLoading=null;libraryLoading=null;}
 function fillLibrary(){
  if(libraryLoading||libraryFailure||sessionClosing||closingPromise||busy||leaseError||leaseRecoveryPending||!pageActive||document.hidden||!lockedAccount||!identity||!state.started||state.exhausted||reviewDeck(state).length>10||$('overlay').hidden)return;
  const token=leaseGeneration;
  let cancel;
  const cancelled=new Promise((resolve,reject)=>{cancel=()=>reject(Error('Library loading session changed.'));});
  cancelLibraryLoading=cancel;
  const loading=load(false,cancelled).catch(error=>{if(token!==leaseGeneration||sessionClosing||!pageActive||document.hidden)return;libraryFailure=error;message(`Library loading failed: ${error.message}. Retry Load more.`);}).finally(()=>{if(libraryLoading!==loading)return;libraryLoading=null;cancelLibraryLoading=null;render();});
  libraryLoading=loading;
 }
 function refill(){
  if(idlePending||!window.Image||$('overlay').hidden)return;
  idlePending=true;
  const idle=window.requestIdleCallback?.bind(window)||((task)=>window.setTimeout(task,0));
  idle(()=>{
   idlePending=false;if($('overlay').hidden)return;
   const upcoming=deck().filter(item=>item.mediaKey!==shown&&!reviewURLStale(item)).slice(0,smallBuffer?2:3);
   buffer.update(smallBuffer&&previousKey?upcoming.slice(0,1):upcoming,previousKey);
   for(const item of upcoming.slice(0,2).filter(item=>item.type==='video'))videoURL(item).catch(()=>{});
   const next=upcoming[0];
   if(warmedKey!==next?.mediaKey){if(warmedVideo){warmedVideo.pause();warmedVideo.removeAttribute('src');warmedVideo.load();}warmedVideo=null;warmedKey=null;}
   if(!mobile&&next?.type==='video'&&!warmedVideo){
    const video=document.createElement('video');warmedVideo=video;warmedKey=next.mediaKey;video.preload='metadata';video.muted=true;video.playsInline=true;
    videoURL(next).then(url=>{if(warmedVideo===video)video.src=url;}).catch(()=>{});
   }
  });
 }
 function painted(media,token){
  if(token!==generation||swipeAt===null)return;
  const finish=()=>{if(token!==generation||swipeAt===null)return;window.performance?.mark('painted');metrics.paint.push(window.performance.now()-swipeAt);swipeAt=null;
   if(window.localStorage?.psDebug==='1'){const times=[...metrics.paint].sort((a,b)=>a-b);window.console?.table({p50:times[Math.floor(times.length*.5)],p95:times[Math.min(times.length-1,Math.floor(times.length*.95))],bufferHitRate:metrics.hits/(metrics.hits+metrics.misses)});}
  };
  (window.requestAnimationFrame?.bind(window)||((task)=>window.setTimeout(task,0)))(finish);
 }
 function dropWarmVideo(){if(warmedVideo){warmedVideo.pause();warmedVideo.removeAttribute('src');warmedVideo.load();}warmedVideo=null;warmedKey=null;}
 function stopMedia(clearUnderCard=true){captureVideo();swipeFeedback.reset();if(clearUnderCard){underCard.replaceChildren();underCard.hidden=true;}generation++;const image=$('media').querySelector('img');const old=state.items.find(item=>item.mediaKey===shown);if(image&&old&&image.complete&&image.naturalWidth)buffer.retain(old,image);const video=$('media').querySelector('video');if(video){video.pause();video.removeAttribute('src');video.load();}$('media').replaceChildren();shown=null;}
 async function display(item,retried=false,forceRefresh=false) {
  const preview=underCard.querySelector('img'),preloaded=preview?.dataset?.key===item?.mediaKey?preview:null;
  stopMedia(shown!==(item?.mediaKey||null));$('zoom').value='1';$('card').classList.remove('zoomed');mediaElement.style.touchAction='';shown=item?.mediaKey||null;const token=generation;
  $('media').style.color='var(--ps-label)';$('media').setAttribute('aria-busy','false');
  if(!item){$('media').textContent='No items to review. Load more or refresh latest.';return;}
  let handlingError=false;
  const failed=async()=>{
   if(token!==generation||handlingError)return;
   handlingError=true;$('media').setAttribute('aria-busy','false');$('media').replaceChildren();
   if(!retried){$('media').textContent='Refreshing preview\u2026';try{const fresh=await refreshItemURL(item);if(token===generation){preloader.clear();buffer.clear();videoURLs.delete(item.mediaKey);dropWarmVideo();display(fresh,true);preloadReview(fresh);}return;}catch{}}
   if(token!==generation)return;
   const label=document.createElement('p'),retry=document.createElement('button');
   label.textContent='Preview unavailable.';retry.textContent='Retry';retry.onclick=()=>display(current(),false,true);
   $('media').replaceChildren(label,retry);
  };
  try {
   if(forceRefresh||reviewURLStale(item)){
    $('media').textContent='Refreshing preview\u2026';
    try{item=await refreshItemURL(item);if(forceRefresh)retried=true;}catch{if(forceRefresh){retried=true;await failed();return;}}
    if(token!==generation)return;
    $('media').replaceChildren();
   }
   const cached=!retried&&!forceRefresh?((item.type==='photo'?preloaded:null)||buffer.take(item.mediaKey)):null;const media=item.type==='video'?(warmedKey===item.mediaKey&&!retried&&!forceRefresh?warmedVideo:document.createElement('video')):(cached||document.createElement('img'));if(cached)metrics.hits++;else metrics.misses++;if(media===warmedVideo){warmedVideo=null;warmedKey=null;}
   media.onerror=failed;
   if(item.type==='video'){const savedTime=resume.video?.key===item.mediaKey?resume.video.time:0;media.dataset.resumeReady='pending';media.addEventListener('loadedmetadata',()=>{if(token!==generation)return;if(Number.isFinite(savedTime))media.currentTime=Math.max(0,Math.min(savedTime,Number.isFinite(media.duration)?media.duration:savedTime));media.dataset.resumeReady='ready';});media.addEventListener('timeupdate',()=>{if(Date.now()-videoSavedAt>=1000){videoSavedAt=Date.now();captureVideo();}});media.addEventListener('pause',captureVideo);
    media.controls=$('card').classList.contains('expanded');media.muted=true;media.loop=true;media.playsInline=true;media.preload='metadata';media.poster=mediaURL(item.thumbUrl,false,previewSize());
    const poster=cached||document.createElement('img');poster.alt=item.name;poster.setAttribute('class','video-poster');poster.style.width='';poster.style.maxWidth='100%';poster.style.maxHeight='100%';
    poster.onload=()=>painted(poster,token);if(!cached)poster.src=media.poster;
    media.hidden=true;$('media').replaceChildren(poster,media);addVideoControls(media);$('media').setAttribute('aria-busy','true');
    if(poster.complete&&poster.naturalWidth)painted(poster,token);
    const started=window.performance?.now();
    media.oncanplay=()=>{if(token===generation)$('media').setAttribute('aria-busy','false');};
    media.onloadeddata=()=>{
     if(token!==generation)return;
     media.hidden=false;$('media').replaceChildren(media);addVideoControls(media);painted(media,token);
     if(window.localStorage?.psDebug==='1')window.console?.table({videoFirstFrameMs:window.performance.now()-started});
    };
    if(retried||forceRefresh)videoURLs.delete(item.mediaKey);const url=await videoURL(item);if(token!==generation)return;
    if(media.src!==url)media.src=url;media.play().catch(()=>{});
    if(media.readyState>=2)media.onloadeddata();
   }
   else {media.style.maxWidth='100%';media.style.maxHeight='100%';media.style.width='';media.style.touchAction='';media.alt=item.name;media.draggable=false;media.hidden=true;media.onload=()=>{if(token===generation){media.hidden=false;$('media').setAttribute('aria-busy','false');painted(media,token);}};$('media').append(media);const source=mediaURL(item.thumbUrl,false,previewSize()),reused=!!cached&&media.src===source;$('media').setAttribute('aria-busy',String(!reused));if(!reused)media.src=source;if(reused&&media.complete){if(media.naturalWidth>0){media.hidden=false;$('media').setAttribute('aria-busy','false');painted(media,token);}else await failed();}}
  }catch{await failed();}
 }
 function updateVideoControls(){
  const video=mediaElement.querySelector('video');
  if(video)video.controls=$('card').classList.contains('expanded');
  for(const button of mediaElement.childNodes)if(button.dataset?.videoControl)button.hidden=$('card').classList.contains('expanded');
 }
 function addVideoControls(video){
  for(const action of ['play','mute']){
   const button=document.createElement('button');button.dataset.videoControl=action;
   button.textContent=action==='play'?(video.paused?'Play':'Pause'):'Unmute';
   button.style.cssText=`position:absolute;bottom:12px;${action==='play'?'left':'right'}:12px;z-index:2`;
   button.addEventListener('pointerdown',event=>event.stopPropagation());
   button.onclick=()=>{if(action==='play'){if(video.paused)video.play().catch(()=>{});else video.pause();button.textContent=video.paused?'Play':'Pause';}else{video.muted=!video.muted;button.textContent=video.muted?'Unmute':'Mute';}};
   if(action==='play')for(const type of ['play','pause'])video.addEventListener(type,()=>{button.textContent=video.paused?'Play':'Pause';});
   mediaElement.append(button);
  }
  updateVideoControls();
 }
 let renderedHistory='';
 queue_detailsElement.addEventListener('toggle',()=>render());historyPanel.addEventListener('toggle',()=>render());
 function historyView(){
  const entries=[...(state.history||[])].reverse(),nextUndo=entries.find(entry=>canUndoReview(state,entry));
  const decisionLabel=value=>value==='remove'?'Queue':value==='keep'?'Keep':'Unreviewed';
  const historyLabel=entry=>`${state.items.find(item=>item.mediaKey===entry.key)?.name||entry.key} \u00b7 ${decisionLabel(entry.previous)} \u2192 ${decisionLabel(entry.decision)}`;
  return {entries,nextUndo,historyLabel,decisionLabel};
 }
 function renderCard(){
  const item=current();
  $('caption').textContent=item?`${inspected?'Candidate inspection \u00b7 ':''}${item.name} \u00b7 ${item.date?new Date(item.date).toLocaleDateString():'Unknown date'} \u00b7 ${itemSize(item)}`:(reviewDeck(state).length?'No items match this filter.':state.exhausted?"You\u2019ve reviewed everything":libraryFailure?'Library loading failed. Retry Load more.':'Loading more items\u2026');
  if(!$('overlay').hidden&&(shown!==(item?.mediaKey||null)||!$('media').childNodes.length))display(item);
 }
 function renderStats(){
  const queue=reviewQueue(state),candidates=reviewTrashCandidates(state);
  lifetime.textContent=estimate(state.items.filter(item=>item.state==='in_trash'&&item.decision==='remove'));
  counter.textContent=`${state.items.filter(item=>item.decision).length} reviewed \u00b7 ${candidates.length} marked`;counter.title=counter.textContent;trashBadge.textContent=String(candidates.length);queuePill.hidden=candidates.length<25;queuePillText.textContent=`${candidates.length} going to Trash`;queueGrowth.hidden=candidates.length<=25;queueGrowth.textContent=`+${candidates.length-25}`;queueThumbs.replaceChildren();for(const item of candidates.slice(-3)){const image=document.createElement('img');image.alt='';image.src=mediaURL(item.thumbUrl);queueThumbs.append(image);}
  $('stats').textContent=`${deck().length} to review \u00b7 ${state.items.filter(item=>item.decision).length}/${state.items.length} reviewed \u00b7 Queue: ${queue.length} (estimated savings: ${estimate(queue)}) \u00b7 In Trash: ${estimate(state.items.filter(item=>item.decision==='remove'&&item.state==='in_trash'))} (running total) \u00b7 Lifetime freed: ${bytes(state.lifetimeFreed??reviewStorage(state.items.filter(item=>item.state==='in_trash')).bytes)}`;
  const {nextUndo,historyLabel,decisionLabel}=historyView();
  undoPreview.textContent=nextUndo?`Next Undo: ${historyLabel(nextUndo)}; restores ${decisionLabel(nextUndo.previous)}.`:'No previous decisions can be undone.';
  $('undo').title=undoPreview.textContent;$('undo').setAttribute('aria-describedby','undo-preview');
$('remove').setAttribute('aria-label',inspected?'Back to review':'Mark for deletion');$('keep').setAttribute('aria-label',inspected?'Keep instead':'Keep');
  $('send').textContent='Finish previous transfer';$('send').parentElement.hidden=!state.job;
  $('album').hidden=!state.albumKey;if(state.albumKey)$('album').href=`https://photos.google.com/u/${location.pathname.match(/^\/u\/(\d+)/)?.[1]||'0'}/album/${encodeURIComponent(state.albumKey)}`;
 }
 function reviewRows(){const items=new Map(state.items.map(item=>[item.mediaKey,item]));return reviewItems.filter(saved=>items.has(saved.mediaKey)).map(saved=>({...saved,...items.get(saved.mediaKey)})).filter(item=>item.state!=='in_trash'&&!item.needsPreview);}
 function decideWithHistory(current,item,decision){
  const next=decideReview(current,item.mediaKey,decision,item.decision,item.revision||0);
  return {...next,history:[...(current.history||[]),{key:item.mediaKey,previous:item.decision,decision,revision:(item.revision||0)+1}]};
 }
 function selectTrashItem(key,selected){
  if(busy||!identity||leaseError)return;
  const item=state.items.find(item=>item.mediaKey===key);if(!item||item.state==='in_trash')return;
  const decision=selected?'remove':'keep';if(item.decision===decision)return;
  try{apply(decideWithHistory(state,item,decision));}catch(error){message(error.message);}
 }
 selectAll.onclick=()=>{if(busy||!identity||leaseError)return;try{let next=state;for(const item of reviewRows())if(item.decision!=='remove')next=decideWithHistory(next,item,'remove');apply(next);}catch(error){message(error.message);}};
 function renderTrashReview(){
  if(reviewPanel.hidden){if(resumeReviewPlayback&&!overlayElement.hidden){mediaElement.querySelector('video')?.play().catch(()=>{});resumeReviewPlayback=false;}previewGeneration++;if(previewVideo){previewVideo.pause();previewVideo.removeAttribute('src');previewVideo.load();previewVideo=null;}reviewSignature='';return;}
  const rows=reviewRows(),selected=rows.filter(item=>item.decision==='remove');
  sizeValue.textContent=estimate(selected);reviewSubtitle.textContent=`${selected.length} of ${rows.length} selected \u00b7 ${estimate(selected)}`;moveTrash.textContent=`Move ${selected.length} to Trash`;moveTrash.disabled=busy||!identity||!selected.length;
  const signature=JSON.stringify([previewKey,rows.map(item=>[item.mediaKey,item.decision,item.thumbUrl,item.name,item.state])]);if(signature===reviewSignature)return;reviewSignature=signature;
  reviewGrid.replaceChildren();
  for(const item of rows){
   const tile=document.createElement('div');tile.setAttribute('class',`trash-tile${item.decision==='remove'?'':' kept'}`);
   const photo=document.createElement('button'),image=document.createElement('img');photo.setAttribute('class','trash-photo');photo.setAttribute('aria-label',`Preview ${item.name}`);image.alt=item.name;image.loading='lazy';image.src=mediaURL(item.thumbUrl);photo.append(image);photo.onclick=()=>{if(busy)return;previewKey=item.mediaKey;renderTrashReview();};
   const check=document.createElement('button');check.setAttribute('class','trash-check');icon(check,`Keep ${item.name}`,['M5 12l4 4L19 6']);check.setAttribute('aria-label',`${item.decision==='remove'?'Keep':'Trash'} ${item.name}`);check.setAttribute('aria-pressed',String(item.decision==='remove'));check.onclick=()=>{selectTrashItem(item.mediaKey,item.decision!=='remove');[...reviewGrid.querySelectorAll('.trash-check')].find(button=>button.dataset.key===item.mediaKey)?.focus();};check.dataset.key=item.mediaKey;tile.append(photo,check);
   if(item.type==='video'){const duration=document.createElement('span');duration.setAttribute('class','trash-duration');duration.textContent=`\u25b6 ${videoDuration(item)}`;tile.append(duration);}
   if(item.legacy){const legacy=document.createElement('span');legacy.setAttribute('class','trash-legacy');legacy.textContent='Previously marked';tile.append(legacy);}
   reviewGrid.append(tile);
  }
  reviewPanel.querySelector('.trash-preview')?.remove();previewGeneration++;if(previewVideo){previewVideo.pause();previewVideo.removeAttribute('src');previewVideo.load();previewVideo=null;}
  const item=rows.find(item=>item.mediaKey===previewKey);if(!item){previewKey=null;return;}
  const preview=document.createElement('section');preview.setAttribute('class','trash-preview');preview.setAttribute('id','trash-preview');preview.setAttribute('role','dialog');preview.setAttribute('aria-label',`Preview ${item.name}`);const nav=document.createElement('div');nav.setAttribute('class','trash-nav');const back=document.createElement('button'),position=document.createElement('span'),done=document.createElement('button');back.textContent='\u2039 Going to Trash';position.textContent=`${rows.indexOf(item)+1} of ${rows.length}`;done.textContent='Done';back.onclick=done.onclick=()=>{previewKey=null;renderTrashReview();};nav.append(back,position,done);
  const media=document.createElement('div');media.setAttribute('class','trash-preview-media');const image=document.createElement(item.type==='video'?'video':'img');if(item.type==='video'){image.controls=true;image.playsInline=true;image.poster=mediaURL(item.thumbUrl,false,previewSize());previewVideo=image;const token=previewGeneration;videoURL(item).then(url=>{if(token===previewGeneration)image.src=url;}).catch(error=>message(error.message));}else{image.alt=item.name;image.src=mediaURL(item.thumbUrl,false,previewSize());}media.append(image);
  const caption=document.createElement('div'),details=document.createElement('small');caption.setAttribute('class','trash-preview-caption');caption.textContent=item.name;details.textContent=[item.date?new Date(item.date).toLocaleDateString():'Unknown date',item.type==='video'?videoDuration(item):null,itemSize(item),item.legacy?'Previously marked':null].filter(Boolean).join(' \u00b7 ');caption.append(details);
  const strip=document.createElement('div');strip.setAttribute('class','trash-strip');for(const row of rows){const button=document.createElement('button'),thumb=document.createElement('img');button.setAttribute('class',row.mediaKey===previewKey?'active':'');button.setAttribute('aria-label',`Preview ${row.name}`);thumb.alt='';thumb.src=mediaURL(row.thumbUrl);button.append(thumb);button.onclick=()=>{previewKey=row.mediaKey;renderTrashReview();};strip.append(button);}
  const bar=document.createElement('div');bar.setAttribute('class','trash-bar');const keep=document.createElement('button'),trash=document.createElement('button');keep.textContent='Keep';trash.textContent='Trash';trash.setAttribute('class','preview-trash');keep.setAttribute('aria-pressed',String(item.decision==='keep'));trash.setAttribute('aria-pressed',String(item.decision==='remove'));keep.onclick=()=>selectTrashItem(item.mediaKey,false);trash.onclick=()=>selectTrashItem(item.mediaKey,true);bar.append(keep,trash);preview.append(nav,media,caption,strip,bar);reviewPanel.append(preview);done.focus();
 }
 function videoDuration(item){const seconds=Math.max(0,Math.floor((Number(item.duration)||0)/1000));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;}
 function renderLists(){
  const queue=reviewQueue(state),candidates=reviewTrashCandidates(state);
  const {entries,nextUndo,historyLabel}=historyView();
  if(historyPanel.open){
  const historyRows=entries.slice(0,100).map(entry=>`${historyLabel(entry)} \u00b7 ID: ${entry.key}${entry===nextUndo?' \u00b7 Next Undo':canUndoReview(state,entry)?'':' \u00b7 Unavailable for Undo'}`);
  if(entries.length>100)historyRows.push(`Showing the latest 100 of ${entries.length} decisions.`);
  if(!entries.length)historyRows.push('No decisions yet.');
  const historySignature=JSON.stringify(historyRows);
  if(historySignature!==renderedHistory){
   renderedHistory=historySignature;historyList.replaceChildren();
   for(const text of historyRows){const row=document.createElement('li');row.textContent=text;historyList.append(row);}
  }
  }
  renderTrashReview();
 }

 function render(){
  renderCard();const item=current();
  const next=inspected||$('card').classList.contains('expanded')?null:deck().find(candidate=>candidate.mediaKey!==item?.mediaKey);
  if(next&&underCard.querySelector('img')?.dataset?.key!==next.mediaKey){try{const preview=document.createElement('img');preview.dataset.key=next.mediaKey;preview.alt='';preview.draggable=false;preview.src=mediaURL(next.thumbUrl,false,previewSize());underCard.replaceChildren(preview);}catch{underCard.replaceChildren();}}
  if(!next)underCard.replaceChildren();underCard.hidden=!next;
  preloadReview(item);
  renderStats();controls();renderLists();refill();fillLibrary();
  if(identity&&!$('overlay').hidden)persistResume();
 }
 let cardAnimation=null;
 function finishCardAnimation(){if(cardAnimation)cardAnimation.finish();}
 function clearCardAnimation(){if(cardAnimation){cardAnimation.cancel();cardAnimation=null;}$('card').style.visibility='';}
 async function animateCard(decision){
  clearCardAnimation();
  if(!$('card').animate||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
  const side=decision==='keep'?1:-1,center={transform:'translateX(0) rotate(0deg)',opacity:1},edge={transform:`translateX(${side*120}vw) rotate(${side*18}deg)`,opacity:0};
  $('undo').querySelector('svg')?.animate?.([{transform:'rotate(-45deg)'},{transform:'rotate(0)'}],{duration:350,easing:'cubic-bezier(.34,1.56,.64,1)'});
  const animation=$('card').animate([edge,center],{duration:350,easing:'cubic-bezier(.34,1.56,.64,1)',fill:'forwards'});cardAnimation=animation;
  let timer;
  try{await Promise.race([animation.finished,new Promise(resolve=>{timer=window.setTimeout(()=>{animation.finish();resolve();},350);})]);}catch{}finally{window.clearTimeout(timer);}
 }
 async function openSession(claim=false) {
  const requestedGeneration=leaseGeneration;
  if(closingPromise){await closingPromise;if(requestedGeneration!==leaseGeneration)return;}
  await suspendingPromise;
  if(busy||!pageActive||document.hidden)return;
  const token=++leaseGeneration;
  cancelLibraryFill();window.clearTimeout(syncTimer);syncTimer=null;clearInterval(leaseTimer);leaseTimer=null;libraryFailure=null;otherTab=false;useHere.hidden=true;
  await resumeWrite;preloader.clear();busy=true;controls();$('overlay').hidden=false;lockPage();$('launcher').hidden=true;buffer.clear();await syncRunning;
  try{
   const result=await rawCall('identity');
   if(token!==leaseGeneration)return;
   if(!result.ok)throw Error(result.error);
   const changed=identity?.account!==result.data.account;
   if(changed){
    await releaseLease();
    await writes.flush();writes=createWrites();writeConflict=null;leaseError=null;
    inspected=null;focused=null;stopMedia();dropWarmVideo();buffer.clear();videoURLs.clear();previousKey=null;
   }
   identity=result.data;$('account').textContent=identity.label;db=await database();
   let settings={};try{settings=await (await pairingPromise).settings();}catch(error){pairingNotice.textContent=`Pairing storage unavailable: ${error.message}`;}unpairedBanner.hidden=!settings.unpaired;
   $('sync-url').value=settings.url||'';$('sync-token').value='';$('sync-token').placeholder=settings.token?'Leave blank to keep saved token':'Enter sync token';
   syncEnabled=!!(settings.url&&settings.token);syncClient.configure(settings);
   settingsPanel.open=true;onboarding.hidden=syncEnabled||!!settings.onboardingDismissed;syncLocal.hidden=syncEnabled;
   if(!syncEnabled&&!settings.onboardingDismissed&&!receivingPanel)receivePairing(true);
   if(!await renewLease(true,claim))return;
   const sessionGeneration=leaseGeneration;
   if(!changed){
    await writes.flush();
    if(writes.pending){if(!writeConflict)message('Local changes are still pending. Close and reopen to retry saving.');return;}
   }
   if(!receivingPanel||receivingPanel.hidden)$('close').focus();message('Reading local progress\u2026');
   state=await db.read(identity.account);writeRevision=state.revision;persistedItems=state.items;
   resume=await db.resume(identity.account);$('filter').value=resume.filter||'all';$('sort').value=resume.sort||'original';reviewEvery.value=String(resume.reviewEvery||25);deleteMethod.value='trash';trashOptIn.checked=true;focused=resume.currentId||null;inspected=resume.inspected&&state.items.some(item=>item.mediaKey===focused)?focused:null;const missing=focused&&!state.items.some(item=>item.mediaKey===focused&&item.state==='active');if(missing){focused=null;inspected=null;}
   if(syncEnabled)await synchronize();
   if(!pageActive||document.hidden||sessionGeneration!==leaseGeneration)return;
   leaseRecoveryPending=false;
   message(missing?'Saved item is unavailable. Continuing with the next unreviewed item.':idleMessage());
  }catch(error){
   await releaseLease();identity=null;state=emptyReview();stopMedia();buffer.clear();message(error.message);
  }finally{busy=false;render();controls();}
 }
 function open(claim=false){
  if(openingPromise)return openingPromise;
  openingPromise=openSession(claim).then(()=>{refreshStalePreviews();}).finally(()=>{openingPromise=null;if(resumeOpening){resumeOpening=false;if(pageActive&&!document.hidden&&!$('overlay').hidden&&!closingPromise)open();}});
  return openingPromise;
 }
 async function closeSession(){
  sessionClosing=true;cancelLibraryFill();clearInterval(leaseTimer);leaseTimer=null;window.clearTimeout(syncTimer);syncTimer=null;
  captureVideo();persistResume();if(!sheet.hidden)suppressViewerShortcuts();sheet.hidden=true;resumeReviewPlayback=false;
  preloader.clear();finishCardAnimation();clearCardAnimation();await openingPromise;await activeOperation;await libraryLoading;await writes.flush();
  leaseGeneration++;clearInterval(leaseTimer);leaseTimer=null;
  $('overlay').hidden=true;unlockPage();reviewPanel.hidden=true;previewKey=null;renderTrashReview();$('launcher').hidden=false;$('launcher').focus();
  stopMedia();dropWarmVideo();buffer.clear();window.clearTimeout(syncTimer);
  await openingPromise;await activeOperation;
  $('overlay').hidden=true;unlockPage();reviewPanel.hidden=true;previewKey=null;renderTrashReview();$('launcher').hidden=false;stopMedia();dropWarmVideo();buffer.clear();
  try{
   if(!otherTab&&await recoverLease()){
    await writes.flush();
    await synchronize(false);
   }
  }finally{
   await releaseLease();
  }
  buffer.clear();
 }
 function close(){
  if(closingPromise)return closingPromise;
  closingPromise=closeSession().finally(()=>{sessionClosing=false;closingPromise=null;});
  return closingPromise;
 }
 function decide(decision){
  if(busy||otherTab||!identity||leaseError||$('overlay').hidden||!reviewPanel.hidden||!sheet.hidden)return;
  if(inspected&&decision==='remove'){inspected=null;render();return;}
  const item=current();if(!item)return;
  try{
  swipeFeedback.dismiss(decision);window.performance?.mark('swipe');swipeAt=window.performance?.now()??null;const previous=item.decision,next=decideReview(state,item.mediaKey,decision,previous,item.revision||0);inspected=null;focused=null;previousKey=item.mediaKey;apply({...next,history:[...(state.history||[]),{key:item.mediaKey,previous,decision,revision:(item.revision||0)+1}]},item.mediaKey);message([decision==='remove'?'Added to the local removal queue.':`Kept ${item.name}.`,readyMessage()].filter(Boolean).join(' '));
  }catch(error){message(error.message);}
 }
 async function undo(){if(busy||otherTab||!identity||leaseError||$('overlay').hidden||!reviewPanel.hidden||!sheet.hidden)return;try{const history=structuredClone(state.history||[]);while(history.length&&!canUndoReview(state,history.at(-1)))history.pop();const last=history.pop();if(!last){message('No previous decisions can be undone.');return;}const next=decideReview(state,last.key,last.previous,last.decision,last.revision);const previous=[...history].reverse().find(entry=>entry.key===last.key);const restored=next.items.find(item=>item.mediaKey===last.key);if(previous&&previous.revision===last.revision-1){const revisionOffset=restored.revision-previous.revision;for(const entry of history)if(entry.key===last.key)entry.revision+=revisionOffset;}inspected=null;focused=restored.decision===null?last.key:null;apply({...next,history});await animateCard(last.decision);clearCardAnimation();message([`Last swipe undone for ${restored.name}.`,readyMessage()].filter(Boolean).join(' '));}catch(error){message(error.message);}}
 async function load(refresh=false,cancelled=null) {
  const token=leaseGeneration;
  const assertLoadSession=()=>{if(token!==leaseGeneration||(cancelled&&sessionClosing))throw Error('Library loading session changed.');};
  const loadCall=async(operation,args)=>{assertLoadSession();const request=call(operation,args);const result=await (cancelled?Promise.race([request,cancelled]):request);assertLoadSession();return result;};
  buffer.clear();previousKey=null;
  libraryFailure=null;
  const savePage=async(next,page,cursor,refresh)=>{assertLoadSession();await syncRunning;assertLoadSession();await assertSaveAccount();assertLoadSession();state=markSyncChanges(state,mergeReviewPage(state,page,cursor,refresh));renderCard();await writes.enqueue();if(writes.pending)throw leaseError||Error('Local changes have not been saved.');return state;};
  const result=await loadReviewPages({read:async()=>state,save:savePage,call:loadCall,refresh,progress:scanned=>message(`Loading library \u00b7 ${scanned} rows checked\u2026`)});
  assertLoadSession();
  message(`${result.added} new items to review \u00b7 ${result.scanned} library rows checked${result.exhausted?' \u00b7 End of library':''}${result.warning?'. '+result.warning:''}`);
 }

 mediaElement.addEventListener('wheel',event=>{if(!$('card').classList.contains('expanded'))return;event.preventDefault();$('zoom').value=String(Math.max(1,Math.min(3,Number($('zoom').value)+(event.deltaY<0?.25:-.25))));$('zoom').oninput();},{passive:false});
 function toggleEnlarge(){swipeFeedback.reset();const before=$('card').getBoundingClientRect?.();const expanded=$('card').classList.toggle('expanded');updateVideoControls();if($('enlarge').setAttribute)$('enlarge').setAttribute('aria-label',expanded?'Exit fullscreen':'Fullscreen photo');if($('card').animate&&!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)$('card').animate([{transform:before?`translate(${before.left-$('card').getBoundingClientRect().left}px,${before.top-$('card').getBoundingClientRect().top}px) scale(${before.width/$('card').getBoundingClientRect().width},${before.height/$('card').getBoundingClientRect().height})`:'scale(.92)',transformOrigin:'top left'},{transform:'none',transformOrigin:'top left'}],{duration:350,easing:'cubic-bezier(.34,1.56,.64,1)'});refreshPreviews();}
 function refreshPreviews(){const next=underCard.querySelector('img'),candidate=state.items.find(item=>item.mediaKey===next?.dataset?.key);if(candidate)next.src=mediaURL(candidate.thumbUrl,false,previewSize());if($('overlay').hidden)return;const item=current(),media=$('media').querySelector('img')||$('media').querySelector('video');if(item&&item.mediaKey===shown&&media?.tagName===(item.type==='video'?'VIDEO':'IMG')){const url=mediaURL(item.thumbUrl,false,previewSize());if(item.type==='video')media.poster=url;else media.src=url;}preloadReview(item);}
 window.addEventListener('resize',refreshPreviews);
 $('sync-save').onclick=()=>run(async()=>{const previous=await (await pairingPromise).settings();const url=$('sync-url').value.trim();const normalized=url?new URL(url).origin:'';const settings={...previous,...validateSyncSettings(url,$('sync-token').value||(normalized===previous.url?previous.token||'':''))};if(settings.token)delete settings.unpaired;await (await pairingPromise).saveSettings({...settings,onboardingDismissed:true});$('sync-token').value='';if(settings.token)unpairedBanner.hidden=true;syncEnabled=!!(settings.url&&settings.token);onboarding.hidden=true;syncLocal.hidden=syncEnabled;syncClient.configure(settings);await synchronize();settingsPanel.open=true;message(idleMessage());});
 $('sync-local').onclick=()=>run(async()=>{const settings=await (await pairingPromise).settings();await (await pairingPromise).saveSettings({...settings,onboardingDismissed:true});onboarding.hidden=true;closeSettings();message(idleMessage());});
 let receivingPanel;
 const receivePairing=manual=>{if(!manual&&/^#pswipe-pair=([A-Za-z0-9_-]{22})(?:&origin=([^&]+))?$/.test(location.hash||'')){receivingPanel?.remove();receivingPanel=null;}else if(!manual)return;if(receivingPanel){receivingPanel.hidden=false;(receivingPanel.querySelector('#pairing-short-code')||receivingPanel.querySelector('input')).focus();return receivingPanel;}return receivingPanel=receivePairingLink({document,parent:root,location:manual?{...location,hash:''}:location,window,fetch:environment.syncFetch||environment.fetch,saveSettings:async settings=>{await (await pairingPromise).saveSettings(settings);},onPaired:async()=>{await openingPromise;await open();},onClose:suppressViewerShortcuts,manual,url:$('sync-url').value.trim()||undefined});};
 const pairThis=document.createElement('button');pairThis.textContent='Pair this device';settingsPanel.append(pairThis);pairThis.onclick=onboardPair.onclick;receivePairing(false);
 window.addEventListener('hashchange',()=>receivePairing(false));
 $('launcher').onclick=()=>open();$('close').onclick=close;$('keep').onclick=()=>decide('keep');$('remove').onclick=()=>decide('remove');$('undo').onclick=undo;$('load').onclick=()=>run(()=>load());$('refresh').onclick=()=>run(()=>load(true));$('enlarge').onclick=toggleEnlarge;
 reviewEvery.onchange=deleteMethod.onchange=()=>{trashOptIn.checked=deleteMethod.value==='trash';persistResume();render();};
 $('filter').onchange=$('sort').onchange=()=>{inspected=null;focused=null;buffer.clear();render();};
 $('zoom').oninput=()=>{swipeFeedback.reset();mediaElement.style.touchAction=Number($('zoom').value)>1?'pan-x pan-y pinch-zoom':'';const image=$('media').querySelector('img');if(image){$('card').classList.toggle('zoomed',Number($('zoom').value)>1);image.style.maxWidth='none';image.style.maxHeight='none';image.style.width=`${Number($('zoom').value)*100}%`;image.style.touchAction=Number($('zoom').value)>1?'pan-x pan-y pinch-zoom':'';}};
 $('send').onclick=()=>{if(busy)return;const confirmedKeys=[...(state.job?.mediaKeys||reviewQueue(state).map(item=>item.mediaKey))];const count=confirmedKeys.length;if(!count){message('The removal queue is empty.');return;}if(!window.confirm(`Add ${count} candidates to a private review album? This does not delete media.`))return;run(async()=>{const keys=state.job?.mediaKeys||reviewQueue(state).map(item=>item.mediaKey);if(keys.length!==confirmedKeys.length||keys.some(key=>!confirmedKeys.includes(key)))throw Error('The queue changed in another tab. Review it and confirm again.');message('Updating and verifying the review album\u2026');await sendReviewAlbum({read:async()=>state,save,call,title:'Photos Swipe \u00b7 Review'});inspected=null;message('Every candidate was verified in the review album. Choose Trash in Settings to use this panel, or open the review album to move items manually in Google Photos.');});};
 trashOptIn.onchange=()=>render();
 moveTrash.onclick=()=>{if(busy||reviewPanel.hidden||!trashOptIn.checked)return;const candidates=reviewRows().filter(item=>item.decision==='remove'),keys=candidates.map(item=>item.mediaKey);if(!keys.length){message('No candidates to move to Trash.');return;}if(!window.confirm(`Move exactly ${keys.length} items to Google Photos Trash?\n\nItems stay in Google Photos Trash for 60 days.`))return;run(async()=>{if(state.job)throw Error('Finish the saved album operation before moving items to Trash.');const currentKeys=reviewRows().filter(item=>item.decision==='remove').map(item=>item.mediaKey);if(currentKeys.length!==keys.length||currentKeys.some(key=>!keys.includes(key)))throw Error('Candidates changed. Review the item list and confirm again.');if(state.items.some(item=>keys.includes(item.mediaKey)&&!item.dedupKey))throw Error('Missing Trash identifiers. Refresh latest before retrying.');for(let index=0;index<keys.length;index+=25){const batch=keys.slice(index,index+25);await call('moveToTrash',{dedupKeys:state.items.filter(item=>batch.includes(item.mediaKey)).map(item=>item.dedupKey),confirmed:true});await save(await reconcileReviewTrash(state,call));if(state.items.some(item=>batch.includes(item.mediaKey)&&item.state!=='in_trash'))throw Error('Trash move was not verified. Check deleted items before retrying.');}reviewItems=reviewItems.filter(item=>!keys.includes(item.mediaKey));previewKey=null;renderTrashReview();message(`Verified ${keys.length} items in Trash.`);});};
 $('trash').onclick=()=>run(async()=>{message('Reading Google Photos Trash\u2026');await save(await reconcileReviewTrash(state,call));message('Trash check complete. Unknown results leave local state unchanged.');});
 for(const target of [launcherElement,overlayElement])for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','touchstart','touchmove','touchend','touchcancel','wheel','mousedown','mouseup'])target.addEventListener(type,event=>event.stopPropagation());
 for(const type of ['keydown','keyup','keypress'])overlayElement.addEventListener(type,event=>event.stopPropagation());
 launcherElement.addEventListener('click',event=>event.stopPropagation());
 const swipeFeedback=createSwipeFeedback({window,targets:[$('media'),$('swipe')],card:topCard,under:underCard,keep:stamps[0],remove:stamps[1],canSwipe:()=>!!current()&&!busy&&!otherTab&&!leaseError&&reviewPanel.hidden&&sheet.hidden&&!inspected&&!$('overlay').hidden&&Number($('zoom').value)<=1,onDecide:decide,playbackOnClick:true});
 $('overlay').addEventListener('dragstart',event=>event.preventDefault());
 $('media').addEventListener('dblclick',event=>{if(event.target.tagName!=='VIDEO')toggleEnlarge();});
 function suspendPage(){
  pageActive=false;leaseRecoveryPending=true;
  clearInterval(leaseTimer);leaseTimer=null;
  if(suspendingPromise)return suspendingPromise;
  if(!writes.pending&&!writes.flushing)return releaseLease();
  suspendingPromise=writes.flush().finally(()=>releaseLease()).finally(()=>{suspendingPromise=null;});
  return suspendingPromise;
 }
 async function resumeLease(){
  await suspendingPromise;await activeOperation;await syncRunning;
  if(!leaseRecoveryPending)await refreshLease();
  await libraryLoading;
  if(!pageActive||document.hidden||!identity||$('overlay').hidden||closingPromise)return;
  startRenewal();await refreshLease();refreshStalePreviews();
 }
 function leavePage(){
  suspendPage();
  stopMedia();dropWarmVideo();buffer.clear();window.clearTimeout(syncTimer);
 }
 window.addEventListener('pagehide',leavePage);
 window.addEventListener('unload',leavePage);
 window.addEventListener('focus',async()=>{if(identity&&!busy&&!activeOperation&&!$('overlay').hidden){await refreshLease();if(!otherTab)await synchronize();}});
 document.addEventListener?.('visibilitychange',()=>{if(document.hidden){captureVideo();suspendPage();buffer.clear();if(warmedVideo){warmedVideo.removeAttribute('src');warmedVideo.load();warmedVideo=null;warmedKey=null;}}else{pageActive=true;if(openingPromise&&!$('overlay').hidden)resumeOpening=true;else if(leaseRecoveryPending&&!identity&&!$('overlay').hidden&&!closingPromise)open();if(identity&&!$('overlay').hidden)resumeLease();}});
 window.addEventListener('pageshow',()=>{pageActive=true;if(!document.hidden&&!$('overlay').hidden){if(openingPromise)resumeOpening=true;return open();}});
 const activePairingDialog=()=>!pairingModal.modal.hidden?pairingModal.modal:receivingPanel&&!receivingPanel.hidden?receivingPanel:null;
 function editingFieldFocused(event){
  const editable=element=>['INPUT','SELECT','TEXTAREA'].includes(element?.tagName)||element?.isContentEditable;
  const focused=[document.activeElement,root.activeElement];
  for(let index=0;index<focused.length;index++){const nested=focused[index]?.shadowRoot?.activeElement;if(nested)focused.push(nested);}
  return [...focused,event.target,...(event.composedPath?.()||[])].some(editable);
 }
 function handleViewerSpace(event){
  if(activePairingDialog()||!sheet.hidden||!reviewPanel.hidden)return false;
  if($('overlay').hidden||event.altKey||event.ctrlKey||event.metaKey||event.isComposing||event.key!==' ')return false;
  if(editingFieldFocused(event))return false;
  event.preventDefault();event.stopImmediatePropagation();
  if(Date.now()<viewerShortcutsBlockedUntil)return true;
  const video=$('media').querySelector('video');
  if(video&&event.type==='keydown'&&!event.repeat){if(video.paused)video.play().catch(()=>{});else video.pause();}
  return true;
 }
 window.addEventListener('keyup',handleViewerSpace,true);
 window.addEventListener('keydown',event=>{
  const dialog=activePairingDialog();
  if(dialog){if(event.key==='Tab'){const focusable=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled)')].filter(element=>element.getClientRects().length);const index=focusable.indexOf(root.activeElement),next=event.shiftKey?(index<=0?focusable.length-1:index-1):(index+1)%focusable.length;event.preventDefault();event.stopImmediatePropagation();focusable[next]?.focus();}else if(!dialog.contains(root.activeElement)){event.preventDefault();event.stopImmediatePropagation();dialog.querySelector('button:not(:disabled),input:not(:disabled)')?.focus();}if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();if(dialog===pairingModal.modal)pairingModal.close();else dialog.onkeydown(event);}return;}
  if(event.key==='Escape'&&!$('overlay').hidden){event.preventDefault();event.stopImmediatePropagation();if(!sheet.hidden)closeSettings();else if(!reviewPanel.hidden){if(previewKey){previewKey=null;renderTrashReview();}else{reviewPanel.hidden=true;renderTrashReview();reviewButton.focus();}}else if($('card').classList.contains('expanded'))toggleEnlarge();else close();return;}
  if((!sheet.hidden||!reviewPanel.hidden)&&event.key!=='Tab'){event.stopImmediatePropagation();return;}
  if(handleViewerSpace(event))return;
  if($('overlay').hidden||event.altKey||event.ctrlKey||event.metaKey||event.isComposing)return;
  if(event.key==='Tab'){
   const focusable=[...(!sheet.hidden?sheet:!reviewPanel.hidden?(reviewPanel.querySelector('.trash-preview')||reviewPanel):overlayElement).querySelectorAll('button:not(:disabled),select,input,a[href],summary,video[controls]')].filter(element=>element.getClientRects().length);
   const index=focusable.indexOf(root.activeElement),next=event.shiftKey?(index<=0?focusable.length-1:index-1):(index+1)%focusable.length;
   event.preventDefault();event.stopImmediatePropagation();focusable[next]?.focus();return;
  }
  if(Date.now()<viewerShortcutsBlockedUntil||editingFieldFocused(event))return;
  const actions={ArrowLeft:()=>decide('remove'),ArrowRight:()=>decide('keep'),z:undo,Z:undo,f:toggleEnlarge,F:toggleEnlarge,Escape:close};
  if(actions[event.key]){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat||!['ArrowLeft','ArrowRight','z','Z'].includes(event.key))actions[event.key]();}
 },true);
}

const pageWindow=typeof unsafeWindow==='undefined'?window:unsafeWindow;
const environment={version:typeof photosSwipeReleaseVersion==='undefined'?"1.2.46":photosSwipeReleaseVersion,window:pageWindow,document,location,GM:typeof GM==='undefined'?undefined:GM,fetch:pageWindow.fetch.bind(pageWindow),syncFetch:typeof fetch==='undefined'?window.fetch.bind(window):fetch.bind(globalThis),crypto:window.crypto,indexedDB:pageWindow.indexedDB,AbortController:pageWindow.AbortController,setTimeout:window.setTimeout.bind(window),clearTimeout:window.clearTimeout.bind(window)};
if(!pageWindow.WIZ_global_data?.SNlM0e||!pageWindow.WIZ_global_data?.oPEP7c)environment.photosCall=createPagePhotosBridge(environment);
mountPhotosSwipe(environment);
})();
