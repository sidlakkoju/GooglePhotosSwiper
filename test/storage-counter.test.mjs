import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionStorageCounter,formatStorageBytes} from '../lib/userscript-counter.mjs';
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
test('storage formatting follows approved decimal units and precision',()=>{
 assert.equal(formatStorageBytes(0),'0.00 MB');assert.equal(formatStorageBytes(38.2e6),'38.2 MB');assert.equal(formatStorageBytes(500e6),'500 MB');assert.equal(formatStorageBytes(1.24e9),'1.24 GB');
});

test('capsule follows logarithmic heat, orbit timing, count-up and immediate reset',async()=>{
 const {createStorageCapsule}=await import('../lib/userscript-counter.mjs');
 const node=()=>({children:[],style:{setProperty(key,value){this[key]=value;}},attributes:{},classList:{add(){},remove(){}},append(...children){this.children.push(...children);},replaceChildren(){this.children=[];},setAttribute(key,value){this.attributes[key]=value;}});
 let now=0,id=0;const frames=new Map(),window={performance:{now:()=>now},matchMedia:()=>({matches:false}),requestAnimationFrame:callback=>{frames.set(++id,callback);return id;}};
 const document={createElement:tag=>tag==='canvas'?{getContext:()=>({measureText:()=>({width:7})})}:node(),createElementNS:()=>node(),addEventListener(){}};
 const element=node(),capsule=createStorageCapsule({document,window,root:node(),element,isVisible:()=>true});
 const svg=element.children[0].children[0].children[0],face=element.children[0].children[0].children[1];
 const tick=time=>{now=time;const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback(now);};
 capsule.update(0);tick(100);assert.equal(svg.attributes.width,78);assert.equal(svg.attributes.height,32);assert.equal(svg.children[1].attributes.fill,'rgba(52,199,89,1)');
 capsule.update(50e9);tick(500);assert.equal(svg.attributes.width,116);assert.equal(svg.attributes.height,38);assert.equal(svg.children[1].attributes.fill,'rgba(255,69,58,1)');
 const front=face.children.map(glyph=>glyph.style.transform);tick(999);assert.deepEqual(face.children.map(glyph=>glyph.style.transform),front);tick(1100);assert.notDeepEqual(face.children.map(glyph=>glyph.style.transform),front);
 capsule.reset();assert.equal(svg.attributes.width,78);assert.match(element.attributes['aria-label'],/^0.00 MB/);
 capsule.update(38.2e6,{animate:true,delta:38.2e6});assert.equal(element.children[1].textContent,'+38.2 MB');tick(1200);assert.ok(svg.attributes.width>78);assert.ok(svg.attributes.width<116);
 capsule.reset();tick(1800);assert.equal(svg.attributes.width,78);assert.match(element.attributes['aria-label'],/^0.00 MB/);
});
