import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,extname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {openReviewDatabase} from '../lib/userscript-db.mjs';
import {emptyReview} from '../lib/userscript-core.mjs';
import {createMemoryIndexedDB,createDemoPhotos,demoItems,demoLibrary,demoLandscapeSVG} from '../lib/userscript-demo.mjs';

let chromium;
try{({chromium}=await import('playwright'));}catch{}

test('demo storage lives in memory and keeps the real database rules',async()=>{
 const indexedDB=createMemoryIndexedDB(),db=await openReviewDatabase(indexedDB);
 assert.deepEqual(await db.read('demo'),emptyReview());
 const saved=await db.save('demo',{...emptyReview(),items:[{mediaKey:'a',decision:'keep'}]});
 assert.equal(saved.revision,1);
 const reopened=await openReviewDatabase(indexedDB);
 assert.deepEqual(await reopened.read('demo'),saved);
 await assert.rejects(db.save('demo',{...emptyReview()}),/another tab/);
 await db.lease('demo','owner-a');await assert.rejects(reopened.lease('demo','owner-b'),/busy/);
 await db.saveSettings({onboardingDismissed:true});assert.deepEqual(await reopened.settings(),{onboardingDismissed:true});
 assert.deepEqual((await indexedDB.databases()).map(entry=>entry.name),['photos-swipe-userscript']);
 assert.deepEqual(await (await openReviewDatabase(createMemoryIndexedDB())).read('demo'),emptyReview(),'a new page starts empty');
});

test('the demo library answers like Google Photos and simulates Trash without any network',async()=>{
 const items=demoItems('https://demo.test/media/'),photos=createDemoPhotos({items});
 assert.ok(items.length>=12&&items.some(item=>item.type==='video')&&items.some(item=>item.takesUpSpace===false));
 for(const item of items){assert.match(item.name,/^IMG_\d{4}\.(HEIC|JPG|MOV)$/);assert.ok(item.size>=1e6&&item.size<=8e6);assert.match(item.date,/^202[45]-/);assert.ok(item.locationName);assert.ok(item.dedupKey);}
 const page=(await photos.call('library',{cursor:null})).data;
 assert.equal(page.items.length,items.length);assert.equal(page.nextPageId,null);assert.ok(page.items.every(item=>!('videoUrl' in item)));
 const [first,second]=items;
 assert.deepEqual((await photos.call('moveToTrash',{dedupKeys:[first.dedupKey],confirmed:true})).ok,true);
 assert.deepEqual((await photos.call('trashPage',{cursor:null})).data.items,[{mediaKey:first.mediaKey,dedupKey:first.dedupKey}]);
 assert.equal((await photos.call('itemState',{mediaKey:first.mediaKey})).data.state,'in_trash');
 assert.equal((await photos.call('itemState',{mediaKey:second.mediaKey})).data.state,'active');
 assert.equal((await photos.call('library',{cursor:null})).data.items.length,items.length-1);
 for(const operation of ['createShareLink','addToAlbum','createAlbum','trash'])assert.equal((await photos.call(operation,{mediaKey:first.mediaKey})).ok,false);
 assert.match((await photos.call('video',{mediaKey:items.find(item=>item.type==='video').mediaKey})).data.url,/^https:\/\/demo\.test\/media\/.+\.mp4$/);
 for(const entry of demoLibrary)assert.match(demoLandscapeSVG(entry.palette,{seed:entry.seed}),/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*>.*<\/svg>$/s);
});

