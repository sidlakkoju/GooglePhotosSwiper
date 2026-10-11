import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {removalQueue} from '../public/model.js';

const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
function review({delayed=false}={}){
 const elements=new Map(),items=[{id:'first'},{id:'next'},{id:'third'}],decisions={},history=[];
 const $=id=>{
  if(!elements.has(id)){
   const classes=new Set();
   elements.set(id,{style:{},dataset:{},hidden:false,textContent:'',classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)},querySelector:()=>null,setPointerCapture(){}});
  }
  return elements.get(id);
 };
 const timers=[],toastTimers=new Map(),writes=[];
 let timerId=0;
 const context=vm.createContext({photoViewer:{open:false},$,items,decisions,history,busy:false,animating:false,generation:0,reviewActions:Promise.resolve(),authenticated:true,mode:'fake',workspace:{},active:()=>items.find(item=>!decisions[item.id]),pending:()=>items.filter(item=>!decisions[item.id]),summarize:()=>({kept:[],sent:[],reviewed:Object.keys(decisions).length}),removalQueue:()=>[],renderStorage(){},renderCard(){},renderQueue(){},renderOperations(){},renderReconciliation(){},renderControls(){},prefetchReview(){},updateDecision:async(item,decision)=>{writes.push([item.id,decision]);if(decision)decisions[item.id]=decision;else delete decisions[item.id];return true;},matchMedia:()=>({matches:true}),setTimeout:(fn,delay)=>{if(delay===2800){toastTimers.set(++timerId,fn);return timerId;}return delayed?timers.push(fn):fn();},clearTimeout:id=>toastTimers.delete(id)});
 context.setHistory=entries=>{context.history=entries;};
 vm.runInContext(source.slice(source.indexOf('function renderGuide('),source.indexOf("$('toast').onclick=")),context);
 vm.runInContext(source.split('\n').filter(line=>line.startsWith('let toastTimer')||line.startsWith('function dismissToast(')||line.startsWith('function toast(')).join('\n'),context);
 for(const name of ['render','enqueueReviewAction','choose','undo','applyDecision','applyUndo']){
  const line=source.split('\n').find(line=>line.startsWith(`function ${name}(`)||line.startsWith(`async function ${name}(`));
  vm.runInContext(line,context);
 }
 vm.runInContext(source.split('\n').find(line=>line.startsWith('let startX=null;')),context);
 context.render();
 return {context,$,decisions,timers,toastTimers,writes};
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


test('rapid keyboard swipe and undo inputs survive pending writes and card animations in order',async()=>{
 const {context,$,decisions,timers,writes}=review({delayed:true});
 let keydown;
 context.document={querySelector:()=>null,addEventListener:(type,handler)=>{assert.equal(type,'keydown');keydown=handler;}};
 const line=source.split('\n').find(line=>line.includes("document.addEventListener('keydown'"));
 vm.runInContext(line.slice(line.indexOf("document.addEventListener('keydown'")),context);
 const save=context.updateDecision;
 let release;
 context.updateDecision=async(item,decision)=>{if(!release)await new Promise(resolve=>{release=resolve;});return await save(item,decision);};
 const press=key=>keydown({key,target:{tagName:'BODY',closest:()=>null},preventDefault(){}});
 press('ArrowLeft');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(context.animating,true);
 for(const key of ['z','ArrowRight','z','ArrowLeft','ArrowLeft','z','z'])press(key);
 release();
 const complete=context.reviewActions;
 for(let i=0;i<4;i++){
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(context.animating,true);
  assert.equal(timers.length,1);
  timers.shift()();
 }
 await complete;
 assert.deepEqual(writes,[['first','remove'],['first',null],['first','keep'],['first',null],['first','remove'],['next','remove'],['next',null],['first',null]]);
 assert.deepEqual(decisions,{});
 assert.equal(removalQueue(context.items,decisions).length,0);
 assert.equal(context.history.length,0);
 assert.equal(context.active().id,'first');
 assert.equal($('progress-text').textContent,'0 of 3 reviewed');
 assertReset($);
});


test('queued review actions do not carry into a changed workspace',async()=>{
 const {context,decisions,writes}=review();
 const result=context.choose('remove');
 context.generation++;
 await result;
 assert.deepEqual(writes,[]);
 assert.deepEqual(decisions,{});
});

for(const decision of ['keep','remove']){
 test(`a new ${decision} swipe dismisses the Undo toast immediately`,async()=>{
  const {context,$,decisions,toastTimers}=review();
  await context.choose('remove');
  await context.undo();
  assert.equal($('toast').textContent,'Last swipe undone');
  assert.equal($('toast').classList.contains('show'),true);
  assert.equal(toastTimers.size,1);
  const swipe=context.choose(decision);
  assert.equal($('toast').textContent,'');
  assert.equal($('toast').classList.contains('show'),false);
  assert.equal(toastTimers.size,0);
  await swipe;
  assert.equal(decisions.first,decision);
  assert.equal(context.active().id,'next');
 });
}

test('a failed new swipe replaces the Undo toast with the decision error',async()=>{
 const {context,$,toastTimers}=review();
 await context.choose('keep');
 await context.undo();
 context.updateDecision=async()=>{throw Error('Synthetic decision failure');};
 await context.choose('remove');
 assert.equal($('toast').textContent,'Synthetic decision failure');
 assert.equal($('toast').classList.contains('show'),true);
 assert.equal(toastTimers.size,1);
 assert.equal(context.active().id,'first');
});

test('a new swipe dismisses the Undo toast before its decision save completes',async()=>{
 const {context,$,toastTimers}=review();
 await context.choose('keep');
 await context.undo();
 let finishSave;
 context.updateDecision=()=>new Promise(resolve=>{finishSave=resolve;});
 const swipe=context.choose('remove');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(context.animating,true);
 assert.equal($('toast').textContent,'');
 assert.equal($('toast').classList.contains('show'),false);
 assert.equal(toastTimers.size,0);
 finishSave(true);
 await swipe;
 assert.equal(context.animating,false);
});

for(const guard of ['busy','animating','hidden','no active item']){
 test(`a swipe blocked by ${guard} preserves the Undo toast`,async()=>{
  const {context,$,decisions,toastTimers}=review();
  await context.choose('keep');
  await context.undo();
  if(guard==='hidden')$('review-view').hidden=true;
  else if(guard==='no active item')Object.assign(decisions,{first:'keep',next:'keep',third:'keep'});
  else context[guard]=true;
  context.updateDecision=()=>assert.fail('A blocked swipe must not save a decision');
  await context.choose('remove');
  assert.equal($('toast').textContent,'Last swipe undone');
  assert.equal($('toast').classList.contains('show'),true);
  assert.equal(toastTimers.size,1);
 });
}
