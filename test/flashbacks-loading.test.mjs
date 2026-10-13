import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {flashbackDeck} from '../lib/userscript-order.mjs';
import {emptyReview,loadReviewPages,mergeReviewPage} from '../lib/userscript-core.mjs';

const source=await readFile(new URL('../lib/userscript-ui.mjs',import.meta.url),'utf8');
const loadSource=source.slice(source.indexOf(' async function load(refresh='),source.indexOf(" mediaElement.addEventListener('wheel'"));
const items=Array.from({length:48},(_,index)=>({mediaKey:`synthetic-${index}`,date:new Date(Date.UTC(2000+Math.floor(index/8),0,1,0,index%8)).toISOString(),decision:null,state:'active'}));

for(const swipe of [false,true])test(`failed later page pins the displayed card after ${swipe?'a swipe':'the first render'}`,async()=>{
 const saved={};
 let calls=0,shown;
 const context=vm.createContext({state:emptyReview(),leaseGeneration:0,sessionClosing:false,focused:null,shown:null,inspected:null,libraryFailure:null,deckItems:null,syncRunning:Promise.resolve(),buffer:{clear(){}},previousKey:null,$:()=>({value:'flashbacks'}),pageVisible:()=>true,assertSaveAccount:async()=>{},markSyncChanges:(_,next)=>next,mergeReviewPage,loadReviewPages,writes:{enqueue:async()=>{},pending:false},message(){},call:async()=>{
  if(calls++){
   if(swipe){
    saved.seen=[context.shown];
    context.state={...context.state,items:context.state.items.map(item=>item.mediaKey===context.shown?{...item,decision:'remove'}:item)};
    context.focused=null;
    context.render();
   }
   shown=context.shown;
   throw Error('Synthetic page failure');
  }
  return {items:items.slice(28),nextPageId:'synthetic-next'};
 },render(){context.shown=flashbackDeck(context.state,saved,()=>0,Date.now(),context.focused,!!context.libraryFailure)[0]?.mediaKey||null;}});
 vm.runInContext(loadSource,context);
 await assert.rejects(context.load(),/Synthetic page failure/);
 context.render();
 assert.equal(context.shown,shown);
 assert.equal(saved.keys[0],shown);
 assert.equal(saved.keys.length,20-Number(swipe));
});

test('an already visible boundary stays together when older photos arrive',()=>{
 const state={items:items.slice(28),started:true,exhausted:false},saved={};
 flashbackDeck(state,saved,()=>.99,Date.now(),null,true);
 const shown=items[28];
 assert.equal(saved.keys[0],shown.mediaKey);
 state.items=items.slice(12);
 const deck=flashbackDeck(state,saved,()=>0,Date.now(),shown.mediaKey);
 const expected=[...items.slice(28,32),...items.slice(24,28)];
 assert.deepEqual(deck.slice(0,8),expected);
 assert.deepEqual(saved.starts.filter(key=>items.slice(24,32).some(item=>item.mediaKey===key)),[shown.mediaKey]);
 assert.equal(new Set(saved.keys).size,deck.length);
 assert.deepEqual(flashbackDeck(state,saved,()=>.99,Date.now(),shown.mediaKey),deck);
 assert.deepEqual(flashbackDeck(state,JSON.parse(JSON.stringify(saved)),()=>.99),deck);
 saved.seen=[shown.mediaKey];
 state.items=state.items.map(item=>item===shown?{...item,decision:'remove'}:item);
 assert.deepEqual(flashbackDeck(state,saved,()=>0).slice(0,7),expected.slice(1));
 assert.ok(saved.starts.includes(shown.mediaKey));
});
