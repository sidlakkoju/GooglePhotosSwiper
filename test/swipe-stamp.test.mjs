import {sampleSwipe,releaseSwipe,animateSwipe,throwSwipe} from '../public/swipe.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {loadUndoHistory,validUndoHistory} from '../public/undo-history.js';
import {createStore} from '../lib/store.mjs';
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
 const context=vm.createContext({sampleSwipe,releaseSwipe,animateSwipe,throwSwipe,photoViewer:{open:false},$,items,decisions,history,busy:false,animating:false,generation:0,reviewActionVersion:0,reviewActionsPending:0,workspaceLoadsPending:0,workspaceGeneration:0,workspaceRefreshGeneration:0,sessionGeneration:0,pendingDecisionWrites:0,decisionWriteWaiters:new Set(),historyRestored:true,loadUndoHistory,validUndoHistory,sessionStorage:{getItem:()=>null},reviewActions:Promise.resolve(),authenticated:true,evict:async()=>{},mode:'fake',workspace:{},active:()=>context.items.find(item=>!context.decisions[item.id]),pending:()=>context.items.filter(item=>!context.decisions[item.id]),summarize:()=>({kept:[],sent:[],reviewed:Object.keys(context.decisions).length}),removalQueue:()=>[],renderStorage(){},renderCard(){},renderQueue(){},renderOperations(){},renderReconciliation(){},renderControls(){},prefetchReview(){},updateDecision:async(item,decision)=>{writes.push([item.id,decision]);item.revision++;item.decision=decision;if(decision)context.decisions[item.id]=decision;else delete context.decisions[item.id];return true;},matchMedia:()=>({matches:true}),setTimeout:(fn,delay)=>{if(delay===2800){toastTimers.set(++timerId,fn);return timerId;}return delayed?timers.push(fn):fn();},clearTimeout:id=>toastTimers.delete(id)});
 context.setHistory=entries=>{context.history=entries;};
 vm.runInContext(source.slice(source.indexOf('function renderGuide('),source.indexOf("$('toast').onclick=")),context);
 vm.runInContext(source.split('\n').filter(line=>line.startsWith('let toastTimer')||line.startsWith('function dismissToast(')||line.startsWith('function toast(')).join('\n'),context);
 for(const name of ['render','enqueueReviewAction','choose','undo','applyDecision','applyUndo','refreshWorkspace','loadWorkspace']){
  const line=source.split('\n').find(line=>line.startsWith(`function ${name}(`)||line.startsWith(`async function ${name}(`));
  vm.runInContext(line,context);
 }
 vm.runInContext(source.split('\n').find(line=>line.startsWith('let startX=null')),context);
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
 assert.equal(timers.length,0);
 await complete;
 assert.deepEqual(writes,[['first','remove'],['first',null],['first','keep'],['first',null],['first','remove'],['next','remove'],['next',null],['first',null]]);
 assert.deepEqual(decisions,{});
 assert.equal(removalQueue(context.items,decisions).length,0);
 assert.equal(context.history.length,0);
 assert.equal(context.active().id,'first');
 assert.equal($('progress-text').textContent,'0 of 3 reviewed');
 assertReset($);
});


for(const decision of ['keep','remove']){
 test(`${decision} clicks during an undo save are blocked while rapid keyboard inputs queue`,async()=>{
  const {context,$,writes}=review();
  context.albumCandidates=()=>[];
  context.bridgeConnected=false;
  context.reconciliationSupported=false;
  context.photoViewer.refreshControls=()=>{};
  vm.runInContext(source.split('\n').find(line=>line.startsWith('function renderControls(')),context);
  const handlers=source.split('\n').find(line=>line.startsWith("$('import-next').onclick="));
  vm.runInContext(handlers.slice(handlers.indexOf("$('keep').onclick=")),context);
  for(const id of ['keep','remove','undo'])$(id).click=()=>{if(!$(id).disabled)$(id).onclick();};
  await context.choose('remove');
  assert.equal(context.active().id,'next');
  assert.equal($(decision).disabled,false);
  const save=context.updateDecision;
  let release;
  context.updateDecision=async(item,value)=>{
   if(value===null&&!release)await new Promise(resolve=>{release=resolve;});
   return await save(item,value);
  };
  $('undo').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(context.animating,true);
  assert.equal(context.active().id,'next');
  assert.equal($('keep').disabled,true);
  assert.equal($('remove').disabled,true);
  assert.equal($('undo').disabled,true);
  $(decision).click();
  assert.equal(context.reviewActionsPending,1);
  const press=keyboard(context);
  for(const key of ['ArrowRight','z','ArrowLeft','z'])press(key);
  assert.equal(context.reviewActionsPending,5);
  release();
  await context.reviewActions;
  assert.deepEqual(writes,[['first','remove'],['first',null],['first','keep'],['first',null],['first','remove'],['first',null]]);
  assert.equal(context.active().id,'first');
  assert.equal(context.history.length,0);
  assert.equal($('keep').disabled,false);
  assert.equal($('remove').disabled,false);
  $(decision).click();
  await context.reviewActions;
  assert.deepEqual(writes.at(-1),['first',decision]);
  assert.equal(context.active().id,'next');
 });
}

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
 await new Promise(resolve=>setImmediate(resolve));
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


