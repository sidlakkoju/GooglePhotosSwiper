import {sampleSwipe,releaseSwipe,animateSwipe,throwSwipe} from '../public/swipe.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createStore} from '../lib/store.mjs';
import * as model from '../public/model.js';
import * as undoHistory from '../public/undo-history.js';
import {createConnectionCheck} from '../public/connection.js';

function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function settle(){for(let n=0;n<12;n++)await Promise.resolve();}
async function browser(t,previous=null){
 const store=previous?.store||createStore();if(!previous)t.after(()=>store.close());
 if(!previous){store.setSetting('account','fake');
 store.importItems(['a','b'].map(mediaKey=>({mediaKey,name:mediaKey+'.jpg',type:'photo',thumbUrl:'https://lh3.googleusercontent.com/fake'})),'fake');}
 const elements=new Map(),timers=new Map(),storage=previous?.storage||new Map(),listeners=new Map();let timerId=0,workspaceWait=null,decisionWait=null,unauthorizedPath=null;
 function element(){return {style:{},dataset:{},hidden:false,open:false,classList:{add(){},remove(){},toggle(){}},addEventListener(){},querySelector:()=>null,setAttribute(){},removeAttribute(){},replaceChildren(){},append(){},before(){},showModal(){this.open=true;},close(){this.open=false;}};}
 const getElement=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
 const snapshot=()=>({items:store.listItems().map(item=>({...item,url:'data:image/png;base64,fake'})),jobs:[]});
 const sessionStorage={getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)};
 const context=vm.createContext({
  sampleSwipe,releaseSwipe,animateSwipe,throwSwipe,...model,...undoHistory,createConnectionCheck,sessionStorage,localStorage:sessionStorage,
  document:{getElementById:getElement,querySelectorAll:()=>[],querySelector:()=>null,createElement:element,addEventListener(){}},
  window:{addEventListener:(name,fn)=>listeners.set(name,fn)},location:{hash:'',pathname:'/'},
  createPhotoViewer:()=>({refreshControls(){}}),bridge:async()=>({installed:true,paired:false}),
  cached:async()=>null,evict:async()=>{},URL,URLSearchParams,AbortSignal,
  IntersectionObserver:class{disconnect(){}observe(){}},matchMedia:()=>({matches:false,addEventListener(){}}),
  setTimeout:(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId;},clearTimeout:id=>timers.delete(id),setInterval(){},
  fetch:async(path,options)=>{
   if(path===unauthorizedPath){unauthorizedPath=null;return {ok:false,status:401,json:async()=>({})};}
   let body;
   if(path==='/api/session')body={authenticated:false};
   else if(path==='/api/workspace'){body=snapshot();if(workspaceWait){const wait=workspaceWait;workspaceWait=null;await wait.promise;}}
   else if(path==='/api/decisions'){if(decisionWait){const wait=decisionWait;decisionWait=null;await wait.promise;}const {id,decision,revision}=JSON.parse(options.body);body=store.decide(id,decision,revision);}
   else if(path==='/api/logout')body={};
   else throw Error('Unexpected request '+path);
   return {ok:true,json:async()=>body};
  }
 });
 const source=(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
 vm.runInContext(source,context);await settle();await context.unlocked();
 return {context,store,storage,sessionStorage,getElement,snapshot,
  expireRequest(path){unauthorizedPath=path;},
  delayWorkspace(){workspaceWait=deferred();return workspaceWait;},
  delayDecision(){decisionWait=deferred();return decisionWait;},
  async finishSwipe(){await settle();assert.equal([...timers.values()].some(timer=>timer.delay===230),false,'decision must not wait for animation');await settle();},
  focus:()=>listeners.get('focus')()
 };
}

for(const arrival of ['during decision write','during animation','after animation'])test(`stale workspace load cannot erase a swipe ${arrival}`,async t=>{
 const b=await browser(t),stale=b.delayWorkspace();b.context.loadWorkspace();
 const write=arrival==='during decision write'?b.delayDecision():null;
 const swipe=b.getElement('remove').onclick();await settle();
 if(arrival==='after animation')await b.finishSwipe();
 stale.resolve();await settle();
 if(write){write.resolve();await settle();}
 if(arrival!=='after animation')await b.finishSwipe();
 await swipe;
 assert.equal(b.getElement('undo').disabled,false);
 assert.equal(b.getElement('removed').textContent,1);
 assert.equal(undoHistory.loadUndoHistory(b.sessionStorage).length,1);
 await b.context.loadWorkspace();
 assert.equal(b.getElement('undo').disabled,false);
 await b.getElement('undo').onclick();
 assert.equal(b.store.listItems()[0].decision,null);
 assert.equal(undoHistory.loadUndoHistory(b.sessionStorage).length,0);
});

test('refresh started during a decision write cannot replace the active item or undo history',async t=>{
 const b=await browser(t),write=b.delayDecision();
 const swipe=b.getElement('keep').onclick();await settle();
 const refresh=b.context.loadWorkspace();write.resolve();await b.finishSwipe();await swipe;await refresh;
 assert.equal(b.getElement('kept').textContent,1);
 assert.equal(vm.runInContext('items[0].revision',b.context),b.store.listItems()[0].revision);
 await b.getElement('undo').onclick();
 assert.equal(b.store.listItems()[0].decision,null);
 assert.equal(b.getElement('kept').textContent,0);
});

