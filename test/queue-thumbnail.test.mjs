import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
import {hash} from '../lib/store.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

function element(tag){
 return {tag,children:[],hidden:false,isConnected:true,setAttribute(){},append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;}};
}

test('synthetic video removal row uses its video poster before and after preview caching',async()=>{
 const fixture=await readFile(new URL('./fixtures/core-review-browser.mjs',import.meta.url),'utf8');
 const fixtureContext={readFile,createApp,hash,URL,Buffer,Response,process:{argv:[],on(){}},console};
 const executable=fixture.replaceAll('import.meta.url',JSON.stringify(new URL('./fixtures/core-review-browser.mjs',import.meta.url).href)).replace(/^import .*;$/gm,'').replace(/^app.server.listen.*;$/m,'');
 await vm.runInNewContext(`(async()=>{${executable}\nglobalThis.qaApp=app;})()`,fixtureContext);
 const app=fixtureContext.qaApp;
 try{
  const preview=async item=>{
   let status,body;
   await app.server.listeners('request')[0]({url:'/qa-preview/'+encodeURIComponent(item.id)},{writeHead(code){status=code;},end(value){body=value;}});
   assert.equal(status,200);
   return JSON.parse(body);
  };
  const video=app.store.listItems().find(i=>i.type==='video'),photo=app.store.listItems().find(i=>i.type==='photo');
  app.store.decide(video.id,'remove',video.revision);
  const poster=await preview(video),photoPreview=await preview(photo);
  assert.equal(poster.dataUrl,'data:image/png;base64,'+(await readFile(new URL('./fixtures/synthetic-video-poster.png',import.meta.url))).toString('base64'));
  assert.notEqual(poster.dataUrl,photoPreview.dataUrl);
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const nodes={'queue-list':element('div'),export:element('button')};
  let observer;
  const context={document:{createElement:element},$:id=>nodes[id],IntersectionObserver:class{constructor(callback){this.callback=callback;observer=this;}disconnect(){}unobserve(){}observe(target){this.target=target;}},ensurePreview:async item=>{item.url=poster.dataUrl;return item.url;},bridgeConnected:true,busy:false,animating:false,mode:'fake',date:()=>'',formatBytes:String,photoViewer:{open(){}},updateDecision:async()=>{},render(){}};
  vm.runInNewContext(source.slice(source.indexOf('let queueObserver'),source.indexOf('function renderOperations')),context);
  context.renderQueue([video]);
  observer.callback([{isIntersecting:true,target:observer.target}]);
  await new Promise(resolve=>setImmediate(resolve));
  for(let pass=0;pass<2;pass++){
   const [image,placeholder]=nodes['queue-list'].children[0].children[0].children;
   assert.equal(image.src,poster.dataUrl);
   assert.equal(image.hidden,false);
   assert.equal(placeholder.hidden,true);
   context.renderQueue([video]);
  }
 }finally{
  app.store.close();
 }
});
