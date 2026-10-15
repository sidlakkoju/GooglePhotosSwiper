import test from 'node:test';
import assert from 'node:assert/strict';
import {loopOnEnd,smallerVideoURL,startProgressiveVideo,watchVideoLoading} from '../lib/userscript-video.mjs';

function fakeVideo(){
 const listeners=new Map();
 return {style:{},parentNode:{append(element){element.isConnected=true;}},remove(){this.isConnected=false;},src:'',currentTime:0,readyState:0,paused:true,muted:true,volume:1,playbackRate:1,loop:true,dataset:{},loads:0,
  addEventListener(type,handler,options){const list=listeners.get(type)||[];list.push({handler,once:options?.once});listeners.set(type,list);},
  emit(type){for(const entry of [...(listeners.get(type)||[])]){if(entry.once)listeners.set(type,listeners.get(type).filter(value=>value!==entry));entry.handler();}},
  play(){this.playCalls=(this.playCalls||0)+1;this.paused=false;this.emit('play');return Promise.resolve();},pause(){this.paused=true;this.emit('pause');},load(){this.loads++;},removeAttribute(name){this[name]='';}
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

test('phone starts at 360p and upgrades in place to 720p at current playback time with one audio source',async()=>{
 const {video,full,swaps}=setup(true);
 assert.equal(video.src,smallerVideoURL(url,true));assert.equal(full.src,'');
 video.currentTime=12.5;video.readyState=2;video.muted=false;video.emit('loadeddata');
 assert.equal(full.src,smallerVideoURL(url));assert.equal(full.hidden,false);assert.equal(full.isConnected,true);assert.equal(full.style.opacity,'0');assert.equal(full.muted,true);
 full.readyState=2;full.emit('canplay');assert.equal(full.currentTime,12.5);assert.equal(swaps.length,0);
 full.emit('seeked');await Promise.resolve();
 assert.deepEqual(swaps,[full]);assert.equal(full.currentTime,12.5);assert.equal(video.paused,true);assert.equal(video.src,'');assert.equal(full.muted,false);assert.equal(full.paused,false);
});

for(const event of ['error','stalled'])test(`small ${event} immediately falls back to original and preserves time`,()=>{
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

test('normal initial waiting does not abandon the smaller rendition, and a stall with no data retries it once before the original',()=>{
 const {video}=setup();video.emit('waiting');assert.equal(video.src,smallerVideoURL(url));
 const plays=video.playCalls;
 video.emit('stalled');assert.equal(video.src,smallerVideoURL(url));assert.equal(video.loads,1);assert.equal(video.playCalls,plays+1);
 video.emit('stalled');assert.equal(video.src,url);
});

test('retrying the smaller rendition keeps an applied resume position and leaves a pending one to the display',()=>{
 const {video}=setup();video.readyState=1;video.currentTime=16;video.dataset.resumeReady='ready';
 video.emit('stalled');video.currentTime=0;video.emit('loadedmetadata');assert.equal(video.currentTime,16);
 const pending=setup();pending.video.readyState=1;pending.video.currentTime=4;pending.video.dataset.resumeReady='pending';
 pending.video.emit('stalled');pending.video.currentTime=0;pending.video.emit('loadedmetadata');assert.equal(pending.video.currentTime,0);
});

test('a stall after the smaller rendition has data falls back to the original without a retry',()=>{
 const {video}=setup();video.readyState=2;video.emit('stalled');assert.equal(video.src,url);
});

test('a retried smaller rendition that recovers keeps playing and still upgrades',async()=>{
 const {video,full,swaps}=setup(true);
 video.emit('stalled');assert.equal(video.src,smallerVideoURL(url,true));
 video.currentTime=1;video.readyState=2;video.emit('loadeddata');
 full.readyState=2;full.emit('canplay');full.emit('seeked');await Promise.resolve();
 assert.deepEqual(swaps,[full]);assert.equal(full.src,smallerVideoURL(url));
});

for(const event of ['error','stalled'])test(`small ${event} resumes original after a browser error forces paused`,()=>{
 const {video}=setup();video.readyState=2;video.emit('loadeddata');
 video.error={code:4};video.paused=true;video.emit('pause');
 if(event==='error')video.onerror();else video.emit(event);
 assert.equal(video.src,url);assert.equal(video.playCalls,2);assert.equal(video.paused,false);
});

test('fallback respects a user pause before the rendition fails',()=>{
 const {video}=setup();video.pause();video.error={code:4};video.onerror();
 assert.equal(video.src,url);assert.equal(video.playCalls,1);assert.equal(video.paused,true);
});

test('a clamped no-op seek abandons the hidden upgrade without repeated seeks',()=>{
 const {video,full,swaps}=setup();let seeks=0;
 Object.defineProperty(full,'currentTime',{get:()=>0,set:()=>{seeks++;}});
 video.currentTime=12;video.readyState=2;video.emit('loadeddata');full.readyState=2;full.emit('canplay');
 for(let index=0;index<20;index++){full.emit('seeked');full.emit('canplay');}
 assert.equal(seeks,1);assert.equal(full.src,'');assert.equal(full.paused,true);
 assert.equal(video.src,smallerVideoURL(url));assert.equal(video.paused,false);assert.deepEqual(swaps,[]);
});

test('alignment attempts stay bounded when seeks progress without reaching the target',()=>{
 const {video,full,swaps}=setup();let time=0,seeks=0;
 Object.defineProperty(full,'currentTime',{get:()=>time,set:()=>{seeks++;time+=.01;}});
 video.currentTime=12;video.readyState=2;video.emit('loadeddata');full.readyState=2;full.emit('canplay');
 for(let index=0;index<20;index++)full.emit('seeked');
 assert.equal(seeks,8);assert.equal(full.src,'');assert.deepEqual(swaps,[]);
 assert.equal(video.src,smallerVideoURL(url));assert.equal(video.paused,false);
});

test('upgrade plays attached and rendered and cleans up when playback is rejected',async()=>{
 const {video,full,swaps}=setup();
 full.play=function(){assert.equal(this.isConnected,true);assert.equal(this.hidden,false);return Promise.reject(Error('autoplay'));};
 video.readyState=2;video.emit('loadeddata');full.readyState=2;full.emit('canplay');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(full.isConnected,false);assert.equal(full.src,'');assert.deepEqual(swaps,[]);assert.equal(video.src,smallerVideoURL(url));
});

test('pausing during a pending upgrade play preserves the swapped video after AbortError',async()=>{
 const {video,full,swaps,errors}=setup();let rejectPlayback;
 full.play=function(){this.paused=false;return new Promise((resolve,reject)=>{rejectPlayback=reject;});};
 const pause=full.pause;
 full.pause=function(){pause.call(this);rejectPlayback(new DOMException('Playback interrupted by pause','AbortError'));};
 video.readyState=2;video.currentTime=3;video.emit('loadeddata');full.readyState=2;full.emit('canplay');full.emit('seeked');
 assert.equal(swaps.length,0);
 video.pause();full.emit('canplay');
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(swaps,[full]);assert.equal(full.isConnected,true);assert.equal(full.src,url);assert.equal(full.paused,true);
 assert.equal(full.currentTime,3);assert.equal(full.style.opacity,'');assert.equal(full.loads,1);assert.equal(video.src,'');assert.deepEqual(errors,[]);
 full.onerror();assert.deepEqual(errors,['error']);
});

for(const event of ['loadeddata','canplay','playing','timeupdate','frame','warm'])test(`loading clears on ${event} without a new canplay`,()=>{
 const video=fakeVideo();let busy=true,frame;
 video.requestVideoFrameCallback=callback=>{frame=callback;};
 if(event==='warm')video.readyState=2;
 watchVideoLoading({video,isActive:()=>true,onReady:()=>{busy=false;}});
 if(event==='frame')frame();else if(event==='timeupdate'){video.currentTime=1;video.emit(event);}else if(event!=='warm')video.emit(event);
 assert.equal(busy,false);
});

test('loading ignores nonadvancing time and events from a passed card',()=>{
 const video=fakeVideo();let clears=0,active=true;
 watchVideoLoading({video,isActive:()=>active,onReady:()=>{clears++;}});
 video.emit('timeupdate');assert.equal(clears,0);active=false;video.emit('playing');video.currentTime=1;video.emit('timeupdate');assert.equal(clears,0);
});

test('fallback clears loading without waiting for canplay',()=>{
 const video=fakeVideo();let busy=true;
 startProgressiveVideo({video,url,createVideo:fakeVideo,isActive:()=>true,onSwap:()=>{},onError:()=>{},onFallback:()=>{busy=false;}});
 video.onerror();assert.equal(busy,false);
});

for(const time of [0,18])test(`waiting after loadeddata at ${time} preserves the hidden upgrade and same-time swap`,async()=>{
 const {video,full,swaps}=setup();video.readyState=2;video.emit('loadeddata');
 video.currentTime=time;video.emit('waiting');
 assert.equal(video.src,smallerVideoURL(url));assert.equal(video.loads,0);
 assert.equal(full.src,url);assert.equal(full.isConnected,true);assert.equal(full.loads,1);
 full.readyState=2;full.emit('canplay');if(time)full.emit('seeked');await Promise.resolve();
 assert.deepEqual(swaps,[full]);assert.equal(full.currentTime,time);assert.equal(full.paused,false);
});

test('desktop starts at 720p and upgrades to the original',()=>{
 const {video,full}=setup(false);
 assert.equal(video.src,smallerVideoURL(url));
 video.readyState=2;video.emit('loadeddata');
 assert.equal(full.src,url);
});

for(const compact of [false,true])for(const event of ['playing','timeupdate'])test(`warmed ${compact?'phone':'desktop'} video upgrades on ${event} when loadeddata never fires`,async()=>{
 const video=fakeVideo(),swaps=[];let created=0;video.src=smallerVideoURL(url,compact);video.readyState=1;
 const full=fakeVideo();
 startProgressiveVideo({video,url,compact,createVideo:()=>{created++;return full;},onSwap:value=>swaps.push(value),onError:()=>{},isActive:()=>true});
 assert.equal(video.src,smallerVideoURL(url,compact));assert.equal(video.playCalls,1);assert.equal(created,0);
 video.readyState=4;video.currentTime=.5;video.emit(event);
 assert.equal(created,1);assert.equal(full.src,compact?smallerVideoURL(url):url);assert.equal(full.loads,1);
 for(const other of ['loadeddata','playing','timeupdate'])video.emit(other);
 assert.equal(created,1);assert.equal(full.loads,1);
 full.readyState=2;full.emit('canplay');full.emit('seeked');await Promise.resolve();
 assert.deepEqual(swaps,[full]);assert.equal(full.currentTime,.5);
});

test('warmed video events from a passed card do not start an upgrade',()=>{
 const video=fakeVideo();let created=0,active=true;video.src=smallerVideoURL(url);video.readyState=1;
 startProgressiveVideo({video,url,createVideo:()=>{created++;return fakeVideo();},onSwap:()=>{},onError:()=>{},isActive:()=>active});
 active=false;video.readyState=4;video.emit('playing');video.emit('timeupdate');
 assert.equal(created,0);
});

function clocked(t){
 const now=Date.now;let clock=now();Date.now=()=>clock;t.after(()=>{Date.now=now;});
 return {advance:ms=>{clock+=ms;}};
}
function stubbornVideo(){
 const element=fakeVideo();let time=0;
 Object.defineProperty(element,'currentTime',{get:()=>time,set:value=>{element.seeks=(element.seeks||0)+1;time=Math.min(value,time+.01);}});
 return element;
}

test('an upgrade abandoned under contention retries while the same card keeps playing and can then swap',async t=>{
 const clock=clocked(t),video=fakeVideo(),created=[],swaps=[];
 startProgressiveVideo({video,url,compact:true,createVideo:()=>{const element=created.length?fakeVideo():stubbornVideo();created.push(element);return element;},onSwap:value=>swaps.push(value),onError:()=>{},isActive:()=>true});
 video.currentTime=12;video.readyState=2;for(const event of ['loadeddata','playing','timeupdate'])video.emit(event);
 const first=created[0];first.readyState=2;first.emit('canplay');
 for(let index=0;index<20;index++)first.emit('seeked');
 assert.equal(first.src,'');assert.equal(created.length,1);
 clock.advance(4000);video.emit('timeupdate');assert.equal(created.length,1);
 video.pause();clock.advance(2000);video.emit('timeupdate');assert.equal(created.length,1);
 await video.play();video.emit('timeupdate');
 assert.equal(created.length,2);
 const second=created[1];assert.equal(second.src,smallerVideoURL(url));
 second.readyState=2;second.emit('canplay');assert.equal(second.currentTime,12);second.emit('seeked');await Promise.resolve();
 assert.deepEqual(swaps,[second]);
});

test('upgrade retries back off and stop after three attempts',t=>{
 const clock=clocked(t),video=fakeVideo(),created=[];
 startProgressiveVideo({video,url,createVideo:()=>{const element=stubbornVideo();created.push(element);return element;},onSwap:()=>{},onError:()=>{},isActive:()=>true});
 video.currentTime=12;video.readyState=2;for(const event of ['loadeddata','playing','timeupdate'])video.emit(event);
 const fail=element=>{element.readyState=2;element.emit('canplay');for(let index=0;index<20;index++)element.emit('seeked');};
 const waits=[];
 for(let round=0;round<4;round++){
  fail(created.at(-1));const before=created.length;let waited=0;
  while(created.length===before&&waited<60000){clock.advance(1000);waited+=1000;video.emit('timeupdate');}
  waits.push(created.length>before?waited:null);
 }
 assert.deepEqual(waits,[5000,10000,20000,null]);assert.equal(created.length,4);
});

test('a hidden seek that never completes is reissued after four seconds',t=>{
 const clock=clocked(t),video=fakeVideo(),full=fakeVideo();let seeks=0,time=0;
 Object.defineProperty(full,'currentTime',{get:()=>time,set:value=>{seeks++;time=value-.3;}});
 startProgressiveVideo({video,url,createVideo:()=>full,onSwap:()=>{},onError:()=>{},isActive:()=>true});
 video.currentTime=9;video.readyState=2;video.emit('loadeddata');full.readyState=2;full.emit('canplay');
 assert.equal(seeks,1);
 clock.advance(3000);video.emit('timeupdate');full.emit('canplay');assert.equal(seeks,1);
 clock.advance(1500);video.emit('timeupdate');assert.equal(seeks,2);
});

function seekAheadSetup(bufferEnd){
 const video=fakeVideo(),full=fakeVideo(),swaps=[],frames=[];
 full.buffered={length:1,start:()=>0,end:()=>bufferEnd};
 video.requestVideoFrameCallback=callback=>frames.push(callback);
 startProgressiveVideo({video,url,compact:true,createVideo:()=>full,onSwap:value=>swaps.push(value),onError:()=>{},isActive:()=>true,setTimer:()=>{}});
 video.currentTime=1;video.readyState=2;video.emit('loadeddata');
 full.readyState=2;full.emit('canplay');
 const late=()=>{video.currentTime+=.2;full.emit('seeked');};
 return {video,full,swaps,frames,late};
}

test('a late seek inside the buffer is closed by playing the hidden video faster, then swaps on the in-sync frame before restoring the rate',async()=>{
 const {video,full,swaps,late}=seekAheadSetup(5),fullFrames=[];
 full.requestVideoFrameCallback=callback=>fullFrames.push(callback);
 let seeks=0,time=full.currentTime;Object.defineProperty(full,'currentTime',{get:()=>time,set:value=>{seeks++;time=value;}});
 late();
 assert.equal(seeks,0);assert.equal(full.playbackRate,1.5);assert.equal(full.paused,false);assert.deepEqual(swaps,[]);
 time=1.4;video.currentTime=1.3;fullFrames.shift()();
 assert.equal(full.playbackRate,.75);
 time=1.45;video.currentTime=1.44;fullFrames.shift()();
 assert.deepEqual(swaps,[full]);assert.equal(seeks,0);assert.equal(full.playbackRate,1);
});

test('without buffered room ahead the upgrade keeps exact seeks',()=>{
 const {full,late}=seekAheadSetup(1.45);
 late();late();assert.ok(Math.abs(full.currentTime-1.4)<1e-9,`exact seek to ${full.currentTime}`);
});

test('a catch-up that has not converged after eight seconds gives up and retries later',t=>{
 const clock=clocked(t);
 const {video,full,late}=seekAheadSetup(5);
 full.requestVideoFrameCallback=()=>{};
 late();assert.equal(full.playbackRate,1.5);
 clock.advance(7900);video.emit('timeupdate');assert.equal(full.src,url.replace('=original','=m22'));
 clock.advance(200);video.emit('timeupdate');assert.equal(full.src,'');assert.equal(full.isConnected,false);
});

test('videos loop by restarting on ended instead of the native loop attribute',()=>{
 const video=fakeVideo();let active=true;
 loopOnEnd(video,()=>active);
 assert.equal(video.loop,false);
 video.currentTime=3;video.paused=true;video.emit('ended');
 assert.equal(video.currentTime,0);assert.equal(video.paused,false);assert.equal(video.playCalls,1);
 active=false;video.currentTime=3;video.paused=true;video.emit('ended');
 assert.equal(video.currentTime,3);assert.equal(video.playCalls,1);
});

test('the catch-up compares the presented frame time, not the coarser currentTime',()=>{
 const {video,full,swaps,late}=seekAheadSetup(5),fullFrames=[];
 full.requestVideoFrameCallback=callback=>fullFrames.push(callback);
 late();assert.equal(full.playbackRate,1.5);
 full.currentTime=1.3;video.currentTime=1.42;fullFrames.shift()(0,{mediaTime:1.41});
 assert.deepEqual(swaps,[full]);assert.equal(full.playbackRate,1);
});
