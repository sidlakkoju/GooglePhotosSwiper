import {authenticate,hash} from './pairing.mjs';
export const googleClientId='717807985103-6dfnvq5vpf0qa1ntjsgjcpr3oo30inc8.apps.googleusercontent.com';
export const syncOrigin='https://photoswiper-sync.sidlakkoju.workers.dev';
const random=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const inlineJSON=value=>JSON.stringify(value).replaceAll('<','\\u003c');
const decode=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const jwksCache=new WeakMap();
export async function verifyGoogleToken(token,nonce,fetchKeys=fetch){
 if(typeof token!=='string'||token.length>16384)throw Error('Invalid token');
 const parts=token.split('.');if(parts.length!==3)throw Error('Invalid token');
 const header=JSON.parse(new TextDecoder().decode(decode(parts[0]))),claims=JSON.parse(new TextDecoder().decode(decode(parts[1])));
 if(header.alg!=='RS256'||typeof header.kid!=='string'||claims.aud!==googleClientId||!['accounts.google.com','https://accounts.google.com'].includes(claims.iss)||!Number.isFinite(claims.exp)||claims.exp<=Date.now()/1000||claims.nonce!==nonce||typeof claims.sub!=='string'||!claims.sub||claims.sub.length>256)throw Error('Invalid token');
 let cached=jwksCache.get(fetchKeys);
 if(!cached||cached.expires<Date.now()){
  const response=await fetchKeys('https://www.googleapis.com/oauth2/v3/certs');if(!response.ok)throw Error('Invalid keys');
  cached={keys:(await response.json()).keys,expires:Date.now()+Math.min(3600,Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1]||300))*1000};jwksCache.set(fetchKeys,cached);
 }
 const jwk=cached.keys.find(key=>key.kid===header.kid&&key.kty==='RSA');if(!jwk)throw Error('Invalid token');
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(parts.slice(0,2).join('.'))))throw Error('Invalid token');
 if(claims.exp<=Date.now()/1000)throw Error('Invalid token');
 return claims;
}
export async function googleAuthRequest(request,env){
 const url=new URL(request.url),db=env.DB,now=Math.floor(Date.now()/1000);
 const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
 try{
 if(!db)return json({error:'Database unavailable'},500);
 if(url.pathname==='/auth/session'&&request.method==='POST'){
  const value=await request.json();if(!/^[A-Za-z0-9_-]{43}$/.test(value.state)||typeof value.name!=='string'||value.name.length>40||typeof value.platform!=='string'||value.platform.length>40)return json({error:'Invalid session'},400);
  const device=await authenticate(request,env);if(request.headers.has('Authorization')&&!device)return json({error:'Unauthorized'},401);
  const mapping=device?await db.prepare('SELECT space FROM device_spaces WHERE device_id = ?').bind(device.id).first():null;
  await db.prepare('DELETE FROM google_pending WHERE expires_at <= ?').bind(now).run();
  const nonce=random();await db.prepare('INSERT INTO google_pending (state_hash,nonce,expires_at,space,name,platform,login_hint,source_scope,source_device) VALUES (?,?,?,?,?,?,?,?,?)').bind(await hash(value.state),nonce,now+300,device?(mapping?.space||'legacy'):null,value.name,value.platform,typeof value.loginHint==='string'&&value.loginHint.length<=254?value.loginHint:null,typeof value.sourceScope==='string'&&/^[A-Za-z0-9_-]{1,256}$/.test(value.sourceScope)?value.sourceScope:'default',device?.id||null).run();
  return json({url:syncOrigin+'/auth/start?state='+value.state});
 }
 const state=url.searchParams.get('state');
 if(url.pathname==='/auth/start'&&request.method==='GET'){
  const pending=await db.prepare('SELECT * FROM google_pending WHERE state_hash = ? AND expires_at > ? AND completed_at IS NULL').bind(await hash(state||''),now).first();if(!pending)return json({error:'Invalid state'},400);
  const script=`google.accounts.id.initialize({client_id:${inlineJSON(googleClientId)},nonce:${inlineJSON(pending.nonce)},login_hint:${inlineJSON(pending.login_hint)},auto_select:false,callback:async result=>{const response=await fetch('/auth/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:${inlineJSON(state)},credential:result.credential})});const value=await response.json();document.getElementById('status').textContent=response.ok?'Copy this sign-in code into Photos Swipe: '+value.code:'Sign-in failed. Please try again.';}});google.accounts.id.renderButton(document.getElementById('button'),{theme:'outline',size:'large'});`;
  return new Response(`<html><head><meta name="referrer" content="no-referrer"><title>Photos Swipe sign-in</title></head><body><h1>Sign in with Google</h1><div id="button"></div><p id="status"></p><script src="https://accounts.google.com/gsi/client"></script><script>${script}</script></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src https://accounts.google.com 'sha256-"+btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(script)))))+"'; frame-src https://accounts.google.com; connect-src 'self' https://accounts.google.com; style-src https://accounts.google.com; base-uri 'none'; frame-ancestors 'none'"}});
 }
 if(url.pathname==='/auth/complete'&&request.method==='POST'){
  if(request.headers.get('Origin')!==syncOrigin)return json({error:'Forbidden'},403);
  const value=await request.json(),digest=await hash(value.state||'');
  const pending=await db.prepare('SELECT * FROM google_pending WHERE state_hash = ? AND expires_at > ? AND completed_at IS NULL').bind(digest,now).first();if(!pending)return json({error:'Invalid state'},400);
  const claims=await verifyGoogleToken(value.credential,pending.nonce,env.GOOGLE_FETCH||fetch);
  const code=random();
  const accountSpace=crypto.randomUUID();
  const results=await db.batch([
   db.prepare('UPDATE google_pending SET completed_at = ?, sub = ?, email = ?, claim_hash = ? WHERE state_hash = ? AND completed_at IS NULL AND expires_at > ? RETURNING state_hash').bind(-1,claims.sub,claims.email||null,await hash(code),digest,now),
   db.prepare('INSERT OR IGNORE INTO google_accounts (sub,space,email) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM google_pending WHERE state_hash = ? AND sub = ?)').bind(claims.sub,accountSpace,claims.email||null,digest,claims.sub)
  ]);
  if(!results[0].results.length)return json({error:'State used'},400);
  await db.prepare('UPDATE google_pending SET completed_at = ? WHERE state_hash = ? AND completed_at = -1').bind(now,digest).run();
  return json({code});
 }
 if(url.pathname==='/auth/claim'&&request.method==='POST'){
  const value=await request.json(),digest=await hash(value.state||'');
  if(typeof value.code!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value.code))throw Error('Invalid code');
  const pending=await db.prepare('SELECT * FROM google_pending WHERE state_hash = ? AND claim_hash = ? AND expires_at > ? AND claimed_at IS NULL AND completed_at >= 0').bind(digest,await hash(value.code),now).first();
  if(!pending)throw Error('Invalid state');
  const sourceDevice=pending.source_device?await authenticate(request,env):null;
  if(pending.source_device&&sourceDevice?.id!==pending.source_device)return json({error:'Unauthorized'},401);
  const linked=pending.space?await db.prepare('SELECT sub FROM google_accounts WHERE space = ?').bind(pending.space).first():null;
  const account=await db.prepare('SELECT space FROM google_accounts WHERE sub = ?').bind(pending.sub).first();
  const claimed=await db.prepare('UPDATE google_pending SET claimed_at = ? WHERE state_hash = ? AND expires_at > ? AND claimed_at IS NULL AND completed_at >= 0 RETURNING email').bind(now,digest,now).first();
  if(!claimed)throw Error('Invalid state');
  if(pending.space&&!linked&&account.space!==pending.space){
   const source=pending.space==='legacy'?pending.source_scope:pending.space+':shared',target=account.space+':shared';
   const guardedSource="(SELECT ? WHERE EXISTS (SELECT 1 FROM google_space_links WHERE source = ? AND space = ?))";
   await db.batch([
    db.prepare('INSERT OR IGNORE INTO google_space_links (source,space) VALUES (?,?)').bind(pending.space,account.space),
    db.prepare(`INSERT INTO decision_versions (scope,id,device_id,updated_at) SELECT ?,v.id,v.device_id,v.updated_at FROM decision_versions v JOIN decisions d ON d.scope = v.scope AND d.id = v.id WHERE v.scope = ${guardedSource} AND NOT EXISTS (SELECT 1 FROM decisions t WHERE t.scope = ? AND t.id = v.id AND t.decision = 'remove' AND d.decision = 'keep') ON CONFLICT(scope,id) DO UPDATE SET device_id = excluded.device_id, updated_at = excluded.updated_at WHERE excluded.updated_at >= decision_versions.updated_at OR EXISTS (SELECT 1 FROM decisions s JOIN decisions t ON t.id = s.id WHERE s.scope = ${guardedSource} AND t.scope = ? AND s.id = excluded.id AND s.decision = 'remove' AND t.decision = 'keep')`).bind(target,source,pending.space,account.space,target,source,pending.space,account.space,target),
    db.prepare(`INSERT INTO decisions (scope,id,decision) SELECT ?,id,decision FROM decisions WHERE scope = ${guardedSource} ON CONFLICT(scope,id) DO UPDATE SET decision = excluded.decision WHERE decisions.decision != 'remove'`).bind(target,source,pending.space,account.space),
    db.prepare(`INSERT INTO review_items (scope,id,data) SELECT ?,id,data FROM review_items WHERE scope = ${guardedSource} ON CONFLICT(scope,id) DO UPDATE SET data = excluded.data WHERE COALESCE(json_extract(excluded.data, '$.revision'),0) > COALESCE(json_extract(review_items.data, '$.revision'),0)`).bind(target,source,pending.space,account.space),
    db.prepare(`INSERT INTO review_state (scope,progress,history) SELECT ?,progress,history FROM review_state WHERE scope = ${guardedSource} ON CONFLICT(scope) DO UPDATE SET history = excluded.history WHERE review_state.history = '[]'`).bind(target,source,pending.space,account.space),
    db.prepare(`INSERT OR IGNORE INTO review_state (scope,progress,history) SELECT ? || substr(scope, ?),progress,history FROM review_state WHERE substr(scope,1,?) = ${guardedSource}`).bind(target,source.length+1,source.length+8,source+':device:',pending.space,account.space),
    db.prepare(`INSERT INTO device_spaces (device_id,space) SELECT d.id,? FROM devices d LEFT JOIN device_spaces s ON s.device_id = d.id WHERE COALESCE(s.space,'legacy') = ${guardedSource} ON CONFLICT(device_id) DO UPDATE SET space = excluded.space`).bind(account.space,pending.space,pending.space,account.space)
   ]);
  }
  const mapping=sourceDevice?await db.prepare('SELECT space FROM device_spaces WHERE device_id = ?').bind(sourceDevice.id).first():null;
  const token=random(),id=sourceDevice&&mapping?.space===account.space?sourceDevice.id:crypto.randomUUID();
  await db.batch([
   db.prepare('UPDATE google_pending SET claim_device = ? WHERE state_hash = ?').bind(id,digest),
   db.prepare('INSERT INTO devices (id,name,platform,token_hash,created_at,last_seen_at) SELECT ?,name,platform,?,?,? FROM google_pending WHERE state_hash = ? AND claim_device = ? ON CONFLICT(id) DO UPDATE SET token_hash = excluded.token_hash, last_seen_at = excluded.last_seen_at').bind(id,await hash(token),now,now,digest,id),
   db.prepare('INSERT INTO device_spaces (device_id,space) SELECT ?,a.space FROM google_accounts a JOIN google_pending p ON p.sub = a.sub WHERE p.state_hash = ? AND p.claim_device = ? ON CONFLICT(device_id) DO UPDATE SET space = excluded.space').bind(id,digest,id)
  ]);
  return json({token,deviceId:id,email:claimed.email});
 }
 return json({error:'Not found'},404);
 }catch{return json({error:'Invalid or used sign-in state'},400);}
}