test('older refresh cannot supersede a newer snapshot that invalidates undo',async t=>{
 const b=await browser(t),swipe=b.getElement('remove').onclick();await b.finishSwipe();await swipe;
 const stale=b.delayWorkspace(),refresh=b.context.loadWorkspace();
 const item=b.store.listItems()[0];b.store.decide(item.id,'keep',item.revision);
 await b.context.loadWorkspace();stale.resolve();await refresh;
 assert.equal(b.getElement('kept').textContent,1);
 assert.equal(b.getElement('undo').disabled,true);
 assert.equal(undoHistory.loadUndoHistory(b.sessionStorage).length,0);
});

for(const signInAgain of [false,true])test(`pending refresh cannot restore signed-out history${signInAgain?' after sign-in':''}`,async t=>{
 const b=await browser(t),swipe=b.getElement('remove').onclick();await b.finishSwipe();await swipe;
 const stale=b.delayWorkspace(),refresh=b.context.loadWorkspace();
 await b.getElement('lock').onclick();
 if(signInAgain){const item=b.store.listItems()[0];b.store.decide(item.id,'keep',item.revision);await b.context.unlocked();}
 stale.resolve();await refresh;
 assert.equal(b.getElement('undo').disabled,true);
 assert.equal(undoHistory.loadUndoHistory(b.sessionStorage).length,0);
 assert.equal(b.getElement('removed').textContent,0);
 assert.equal(b.getElement('kept').textContent,signInAgain?1:0);
});

for(const signInAgain of [false,true])test(`sign-out discards an in-flight swipe${signInAgain?' across another sign-in':''}`,async t=>{
 const b=await browser(t),write=b.delayDecision();
 const swipe=b.getElement('remove').onclick();await settle();
 await b.getElement('lock').onclick();
 const signIn=signInAgain?b.context.unlocked():null;
 write.resolve();await swipe;if(signIn)await signIn;
 assert.equal(b.getElement('undo').disabled,true);
 assert.equal(undoHistory.loadUndoHistory(b.sessionStorage).length,0);
 assert.equal(vm.runInContext('Object.keys(decisions).length',b.context),signInAgain?1:0);
 await b.context.unlocked();
 assert.equal(b.getElement('removed').textContent,1);
 assert.equal(b.getElement('undo').disabled,true);
});

for(const timing of ['before write','during write'])test(`overlapping refresh retries and applies other workspace changes ${timing}`,async t=>{
 const b=await browser(t),stale=b.delayWorkspace();
 let refresh;
 if(timing==='before write')refresh=b.context.loadWorkspace(true);
 const write=b.delayDecision(),swipe=b.getElement('remove').onclick();await settle();
 if(timing==='during write')refresh=b.context.loadWorkspace(true,b.snapshot());
 const other=b.store.listItems()[1];b.store.decide(other.id,'keep',other.revision);
 b.store.importItems([{mediaKey:'c',name:'c.jpg',type:'photo',thumbUrl:'https://lh3.googleusercontent.com/fake'}],'fake');
 stale.resolve();await settle();write.resolve();await b.finishSwipe();await swipe;await refresh;
 assert.equal(b.getElement('kept').textContent,1);
 assert.equal(b.getElement('removed').textContent,1);
 assert.equal(vm.runInContext('items.length',b.context),3);
 assert.equal(b.getElement('undo').disabled,false);
});

test('app reload restores tab history and undoes swipes in reverse order',async t=>{
 const first=await browser(t);
 for(const action of ['remove','keep']){const swipe=first.getElement(action).onclick();await first.finishSwipe();await swipe;}
 const reloaded=await browser(t,first);
 assert.equal(reloaded.getElement('undo').disabled,false);
 assert.equal(reloaded.getElement('kept').textContent,1);
 assert.equal(reloaded.getElement('removed').textContent,1);
 await reloaded.getElement('undo').onclick();
 assert.equal(reloaded.store.listItems()[1].decision,null);
 assert.equal(reloaded.store.listItems()[0].decision,'remove');
 await reloaded.getElement('undo').onclick();
 assert.ok(reloaded.store.listItems().every(item=>item.decision===null));
 assert.equal(reloaded.getElement('undo').disabled,true);
 assert.equal(undoHistory.loadUndoHistory(reloaded.sessionStorage).length,0);
});

for(const path of ['/api/logout','/api/workspace'])test(`session expiry at ${path} clears tab history before sign-in or reload`,async t=>{
 const b=await browser(t),swipe=b.getElement('remove').onclick();await b.finishSwipe();await swipe;
 const stale=b.delayWorkspace(),refresh=b.context.loadWorkspace();
 b.expireRequest(path);
 if(path==='/api/logout')await b.getElement('lock').onclick();
 else await assert.rejects(b.context.loadWorkspace(),/sign-in expired/);
 assert.equal(b.getElement('login-dialog').open,true);
 assert.equal(b.getElement('undo').disabled,true);
 assert.equal(undoHistory.loadUndoHistory(b.sessionStorage).length,0);
 assert.equal(vm.runInContext('history.length',b.context),0);
 assert.equal(vm.runInContext('items.length',b.context),0);
 assert.equal(vm.runInContext('Object.keys(decisions).length',b.context),0);
 assert.equal(b.getElement('removed').textContent,0);
 await b.context.unlocked();
 stale.resolve();await refresh;
 assert.equal(b.getElement('removed').textContent,1);
 assert.equal(b.getElement('undo').disabled,true);
 assert.equal(undoHistory.loadUndoHistory(b.sessionStorage).length,0);
 const reloaded=await browser(t,b);
 assert.equal(reloaded.getElement('undo').disabled,true);
 assert.equal(undoHistory.loadUndoHistory(reloaded.sessionStorage).length,0);
});
