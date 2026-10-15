import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {emptyReview} from '../lib/userscript-core.mjs';
import {fulfillVideo} from './fixtures/video-route.mjs';

const envelope=(id,data)=>`)]}'\n\n123\n${JSON.stringify([['wrb.fr','unrelated','[]'],['wrb.fr',id,JSON.stringify(data)]])}\n`;

for(const engineName of ['webkit','chromium'])test(`a phone video whose small preload was cancelled retries the small version instead of the original (${engineName})`,{timeout:120000},async t=>{
 let playwright;
 try{playwright=await import('playwright');}catch{t.skip('Playwright is unavailable');return;}
 let browser;
 try{browser=await playwright[engineName].launch({headless:true});}catch(error){t.skip(`${engineName} is unavailable: ${error.message.split('\n')[0]}`);return;}
 t.after(()=>browser.close());
 const video=await readFile(new URL('fixtures/synthetic-video.webm',import.meta.url)),poster=await readFile(new URL('fixtures/synthetic-video-poster.png',import.meta.url));
 const requests=[];let cancelled=0;
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:engineName==='chromium'});
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname==='photos-swipe.test')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'});
  if(url.hostname==='photos.google.com'&&url.pathname.endsWith('/data/batchexecute')){
   const request=JSON.parse(new URLSearchParams(route.request().postData()).get('f.req'))[0][0];
   if(request[0]==='VrseUb')return route.fulfill({contentType:'text/plain',body:envelope('VrseUb',[[JSON.parse(request[1])[0],null],'https://lh3.googleusercontent.com/clip-video=dv'])});
   return route.fulfill({status:500,body:''});
  }
  if(url.hostname==='lh3.googleusercontent.com'&&url.pathname.startsWith('/clip-video')){
   requests.push(url.pathname.split('=').pop());
   if(url.pathname.endsWith('=m18')&&!cancelled++)return route.abort('aborted');
   return fulfillVideo(route,video,'video/webm');
  }
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
 await page.addScriptTag({content:source});
 await page.evaluate(()=>document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('launcher').onclick());
 await page.waitForFunction(()=>document.getElementById('photos-swipe-userscript-host')?.shadowRoot.getElementById('caption').textContent.startsWith('first.jpg'));
 for(let count=0;count<100&&!cancelled;count++)await page.waitForTimeout(50);
 assert.equal(cancelled,1,'the small preload was requested and cancelled');
 await page.waitForTimeout(300);
 await page.evaluate(()=>document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('keep').click());
 await page.waitForFunction(()=>{const shown=document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('media').querySelector('video');return !!shown&&!shown.hidden&&shown.readyState>=2&&shown.currentTime>0;},null,{timeout:15000});
 const playing=await page.evaluate(()=>document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('media').querySelector('video').currentSrc.split('=').pop());
 assert.ok(['m18','m22'].includes(playing),`plays a smaller version, not ${playing}`);
 assert.ok(requests.filter(rendition=>rendition==='m18').length>=2,'the small version is requested again');
 assert.ok(!requests.includes('dv'),`the original is never requested: ${requests.join(',')}`);
});
