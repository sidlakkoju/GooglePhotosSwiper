import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {cardPreviewURL,previewURL} from '../lib/userscript-performance.mjs';

const source=await readFile(new URL('../lib/userscript-ui.mjs',import.meta.url),'utf8');
function fixture(dpr){
 const images=[],queueThumbs={children:[],append(image){this.children.push(image);}};
 const context={window:{devicePixelRatio:dpr},location:{pathname:'/u/0/'},cardPreviewURL,previewURL,queueThumbs,document:{createElement(tag){assert.equal(tag,'img');const listeners=new Map();const image={naturalWidth:0,addEventListener(type,listener){listeners.set(type,listener);},load(width=800){this.naturalWidth=width;listeners.get('load')?.();}};images.push(image);return image;}},previewSize:()=>({width:800,height:450})};
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
