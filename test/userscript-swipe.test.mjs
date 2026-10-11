import test from 'node:test';
import assert from 'node:assert/strict';
import {createSwipeFeedback} from '../lib/userscript-swipe.mjs';
function setup(reduced=false){
 const handlers={},card={style:{},getBoundingClientRect:()=>({width:300})},under={style:{}},keep={style:{}},remove={style:{}},decisions=[],frames=new Map();
 let nextFrame=0,allowed=true;
 const target={addEventListener:(name,handler)=>{handlers[name]=handler;},setPointerCapture(){},hasPointerCapture:()=>true,releasePointerCapture(){}};
 const window={matchMedia:()=>({matches:reduced}),requestAnimationFrame:fn=>{frames.set(++nextFrame,fn);return nextFrame;},cancelAnimationFrame:id=>frames.delete(id)};
 const feedback=createSwipeFeedback({window,targets:[target],card,under,keep,remove,canSwipe:()=>allowed,onDecide:value=>decisions.push(value)});
 const send=(type,x,y=0,id=1)=>handlers[type]({pointerId:id,clientX:x,clientY:y,button:0,isPrimary:true,target:{tagName:'IMG'}});
 const paint=()=>{for(const [id,fn] of frames){frames.delete(id);fn();}};
 return {send,paint,card,under,keep,remove,decisions,frames,feedback,block:()=>{allowed=false;}};
}
for(const direction of [-1,1])test(`drag feedback follows direction ${direction} and saturates at the commit threshold`,()=>{
 const s=setup();s.send('pointerdown',0);s.send('pointermove',direction*32.5,5);
 assert.equal(s.frames.size,1);s.paint();
 assert.match(s.card.style.transform,new RegExp(`translate3d\\(${direction*32.5}px,1px,0\\)`));
 assert.match(s.card.style.transform,/scale\(1.02\)/);
 assert.equal((direction>0?s.keep:s.remove).style.opacity,'0.5');assert.equal(s.under.style.transform,'scale(0.97)');
 s.send('pointermove',direction*1000);s.paint();assert.match(s.card.style.transform,new RegExp(`rotate\\(${direction*15}deg\\)`));
 assert.equal((direction>0?s.keep:s.remove).style.opacity,'1');assert.equal(s.under.style.transform,'scale(1)');
 s.send('pointerup',direction*1000);assert.deepEqual(s.decisions,[direction>0?'keep':'remove']);assert.equal(s.card.style.transform,'');
});
test('vertical, short, cancelled and unrelated pointers never commit',()=>{
 for(const end of ['pointerup','pointercancel','lostpointercapture']){
  const s=setup();s.send('pointerdown',0);s.send('pointermove',40);s.send('pointermove',200,0,2);s.send(end,40);s.paint();
  assert.deepEqual(s.decisions,[]);assert.equal(s.card.style.transform,'');assert.equal(s.keep.style.opacity,'0');
 }
 const s=setup();s.send('pointerdown',0);s.send('pointermove',15,30);s.send('pointerup',150,30);assert.deepEqual(s.decisions,[]);
});
test('reset cancels queued paint and reduced motion retains stamps without tilt',()=>{
 const s=setup(true);s.send('pointerdown',0);s.send('pointermove',70);s.paint();assert.equal(s.card.style.transform,'');assert.equal(s.keep.style.opacity,'1');
 s.send('pointermove',100);s.feedback.reset();s.paint();assert.equal(s.keep.style.opacity,'0');assert.equal(s.frames.size,0);
 s.block();s.send('pointerdown',0);s.send('pointerup',100);assert.deepEqual(s.decisions,[]);
});
