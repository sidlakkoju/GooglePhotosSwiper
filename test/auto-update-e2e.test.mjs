import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {emptyReview} from '../lib/userscript-core.mjs';

const nonce='synthetic-nonce-value';
const csp=`require-trusted-types-for 'script'; script-src 'report-sample' 'nonce-${nonce}' 'unsafe-inline' 'unsafe-eval' 'strict-dynamic' https: http:; object-src 'none'; base-uri 'self'`;
const page=`<!doctype html><html><head><script nonce="${nonce}">window.WIZ_global_data={SNlM0e:'synthetic-token',oPEP7c:'synthetic@example.test',eptZe:'/_/PhotosUi/u/0/'};</script></head><body></body></html>`;
const gmShim=`(()=>{
 window.GM={
  getValue:(key,fallback)=>window.__gmGet(key).then(value=>value===null?fallback:JSON.parse(value)),
  setValue:(key,value)=>window.__gmSet(key,JSON.stringify(value)),
  deleteValue:key=>window.__gmSet(key,null),
  xmlHttpRequest(options){
   fetch(options.url,{method:options.method||'GET',headers:options.headers,body:options.data}).then(async response=>{
    const responseText=await response.text();
    options.onload?.({status:response.status,responseText,responseHeaders:[...response.headers].map(([key,value])=>key+': '+value).join('\\r\\n')});
   },()=>options.onerror?.());
   return {abort(){}};
  }
 };
})();`;

