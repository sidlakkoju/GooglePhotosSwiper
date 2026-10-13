import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {googleAuthRequest as handleGoogleAuthRequest,verifyGoogleToken,googleClientId,syncOrigin} from '../worker/src/google-auth.mjs';
import {syncRequest} from '../worker/src/sync.mjs';
import {hash} from '../worker/src/pairing.mjs';
import {runInNewContext} from 'node:vm';
class D1 {
 constructor(){this.sqlite=new DatabaseSync(':memory:');for(const file of readdirSync(new URL('../worker/migrations/',import.meta.url)).sort())this.sqlite.exec(readFileSync(new URL('../worker/migrations/'+file,import.meta.url),'utf8'));}
 prepare(sql){const statement=this.sqlite.prepare(sql);const bound=args=>({first:async()=>statement.get(...args)||null,all:async()=>({results:statement.all(...args)}),run:async()=>statement.run(...args),execute:()=>({results:statement.all(...args),meta:{changes:this.sqlite.prepare('SELECT changes() AS n').get().n}})});return {...bound([]),bind:(...args)=>{if(/\bLIKE\s+\?/i.test(sql)&&args.some(arg=>typeof arg==='string'&&arg.endsWith('%')&&arg.length>50))throw Error('LIKE pattern too long');return bound(args);}};}
 async batch(statements){this.sqlite.exec('BEGIN');try{const results=statements.map(s=>s.execute());this.sqlite.exec('COMMIT');return results;}catch(error){this.sqlite.exec('ROLLBACK');throw error;}}
}
const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk={...await crypto.subtle.exportKey('jwk',keys.publicKey),kid:'test'};
const fetchKeys=async url=>{assert.equal(url,'https://www.googleapis.com/oauth2/v3/certs');return Response.json({keys:[jwk]});};
const encode=value=>Buffer.from(typeof value==='string'?value:JSON.stringify(value)).toString('base64url');
async function token(nonce,overrides={},key=keys.privateKey,kid='test'){const message=encode({alg:'RS256',kid})+'.'+encode({sub:'account-one',aud:googleClientId,iss:'https://accounts.google.com',exp:Math.floor(Date.now()/1000)+300,nonce,email:'one@example.test',...overrides});return message+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(message))).toString('base64url');}
async function googleAuthRequest(request,env){
 if(env.browserCookie&&!request.headers.has('Cookie'))request.headers.set('Cookie',env.browserCookie);
 const response=await handleGoogleAuthRequest(request,env);
 const cookie=response.headers.get('Set-Cookie');if(cookie)env.browserCookie=cookie.split(';')[0];
 return response;
}
const request=(env,path,value,bearer)=>googleAuthRequest(new Request(syncOrigin+path,{method:'POST',headers:{Origin:syncOrigin,...(bearer?{Authorization:'Bearer '+bearer}:{})},body:JSON.stringify(value)}),env);
async function signIn(env,state,bearer,sub='account-one'){
 assert.equal((await request(env,'/auth/session',{state,name:'Test device',platform:'test'},bearer)).status,200);
 const pending=await env.DB.prepare('SELECT nonce FROM google_pending WHERE state_hash = ?').bind(await hash(state)).first();
 const complete=await request(env,'/auth/complete',{state,credential:await token(pending.nonce,{sub})});assert.equal(complete.status,200);const {code}=await complete.json();
 const claim=await request(env,'/auth/claim',{state,code},bearer);assert.equal(claim.status,200);return claim.json();
}
test('Google verification accepts only signed RS256 tokens with correct audience, issuer, expiry and nonce',async()=>{
 for(const iss of ['accounts.google.com','https://accounts.google.com'])assert.equal((await verifyGoogleToken(await token('nonce',{iss}),'nonce',fetchKeys)).sub,'account-one');
 for(const overrides of [{aud:'wrong'},{iss:'wrong'},{exp:1},{nonce:'wrong'}])await assert.rejects(verifyGoogleToken(await token('nonce',overrides),'nonce',fetchKeys));
 const other=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 await assert.rejects(verifyGoogleToken(await token('nonce',{},other.privateKey),'nonce',fetchKeys));
});
test('one-time Google claims share a sub space, isolate other accounts and preserve pairing fallback',async()=>{
 const env={DB:new D1(),GOOGLE_FETCH:fetchKeys,SYNC_TOKEN:'legacy-test',PAIRING_IP_KEY:'test-ip-key'};
 const a=await signIn(env,'a'.repeat(43),'legacy-test'),b=await signIn(env,'b'.repeat(43)),c=await signIn(env,'c'.repeat(43),undefined,'account-two');
 assert.equal((await request(env,'/auth/claim',{state:'a'.repeat(43)})).status,400);
 assert.equal((await request(env,'/auth/complete',{state:'a'.repeat(43),credential:await token('unused')})).status,400);
 assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM devices').get().n,3);
 const api=(device,path,method='GET',value)=>syncRequest(new Request(syncOrigin+'/api/'+path,{method,headers:{Authorization:'Bearer '+device.token},...(value?{body:JSON.stringify(value)}:{})}),env);
 await api(a,'decisions/photo?scope=first','PUT',{decision:'remove'});
 await api(b,'decisions/photo?scope=second','PUT',{decision:'keep'});
 assert.equal((await (await api(b,'state?scope=first')).json()).decisions[0].decision,'remove');
 assert.equal((await (await api(c,'state?scope=first')).json()).decisions.length,0);
 assert.equal((await (await api(c,'devices')).json()).devices.length,1);
 const pair=await (await api(a,'pair/start','POST')).json();
 const response=await syncRequest(new Request(syncOrigin+'/api/pair/claim',{method:'POST',body:JSON.stringify({short:pair.short,name:'Backup',platform:'test'})}),env);
 assert.equal(response.status,200);const backup=await response.json();
 assert.equal((await (await api(backup,'state?scope=first')).json()).decisions[0].decision,'remove');
 assert.equal((await api(b,'decisions/photo?scope=first','DELETE')).status,200);
 assert.equal((await (await api(a,'state?scope=first')).json()).decisions[0].decision,'remove');
 assert.equal((await (await api(a,'trash-check?scope=first','POST',{ids:['photo']})).json()).safe,false);
 assert.equal((await (await api(c,'trash-check','POST',{ids:['photo']})).json()).safe,false);
});
test('all migrations preserve existing data and tracked migrations are safe to rerun',()=>{
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec('CREATE TABLE d1_migrations (name TEXT PRIMARY KEY)');
 const files=readdirSync(new URL('../worker/migrations/',import.meta.url)).sort();
 const migrate=()=>{for(const file of files){
  const sql=readFileSync(new URL('../worker/migrations/'+file,import.meta.url),'utf8');
  assert.doesNotMatch(sql,/\b(DROP|DELETE)\b/i);
  if(sql.includes('ALTER TABLE'))assert.match(sql,/ALTER TABLE \w+ ADD COLUMN /);
  if(sqlite.prepare('SELECT name FROM d1_migrations WHERE name = ?').get(file))continue;
  sqlite.exec('BEGIN');
  try{sqlite.exec(sql);sqlite.prepare('INSERT INTO d1_migrations VALUES (?)').run(file);sqlite.exec('COMMIT');}catch(error){sqlite.exec('ROLLBACK');throw error;}
 }};
 migrate();sqlite.exec("INSERT INTO decisions VALUES ('default','old','keep'); INSERT INTO google_pending (state_hash,nonce,expires_at,name,platform,claim_hash,source_device) VALUES (X'01','fixture',1,'Fixture','test',X'02','fixture-device')");
 migrate();migrate();
 assert.equal(sqlite.prepare('SELECT decision FROM decisions WHERE id = ?').get('old').decision,'keep');
 assert.equal(sqlite.prepare('SELECT source_device FROM google_pending').get().source_device,'fixture-device');
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM d1_migrations').get().n,files.length);
});
test('two clients poll accepted per-photo decisions and retain only their own undo history',async()=>{
 const {createSyncClient}=await import('../lib/userscript-sync.mjs');
 const {reviewDeck}=await import('../lib/userscript-core.mjs');
 const env={DB:new D1(),GOOGLE_FETCH:fetchKeys};
 const a=await signIn(env,'d'.repeat(43)),b=await signIn(env,'e'.repeat(43));
 const client=device=>{const result=createSyncClient({fetch:(url,options)=>syncRequest(new Request(url,options),env)});result.configure({url:syncOrigin,token:device.token});return result;};
 const first=client(a),second=client(b),save=async state=>state;
 const initial=()=>({started:true,history:[],items:[{mediaKey:'photo',decision:null,state:'active',revision:0}],syncDecisions:{},syncPending:{}});
 let one={...initial(),history:[{key:'photo',previous:null,decision:'remove',revision:1}],items:[{mediaKey:'photo',decision:'remove',state:'active',revision:1}],syncPending:{photo:'remove'},syncDirty:true};
 one=await first.sync('photos-one',one,save);
 let two=await second.sync('photos-two',initial(),save);
 assert.equal(two.items[0].decision,'remove');assert.equal(reviewDeck(two).length,0);assert.equal(two.history.length,0);assert.equal(one.history.length,1);
 two=await second.sync('photos-two',{...two,items:[{...two.items[0],decision:'keep'}],syncPending:{photo:'keep'}},save);
 assert.equal(two.items[0].decision,'remove');
 const version=env.DB.sqlite.prepare('SELECT device_id,updated_at FROM decision_versions').get();assert.equal(version.device_id,a.deviceId);assert.ok(version.updated_at>0);
 const scope=env.DB.sqlite.prepare('SELECT scope FROM decisions').get().scope;
 assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM decisions WHERE scope = ?').get(scope).n,1);
});
test('expired and unknown states cannot complete or claim sign-in',async()=>{
 const env={DB:new D1(),GOOGLE_FETCH:fetchKeys},state='f'.repeat(43);
 await request(env,'/auth/session',{state,name:'Test',platform:'test'});
 env.DB.sqlite.exec('UPDATE google_pending SET expires_at = 1');
 assert.equal((await request(env,'/auth/claim',{state})).status,400);
 assert.equal((await request(env,'/auth/complete',{state,credential:await token('unknown')})).status,400);
 assert.equal((await request(env,'/auth/claim',{state:'unknown'})).status,400);
 assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM devices').get().n,0);
});
test('a paired space joins an account that already signed in on another device',async()=>{
 const env={DB:new D1(),GOOGLE_FETCH:fetchKeys,SYNC_TOKEN:'legacy-test',PAIRING_IP_KEY:'test-key'};
 const existing=await signIn(env,'g'.repeat(43));
 await syncRequest(new Request(syncOrigin+'/api/decisions/legacy-photo',{method:'PUT',headers:{Authorization:'Bearer legacy-test'},body:JSON.stringify({decision:'remove'})}),env);
 await signIn(env,'h'.repeat(43),'legacy-test');
 for(const token of [existing.token,'legacy-test']){
  const response=await syncRequest(new Request(syncOrigin+'/api/state',{headers:{Authorization:'Bearer '+token}}),env);
  assert.equal((await response.json()).decisions[0].id,'legacy-photo');
 }
});

