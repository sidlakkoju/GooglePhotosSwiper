import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,extname} from 'node:path';
import {spawnSync} from 'node:child_process';

let chromium;
try{({chromium}=await import('playwright'));}catch{}

const audit=()=>{
 const sr=document.getElementById('photos-swipe-userscript-host').shadowRoot;
 const name=e=>e.tagName.toLowerCase()+(e.id?'#'+e.id:e.classList.length?'.'+[...e.classList].slice(0,2).join('.'):'');
 const shown=e=>{const r=e.getBoundingClientRect();if(r.width<1||r.height<1)return false;for(let x=e;x&&x.nodeType===1;x=x.parentElement){const cs=getComputedStyle(x);if(cs.display==='none'||cs.visibility==='hidden'||+cs.opacity===0)return false;}return true;};
 const visible=e=>{const cs=getComputedStyle(e);return cs.backgroundColor!=='rgba(0, 0, 0, 0)'||cs.backgroundImage!=='none'||(cs.boxShadow!=='none'&&/inset/.test(cs.boxShadow))||parseFloat(cs.borderTopWidth)>0||(cs.backdropFilter&&cs.backdropFilter!=='none');};
 const radius=(e,corner)=>{const r=e.getBoundingClientRect();return Math.min(parseFloat(getComputedStyle(e)['border'+corner+'Radius'])||0,r.height/2,r.width/2);};
 const clipped=(e,a)=>{for(let x=e.parentElement;x;x=x.parentElement){if(getComputedStyle(x).overflow!=='visible')return true;if(x===a)break;}return false;};
 const elements=[...sr.querySelectorAll('*')].filter(e=>shown(e)&&visible(e));
 const corners=[],gaps=[],overlaps=[];
 for(const e of elements){
  if(e.tagName==='INPUT')continue;
  let a=e.parentElement;
  while(a&&!(visible(a)&&shown(a)&&['TopLeft','TopRight','BottomLeft','BottomRight'].some(c=>radius(a,c)>0)))a=a.parentElement;
  if(!a)continue;
  const er=e.getBoundingClientRect(),ar=a.getBoundingClientRect();
  for(const [corner,dx,dy] of [['TopLeft',er.left-ar.left,er.top-ar.top],['TopRight',ar.right-er.right,er.top-ar.top],['BottomLeft',er.left-ar.left,ar.bottom-er.bottom],['BottomRight',ar.right-er.right,ar.bottom-er.bottom]]){
   const R=radius(a,corner),r=radius(e,corner);
   if(R<=0||dx<0||dy<0||dx>=R||dy>=R)continue;
   if(dx<1.5&&dy<1.5&&clipped(e,a))continue;
   const want=Math.max(0,R-Math.max(dx,dy));
   if(Math.abs(r-want)>2.5||Math.abs(dx-dy)>3)corners.push(`${name(e)} in ${name(a)} ${corner}: r=${r.toFixed(1)} want=${want.toFixed(1)} inset=${dx.toFixed(1)}/${dy.toFixed(1)}`);
  }
 }
 for(const p of new Set(elements.map(e=>e.parentElement))){
  if(!p)continue;
  const kids=[...p.children].filter(k=>shown(k)&&visible(k)&&!['absolute','fixed'].includes(getComputedStyle(k).position));
  for(let i=1;i<kids.length;i++){
   const a=kids[i-1].getBoundingClientRect(),b=kids[i].getBoundingClientRect(),row=b.top<a.bottom-2&&a.top<b.bottom-2,gap=row?b.left-a.right:b.top-a.bottom;
   if(gap<6&&gap>-40&&!kids[i-1].classList.contains('trash-size'))gaps.push(`${name(kids[i-1])} | ${name(kids[i])}: ${gap.toFixed(1)}`);
  }
 }
 const targets=[];
 for(const e of sr.querySelectorAll('button,a[href],select,input,summary,[role=button]')){
  if(!shown(e)||e.closest('[aria-hidden=true]')||e.disabled)continue;
  const r=(e.closest('label')||e).getBoundingClientRect(),b=getComputedStyle(e,'::before'),hit=b.content!=='none'&&b.position==='absolute'?{w:r.width-(parseFloat(b.left)||0)-(parseFloat(b.right)||0),h:r.height-(parseFloat(b.top)||0)-(parseFloat(b.bottom)||0)}:{w:r.width,h:r.height};
  const cover=e.tagName==='INPUT'&&e.style.opacity==='0';
  if(!cover&&Math.min(hit.w,hit.h)<43.5)targets.push(`${name(e)} ${e.getAttribute('aria-label')||e.textContent.trim().slice(0,24)}: ${hit.w.toFixed(0)}x${hit.h.toFixed(0)}`);
 }
 const header=[...sr.querySelector('.content > header').children].filter(shown);
 for(let i=0;i<header.length;i++)for(let j=i+1;j<header.length;j++){const a=header[i].getBoundingClientRect(),b=header[j].getBoundingClientRect();if(a.width>2&&b.width>2&&a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1)overlaps.push(`${name(header[i])} overlaps ${name(header[j])}`);}
 return {corners,gaps,overlaps,targets};
};

