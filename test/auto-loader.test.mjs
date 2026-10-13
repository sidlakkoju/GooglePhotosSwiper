import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {compareVersions} from '../lib/userscript-loader.mjs';
import {startAutoLoader,showUpdateBanner,loaderAPIVersion} from '../lib/userscript-auto-loader.mjs';
function fixture(latest,cached){
 const nodes=[],writes=[],trusted=new WeakMap(),window={};
 const env={window,crypto:webcrypto,setTimeout,clearTimeout,document:{documentElement:{dataset:{}},body:{appendChild:node=>nodes.push(node)},getElementById:id=>nodes.find(node=>node.id===id),querySelector:()=>({nonce:'synthetic-nonce'}),createElement:()=>({style:{},remove(){}})},GM:{info:{script:{version:'1.2.51'}},getValue:async()=>cached,setValue:async(key,value)=>writes.push({key,value}),xmlHttpRequest(options){queueMicrotask(()=>latest?options.onload({status:200,responseText:latest.code,responseHeaders:'X-Photoswiper-Version: '+latest.version+(latest.requiredLoaderVersion?'\r\nX-Photoswiper-Required-Loader-Version: '+latest.requiredLoaderVersion:'')}):options.onerror());}},trustedTypes:{createPolicy(name,rules){return {createScript(source){const value={};trusted.set(value,rules.createScript(source));return value;}};}}};
 env.eval=value=>{assert.ok(trusted.has(value));return vm.runInNewContext(trusted.get(value));};
 return {env,nodes,writes,trusted};
}
const app={version:'1.2.10',code:'window.runs=(window.runs||0)+1;window.version=photosSwipeReleaseVersion;window.storage=GM;'};
test('auto loader uses TrustedScript eval, caches app and preserves desktop GM context',async()=>{
 const {env,nodes,writes}=fixture(app);
 assert.equal(await startAutoLoader(env),true);
 assert.equal(env.window.runs,1);assert.equal(env.window.storage,env.GM);assert.equal(env.window.version,app.version);
 assert.deepEqual(writes,[{key:'photoswiper-app',value:app}]);assert.equal(nodes.length,0);
 assert.equal(await startAutoLoader(env),false);
});
test('offline request uses GM app cache and no cache fails gracefully',async()=>{
 for(const cached of [app,null]){
  const {env,writes,nodes}=fixture(null,cached);
  assert.equal(await startAutoLoader(env),Boolean(cached));assert.equal(env.window.runs,cached?1:undefined);assert.equal(writes.length,0);assert.equal(nodes.length,1);
 }
});
test('eval denial falls back to a nonce-bearing TrustedScript element',async()=>{
 const {env,trusted}=fixture(app);
 env.eval=()=>{throw new EvalError('Synthetic CSP denial');};
 env.document.head={appendChild(script){assert.equal(script.nonce,'synthetic-nonce');assert.ok(trusted.has(script.text));vm.runInNewContext(trusted.get(script.text),{window:env.window});}};
 assert.equal(await startAutoLoader(env),true);assert.equal(env.window.runs,1);
 assert.equal(Object.keys(env.window).some(key=>key.startsWith('__photoswiperExecute')),false);
});
test('update banner compares numeric versions and prereleases and ignores invalid versions',()=>{
 for(const [version,expected] of [['1.0.1',true],[loaderAPIVersion,false],['0.9.0',false],['1.0.0-rc.1',false],['invalid',false]]){
  const {env,nodes}=fixture(null);assert.equal(showUpdateBanner(env,version),expected);assert.equal(nodes.length,Number(expected));
  if(expected){assert.match(nodes[0].style.cssText,/#1967d2/);assert.equal(showUpdateBanner(env,version),false);}
 }
});
test('main install artifact is a small loader with both manager API grants',async()=>{
 const source=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8');
 assert.ok(source.length<15000);
 assert.ok(compareVersions(/^\/\/ @version (\S+)$/m.exec(source)[1],'1.2.53')>0);
 for(const grant of ['GM.xmlHttpRequest','GM.getValue','GM.setValue','GM_xmlhttpRequest','unsafeWindow'])assert.ok(source.includes('@grant '+grant));
 assert.ok(source.includes('startAutoLoader'));assert.ok(!source.includes('mountPhotosSwipe'));
});

test('invalid live versions and silent requests retain the offline cache',async()=>{
 for(const silent of [false,true]){
  const {env,writes}=fixture({...app,version:'invalid'},app);
  if(silent){env.GM.xmlHttpRequest=()=>{};env.setTimeout=callback=>setTimeout(callback,0);}
  assert.equal(await startAutoLoader(env),true);assert.equal(env.window.version,app.version);assert.equal(writes.length,0);
 }
});

test('GM cache write failure does not block a fresh app',async()=>{
 const {env}=fixture(app);env.GM.setValue=async()=>{throw Error('Synthetic quota failure');};
 assert.equal(await startAutoLoader(env),true);assert.equal(env.window.runs,1);
});

test('app releases do not require a loader update, but a newer loader API does',async()=>{
 for(const requiredLoaderVersion of [undefined,loaderAPIVersion,'1.0.1']){
  const {env,nodes}=fixture({...app,version:'1.2.52',requiredLoaderVersion});
  assert.equal(await startAutoLoader(env),true);
  assert.equal(env.window.version,'1.2.52');
  assert.equal(nodes.length,requiredLoaderVersion==='1.0.1'?1:0);
 }
});
test('app execution failures show the update banner and resolve gracefully',async()=>{
 for(const code of ['throw Error("Synthetic runtime failure");','invalid syntax {']){
  const {env,nodes}=fixture({...app,code});
  assert.equal(await startAutoLoader(env),false);
  assert.equal(nodes.length,1);
  assert.equal(env.document.documentElement.dataset.psLoaderInjected,undefined);
 }
});

for(const marker of ['psLoaded','psLoaderInjected'])for(const stage of ['cache','request','write'])test(`loader race during ${stage} with ${marker} skips update banner`,async()=>{
 const {env,nodes}=fixture({...app,requiredLoaderVersion:'1.0.1'});
 if(stage==='cache')env.GM.getValue=async()=>{env.document.documentElement.dataset[marker]='1';return app;};
 if(stage==='request')env.GM.xmlHttpRequest=options=>{env.document.documentElement.dataset[marker]='1';options.onerror();};
 if(stage==='write')env.GM.setValue=async()=>{env.document.documentElement.dataset[marker]='1';};
 assert.equal(await startAutoLoader(env),false);
 assert.equal(env.window.runs,undefined);
 assert.equal(nodes.length,0);
});
test('install artifacts use ASCII and unique grants and connect entries',async()=>{
 for(const name of ['photoswiper.user.js','photoswiper-loader.user.js','photoswiper-app.user.js']){
  const source=await readFile(new URL('../userscript/'+name,import.meta.url),'utf8');
  assert.doesNotMatch(source,/[^\x00-\x7f]/);
  const entries=source.match(/^\/\/ @(grant|connect) .*$/gm);
  assert.equal(new Set(entries).size,entries.length);
 }
});
