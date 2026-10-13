import test from 'node:test';
import assert from 'node:assert/strict';
import {createVideoTimeline,restoreVideoTime} from '../lib/userscript-ui.mjs';
import {createSwipeFeedback} from '../lib/userscript-swipe.mjs';

function fixture(){
 const video={duration:120,currentTime:0,dataset:{resumeReady:'pending'},listeners:{},addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}};
 const document={createElement:()=>({dataset:{},style:{},listeners:{},setAttribute(){},addEventListener(type,fn){this.listeners[type]=fn;},getBoundingClientRect:()=>({left:100,width:400}),setPointerCapture(){},closest:()=>({})})};
 let captures=0;
 const [timeline,label]=createVideoTimeline({document,video,onSeek:()=>captures++});
 const event=(x,extra={})=>({clientX:x,clientY:0,pointerId:1,button:0,isPrimary:true,target:timeline,stopPropagation(){},preventDefault(){},...extra});
 return {video,timeline,label,event,get captures(){return captures;}};
}

for(const view of ['card','enlarged inspection'])for(const pointerType of ['mouse','touch']){
 test(`${view} timeline seeks at 75% with ${pointerType} and updates time immediately`,()=>{
  const f=fixture();
  f.timeline.listeners.pointerdown(f.event(400,{pointerType}));
  f.timeline.listeners.pointerup(f.event(400,{pointerType}));
  f.timeline.listeners.click(f.event(400,{pointerType}));
  assert.equal(f.video.currentTime,90);
  assert.equal(f.timeline.value,'0.75');
  assert.equal(f.label.textContent,'1:30 / 2:00');
  assert.ok(f.captures>0);
 });
}

test('metadata restore runs once and cannot overwrite a timeline seek',()=>{
 const f=fixture();
 f.timeline.listeners.click(f.event(400));
 restoreVideoTime(f.video,12);
 assert.equal(f.video.currentTime,90);
 f.video.dataset.resumeReady='pending';
 restoreVideoTime(f.video,12);
 assert.equal(f.video.currentTime,12);
 f.timeline.listeners.click(f.event(400));
 restoreVideoTime(f.video,12);
 assert.equal(f.video.currentTime,90);
});

test('timeline drag never captures the card or triggers a swipe decision',()=>{
 const f=fixture(),handlers={},globalHandlers={};let decisions=0,captures=0;
 const card={style:{},getBoundingClientRect:()=>({width:800})};
 createSwipeFeedback({window:{addEventListener:(type,fn)=>globalHandlers[type]=fn},targets:[{addEventListener:(type,fn)=>handlers[type]=fn,setPointerCapture(){captures++;}}],card,under:{style:{}},keep:{style:{}},remove:{style:{}},canSwipe:()=>true,onDecide:()=>decisions++});
 for(const pointerType of ['mouse','touch']){
  handlers.pointerdown(f.event(100,{pointerType}));
  f.timeline.listeners.pointerdown(f.event(100,{pointerType}));
  globalHandlers.pointermove(f.event(400,{pointerType}));
  f.timeline.listeners.pointermove(f.event(400,{pointerType}));
  globalHandlers.pointerup(f.event(400,{pointerType}));
  f.timeline.listeners.pointerup(f.event(400,{pointerType}));
 }
 assert.equal(f.video.currentTime,90);
 assert.equal(decisions,0);
 assert.equal(captures,0);
 assert.equal(card.style.transform,'');
});