test('every view keeps concentric corners, real gaps and a header without overlaps at phone, tablet and desktop sizes',{timeout:120000},async t=>{
 if(!chromium){t.skip('Playwright is unavailable');return;}
 const directory=await mkdtemp(join(tmpdir(),'photos-swipe-audit-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const built=spawnSync(process.execPath,['scripts/build-demo.mjs',directory],{encoding:'utf8'});
 assert.equal(built.status,0,built.stderr);
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const types={'.html':'text/html','.js':'text/javascript','.svg':'image/svg+xml','.mp4':'video/mp4'};
 for(const [width,height] of [[390,844],[768,1024],[1440,900]])for(const colorScheme of ['dark','light']){
  const page=await browser.newPage({viewport:{width,height},colorScheme});
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.hostname!=='demo.test')return route.abort();const path=url.pathname.slice(1)||'index.html';try{return route.fulfill({body:await readFile(join(directory,path)),contentType:types[extname(path)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}});
  await page.goto('https://demo.test/');
  await page.waitForFunction(()=>/to review/.test(document.getElementById('photos-swipe-userscript-host')?.shadowRoot.getElementById('stats')?.textContent||''),null,{timeout:15000});
  const click=selector=>page.evaluate(s=>document.getElementById('photos-swipe-userscript-host').shadowRoot.querySelector(s).click(),selector);
  await page.evaluate(()=>{document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('close').hidden=false;});
  await page.waitForTimeout(300);
  const views={swipe:await page.evaluate(audit)};
  await click('#settings');await page.waitForTimeout(600);
  views.settings=await page.evaluate(audit);
  await click('.settings-header button');await page.waitForTimeout(300);
  for(let i=0;i<3;i++){await click('#remove');await page.waitForTimeout(200);}
  await click('#review');await page.waitForTimeout(700);
  views.trash=await page.evaluate(audit);
  await click('.trash-photo');await page.waitForTimeout(500);
  views.preview=await page.evaluate(audit);
  await click('.trash-preview .trash-nav button');await page.waitForTimeout(300);
  await click('#move-trash');await page.waitForTimeout(1200);
  views.done=await page.evaluate(audit);
  await click('#keep-swiping');await page.waitForTimeout(400);
  await page.evaluate(()=>document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('order-switcher').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true})));await page.waitForTimeout(300);
  views.order=await page.evaluate(audit);
  for(const [view,result] of Object.entries(views))assert.deepEqual(result,{corners:[],gaps:[],overlaps:[],targets:[]},`${view} at ${width}x${height} ${colorScheme}`);
  await page.close();
 }
});

const serveDemo=async(t,browser,directory,options)=>{
 const types={'.html':'text/html','.js':'text/javascript','.svg':'image/svg+xml','.mp4':'video/mp4'};
 const page=await browser.newPage(options);
 await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.hostname!=='demo.test')return route.abort();const path=url.pathname.slice(1)||'index.html';try{return route.fulfill({body:await readFile(join(directory,path)),contentType:types[extname(path)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}});
 await page.goto('https://demo.test/');
 await page.waitForFunction(()=>/to review/.test(document.getElementById('photos-swipe-userscript-host')?.shadowRoot.getElementById('stats')?.textContent||''),null,{timeout:15000});
 return page;
};
const inShadow=(page,code)=>page.evaluate(source=>Function('const root=document.getElementById("photos-swipe-userscript-host").shadowRoot;const q=s=>root.querySelector(s);const box=s=>{const r=q(s).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};};const ring=()=>{const e=root.activeElement;return e?getComputedStyle(e).outlineStyle:"none";};'+source)(),code);

