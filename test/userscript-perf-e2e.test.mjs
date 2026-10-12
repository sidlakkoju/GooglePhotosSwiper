import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {emptyReview} from '../lib/userscript-core.mjs';
test('buffered photos paint below 100ms p95 over twenty Fast 3G swipes',{timeout:60000},async t=>{
 let chromium;
 try{({chromium}=await import('playwright'));}catch{t.skip('Playwright is unavailable');return;}
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:400,height:800},deviceScaleFactor:2});
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname==='photos-swipe.test')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'});
   if(url.hostname==='lh3.googleusercontent.com'){
    await new Promise(resolve=>setTimeout(resolve,150));
    return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="768" height="768"><rect width="768" height="768" fill="green"/></svg>'});
   }
   await route.abort();throw Error(`Unexpected synthetic request: ${url.origin}`);
  });
  await page.goto('https://photos-swipe.test');
  const session=await page.context().newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:1.6*1024*1024/8,uploadThroughput:750*1024/8});
  const state={...emptyReview(),revision:1,items:Array.from({length:24},(_,index)=>({mediaKey:`synthetic-${index}`,name:`synthetic-${index}`,thumbUrl:`https://lh3.googleusercontent.com/synthetic-${index}`,type:'photo',state:'active',decision:null,revision:0}))};
  await page.evaluate(async state=>{
   window.WIZ_global_data={SNlM0e:'synthetic-token',oPEP7c:'synthetic@example.test',eptZe:'/_/PhotosUi/u/0/'};
   const account=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(window.WIZ_global_data.oPEP7c))),byte=>byte.toString(16).padStart(2,'0')).join('');
   const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('photos-swipe-userscript',2);request.onupgradeneeded=()=>{for(const name of ['accounts','leases','settings'])request.result.createObjectStore(name);};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
   await new Promise((resolve,reject)=>{const tx=db.transaction('accounts','readwrite');tx.objectStore('accounts').put(state,account);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
  },state);
  const source=(await readFile(new URL('../userscript/photoswiper-app.user.js',import.meta.url),'utf8')).replace('mountPhotosSwipe({window,document,location,fetch:',"mountPhotosSwipe({window,document,location:{origin:'https://photos.google.com',pathname:'/u/0/'},fetch:");
  await page.addScriptTag({content:source});
  await page.evaluate(()=>document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('launcher').onclick());
  await page.waitForFunction(()=>{const image=document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('media').querySelector('img');return image?.complete&&image.naturalWidth;});
  await page.waitForTimeout(1000);
  for(let index=0;index<20;index++){await page.keyboard.press('ArrowRight');await page.waitForTimeout(1000);}
  const durations=await page.evaluate(()=>{
   const swipes=performance.getEntriesByName('swipe'),paints=performance.getEntriesByName('painted');
   return paints.map(paint=>paint.startTime-swipes.filter(swipe=>swipe.startTime<=paint.startTime).at(-1).startTime);
  });
  assert.equal(durations.length,20);
  const sorted=durations.slice(3).sort((a,b)=>a-b);
  assert.ok(sorted[Math.floor(sorted.length*.95)]<100,JSON.stringify(sorted));
  const current=await page.evaluate(()=>document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('media').querySelector('img').naturalWidth);
  assert.ok(current>0);
 }finally{await browser.close();}
});
