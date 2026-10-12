import {reviewStorage} from './userscript-core.mjs';
const fields=['mediaKey','type','size','spaceTaken','takesUpSpace','state','revision','queueSent'];
function mergeProgressItem(item,checkpoint) {
 return {...Object.fromEntries(Object.entries(item).filter(([field])=>!fields.includes(field))),...checkpoint};
}
export function createSyncClient({fetch,status=()=>{},unpaired=()=>{}}) {
 let settings={},blocked=false,firstSync=true;
 const configure=value=>{settings=value||{};blocked=false;firstSync=true;status(settings.url&&settings.token?'Sync ready':'Sync off · saved locally');};
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
  status('Syncing…');
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
    try{next=await rebuild(next);}catch(error){status(`${error.message} · checkpoint recovered; retry loading the library`);}
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
   if(writeError){if(!blocked)status(`${writeError.message} · pull saved locally; retry on next action`);return next;}
   status(`Synced · ${Object.keys(decisions).length} reviewed IDs${remote.suggestRevokeLegacy?' · Device paired; retire the exposed shared sync token.':''}`);return next;
  }catch(error){if(!blocked)status(`${error.message} · saved locally; retry on next action`);return checkpoint===state?state:await save(checkpoint);}
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
export function markSyncChanges(previous,next) {
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
export function validateSyncSettings(url,token) {
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
export function reviewSyncProgress(state,decisions=state.syncDecisions||{}) {
 return {started:!!state.started,reviewed:Object.keys(decisions).length,items:state.items.map(item=>Object.fromEntries(fields.filter(field=>item[field]!==undefined).map(field=>[field,item[field]]))),lifetimeFreed:state.lifetimeFreed||reviewStorage(state.items.filter(item=>item.state==='in_trash')).bytes};
}
export async function rebuildSyncedReview(state,call) {
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
 return {...current,...(recovered?{started:synced.started,cursor:synced.cursor,exhausted:synced.exhausted}:{}),lifetimeFreed:Math.max(current.lifetimeFreed||0,synced.lifetimeFreed||0),syncProgress:synced.syncProgress,syncCheckpoint:synced.syncCheckpoint,items,history,syncDecisions:synced.syncDecisions,syncPending:pending,syncHistoryKeys:[...new Set([...(synced.syncHistoryKeys||[]),...changed])],syncDirty:!!synced.syncDirty||JSON.stringify(history)!==JSON.stringify(synced.history)};
}
export function decisionBatches(pending) {
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
