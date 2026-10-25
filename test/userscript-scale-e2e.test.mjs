import test from 'node:test';
import {deflateSync,crc32} from 'node:zlib';
const pngPhoto=(()=>{const width=90,height=120,raw=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*(width*4+1)+1+x*4,sun=(x-45)**2+(y-50)**2<400;raw[i]=sun?255:51;raw[i+1]=sun?221:170;raw[i+2]=sun?85:119;raw[i+3]=255;}const chunk=(type,data)=>{const length=Buffer.alloc(4),body=Buffer.concat([Buffer.from(type),data]),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(body));return Buffer.concat([length,body,crc]);};const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);})();
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {emptyReview} from '../lib/userscript-core.mjs';

let chromium;
try{({chromium}=await import('playwright'));}catch{}
const hour=3600000;
const item=(index,extra={})=>({mediaKey:`synthetic-${index}`,name:`synthetic-${index}.jpg`,date:new Date(Date.UTC(2024,8,1)+index*(extra.spacing??86400000)).toISOString(),size:2e7,thumbUrl:`https://lh3.googleusercontent.com/synthetic-${index}`,type:'photo',state:'active',decision:null,revision:0,urlFetchedAt:Date.now(),locationName:'Banff, AB',...extra});

async function mount(t,{width,height,items,dpr=1,touch=false,sort='flashbacks'}){
 if(!chromium){t.skip('Playwright is unavailable');return null;}
 const browser=await chromium.launch({headless:true});
 t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:dpr,hasTouch:touch,isMobile:touch});
 const requests=[];
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.hostname==='photos-swipe.test')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'});
  if(url.hostname==='lh3.googleusercontent.com'){requests.push(url.pathname);return route.fulfill({contentType:'image/png',body:pngPhoto});}
  return route.abort();
 });
 await page.goto('https://photos-swipe.test');
 await page.evaluate(async ({review,sort})=>{
  window.WIZ_global_data={SNlM0e:'synthetic-token',oPEP7c:'synthetic@example.test',eptZe:'/_/PhotosUi/u/0/'};
  const account=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(window.WIZ_global_data.oPEP7c))),byte=>byte.toString(16).padStart(2,'0')).join('');
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('photos-swipe-userscript',2);request.onupgradeneeded=()=>{for(const name of ['accounts','leases','settings'])request.result.createObjectStore(name);};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  await new Promise((resolve,reject)=>{const tx=db.transaction(['accounts','settings'],'readwrite');tx.objectStore('accounts').put(review,account);tx.objectStore('settings').put({onboardingDismissed:true},'sync');tx.objectStore('settings').put({sort},`resume:${account}`);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
 },{review:{...emptyReview(),revision:1,started:true,exhausted:true,swipeCount:1,items},sort});
 const source=(await readFile(new URL('../userscript/photoswiper-app.user.js',import.meta.url),'utf8')).replace('document,location,GM:',"document,location:{origin:'https://photos.google.com',pathname:'/u/0/'},GM:");
 await page.addScriptTag({content:source});
 await page.evaluate(()=>document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('launcher').onclick());
 await page.waitForFunction(()=>{const image=document.getElementById('photos-swipe-userscript-host').shadowRoot.querySelector('#media img');return image?.complete&&image.naturalWidth>0&&!image.hidden;},null,{timeout:20000});
 return {page,requests};
}
const measure=(page,code)=>page.evaluate(source=>Function('const root=document.getElementById("photos-swipe-userscript-host").shadowRoot;const q=s=>root.querySelector(s);'+source)(),code);
const swipe=async(page,key='ArrowRight')=>{
 const before=await page.evaluate(()=>performance.getEntriesByName('painted').length);
 await page.keyboard.press(key);
 await page.waitForFunction(count=>performance.getEntriesByName('painted').length>count,before,{timeout:10000});
};

