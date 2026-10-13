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
 const local={...item,thumbUrl:'https://fixture.invalid/device-local',urlFetchedAt:1,revision:1,state:'active'};
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
 assert.deepEqual(f.calls,[item.mediaKey,item.mediaKey]);assert.equal(f.placeholders.length,6);
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

test('binds during a refresh wait for the fresh URL without requesting the cached URL',async()=>{
 let finishRefresh;const calls=[],requests=[];
 const refreshed=new Promise(resolve=>{finishRefresh=resolve;});
 const thumbnails=createLocalThumbnails({stale:()=>false,refresh:value=>{calls.push(value.mediaKey);return refreshed;},placeholder:image=>{image.placeholder=true;}});
 const first={},second={set src(value){requests.push(value);}};
 await thumbnails.bind(first,item,value=>value.thumbUrl);
 const retry=first.onerror();
 const binding=thumbnails.bind(second,item,value=>value.thumbUrl);
 await Promise.resolve();
 assert.deepEqual(requests,[]);
 finishRefresh({...item,thumbUrl:'https://fixture.invalid/fresh'});
 await Promise.all([retry,binding]);
 assert.deepEqual(requests,['https://fixture.invalid/fresh']);
 assert.deepEqual(calls,[item.mediaKey]);
});
test('a late error on the old URL adopts the cached refresh without poisoning later binds',async()=>{
 const calls=[],placeholders=[];
 const thumbnails=createLocalThumbnails({stale:()=>false,refresh:async value=>{calls.push(value.mediaKey);return {...value,thumbUrl:'https://fixture.invalid/fresh'};},placeholder:image=>{image.src=null;placeholders.push(image);}});
 const first={},second={};
 await Promise.all([thumbnails.bind(first,item,value=>value.thumbUrl),thumbnails.bind(second,item,value=>value.thumbUrl)]);
 await first.onerror();
 assert.equal(first.src,'https://fixture.invalid/fresh');
 assert.equal(second.src,item.thumbUrl);
 await second.onerror();
 assert.equal(second.src,first.src);
 const later={};await thumbnails.bind(later,item,value=>value.thumbUrl);
 assert.equal(later.src,first.src);
 assert.deepEqual(placeholders,[]);
 assert.deepEqual(calls,[item.mediaKey]);
 await second.onerror();
 const failed={};await thumbnails.bind(failed,item,value=>value.thumbUrl);
 assert.equal(failed.src,null);
 assert.deepEqual(placeholders,[second,failed]);
 assert.deepEqual(calls,[item.mediaKey]);
});

for(const proactive of [false,true])test(`${proactive?'poster resolve':'stale bind'} preserves the image error retry`,async()=>{
 const calls=[],placeholders=[];
 const thumbnails=createLocalThumbnails({stale:value=>!value.urlFetchedAt,refresh:async value=>{calls.push(value.mediaKey);return {...value,thumbUrl:`https://fixture.invalid/fresh-${calls.length}`,urlFetchedAt:1};},placeholder:image=>{image.src=null;placeholders.push(image);}});
 if(proactive)await thumbnails.resolve(item);
 const image={};await thumbnails.bind(image,item,value=>value.thumbUrl);
 assert.equal(image.src,'https://fixture.invalid/fresh-1');
 await image.onerror();
 assert.equal(image.src,'https://fixture.invalid/fresh-2');
 assert.deepEqual(calls,[item.mediaKey,item.mediaKey]);
 assert.deepEqual(placeholders,[]);
 await image.onerror();
 const later={};await thumbnails.bind(later,item,value=>value.thumbUrl);
 assert.equal(later.src,null);
 assert.deepEqual(calls,[item.mediaKey,item.mediaKey]);
});
test('a newer saved thumbnail recovers failed queue and grid binds and gets its own retry',async()=>{
 const calls=[],placeholders=[];
 const thumbnails=createLocalThumbnails({stale:value=>!value.urlFetchedAt,refresh:async value=>{calls.push(value.thumbUrl);return {...value,thumbUrl:calls.length===1?'https://fixture.invalid/dead-refresh':value.thumbUrl};},placeholder:image=>{image.src=null;placeholders.push(image);}});
 const original={...item,urlFetchedAt:1},first={};
 await thumbnails.bind(first,original,value=>value.thumbUrl);
 await first.onerror();
 await first.onerror();
 const failed={};await thumbnails.bind(failed,original,value=>value.thumbUrl);
 assert.equal(failed.src,null);
 const updated={...original,thumbUrl:'https://fixture.invalid/newer',urlFetchedAt:2};
 const queue={},grid={};
 await Promise.all([thumbnails.bind(queue,updated,value=>value.thumbUrl),thumbnails.bind(grid,updated,value=>`${value.thumbUrl}=w100`)]);
 assert.equal(queue.src,updated.thumbUrl);
 assert.equal(grid.src,`${updated.thumbUrl}=w100`);
 assert.deepEqual(placeholders,[first,failed]);
 await queue.onerror();
 assert.deepEqual(calls,[original.thumbUrl,updated.thumbUrl]);
});