async function buildDemo(t){
 const directory=await mkdtemp(join(tmpdir(),'photos-swipe-demo-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const result=spawnSync(process.execPath,['scripts/build-demo.mjs',directory],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 return directory;
}

test('the static demo build is self-contained with relative paths',async t=>{
 const directory=await buildDemo(t),files=await readdir(directory),media=await readdir(join(directory,'media'));
 assert.deepEqual(files.sort(),['index.html','media','photos-swipe-demo.js']);
 assert.ok(media.filter(name=>name.endsWith('.svg')).length>=12);assert.ok(media.some(name=>name.endsWith('.mp4')));
 const html=await readFile(join(directory,'index.html'),'utf8'),script=await readFile(join(directory,'photos-swipe-demo.js'),'utf8');
 assert.match(html,/<script src="photos-swipe-demo\.js"><\/script>/);
 assert.doesNotMatch(html,/(src|href)="\/|https?:\/\//);
 assert.match(html,/Content-Security-Policy" content="default-src 'none'; script-src 'self';[^"]*connect-src 'none'/);
 assert.match(html,/background:#000/);
 assert.doesNotMatch(script,/photosOperation|batchexecute|createPagePhotosBridge/);
 assert.ok([...script].every(character=>character.charCodeAt(0)<128));
});

test('the embedded demo swipes, simulates Trash, posts to its parent and resets without touching Google or real storage',{timeout:60000},async t=>{
 if(!chromium){t.skip('Playwright is unavailable');return;}
 const directory=await buildDemo(t);
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1000,height:900}});
 const outside=[],types={'.html':'text/html','.js':'text/javascript','.svg':'image/svg+xml','.mp4':'video/mp4'};
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname==='site.test')return route.fulfill({contentType:'text/html',body:'<!doctype html><body style="margin:0"><script>window.events=[];addEventListener("message",e=>{if(e.data?.type==="photos-swipe-demo")events.push(e.data.event);});</script><iframe id="demo" src="https://demo.test/photos-swipe/demo/?embed=1" style="width:390px;height:844px;border:0"></iframe></body>'});
  if(url.hostname!=='demo.test'){outside.push(url.href);return route.abort();}
  const path=url.pathname.replace(/^\/photos-swipe\/demo\//,'')||'index.html';
  try{return route.fulfill({body:await readFile(join(directory,path)),contentType:types[extname(path)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
 });
 await page.goto('https://site.test/');
 const frame=()=>page.frame({url:/demo\.test/});
 const shadow=code=>frame().evaluate(source=>Function('const root=document.getElementById("photos-swipe-userscript-host").shadowRoot;const q=s=>root.querySelector(s);'+source)(),code);
 const ready=async()=>{await page.waitForFunction(()=>window.events.includes('ready'));await frame().waitForFunction(()=>/^14 to review/.test(document.getElementById('photos-swipe-userscript-host')?.shadowRoot.getElementById('stats').textContent||''),null,{timeout:15000});};
 await ready();
 const opened=await shadow(`return {overlay:q('#overlay').hidden,launcher:getComputedStyle(q('#launcher')).display,close:q('#close').hidden,sync:q('#sync-settings').closest('.group').hidden,onboarding:q('#pair-onboarding').hidden,signIn:q('#google-sign-in').disabled,coach:q('.coach').hidden,reset:!!q('#demo-reset'),embed:document.documentElement.dataset.embed};`);
 assert.deepEqual(opened,{overlay:false,launcher:'none',close:true,sync:true,onboarding:true,signIn:true,coach:true,reset:true,embed:'1'});
 assert.deepEqual(await page.evaluate(()=>window.events),['ready']);
 for(let index=0;index<3;index++){await shadow(`q('#remove').click();`);await frame().waitForTimeout(150);}
 await page.waitForFunction(()=>window.events.includes('first-swipe'));
 assert.deepEqual(await page.evaluate(()=>window.events.filter(event=>event==='first-swipe')),['first-swipe']);
 assert.equal(await shadow(`return q('.trash-badge').textContent;`),'3');
 await shadow(`q('#undo').click();`);await frame().waitForTimeout(150);
 assert.equal(await shadow(`return q('.trash-badge').textContent;`),'2');
 await shadow(`q('#open-photos').click();`);await frame().waitForTimeout(50);
 assert.match(await shadow(`return q('#status').textContent;`),/^Demo:/);assert.equal(page.frames().length,2);
 await shadow(`q('#review').click();`);await frame().waitForTimeout(200);
 await shadow(`q('#move-trash').click();`);
 await frame().waitForFunction(()=>!document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('trash-done').hidden,null,{timeout:10000});
 const done=await shadow(`return {status:q('.trash-review-status').textContent||q('#status').textContent,link:q('#open-trash').hidden,demo:q('.trash-done-demo').hidden,stats:q('#stats').textContent};`);
 assert.match(done.status,/Demo: nothing was deleted/);assert.equal(done.link,true);assert.equal(done.demo,false);assert.match(done.stats,/^12 to review/);
 assert.deepEqual(await frame().evaluate(async()=>(await indexedDB.databases()).map(entry=>entry.name)),[],'demo progress never reaches IndexedDB');
 await page.evaluate(()=>{window.events=[];document.getElementById('demo').contentWindow.postMessage({type:'photos-swipe-demo',command:'reset'},'*');});
 await ready();
 assert.equal(await shadow(`return q('.trash-badge').hidden;`),true);
 assert.deepEqual(outside,[]);
});

test('a demo that loads while its page is hidden opens once the page becomes visible',{timeout:30000},async t=>{
 if(!chromium){t.skip('Playwright is unavailable');return;}
 const directory=await buildDemo(t);
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const types={'.html':'text/html','.js':'text/javascript','.svg':'image/svg+xml','.mp4':'video/mp4'};
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname!=='demo.test')return route.abort();
  const path=url.pathname.replace(/^\/photos-swipe\/demo\//,'')||'index.html';
  try{return route.fulfill({body:await readFile(join(directory,path)),contentType:types[extname(path)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
 });
 await page.addInitScript(()=>{let hidden=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>hidden?'hidden':'visible'});window.showPage=()=>{hidden=false;document.dispatchEvent(new Event('visibilitychange'));};});
 await page.goto('https://demo.test/photos-swipe/demo/?embed=1');
 const overlayHidden=()=>page.evaluate(()=>document.getElementById('photos-swipe-userscript-host')?.shadowRoot.getElementById('overlay').hidden);
 await page.waitForTimeout(400);
 assert.equal(await overlayHidden(),true);
 await page.evaluate(()=>window.showPage());
 await page.waitForFunction(()=>document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('overlay').hidden===false,null,{timeout:10000});
 await page.waitForFunction(()=>/to review/.test(document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('stats').textContent||''),null,{timeout:15000});
});

test('the userscript still refuses to mount off photos.google.com unless the environment is a demo',{timeout:30000},async t=>{
 if(!chromium){t.skip('Playwright is unavailable');return;}
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage();
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='photos-swipe.test'?route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}):route.abort());
 await page.goto('https://photos-swipe.test/');
 await page.evaluate(()=>{window.WIZ_global_data={SNlM0e:'synthetic-token',oPEP7c:'synthetic@example.test'};});
 await page.addScriptTag({content:await readFile(new URL('../userscript/photoswiper-app.user.js',import.meta.url),'utf8')});
 assert.equal(await page.evaluate(()=>!!document.getElementById('photos-swipe-userscript-host')),false);
 const source=await readFile(new URL('../userscript/photoswiper-app.user.js',import.meta.url),'utf8');
 assert.doesNotMatch(source.slice(source.indexOf('const environment={version')),/demo/);
});

test('Settings shows review stats and charts with text alternatives, and no media IDs',{timeout:60000},async t=>{
 if(!chromium){t.skip('Playwright is unavailable');return;}
 const directory=await buildDemo(t);
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const types={'.html':'text/html','.js':'text/javascript','.svg':'image/svg+xml','.mp4':'video/mp4'};
 for(const [width,height,colorScheme] of [[390,844,'dark'],[1440,900,'light']]){
  const page=await browser.newPage({viewport:{width,height},colorScheme});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.hostname!=='demo.test')return route.abort();const path=url.pathname.slice(1)||'index.html';try{return route.fulfill({body:await readFile(join(directory,path)),contentType:types[extname(path)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}});
  await page.goto('https://demo.test/');
  const shadow=code=>page.evaluate(source=>Function('const root=document.getElementById("photos-swipe-userscript-host").shadowRoot;const q=s=>root.querySelector(s);'+source)(),code);
  await page.waitForFunction(()=>/^14 to review/.test(document.getElementById('photos-swipe-userscript-host')?.shadowRoot.getElementById('stats')?.textContent||''),null,{timeout:15000});
  assert.equal(await shadow(`return q('#stats-body').childElementCount;`),0);
  const read=()=>shadow(`const group=q('#stats-group'),tiles=[...q('#stats-tiles').children].map(tile=>tile.getBoundingClientRect());return {text:group.innerText,all:group.textContent,heading:group.querySelector('h2').textContent,tiles:[...q('#stats-tiles').children].map(tile=>tile.querySelector('.stats-value').textContent),rows:new Set(tiles.map(rect=>Math.round(rect.top))).size,plots:[...group.querySelectorAll('svg.stats-plot')].map(svg=>({role:svg.getAttribute('role'),label:svg.getAttribute('aria-label'),width:svg.getBoundingClientRect().width,bars:svg.querySelectorAll('.stats-keep,.stats-trash').length})),tables:group.querySelectorAll('table.stats-sr').length,legacy:!!(q('#history-details')||q('#history-list')||q('#lifetime-freed')),groups:[...root.querySelectorAll('#settings-sheet .group h2')].map(h=>h.textContent),today:[...[...group.querySelectorAll('#stats-reviews table tr')].at(-1).children].map(cell=>cell.textContent)};`);
  await shadow(`q('#settings').click();`);await page.waitForTimeout(400);
  const before=await read();
  assert.equal(before.heading,'Stats');assert.equal(before.legacy,false);
  assert.ok(!before.groups.includes('History')&&!before.groups.includes('Lifetime freed'));
  assert.match(before.text,/Reviewed[\s\S]*Kept vs Trash[\s\S]*Storage freed[\s\S]*Going to Trash[\s\S]*Reviews per day[\s\S]*Storage/);
  assert.doesNotMatch(before.all,/AF1Qip|demo-past|IMG_\d|→|Unavailable for Undo|ID:/);
  assert.equal(before.rows,width<600?2:1);
  assert.equal(before.plots.length,2);assert.equal(before.tables,2);
  for(const plot of before.plots){assert.equal(plot.role,'img');assert.match(plot.label,/last 30 days/);assert.ok(plot.width>200);}
  assert.ok(before.plots[0].bars>10,'the demo shows past activity on first open');
  assert.ok(Number(before.tiles[0])>=100);assert.equal(before.tiles[3],'0');
  await shadow(`q('.settings-header button').click();`);await page.waitForTimeout(200);
  for(let index=0;index<2;index++){await shadow(`q('#remove').click();`);await page.waitForTimeout(200);}
  await shadow(`q('#keep').click();`);await page.waitForTimeout(200);
  assert.equal(await shadow(`return q('#stats-tiles .stats-value').textContent;`),before.tiles[0],'swipes do not rebuild the hidden stats');
  await shadow(`q('#settings').click();`);await page.waitForTimeout(400);
  const after=await read();
  assert.equal(Number(after.tiles[0]),Number(before.tiles[0])+3);assert.equal(after.tiles[3],'2');
  assert.deepEqual(after.today.slice(1),['1','2']);
  assert.deepEqual(errors,[]);
  await page.close();
 }
});
