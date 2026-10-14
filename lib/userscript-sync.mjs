import {reviewSwipeCount,reviewStorage} from './userscript-core.mjs';
const fields=['mediaKey','type','size','spaceTaken','takesUpSpace','state','revision','queueSent','lastDecisionAt','lastDecisionSwipe','keepCount'];
function syncedItemWorthKeeping(item){return !!item&&((item.revision||0)>0||(item.state!==undefined&&item.state!=='active')||!!item.queueSent||!!item.lastDecisionAt||!!item.keepCount);}
export function changedProgressItems(items,previous=[]){
 const before=new Map(previous.map(item=>[item.mediaKey,item]));
 return items.filter(item=>{const old=before.get(item.mediaKey);return (syncedItemWorthKeeping(item)||syncedItemWorthKeeping(old))&&JSON.stringify(item)!==JSON.stringify(old);});
}
function cursorKey(token){let hash=0x811c9dc5;for(let index=0;index<token.length;index++){hash^=token.charCodeAt(index);hash=Math.imul(hash,0x01000193)>>>0;}return hash.toString(36);}
function syncedPreviewItem(item){const local={...item};delete local.urlFetchedAt;return local;}
function mergeProgressItem(item,checkpoint) {
 return {...Object.fromEntries(Object.entries(item).filter(([field])=>!fields.includes(field))),...Object.fromEntries(fields.filter(field=>checkpoint[field]!==undefined).map(field=>[field,checkpoint[field]]))};
}
export function createSyncClient({fetch,status=()=>{},unpaired=()=>{}}) {
 let settings={},blocked=false,firstSync=true,failures=0,retryAt=0;
 const failed=()=>{failures++;retryAt=Date.now()+Math.min(SYNC_BACKOFF_MS*2**(failures-1),SYNC_BACKOFF_MAX_MS);};
 const configure=value=>{settings=value||{};blocked=false;firstSync=true;status(settings.url&&settings.token?'Sync ready':'Sync off · saved locally');};
 async function request(scope,path,method='GET',value,query={}) {
  if(blocked)throw Error('This device was unpaired.');
  if(!settings.url||!settings.token)throw Error('Configure sync to manage paired devices.');
  const url=new URL(path,settings.url.replace(/\/$/,'')+'/');url.searchParams.set('scope',scope);for(const [key,entry] of Object.entries(query))url.searchParams.set(key,String(entry));
  const signal=AbortSignal.timeout(10000);
  try {
   const response=await fetch(url.href,{method,headers:{Authorization:`Bearer ${settings.token}`,...(value?{'Content-Type':'application/json'}:{})},...(value?{body:JSON.stringify(value)}:{}),credentials:'omit',referrerPolicy:'no-referrer',signal});
   if(response.status===401){blocked=true;status('This device was unpaired.');await unpaired();throw Error('This device was unpaired.');}
   if(!response.ok)throw Object.assign(Error(`Sync HTTP ${response.status}`),{status:response.status});
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
  status('Syncing…');
  let checkpoint=state;
  const itemsKey=cursorKey(settings.token),cursor=state.syncCursor?.key===itemsKey&&typeof state.syncCursor.at==='string'&&state.syncDecisions&&(state.started||state.items.length||state.history.length)?state.syncCursor.at:'';
  try {
   const remote=pull?await syncRequest(scope,'api/state','GET',undefined,{cursor}):{delta:true,decisions:[],progress:state.syncProgress||{}};
   const decisions=remote.delta?{...state.syncDecisions}:{},owners={...remote.decisionOwners};
   const applyDecisions=rows=>{for(const {id,decision} of rows)if(decision==null)delete decisions[id];else decisions[id]=decision;};
   applyDecisions(remote.decisions);
   const pending={...state.syncPending},pendingTimes={...state.syncPendingTimes};
   if(state.syncDecisions==null)for(const item of state.items)if(item.decision&&!Object.hasOwn(pending,item.mediaKey)){pending[item.mediaKey]=item.decision;pendingTimes[item.mediaKey]=item.lastDecisionAt??0;}
   const dirty=state.syncDirty||!state.syncDecisions&&state.history.length>0;
   const historyKeys=new Set([...(state.syncHistoryKeys||[]),...Object.keys(pending),...(dirty?state.history.map(entry=>entry.key):[])]);
   const remaining={...pending};
   for(const batch of decisionBatches(pending,pendingTimes,state.syncPendingUndo)){
    const accepted=await syncRequest(scope,'api/decisions','PUT',{decisions:batch},{delta:1});
    for(const {id} of batch)delete remaining[id];
    applyDecisions(batch);
    if(accepted.delta&&Array.isArray(accepted.decisions)){applyDecisions(accepted.decisions);Object.assign(owners,accepted.decisionOwners);}
    else if(accepted.merged&&accepted.decisions){for(const id of Object.keys(decisions))delete decisions[id];applyDecisions(accepted.decisions);Object.assign(owners,accepted.decisionOwners);}
    checkpoint={...state,syncDecisions:{...decisions},syncPending:{...remaining},syncPendingTimes:pendingTimes,syncDirty:dirty,syncHistoryKeys:[...historyKeys]};
   }
   const remoteHistory=remote.delta?null:remote.history,historyBase=remoteHistory||state.syncHistory;
   const history=(remoteHistory?dirty?mergeHistory(remoteHistory,state.history,historyKeys):remoteHistory:state.history).filter(entry=>owners[entry.key]!==false).slice(-2000);
   const checkpointItems=new Map((remote.progress.items||[]).map(item=>[item.mediaKey,item]));
   const checkpointRevisions=new Map([...checkpointItems].map(([key,item])=>[key,item.revision||0]));
   const mergedItems=state.items.map(item=>{
    const checkpoint=checkpointItems.get(item.mediaKey);checkpointItems.delete(item.mediaKey);
    return checkpoint&&(checkpoint.revision||0)>=(item.revision||0)?mergeProgressItem(item,checkpoint):item;
   });
   for(const item of checkpointItems.values())mergedItems.push({...syncedPreviewItem(item),name:item.mediaKey,type:item.type||'photo',needsPreview:true});
   const items=mergedItems.map(item=>{
    const value=decisions[item.mediaKey]??(Object.hasOwn(pending,item.mediaKey)||Object.hasOwn(state.syncDecisions||{},item.mediaKey)?null:item.decision);
    const entry=history.findLast(entry=>entry.key===item.mediaKey&&entry.decision===value);
    return {...item,decision:value,revision:!dirty&&entry&&(value!==item.decision||!item.revision)?Math.max(entry.revision,checkpointRevisions.get(item.mediaKey)||0):item.revision};
   });
   let next={...state,swipeCount:Math.max(reviewSwipeCount(state),remote.progress.swipeCount||0),history,items,syncDecisions:decisions,lifetimeFreed:Math.max(state.lifetimeFreed||0,remote.progress.lifetimeFreed||0,reviewStorage(items.filter(item=>item.state==='in_trash')).bytes)};
   if(!state.started&&!state.items.length&&!state.history.length&&!dirty&&Object.keys(pending).length===0&&(remote.progress.started||Object.keys(decisions).length)){
    const restored=remote.progress.items?.map(item=>({...item}))||Object.keys(decisions).map(mediaKey=>({mediaKey,revision:history.findLast(entry=>entry.key===mediaKey)?.revision||0,state:'active'}));
    for(const mediaKey of Object.keys(decisions))if(!restored.some(item=>item.mediaKey===mediaKey))restored.push({mediaKey,revision:history.findLast(entry=>entry.key===mediaKey)?.revision||0,state:'active'});
    next={...next,started:!!remote.progress.started,items:restored.map(item=>({...syncedPreviewItem(item),name:item.mediaKey,type:item.type||'photo',decision:decisions[item.mediaKey]??null,needsPreview:true})),lifetimeFreed:remote.progress.lifetimeFreed||0};
    try{next=await rebuild(next);}catch(error){status(`${error.message} · checkpoint recovered; retry loading the library`);}
   }
   let progress=reviewSyncProgress(next,decisions);
   const {items:checkpointList,...checkpointMetadata}=state.syncCheckpoint||{},{items:progressList,...progressMetadata}=progress;
   const changedItems=changedProgressItems(progressList,Array.isArray(checkpointList)?checkpointList:[]);
   const progressDirty=dirty||(changedItems.length>0||JSON.stringify(progressMetadata)!==JSON.stringify(checkpointMetadata))&&state.items.length>0;
   let writeError=null,historySynced=false;
   const accepted=new Map();
   try{
    if(dirty){
     const patch=historyBase&&historyPatch(historyBase,history),body=patch&&{action:'patch',base:cursorKey(JSON.stringify(historyBase)),...patch};
     let patched=false;
     if(body&&new TextEncoder().encode(JSON.stringify(body)).length<=262144){
      try{patched=(await syncRequest(scope,'api/undo','POST',body)).length===history.length;}catch(error){if(error.status!==409)throw error;}
     }
     if(!patched)await syncRequest(scope,'api/undo','PUT',{history});
     historySynced=true;
    }
    if(progressDirty){
     for(const batch of progressBatches({...progress,items:changedItems})){
      const result=await syncRequest(scope,'api/progress','PUT',batch);
      const items=result.items||(await syncRequest(scope,'api/state')).progress.items;
      if(!Array.isArray(items)||batch.items.some(item=>!items.some(row=>row.mediaKey===item.mediaKey)))throw Error('Unconfirmed sync');
      for(const item of items)accepted.set(item.mediaKey,item);
     }
    }
   }catch(error){writeError=error;}
   if(accepted.size){
    next={...next,items:next.items.map(item=>accepted.has(item.mediaKey)?mergeProgressItem(item,accepted.get(item.mediaKey)):item)};
    progress.items=reviewSyncProgress(next,decisions).items;
   }
   const confirmed=new Map(progress.items.filter(item=>accepted.has(item.mediaKey)).map(item=>[item.mediaKey,item]));
   const syncCheckpoint=!writeError?{...progress,items:progress.items.filter(syncedItemWorthKeeping)}:confirmed.size?{...checkpointMetadata,items:[...(Array.isArray(checkpointList)?checkpointList:[]).filter(item=>!confirmed.has(item.mediaKey)),...[...confirmed.values()].filter(syncedItemWorthKeeping)]}:state.syncCheckpoint;
   const unsynced=!!writeError&&!historySynced;
   const {syncItemsCursor,...saved}=next;
   next=await save({...saved,syncPending:{},syncPendingTimes:{},syncPendingUndo:{},syncDirty:unsynced&&!!dirty,syncHistoryKeys:unsynced?[...historyKeys]:[],syncHistory:historySynced?history:historyBase,syncProgress:Object.fromEntries(Object.entries(remote.progress||{}).filter(([key])=>key!=='items')),syncCheckpoint,...(pull&&typeof remote.cursor==='string'?{syncCursor:{key:itemsKey,at:remote.cursor}}:{})});
   if(writeError){failed();if(!blocked)status(`${writeError.message} · pull saved locally; retry on next action`);return next;}
   failures=0;retryAt=0;
   status(`Synced · ${Object.keys(decisions).length} reviewed IDs`);return next;
  }catch(error){failed();if(!blocked)status(`${error.message} · saved locally; retry on next action`);return checkpoint===state?state:await save(checkpoint);}
 }
 return {configure,sync,ready:(now=Date.now())=>now>=retryAt,trashCheck:(scope,ids)=>request(scope,'api/trash-check','POST',{ids}),devices:()=>request('default','api/devices'),rename:(id,name)=>request('default',`api/devices/${encodeURIComponent(id)}`,'PATCH',{name}),revoke:id=>request('default',`api/devices/${encodeURIComponent(id)}`,'DELETE'),revokeOthers:()=>request('default','api/devices/revoke-others','POST')};
}
export const SYNC_POLL_MS=60000,SYNC_IDLE_POLL_MS=300000,SYNC_IDLE_AFTER_MS=120000,SYNC_PUSH_DELAY_MS=5000,SYNC_BACKOFF_MS=5000,SYNC_BACKOFF_MAX_MS=300000;
export function heartbeatSync(state,lastPullAt,now,activeAt=now){
 if(now-lastPullAt>=(now-activeAt<SYNC_IDLE_AFTER_MS?SYNC_POLL_MS:SYNC_IDLE_POLL_MS))return 'pull';
 return state.syncDirty||Object.keys(state.syncPending||{}).length?'push':null;
}
export function markSyncChanges(previous,next) {
 const pending={...previous.syncPending},times={...previous.syncPendingTimes},undos={...previous.syncPendingUndo};
 const undo=next.history.length<previous.history.length;
 const old=new Map(previous.items.map(item=>[item.mediaKey,item.decision]));
 let dirty=!!previous.syncDirty||JSON.stringify(previous.history)!==JSON.stringify(next.history);
 const items=next.items.map(item=>{
  if(!old.has(item.mediaKey)&&previous.syncDecisions?.[item.mediaKey])return {...item,decision:previous.syncDecisions[item.mediaKey],revision:previous.history.findLast(entry=>entry.key===item.mediaKey)?.revision||item.revision||0};
  if((old.get(item.mediaKey)??null)!==(item.decision??null)){pending[item.mediaKey]=item.decision??null;times[item.mediaKey]=Date.now();undos[item.mediaKey]=undo||item.decision==='keep'&&(!!undos[item.mediaKey]||old.get(item.mediaKey)==='remove');dirty=true;}
  return item;
 });
 return {...next,items,syncPending:pending,syncPendingTimes:times,syncPendingUndo:undos,syncDirty:dirty};
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
export function reviewSyncProgress(state,decisions=state.syncDecisions||{}) {
 return {swipeCount:reviewSwipeCount(state),started:!!state.started,reviewed:Object.keys(decisions).length,items:state.items.map(item=>Object.fromEntries(fields.filter(field=>item[field]!==undefined).map(field=>[field,item[field]]))),lifetimeFreed:state.lifetimeFreed||reviewStorage(state.items.filter(item=>item.state==='in_trash')).bytes};
}
export async function rebuildSyncedReview(state,call) {
 const items=new Map(state.items.map(item=>[item.mediaKey,item])),seen=new Set();let cursor=null,exhausted=false;
 for(let count=0;count<12;count++){
  const page=await call('library',{cursor});
  for(const item of page.items){const old=items.get(item.mediaKey),storage=Object.fromEntries(['size','spaceTaken','takesUpSpace'].map(field=>[field,item[field]??old?.[field]]));items.set(item.mediaKey,{...old,...item,...storage,decision:state.syncDecisions[item.mediaKey]??null,state:old?.state||'active',revision:old?.revision||0,urlFetchedAt:Date.now(),needsPreview:false});}
  if(page.nextPageId&&(page.nextPageId===cursor||seen.has(page.nextPageId)))throw Error('Google repeated a library page during sync recovery.');
  cursor=page.nextPageId;exhausted=!cursor;seen.add(cursor);
  if(exhausted||[...items.values()].filter(item=>!item.decision&&!item.needsPreview&&item.state!=='in_trash').length>=50)break;
 }
 return {...state,items:[...items.values()],started:true,cursor,exhausted};
}

export function historyPatch(base,next) {
 const before=base.map(entry=>JSON.stringify(entry)),after=next.map(entry=>JSON.stringify(entry));
 let start=0,end=0;
 for(let index=0;index<before.length;index++){
  if(before[index]!==after[0])continue;
  let run=1;while(index+run<before.length&&run<after.length&&before[index+run]===after[run])run++;
  if(run>end-start){start=index;end=index+run;}
  if(index+run===before.length)break;
 }
 return end>start?{start,end,append:next.slice(end-start)}:null;
}
function mergeHistory(remote,local,keys) {
 return [...remote.filter(entry=>!keys.has(entry.key)),...local.filter(entry=>keys.has(entry.key))];
}
export function mergeSyncResult(current,snapshot,synced) {
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
 return {...current,swipeCount:Math.max(reviewSwipeCount(current),reviewSwipeCount(synced)),...(recovered?{started:synced.started,cursor:synced.cursor,exhausted:synced.exhausted}:{}),lifetimeFreed:Math.max(current.lifetimeFreed||0,synced.lifetimeFreed||0),syncProgress:synced.syncProgress,syncCheckpoint:synced.syncCheckpoint,syncCursor:synced.syncCursor,syncHistory:synced.syncHistory,items,history,syncDecisions:synced.syncDecisions,syncPending:pending,syncPendingTimes:{...synced.syncPendingTimes,...Object.fromEntries([...changed].filter(key=>Object.hasOwn(current.syncPendingTimes||{},key)).map(key=>[key,current.syncPendingTimes[key]]))},syncPendingUndo:{...synced.syncPendingUndo,...Object.fromEntries([...changed].filter(key=>Object.hasOwn(current.syncPendingUndo||{},key)).map(key=>[key,current.syncPendingUndo[key]]))},syncHistoryKeys:[...new Set([...(synced.syncHistoryKeys||[]),...changed])],syncDirty:!!synced.syncDirty||JSON.stringify(history)!==JSON.stringify(synced.history)};
}
export function decisionBatches(pending,times={},undos={}) {
 const batches=[];let batch=[],bytes=16;
 for(const [id,decision] of Object.entries(pending)){
  const entry={id,decision,...(times?.[id]!==undefined?{updatedAt:times[id]}:{}),...(undos?.[id]?{undo:true}:{})},size=new TextEncoder().encode(JSON.stringify(entry)).length;
  if(batch.length&&(batch.length===2000||bytes+size+1>262144)){batches.push(batch);batch=[];bytes=16;}
  if(bytes+size>262144)throw Error('Decision exceeds sync input limit');
  bytes+=size+(batch.length?1:0);batch.push(entry);
 }
 if(batch.length)batches.push(batch);
 return batches;
}

export function privateSyncFetch(GM){
 return (url,options={})=>new Promise((resolve,reject)=>{
  const abort=()=>{handle?.abort?.();reject(new DOMException('Sync cancelled','AbortError'));};
  let handle;
  if(options.signal?.aborted){abort();return;}
  options.signal?.addEventListener('abort',abort,{once:true});
  const finish=callback=>value=>{options.signal?.removeEventListener('abort',abort);callback(value);};
  handle=GM.xmlHttpRequest({url,method:options.method||'GET',headers:options.headers,data:options.body,timeout:10000,onload:finish(response=>resolve({ok:response.status>=200&&response.status<300,status:response.status,json:async()=>JSON.parse(response.responseText)})),onerror:finish(()=>reject(Error('Sync request failed'))),ontimeout:finish(()=>reject(new DOMException('Sync timed out','TimeoutError')))});
 });
}
