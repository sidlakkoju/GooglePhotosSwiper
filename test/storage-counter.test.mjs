import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionStorageCounter,formatStorageBytes,createStorageCapsule} from '../lib/userscript-counter.mjs';
const item=(mediaKey,options={})=>({mediaKey,decision:'remove',state:'active',size:38.2e6,...options});
test('session storage counts queued and newly trashed metadata without prior Trash history',()=>{
 const counter=createSessionStorageCounter();counter.total([]);
 const items=[item('old',{state:'in_trash'}),item('queued'),item('sent',{queueSent:true,spaceTaken:5e6}),item('free',{takesUpSpace:false}),item('unknown',{size:null})];
 assert.equal(counter.total(items),43.2e6);
 items[1].state='in_trash';assert.equal(counter.total(items),43.2e6);
 counter.reset(items);assert.equal(counter.total(items),0);assert.equal(counter.total(items),0);
 items.push(item('new'));assert.equal(counter.total(items),38.2e6);
 items.at(-1).decision=null;assert.equal(counter.total(items),0);
});
test('counter reset permits a retained item to be kept and queued again',()=>{
 const counter=createSessionStorageCounter(),items=[item('a')];assert.equal(counter.total(items),38.2e6);
 counter.reset(items);assert.equal(counter.total(items),0);items[0].decision='keep';counter.total(items);items[0].decision='remove';assert.equal(counter.total(items),38.2e6);
});
test('reset excludes only submitted items and preserves queued items after hydration',()=>{
 const counter=createSessionStorageCounter(),submitted=item('submitted'),queued=item('queued',{size:5e6}),synced=item('synced',{needsPreview:true,size:7e6});
 const items=[submitted,queued,synced];
 assert.equal(counter.total(items),43.2e6);
 submitted.state='in_trash';counter.reset([submitted]);
 assert.equal(counter.total(items),5e6);
 synced.needsPreview=false;
 assert.equal(counter.total(items),12e6);
 assert.equal(counter.total(items),12e6);
});
test('storage formatting follows approved decimal units and precision',()=>{
 assert.equal(formatStorageBytes(0),'0.00 MB');assert.equal(formatStorageBytes(38.2e6),'38.2 MB');assert.equal(formatStorageBytes(500e6),'500 MB');assert.equal(formatStorageBytes(1.24e9),'1.24 GB');
});

function capsuleFixture({reduced=false}={}){
 const node=()=>({children:[],style:{setProperty(key,value){this[key]=value;}},attributes:{},classList:{values:new Set(),add(value){this.values.add(value);},remove(value){this.values.delete(value);}},append(...children){this.children.push(...children);},replaceChildren(){this.children=[];},setAttribute(key,value){this.attributes[key]=value;}});
 let now=0,id=0;const frames=new Map(),motion={matches:reduced,addEventListener(type,callback){this.change=callback;}},window={performance:{now:()=>now},matchMedia:()=>motion,requestAnimationFrame:callback=>{frames.set(++id,callback);return id;},cancelAnimationFrame:id=>frames.delete(id)};
 const document={createElement:tag=>tag==='canvas'?{getContext:()=>({measureText:()=>({width:7})})}:node(),createElementNS:()=>node(),addEventListener(){}};
 const element=node(),capsule=createStorageCapsule({document,window,root:node(),element,isVisible:()=>true});
 const svg=element.children[0].children[0].children[0],face=element.children[0].children[0].children[1],chip=element.children[1];
 const tick=time=>{now=time;const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback(now);};
 const transforms=()=>face.children.map(glyph=>glyph.style.transform);
 const centerX=()=>Number(/translate\(([-\d.]+)px/.exec(face.children[Math.floor(face.children.length/2)].style.transform)[1]);
 return {capsule,element,svg,chip,frames,motion,tick,transforms,centerX};
}

test('capsule stays still while idle and unchanged updates do not restart a turn',()=>{
 const {capsule,frames,tick,transforms}=capsuleFixture();
 capsule.update(0);const idle=transforms();tick(2000);capsule.update(0,{animate:true,delta:1e6});
 assert.equal(frames.size,0);assert.deepEqual(transforms(),idle);
 capsule.update(1e6);tick(2050);assert.equal(frames.size,1);capsule.update(1e6);tick(2550);
 assert.equal(frames.size,0);const settled=transforms();tick(5000);capsule.update(1e6);assert.deepEqual(transforms(),settled);
});

for(const [name,initial,next,direction] of [['right',0,1e6,1],['left',1e6,0,-1]])test(`capsule rotates ${name} when the value ${direction>0?'increases':'decreases'}`,()=>{
 const {capsule,frames,tick,centerX,transforms}=capsuleFixture();
 capsule.update(initial);const restingX=centerX();capsule.update(next);assert.equal(frames.size,1);tick(25);
 assert.ok(direction*(centerX()-restingX)>0);tick(550);assert.equal(frames.size,0);
 const settled=transforms();tick(2000);assert.deepEqual(transforms(),settled);
});

test('capsule follows logarithmic heat, count-up and immediate reset',()=>{
 const {capsule,svg,element,chip,frames,tick}=capsuleFixture();
 capsule.update(0);assert.equal(svg.attributes.width,78);assert.equal(svg.attributes.height,32);assert.equal(svg.children[1].attributes.fill,'rgba(52,199,89,1)');
 capsule.update(50e9,{animate:false});assert.equal(svg.attributes.width,116);assert.equal(svg.attributes.height,38);assert.equal(svg.children[1].attributes.fill,'rgba(255,69,58,1)');
 capsule.reset();assert.equal(svg.attributes.width,78);assert.match(element.attributes['aria-label'],/^0.00 MB/);
 capsule.update(38.2e6,{animate:true,delta:38.2e6});assert.equal(chip.textContent,'+38.2 MB');tick(100);assert.ok(svg.attributes.width>78);assert.ok(svg.attributes.width<116);
 capsule.reset();assert.equal(frames.size,0);tick(1800);assert.equal(svg.attributes.width,78);assert.match(element.attributes['aria-label'],/^0.00 MB/);
});

test('capsule respects reduced motion and stops a running turn when the preference changes',()=>{
 const {capsule,frames,motion,chip,element}=capsuleFixture({reduced:true});
 capsule.update(0);capsule.update(38.2e6,{animate:true,delta:38.2e6});assert.equal(frames.size,0);assert.equal(chip.classList.values.has('go'),false);assert.match(element.attributes['aria-label'],/^38.2 MB/);
 motion.matches=false;capsule.update(0);assert.equal(frames.size,1);motion.matches=true;motion.change();assert.equal(frames.size,0);
});
