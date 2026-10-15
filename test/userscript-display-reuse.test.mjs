import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {watchVideoLoading} from '../lib/userscript-video.mjs';
import {restoreVideoTime} from '../lib/userscript-ui.mjs';
import {createReviewPreloader} from '../lib/userscript-preload.mjs';
import {reusablePreview,pendingPreview} from '../lib/userscript-performance.mjs';

const source=await readFile(new URL('../lib/userscript-ui.mjs',import.meta.url),'utf8');
const displaySource=source.slice(source.indexOf(' async function display(item,'),source.indexOf(' function updateVideoControls()'));

function fixture(reuse){
 const item={mediaKey:'next',name:'Next',type:reuse==='video'?'video':'photo',thumbUrl:'https://fixture.invalid/next'};
 const created=[],refreshes=[],played=[],cleared=[];
 const element=tag=>({tag,style:{},dataset:{},complete:true,naturalWidth:640,hidden:false,src:item.thumbUrl,readyState:2,duration:60,currentTime:0,listeners:{},addEventListener(type,listener){(this.listeners[type]??=[]).push(listener);},setAttribute(){},pause(){this.paused=true;},removeAttribute(name){delete this[name];},load(){this.loads=(this.loads||0)+1;},play(){played.push(this);return Promise.resolve();}});
 const broken=element('img');broken.naturalWidth=0;broken.dataset.key=item.mediaKey;
 const ready=element(item.type==='video'?'video':'img');
 let assignments=0;Object.defineProperty(ready,'src',{configurable:true,get:()=>item.thumbUrl,set:()=>{assignments++;}});
 const media={querySelector(tag){return this.children.find(child=>child.tag===tag)||null;},style:{},children:[],setAttribute(name,value){this[name]=value;},replaceChildren(...children){this.children=children;},append(child){this.children.push(child);}};
 const nodes={media,zoom:{},card:{classList:{remove(){},contains:()=>false}}};
 const context=vm.createContext({watchVideoLoading,startProgressiveVideo:({video,url})=>{if(video.src!==url){video.src=url;video.play().catch(()=>{});}else if(video.paused)video.play().catch(()=>{});},previewSize:()=>({compact:false}),otherTab:false,leaseError:null,underCard:{querySelector:()=>broken},stopMedia(){},$:id=>nodes[id],mediaElement:media,shown:null,generation:0,reviewURLStale:()=>false,previewSource:url=>url,buffer:{take:()=>reuse==='buffer'?ready:null},preloader:{take:()=>reuse==='preloader'?ready:null,takeVideo:()=>reuse==='video'?ready:null},reusablePreview,pendingPreview,metrics:{hits:0,misses:0},document:{createElement:tag=>{const node=element(tag);created.push(node);return node;}},refreshItemURL:async value=>{refreshes.push(value);return value;},clearPreviewWindow:()=>cleared.push('window'),videoURLs:new Map(),dropWarmVideo:()=>cleared.push('video'),preloadReview(){},painted(){},restoreVideoTime,resume:{},videoSavedAt:0,captureVideo(){},addVideoControls(){},videoURL:async()=>item.thumbUrl,window:{performance:{now:()=>0},localStorage:{}},current:()=>item,sharpReady:()=>null,upgradeSharp(){}});
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


test('transferred videos with metadata already loaded restore the saved playback position',async()=>{
 const f=fixture('video');f.context.resume.video={key:f.item.mediaKey,time:12};
 await f.context.display(f.item);
 assert.equal(f.ready.currentTime,12);assert.equal(f.ready.dataset.resumeReady,'ready');
});


test('stale video plays its warmed download at once without waiting for a thumbnail refresh',async()=>{
 const f=fixture('video'),size={width:360,height:480},previous={mediaKey:'previous',type:'photo',thumbUrl:'https://fixture.invalid/previous'},items=[previous,f.item];
 const preloader=createReviewPreloader({createImage:()=>({src:'',style:{},dataset:{},complete:true,naturalWidth:640,decode:async()=>{},removeAttribute(){},setAttribute(){},addEventListener(){}}),createVideo:()=>f.ready,videoURL:async()=>({url:f.item.thumbUrl}),previewURL:url=>url,playbackURL:url=>url});
 preloader.update(items,previous,size);
 await new Promise(resolve=>setImmediate(resolve));
 const warmedAssignments=f.assignments(),refreshes=[];
 f.context.preloader=preloader;
 f.context.reviewURLStale=()=>true;
 f.context.refreshItemURL=item=>{refreshes.push(item.mediaKey);return new Promise(()=>{});};
 const displaying=f.context.display(f.item);
 preloader.update(items,f.item,size);
 await displaying;
 assert.ok(f.media.children.includes(f.ready));
 assert.deepEqual(refreshes,[]);
 assert.deepEqual(f.played,[f.ready]);
 assert.equal(f.assignments(),warmedAssignments);
 assert.equal(f.ready.loads,1);
 assert.equal(f.context.metrics.hits,1);
 assert.equal(f.created.filter(node=>node.tag==='video').length,0);
});

for(const retried of [false,true])test(`failed video cannot restart or reattach after its pending link resolves (retried=${retried})`,async()=>{
 const f=fixture('video');
 let finishLink,finishRefresh;
 f.context.videoURL=()=>new Promise(resolve=>{finishLink=resolve;});
 f.context.refreshItemURL=()=>new Promise(resolve=>{finishRefresh=resolve;});
 const displaying=f.context.display(f.item,retried);
 const video=f.media.querySelector('video');
 const failed=video.onerror();
 assert.equal(video.paused,true);
 assert.equal(video.src,undefined);
 assert.equal(video.loads,1);
 video.onloadeddata();
 assert.ok(!f.media.children.includes(video));
 assert.equal(f.media['aria-busy'],'false');
 finishLink('https://fixture.invalid/late-video');
 await displaying;
 assert.equal(video.src,undefined);
 assert.deepEqual(f.played,retried?[]:[video]);
 assert.ok(!f.media.children.includes(video));
 if(!retried){
  f.context.generation++;
  finishRefresh(f.item);
 }
 await failed;
});

for(const warmed of [false,true])for(const event of ['loadeddata','canplay','playing','timeupdate'])test(`${warmed?'warmed':'fresh'} video reveals and clears loading on ${event}`,async()=>{
 const f=fixture(warmed?'video':'none');f.item.type='video';f.ready.readyState=1;
 if(!warmed){const create=f.context.document.createElement;f.context.document.createElement=tag=>{const node=create(tag);node.readyState=1;return node;};}
 await f.context.display(f.item);
 const video=f.media.querySelector('video');
 assert.equal(video.hidden,true);assert.equal(f.media['aria-busy'],'true');
 if(event==='timeupdate'){
  for(const listener of video.listeners.timeupdate)listener();
  assert.equal(video.hidden,true);assert.equal(f.media['aria-busy'],'true');
  video.currentTime=1;
  for(const listener of video.listeners.timeupdate)listener();
 }else video[`on${event}`]();
 assert.equal(video.hidden,false);assert.equal(f.media['aria-busy'],'false');
 assert.deepEqual(f.media.children,[video]);
 video.oncanplay();video.onplaying();video.onloadeddata();
 assert.deepEqual(f.media.children,[video]);
});

test('ready warmed video reveals and attempts autoplay before its pending link resolves',async()=>{
 const f=fixture('video');let finishLink;
 f.context.videoURL=()=>new Promise(resolve=>{finishLink=resolve;});
 const displaying=f.context.display(f.item);
 assert.equal(f.ready.hidden,false);assert.equal(f.media['aria-busy'],'false');
 assert.deepEqual(f.media.children,[f.ready]);assert.deepEqual(f.played,[f.ready]);
 finishLink(f.item.thumbUrl);await displaying;
 assert.deepEqual(f.played,[f.ready]);
});

for(const readyState of [1,2])test(`warmed video restarts autoplay after its pending link changes (readyState=${readyState})`,async()=>{
 const f=fixture('video');let finishLink,currentSource=f.item.thumbUrl;
 f.ready.readyState=readyState;
 Object.defineProperty(f.ready,'src',{configurable:true,get:()=>currentSource,set:value=>{currentSource=value;f.ready.paused=true;f.ready.readyState=0;}});
 f.ready.play=()=>{f.played.push(f.ready);f.ready.paused=false;return Promise.resolve();};
 f.context.videoURL=()=>new Promise(resolve=>{finishLink=resolve;});
 const displaying=f.context.display(f.item);
 assert.deepEqual(f.played,[f.ready]);
 const refreshedURL='https://fixture.invalid/refreshed-video';
 finishLink(refreshedURL);await displaying;
 assert.equal(f.ready.src,refreshedURL);
 assert.deepEqual(f.played,[f.ready,f.ready]);
 assert.equal(f.ready.paused,false);
 f.ready.onplaying();
 assert.equal(f.ready.hidden,false);assert.equal(f.media['aria-busy'],'false');
 assert.deepEqual(f.media.children,[f.ready]);
});

for(const event of ['loadeddata','canplay','playing','timeupdate'])test(`superseded video ignores ${event}`,async()=>{
 const f=fixture('video');f.ready.readyState=1;
 await f.context.display(f.item);f.context.generation++;
 f.ready.currentTime=1;
 if(event==='timeupdate')for(const listener of f.ready.listeners.timeupdate)listener();
 else f.ready[`on${event}`]();
 assert.equal(f.ready.hidden,true);assert.equal(f.media['aria-busy'],'true');
});

test('an under-card photo that is still downloading becomes the card without a second request',async()=>{
 const f=fixture('none');
 const pending=f.context.underCard.querySelector();
 pending.naturalWidth=0;pending.complete=false;
 let assigned=0;Object.defineProperty(pending,'src',{configurable:true,get:()=>f.item.thumbUrl,set:()=>{assigned++;}});
 await f.context.display(f.item);
 assert.ok(f.media.children.includes(pending));
 assert.equal(f.created.length,0);
 assert.equal(assigned,0);
 assert.equal(f.media['aria-busy'],'true');
 pending.complete=true;pending.naturalWidth=640;pending.onload();
 assert.equal(pending.hidden,false);assert.equal(f.media['aria-busy'],'false');
 assert.equal(f.context.metrics.hits,1);
});
