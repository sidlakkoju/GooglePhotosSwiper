const origin = 'https://photos.google.com';
const methods = 'GET, PUT, DELETE, POST, OPTIONS';
const encoder = new TextEncoder();
async function authorized(header, secret) {
 const candidate = header?.startsWith('Bearer ') ? header.slice(7) : '';
 const digest = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
 const [left,right] = await Promise.all([digest(candidate),digest(secret)]);
 let difference = 0;
 for(let index=0;index<left.length;index++)difference |= left[index]^right[index];
 return difference===0;
}
const identifier = value => typeof value==='string' && /^[A-Za-z0-9_-]{1,256}$/.test(value);
const decision = value => value===null || value==='keep' || value==='remove';
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
 const respond=(value,status=200)=>new Response(value===null?null:JSON.stringify(value),{status,headers});
 if(request.method==='OPTIONS'){
  if(request.headers.get('Origin')!==origin)return respond({error:'Origin forbidden'},403);
  headers['Access-Control-Allow-Methods']=methods;headers['Access-Control-Allow-Headers']='Authorization, Content-Type';
  return respond(null,204);
 }
 if(!env.SYNC_TOKEN)return respond({error:'Sync secret unset'},500);
 if(!await authorized(request.headers.get('Authorization'),env.SYNC_TOKEN))return respond({error:'Unauthorized'},401);
 const url=new URL(request.url),scope=url.searchParams.get('scope')||'default';
 if(!identifier(scope))return respond({error:'Invalid scope'},400);
 const db=env.DB;
 try {
  const route=url.pathname,method=request.method;
  const read=async()=>{
   const rows=await db.prepare('SELECT id, decision FROM decisions WHERE scope = ?').bind(scope).all();
   const record=await db.prepare('SELECT progress, history FROM review_state WHERE scope = ?').bind(scope).first();
   return {decisions:rows.results,progress:record?JSON.parse(record.progress):{},history:record?JSON.parse(record.history):[]};
  };
  if(route==='/api/state'&&method==='GET')return respond(await read());
  const match=route.match(/^\/api\/decisions\/([^/]+)$/);
  if(match&&['PUT','DELETE'].includes(method)){
   const id=decodeURIComponent(match[1]);if(!identifier(id))return respond({error:'Invalid item ID'},400);
   if(method==='DELETE')await db.prepare('DELETE FROM decisions WHERE scope = ? AND id = ?').bind(scope,id).run();
   else {const value=await body(request);if(Object.keys(value).length!==1||!['keep','remove'].includes(value.decision))throw Error('Invalid decision');await db.prepare('INSERT INTO decisions (scope, id, decision) VALUES (?, ?, ?) ON CONFLICT(scope, id) DO UPDATE SET decision = excluded.decision').bind(scope,id,value.decision).run();}
   return respond({ok:true});
  }
  if(route==='/api/progress'&&method==='GET')return respond((await read()).progress);
  if((route==='/api/progress'&&method==='PUT')||(route==='/api/undo'&&['PUT','POST'].includes(method))){
   const value=await body(request);let result=null;
   await db.prepare("INSERT OR IGNORE INTO review_state (scope, progress, history) VALUES (?, '{}', '[]')").bind(scope).run();
   if(route==='/api/progress'){
    if(!value||Object.keys(value).some(key=>!['started','reviewed'].includes(key))||typeof value.started!=='boolean'||!Number.isSafeInteger(value.reviewed)||value.reviewed<0)throw Error('Invalid progress');
    await db.prepare('UPDATE review_state SET progress = ? WHERE scope = ?').bind(JSON.stringify(value),scope).run();
   }else if(method==='PUT'){
    if(!historyValid(value.history)||Object.keys(value).length!==1)throw Error('Invalid undo history');
    await db.prepare('UPDATE review_state SET history = ? WHERE scope = ?').bind(JSON.stringify(value.history),scope).run();
   }else {
    if(Object.keys(value).some(key=>!['action','entry'].includes(key))||!['push','pop'].includes(value.action)||value.action==='push'&&!historyValid([value.entry]))throw Error('Invalid undo action');
    const record=await db.prepare("UPDATE review_state SET history = CASE WHEN ? = 'push' THEN json_insert(history, '$[#]', json(?)) ELSE json_remove(history, '$[#-1]') END WHERE scope = ? AND (? = 'pop' OR json_array_length(history) < 2000) RETURNING history").bind(value.action,JSON.stringify(value.entry||null),scope,value.action).first();
    if(!record)throw Error('Undo history full');result=JSON.parse(record.history);
   }
   return respond(result||{ok:true});
  }
  return respond({error:'Not found'},404);
 }catch(error){return respond({error:error.message.startsWith('Invalid')||error.message==='Input too large'||error.message==='Undo history full'?error.message:'Sync request failed'},error instanceof SyntaxError||error instanceof URIError||error.message.startsWith('Invalid')||error.message==='Input too large'||error.message==='Undo history full'?400:500);}
}