for(const engine of ['webkit','chromium'])test(`${engine}: stub installs, reuses its cache and reloads into a new release when opened`,{timeout:240000},async t=>{
 let playwright;
 try{playwright=await import('playwright');}catch{t.skip('Playwright is unavailable');return;}
 let browser;
 try{browser=await playwright[engine].launch({headless:true});}catch(error){t.skip(`${engine} is unavailable: ${error.message.split('\n')[0]}`);return;}
 let stage='launch',diagnose=async()=>'';
 try{
  const appSource=await readFile(new URL('../userscript/photoswiper-app.user.js',import.meta.url),'utf8');
  const appCode=appSource.slice(appSource.indexOf('// ==/UserScript==')+'// ==/UserScript=='.length).trimStart();
  const stub=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8');
  let liveVersion='1.2.76';
  const requests=[],store=new Map();
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  await context.exposeBinding('__gmGet',(source,key)=>store.has(key)?store.get(key):null);
  await context.exposeBinding('__gmSet',(source,key,value)=>{if(value===null)store.delete(key);else store.set(key,value);});
  await context.addInitScript({content:gmShim+`\nwindow.addEventListener('load',()=>{${stub}});`});
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname==='photos.google.com'&&url.pathname==='/')return route.fulfill({contentType:'text/html',headers:{'Content-Security-Policy':csp},body:page});
   if(url.hostname==='photoswiper-sync.sidlakkoju.workers.dev'){
    requests.push(url.pathname);
    const headers={'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'X-Photoswiper-Version, X-Photoswiper-Required-Loader-Version','Cache-Control':'no-store','X-Photoswiper-Version':liveVersion,'X-Photoswiper-Required-Loader-Version':'1.0.0'};
    if(url.pathname==='/version')return route.fulfill({contentType:'application/json',headers,body:JSON.stringify({version:liveVersion,requiredLoaderVersion:'1.0.0'})});
    if(url.pathname==='/app.js')return route.fulfill({contentType:'text/javascript',headers,body:appCode});
    if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,contentType:'application/json',headers,body:'{"error":"Unauthorized"}'});
   }
   return route.fulfill({status:404,body:''});
  });
  const tab=await context.newPage();
  tab.setDefaultTimeout(90000);
  const errors=[];tab.on('pageerror',error=>errors.push(error.message));
  stage='step 1: await tab.goto("https://photos.google.com/");';
  await tab.goto('https://photos.google.com/');
  stage='step 2: await tab.evaluate(async state=>{';
  await tab.evaluate(async state=>{
   const account=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(window.WIZ_global_data.oPEP7c))),byte=>byte.toString(16).padStart(2,'0')).join('');
   const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('photos-swipe-userscript',2);request.onupgradeneeded=()=>{for(const name of ['accounts','leases','settings'])request.result.createObjectStore(name);};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
   await new Promise((resolve,reject)=>{const tx=db.transaction('accounts','readwrite');tx.objectStore('accounts').put(state,account);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
  },{...emptyReview(),revision:1,items:[{mediaKey:'synthetic-0',name:'synthetic-0',thumbUrl:'https://lh3.googleusercontent.com/synthetic-0',type:'photo',state:'active',decision:null,revision:0,urlFetchedAt:Date.now()}]});
  diagnose=async()=>JSON.stringify({requests,errors,host:await host().catch(error=>error.message)});
  const host=()=>tab.evaluate(()=>{const root=document.getElementById('photos-swipe-userscript-host')?.shadowRoot;return root?{version:root.getElementById('running-version')?.textContent,overlay:!root.getElementById('overlay').hidden,status:root.getElementById('status')?.textContent||'',banner:!!document.getElementById('photoswiper-update')}:null;});
  stage='step 3: await tab.waitForFunction(()=>document.getElementById("photo';
  await tab.waitForFunction(()=>document.getElementById('photos-swipe-userscript-host'),null,{timeout:90000});
  assert.deepEqual({...await host(),status:undefined},{version:'v1.2.76',overlay:false,status:undefined,banner:false});
  assert.deepEqual(requests,['/version','/app.js']);
  assert.equal(JSON.parse(store.get('photoswiper-app')).version,'1.2.76');

  requests.length=0;
  stage='step 4: await tab.reload();';
  await tab.reload();
  stage='step 5: await tab.waitForFunction(()=>document.getElementById("photo';
  await tab.waitForFunction(()=>document.getElementById('photos-swipe-userscript-host'),null,{timeout:90000});
  assert.equal((await host()).version,'v1.2.76');
  assert.deepEqual(requests,['/version']);

  liveVersion='1.2.77';requests.length=0;
  const navigated=tab.waitForEvent('load',{timeout:90000});
  stage='step 6: await tab.evaluate(()=>document.getElementById("photos-swipe';
  await tab.evaluate(()=>document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('launcher').click());
  stage='step 7: await navigated;';
  await navigated;
  stage='step 8: await tab.waitForFunction(()=>{const root=document.getElemen';
  await tab.waitForFunction(()=>{const root=document.getElementById('photos-swipe-userscript-host')?.shadowRoot;return root&&!root.getElementById('overlay').hidden;},null,{timeout:90000});
  const updated=await host();
  assert.equal(updated.version,'v1.2.77');
  assert.equal(updated.overlay,true);
  assert.equal(updated.banner,false);
  assert.ok(requests.includes('/app.js'));
  assert.equal(requests.filter(path=>path==='/app.js').length,1);
  assert.equal(JSON.parse(store.get('photoswiper-app')).version,'1.2.77');

  requests.length=0;
  stage='step 9: await tab.evaluate(()=>document.getElementById("photos-swipe';
  await tab.evaluate(()=>document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('close').click());
  stage='step 10: await tab.waitForFunction(()=>document.getElementById("photo';
  await tab.waitForFunction(()=>document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('overlay').hidden);
  stage='step 11: await tab.evaluate(()=>document.getElementById("photos-swipe';
  await tab.evaluate(()=>document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('launcher').click());
  stage='step 12: await tab.waitForFunction(()=>!document.getElementById("phot';
  await tab.waitForFunction(()=>!document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('overlay').hidden);
  await tab.waitForTimeout(500);
  assert.equal((await host()).version,'v1.2.77');
  assert.deepEqual(errors,[]);
 }catch(error){console.error(`E2E-STAGE ${engine} ${stage} ${await diagnose()}`);throw error;}finally{await browser.close();}
});
