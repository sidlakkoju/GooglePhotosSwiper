import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmReviewTrash,markReviewTrash} from '../lib/userscript-core.mjs';

const fakeCall=({firstPage=[],states={},pages=[[]],failState=false}={})=>{
 const calls=[];
 const call=async(operation,args)=>{
  calls.push([operation,args.mediaKey??args.cursor??null]);
  if(operation==='trashPage'){
   if(args.cursor===null&&firstPage)return {items:firstPage.map(mediaKey=>({mediaKey})),nextPageId:pages.length>1?'1':null};
   const index=Number(args.cursor||0);return {items:pages[index].map(mediaKey=>({mediaKey})),nextPageId:index+1<pages.length?String(index+1):null};
  }
  if(operation==='itemState'){if(failState)throw Error('Unavailable');const value=states[args.mediaKey];return {state:typeof value==='function'?value():value||'active'};}
  throw Error(`Unexpected ${operation}`);
 };
 return {call,calls};
};

test('items on the first Trash page are confirmed with a single request',async()=>{
 const keys=Array.from({length:25},(_,index)=>`batch-${index}`);
 const {call,calls}=fakeCall({firstPage:['older',...keys]});
 const confirmed=await confirmReviewTrash(keys,call,{sleep:async()=>assert.fail('no retry expected')});
 assert.deepEqual([...confirmed].sort(),[...keys].sort());
 assert.deepEqual(calls,[['trashPage',null]]);
});

test('items missing from the first page are checked individually and in parallel',async()=>{
 const keys=Array.from({length:20},(_,index)=>`batch-${index}`);
 let inFlight=0,peak=0;
 const states=Object.fromEntries(keys.map(key=>[key,'in_trash']));
 const {call:inner,calls}=fakeCall({firstPage:keys.slice(0,4),states});
 const call=async(operation,args)=>{if(operation!=='itemState')return inner(operation,args);inFlight++;peak=Math.max(peak,inFlight);await new Promise(resolve=>setTimeout(resolve,5));inFlight--;return inner(operation,args);};
 const confirmed=await confirmReviewTrash(keys,call,{concurrency:8,sleep:async()=>assert.fail('no retry expected')});
 assert.equal(confirmed.size,20);
 assert.equal(calls.filter(([operation])=>operation==='itemState').length,16);
 assert.equal(peak,8);
});

test('an item that reaches Trash late is confirmed by the retry without a full Trash scan',async()=>{
 let ready=false;const sleeps=[];
 const {call,calls}=fakeCall({states:{late:()=>ready?'in_trash':'active'}});
 const confirmed=await confirmReviewTrash(['late'],call,{sleep:async delay=>{sleeps.push(delay);ready=true;}});
 assert.deepEqual([...confirmed],['late']);assert.deepEqual(sleeps,[1500]);
 assert.deepEqual(calls.map(([operation])=>operation),['trashPage','itemState','itemState']);
});

test('when item checks fail the full Trash scan decides, and absent items stay unconfirmed',async()=>{
 const {call,calls}=fakeCall({firstPage:[],pages:[['other'],['deep']],failState:true});
 const confirmed=await confirmReviewTrash(['deep','missing'],call,{sleep:async()=>{}});
 assert.deepEqual([...confirmed],['deep']);
 assert.deepEqual(calls.filter(([operation])=>operation==='trashPage').length,3);
});

test('markReviewTrash bins only the confirmed items once and adds their bytes to lifetime freed',()=>{
 const state={lifetimeFreed:100,items:[{mediaKey:'a',state:'active',size:10,revision:2},{mediaKey:'b',state:'active',size:20,revision:0},{mediaKey:'c',state:'in_trash',size:40,revision:1}]};
 const next=markReviewTrash(state,new Set(['a','c']));
 assert.deepEqual(next.items.map(item=>[item.mediaKey,item.state,item.revision]),[['a','in_trash',3],['b','active',0],['c','in_trash',1]]);
 assert.equal(next.lifetimeFreed,110);
 assert.equal(markReviewTrash(next,['a','c']),next);
});