test('linking a hashed Photos scope preserves shared and per-device undo and permits clearing old decisions',async()=>{
 const env={DB:new D1(),GOOGLE_FETCH:fetchKeys,SYNC_TOKEN:'legacy-test'},scope='a'.repeat(64),state='i'.repeat(43);
 const api=(bearer,path,method='GET',value)=>syncRequest(new Request(syncOrigin+'/api/'+path+'?scope='+scope,{method,headers:{Authorization:'Bearer '+bearer},...(value?{body:JSON.stringify(value)}:{})}),env);
 await api('legacy-test','state');
 const device=env.DB.sqlite.prepare('SELECT id FROM devices').get();
 const entry={key:'old',previous:null,decision:'remove',revision:1};
 env.DB.sqlite.prepare('INSERT INTO decisions VALUES (?,?,?)').run(scope,'old','remove');
 env.DB.sqlite.prepare('INSERT INTO decisions VALUES (?,?,?)').run(scope,'clear-before-link','remove');
 assert.equal((await api('legacy-test','decisions/clear-before-link','DELETE')).status,200);
 assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM decisions WHERE id = ?').get('clear-before-link').n,1);
 env.DB.sqlite.prepare('DELETE FROM decisions WHERE scope = ? AND id = ?').run(scope,'clear-before-link');
 env.DB.sqlite.prepare('INSERT INTO review_state VALUES (?,?,?)').run(scope,JSON.stringify({started:true,reviewed:1}),JSON.stringify([entry]));
 await api('legacy-test','undo','PUT',{history:[entry]});
 assert.deepEqual((await (await api('legacy-test','state')).json()).history,[entry]);
 const {createSyncClient}=await import('../lib/userscript-sync.mjs');
 const client=createSyncClient({fetch:(url,options)=>syncRequest(new Request(url,options),env)});
 client.configure({url:syncOrigin,token:'legacy-test'});
 const pulled=await client.sync(scope,{started:true,history:[entry],items:[{mediaKey:'old',decision:'remove',revision:1}],syncDirty:false,syncPending:{},syncDecisions:{old:'remove'}},async value=>value);
 assert.deepEqual(pulled.history,[entry]);
 const existing=await signIn(env,'l'.repeat(43));
 const existingSpace=env.DB.sqlite.prepare('SELECT space FROM device_spaces WHERE device_id = ?').get(existing.deviceId).space;
 env.DB.sqlite.prepare('INSERT INTO review_state VALUES (?,?,?)').run(existingSpace+':shared','{}','[]');
 const ownEntry={...entry,key:'own'};
 await api('legacy-test','undo','PUT',{history:[entry,ownEntry]});
 await request(env,'/auth/session',{state,name:'Linked',platform:'test',sourceScope:scope},'legacy-test');
 const pending=await env.DB.prepare('SELECT nonce FROM google_pending WHERE state_hash = ?').bind(await hash(state)).first();
 const complete=await request(env,'/auth/complete',{state,credential:await token(pending.nonce)});assert.equal(complete.status,200);const {code}=await complete.json();
 const claim=await request(env,'/auth/claim',{state,code},'legacy-test');assert.equal(claim.status,200);const linked=await claim.json();
 assert.deepEqual((await (await api('legacy-test','state')).json()).history,[entry,ownEntry]);
 assert.deepEqual((await (await api(linked.token,'state')).json()).history,[entry,ownEntry]);
 const mapping=env.DB.sqlite.prepare('SELECT space FROM device_spaces WHERE device_id = ?').get(device.id);
 assert.deepEqual(JSON.parse(env.DB.sqlite.prepare('SELECT history FROM review_state WHERE scope = ?').get(mapping.space+':shared:device:'+device.id).history),[entry,ownEntry]);
 await api(linked.token,'decisions','PUT',{decisions:[{id:'old',decision:null}]});
 assert.deepEqual((await (await api(linked.token,'state')).json()).decisions,[]);
 await api(linked.token,'decisions/old','PUT',{decision:'keep'});
 assert.deepEqual((await (await api(linked.token,'state')).json()).decisions,[{id:'old',decision:'keep'}]);
});

