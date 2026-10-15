import test from 'node:test';
import assert from 'node:assert/strict';
import {createSwipeFeedback} from '../lib/userscript-swipe.mjs';
function setup(reduced=false,width=300){
 const handlers={},windowHandlers={},listenerOptions={},card={style:{},getBoundingClientRect:()=>({width}),querySelector:()=>null},under={style:{}},keep={style:{}},remove={style:{}},decisions=[],frames=new Map();
 let nextFrame=0,allowed=true;
 const target={addEventListener:(name,handler,options)=>{handlers[name]=handler;listenerOptions[name]=options;},setPointerCapture(){},hasPointerCapture:()=>true,releasePointerCapture(){},querySelector:sel=>sel==='video'?null:null};
 const window={addEventListener:(name,handler,capture)=>{assert.equal(capture,true);windowHandlers[name]=handler;},matchMedia:()=>({matches:reduced}),requestAnimationFrame:fn=>{frames.set(++nextFrame,fn);return nextFrame;},cancelAnimationFrame:id=>frames.delete(id)};
 const feedback=createSwipeFeedback({window,targets:[target],card,under,keep,remove,canSwipe:()=>allowed,onDecide:value=>decisions.push(value)});
 const send=(type,x,y=0,id=1,timeStamp=undefined,eventTarget={tagName:'IMG'})=>handlers[type]?.({pointerId:id,clientX:x,clientY:y,button:0,isPrimary:true,timeStamp,target:eventTarget,pointerType:'touch',preventDefault(){}});
 const paint=()=>{for(const [id,fn] of frames){frames.delete(id);fn();}};
 const sendWindow=(type,x,y=0,id=1,timeStamp=undefined)=>windowHandlers[type]?.({pointerId:id,clientX:x,clientY:y,timeStamp,preventDefault(){}});
 const touchmove=(cancelable=true)=>{let prevented=false;handlers.touchmove?.({cancelable,preventDefault:()=>{prevented=true;}});return prevented;};
 return {send,sendWindow,paint,touchmove,listenerOptions,card,under,keep,remove,decisions,frames,feedback,block:()=>{allowed=false;}};
}
for(const direction of [-1,1])test(`drag feedback follows direction ${direction} and saturates at the commit threshold`,()=>{
 const s=setup();s.send('pointerdown',0);s.send('pointermove',direction*49.5,5);
 assert.equal(s.frames.size,1);s.paint();
 assert.match(s.card.style.transform,new RegExp(`translate3d\\(${direction*49.5}px,1px,0\\)`));
 assert.match(s.card.style.transform,/scale\(1.02\)/);
 assert.equal((direction>0?s.keep:s.remove).style.opacity,'0.5');assert.equal(s.under.style.transform,'scale(0.97)');
 s.send('pointermove',direction*1000);s.paint();assert.match(s.card.style.transform,new RegExp(`rotate\\(${direction*15}deg\\)`));
 assert.equal((direction>0?s.keep:s.remove).style.opacity,'1');assert.equal(s.under.style.transform,'scale(1)');
 s.send('pointerup',direction*1000);assert.deepEqual(s.decisions,[direction>0?'keep':'remove']);assert.match(s.card.style.transform,/translate3d/);
 s.feedback.reset();assert.equal(s.card.style.transform,'');
});
test('vertical, short, cancelled and unrelated pointers never commit',()=>{
 for(const end of ['pointerup','pointercancel']){
  const s=setup();s.send('pointerdown',0);s.send('pointermove',40);s.send('pointermove',200,0,2);s.send(end,40);s.paint();
  assert.deepEqual(s.decisions,[]);assert.equal(s.card.style.transform,'');assert.equal(s.keep.style.opacity,'0');
 }
 const s=setup();s.send('pointerdown',0);s.send('pointermove',15,30);s.send('pointerup',150,30);assert.deepEqual(s.decisions,[]);
});
test('reset cancels queued paint and reduced motion retains stamps without tilt',()=>{
 const s=setup(true);s.send('pointerdown',0);s.send('pointermove',100);s.paint();assert.equal(s.card.style.transform,'');assert.equal(s.keep.style.opacity,'1');
 s.send('pointermove',100);s.feedback.reset();s.paint();assert.equal(s.keep.style.opacity,'0');assert.equal(s.frames.size,0);
 s.block();s.send('pointerdown',0);s.send('pointerup',100);assert.deepEqual(s.decisions,[]);
});

