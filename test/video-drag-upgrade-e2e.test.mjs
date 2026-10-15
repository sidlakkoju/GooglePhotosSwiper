import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {emptyReview} from '../lib/userscript-core.mjs';
import {fulfillVideo} from './fixtures/video-route.mjs';

const envelope=(id,data)=>`)]}'\n\n123\n${JSON.stringify([['wrb.fr','unrelated','[]'],['wrb.fr',id,JSON.stringify(data)]])}\n`;

test('a video card being dragged does not start its full-quality download until the drag ends',{timeout:120000},async t=>{
 let chromium;
 try{({chromium}=await import('playwright'));}catch{t.skip('Playwright is unavailable');return;}
 let browser;
 try{browser=await chromium.launch({headless:true});}catch(error){t.skip(`Chromium is unavailable: ${error.message.split('\n')[0]}`);return;}
 t.after(()=>browser.close());
 const video=await readFile(new URL('fixtures/synthetic-video.mov',import.meta.url)),poster=await readFile(new URL('fixtures/synthetic-video-poster.png',import.meta.url));
 let release;const held=new Promise(resolve=>{release=resolve;});const full=[];
 const page=await browser.newPage({viewport:{width:1280,height:800}});
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname==='photos-swipe.test')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'});
  if(url.hostname==='photos.google.com'&&url.pathname.endsWith('/data/batchexecute')){
   const request=JSON.parse(new URLSearchParams(route.request().postData()).get('f.req'))[0][0];
   if(request[0]==='VrseUb')return route.fulfill({contentType:'text/plain',body:envelope('VrseUb',[[JSON.parse(request[1])[0],null],'https://lh3.googleusercontent.com/clip-video=dv'])});
   return route.fulfill({status:500,body:''});
  }
  if(url.hostname==='lh3.googleusercontent.com'&&url.pathname==='/clip-video=dv'){full.push(Date.now());return fulfillVideo(route,video,'video/quicktime');}
  if(url.hostname==='lh3.googleusercontent.com'&&url.pathname.startsWith('/clip-video')){await held;return fulfillVideo(route,video,'video/quicktime');}
  if(url.hostname==='lh3.googleusercontent.com')return route.fulfill({contentType:'image/png',body:poster});
  return route.abort();
 });
 await page.goto('https://photos-swipe.test');
 const items=[{mediaKey:'clip',name:'clip.mov',type:'video',date:'2024-01-01T00:00:00.000Z',thumbUrl:'https://lh3.googleusercontent.com/clip-poster',urlFetchedAt:Date.now(),state:'active',decision:null,revision:0},{mediaKey:'next',name:'next.jpg',type:'photo',date:'2024-01-02T00:00:00.000Z',thumbUrl:'https://lh3.googleusercontent.com/next',urlFetchedAt:Date.now(),state:'active',decision:null,revision:0}];
 await page.evaluate(async review=>{
  window.WIZ_global_data={SNlM0e:'synthetic-token',oPEP7c:'synthetic@example.test',eptZe:'/_/PhotosUi/u/0/'};
  const account=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(window.WIZ_global_data.oPEP7c))),byte=>byte.toString(16).padStart(2,'0')).join('');
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('photos-swipe-userscript',2);request.onupgradeneeded=()=>{for(const name of ['accounts','leases','settings'])request.result.createObjectStore(name);};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  await new Promise((resolve,reject)=>{const tx=db.transaction(['accounts','settings'],'readwrite');tx.objectStore('accounts').put(review,account);tx.objectStore('settings').put({onboardingDismissed:true},'sync');tx.objectStore('settings').put({sort:'original'},'resume:'+account);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
 },{...emptyReview(),revision:1,started:true,exhausted:true,swipeCount:3,items});
 const source=(await readFile(new URL('../userscript/photoswiper-app.user.js',import.meta.url),'utf8')).replace('document,location,GM:',"document,location:{origin:'https://photos.google.com',pathname:'/u/0/'},GM:");
 await page.addScriptTag({content:source});
 await page.evaluate(()=>document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('launcher').onclick());
 await page.waitForFunction(()=>document.getElementById('photos-swipe-userscript-host')?.shadowRoot.getElementById('caption').textContent.startsWith('clip.mov'));
 const box=await page.evaluate(()=>{const rect=document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('media').getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};});
 await page.mouse.move(box.x,box.y);await page.mouse.down();await page.mouse.move(box.x+24,box.y,{steps:4});
 release();
 await page.waitForFunction(()=>{const video=document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('media').querySelector('video');return !!video&&video.readyState>=2&&video.currentTime>.3;},null,{timeout:30000});
 await page.waitForTimeout(800);
 assert.deepEqual(full,[],'the full-quality download started while the card was being dragged');
 await page.mouse.move(box.x,box.y,{steps:4});await page.mouse.up();
 for(let count=0;count<100&&!full.length;count++)await page.waitForTimeout(50);
 assert.ok(full.length>0,'the full-quality download starts once the drag ends without a swipe');
 assert.ok((await page.evaluate(()=>document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('caption').textContent)).startsWith('clip.mov'),'the card stayed after a drag that did not commit');
});
