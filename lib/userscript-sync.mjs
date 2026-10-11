export function createSyncClient({fetch,status=()=>{}}) {
 let settings={};
 const configure=value=>{settings=value||{};status(settings.url&&settings.token?'Sync ready':'Sync off · saved locally');};
 async function request(scope,path,method='GET',value) {
  const url=new URL(path,settings.url.replace(/\/$/,'')+'/');url.searchParams.set('scope',scope);
  const response=await fetch(url.href,{method,headers:{Authorization:`Bearer ${settings.token}`,...(value?{'Content-Type':'application/json'}:{})},...(value?{body:JSON.stringify(value)}:{}),credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error(`Sync HTTP ${response.status}`);
  return response.json();
 }
 async function sync(scope,state,save,{pull=true}={}) {
  if(!settings.url||!settings.token)return state;
  status('Syncing…');
  let checkpoint=state;
  try {
   const remote=pull?await request(scope,'api/state'):{decisions:Object.entries(state.syncDecisions||{}).map(([id,decision])=>({id,decision})),history:state.history,progress:state.syncProgress};
   const decisions={...Object.fromEntries(remote.decisions.map(item=>[item.id,item.decision]))};
   const pending={...state.syncPending};
   if(state.syncDecisions==null)for(const item of state.items)if(item.decision&&!Object.hasOwn(pending,item.mediaKey))pending[item.mediaKey]=item.decision;
   const dirty=state.syncDirty||!state.syncDecisions&&state.history.length>0;
   const remaining={...pending};
   for(const batch of decisionBatches(pending)){
    await request(scope,'api/decisions','PUT',{decisions:batch});
    for(const {id,decision} of batch){delete remaining[id];if(decision===null)delete decisions[id];else decisions[id]=decision;}
    checkpoint={...state,syncDecisions:{...decisions},syncPending:{...remaining},syncDirty:dirty};
   }
   for(const [id,value] of Object.entries(pending)){if(value===null)delete decisions[id];else decisions[id]=value;}
   const history=(dirty?mergeHistory(remote.history,state.history,new Set(Object.keys(pending))):remote.history).slice(-2000);
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
   next=await save({...next,syncPending:{},syncDirty:false,syncProgress:remote.progress});
   status(`Synced · ${Object.keys(decisions).length} reviewed IDs`);return next;
  }catch(error){status(`${error.message} · saved locally; retry on next action`);return checkpoint===state?state:await save(checkpoint);}
 }
 return {configure,sync};
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
 return {...current,items:current.items.map(item=>changed.has(item.mediaKey)?item:incoming.get(item.mediaKey)||item),history,syncDecisions:synced.syncDecisions,syncPending:pending,syncDirty:!!synced.syncDirty||JSON.stringify(history)!==JSON.stringify(synced.history)};
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
