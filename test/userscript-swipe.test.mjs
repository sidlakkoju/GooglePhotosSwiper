import test from 'node:test';
import assert from 'node:assert/strict';
import {createSwipeFeedback} from '../lib/userscript-swipe.mjs';
function setup(reduced=false,width=300){
 const handlers={},card={style:{},getBoundingClientRect:()=>({width})},under={style:{}},keep={style:{}},remove={style:{}},decisions=[],frames=new Map();
 let nextFrame=0,allowed=true;
 const target={addEventListener:(name,handler)=>{handlers[name]=handler;},setPointerCapture(){},hasPointerCapture:()=>true,releasePointerCapture(){}};
 const window={matchMedia:()=>({matches:reduced}),requestAnimationFrame:fn=>{frames.set(++nextFrame,fn);return nextFrame;},cancelAnimationFrame:id=>frames.delete(id)};
 const feedback=createSwipeFeedback({window,targets:[target],card,under,keep,remove,canSwipe:()=>allowed,onDecide:value=>decisions.push(value)});
 const send=(type,x,y=0,id=1,timeStamp=undefined,eventTarget={tagName:'IMG'})=>handlers[type]({pointerId:id,clientX:x,clientY:y,button:0,isPrimary:true,timeStamp,target:eventTarget});
 const paint=()=>{for(const [id,fn] of frames){frames.delete(id);fn();}};
 return {send,paint,card,under,keep,remove,decisions,frames,feedback,block:()=>{allowed=false;}};
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
 for(const end of ['pointerup','pointercancel','lostpointercapture']){
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
 const s=setup();s.send('pointerdown',0);s.send('pointermove',120,90);s.paint();
 assert.equal(s.keep.style.opacity,'0');assert.equal(s.under.style.transform,'scale(0.94)');
 s.send('pointerup',120,90);assert.deepEqual(s.decisions,[]);
});
for(const width of [200,600])test(`commit distance follows a ${width}px card`,()=>{
 const s=setup(false,width);s.send('pointerdown',0);s.send('pointermove',width*.3);s.paint();
 assert.ok(Number(s.keep.style.opacity)<1);s.send('pointerup',width*.3);assert.deepEqual(s.decisions,[]);
 s.send('pointerdown',0);s.send('pointerup',width*.34);assert.deepEqual(s.decisions,['keep']);
});
test('a short fast fling commits, but a held short drag does not',()=>{
 for(const delay of [30,300]){
  const s=setup();s.send('pointerdown',0,0,1,0);s.send('pointermove',30,0,1,30);s.send('pointerup',40,0,1,delay+30);
  assert.deepEqual(s.decisions,[]);
 }
 const s=setup();s.send('pointerdown',0,0,1,0);s.send('pointerup',40,0,1,40);assert.deepEqual(s.decisions,['keep']);
});
for(const end of ['pointercancel','lostpointercapture'])test(`${end} cancels a committable drag and queued paint`,()=>{
 const s=setup();s.send('pointerdown',0);s.send('pointermove',200);s.send(end,200);s.paint();
 assert.deepEqual(s.decisions,[]);assert.equal(s.card.style.transform,'');assert.equal(s.keep.style.opacity,'0');
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
 s.card.animate=(frames,options)=>{assert.match(frames[1].transform,/translate3d/);assert.equal(options.duration,180);return {finished:new Promise(resolve=>{complete=resolve;}),cancel:()=>{cancelled=true;}};};
 s.send('pointerdown',0);s.send('pointerup',150);
 assert.deepEqual(s.decisions,['keep']);assert.match(s.card.style.transform,/450px/);
 complete();await s.feedback.finished;assert.match(s.card.style.transform,/450px/);
 s.feedback.reset();assert.equal(s.card.style.transform,'');assert.equal(cancelled,true);
 const reduced=setup(true);reduced.card.animate=()=>assert.fail('Reduced motion must skip animation');reduced.send('pointerdown',0);reduced.send('pointerup',150);
 assert.deepEqual(reduced.decisions,['keep']);assert.equal(reduced.card.style.transform,'');
});

test('a fast return toward the origin cannot fling in the original direction',()=>{
 const s=setup();s.send('pointerdown',0,0,1,0);s.send('pointermove',80,0,1,100);s.send('pointerup',40,0,1,120);
 assert.deepEqual(s.decisions,[]);
});
