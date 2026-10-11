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
async function browser(t){
 const store=createStore();t.after(()=>store.close());
 store.setSetting('account','fake');
 store.importItems(['a','b'].map(mediaKey=>({mediaKey,name:mediaKey+'.jpg',type:'photo',thumbUrl:'https://lh3.googleusercontent.com/fake'})),'fake');
 const elements=new Map(),timers=new Map(),storage=new Map(),listeners=new Map();let timerId=0,workspaceWait=null,decisionWait=null;
 function element(){return {style:{},dataset:{},hidden:false,open:false,classList:{add(){},remove(){},toggle(){}},addEventListener(){},querySelector:()=>null,setAttribute(){},removeAttribute(){},replaceChildren(){},append(){},before(){},showModal(){this.open=true;},close(){this.open=false;}};}
 const getElement=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
 const snapshot=()=>({items:store.listItems().map(item=>({...item,url:'data:image/png;base64,fake'})),jobs:[]});
 const sessionStorage={getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)};
 const context=vm.createContext({
  ...model,...undoHistory,createConnectionCheck,sessionStorage,localStorage:sessionStorage,
  document:{getElementById:getElement,querySelectorAll:()=>[],querySelector:()=>null,createElement:element,addEventListener(){}},
  window:{addEventListener:(name,fn)=>listeners.set(name,fn)},location:{hash:'',pathname:'/'},
  createPhotoViewer:()=>({refreshControls(){}}),bridge:async()=>({installed:true,paired:false}),
  cached:async()=>null,evict:async()=>{},URL,URLSearchParams,AbortSignal,
  IntersectionObserver:class{disconnect(){}observe(){}},matchMedia:()=>({matches:false,addEventListener(){}}),
  setTimeout:(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId;},clearTimeout:id=>timers.delete(id),setInterval(){},
  fetch:async(path,options)=>{
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
 return {context,store,sessionStorage,getElement,snapshot,
  delayWorkspace(){workspaceWait=deferred();return workspaceWait;},
  delayDecision(){decisionWait=deferred();return decisionWait;},
  async finishSwipe(){await settle();const animation=[...timers].find(([,timer])=>timer.delay===230);assert.ok(animation,'swipe animation started');timers.delete(animation[0]);animation[1].fn();await settle();},
  focus:()=>listeners.get('focus')()
 };
}

for(const arrival of ['during decision write','during animation','after animation'])test(`stale focus refresh cannot erase a swipe ${arrival}`,async t=>{
 const b=await browser(t),stale=b.delayWorkspace();b.focus();
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
 await b.context.refreshWorkspace();
 assert.equal(b.getElement('undo').disabled,false);
 await b.getElement('undo').onclick();
 assert.equal(b.store.listItems()[0].decision,null);
 assert.equal(undoHistory.loadUndoHistory(b.sessionStorage).length,0);
});

test('refresh started during a decision write cannot replace the active item or undo history',async t=>{
 const b=await browser(t),write=b.delayDecision();
 const swipe=b.getElement('keep').onclick();await settle();
 await b.context.refreshWorkspace();write.resolve();await b.finishSwipe();await swipe;
 assert.equal(b.getElement('kept').textContent,1);
 assert.equal(vm.runInContext('items[0].revision',b.context),b.store.listItems()[0].revision);
 await b.getElement('undo').onclick();
 assert.equal(b.store.listItems()[0].decision,null);
 assert.equal(b.getElement('kept').textContent,0);
});

test('older refresh cannot supersede a newer snapshot that invalidates undo',async t=>{
 const b=await browser(t),swipe=b.getElement('remove').onclick();await b.finishSwipe();await swipe;
 const stale=b.delayWorkspace(),refresh=b.context.refreshWorkspace();
 const item=b.store.listItems()[0];b.store.decide(item.id,'keep',item.revision);
 await b.context.refreshWorkspace();stale.resolve();await refresh;
 assert.equal(b.getElement('kept').textContent,1);
 assert.equal(b.getElement('undo').disabled,true);
 assert.equal(undoHistory.loadUndoHistory(b.sessionStorage).length,0);
});

for(const signInAgain of [false,true])test(`pending refresh cannot restore signed-out history${signInAgain?' after sign-in':''}`,async t=>{
 const b=await browser(t),swipe=b.getElement('remove').onclick();await b.finishSwipe();await swipe;
 const stale=b.delayWorkspace(),refresh=b.context.refreshWorkspace();
 await b.getElement('lock').onclick();
 if(signInAgain){const item=b.store.listItems()[0];b.store.decide(item.id,'keep',item.revision);await b.context.unlocked();}
 stale.resolve();await refresh;
 assert.equal(b.getElement('undo').disabled,true);
 assert.equal(undoHistory.loadUndoHistory(b.sessionStorage).length,0);
 assert.equal(b.getElement('removed').textContent,0);
 assert.equal(b.getElement('kept').textContent,signInAgain?1:0);
});