for(const outcome of ['reject','dead'])test(`a newer saved URL arriving during a refresh survives a ${outcome} refresh`,async()=>{
 let finishRefresh,rejectRefresh;
 const pending=new Promise((resolve,reject)=>{finishRefresh=resolve;rejectRefresh=reject;});
 const thumbnails=createLocalThumbnails({stale:()=>false,refresh:()=>pending,placeholder:image=>{image.src=null;}});
 const original={},updated={...item,thumbUrl:'https://fixture.invalid/newer'},queue={},grid={};
 await thumbnails.bind(original,item,value=>value.thumbUrl);
 const retry=original.onerror();
 await Promise.all([thumbnails.bind(queue,updated,value=>value.thumbUrl),thumbnails.bind(grid,updated,value=>`${value.thumbUrl}=w100`)]);
 assert.equal(queue.src,updated.thumbUrl);
 assert.equal(grid.src,`${updated.thumbUrl}=w100`);
 if(outcome==='reject')rejectRefresh(Error('Temporary lookup failure'));
 else finishRefresh({...item,thumbUrl:'https://fixture.invalid/dead'});
 await retry;
 if(outcome==='dead'){
  assert.equal(original.src,updated.thumbUrl);
 }
 const later={};await thumbnails.bind(later,updated,value=>value.thumbUrl);
 assert.equal(later.src,updated.thumbUrl);
});

for(const staleInitially of [false,true])test(`a transient ${staleInitially?'initial':'retry'} lookup failure allows later queue and grid recovery`,async()=>{
 const calls=[],original={...item,urlFetchedAt:staleInitially?0:1};
 const thumbnails=createLocalThumbnails({stale:value=>!value.urlFetchedAt,refresh:async value=>{calls.push(value.mediaKey);if(calls.length===1)throw Error('Temporary lookup failure');return {...value,thumbUrl:'https://fixture.invalid/recovered',urlFetchedAt:2};},placeholder:image=>{image.src=null;}});
 const first={};await thumbnails.bind(first,original,value=>value.thumbUrl);
 if(!staleInitially)await first.onerror();
 assert.equal(first.src,null);
 const queue={},grid={};
 await Promise.all([thumbnails.bind(queue,original,value=>value.thumbUrl),thumbnails.bind(grid,original,value=>`${value.thumbUrl}=w100`)]);
 if(!staleInitially)await queue.onerror();
 assert.equal(queue.src,'https://fixture.invalid/recovered');
 if(!staleInitially)await grid.onerror();
 assert.equal(grid.src,'https://fixture.invalid/recovered=w100');
 assert.deepEqual(calls,[item.mediaKey,item.mediaKey]);
});