for(const [width,height] of [[393,852],[1280,900]])test(`a drag moves the whole card with its frame, chips and tools over the next card at ${width}×${height}`,async t=>{
 const mounted=await mount(t,{width,height,items:Array.from({length:4},(_,index)=>item(index))});if(!mounted)return;
 const {page}=mounted;
 await page.waitForFunction(()=>document.getElementById('photos-swipe-userscript-host').shadowRoot.querySelector('#next-card img')?.naturalWidth>0);
 const caption=await measure(page,`return q('#caption').textContent;`);
 const media=await page.locator('#media').boundingBox(),x=media.x+media.width/2,y=media.y+media.height/2;
 await page.mouse.move(x,y);await page.mouse.down();
 for(let step=1;step<=8;step++){await page.mouse.move(x+12*step,y+3*step);await page.waitForTimeout(16);}
 await page.waitForTimeout(80);
 const held=await measure(page,`const top=q('.top-card'),card=q('#card'),under=q('#next-card'),label=q('.memory-label'),r=label.getBoundingClientRect();
  return {lifted:top.classList.contains('lifted'),transform:getComputedStyle(top).transform!=='none',frame:getComputedStyle(top,'::before').backgroundImage!=='none',stackClip:getComputedStyle(card).overflow,stackFill:getComputedStyle(card).backgroundColor,contentClip:getComputedStyle(q('.content')).overflow,
   tools:top.contains(q('#enlarge'))&&top.contains(q('#share'))&&getComputedStyle(q('#enlarge')).opacity==='1',chip:top.contains(label)&&!label.hidden&&r.width>0,stamp:top.contains(q('.stamp-keep')),
   under:{opacity:getComputedStyle(under).opacity,fill:getComputedStyle(under).backgroundColor}};`);
 assert.deepEqual({...held,under:undefined},{lifted:true,transform:true,frame:true,stackClip:'visible',stackFill:'rgba(0, 0, 0, 0)',contentClip:'visible',tools:true,chip:true,stamp:true,under:undefined});
 assert.equal(held.under.opacity,'1');assert.notEqual(held.under.fill,'rgba(0, 0, 0, 0)');
 for(let step=7;step>=0;step--){await page.mouse.move(x+12*step,y+3*step);await page.waitForTimeout(16);}
 await page.mouse.up();await page.waitForTimeout(500);
 assert.deepEqual(await measure(page,`return {lifted:!!q('.top-card.lifted'),contentClip:getComputedStyle(q('.content')).overflow,caption:q('#caption').textContent};`),{lifted:false,contentClip:width>=900?'clip':'hidden',caption});
});

test('a drag in enlarged view without element fullscreen, as on iPhone, keeps the card opaque over the next card',async t=>{
 const mounted=await mount(t,{width:393,height:852,items:Array.from({length:4},(_,index)=>item(index))});if(!mounted)return;
 const {page}=mounted;
 await page.waitForFunction(()=>document.getElementById('photos-swipe-userscript-host').shadowRoot.querySelector('#next-card img')?.naturalWidth>0);
 await page.evaluate(()=>{for(const name of ['fullscreenEnabled','webkitFullscreenEnabled'])Object.defineProperty(Document.prototype,name,{configurable:true,get:()=>false});});
 await measure(page,`q('#enlarge').click();`);await page.waitForTimeout(400);
 assert.deepEqual(await measure(page,`return {expanded:q('#card').classList.contains('expanded'),fullscreen:!!(document.fullscreenElement||document.webkitFullscreenElement)};`),{expanded:true,fullscreen:false});
 const media=await page.locator('#media').boundingBox(),x=media.x+media.width/2,y=media.y+media.height/2;
 await page.mouse.move(x,y);await page.mouse.down();
 for(let step=1;step<=8;step++){await page.mouse.move(x+12*step,y+3*step);await page.waitForTimeout(16);}
 await page.waitForTimeout(80);
 const held=await measure(page,`const top=q('.top-card'),fill=getComputedStyle(top,'::before');
  return {lifted:top.classList.contains('lifted'),peek:getComputedStyle(q('#next-card')).opacity,frame:fill.content!=='none'&&fill.backgroundImage!=='none',covers:Math.round(parseFloat(fill.width))===top.offsetWidth&&Math.round(parseFloat(fill.height))===top.offsetHeight};`);
 assert.deepEqual(held,{lifted:true,peek:'1',frame:true,covers:true});
 for(let step=7;step>=0;step--){await page.mouse.move(x+12*step,y+3*step);await page.waitForTimeout(16);}
 await page.mouse.up();await page.waitForTimeout(500);
 assert.equal(await measure(page,`return !!q('.top-card.lifted');`),false);
});

