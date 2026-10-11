// ==UserScript==
// @name Photos Swipe
// @author sidlakkoju
// @namespace https://github.com/sidlakkoju/GooglePhotosSwiper
// @version 1.2.17
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
  if(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
  const start=element.style.transform||'translateX(0px)',direction=dx>0?1:-1;
  const distance=(globalThis.innerWidth||1000)+(element.getBoundingClientRect?.().width||350);
  return element.animate?.([{transform:start,opacity:1},{transform:commit?`translateX(${direction*distance}px) rotate(${direction*18}deg)`:'translateX(0px)',opacity:commit?0:1}],{duration,easing:commit?'ease-out':'cubic-bezier(.2,1.5,.5,1)'});
}
function throwSwipe(element,dx,duration){
  if(!element.cloneNode||!element.ownerDocument?.body)return;
  const transform=element.style.transform,transition=element.style.transition;
  element.style.transition='none';
  element.style.transform='none';
  const rect=element.getBoundingClientRect();
  element.style.transform=transform;
  element.style.transition=transition;
  const copy=element.cloneNode(true);
  if(globalThis.getComputedStyle){
    const originals=[element,...element.querySelectorAll('*')],copies=[copy,...copy.querySelectorAll('*')];
    originals.forEach((original,index)=>{const computed=globalThis.getComputedStyle(original);for(const property of computed)copies[index].style.setProperty(property,computed.getPropertyValue(property));});
  }
  copy.removeAttribute('id');
  for(const child of copy.querySelectorAll('[id]'))child.removeAttribute('id');
  copy.setAttribute('aria-hidden','true');
  copy.inert=true;
  Object.assign(copy.style,{position:'fixed',left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`,margin:'0',boxSizing:'border-box',right:'auto',bottom:'auto',transform,pointerEvents:'none',zIndex:'2147483647',transition:'none'});
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
const reviewDeck = state => state.items.filter(item=>!item.decision&&item.state!=='in_trash');
const reviewQueue = state => state.items.filter(item=>item.decision==='remove'&&!item.queueSent&&item.state!=='in_trash');
const reviewTrashCandidates = state => state.items.filter(item=>item.decision==='remove'&&item.state!=='in_trash');
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
 for(const item of page.items){const old=items.get(item.mediaKey);items.set(item.mediaKey,{...old,...item,urlFetchedAt:Date.now(),decision:old?.decision??null,queueSent:old?.queueSent??false,albumKey:old?.albumKey??null,state:'active',revision:(old?.revision||0)+(old&&old.state!=='active'?1:0)});}
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
 return {...state,items};
}
async function loadReviewPages({read,save,call,refresh=false,progress=()=>{},target=50,maxPages=12}) {
 let state=await read();
 const before=new Set(reviewDeck(state).map(item=>item.mediaKey)),seen=new Set(state.cursor?[state.cursor]:[]);
 let scanned=0,added=0,warning='',limited=false;
 if(!refresh&&state.exhausted)return {scanned,added,warning,limited,exhausted:true};
 for(let count=0;count<maxPages;count++){
  progress(scanned);
  const cursor=refresh?null:state.cursor,page=await call('library',{cursor});
  if(!refresh&&page.nextPageId&&seen.has(page.nextPageId))throw Error('Google repeated a library page. Reload before retrying.');
  state=await save(mergeReviewPage(state,page,cursor,refresh));scanned+=page.items.length;warning=page.metadataWarning||warning;added=reviewDeck(state).filter(item=>!before.has(item.mediaKey)).length;
  if(refresh||state.exhausted||added>=target)break;
  seen.add(state.cursor);limited=count===maxPages-1;
 }
 return {scanned,added,warning,limited,exhausted:state.exhausted};
}

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
  settings:async()=>await transaction('settings','sync')||{},
  deleteSettings:()=>transaction('settings','sync',()=>undefined),
  saveSettings:value=>transaction('settings','sync',()=>value),
  read:async account=>(await transaction('accounts',account))||emptyReview(),
  save:(account,state)=>transaction('accounts',account,current=>{
   if((current?.revision||0)!==state.revision)throw Error('Progress changed in another tab. Reopen Photos Swipe and retry.');
   return {...state,revision:state.revision+1};
  }),
  lease:(account,owner,release=false)=>transaction('leases',account,current=>{
   if(current?.owner!==owner&&current?.expires>Date.now())throw Error('Photos Swipe is busy in another tab. Try again when it finishes.');
   return {owner,expires:release?0:Date.now()+90000};
  })
 };
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
 async function sync(scope,state,save) {
  if(blocked||!settings.url||!settings.token)return state;
  let retryAvailable=firstSync;firstSync=false;
  const syncRequest=async(...args)=>{
   try{return await request(...args);}catch(error){
    if(error.name!=='TimeoutError'||!retryAvailable)throw error;
    retryAvailable=false;return request(...args);
   }
  };
  status('Syncing\u2026');
  try {
   const remote=await syncRequest(scope,'api/state');
   const decisions={...Object.fromEntries(remote.decisions.map(item=>[item.id,item.decision]))};
   const pending={...state.syncPending};
   if(state.syncDecisions==null)for(const item of state.items)if(item.decision&&!Object.hasOwn(pending,item.mediaKey))pending[item.mediaKey]=item.decision;
   const dirty=state.syncDirty||!state.syncDecisions&&state.history.length>0;
   for(const [id,value] of Object.entries(pending)){
    await syncRequest(scope,`api/decisions/${encodeURIComponent(id)}`,value===null?'DELETE':'PUT',value===null?undefined:{decision:value});
    if(value===null)delete decisions[id];else decisions[id]=value;
   }
   const history=(dirty?state.history:remote.history).slice(-2000);
   const items=state.items.map(item=>{
    const value=Object.hasOwn(pending,item.mediaKey)?pending[item.mediaKey]:decisions[item.mediaKey]??(Object.hasOwn(state.syncDecisions||{},item.mediaKey)?null:item.decision);
    const entry=history.findLast(entry=>entry.key===item.mediaKey&&entry.decision===value);
    return {...item,decision:value,revision:!dirty&&entry&&(value!==item.decision||!item.revision)?entry.revision:item.revision};
   });
   let next={...state,history,items,syncDecisions:decisions};
   if(dirty){
    await syncRequest(scope,'api/undo','PUT',{history});
    await syncRequest(scope,'api/progress','PUT',{started:state.started,reviewed:Object.keys(decisions).length});
   }
   next=await save({...next,syncPending:{},syncDirty:false,syncProgress:remote.progress});
   status(`Synced \u00b7 ${Object.keys(decisions).length} reviewed IDs${remote.suggestRevokeLegacy?' \u00b7 Device paired; retire the exposed shared sync token.':''}`);return next;
  }catch(error){if(!blocked)status(`${error.message} \u00b7 saved locally; retry on next action`);return state;}
 }
 return {configure,sync,devices:()=>request('default','api/devices'),rename:(id,name)=>request('default',`api/devices/${encodeURIComponent(id)}`,'PATCH',{name}),revoke:id=>request('default',`api/devices/${encodeURIComponent(id)}`,'DELETE'),revokeOthers:()=>request('default','api/devices/revoke-others','POST'),async pair(url,code,name,platform){
  const response=await fetch(new URL('api/pair/claim',url).href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({short:code,name,platform}),credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error(`Pairing HTTP ${response.status}`);
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

async function createPairingStore({GM,database,crypto}) {
 const durable=!!GM&&['getValue','setValue','deleteValue'].every(name=>typeof GM[name]==='function');
 const key='photos-swipe-pairing';
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
  return {...(!complete(value)?select({...legacy,token:undefined}):{}),...select(value),onboardingDismissed:legacy.onboardingDismissed,unpaired:legacy.unpaired};
 }
 async function saveSettings(value) {
  const db=await database();
  if(!durable)return db.saveSettings(value);
  if(value.url&&value.token)await GM.setValue(key,{...select(value),deviceId:value.deviceId||crypto.randomUUID()});
  else await GM.deleteValue(key);
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

function createSwipeFeedback({window,targets,card,under,keep,remove,canSwipe,onDecide}) {
 let gesture=null,frame=null,animation=null,dismissing=false,finished=Promise.resolve();
 const reduced=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;
 const eligible=({dx,dy})=>Math.abs(dx)>Math.abs(dy)*1.5;
 const commits=value=>value.locked&&eligible(value)&&(Math.abs(value.dx)>=value.width*.33||Math.abs(value.velocity)>.5&&Math.sign(value.velocity)===Math.sign(value.dx))&&canSwipe();
 const paint=()=>{
  frame=null;
  if(!gesture?.locked)return;
  const {dx,dy,width}=gesture,progress=eligible(gesture)?Math.min(1,Math.abs(dx)/(width*.33)):0;
  card.style.transform=reduced()?'':`translate3d(${dx}px,${dy*.2}px,0) rotate(${Math.max(-15,Math.min(15,dx/width*15))}deg) scale(1.02)`;
  keep.style.opacity=String(dx>0?progress:0);
  remove.style.opacity=String(dx<0?progress:0);
  under.style.transform=`scale(${.94+.06*progress})`;
 };
 const release=()=>{
  const previous=gesture;
  gesture=null;
  if(frame!==null)window.cancelAnimationFrame?.(frame);
  frame=null;
  if(previous?.target.hasPointerCapture?.(previous.id))previous.target.releasePointerCapture(previous.id);
 };
 const reset=()=>{
  release();animation?.cancel();animation=null;dismissing=false;finished=Promise.resolve();
  card.style.transform='';card.style.willChange='';card.style.visibility='';
  keep.style.opacity='0';remove.style.opacity='0';under.style.transform='scale(.94)';
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
  dismissing=true;release();
  const direction=decision==='keep'?1:-1,width=card.getBoundingClientRect?.().width||card.offsetWidth||300;
  keep.style.opacity=decision==='keep'?'1':'0';remove.style.opacity=decision==='remove'?'1':'0';under.style.transform='scale(1)';
  const destination=reduced()?'':`translate3d(${direction*(Math.max(window.innerWidth||0,width)*1.5)}px,0,0) rotate(${direction*15}deg)`;
  if(card.cloneNode&&card.parentNode&&!reduced()){
   const outgoing=card.cloneNode(true);
   outgoing.setAttribute('aria-hidden','true');outgoing.inert=true;
   for(const element of outgoing.querySelectorAll?.('[id]')||[])element.removeAttribute('id');
   outgoing.style.position='absolute';outgoing.style.inset='0';outgoing.style.pointerEvents='none';outgoing.style.zIndex='3';
   card.parentNode.append(outgoing);
   card.style.visibility='hidden';
   const flight=outgoing.animate?.([{transform:card.style.transform||'none'},{transform:destination}],{duration:180,easing:'ease-out'});
   outgoing.style.transform=destination;
   finished=flight?flight.finished.catch(()=>{}).then(()=>outgoing.remove()):Promise.resolve(outgoing.remove());
   return finished;
  }
  return animate(destination);
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
   if(Math.abs(gesture.dy)>=Math.abs(gesture.dx)){reset();return;}
   gesture.locked=true;card.style.willChange='transform';
  }
  if(frame===null){if(window.requestAnimationFrame)frame=window.requestAnimationFrame(paint);else paint();}
 };
 const finishGesture=event=>{
   if(!gesture||event.pointerId!==gesture.id)return;
   update(event);
   if(!gesture)return;
   const value=gesture,commit=commits(value);
   if(commit){paint();release();dismiss(value.dx>0?'keep':'remove');onDecide(value.dx>0?'keep':'remove');}
   else {
    const transform=card.style.transform;
    reset();card.style.transform=transform;animate('');
    if(!value.locked&&Math.hypot(value.dx,value.dy)<10&&value.video){if(value.video.paused)value.video.play().catch(()=>{});else value.video.pause();}
   }
 };
 window.addEventListener?.('pointermove',update,true);
 window.addEventListener?.('pointerup',finishGesture,true);
 window.addEventListener?.('pointercancel',event=>{if(gesture&&event.pointerId===gesture.id)reset();},true);
 for(const target of targets){
  target.addEventListener('pointerdown',event=>{
   if(gesture||dismissing||!canSwipe()||event.isPrimary===false||event.button!==0)return;
   animation?.cancel();animation=null;
   gesture={id:event.pointerId,x:event.clientX,y:event.clientY,dx:0,dy:0,samples:Number.isFinite(event.timeStamp)?[{dx:0,time:event.timeStamp}]:[],velocity:0,width:card.getBoundingClientRect?.().width||card.offsetWidth||300,target,video:event.target.tagName==='VIDEO'?event.target:null,locked:false};
   target.setPointerCapture(event.pointerId);
  });
  target.addEventListener('pointermove',update);
  target.addEventListener('pointerup',finishGesture);
  for(const type of ['pointercancel'])target.addEventListener(type,event=>{if(gesture&&event.pointerId===gesture.id)reset();});
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

function createPairingModal({document,parent,fetch,settings,setTimeout,clearTimeout,now=Date.now,renderQR=renderPairingQR}) {
 const modal=document.createElement('section');modal.hidden=true;modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','Pair another device');modal.style.cssText='position:fixed;inset:0;overflow:auto;background:#f4f7f1;padding:24px;z-index:1;pointer-events:auto';
 const status=document.createElement('p'),qr=document.createElement('div'),short=document.createElement('p'),countdown=document.createElement('p'),cancel=document.createElement('button'),renew=document.createElement('button'),devices=document.createElement('button');
 status.setAttribute('role','status');cancel.textContent='Cancel';renew.textContent='New code';devices.textContent='View devices';modal.append(status,qr,short,countdown,cancel,renew,devices);parent.append(modal);
 let generation=0,current=null,timer=null,credentials=null,nextPollAt=0,polling=false,pendingStatus=null;
 const request=async(path,method='GET',body)=>{
  const response=await fetch(new URL('/api/'+path,credentials.url).href,{method,headers:{Authorization:`Bearer ${credentials.token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error(response.status===401?'Pair this device first.':`Pairing request failed (${response.status})`);
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
  if(version===generation){current=null;modal.hidden=true;}
 };
 cancel.onclick=close;renew.onclick=start;modal.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
 devices.onclick=async()=>{try{const result=await request('devices');status.textContent='Devices';qr.replaceChildren();for(const device of result.devices.filter(device=>!device.revoked_at)){const row=document.createElement('p');row.textContent=device.name+' ('+device.platform+')';qr.append(row);}}catch(error){status.textContent=error.message;}};
 return {open,close,modal};
}
function receivePairingLink({document,parent,location,window,fetch,saveSettings,onPaired,manual=false,url='https://photoswiper-sync.sidlakkoju.workers.dev'}) {
 const match=location.hash?.match(/^#pswipe-pair=([A-Za-z0-9_-]{22})(?:&origin=([^&]+))?$/);if(!match&&!manual)return;
 if(match)window.history.replaceState(null,'',location.pathname+location.search);
 const panel=document.createElement('section'),name=document.createElement('input'),button=document.createElement('button'),status=document.createElement('p'),shortCode=document.createElement('input'),origin=document.createElement('input'),cancel=document.createElement('button');
 panel.style.cssText='position:fixed;inset:0;background:#f4f7f1;padding:24px;pointer-events:auto;z-index:2';name.value=/iPhone/.test(window.navigator?.userAgent||'')?'iPhone (Safari)':'New browser';name.setAttribute('aria-label','Device name');button.textContent='Pair this device';panel.append(name,button,status);if(manual){shortCode.setAttribute('aria-label','Six-digit pairing code');shortCode.inputMode='numeric';shortCode.maxLength=7;origin.setAttribute('aria-label','Worker origin');origin.type='url';origin.value=url;panel.append(shortCode,origin);}cancel.textContent='Cancel';cancel.onclick=()=>{panel.hidden=true;};panel.onkeydown=event=>{if(event.key==='Escape')cancel.onclick();};panel.append(cancel);panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Pair this device');parent.append(panel);name.focus();
 button.onclick=async()=>{button.disabled=true;try{const worker=new URL(match?.[2]?decodeURIComponent(match[2]):manual?origin.value:url);if(worker.protocol!=='https:'||worker.username||worker.password)throw Error('Enter a valid HTTPS Worker origin.');const claimedURL=worker.origin;const response=await fetch(claimedURL+'/api/pair/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...(match?{code:match[1]}:{short:shortCode.value.replace(/\s/g,'')}),name:name.value,platform:window.navigator?.platform||'browser'}),credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('Code expired or unavailable. Ask the paired device for a new code.');const result=await response.json();await saveSettings({url:claimedURL,token:result.token,onboardingDismissed:true});panel.hidden=true;await onPaired();}catch(error){status.textContent=error.message;button.disabled=false;}};
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

function mountPhotosSwipe(environment) {
 const {window,document,location}=environment;
 if(window.top!==window||location.origin!=='https://photos.google.com'||document.getElementById('photos-swipe-userscript-host'))return;
 const rawCall=environment.photosCall||createPhotosAPI(environment),owner=environment.crypto.randomUUID();
 const host=document.createElement('div');host.id='photos-swipe-userscript-host';
 host.style.cssText='position:fixed;inset:0;z-index:2147483647;pointer-events:none';
 const root=host.attachShadow({mode:'open'});
 const styleElement1=document.createElement('style');
 root.append(styleElement1);
 styleElement1.append(document.createTextNode(":host{all:initial;--ps-bg:#F2F2F7;--ps-surface:rgba(255,255,255,.72);--ps-surface-solid:#FFF;--ps-fill:rgba(120,120,128,.12);--ps-label:#000;--ps-label2:rgba(60,60,67,.6);--ps-sep:rgba(60,60,67,.18);--ps-accent:#007AFF;--ps-destructive:#FF3B30;--ps-on-action:#FFF;--ps-shadow-color:rgba(0,0,0,.12);--ps-r-sm:10px;--ps-r-md:16px;--ps-r-lg:24px;--ps-r-pill:999px;--ps-s1:4px;--ps-s2:8px;--ps-s3:12px;--ps-s4:16px;--ps-s5:24px;--ps-s6:32px;--ps-font:-apple-system,BlinkMacSystemFont,\"SF Pro Text\",system-ui,Inter,sans-serif;--ps-t-large:600 28px/34px var(--ps-font);--ps-t-title:600 20px/25px var(--ps-font);--ps-t-body:400 17px/22px var(--ps-font);--ps-t-callout:500 15px/20px var(--ps-font);--ps-t-caption:400 12px/16px var(--ps-font);font:var(--ps-t-body);color:var(--ps-label);color-scheme:light}@media(prefers-color-scheme:dark){:host{--ps-bg:#000;--ps-surface:rgba(28,28,30,.72);--ps-surface-solid:#1C1C1E;--ps-fill:rgba(120,120,128,.24);--ps-label:#FFF;--ps-label2:rgba(235,235,245,.6);--ps-sep:rgba(84,84,88,.6);--ps-accent:#0A84FF;--ps-destructive:#FF453A;--ps-shadow-color:rgba(0,0,0,.5);color-scheme:dark}}*{box-sizing:border-box}button,select,input{font:var(--ps-t-callout);appearance:none;-webkit-appearance:none;color:var(--ps-label);background:var(--ps-surface-solid);border:1px solid var(--ps-sep);border-radius:var(--ps-r-sm);padding:var(--ps-s2) var(--ps-s3);accent-color:var(--ps-accent)}button,a,select{touch-action:manipulation}button{min-height:44px;border:0;background:var(--ps-fill);padding:10px 16px;cursor:pointer}button:disabled{opacity:.5;cursor:wait}button:focus-visible,a:focus-visible,select:focus-visible,input:focus-visible{outline:3px solid var(--ps-accent);outline-offset:2px}a{color:var(--ps-accent)}p{margin:8px 0;overflow-wrap:anywhere}[hidden]{display:none!important}.launcher{pointer-events:auto;position:absolute;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));background:var(--ps-accent);color:var(--ps-on-action);box-shadow:0 3px 20px var(--ps-shadow-color)}.overlay{pointer-events:auto;position:absolute;inset:0;background:var(--ps-bg);overflow:auto;overscroll-behavior:contain;padding:calc(12px + env(safe-area-inset-top)) 12px calc(18px + env(safe-area-inset-bottom))}.content{max-width:850px;margin:auto}header,.actions,.toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}header{justify-content:space-between}h1{font:var(--ps-t-large);margin:0}.account{font:var(--ps-t-caption);color:var(--ps-label2)}.card{margin-top:12px;background:var(--ps-surface-solid);border-radius:var(--ps-r-lg);position:relative}.media{height:48vh;height:48dvh;min-height:180px;display:flex;align-items:center;justify-content:center;overflow:auto}.media img,.media video{display:block;max-width:100%;max-height:100%;object-fit:contain}.media img{pointer-events:none;}.media img,.media video{touch-action:pan-y pinch-zoom;user-select:none;-webkit-user-drag:none}.card.expanded .media{height:72vh;height:72dvh}.caption{padding:10px 14px}.swipe{color:var(--ps-label2);text-align:center;padding:12px;touch-action:pan-y pinch-zoom;background:var(--ps-fill)}.actions{justify-content:center;margin:12px 0}.stats{padding:12px;background:var(--ps-fill);border-radius:var(--ps-r-sm);margin:12px 0}.toolbar{margin:10px 0}select{max-width:100%;min-height:44px}details{margin:16px 0}#sync-local{display:block}#sync-settings>label{display:block;width:100%;margin:12px 0}#sync-settings>label>input{display:block;width:100%;min-width:0;margin-top:4px}.queue{display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px}.queue button{padding:6px;overflow:hidden}.queue img{width:100%;height:75px;object-fit:cover}.queue span{display:block;font:var(--ps-t-caption);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.status{min-height:24px}.zoom-control,.trash-toggle{display:flex;align-items:center;gap:8px;white-space:nowrap}#zoom{width:120px;min-width:0;min-height:44px}#history-list li{overflow-wrap:anywhere}#undo-preview{font-size:13px;min-width:0;flex-basis:100%} @media(max-width:599px){.overlay{scrollbar-gutter:stable;padding-right:18px}.actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.actions button{padding:8px}#undo-preview{grid-column:1 / -1;grid-row:2;margin:0}.zoom-control{grid-column:span 2}.zoom-control input{flex:1}.library-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.library-controls>*{width:100%;min-width:0}.album-controls{position:relative;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;padding:8px 0 calc(8px + env(safe-area-inset-bottom));margin-bottom:0}.album-controls button{padding:8px;font-size:14px;min-width:0;white-space:normal;overflow-wrap:anywhere}.album-controls a,.album-explanation{grid-column:1 / -1;min-width:0}.album-explanation{margin:0;font-size:13px}.trash-toggle{min-height:44px;font-size:14px;white-space:normal;min-width:0}.trash-toggle input{flex-shrink:0}.media{height:32vh;height:32dvh}.stats{font-size:14px;padding:8px}} @media(min-width:800px){.media{height:55vh}.overlay{padding:24px}}h2{font:var(--ps-t-title)}.status,#sync-status,.album-explanation{color:var(--ps-label2)}select{padding-right:var(--ps-s6);background-image:linear-gradient(45deg,transparent 50%,var(--ps-label2) 50%),linear-gradient(135deg,var(--ps-label2) 50%,transparent 50%);background-position:calc(100% - 15px) 50%,calc(100% - 10px) 50%;background-size:5px 5px;background-repeat:no-repeat}input[type=checkbox]{width:22px;height:22px;min-width:22px;padding:0;display:grid;place-content:center}input[type=checkbox]:checked{background:var(--ps-accent);border-color:var(--ps-accent)}input[type=checkbox]:checked::before{content:'\u2713';color:var(--ps-on-action)}input[type=range]{padding:0;background:transparent;border:0}input[type=range]::-webkit-slider-runnable-track{height:4px;background:var(--ps-fill);border-radius:var(--ps-r-pill)}input[type=range]::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:22px;height:22px;margin-top:-9px;border:0;border-radius:var(--ps-r-pill);background:var(--ps-accent)}input[type=range]::-moz-range-track{height:4px;background:var(--ps-fill);border-radius:var(--ps-r-pill)}input[type=range]::-moz-range-thumb{width:22px;height:22px;border:0;border-radius:var(--ps-r-pill);background:var(--ps-accent)}.keep,.remove{background:var(--ps-surface-solid)}.keep{color:var(--ps-accent)}.remove{color:var(--ps-destructive)}#move-trash{background:var(--ps-destructive);color:var(--ps-on-action)}.album-controls,#sync-settings{background:var(--ps-surface-solid);border-radius:var(--ps-r-md)}#sync-settings{padding:var(--ps-s3)}@supports ((backdrop-filter:blur(20px)) or (-webkit-backdrop-filter:blur(20px))){.album-controls,#sync-settings{background:var(--ps-surface);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}}"));
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
 const feedbackStyles=document.createElement('style');feedbackStyles.textContent='.card{overflow:hidden}.top-card{position:relative;z-index:1}.media{position:relative;z-index:1;background:var(--ps-surface-solid);border-radius:var(--ps-r-lg);touch-action:pan-y pinch-zoom;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}.under-card{position:absolute;inset:0 0 auto;z-index:0;pointer-events:none;transform:scale(.94)}.swipe-stamp{position:absolute;top:24px;z-index:2;padding:8px 14px;border:4px solid currentColor;border-radius:8px;font-size:28px;font-weight:800;opacity:0;pointer-events:none}.stamp-keep{left:24px;color:var(--ps-accent);transform:rotate(-12deg)}.stamp-remove{right:24px;color:var(--ps-destructive);transform:rotate(12deg)}.card.expanded .media{touch-action:pan-x pan-y pinch-zoom}';root.append(feedbackStyles);
 const swipeElement=document.createElement('div');
 swipeElement.setAttribute("class","swipe");
 swipeElement.setAttribute("id","swipe");
 cardElement.append(swipeElement);
 swipeElement.append(document.createTextNode("Swipe left to queue \u00b7 right to keep"));
 const captionElement=document.createElement('p');
 captionElement.setAttribute("class","caption");
 captionElement.setAttribute("id","caption");
 cardElement.append(captionElement);
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
 const syncLocal=document.createElement('button');syncLocal.setAttribute('id','sync-local');syncLocal.textContent='Continue locally';settingsPanel.append(syncLocal);
 for(const [id,title,type] of [['sync-url','Sync URL','url'],['sync-token','Sync token','password']]){const label=document.createElement('label'),input=document.createElement('input');label.textContent=title+' ';input.setAttribute('id',id);input.type=type;input.autocomplete='off';label.append(input);settingsPanel.append(label);}
 const syncSave=document.createElement('button');syncSave.setAttribute('id','sync-save');syncSave.textContent='Save and sync';settingsPanel.append(syncSave);
 const pairAnother=document.createElement('button');pairAnother.textContent='Pair another device';pairAnother.setAttribute('id','pair-another');settingsPanel.append(pairAnother);
 const pairingModal=createPairingModal({document,parent:root,fetch:environment.syncFetch||environment.fetch,settings:async()=>(await pairingPromise).settings(),setTimeout:environment.setTimeout,clearTimeout:environment.clearTimeout});pairAnother.onclick=pairingModal.open;
 const syncStatus=document.createElement('p');syncStatus.setAttribute('id','sync-status');syncStatus.setAttribute('role','status');divElement4.insertBefore(settingsPanel,cardElement);divElement4.insertBefore(syncStatus,cardElement);
 const unpairedBanner=document.createElement('div');unpairedBanner.setAttribute('id','unpaired-banner');unpairedBanner.setAttribute('role','alert');unpairedBanner.hidden=true;
 const unpairedText=document.createElement('span');unpairedText.textContent='This device was unpaired.';
 const pairAgain=document.createElement('button');pairAgain.setAttribute('id','pair-again');pairAgain.textContent='Pair again';
 const dismissUnpaired=document.createElement('button');dismissUnpaired.setAttribute('id','dismiss-unpaired');dismissUnpaired.textContent='Dismiss';unpairedBanner.append(unpairedText,pairAgain,dismissUnpaired);divElement4.insertBefore(unpairedBanner,cardElement);
 const pairingPanel=document.createElement('details');pairingPanel.setAttribute('id','enter-pairing-code');const pairingTitle=document.createElement('summary');pairingTitle.textContent='Enter pairing code';pairingPanel.append(pairingTitle);
 for(const [id,title] of [['pair-code','Pairing code'],['pair-name','Device name']]){const label=document.createElement('label'),input=document.createElement('input');input.setAttribute('id',id);label.textContent=title;label.append(input);pairingPanel.append(label);}
 const pairSubmit=document.createElement('button');pairSubmit.setAttribute('id','pair-submit');pairSubmit.textContent='Pair and sync';pairingPanel.append(pairSubmit);settingsPanel.append(pairingPanel);
 const devicesPanel=document.createElement('details');devicesPanel.setAttribute('id','paired-devices');const devicesTitle=document.createElement('summary');devicesTitle.textContent='Paired devices';
 const devicesList=document.createElement('div');devicesList.setAttribute('id','devices-list');const refreshDevices=document.createElement('button');refreshDevices.setAttribute('id','refresh-devices');refreshDevices.textContent='Refresh devices';
 const revokeOthers=document.createElement('button');revokeOthers.setAttribute('id','revoke-other-devices');revokeOthers.textContent='Revoke all other devices';devicesPanel.append(devicesTitle,refreshDevices,devicesList,revokeOthers);settingsPanel.append(devicesPanel);
 const pairedNotice=document.createElement('button');pairedNotice.setAttribute('id','paired-notice');pairedNotice.textContent='New device paired \u00b7 View paired devices';pairedNotice.hidden=true;divElement4.insertBefore(pairedNotice,cardElement);
 const historyPanel=document.createElement('details');historyPanel.setAttribute('id','history-details');
 const historyTitle=document.createElement('summary');historyTitle.textContent='Decision history';
 const undoPreview=document.createElement('p');undoPreview.setAttribute('id','undo-preview');
 const historyList=document.createElement('ol');historyList.setAttribute('id','history-list');
 historyPanel.append(historyTitle,historyList);divElement13.insertBefore(undoPreview,enlargeElement);divElement4.insertBefore(historyPanel,queue_detailsElement);
 document.documentElement.append(host);
 const $=id=>root.getElementById(id);
 let dbPromise,db,state=emptyReview(),identity,busy=false,inspected=null,focused=null,shown=null,generation=0,leaseError=null,lockedAccount=null,syncEnabled=false,syncSummary='Sync off \u00b7 saved locally';
 const database=()=>dbPromise||(dbPromise=openReviewDatabase(environment.indexedDB).catch(error=>{dbPromise=null;throw error;}));
 const pairingNotice=document.createElement('p');settingsPanel.append(pairingNotice);
 const pairingPromise=createPairingStore({GM:environment.GM,database,crypto:environment.crypto}).then(async store=>{
  if(!store.durable)pairingNotice.textContent='Pairing may not persist in this browser';
  try{await store.settings();}catch(error){pairingNotice.textContent=`Pairing storage unavailable: ${error.message}`;}
  return store;
 });
 const clearCredentials=async()=>{const settings=await (await pairingPromise).settings();await (await pairingPromise).saveSettings({...settings,token:'',unpaired:true});$('sync-token').value='';syncEnabled=false;unpairedBanner.hidden=false;};
 const syncClient=createSyncClient({fetch:environment.syncFetch||environment.fetch,unpaired:clearCredentials,status:value=>{syncSummary=value;$('sync-status').textContent=value;pairedNotice.hidden=!value.includes('Device paired');}});
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
 pairAgain.onclick=()=>{settingsPanel.open=true;pairingPanel.open=true;$('pair-code').focus();};dismissUnpaired.onclick=()=>{unpairedBanner.hidden=true;};pairedNotice.onclick=()=>{settingsPanel.open=true;devicesPanel.open=true;return run(showDevices);};
 pairSubmit.onclick=()=>run(async()=>{const url=validateSyncSettings($('sync-url').value.trim(),'pairing').url,code=$('pair-code').value.trim(),name=$('pair-name').value.trim();if(!/^\d{6}$/.test(code))throw Error('Enter a six-digit pairing code.');const result=await syncClient.pair(url,code,name,window.navigator?.platform||'Browser');const settings={url,token:result.token,onboardingDismissed:true};await (await pairingPromise).saveSettings(settings);$('sync-token').value='';$('sync-token').placeholder='Leave blank to keep saved token';syncClient.configure(settings);syncEnabled=true;unpairedBanner.hidden=true;pairingPanel.open=false;await synchronize();await showDevices();});
 const pendingDecisions=[];let savingDecisions=false;
 const synchronize=async()=>{state=await syncClient.sync(identity.account,state,async next=>{if(leaseError)throw leaseError;await db.lease(identity.account,owner);return db.save(identity.account,next);});};
 const readyMessage=()=>syncEnabled?`Ready. Decisions are saved locally with sync enabled. ${syncSummary}`:'Ready. Decisions are saved locally on this browser.';
 const idleMessage=()=>state.job?'A saved album operation is ready to retry.':readyMessage();
 const message=value=>{$('status').textContent=value;};
 async function call(operation,args={}) {
  if(leaseError)throw leaseError;
  if(lockedAccount)await db.lease(lockedAccount,owner);
  const result=await rawCall(operation,{...args,...(identity?{account:identity.account}:{})});
  if(!result.ok)throw Error(result.error);
  if(leaseError)throw leaseError;
  if(lockedAccount)await db.lease(lockedAccount,owner);
  return result.data;
 }
 async function assertAccount(){if(!identity)throw Error('Close and reopen Photos Swipe after signing into Google Photos.');const result=await call('identity');if(result.account!==identity.account)throw Error('Google account changed. Close and reopen Photos Swipe.');}
 async function save(next){await assertAccount();state=await db.save(identity.account,markSyncChanges(state,next));await synchronize();return state;}
 function controls(){for(const button of root.querySelectorAll('button,select'))if(!['close','launcher'].includes(button.id)&&!pairingModal.modal.contains(button)&&!receivingPanel?.contains(button))button.disabled=(busy&&!((savingDecisions||reviewingUndo)&&['keep','remove','undo'].includes(button.id)))||!identity||(!syncEnabled&&['refresh-devices','revoke-other-devices'].includes(button.id));$('overlay').setAttribute('aria-busy',String(busy));}
 async function withAccountLease(task) {
  const account=identity.account;let acquired=false,timer;
  leaseError=null;
  try {
   await db.lease(account,owner);acquired=true;lockedAccount=account;
   timer=setInterval(()=>{db.lease(account,owner).catch(error=>{leaseError=error;});},20000);
   state=await db.read(account);
   await task();
  }finally{
   clearInterval(timer);
   if(acquired)try{await db.lease(account,owner,true);}catch{}
   lockedAccount=null;
  }
 }
 async function run(task,decisions=false) {
  if(busy)return;
  busy=true;leaseError=null;controls();let failed=false;
  try {
   db=await database();
   await assertAccount();
   await withAccountLease(task);
  }catch(error){failed=true;message(error.message);deferredReviewInputs.length=0;}finally{
   if(decisions&&!failed&&pendingDecisions.length){busy=false;run(task,true);return;}
   if(!decisions)swipeFeedback.reset();else {pendingDecisions.length=0;savingDecisions=false;}busy=false;render();clearCardAnimation();controls();const nextInput=deferredReviewInputs.shift();if(nextInput)nextInput();
  }
 }
 const bytes=value=>value>=1e9?`${(value/1e9).toFixed(1)} GB`:value>=1e6?`${(value/1e6).toFixed(1)} MB`:`${Math.round(value/1e3)} KB`;
 const itemSize=item=>Number.isFinite(item.size)&&item.size>=0?bytes(item.size):'Unknown size';
 const estimate=items=>{const total=reviewStorage(items);return `${bytes(total.bytes)}${total.unknown?` + ${total.unknown} unknown`:''}`;};
 function deck(){const items=reviewDeck(state).filter(item=>!pendingDecisions.some(entry=>entry.key===item.mediaKey)).filter(item=>$('filter').value==='all'||item.type===$('filter').value);if($('sort').value==='oldest')items.sort((a,b)=>new Date(a.date||0)-new Date(b.date||0));if($('sort').value==='largest')items.sort((a,b)=>(b.size||0)-(a.size||0));return items;}
 function current(){return inspected?state.items.find(item=>item.mediaKey===inspected):reviewDeck(state).find(item=>item.mediaKey===focused&&!pendingDecisions.some(entry=>entry.key===item.mediaKey))||deck()[0];}
 function mediaURL(value,video=false,size={width:1200,height:1200}) {
  const url=new URL(value);
  if(url.protocol!=='https:'||!(url.hostname==='photos.fife.usercontent.google.com'||url.hostname.endsWith('.googleusercontent.com'))||url.username||url.password||url.port)throw Error('Unexpected preview host.');
  if(!video){url.pathname=url.pathname.replace(/=.+$/,'')+`=w${Math.max(1,Math.ceil(size.width))}-h${Math.max(1,Math.ceil(size.height))}-k-no`;url.searchParams.set('authuser',location.pathname.match(/^\/u\/(\d+)/)?.[1]||'0');}
  return url.href;
 }
 const preloader=createReviewPreloader({createImage:()=>document.createElement('img'),createVideo:()=>document.createElement('video'),videoURL:async mediaKey=>{const result=await rawCall('video',{mediaKey,account:identity.account});if(!result.ok)throw Error(result.error);return result.data;},previewURL:(url,size)=>mediaURL(url,false,size),playbackURL:url=>mediaURL(url,true)});
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
   state={...state,items:state.items.map(saved=>saved.mediaKey===item.mediaKey?{...saved,thumbUrl:fresh.thumbUrl,urlFetchedAt:fresh.urlFetchedAt}:saved)};
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
  if(results.some(result=>result.status==='fulfilled')){preloader.clear();if(current()?.mediaKey===item?.mediaKey)display(current());preloadReview(current());}
 }
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshStalePreviews();});
 function stopMedia(clearUnderCard=true){swipeFeedback.reset();if(clearUnderCard){underCard.replaceChildren();underCard.hidden=true;}generation++;const video=$('media').querySelector('video');if(video){video.pause();video.removeAttribute('src');video.load();}$('media').replaceChildren();shown=null;}
 async function display(item,retried=false,forceRefresh=false) {
  const preview=underCard.querySelector('img'),preloaded=preview?.dataset?.key===item?.mediaKey?preview:null;
  stopMedia(shown!==(item?.mediaKey||null));$('zoom').value='1';mediaElement.style.touchAction='pan-y pinch-zoom';shown=item?.mediaKey||null;const token=generation;
  $('media').style.color='var(--ps-label)';
  if(!item){$('media').textContent='No items to review. Load more or refresh latest.';return;}
  let handlingError=false;
  const failed=async()=>{
   if(token!==generation||handlingError)return;
   handlingError=true;$('media').replaceChildren();
   if(!retried){$('media').textContent='Refreshing preview\u2026';try{const fresh=await refreshItemURL(item);if(token===generation){preloader.clear();display(fresh,true);preloadReview(fresh);}return;}catch{}}
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
   const media=(item.type==='photo'&&!retried&&!forceRefresh?preloaded:null)||document.createElement(item.type==='video'?'video':'img');
   media.onerror=failed;
   if(item.type==='video'){media.controls=$('card').classList.contains('expanded');media.muted=true;media.loop=true;media.playsInline=true;media.preload='metadata';media.poster=mediaURL(item.thumbUrl,false,previewSize());$('media').append(media);addVideoControls(media);const cached=retried?null:preloader.videoSource(item.mediaKey),prefetched=await Promise.resolve(cached).catch(()=>null);if(token!==generation)return;const source=prefetched||mediaURL((await call('video',{mediaKey:item.mediaKey})).url,true);if(token!==generation)return;media.src=source;media.play().catch(()=>{});}
   else {media.alt=item.name;media.draggable=false;media.hidden=true;media.onload=()=>{if(token===generation)media.hidden=false;};mediaElement.ondblclick=()=>{if($('media').querySelector('img'))toggleEnlarge();};$('media').append(media);const source=mediaURL(item.thumbUrl,false,previewSize()),reused=media===preloaded&&media.src===source;if(!reused)media.src=source;if(reused&&media.complete){if(media.naturalWidth>0)media.hidden=false;else await failed();}}
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
   button.textContent=action==='play'?'Pause':'Unmute';
   button.style.cssText=`position:absolute;bottom:12px;${action==='play'?'left':'right'}:12px;z-index:2`;
   button.addEventListener('pointerdown',event=>event.stopPropagation());
   button.onclick=()=>{if(action==='play'){if(video.paused)video.play().catch(()=>{});else video.pause();button.textContent=video.paused?'Play':'Pause';}else{video.muted=!video.muted;button.textContent=video.muted?'Unmute':'Mute';}};
   if(action==='play')for(const type of ['play','pause'])video.addEventListener(type,()=>{button.textContent=video.paused?'Play':'Pause';});
   mediaElement.append(button);
  }
  updateVideoControls();
 }
 let renderedHistory='';
 function render() {
  for(const animation of $('card').getAnimations?.()||[])animation.cancel();
  const item=current(),queue=reviewQueue(state),candidates=reviewTrashCandidates(state);
  $('caption').textContent=item?`${inspected?'Candidate inspection \u00b7 ':''}${item.name} \u00b7 ${item.date?new Date(item.date).toLocaleDateString():'Unknown date'} \u00b7 ${itemSize(item)}`:'No unreviewed items in this batch.';
  if(!$('overlay').hidden&&(shown!==(item?.mediaKey||null)||!$('media').childNodes.length))display(item);
  const next=inspected||$('card').classList.contains('expanded')?null:deck().find(candidate=>candidate.mediaKey!==item?.mediaKey);
  if(next&&underCard.querySelector('img')?.dataset?.key!==next.mediaKey){try{const preview=document.createElement('img');preview.dataset.key=next.mediaKey;preview.alt='';preview.draggable=false;preview.src=mediaURL(next.thumbUrl,false,previewSize());underCard.replaceChildren(preview);}catch{underCard.replaceChildren();}}
  if(!next)underCard.replaceChildren();underCard.hidden=!next;
  preloadReview(item);
  $('stats').textContent=`${deck().length} to review \u00b7 ${state.items.filter(item=>item.decision).length}/${state.items.length} reviewed \u00b7 Queue: ${queue.length} (estimated savings: ${estimate(queue)}) \u00b7 In Trash: ${estimate(state.items.filter(item=>item.decision==='remove'&&item.state==='in_trash'))} (running total)`;
  const entries=[...(state.history||[])].reverse(),nextUndo=entries.find(entry=>canUndoReview(state,entry));
  const decisionLabel=value=>value==='remove'?'Queue':value==='keep'?'Keep':'Unreviewed';
  const historyLabel=entry=>`${state.items.find(item=>item.mediaKey===entry.key)?.name||entry.key} \u00b7 ${decisionLabel(entry.previous)} \u2192 ${decisionLabel(entry.decision)}`;
  undoPreview.textContent=nextUndo?`Next Undo: ${historyLabel(nextUndo)}; restores ${decisionLabel(nextUndo.previous)}.`:'No previous decisions can be undone.';
  $('undo').title=undoPreview.textContent;$('undo').setAttribute('aria-describedby','undo-preview');
  const historyRows=entries.slice(0,100).map(entry=>`${historyLabel(entry)} \u00b7 ID: ${entry.key}${entry===nextUndo?' \u00b7 Next Undo':canUndoReview(state,entry)?'':' \u00b7 Unavailable for Undo'}`);
  if(entries.length>100)historyRows.push(`Showing the latest 100 of ${entries.length} decisions.`);
  if(!entries.length)historyRows.push('No decisions yet.');
  const historySignature=JSON.stringify(historyRows);
  if(historySignature!==renderedHistory){
   renderedHistory=historySignature;historyList.replaceChildren();
   for(const text of historyRows){const row=document.createElement('li');row.textContent=text;historyList.append(row);}
  }
  moveTrash.textContent=`Move ${candidates.length} items to Trash`;
  trashCandidates.hidden=!trashOptIn.checked;moveTrash.hidden=!trashOptIn.checked;
  trashTitle.textContent=`Move to Trash candidates (${candidates.length})`;
  trashList.replaceChildren();
  for(const candidate of candidates){
   const button=document.createElement('button'),image=document.createElement('img'),label=document.createElement('span');
   image.onerror=()=>image.remove();image.src=mediaURL(candidate.thumbUrl);image.alt='';image.loading='lazy';
   label.textContent=`${candidate.name} \u00b7 ${candidate.type} \u00b7 ${candidate.date?new Date(candidate.date).toLocaleDateString():'Unknown date'} \u00b7 ${candidate.queueSent?'Sent to review album':'Queued'} \u00b7 ID: ${candidate.mediaKey}`;
   label.style.cssText='white-space:normal;overflow-wrap:anywhere';
   button.append(image,label);button.setAttribute('aria-label',`Inspect ${label.textContent}`);
   button.onclick=()=>{if(!busy){inspected=candidate.mediaKey;render();}};trashList.append(button);
  }
  $('queue-title').textContent=`Removal queue (${queue.length})`;
  $('queue').replaceChildren();
  for(const item of queue){const button=document.createElement('button'),image=document.createElement('img'),label=document.createElement('span');image.onerror=()=>image.remove();image.src=mediaURL(item.thumbUrl);image.alt='';image.loading='lazy';label.textContent=item.name;button.append(image,label);button.setAttribute('aria-label',`Inspect ${item.name}`);button.onclick=()=>{if(!busy){inspected=item.mediaKey;render();}};$('queue').append(button);}
  $('remove').textContent=inspected?'Back to review':'\u00d7 Queue';$('keep').textContent=inspected?'Keep instead':'\u2713 Keep';
  $('send').textContent=state.job?'Retry saved album operation':'Send to review album';
  $('album').hidden=!state.albumKey;if(state.albumKey)$('album').href=`https://photos.google.com/u/${location.pathname.match(/^\/u\/(\d+)/)?.[1]||'0'}/album/${encodeURIComponent(state.albumKey)}`;
 }
 async function open() {
  if(busy)return;
  preloader.clear();
  $('overlay').hidden=false;$('launcher').hidden=true;$('close').focus();message('Reading local progress\u2026');
  busy=true;controls();
  try{const result=await rawCall('identity');if(!result.ok)throw Error(result.error);if(identity?.account!==result.data.account){inspected=null;focused=null;stopMedia();}identity=result.data;$('account').textContent=identity.label;db=await database();state=await db.read(identity.account);let settings={};try{settings=await (await pairingPromise).settings();}catch(error){pairingNotice.textContent=`Pairing storage unavailable: ${error.message}`;}unpairedBanner.hidden=!settings.unpaired;$('sync-url').value=settings.url||'';$('sync-token').value='';$('sync-token').placeholder=settings.token?'Leave blank to keep saved token':'Enter sync token';syncEnabled=!!(settings.url&&settings.token);syncClient.configure(settings);settingsPanel.open=!syncEnabled&&!settings.onboardingDismissed;syncLocal.hidden=syncEnabled;if(syncEnabled)await withAccountLease(synchronize);message(idleMessage());}
  catch(error){identity=null;state=emptyReview();stopMedia();message(error.message);}finally{busy=false;render();controls();refreshStalePreviews();}
 }
 function close(){preloader.clear();finishCardAnimation();clearCardAnimation();$('overlay').hidden=true;$('launcher').hidden=false;stopMedia();$('launcher').focus();}
 const deferredReviewInputs=[];let reviewingUndo=false,cardAnimation=null;
 function finishCardAnimation(){if(cardAnimation)cardAnimation.finish();}
 function clearCardAnimation(){if(cardAnimation){cardAnimation.cancel();cardAnimation=null;}$('card').style.visibility='';}
 async function animateCard(decision){
  clearCardAnimation();
  if(!$('card').animate||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
  const side=decision==='keep'?1:-1,center={transform:'translateX(0) rotate(0deg)',opacity:1},edge={transform:`translateX(${side*120}vw) rotate(${side*18}deg)`,opacity:0};
  const animation=$('card').animate([edge,center],{duration:250,easing:'ease-out',fill:'forwards'});cardAnimation=animation;
  let timer;
  try{await Promise.race([animation.finished,new Promise(resolve=>{timer=window.setTimeout(()=>{animation.finish();resolve();},350);})]);}catch{}finally{window.clearTimeout(timer);}
 }
 function undo(){if(!identity||$('overlay').hidden)return;if(busy){if(savingDecisions||reviewingUndo){deferredReviewInputs.push(undo);finishCardAnimation();}return;}reviewingUndo=true;return run(async()=>{try{await applyUndo();}finally{reviewingUndo=false;}});}
 function decide(decision,deferred=false){
  if(!identity||$('overlay').hidden)return;
  if((deferredReviewInputs.length&&!deferred)||reviewingUndo){deferredReviewInputs.push(()=>decide(decision,true));finishCardAnimation();return;}
  if(busy&&!savingDecisions)return;
  if(inspected&&decision==='remove'){inspected=null;render();return;}
  const item=current();if(!item)return;
  pendingDecisions.push({key:item.mediaKey,previous:item.decision,decision,revision:(item.revision||0)+1,name:item.name});
  swipeFeedback.dismiss(decision);
  inspected=null;focused=null;render();
  if(savingDecisions)return;
  savingDecisions=true;
  run(async()=>{
   while(pendingDecisions.length){
    const entry=pendingDecisions[0],next=decideReview(state,entry.key,entry.decision,entry.previous,entry.revision-1);
    await save({...next,history:[...(state.history||[]),{key:entry.key,previous:entry.previous,decision:entry.decision,revision:entry.revision}]});
    pendingDecisions.shift();render();
    message(entry.decision==='remove'?'Added to the local removal queue.':`Kept ${entry.name}.`);
   }
  },true);
 }
 async function applyUndo(){const history=structuredClone(state.history||[]);while(history.length&&!canUndoReview(state,history.at(-1)))history.pop();const last=history.pop();if(!last){message('No previous decisions can be undone.');return;}const next=decideReview(state,last.key,last.previous,last.decision,last.revision);const previous=[...history].reverse().find(entry=>entry.key===last.key);if(previous&&previous.revision===last.revision-1)previous.revision=next.items.find(item=>item.mediaKey===last.key).revision;await save({...next,history});const restored=state.items.find(item=>item.mediaKey===last.key);inspected=restored.decision==='remove'?last.key:null;focused=restored.decision===null?last.key:null;render();await animateCard(last.decision);message(`Decision undone for ${restored.name}.`);}
 async function load(refresh=false) {
  const result=await loadReviewPages({read:async()=>state,save,call,refresh,progress:scanned=>message(`Loading library \u00b7 ${scanned} rows checked\u2026`)});
  message(`${result.added} new items to review \u00b7 ${result.scanned} library rows checked${result.exhausted?' \u00b7 End of library':''}${result.limited?' \u00b7 Scan limit reached; Load more continues from here':''}${result.warning?'. '+result.warning:''}`);
 }

 function toggleEnlarge(){swipeFeedback.reset();$('card').classList.toggle('expanded');updateVideoControls();$('enlarge').textContent=$('card').classList.contains('expanded')?'Fit view':'Enlarge';refreshPreviews();}
 function refreshPreviews(){if($('overlay').hidden)return;const item=current(),media=$('media').querySelector('img')||$('media').querySelector('video');if(item&&item.mediaKey===shown&&media?.tagName===(item.type==='video'?'VIDEO':'IMG')){const url=mediaURL(item.thumbUrl,false,previewSize());if(item.type==='video')media.poster=url;else media.src=url;}preloadReview(item);}
 window.addEventListener('resize',refreshPreviews);
 $('sync-save').onclick=()=>run(async()=>{const previous=await (await pairingPromise).settings();const url=$('sync-url').value.trim();const normalized=url?new URL(url).origin:'';const settings={...previous,...validateSyncSettings(url,$('sync-token').value||(normalized===previous.url?previous.token||'':''))};if(settings.token)delete settings.unpaired;await (await pairingPromise).saveSettings({...settings,onboardingDismissed:true});$('sync-token').value='';if(settings.token)unpairedBanner.hidden=true;syncEnabled=!!(settings.url&&settings.token);syncLocal.hidden=syncEnabled;syncClient.configure(settings);await synchronize();settingsPanel.open=!syncEnabled;message(idleMessage());});
 $('sync-local').onclick=()=>run(async()=>{const settings=await (await pairingPromise).settings();await (await pairingPromise).saveSettings({...settings,onboardingDismissed:true});settingsPanel.open=false;message(idleMessage());});
 let receivingPanel;
 const receivePairing=manual=>{if(!manual&&/^#pswipe-pair=([A-Za-z0-9_-]{22})(?:&origin=([^&]+))?$/.test(location.hash||'')){receivingPanel?.remove();receivingPanel=null;}else if(!manual)return;if(receivingPanel){receivingPanel.hidden=false;receivingPanel.querySelector('input').focus();return receivingPanel;}return receivingPanel=receivePairingLink({document,parent:root,location:manual?{...location,hash:''}:location,window,fetch:environment.syncFetch||environment.fetch,saveSettings:async settings=>{await (await pairingPromise).saveSettings(settings);},onPaired:open,manual,url:$('sync-url').value.trim()||undefined});};
 const pairThis=document.createElement('button');pairThis.textContent='Pair this device';settingsPanel.append(pairThis);pairThis.onclick=()=>receivePairing(true);receivePairing(false);
 window.addEventListener('hashchange',()=>receivePairing(false));
 $('launcher').onclick=open;$('close').onclick=close;$('keep').onclick=()=>decide('keep');$('remove').onclick=()=>decide('remove');$('undo').onclick=undo;$('load').onclick=()=>run(()=>load());$('refresh').onclick=()=>run(()=>load(true));$('enlarge').onclick=toggleEnlarge;
 $('filter').onchange=$('sort').onchange=()=>{inspected=null;focused=null;render();};
 $('zoom').oninput=()=>{swipeFeedback.reset();mediaElement.style.touchAction=Number($('zoom').value)>1?'pan-x pan-y pinch-zoom':'pan-y pinch-zoom';const image=$('media').querySelector('img');if(image){image.style.maxWidth='none';image.style.maxHeight='none';image.style.width=`${Number($('zoom').value)*100}%`;image.style.touchAction=Number($('zoom').value)>1?'pan-x pan-y pinch-zoom':'pan-y pinch-zoom';}};
 $('send').onclick=()=>{if(busy)return;const confirmedKeys=[...(state.job?.mediaKeys||reviewQueue(state).map(item=>item.mediaKey))];const count=confirmedKeys.length;if(!count){message('The removal queue is empty.');return;}if(!window.confirm(`Add ${count} candidates to a private review album? This does not delete media.`))return;run(async()=>{const keys=state.job?.mediaKeys||reviewQueue(state).map(item=>item.mediaKey);if(keys.length!==confirmedKeys.length||keys.some(key=>!confirmedKeys.includes(key)))throw Error('The queue changed in another tab. Review it and confirm again.');message('Updating and verifying the review album\u2026');await sendReviewAlbum({read:async()=>state,save,call,title:'Photos Swipe \u00b7 Review'});inspected=null;message('Every candidate was verified in the review album. Select Enable Move to Trash below to use this panel, or open the review album to move items manually in Google Photos.');});};
 trashOptIn.onchange=()=>render();
 moveTrash.onclick=()=>{if(busy||!trashOptIn.checked)return;const candidates=reviewTrashCandidates(state),keys=candidates.map(item=>item.mediaKey);if(!keys.length){message('No candidates to move to Trash.');return;}if(!window.confirm(`Move exactly ${keys.length} items to Google Photos Trash?\n\n${candidates.map(item=>`${item.name} (ID: ${item.mediaKey})`).join('\n')}`))return;run(async()=>{if(state.job)throw Error('Finish the saved album operation before moving items to Trash.');const currentKeys=reviewTrashCandidates(state).map(item=>item.mediaKey);if(currentKeys.length!==keys.length||currentKeys.some(key=>!keys.includes(key)))throw Error('Candidates changed. Review the item list and confirm again.');if(state.items.some(item=>keys.includes(item.mediaKey)&&!item.dedupKey))throw Error('Missing Trash identifiers. Refresh latest before retrying.');for(let index=0;index<keys.length;index+=25){const batch=keys.slice(index,index+25);await call('moveToTrash',{dedupKeys:state.items.filter(item=>batch.includes(item.mediaKey)).map(item=>item.dedupKey),confirmed:true});await save(await reconcileReviewTrash(state,call));if(state.items.some(item=>batch.includes(item.mediaKey)&&item.state!=='in_trash'))throw Error('Trash move was not verified. Check deleted items before retrying.');}trashOptIn.checked=false;moveTrash.hidden=true;message(`Verified ${keys.length} items in Trash.`);});};
 $('trash').onclick=()=>run(async()=>{message('Reading Google Photos Trash\u2026');await save(await reconcileReviewTrash(state,call));message('Trash check complete. Unknown results leave local state unchanged.');});
 for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','touchstart','touchmove','touchend','touchcancel','wheel'])overlayElement.addEventListener(type,event=>event.stopPropagation());
 const swipeFeedback=createSwipeFeedback({window,targets:[$('media'),$('swipe')],card:topCard,under:underCard,keep:stamps[0],remove:stamps[1],canSwipe:()=>!!current()&&(!busy||savingDecisions||reviewingUndo)&&!inspected&&!$('overlay').hidden&&!$('card').classList.contains('expanded')&&Number($('zoom').value)<=1,onDecide:decide});
 window.addEventListener('pageshow',event=>{if(event.persisted&&!$('overlay').hidden)return open();});
 const activePairingDialog=()=>!pairingModal.modal.hidden?pairingModal.modal:receivingPanel&&!receivingPanel.hidden?receivingPanel:null;
 function handleViewerSpace(event){
  if(activePairingDialog())return false;
  if($('overlay').hidden||event.altKey||event.ctrlKey||event.metaKey||event.isComposing||event.key!==' ')return false;
  if(['INPUT','SELECT','TEXTAREA'].includes(root.activeElement?.tagName)||root.activeElement?.isContentEditable)return false;
  const video=$('media').querySelector('video');
  event.preventDefault();event.stopImmediatePropagation();
  if(video&&event.type==='keydown'&&!event.repeat){if(video.paused)video.play().catch(()=>{});else video.pause();}
  return true;
 }
 window.addEventListener('keyup',handleViewerSpace,true);
 window.addEventListener('keydown',event=>{
  const dialog=activePairingDialog();
  if(dialog){if(event.key==='Tab'){const focusable=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled)')].filter(element=>element.getClientRects().length);const index=focusable.indexOf(root.activeElement),next=event.shiftKey?(index<=0?focusable.length-1:index-1):(index+1)%focusable.length;event.preventDefault();event.stopImmediatePropagation();focusable[next]?.focus();}else if(!dialog.contains(root.activeElement)){event.preventDefault();event.stopImmediatePropagation();dialog.querySelector('button:not(:disabled),input:not(:disabled)')?.focus();}if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();if(dialog===pairingModal.modal)pairingModal.close();else dialog.onkeydown(event);}return;}
  if(handleViewerSpace(event))return;
  if($('overlay').hidden||event.altKey||event.ctrlKey||event.metaKey||event.isComposing)return;
  if(event.key==='Tab'){
   const focusable=[...root.querySelectorAll('button:not(:disabled),select,input,a[href],summary,video[controls]')].filter(element=>element.getClientRects().length);
   const index=focusable.indexOf(root.activeElement),next=event.shiftKey?(index-1+focusable.length)%focusable.length:(index+1)%focusable.length;
   event.preventDefault();event.stopImmediatePropagation();focusable[next]?.focus();return;
  }
  if(['INPUT','SELECT','TEXTAREA'].includes(root.activeElement?.tagName)||root.activeElement?.isContentEditable)return;
  const actions={ArrowLeft:()=>decide('remove'),ArrowRight:()=>decide('keep'),z:undo,Z:undo,f:toggleEnlarge,F:toggleEnlarge,Escape:close};
  if(actions[event.key]){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat||!['ArrowLeft','ArrowRight','z','Z'].includes(event.key))actions[event.key]();}
 },true);
}

const pageWindow=typeof unsafeWindow==='undefined'?window:unsafeWindow;
const environment={window:pageWindow,document,location,GM:typeof GM==='undefined'?undefined:GM,fetch:pageWindow.fetch.bind(pageWindow),syncFetch:typeof fetch==='undefined'?window.fetch.bind(window):fetch.bind(globalThis),crypto:window.crypto,indexedDB:pageWindow.indexedDB,AbortController:pageWindow.AbortController,setTimeout:window.setTimeout.bind(window),clearTimeout:window.clearTimeout.bind(window)};
if(!pageWindow.WIZ_global_data?.SNlM0e||!pageWindow.WIZ_global_data?.oPEP7c)environment.photosCall=createPagePhotosBridge(environment);
mountPhotosSwipe(environment);
})();