test('workspace reload blocks revision-checked writes through the full swipe and undo burst',async()=>{
 const store=createStore();
 try{
  store.setSetting('account','synthetic');
  store.importItems(['first','next','third'].map(mediaKey=>({mediaKey,type:'photo',thumbUrl:'https://lh3.googleusercontent.com/synthetic'})),'synthetic');
  const {context,$,timers}=review({delayed:true});
  context.mode='google';
  context.items=store.listItems();
  const writes=[];
  let releaseWorkspace,releaseDecision;
  context.api=async(path,data)=>{
   if(path==='/workspace'){
    const snapshot={items:store.listItems(),jobs:[]};
    await new Promise(resolve=>{releaseWorkspace=resolve;});
    return snapshot;
   }
   assert.equal(path,'/decisions');
   if(!writes.length)await new Promise(resolve=>{releaseDecision=resolve;});
   const result=store.decide(data.id,data.decision,data.revision);
   writes.push([data.id,data.decision]);
   return result;
  };
  vm.runInContext(source.slice(source.indexOf('async function updateDecision('),source.indexOf('let reviewActions=')),context);
  const refresh=context.refreshWorkspace();
  await new Promise(resolve=>setImmediate(resolve));
  const press=keyboard(context);
  for(const key of ['ArrowLeft','z','ArrowRight','z','ArrowLeft','ArrowLeft','z','z'])press(key);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(releaseDecision,undefined);
  assert.equal(context.animating,false);
  releaseWorkspace();
  await refresh;
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(context.animating,true);
  releaseDecision();
  assert.equal(timers.length,0);
  await context.reviewActions;
  assert.deepEqual(writes,[['synthetic:first','remove'],['synthetic:first',null],['synthetic:first','keep'],['synthetic:first',null],['synthetic:first','remove'],['synthetic:next','remove'],['synthetic:next',null],['synthetic:first',null]]);
  assert.ok(store.listItems().every(item=>item.decision===null));
  assert.equal(context.history.length,0);
  assert.equal($('progress-text').textContent,'0 of 3 reviewed');
  assert.equal(removalQueue(context.items,context.decisions).length,0);
 }finally{store.close();}
});

test('workspace reload waits for an in-flight decision without waiting for animation',async()=>{
 const {context,timers}=review({delayed:true});
 const save=context.updateDecision;
 let release,reads=0;
 context.updateDecision=async(item,decision)=>{await new Promise(resolve=>{release=resolve;});return await save(item,decision);};
 context.api=async()=>{reads++;return {items:context.items.map(item=>({...item,decision:context.decisions[item.id]})),jobs:[]};};
 const swipe=context.choose('keep');
 await new Promise(resolve=>setImmediate(resolve));
 const refresh=context.refreshWorkspace();
 assert.equal(reads,0);
 release();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(timers.length,0);
 await swipe;
 await refresh;
 assert.equal(reads,1);
 assert.equal(context.decisions.first,'keep');
});