test('two hundred decisions keep DOM nodes, listeners and heap flat and force almost no synchronous layout',{timeout:180000},async t=>{
 const mounted=await mount(t,{width:440,height:956,dpr:3,touch:true,items:Array.from({length:260},(_,index)=>item(index,{spacing:hour/4}))});if(!mounted)return;
 const {page}=mounted,cdp=await page.context().newCDPSession(page);
 await cdp.send('HeapProfiler.enable');
 const counters=async()=>{await page.waitForTimeout(800);await cdp.send('HeapProfiler.collectGarbage');await cdp.send('HeapProfiler.collectGarbage');const dom=await cdp.send('Memory.getDOMCounters'),heap=await cdp.send('Runtime.getHeapUsage');return {nodes:dom.nodes,listeners:dom.jsEventListeners,heap:heap.usedSize};};
 for(let index=0;index<10;index++)await swipe(page,index%4===3?'ArrowLeft':'ArrowRight');
 const start=await counters();
 const events=[];cdp.on('Tracing.dataCollected',event=>events.push(...event.value));
 const traced=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));
 await cdp.send('Tracing.start',{traceConfig:{includedCategories:['devtools.timeline','disabled-by-default-devtools.timeline.stack']},transferMode:'ReportEvents'});
 for(let index=0;index<10;index++){await swipe(page);await page.waitForTimeout(60);}
 await cdp.send('Tracing.end');await traced;
 const forced=events.filter(event=>event.ph==='X'&&['Layout','UpdateLayoutTree'].includes(event.name)&&event.args?.beginData?.stackTrace?.length).length;
 assert.ok(forced<=10,`${forced} forced style or layout passes in ten decisions`);
 for(let index=0;index<190;index++)await swipe(page,index%4===3?'ArrowLeft':'ArrowRight');
 const end=await counters();
 assert.ok(end.nodes-start.nodes<120,JSON.stringify({start,end}));
 assert.ok(end.listeners-start.listeners<30,JSON.stringify({start,end}));
 assert.ok(end.heap-start.heap<4e6,JSON.stringify({start,end}));
});

test('Going to Trash with six hundred items renders tiles in chunks, patches choices in place and sizes thumbnails to the tile',{timeout:120000},async t=>{
 const mounted=await mount(t,{width:440,height:956,items:Array.from({length:640},(_,index)=>item(index,index<600?{decision:'remove',revision:1}:{})),sort:'original'});if(!mounted)return;
 const {page,requests}=mounted;
 const opened=await measure(page,`const started=performance.now();q('#review').click();return {ms:performance.now()-started,tiles:root.querySelectorAll('.trash-tile').length};`);
 assert.ok(opened.tiles>=24&&opened.tiles<=96,JSON.stringify(opened));
 await page.waitForTimeout(800);
 const tileRequests=requests.filter(path=>/=w300-h300-k-no$/.test(path));
 assert.ok(tileRequests.length>0&&tileRequests.length<=96,String(tileRequests.length));
 assert.ok(!requests.some(path=>/=w(1024|1600)-h/.test(path)));
 for(let pass=0;pass<12;pass++){await measure(page,`const scroll=q('.trash-scroll');scroll.scrollTop=scroll.scrollHeight;`);await page.waitForTimeout(150);}
 assert.equal(await measure(page,`return root.querySelectorAll('.trash-tile').length;`),600);
 const toggled=await measure(page,`const tile=q('.trash-tile');window.__tile=tile;tile.querySelector('.trash-check').click();const same=q('.trash-tile')===window.__tile;return {same,kept:window.__tile.classList.contains('kept'),pressed:window.__tile.querySelector('.trash-check').getAttribute('aria-pressed'),tiles:root.querySelectorAll('.trash-tile').length,subtitle:q('.trash-subtitle')?.textContent||''};`);
 assert.deepEqual({same:toggled.same,kept:toggled.kept,pressed:toggled.pressed,tiles:toggled.tiles},{same:true,kept:true,pressed:'false',tiles:600});
 const strip=await measure(page,`q('.trash-tile:nth-child(300) .trash-photo').click();return {buttons:root.querySelectorAll('.trash-strip button').length,active:q('.trash-strip button.active')?.getAttribute('aria-label')};`);
 assert.ok(strip.buttons<=61,JSON.stringify(strip));assert.equal(strip.active,'Preview synthetic-299.jpg');
});
