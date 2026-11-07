import test from 'node:test';
import assert from 'node:assert/strict';
import {createVideoQuality,createVideoTimeline,restoreVideoTime,videoResolution} from '../lib/userscript-ui.mjs';
import {createSwipeFeedback} from '../lib/userscript-swipe.mjs';

function fixture(){
 const video={duration:120,currentTime:0,dataset:{resumeReady:'pending'},listeners:{},addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}};
 const document={createTextNode:textContent=>({textContent}),createElement:()=>({dataset:{},style:{},listeners:{},childNodes:[],append(...nodes){this.childNodes.push(...nodes);},setAttribute(){},addEventListener(type,fn){this.listeners[type]=fn;},getBoundingClientRect:()=>({left:100,width:400}),setPointerCapture(){},closest:()=>({})})};
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
  assert.equal(f.label.childNodes[0].textContent,'1:30 / 2:00');
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

test('the resolution reads the shorter side of the frame the video element is showing',()=>{
 assert.equal(videoResolution({videoWidth:1920,videoHeight:1080}),'1080p');
 assert.equal(videoResolution({videoWidth:720,videoHeight:1280}),'720p');
 assert.equal(videoResolution({videoWidth:256,videoHeight:144}),'144p');
 assert.equal(videoResolution({videoWidth:0,videoHeight:0}),'');
 assert.equal(videoResolution({}),'');
});

test('the resolution badge stays hidden until metadata, follows resizes and source changes, and shows the spinner only when told',()=>{
 const f=fixture(),video=f.video;video.videoWidth=0;video.videoHeight=0;
 const document={createElement:()=>({dataset:{},childNodes:[],hidden:false,textContent:'',setAttribute(key,value){this[key]=value;},append(...nodes){this.childNodes.push(...nodes);}})};
 const {badge,setLoading}=createVideoQuality({document,video});
 const [text,spinner]=badge.childNodes;
 assert.equal(badge.dataset.videoQuality,'badge');assert.equal(badge.hidden,true);assert.equal(spinner.hidden,true);assert.equal(spinner['aria-label'],'Loading a sharper version');
 video.videoWidth=640;video.videoHeight=360;for(const fn of video.listeners.loadedmetadata)fn();
 assert.equal(badge.hidden,false);assert.equal(text.textContent,'360p');
 video.videoWidth=1280;video.videoHeight=720;for(const fn of video.listeners.resize)fn();
 assert.equal(text.textContent,'720p');
 video.videoWidth=0;video.videoHeight=0;for(const fn of video.listeners.emptied)fn();
 assert.equal(badge.hidden,true);
 setLoading(true);assert.equal(spinner.hidden,false);setLoading(false);assert.equal(spinner.hidden,true);
 const swapped=createVideoQuality({document,video:{videoWidth:1920,videoHeight:1080,addEventListener(){}},loading:true});
 assert.equal(swapped.badge.hidden,false);assert.equal(swapped.badge.childNodes[0].textContent,'1080p');assert.equal(swapped.badge.childNodes[1].hidden,false);
});

test('the time label keeps the time in its own text so the badge beside it survives every update',()=>{
 const f=fixture(),badge={dataset:{videoQuality:'badge'}};f.label.append(badge);
 f.timeline.listeners.click(f.event(400));
 assert.equal(f.label.childNodes[0].textContent,'1:30 / 2:00');assert.equal(f.label.childNodes[1],badge);
});
