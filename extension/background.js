import { browserTrimUpload } from './trim-upload.js';
import { storedSourceDownload } from './trim-download.js';
import { photosOperation } from './photos-api.js';
const APP='http://localhost:3000';
let operationRunning=false;
function version(){return chrome.runtime.getManifest?.().version||'1.2.2';}
async function api(path,data,token){
 let r;
 try{r=await fetch(`${APP}/api/bridge${path}`,{method:data?'POST':'GET',signal:AbortSignal.timeout(['/status','/pair'].includes(path)?15000:360000),headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(data?{body:JSON.stringify(data)}:{})});}
 catch{throw Error('The local app did not respond. Open localhost:3000, check that the server is running, and retry.');}
 let b;try{b=await r.json();}catch{throw Error('The local app returned an unexpected response. Restart the local server and retry.');}
 if(!r.ok)throw Error(b.error||'Local server unavailable.');return b;
}
function photosTab(tab){try{const u=new URL(tab?.url);return u.origin==='https://photos.google.com';}catch{return false;}}
async function google(tabId,operation,args={}){
 let tab;try{tab=await chrome.tabs.get(tabId);}catch{throw Error('The paired Google Photos tab is closed. Open Google Photos and check connection again, or pair from its extension popup.');}
 if(!photosTab(tab))throw Error('The paired tab is no longer Google Photos. Open Google Photos and check connection again.');
 let results;try{results=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:photosOperation,args:[operation,args]});}catch{throw Error('The extension could not access Google Photos. Reload that tab and check connection again.');}
 const r=results[0]?.result;if(!r?.ok)throw Error(r?.error||'Google Photos did not respond. Reload its tab and try again.');return r.data;
}
async function livePair(pair,verify=true){
 let tab;try{tab=await chrome.tabs.get(pair.tabId);}catch{}
 if(photosTab(tab)){
  if(!verify)return {pair,identity:null,recoveredTab:false};
  const identity=await google(pair.tabId,'identity');
  if(identity.account!==pair.account)throw Error('The paired Google Photos tab has a different account. Switch it back or pair the intended account again.');
  return {pair,identity,recoveredTab:false};
 }
 // Only read identities when the old tab is gone; never switch away from a live
 // tab that changed accounts, and never bind an unverified tab to the saved token.
 const tabs=await chrome.tabs.query({url:'https://photos.google.com/*'});
 for(const candidate of tabs){
  if(!photosTab(candidate))continue;
  let identity;try{identity=await google(candidate.id,'identity');}catch{continue;}
  if(identity.account!==pair.account)continue;
  const current=(await chrome.storage.local.get('pair')).pair;
  if(current?.token!==pair.token||current.account!==pair.account)throw Error('Pairing changed during the connection check. Check again.');
  const restored={...pair,tabId:candidate.id};await chrome.storage.local.set({pair:restored});
  return {pair:restored,identity,recoveredTab:true};
 }
 throw Error('No open Google Photos tab matches the paired account. Open that account in Google Photos, then check again. To change accounts, pair through its extension popup.');
}
function safeMedia(v){try{const u=new URL(v);return u.protocol==='https:'&&(u.hostname==='photos.fife.usercontent.google.com'||u.hostname.endsWith('.googleusercontent.com'))&&!u.port&&!u.username&&!u.password;}catch{return false;}}
async function preview(url){if(!safeMedia(url))throw Error('Unexpected Google preview host.');const response=await fetch(url,{credentials:'include',redirect:'error',signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Preview expired. Rescan the latest batch in Google Photos.');if(!response.headers.get('content-type')?.startsWith('image/'))throw Error('Unexpected preview format.');if(Number(response.headers.get('content-length'))>8*1024*1024)throw Error('Preview too large.');const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>8*1024*1024)throw Error('Preview too large.');let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return {dataUrl:`data:${response.headers.get('content-type').split(';')[0]};base64,${btoa(binary)}`};}
async function perform(operation,args,sender){
 const ownPopup=sender.id===chrome.runtime.id&&!sender.tab&&sender.url===chrome.runtime.getURL('popup.html');
 const ownApp=sender.id===chrome.runtime.id&&sender.frameId===0&&sender.tab?.url?.startsWith(`${APP}/`);
 if(!ownApp&&!ownPopup)throw Error('This page cannot use the Photos Swipe bridge.');
 if(operation==='status'){
  const saved=await chrome.storage.local.get('pair');if(!saved.pair)return {installed:true,version:version(),paired:false};
  await api('/status',null,saved.pair.token);
  const live=await livePair(saved.pair);
  return {installed:true,version:version(),paired:true,label:live.identity.label,recoveredTab:live.recoveredTab,reconciliationSupported:true,trimSupported:true,trimUploadSupported:true,trimArchiveSupported:true};
 }
 if(operation==='pair'){
  if(!ownPopup)throw Error('Pair through the extension popup.');const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!photosTab(tab))throw Error('Open your Google Photos tab, then click this extension.');const identity=await google(tab.id,'identity');const result=await api('/pair',{code:String(args.code),...identity});await chrome.storage.local.set({pair:{token:result.token,account:identity.account,tabId:tab.id,label:identity.label}});return {label:identity.label};
 }
 if(operation==='forget'){if(!ownPopup)throw Error('Disconnect through the extension popup.');await chrome.storage.local.remove('pair');return {ok:true};}
 const saved=await chrome.storage.local.get('pair');if(!saved.pair)throw Error('Pair the extension first.');await api('/status',null,saved.pair.token);const {pair}=await livePair(saved.pair,false);
 const call=(operation,args={})=>google(pair.tabId,operation,{...args,account:pair.account});
 if(operation==='import'){
  if(operationRunning)throw Error('Another bridge operation is in progress.');operationRunning=true;
  try{const state=await api('/cursor',null,pair.token);if(!args?.restart&&state.exhausted)throw Error('All library pages have been imported. Rescan newest to refresh.');const data=await call('library',{cursor:args?.restart?null:state.cursor});await api('/import',data,pair.token);return {count:data.items.length,warning:data.metadataWarning};}finally{operationRunning=false;}
 }
 if(operation==='reconcile'){
  if(operationRunning)throw Error('Another bridge operation is in progress.');operationRunning=true;
  try{
   const snapshot=await api('/reconcile',null,pair.token),trashKeys=new Set(),trashDedup=new Set(),seen=new Set();let cursor=null;
   do{const page=await call('trashPage',{cursor});for(const item of page.items){trashKeys.add(item.mediaKey);if(item.dedupKey)trashDedup.add(item.dedupKey);}cursor=page.nextPageId;if(cursor&&seen.has(cursor))throw Error('Google repeated a Trash page. Nothing was updated.');seen.add(cursor);if(seen.size>1000)throw Error('Trash scan is too large. Nothing was updated.');}while(cursor);
   let members=null,albumUnavailable=false;if(snapshot.albumKey){try{members=await call('albumMembers',{albumKey:snapshot.albumKey});}catch(error){if(!snapshot.albumTitle)throw error;const found=await call('findAlbum',{title:snapshot.albumTitle});if(found.albumKey===snapshot.albumKey)throw error;albumUnavailable=true;}}
   const results=[];
   for(const item of snapshot.items){const inTrash=trashKeys.has(item.mediaKey)||!!item.dedupKey&&trashDedup.has(item.dedupKey);
    const inAlbum=members&&item.albumKey===snapshot.albumKey?(members.keys.includes(item.mediaKey)||!!item.dedupKey&&members.dedupKeys.includes(item.dedupKey)):null;
    let state=inTrash?'in_trash':albumUnavailable&&item.albumKey?'unknown':'active';
    if(!inTrash&&(item.state==='in_trash'||item.albumKey&&inAlbum===false))state=(await call('itemState',{mediaKey:item.mediaKey})).state;
    results.push({id:item.id,revision:item.revision,state,inAlbum});
   }
   return await api('/reconcile',{results,albumUnavailable,albumKey:snapshot.albumKey},pair.token);
  }finally{operationRunning=false;}
 }
 if(operation==='trimConfirmSource'){
  if(operationRunning)throw Error('Another bridge operation is in progress.');operationRunning=true;
  try{const job=await api(`/trim-jobs/${args.jobId}`,null,pair.token);if(job.uploadStarted){if(!job.sourceMetadataConfirmed)throw Error('This upload began without confirmed source metadata. Leave the original unchanged and recreate after reconciliation.');return job;}const state=await call('itemState',{mediaKey:job.source.mediaKey});await api(`/trim-jobs/${job.id}/original-state`,{mediaKey:job.source.mediaKey,state:state.state},pair.token);const info=await call('trimInfo',{mediaKey:job.source.mediaKey});return await api(`/trim-jobs/${job.id}/source-info`,info,pair.token);}finally{operationRunning=false;}
 }
 if(operation==='trimUpload'){
  if(operationRunning)throw Error('Another bridge operation is in progress.');operationRunning=true;
  try{return await browserTrimUpload({jobId:args.jobId,pair,server:(path,data)=>api(path,data,pair.token),call,storage:chrome.storage.local});}finally{operationRunning=false;}
 }
 if(operation==='trimCleanup'){
  const job=await api(`/trim-jobs/${args.jobId}`,null,pair.token);if(!['completed','cancelled'].includes(job.status)||job.account!==pair.account)throw Error('Only a closed crop can clean its Chrome upload checkpoint.');await chrome.storage.local.remove(`trim-upload:${pair.account}:${job.id}`);await chrome.storage.local.remove(`trim-source:${pair.account}:${job.id}`);return {ok:true};
 }
 if(operation==='trimSource'||operation==='trimVerify'){
  if(operationRunning)throw Error('Another bridge operation is in progress.');operationRunning=true;
  try{const job=await api(`/trim-jobs/${args.jobId}`,null,pair.token);
   if(operation==='trimVerify'){if(!job.uploadStarted&&!job.sourceMetadataConfirmed){const source=await call('trimInfo',{mediaKey:job.source.mediaKey});await api(`/trim-jobs/${job.id}/source-info`,source,pair.token);}const info=await call('trimFind',{name:job.name});const state=await call('itemState',{mediaKey:job.source.mediaKey});await api(`/trim-jobs/${job.id}/original-state`,{mediaKey:job.source.mediaKey,state:state.state},pair.token);return await api(`/trim-jobs/${job.id}/metadata`,info,pair.token);}
   if(job.exportReport)return job;if(job.archiveValidated)return api(`/trim-jobs/${job.id}/resume`,{},pair.token);
   const info=await call('trimInfo',{mediaKey:job.source.mediaKey});if(info.size!==job.source.size)throw Error('Stored original size changed. Refresh and start a new crop.');
   await api(`/trim-jobs/${job.id}/source-info`,info,pair.token);
   const source=await storedSourceDownload({job,pair,call,storage:chrome.storage.local,readJob:()=>api(`/trim-jobs/${job.id}`,null,pair.token)}),archive=source.state==='archive';
   if(!safeMedia(source.url)||!Number.isSafeInteger(source.size)||source.size<1||source.size>(archive?1024*1024*1024+16*1024*1024:1024*1024*1024)||!archive&&(source.size!==job.source.size||source.name!==job.source.name))throw Error('Stored-file download does not match the original.');
   const current=await api(`/trim-jobs/${job.id}`,null,pair.token);if(['completed','cancelled'].includes(current.status)||current.sourceRevision!==job.sourceRevision)throw Error('The crop changed while its original was being prepared.');
   const route=archive?'source-archive':'source',response=await fetch(source.url,{credentials:'include',redirect:'error',signal:AbortSignal.timeout(180000)});if(!response.ok||!response.body)throw Error('Chrome could not download the stored original. Resume to retry its saved request.');
   // Archive and media bytes stay bounded; Google credentials never reach localhost.
   const declared=response.headers.get('content-length');if(declared!==null&&Number(declared)!==source.size)throw Error('Google download byte size differs from its acknowledged request.');
   let offset=(archive?current.archiveBytes:current.sourceBytes)||0,skipped=0;
   if(offset>source.size)throw Error('Stored download offset exceeds its acknowledged bytes.');
   const send=async(part,final=false)=>{const r=await fetch(`${APP}/api/bridge/trim-jobs/${job.id}/${route}`,{method:'PUT',headers:{Authorization:`Bearer ${pair.token}`,'Content-Type':'application/octet-stream','X-Source-Offset':String(offset),...(archive?{'X-Archive-Size':String(source.size)}:{}),...(final?{'X-Source-Final':'true'}:{})},body:part,signal:AbortSignal.timeout(final?360000:30000)});if(!r.ok)throw Error((await r.json()).error);return r.json();};
   for await(const chunk of response.body){let position=Math.min(chunk.length,Math.max(0,offset-skipped));skipped+=chunk.length;if(skipped>source.size)throw Error('Google download exceeds its acknowledged byte size.');while(position<chunk.length){const part=chunk.subarray(position,position+1024*1024);await send(part);offset+=part.length;position+=part.length;}}
   if(skipped!==source.size||offset!==source.size)throw Error('Google stored download ended before all acknowledged bytes arrived. Resume its saved checkpoint.');
   const prepared=await send(new Uint8Array(),true);await chrome.storage.local.remove(`trim-source:${pair.account}:${job.id}`);return prepared;
  }finally{operationRunning=false;}
 }
 if(operation==='preview'||operation==='video'){
  // Load canonical metadata from the local server, never a page-supplied URL.
  const item=await api(`/items/${encodeURIComponent(args.id)}`,null,pair.token);
  if(operation==='video'){const result=await call('video',{mediaKey:item.mediaKey});if(!safeMedia(result.url))throw Error('Unexpected video host. Open it in Google Photos instead.');return result;}
  await call('identity');const thumb=new URL(item.thumbUrl);thumb.searchParams.set('authuser',new URL((await chrome.tabs.get(pair.tabId)).url).pathname.match(/^\/u\/(\d+)/)?.[1]||'0');thumb.pathname=thumb.pathname.replace(/=.+$/,'')+'=w1200-h1200-k-no';return preview(thumb.href);
 }
 if(operation==='sendAlbum'){
  if(operationRunning)throw Error('Another bridge operation is in progress.');operationRunning=true;let job;
  try{
   job=await api(`/jobs/${args.jobId}`,null,pair.token);if(job.status==='completed')return job;
   if(job.status!=='queued')throw Error('Retry the operation in the app before running it again.');
   job=await api(`/jobs/${job.id}`,{status:'running'},pair.token);
   let members,found;
   if(job.albumKey){try{members=await call('albumMembers',{albumKey:job.albumKey});}catch(error){found=await call('findAlbum',{title:job.title});if(found.albumKey===job.albumKey)throw Error(`The review album exists but could not be read. Reload Google Photos and retry. ${error.message}`);job=await api(`/jobs/${job.id}/reset-album`,{previousAlbumKey:job.albumKey},pair.token);}}
   if(!job.albumKey){found ||= await call('findAlbum',{title:job.title});const albumKey=found.albumKey||(await call('createAlbum',{title:job.title})).albumKey;job=await api(`/jobs/${job.id}`,{albumKey,status:'running'},pair.token);members=await call('albumMembers',{albumKey:job.albumKey});}
   const matches=(members,index)=>members.keys.includes(job.mediaKeys[index])||!!job.dedupKeys?.[index]&&members.dedupKeys?.includes(job.dedupKeys[index]);
   let confirmed=job.mediaKeys.filter((k,index)=>matches(members,index));job=await api(`/jobs/${job.id}`,{confirmed,status:'running'},pair.token);
   const missing=job.mediaKeys.filter((k,index)=>!matches(members,index));
   for(let i=0;i<missing.length;i+=25){const chunk=missing.slice(i,i+25);let writeError;
    try{await call('addToAlbum',{albumKey:job.albumKey,mediaKeys:chunk});}catch(e){writeError=e;}
    members=await call('albumMembers',{albumKey:job.albumKey});confirmed=job.mediaKeys.filter((k,index)=>matches(members,index));job=await api(`/jobs/${job.id}`,{confirmed,status:'running'},pair.token);
    if(chunk.some(k=>!confirmed.includes(k)))throw writeError||Error('Google has not confirmed every photo. Retry to reconcile the album.');
   }
   return await api(`/jobs/${job.id}`,{confirmed:job.mediaKeys,status:'completed'},pair.token);
  }catch(e){if(job)try{await api(`/jobs/${job.id}`,{status:'failed',error:e.message},pair.token);}catch{}throw e;}finally{operationRunning=false;}
 }
 throw Error('Unsupported bridge command.');
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{perform(message.operation,message.args||{},sender).then(data=>respond({ok:true,data})).catch(e=>respond({ok:false,error:e.message}));return true;});
