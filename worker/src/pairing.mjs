const encoder = new TextEncoder();
export const hash = async value => new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
const random = size => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(size)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
function shortCode() {
 let value;
 do {value=crypto.getRandomValues(new Uint32Array(1))[0];} while(value>=4294000000);
 return String(value%1000000).padStart(6,'0');
}
const nowSeconds = () => Math.floor(Date.now()/1000);
export async function authenticate(request,env) {
 const token=request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
 if(!token)return null;
 const digest=await hash(token),db=env.DB,now=nowSeconds();
 if(env.SYNC_TOKEN){
  const legacyHash=await hash(env.SYNC_TOKEN);
  let difference=0;
  for(let index=0;index<digest.length;index++)difference|=digest[index]^legacyHash[index];
  if(difference===0){
   await db.prepare("INSERT OR IGNORE INTO devices (id,name,platform,created_at,last_seen_at,is_legacy) VALUES ('legacy','Legacy shared token','legacy',?,?,1)").bind(now,now).run();
   const legacy=await db.prepare("SELECT * FROM devices WHERE id = 'legacy' AND revoked_at IS NULL").first();
   if(!legacy)return null;
   await touch(db,legacy.id,now);
   return legacy;
  }
 }
 const device=await db.prepare('SELECT * FROM devices WHERE token_hash = ? AND revoked_at IS NULL').bind(digest).first();
 if(device)await touch(db,device.id,now);
 return device;
}
async function touch(db,id,now) {
 await db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ? AND last_seen_at <= ?').bind(now,id,now-60).run();
}
async function limit(db,key,now,maximum) {
 const window=Math.floor(now/3600)*3600;
 const results=await db.batch([
  db.prepare('DELETE FROM pair_attempts WHERE window_start < ?').bind(window),
  db.prepare('INSERT INTO pair_attempts (ip_hash,window_start,count) VALUES (?, ?, 1) ON CONFLICT(ip_hash,window_start) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count').bind(key,window,maximum)
 ]);
 return results[1].results.length>0;
}
const label = value => typeof value==='string'&&value.trim().length>0&&value.trim().length<=40&&!/[\p{Cc}\p{Cf}<>]/u.test(value);
export async function pairingRequest(request,env,device,readBody,respond) {
 const url=new URL(request.url),route=url.pathname,method=request.method,db=env.DB,now=nowSeconds();
 const limited=()=>respond({error:'rate_limited'},429,{'Retry-After':String(3600-now%3600)});
 if(route==='/api/pair/claim'&&method==='POST'){
  if(!env.PAIRING_IP_KEY)return respond({error:'pairing_misconfigured'},500);
  const key=await crypto.subtle.importKey('raw',encoder.encode(env.PAIRING_IP_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const ipHash=new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(request.headers.get('CF-Connecting-IP')||'unknown')));
  if(!await limit(db,ipHash,now,30))return limited();
  const value=await readBody(request);
  if(Object.keys(value).some(key=>!['code','short','name','platform'].includes(key))||!label(value.name)||!label(value.platform)||Boolean(value.code)===Boolean(value.short))throw Error('Invalid pairing input');
  const isShort=!!value.short,input=isShort?value.short:value.code;
  if(typeof input!=='string'||!(isShort?/^\d{6}$/:/^[A-Za-z0-9_-]{22}$/).test(input))return respond({error:'invalid'},400);
  const globalKey=await hash('global-short-failures'),window=Math.floor(now/3600)*3600;
  if(isShort){
   const attempts=await db.prepare('SELECT count FROM pair_attempts WHERE ip_hash = ? AND window_start = ?').bind(globalKey,window).first();
   if(attempts?.count>=100)return limited();
  }
  const inputHash=await hash(input),column=isShort?'short_hash':'code_hash',id=crypto.randomUUID(),token=random(32),tokenHash=await hash(token);
  const results=await db.batch([
   db.prepare(`UPDATE pairing_codes SET used_at = ?, claimed_device = ? WHERE ${column} = ? AND used_at IS NULL AND expires_at > ? AND failed_attempts < 5 AND EXISTS (SELECT 1 FROM devices WHERE id = created_by_device AND revoked_at IS NULL)${isShort?' AND COALESCE((SELECT count FROM pair_attempts WHERE ip_hash = ? AND window_start = ?),0) < 100':''} RETURNING id`).bind(now,id,inputHash,now,...(isShort?[globalKey,window]:[])),
   db.prepare('INSERT INTO devices (id,name,platform,token_hash,created_at,last_seen_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM pairing_codes WHERE claimed_device = ?)').bind(id,value.name.trim(),value.platform.trim(),tokenHash,now,now,id)
  ]);
  if(results[0].results.length)return respond({deviceId:id,token});
  if(isShort){
   const failures=await db.prepare('INSERT INTO pair_attempts (ip_hash,window_start,count) VALUES (?,?,1) ON CONFLICT(ip_hash,window_start) DO UPDATE SET count = count + 1 WHERE count < 100 RETURNING count').bind(globalKey,window).all();
   if(!failures.results.length)return limited();
   await db.prepare('UPDATE pairing_codes SET failed_attempts = failed_attempts + 1, used_at = CASE WHEN failed_attempts >= 4 THEN ? ELSE used_at END WHERE used_at IS NULL AND expires_at > ?').bind(now,now).run();
   return respond({error:'invalid'},400);
  }
  const existing=await db.prepare('SELECT id FROM pairing_codes WHERE code_hash = ?').bind(inputHash).first();
  return respond({error:existing?'expired_or_used':'invalid'},400);
 }
 if(route==='/api/pair/start'&&method==='POST'){
  if(!await limit(db,await hash(`start:${device.id}`),now,10))return limited();
  for(let attempt=0;attempt<10;attempt++){
   const code=random(16),short=shortCode(),id=crypto.randomUUID();
   try {
    const started=await db.batch([
     db.prepare('UPDATE pairing_codes SET used_at = ? WHERE used_at IS NULL AND (created_by_device = ? OR expires_at <= ?)').bind(now,device.id,now),
     db.prepare('INSERT INTO pairing_codes (id,code_hash,short_hash,expires_at,created_by_device) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM devices WHERE id = ? AND revoked_at IS NULL)').bind(id,await hash(code),await hash(short),now+300,device.id,device.id)
    ]);
    if(started[1].meta.changes===0)return respond({error:'Unauthorized'},401);
    return respond({id,code,short,expiresAt:(now+300)*1000});
   }catch(error){if(!String(error.message).includes('UNIQUE'))throw error;}
  }
  return respond({error:'Pairing unavailable'},503);
 }
 if(route==='/api/pair/start'&&method==='DELETE'){
  const value=await readBody(request);
  if(typeof value.id!=='string'||Object.keys(value).length!==1)throw Error('Invalid pairing input');
  await db.prepare('UPDATE pairing_codes SET used_at = COALESCE(used_at, ?) WHERE id = ? AND created_by_device = ?').bind(now,value.id,device.id).run();
  return respond({ok:true});
 }
 if(route==='/api/pair/status'&&method==='GET'){
  const result=await db.prepare('SELECT p.claimed_device, d.name FROM pairing_codes p LEFT JOIN devices d ON d.id = p.claimed_device WHERE p.id = ? AND p.created_by_device = ?').bind(url.searchParams.get('id'),device.id).first();
  return result?respond({claimed:!!result.claimed_device,name:result.name||null}):respond({error:'Not found'},404);
 }
 if(route==='/api/devices'&&method==='GET'){
  const rows=await db.prepare('SELECT id,name,platform,created_at,last_seen_at,revoked_at,is_legacy FROM devices ORDER BY created_at DESC,id DESC').all();
  return respond({devices:rows.results,deviceId:device.id,suggestRevokeLegacy:rows.results.some(row=>!row.is_legacy&&!row.revoked_at)&&rows.results.some(row=>row.is_legacy&&!row.revoked_at)});
 }
 if(route==='/api/devices/revoke-others'&&method==='POST'){
  await db.prepare('UPDATE devices SET revoked_at = ? WHERE id != ? AND revoked_at IS NULL').bind(now,device.id).run();
  return respond({ok:true});
 }
 const match=route.match(/^\/api\/devices\/([^/]+)$/);
 if(match&&['PATCH','DELETE'].includes(method)){
  const id=decodeURIComponent(match[1]);
  let result;
  if(method==='PATCH'){
   const value=await readBody(request);
   if(Object.keys(value).length!==1||!label(value.name))throw Error('Invalid device name');
   result=await db.prepare('UPDATE devices SET name = ? WHERE id = ? RETURNING id').bind(value.name.trim(),id).first();
  }else result=await db.prepare('UPDATE devices SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? RETURNING id').bind(now,id).first();
  return result?respond({ok:true}):respond({error:'Not found'},404);
 }
 return null;
}
