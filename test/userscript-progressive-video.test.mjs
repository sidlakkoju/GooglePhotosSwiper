import test from 'node:test';
import assert from 'node:assert/strict';
import {smallerVideoURL,startProgressiveVideo} from '../lib/userscript-video.mjs';

function fakeVideo(){
 const listeners=new Map();
 return {src:'',currentTime:0,readyState:0,paused:true,muted:true,volume:1,playbackRate:1,loop:true,dataset:{},loads:0,
  addEventListener(type,handler,options){const list=listeners.get(type)||[];list.push({handler,once:options?.once});listeners.set(type,list);},
  emit(type){for(const entry of [...(listeners.get(type)||[])]){if(entry.once)listeners.set(type,listeners.get(type).filter(value=>value!==entry));entry.handler();}},
  play(){this.paused=false;return Promise.resolve();},pause(){this.paused=true;},load(){this.loads++;},removeAttribute(name){this[name]='';}
 };
}
const url='https://fixture.invalid/synthetic=original?authuser=0';
function setup(compact=false){
 const video=fakeVideo(),full=fakeVideo(),swaps=[],errors=[];let active=true;
 const cancel=startProgressiveVideo({video,url,compact,createVideo:()=>full,onSwap:value=>swaps.push(value),onError:()=>errors.push('error'),isActive:()=>active});
 return {video,full,swaps,errors,cancel,deactivate:()=>{active=false;}};
}

test('smaller rendition preserves query and selects phone or desktop quality',()=>{
 assert.equal(smallerVideoURL(url,true),'https://fixture.invalid/synthetic=m18?authuser=0');
 assert.equal(smallerVideoURL(url),'https://fixture.invalid/synthetic=m22?authuser=0');
});

test('small starts first and hidden original upgrades at current playback time with one audio source',async()=>{
 const {video,full,swaps}=setup(true);
 assert.equal(video.src,smallerVideoURL(url,true));assert.equal(full.src,'');
 video.currentTime=12.5;video.readyState=2;video.muted=false;video.emit('loadeddata');
 assert.equal(full.src,url);assert.equal(full.hidden,true);assert.equal(full.muted,true);
 full.readyState=2;full.emit('canplay');assert.equal(full.currentTime,12.5);assert.equal(swaps.length,0);
 full.emit('seeked');await Promise.resolve();
 assert.deepEqual(swaps,[full]);assert.equal(full.currentTime,12.5);assert.equal(video.paused,true);assert.equal(video.src,'');assert.equal(full.muted,false);assert.equal(full.paused,false);
});

for(const event of ['error','stalled','waiting'])test(`small ${event} immediately falls back to original and preserves time`,()=>{
 const {video,full,errors}=setup();video.currentTime=7;video.readyState=2;video.emit('loadeddata');
 if(event==='error')video.onerror();else video.emit(event);
 assert.equal(video.src,url);assert.equal(full.src,'');video.currentTime=0;video.emit('loadedmetadata');assert.equal(video.currentTime,7);
 video.onerror();assert.deepEqual(errors,['error']);
});

test('passing card cancels hidden original and prevents late swap',async()=>{
 const {video,full,swaps,cancel,deactivate}=setup();video.readyState=2;video.emit('loadeddata');
 deactivate();cancel();full.readyState=2;full.emit('canplay');await Promise.resolve();
 assert.equal(full.src,'');assert.equal(full.paused,true);assert.deepEqual(swaps,[]);
});

test('paused playback stays paused after upgrade and original failure retains small fallback',()=>{
 const {video,full,swaps}=setup();video.pause();video.readyState=2;video.emit('loadeddata');full.readyState=2;full.emit('canplay');
 assert.deepEqual(swaps,[full]);assert.equal(full.paused,true);
 const second=setup();second.video.readyState=2;second.video.emit('loadeddata');second.full.onerror();
 assert.equal(second.video.src,smallerVideoURL(url));second.video.onerror();assert.equal(second.video.src,url);
});

test('frame handoff realigns after a seek and preserves a pause while preparing the frame',async()=>{
 const {video,full,swaps}=setup();let frame;
 full.requestVideoFrameCallback=callback=>{frame=callback;};
 video.readyState=2;video.currentTime=3;video.emit('loadeddata');full.readyState=2;full.emit('canplay');full.emit('seeked');await Promise.resolve();
 video.currentTime=20;frame();assert.equal(swaps.length,0);assert.equal(full.currentTime,20);
 full.emit('seeked');await Promise.resolve();video.pause();frame();
 assert.deepEqual(swaps,[full]);assert.equal(full.currentTime,20);assert.equal(full.paused,true);
});

test('fallback before metadata keeps the saved resume position owned by the display',()=>{
 const {video}=setup();video.dataset.resumeReady='pending';video.onerror();
 video.currentTime=16;video.dataset.resumeReady='ready';video.emit('loadedmetadata');
 assert.equal(video.currentTime,16);
});

test('normal initial waiting does not abandon the smaller rendition',()=>{
 const {video}=setup();video.emit('waiting');assert.equal(video.src,smallerVideoURL(url));
 video.emit('stalled');assert.equal(video.src,url);
});
