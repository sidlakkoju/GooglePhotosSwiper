import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {emptyReview} from '../lib/userscript-core.mjs';
import {fulfillVideo} from './fixtures/video-route.mjs';

const envelope=(id,data)=>`)]}'\n\n123\n${JSON.stringify([['wrb.fr','unrelated','[]'],['wrb.fr',id,JSON.stringify(data)]])}\n`;

for(const device of [{name:'desktop',viewport:{width:1280,height:800},small:'=m22',full:'=dv'},{name:'phone',viewport:{width:390,height:844},isMobile:true,hasTouch:true,small:'=m18',full:'=m22'}])test(`a preloaded ${device.name} video switches up to full quality after it is shown`,{timeout:120000},async t=>{
 let chromium;
 try{({chromium}=await import('playwright'));}catch{t.skip('Playwright is unavailable');return;}
 let browser;
 try{browser=await chromium.launch({headless:true});}catch(error){t.skip(`Chromium is unavailable: ${error.message.split('\n')[0]}`);return;}
 t.after(()=>browser.close());
 const video=await readFile(new URL('fixtures/synthetic-video.webm',import.meta.url)),poster=await readFile(new URL('fixtures/synthetic-video-poster.png',import.meta.url));
 const requests=[];
 const page=await browser.newPage({viewport:device.viewport,isMobile:!!device.isMobile,hasTouch:!!device.hasTouch});
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname==='photos-swipe.test')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'});
  if(url.hostname==='photos.google.com'&&url.pathname.endsWith('/data/batchexecute')){
   const request=JSON.parse(new URLSearchParams(route.request().postData()).get('f.req'))[0][0];
   if(request[0]==='VrseUb')return route.fulfill({contentType:'text/plain',body:envelope('VrseUb',[[JSON.parse(request[1])[0],null],'https://lh3.googleusercontent.com/clip-video=dv'])});
   return route.fulfill({status:500,body:''});
  }
  if(url.hostname==='lh3.googleusercontent.com'&&url.pathname.startsWith('/clip-video')){requests.push(url.pathname);return fulfillVideo(route,video,'video/webm');}
  if(url.hostname==='lh3.googleusercontent.com')return route.fulfill({contentType:'image/png',body:poster});
  return route.abort();
 });
 await page.goto('https://photos-swipe.test');
 const items=[{mediaKey:'first',name:'first.jpg',type:'photo',date:'2024-01-02T00:00:00.000Z',thumbUrl:'https://lh3.googleusercontent.com/first',urlFetchedAt:Date.now(),state:'active',decision:null,revision:0},{mediaKey:'clip',name:'clip.webm',type:'video',date:'2024-01-01T00:00:00.000Z',thumbUrl:'https://lh3.googleusercontent.com/clip-poster',urlFetchedAt:Date.now(),state:'active',decision:null,revision:0},{mediaKey:'last',name:'last.jpg',type:'photo',date:'2023-12-31T00:00:00.000Z',thumbUrl:'https://lh3.googleusercontent.com/last',urlFetchedAt:Date.now(),state:'active',decision:null,revision:0}];
 await page.evaluate(async review=>{
  window.WIZ_global_data={SNlM0e:'synthetic-token',oPEP7c:'synthetic@example.test',eptZe:'/_/PhotosUi/u/0/'};
  const account=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(window.WIZ_global_data.oPEP7c))),byte=>byte.toString(16).padStart(2,'0')).join('');
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('photos-swipe-userscript',2);request.onupgradeneeded=()=>{for(const name of ['accounts','leases','settings'])request.result.createObjectStore(name);};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  await new Promise((resolve,reject)=>{const tx=db.transaction(['accounts','settings'],'readwrite');tx.objectStore('accounts').put(review,account);tx.objectStore('settings').put({onboardingDismissed:true},'sync');tx.objectStore('settings').put({sort:'original'},'resume:'+account);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
 },{...emptyReview(),revision:1,started:true,exhausted:true,swipeCount:3,items});
 const source=(await readFile(new URL('../userscript/photoswiper-app.user.js',import.meta.url),'utf8')).replace('document,location,GM:',"document,location:{origin:'https://photos.google.com',pathname:'/u/0/'},GM:");
 await page.evaluate(()=>{window.videosCreated=[];const create=document.createElement.bind(document);document.createElement=(tag,...rest)=>{const element=create(tag,...rest);if(String(tag).toLowerCase()==='video')window.videosCreated.push(element);return element;};});
 await page.addScriptTag({content:source});
 await page.evaluate(()=>document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('launcher').onclick());
 await page.waitForFunction(()=>document.getElementById('photos-swipe-userscript-host')?.shadowRoot.getElementById('caption').textContent.startsWith('first.jpg'));
 for(let count=0;count<200&&!requests.length;count++)await page.waitForTimeout(50);
 assert.deepEqual([...new Set(requests)],[`/clip-video${device.small}`],'next video is preloaded at the smaller quality');
 await page.waitForTimeout(500);
 await page.keyboard.press('ArrowRight');
 await page.waitForFunction(()=>document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('caption').textContent.startsWith('clip.webm'));
 await page.waitForFunction(full=>{const video=document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('media').querySelector('video');return !!video&&video.currentSrc.includes(full)&&!video.paused&&video.style.opacity==='';},device.full,{timeout:20000});
 
 assert.ok(requests.includes(`/clip-video${device.full}`),'full quality is requested');
 assert.equal(await page.evaluate(()=>window.videosCreated.filter(video=>video.playsInline).length),2,'the preloaded video is shown, then replaced once by the full-quality one; spare elements prepared during key presses never play');
 const shown=await page.evaluate(()=>{const videos=[...document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('media').querySelectorAll('video')];return {count:videos.length,time:videos[0].currentTime,hidden:videos[0].hidden};});
 assert.equal(shown.count,1);assert.equal(shown.hidden,false);assert.ok(shown.time>0);
});