test('overlapping paired sign-ins cannot copy a legacy library to two Google accounts',async()=>{
 const env={DB:new D1(),GOOGLE_FETCH:fetchKeys,SYNC_TOKEN:'legacy-test'};
 await syncRequest(new Request(syncOrigin+'/api/state',{headers:{Authorization:'Bearer legacy-test'}}),env);
 env.DB.sqlite.exec("INSERT INTO decisions VALUES ('default','private-photo','remove')");
 const states=['j'.repeat(43),'k'.repeat(43)];
 for(const state of states)assert.equal((await request(env,'/auth/session',{state,name:'Paired',platform:'test'},'legacy-test')).status,200);
 const credentials=await Promise.all(states.map(async(state,index)=>{const pending=await env.DB.prepare('SELECT nonce FROM google_pending WHERE state_hash = ?').bind(await hash(state)).first();return token(pending.nonce,{sub:'overlap-'+index});}));
 const responses=await Promise.all(states.map((state,index)=>request(env,'/auth/complete',{state,credential:credentials[index]})));
 assert.deepEqual(responses.map(response=>response.status),[200,200]);
 const codes=await Promise.all(responses.map(response=>response.json()));
 const claims=await Promise.all(states.map(async(state,index)=>(await request(env,'/auth/claim',{state,code:codes[index].code},'legacy-test')).json()));
 const libraries=await Promise.all(claims.map(async device=>(await syncRequest(new Request(syncOrigin+'/api/state',{headers:{Authorization:'Bearer '+device.token}}),env)).json()));
 assert.deepEqual(libraries.map(library=>library.decisions.length).sort(),[0,1]);
 assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM google_space_links').get().n,1);
});

test('legacy claims require the code and original device token',async()=>{
 const env={DB:new D1(),GOOGLE_FETCH:fetchKeys,SYNC_TOKEN:'legacy-test'},state='m'.repeat(43);
 await syncRequest(new Request(syncOrigin+'/api/decisions/private',{method:'PUT',headers:{Authorization:'Bearer legacy-test'},body:JSON.stringify({decision:'remove'})}),env);
 await request(env,'/auth/session',{state,name:'Attacker',platform:'test'},'legacy-test');
 const pending=await env.DB.prepare('SELECT nonce FROM google_pending WHERE state_hash = ?').bind(await hash(state)).first();
 const completion=await request(env,'/auth/complete',{state,credential:await token(pending.nonce)});
 const {code}=await completion.json();
 for(const value of [{state},{state,code:'x'.repeat(43)}])assert.equal((await request(env,'/auth/claim',value,'legacy-test')).status,400);
 assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM google_space_links').get().n,0);
 assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM device_spaces').get().n,0);
 assert.equal((await request(env,'/auth/claim',{state,code})).status,401);
 assert.equal((await request(env,'/auth/poll',{state,code})).status,401);
 assert.deepEqual(await (await request(env,'/auth/poll',{state},'legacy-test')).json(),{status:'pending'});
 assert.equal((await request(env,'/auth/poll',{state,code:'x'.repeat(43)},'legacy-test')).status,400);
 const claims=await Promise.all([request(env,'/auth/claim',{state,code},'legacy-test'),request(env,'/auth/claim',{state,code},'legacy-test')]);
 assert.deepEqual(claims.map(response=>response.status).sort(),[200,400]);
 const device=await claims.find(response=>response.status===200).json();
 assert.equal((await syncRequest(new Request(syncOrigin+'/api/state',{headers:{Authorization:'Bearer '+device.token}}),env)).status,200);
});

test('linking and repeated Google sign-in preserve ownership and undo-to-undecided',async()=>{
 const env={DB:new D1(),GOOGLE_FETCH:fetchKeys,SYNC_TOKEN:'legacy-test'};
 const api=(bearer,path,method='GET',value)=>syncRequest(new Request(syncOrigin+'/api/'+path,{method,headers:{Authorization:'Bearer '+bearer},...(value?{body:JSON.stringify(value)}:{})}),env);
 await api('legacy-test','decisions/old','PUT',{decision:'remove'});
 const linked=await signIn(env,'n'.repeat(43),'legacy-test');
 assert.equal(linked.deviceId,'legacy');
 assert.equal(env.DB.sqlite.prepare('SELECT device_id FROM decision_versions WHERE scope LIKE ?').get('%:shared').device_id,linked.deviceId);
 await api(linked.token,'decisions/old','DELETE');
 assert.deepEqual((await (await api(linked.token,'state')).json()).decisions,[]);
 await api(linked.token,'decisions/new','PUT',{decision:'remove'});
 const again=await signIn(env,'o'.repeat(43),linked.token);
 assert.equal(again.deviceId,linked.deviceId);
 await api(again.token,'decisions','PUT',{decisions:[{id:'new',decision:null}]});
 assert.deepEqual((await (await api(again.token,'state')).json()).decisions,[]);
 assert.equal((await (await api(again.token,'trash-check','POST',{ids:['new']})).json()).safe,false);
});

test('explicit own-device undo-to-keep replaces synced removes through both write endpoints',async()=>{
 const env={DB:new D1(),GOOGLE_FETCH:fetchKeys},device=await signIn(env,'p'.repeat(43));
 const api=(path,method,value)=>syncRequest(new Request(syncOrigin+'/api/'+path,{method,headers:{Authorization:'Bearer '+device.token},body:JSON.stringify(value)}),env);
 for(const batch of [false,true]){
  await api('decisions/photo','PUT',{decision:'remove'});
  const response=await api(batch?'decisions':'decisions/photo','PUT',batch?{decisions:[{id:'photo',decision:'keep',undo:true}]}:{decision:'keep',undo:true});
  assert.equal(response.status,200);
  assert.equal((await (await api('trash-check','POST',{ids:['photo']})).json()).safe,false);
  assert.equal(env.DB.sqlite.prepare('SELECT decision FROM decisions').get().decision,'keep');
 }
});

test('sign-in HTML allows origin referrers while JSON auth responses suppress referrers',async()=>{
 const env={DB:new D1()},state='s'.repeat(43);
 const session=await request(env,'/auth/session',{state,name:'Test',platform:'test'});
 assert.equal(session.status,200);
 assert.equal(session.headers.get('Referrer-Policy'),'no-referrer');
 const response=await googleAuthRequest(new Request(syncOrigin+'/auth/start?state='+state),env);
 assert.equal(response.status,200);
 assert.equal(response.headers.get('Referrer-Policy'),'strict-origin-when-cross-origin');
 assert.match(await response.text(),/<meta name="referrer" content="strict-origin-when-cross-origin">/);
});

