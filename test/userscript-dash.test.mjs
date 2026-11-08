import test from 'node:test';
import assert from 'node:assert/strict';
import {attachAdaptive,attachDash,chooseTracks,parseDashManifest,streamURL} from '../lib/userscript-dash.mjs';
import {startProgressiveVideo} from '../lib/userscript-video.mjs';

const url='https://fixture.invalid/synthetic=dv?authuser=0';
const base=streamURL(url);
const representation=(id,codecs,width,height,bandwidth,host='rr1---sn-fixture.googlevideo.invalid')=>`<Representation id="${id}" codecs="${codecs}" width="${width}" height="${height}" startWithSAP="1" bandwidth="${bandwidth}"><BaseURL>https://${host}/videoplayback/id/${id}/expire/1/sparams/a%2Cb/sig/x&amp;y/</BaseURL><SegmentList><Initialization sourceURL="sq/0"/><SegmentURL media="sq/1/dur/5.005"/><SegmentURL media="sq/2/dur/5.005"/><SegmentURL media="sq/3/dur/5.005"/><SegmentURL media="sq/4/dur/2.236"/></SegmentList></Representation>`;
const audio=`<Representation id="140" codecs="mp4a.40.2" audioSamplingRate="44100" startWithSAP="1" bandwidth="130000"><BaseURL>https://rr1---sn-fixture.googlevideo.invalid/videoplayback/id/140/</BaseURL><SegmentList><Initialization sourceURL="sq/0"/><SegmentURL media="sq/1/dur/9.985"/><SegmentURL media="sq/2/dur/7.314"/></SegmentList></Representation>`;
const videoTimeline='<SegmentList startNumber="0" timescale="1000"><SegmentTimeline><S d="5005" r="2"/><S d="2236"/></SegmentTimeline></SegmentList>';
const manifest=`<?xml version="1.0" encoding="UTF-8"?>\n<MPD xmlns="urn:mpeg:DASH:schema:MPD:2011" type="static" mediaPresentationDuration="PT17.298S"><Period><AdaptationSet id="0" mimeType="video/mp4" subsegmentAlignment="true"><Role schemeIdUri="urn:mpeg:DASH:role:2011" value="main"/>${videoTimeline}${representation('133','avc1.4d400d',426,240,429550)}${representation('136','avc1.4d401e',1280,720,4106666)}${representation('137','avc1.640028',1920,1080,8000000)}</AdaptationSet><AdaptationSet id="1" mimeType="video/webm" subsegmentAlignment="true">${videoTimeline}${representation('248','vp9',1920,1080,6000000)}${representation('271','vp9',2560,1440,12000000)}</AdaptationSet><AdaptationSet id="2" mimeType="audio/mp4" subsegmentAlignment="true"><SegmentList startNumber="0" timescale="1000"><SegmentTimeline><S d="9985"/><S d="7314"/></SegmentTimeline></SegmentList>${audio}</AdaptationSet></Period></MPD>\n`;

test('stream URLs swap the rendition suffix for Google\'s DASH and HLS manifests and keep the query',()=>{
 assert.equal(streamURL(url),'https://fixture.invalid/synthetic=mm,dash-vm-vf,dr.sdr,sdrCodec.vp9.h264?authuser=0');
 assert.equal(streamURL('https://fixture.invalid/synthetic=m22','hls'),'https://fixture.invalid/synthetic=mm,hls-vm-vf,dr.sdr,sdrCodec.vp9.h264');
});

test('the manifest parser reads every representation with absolute segment URLs and timeline times',()=>{
 const parsed=parseDashManifest(manifest,base);
 assert.equal(parsed.duration,17.298);
 assert.deepEqual(parsed.tracks.map(track=>`${track.id}:${track.kind}:${track.mime}:${track.width}x${track.height}`),['133:video:video/mp4:426x240','136:video:video/mp4:1280x720','137:video:video/mp4:1920x1080','248:video:video/webm:1920x1080','271:video:video/webm:2560x1440','140:audio:audio/mp4:0x0']);
 const sharp=parsed.tracks.find(track=>track.id==='137');
 assert.equal(sharp.codecs,'avc1.640028');
 assert.equal(sharp.init,'https://rr1---sn-fixture.googlevideo.invalid/videoplayback/id/137/expire/1/sparams/a%2Cb/sig/x&y/sq/0');
 assert.equal(sharp.segments[3].url,'https://rr1---sn-fixture.googlevideo.invalid/videoplayback/id/137/expire/1/sparams/a%2Cb/sig/x&y/sq/4/dur/2.236');
 assert.deepEqual(sharp.segments.map(segment=>[segment.start,segment.end]),[[0,5.005],[5.005,10.01],[10.01,15.015],[15.015,17.251]]);
 assert.deepEqual(parsed.tracks.at(-1).segments.map(segment=>[segment.start,segment.end]),[[0,9.985],[9.985,17.299]]);
});

