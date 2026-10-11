import http from 'node:http';
import { readFile,mkdir,writeFile,chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { timingSafeEqual,randomInt } from 'node:crypto';
import { createStore,hash,secret,problem,text,key,mediaURL } from './lib/store.mjs';
const publicDir=new URL('./public/',import.meta.url),types={html:'text/html',css:'text/css',js:'text/javascript',svg:'image/svg+xml'};
const assets=new Set(['index.html','guide.html','app.js','viewer.js','swipe.js','model.js','bridge.js','connection.js','cache.js','import-review.js','undo-history.js','styles.css','demo.svg']);
export function createApp({dbPath=':memory:',loginCode=secret(),now=()=>Date.now(),mediaFetch=fetch}={}){
 const store=createStore(dbPath),{db}=store;let pairing=null,attempts={count:0,start:now()},pairAttempts={count:0,start:now()};
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https://*.googleusercontent.com https://photos.fife.usercontent.google.com; media-src 'self' blob: https://*.googleusercontent.com https://photos.fife.usercontent.google.com; connect-src 'self' https://*.googleusercontent.com https://photos.fife.usercontent.google.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const json=(s,b)=>{res.writeHead(s,{'Content-Type':'application/json'});res.end(JSON.stringify(b));};
  try{
   const host=req.headers.host||'',port=server.address()?.port;if(![`localhost:${port}`,`127.0.0.1:${port}`].includes(host))throw problem(403,'Localhost only.');const origin=`http://${host}`,u=new URL(req.url,origin),isBridge=u.pathname.startsWith('/api/bridge/');
   const extensionOrigin=/^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin||'');
   if(req.headers.origin&&req.headers.origin!==origin&&!(isBridge&&extensionOrigin))throw problem(403,'Cross-origin request blocked.');if(req.headers['sec-fetch-site']==='cross-site'&&!isBridge)throw problem(403,'Cross-site request blocked.');
   if(req.method==='OPTIONS'){if(!isBridge||!extensionOrigin)throw problem(403,'Origin blocked.');res.writeHead(204,{'Access-Control-Allow-Origin':req.headers.origin,'Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'GET,POST','Vary':'Origin'});res.end();return;}
   if(isBridge&&extensionOrigin)res.setHeader('Access-Control-Allow-Origin',req.headers.origin);
   async function body(){if(!req.headers['content-type']?.startsWith('application/json'))throw problem(415,'Use JSON requests.');let chunks=[],length=0;for await(const c of req){length+=c.length;if(length>2*1024*1024)throw problem(413,'Request too large.');chunks.push(c);}try{const b=JSON.parse(Buffer.concat(chunks).toString());if(!b||typeof b!=='object'||Array.isArray(b))throw Error();return b;}catch{throw problem(400,'Invalid JSON body.');}}
   const cookie=/\bps_session=([a-zA-Z0-9_-]+)\b/.exec(req.headers.cookie||'')?.[1],authenticated=cookie&&db.prepare('SELECT hash FROM sessions WHERE hash=? AND expires>?').get(hash(cookie),now());
   if(u.pathname==='/api/session'&&req.method==='GET')return json(200,{authenticated:!!authenticated});
   if(u.pathname==='/api/login'&&req.method==='POST'){if(now()-attempts.start>60000)attempts={count:0,start:now()};if(++attempts.count>10)throw problem(429,'Too many attempts. Wait a minute.');const b=await body();if(typeof b.code!=='string'||!timingSafeEqual(Buffer.from(hash(b.code)),Buffer.from(hash(loginCode))))throw problem(401,'Incorrect local access code.');const token=secret();db.prepare('DELETE FROM sessions WHERE expires<?').run(now());db.prepare('INSERT INTO sessions VALUES (?,?)').run(hash(token),now()+43200000);res.setHeader('Set-Cookie',`ps_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);return json(200,{ok:true});}
   if(isBridge){
    if(u.pathname==='/api/bridge/pair'&&req.method==='POST'){if(now()-pairAttempts.start>60000)pairAttempts={count:0,start:now()};if(++pairAttempts.count>20)throw problem(429,'Too many pairing attempts. Wait a minute.');const b=await body();if(!pairing||pairing.expires<now()||b.code!==pairing.code)throw problem(401,'Pairing code expired or incorrect. Generate a new one.');if(!key(b.account)||!text(b.label))throw problem(400,'Invalid Google account.');if(store.account()&&store.account()!==b.account)throw problem(409,'This workspace belongs to a different Google account. Pair that account instead.');const token=secret();db.prepare('DELETE FROM pairs').run();db.prepare('INSERT INTO pairs VALUES (?,?,?)').run(hash(token),b.account,text(b.label));store.setSetting('account',b.account);store.setSetting('accountLabel',text(b.label));pairing=null;return json(200,{token,account:b.account});}
    const token=/^Bearer ([a-zA-Z0-9_-]+)$/.exec(req.headers.authorization||'')?.[1],pair=token&&db.prepare('SELECT * FROM pairs WHERE hash=?').get(hash(token));if(!pair||pair.account!==store.account())throw problem(401,'Extension is not paired.');
    if(u.pathname==='/api/bridge/status'&&req.method==='GET')return json(200,{account:pair.account,label:pair.label});
    if(u.pathname==='/api/bridge/import'&&req.method==='POST'){const b=await body();return json(200,store.importPage(b.items,pair.account,b));}
    if(u.pathname==='/api/bridge/reconcile'&&req.method==='GET')return json(200,store.reconciliationSnapshot());
    if(u.pathname==='/api/bridge/reconcile'&&req.method==='POST'){const b=await body();return json(200,store.reconcile(b.results,{albumUnavailable:b.albumUnavailable??false,albumKey:b.albumKey}));}
    if(u.pathname==='/api/bridge/cursor'&&req.method==='GET')return json(200,{cursor:store.getSetting('cursor')||null,exhausted:store.getSetting('exhausted')==='true'});
    if(u.pathname.startsWith('/api/bridge/items/')&&req.method==='GET'){const id=decodeURIComponent(u.pathname.slice('/api/bridge/items/'.length));const item=store.listItems().find(i=>i.id===id);if(!item)throw problem(404,'Photo not found.');return json(200,item);}
    const reset=/^\/api\/bridge\/jobs\/([a-f0-9]{24})\/reset-album$/.exec(u.pathname);if(reset&&req.method==='POST')return json(200,store.resetJobAlbum(reset[1],(await body()).previousAlbumKey));
    const m=/^\/api\/bridge\/jobs\/([a-f0-9]{24})$/.exec(u.pathname);if(m&&req.method==='GET')return json(200,store.getJob(m[1]));if(m&&req.method==='POST')return json(200,store.progressJob(m[1],await body()));throw problem(404,'Unknown bridge operation.');
   }
   if(u.pathname.startsWith('/api/')){
    if(!authenticated)throw problem(401,'Unlock your local workspace first.');
    if(u.pathname==='/api/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(cookie));res.setHeader('Set-Cookie','ps_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(200,{ok:true});}
    if(u.pathname==='/api/workspace'&&req.method==='GET')return json(200,{items:store.listItems(),...store.reconciliationInfo(),paired:!!db.prepare('SELECT hash FROM pairs').get(),account:store.account(),accountLabel:store.getSetting('accountLabel'),cursor:store.getSetting('cursor')||null,exhausted:store.getSetting('exhausted')==='true',albumKey:store.getSetting('album'),albumTitle:store.albumTitle(),storage:store.storageSummary(),jobs:db.prepare('SELECT id FROM jobs WHERE account=? ORDER BY created DESC LIMIT 10').all(store.account()).map(j=>store.getJob(j.id))});
    if(u.pathname==='/api/video-preview'&&req.method==='POST'){
     const b=await body(),item=store.listItems().find(i=>i.id===b.id);
     if(!item||item.type!=='video'||typeof b.url!=='string'||b.url.length>16000||!mediaURL(b.url)||(b.prefetch!==undefined&&typeof b.prefetch!=='boolean'))throw problem(400,'Invalid video preview.');
     const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180000);res.on('close',()=>controller.abort());
     try{const upstream=await mediaFetch(b.url,{redirect:'error',signal:controller.signal});if(!upstream.ok||!upstream.body)throw problem(502,'Video preview unavailable. Retry playback.');
      const type=upstream.headers.get('content-type')?.split(';')[0];if(!type?.startsWith('video/')&&type!=='application/octet-stream')throw problem(502,'Unexpected video preview format.');
      const limit=(b.prefetch?32:512)*1024*1024;if(Number(upstream.headers.get('content-length'))>limit)throw problem(413,b.prefetch?'Video preview exceeds the preloading limit.':'This video preview is too large to buffer. Open it in Google Photos.');
      res.writeHead(200,{'Content-Type':type});let size=0;for await(const chunk of upstream.body){size+=chunk.length;if(size>limit)throw problem(413,'Video preview is too large.');if(!res.write(chunk))await new Promise(resolve=>res.once('drain',resolve));}res.end();
     }finally{clearTimeout(timer);controller.abort();}return;
    }
    if(u.pathname==='/api/pair-code'&&req.method==='POST'){pairing={code:String(randomInt(100000,1000000)),expires:now()+300000};return json(200,pairing);}
    if(u.pathname==='/api/unpair'&&req.method==='POST'){db.prepare('DELETE FROM pairs').run();pairing=null;return json(200,{ok:true});}
    if(u.pathname==='/api/decisions'&&req.method==='POST'){const b=await body();return json(200,store.decide(b.id,b.decision,b.revision));}
    if(u.pathname==='/api/album-jobs'&&req.method==='POST'){const b=await body();if(!db.prepare('SELECT hash FROM pairs').get())throw problem(409,'Pair the desktop extension first.');return json(201,store.createJob(b.ids));}
    const m=/^\/api\/album-jobs\/([a-f0-9]{24})\/retry$/.exec(u.pathname);if(m&&req.method==='POST')return json(200,store.retryJob(m[1]));throw problem(404,'Unknown operation.');
   }
   if(req.method!=='GET')throw problem(405,'Method not allowed.');const file=u.pathname==='/'?'index.html':u.pathname.slice(1);if(!assets.has(file))throw problem(404,'Not found.');const bytes=await readFile(new URL(file,publicDir));res.writeHead(200,{'Content-Type':`${types[file.split('.').pop()]}; charset=utf-8`});res.end(bytes);
  }catch(e){if(!res.headersSent)json(e.status||500,{error:e.status?e.message:'Local server error. Check the terminal.'});else res.destroy();if(!e.status)console.error(e.message);}
 });server.on('close',()=>{store.close();});return {server,store,loginCode};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const dir=fileURLToPath(new URL('./.data/',import.meta.url));await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);let loginCode=process.env.LOCAL_ACCESS_CODE;
 if(!loginCode){try{loginCode=(await readFile(join(dir,'access-code'),'utf8')).trim();}catch{loginCode=secret();await writeFile(join(dir,'access-code'),loginCode,{mode:0o600});}}
 const {server}=createApp({dbPath:join(dir,'photos.sqlite'),loginCode}),port=Number(process.env.PORT)||3000;
 server.listen(port,'127.0.0.1',async()=>{await writeFile(join(dir,'local-login-url'),`http://localhost:${port}/#unlock=${loginCode}`,{mode:0o600});console.log(`Photos Swipe: http://localhost:${port}\nAccess link saved in .data/local-login-url (open once to unlock).`);});for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>server.close(()=>process.exit(0)));
}
