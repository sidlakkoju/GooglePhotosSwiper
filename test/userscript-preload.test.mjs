import test from 'node:test';
import assert from 'node:assert/strict';
import {createReviewPreloader,reviewURLStale} from '../lib/userscript-preload.mjs';
const photo=key=>({mediaKey:key,type:'photo',thumbUrl:`https://fixture.invalid/${key}`});
const video=key=>({...photo(key),type:'video'});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(videoURL=async key=>({url:`video:${key}`}),decode=()=>Promise.resolve()){
 const images=[],videos=[],calls=[],sizes=[];
 const create=collection=>()=>{const element={removed:[],decodeCalls:0,decode(){this.decodeCalls++;return decode();},removeAttribute(name){this.removed.push(name);delete this[name];},pause(){this.paused=true;},load(){this.loads=(this.loads||0)+1;}};collection.push(element);return element;};
 const buffer=createReviewPreloader({createImage:create(images),createVideo:create(videos),videoURL:key=>{calls.push(key);return videoURL(key);},previewURL:(url,size)=>{new URL(url);sizes.push(size);return `${url}=w${size.width}-h${size.height}`;},playbackURL:url=>url});
 return {buffer,images,videos,calls,sizes};
}
test('screen sized lookahead decodes three photos and fetches two video links and warms one video, deduped',async()=>{
 const f=fixture(),items=[photo('current'),video('v1'),photo('p1'),video('v2'),photo('p2'),photo('p3'),photo('p4'),video('v3')];
 const size={width:820,height:440};
 f.buffer.update(items,items[0],size);await tick();
 assert.equal(f.images.length,5);assert.ok(f.images.every(image=>image.decodeCalls===1&&image.src.endsWith('=w820-h440')));
 assert.deepEqual(f.calls,['v1','v2']);assert.equal(f.videos.length,1);
 assert.ok(f.videos.every(media=>media.poster.endsWith('=w820-h440')&&media.preload==='auto'&&media.loads===1));
 f.buffer.update(items,items[0],size);await tick();assert.equal(f.images.length,5);assert.equal(f.calls.length,2);
 assert.equal(f.buffer.videoSource('v1'),'video:v1');
});
test('compact windows use two photos and two video links and evict on advance, resize and clear',async()=>{
 const f=fixture(),items=[photo('a'),photo('b'),video('v'),photo('c'),photo('d'),video('w')],size={width:360,height:260,compact:true};
 f.buffer.update(items,items[0],size);await tick();assert.equal(f.images.length,4);assert.deepEqual(f.calls,['v','w']);
 f.buffer.update(items,items[2],size);await tick();assert.ok(f.images[0].removed.includes('src'));assert.equal(f.buffer.videoSource('v'),'video:v');
 f.buffer.update(items,items[2],{...size,width:400});await tick();assert.equal(f.videos[0].paused,undefined);assert.deepEqual(f.videos[0].removed,[]);assert.equal(f.videos[0].loads,1);assert.equal(f.calls.length,2);
 f.buffer.clear();assert.ok(f.images.every(image=>image.removed.includes('src')));assert.ok(f.videos.every(media=>media.paused));assert.equal(f.buffer.videoSource('w'),undefined);
});
test('queued work is skipped and late video responses cannot populate an evicted window',async()=>{
 let resolve;
 const f=fixture(()=>new Promise(done=>{resolve=done;})),items=[photo('a'),video('v'),photo('b')];
 f.buffer.update(items,items[0],{width:100,height:100});f.buffer.clear();await tick();assert.equal(f.calls.length,0);assert.equal(f.images.length,0);
 f.buffer.update(items,items[0],{width:100,height:100});await tick();
 const request=f.buffer.videoSource('v');assert.ok(request instanceof Promise);
 f.buffer.update(items,items[2],{width:100,height:100});resolve({url:'video:v'});await request;await tick();
 assert.equal(f.videos.length,0);assert.equal(f.buffer.videoSource('v'),undefined);
});
test('failed decode and video requests are swallowed and may be retried on later updates',async()=>{
 let fail=true;
 const f=fixture(async key=>{if(fail)throw Error('offline');return {url:`video:${key}`};}),items=[photo('a'),video('v')],size={width:100,height:100};
 f.buffer.update(items,items[0],size);await tick();assert.equal(f.buffer.videoSource('v'),undefined);
 fail=false;f.buffer.update(items,items[0],size);await tick();assert.equal(f.buffer.videoSource('v'),'video:v');
 f.videos[0].onerror();assert.equal(f.buffer.videoSource('v'),undefined);
 f.buffer.clear();
 let decodeFails=true;
 const photos=fixture(undefined,()=>decodeFails?Promise.reject(Error('decode failed')):Promise.resolve());
 photos.buffer.update([photo('a'),photo('b')],photo('a'),size);await tick();
 assert.ok(photos.images[0].removed.includes('src'));
 decodeFails=false;photos.buffer.update([photo('a'),photo('b')],photo('a'),size);await tick();
 assert.equal(photos.images.length,2);assert.equal(photos.images[1].decodeCalls,1);
});