test('without a timeline the parser spreads segments evenly over the duration, and junk yields no tracks',()=>{
 const parsed=parseDashManifest(manifest.replace(/<SegmentTimeline>[\s\S]*?<\/SegmentTimeline>/g,''),base);
 assert.deepEqual(parsed.tracks[0].segments.map(segment=>+segment.start.toFixed(3)),[0,4.324,8.649,12.973]);
 assert.deepEqual(parseDashManifest('\u001aEß£ not xml',base).tracks,[]);
});

test('track choice takes the smallest rendition covering 1080p, prefers H.264, adds the best audio, and skips what the browser cannot play',()=>{
 const {tracks}=parseDashManifest(manifest,base);
 assert.deepEqual(chooseTracks(tracks,{supported:()=>true}).map(track=>track.id),['137','140']);
 assert.deepEqual(chooseTracks(tracks,{supported:()=>true,need:2000}).map(track=>track.id),['271','140']);
 assert.deepEqual(chooseTracks(tracks,{supported:type=>!type.startsWith('video/mp4')}).map(track=>track.id),['248','140']);
 assert.deepEqual(chooseTracks(tracks.filter(track=>!['137','248','271'].includes(track.id)),{supported:()=>true}).map(track=>track.id),['136','140']);
 assert.deepEqual(chooseTracks(tracks.filter(track=>track.kind==='video'),{supported:()=>true}).map(track=>track.id),['137']);
 assert.deepEqual(chooseTracks(tracks,{supported:type=>type.startsWith('audio/')}),[]);
 assert.deepEqual(chooseTracks(tracks,{supported:()=>{throw new Error('unsupported');}}),[]);
});

function fakeElement(){
 const listeners=new Map();
 return {src:'',currentTime:0,seeking:false,listeners,
  addEventListener(type,handler){const list=listeners.get(type)||[];list.push(handler);listeners.set(type,list);},
  removeEventListener(type,handler){listeners.set(type,(listeners.get(type)||[]).filter(value=>value!==handler));},
  emit(type){for(const handler of [...(listeners.get(type)||[])])handler();},
  load(){},canPlayType:()=>''};
}
function fakeMediaWindow({times,supported=()=>true}){
 const sources=[];
 class FakeBuffer{
  constructor(type,source){this.type=type;this.source=source;this.updating=false;this.ranges=[];this.appended=[];this.handlers=new Map();}
  get buffered(){const ranges=[...this.ranges].sort((a,b)=>a[0]-b[0]);return {length:ranges.length,start:index=>ranges[index][0],end:index=>ranges[index][1]};}
  addEventListener(type,handler){const list=this.handlers.get(type)||[];list.push(handler);this.handlers.set(type,list);}
  removeEventListener(type,handler){this.handlers.set(type,(this.handlers.get(type)||[]).filter(value=>value!==handler));}
  finish(){setTimeout(()=>{this.updating=false;for(const handler of [...(this.handlers.get('updateend')||[])])handler();},0);}
  appendBuffer(data){this.source.readyState='open';const name=new TextDecoder().decode(data);this.appended.push(name);this.updating=true;const range=times[name];if(range)this.ranges.push(range);this.finish();}
  remove(start,end){this.updating=true;this.ranges=this.ranges.filter(range=>range[1]<=start||range[0]>=end);this.finish();}
 }
 class FakeSource{
  constructor(){this.readyState='open';this.buffers=[];this.ended=0;this.handlers=new Map();sources.push(this);}
  static isTypeSupported(type){return supported(type);}
  addEventListener(type,handler){this.handlers.set(type,handler);}
  open(){this.handlers.get('sourceopen')?.();}
  addSourceBuffer(type){const buffer=new FakeBuffer(type,this);this.buffers.push(buffer);return buffer;}
  endOfStream(){this.ended++;this.readyState='ended';}
 }
 return {sources,window:{MediaSource:FakeSource,AbortController,URL:{createObjectURL:()=>'blob:fixture',revokeObjectURL(){}}}};
}
function fakeFetch(responses){
 const calls=[];
 const fetch=(target,options)=>{
  calls.push({target,credentials:options.credentials});
  const response=typeof responses==='function'?responses(target):responses[target];
  if(response===undefined)return Promise.reject(new Error(`unexpected ${target}`));
  if(response.pending)return new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')));response.pending.push(()=>resolve(response.value));});
  return Promise.resolve(response);
 };
 return {fetch,calls};
}
const ok=body=>({ok:true,status:200,text:async()=>body,arrayBuffer:async()=>new TextEncoder().encode(body).buffer});
const settle=async(rounds=20)=>{for(let round=0;round<rounds;round++)await new Promise(resolve=>setTimeout(resolve,0));};

