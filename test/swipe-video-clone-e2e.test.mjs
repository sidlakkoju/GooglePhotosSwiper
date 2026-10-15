import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {emptyReview} from '../lib/userscript-core.mjs';
import {fulfillVideo} from './fixtures/video-route.mjs';

const envelope=(id,data)=>`)]}'\n\n123\n${JSON.stringify([['wrb.fr','unrelated','[]'],['wrb.fr',id,JSON.stringify(data)]])}\n`;

for(const engineName of ['webkit','chromium'])for(const how of ['button','drag'])test(`swiping a video card away by ${how} starts no new download of its video (${engineName})`,{timeout:120000},async t=>{
 let playwright;
 try{playwright=await import('playwright');}catch{t.skip('Playwright is unavailable');return;}
 let browser;
 try{browser=await playwright[engineName].launch({headless:true});}catch(error){t.skip(`${engineName} is unavailable: ${error.message.split('\n')[0]}`);return;}
 t.after(()=>browser.close());
 const video=await readFile(new URL('fixtures/synthetic-video.webm',import.meta.url)),poster=await readFile(new URL('fixtures/synthetic-video-poster.png',import.meta.url));
 const requests=[];
 const page=await browser.newPage({viewport:{width:1280,height:800}});
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname==='photos-swipe.test')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'});
  if(url.hostname==='photos.google.com'&&url.pathname.endsWith('/data/batchexecute')){
   const request=JSON.parse(new URLSearchParams(route.request().postData()).get('f.req'))[0][0];
   if(request[0]==='VrseUb'){const key=JSON.parse(request[1])[0];return route.fulfill({contentType:'text/plain',body:envelope('VrseUb',[[key,null],`https://lh3.googleusercontent.com/${key}-video=dv`])});}
   return route.fulfill({status:500,body:''});
  }
  if(url.hostname==='lh3.googleusercontent.com'&&/-video=/.test(url.pathname)){requests.push({at:Date.now(),path:url.pathname.slice(1)});return fulfillVideo(route,video,'video/webm');}
  if(url.hostname==='lh3.googleusercontent.com')return route.fulfill({contentType:'image/png',body:poster});
  return route.abort();
 });
 await page.goto('https://photos-swipe.test');
 const items=['first','second'].map((key,index)=>({mediaKey:key,name:`${key}.webm`,type:'video',duration:20000,date:new Date(Date.UTC(2024,0,10-index)).toISOString(),thumbUrl:`https://lh3.googleusercontent.com/${key}-poster`,urlFetchedAt:Date.now(),state:'active',decision:null,revision:0}));
 await page.evaluate(async review=>{
  window.WIZ_global_data={SNlM0e:'synthetic-token',oPEP7c:'synthetic@example.test',eptZe:'/_/PhotosUi/u/0/'};
  const account=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(window.WIZ_global_data.oPEP7c))),byte=>byte.toString(16).padStart(2,'0')).join('');
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('photos-swipe-userscript',2);request.onupgradeneeded=()=>{for(const name of ['accounts','leases','settings'])request.result.createObjectStore(name);};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  await new Promise((resolve,reject)=>{const tx=db.transaction(['accounts','settings'],'readwrite');tx.objectStore('accounts').put(review,account);tx.objectStore('settings').put({onboardingDismissed:true},'sync');tx.objectStore('settings').put({sort:'original'},'resume:'+account);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
 },{...emptyReview(),revision:1,started:true,exhausted:true,swipeCount:3,items});
 const source=(await readFile(new URL('../userscript/photoswiper-app.user.js',import.meta.url),'utf8')).replace('document,location,GM:',"document,location:{origin:'https://photos.google.com',pathname:'/u/0/'},GM:");
 await page.addScriptTag({content:source});
 await page.evaluate(()=>document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('launcher').onclick());
 await page.waitForFunction(()=>{const root=document.getElementById('photos-swipe-userscript-host').shadowRoot;const shown=root.getElementById('media').querySelector('video');return /^first/.test(root.getElementById('caption').textContent)&&!!shown&&shown.readyState>=2&&shown.currentTime>0;},null,{timeout:20000});
 await page.waitForTimeout(1500);
 const swipedAt=Date.now();
 if(how==='button')await page.evaluate(()=>document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('keep').click());
 else{
  const box=await page.evaluate(()=>{const rect=document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('card').getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/3};});
  await page.mouse.move(box.x,box.y);await page.mouse.down();for(let step=1;step<=10;step++)await page.mouse.move(box.x+step*40,box.y);await page.mouse.up();
 }
 await page.waitForFunction(()=>/^second/.test(document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('caption').textContent),null,{timeout:10000});
 await page.waitForTimeout(1500);
 const after=requests.filter(request=>request.at>=swipedAt&&request.path.startsWith('first-')).map(request=>request.path);
 assert.deepEqual(after,[],`the swiped-away video was downloaded again: ${after.join(', ')}`);
});
