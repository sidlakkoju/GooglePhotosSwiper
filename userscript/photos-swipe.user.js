// ==UserScript==
// @name Photos Swipe
// @namespace https://github.com/sidlakkoju/GooglePhotosSwiper
// @version 1.0.0
// @description Review Google Photos with local swipe decisions and verified review albums. RPC formats adapted from Google Photos Toolkit by xob0t.
// @match https://photos.google.com/*
// @run-at document-idle
// @grant none
// @inject-into page
// @noframes
// @updateURL https://raw.githubusercontent.com/sidlakkoju/GooglePhotosSwiper/main/userscript/photos-swipe.user.js
// @downloadURL https://raw.githubusercontent.com/sidlakkoju/GooglePhotosSwiper/main/userscript/photos-swipe.user.js
// @license MIT
// MIT License
// 
// Copyright (c) 2024 xob0t
// 
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// 
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
// 
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
// ==/UserScript==

(function () {
'use strict';
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
 const {window,location,fetch,crypto,AbortController,setTimeout,clearTimeout}=environment;
return async function photosOperation(operation,args={}) {
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
   const request=buildPhotosRequest(global,location,id,payload);
   const controller=new AbortController();
   const timer=setTimeout(()=>controller.abort(),30000);
   try {
    const response=await fetch(request.url,{...request.options,signal:controller.signal});
    if(!response.ok)throw Error(`Google Photos request failed (${response.status}). Reload and retry.`);
    const raw=await response.text();
    requireSamePage();
    return parsePhotosResponse(raw,id);
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
   if(typeof args.title!=='string'||!args.title.startsWith('Photos Swipe · Review · ')||args.title.length>150)throw Error('Invalid review album title.');
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
  if(operation==='video') {
   if(!validKey(args.mediaKey))throw Error('Invalid video.');const data=await rpc('VrseUb',[args.mediaKey,null,null,null,null]);
   if(data?.[0]?.[0]!==args.mediaKey||!safeMediaUrl(data[1]))throw Error('Video preview unavailable. Open it in Google Photos.');return {ok:true,data:{url:data[1]}};
  }
  throw Error('Unsupported Google Photos operation.');
 }catch(e){return {ok:false,error:e.message||'Google Photos request failed.'};}
}
}

const emptyReview = () => ({revision:0,items:[],cursor:null,started:false,exhausted:false,albumKey:null,job:null});
const reviewDeck = state => state.items.filter(item=>!item.decision&&item.state!=='in_trash');
const reviewQueue = state => state.items.filter(item=>item.decision==='remove'&&!item.queueSent&&item.state!=='in_trash');
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
 for(const item of page.items){const old=items.get(item.mediaKey);items.set(item.mediaKey,{...old,...item,decision:old?.decision??null,queueSent:old?.queueSent??false,albumKey:old?.albumKey??null,state:'active',revision:(old?.revision||0)+(old&&old.state!=='active'?1:0)});}
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
 return {...state,albumKey:state.job.albumKey,job:null,items:state.items.map(item=>keys.has(item.mediaKey)?{...item,queueSent:true,albumKey:state.job.albumKey,revision:(item.revision||0)+1}:item)};
}
async function sendReviewAlbum({read,save,call,title}) {
 let state=await read();
 if(!state.job){const mediaKeys=reviewQueue(state).map(item=>item.mediaKey);if(!mediaKeys.length)throw Error('The removal queue is empty.');state=await save({...state,job:{title,mediaKeys,albumKey:state.albumKey}});}
 let members;
 if(state.job.albumKey){
  try{members=await call('albumMembers',{albumKey:state.job.albumKey});}
  catch(error){const found=await call('findAlbum',{title:state.job.title});if(found.albumKey===state.job.albumKey)throw error;state=await save({...state,job:{...state.job,albumKey:null}});}
 }
 if(!state.job.albumKey){const found=await call('findAlbum',{title:state.job.title});const albumKey=found.albumKey||(await call('createAlbum',{title:state.job.title})).albumKey;state=await save({...state,job:{...state.job,albumKey}});}
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
  if(trash.keys.has(item.mediaKey)||item.dedupKey&&trash.dedupKeys.has(item.dedupKey))next='in_trash';
  else if(item.state==='in_trash'){const result=await call('itemState',{mediaKey:item.mediaKey});if(result.state!=='unknown')next=result.state;}
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
  const request=indexedDB.open('photos-swipe-userscript',1);
  request.onupgradeneeded=()=>{request.result.createObjectStore('accounts');request.result.createObjectStore('leases');};
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
  request.onblocked=()=>reject(Error('Close other Photos Swipe tabs to open local storage.'));
 });
 db.onversionchange=()=>db.close();
 function transaction(store,key,change) {
  return new Promise((resolve,reject)=>{
   const tx=db.transaction(store,change?'readwrite':'readonly'),table=tx.objectStore(store),request=table.get(key);let result,failure;
   request.onsuccess=()=>{
    try {result=change?change(request.result):request.result;if(change)table.put(result,key);}catch(error){failure=error;tx.abort();}
   };
   tx.oncomplete=()=>resolve(result);
   tx.onabort=()=>reject(failure||tx.error||Error('Local storage transaction failed.'));
   tx.onerror=()=>{};
  });
 }
 return {
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

function mountPhotosSwipe(environment) {
 const {window,document,location}=environment;
 if(window.top!==window||location.origin!=='https://photos.google.com'||document.getElementById('photos-swipe-userscript-host'))return;
 const rawCall=createPhotosAPI(environment),owner=environment.crypto.randomUUID();
 const host=document.createElement('div');host.id='photos-swipe-userscript-host';
 host.style.cssText='all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
 const root=host.attachShadow({mode:'open'});
 root.innerHTML=`<style>
 :host{font:16px system-ui;color:#193426}*{box-sizing:border-box}button,select,input{font:inherit}button,a,select{touch-action:manipulation}button{min-height:44px;border:0;border-radius:12px;background:#e3ebdf;color:#193426;padding:10px 16px;cursor:pointer}button:disabled{opacity:.5;cursor:wait}button:focus-visible,a:focus-visible,select:focus-visible{outline:3px solid #0075ff;outline-offset:2px}a{color:#236541}p{margin:8px 0;overflow-wrap:anywhere}[hidden]{display:none!important}
 .launcher{pointer-events:auto;position:absolute;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));background:#245b3d;color:white;box-shadow:0 3px 20px #0005}
 .overlay{pointer-events:auto;position:absolute;inset:0;background:#f4f7f1;overflow:auto;overscroll-behavior:contain;padding:calc(12px + env(safe-area-inset-top)) 12px calc(18px + env(safe-area-inset-bottom))}
 .content{max-width:850px;margin:auto}header,.actions,.toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}header{justify-content:space-between}h1{font-size:22px;margin:0}.account{font-size:13px}.card{margin-top:12px;background:#13281f;border-radius:18px;overflow:hidden;position:relative}.media{height:48vh;height:48dvh;min-height:180px;display:flex;align-items:center;justify-content:center;overflow:auto}.media img,.media video{display:block;max-width:100%;max-height:100%;object-fit:contain}.media img{touch-action:pan-y pinch-zoom;user-select:none;-webkit-user-drag:none}.card.expanded .media{height:72vh;height:72dvh}.caption{color:white;padding:10px 14px}.swipe{color:white;text-align:center;padding:12px;touch-action:pan-y pinch-zoom;background:#264638}.actions{justify-content:center;margin:12px 0}.keep{background:#245b3d;color:white}.remove{background:#8c3535;color:white}.stats{padding:12px;background:#e3ebdf;border-radius:12px;margin:12px 0}.toolbar{margin:10px 0}select{max-width:100%;min-height:44px;border-radius:8px}details{margin:16px 0}.queue{display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px}.queue button{padding:6px;overflow:hidden}.queue img{width:100%;height:75px;object-fit:cover}.queue span{display:block;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.status{min-height:24px}#zoom{width:120px;min-height:44px} @media(min-width:800px){.media{height:55vh}.overlay{padding:24px}}
 </style>
 <button class="launcher" id="launcher">Photos Swipe</button>
 <section class="overlay" id="overlay" hidden role="dialog" aria-modal="true" aria-label="Photos Swipe"><div class="content">
 <header><h1>Photos Swipe</h1><button id="close">Close</button></header><p class="account" id="account"></p>
 <div class="card" id="card"><div class="media" id="media"></div><div class="swipe" id="swipe">Swipe left to queue · right to keep</div><p class="caption" id="caption">Load a batch to start reviewing.</p></div>
 <div class="actions"><button class="remove" id="remove">× Queue</button><button id="undo">Undo</button><button class="keep" id="keep">✓ Keep</button><button id="enlarge">Enlarge</button><label>Zoom <input id="zoom" type="range" min="1" max="3" step="0.25" value="1"></label></div>
 <div class="stats" id="stats"></div>
 <div class="toolbar"><button id="load">Load 50 more</button><button id="refresh">Refresh latest</button><select id="filter" aria-label="Media filter"><option value="all">All media</option><option value="photo">Photos</option><option value="video">Videos</option></select><select id="sort" aria-label="Review order"><option value="original">Library order</option><option value="oldest">Oldest first</option><option value="largest">Largest first</option></select></div>
 <p role="status" aria-live="polite" class="status" id="status"></p>
 <details id="queue-details"><summary id="queue-title">Removal queue</summary><div class="queue" id="queue"></div></details>
 <div class="toolbar"><button id="send">Send to review album</button><button id="trash">Check deleted items</button><a id="album" target="_blank" rel="noopener" hidden>Open review album ↗</a></div>
 <p>Swipes never delete media. Send candidates to a review album, then move them to Trash yourself in Google Photos.</p>
 </div></section>`;
 document.documentElement.append(host);
 const $=id=>root.getElementById(id);
 let dbPromise,db,state=emptyReview(),identity,busy=false,history=[],inspected=null,shown=null,generation=0,leaseError=null,lockedAccount=null;
 const database=()=>dbPromise||(dbPromise=openReviewDatabase(environment.indexedDB).catch(error=>{dbPromise=null;throw error;}));
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
 async function save(next){await assertAccount();state=await db.save(identity.account,next);return state;}
 function controls(){for(const button of root.querySelectorAll('button,select'))if(!['close','launcher'].includes(button.id))button.disabled=busy||!identity;$('overlay').setAttribute('aria-busy',String(busy));}
 async function run(task) {
  if(busy)return;
  busy=true;leaseError=null;controls();let acquired=false,timer;
  try {
   db=await database();
   await assertAccount();
   await db.lease(identity.account,owner);acquired=true;lockedAccount=identity.account;
   timer=setInterval(()=>{db.lease(identity.account,owner).catch(error=>{leaseError=error;});},20000);
   state=await db.read(identity.account);
   await task();
  }catch(error){message(error.message);}finally{
   clearInterval(timer);
   if(acquired)try{await db.lease(identity.account,owner,true);}catch{}
   lockedAccount=null;busy=false;render();controls();
  }
 }
 const bytes=value=>value>=1e9?`${(value/1e9).toFixed(1)} GB`:value>=1e6?`${(value/1e6).toFixed(1)} MB`:`${Math.round(value/1e3)} KB`;
 const estimate=items=>{const total=reviewStorage(items);return `${bytes(total.bytes)}${total.unknown?` + ${total.unknown} unknown`:''}`;};
 function deck(){const items=reviewDeck(state).filter(item=>$('filter').value==='all'||item.type===$('filter').value);if($('sort').value==='oldest')items.sort((a,b)=>Date.parse(a.date||0)-Date.parse(b.date||0));if($('sort').value==='largest')items.sort((a,b)=>(b.size||0)-(a.size||0));return items;}
 function current(){return inspected?state.items.find(item=>item.mediaKey===inspected):deck()[0];}
 function mediaURL(value,video=false) {
  const url=new URL(value);
  if(url.protocol!=='https:'||!(url.hostname==='photos.fife.usercontent.google.com'||url.hostname.endsWith('.googleusercontent.com'))||url.username||url.password||url.port)throw Error('Unexpected preview host.');
  if(!video){url.pathname=url.pathname.replace(/=.+$/,'')+'=w1200-h1200-k-no';url.searchParams.set('authuser',location.pathname.match(/^\/u\/(\d+)/)?.[1]||'0');}
  return url.href;
 }
 function stopMedia(){generation++;const video=$('media').querySelector('video');if(video){video.pause();video.removeAttribute('src');video.load();}$('media').replaceChildren();shown=null;}
 async function display(item) {
  stopMedia();$('zoom').value='1';shown=item?.mediaKey||null;const token=generation;
  if(!item){$('media').textContent='No items to review. Load more or refresh latest.';$('media').style.color='white';return;}
  try {
   const media=document.createElement(item.type==='video'?'video':'img');
   if(item.type==='video'){media.controls=true;media.muted=true;media.loop=true;media.playsInline=true;media.preload='metadata';media.poster=mediaURL(item.thumbUrl);$('media').append(media);const result=await call('video',{mediaKey:item.mediaKey});if(token!==generation)return;media.src=mediaURL(result.url,true);media.play().catch(()=>{});}
   else {media.alt=item.name;media.draggable=false;media.src=mediaURL(item.thumbUrl);media.ondblclick=()=>toggleEnlarge();$('media').append(media);}
   media.onerror=()=>{if(token===generation)message('Preview unavailable. Reload Google Photos and try again.');};
  }catch(error){if(token===generation)message(error.message);}
 }
 function render() {
  const item=current(),queue=reviewQueue(state);
  $('caption').textContent=item?`${inspected?'Queue inspection · ':''}${item.name} · ${item.date?new Date(item.date).toLocaleDateString():'Unknown date'}`:'No unreviewed items in this batch.';
  if(!$('overlay').hidden&&(shown!==(item?.mediaKey||null)||!$('media').childNodes.length))display(item);
  $('stats').textContent=`${deck().length} to review · ${state.items.filter(item=>item.decision).length}/${state.items.length} reviewed · Queue: ${queue.length} · estimated savings ${estimate(queue)} · In Trash: ${estimate(state.items.filter(item=>item.decision==='remove'&&item.state==='in_trash'))}`;
  $('queue-title').textContent=`Removal queue (${queue.length})`;
  $('queue').replaceChildren();
  for(const item of queue){const button=document.createElement('button'),image=document.createElement('img'),label=document.createElement('span');image.src=mediaURL(item.thumbUrl);image.alt='';image.loading='lazy';label.textContent=item.name;button.append(image,label);button.setAttribute('aria-label',`Inspect ${item.name}`);button.onclick=()=>{if(!busy){inspected=item.mediaKey;render();}};$('queue').append(button);}
  $('remove').textContent=inspected?'Back to review':'× Queue';$('keep').textContent=inspected?'Keep instead':'✓ Keep';
  $('send').textContent=state.job?'Retry saved album operation':'Send to review album';
  $('album').hidden=!state.albumKey;if(state.albumKey)$('album').href=`https://photos.google.com/u/${location.pathname.match(/^\/u\/(\d+)/)?.[1]||'0'}/album/${encodeURIComponent(state.albumKey)}`;
 }
 async function open() {
  if(busy)return;
  $('overlay').hidden=false;$('launcher').hidden=true;$('close').focus();message('Reading local progress…');
  busy=true;controls();
  try{const result=await rawCall('identity');if(!result.ok)throw Error(result.error);if(identity?.account!==result.data.account){history=[];inspected=null;stopMedia();}identity=result.data;$('account').textContent=identity.label;db=await database();state=await db.read(identity.account);message(state.job?'A saved album operation is ready to retry.':'Ready. Decisions are saved locally on this browser.');}
  catch(error){identity=null;state=emptyReview();stopMedia();message(error.message);}finally{busy=false;render();controls();}
 }
 function close(){$('overlay').hidden=true;$('launcher').hidden=false;stopMedia();$('launcher').focus();}
 function decide(decision){
  if(busy)return;
  if(inspected&&decision==='remove'){inspected=null;render();return;}
  const item=current();if(!item)return;
  run(async()=>{const previous=item.decision;await save(decideReview(state,item.mediaKey,decision,previous,item.revision||0));history.push({key:item.mediaKey,previous,decision,revision:(item.revision||0)+1});inspected=null;message(decision==='remove'?'Added to the local removal queue.':'Kept.');});
 }
 function undo(){if(busy||!history.length)return;run(async()=>{while(history.length&&!canUndoReview(state,history.at(-1)))history.pop();const last=history.at(-1);if(!last){message('No previous decisions can be undone.');return;}await save(decideReview(state,last.key,last.previous,last.decision,last.revision));history.pop();inspected=null;message('Decision undone.');});}
 async function load(refresh=false) {
  const result=await loadReviewPages({read:async()=>state,save,call,refresh,progress:scanned=>message(`Loading library · ${scanned} rows checked…`)});
  message(`${result.added} new items to review · ${result.scanned} library rows checked${result.exhausted?' · End of library':''}${result.limited?' · Scan limit reached; Load more continues from here':''}${result.warning?'. '+result.warning:''}`);
 }

 function toggleEnlarge(){$('card').classList.toggle('expanded');$('enlarge').textContent=$('card').classList.contains('expanded')?'Fit view':'Enlarge';}
 $('launcher').onclick=open;$('close').onclick=close;$('keep').onclick=()=>decide('keep');$('remove').onclick=()=>decide('remove');$('undo').onclick=undo;$('load').onclick=()=>run(()=>load());$('refresh').onclick=()=>run(()=>load(true));$('enlarge').onclick=toggleEnlarge;
 $('filter').onchange=$('sort').onchange=()=>{inspected=null;render();};
 $('zoom').oninput=()=>{const image=$('media').querySelector('img');if(image){image.style.maxWidth='none';image.style.maxHeight='none';image.style.width=`${Number($('zoom').value)*100}%`;image.style.touchAction=Number($('zoom').value)>1?'pan-x pan-y pinch-zoom':'pan-y pinch-zoom';}};
 $('send').onclick=()=>{if(busy)return;const confirmedKeys=[...(state.job?.mediaKeys||reviewQueue(state).map(item=>item.mediaKey))];const count=confirmedKeys.length;if(!count){message('The removal queue is empty.');return;}if(!window.confirm(`Add ${count} candidates to a private review album? This does not delete media.`))return;run(async()=>{const keys=state.job?.mediaKeys||reviewQueue(state).map(item=>item.mediaKey);if(keys.length!==confirmedKeys.length||keys.some(key=>!confirmedKeys.includes(key)))throw Error('The queue changed in another tab. Review it and confirm again.');message('Updating and verifying the review album…');await sendReviewAlbum({read:async()=>state,save,call,title:`Photos Swipe · Review · ${identity.account.slice(0,12)}`});history=[];inspected=null;message('Every candidate was verified in the review album. Open it in Google Photos to move items to Trash.');});};
 $('trash').onclick=()=>run(async()=>{message('Reading Google Photos Trash…');await save(await reconcileReviewTrash(state,call));message('Trash check complete. Unknown results leave local state unchanged.');});
 let swipeStart=null;
 for(const target of [$('media'),$('swipe')]){
  target.addEventListener('pointerdown',event=>{if(busy||event.isPrimary===false||event.button!==0||event.target.tagName==='VIDEO'||Number($('zoom').value)>1)return;swipeStart={id:event.pointerId,x:event.clientX,y:event.clientY};target.setPointerCapture(event.pointerId);});
  target.addEventListener('pointerup',event=>{if(!swipeStart||event.pointerId!==swipeStart.id)return;const dx=event.clientX-swipeStart.x,dy=event.clientY-swipeStart.y;swipeStart=null;if(Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)*1.5)decide(dx>0?'keep':'remove');});
  target.addEventListener('pointercancel',()=>{swipeStart=null;});
 }
 window.addEventListener('keydown',event=>{
  if($('overlay').hidden||event.altKey||event.ctrlKey||event.metaKey)return;
  if(event.key==='Tab'){
   const focusable=[...root.querySelectorAll('button:not(:disabled),select,input,a[href],summary,video[controls]')].filter(element=>element.getClientRects().length);
   const index=focusable.indexOf(root.activeElement),next=event.shiftKey?(index-1+focusable.length)%focusable.length:(index+1)%focusable.length;
   event.preventDefault();event.stopImmediatePropagation();focusable[next]?.focus();return;
  }
  if(['INPUT','SELECT','TEXTAREA'].includes(root.activeElement?.tagName))return;
  const actions={ArrowLeft:()=>decide('remove'),ArrowRight:()=>decide('keep'),z:undo,Z:undo,f:toggleEnlarge,F:toggleEnlarge,Escape:close,' ':()=>{const video=$('media').querySelector('video');if(video){if(video.paused)video.play().catch(()=>{});else video.pause();}}};
  if(actions[event.key]){event.preventDefault();event.stopImmediatePropagation();actions[event.key]();}
 },true);
}

mountPhotosSwipe({window,document,location,fetch:window.fetch.bind(window),crypto:window.crypto,indexedDB:window.indexedDB,AbortController:window.AbortController,setTimeout:window.setTimeout.bind(window),clearTimeout:window.clearTimeout.bind(window)});
})();