test('the DASH player fetches the manifest with cookies, starts at the playing time, and buffers only the segments it needs',async()=>{
 const {tracks}=parseDashManifest(manifest,base),video=tracks.find(track=>track.id==='137'),sound=tracks.find(track=>track.id==='140');
 const times={};for(const track of [video,sound])track.segments.forEach((segment,index)=>{times[`${track.id}:${index}`]=[segment.start,segment.end];});
 const responses={[base]:ok(manifest),[video.init]:ok('137:init'),[sound.init]:ok('140:init')};
 for(const track of [video,sound])track.segments.forEach((segment,index)=>{responses[segment.url]=ok(`${track.id}:${index}`);});
 const media=fakeMediaWindow({times}),{fetch,calls}=fakeFetch(responses),element=fakeElement(),failures=[];
 assert.equal(attachDash({video:element,url,window:media.window,fetch,startTime:()=>11,ahead:6,onFail:()=>failures.push('fail')}),true);
 assert.equal(element.src,'blob:fixture');
 media.sources[0].open();await settle();
 assert.deepEqual(calls[0],{target:base,credentials:'include'});
 assert.ok(calls.slice(1).every(call=>call.credentials==='omit'));
 assert.equal(element.currentTime,11);
 const [videoBuffer,audioBuffer]=media.sources[0].buffers;
 assert.equal(videoBuffer.type,'video/mp4; codecs="avc1.640028"');assert.equal(audioBuffer.type,'audio/mp4; codecs="mp4a.40.2"');
 assert.deepEqual(videoBuffer.appended,['137:init','137:2','137:3']);
 assert.deepEqual(audioBuffer.appended,['140:init','140:1']);
 assert.equal(media.sources[0].ended,1);
 element.currentTime=1;element.emit('seeking');await settle();
 assert.deepEqual(videoBuffer.appended,['137:init','137:2','137:3','137:0','137:1']);
 assert.deepEqual(audioBuffer.appended,['140:init','140:1','140:0']);
 assert.deepEqual(failures,[]);
});

test('a seek away from an in-flight segment abandons it and loads the segment at the new time',async()=>{
 const {tracks}=parseDashManifest(manifest.replace(/<AdaptationSet id="2"[\s\S]*?<\/AdaptationSet>/,''),base),video=tracks.find(track=>track.id==='137');
 const times={};video.segments.forEach((segment,index)=>{times[`137:${index}`]=[segment.start,segment.end];});
 const slow={pending:[],value:ok('137:0')},responses={[base]:ok(manifest.replace(/<AdaptationSet id="2"[\s\S]*?<\/AdaptationSet>/,'')),[video.init]:ok('137:init'),[video.segments[0].url]:slow};
 video.segments.slice(1).forEach((segment,index)=>{responses[segment.url]=ok(`137:${index+1}`);});
 const media=fakeMediaWindow({times}),{fetch}=fakeFetch(responses),element=fakeElement();
 attachDash({video:element,url,window:media.window,fetch,ahead:4});
 media.sources[0].open();await settle();
 assert.equal(slow.pending.length,1);
 element.currentTime=16;element.emit('seeking');await settle();
 assert.deepEqual(media.sources[0].buffers[0].appended,['137:init','137:3']);
});

test('the DASH player gives up without retrying a refused manifest, retries a flaky segment, and stops when its element is emptied',async()=>{
 const refused=fakeMediaWindow({times:{}}),first=fakeFetch({[base]:{ok:false,status:403}}),failures=[];
 attachDash({video:fakeElement(),url,window:refused.window,fetch:first.fetch,onFail:()=>failures.push('manifest')});
 refused.sources[0].open();await settle();
 assert.deepEqual(failures,['manifest']);assert.equal(first.calls.length,1);
 const unplayable=fakeMediaWindow({times:{},supported:()=>false}),second=fakeFetch({[base]:ok(manifest)});
 attachDash({video:fakeElement(),url,window:unplayable.window,fetch:second.fetch,onFail:()=>failures.push('codecs')});
 unplayable.sources[0].open();await settle();
 assert.deepEqual(failures,['manifest','codecs']);
 const {tracks}=parseDashManifest(manifest,base),video=tracks.find(track=>track.id==='137'),sound=tracks.find(track=>track.id==='140');
 let flaky=0;
 const media=fakeMediaWindow({times:{'137:0':[0,5.005],'140:0':[0,9.985]}}),third=fakeFetch(target=>{
  if(target===base)return ok(manifest);if(target===video.init)return ok('137:init');if(target===sound.init)return ok('140:init');
  if(target===video.segments[0].url){flaky++;return flaky===1?{ok:false,status:503}:ok('137:0');}
  if(target===sound.segments[0].url)return ok('140:0');
  return {pending:[],value:ok('later')};
 }),element=fakeElement();
 attachDash({video:element,url,window:media.window,fetch:third.fetch,ahead:4,onFail:()=>failures.push('segment')});
 media.sources[0].open();await settle();await new Promise(resolve=>setTimeout(resolve,1100));await settle();
 assert.equal(flaky,2);assert.deepEqual(failures,['manifest','codecs']);
 assert.deepEqual(media.sources[0].buffers[0].appended,['137:init','137:0']);
 assert.equal(typeof element.detachAdaptive,'function');
 const kept=fakeMediaWindow({times:{'137:init':[0,0]}}),broken=fakeFetch(target=>target===base?ok(manifest):target===video.init?ok('137:init'):target===sound.init?ok('140:init'):{ok:false,status:404}),keptElement=fakeElement();let asked=0;
 attachDash({video:keptElement,url,window:kept.window,fetch:broken.fetch,onFail:()=>{asked++;return false;}});
 kept.sources[0].open();await settle();
 assert.equal(asked,2);assert.equal(typeof keptElement.detachAdaptive,'function');
 const blocked=broken.calls.length;keptElement.emit('seeking');await settle();assert.equal(broken.calls.length,blocked);
 keptElement.src='';keptElement.emit('emptied');
 element.src='';element.emit('emptied');
 assert.equal(element.detachAdaptive,undefined);
 const before=third.calls.length;element.currentTime=12;element.emit('seeking');await settle();
 assert.equal(third.calls.length,before);
});

