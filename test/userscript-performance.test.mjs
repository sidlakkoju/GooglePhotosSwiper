import test from 'node:test';
import assert from 'node:assert/strict';
import {previewURL,createPreloadBuffer,createWriteQueue} from '../lib/userscript-performance.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const item=mediaKey=>({mediaKey});
test('preview sizes use capped DPR and CDN buckets without original downloads',()=>{
 for(const [width,dpr,size] of [[360,1,512],[360,2,768],[360,3,768],[500,2,1024],[800,2,1600]]){
  const url=previewURL('https://lh3.googleusercontent.com/image=d',{width,height:width,dpr});
  assert.ok(url.includes(`=w${size}-h${size}-k-no`));assert.equal(url.includes('=d'),false);
 }
 assert.match(previewURL('https://lh3.googleusercontent.com/image',{width:800,height:800,dpr:3,mobile:true}),/=w1024-h1024/);
 assert.throws(()=>previewURL('https://evil.example/image'));
});
test('buffer bounds concurrent loads, evicts, aborts and ignores stale generations',async()=>{
 const loads=[];
 const buffer=createPreloadBuffer({size:3,concurrency:2,load:(item,signal)=>new Promise(resolve=>loads.push({item,signal,resolve}))});
 buffer.update(['a','b','c','d'].map(item));await tick();
 assert.deepEqual(loads.map(load=>load.item.mediaKey),['a','b']);assert.equal(buffer.entries.size,3);
 const image={src:'a'};loads[0].resolve(image);await tick();
 assert.equal(buffer.get('a'),image);assert.equal(loads.length,3);
 buffer.update(['b','c','d'].map(item),'a');assert.equal(buffer.get('a'),image);
 buffer.update(['c','d','e'].map(item));assert.equal(loads[1].signal.aborted,true);assert.equal(image.src,'');
 buffer.clear();loads[1].resolve({src:'stale'});loads[2].resolve({src:'stale'});await tick();
 assert.equal(buffer.entries.size,0);assert.equal(buffer.get('b'),null);
});
test('write queue serializes writes and coalesces a burst to the latest snapshot',async()=>{
 let state=0,revision=0,finish;const calls=[];
 const queue=createWriteQueue({snapshot:()=>({state,revision}),write:value=>{calls.push(value);return new Promise(resolve=>{finish=()=>resolve({...value,revision:value.revision+1});});},committed:saved=>{revision=saved.revision;}});
 state=1;queue.enqueue();await tick();state=2;queue.enqueue();state=3;queue.enqueue();
 assert.equal(calls.length,1);finish();await tick();
 assert.deepEqual(calls[1],{state:3,revision:1});finish();await queue.flush();
 assert.equal(calls.length,2);assert.equal(revision,2);assert.equal(queue.pending,false);
});
test('failed writes remain pending and can retry without losing new state',async()=>{
 let fail=true,state=1;const errors=[],saved=[];
 const queue=createWriteQueue({snapshot:()=>state,write:async value=>{if(fail)throw Error('Offline');saved.push(value);return value;},committed:()=>{},error:failure=>errors.push(failure.message)});
 await queue.enqueue();assert.equal(queue.pending,true);assert.deepEqual(errors,['Offline']);
 state=2;fail=false;await queue.enqueue();assert.deepEqual(saved,[2]);assert.equal(queue.pending,false);
});

test('moving a decoded photo into the card prevents refill from clearing its source',async()=>{
 const image={src:'decoded'};
 const buffer=createPreloadBuffer({size:1,load:async()=>image});
 buffer.update([item('a')]);await tick();assert.equal(buffer.take('a'),image);
 buffer.update([item('b')]);assert.equal(image.src,'decoded');
 buffer.clear();
});

test('a synchronous burst is persisted once with the latest state',async()=>{
 let state=0;const saved=[];
 const queue=createWriteQueue({snapshot:()=>state,write:async value=>{saved.push(value);return value;},committed:()=>{}});
 for(let index=1;index<=10;index++){state=index;queue.enqueue();}
 await queue.flush();assert.deepEqual(saved,[10]);
});