test('sort, filter, and navigation cannot change the target of a queued burst',async()=>{
 const {context,$,timers,writes}=review({delayed:true});
 context.sort='original';
 let selectedFilter;
 const filterButton={dataset:{filter:'video'}};
 context.document={querySelectorAll:()=>[filterButton],addEventListener(){}};
 context.setFilter=value=>{selectedFilter=value;};
 vm.runInContext(source.split('\n').find(line=>line.startsWith('function showView(')),context);
 const handlers=source.split('\n').find(line=>line.startsWith("document.querySelectorAll('[data-filter]')"));
 vm.runInContext(handlers.slice(0,handlers.indexOf("document.addEventListener('keydown'")),context);
 const first=context.choose('remove'),second=context.choose('keep');
 const sortTarget={value:'newest'};
 $('sort').onchange({target:sortTarget});
 filterButton.onclick();
 context.showView('queue');
 assert.equal(context.sort,'original');
 assert.equal(sortTarget.value,'original');
 assert.equal(selectedFilter,undefined);
 assert.equal($('review-view').hidden,false);
 assert.equal(timers.length,0);
 await Promise.all([first,second]);
 assert.deepEqual(writes,[['first','remove'],['next','keep']]);
 sortTarget.value='newest';
 $('sort').onchange({target:sortTarget});
 filterButton.onclick();
 assert.equal(context.sort,'newest');
 assert.equal(selectedFilter,'video');
});

function viewerReview(context){
 let callbacks,opens=0;
 context.ensurePreview=()=>{};
 context.loadVideo=()=>{};
 context.createPhotoViewer=(dialog,preview,video,review)=>{callbacks=review;return {open(){opens++;}};};
 vm.runInContext(source.split('\n').find(line=>line.startsWith('const photoViewer=createPhotoViewer(')),context);
 vm.runInContext(source.split('\n').find(line=>line.startsWith('function enlargeMedia(')),context);
 return {callbacks,opens:()=>opens};
}

test('reload locks viewer and pointer decisions when the pending head changes',async()=>{
 const {context,$,writes}=review();
 const viewer=viewerReview(context);
 let release;
 context.api=()=>new Promise(resolve=>{release=resolve;});
 $('card').onpointerdown(pointer(200));
 const refresh=context.refreshWorkspace();
 assert.equal(context.workspaceLoadsPending,1);
 assert.equal(context.reviewActionsPending,1);
 assert.equal(viewer.callbacks.canDecide(),false);
 assert.equal(viewer.callbacks.canUndo(),false);
 context.enlargeMedia(context.active());
 assert.equal(viewer.opens(),0);
 assertReset($);
 $('card').onpointerdown(pointer(200));
 $('card').onpointermove(pointer(320));
 $('card').onpointerup(pointer(320));
 assertReset($);
 await assert.rejects(viewer.callbacks.decide('keep','first'),/Wait for the current operation/);
 await new Promise(resolve=>setImmediate(resolve));
 release({items:[{id:'next'},{id:'third'}],jobs:[]});
 await refresh;
 assert.equal(context.active().id,'next');
 assert.equal(context.workspaceLoadsPending,0);
 assert.equal(context.reviewActionsPending,0);
 await assert.rejects(viewer.callbacks.decide('remove','first'),/Wait for the current operation/);
 assert.deepEqual(writes,[]);
 assert.equal(viewer.callbacks.canDecide(),true);
 await viewer.callbacks.decide('keep','next');
 assert.deepEqual(writes,[['next','keep']]);
});

test('a pinned viewer decision skips a replaced head even if its previous decision matches',async()=>{
 const {context,writes}=review();
 const {callbacks}=viewerReview(context);
 context.decisions.first='keep';
 context.active=()=>context.items[0];
 const result=callbacks.decide('keep','first');
 context.active=()=>context.items[1];
 await assert.rejects(result,/could not be saved/);
 assert.deepEqual(writes,[]);
});

for(const input of ['viewer','pointer'])test(`reload cancels a queued ${input} decision before replacing the pending head`,async()=>{
 const {context,$,writes}=review();
 const {callbacks}=viewerReview(context);
 let decision;
 if(input==='viewer')decision=assert.rejects(callbacks.decide('keep','first'),/could not be saved/);
 else{
  $('card').onpointerdown(pointer(200));
  $('card').onpointerup(pointer(320));
  decision=context.reviewActions;
 }
 const refresh=context.refreshWorkspace(false,{items:[{id:'next'},{id:'third'}],jobs:[]});
 await Promise.all([decision,refresh]);
 assert.equal(context.active().id,'next');
 assert.deepEqual(writes,[]);
 assert.equal(context.history.length,0);
 assert.equal(context.workspaceLoadsPending,0);
 assert.equal(context.reviewActionsPending,0);
 assertReset($);
 await callbacks.decide('remove','next');
 assert.deepEqual(writes,[['next','remove']]);
});