test('a locked diagonal drag never advertises or commits a decision',()=>{
 for(const [dx,dy] of [[70,50],[120,90]]){
  const s=setup();s.send('pointerdown',0);s.send('pointermove',30);s.send('pointermove',dx,dy);s.paint();
  assert.equal(s.keep.style.opacity,'0');assert.equal(s.under.style.transform,'scale(0.94)');
  s.send('pointerup',dx,dy);assert.deepEqual(s.decisions,[]);
 }
});
for(const width of [200,600])test(`commit distance follows a ${width}px card`,()=>{
 const s=setup(false,width);s.send('pointerdown',0);s.send('pointermove',width*.3);s.paint();
 assert.ok(Number(s.keep.style.opacity)<1);s.send('pointerup',width*.3);assert.deepEqual(s.decisions,[]);
 s.send('pointerdown',0);s.send('pointerup',width*.34);assert.deepEqual(s.decisions,['keep']);
});
test('a short fast fling commits, but a held short drag does not',()=>{
 for(const delay of [30,300]){
  const s=setup();s.send('pointerdown',0,0,1,0);s.send('pointermove',30,0,1,30);s.send('pointerup',40,0,1,delay+30);
  assert.deepEqual(s.decisions,delay===30?['keep']:[]);
 }
 const s=setup();s.send('pointerdown',0,0,1,0);s.send('pointerup',40,0,1,40);assert.deepEqual(s.decisions,['keep']);
});
for(const end of ['pointercancel'])test(`${end} cancels a committable drag and queued paint`,()=>{
 const s=setup();s.send('pointerdown',0);s.send('pointermove',200);s.send(end,200);s.paint();
 assert.deepEqual(s.decisions,[]);assert.equal(s.card.style.transform,'');assert.equal(s.keep.style.opacity,'0');
});
for(const direction of [-1,1])test(`pointercancel after a locked ${direction>0?'right':'left'} swipe past threshold springs back and never commits`,()=>{
 const s=setup();const animations=[];
 s.card.animate=(frames,options)=>{animations.push({frames,options});return {finished:Promise.resolve(),cancel(){}};};
 s.send('pointerdown',0);s.send('pointermove',direction*200);s.paint();
 const mid=s.card.style.transform;assert.match(mid,/translate3d/);
 s.send('pointercancel',direction*200);
 assert.deepEqual(s.decisions,[]);
 assert.equal(s.card.style.transform,'');
 assert.equal(animations.length,1);
 assert.equal(animations[0].options.duration,180);
 assert.equal(animations[0].frames[0].transform,mid);
 assert.equal(animations[0].frames[1].transform,'none');
});
test('pointercancel after a locked short drag springs back and never commits',()=>{
 const s=setup();const animations=[];
 s.card.animate=(frames,options)=>{animations.push({frames,options});return {finished:Promise.resolve(),cancel(){}};};
 s.send('pointerdown',0);s.send('pointermove',40);s.paint();
 const mid=s.card.style.transform;assert.match(mid,/translate3d/);
 s.send('pointercancel',40);
 assert.deepEqual(s.decisions,[]);assert.equal(animations.length,1);assert.equal(animations[0].options.duration,180);assert.equal(animations[0].frames[0].transform,mid);
});
test('touchmove after horizontal lock is non-passive and preventDefaulted',()=>{
 const s=setup();
 assert.deepEqual(s.listenerOptions.touchmove,{passive:false});
 assert.equal(s.touchmove(),false);
 s.send('pointerdown',0);s.send('pointermove',5);assert.equal(s.touchmove(),false);
 s.send('pointermove',40);assert.equal(s.touchmove(),true);
 assert.equal(s.touchmove(false),false);
});
test('swipe CSS uses touch-action none on card, media, and swipe strip',async()=>{
 const source=await import('node:fs/promises').then(fs=>fs.readFile(new URL('../lib/userscript-ui.mjs',import.meta.url),'utf8'));
 assert.match(source,/\.card\{touch-action:none/);
 assert.match(source,/\.media\{touch-action:none/);
 assert.match(source,/\.swipe\{[^}]*touch-action:none/);
 assert.doesNotMatch(source,/overflow-x:hidden/);
});
test('video taps toggle playback and video drags decide without toggling',()=>{
 const s=setup();let plays=0,pauses=0;
 const video={tagName:'VIDEO',paused:true,play:()=>{plays++;return Promise.resolve();},pause:()=>{pauses++;}};
 for(const paused of [true,false]){video.paused=paused;s.send('pointerdown',0,0,1,undefined,video);s.send('pointerup',0);}
 assert.equal(plays,1);assert.equal(pauses,1);
 s.send('pointerdown',0,0,1,undefined,video);s.send('pointerup',150);assert.deepEqual(s.decisions,['keep']);assert.equal(pauses,1);
});
test('dismissal retains its destination until reset and respects reduced motion',async()=>{
 const s=setup();let complete,cancelled=false;
 s.card.animate=(frames,options)=>{assert.match(frames[1].transform,/translate3d/);assert.equal(options.duration,280);return {finished:new Promise(resolve=>{complete=resolve;}),cancel:()=>{cancelled=true;}};};
 s.send('pointerdown',0);s.send('pointerup',150);
 assert.deepEqual(s.decisions,['keep']);assert.match(s.card.style.transform,/390px/);
 complete();await s.feedback.finished;assert.match(s.card.style.transform,/390px/);
 s.feedback.reset();assert.equal(s.card.style.transform,'');assert.equal(cancelled,true);
 const reduced=setup(true);reduced.card.animate=()=>assert.fail('Reduced motion must skip animation');reduced.send('pointerdown',0);reduced.send('pointerup',150);
 assert.deepEqual(reduced.decisions,['keep']);assert.equal(reduced.card.style.transform,'');
});

test('a fast return toward the origin cannot fling in the original direction',()=>{
 const s=setup();s.send('pointerdown',0,0,1,0);s.send('pointermove',80,0,1,100);s.send('pointerup',40,0,1,120);
 assert.deepEqual(s.decisions,[]);
});

test('capture transfer and capture loss before release preserve a swipe',()=>{
 for(const video of [false,true]){
  const s=setup();s.send('pointerdown',0,0,1,0,{tagName:video?'VIDEO':'IMG'});
  s.send('lostpointercapture',0);s.send('pointermove',120,0,1,100);
  s.send('lostpointercapture',120);s.send('pointerup',120,0,1,110);
  assert.deepEqual(s.decisions,['keep']);
 }
});
test('velocity averaging rejects millisecond jitter and retains a fling across release',()=>{
 const jitter=setup();jitter.send('pointerdown',0,0,1,0);jitter.send('pointermove',20,0,1,200);jitter.send('pointermove',21,0,1,201);jitter.send('pointerup',21,0,1,202);
 assert.deepEqual(jitter.decisions,[]);
 const fling=setup();fling.send('pointerdown',0,0,1,0);fling.send('pointermove',40,0,1,40);fling.send('pointerup',40,0,1,60);
 assert.deepEqual(fling.decisions,['keep']);
});

test('outgoing card animation survives resetting the live card and removes its clone',async()=>{
 const s=setup();let finish,removed=false,outgoing;
 s.card.parentNode={append(node){outgoing=node;}};
 s.card.cloneNode=()=>({style:{...s.card.style},setAttribute(){},animate(){return {finished:new Promise(resolve=>{finish=resolve;})};},remove(){removed=true;}});
 s.send('pointerdown',0);s.send('pointerup',150);
 assert.match(outgoing.style.transform,/390px/);assert.equal(outgoing.inert,true);
 assert.equal(s.card.style.visibility,'hidden');assert.equal(outgoing.style.visibility,'');
 s.feedback.reset();assert.equal(s.card.style.transform,'');assert.equal(s.card.style.visibility,'');assert.equal(removed,false);
 finish();await new Promise(resolve=>setTimeout(resolve,0));
 s.send('pointerdown',0);s.send('pointerup',-150);assert.deepEqual(s.decisions,['keep','remove']);
 finish();await s.feedback.finished;
 assert.equal(removed,true);
});

test('capture loss finishes outside the swipe target before overlay propagation stops',()=>{
 const s=setup();
 s.send('pointerdown',0,0,1,0,{tagName:'VIDEO'});
 s.send('lostpointercapture',0);
 s.sendWindow('pointermove',120,0,1,100);
 s.paint();assert.equal(s.keep.style.opacity,'1');
 s.sendWindow('pointerup',120,0,1,110);
 s.send('pointerup',120,0,1,110);
 assert.deepEqual(s.decisions,['keep']);
});
test('window cancellation after capture loss resets the gesture for another swipe',()=>{
 const s=setup();
 s.send('pointerdown',0);s.send('lostpointercapture',0);
 s.sendWindow('pointermove',120);s.sendWindow('pointercancel',120);s.paint();
 assert.deepEqual(s.decisions,[]);assert.equal(s.card.style.transform,'');
 s.send('pointerdown',0);s.sendWindow('pointerup',-120);
 assert.deepEqual(s.decisions,['remove']);
});

for(const direction of [-1,1])test(`a pause before a short fling uses only recent samples in direction ${direction}`,()=>{
 const s=setup();
 s.send('pointerdown',0,0,1,0);
 s.send('pointermove',direction*10,0,1,1000);
 s.send('pointermove',direction*40,0,1,1030);
 s.send('pointerup',direction*50,0,1,1040);
 assert.deepEqual(s.decisions,[direction>0?'keep':'remove']);
});

test('pointermove batches all style writes and reads width only at pointerdown',()=>{
 const s=setup();let reads=0,writes=0;
 s.card.getBoundingClientRect=()=>{reads++;return {width:300};};
 for(const element of [s.card,s.under,s.keep,s.remove])element.style=new Proxy(element.style,{set(target,key,value){writes++;target[key]=value;return true;}});
 s.send('pointerdown',0);
 assert.equal(reads,1);
 const initialWrites=writes;
 for(let x=20;x<=120;x+=20)s.send('pointermove',x);
 assert.equal(writes,initialWrites);assert.equal(reads,1);assert.equal(s.frames.size,1);
 s.paint();assert.match(s.card.style.transform,/120px/);assert.equal(s.card.style.willChange,'transform');
 s.send('pointerup',120);assert.equal(reads,1);assert.equal(s.card.style.willChange,'');assert.equal(s.frames.size,0);
});

test('reduced motion fades an outgoing copy for 150ms while the next card resets immediately',async()=>{
 const s=setup(true);let complete,outgoing,frames,options,removed=false;
 s.card.parentNode={append(node){outgoing=node;}};
 s.card.cloneNode=()=>({style:{...s.card.style},setAttribute(){},removeAttribute(){},animate(values,timing){frames=values;options=timing;return {finished:new Promise(resolve=>{complete=resolve;})};},remove(){removed=true;}});
 s.send('pointerdown',0);s.send('pointermove',120);s.paint();
 assert.equal(s.card.style.transform,'');assert.equal(s.under.style.transform,'');assert.equal(s.card.style.willChange,'');
 s.send('pointerup',120);
 assert.deepEqual(s.decisions,['keep']);assert.deepEqual(frames,[{opacity:1},{opacity:0}]);assert.equal(options.duration,150);
 assert.equal(outgoing.style.transform,'');assert.equal(outgoing.style.willChange,'');
 s.feedback.reset();assert.equal(s.card.style.visibility,'');assert.equal(removed,false);
 complete();await new Promise(resolve=>setImmediate(resolve));assert.equal(removed,true);
});
for(const [name,move] of [['zero-move',null],['sub-slop',[6,4]],['vertical-cancelled',[4,30]]])test(`pointercancel before the horizontal lock (${name}) resets without a spring or decision`,()=>{
 const s=setup();const animations=[];
 s.card.animate=(...args)=>{animations.push(args);return {finished:Promise.resolve(),cancel(){}};};
 s.send('pointerdown',0);if(move)s.send('pointermove',...move);
 s.send('pointercancel',move?.[0]??0,move?.[1]??0);s.paint();
 assert.deepEqual(s.decisions,[]);assert.equal(animations.length,0);assert.equal(s.frames.size,0);
 assert.equal(s.card.style.transform||'','');assert.equal(s.keep.style.opacity||'0','0');assert.equal(s.remove.style.opacity||'0','0');
 s.send('pointerdown',0);s.send('pointerup',150);assert.deepEqual(s.decisions,['keep']);
});
test('vertical drags on a video and drags from video control buttons never decide or toggle playback',()=>{
 const s=setup();let toggles=0;
 const video={tagName:'VIDEO',paused:true,closest:()=>null,play:()=>{toggles++;return Promise.resolve();},pause:()=>{toggles++;}};
 s.send('pointerdown',0,0,1,undefined,video);s.send('pointermove',4,40,1,undefined,video);s.send('pointerup',150,40,1,undefined,video);
 const button={tagName:'BUTTON',closest:selector=>selector.includes('[data-video-control]')?button:null};
 s.send('pointerdown',0,0,1,undefined,button);s.send('pointermove',150,0,1,undefined,button);s.send('pointerup',150,0,1,undefined,button);
 assert.deepEqual(s.decisions,[]);assert.equal(toggles,0);assert.equal(s.card.style.transform||'','');
});
