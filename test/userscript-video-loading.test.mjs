import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

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
 const context=vm.createContext({captureVideo(){},swipeFeedback:{reset(){}},underCard:{replaceChildren(){},hidden:false},generation:0,state:{items:[]},shown:'passed',buffer:{},$:()=>({querySelector:tag=>tag==='video'?video:null,replaceChildren:()=>events.push('remove-card')})});
 vm.runInContext(source.slice(source.indexOf(' function stopMedia('),source.indexOf(' function showLockCard(')),context);
 context.stopMedia();assert.deepEqual(events,['pause','remove:src','load','remove-card']);assert.equal(context.shown,null);
});