test('reload failure releases viewer and pointer controls',async()=>{
 const {context,$,writes}=review();
 const {callbacks}=viewerReview(context);
 context.api=async()=>{throw Error('Synthetic reload failure');};
 await assert.rejects(context.refreshWorkspace(),/Synthetic reload failure/);
 assert.equal(context.workspaceLoadsPending,0);
 assert.equal(context.reviewActionsPending,0);
 assert.equal(callbacks.canDecide(),true);
 $('card').onpointerdown(pointer(200));
 $('card').onpointerup(pointer(320));
 await context.reviewActions;
 assert.deepEqual(writes,[['first','keep']]);
});

test('viewer controls block input during reload and pass the displayed id after unlocking',async()=>{
 const viewerSource=await readFile(new URL('../public/viewer.js',import.meta.url),'utf8');
 const writes=[],shown=[];
 let loading=true;
 const context=vm.createContext({canReview:true,working:false,current:{id:'displayed'},request:0,actions:{},removeButton:{},keepButton:{},undoButton:{},review:{canDecide:()=>!loading,canUndo:()=>!loading,decide:async(decision,id)=>{writes.push([id,decision]);return {id:'next'};}},dialog:{open:true,focus(){}},status:{},show:async item=>shown.push(item.id)});
 for(const name of ['controls','decide'])vm.runInContext(viewerSource.split('\n').find(line=>line.trimStart().startsWith(`function ${name}(`)||line.trimStart().startsWith(`async function ${name}(`)),context);
 context.controls();
 assert.equal(context.keepButton.disabled,true);
 assert.equal(context.removeButton.disabled,true);
 assert.equal(context.undoButton.disabled,true);
 await context.decide('remove');
 assert.deepEqual(writes,[]);
 loading=false;
 context.controls();
 assert.equal(context.keepButton.disabled,false);
 assert.equal(context.removeButton.disabled,false);
 assert.equal(context.undoButton.disabled,false);
 await context.decide('remove');
 assert.deepEqual(writes,[['displayed','remove']]);
 assert.deepEqual(shown,['next']);
});


test('viewer swipe gestures cannot start while a workspace reload locks decisions',async()=>{
 const viewerSource=await readFile(new URL('../public/viewer.js',import.meta.url),'utf8');
 const context=vm.createContext({working:false,canReview:true,current:{id:'first'},review:{canDecide:()=>false},ready:false,scale:1,pointers:new Map(),swipe:null,swipeZone:{setPointerCapture:()=>assert.fail('Locked gestures must not capture the pointer')}});
 vm.runInContext(viewerSource.slice(viewerSource.indexOf('  function down('),viewerSource.indexOf('  function move(')),context);
 context.down({button:0,target:{closest:()=>null},currentTarget:context.swipeZone,pointerId:1,clientX:200,clientY:100});
 assert.equal(context.swipe,null);
});

test('a short pointer fling saves at release and the next gesture does not wait for animation',async()=>{
 const {context,$,writes,timers}=review({delayed:true});
 const card=$('card'),throws=[];
 context.matchMedia=()=>({matches:false});
 context.throwSwipe=(element,dx,duration)=>{throws.push({element,dx,duration});};
 card.onpointerdown({...pointer(200),timeStamp:0});
 card.onpointermove({...pointer(215),timeStamp:20});
 card.onpointerup({...pointer(240),timeStamp:50});
 await context.reviewActions;
 assert.deepEqual(writes,[['first','keep']]);
 assert.equal(context.animating,false);
 assert.equal(timers.length,0);
 card.onpointerdown({...pointer(200),timeStamp:100});
 card.onpointerup({...pointer(160),timeStamp:150});
 await context.reviewActions;
 assert.deepEqual(writes,[['first','keep'],['next','remove']]);
 assert.equal(throws.length,2);
 assert.equal(throws[0].duration,252);
 assert.equal(throws[1].dx,-1);
});

test('a cancelled pointer fling resets the stamp without writing a decision',async()=>{
 const {context,$,writes}=review();
 $('card').onpointerdown({...pointer(200),timeStamp:0});
 $('card').onpointermove({...pointer(350),timeStamp:20});
 $('card').onpointercancel({...pointer(350),timeStamp:30});
 await context.reviewActions;
 assert.deepEqual(writes,[]);
 assertReset($);
});
