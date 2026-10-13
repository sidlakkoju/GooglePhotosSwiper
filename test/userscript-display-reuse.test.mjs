import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {reusablePreview} from '../lib/userscript-performance.mjs';

const source=await readFile(new URL('../lib/userscript-ui.mjs',import.meta.url),'utf8');
const displaySource=source.slice(source.indexOf(' async function display(item,'),source.indexOf(' function updateVideoControls()'));

function fixture(reuse){
 const item={mediaKey:'next',name:'Next',type:reuse==='video'?'video':'photo',thumbUrl:'https://fixture.invalid/next'};
 const created=[],refreshes=[],played=[],cleared=[];
 const element=tag=>({tag,style:{},dataset:{},complete:true,naturalWidth:640,hidden:false,src:item.thumbUrl,readyState:2,addEventListener(){},setAttribute(){},play(){played.push(this);return Promise.resolve();}});
 const broken=element('img');broken.naturalWidth=0;broken.dataset.key=item.mediaKey;
 const ready=element(item.type==='video'?'video':'img');
 let assignments=0;Object.defineProperty(ready,'src',{get:()=>item.thumbUrl,set:()=>{assignments++;}});
 const media={style:{},children:[],setAttribute(name,value){this[name]=value;},replaceChildren(...children){this.children=children;},append(child){this.children.push(child);}};
 const nodes={media,zoom:{},card:{classList:{remove(){},contains:()=>false}}};
 const context=vm.createContext({underCard:{querySelector:()=>broken},stopMedia(){},$:id=>nodes[id],mediaElement:media,shown:null,generation:0,reviewURLStale:()=>false,previewSource:url=>url,buffer:{take:()=>reuse==='buffer'?ready:null},preloader:{take:()=>reuse==='preloader'?ready:null},reusablePreview,warmedKey:reuse==='video'?item.mediaKey:null,warmedVideo:reuse==='video'?ready:null,metrics:{hits:0,misses:0},document:{createElement:tag=>{const node=element(tag);created.push(node);return node;}},refreshItemURL:async value=>{refreshes.push(value);return value;},clearPreviewWindow:()=>cleared.push('window'),videoURLs:new Map(),dropWarmVideo:()=>cleared.push('video'),preloadReview(){},painted(){},resume:{},videoSavedAt:0,captureVideo(){},addVideoControls(){},videoURL:async()=>item.thumbUrl,window:{performance:{now:()=>0},localStorage:{}},current:()=>item});
 vm.runInContext(source.slice(source.indexOf(' const previewOwners='),source.indexOf(' function queueThumbnailSource('))+displaySource,context);
 return {context,item,ready,media,created,refreshes,played,cleared,assignments:()=>assignments};
}

for(const reuse of ['buffer','preloader','video'])test(`broken under-card preview does not block ${reuse} reuse`,async()=>{
 const f=fixture(reuse);
 await f.context.display(f.item);
 assert.ok(f.media.children.includes(f.ready));
 assert.equal(f.ready.hidden,false);
 assert.equal(f.assignments(),0);
 assert.deepEqual(f.refreshes,[]);
 assert.deepEqual(f.cleared,[]);
 assert.equal(f.context.metrics.hits,1);
 assert.equal(f.context.metrics.misses,0);
 if(reuse==='video'){
  assert.deepEqual(f.played,[f.ready]);
  assert.equal(f.context.warmedVideo,null);
  assert.equal(f.context.warmedKey,null);
 }else assert.equal(f.created.length,0);
});

test('broken under-card preview allows a new photo load and actual display errors still refresh',async()=>{
 const f=fixture('none');
 await f.context.display(f.item);
 assert.equal(f.created.length,1);
 assert.ok(f.media.children.includes(f.created[0]));
 assert.deepEqual(f.refreshes,[]);
 assert.equal(f.context.metrics.misses,1);
 await f.created[0].onerror();
 assert.deepEqual(f.refreshes,[f.item]);
 assert.deepEqual(f.cleared,['window','video']);
});
