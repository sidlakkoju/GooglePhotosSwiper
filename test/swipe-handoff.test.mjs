import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createWriteQueue} from '../lib/userscript-performance.mjs';
import {readFile} from 'node:fs/promises';
import {throwSwipe as throwPublicSwipe} from '../public/swipe.js';
import {throwSwipe as throwUserscriptSwipe} from '../lib/swipe.mjs';

for(const [surface,throwSwipe] of [['deck',throwPublicSwipe],['userscript',throwUserscriptSwipe]])for(const dx of [-120,120])test(`${surface} outgoing copy retains rotated release geometry for dx ${dx}`,()=>{
 const transform=`translateX(${dx}px) rotate(${dx/20}deg)`;
 let frames;
 const copy={style:{},removeAttribute(){},setAttribute(){},querySelectorAll:()=>[],remove(){},getBoundingClientRect:()=>({width:340}),animate:f=>{frames=f;return {finished:Promise.resolve()};}};
 const original={style:{transform,transition:'transform .23s ease'},ownerDocument:{body:{}},parentNode:{append(){}},cloneNode:()=>copy,getBoundingClientRect(){assert.equal(this.style.transition,'none');return this.style.transform==='none'?{left:10,top:20,width:300,height:400}:{left:110,top:5,width:340,height:430};}};
 throwSwipe(original,dx,240);
 assert.equal(original.style.transform,transform);
 assert.equal(original.style.transition,'transform .23s ease');
 assert.equal(copy.style.transition,'none');
 assert.equal(copy.style.width,'300px');
 assert.equal(copy.style.height,'400px');
 assert.equal(copy.style.left,'10px');
 assert.equal(copy.style.top,'20px');
 assert.equal(copy.style.boxSizing,'border-box');
 assert.equal(frames[0].transform,transform);
});

for(const surface of ['viewer']){
 const source=await readFile(new URL('../public/viewer.js',import.meta.url),'utf8');
 function fixture({busy=false,inspection=false,fail=false,delayTask=false}={}){
  const card={hidden:false,style:{visibility:'',transform:'translateX(120px) rotate(6deg)'}},throws=[],writes=[];
  let finish,startTask;
  const waiting=new Promise(resolve=>{finish=resolve;});
  const taskReady=new Promise(resolve=>{startTask=resolve;});
  const save=async()=>{writes.push('save');await waiting;if(fail)throw Error('Save failed');};
  const context=vm.createContext({identity:{account:'synthetic'},window:{setTimeout,clearTimeout,matchMedia:()=>globalThis.matchMedia?.()||{matches:false}},busy,inspected:inspection?'first':null,current:{id:'first'},$:()=>card,throwSwipe:(element,dx,duration)=>{throws.push({element,dx,duration});return {finished:waiting,finish(){},cancel(){}};},run:async task=>{try{if(delayTask)await taskReady;await task();}catch{}finally{context.render();}},render:()=>{assert.equal(card.style.visibility,'hidden');},state:{history:[]},decideReview:()=>({}),save,message(){},focused:null,canReview:true,working:busy,controls(){},stage:card,request:0,review:{canDecide:()=>!busy,decide:async()=>{await save();return {id:'next'};}},dialog:{open:true,focus(){}},status:{},show:async()=>{assert.equal(card.style.visibility,'hidden');}});
  const start=source.indexOf('  async function decide(');
  const end=source.indexOf('  async function undo(',start);
  vm.runInContext(source.slice(start,end),context);
  return {context,card,throws,writes,finish,startTask};
 }
 test(`${surface} cancels a live spring before a button decision or outgoing measurement`,async()=>{
  for(const swipeResult of [null,{dx:120,duration:240}]){
   const {context,card,finish}=fixture();
   let running=true;
   card.getAnimations=()=>running?[{cancel(){running=false;}}]:[];
   context.throwSwipe=()=>assert.equal(running,false);
   context.render=()=>assert.equal(running,false);
   context.show=async()=>assert.equal(running,false);
   const result=context.decide('keep',swipeResult);
   assert.equal(running,false);
   finish();
   await result;
   await new Promise(resolve=>setImmediate(resolve));
  }
 });
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
 for(const fallback of ['reduced motion','missing animate'])for(const fail of [false,true])test(`${surface} stays visible during a delayed ${fail?'failed':'successful'} save with ${fallback}`,async()=>{
  const {context,card,writes,finish}=fixture({fail});
  let removed=false;
  const copy={style:{},removeAttribute(){},setAttribute(){},querySelectorAll:()=>[],remove(){removed=true;},getBoundingClientRect:()=>({width:300})};
  if(fallback==='reduced motion')copy.animate=(frames,options)=>{assert.deepEqual(frames,[{opacity:1},{opacity:0}]);assert.equal(options.duration,150);return {finished:Promise.resolve()};};
  Object.assign(card,{ownerDocument:{body:{}},parentNode:{append(){}},cloneNode:()=>copy,getBoundingClientRect:()=>({left:0,top:0,width:300,height:400})});
  const matchMedia=globalThis.matchMedia;
  globalThis.matchMedia=()=>({matches:fallback==='reduced motion'});
  context.throwSwipe=throwPublicSwipe;
  context.render=()=>assert.equal(card.style.visibility,'');
  let finishPreview;
  const previewWaiting=new Promise(resolve=>{finishPreview=resolve;});
  context.show=async()=>{assert.equal(card.style.visibility,'');await previewWaiting;assert.equal(card.style.visibility,'');};
  try{
   const result=context.decide('keep',{dx:120,duration:240});
   assert.equal(removed,fallback==='missing animate');
   assert.equal(card.style.visibility,'');
   assert.deepEqual(writes,['save']);
   await new Promise(resolve=>setImmediate(resolve));
   assert.equal(removed,true);
   assert.equal(card.style.visibility,'');
   finish();
   await new Promise(resolve=>setImmediate(resolve));
   assert.equal(card.style.visibility,'');
   finishPreview();
   await result;
   await new Promise(resolve=>setImmediate(resolve));
   assert.equal(card.style.visibility,'');
  }finally{
   if(matchMedia===undefined)delete globalThis.matchMedia;
   else globalThis.matchMedia=matchMedia;
  }
 });
 test(`${surface} does not fly off a gesture rejected by busy state`,async()=>{
  const {context,card,throws,writes}=fixture({busy:true});
  await context.decide('keep',{dx:120,duration:240});
  assert.equal(throws.length,0);
  assert.equal(writes.length,0);
  assert.equal(card.style.visibility,'');
 });
 if(surface==='viewer')test('viewer cancels a spring when replacing or closing its media',()=>{
  let running=true;
  const stage={style:{},getAnimations:()=>running?[{cancel(){running=false;}}]:[],classList:{remove(){}}};
  const media={pause(){},removeAttribute(){assert.equal(running,false);},load(){}};
  const context=vm.createContext({stage,video:media,image:media,pointers:new Map(),clearSwipe(){}});
  vm.runInContext(source.split('\n').find(line=>line.includes('function clearMedia(')),context);
  context.clearMedia();
  assert.equal(running,false);
 });

}