test('sign-in page permits GIS styles while restricting scripts and framing',async()=>{
 const env={DB:new D1()},state='q'.repeat(43);
 await request(env,'/auth/session',{state,name:'Test',platform:'test'});
 const response=await googleAuthRequest(new Request(syncOrigin+'/auth/start?state='+state),env);
 assert.equal(response.status,200);
 const html=await response.text(),csp=Object.fromEntries(response.headers.get('Content-Security-Policy').split(';').map(part=>part.trim().split(/\s+/)).map(([name,...sources])=>[name,sources]));
 const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 const sourceHash=async value=>"'sha256-"+Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('base64')+"'";
 assert.deepEqual(csp['style-src'],['https://accounts.google.com/gsi/style',"'unsafe-inline'"]);
 assert.deepEqual(csp['style-src-attr'],["'unsafe-inline'"]);
 assert.deepEqual(csp['style-src-elem'],['https://accounts.google.com/gsi/style',"'unsafe-inline'"]);
 assert.deepEqual(csp['script-src'],['https://accounts.google.com',await sourceHash(script)]);
 assert.deepEqual(csp['default-src'],["'none'"]);
 assert.deepEqual(csp['frame-src'],['https://accounts.google.com']);
 assert.deepEqual(csp['connect-src'],["'self'",'https://accounts.google.com']);
 assert.deepEqual(csp['frame-ancestors'],["'none'"]);
 assert.deepEqual(csp['base-uri'],["'none'"]);
 assert.doesNotMatch(html,/\sstyle\s*=/i);
 assert.match(html,/name="viewport"/);
 const elements={status:{},button:{}};
 let callback;
 runInNewContext(script,{google:{accounts:{id:{initialize:options=>callback=options.callback,renderButton:element=>assert.equal(element,elements.button)}}},document:{getElementById:id=>elements[id]},fetch:async()=>Response.json({code:'r'.repeat(43)})});
 await callback({credential:'test'});
 assert.equal(elements.status.textContent,"You're signed in. Return to Google Photos.");
 assert.doesNotMatch(html,/<input|Copy this code/);
 assert.match(script,/window.close/);
 assert.match(script,/BroadcastChannel/);
 assert.match(script,/postMessage/);
});

test('state-only polling cannot redeem a completed session; code redemption is single-use and expires',async()=>{
 const env={DB:new D1(),GOOGLE_FETCH:fetchKeys},state='p'.repeat(43);
 await request(env,'/auth/session',{state,name:'Test',platform:'test'});
 assert.deepEqual(await (await request(env,'/auth/poll',{state})).json(),{status:'pending'});
 const pending=await env.DB.prepare('SELECT nonce FROM google_pending WHERE state_hash = ?').bind(await hash(state)).first();
 const {code}=await (await request(env,'/auth/complete',{state,credential:await token(pending.nonce)})).json();
 for(const value of [{state},{state,code:'x'.repeat(43)}]){
  const response=await request(env,'/auth/poll',value);assert.equal(response.status,value.code?400:200);if(!value.code)assert.deepEqual(await response.json(),{status:'pending'});
 }
 assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM devices').get().n,0);
 assert.equal(env.DB.sqlite.prepare('SELECT claimed_at FROM google_pending').get().claimed_at,null);
 const results=await Promise.all([request(env,'/auth/poll',{state,code}),request(env,'/auth/poll',{state,code})]);
 const values=await Promise.all(results.map(response=>response.json()));assert.equal(values.filter(value=>value.status==='done').length,1);assert.ok(values.find(value=>value.status==='done').token);
 assert.equal((await request(env,'/auth/claim',{state,code})).status,400);
 assert.equal((await (await request(env,'/auth/poll',{state})).json()).status,'expired');
 const expired='q'.repeat(43);await request(env,'/auth/session',{state:expired,name:'Test',platform:'test'});
 await env.DB.prepare('UPDATE google_pending SET expires_at = ? WHERE state_hash = ?').bind(Math.floor(Date.now()/1000),await hash(expired)).run();
 assert.equal((await (await request(env,'/auth/poll',{state:expired})).json()).status,'expired');
});
test('failed verification is reported by polling and paired polling requires the original token',async()=>{
 const env={DB:new D1(),GOOGLE_FETCH:fetchKeys,SYNC_TOKEN:'legacy-test'},state='r'.repeat(43);
 await request(env,'/auth/session',{state,name:'Test',platform:'test'},'legacy-test');
 assert.equal((await request(env,'/auth/poll',{state})).status,401);
 await request(env,'/auth/complete',{state,credential:'invalid'});
 assert.equal((await (await request(env,'/auth/poll',{state},'legacy-test')).json()).status,'failed');
});