for(const outcome of ['reject','dead'])test(`cache eviction during a ${outcome} retry preserves recovery and failure caching`,async()=>{
 let finishRefresh,rejectRefresh;
 const pending=new Promise((resolve,reject)=>{finishRefresh=resolve;rejectRefresh=reject;});
 const calls=[],original={...item,urlFetchedAt:1};
 const thumbnails=createLocalThumbnails({stale:value=>!value.urlFetchedAt,refresh:value=>{calls.push(value.mediaKey);return calls.length===1?pending:Promise.resolve({...value,thumbUrl:'https://fixture.invalid/recovered',urlFetchedAt:2});},placeholder:image=>{image.src=null;}});
 const first={};await thumbnails.bind(first,original,value=>value.thumbUrl);
 const retry=first.onerror();
 await Promise.resolve();
 for(let index=0;index<512;index++)await thumbnails.resolve({...original,mediaKey:`eviction-${index}`});
 if(outcome==='reject')rejectRefresh(Error('Temporary lookup failure'));
 else finishRefresh({...original,thumbUrl:'https://fixture.invalid/dead',urlFetchedAt:2});
 await retry;
 if(outcome==='reject'){
  assert.equal(first.src,null);
  const queue={},grid={};
  await Promise.all([thumbnails.bind(queue,original,value=>value.thumbUrl),thumbnails.bind(grid,original,value=>`${value.thumbUrl}=w100`)]);
  await queue.onerror();
  await grid.onerror();
  assert.equal(queue.src,'https://fixture.invalid/recovered');
  assert.equal(grid.src,'https://fixture.invalid/recovered=w100');
  assert.deepEqual(calls,[item.mediaKey,item.mediaKey]);
 }else{
  assert.equal(first.src,'https://fixture.invalid/dead');
  await first.onerror();
  assert.equal(first.src,null);
  for(let pass=0;pass<3;pass++){
   const later={};await thumbnails.bind(later,original,value=>value.thumbUrl);
   assert.equal(later.src,null);
   assert.equal(later.onerror,null);
  }
  assert.deepEqual(calls,[item.mediaKey]);
 }
});

test('detached strip image does not request the shared in-flight refresh',async()=>{
 let finish;const requests=[],calls=[];
 const thumbnails=createLocalThumbnails({stale:()=>false,refresh:value=>{calls.push(value.mediaKey);return new Promise(resolve=>{finish=resolve;});},placeholder(){}});
 const first={isConnected:true,set src(value){requests.push(['first',value]);}},second={isConnected:true,set src(value){requests.push(['second',value]);}};
 await thumbnails.bind(first,item,value=>value.thumbUrl);
 const retry=first.onerror();await Promise.resolve();first.isConnected=false;
 const binding=thumbnails.bind(second,item,value=>value.thumbUrl);
 finish({...item,thumbUrl:'https://fixture.invalid/fresh'});await Promise.all([retry,binding]);
 assert.deepEqual(requests,[['first',item.thumbUrl],['second','https://fixture.invalid/fresh']]);assert.deepEqual(calls,[item.mediaKey]);
});
test('successful refreshed image can retry a later expired URL once',async()=>{
 let count=0;const thumbnails=createLocalThumbnails({stale:()=>false,refresh:async value=>({...value,thumbUrl:`https://fixture.invalid/fresh-${++count}`}),placeholder(){}});
 const image={};await thumbnails.bind(image,item,value=>value.thumbUrl);await image.onerror();image.onload();
 await image.onerror();assert.equal(count,2);assert.equal(image.src,'https://fixture.invalid/fresh-2');
 await image.onerror();const rebuilt={};await thumbnails.bind(rebuilt,item,value=>value.thumbUrl);assert.equal(rebuilt.src,undefined);
});
test('poster lookup retries once before filename fallback',async()=>{
 let calls=0;const placeholders=[];
 const thumbnails=createLocalThumbnails({stale:()=>true,refresh:async()=>{calls++;throw Error('Fixture failure');},placeholder:(image,value)=>placeholders.push(value.name)});
 await thumbnails.bind({},item,value=>value.thumbUrl,{retryLookup:true});assert.equal(calls,2);assert.deepEqual(placeholders,[item.name]);
});
