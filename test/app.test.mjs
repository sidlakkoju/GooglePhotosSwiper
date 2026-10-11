import test from 'node:test';
import assert from 'node:assert/strict';
import {pending,summarize,albumCandidates,removalQueue,storageTotals} from '../public/model.js';
import {createApp} from '../server.mjs';
import {createStore,mediaURL} from '../lib/store.mjs';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const sample=(key='photoA')=>({mediaKey:key,name:'Memory.jpg',type:'photo',date:'2026-10-04T12:00:00Z',thumbUrl:'https://lh3.googleusercontent.com/photo',size:1200});
test('filters, ordering, and unknown sizes',()=>{const items=[{id:'a',type:'photo',size:20},{id:'b',type:'video',size:300},{id:'c',type:'photo'}];assert.deepEqual(pending(items,{},'all','largest').map(i=>i.id),['b','a','c']);assert.deepEqual(pending(items,{a:'keep',b:'remove'}).map(i=>i.id),['c']);assert.equal(summarize(items,{b:'remove'}).bytes,300);assert.equal(summarize(items,{c:'remove'}).unknown,1);});
test('reimport preserves decisions; revisions reject stale updates; metadata writes are atomic',()=>{const s=createStore();try{s.setSetting('account','account');s.importItems([sample()],'account');const id='account:photoA';s.decide(id,'remove',0);s.importItems([{...sample(),name:'Refreshed.jpg'}],'account');assert.equal(s.listItems()[0].decision,'remove');assert.equal(s.listItems()[0].revision,1);assert.throws(()=>s.decide(id,'keep',0),/another tab/);assert.throws(()=>s.importItems([sample('valid'),{...sample('bad'),thumbUrl:'https://evil.test/image'}],'account'),/Unsupported preview host/);assert.equal(s.listItems().length,1);s.decide(id,null,1);assert.equal(s.listItems()[0].decision,null);}finally{s.close();}});
test('album jobs lock candidates, retain partial acknowledgements, and reconcile retry',()=>{const s=createStore();try{s.setSetting('account','account');s.importItems([sample('a'),sample('b')],'account');for(const i of s.listItems())s.decide(i.id,'remove',0);const j=s.createJob(s.listItems().map(i=>i.id));assert.throws(()=>s.decide('account:a','keep',1),/Wait/);assert.throws(()=>s.createJob(['account:a']),/pending/);assert.throws(()=>s.progressJob(j.id,{status:'completed',albumKey:'album',confirmed:['a']}),/unverified/);s.progressJob(j.id,{status:'running',albumKey:'album',confirmed:['a']});s.progressJob(j.id,{status:'failed',error:'interrupted'});assert.equal(s.listItems()[0].albumKey,'album');assert.equal(s.listItems()[1].albumKey,null);s.retryJob(j.id);assert.equal(s.getJob(j.id).confirmed.length,1);s.progressJob(j.id,{status:'completed',confirmed:['a','b']});assert.equal(s.getJob(j.id).status,'completed');assert.throws(()=>s.createJob(['account:a']),/unsent/);assert.throws(()=>s.getJob('other'),/not found/);}finally{s.close();}});
test('SQLite state survives restart',async()=>{const dir=await mkdtemp(join(tmpdir(),'photos-test-'));try{let s=createStore(join(dir,'data.sqlite'));s.setSetting('account','account');s.importItems([sample()],'account');s.decide('account:photoA','keep',0);s.close();s=createStore(join(dir,'data.sqlite'));assert.equal(s.listItems()[0].decision,'keep');s.close();}finally{await rm(dir,{recursive:true,force:true});}});
test('media allowlist rejects non-Google hosts, credentials, HTTP, and nonstandard ports',()=>{assert.ok(mediaURL(sample().thumbUrl));assert.ok(mediaURL('https://photos.fife.usercontent.google.com/test'));assert.equal(mediaURL('https://photos.fife.usercontent.google.com.evil.test/a'),false);for(const v of ['http://lh3.googleusercontent.com/a','https://lh3.googleusercontent.com.evil.test/a','https://user:secret@lh3.googleusercontent.com/a','https://lh3.googleusercontent.com:9000/a'])assert.equal(mediaURL(v),false);});
test('local HTTP flow: login, one-time pairing, import, decisions, album checkpoint, revoke',async()=>{
 let clock=Date.now();const app=createApp({loginCode:'unit-test-access',now:()=>clock});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://localhost:${app.server.address().port}`;let cookie='',bridgeToken='';
 async function request(path,data,{bridge=false,origin}={}){const r=await fetch(base+path,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json'}:{}),...(bridge?{Authorization:`Bearer ${bridgeToken}`}:{Cookie:cookie}),...(origin?{Origin:origin}:{})},...(data?{body:JSON.stringify(data)}:{})});let b;try{b=await r.json();}catch{}return {r,b};}
 try{
  assert.equal((await fetch(base)).status,200);assert.equal((await fetch(base+'/.data/access-code')).status,404);
  assert.equal((await request('/api/workspace')).r.status,401);assert.equal((await request('/api/login',{code:'bad'})).r.status,401);
  const login=await request('/api/login',{code:'unit-test-access'});assert.equal(login.r.status,200);cookie=login.r.headers.get('set-cookie').split(';')[0];assert.match(login.r.headers.get('set-cookie'),/HttpOnly/);
  assert.equal((await request('/api/workspace',null,{origin:'https://evil.test'})).r.status,403);
  let code=(await request('/api/pair-code',{})).b.code;clock+=300001;assert.equal((await request('/api/bridge/pair',{code,account:'account',label:'Account'})).r.status,401);
  code=(await request('/api/pair-code',{})).b.code;const pair=await request('/api/bridge/pair',{code,account:'account',label:'Account'});bridgeToken=pair.b.token;assert.equal((await request('/api/bridge/pair',{code,account:'account',label:'Account'})).r.status,401);
  assert.equal((await request('/api/bridge/import',{items:[sample()],nextPageId:'page-2'},{bridge:true})).r.status,200);
  let w=(await request('/api/workspace')).b;assert.equal(w.trimJobs,undefined);assert.equal(w.cropProvider,undefined);assert.equal((await request('/api/trim-jobs',{})).r.status,404);assert.equal((await fetch(base+'/trim-workflow.js')).status,404);assert.equal(w.items.length,1);assert.equal(w.cursor,'page-2');assert.equal(w.account,'account');assert.equal(w.albumTitle,'Photos Swipe · Review · accoun');
  await request('/api/decisions',{id:w.items[0].id,decision:'remove',revision:0});const job=(await request('/api/album-jobs',{ids:[w.items[0].id]})).b;
  assert.equal((await request(`/api/bridge/jobs/${job.id}`,{status:'completed',albumKey:'album',confirmed:['photoA']},{bridge:true})).r.status,200);
  w=(await request('/api/workspace')).b;assert.equal(w.albumTitle,job.title);assert.equal(w.items[0].albumKey,'album');assert.equal(w.jobs[0].status,'completed');
  // Bad/expired re-pair attempts must not revoke the existing account or jobs.
  assert.equal((await request('/api/bridge/pair',{code:'000000',account:'account',label:'Account'})).r.status,401);
  const stale=(await request('/api/pair-code',{})).b.code;clock+=300001;
  assert.equal((await request('/api/bridge/pair',{code:stale,account:'account',label:'Account'})).r.status,401);
  const other=(await request('/api/pair-code',{})).b.code;
  assert.equal((await request('/api/bridge/pair',{code:other,account:'otheraccount',label:'Other'})).r.status,409);
  assert.equal((await request('/api/bridge/status',null,{bridge:true})).r.status,200);
  const preserved=(await request('/api/workspace')).b;assert.equal(preserved.account,'account');assert.equal(preserved.items[0].decision,'remove');assert.equal(preserved.jobs[0].status,'completed');
  await request('/api/unpair',{});assert.equal((await request('/api/bridge/status',null,{bridge:true})).r.status,401);
  await request('/api/logout',{});assert.equal((await request('/api/workspace')).r.status,401);
 }finally{await new Promise(r=>app.server.close(r));}
});

test('manual-deletion reconciliation hides confirmed trash, preserves unknowns, and restores reimports',()=>{
 const s=createStore();try{
  s.setSetting('account','account');s.importItems([sample('a'),sample('b')],'account');for(const i of s.listItems())s.decide(i.id,'remove',i.revision);
  const job=s.createJob(s.listItems().map(i=>i.id));s.progressJob(job.id,{status:'completed',albumKey:'album',confirmed:['a','b']});
  let snapshot=s.reconciliationSnapshot();const a=snapshot.items.find(i=>i.mediaKey==='a'),b=snapshot.items.find(i=>i.mediaKey==='b');
  const report=s.reconcile([{id:a.id,revision:a.revision,state:'in_trash',inAlbum:false},{id:b.id,revision:b.revision,state:'unknown',inAlbum:false}]);
  assert.equal(report.inTrash,1);assert.equal(report.unknown,1);assert.deepEqual(s.listItems().map(i=>i.mediaKey),['b']);assert.equal(s.listItems()[0].albumKey,'album');assert.equal(s.reconciliationInfo().inTrashCount,1);
  assert.throws(()=>s.decide(a.id,'keep',a.revision),/Restore/);
  s.importItems([sample('a')],'account');assert.equal(s.listItems().find(i=>i.id===a.id).decision,'remove');assert.equal(s.listItems().find(i=>i.id===a.id).albumKey,null);
  const updated=s.listItems().find(i=>i.id===b.id);s.reconcile([{id:b.id,revision:updated.revision,state:'active',inAlbum:false}]);assert.equal(s.listItems().find(i=>i.id===b.id).albumKey,null);
 }finally{s.close();}
});
test('reconciliation rejects incomplete results atomically and respects decisions changed during the check',()=>{
 const s=createStore();try{s.setSetting('account','account');s.importItems([sample('a'),sample('b')],'account');const snapshot=s.reconciliationSnapshot();
  assert.throws(()=>s.reconcile([{id:'account:a',revision:0,state:'in_trash',inAlbum:false},{id:'account:b',revision:0,state:'gone',inAlbum:false}]),/Invalid/);assert.equal(s.listItems().length,2);
  s.decide('account:a','keep',0);const report=s.reconcile(snapshot.items.map(i=>({id:i.id,revision:i.revision,state:'in_trash',inAlbum:false})));assert.equal(report.changed,1);assert.equal(s.listItems().length,1);assert.equal(s.listItems()[0].decision,'keep');
 }finally{s.close();}
});

test('missing review albums do not prevent confirmed Trash updates or reuse broken album links',()=>{
 const s=createStore();try{s.setSetting('account','account');s.importItems([sample()],'account');s.decide('account:photoA','remove',0);const job=s.createJob(['account:photoA']);s.progressJob(job.id,{status:'completed',albumKey:'missingalbum',confirmed:['photoA']});const photo=s.listItems()[0];
  const report=s.reconcile([{id:photo.id,revision:photo.revision,state:'in_trash',inAlbum:null}],{albumUnavailable:true,albumKey:'missingalbum'});assert.equal(report.inTrash,1);assert.equal(s.getSetting('album'),'');assert.equal(s.reconciliationInfo().unavailableAlbum,'missingalbum');assert.equal(s.listItems().length,0);
 }finally{s.close();}
});

test('failed album jobs can replace a missing target without losing their candidates',()=>{
 const s=createStore();try{s.setSetting('account','account');s.importItems([sample('a'),sample('b')],'account');for(const i of s.listItems())s.decide(i.id,'remove',0);const j=s.createJob(s.listItems().map(i=>i.id));s.progressJob(j.id,{status:'running',albumKey:'gone',confirmed:['a']});s.progressJob(j.id,{status:'failed',error:'unavailable'});
  assert.throws(()=>s.resetJobAlbum(j.id,'wrong'),/changed/);const reset=s.resetJobAlbum(j.id,'gone');assert.equal(reset.albumKey,null);assert.deepEqual(reset.confirmed,[]);assert.deepEqual(reset.mediaKeys,['a','b']);assert.ok(s.listItems().every(i=>!i.albumKey));assert.equal(s.getSetting('album'),'');s.retryJob(j.id);s.progressJob(j.id,{albumKey:'replacement',status:'completed',confirmed:['a','b']});assert.throws(()=>s.resetJobAlbum(j.id,'replacement'),/changed/);
 }finally{s.close();}
});

test('video buffering requires local auth and a known video, restricts hosts and validates upstream content',async()=>{
 let upstreamType='video/mp4',upstreamSize='4',calls=0;
 const app=createApp({loginCode:'video-test',mediaFetch:async(url,options)=>{calls++;assert.equal(options.redirect,'error');assert.equal(url,'https://lh3.googleusercontent.com/video');return new Response(new Uint8Array([1,2,3,4]),{headers:{'Content-Type':upstreamType,'Content-Length':upstreamSize}});}});
 app.store.setSetting('account','account');app.store.importItems([{...sample('v'),type:'video'},sample('p')],'account');
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://localhost:${app.server.address().port}`;let cookie='';
 const request=(path,body,origin)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});
 try{
  const video={id:'account:v',url:'https://lh3.googleusercontent.com/video'};
  assert.equal((await request('/api/video-preview',video)).status,401);
  cookie=(await request('/api/login',{code:'video-test'})).headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/api/video-preview',video,'https://evil.test')).status,403);
  for(const bad of [{...video,url:'https://evil.test/a'},{...video,url:'http://lh3.googleusercontent.com/a'},{...video,id:'account:p'},{...video,id:'other:v'}])assert.equal((await request('/api/video-preview',bad)).status,400);
  assert.equal(calls,0);const response=await request('/api/video-preview',video);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array([1,2,3,4]));
  upstreamType='text/html';assert.equal((await request('/api/video-preview',video)).status,502);
  upstreamType='video/mp4';upstreamSize=String(33*1024*1024);assert.equal((await request('/api/video-preview',{...video,prefetch:true})).status,413);assert.equal((await request('/api/video-preview',{...video,prefetch:'invalid'})).status,400);upstreamSize=String(513*1024*1024);assert.equal((await request('/api/video-preview',video)).status,413);
 }finally{await new Promise(r=>app.server.close(r));}
});

// Every browser module must be on the static allowlist; otherwise a new import
// can make the entire application inert even when Node syntax checks pass.
test('all public browser modules are served as JavaScript',async()=>{
 const app=createApp({loginCode:'asset-test'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 try{const base=`http://localhost:${app.server.address().port}`;for(const file of (await readdir(new URL('../public/',import.meta.url))).filter(f=>f.endsWith('.js'))){const response=await fetch(`${base}/${file}`);assert.equal(response.status,200,file);assert.match(response.headers.get('content-type'),/javascript/,file);assert.equal(await response.text(),await readFile(new URL(`../public/${file}`,import.meta.url),'utf8'),file);}}
 finally{await new Promise(r=>app.server.close(r));}
});
