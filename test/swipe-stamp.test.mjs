import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
function review(){
 const elements=new Map(),items=[{id:'first'},{id:'next'}],decisions={},history=[];
 const $=id=>{
  if(!elements.has(id)){
   const classes=new Set();
   elements.set(id,{style:{},dataset:{},hidden:false,textContent:'',classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)},querySelector:()=>null,setPointerCapture(){}});
  }
  return elements.get(id);
 };
 const context=vm.createContext({$,items,decisions,history,busy:false,animating:false,mode:'fake',workspace:{},active:()=>items.find(item=>!decisions[item.id]),pending:()=>items.filter(item=>!decisions[item.id]),summarize:()=>({kept:[],sent:[],reviewed:Object.keys(decisions).length}),removalQueue:()=>[],renderStorage(){},renderCard(){},renderQueue(){},renderOperations(){},renderReconciliation(){},renderControls(){},prefetchReview(){},toast(){},updateDecision:async(item,decision)=>{if(decision)decisions[item.id]=decision;else delete decisions[item.id];},matchMedia:()=>({matches:true}),setTimeout:fn=>fn()});
 vm.runInContext(source.slice(source.indexOf('function renderGuide('),source.indexOf("$('toast').onclick=")),context);
 for(const name of ['render','choose','undo']){
  const line=source.split('\n').find(line=>line.startsWith(`function ${name}(`)||line.startsWith(`async function ${name}(`));
  vm.runInContext(line,context);
 }
 vm.runInContext(source.split('\n').find(line=>line.startsWith('let startX=null;')),context);
 context.render();
 return {context,$,decisions};
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
