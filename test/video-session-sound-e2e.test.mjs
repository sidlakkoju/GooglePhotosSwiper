import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {emptyReview} from '../lib/userscript-core.mjs';
import {fulfillVideo} from './fixtures/video-route.mjs';

const envelope=(id,data)=>`)]}'\n\n123\n${JSON.stringify([['wrb.fr','unrelated','[]'],['wrb.fr',id,JSON.stringify(data)]])}\n`;
const clip=await readFile(new URL('fixtures/synthetic-video.mov',import.meta.url)),poster=await readFile(new URL('fixtures/synthetic-video-poster.png',import.meta.url));
const appSource=(await readFile(new URL('../userscript/photoswiper-app.user.js',import.meta.url),'utf8')).replace('document,location,GM:',"document,location:{origin:'https://photos.google.com',pathname:'/u/0/'},GM:");
const items=['a','b','c'].map((key,index)=>({mediaKey:key,name:`${key}.mov`,type:'video',date:`2024-01-0${index+1}T00:00:00.000Z`,thumbUrl:`https://lh3.googleusercontent.com/${key}-poster`,urlFetchedAt:Date.now(),state:'active',decision:null,revision:0}));

function webkitPolicy(strict){
 const unlocked=new WeakSet(),proto=HTMLMediaElement.prototype,play=proto.play,load=proto.load,muted=Object.getOwnPropertyDescriptor(proto,'muted');
 let gesture=false;
 window.policyLog={rejected:0,paused:0};
 for(const type of ['touchend','click','keydown'])window.addEventListener(type,event=>{if(event.isTrusted){gesture=true;setTimeout(()=>{gesture=false;});}},true);
 const lift=(element,direct)=>{if(gesture&&(!strict||direct&&element.isConnected&&!element.hidden&&element.style.opacity!=='0'))unlocked.add(element);};
 proto.play=function(){lift(this,false);if(!muted.get.call(this)&&!unlocked.has(this)){window.policyLog.rejected++;return Promise.reject(new DOMException('The request is not allowed by the user agent.','NotAllowedError'));}return play.call(this);};
 proto.load=function(){lift(this,false);return load.call(this);};
 Object.defineProperty(proto,'muted',{configurable:true,get(){return muted.get.call(this);},set(value){lift(this,true);muted.set.call(this,value);if(!value&&!this.paused&&!unlocked.has(this)){window.policyLog.paused++;this.pause();}}});
}

async function launch(t,engineName,options){
 let engine,devices;
 try{({[engineName]:engine,devices}=await import('playwright'));}catch{t.skip('Playwright is unavailable');return null;}
 let browser;
 try{browser=await engine.launch({headless:true});}catch(error){t.skip(`${engineName} is unavailable: ${error.message.split('\n')[0]}`);return null;}
 t.after(()=>browser.close());
 const context=await browser.newContext(options.device?devices[options.device]:{viewport:{width:1280,height:800}});
 const page=await context.newPage(),gates=new Map(),gate=key=>{if(!gates.has(key)){let open;gates.set(key,{promise:new Promise(resolve=>{open=resolve;}),open});}return gates.get(key);};
 page.openGate=key=>gate(key).open();
 if(options.policy)await page.addInitScript(webkitPolicy,options.policy==='strict');
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname==='photos-swipe.test')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'});
  if(url.hostname==='photos.google.com'&&url.pathname.endsWith('/data/batchexecute')){
   const request=JSON.parse(new URLSearchParams(route.request().postData()).get('f.req'))[0][0];
   if(request[0]==='VrseUb'){const key=JSON.parse(request[1])[0];return route.fulfill({contentType:'text/plain',body:envelope('VrseUb',[[key,null],`https://lh3.googleusercontent.com/${key}-video=dv`])});}
   return route.fulfill({status:500,body:''});
  }
  if(url.hostname==='lh3.googleusercontent.com'&&url.pathname.includes('-video')){
   const [key,quality]=url.pathname.slice(1).split('-video=');
   if(quality!==(options.device?'m18':'m22'))await gate(key).promise;
   return fulfillVideo(route,clip,'video/quicktime');
  }
  if(url.hostname==='lh3.googleusercontent.com')return route.fulfill({contentType:'image/png',body:poster});
  return route.abort();
 });
 await page.goto('https://photos-swipe.test');
 await page.evaluate(async review=>{
  window.WIZ_global_data={SNlM0e:'synthetic-token',oPEP7c:'synthetic@example.test',eptZe:'/_/PhotosUi/u/0/'};
  const account=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(window.WIZ_global_data.oPEP7c))),byte=>byte.toString(16).padStart(2,'0')).join('');
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('photos-swipe-userscript',2);request.onupgradeneeded=()=>{for(const name of ['accounts','leases','settings'])request.result.createObjectStore(name);};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  await new Promise((resolve,reject)=>{const tx=db.transaction(['accounts','settings'],'readwrite');tx.objectStore('accounts').put(review,account);tx.objectStore('settings').put({onboardingDismissed:true},'sync');tx.objectStore('settings').put({sort:'original'},'resume:'+account);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
 },{...emptyReview(),revision:1,started:true,exhausted:true,swipeCount:3,items});
 return page;
}

async function openApp(page,name){
 await page.evaluate(()=>{window.WIZ_global_data={SNlM0e:'synthetic-token',oPEP7c:'synthetic@example.test',eptZe:'/_/PhotosUi/u/0/'};});
 await page.addScriptTag({content:appSource});
 await page.evaluate(()=>document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('launcher').onclick());
 await showing(page,name);
}