test('saved URL freshness expires at forty minutes and treats legacy batches as stale',()=>{
 const now=50*60*1000;
 assert.equal(reviewURLStale({},now),true);
 assert.equal(reviewURLStale({urlFetchedAt:now-40*60*1000},now),true);
 assert.equal(reviewURLStale({urlFetchedAt:now-40*60*1000+1},now),false);
});

test('review clear preserves upcoming downloads and transfers a decoded element to the card',async()=>{
 let finishDecode;
 const f=fixture(undefined,()=>new Promise(resolve=>{finishDecode=resolve;})),items=[photo('a'),photo('b')],size={width:360,height:480};
 f.buffer.update(items,items[0],size);await tick();
 const image=f.images[0],source=image.src;
 assert.equal(f.buffer.take('b',source),null);
 f.buffer.clear([items[1]],size);
 assert.deepEqual(image.removed,[]);
 finishDecode();await tick();
 assert.equal(f.buffer.take('b','wrong-url'),null);
 assert.equal(f.buffer.take('b',source),image);
 f.buffer.clear();
 assert.equal(image.src,source);
 assert.deepEqual(image.removed,[]);
});

test('clear disposes previews even when a preserved item has an invalid URL',async()=>{
 const f=fixture(),items=[photo('a'),photo('b')];
 f.buffer.update(items,items[0],{width:100,height:100});await tick();
 assert.doesNotThrow(()=>f.buffer.clear([{mediaKey:'b',thumbUrl:'invalid'}],{width:100,height:100}));
 assert.ok(f.images[0].removed.includes('src'));
});

test('compact lookahead starts both links concurrently and transfers only the next original video',async()=>{
 const pending=new Map(),f=fixture(key=>new Promise(resolve=>pending.set(key,resolve))),items=[photo('a'),video('v'),video('w')],size={width:360,height:480,compact:true};
 f.buffer.update(items,items[0],size);await tick();
 assert.deepEqual([...pending.keys()],['v','w']);
 pending.get('w')({url:'video:w=original'});await tick();assert.equal(f.videos.length,0);
 pending.get('v')({url:'video:v=original'});await tick();assert.equal(f.videos.length,1);
 const warmed=f.videos[0];assert.equal(warmed.src,'video:v=original');assert.equal(warmed.preload,'auto');assert.equal(warmed.playsInline,true);
 assert.equal(f.buffer.takeVideo('v'),warmed);assert.equal(f.buffer.takeVideo('v'),null);
 f.buffer.update(items,items[1],size);await tick();assert.equal(f.videos.length,2);assert.equal(f.videos[1].src,'video:w=original');
 f.buffer.clear();assert.equal(warmed.src,'video:v=original');assert.equal(warmed.loads,1);
 assert.ok(f.videos[1].removed.includes('src'));assert.equal(f.videos[1].loads,2);
});

