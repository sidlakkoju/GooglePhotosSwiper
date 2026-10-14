import {decisionWins} from './decision-merge.mjs';
import {authenticate,pairingRequest} from './pairing.mjs';
const origin = 'https://photos.google.com';
const methods = 'GET, PUT, DELETE, POST, PATCH, OPTIONS';
const identifier = value => typeof value==='string' && /^[A-Za-z0-9_-]{1,256}$/.test(value);
const decision = value => value===null || value==='keep' || value==='remove';
const now="CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
export function digest(text){let hash=0x811c9dc5;for(let index=0;index<text.length;index++){hash^=text.charCodeAt(index);hash=Math.imul(hash,0x01000193)>>>0;}return hash.toString(36);}
function progressItemsValid(items) {
 return Array.isArray(items)&&items.length<=2000&&new Set(items.map(item=>item?.mediaKey)).size===items.length&&items.every(item=>item&&Object.keys(item).every(key=>['mediaKey','type','size','spaceTaken','takesUpSpace','state','revision','queueSent','lastDecisionAt','lastDecisionSwipe','keepCount'].includes(key))&&identifier(item.mediaKey)&&(!Object.hasOwn(item,'type')||['photo','video'].includes(item.type))&&['size','spaceTaken','lastDecisionAt','lastDecisionSwipe','keepCount'].every(key=>item[key]==null||Number.isSafeInteger(item[key])&&item[key]>=0)&&['takesUpSpace','queueSent'].every(key=>item[key]==null||typeof item[key]==='boolean')&&(!Object.hasOwn(item,'state')||['active','in_trash'].includes(item.state))&&(!Object.hasOwn(item,'revision')||Number.isSafeInteger(item.revision)&&item.revision>=0));
}
function historyValid(entries) {
 return Array.isArray(entries)&&entries.length<=2000&&entries.every(entry=>entry&&Object.keys(entry).every(key=>['key','previous','decision','revision','cooldown'].includes(key))&&(!Object.hasOwn(entry,'cooldown')||entry.cooldown&&Object.keys(entry.cooldown).every(key=>['lastDecisionAt','lastDecisionSwipe','keepCount'].includes(key)&& (entry.cooldown[key]===null||Number.isSafeInteger(entry.cooldown[key])&&entry.cooldown[key]>=0)))&&identifier(entry.key)&&decision(entry.previous)&&['keep','remove'].includes(entry.decision)&&Number.isSafeInteger(entry.revision)&&entry.revision>=0);
}
async function body(request,limit=262144) {
 if(Number(request.headers.get('Content-Length'))>limit)throw Error('Input too large');
 const reader=request.body?.getReader();let size=0;const chunks=[];
 if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw Error('Input too large');}chunks.push(value);}
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
  const decisionStatements=(id,value,updatedAt=Date.now(),undo=false)=>{
   const owned="(NOT EXISTS (SELECT 1 FROM decisions WHERE scope = ? AND id = ?) OR EXISTS (SELECT 1 FROM decision_versions WHERE scope = ? AND id = ? AND device_id = ?))";
   const ownerArgs=[scope,id,scope,id,device.id];
   const notTrashed="NOT EXISTS (SELECT 1 FROM review_items WHERE scope = ? AND id = ? AND json_extract(data, '$.state') = 'in_trash')";
   if(value===null)return [
    db.prepare(`INSERT INTO decision_versions (scope,id,device_id,updated_at,changed_at) SELECT ?,?,?,?,${now} WHERE ${owned} AND ${notTrashed} ON CONFLICT(scope,id) DO UPDATE SET updated_at = excluded.updated_at, changed_at = excluded.changed_at WHERE decision_versions.device_id = excluded.device_id AND excluded.updated_at >= decision_versions.updated_at`).bind(scope,id,device.id,updatedAt,...ownerArgs,scope,id),
    db.prepare(`DELETE FROM decisions WHERE scope = ? AND id = ? AND EXISTS (SELECT 1 FROM decision_versions WHERE scope = ? AND id = ? AND device_id = ? AND updated_at = ?) AND ${notTrashed}`).bind(scope,id,scope,id,device.id,updatedAt,scope,id)
   ];
   const statements=[];
   if(value==='keep')statements.push(db.prepare('INSERT INTO decision_keeps (scope,id,updated_at) VALUES (?,?,?) ON CONFLICT(scope,id) DO UPDATE SET updated_at = MAX(decision_keeps.updated_at, excluded.updated_at)').bind(scope,id,updatedAt));
   const insertWins=decisionWins('(SELECT decision FROM decisions WHERE scope = ? AND id = ?)','?','(SELECT updated_at FROM decision_versions WHERE scope = ? AND id = ?)','?');
   const wins=decisionWins('(SELECT decision FROM decisions WHERE scope = ? AND id = ?)','?','decision_versions.updated_at','excluded.updated_at');
   statements.push(db.prepare(`INSERT INTO decision_versions (scope,id,device_id,updated_at,changed_at) SELECT ?,?,?,?,${now} WHERE ${notTrashed} AND ${undo?owned:insertWins} ON CONFLICT(scope,id) DO UPDATE SET device_id = excluded.device_id, updated_at = excluded.updated_at, changed_at = excluded.changed_at WHERE ${undo?'decision_versions.device_id = excluded.device_id AND excluded.updated_at >= decision_versions.updated_at':wins}`).bind(scope,id,device.id,updatedAt,scope,id,...(undo?ownerArgs:[scope,id,value,scope,id,updatedAt]),...(undo?[]:[scope,id,value])));
   statements.push(db.prepare(`INSERT INTO decisions (scope,id,decision) SELECT ?,?,? WHERE ${notTrashed} AND EXISTS (SELECT 1 FROM decision_versions WHERE scope = ? AND id = ? AND device_id = ? AND updated_at = ?)${undo?'':" AND (? = 'remove' OR NOT EXISTS (SELECT 1 FROM decisions WHERE scope = ? AND id = ? AND decision = 'remove'))"} ON CONFLICT(scope,id) DO UPDATE SET decision = excluded.decision`).bind(scope,id,value,scope,id,scope,id,device.id,updatedAt,...(undo?[]:[value,scope,id])));
   return statements;
  };
  const writeDecision=(id,value,updatedAt,undo)=>db.batch(decisionStatements(id,value,updatedAt,undo));

  const route=url.pathname,method=request.method;
  const tag=digest(scope);
  const owners=rows=>mapping&&mapping.space!=='legacy'?{decisionOwners:Object.fromEntries(rows.filter(row=>row.device_id!==null).map(row=>[row.id,row.device_id===device.id]))}:{};
  const read=async({items:includeItems=true,since,cursor=false}={})=>{
   const at=includeItems||cursor?(await db.prepare(`SELECT ${now} AS now`).first()).now:undefined;
   const rows=await db.prepare('SELECT id, decision FROM decisions WHERE scope = ?').bind(scope).all();
   const record=await db.prepare('SELECT progress FROM review_state WHERE scope = ?').bind(scope).first();
   const ownHistory=await db.prepare('SELECT history FROM review_state WHERE scope = ?').bind(historyScope).first();
   const progress=record?JSON.parse(record.progress):{};
   if(includeItems){
    if(Object.hasOwn(progress,'items')){
     const items=since===undefined?await db.prepare('SELECT data FROM review_items WHERE scope = ? ORDER BY rowid').bind(scope).all():await db.prepare('SELECT data FROM review_items WHERE scope = ? AND updated_at >= ? ORDER BY updated_at').bind(scope,Math.max(0,since-1000)).all();
     progress.items=items.results.map(item=>JSON.parse(item.data));
    }
   }else delete progress.items;
   const versions=mapping&&mapping.space!=='legacy'?(await db.prepare('SELECT id,device_id FROM decision_versions WHERE scope = ?').bind(scope).all()).results:[];
   return {decisions:rows.results,progress,...(includeItems?{itemsCursor:at}:{}),...(cursor?{cursor:at+'.'+tag}:{}),history:ownHistory?JSON.parse(ownHistory.history):[],...owners(versions)};
  };
  const changes=async since=>{
   const from=Math.max(0,since-1000);
   const head=await db.prepare(`SELECT ${now} AS now, COALESCE((SELECT MAX(changed_at) FROM decision_versions WHERE scope = ?),-1) AS decisions_at, COALESCE((SELECT MAX(updated_at) FROM review_items WHERE scope = ?),-1) AS items_at, (SELECT progress FROM review_state WHERE scope = ?) AS progress`).bind(scope,scope,scope).first();
   const progress=head.progress?JSON.parse(head.progress):{};
   const rows=head.decisions_at>=from?(await db.prepare('SELECT v.id, d.decision, v.device_id FROM decision_versions v LEFT JOIN decisions d ON d.scope = v.scope AND d.id = v.id WHERE v.scope = ? AND v.changed_at >= ?').bind(scope,from).all()).results:[];
   if(Object.hasOwn(progress,'items'))progress.items=head.items_at>=from?(await db.prepare('SELECT data FROM review_items WHERE scope = ? AND updated_at >= ? ORDER BY updated_at').bind(scope,from).all()).results.map(item=>JSON.parse(item.data)):[];
   return {delta:true,decisions:rows.map(({id,decision})=>({id,decision})),progress,cursor:head.now+'.'+tag,...owners(rows)};
  };
  if(route==='/api/state'&&method==='GET'){
   const since=url.searchParams.get('since'),cursor=url.searchParams.get('cursor');
   if(since!==null&&!/^\d{1,15}$/.test(since))return respond({error:'Invalid since'},400);
   if(cursor!==null){
    const parsed=/^(?:(\d{1,15})\.([0-9a-z]{1,7}))?$/.exec(cursor);
    if(!parsed)return respond({error:'Invalid cursor'},400);
    return respond(parsed[1]&&parsed[2]===tag?await changes(Number(parsed[1])):await read({cursor:true}));
   }
   return respond(await read({since:since===null?undefined:Number(since)}));
  }
  if(route==='/api/decisions'&&method==='PUT'){
   const value=await body(request);
   if(Object.keys(value).length!==1||!Array.isArray(value.decisions)||value.decisions.length>2000||!value.decisions.every(entry=>entry&&Object.keys(entry).every(key=>['id','decision','updatedAt','undo'].includes(key))&&identifier(entry.id)&&decision(entry.decision)&&(entry.updatedAt===undefined||Number.isSafeInteger(entry.updatedAt)&&entry.updatedAt>=0)&&(entry.undo===undefined||typeof entry.undo==='boolean')))throw Error('Invalid decisions');
   const statements=value.decisions.flatMap(entry=>decisionStatements(entry.id,entry.decision,entry.updatedAt,entry.undo));
   if(url.searchParams.get('delta')==='1'){
    const ids=[...new Set(value.decisions.map(entry=>entry.id))];
    statements.push(...ids.map(id=>db.prepare('SELECT ? AS id, (SELECT decision FROM decisions WHERE scope = ? AND id = ?) AS decision, (SELECT device_id FROM decision_versions WHERE scope = ? AND id = ?) AS device_id').bind(id,scope,id,scope,id)));
    const results=statements.length?await db.batch(statements):[],rows=results.slice(results.length-ids.length).flatMap(result=>result.results);
    return respond({ok:true,delta:true,decisions:rows.map(({id,decision})=>({id,decision})),...owners(rows)});
   }
   if(statements.length)await db.batch(statements);
   const state=await read({items:false});return respond({ok:true,merged:true,decisions:state.decisions,...(state.decisionOwners?{decisionOwners:state.decisionOwners}:{})});
  }
  const match=route.match(/^\/api\/decisions\/([^/]+)$/);
  if(match&&['PUT','DELETE'].includes(method)){
   const id=decodeURIComponent(match[1]);if(!identifier(id))return respond({error:'Invalid item ID'},400);
   if(method==='DELETE')await writeDecision(id,null);
   else {const value=await body(request);if(Object.keys(value).some(key=>!['decision','updatedAt','undo'].includes(key))||!['keep','remove'].includes(value.decision)||(value.updatedAt!==undefined&&(!Number.isSafeInteger(value.updatedAt)||value.updatedAt<0))||(value.undo!==undefined&&typeof value.undo!=='boolean'))throw Error('Invalid decision');await writeDecision(id,value.decision,value.updatedAt,value.undo);}
   return respond({ok:true});
  }
  if(route==='/api/trash-check'&&method==='POST'){
   const value=await body(request);if(!Array.isArray(value.ids)||value.ids.length>25||!value.ids.every(identifier))throw Error('Invalid items');
   const rows=await db.batch(value.ids.map(id=>db.prepare("SELECT d.id FROM decisions d LEFT JOIN decision_versions v ON v.scope = d.scope AND v.id = d.id LEFT JOIN decision_keeps k ON k.scope = d.scope AND k.id = d.id WHERE d.scope = ? AND d.id = ? AND d.decision = 'remove' AND COALESCE(k.updated_at,0) <= COALESCE(v.updated_at,0)").bind(scope,id)));
   return respond({safe:rows.every(row=>row.results.length===1)});
  }
  if(route==='/api/progress'&&method==='GET')return respond((await read()).progress);
  if((route==='/api/progress'&&method==='PUT')||(route==='/api/undo'&&['PUT','POST'].includes(method))){
   const value=await body(request,route==='/api/undo'&&method==='PUT'?1048576:262144);let result=null;
   const stateScope=route==='/api/undo'?historyScope:scope;
   await db.prepare("INSERT OR IGNORE INTO review_state (scope, progress, history) VALUES (?, '{}', '[]')").bind(stateScope).run();
   if(route==='/api/progress'){
    if(!value||Object.keys(value).some(key=>!['started','reviewed','items','lifetimeFreed','swipeCount'].includes(key))||Object.hasOwn(value,'swipeCount')&&(!Number.isSafeInteger(value.swipeCount)||value.swipeCount<0)||typeof value.started!=='boolean'||!Number.isSafeInteger(value.reviewed)||value.reviewed<0||Object.hasOwn(value,'items')&&!progressItemsValid(value.items)||Object.hasOwn(value,'lifetimeFreed')&&(!Number.isSafeInteger(value.lifetimeFreed)||value.lifetimeFreed<0))throw Error('Invalid progress');
    const incoming=JSON.stringify({...value,...(Object.hasOwn(value,'items')?{items:[]}:{})});
    const items=value.items||[],stored=new Map();
    for(let index=0;index<items.length;index+=100){
     const batch=items.slice(index,index+100),results=await db.batch(batch.map(item=>db.prepare(`INSERT INTO review_items (scope, id, data, updated_at) VALUES (?, ?, ?, ${now}) ON CONFLICT(scope, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at WHERE COALESCE(json_extract(review_items.data, '$.state'),'active') != 'in_trash' AND (json_extract(excluded.data, '$.state') = 'in_trash' OR COALESCE(json_extract(excluded.data, '$.revision'), 0) > COALESCE(json_extract(review_items.data, '$.revision'), 0))`).bind(scope,item.mediaKey,JSON.stringify(item))));
     batch.forEach((item,position)=>{if(results[position]?.meta?.changes===1)stored.set(item.mediaKey,JSON.stringify(item));});
    }
    await db.prepare('UPDATE review_state SET progress = json_patch(progress, ?) WHERE scope = ?').bind(incoming,scope).run();
    const missing=items.filter(item=>!stored.has(item.mediaKey));
    for(let index=0;index<missing.length;index+=100){
     const rows=await db.batch(missing.slice(index,index+100).map(item=>db.prepare('SELECT data FROM review_items WHERE scope = ? AND id = ?').bind(scope,item.mediaKey)));
     missing.slice(index,index+100).forEach((item,position)=>stored.set(item.mediaKey,rows[position].results[0].data));
    }
    result={ok:true,items:items.map(item=>JSON.parse(stored.get(item.mediaKey)))};
   }else if(method==='PUT'){
    if(!historyValid(value.history)||Object.keys(value).length!==1)throw Error('Invalid undo history');
    await db.prepare('UPDATE review_state SET history = ? WHERE scope = ?').bind(JSON.stringify(value.history),historyScope).run();
   }else if(value.action==='patch'){
    if(Object.keys(value).some(key=>!['action','base','start','end','append'].includes(key))||typeof value.base!=='string'||!/^[0-9a-z]{1,7}$/.test(value.base)||!Number.isSafeInteger(value.start)||!Number.isSafeInteger(value.end)||value.start<0||value.end<value.start||!historyValid(value.append))throw Error('Invalid undo action');
    const record=await db.prepare('SELECT history FROM review_state WHERE scope = ?').bind(historyScope).first();
    if(digest(record.history)!==value.base)return respond({error:'Undo history changed'},409);
    const history=JSON.parse(record.history);
    if(value.end>history.length)throw Error('Invalid undo action');
    const next=[...history.slice(value.start,value.end),...value.append];
    if(!historyValid(next))throw Error('Invalid undo history');
    if(!await db.prepare('UPDATE review_state SET history = ? WHERE scope = ? AND history = ? RETURNING scope').bind(JSON.stringify(next),historyScope,record.history).first())return respond({error:'Undo history changed'},409);
    result={ok:true,length:next.length};
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