for(const engine of ['chromium','webkit'])test(`focus rings follow the keyboard and the scrolled Settings header stays legible (${engine})`,{timeout:120000},async t=>{
 let playwright;try{playwright=await import('playwright');}catch{t.skip('Playwright is unavailable');return;}
 let browser;try{browser=await playwright[engine].launch({headless:true});}catch(error){t.skip(`${engine} is unavailable: ${error.message.split('\n')[0]}`);return;}
 t.after(()=>browser.close());
 const directory=await mkdtemp(join(tmpdir(),'photos-swipe-focus-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const built=spawnSync(process.execPath,['scripts/build-demo.mjs',directory],{encoding:'utf8'});
 assert.equal(built.status,0,built.stderr);
 for(const colorScheme of ['dark','light']){
  const page=await serveDemo(t,browser,directory,{viewport:{width:390,height:844},colorScheme});
  const gear=await inShadow(page,`return box('#settings');`);
  await page.mouse.click(gear.x,gear.y);await page.waitForTimeout(500);
  assert.equal(await inShadow(page,`return root.activeElement?.textContent;`),'Done');
  assert.equal(await inShadow(page,`return ring();`),'none','Done has no ring after a tap');
  await inShadow(page,`q('#settings-sheet').scrollTop=200;q('#settings-sheet').dispatchEvent(new Event('scroll'));`);await page.waitForTimeout(400);
  const header=await inShadow(page,`const h=q('.settings-header'),c=getComputedStyle(h).backgroundColor,a=/rgba?\\(([^)]*)\\)/.exec(c)?.[1].split(',').map(Number)||[];return {scrolled:h.classList.contains('scrolled'),alpha:a.length===4?a[3]:/color\\(/.test(c)?Number(/\\/\\s*([\\d.]+)\\)/.exec(c)?.[1]??1):1,mask:getComputedStyle(h).webkitMaskImage||getComputedStyle(h).maskImage};`);
  assert.equal(header.scrolled,true);assert.ok(header.alpha>=.9,`header fill alpha ${header.alpha}`);assert.match(header.mask,/gradient/,'the header edge fades');
  await page.keyboard.press('Tab');await page.waitForTimeout(100);
  assert.equal(await inShadow(page,`return ring();`),'solid','Tab shows the ring');
  await page.keyboard.press('Escape');await page.waitForTimeout(300);
  for(let i=0;i<2;i++){const remove=await inShadow(page,`return box('#remove');`);await page.mouse.click(remove.x,remove.y);await page.waitForTimeout(500);}
  const review=await inShadow(page,`return box('#review');`);await page.mouse.click(review.x,review.y);await page.waitForTimeout(500);
  assert.equal(await inShadow(page,`return root.activeElement?.id;`),'move-trash');
  assert.equal(await inShadow(page,`return ring();`),'none','Move to Trash has no ring after a tap');
  await page.close();
 }
});

test('the real app adds a close button, the sync card and a share sheet that keep the same corners, gaps and targets',{timeout:120000},async t=>{
 if(!chromium){t.skip('Playwright is unavailable');return;}
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const {emptyReview}=await import('../lib/userscript-core.mjs');
 const source=(await readFile(new URL('../userscript/photoswiper-app.user.js',import.meta.url),'utf8')).replace('document,location,GM:',"document,location:{origin:'https://photos.google.com',pathname:'/u/0/'},GM:");
 const items=Array.from({length:4},(_,index)=>({mediaKey:`synthetic-${index}`,name:`synthetic-${index}.jpg`,date:new Date(2024,9,19,index).toISOString(),size:2e6,thumbUrl:`https://lh3.googleusercontent.com/synthetic-${index}`,type:'photo',state:'active',decision:null,revision:0,urlFetchedAt:Date.now(),locationName:'Yosemite Valley, CA'}));
 for(const [width,height] of [[390,844],[1440,900]])for(const colorScheme of ['dark','light']){
  const page=await browser.newPage({viewport:{width,height},colorScheme});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='photos-swipe.test')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'});if(url.hostname==='lh3.googleusercontent.com')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><rect width="900" height="1200" fill="#7ab"/></svg>'});return route.abort();});
  await page.goto('https://photos-swipe.test');
  await page.evaluate(async review=>{
   window.WIZ_global_data={SNlM0e:'synthetic-token',oPEP7c:'synthetic@example.test',eptZe:'/_/PhotosUi/u/0/'};
   const account=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(window.WIZ_global_data.oPEP7c))),byte=>byte.toString(16).padStart(2,'0')).join('');
   const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('photos-swipe-userscript',2);request.onupgradeneeded=()=>{for(const name of ['accounts','leases','settings'])request.result.createObjectStore(name);};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
   await new Promise((resolve,reject)=>{const tx=db.transaction(['accounts','settings'],'readwrite');tx.objectStore('accounts').put(review,account);tx.objectStore('settings').put({},'sync');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
  },{...emptyReview(),revision:1,started:true,exhausted:true,items});
  await page.addScriptTag({content:source});
  await page.evaluate(()=>document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('launcher').onclick());
  await page.waitForFunction(()=>document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('overlay').getAttribute('aria-busy')==='false');
  await page.waitForTimeout(600);
  const views={onboarding:await page.evaluate(audit)};
  assert.equal(await inShadow(page,`return q('#pair-onboarding').hidden||!q('#close').getClientRects().length;`),false);
  await inShadow(page,`q('#share').click();`);await page.waitForTimeout(500);
  views.share=await page.evaluate(audit);
  for(const [view,result] of Object.entries(views))assert.deepEqual(result,{corners:[],gaps:[],overlaps:[],targets:[]},`${view} at ${width}x${height} ${colorScheme}`);
  await page.close();
 }
});
