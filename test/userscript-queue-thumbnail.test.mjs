import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createLocalThumbnails} from '../lib/userscript-thumbnails.mjs';
import {cardPreviewURL,previewURL} from '../lib/userscript-performance.mjs';

const source=await readFile(new URL('../lib/userscript-ui.mjs',import.meta.url),'utf8');
function fixture(dpr){
 const images=[],queueThumbs={children:[],append(image){this.children.push(image);}};
 const context={window:{devicePixelRatio:dpr},location:{pathname:'/u/0/'},cardPreviewURL,previewURL,queueThumbs,document:{createElement(tag){assert.equal(tag,'img');const listeners=new Map();const image={naturalWidth:0,addEventListener(type,listener){listeners.set(type,listener);},load(width=800){this.naturalWidth=width;listeners.get('load')?.();}};images.push(image);return image;}},queueImage:(image,item)=>{image.src=context.queueThumbnailSource(item);},previewSize:()=>({width:800,height:450})};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf(' function mediaURL('),source.indexOf(' const preloader='))+source.slice(source.indexOf(' function previewSource('),source.indexOf(' function previewSize(')),context);
 return {context,images,queueThumbs,run:code=>vm.runInContext(code,context)};
}
function render(f,items){
 f.context.candidates=items;
 const start=source.indexOf('for(const item of candidates.slice(-3))');
 const end=source.indexOf('\n',start);
 f.run(source.slice(start,end));
 return f.queueThumbs.children.map(image=>image.src);
}
const item=key=>({mediaKey:key,thumbUrl:`https://fixture.googleusercontent.com/${key}=w1024-h1024`});

test('queue pill reuses a successfully loaded preview URL, including after a resize',()=>{
 const f=fixture(2),photo=item('loaded');f.context.photo=photo;
 const loadedSource=f.run('const image=previewImage();image.src=previewSource(photo.thumbUrl);image.load();image.src');
 f.context.previewSize=()=>({width:1200,height:700});
 assert.deepEqual(render(f,[photo]),[loadedSource]);
 assert.match(loadedSource,/=w800-h450-k-no/);
});

test('queue pill uses a small DPR scaled URL when a preview is missing, pending or failed',()=>{
 for(const [dpr,pixels] of [[undefined,96],[1,96],[1.5,144],[2,192],[3,288],[8,288],[NaN,96],[Infinity,96],[0,96]]){
  const f=fixture(dpr),items=[item('missing'),item('pending'),item('failed')];f.context.items=items;
  f.run('const pending=previewImage();pending.src=previewSource(items[1].thumbUrl);const failed=previewImage();failed.src=previewSource(items[2].thumbUrl);failed.load(0);');
  const urls=render(f,items);
  assert.equal(urls.length,3);
  for(const url of urls){assert.match(url,new RegExp(`=w${pixels}-h${pixels}-k-no`));assert.doesNotMatch(url,/=w(?:512|768|1024)-h/);}
 }
});

test('queue pill does not reuse a loaded source belonging to an old thumbnail URL',()=>{
 const f=fixture(1);f.context.photo=item('old');
 f.run('const image=previewImage();image.src=previewSource(photo.thumbUrl);image.load();');
 assert.match(render(f,[{...item('new'),mediaKey:'old'}])[0],/\/new=w96-h96-k-no/);
});


test('queue strip remembers dead fresh URLs across repeated desktop and iPhone renders',async()=>{
 for(const dpr of [1,3]){
  const f=fixture(dpr),requests=[],lookups=[],bindings=[],items=['QA0000','QA0001','QA0002'].map(key=>({...item(key),urlFetchedAt:1}));
  const fetch=async url=>{requests.push(url);return {ok:false,status:403};};
  const thumbnails=createLocalThumbnails({stale:()=>false,refresh:async value=>{lookups.push(value.mediaKey);return {...value,thumbUrl:`https://fixture.googleusercontent.com/fresh-${value.mediaKey}=w1024-h1024`};},placeholder:image=>{image.onerror=null;image.placeholder=true;delete image.src;}});
  f.context.queueImage=(image,value)=>{
   Object.defineProperty(image,'src',{configurable:true,set(url){this.request=fetch(url);},get(){return undefined;}});
   bindings.push(thumbnails.bind(image,value,f.context.queueThumbnailSource));
  };
  for(let pass=0;pass<10;pass++){
   f.queueThumbs.children=[];
   render(f,items);
   await Promise.all(bindings.splice(0));
   for(const image of f.queueThumbs.children){
    if(image.request){assert.equal((await image.request).status,403);await image.onerror();assert.equal((await image.request).status,403);await image.onerror();}
    assert.equal(image.placeholder,true);
    assert.equal(image.onerror,null);
   }
  }
  assert.deepEqual(lookups,items.map(value=>value.mediaKey));
  assert.equal(requests.length,6);
  for(const value of items){
   assert.equal(requests.filter(url=>url.includes(`/${value.mediaKey}=`)).length,1);
   assert.equal(requests.filter(url=>url.includes(`/fresh-${value.mediaKey}=`)).length,1);
  }
  for(const url of requests)assert.match(url,new RegExp(`=w${96*dpr}-h${96*dpr}-k-no`));
 }
});