test('sign-in page closes and signals success, and shows errors without a code box',async()=>{
 const env={DB:new D1()},state='s'.repeat(43);await request(env,'/auth/session',{state,name:'Test',platform:'test'});
 const html=await (await googleAuthRequest(new Request(syncOrigin+'/auth/start?state='+state),env)).text(),script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 for(const outcome of ['done','failed','network']){
  let callback,closed=0,posted=0,broadcast=0;const status={};
  runInNewContext(script,{google:{accounts:{id:{initialize:options=>{callback=options.callback;},renderButton(){}}}},document:{getElementById:()=>status},window:{close(){closed++;},opener:{postMessage(message,origin){assert.equal(origin,'https://photos.google.com');assert.equal(message.state,state);assert.equal(message.code,'r'.repeat(43));posted++;}}},BroadcastChannel:class{postMessage(message){assert.deepEqual(Object.keys(message),['type']);broadcast++;}close(){}},fetch:async()=>{if(outcome==='network')throw Error('Network unavailable');return Response.json({code:'r'.repeat(43)}, {status:outcome==='done'?200:400});}});
  await callback({credential:'synthetic'});assert.equal(closed,outcome==='done'?1:0);assert.equal(posted,closed);assert.equal(broadcast,closed);assert.match(status.textContent,outcome==='done'?/You're signed in/:outcome==='failed'?/Sign-in failed/:/Network unavailable/);
 }
 assert.doesNotMatch(html,/<input|Copy this code/);
});
test('completed poll expires at five minutes and legacy claims consume the polling session',async()=>{
 const env={DB:new D1(),GOOGLE_FETCH:fetchKeys},state='t'.repeat(43);
 await signIn(env,state);assert.equal((await (await request(env,'/auth/poll',{state})).json()).status,'expired');
 const next='u'.repeat(43);await request(env,'/auth/session',{state:next,name:'Test',platform:'test'});
 const pending=await env.DB.prepare('SELECT * FROM google_pending WHERE state_hash = ?').bind(await hash(next)).first();assert.equal(pending.expires_at-Math.floor(Date.now()/1000),300);
 await request(env,'/auth/complete',{state:next,credential:await token(pending.nonce)});
 await env.DB.prepare('UPDATE google_pending SET expires_at = ? WHERE state_hash = ?').bind(Math.floor(Date.now()/1000),await hash(next)).run();
 assert.equal((await (await request(env,'/auth/poll',{state:next})).json()).status,'expired');assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM devices').get().n,1);
});

for(const failure of ['network','http','json','keys','import'])test(`Google key service ${failure} failure leaves the session available for retry`,async()=>{
 let unavailable=true;
 const retryFetch=async()=>{
  if(!unavailable)return fetchKeys('https://www.googleapis.com/oauth2/v3/certs');
  if(failure==='network')throw Error('Network unavailable');
  if(failure==='http')return new Response('',{status:503});
  if(failure==='json')return new Response('invalid');
  if(failure==='keys')return Response.json({});
  return Response.json({keys:[{kid:'test',kty:'RSA'}]},{headers:{'Cache-Control':'max-age=0'}});
 };
 const env={DB:new D1(),GOOGLE_FETCH:retryFetch},state='u'.repeat(43);
 assert.equal((await request(env,'/auth/session',{state,name:'Test',platform:'test'})).status,200);
 const pending=await env.DB.prepare('SELECT nonce FROM google_pending WHERE state_hash = ?').bind(await hash(state)).first();
 const credential=await token(pending.nonce);
 assert.equal((await request(env,'/auth/complete',{state,credential})).status,503);
 assert.equal((await (await request(env,'/auth/poll',{state})).json()).status,'pending');
 assert.equal((await googleAuthRequest(new Request(syncOrigin+'/auth/start?state='+state),env)).status,200);
 unavailable=false;
 await new Promise(resolve=>setTimeout(resolve,2));
 assert.equal((await request(env,'/auth/complete',{state,credential})).status,200);
 assert.deepEqual(await (await request(env,'/auth/poll',{state})).json(),{status:'pending'});
});

for(const openerMode of ['absent','present','throws'])test(`auth start allowlists Photos return URLs and redirects after success with ${openerMode} opener`,async()=>{
 const env={DB:new D1()},state='r'.repeat(43);await request(env,'/auth/session',{state,name:'Test',platform:'test'});
 for(const target of ['https://evil.test','https://photos.google.com.evil.test/','http://photos.google.com/','https://user@photos.google.com/','javascript:alert(1)','/relative'])assert.equal((await googleAuthRequest(new Request(syncOrigin+'/auth/start?state='+state+'&return='+encodeURIComponent(target)),env)).status,400);
 const target='https://photos.google.com/u/0/?test=1#album',response=await googleAuthRequest(new Request(syncOrigin+'/auth/start?state='+state+'&return='+encodeURIComponent(target)),env);assert.equal(response.status,200);
 const script=(await response.text()).match(/<script>([\s\S]*?)<\/script>/)[1];let callback,returned;runInNewContext(script,{google:{accounts:{id:{initialize:value=>callback=value.callback,renderButton(){}}}},document:{getElementById:()=>({})},URL,URLSearchParams,fetch:async()=>Response.json({code:'c'.repeat(43)}),window:{opener:openerMode==='absent'?null:{postMessage(){if(openerMode==='throws')throw Error('Opener unavailable');}},close:()=>assert.fail('Return flow must keep the tab open'),location:{replace:value=>returned=value}}});await callback({credential:'test'});const returnedURL=new URL(returned);assert.equal(returnedURL.origin,'https://photos.google.com');const fragment=new URLSearchParams(returnedURL.hash.slice(1));assert.equal(fragment.get('photos-swipe-state'),state);assert.equal(fragment.get('photos-swipe-code'),'c'.repeat(43));assert.equal(fragment.get('photos-swipe-return-hash'),'album');
});

for(const outcome of ['rotated','unavailable','missing'])test(`Google missing cached kid refresh handles ${outcome} keys`,async()=>{
 let calls=0;
 const rolloverFetch=async()=>{
  calls++;
  if(calls===2&&outcome==='unavailable')return new Response('',{status:503});
  const kid=calls===1||outcome==='missing'?'old':'test';
  return Response.json({keys:[{...jwk,kid}]},{headers:{'Cache-Control':'max-age=3600'}});
 };
 await verifyGoogleToken(await token('warm',{},keys.privateKey,'old'),'warm',rolloverFetch);
 const env={DB:new D1(),GOOGLE_FETCH:rolloverFetch},state='v'.repeat(43);
 await request(env,'/auth/session',{state,name:'Test',platform:'test'});
 const pending=await env.DB.prepare('SELECT nonce FROM google_pending WHERE state_hash = ?').bind(await hash(state)).first();
 const credential=await token(pending.nonce);
 const completion=await request(env,'/auth/complete',{state,credential});
 assert.equal(calls,2);
 assert.equal(completion.status,outcome==='rotated'?200:outcome==='unavailable'?503:400);
 assert.equal((await (await request(env,'/auth/poll',{state})).json()).status,outcome==='missing'?'failed':'pending');
 if(outcome==='unavailable'){
  assert.equal((await request(env,'/auth/complete',{state,credential})).status,200);
  assert.equal(calls,3);
  assert.deepEqual(await (await request(env,'/auth/poll',{state})).json(),{status:'pending'});
 }
 if(outcome!=='missing'){
  const fetched=calls;
  assert.equal((await verifyGoogleToken(await token('next'),'next',rolloverFetch)).sub,'account-one');
  assert.equal(calls,fetched);
 }
});

test('same-tab return redirects with 302 and state-only claim is single-use',async()=>{
 const env={DB:new D1(),GOOGLE_FETCH:fetchKeys,SYNC_TOKEN:'legacy-test'},state='v'.repeat(43),target='https://photos.google.com/u/2/?test=1#album';
 await request(env,'/auth/session',{state,automatic:true,name:'Synthetic browser',platform:'test'},'legacy-test');
 assert.equal((await googleAuthRequest(new Request(syncOrigin+'/auth/start?state='+state+'&return='+encodeURIComponent(target)),env)).status,200);
 assert.equal((await googleAuthRequest(new Request(syncOrigin+'/auth/return?state='+state),env)).status,400);
 const pending=await env.DB.prepare('SELECT nonce FROM google_pending WHERE state_hash = ?').bind(await hash(state)).first();
 await request(env,'/auth/complete',{state,credential:await token(pending.nonce)});
 const redirect=await googleAuthRequest(new Request(syncOrigin+'/auth/return?state='+state),env);assert.equal(redirect.status,302);assert.equal(redirect.headers.get('Location'),target);assert.equal(redirect.headers.get('Referrer-Policy'),'no-referrer');
 assert.equal((await request(env,'/auth/poll',{state})).status,401);
 const claims=await Promise.all([request(env,'/auth/poll',{state},'legacy-test'),request(env,'/auth/poll',{state},'legacy-test')]);
 assert.equal((await Promise.all(claims.map(response=>response.json()))).filter(value=>value.status==='done').length,1);
 assert.equal((await googleAuthRequest(new Request(syncOrigin+'/auth/return?state='+state),env)).status,400);
});

test('same-tab legacy Google claim merges progress into an existing account',async()=>{
 const env={DB:new D1(),GOOGLE_FETCH:fetchKeys,SYNC_TOKEN:'legacy-test'},state='w'.repeat(43);
 const existing=await signIn(env,'x'.repeat(43));
 const api=(bearer,path,method='GET',value)=>syncRequest(new Request(syncOrigin+'/api/'+path,{method,headers:{Authorization:'Bearer '+bearer},...(value?{body:JSON.stringify(value)}:{})}),env);
 await api('legacy-test','decisions/legacy-synthetic','PUT',{decision:'remove'});await api(existing.token,'decisions/account-synthetic','PUT',{decision:'keep'});
 await request(env,'/auth/session',{state,automatic:true,name:'Synthetic device',platform:'test'},'legacy-test');
 await googleAuthRequest(new Request(syncOrigin+'/auth/start?state='+state+'&return='+encodeURIComponent('https://photos.google.com/u/0/')),env);
 const pending=await env.DB.prepare('SELECT nonce FROM google_pending WHERE state_hash = ?').bind(await hash(state)).first();await request(env,'/auth/complete',{state,credential:await token(pending.nonce)});
 const linked=await (await request(env,'/auth/poll',{state},'legacy-test')).json();assert.equal(linked.status,'done');
 for(const bearer of [linked.token,existing.token,'legacy-test'])assert.deepEqual((await (await api(bearer,'state')).json()).decisions.map(entry=>entry.id).sort(),['account-synthetic','legacy-synthetic']);
});

test('foreground fallback claims automatically without an opener or return URL',async()=>{
 const env={DB:new D1(),GOOGLE_FETCH:fetchKeys},state='y'.repeat(43);
 await request(env,'/auth/session',{state,automatic:true,name:'Synthetic fallback',platform:'test'});
 await googleAuthRequest(new Request(syncOrigin+'/auth/start?state='+state),env);
 assert.equal((await (await request(env,'/auth/poll',{state})).json()).status,'pending');
 const pending=await env.DB.prepare('SELECT nonce FROM google_pending WHERE state_hash = ?').bind(await hash(state)).first();await request(env,'/auth/complete',{state,credential:await token(pending.nonce)});
 assert.equal((await (await request(env,'/auth/poll',{state})).json()).status,'done');assert.equal((await (await request(env,'/auth/poll',{state})).json()).status,'expired');
});

for(const automatic of [undefined,false])test(`Photos return URL cannot enable state-only claims for automatic=${automatic}`,async()=>{
 const env={DB:new D1(),GOOGLE_FETCH:fetchKeys},state='z'.repeat(43);
 assert.equal((await request(env,'/auth/session',{state,automatic,name:'Legacy browser',platform:'test'})).status,200);
 assert.equal((await googleAuthRequest(new Request(syncOrigin+'/auth/start?state='+state+'&return='+encodeURIComponent('https://photos.google.com/')),env)).status,200);
 const pending=await env.DB.prepare('SELECT nonce,state_claim,return_url FROM google_pending WHERE state_hash = ?').bind(await hash(state)).first();
 assert.equal(pending.state_claim,0);assert.equal(pending.return_url,'https://photos.google.com/');
 const complete=await request(env,'/auth/complete',{state,credential:await token(pending.nonce)});assert.equal(complete.status,200);const {code}=await complete.json();
 assert.deepEqual(await (await request(env,'/auth/poll',{state})).json(),{status:'pending'});
 assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM devices').get().n,0);
 assert.equal(env.DB.sqlite.prepare('SELECT claimed_at FROM google_pending').get().claimed_at,null);
 assert.equal((await request(env,'/auth/poll',{state,code:'x'.repeat(43)})).status,400);
 const claim=await request(env,'/auth/poll',{state,code});assert.equal(claim.status,200);assert.equal((await claim.json()).status,'done');
 assert.equal((await (await request(env,'/auth/poll',{state,code})).json()).status,'expired');
});

test('a shared automatic sign-in link without a private proof requires the completing browser',async()=>{
 const claimSecret=undefined;
 const env={DB:new D1(),GOOGLE_FETCH:fetchKeys},state='S'.repeat(43);
 await request(env,'/auth/session',{state,automatic:true,claimSecret,name:'Browser',platform:'test'});
 await googleAuthRequest(new Request(syncOrigin+'/auth/start?state='+state),env);
 const attackerCookie=env.browserCookie;
 await googleAuthRequest(new Request(syncOrigin+'/auth/start?state='+state),env);
 const pending=await env.DB.prepare('SELECT nonce FROM google_pending WHERE state_hash = ?').bind(await hash(state)).first();
 const credential=await token(pending.nonce);
 const attackerRequest=path=>new Request(syncOrigin+path,{method:'POST',headers:{Origin:syncOrigin,Cookie:attackerCookie},body:JSON.stringify({state,credential,claimSecret})});
 assert.equal((await handleGoogleAuthRequest(attackerRequest('/auth/complete'),env)).status,401);
 assert.equal((await request(env,'/auth/complete',{state,credential})).status,200);
 assert.equal((await handleGoogleAuthRequest(attackerRequest('/auth/poll'),env)).status,401);
 assert.equal((await handleGoogleAuthRequest(new Request(syncOrigin+'/auth/poll',{method:'POST',body:JSON.stringify({state,claimSecret})}),env)).status,401);
 assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM devices').get().n,0);
 assert.equal((await (await request(env,'/auth/poll',{state,claimSecret})).json()).status,'done');
 });

test('changing the browser during Google verification prevents completion',async()=>{
 const env={DB:new D1()},state='R'.repeat(43);
 env.GOOGLE_FETCH=async url=>{await googleAuthRequest(new Request(syncOrigin+'/auth/start?state='+state),env);return fetchKeys(url);};
 await request(env,'/auth/session',{state,automatic:true,name:'Browser',platform:'test'});
 await googleAuthRequest(new Request(syncOrigin+'/auth/start?state='+state),env);
 const pending=await env.DB.prepare('SELECT nonce FROM google_pending WHERE state_hash = ?').bind(await hash(state)).first();
 assert.equal((await request(env,'/auth/complete',{state,credential:await token(pending.nonce)})).status,400);
 assert.equal((await (await request(env,'/auth/poll',{state})).json()).status,'pending');
 assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM google_accounts').get().n,0);
});

for(const openerMode of ['same-tab','opener-less tab'])test(`userscript ${openerMode} return claims without sharing the browser cookie`,async()=>{
 const env={DB:new D1(),GOOGLE_FETCH:fetchKeys},state='Q'.repeat(43),target='https://photos.google.com/u/2/?test=1#album';
 const privateRequest=value=>handleGoogleAuthRequest(new Request(syncOrigin+'/auth/poll',{method:'POST',body:JSON.stringify(value)}),env);
 await request(env,'/auth/session',{state,name:'Safari',platform:'iPhone'});
 const response=await googleAuthRequest(new Request(syncOrigin+'/auth/start?state='+state+'&return='+encodeURIComponent(target)),env);
 const script=(await response.text()).match(/<script>([\s\S]*?)<\/script>/)[1];let callback,returned;
 runInNewContext(script,{google:{accounts:{id:{initialize:value=>callback=value.callback,renderButton(){}}}},document:{getElementById:()=>({})},URL,URLSearchParams,fetch:async(path,options)=>{
  assert.equal(path,'/auth/complete');
  return request(env,path,JSON.parse(options.body));
 },window:{opener:null,close:()=>assert.fail('Must return to Photos'),location:{replace:value=>returned=value}}});
 const pending=await env.DB.prepare('SELECT nonce,state_claim FROM google_pending WHERE state_hash = ?').bind(await hash(state)).first();
 assert.equal(pending.state_claim,0);
 await callback({credential:await token(pending.nonce)});
 assert.ok(env.browserCookie);assert.deepEqual(await (await privateRequest({state})).json(),{status:'pending'});
 const returnURL=new URL(returned),fragment=new URLSearchParams(returnURL.hash.slice(1));
 assert.equal(returnURL.origin,'https://photos.google.com');assert.equal(fragment.get('photos-swipe-state'),state);assert.equal(fragment.get('photos-swipe-return-hash'),'album');
 const code=fragment.get('photos-swipe-code');assert.match(code,/^[A-Za-z0-9_-]{43}$/);
 assert.equal((await privateRequest({state,code:'x'.repeat(43)})).status,400);
 const claim=await privateRequest({state,code});assert.equal(claim.status,200);assert.equal((await claim.json()).status,'done');
 assert.equal((await (await privateRequest({state,code})).json()).status,'expired');
});

for(const bearer of [undefined,'legacy-test'])test(`automatic return delivers a completion code and rejects a pre-shared proof without cookies (${bearer||'new device'})`,async()=>{
 const env={DB:new D1(),GOOGLE_FETCH:fetchKeys,SYNC_TOKEN:'legacy-test'},state='P'.repeat(43),claimSecret='K'.repeat(43),target='https://photos.google.com/u/2/?test=1#album';
 assert.equal((await request(env,'/auth/session',{state,automatic:true,claimSecret,name:'Safari',platform:'iPhone'},bearer)).status,200);
 const response=await googleAuthRequest(new Request(syncOrigin+'/auth/start?state='+state+'&return='+encodeURIComponent(target)),env);
 const html=await response.text(),script=html.match(/<script>([\s\S]*?)<\/script>/)[1];let callback,returned;
 assert.ok(!html.includes(claimSecret));
 runInNewContext(script,{google:{accounts:{id:{initialize:value=>callback=value.callback,renderButton(){}}}},document:{getElementById:()=>({})},fetch:async(path,options)=>request(env,path,JSON.parse(options.body)),encodeURIComponent,URL,URLSearchParams,window:{opener:null,location:{replace:value=>returned=value}}});
 const pending=await env.DB.prepare('SELECT nonce,private_claim_hash FROM google_pending WHERE state_hash = ?').bind(await hash(state)).first();
 assert.deepEqual(new Uint8Array(pending.private_claim_hash),await hash(claimSecret));
 await callback({credential:await token(pending.nonce)});
 const destination=new URL(returned),fragment=new URLSearchParams(destination.hash.slice(1)),code=fragment.get('photos-swipe-code');
 assert.equal(destination.origin,'https://photos.google.com');assert.equal(fragment.get('photos-swipe-state'),state);assert.equal(fragment.get('photos-swipe-return-hash'),'album');assert.match(code,/^[A-Za-z0-9_-]{43}$/);
 const deviceCount=env.DB.sqlite.prepare('SELECT count(*) AS n FROM devices').get().n;
 const poll=value=>handleGoogleAuthRequest(new Request(syncOrigin+'/auth/poll',{method:'POST',headers:bearer?{Authorization:'Bearer '+bearer}:{},body:JSON.stringify({state,...value})}),env);
 for(const value of [{},{claimSecret:'X'.repeat(43)},{claimSecret:state}])assert.equal((await poll(value)).status,401);
 assert.equal((await request(env,'/auth/poll',{state},bearer)).status,401);
 assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM devices').get().n,deviceCount);
 assert.equal((await poll({claimSecret})).status,401);
 assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM devices').get().n,deviceCount);
 const responses=await Promise.all([poll({claimSecret,code}),poll({claimSecret,code})]);
 assert.ok(responses.every(response=>response.status===200||response.status===400));
 const claims=await Promise.all(responses.map(response=>response.json()));assert.equal(claims.filter(value=>value.status==='done').length,1);
 assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM devices').get().n,deviceCount+(bearer?0:1));
 assert.equal((await (await poll({claimSecret})).json()).status,'expired');
});

test('unauthenticated session creation is atomically capped and expired sessions free capacity',async()=>{
 const env={DB:new D1()};
 const insert=env.DB.sqlite.prepare('INSERT INTO google_pending (state_hash,nonce,expires_at,name,platform) VALUES (?,?,?,?,?)');
 for(let index=0;index<999;index++)insert.run(Buffer.from(String(index)),'fixture',Math.floor(Date.now()/1000)+300,'Fixture','test');
 const responses=await Promise.all(['a','b','c'].map(value=>request(env,'/auth/session',{state:value.repeat(43),name:'Fixture',platform:'test'})));
 assert.deepEqual(responses.map(response=>response.status).sort(),[200,429,429]);
 assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM google_pending').get().n,1000);
 env.DB.sqlite.exec('UPDATE google_pending SET expires_at = 1');
 assert.equal((await request(env,'/auth/session',{state:'d'.repeat(43),name:'Fixture',platform:'test'})).status,200);
 assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM google_pending').get().n,1);
});

test('two Google devices merge timestamps, removal precedence, device undo and newer-keep trash safety',async()=>{
 const env={DB:new D1(),GOOGLE_FETCH:fetchKeys};
 const a=await signIn(env,'1'.repeat(43)),b=await signIn(env,'2'.repeat(43));
 const api=(device,path,method='GET',value)=>syncRequest(new Request(syncOrigin+'/api/'+path,{method,headers:{Authorization:'Bearer '+device.token},...(value?{body:JSON.stringify(value)}:{})}),env);
 const decide=(device,decision,updatedAt,undo=false)=>api(device,'decisions','PUT',{decisions:[{id:'synthetic-photo',decision,updatedAt,undo}]});
 const state=async()=> (await (await api(a,'state')).json()).decisions;
 await decide(a,'keep',100);
 await decide(b,'keep',50);
 assert.equal(env.DB.sqlite.prepare('SELECT device_id FROM decision_versions').get().device_id,a.deviceId);
 await decide(b,'remove',40);
 assert.deepEqual(await state(),[{id:'synthetic-photo',decision:'remove'}]);
 assert.equal(env.DB.sqlite.prepare('SELECT device_id FROM decision_versions').get().device_id,b.deviceId);
 await decide(a,'remove',30);
 assert.equal(env.DB.sqlite.prepare('SELECT device_id FROM decision_versions').get().device_id,b.deviceId);
 await decide(a,'keep',200);
 assert.deepEqual(await state(),[{id:'synthetic-photo',decision:'remove'}]);
 assert.equal((await (await api(b,'trash-check','POST',{ids:['synthetic-photo']})).json()).safe,false);
 await decide(a,null,250,true);
 await decide(a,'keep',260,true);
 assert.deepEqual(await state(),[{id:'synthetic-photo',decision:'remove'}]);
 await decide(b,'keep',300,true);
 assert.deepEqual(await state(),[{id:'synthetic-photo',decision:'keep'}]);
 await decide(b,'remove',400);
 await decide(b,'keep',400);
 assert.deepEqual(await state(),[{id:'synthetic-photo',decision:'remove'}]);
 assert.equal((await (await api(b,'trash-check','POST',{ids:['synthetic-photo']})).json()).safe,true);
 await decide(b,null,500,true);
 assert.deepEqual(await state(),[]);
 await decide(a,'keep',450);
 assert.deepEqual(await state(),[]);
});

test('synced trash stays binned after stale progress, keeps and own-device undo',async()=>{
 const env={DB:new D1(),GOOGLE_FETCH:fetchKeys};
 const device=await signIn(env,'3'.repeat(43));
 const api=(path,value)=>syncRequest(new Request(syncOrigin+'/api/'+path,{method:'PUT',headers:{Authorization:'Bearer '+device.token},body:JSON.stringify(value)}),env);
 await api('decisions',{decisions:[{id:'synthetic-binned',decision:'remove',updatedAt:100}]});
 await api('progress',{started:true,reviewed:1,items:[{mediaKey:'synthetic-binned',state:'in_trash',revision:2}]});
 await api('progress',{started:true,reviewed:1,items:[{mediaKey:'synthetic-binned',state:'active',revision:200}]});
 await api('decisions',{decisions:[{id:'synthetic-binned',decision:'keep',updatedAt:300,undo:true}]});
 await api('decisions',{decisions:[{id:'synthetic-binned',decision:null,updatedAt:400,undo:true}]});
 assert.equal(env.DB.sqlite.prepare('SELECT decision FROM decisions').get().decision,'remove');
 assert.equal(JSON.parse(env.DB.sqlite.prepare('SELECT data FROM review_items').get().data).state,'in_trash');
});

test('one-time space linking applies the same timestamp and remove precedence as ongoing writes',async()=>{
 const env={DB:new D1(),GOOGLE_FETCH:fetchKeys,SYNC_TOKEN:'synthetic-legacy-token'};
 const existing=await signIn(env,'4'.repeat(43));
 const api=(bearer,path,method='GET',value)=>syncRequest(new Request(syncOrigin+'/api/'+path,{method,headers:{Authorization:'Bearer '+bearer},...(value?{body:JSON.stringify(value)}:{})}),env);
 const rows=[
  {id:'synthetic-older-keep',source:'keep',target:'keep',sourceTime:10,targetTime:20,winner:existing.deviceId},
  {id:'synthetic-newer-keep',source:'keep',target:'keep',sourceTime:30,targetTime:20},
  {id:'synthetic-older-remove',source:'remove',target:'keep',sourceTime:10,targetTime:20},
  {id:'synthetic-newer-keep-vs-remove',source:'keep',target:'remove',sourceTime:30,targetTime:20,winner:existing.deviceId}
 ];
 await api(existing.token,'decisions','PUT',{decisions:rows.map(row=>({id:row.id,decision:row.target,updatedAt:row.targetTime}))});
 await api('synthetic-legacy-token','decisions','PUT',{decisions:rows.map(row=>({id:row.id,decision:row.source,updatedAt:row.sourceTime}))});
 const sourceDevice=env.DB.sqlite.prepare('SELECT id FROM devices WHERE is_legacy = 1').get().id;
 const linked=await signIn(env,'5'.repeat(43),'synthetic-legacy-token');
 const decisions=(await (await api(linked.token,'state')).json()).decisions;
 const scope=env.DB.sqlite.prepare('SELECT space FROM device_spaces WHERE device_id = ?').get(existing.deviceId).space+':shared';
 for(const row of rows){
  assert.equal(decisions.find(entry=>entry.id===row.id).decision,row.source==='remove'||row.target==='remove'?'remove':'keep');
  const version=env.DB.sqlite.prepare('SELECT device_id,updated_at FROM decision_versions WHERE scope = ? AND id = ?').get(scope,row.id);
  assert.equal(version.device_id,row.winner||sourceDevice);
  assert.equal(version.updated_at,row.winner?row.targetTime:row.sourceTime);
 }
 assert.equal((await (await api(linked.token,'trash-check','POST',{ids:['synthetic-newer-keep-vs-remove']})).json()).safe,false);
});

test('polling removes undo eligibility when another device owns the same keep decision',async()=>{
 const {createSyncClient,markSyncChanges}=await import('../lib/userscript-sync.mjs');
 const env={DB:new D1(),GOOGLE_FETCH:fetchKeys};
 const a=await signIn(env,'6'.repeat(43)),b=await signIn(env,'7'.repeat(43));
 const client=device=>{const result=createSyncClient({fetch:(url,options)=>syncRequest(new Request(url,options),env)});result.configure({url:syncOrigin,token:device.token});return result;};
 const first=client(a),second=client(b),save=async state=>state;
 const initial=()=>({started:true,history:[],items:[{mediaKey:'synthetic-own-keep',decision:null,state:'active',revision:0}],syncDecisions:{},syncPending:{}});
 const keep=state=>markSyncChanges(state,{...state,history:[{key:'synthetic-own-keep',previous:null,decision:'keep',revision:1}],items:[{...state.items[0],decision:'keep',revision:1}]});
 let one=await first.sync('default',keep(initial()),save);
 const secondState=keep(initial());
 assert.ok(secondState.syncPendingTimes['synthetic-own-keep']>=env.DB.sqlite.prepare('SELECT updated_at FROM decision_versions').get().updated_at,JSON.stringify(secondState));
 const two=await second.sync('default',secondState,save);
 assert.equal(two.history.length,1);
 one=await first.sync('default',one,save);
 assert.equal(one.history.length,0);
 assert.equal(one.items[0].decision,'keep');
});

for(const batch of [false,true])test(`undo-to-keep records trash protection against older other-device removes (${batch?'batch':'single'})`,async()=>{
 const env={DB:new D1(),GOOGLE_FETCH:fetchKeys};
 const a=await signIn(env,'8'.repeat(43)),b=await signIn(env,'9'.repeat(43));
 const api=(device,path,method='GET',value)=>syncRequest(new Request(syncOrigin+'/api/'+path,{method,headers:{Authorization:'Bearer '+device.token},...(value?{body:JSON.stringify(value)}:{})}),env);
 const decide=(device,decision,updatedAt,undo=false)=>api(device,batch?'decisions':'decisions/photo','PUT',batch?{decisions:[{id:'photo',decision,updatedAt,undo}]}:{decision,updatedAt,undo});
 await decide(a,'keep',100);
 await decide(a,'remove',200);
 await decide(a,'keep',300,true);
 assert.equal(env.DB.sqlite.prepare('SELECT updated_at FROM decision_keeps').get().updated_at,300);
 await decide(b,'remove',150);
 assert.deepEqual((await (await api(a,'state')).json()).decisions,[{id:'photo',decision:'remove'}]);
 assert.equal((await (await api(b,'trash-check','POST',{ids:['photo']})).json()).safe,false);
 await decide(b,'remove',350);
 assert.equal((await (await api(b,'trash-check','POST',{ids:['photo']})).json()).safe,true);
});

for(const batch of [false,true])test(`versionless removes reject keep ownership and undo (${batch?'batch':'single'})`,async()=>{
 const env={DB:new D1(),GOOGLE_FETCH:fetchKeys};
 const a=await signIn(env,'6'.repeat(43)),b=await signIn(env,'7'.repeat(43));
 const scope=env.DB.sqlite.prepare('SELECT space FROM device_spaces WHERE device_id = ?').get(a.deviceId).space+':shared';
 const api=(device,path,method='GET',value)=>syncRequest(new Request(syncOrigin+'/api/'+path,{method,headers:{Authorization:'Bearer '+device.token},...(value?{body:JSON.stringify(value)}:{})}),env);
 for(const undo of [false,true]){
  const id=undo?'undo':'keep';
  env.DB.sqlite.prepare('INSERT INTO decisions VALUES (?,?,?)').run(scope,id,'remove');
  for(const device of [a,b]){
   const value={decision:'keep',updatedAt:30,undo};
   assert.equal((await api(device,batch?'decisions':'decisions/'+id,'PUT',batch?{decisions:[{id,...value}]}:value)).status,200);
   assert.equal(env.DB.sqlite.prepare('SELECT decision FROM decisions WHERE scope = ? AND id = ?').get(scope,id).decision,'remove');
   assert.equal(env.DB.sqlite.prepare('SELECT * FROM decision_versions WHERE scope = ? AND id = ?').get(scope,id),undefined);
   assert.equal((await (await api(device,'trash-check','POST',{ids:[id]})).json()).safe,false);
   assert.equal((await api(device,'decisions/'+id,'DELETE')).status,200);
   assert.equal(env.DB.sqlite.prepare('SELECT decision FROM decisions WHERE scope = ? AND id = ?').get(scope,id).decision,'remove');
  }
 }
});

test('space linking preserves versionless target removes against source keeps and later undo',async()=>{
 const env={DB:new D1(),GOOGLE_FETCH:fetchKeys,SYNC_TOKEN:'synthetic-legacy-token'};
 const existing=await signIn(env,'8'.repeat(43));
 const scope=env.DB.sqlite.prepare('SELECT space FROM device_spaces WHERE device_id = ?').get(existing.deviceId).space+':shared';
 const api=(bearer,path,method='GET',value)=>syncRequest(new Request(syncOrigin+'/api/'+path,{method,headers:{Authorization:'Bearer '+bearer},...(value?{body:JSON.stringify(value)}:{})}),env);
 const ids=['versioned-source','versionless-source'];
 for(const id of ids)env.DB.sqlite.prepare('INSERT INTO decisions VALUES (?,?,?)').run(scope,id,'remove');
 await api('synthetic-legacy-token','decisions','PUT',{decisions:ids.map(id=>({id,decision:'keep',updatedAt:30}))});
 env.DB.sqlite.prepare('DELETE FROM decision_versions WHERE scope = ? AND id = ?').run('default','versionless-source');
 const linked=await signIn(env,'9'.repeat(43),'synthetic-legacy-token');
 for(const id of ids){
  assert.equal(env.DB.sqlite.prepare('SELECT * FROM decision_versions WHERE scope = ? AND id = ?').get(scope,id),undefined);
  assert.equal((await (await api(linked.token,'trash-check','POST',{ids:[id]})).json()).safe,false);
  assert.equal((await api(linked.token,'decisions/'+id,'PUT',{decision:'keep',updatedAt:40,undo:true})).status,200);
  assert.equal(env.DB.sqlite.prepare('SELECT decision FROM decisions WHERE scope = ? AND id = ?').get(scope,id).decision,'remove');
  assert.equal(env.DB.sqlite.prepare('SELECT * FROM decision_versions WHERE scope = ? AND id = ?').get(scope,id),undefined);
 }
});
