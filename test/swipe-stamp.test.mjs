import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
function review(){
 const timers=new Map();
 let timerId=0;
 const elements=new Map(),items=[{id:'first'},{id:'next'}],decisions={},history=[];
 const $=id=>{
  if(!elements.has(id)){
   const classes=new Set();
   elements.set(id,{style:{},dataset:{},hidden:false,textContent:'',classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)},querySelector:()=>null,setPointerCapture(){}});
  }
  return elements.get(id);
 };
 const context=vm.createContext({$,items,decisions,history,busy:false,animating:false,mode:'fake',workspace:{},active:()=>items.find(item=>!decisions[item.id]),pending:()=>items.filter(item=>!decisions[item.id]),summarize:()=>({kept:[],sent:[],reviewed:Object.keys(decisions).length}),removalQueue:()=>[],renderStorage(){},renderCard(){},renderQueue(){},renderOperations(){},renderReconciliation(){},renderControls(){},prefetchReview(){},updateDecision:async(item,decision)=>{if(decision)decisions[item.id]=decision;else delete decisions[item.id];return true;},matchMedia:()=>({matches:true}),setTimeout:(fn,delay)=>{if(delay===2800){timers.set(++timerId,fn);return timerId;}fn();},clearTimeout:id=>timers.delete(id)});
 context.setHistory=entries=>{context.history=entries;};
 vm.runInContext(source.slice(source.indexOf('function renderGuide('),source.indexOf("$('toast').onclick=")),context);
 vm.runInContext(source.split('\n').filter(line=>line.startsWith('let toastTimer')||line.startsWith('function dismissToast(')||line.startsWith('function toast(')).join('\n'),context);
 for(const name of ['render','choose','undo']){
  const line=source.split('\n').find(line=>line.startsWith(`function ${name}(`)||line.startsWith(`async function ${name}(`));
  vm.runInContext(line,context);
 }
 vm.runInContext(source.split('\n').find(line=>line.startsWith('let startX=null;')),context);
 context.render();
 return {context,$,decisions,timers};
}
const pointer=x=>({clientX:x,pointerId:1,target:{tagName:'IMG'}});
function assertReset($){
 assert.equal($('stamp').hidden,true);
 assert.equal($('stamp').textContent,'');
 assert.equal($('stamp').style.opacity,'0');
 assert.equal($('card').style.transform,'');
 assert.equal($('card').classList.contains('dragging'),false);
}

for(const [decision,distance] of [['keep',120],['remove',-120]]){
 test(`${decision} stamp clears on the next card and after undo`,async()=>{
  const {context,$,decisions}=review();
  $('card').onpointerdown(pointer(200));
  $('card').onpointermove(pointer(200+distance));
  assert.equal($('stamp').hidden,false);
  assert.equal($('stamp').textContent,decision.toUpperCase());
  await context.choose(decision);
  assert.equal(decisions.first,decision);
  assert.equal(context.active().id,'next');
  assertReset($);
  $('card').onpointermove(pointer(400));
  assertReset($);
  await context.undo();
  assert.equal(context.active().id,'first');
  assertReset($);
  $('card').onpointermove(pointer(450));
  assertReset($);
 });
}

test('short and cancelled drags clear the stamp and allow a fresh gesture',()=>{
 for(const cancel of [false,true]){
  const {$}=review();
  $('card').onpointerdown(pointer(200));
  $('card').onpointermove(pointer(cancel?320:240));
  $('card')[cancel?'onpointercancel':'onpointerup'](pointer(cancel?320:240));
  assertReset($);
  $('card').onpointerdown(pointer(200));
  $('card').onpointermove(pointer(150));
  assert.equal($('stamp').hidden,false);
  assert.equal($('stamp').textContent,'REMOVE');
 }
});

for(const decision of ['keep','remove']){
 test(`a new ${decision} swipe dismisses the Undo toast immediately`,async()=>{
  const {context,$,decisions,timers}=review();
  await context.choose('remove');
  await context.undo();
  assert.equal($('toast').textContent,'Last swipe undone');
  assert.equal($('toast').classList.contains('show'),true);
  assert.equal(timers.size,1);
  const swipe=context.choose(decision);
  assert.equal($('toast').textContent,'');
  assert.equal($('toast').classList.contains('show'),false);
  assert.equal(timers.size,0);
  await swipe;
  assert.equal(decisions.first,decision);
  assert.equal(context.active().id,'next');
 });
}

test('a failed new swipe replaces the Undo toast with the decision error',async()=>{
 const {context,$,timers}=review();
 await context.choose('keep');
 await context.undo();
 context.updateDecision=async()=>{throw Error('Synthetic decision failure');};
 await context.choose('remove');
 assert.equal($('toast').textContent,'Synthetic decision failure');
 assert.equal($('toast').classList.contains('show'),true);
 assert.equal(timers.size,1);
 assert.equal(context.active().id,'first');
});

test('a new swipe dismisses the Undo toast before its decision save completes',async()=>{
 const {context,$,timers}=review();
 await context.choose('keep');
 await context.undo();
 let finishSave;
 context.updateDecision=()=>new Promise(resolve=>{finishSave=resolve;});
 const swipe=context.choose('remove');
 assert.equal(context.animating,true);
 assert.equal($('toast').textContent,'');
 assert.equal($('toast').classList.contains('show'),false);
 assert.equal(timers.size,0);
 finishSave(true);
 await swipe;
 assert.equal(context.animating,false);
});

for(const guard of ['busy','animating','hidden','no active item']){
 test(`a swipe blocked by ${guard} preserves the Undo toast`,async()=>{
  const {context,$,decisions,timers}=review();
  await context.choose('keep');
  await context.undo();
  if(guard==='hidden')$('review-view').hidden=true;
  else if(guard==='no active item')Object.assign(decisions,{first:'keep',next:'keep'});
  else context[guard]=true;
  context.updateDecision=()=>assert.fail('A blocked swipe must not save a decision');
  await context.choose('remove');
  assert.equal($('toast').textContent,'Last swipe undone');
  assert.equal($('toast').classList.contains('show'),true);
  assert.equal(timers.size,1);
 });
}
