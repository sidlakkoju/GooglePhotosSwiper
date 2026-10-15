import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {emptyReview} from '../lib/userscript-core.mjs';

const envelope=(id,data)=>`)]}'\n\n123\n${JSON.stringify([['wrb.fr','unrelated','[]'],['wrb.fr',id,JSON.stringify(data)]])}\n`;

test('a full-quality video that runs out of data after the swap falls back to 720p and keeps playing',{timeout:120000},async t=>{
 let chromium;
 try{({chromium}=await import('playwright'));}catch{t.skip('Playwright is unavailable');return;}
 let browser;
 try{browser=await chromium.launch({headless:true});}catch(error){t.skip(`Chromium is unavailable: ${error.message.split('\n')[0]}`);return;}
 let release;const held=new Promise(resolve=>{release=resolve;});
 t.after(async()=>{release();await browser.close();});
 const video=await readFile(new URL('fixtures/synthetic-video.webm',import.meta.url)),poster=await readFile(new URL('fixtures/synthetic-video-poster.png',import.meta.url));
 const cut=Math.floor(video.length*.3),requests=[];
 const page=await browser.newPage({viewport:{width:1280,height:800}});
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname==='photos-swipe.test')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'});
  if(url.hostname==='photos.google.com'&&url.pathname.endsWith('/data/batchexecute')){
   const request=JSON.parse(new URLSearchParams(route.request().postData()).get('f.req'))[0][0];
   if(request[0]==='VrseUb')return route.fulfill({contentType:'text/plain',body:envelope('VrseUb',[[JSON.parse(request[1])[0],null],'https://lh3.googleusercontent.com/clip-video=dv'])});
   return route.fulfill({status:500,body:''});
  }
  if(url.hostname==='lh3.googleusercontent.com'&&url.pathname.startsWith('/clip-video')){
   const range=/bytes=(\d+)-(\d*)/.exec(route.request().headers().range||''),start=range?+range[1]:0,full=url.pathname.endsWith('=dv');
   requests.push(`${url.pathname.slice(11)} ${start}`);
   if(full&&start>=cut){await held;return route.abort().catch(()=>{});}
   const end=Math.min(range?.[2]?+range[2]:video.length-1,full?cut-1:video.length-1);
   return route.fulfill({status:206,contentType:'video/webm',headers:{'accept-ranges':'bytes','content-range':`bytes ${start}-${end}/${video.length}`},body:video.subarray(start,end+1)}).catch(()=>{});
  }
  if(url.hostname==='lh3.googleusercontent.com')return route.fulfill({contentType:'image/png',body:poster});
  return route.abort();
 });
 await page.goto('https://photos-swipe.test');
 const items=[{mediaKey:'clip',name:'clip.webm',type:'video',date:'2024-01-01T00:00:00.000Z',thumbUrl:'https://lh3.googleusercontent.com/clip-poster',urlFetchedAt:Date.now(),state:'active',decision:null,revision:0},{mediaKey:'last',name:'last.jpg',type:'photo',date:'2023-12-31T00:00:00.000Z',thumbUrl:'https://lh3.googleusercontent.com/last',urlFetchedAt:Date.now(),state:'active',decision:null,revision:0}];
 await page.evaluate(async review=>{
  window.WIZ_global_data={SNlM0e:'synthetic-token',oPEP7c:'synthetic@example.test',eptZe:'/_/PhotosUi/u/0/'};
  const account=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(window.WIZ_global_data.oPEP7c))),byte=>byte.toString(16).padStart(2,'0')).join('');
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('photos-swipe-userscript',2);request.onupgradeneeded=()=>{for(const name of ['accounts','leases','settings'])request.result.createObjectStore(name);};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  await new Promise((resolve,reject)=>{const tx=db.transaction(['accounts','settings'],'readwrite');tx.objectStore('accounts').put(review,account);tx.objectStore('settings').put({onboardingDismissed:true},'sync');tx.objectStore('settings').put({sort:'original'},'resume:'+account);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
 },{...emptyReview(),revision:1,started:true,exhausted:true,swipeCount:3,items});
 const source=(await readFile(new URL('../userscript/photoswiper-app.user.js',import.meta.url),'utf8')).replace('document,location,GM:',"document,location:{origin:'https://photos.google.com',pathname:'/u/0/'},GM:");
 await page.addScriptTag({content:source});
 await page.evaluate(()=>document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('launcher').onclick());
 const shown=()=>page.evaluate(()=>{const video=document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('media')?.querySelector('video:not([hidden])');return video&&video.style.opacity===''?{src:video.currentSrc.replace(/^.*clip-video/,''),time:video.currentTime,paused:video.paused}:null;});
 await page.waitForFunction(()=>document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('media')?.querySelector('video:not([hidden])')?.currentSrc.endsWith('=dv'),null,{timeout:20000});
 let frozen=null,firstShown=null,stuckSince=0,last=-1;
 for(const started=Date.now();Date.now()-started<20000;await page.waitForTimeout(100)){
  const state=await shown();
  if(state?.src==='=m22'){frozen=last;firstShown=state.time;break;}
  if(state&&state.time!==last){last=state.time;stuckSince=Date.now();}
 }
 assert.ok(requests.some(request=>request.startsWith('=dv ')&&+request.split(' ')[1]>=cut),'the full-quality download ran out and asked for the rest');
 assert.notEqual(frozen,null,'the video fell back to 720p');
 assert.ok(firstShown>=frozen-.25,`the first 720p picture is at ${firstShown} s, not where the video froze (${frozen} s)`);
 const stuckFor=Date.now()-stuckSince;
 assert.ok(stuckFor<5000,`frozen for ${stuckFor} ms before falling back`);
 await page.waitForFunction(time=>{const video=document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('media').querySelector('video:not([hidden])');return video.currentSrc.endsWith('=m22')&&!video.paused&&video.currentTime>time+.5;},frozen,{timeout:10000});
 assert.ok((await shown()).time>=frozen,'720p continues from where the full-quality video stopped');
});