async function showing(page,name){
 await page.waitForFunction(name=>document.getElementById('photos-swipe-userscript-host')?.shadowRoot.getElementById('caption').textContent.startsWith(name),name);
 await page.waitForFunction(()=>{const video=document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('media').querySelector('video');return !!video&&!video.hidden&&video.currentTime>.5;},null,{timeout:30000});
}

const shown=page=>page.evaluate(()=>{
 const media=document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('media'),video=media.querySelector('video');
 return {muted:video.muted,paused:video.paused,time:video.currentTime,label:media.querySelector('[data-video-control=mute]')?.textContent,log:window.policyLog};
});

async function playingWith(page,muted,message){
 const before=await shown(page);
 await page.waitForTimeout(700);
 const after=await shown(page);
 assert.equal(after.muted,muted,`${message}: muted`);
 assert.equal(after.paused,false,`${message}: keeps playing`);
 assert.ok(after.time!==before.time,`${message}: playback moves (${before.time} -> ${after.time})`);
 assert.equal(after.label,muted?'Unmute':'Mute',`${message}: button label`);
 return after;
}

async function upgrade(page,key){
 const current=()=>page.evaluate(()=>document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('media').querySelector('video').currentSrc);
 assert.doesNotMatch(await current(),/=dv$/,'full quality waits for the test');
 page.openGate(key);
 await page.waitForFunction(()=>{const videos=[...document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('media').querySelectorAll('video')];return videos.length===1&&videos[0].currentSrc.endsWith('=dv')&&videos[0].style.opacity===''&&videos[0].currentTime>.3;},null,{timeout:30000});
}

const press=(page,selector,touch)=>touch?page.locator(selector).tap():page.locator(selector).click();

test('iPhone Safari: Unmute carries over to later, undone and enlarged videos (and their quality swaps) until Mute or reload',{timeout:180000},async t=>{
 const page=await launch(t,'webkit',{device:'iPhone 13',policy:'webkit'});if(!page)return;
 await openApp(page,'a.mov');
 await playingWith(page,true,'the first video starts muted');
 await press(page,'[data-video-control=mute]',true);
 await playingWith(page,false,'the first video after Unmute');
 await upgrade(page,'a');
 await playingWith(page,false,'the first video after its quality swap');
 await press(page,'#keep',true);
 await showing(page,'b.mov');
 await playingWith(page,false,'the next video starts with sound');
 await upgrade(page,'b');
 const swapped=await playingWith(page,false,'the next video after its quality swap');
 assert.deepEqual(swapped.log,{rejected:0,paused:0},'elements prepared during taps may play with sound');
 await press(page,'#enlarge',true);
 await playingWith(page,false,'the enlarged view');
 await press(page,'#enlarge',true);
 await press(page,'#undo',true);
 await showing(page,'a.mov');
 await playingWith(page,false,'the video brought back by Undo');
 await press(page,'#keep',true);
 await showing(page,'b.mov');
 assert.deepEqual((await playingWith(page,false,'the next video again')).log,{rejected:0,paused:0});
 await press(page,'[data-video-control=mute]',true);
 await playingWith(page,true,'the second video after Mute');
 await press(page,'#keep',true);
 await showing(page,'c.mov');
 await playingWith(page,true,'Mute also carries over');
 await press(page,'[data-video-control=mute]',true);
 await playingWith(page,false,'the third video after Unmute');
 await page.reload();
 await openApp(page,'c.mov');
 await playingWith(page,true,'a reload starts muted again');
});

test('iPhone Safari: when sound is refused, videos fall back to muted playback instead of stalling',{timeout:180000},async t=>{
 const page=await launch(t,'webkit',{device:'iPhone 13',policy:'strict'});if(!page)return;
 await openApp(page,'a.mov');
 await press(page,'[data-video-control=mute]',true);
 await playingWith(page,false,'the tapped video plays with sound');
 await upgrade(page,'a');
 const swapped=await playingWith(page,true,'a quality swap that may not unmute');
 assert.ok(swapped.log.paused>=1,'the replacement was paused by the sound policy');
 await press(page,'[data-video-control=mute]',true);
 await playingWith(page,false,'Unmute works again on the replacement');
 await press(page,'#keep',true);
 await showing(page,'b.mov');
 const next=await playingWith(page,true,'the next video whose play() with sound is refused');
 assert.ok(next.log.rejected>=1,'play() with sound was refused');
 await press(page,'#keep',true);
 await showing(page,'c.mov');
 const later=await playingWith(page,true,'the following video, also refused');
 assert.ok(later.log.rejected>next.log.rejected,'the session still asks for sound after a refusal');
});

test('desktop Chrome: Unmute and Mute carry over to the next video',{timeout:180000},async t=>{
 const page=await launch(t,'chromium',{});if(!page)return;
 await openApp(page,'a.mov');
 await playingWith(page,true,'the first video starts muted');
 await press(page,'[data-video-control=mute]');
 await playingWith(page,false,'the first video after Unmute');
 await press(page,'#keep');
 await showing(page,'b.mov');
 await playingWith(page,false,'the next video starts with sound');
 await upgrade(page,'b');
 await playingWith(page,false,'the next video after its quality swap');
 await press(page,'[data-video-control=mute]');
 await press(page,'#keep');
 await showing(page,'c.mov');
 await playingWith(page,true,'Mute carries over');
});
