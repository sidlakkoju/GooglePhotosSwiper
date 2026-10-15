import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {loopOnEnd} from '../lib/userscript-video.mjs';

const source=await readFile(new URL('../lib/userscript-ui.mjs',import.meta.url),'utf8');

test('video links run in parallel with per-account per-card deduplication',async()=>{
 const pending=[],context=vm.createContext({identity:{account:'synthetic'},mediaURL:url=>url,call:(method,data)=>new Promise(resolve=>pending.push({method,data,resolve}))});
 vm.runInContext(source.slice(source.indexOf(' const videoURLs='),source.indexOf(' let libraryLoading=')),context);
 const a=context.videoURL({mediaKey:'a'}),duplicate=context.videoURL({mediaKey:'a'}),b=context.videoURL({mediaKey:'b'});
 assert.equal(a,duplicate);assert.equal(pending.length,2);
 pending[1].resolve({url:'https://fixture.invalid/b=original'});assert.equal(await b,'https://fixture.invalid/b=original');
 pending[0].resolve({url:'https://fixture.invalid/a=original'});await a;
 assert.equal(await context.videoURL({mediaKey:'a'}),'https://fixture.invalid/a=original');assert.equal(pending.length,2);
});

test('stopping a passed card pauses and aborts its active video before removing it',()=>{
 const events=[],video={pause:()=>events.push('pause'),removeAttribute:name=>events.push(`remove:${name}`),load:()=>events.push('load')};
 const context=vm.createContext({setVideoLoading(){},captureVideo(){},swipeFeedback:{reset(){}},underCard:{replaceChildren(){},hidden:false},generation:0,state:{items:[]},shown:'passed',buffer:{},$:()=>({querySelector:tag=>tag==='video'?video:null,replaceChildren:()=>events.push('remove-card')})});
 vm.runInContext(source.slice(source.indexOf(' function stopMedia('),source.indexOf(' function showLockCard(')),context);
 context.stopMedia();assert.deepEqual(events,['pause','remove:src','load','remove-card']);assert.equal(context.shown,null);
});

test('quality swap and fallback clear the active loading label',()=>{
 let busy='true',options;
 const media={readyState:0,currentTime:0,addEventListener(){}},container={setAttribute(name,value){if(name==='aria-busy')busy=value;},replaceChildren(){}};
 const context=vm.createContext({media,token:1,generation:1,handlingError:false,$:()=>container,watchVideoLoading(){},window:{},videoURL:async()=> 'video:original',item:{mediaKey:'v'},retried:false,forceRefresh:false,previewSize:()=>({compact:false}),document:{},captureVideo(){},failed(){},startProgressiveVideo(value){options=value;},loopOnEnd,addVideoControls(){},painted(){},warmed:false,setVideoLoading(){},trackVideoLoading(){}});
 const start=source.indexOf('    const clearLoading=');
 const end=source.indexOf('\n   }\n   else',start);
 return vm.runInContext(`(async()=>{${source.slice(start,end)}})()`,context).then(()=>{
  options.onFallback();assert.equal(busy,'false');busy='true';
  options.onSwap({addEventListener(){}});assert.equal(busy,'false');
  busy='true';context.generation=2;options.onFallback();assert.equal(busy,'true');
 });
});
