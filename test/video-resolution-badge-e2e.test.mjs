import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {emptyReview} from '../lib/userscript-core.mjs';
import {fulfillVideo} from './fixtures/video-route.mjs';

const envelope=(id,data)=>`)]}'\n\n123\n${JSON.stringify([['wrb.fr','unrelated','[]'],['wrb.fr',id,JSON.stringify(data)]])}\n`;
const cases=[
 {name:'desktop, original ignores byte ranges',width:1280,height:800,scheme:'light',original:'no ranges',shows:'m22'},
 {name:'desktop, original can seek',width:1280,height:800,scheme:'dark',original:'ranges',shows:'dv'},
 {name:'phone, original ignores byte ranges',width:375,height:812,scheme:'dark',touch:true,original:'no ranges',shows:'m22'},
 {name:'short window, original ignores byte ranges',width:1366,height:600,scheme:'light',original:'no ranges',shows:'m22'},
 {name:'landscape phone, original ignores byte ranges',width:750,height:342,scheme:'dark',touch:true,original:'no ranges',shows:'m22'}
];

for(const engineName of ['chromium','webkit'])for(const scenario of cases)test(`the video bar shows the playing resolution with a spinner only while a sharper copy loads, ${scenario.name} (${engineName})`,{timeout:120000},async t=>{
 let playwright;
 try{playwright=await import('playwright');}catch{t.skip('Playwright is unavailable');return;}
 let browser;
 try{browser=await playwright[engineName].launch({headless:true});}catch(error){t.skip(`${engineName} is unavailable: ${error.message.split('\n')[0]}`);return;}
 t.after(()=>browser.close());
 const video=await readFile(new URL('fixtures/synthetic-video.webm',import.meta.url)),poster=await readFile(new URL('fixtures/synthetic-video-poster.png',import.meta.url));
 const page=await browser.newPage({viewport:{width:scenario.width,height:scenario.height},colorScheme:scenario.scheme,hasTouch:!!scenario.touch,isMobile:!!scenario.touch&&engineName==='chromium'});
 let releaseOriginal;const originalRequested=new Promise(resolve=>{releaseOriginal=resolve;});let held=true;const waiting=[];
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname==='photos-swipe.test')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'});
  if(url.hostname==='photos.google.com'&&url.pathname.endsWith('/data/batchexecute')){
   const request=JSON.parse(new URLSearchParams(route.request().postData()).get('f.req'))[0][0];
   if(request[0]==='VrseUb'){const key=JSON.parse(request[1])[0];return route.fulfill({contentType:'text/plain',body:envelope('VrseUb',[[key,null],`https://lh3.googleusercontent.com/${key}-video=dv`])});}
   return route.fulfill({status:500,body:''});
  }
  if(url.hostname==='lh3.googleusercontent.com'&&url.pathname.endsWith(scenario.touch?'=m22':'=dv')){
   releaseOriginal();if(held)await new Promise(resolve=>waiting.push(resolve));
   return scenario.original==='ranges'||scenario.touch?fulfillVideo(route,video,'video/webm'):route.fulfill({status:200,contentType:'video/webm',body:video});
  }
  if(url.hostname==='lh3.googleusercontent.com'&&url.pathname.endsWith('=dv'))return route.fulfill({status:200,contentType:'video/webm',body:video});
  if(url.hostname==='lh3.googleusercontent.com'&&/-video=/.test(url.pathname))return fulfillVideo(route,video,'video/webm');
  if(url.hostname==='lh3.googleusercontent.com')return route.fulfill({contentType:'image/png',body:poster});
  return route.abort();
 });
 await page.goto('https://photos-swipe.test');
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
 const read=()=>page.evaluate(()=>{
  const root=document.getElementById('photos-swipe-userscript-host').shadowRoot,media=root.getElementById('media');
  const shown=[...media.querySelectorAll('video')].find(element=>!element.hidden&&element.style.opacity!=='0');
  const badge=media.querySelector('[data-video-quality=badge]'),spinner=badge?.querySelector('[data-video-quality=loading]'),label=badge?.querySelector('[data-video-quality=label]');
  const box=element=>{if(!element||!element.getClientRects().length)return null;const rect=element.getBoundingClientRect();return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom};};
  const controls=Object.fromEntries([...media.children].filter(element=>element.dataset.videoControl&&!element.hidden).map(element=>[element.dataset.videoControl,box(element)]));
  return {src:shown?.currentSrc.replace(/^.*=/,''),size:shown?Math.min(shown.videoWidth,shown.videoHeight):0,badge:badge&&!badge.hidden?label.textContent:null,inTime:badge?.parentElement?.dataset.videoControl,spinning:!!spinner&&!spinner.hidden&&getComputedStyle(spinner).display!=='none',spinner:box(spinner),badgeBox:box(badge),controls,media:box(media),color:badge&&getComputedStyle(badge).color,timeColor:getComputedStyle(media.querySelector('[data-video-control=time]')).color,time:media.querySelector('[data-video-control=time]').firstChild?.textContent};
 });
 await originalRequested;
 await page.waitForFunction(()=>{const badge=document.getElementById('photos-swipe-userscript-host').shadowRoot.querySelector('#media [data-video-quality=badge]');return !!badge&&!badge.hidden;},null,{timeout:20000});
 await page.waitForTimeout(800);
 const loading=await read();
 assert.equal(loading.inTime,'time');
 assert.ok(loading.size>0);assert.equal(loading.badge,`${loading.size}p`);
 assert.equal(loading.src,scenario.touch?'m18':'m22');
 assert.ok(loading.spinning,`no spinner while the sharper copy loads: ${JSON.stringify(loading)}`);
 assert.match(loading.time,/^\d+:\d\d \/ 0:20$/);
 assert.equal(loading.color,loading.timeColor);
 const overlap=(a,b)=>a&&b&&a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom;
 for(const part of [loading.badgeBox,loading.spinner]){
  for(const name of ['play','mute','seek'])assert.ok(!overlap(part,loading.controls[name]),`${JSON.stringify(part)} overlaps ${name} ${JSON.stringify(loading.controls[name])}`);
  assert.ok(part.left>=loading.media.left&&part.right<=loading.media.right&&part.bottom<=loading.media.bottom);
 }
 held=false;for(const resolve of waiting.splice(0))resolve();
 await page.waitForFunction(()=>{const spinner=document.getElementById('photos-swipe-userscript-host').shadowRoot.querySelector('#media [data-video-quality=loading]');return !!spinner&&spinner.hidden;},null,{timeout:20000});
 if(scenario.shows==='dv')await page.waitForFunction(()=>[...document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('media').querySelectorAll('video')].some(element=>element.style.opacity!=='0'&&element.currentSrc.endsWith('=dv')),null,{timeout:20000}).catch(()=>{});
 await page.waitForTimeout(scenario.touch?3000:1500);
 const settled=await read();
 assert.ok(!settled.spinning,`the spinner kept spinning: ${JSON.stringify(settled)}`);
 assert.ok(settled.size>0);assert.equal(settled.badge,`${settled.size}p`);
 assert.equal(settled.src,engineName==='webkit'&&!scenario.touch?'dv':scenario.shows);
});
