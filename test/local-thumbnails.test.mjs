import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalThumbnails} from '../lib/userscript-thumbnails.mjs';
import {reviewSyncProgress,createSyncClient} from '../lib/userscript-sync.mjs';
const item={mediaKey:'synthetic-photo',name:'Fixture.jpg',thumbUrl:'https://fixture.invalid/foreign',urlFetchedAt:0};
function fixture(reject=false){
 const calls=[],placeholders=[];
 const thumbnails=createLocalThumbnails({stale:value=>!value.urlFetchedAt,refresh:async value=>{calls.push(value.mediaKey);if(reject)throw Error('Unavailable');return {...value,thumbUrl:'https://fixture.invalid/local',urlFetchedAt:1};},placeholder:(image,value)=>{image.src=null;placeholders.push(value.name);}});
 return {thumbnails,calls,placeholders};
}
test('foreign stale thumbnail resolves by mediaKey and shares the local cache',async()=>{
 const f=fixture(),image={};
 await f.thumbnails.bind(image,item,value=>value.thumbUrl);
 assert.equal(image.src,'https://fixture.invalid/local');
 const second={};await f.thumbnails.bind(second,item,value=>value.thumbUrl);
 assert.equal(second.src,image.src);assert.deepEqual(f.calls,[item.mediaKey]);
 assert.equal(item.thumbUrl,'https://fixture.invalid/foreign');
});
test('valid local thumbnail requires no lookup',async()=>{
 const f=fixture(),image={};await f.thumbnails.bind(image,{...item,urlFetchedAt:1},value=>value.thumbUrl);
 assert.deepEqual(f.calls,[]);
});
test('image error refreshes exactly once then shows filename placeholder',async()=>{
 const f=fixture(),image={};await f.thumbnails.bind(image,{...item,urlFetchedAt:1},value=>value.thumbUrl);
 const error=image.onerror;await error();assert.equal(image.src,'https://fixture.invalid/local');await error();await error();
 assert.deepEqual(f.calls,[item.mediaKey]);assert.deepEqual(f.placeholders,['Fixture.jpg']);assert.equal(image.onerror,null);
});
test('lookup failure shows a placeholder without trying the foreign URL',async()=>{
 const f=fixture(true),image={};await f.thumbnails.bind(image,item,value=>value.thumbUrl);
 assert.deepEqual(f.calls,[item.mediaKey]);assert.deepEqual(f.placeholders,['Fixture.jpg']);assert.equal(image.src,null);
});
test('unchanged retry URL shows the filename placeholder after one image error',async()=>{
 const f=fixture(),image={},local={...item,thumbUrl:'https://fixture.invalid/local',urlFetchedAt:1};
 await f.thumbnails.bind(image,local,value=>value.thumbUrl);
 assert.equal(image.src,local.thumbUrl);
 const error=image.onerror;await error();
 assert.deepEqual(f.calls,[item.mediaKey]);assert.deepEqual(f.placeholders,['Fixture.jpg']);assert.equal(image.onerror,null);assert.equal(image.src,null);
 await error();
 assert.deepEqual(f.calls,[item.mediaKey]);assert.deepEqual(f.placeholders,['Fixture.jpg']);
});
test('refreshed URLs never enter sync progress',()=>{
 const progress=reviewSyncProgress({items:[{...item,urlFetchedAt:1,thumbUrl:'https://fixture.invalid/local'}]});
 assert.equal('thumbUrl' in progress.items[0],false);assert.equal('urlFetchedAt' in progress.items[0],false);
});
test('remote checkpoint cannot overwrite a valid device-local thumbnail',async()=>{
 const local={...item,urlFetchedAt:1,revision:1,state:'active'};
 const client=createSyncClient({fetch:async()=>({ok:true,json:async()=>({decisions:[],history:[],progress:{items:[{...local,thumbUrl:'https://fixture.invalid/foreign',urlFetchedAt:999}]}})})});
 client.configure({url:'https://sync.fixture.invalid',token:'synthetic-token'});
 const result=await client.sync('synthetic-account',{started:true,items:[local],history:[],syncDecisions:{},syncCheckpoint:reviewSyncProgress({started:true,items:[local]})},async value=>value);
 assert.equal(result.items[0].thumbUrl,local.thumbUrl);assert.equal(result.items[0].urlFetchedAt,1);
});
test('concurrent queue and grid lookups share one mediaKey request',async()=>{
 const f=fixture(),images=[{},{}];
 await Promise.all(images.map(image=>f.thumbnails.bind(image,item,value=>value.thumbUrl)));
 assert.deepEqual(f.calls,[item.mediaKey]);assert.equal(images[0].src,images[1].src);
});
test('failed retry lookup produces the filename fallback',async()=>{
 const f=fixture(true),image={};await f.thumbnails.bind(image,{...item,urlFetchedAt:1},value=>value.thumbUrl);
 await image.onerror();assert.deepEqual(f.calls,[item.mediaKey]);assert.deepEqual(f.placeholders,['Fixture.jpg']);assert.equal(image.onerror,null);
});
test('a dead initially refreshed URL stays a placeholder on later binds',async()=>{
 const f=fixture(),image={};await f.thumbnails.bind(image,item,value=>value.thumbUrl);
 await image.onerror();
 for(let pass=0;pass<5;pass++){
  const next={};await f.thumbnails.bind(next,item,value=>value.thumbUrl);
  assert.equal(next.src,null);assert.equal(next.onerror,null);
 }
 assert.deepEqual(f.calls,[item.mediaKey]);assert.equal(f.placeholders.length,6);
});
test('failed thumbnails are isolated by account scope',async()=>{
 let account='synthetic-account-a';const calls=[];
 const thumbnails=createLocalThumbnails({scope:()=>account,stale:()=>false,refresh:async value=>{calls.push(account);return {...value,thumbUrl:'https://fixture.invalid/fresh'};},placeholder:image=>{image.src=null;}});
 const first={};await thumbnails.bind(first,item,value=>value.thumbUrl);await first.onerror();await first.onerror();
 const failed={};await thumbnails.bind(failed,item,value=>value.thumbUrl);assert.equal(failed.src,null);
 account='synthetic-account-b';
 const second={};await thumbnails.bind(second,item,value=>value.thumbUrl);assert.equal(second.src,item.thumbUrl);
 await second.onerror();assert.deepEqual(calls,['synthetic-account-a','synthetic-account-b']);
});
