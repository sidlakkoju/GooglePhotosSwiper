import test from 'node:test';
import assert from 'node:assert/strict';
import {createShareQueue,downloadShareFile,shareFraction} from '../lib/userscript-share.mjs';

const browser={Blob,File,navigator:{canShare:()=>true}};
const streamed=(chunks,headers={})=>({ok:true,headers:new Headers(headers),body:new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(new Uint8Array(chunk));controller.close();}})});

test('downloads stream progress against Content-Length and keep the photo name with the real extension',async()=>{
 const progress=[];
 const file=await downloadShareFile({window:browser,fetch:async()=>streamed([400,600],{'content-length':'1000','content-type':'image/png'}),source:'https://lh3.googleusercontent.com/x=w4096-h4096',name:'IMG_7294.HEIC',video:false,onProgress:(loaded,total)=>progress.push([loaded,total])});
 assert.deepEqual(progress,[[0,1000],[400,1000],[1000,1000]]);
 assert.equal(file.name,'IMG_7294.png');assert.equal(file.type,'image/png');assert.equal(file.size,1000);
});

test('downloads without Content-Length report an unknown total and default a video to mp4',async()=>{
 const progress=[];
 const file=await downloadShareFile({window:browser,fetch:async()=>streamed([10,20]),source:'v',name:'IMG_7294.mov',video:true,onProgress:(loaded,total)=>progress.push([loaded,total])});
 assert.deepEqual(progress,[[0,null],[10,null],[30,null]]);
 assert.equal(file.name,'IMG_7294.mp4');assert.equal(file.type,'video/mp4');
});

test('downloads retry without credentials, reject empty or unshareable files, and pass aborts through',async()=>{
 const modes=[];
 await downloadShareFile({window:browser,fetch:async(source,options)=>{modes.push(options.credentials);if(options.credentials==='include')throw TypeError('CORS');return streamed([5]);},source:'x',name:'a.jpg'});
 assert.deepEqual(modes,['include','omit']);
 await assert.rejects(downloadShareFile({window:browser,fetch:async()=>streamed([]),source:'x',name:'a.jpg'}),/Unavailable/);
 await assert.rejects(downloadShareFile({window:{...browser,navigator:{canShare:()=>false}},fetch:async()=>streamed([5]),source:'x',name:'a.jpg'}),/Unsupported/);
 await assert.rejects(downloadShareFile({window:browser,fetch:async()=>({ok:false}),source:'x',name:'a.jpg'}),/Unavailable/);
 const aborted=[];
 await assert.rejects(downloadShareFile({window:browser,fetch:async(source,options)=>{aborted.push(options.credentials);throw new DOMException('stop','AbortError');},source:'x',name:'a.jpg'}),{name:'AbortError'});
 assert.deepEqual(aborted,['include']);
});

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));

test('the share queue runs two downloads at a time, reports progress and readiness, and starts the next when one finishes',async()=>{
 const jobs=new Map(),changes=[];
 const queue=createShareQueue({AbortController,onChange:entries=>changes.push(entries.map(entry=>`${entry.key}:${entry.state}`).join(' ')),download:(item,{onProgress,signal})=>{const job=deferred();jobs.set(item.mediaKey,{job,onProgress,signal});return job.promise;}});
 for(const key of ['a','b','c'])queue.add({mediaKey:key,name:key});
 await settle();
 assert.deepEqual([...jobs.keys()],['a','b']);
 assert.equal(queue.get('c').state,'waiting');
 jobs.get('a').onProgress(50,100);
 assert.deepEqual([queue.get('a').loaded,queue.get('a').total],[50,100]);
 assert.deepEqual(shareFraction(queue.list()),{fraction:.5});
 assert.deepEqual(shareFraction([{state:'downloading',loaded:5,total:null}]),{fraction:null});
 jobs.get('a').job.resolve(new File(['xx'],'a.jpg'));await settle();await settle();
 assert.equal(queue.get('a').state,'ready');assert.equal(queue.get('a').file.name,'a.jpg');
 assert.deepEqual([...jobs.keys()],['a','b','c']);
 jobs.get('b').job.reject(Error('nope'));await settle();
 assert.equal(queue.get('b').state,'failed');
 assert.ok(changes.at(-1).includes('b:failed'));
});

test('removing an entry aborts its download and ignores its late result; retry and keep update the entry',async()=>{
 const jobs=[];
 const queue=createShareQueue({AbortController,download:(item,{signal})=>{const job=deferred();jobs.push({job,signal});return job.promise;}});
 queue.add({mediaKey:'a'});await settle();
 queue.remove('a');
 assert.equal(jobs[0].signal.aborted,true);assert.equal(queue.get('a'),null);
 jobs[0].job.resolve(new File(['x'],'a.jpg'));await settle();
 assert.equal(queue.get('a'),null);
 queue.add({mediaKey:'b'});await settle();
 assert.equal(queue.get('b').kept,false);queue.keep('b');assert.equal(queue.get('b').kept,true);
 jobs[1].job.reject(Error('x'));await settle();
 queue.retry('b');await settle();
 assert.equal(queue.get('b').state,'downloading');assert.equal(jobs.length,3);
});

test('share progress combines downloads, counts finished files, and is null when nothing is preparing',()=>{
 assert.equal(shareFraction([]),null);
 assert.equal(shareFraction([{state:'ready',file:{size:10}}]),null);
 assert.deepEqual(shareFraction([{state:'ready',file:{size:100}},{state:'downloading',loaded:50,total:100}]),{fraction:.75});
 assert.deepEqual(shareFraction([{state:'downloading',loaded:25,total:100},{state:'failed'}]),{fraction:.25});
});
