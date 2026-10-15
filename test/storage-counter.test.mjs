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

function counterFixture({reduced=false}={}){
 const timers=[];
 const node=tag=>{const element={tag,children:[],style:{values:{},setProperty(key,value){this.values[key]=value;}},dataset:{},attributes:{},offsetWidth:1,textContent:'',className:'',
  classList:{values:new Set(),add(value){this.values.add(value);},remove(...values){for(const value of values)this.values.delete(value);},toggle(value,force){if(force??!this.values.has(value))this.values.add(value);else this.values.delete(value);},contains(value){return this.values.has(value);}},
  append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},setAttribute(key,value){this.attributes[key]=value;},
  querySelectorAll(selector){const found=[],walk=current=>{for(const child of current.children){if(selector==='.'+child.className)found.push(child);walk(child);}};walk(this);return found;}};return element;};
 const motion={matches:reduced},window={matchMedia:()=>motion,setTimeout:(callback,delay)=>{timers.push({callback,delay});return timers.length;},clearTimeout(){}};
 const element=node('span'),capsule=createStorageCapsule({document:{createElement:node},window,root:node('root'),element,isVisible:()=>true});
 const [label,value,note]=element.children,digits=value.children[0],unit=value.children[1];
 const shown=()=>digits.children.map(child=>child.className==='sv-col'?child.children[0].style.values['--n']:child.textContent).join('')+' '+unit.textContent;
 const flush=()=>{for(const timer of timers.splice(0))timer.callback();};
 return {capsule,element,label,value,note,shown,flush,motion};
}

test('the counter shows the formatted total with an accessible label and stays still when unchanged',()=>{
 const {capsule,element,label,value,note,shown}=counterFixture();
 capsule.update(0);assert.equal(shown(),'0.00 MB');assert.equal(label.textContent,'Freed');assert.equal(value.dataset.text,'0.00 MB');
 assert.match(element.attributes['aria-label'],/^0.00 MB approximate storage freed/);assert.equal(element.attributes.role,'img');
 capsule.update(0,{animate:true,delta:0});assert.equal(note.classList.contains('sv-go'),false);
});

test('a queued item rolls the digits, tints the number and swaps the caption for the amount added',()=>{
 const {capsule,element,value,note,shown,flush}=counterFixture();
 capsule.update(0);capsule.update(38.2e6,{animate:true,delta:38.2e6});
 assert.equal(shown(),'38.2 MB');assert.equal(value.dataset.text,'38.2 MB');
 assert.equal(note.textContent,'+38.2 MB');assert.ok(note.classList.contains('sv-go'));assert.ok(element.classList.contains('sv-noting'));assert.equal(note.classList.contains('sv-free'),false);
 assert.ok(value.classList.contains('sv-bump'));flush();assert.equal(value.classList.contains('sv-bump'),false);
 capsule.update(1.24e9,{animate:true,delta:1.2e9});assert.equal(shown(),'1.24 GB');assert.equal(note.textContent,'+1.20 GB');
});

test('an item Google stores free says so instead of looking stuck at zero',()=>{
 const {capsule,note,shown}=counterFixture();
 capsule.update(5e6);capsule.update(5e6,{animate:true,delta:0,free:true});
 assert.equal(shown(),'5.00 MB');assert.equal(note.textContent,'Stored free');assert.ok(note.classList.contains('sv-free'));assert.ok(note.classList.contains('sv-go'));
});

test('reset returns to zero at once and reduced motion skips the caption swap',()=>{
 const {capsule,element,note,shown}=counterFixture({reduced:true});
 capsule.update(0);capsule.update(38.2e6,{animate:true,delta:38.2e6});
 assert.equal(shown(),'38.2 MB');assert.equal(note.classList.contains('sv-go'),false);assert.match(element.attributes['aria-label'],/^38.2 MB/);
 capsule.reset();assert.equal(shown(),'0.00 MB');assert.equal(element.classList.contains('sv-noting'),false);assert.match(element.attributes['aria-label'],/^0.00 MB/);
});

test('sizes just under a unit boundary round into the next format instead of showing an extra digit',()=>{
 assert.equal(formatStorageBytes(9.994e6),'9.99 MB');assert.equal(formatStorageBytes(9.996e6),'10.0 MB');
 assert.equal(formatStorageBytes(99.94e6),'99.9 MB');assert.equal(formatStorageBytes(99.96e6),'100 MB');
 assert.equal(formatStorageBytes(999.4e6),'999 MB');assert.equal(formatStorageBytes(999.5e6),'1.00 GB');assert.equal(formatStorageBytes(999.99e6),'1.00 GB');
 assert.equal(formatStorageBytes(9.996e9),'10.0 GB');assert.equal(formatStorageBytes(99.96e9),'100 GB');
});
