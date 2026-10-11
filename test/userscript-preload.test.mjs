import test from 'node:test';
import assert from 'node:assert/strict';
import {createReviewPreloader} from '../lib/userscript-preload.mjs';
const photo=key=>({mediaKey:key,type:'photo',thumbUrl:`https://fixture.invalid/${key}`});
const video=key=>({...photo(key),type:'video'});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(videoURL=async key=>({url:`video:${key}`}),decode=()=>Promise.resolve()){
 const images=[],videos=[],calls=[],sizes=[];
 const create=collection=>()=>{const element={removed:[],decodeCalls:0,decode(){this.decodeCalls++;return decode();},removeAttribute(name){this.removed.push(name);delete this[name];},pause(){this.paused=true;},load(){this.loads=(this.loads||0)+1;}};collection.push(element);return element;};
 const buffer=createReviewPreloader({createImage:create(images),createVideo:create(videos),videoURL:key=>{calls.push(key);return videoURL(key);},previewURL:(url,size)=>{sizes.push(size);return `${url}=w${size.width}-h${size.height}`;},playbackURL:url=>url});
 return {buffer,images,videos,calls,sizes};
}
test('screen sized lookahead decodes three photos and warms two videos and posters, deduped',async()=>{
 const f=fixture(),items=[photo('current'),video('v1'),photo('p1'),video('v2'),photo('p2'),photo('p3'),photo('p4'),video('v3')];
 const size={width:820,height:440};
 f.buffer.update(items,items[0],size);await tick();
 assert.equal(f.images.length,5);assert.ok(f.images.every(image=>image.decodeCalls===1&&image.src.endsWith('=w820-h440')));
 assert.deepEqual(f.calls,['v1','v2']);assert.equal(f.videos.length,2);
 assert.ok(f.videos.every(media=>media.poster.endsWith('=w820-h440')&&media.preload==='metadata'&&media.loads===1));
 f.buffer.update(items,items[0],size);await tick();assert.equal(f.images.length,5);assert.equal(f.calls.length,2);
 assert.equal(f.buffer.videoSource('v1'),'video:v1');
});
test('compact windows use two photos and one video and evict on advance, resize and clear',async()=>{
 const f=fixture(),items=[photo('a'),photo('b'),video('v'),photo('c'),photo('d'),video('w')],size={width:360,height:260,compact:true};
 f.buffer.update(items,items[0],size);await tick();assert.equal(f.images.length,3);assert.deepEqual(f.calls,['v']);
 f.buffer.update(items,items[2],size);await tick();assert.ok(f.images[0].removed.includes('src'));assert.equal(f.buffer.videoSource('v'),'video:v');
 f.buffer.update(items,items[2],{...size,width:400});await tick();assert.ok(f.videos[0].paused);assert.ok(f.videos[0].removed.includes('src'));
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