test('browsers without Media Source use native HLS when they can play it, and otherwise report no adaptive stream',()=>{
 const hls=fakeElement();hls.canPlayType=type=>type==='application/vnd.apple.mpegurl'?'maybe':'';
 assert.equal(attachAdaptive({video:hls,url,window:{},fetch}),'hls');
 assert.equal(hls.src,streamURL(url,'hls'));
 const plain=fakeElement();
 assert.equal(attachAdaptive({video:plain,url,window:{},fetch}),'');
 assert.equal(plain.src,'');
});

function progressiveVideo(){
 const listeners=new Map();
 return {style:{},parentNode:{append(element){element.isConnected=true;}},remove(){this.isConnected=false;},src:'',currentTime:0,readyState:0,paused:true,muted:true,volume:1,playbackRate:1,loop:true,dataset:{},loads:0,
  addEventListener(type,handler,options){const list=listeners.get(type)||[];list.push({handler,once:options?.once});listeners.set(type,list);},
  emit(type){for(const entry of [...(listeners.get(type)||[])]){if(entry.once)listeners.set(type,listeners.get(type).filter(value=>value!==entry));entry.handler();}},
  play(){this.paused=false;this.emit('play');return Promise.resolve();},pause(){this.paused=true;this.emit('pause');},load(){this.loads++;},removeAttribute(name){this[name]='';}
 };
}

test('the desktop upgrade streams through the adaptive player and falls back to the original file in the same element when it fails',async()=>{
 const video=progressiveVideo(),copies=[],attached=[];
 startProgressiveVideo({video,url,compact:false,createVideo:()=>{const copy=progressiveVideo();copies.push(copy);return copy;},onSwap(){},onError(){},isActive:()=>true,adaptive:(element,options)=>{attached.push({element,options});element.src='blob:fixture';return 'dash';}});
 video.currentTime=6;video.readyState=2;video.emit('loadeddata');
 assert.equal(copies.length,1);assert.equal(copies[0].src,'blob:fixture');assert.equal(attached[0].options.startTime(),6);
 assert.equal(attached[0].options.onFail(),true);
 assert.equal(copies.length,1);assert.equal(copies[0].src,url);assert.equal(attached.length,1);
 copies[0].onerror();assert.equal(copies[0].src,'');
});

test('the phone keeps its 720p file step, and a native HLS error falls back to the original file',()=>{
 const phone=progressiveVideo(),phoneCopies=[];let phoneAdaptive=0;
 startProgressiveVideo({video:phone,url,compact:true,createVideo:()=>{const copy=progressiveVideo();phoneCopies.push(copy);return copy;},onSwap(){},onError(){},isActive:()=>true,adaptive:()=>{phoneAdaptive++;return 'hls';}});
 phone.readyState=2;phone.emit('loadeddata');
 assert.equal(phoneAdaptive,0);assert.match(phoneCopies[0].src,/=m22\?/);
 const video=progressiveVideo(),copies=[];
 startProgressiveVideo({video,url,compact:false,createVideo:()=>{const copy=progressiveVideo();copies.push(copy);return copy;},onSwap(){},onError(){},isActive:()=>true,adaptive:element=>{element.src=streamURL(url,'hls');return 'hls';}});
 video.readyState=2;video.emit('loadeddata');
 assert.equal(copies[0].src,streamURL(url,'hls'));
 copies[0].onerror();
 assert.equal(copies.length,1);assert.equal(copies[0].src,url);
});
