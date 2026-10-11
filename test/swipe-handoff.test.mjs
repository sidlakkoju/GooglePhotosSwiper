import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {throwSwipe} from '../public/swipe.js';

test('a rotated outgoing copy retains the release transform and untransformed border box',()=>{
 const transform='translateX(120px) rotate(6deg)';
 let frames;
 const copy={style:{},removeAttribute(){},setAttribute(){},querySelectorAll:()=>[],remove(){},getBoundingClientRect:()=>({width:340}),animate:f=>{frames=f;return {finished:Promise.resolve()};}};
 const original={style:{transform,transition:'none'},ownerDocument:{body:{}},parentNode:{append(){}},cloneNode:()=>copy,getBoundingClientRect(){return this.style.transform==='none'?{left:10,top:20,width:300,height:400}:{left:110,top:5,width:340,height:430};}};
 throwSwipe(original,120,240);
 assert.equal(original.style.transform,transform);
 assert.equal(copy.style.width,'300px');
 assert.equal(copy.style.height,'400px');
 assert.equal(copy.style.left,'10px');
 assert.equal(copy.style.top,'20px');
 assert.equal(copy.style.boxSizing,'border-box');
 assert.equal(frames[0].transform,transform);
});

for(const surface of ['userscript','viewer']){
 const source=await readFile(new URL(surface==='userscript'?'../lib/userscript-ui.mjs':'../public/viewer.js',import.meta.url),'utf8');
 function fixture({busy=false,inspection=false,fail=false}={}){
  const card={style:{visibility:'',transform:'translateX(120px) rotate(6deg)'}},throws=[],writes=[];
  let finish;
  const waiting=new Promise(resolve=>{finish=resolve;});
  const save=async()=>{writes.push('save');await waiting;if(fail)throw Error('Save failed');};
  const context=vm.createContext({busy,inspected:inspection?'first':null,current:surface==='userscript'?()=>({mediaKey:'first',name:'First'}):{id:'first'},$:()=>card,throwSwipe:(element,dx,duration)=>throws.push({element,dx,duration}),run:async task=>{try{await task();}catch{}finally{context.render();}},render:()=>{assert.equal(card.style.visibility,'hidden');},state:{history:[]},decideReview:()=>({}),save,message(){},focused:null,canReview:true,working:busy,controls(){},stage:card,request:0,review:{canDecide:()=>!busy,decide:async()=>{await save();return {id:'next'};}},dialog:{open:true,focus(){}},status:{},show:async()=>{assert.equal(card.style.visibility,'hidden');}});
  const start=source.indexOf(surface==='userscript'?' function decide(':'  async function decide(');
  const end=source.indexOf(surface==='userscript'?' function undo(':'  async function undo(',start);
  vm.runInContext(source.slice(start,end),context);
  return {context,card,throws,writes,finish};
 }
 for(const fail of [false,true])test(`${surface} hides the old photo through a delayed ${fail?'failed':'successful'} save and restores visibility`,async()=>{
  const {context,card,throws,writes,finish}=fixture({fail});
  const result=context.decide('keep',{dx:120,duration:240});
  assert.equal(throws.length,1);
  assert.equal(card.style.visibility,'hidden');
  assert.deepEqual(writes,['save']);
  finish();
  await result;
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(card.style.visibility,'');
 });
 test(`${surface} does not fly off a gesture rejected by busy state`,async()=>{
  const {context,card,throws,writes}=fixture({busy:true});
  await context.decide('keep',{dx:120,duration:240});
  assert.equal(throws.length,0);
  assert.equal(writes.length,0);
  assert.equal(card.style.visibility,'');
 });
 if(surface==='userscript')test('leaving candidate inspection does not fly off or save a decision',()=>{
  const {context,throws,writes}=fixture({inspection:true});
  context.render=()=>{};
  context.decide('remove',{dx:-120,duration:240});
  assert.equal(context.inspected,null);
  assert.equal(throws.length,0);
  assert.equal(writes.length,0);
 });
}

test('deck card reset cannot transition the next photo from the release offset',async()=>{
 const css=await readFile(new URL('../public/styles.css',import.meta.url),'utf8');
 const rule=css.match(/\.photo-card\{([^}]+)\}/)[1];
 assert.doesNotMatch(rule,/transition:[^;]*transform/);
});
