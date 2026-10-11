import {reviewStorage} from './userscript-core.mjs';
export function createSyncClient({fetch,status=()=>{},unpaired=()=>{}}) {
 let settings={},blocked=false;
 const configure=value=>{settings=value||{};blocked=false;status(settings.url&&settings.token?'Sync ready':'Sync off · saved locally');};
 async function request(scope,path,method='GET',value) {
  if(blocked)throw Error('This device was unpaired.');
  if(!settings.url||!settings.token)throw Error('Configure sync to manage paired devices.');
  const url=new URL(path,settings.url.replace(/\/$/,'')+'/');url.searchParams.set('scope',scope);
  const response=await fetch(url.href,{method,headers:{Authorization:`Bearer ${settings.token}`,...(value?{'Content-Type':'application/json'}:{})},...(value?{body:JSON.stringify(value)}:{}),credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(10000)});
  if(response.status===401){blocked=true;status('This device was unpaired.');await unpaired();throw Error('This device was unpaired.');}
  if(!response.ok)throw Error(`Sync HTTP ${response.status}`);
  return response.json();
 }
 async function sync(scope,state,save,rebuild=async value=>value) {
  if(blocked||!settings.url||!settings.token)return state;
  status('Syncing…');
  try {
   const remote=await request(scope,'api/state');
   const decisions={...Object.fromEntries(remote.decisions.map(item=>[item.id,item.decision]))};
   const pending={...state.syncPending};
   if(state.syncDecisions==null)for(const item of state.items)if(item.decision&&!Object.hasOwn(pending,item.mediaKey))pending[item.mediaKey]=item.decision;
   const dirty=state.syncDirty||!state.syncDecisions&&state.history.length>0;
   for(const [id,value] of Object.entries(pending)){
    await request(scope,`api/decisions/${encodeURIComponent(id)}`,value===null?'DELETE':'PUT',value===null?undefined:{decision:value});
    if(value===null)delete decisions[id];else decisions[id]=value;
   }
   const history=(dirty?state.history:remote.history).slice(-2000);
   const items=state.items.map(item=>{
    const value=Object.hasOwn(pending,item.mediaKey)?pending[item.mediaKey]:decisions[item.mediaKey]??(Object.hasOwn(state.syncDecisions||{},item.mediaKey)?null:item.decision);
    const entry=history.findLast(entry=>entry.key===item.mediaKey&&entry.decision===value);
    return {...item,decision:value,revision:!dirty&&entry&&(value!==item.decision||!item.revision)?entry.revision:item.revision};
   });
   let next={...state,history,items,syncDecisions:decisions,lifetimeFreed:Math.max(state.lifetimeFreed||0,remote.progress.lifetimeFreed||0,reviewStorage(items.filter(item=>item.state==='in_trash')).bytes)};
   if(!state.started&&!state.items.length&&!state.history.length&&!dirty&&Object.keys(pending).length===0&&(remote.progress.started||Object.keys(decisions).length)){
    const restored=remote.progress.items?.map(item=>({...item}))||Object.keys(decisions).map(mediaKey=>({mediaKey,revision:history.findLast(entry=>entry.key===mediaKey)?.revision||0,state:'active'}));
    for(const mediaKey of Object.keys(decisions))if(!restored.some(item=>item.mediaKey===mediaKey))restored.push({mediaKey,revision:history.findLast(entry=>entry.key===mediaKey)?.revision||0,state:'active'});
    next=await rebuild({...next,started:!!remote.progress.started,items:restored.map(item=>({...item,name:item.mediaKey,type:item.type||'photo',decision:decisions[item.mediaKey]??null,needsPreview:true})),lifetimeFreed:remote.progress.lifetimeFreed||0});
   }
   const progress=reviewSyncProgress(next,decisions);
   const progressDirty=dirty||JSON.stringify(progress)!==JSON.stringify(state.syncCheckpoint)&&state.items.length>0;
   if(dirty){
    await request(scope,'api/undo','PUT',{history});
   }
   if(progressDirty)for(const batch of progressBatches(progress))await request(scope,'api/progress','PUT',batch);
   next=await save({...next,syncPending:{},syncDirty:false,syncProgress:remote.progress,syncCheckpoint:progress});
   status(`Synced · ${Object.keys(decisions).length} reviewed IDs${remote.suggestRevokeLegacy?' · Device paired; retire the exposed shared sync token.':''}`);return next;
  }catch(error){if(!blocked)status(`${error.message} · saved locally; retry on next action`);return state;}
 }
 return {configure,sync,devices:()=>request('default','api/devices'),rename:(id,name)=>request('default',`api/devices/${encodeURIComponent(id)}`,'PATCH',{name}),revoke:id=>request('default',`api/devices/${encodeURIComponent(id)}`,'DELETE'),revokeOthers:()=>request('default','api/devices/revoke-others','POST'),async pair(url,code,name,platform){
  const response=await fetch(new URL('api/pair/claim',url).href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({short:code,name,platform}),credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error(`Pairing HTTP ${response.status}`);
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
 const fields=['mediaKey','type','size','spaceTaken','takesUpSpace','state','revision','queueSent'];
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
