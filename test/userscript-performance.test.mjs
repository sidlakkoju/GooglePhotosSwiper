import test from 'node:test';
import assert from 'node:assert/strict';
import {cardPreviewURL,reusablePreview,pendingPreview,previewURL,createPreloadBuffer,createWriteQueue} from '../lib/userscript-performance.mjs';
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
test('buffer bounds concurrent loads, evicts, aborts and ignores evicted work',async()=>{
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

test('failed lookahead preloads retry on the next buffer update',async()=>{
 let attempts=0;const image={src:'decoded'};
 const buffer=createPreloadBuffer({load:async()=>{if(++attempts===1)throw Error('Temporary failure');return image;}});
 buffer.update([item('a')]);await tick();
 assert.equal(buffer.get('a'),null);assert.equal(attempts,1);
 buffer.update([item('a')]);await tick();
 assert.equal(buffer.get('a'),image);assert.equal(attempts,2);
 buffer.clear();
});

test('buffer and display share an exact synthetic preview URL and reuse without assigning src',async()=>{
 const {readFile}=await import('node:fs/promises');
 const ui=await readFile(new URL('../lib/userscript-ui.mjs',import.meta.url),'utf8');
 const {runInNewContext}=await import('node:vm');
 const context={cardPreviewURL,previewURL,createPreloadBuffer,URL,AbortController,smallBuffer:true,location:{pathname:'/u/2/'},$:()=>({getBoundingClientRect:()=>({width:359.5,height:480.2})}),window:{devicePixelRatio:3,navigator:{userAgent:'iPhone'}}};
 const urlFunctions=ui.slice(ui.indexOf(' function mediaURL('),ui.indexOf(' const preloader='))+ui.slice(ui.indexOf(' function previewSource('),ui.indexOf(' function preloadReview('));
 runInNewContext(urlFunctions,context);
 const previewSource=context.previewSource;
 const photo={mediaKey:'synthetic',thumbUrl:'https://lh3.googleusercontent.com/synthetic-photo=w512-h512-k-no?authuser=0'};
 let assignments=0,source;
 const listeners=new Map();
 const image={addEventListener(type,listener){listeners.set(type,listener);},complete:true,naturalWidth:360,get src(){return source;},set src(value){assignments++;source=value;queueMicrotask(()=>{listeners.get('load')?.();this.onload();});},decode:async()=>{}};
 context.window.Image=function(){return image;};
 runInNewContext(ui.slice(ui.indexOf(' const buffer=createPreloadBuffer('),ui.indexOf(' const videoURLs='))+'\n globalThis.testBuffer=buffer;',context);
 const buffer=context.testBuffer;
 buffer.update([photo]);await tick();
 const displayURL=previewSource(photo.thumbUrl),cached=buffer.take(photo.mediaKey);
 assert.equal(cached.src,displayURL);
 assert.equal(context.queueThumbnailSource(photo),displayURL);
 assert.equal(displayURL,'https://lh3.googleusercontent.com/synthetic-photo=w360-h481-k-no?authuser=2');
 assert.equal(reusablePreview(cached,displayURL),image);
 assert.equal(assignments,1);
 assert.equal(reusablePreview(cached,previewSource(photo.thumbUrl.replace('synthetic-photo','other'))),null);
 assert.equal(reusablePreview({...image,complete:false},displayURL),null);
 assert.match(ui,/source:item=>previewSource\(item.thumbUrl\)/);assert.match(ui,/image.src=source;/);
 assert.match(ui,/const source=previewSource\(item.thumbUrl\);/);
 assert.match(ui,/const reused=!!\(sharp\|\|cached\);[\s\S]*?if\(!reused\)media.src=source/);
});

test('clearing preserves upcoming in-flight downloads and evicts replaced URLs',async()=>{
 const loads=[],photos=['a','b'].map(mediaKey=>({mediaKey,thumbUrl:`https://fixture.invalid/${mediaKey}`}));
 const buffer=createPreloadBuffer({load:(item,signal)=>new Promise(resolve=>loads.push({item,signal,resolve}))});
 buffer.update(photos);await tick();
 buffer.clear([photos[1]]);
 assert.equal(loads[0].signal.aborted,true);
 assert.equal(loads[1].signal.aborted,false);
 const image={src:'ready'};loads[1].resolve(image);await tick();
 assert.equal(buffer.take('b'),image);
 buffer.update([photos[1]]);await tick();
 buffer.clear([{...photos[1],thumbUrl:'https://fixture.invalid/replaced'}]);
 assert.equal(loads[2].signal.aborted,true);
 loads[0].resolve({src:'late'});loads[2].resolve({src:'late'});await tick();
 assert.equal(buffer.entries.size,0);
});

test('buffer reloads entries whose preview size changed and only hands out the current size',async()=>{
 let size=360;const loads=[],elements=[];
 const buffer=createPreloadBuffer({source:item=>`${item.thumbUrl}=w${size}`,load:async(item,signal,source)=>{loads.push(source);const el={src:source,signal};elements.push(el);return el;}});
 const a={mediaKey:'a',thumbUrl:'https://fixture.invalid/a'};
 buffer.update([a]);await new Promise(resolve=>setTimeout(resolve,0));
 assert.deepEqual(loads,['https://fixture.invalid/a=w360']);
 size=720;
 assert.equal(buffer.take('a','https://fixture.invalid/a=w720'),null);
 assert.ok(buffer.entries.has('a'));
 buffer.update([a]);await new Promise(resolve=>setTimeout(resolve,0));
 assert.deepEqual(loads,['https://fixture.invalid/a=w360','https://fixture.invalid/a=w720']);
 assert.equal(elements[0].src,'');
 assert.equal(buffer.take('a','https://fixture.invalid/a=w720'),elements[1]);
 buffer.update([a]);size=360;buffer.clear([a]);assert.equal(buffer.entries.has('a'),false);
});
test('refill keeps the in-flight load for the card being shown and pending under-card previews are reusable',async()=>{
 const signals=[];
 const buffer=createPreloadBuffer({load:(item,signal)=>{signals.push([item.mediaKey,signal]);return new Promise(()=>{});}});
 const a={mediaKey:'a',thumbUrl:'a'},b={mediaKey:'b',thumbUrl:'b'},c={mediaKey:'c',thumbUrl:'c'};
 buffer.update([a,b]);await new Promise(resolve=>setTimeout(resolve,0));
 buffer.update([b,c],null,'a');
 assert.equal(signals.find(([key])=>key==='a')[1].aborted,false);
 buffer.update([b,c]);
 assert.equal(signals.find(([key])=>key==='a')[1].aborted,true);
 assert.equal(pendingPreview({src:'x',complete:false},'x')?.src,'x');
 assert.equal(pendingPreview({src:'x',complete:true,naturalWidth:0},'x'),null);
 assert.equal(pendingPreview({src:'y',complete:false},'x'),null);
});
test('background library pages keep the ready swipe buffer',async()=>{
 const {readFile}=await import('node:fs/promises');
 const ui=await readFile(new URL('../lib/userscript-ui.mjs',import.meta.url),'utf8');
 const load=ui.slice(ui.indexOf(' async function load(refresh=false'),ui.indexOf(' mediaElement.addEventListener(\'wheel\''));
 assert.doesNotMatch(load,/buffer\.clear\(\);/);
 assert.match(load,/mergeReviewPage\(state,page,cursor,refresh\)\);buffer\.clear\(state\.items\);/);
 const kept=createPreloadBuffer({load:async item=>({src:item.thumbUrl})});
 const a={mediaKey:'a',thumbUrl:'a'};kept.update([a]);await new Promise(resolve=>setTimeout(resolve,0));
 kept.clear([a,{mediaKey:'new',thumbUrl:'new'}]);assert.equal(kept.get('a').src,'a');
 kept.clear([{...a,thumbUrl:'refreshed'}]);assert.equal(kept.get('a'),null);
});
