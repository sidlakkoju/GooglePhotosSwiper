import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {emptyReview} from '../lib/userscript-core.mjs';
import {fulfillVideo} from './fixtures/video-route.mjs';
import {splitWebM,dashManifest,dashSegment} from './fixtures/dash-route.mjs';

const envelope=(id,data)=>`)]}'\n\n123\n${JSON.stringify([['wrb.fr','unrelated','[]'],['wrb.fr',id,JSON.stringify(data)]])}\n`;
const origin='https://photos-swipe.test';

for(const manifestMode of ['served','missing'])test(`${manifestMode==='served'?"the sharp copy streams from Google's DASH manifest and seeks":'a missing DASH manifest falls back to the file copies and still seeks'} (chromium)`,{timeout:120000},async t=>{
 let playwright;
 try{playwright=await import('playwright');}catch{t.skip('Playwright is unavailable');return;}
 let browser;
 try{browser=await playwright.chromium.launch({headless:true});}catch(error){t.skip(`chromium is unavailable: ${error.message.split('\n')[0]}`);return;}
 t.after(()=>browser.close());
 const video=await readFile(new URL('fixtures/synthetic-video.webm',import.meta.url)),poster=await readFile(new URL('fixtures/synthetic-video-poster.png',import.meta.url));
 const split=splitWebM(video),manifest=dashManifest({seconds:split.seconds,segments:split.segments});
 const requests={manifest:[],segments:[],original:0};
 const page=await browser.newPage({viewport:{width:1280,height:800}});
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.hostname==='photos-swipe.test')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'});
  if(url.hostname==='photos.google.com'&&url.pathname.endsWith('/data/batchexecute')){
   const call=JSON.parse(new URLSearchParams(request.postData()).get('f.req'))[0][0];
   if(call[0]==='VrseUb'){const key=JSON.parse(call[1])[0];return route.fulfill({contentType:'text/plain',body:envelope('VrseUb',[[key,null],`https://lh3.googleusercontent.com/${key}-video=dv`])});}
   return route.fulfill({status:500,body:''});
  }
  if(url.hostname==='lh3.googleusercontent.com'&&url.pathname.endsWith('=mm,dash-vm-vf,dr.sdr,sdrCodec.vp9.h264')){
   requests.manifest.push(url.pathname);
   const headers={'access-control-allow-origin':origin,'access-control-allow-credentials':'true'};
   if(manifestMode==='missing')return route.fulfill({status:404,headers,body:''});
   return route.fulfill({status:200,contentType:'application/dash+xml',headers,body:manifest});
  }
  if(url.hostname==='rr1---sn-test.googlevideo.com'){
   const segment=dashSegment(url.pathname,split);
   if(!segment?.body)return route.fulfill({status:404,headers:{'access-control-allow-origin':'*'},body:''});
   requests.segments.push(`${segment.id}:${segment.number}`);
   return route.fulfill({status:200,contentType:'video/webm',headers:{'access-control-allow-origin':'*'},body:segment.body});
  }
  if(url.hostname==='lh3.googleusercontent.com'&&url.pathname.endsWith('=dv')){requests.original++;return route.fulfill({status:200,contentType:'video/webm',body:video});}
  if(url.hostname==='lh3.googleusercontent.com'&&/-video=/.test(url.pathname))return fulfillVideo(route,video,'video/webm');
  if(url.hostname==='lh3.googleusercontent.com')return route.fulfill({contentType:'image/png',body:poster});
  return route.abort();
 });
 await page.goto(origin);
 const items=[{mediaKey:'first',name:'first.webm',type:'video',duration:20000,date:new Date(Date.UTC(2024,0,10)).toISOString(),thumbUrl:'https://lh3.googleusercontent.com/first-poster',urlFetchedAt:Date.now(),state:'active',decision:null,revision:0}];
 await page.evaluate(async review=>{
  window.WIZ_global_data={SNlM0e:'synthetic-token',oPEP7c:'synthetic@example.test',eptZe:'/_/PhotosUi/u/0/'};
  const account=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(window.WIZ_global_data.oPEP7c))),byte=>byte.toString(16).padStart(2,'0')).join('');
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('photos-swipe-userscript',2);request.onupgradeneeded=()=>{for(const name of ['accounts','leases','settings'])request.result.createObjectStore(name);};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  await new Promise((resolve,reject)=>{const tx=db.transaction(['accounts','settings'],'readwrite');tx.objectStore('accounts').put(review,account);tx.objectStore('settings').put({onboardingDismissed:true},'sync');tx.objectStore('settings').put({sort:'original'},'resume:'+account);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
 },{...emptyReview(),revision:1,started:true,exhausted:true,swipeCount:3,items});
 const app=(await readFile(new URL('../userscript/photoswiper-app.user.js',import.meta.url),'utf8')).replace('document,location,GM:',"document,location:{origin:'https://photos.google.com',pathname:'/u/0/'},GM:");
 await page.addScriptTag({content:app});
 await page.evaluate(()=>document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('launcher').onclick());
 const shown=()=>page.evaluate(()=>{const root=document.getElementById('photos-swipe-userscript-host').shadowRoot,videos=[...root.getElementById('media').querySelectorAll('video')].filter(element=>element.style.opacity!=='0'),badge=root.querySelector('#media [data-video-quality=badge]');return {count:videos.length,time:videos[0]?.currentTime,paused:videos[0]?.paused,src:videos[0]?.currentSrc||'',error:videos[0]?.error?.code||0,size:videos[0]?Math.min(videos[0].videoWidth,videos[0].videoHeight):0,badge:badge&&!badge.hidden?badge.textContent:null,label:root.querySelector('[data-video-control=time]')?.firstChild.textContent};});
 const streaming=manifestMode==='served';
 await page.waitForFunction(expectBlob=>{const root=document.getElementById('photos-swipe-userscript-host').shadowRoot,videos=[...root.getElementById('media').querySelectorAll('video')];if(videos.length!==1)return false;const element=videos[0];return element.readyState>=2&&element.currentTime>0&&(expectBlob?element.currentSrc.startsWith('blob:'):element.currentSrc.endsWith('=m22'));},streaming,{timeout:30000});
 if(!streaming)for(let wait=0;wait<100&&!requests.original;wait++)await page.waitForTimeout(100);
 const swapped=await shown();
 assert.equal(swapped.error,0);
 assert.equal(swapped.count,1);
 if(streaming){
  assert.ok(requests.segments.some(entry=>entry==='243:0'),`the 360p stream's init segment was never fetched: ${requests.segments}`);
  assert.ok(requests.segments.every(entry=>entry.startsWith('243:')),`only the sharpest stream should be fetched: ${requests.segments}`);
  assert.equal(requests.original,0,'the unseekable original should not be downloaded when the manifest works');
  assert.equal(swapped.badge,`${swapped.size}p`);
 }else{
  assert.ok(requests.manifest.length>=1,'the manifest was never requested');
  assert.ok(requests.original>=1,'a missing manifest should fall back to the original copy');
  assert.equal(requests.segments.length,0);
 }
 const box=await page.evaluate(()=>{const rect=document.getElementById('photos-swipe-userscript-host').shadowRoot.querySelector('[data-video-control=seek]').getBoundingClientRect();return {x:rect.x,y:rect.y+rect.height/2,width:rect.width};});
 await page.mouse.click(box.x+box.width*.75,box.y);
 await page.waitForFunction(()=>{const element=document.getElementById('photos-swipe-userscript-host').shadowRoot.querySelector('#media video');return element&&!element.seeking&&element.readyState>=2;},null,{timeout:15000});
 const clicked=await shown();
 assert.ok(Math.abs(clicked.time-15)<.6,`clicking at 75% left the video at ${clicked.time}s (${clicked.label})`);
 assert.match(clicked.label,/^0:1[56] \/ 0:20$/);
 if(streaming)assert.ok(requests.segments.includes('243:4'),`seeking to 0:15 never fetched the 15–20 s segment: ${requests.segments}`);
 await page.mouse.move(box.x+box.width*.1,box.y);await page.mouse.down();
 for(let step=1;step<=10;step++){await page.mouse.move(box.x+box.width*(.1+step*.04),box.y);await page.waitForTimeout(30);}
 await page.mouse.up();
 await page.waitForFunction(()=>{const element=document.getElementById('photos-swipe-userscript-host').shadowRoot.querySelector('#media video');return element&&!element.seeking&&element.readyState>=2;},null,{timeout:15000});
 const dragged=await shown();
 assert.ok(Math.abs(dragged.time-10)<.6,`dragging to 50% left the video at ${dragged.time}s (${dragged.label})`);
 await page.waitForTimeout(1200);
 const later=await shown();
 assert.ok(later.time>dragged.time,`playback did not continue after the drag: ${dragged.time}s then ${later.time}s`);
 assert.equal(later.error,0);
 if(streaming)assert.ok(later.src.startsWith('blob:'),'the streamed copy was replaced after seeking');
});
