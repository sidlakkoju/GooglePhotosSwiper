// ==UserScript==
// @name Photos Swipe
// @author sidlakkoju
// @namespace https://github.com/sidlakkoju/GooglePhotosSwiper
// @version 1.2.3
// @description Review Google Photos with local swipe decisions and verified review albums. RPC formats adapted from Google Photos Toolkit by xob0t.
// @match https://photos.google.com/*
// @run-at document-idle
// @grant none
// @inject-into page
// @noframes
// @updateURL https://photoswiper-sync.sidlakkoju.workers.dev/photoswiper.user.js
// @downloadURL https://photoswiper-sync.sidlakkoju.workers.dev/photoswiper.user.js
// @license MIT
// ==/UserScript==

(function () {
'use strict';
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
  if(operation==='video') {
   if(!validKey(args.mediaKey))throw Error('Invalid video.');const data=await rpc('VrseUb',[args.mediaKey,null,null,null,null]);
   if(data?.[0]?.[0]!==args.mediaKey||!safeMediaUrl(data[1]))throw Error('Video preview unavailable. Open it in Google Photos.');return {ok:true,data:{url:data[1]}};
  }
  throw Error('Unsupported Google Photos operation.');
 }catch(e){return {ok:false,error:e.message||'Google Photos request failed.'};}
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
    try {result=change?change(request.result):request.result;if(change)table.put(result,key);}catch(error){failure=error;tx.abort();}
   };
   tx.oncomplete=()=>resolve(result);
   tx.onabort=()=>reject(failure||tx.error||Error('Local storage transaction failed.'));
   tx.onerror=()=>{};
  });
 }
 return {
  settings:async()=>await transaction('settings','sync')||{},
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

function createSyncClient({fetch,status=()=>{}}) {
 let settings={};
 const configure=value=>{settings=value||{};status(settings.url&&settings.token?'Sync ready':'Sync off \u00b7 saved locally');};
 async function request(scope,path,method='GET',value) {
  const url=new URL(path,settings.url.replace(/\/$/,'')+'/');url.searchParams.set('scope',scope);
  const response=await fetch(url.href,{method,headers:{Authorization:`Bearer ${settings.token}`,...(value?{'Content-Type':'application/json'}:{})},...(value?{body:JSON.stringify(value)}:{}),credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error(`Sync HTTP ${response.status}`);
  return response.json();
 }
 async function sync(scope,state,save,{pull=true}={}) {
  if(!settings.url||!settings.token)return state;
  status('Syncing\u2026');
  let checkpoint=state;
  try {
   const remote=pull?await request(scope,'api/state'):{decisions:Object.entries(state.syncDecisions||{}).map(([id,decision])=>({id,decision})),history:state.history,progress:state.syncProgress};
   const decisions={...Object.fromEntries(remote.decisions.map(item=>[item.id,item.decision]))};
   const pending={...state.syncPending};
   if(state.syncDecisions==null)for(const item of state.items)if(item.decision&&!Object.hasOwn(pending,item.mediaKey))pending[item.mediaKey]=item.decision;
   const dirty=state.syncDirty||!state.syncDecisions&&state.history.length>0;
   const historyKeys=new Set([...(state.syncHistoryKeys||[]),...Object.keys(pending),...(dirty?state.history.map(entry=>entry.key):[])]);
   const remaining={...pending};
   for(const batch of decisionBatches(pending)){
    await request(scope,'api/decisions','PUT',{decisions:batch});
    for(const {id,decision} of batch){delete remaining[id];if(decision===null)delete decisions[id];else decisions[id]=decision;}
    checkpoint={...state,syncDecisions:{...decisions},syncPending:{...remaining},syncDirty:dirty,syncHistoryKeys:[...historyKeys]};
   }
   for(const [id,value] of Object.entries(pending)){if(value===null)delete decisions[id];else decisions[id]=value;}
   const history=(dirty?mergeHistory(remote.history,state.history,historyKeys):remote.history).slice(-2000);
   const items=state.items.map(item=>{
    const value=Object.hasOwn(pending,item.mediaKey)?pending[item.mediaKey]:decisions[item.mediaKey]??(Object.hasOwn(state.syncDecisions||{},item.mediaKey)?null:item.decision);
    const entry=history.findLast(entry=>entry.key===item.mediaKey&&entry.decision===value);
    return {...item,decision:value,revision:!dirty&&entry&&(value!==item.decision||!item.revision)?entry.revision:item.revision};
   });
   let next={...state,history,items,syncDecisions:decisions};
   if(dirty){
    await request(scope,'api/undo','PUT',{history});
    await request(scope,'api/progress','PUT',{started:state.started,reviewed:Object.keys(decisions).length});
   }
   next=await save({...next,syncPending:{},syncDirty:false,syncHistoryKeys:[],syncProgress:remote.progress});
   status(`Synced \u00b7 ${Object.keys(decisions).length} reviewed IDs`);return next;
  }catch(error){status(`${error.message} \u00b7 saved locally; retry on next action`);return checkpoint===state?state:await save(checkpoint);}
 }
 return {configure,sync};
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
 return {...current,items:current.items.map(item=>changed.has(item.mediaKey)?item:incoming.get(item.mediaKey)||item),history,syncDecisions:synced.syncDecisions,syncPending:pending,syncHistoryKeys:[...new Set([...(synced.syncHistoryKeys||[]),...changed])],syncDirty:!!synced.syncDirty||JSON.stringify(history)!==JSON.stringify(synced.history)};
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
 return {enqueue(){pending=true;return flush();},flush,get pending(){return pending;}};
}

function mountPhotosSwipe(environment) {
 const {window,document,location}=environment;
 if(window.top!==window||location.origin!=='https://photos.google.com'||document.getElementById('photos-swipe-userscript-host'))return;
 const rawCall=createPhotosAPI(environment),owner=environment.crypto.randomUUID();
 const host=document.createElement('div');host.id='photos-swipe-userscript-host';
 host.style.cssText='all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
 const root=host.attachShadow({mode:'open'});
 const styleElement1=document.createElement('style');
 root.append(styleElement1);
 styleElement1.append(document.createTextNode("\n :host{font:16px system-ui;color:#193426}*{box-sizing:border-box}button,select,input{font:inherit}button,a,select{touch-action:manipulation}button{min-height:44px;border:0;border-radius:12px;background:#e3ebdf;color:#193426;padding:10px 16px;cursor:pointer}button:disabled{opacity:.5;cursor:wait}button:focus-visible,a:focus-visible,select:focus-visible{outline:3px solid #0075ff;outline-offset:2px}a{color:#236541}p{margin:8px 0;overflow-wrap:anywhere}[hidden]{display:none!important}\n .launcher{pointer-events:auto;position:absolute;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));background:#245b3d;color:white;box-shadow:0 3px 20px #0005}\n .overlay{pointer-events:auto;position:absolute;inset:0;background:#f4f7f1;overflow:auto;overscroll-behavior:contain;padding:calc(12px + env(safe-area-inset-top)) 12px calc(18px + env(safe-area-inset-bottom))}\n .content{max-width:850px;margin:auto}header,.actions,.toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}header{justify-content:space-between}h1{font-size:22px;margin:0}.account{font-size:13px}.card{margin-top:12px;background:#13281f;border-radius:18px;overflow:hidden;position:relative}.media{height:48vh;height:48dvh;min-height:180px;display:flex;align-items:center;justify-content:center;overflow:auto}.media[aria-busy=true]{background:linear-gradient(110deg,#13281f,#264638,#13281f)}.media[aria-busy=true]::after{content:'Loading\u2026';position:absolute;color:white;background:#13281fcc;padding:8px;border-radius:8px}.media img,.media video{display:block;max-width:100%;max-height:100%;object-fit:contain}.media img{touch-action:pan-y pinch-zoom;user-select:none;-webkit-user-drag:none}.card.expanded .media{height:72vh;height:72dvh}.caption{color:white;padding:10px 14px}.swipe{color:white;text-align:center;padding:12px;touch-action:pan-y pinch-zoom;background:#264638}.actions{justify-content:center;margin:12px 0}.keep{background:#245b3d;color:white}.remove{background:#8c3535;color:white}.stats{padding:12px;background:#e3ebdf;border-radius:12px;margin:12px 0}.toolbar{margin:10px 0}select{max-width:100%;min-height:44px;border-radius:8px}details{margin:16px 0}.queue{display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px}.queue button{padding:6px;overflow:hidden}.queue img{width:100%;height:75px;object-fit:cover}.queue span{display:block;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.status{min-height:24px}.zoom-control,.trash-toggle{display:flex;align-items:center;gap:8px;white-space:nowrap}#zoom{width:120px;min-width:0;min-height:44px}.album-controls{background:#f4f7f1} @media(max-width:599px){.overlay{padding-bottom:calc(var(--album-controls-height,240px) + 18px + env(safe-area-inset-bottom))}.actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.actions button{padding:8px}.zoom-control{grid-column:span 2}.zoom-control input{flex:1}.library-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.library-controls>*{width:100%;min-width:0}.album-controls{position:fixed;bottom:0;left:12px;right:12px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;padding:8px 0 calc(8px + env(safe-area-inset-bottom));margin-bottom:0}.album-controls button{padding:8px;font-size:14px;min-width:0;white-space:normal;overflow-wrap:anywhere}.album-controls a,.album-explanation{grid-column:1 / -1;min-width:0}.album-explanation{margin:0;font-size:13px}.trash-toggle{min-height:44px;font-size:14px;white-space:normal;min-width:0}.trash-toggle input{flex-shrink:0}.media{height:32vh;height:32dvh}.stats{font-size:14px;padding:8px}} @media(min-width:800px){.media{height:55vh}.overlay{padding:24px}}\n "));
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
 cardElement.append(mediaElement);
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
 const syncStatus=document.createElement('p');syncStatus.setAttribute('id','sync-status');syncStatus.setAttribute('role','status');divElement4.insertBefore(settingsPanel,cardElement);divElement4.insertBefore(syncStatus,cardElement);
 const historyPanel=document.createElement('details');historyPanel.setAttribute('id','history-details');
 const historyTitle=document.createElement('summary');historyTitle.textContent='Decision history';
 const undoPreview=document.createElement('p');undoPreview.setAttribute('id','undo-preview');
 const historyList=document.createElement('ol');historyList.setAttribute('id','history-list');
 historyPanel.append(historyTitle,historyList);divElement4.insertBefore(undoPreview,queue_detailsElement);divElement4.insertBefore(historyPanel,queue_detailsElement);
 document.documentElement.append(host);
 const $=id=>root.getElementById(id);
 if(window.ResizeObserver){
  const albumControlsObserver=new window.ResizeObserver(()=>{
   const height=divElement36.getBoundingClientRect().height;
   if(height)overlayElement.style.setProperty('--album-controls-height',`${height}px`);
  });
  albumControlsObserver.observe(divElement36);
 }
 let dbPromise,db,state=emptyReview(),identity,busy=false,inspected=null,focused=null,shown=null,generation=0,leaseError=null,lockedAccount=null,syncEnabled=false,syncSummary='Sync off \u00b7 saved locally';
 const database=()=>dbPromise||(dbPromise=openReviewDatabase(environment.indexedDB).catch(error=>{dbPromise=null;throw error;}));
 const syncClient=createSyncClient({fetch:environment.fetch,status:value=>{syncSummary=value;$('sync-status').textContent=value;}});
 let leaseTimer,syncTimer,openingPromise=null,closingPromise=null,activeOperation=null,syncRunning=null,decisionCount=0,writeRevision=0,leaseTicks=0,writeConflict=null,leaseGeneration=0,acquiringAccount=null;
 const createWrites=()=>createWriteQueue({snapshot:()=>({...state,revision:writeRevision}),write:async next=>{await assertAccount();if(writeConflict)throw writeConflict;if(leaseError)throw leaseError;return db.save(identity.account,next);},committed:(saved,value,duration)=>{if(window.localStorage?.psDebug==='1')window.console?.table({persistenceMs:duration});writeRevision=saved.revision;state={...state,revision:writeRevision};},error:error=>{if(error.message.includes('Progress changed in another tab'))writeConflict=error;message(writeConflict?'Local save conflict. Unsaved decisions remain visible. Reload the page to read the other tab\u2019s progress; unsaved decisions will be lost.':`Local save failed: ${error.message} \u00b7 pending changes will retry.`);}});
 let writes=createWrites();
 const synchronize=(pull=true)=>{
  if(!identity||!syncEnabled||leaseError||writeConflict||!lockedAccount)return Promise.resolve();
  if(syncRunning)return syncRunning.then(()=>synchronize(pull));
  const account=identity.account;let version;
  syncRunning=(async()=>{
   await writes.flush();if(writes.pending)return;version=state;
   const next=await syncClient.sync(account,version,async value=>value,{pull});
   if(identity?.account===account&&next!==version){
    state={...mergeSyncResult(state,version,next),revision:writeRevision};
    await writes.enqueue();render();
   }
  })().finally(()=>{syncRunning=null;});
  return syncRunning;
 };
 function scheduleSync(){
  if(!syncEnabled)return;
  window.clearTimeout(syncTimer);
  if(++decisionCount>=10&&!busy&&!activeOperation){decisionCount=0;synchronize(false);}
  else syncTimer=window.setTimeout(()=>{decisionCount=0;if(!busy&&!activeOperation)synchronize(false);},2000);
  syncTimer?.unref?.();
 }
 function apply(next,removedKey){state=markSyncChanges(state,next);if(removedKey&&deckCache){deckCache=deckCache.filter(item=>item.mediaKey!==removedKey);deckItems=state.items;}render();writes.enqueue();scheduleSync();}
 const readyMessage=()=>syncEnabled?`Ready. Decisions are saved locally with sync enabled. ${syncSummary}`:'Ready. Decisions are saved locally on this browser.';
 const idleMessage=()=>state.job?'A saved album operation is ready to retry.':readyMessage();
 const message=value=>{$('status').textContent=value;};
 async function call(operation,args={}) {
  if(leaseError)throw leaseError;
  const result=await rawCall(operation,{...args,...(identity?{account:identity.account}:{})});
  if(!result.ok)throw Error(result.error);
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
 async function save(next){await syncRunning;await assertAccount();state=markSyncChanges(state,next);await writes.enqueue();if(writes.pending)throw leaseError||Error('Local changes have not been saved.');return state;}
 function controls(){for(const button of root.querySelectorAll('button,select'))if(!['close','launcher'].includes(button.id))button.disabled=busy||!identity;$('overlay').setAttribute('aria-busy',String(busy));}
 function startRenewal(){
  if(leaseTimer)return;
  leaseTimer=setInterval(()=>{refreshLease();},20000);
  leaseTimer?.unref?.();
 }
 async function renewLease(){
  const token=leaseGeneration,account=identity?.account;
  if(!account)return false;
  try{
   await assertAccount();
   if(token!==leaseGeneration||account!==identity?.account)return false;
   acquiringAccount=account;
   await db.lease(account,owner);
   if(token!==leaseGeneration||account!==identity?.account)return false;
   lockedAccount=account;leaseError=null;startRenewal();return true;
  }catch(error){
   if(token===leaseGeneration){leaseError=error;message(error.message);}
   return false;
  }finally{if(token===leaseGeneration)acquiringAccount=null;}
 }
 async function refreshLease(){
  const token=leaseGeneration;
  if(!await renewLease()||token!==leaseGeneration)return;
  writes.flush();refill();
  if(++leaseTicks%3===0&&syncEnabled&&!busy&&!activeOperation&&!$('overlay').hidden)synchronize();
 }
 async function recoverLease(){
  if(!identity)return true;
  if(!leaseError&&lockedAccount){startRenewal();return true;}
  return renewLease();
 }
 async function withAccountLease(task) {
  if(!await renewLease())throw leaseError||Error('Session changed. Close and reopen Photos Swipe.');
  await writes.flush();if(writes.pending)throw Error('Save pending local changes before this operation.');
  await task();scheduleSync();
 }
 async function run(task) {
  if(busy)return;
  busy=true;controls();
  activeOperation=(async()=>{
   try {
    db=await database();
    await syncRunning;
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
  return previewURL(value,{video,expanded,width:expanded?(window.innerWidth||512):($('media').getBoundingClientRect?.().width||window.innerWidth||512),height:expanded?(window.innerHeight||800):($('media').getBoundingClientRect?.().height||Math.round((window.innerHeight||800)*.48)),dpr:window.devicePixelRatio,mobile:/iPhone|iPad/.test(window.navigator?.userAgent||''),authuser:location.pathname.match(/^\/u\/(\d+)/)?.[1]||'0'});
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
 function refill(){
  if(idlePending||!window.Image||$('overlay').hidden)return;
  idlePending=true;
  const idle=window.requestIdleCallback?.bind(window)||((task)=>window.setTimeout(task,0));
  idle(()=>{
   idlePending=false;if($('overlay').hidden)return;
   const upcoming=deck().filter(item=>item.mediaKey!==shown).slice(0,smallBuffer?2:3);
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
 function stopMedia(){generation++;const image=$('media').querySelector('img');const old=state.items.find(item=>item.mediaKey===shown);if(image&&old&&image.complete&&image.naturalWidth)buffer.retain(old,image);const video=$('media').querySelector('video');if(video){video.pause();video.removeAttribute('src');video.load();}$('media').replaceChildren();shown=null;}
 async function display(item) {
  stopMedia();$('zoom').value='1';shown=item?.mediaKey||null;const token=generation;
  if(!item){$('media').setAttribute('aria-busy','false');$('media').textContent='No items to review. Load more or refresh latest.';$('media').style.color='white';return;}
  try {
   const cached=buffer.take(item.mediaKey);const media=item.type==='video'?(warmedKey===item.mediaKey?warmedVideo:document.createElement('video')):(cached||document.createElement('img'));if(cached)metrics.hits++;else metrics.misses++;if(media===warmedVideo){warmedVideo=null;warmedKey=null;}
   if(item.type==='video'){
    media.controls=true;media.muted=true;media.loop=true;media.playsInline=true;media.preload='metadata';media.poster=mediaURL(item.thumbUrl);
    const poster=cached||document.createElement('img');poster.alt=item.name;
    poster.onload=()=>painted(poster,token);if(!cached)poster.src=media.poster;
    media.hidden=true;$('media').replaceChildren(poster,media);$('media').setAttribute('aria-busy','true');
    if(poster.complete&&poster.naturalWidth)painted(poster,token);
    const started=window.performance?.now();
    media.oncanplay=()=>{if(token===generation)$('media').setAttribute('aria-busy','false');};
    media.onloadeddata=()=>{
     if(token!==generation)return;
     media.hidden=false;$('media').replaceChildren(media);painted(media,token);
     if(window.localStorage?.psDebug==='1')window.console?.table({videoFirstFrameMs:window.performance.now()-started});
    };
    const url=await videoURL(item);if(token!==generation)return;
    if(media.src!==url)media.src=url;media.play().catch(()=>{});
    if(media.readyState>=2)media.onloadeddata();
   }else {
    media.style.maxWidth='100%';media.style.maxHeight='100%';media.style.width='';media.style.touchAction='pan-y pinch-zoom';media.alt=item.name;media.draggable=false;
    $('media').setAttribute('aria-busy',String(!cached));
    media.onload=()=>{if(token===generation)$('media').setAttribute('aria-busy','false');painted(media,token);};
    media.ondblclick=()=>toggleEnlarge();
    if(!cached)media.src=mediaURL(item.thumbUrl);
    $('media').replaceChildren(media);
    if(media.complete&&media.naturalWidth)painted(media,token);
   }
   media.onerror=()=>{if(token===generation)message('Preview unavailable. Reload Google Photos and try again.');};
  }catch(error){if(token===generation)message(error.message);}
 }
 let trashListKey=null,queueListKey=null;
 queue_detailsElement.addEventListener('toggle',()=>render());historyPanel.addEventListener('toggle',()=>render());
 function historyView(){
  const entries=[...(state.history||[])].reverse(),nextUndo=entries.find(entry=>canUndoReview(state,entry));
  const decisionLabel=value=>value==='remove'?'Queue':value==='keep'?'Keep':'Unreviewed';
  const historyLabel=entry=>`${state.items.find(item=>item.mediaKey===entry.key)?.name||entry.key} \u00b7 ${decisionLabel(entry.previous)} \u2192 ${decisionLabel(entry.decision)}`;
  return {entries,nextUndo,historyLabel,decisionLabel};
 }
 function renderCard(){
  const item=current();
  $('caption').textContent=item?`${inspected?'Candidate inspection \u00b7 ':''}${item.name} \u00b7 ${item.date?new Date(item.date).toLocaleDateString():'Unknown date'} \u00b7 ${itemSize(item)}`:'No unreviewed items in this batch.';
  if(!$('overlay').hidden&&(shown!==(item?.mediaKey||null)||!$('media').childNodes.length))display(item);
 }
 function renderStats(){
  const queue=reviewQueue(state);
  $('stats').textContent=`${deck().length} to review \u00b7 ${state.items.filter(item=>item.decision).length}/${state.items.length} reviewed \u00b7 Queue: ${queue.length} (estimated savings: ${estimate(queue)}) \u00b7 In Trash: ${estimate(state.items.filter(item=>item.decision==='remove'&&item.state==='in_trash'))} (running total)`;
  const {nextUndo,historyLabel,decisionLabel}=historyView();
  undoPreview.textContent=nextUndo?`Next Undo: ${historyLabel(nextUndo)}; restores ${decisionLabel(nextUndo.previous)}.`:'No previous decisions can be undone.';
  $('undo').title=undoPreview.textContent;$('undo').setAttribute('aria-describedby','undo-preview');
  $('remove').textContent=inspected?'Back to review':'\u00d7 Queue';$('keep').textContent=inspected?'Keep instead':'\u2713 Keep';
  $('send').textContent=state.job?'Retry saved album operation':'Send to review album';
  $('album').hidden=!state.albumKey;if(state.albumKey)$('album').href=`https://photos.google.com/u/${location.pathname.match(/^\/u\/(\d+)/)?.[1]||'0'}/album/${encodeURIComponent(state.albumKey)}`;
 }
 function renderLists(){
  const queue=reviewQueue(state),candidates=reviewTrashCandidates(state);
  const {entries,nextUndo,historyLabel}=historyView();
  if(historyPanel.open){historyList.replaceChildren();
  for(const entry of entries){const row=document.createElement('li');row.textContent=`${historyLabel(entry)} \u00b7 ID: ${entry.key}${entry===nextUndo?' \u00b7 Next Undo':canUndoReview(state,entry)?'':' \u00b7 Unavailable for Undo'}`;historyList.append(row);}
  if(!entries.length){const row=document.createElement('li');row.textContent='No decisions yet.';historyList.append(row);}
  }
  moveTrash.textContent=`Move ${candidates.length} items to Trash`;
  trashCandidates.hidden=!trashOptIn.checked;moveTrash.hidden=!trashOptIn.checked;
  trashTitle.textContent=`Move to Trash candidates (${candidates.length})`;
  const candidateKey=JSON.stringify(candidates.map(item=>[item.mediaKey,item.name,item.thumbUrl,item.type,item.date,item.queueSent]));
  if(trashOptIn.checked&&trashListKey!==candidateKey){trashListKey=candidateKey;trashList.replaceChildren();
  for(const candidate of candidates){
   const button=document.createElement('button'),image=document.createElement('img'),label=document.createElement('span');
   image.src=mediaURL(candidate.thumbUrl);image.alt='';image.loading='lazy';
   label.textContent=`${candidate.name} \u00b7 ${candidate.type} \u00b7 ${candidate.date?new Date(candidate.date).toLocaleDateString():'Unknown date'} \u00b7 ${candidate.queueSent?'Sent to review album':'Queued'} \u00b7 ID: ${candidate.mediaKey}`;
   label.style.cssText='white-space:normal;overflow-wrap:anywhere';
   button.append(image,label);button.setAttribute('aria-label',`Inspect ${label.textContent}`);
   button.onclick=()=>{if(!busy){inspected=candidate.mediaKey;render();}};trashList.append(button);
  }
  }
  $('queue-title').textContent=`Removal queue (${queue.length})`;
  const queueKey=JSON.stringify(queue.map(item=>[item.mediaKey,item.name,item.thumbUrl]));
  if(queue_detailsElement.open&&queueListKey!==queueKey){queueListKey=queueKey;$('queue').replaceChildren();
  for(const item of queue){const button=document.createElement('button'),image=document.createElement('img'),label=document.createElement('span');image.src=mediaURL(item.thumbUrl);image.alt='';image.loading='lazy';label.textContent=item.name;button.append(image,label);button.setAttribute('aria-label',`Inspect ${item.name}`);button.onclick=()=>{if(!busy){inspected=item.mediaKey;render();}};$('queue').append(button);}
  }
 }
 function render(){renderCard();renderStats();renderLists();refill();}
 async function openSession() {
  if(closingPromise)await closingPromise;
  if(busy)return;
  busy=true;controls();$('overlay').hidden=false;$('launcher').hidden=true;buffer.clear();await syncRunning;
  const token=++leaseGeneration;
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
   if(!await renewLease())return;
   if(!changed){
    await writes.flush();
    if(writes.pending){if(!writeConflict)message('Local changes are still pending. Close and reopen to retry saving.');return;}
   }
   $('close').focus();message('Reading local progress\u2026');
   state=await db.read(identity.account);writeRevision=state.revision;
   const settings=await db.settings();
   $('sync-url').value=settings.url||'';$('sync-token').value=settings.token||'';
   syncEnabled=!!(settings.url&&settings.token);syncClient.configure(settings);
   settingsPanel.open=!syncEnabled&&!settings.onboardingDismissed;syncLocal.hidden=syncEnabled;
   if(syncEnabled)await synchronize();
   message(idleMessage());
  }catch(error){
   await releaseLease();identity=null;state=emptyReview();stopMedia();buffer.clear();message(error.message);
  }finally{busy=false;render();controls();}
 }
 function open(){
  if(openingPromise)return openingPromise;
  openingPromise=openSession().finally(()=>{openingPromise=null;});
  return openingPromise;
 }
 async function closeSession(){
  leaseGeneration++;clearInterval(leaseTimer);leaseTimer=null;
  $('overlay').hidden=true;$('launcher').hidden=false;$('launcher').focus();
  stopMedia();dropWarmVideo();buffer.clear();window.clearTimeout(syncTimer);
  await openingPromise;await activeOperation;
  $('overlay').hidden=true;$('launcher').hidden=false;stopMedia();dropWarmVideo();buffer.clear();
  try{
   if(await recoverLease()){
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
  closingPromise=closeSession().finally(()=>{closingPromise=null;});
  return closingPromise;
 }
 function decide(decision){
  if(busy||!identity||leaseError||$('overlay').hidden)return;
  if(inspected&&decision==='remove'){inspected=null;render();return;}
  const item=current();if(!item)return;
  try{
  window.performance?.mark('swipe');swipeAt=window.performance?.now()??null;const previous=item.decision,next=decideReview(state,item.mediaKey,decision,previous,item.revision||0);inspected=null;focused=null;previousKey=item.mediaKey;apply({...next,history:[...(state.history||[]),{key:item.mediaKey,previous,decision,revision:(item.revision||0)+1}]},item.mediaKey);message(decision==='remove'?'Added to the local removal queue.':`Kept ${item.name}.`);
  }catch(error){message(error.message);}
 }
 function undo(){if(busy||!identity||leaseError||$('overlay').hidden)return;try{const history=structuredClone(state.history||[]);while(history.length&&!canUndoReview(state,history.at(-1)))history.pop();const last=history.pop();if(!last){message('No previous decisions can be undone.');return;}const next=decideReview(state,last.key,last.previous,last.decision,last.revision);const previous=[...history].reverse().find(entry=>entry.key===last.key);if(previous&&previous.revision===last.revision-1)previous.revision=next.items.find(item=>item.mediaKey===last.key).revision;const restored=next.items.find(item=>item.mediaKey===last.key);inspected=restored.decision==='remove'?last.key:null;focused=restored.decision===null?last.key:null;apply({...next,history});message(`Decision undone for ${restored.name}.`);}catch(error){message(error.message);}}
 async function load(refresh=false) {
  buffer.clear();previousKey=null;
  const result=await loadReviewPages({read:async()=>state,save,call,refresh,progress:scanned=>message(`Loading library \u00b7 ${scanned} rows checked\u2026`)});
  message(`${result.added} new items to review \u00b7 ${result.scanned} library rows checked${result.exhausted?' \u00b7 End of library':''}${result.limited?' \u00b7 Scan limit reached; Load more continues from here':''}${result.warning?'. '+result.warning:''}`);
 }

 function toggleEnlarge(){$('card').classList.toggle('expanded');$('enlarge').textContent=$('card').classList.contains('expanded')?'Fit view':'Enlarge';const item=current(),image=$('media').querySelector('img');if(item&&image&&$('card').classList.contains('expanded')){const large=document.createElement('img'),token=generation;large.onload=async()=>{if(large.decode)await large.decode();if(token===generation&&$('card').classList.contains('expanded'))image.src=large.src;};large.src=mediaURL(item.thumbUrl,false,true);}}
 $('sync-save').onclick=()=>run(async()=>{const settings=validateSyncSettings($('sync-url').value.trim(),$('sync-token').value);await db.saveSettings({...settings,onboardingDismissed:true});syncEnabled=!!(settings.url&&settings.token);syncLocal.hidden=syncEnabled;syncClient.configure(settings);await synchronize();settingsPanel.open=!syncEnabled;message(idleMessage());});
 $('sync-local').onclick=()=>run(async()=>{const settings=await db.settings();await db.saveSettings({...settings,onboardingDismissed:true});settingsPanel.open=false;message(idleMessage());});
 $('launcher').onclick=open;$('close').onclick=close;$('keep').onclick=()=>decide('keep');$('remove').onclick=()=>decide('remove');$('undo').onclick=undo;$('load').onclick=()=>run(()=>load());$('refresh').onclick=()=>run(()=>load(true));$('enlarge').onclick=toggleEnlarge;
 $('filter').onchange=$('sort').onchange=()=>{inspected=null;focused=null;buffer.clear();render();};
 $('zoom').oninput=()=>{const image=$('media').querySelector('img');if(image){image.style.maxWidth='none';image.style.maxHeight='none';image.style.width=`${Number($('zoom').value)*100}%`;image.style.touchAction=Number($('zoom').value)>1?'pan-x pan-y pinch-zoom':'pan-y pinch-zoom';}};
 $('send').onclick=()=>{if(busy)return;const confirmedKeys=[...(state.job?.mediaKeys||reviewQueue(state).map(item=>item.mediaKey))];const count=confirmedKeys.length;if(!count){message('The removal queue is empty.');return;}if(!window.confirm(`Add ${count} candidates to a private review album? This does not delete media.`))return;run(async()=>{const keys=state.job?.mediaKeys||reviewQueue(state).map(item=>item.mediaKey);if(keys.length!==confirmedKeys.length||keys.some(key=>!confirmedKeys.includes(key)))throw Error('The queue changed in another tab. Review it and confirm again.');message('Updating and verifying the review album\u2026');await sendReviewAlbum({read:async()=>state,save,call,title:'Photos Swipe \u00b7 Review'});inspected=null;message('Every candidate was verified in the review album. Select Enable Move to Trash below to use this panel, or open the review album to move items manually in Google Photos.');});};
 trashOptIn.onchange=()=>render();
 moveTrash.onclick=()=>{if(busy||!trashOptIn.checked)return;const candidates=reviewTrashCandidates(state),keys=candidates.map(item=>item.mediaKey);if(!keys.length){message('No candidates to move to Trash.');return;}if(!window.confirm(`Move exactly ${keys.length} items to Google Photos Trash?\n\n${candidates.map(item=>`${item.name} (ID: ${item.mediaKey})`).join('\n')}`))return;run(async()=>{if(state.job)throw Error('Finish the saved album operation before moving items to Trash.');const currentKeys=reviewTrashCandidates(state).map(item=>item.mediaKey);if(currentKeys.length!==keys.length||currentKeys.some(key=>!keys.includes(key)))throw Error('Candidates changed. Review the item list and confirm again.');if(state.items.some(item=>keys.includes(item.mediaKey)&&!item.dedupKey))throw Error('Missing Trash identifiers. Refresh latest before retrying.');for(let index=0;index<keys.length;index+=25){const batch=keys.slice(index,index+25);await call('moveToTrash',{dedupKeys:state.items.filter(item=>batch.includes(item.mediaKey)).map(item=>item.dedupKey),confirmed:true});await save(await reconcileReviewTrash(state,call));if(state.items.some(item=>batch.includes(item.mediaKey)&&item.state!=='in_trash'))throw Error('Trash move was not verified. Check deleted items before retrying.');}trashOptIn.checked=false;moveTrash.hidden=true;message(`Verified ${keys.length} items in Trash.`);});};
 $('trash').onclick=()=>run(async()=>{message('Reading Google Photos Trash\u2026');await save(await reconcileReviewTrash(state,call));message('Trash check complete. Unknown results leave local state unchanged.');});
 let swipeStart=null;
 for(const target of [$('media'),$('swipe')]){
  target.addEventListener('pointerdown',event=>{if(busy||event.isPrimary===false||event.button!==0||event.target.tagName==='VIDEO'||Number($('zoom').value)>1)return;swipeStart={id:event.pointerId,x:event.clientX,y:event.clientY};target.setPointerCapture(event.pointerId);});
  target.addEventListener('pointerup',event=>{if(!swipeStart||event.pointerId!==swipeStart.id)return;const dx=event.clientX-swipeStart.x,dy=event.clientY-swipeStart.y;swipeStart=null;if(Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)*1.5)decide(dx>0?'keep':'remove');});
  target.addEventListener('pointercancel',()=>{swipeStart=null;});
 }
 function leavePage(){
  releaseLease();
  stopMedia();dropWarmVideo();buffer.clear();window.clearTimeout(syncTimer);
 }
 window.addEventListener('pagehide',leavePage);
 window.addEventListener('unload',leavePage);
 window.addEventListener('focus',()=>{if(identity&&!busy&&!$('overlay').hidden)synchronize();});
 document.addEventListener?.('visibilitychange',()=>{if(document.hidden){buffer.clear();if(warmedVideo){warmedVideo.removeAttribute('src');warmedVideo.load();warmedVideo=null;warmedKey=null;}}else if(identity&&!busy&&!activeOperation&&!$('overlay').hidden)refreshLease();});
 window.addEventListener('pageshow',event=>{if(event.persisted&&!$('overlay').hidden)return open();});
 function handleViewerSpace(event){
  if($('overlay').hidden||event.altKey||event.ctrlKey||event.metaKey||event.isComposing||event.key!==' ')return false;
  if(['INPUT','SELECT','TEXTAREA'].includes(root.activeElement?.tagName)||root.activeElement?.isContentEditable)return false;
  const video=$('media').querySelector('video');
  event.preventDefault();event.stopImmediatePropagation();
  if(video&&event.type==='keydown'&&!event.repeat){if(video.paused)video.play().catch(()=>{});else video.pause();}
  return true;
 }
 window.addEventListener('keyup',handleViewerSpace,true);
 window.addEventListener('keydown',event=>{
  if(handleViewerSpace(event))return;
  if($('overlay').hidden||event.altKey||event.ctrlKey||event.metaKey||event.isComposing)return;
  if(event.key==='Tab'){
   const focusable=[...root.querySelectorAll('button:not(:disabled),select,input,a[href],summary,video[controls]')].filter(element=>element.getClientRects().length);
   const index=focusable.indexOf(root.activeElement),next=event.shiftKey?(index-1+focusable.length)%focusable.length:(index+1)%focusable.length;
   event.preventDefault();event.stopImmediatePropagation();focusable[next]?.focus();return;
  }
  if(['INPUT','SELECT','TEXTAREA'].includes(root.activeElement?.tagName)||root.activeElement?.isContentEditable)return;
  const actions={ArrowLeft:()=>decide('remove'),ArrowRight:()=>decide('keep'),z:undo,Z:undo,f:toggleEnlarge,F:toggleEnlarge,Escape:close};
  if(actions[event.key]){event.preventDefault();event.stopImmediatePropagation();actions[event.key]();}
 },true);
}

mountPhotosSwipe({window,document,location,fetch:window.fetch.bind(window),crypto:window.crypto,indexedDB:window.indexedDB,AbortController:window.AbortController,setTimeout:window.setTimeout.bind(window),clearTimeout:window.clearTimeout.bind(window)});
})();