test('passing a warmed card aborts its download and warms the newly upcoming card',async()=>{
 const f=fixture(),items=[photo('a'),video('v'),photo('b'),video('w')],size={width:360,height:480,compact:true};
 f.buffer.update(items,items[0],size);await tick();const passed=f.videos[0];
 f.buffer.update(items,items[2],size);await tick();
 assert.equal(passed.paused,true);assert.ok(passed.removed.includes('src'));assert.equal(passed.loads,2);assert.equal(passed.src,undefined);
 assert.equal(f.videos.length,2);assert.equal(f.videos[1].src,'video:w');
 f.buffer.cancelVideos();assert.equal(f.videos[1].src,undefined);assert.equal(f.videos[1].loads,2);
});

test('poster resize preserves the playback URL warm and transfers the same video',async()=>{
 const f=fixture(),items=[photo('a'),video('v'),video('w')],size={width:360,height:480,compact:true};
 f.buffer.update(items,items[0],size);await tick();
 const warmed=f.videos[0],poster=f.images[0];
 const resized={...size,height:420};
 f.buffer.clear(items,resized);f.buffer.update(items,items[0],resized);await tick();
 assert.ok(poster.removed.includes('src'));
 assert.deepEqual(f.calls,['v','w']);assert.equal(f.videos.length,1);
 assert.equal(warmed.poster,'https://fixture.invalid/v=w360-h420');
 assert.equal(warmed.src,'video:v');assert.equal(warmed.loads,1);
 assert.equal(warmed.paused,undefined);assert.deepEqual(warmed.removed,[]);
 assert.equal(f.buffer.takeVideo('v'),warmed);
 f.buffer.clear();assert.equal(warmed.src,'video:v');assert.equal(warmed.loads,1);
});

test('poster resize preserves pending playback requests and warms with the latest poster',async()=>{
 const pending=new Map(),f=fixture(key=>new Promise(resolve=>pending.set(key,resolve))),items=[photo('a'),video('v'),video('w')],size={width:360,height:480,compact:true};
 f.buffer.update(items,items[0],size);await tick();
 const request=f.buffer.videoSource('v');
 f.buffer.update(items,items[0],{...size,height:420});await tick();
 assert.equal(f.buffer.videoSource('v'),request);assert.deepEqual(f.calls,['v','w']);
 pending.get('v')({url:'video:v'});pending.get('w')({url:'video:w'});await tick();
 assert.equal(f.videos.length,1);assert.equal(f.videos[0].poster,'https://fixture.invalid/v=w360-h420');
 assert.equal(f.videos[0].loads,1);assert.equal(f.buffer.videoSource('w'),'video:w');
 f.buffer.clear();assert.equal(f.videos[0].loads,2);
});

test('taking the poster and resizing preserves the playback URL warm cache',async()=>{
 const f=fixture(),items=[photo('a'),video('v')],size={width:360,height:480};
 f.buffer.update(items,items[0],size);await tick();
 const warmed=f.videos[0];
 assert.equal(f.buffer.take('v',f.images[0].src),f.images[0]);
 f.buffer.update(items,items[0],{...size,width:720});await tick();
 assert.deepEqual(f.calls,['v']);assert.equal(f.videos.length,1);assert.equal(warmed.loads,1);
 assert.equal(f.buffer.takeVideo('v'),warmed);
});
test('held videos are not warmed until the hold is released, then the next video warms at once',async()=>{
 const f=fixture(),items=[photo('current'),video('v1'),photo('p1')],size={width:820,height:440};
 f.buffer.holdVideos(true);
 f.buffer.update(items,items[0],size);await tick();
 assert.deepEqual(f.calls,['v1']);assert.equal(f.videos.length,0);
 f.buffer.update(items,items[0],size);await tick();assert.equal(f.videos.length,0);
 f.buffer.holdVideos(false);
 assert.equal(f.videos.length,1);assert.equal(f.videos[0].src,'video:v1');assert.equal(f.videos[0].loads,1);
 assert.equal(f.buffer.takeVideo('v1'),f.videos[0]);
});
test('releasing a hold with nothing waiting does not create a video',async()=>{
 const f=fixture(),items=[photo('current'),photo('p1')],size={width:820,height:440};
 f.buffer.holdVideos(true);f.buffer.update(items,items[0],size);await tick();
 f.buffer.holdVideos(false);assert.equal(f.videos.length,0);
});