test('deck card reset cannot transition the next photo from the release offset',async()=>{
 const css=await readFile(new URL('../public/styles.css',import.meta.url),'utf8');
 const rule=css.match(/\.photo-card\{([^}]+)\}/)[1];
 assert.doesNotMatch(rule,/transition:[^;]*transform/);
});

const userscriptSource=await readFile(new URL('../lib/userscript-ui.mjs',import.meta.url),'utf8');
function userscriptDecisionFixture({busy=false,inspection=false,fail=false,delayTask=false}={}){
 const decisions=[],writes=[];
 let finish,startTask;
 const waiting=new Promise(resolve=>{finish=resolve;}),taskReady=new Promise(resolve=>{startTask=resolve;});
 const context=vm.createContext({identity:{account:'synthetic'},reviewPanel:{hidden:true},sheet:{hidden:true},$:()=>({hidden:false}),leaseError:null,otherTab:false,busy,inspected:inspection?'first':null,focused:null,previousKey:null,swipeAt:null,window:{performance:{mark(){},now:()=>0}},state:{history:[]},current:()=>({mediaKey:'first',name:'First',decision:null,revision:0}),swipeFeedback:{dismiss:value=>decisions.push(value)},render(){},message(){},decideReview:()=>({})});
 const queue=createWriteQueue({snapshot:()=>context.state,write:async next=>{if(delayTask)await taskReady;writes.push('save');await waiting;if(fail)throw Error('Save failed');return next;},committed(){}});
 context.apply=next=>{context.state=next;context.render();queue.enqueue();};
 const start=userscriptSource.indexOf(' function decide('),end=userscriptSource.indexOf(' async function undo(',start);
 vm.runInContext(userscriptSource.slice(start,end),context);
 return {context,decisions,writes,finish,startTask,settle:()=>queue.flush(),pending:()=>queue.pending};
}
for(const fail of [false,true])for(const delayTask of [false,true])test(`userscript advances before a ${delayTask?'delayed task and ':''}${fail?'failed':'successful'} save`,async()=>{
 const fixture=userscriptDecisionFixture({fail,delayTask}),{context,decisions,writes,finish,startTask}=fixture;
 let displayed='first';
 context.render=()=>{displayed=context.state.history.length?'next':'first';};
 context.decide('keep');
 assert.deepEqual(decisions,['keep']);
 assert.equal(displayed,'next');
 assert.deepEqual(writes,[]);
 startTask();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(writes,['save']);
 assert.equal(displayed,'next');
 finish();await fixture.settle();
 assert.equal(displayed,'next');assert.equal(fixture.pending(),fail);
});
test('userscript does not fly off a gesture rejected by busy state',()=>{
 const {context,decisions,writes}=userscriptDecisionFixture({busy:true});
 context.decide('keep');
 assert.equal(decisions.length,0);assert.equal(writes.length,0);
});
test('leaving userscript candidate inspection does not fly off or save a decision',()=>{
 const {context,decisions,writes}=userscriptDecisionFixture({inspection:true});
 context.decide('remove');
 assert.equal(context.inspected,null);assert.equal(decisions.length,0);assert.equal(writes.length,0);
});
