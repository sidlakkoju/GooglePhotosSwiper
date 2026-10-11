import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {loadUndoHistory,validUndoHistory} from '../public/undo-history.js';
import {removalQueue} from '../public/model.js';

const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
function review({delayed=false}={}){
 const elements=new Map(),items=[{id:'first',revision:0},{id:'next',revision:0},{id:'third',revision:0}],decisions={},history=[];
 const $=id=>{
  if(!elements.has(id)){
   const classes=new Set();
   elements.set(id,{style:{},dataset:{},hidden:false,textContent:'',classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)},querySelector:()=>null,setPointerCapture(){}});
  }
  return elements.get(id);
 };
 const timers=[],toastTimers=new Map(),writes=[];
 let timerId=0;
 const context=vm.createContext({photoViewer:{open:false},$,items,decisions,history,busy:false,animating:false,generation:0,reviewActionVersion:0,reviewActionsPending:0,workspaceGeneration:0,workspaceRefreshGeneration:0,sessionGeneration:0,pendingDecisionWrites:0,decisionWriteWaiters:new Set(),historyRestored:true,loadUndoHistory,validUndoHistory,sessionStorage:{getItem:()=>null},reviewActions:Promise.resolve(),authenticated:true,mode:'fake',workspace:{},active:()=>context.items.find(item=>!context.decisions[item.id]),pending:()=>context.items.filter(item=>!context.decisions[item.id]),summarize:()=>({kept:[],sent:[],reviewed:Object.keys(context.decisions).length}),removalQueue:()=>[],renderStorage(){},renderCard(){},renderQueue(){},renderOperations(){},renderReconciliation(){},renderControls(){},prefetchReview(){},updateDecision:async(item,decision)=>{writes.push([item.id,decision]);item.revision++;item.decision=decision;if(decision)context.decisions[item.id]=decision;else delete context.decisions[item.id];return true;},matchMedia:()=>({matches:true}),setTimeout:(fn,delay)=>{if(delay===2800){toastTimers.set(++timerId,fn);return timerId;}return delayed?timers.push(fn):fn();},clearTimeout:id=>toastTimers.delete(id)});
 context.setHistory=entries=>{context.history=entries;};
 vm.runInContext(source.slice(source.indexOf('function renderGuide('),source.indexOf("$('toast').onclick=")),context);
 vm.runInContext(source.split('\n').filter(line=>line.startsWith('let toastTimer')||line.startsWith('function dismissToast(')||line.startsWith('function toast(')).join('\n'),context);
 for(const name of ['render','enqueueReviewAction','choose','undo','applyDecision','applyUndo','refreshWorkspace']){
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
 await context.refreshWorkspace(false,{items:context.items,jobs:[]});
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

function keyboard(context){
 let keydown;
 context.document={querySelector:()=>null,addEventListener:(type,handler)=>{keydown=handler;}};
 const line=source.split('\n').find(line=>line.includes("document.addEventListener('keydown'"));
 vm.runInContext(line.slice(line.indexOf("document.addEventListener('keydown'")),context);
 return (key,repeat=false)=>keydown({key,repeat,target:{tagName:'BODY',closest:()=>null},preventDefault(){}});
}

for(const key of ['ArrowLeft','ArrowRight','z']){
 test(`held ${key} ignores repeats during and after an action`,async()=>{
  const {context,writes}=review();
  if(key==='z'){
   await context.choose('remove');
   await context.choose('keep');
  }
  const initialWrites=writes.length,press=keyboard(context),save=context.updateDecision;
  let release;
  context.updateDecision=async(item,decision)=>{await new Promise(resolve=>{release=resolve;});return await save(item,decision);};
  press(key);
  await new Promise(resolve=>setImmediate(resolve));
  for(let i=0;i<5;i++)press(key,true);
  release();
  await context.reviewActions;
  press(key,true);
  await context.reviewActions;
  assert.equal(writes.length,initialWrites+1);
 });
}

for(const action of ['choose','undo']){
 test(`failed ${action} cancels queued shortcuts and allows fresh input`,async()=>{
  const {context,writes}=review();
  await context.choose('keep');
  const press=keyboard(context),save=context.updateDecision;
  let reject,reads=0;
  context.mode='google';
  context.api=async path=>{
   assert.equal(path,'/workspace');
   reads++;
   return {items:[{id:'first',decision:'keep',revision:1},{id:'next',revision:0},{id:'third',revision:0}],jobs:[]};
  };
  context.updateDecision=()=>new Promise((resolve,fail)=>{reject=fail;});
  press(action==='choose'?'ArrowLeft':'z');
  await new Promise(resolve=>setImmediate(resolve));
  press('z');
  press('ArrowLeft');
  reject(Error('Save failed'));
  await context.reviewActions;
  assert.equal(reads,1);
  assert.deepEqual(writes,[['first','keep']]);
  assert.equal(context.decisions.first,'keep');
  assert.equal(context.decisions.next,undefined);
  assert.equal(context.history.length,1);
  assert.equal(context.animating,false);
  context.updateDecision=save;
  press('ArrowRight');
  await context.reviewActions;
  assert.deepEqual(writes,[['first','keep'],['next','keep']]);
  assert.equal(context.decisions.next,'keep');
 });
}

test('Z undoes the last decision from the removal queue while arrows do nothing',async()=>{
 const {context,$,writes}=review();
 await context.choose('remove');
 $('review-view').hidden=true;
 const press=keyboard(context);
 press('ArrowRight');
 press('ArrowLeft');
 press('z');
 await context.reviewActions;
 assert.deepEqual(writes,[['first','remove'],['first',null]]);
 assert.equal(context.history.length,0);
 assert.equal(context.active().id,'first');
});

test('a workspace request preserves the sequence queued after it begins',async()=>{
 const {context,writes}=review();
 let release;
 context.api=()=>new Promise(resolve=>{release=resolve;});
 const refresh=context.refreshWorkspace();
 const press=keyboard(context);
 for(const key of ['ArrowLeft','z','ArrowRight','z','ArrowLeft','ArrowLeft','z','z'])press(key);
 release({items:[{id:'first'},{id:'next'},{id:'third'}],jobs:[]});
 await refresh;
 await context.reviewActions;
 assert.deepEqual(writes,[['first','remove'],['first',null],['first','keep'],['first',null],['first','remove'],['next','remove'],['next',null],['first',null]]);
 assert.deepEqual(Object.keys(context.decisions),[]);
 assert.equal(context.history.length,0);
});

test('a retry entered during failed-save recovery survives the workspace reload',async()=>{
 const {context,$,writes}=review();
 context.mode='google';
 const save=context.updateDecision;
 let release;
 context.api=()=>new Promise(resolve=>{release=resolve;});
 context.updateDecision=async()=>{throw Error('Save failed');};
 const failed=context.choose('remove');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal($('toast').textContent,'Save failed');
 context.updateDecision=save;
 const retry=context.choose('keep');
 release({items:[{id:'first'},{id:'next'},{id:'third'}],jobs:[]});
 await failed;
 await retry;
 assert.deepEqual(writes,[['first','keep']]);
 assert.equal($('toast').classList.contains('show'),false);
});

test('focus skips workspace reloads while review actions are queued or running',async()=>{
 const {context}=review();
 let focus,reads=0,release;
 context.window={addEventListener:(type,handler)=>{assert.equal(type,'focus');focus=handler;}};
 context.document={querySelector:()=>null};
 context.refreshWorkspace=async()=>{reads++;};
 vm.runInContext(source.split('\n').find(line=>line.startsWith("window.addEventListener('focus'")),context);
 context.updateDecision=()=>new Promise(resolve=>{release=resolve;});
 const swipe=context.choose('remove');
 focus();
 assert.equal(reads,0);
 await new Promise(resolve=>setImmediate(resolve));
 focus();
 assert.equal(reads,0);
 release();
 await swipe;
 focus();
 assert.equal(reads,1);
 assert.equal(context.reviewActionsPending,0);
});
