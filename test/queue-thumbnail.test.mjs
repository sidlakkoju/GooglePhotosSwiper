import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
import {hash} from '../lib/store.mjs';
import {dataBlob} from '../public/cache.js';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';

function element(tag){
 return {tag,children:[],hidden:false,isConnected:true,setAttribute(){},append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;}};
}

test('synthetic queue previews use the served bridge and retain distinct posters in cache',async()=>{
 const fixture=await readFile(new URL('./fixtures/core-review-browser.mjs',import.meta.url),'utf8');
 const fixtureContext={readFile,createApp,hash,URL,Buffer,Response,process:{argv:[],on(){}},console};
 const executable=fixture.replaceAll('import.meta.url',JSON.stringify(new URL('./fixtures/core-review-browser.mjs',import.meta.url).href)).replace(/^import .*;$/gm,'').replace(/^app.server.listen.*;$/m,'');
 await vm.runInNewContext(`(async()=>{${executable}\nglobalThis.qaApp=app;})()`,fixtureContext);
 const app=fixtureContext.qaApp;
 try{
  const origin='http://localhost:3001';
  const requests=[];
  const localFetch=async path=>{
   assert.ok(path.startsWith('/qa-'));requests.push(path);
   let status,headers,body;
   await app.server.listeners('request')[0]({url:path,method:'GET'},{writeHead(code,values){status=code;headers=values;},end(value){body=value;}});
   return new Response(body,{status,headers});
  };
  const malformed=await localFetch('/qa-preview/%');
  assert.equal(malformed.status,400);
  assert.equal((await malformed.json()).error,'Invalid synthetic item id');
  assert.equal((await localFetch('/qa-preview/missing')).status,404);
  const video=app.store.listItems().find(i=>i.type==='video'),photo=app.store.listItems().find(i=>i.type==='photo');
  assert.notEqual(video.id,'synthetic:testvideo');
  const poster='data:image/png;base64,'+(await readFile(new URL('./fixtures/synthetic-video-poster.png',import.meta.url))).toString('base64');
  const stale=dataBlob('data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64'));
  const previewCache=new Map([['synthetic:testvideo',stale]]),objectUrls=new Map();
  const nodes={'queue-list':element('div'),export:element('button')};
  const listeners=new Set();
  const window={addEventListener(type,listener){assert.equal(type,'message');listeners.add(listener);},removeEventListener(type,listener){listeners.delete(listener);},postMessage(data){queueMicrotask(()=>{for(const listener of [...listeners])listener({source:window,origin,data});});}};
  let observer;
  const context={window,location:{origin},fetch:localFetch,crypto:{randomUUID},setTimeout,clearTimeout,document:{createElement:element},$:id=>nodes[id],IntersectionObserver:class{constructor(callback){this.callback=callback;this.targets=[];observer=this;}disconnect(){}unobserve(){}observe(target){this.targets.push(target);}},items:[video,photo],generation:0,cached:async id=>previewCache.get(id),cache:async(id,blob)=>previewCache.set(id,blob),dataBlob,URL:{createObjectURL(blob){const url='blob:'+randomUUID();objectUrls.set(url,blob);return url;}},toast:assert.fail,bridgeConnected:true,busy:false,animating:false,mode:'fake',date:()=>'',formatBytes:String,photoViewer:{open(){}},updateDecision:async()=>{},render(){}};
  vm.createContext(context);
  vm.runInContext(await (await localFetch('/qa-bridge.js')).text(),context);
  vm.runInContext((await readFile(new URL('../public/bridge.js',import.meta.url),'utf8')).replace('export function','function'),context);
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  vm.runInContext(source.slice(source.indexOf('const previewPromises'),source.indexOf('function renderCard')),context);
  vm.runInContext(source.slice(source.indexOf('let queueObserver'),source.indexOf('function renderOperations')),context);
  requests.length=0;
  for(let pass=0;pass<2;pass++){
   delete video.url;delete photo.url;
   context.renderQueue([video,photo]);
   observer.callback(observer.targets.map(target=>({isIntersecting:true,target})));
   await context.ensurePreview(video);
   await context.ensurePreview(photo);
   await new Promise(resolve=>setImmediate(resolve));
   const images=nodes['queue-list'].children.map(row=>row.children[0].children);
   for(const [image,placeholder] of images){assert.equal(image.hidden,false);assert.equal(placeholder.hidden,true);}
   const videoBlob=objectUrls.get(images[0][0].src),photoBlob=objectUrls.get(images[1][0].src);
   assert.equal(videoBlob.type,'image/png');
   assert.equal('data:image/png;base64,'+Buffer.from(await videoBlob.arrayBuffer()).toString('base64'),poster);
   assert.equal(photoBlob.type,'image/svg+xml');
   assert.notDeepEqual(await videoBlob.arrayBuffer(),await photoBlob.arrayBuffer());
   assert.deepEqual(requests,['/qa-preview/'+encodeURIComponent(video.id),'/qa-preview/'+encodeURIComponent(photo.id)]);
  }
  assert.equal(previewCache.get('synthetic:testvideo'),stale);
 }finally{
  app.store.close();
 }
});
