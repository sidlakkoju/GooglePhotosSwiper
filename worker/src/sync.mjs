import {authenticate,pairingRequest} from './pairing.mjs';
const origin = 'https://photos.google.com';
const methods = 'GET, PUT, DELETE, POST, PATCH, OPTIONS';
const identifier = value => typeof value==='string' && /^[A-Za-z0-9_-]{1,256}$/.test(value);
const decision = value => value===null || value==='keep' || value==='remove';
function progressItemsValid(items) {
 return Array.isArray(items)&&items.length<=2000&&new Set(items.map(item=>item?.mediaKey)).size===items.length&&items.every(item=>item&&Object.keys(item).every(key=>['mediaKey','type','size','spaceTaken','takesUpSpace','state','revision','queueSent'].includes(key))&&identifier(item.mediaKey)&&(!Object.hasOwn(item,'type')||['photo','video'].includes(item.type))&&['size','spaceTaken'].every(key=>item[key]==null||Number.isSafeInteger(item[key])&&item[key]>=0)&&['takesUpSpace','queueSent'].every(key=>item[key]==null||typeof item[key]==='boolean')&&(!Object.hasOwn(item,'state')||['active','in_trash'].includes(item.state))&&(!Object.hasOwn(item,'revision')||Number.isSafeInteger(item.revision)&&item.revision>=0));
}
function historyValid(entries) {
 return Array.isArray(entries)&&entries.length<=2000&&entries.every(entry=>entry&&Object.keys(entry).every(key=>['key','previous','decision','revision'].includes(key))&&identifier(entry.key)&&decision(entry.previous)&&['keep','remove'].includes(entry.decision)&&Number.isSafeInteger(entry.revision)&&entry.revision>=0);
}
async function body(request) {
 if(Number(request.headers.get('Content-Length'))>262144)throw Error('Input too large');
 const reader=request.body?.getReader();let size=0;const chunks=[];
 if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>262144){await reader.cancel();throw Error('Input too large');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const value=JSON.parse(new TextDecoder().decode(bytes));
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid input');
 return value;
}
export async function syncRequest(request,env={}) {
 const headers={'Content-Type':'application/json','Cache-Control':'no-store',Vary:'Origin'};
 if(request.headers.get('Origin')===origin)headers['Access-Control-Allow-Origin']=origin;
 const respond=(value,status=200,extra={})=>new Response(value===null?null:JSON.stringify(value),{status,headers:{...headers,...extra}});
 if(request.method==='OPTIONS'){
  if(request.headers.get('Origin')!==origin)return respond({error:'Origin forbidden'},403);
  headers['Access-Control-Allow-Methods']=methods;headers['Access-Control-Allow-Headers']='Authorization, Content-Type';
  return respond(null,204);
 }
 const db=env.DB;
 try {
  if(!db)return respond({error:'Sync database unset'},500);
  const url=new URL(request.url);let scope=url.searchParams.get('scope')||'default';
  const claim=url.pathname==='/api/pair/claim'&&request.method==='POST';
  const device=claim?null:await authenticate(request,env);
  if(!claim&&!device)return respond({error:'Unauthorized'},401);
  const paired=await pairingRequest(request,env,device,body,respond);
  if(paired)return paired;
  if(!identifier(scope))return respond({error:'Invalid scope'},400);
  const mapping=await db.prepare('SELECT space FROM device_spaces WHERE device_id = ?').bind(device.id).first();
  if(mapping&&mapping.space!=='legacy')scope=mapping.space+':shared';
  const historyScope=scope+':device:'+device.id;
  const decisionStatements=(id,value)=>value===null?[db.prepare('DELETE FROM decisions WHERE scope = ? AND id = ? AND EXISTS (SELECT 1 FROM decision_versions WHERE scope = ? AND id = ? AND device_id = ?)').bind(scope,id,scope,id,device.id)]:[db.prepare("INSERT INTO decisions (scope,id,decision) VALUES (?,?,?) ON CONFLICT(scope,id) DO UPDATE SET decision = excluded.decision WHERE decisions.decision != 'remove'").bind(scope,id,value),db.prepare('INSERT INTO decision_versions (scope,id,device_id,updated_at) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM decisions WHERE scope = ? AND id = ? AND decision = ?) ON CONFLICT(scope,id) DO UPDATE SET device_id = excluded.device_id, updated_at = excluded.updated_at').bind(scope,id,device.id,Date.now(),scope,id,value)];
  const writeDecision=(id,value)=>db.batch(decisionStatements(id,value));

  const route=url.pathname,method=request.method;
  const read=async()=>{
   const rows=await db.prepare('SELECT id, decision FROM decisions WHERE scope = ?').bind(scope).all();
   const record=await db.prepare('SELECT progress, history FROM review_state WHERE scope = ?').bind(scope).first();
   const ownHistory=await db.prepare('SELECT history FROM review_state WHERE scope = ?').bind(historyScope).first();
   const progress=record?JSON.parse(record.progress):{};
   if(Object.hasOwn(progress,'items')){
    const items=await db.prepare('SELECT data FROM review_items WHERE scope = ? ORDER BY rowid').bind(scope).all();
    progress.items=items.results.map(item=>JSON.parse(item.data));
   }
   return {decisions:rows.results,progress,history:ownHistory?JSON.parse(ownHistory.history):[]};
  };
  if(route==='/api/state'&&method==='GET'){
   const state=await read();
   const migration=await db.prepare('SELECT id FROM devices WHERE is_legacy = 1 AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM devices WHERE is_legacy = 0 AND revoked_at IS NULL)').first();
   return respond({...state,...(migration?{suggestRevokeLegacy:true}:{})});
  }
  if(route==='/api/decisions'&&method==='PUT'){
   const value=await body(request);
   if(Object.keys(value).length!==1||!Array.isArray(value.decisions)||value.decisions.length>2000||!value.decisions.every(entry=>entry&&Object.keys(entry).length===2&&identifier(entry.id)&&decision(entry.decision)))throw Error('Invalid decisions');
   if(value.decisions.length)await db.batch(value.decisions.flatMap(entry=>decisionStatements(entry.id,entry.decision)));
   return respond({ok:true,merged:true,decisions:(await read()).decisions});
  }
  const match=route.match(/^\/api\/decisions\/([^/]+)$/);
  if(match&&['PUT','DELETE'].includes(method)){
   const id=decodeURIComponent(match[1]);if(!identifier(id))return respond({error:'Invalid item ID'},400);
   if(method==='DELETE')await writeDecision(id,null);
   else {const value=await body(request);if(Object.keys(value).length!==1||!['keep','remove'].includes(value.decision))throw Error('Invalid decision');await writeDecision(id,value.decision);}
   return respond({ok:true});
  }
  if(route==='/api/trash-check'&&method==='POST'){
   const value=await body(request);if(!Array.isArray(value.ids)||value.ids.length>25||!value.ids.every(identifier))throw Error('Invalid items');
   const rows=await db.batch(value.ids.map(id=>db.prepare("SELECT id FROM decisions WHERE scope = ? AND id = ? AND decision = 'remove'").bind(scope,id)));
   return respond({safe:rows.every(row=>row.results.length===1)});
  }
  if(route==='/api/progress'&&method==='GET')return respond((await read()).progress);
  if((route==='/api/progress'&&method==='PUT')||(route==='/api/undo'&&['PUT','POST'].includes(method))){
   const value=await body(request);let result=null;
   const stateScope=route==='/api/undo'?historyScope:scope;
   await db.prepare("INSERT OR IGNORE INTO review_state (scope, progress, history) VALUES (?, '{}', '[]')").bind(stateScope).run();
   if(route==='/api/progress'){
    if(!value||Object.keys(value).some(key=>!['started','reviewed','items','lifetimeFreed'].includes(key))||typeof value.started!=='boolean'||!Number.isSafeInteger(value.reviewed)||value.reviewed<0||Object.hasOwn(value,'items')&&!progressItemsValid(value.items)||Object.hasOwn(value,'lifetimeFreed')&&(!Number.isSafeInteger(value.lifetimeFreed)||value.lifetimeFreed<0))throw Error('Invalid progress');
    const incoming=JSON.stringify({...value,...(Object.hasOwn(value,'items')?{items:[]}:{})});
    const statements=(value.items||[]).map(item=>db.prepare("INSERT INTO review_items (scope, id, data) VALUES (?, ?, ?) ON CONFLICT(scope, id) DO UPDATE SET data = excluded.data WHERE COALESCE(json_extract(excluded.data, '$.revision'), 0) > COALESCE(json_extract(review_items.data, '$.revision'), 0)").bind(scope,item.mediaKey,JSON.stringify(item)));
    for(let index=0;index<statements.length;index+=100)await db.batch(statements.slice(index,index+100));
    await db.prepare('UPDATE review_state SET progress = json_patch(progress, ?) WHERE scope = ?').bind(incoming,scope).run();
    const items=[];
    for(let index=0;index<(value.items||[]).length;index+=100){
     const rows=await db.batch(value.items.slice(index,index+100).map(item=>db.prepare('SELECT data FROM review_items WHERE scope = ? AND id = ?').bind(scope,item.mediaKey)));
     for(const row of rows)items.push(JSON.parse(row.results[0].data));
    }
    result={ok:true,items};
   }else if(method==='PUT'){
    if(!historyValid(value.history)||Object.keys(value).length!==1)throw Error('Invalid undo history');
    await db.prepare('UPDATE review_state SET history = ? WHERE scope = ?').bind(JSON.stringify(value.history),historyScope).run();
   }else {
    if(Object.keys(value).some(key=>!['action','entry'].includes(key))||!['push','pop'].includes(value.action)||value.action==='push'&&!historyValid([value.entry]))throw Error('Invalid undo action');
    const record=await db.prepare("UPDATE review_state SET history = CASE WHEN ? = 'push' THEN json_insert(history, '$[#]', json(?)) ELSE json_remove(history, '$[#-1]') END WHERE scope = ? AND (? = 'pop' OR json_array_length(history) < 2000) RETURNING history").bind(value.action,JSON.stringify(value.entry||null),historyScope,value.action).first();
    if(!record)throw Error('Undo history full');result=JSON.parse(record.history);
   }
   return respond(result||{ok:true});
  }
  return respond({error:'Not found'},404);
 }catch(error){return respond({error:error.message.startsWith('Invalid')||error.message==='Input too large'||error.message==='Undo history full'?error.message:'Sync request failed'},error instanceof SyntaxError||error instanceof URIError||error.message.startsWith('Invalid')||error.message==='Input too large'||error.message==='Undo history full'?400:500);}
}
