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
 async function sync(scope,state,save) {
  if(blocked||!settings.url||!settings.token)return state;
  let retryAvailable=firstSync;firstSync=false;
  const syncRequest=async(...args)=>{
   try{return await request(...args);}catch(error){
    if(error.name!=='TimeoutError'||!retryAvailable)throw error;
    retryAvailable=false;return request(...args);
   }
  };
  status('Syncing…');
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
