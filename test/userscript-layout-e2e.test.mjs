import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {emptyReview} from '../lib/userscript-core.mjs';
import {fulfillVideo} from './fixtures/video-route.mjs';

let chromium;
try{const playwright=await import('playwright');chromium=playwright[process.env.PS_ENGINE||'chromium'];}catch{}
const item=(index,extra={})=>({mediaKey:`synthetic-${index}`,name:`synthetic-${index}.jpg`,date:new Date(2020,0,1+index).toISOString(),size:2e7,thumbUrl:`https://lh3.googleusercontent.com/synthetic-${index}`,type:'photo',state:'active',decision:null,revision:0,urlFetchedAt:Date.now(),...extra});

async function mount(t,{width,height,items,state={},scheme='light',touch=false,routes=null,dpr=1,init=null,onboarding=false,timezoneId=undefined}){
 if(!chromium){t.skip('Playwright is unavailable');return null;}
 const browser=await chromium.launch({headless:true});
 t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:dpr,colorScheme:scheme,hasTouch:touch,isMobile:touch&&(process.env.PS_ENGINE||'chromium')==='chromium',...(timezoneId?{timezoneId,locale:'en-US'}:{})});
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(routes){const handled=routes(route,url);if(handled)return handled;}
  if(url.hostname==='photos-swipe.test')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'});
  if(url.hostname==='lh3.googleusercontent.com')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="1600" height="1200" fill="#3a7"/></svg>'});
  return route.abort();
 });
 await page.goto('https://photos-swipe.test');
 await page.evaluate(async ({review,onboarding})=>{
  window.WIZ_global_data={SNlM0e:'synthetic-token',oPEP7c:'synthetic@example.test',eptZe:'/_/PhotosUi/u/0/'};
  const account=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(window.WIZ_global_data.oPEP7c))),byte=>byte.toString(16).padStart(2,'0')).join('');
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('photos-swipe-userscript',2);request.onupgradeneeded=()=>{for(const name of ['accounts','leases','settings'])request.result.createObjectStore(name);};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  await new Promise((resolve,reject)=>{const tx=db.transaction(['accounts','settings'],'readwrite');tx.objectStore('accounts').put(review,account);tx.objectStore('settings').put(onboarding?{}:{onboardingDismissed:true},'sync');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
 },{review:{...emptyReview(),revision:1,started:true,exhausted:true,...state,items},onboarding});
 const source=(await readFile(new URL('../userscript/photoswiper-app.user.js',import.meta.url),'utf8')).replace('document,location,GM:',"document,location:{origin:'https://photos.google.com',pathname:'/u/0/'},GM:");
 if(init)await page.evaluate(init);
 await page.addScriptTag({content:source});
 await page.evaluate(()=>document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('launcher').onclick());
 await page.waitForFunction(()=>{const root=document.getElementById('photos-swipe-userscript-host').shadowRoot;return root.getElementById('overlay')['aria-busy']!=='true'&&root.getElementById('overlay').getAttribute('aria-busy')==='false';});
 return page;
}
const measure=(page,code)=>page.evaluate(source=>Function('const root=document.getElementById("photos-swipe-userscript-host").shadowRoot;const q=s=>root.querySelector(s);const box=s=>{const r=(typeof s==="string"?q(s):s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};'+source)(),code);

for(const [width,height] of [[1280,900],[393,852]])test(`Enlarge grows the card and hides the surrounding chrome at ${width}×${height}`,async t=>{
 const page=await mount(t,{width,height,items:Array.from({length:5},(_,index)=>item(index))});if(!page)return;
 const before=await measure(page,`return box('#card');`);
 await measure(page,`root.getElementById('enlarge').click();`);
 await page.waitForTimeout(500);
 const after=await measure(page,`return {card:box('#card'),caption:getComputedStyle(q('#caption')).display,order:getComputedStyle(q('.order-row')).display,actions:box('.actions'),scroll:document.scrollingElement.scrollHeight<=innerHeight};`);
 assert.ok(after.card.height>before.height+80||after.card.height>=height-2,`${before.height} → ${after.card.height}`);
 if(width>600)assert.ok(after.card.width>=width-2&&after.card.height>=height-2,`${before.width} → ${after.card.width}`);
 assert.equal(after.caption,'none');assert.equal(after.order,'none');
 assert.ok(after.actions.y+after.actions.height<=height);
 assert.ok(after.scroll);
});

test('a very long name stays within two caption lines and keeps the photo visible at 320×480',async t=>{
 const name='x'.repeat(30)+' '+'very long filename '.repeat(20)+'.jpg';
 const page=await mount(t,{width:320,height:480,items:[item(1,{name})],state:{exhausted:false}});if(!page)return;
 const layout=await measure(page,`return {card:box('#card'),caption:box('#caption'),lineHeight:parseFloat(getComputedStyle(q('#caption')).lineHeight)||20,title:q('#caption').title,scroll:document.scrollingElement.scrollHeight<=innerHeight,keep:box('#keep')};`);
 assert.ok(layout.card.height>=120,String(layout.card.height));
 assert.ok(layout.caption.height<=layout.lineHeight*2+24,String(layout.caption.height));
 assert.match(layout.title,/very long filename/);
 assert.ok(layout.scroll);
 assert.ok(layout.keep.y+layout.keep.height<=480);
});

test('the queue pill is one tappable control with a trash glyph and its size beside the count',async t=>{
 const items=[...Array.from({length:30},(_,index)=>item(index,{decision:'remove',revision:1})),item(100)];
 const page=await mount(t,{width:393,height:852,items,state:{exhausted:false}});if(!page)return;
 const pill=await measure(page,`const pill=q('.queue-pill');const text=[...pill.children].find(node=>node.tagName==='SPAN'&&!node.className);return {hidden:pill.hidden,role:pill.getAttribute('role'),glyph:!!pill.querySelector(':scope > svg'),text:text.textContent,size:text.querySelector('.queue-size')?.textContent,review:box(pill.querySelector('button')),box:box(pill)};`);
 assert.equal(pill.hidden,false);assert.equal(pill.role,'button');assert.ok(pill.glyph);
 assert.match(pill.text,/^30 going to Trash · 600 MB$/);assert.equal(pill.size,'· 600 MB');
 assert.ok(pill.review.height>=44&&pill.review.width>=44);
 await measure(page,`const pill=q('.queue-pill');const r=pill.getBoundingClientRect();root.elementFromPoint(r.x+r.width*0.4,r.y+r.height/2).click();`);
 assert.equal(await measure(page,`return q('#review-panel').hidden;`),false);
});

test('a pending album transfer keeps the old review-album link hidden in Settings',async t=>{
 const page=await mount(t,{width:1280,height:900,items:[item(1,{decision:'remove',revision:1})],state:{albumKey:'synthetic-album',job:{albumKey:'synthetic-album',mediaKeys:['synthetic-1'],confirmed:[]}}});if(!page)return;
 assert.deepEqual(await measure(page,`return {album:q('#album').hidden,send:q('#send').parentElement.hidden};`),{album:true,send:false});
});

test('at 320×568 the window does not scroll and decision controls receive taps',async t=>{
 const page=await mount(t,{width:320,height:568,items:Array.from({length:3},(_,index)=>item(index)),state:{exhausted:false}});if(!page)return;
 const result=await measure(page,`const hit=id=>{const r=box('#'+id);const target=root.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return target?.closest?.('#'+id)?.id||target?.id||null;};return {scroll:document.scrollingElement.scrollHeight<=innerHeight,remove:hit('remove'),keep:hit('keep'),enlarge:hit('enlarge'),status:box('#status').height};`);
 assert.deepEqual(result,{scroll:true,remove:'remove',keep:'keep',enlarge:'enlarge',status:24});
});

for(const [width,height] of [[1280,900],[393,852]])for(const id of ['keep','remove'])test(`a ${id} fly-off stays clipped inside the card stack at ${width}×${height}`,async t=>{
 const page=await mount(t,{width,height,items:Array.from({length:4},(_,index)=>item(index)),state:{exhausted:false}});if(!page)return;
 const before=await measure(page,`return box('#card');`);
 await measure(page,`root.getElementById('${id}').click();`);
 const during=await measure(page,`const animations=[...(root.getAnimations?.()||[]),...document.getAnimations()];for(const animation of animations){animation.pause();const duration=animation.effect?.getComputedTiming?.().duration;animation.currentTime=typeof duration==='number'?duration/2:90;}
  const overlay=q('.overlay'),stack=q('#card'),clones=[...stack.children].filter(node=>node!==q('.top-card')&&node.classList?.contains('top-card'));
  return {clones:clones.length,animations:animations.length,overlay:overlay.scrollWidth<=overlay.clientWidth,page:document.scrollingElement.scrollWidth<=innerWidth,fixed:clones.some(node=>getComputedStyle(node).position==='fixed'),card:box('#card'),clip:getComputedStyle(stack).overflow};`);
 assert.ok(during.animations>0);assert.ok(during.clones>0);
 assert.equal(during.overlay,true);assert.equal(during.page,true);assert.equal(during.fixed,false);
 assert.deepEqual(during.card,before);
});

test('the first-run coach shows on an untouched deck and leaves after the first decision',async t=>{
 const page=await mount(t,{width:393,height:852,items:Array.from({length:3},(_,index)=>item(index)),state:{exhausted:false}});if(!page)return;
 const first=await measure(page,`const coach=q('.coach');return {hidden:coach.hidden,text:coach.textContent,box:box(coach),card:box('#card'),pointer:getComputedStyle(coach).pointerEvents};`);
 assert.equal(first.hidden,false);assert.match(first.text,/Delete/);assert.match(first.text,/Keep/);assert.equal(first.pointer,'none');
 assert.ok(first.box.width>0&&first.box.y>=first.card.y&&first.box.y+first.box.height<=first.card.y+first.card.height+1);
 await measure(page,`root.getElementById('keep').click();`);
 await page.waitForTimeout(100);
 assert.equal(await measure(page,`return q('.coach').hidden;`),true);
});

test('routine messages fade out while errors stay until tapped, and delete is red',async t=>{
 const page=await mount(t,{width:1280,height:900,items:Array.from({length:3},(_,index)=>item(index)),state:{exhausted:true}});if(!page)return;
 await measure(page,`root.getElementById('keep').click();`);
 await page.waitForTimeout(50);
 const routine=await measure(page,`const status=q('#status');const animations=status.getAnimations();for(const animation of animations)animation.finish();return {text:status.textContent,classes:status.className,animations:animations.length,opacity:getComputedStyle(status).opacity};`);
 assert.match(routine.text,/Kept/);assert.match(routine.classes,/toast-show/);assert.ok(routine.animations>0);assert.equal(routine.opacity,'0');
 await measure(page,`const status=q('#status');status.textContent='';status.className='status';`);
 await measure(page,`root.getElementById('trash').click();`);
 await page.waitForTimeout(400);
 const error=await measure(page,`const status=q('#status');return {text:status.textContent,classes:status.className,opacity:getComputedStyle(status).opacity};`);
 assert.match(error.classes,/toast-sticky/,error.text);
 {
  assert.equal(error.opacity,'1');
  await measure(page,`q('#status').click();`);
  const dismissed=await measure(page,`const status=q('#status');for(const animation of status.getAnimations())animation.finish();return {classes:status.className,opacity:getComputedStyle(status).opacity};`);
  assert.match(dismissed.classes,/toast-show/);assert.equal(dismissed.opacity,'0');
 }
 const colors=await measure(page,`return {remove:getComputedStyle(q('#remove')).color,badge:getComputedStyle(q('.trash-badge')).backgroundColor};`);
 assert.match(colors.remove,/rgb\(255, 59, 48\)|rgb\(255, 69, 58\)/);assert.equal(colors.badge,colors.remove);
});

test('the Done view lives inside the rebuilt review panel and lays out compactly',async t=>{
 const page=await mount(t,{width:393,height:852,items:[item(1,{decision:'remove',revision:1})],state:{exhausted:false}});if(!page)return;
 await measure(page,`root.getElementById('review').click();`);
 const done=await measure(page,`const done=root.getElementById('trash-done');done.hidden=false;return {parent:done.parentElement.id,ring:box(done.querySelector('svg')),button:box('#keep-swiping'),link:q('#open-trash').tagName,panel:box('#review-panel'),covers:box(done)};`);
 assert.equal(done.parent,'review-panel');
 assert.equal(Math.round(done.ring.width),72);
 assert.ok(done.button.height>=44);assert.equal(done.link,'A');
 assert.deepEqual(done.covers,done.panel);
});

test('a zoomed enlarged photo pans by mouse drag and shift-wheel without deciding, and Fit restores swiping',async t=>{
 const page=await mount(t,{width:1280,height:900,items:Array.from({length:3},(_,index)=>item(index)),state:{exhausted:false}});if(!page)return;
 const before=await measure(page,`return q('#caption').textContent;`);
 await measure(page,`root.getElementById('enlarge').click();`);await page.waitForTimeout(300);
 await measure(page,`const zoom=root.getElementById('zoom');zoom.value='2';zoom.oninput();`);
 const zoomed=await measure(page,`const media=q('#media');return {scroll:media.scrollWidth>media.clientWidth&&media.scrollHeight>media.clientHeight,left:media.scrollLeft,top:media.scrollTop,box:box(media),overflow:getComputedStyle(media).overflowX};`);
 assert.equal(zoomed.scroll,true);assert.equal(zoomed.overflow,'auto');
 assert.ok(zoomed.left>0,'zoom keeps the centre in view');
 const cx=zoomed.box.x+zoomed.box.width/2,cy=zoomed.box.y+zoomed.box.height/2;
 await page.mouse.move(cx,cy);await page.mouse.down();await page.mouse.move(cx+150,cy+80,{steps:5});await page.mouse.up();
 const dragged=await measure(page,`const media=q('#media');return {left:media.scrollLeft,top:media.scrollTop,caption:q('#caption').textContent};`);
 assert.ok(dragged.left<zoomed.left-100,`${zoomed.left} → ${dragged.left}`);assert.ok(dragged.top<zoomed.top-40);
 await page.mouse.move(cx,cy);await page.keyboard.down('Shift');await page.mouse.wheel(0,200);await page.keyboard.up('Shift');await page.waitForTimeout(100);
 assert.equal(await measure(page,`return root.getElementById('zoom').value;`),'2');
 assert.equal(dragged.caption,before);
 await measure(page,`const zoom=root.getElementById('zoom');zoom.value='1';zoom.oninput();`);
 assert.equal(await measure(page,`return q('#card').classList.contains('zoomed');`),false);
});

for(const reduced of [false,true])test(`the settings sheet ${reduced?'appears without motion':'slides up'} when opened${reduced?' with reduced motion':''}`,async t=>{
 if(!chromium){t.skip('Playwright is unavailable');return;}
 const page=await mount(t,{width:393,height:852,items:[item(1)],state:{exhausted:false}});if(!page)return;
 await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});
 await measure(page,`root.getElementById('settings').click();`);
 const sheet=await measure(page,`const sheet=q('#settings-sheet');return {hidden:sheet.hidden,animation:getComputedStyle(sheet).animationName};`);
 assert.equal(sheet.hidden,false);assert.equal(sheet.animation,reduced?'none':'ps-sheet-up');
});

test('every phone control has a touch target of at least 44 points on the swipe, Going to Trash and preview screens',async t=>{
 const page=await mount(t,{width:390,height:844,items:Array.from({length:6},(_,index)=>item(index,index<3?{decision:'remove',revision:1,lastDecisionAt:1000+index}:{})),state:{exhausted:true}});if(!page)return;
 const small=()=>measure(page,`const size=e=>{const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hits=(px,py)=>{const found=root.elementFromPoint(px,py);return !!found&&(found===e||e.contains(found));};const reach=(dx,dy)=>{let d=0;while(d<60&&hits(x+dx*(d+1),y+dy*(d+1)))d++;return d;};if(!hits(x,y))return [0,0];return [reach(-1,0)+reach(1,0)+1,reach(0,-1)+reach(0,1)+1];};
  return [...root.querySelectorAll('button,a,input')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&getComputedStyle(e).visibility!=='hidden';}).map(e=>({control:e.id||e.className||e.getAttribute('aria-label')||e.textContent.trim(),size:size(e)})).filter(entry=>entry.size.some(value=>value>0&&value<44));`);
 assert.deepEqual(await small(),[]);
 await measure(page,`root.getElementById('review').click();`);await page.waitForTimeout(500);
 assert.ok(await measure(page,`return root.querySelectorAll('.trash-check').length;`)>=3);
 assert.deepEqual(await small(),[]);
 assert.deepEqual(await measure(page,`return [...root.querySelectorAll('.trash-tile')].map(tile=>{const check=tile.querySelector('.trash-check'),r=tile.getBoundingClientRect(),c=check.getBoundingClientRect(),outside=[[r.right+1,c.y+c.height/2],[c.x+c.width/2,r.bottom+1]].filter(([x,y])=>x<innerWidth&&y<innerHeight);return outside.some(([x,y])=>{const found=root.elementFromPoint(x,y);return found===check||check.contains(found);});});`),[false,false,false]);
 await measure(page,`q('.trash-photo').click();`);await page.waitForTimeout(500);
 assert.ok(await measure(page,`return root.querySelectorAll('.trash-strip button').length;`)>=3);
 assert.deepEqual(await small(),[]);
});

const savedDecisions=async page=>{
 await page.waitForTimeout(2500);
 return page.evaluate(async()=>{const db=await new Promise(resolve=>{const request=indexedDB.open('photos-swipe-userscript');request.onsuccess=()=>resolve(request.result);});const entries=await new Promise(resolve=>{const found=[],request=db.transaction('accounts').objectStore('accounts').openCursor();request.onsuccess=()=>{const cursor=request.result;if(!cursor)return resolve(found);found.push([String(cursor.key),cursor.value]);cursor.continue();};});db.close();const meta=entries.find(([key,value])=>/^v2:[^:]+$/.test(key)&&value);const state=meta?{...meta[1],items:entries.filter(([key])=>key.startsWith(meta[0]+':')).sort(([a],[b])=>a<b?-1:1).flatMap(([,value])=>value)}:entries.find(([key,value])=>value&&Array.isArray(value.items))[1];return {decided:state.items.filter(entry=>entry.decision).length,history:state.history.length};});
};

for(const [keys,expected] of [[['ArrowLeft','z','ArrowRight','z','ArrowLeft','ArrowLeft','z','z'],0],[['ArrowLeft','ArrowRight','ArrowLeft','z','ArrowRight','ArrowLeft','z','z','ArrowRight'],3]])test(`back-to-back keyboard decisions and undos are applied in order (${keys.length} keys, ${expected} left)`,async t=>{
 const page=await mount(t,{width:1280,height:900,items:Array.from({length:8},(_,index)=>item(index))});if(!page)return;
 for(const key of keys)await page.keyboard.press(key);
 assert.deepEqual(await savedDecisions(page),{decided:expected,history:expected});
});

test('Going to Trash lists every item it counts, and the badge, button and confirmation agree',async t=>{
 const page=await mount(t,{width:1280,height:900,items:[
  ...[0,1,2].map(index=>item(index,{decision:'remove',revision:1,lastDecisionAt:1000+index})),
  item(3,{decision:'remove',revision:1,queueSent:true,lastDecisionAt:900}),
  item(4,{decision:'remove',revision:1,state:'in_trash'}),
  item(5,{decision:'keep',revision:1}),
  item(6),item(7)
 ]});if(!page)return;
 const prompts=[];page.on('dialog',dialog=>{prompts.push(dialog.message());dialog.dismiss();});
 const counts=()=>measure(page,`const tiles=[...root.querySelectorAll('.trash-tile')];return {badge:q('.trash-badge').textContent,listed:tiles.map(tile=>tile.querySelector('img').alt).sort(),marked:tiles.filter(tile=>!tile.classList.contains('kept')).length,button:root.getElementById('move-trash').textContent.trim()};`);
 await measure(page,`root.getElementById('review').click();`);await page.waitForTimeout(500);
 assert.deepEqual(await counts(),{badge:'4',listed:['synthetic-0.jpg','synthetic-1.jpg','synthetic-2.jpg','synthetic-3.jpg'],marked:4,button:'Move 4 to Trash'});
 await measure(page,`q('.trash-tile .trash-check').click();`);await page.waitForTimeout(300);
 assert.deepEqual(await counts(),{badge:'3',listed:['synthetic-0.jpg','synthetic-1.jpg','synthetic-2.jpg','synthetic-3.jpg'],marked:3,button:'Move 3 to Trash'});
 await measure(page,`root.getElementById('move-trash').click();`);await page.waitForTimeout(300);
 assert.equal(prompts.length,1);assert.match(prompts[0],/^Move exactly 3 items to Google Photos Trash\?/);
});

test('long status messages, including sticky errors, stay on one scrollable faded line in the fixed status slot, and the caption shows exactly two lines',async t=>{
 const long='a-very-long-synthetic-file-name-that-keeps-going-and-going-for-the-summer-holiday-final-final-v2.jpg';
 const page=await mount(t,{width:390,height:844,items:Array.from({length:3},(_,index)=>item(index,{name:`${index}-${long}`})),state:{exhausted:true}});if(!page)return;
 const status=()=>measure(page,`const status=q('#status'),style=getComputedStyle(status);return {text:status.textContent,title:status.title,sticky:status.classList.contains('toast-sticky'),height:status.getBoundingClientRect().height,overflowing:status.scrollWidth>status.clientWidth,scrollable:style.overflowX==='auto',faded:/gradient/.test(style.webkitMaskImage||style.maskImage),nowrap:style.whiteSpace==='nowrap',lines:status.scrollHeight/parseFloat(style.lineHeight)};`);
 await page.keyboard.press('ArrowLeft');await page.keyboard.press('z');
 await page.waitForFunction(()=>/^Last swipe undone for /.test(document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('status').textContent),null,{timeout:5000});
 const routine=await status();
 assert.equal(routine.sticky,false);assert.equal(routine.height,24);assert.equal(routine.nowrap,true);assert.equal(routine.overflowing,true);assert.equal(routine.scrollable,true);assert.equal(routine.faded,true);assert.ok(routine.lines<1.5,`one line (${routine.lines})`);assert.equal(routine.title,routine.text);
 const error='Move to Trash failed: Google Photos did not confirm 3 of 5 items. Nothing else was changed; tap Retry in Going to Trash to try again.';
 await measure(page,`const status=q('#status');status.textContent='';status.className='status';root.getElementById('trash').click();`);
 await page.waitForFunction(()=>document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('status').classList.contains('toast-sticky'),null,{timeout:5000});
 await measure(page,`const status=q('#status');status.textContent=${JSON.stringify(error)};status.title=status.textContent;`);
 const sticky=await status();
 assert.equal(sticky.height,24);assert.equal(sticky.nowrap,true);assert.equal(sticky.scrollable,true);assert.equal(sticky.faded,true);assert.ok(sticky.lines<1.5,`one line (${sticky.lines})`);assert.equal(sticky.title,error);
 const caption=await measure(page,`const caption=q('#caption'),style=getComputedStyle(caption);return {clamp:style.webkitLineClamp,lines:(caption.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom))/parseFloat(style.lineHeight),length:caption.textContent.length};`);
 assert.equal(caption.clamp,'2');assert.ok(caption.length>120);
 assert.ok(caption.lines<=2.01,`clamped caption leaves room for ${caption.lines.toFixed(2)} lines`);
});

for(const [width,height,touch,minCard] of [[393,852,true,300],[320,568,true,200],[320,480,true,100],[852,393,true,300],[1280,900,false,500],[800,600,false,120]])test(`the first-run sync prompt is a styled card that leaves the photo and controls visible at ${width}×${height}`,async t=>{
 const page=await mount(t,{width,height,touch,onboarding:true,items:Array.from({length:4},(_,index)=>item(index))});if(!page)return;
 const layout=await measure(page,`const o=q('#pair-onboarding'),style=getComputedStyle(o),overlap=(a,b)=>a.x<b.x+b.width-1&&b.x<a.x+a.width-1&&a.y<b.y+b.height-1&&b.y<a.y+a.height-1;return {visible:!o.hidden&&o.getClientRects().length>0,onb:box(o),content:box('.content'),card:box('#card'),caption:box('#caption'),actions:box('.actions'),background:style.backgroundColor,radius:parseFloat(style.borderTopLeftRadius),buttons:[...o.querySelectorAll('button')].map(b=>({text:b.textContent,box:box(b),background:getComputedStyle(b).backgroundColor,accent:getComputedStyle(q('.content')).getPropertyValue('--ps-accent').trim()})),overlaps:[q('#caption'),q('.actions')].filter(e=>overlap(box(o),box(e))).map(e=>e.id||e.className),scroll:document.scrollingElement.scrollHeight<=innerHeight};`);
 assert.ok(layout.visible);
 assert.notEqual(layout.background,'rgba(0, 0, 0, 0)');assert.ok(layout.radius>=12,String(layout.radius));
 assert.ok(layout.onb.x>=layout.content.x+4&&layout.onb.x+layout.onb.width<=layout.content.x+layout.content.width-4,JSON.stringify(layout.onb));
 assert.ok(layout.onb.y>=layout.content.y&&layout.onb.y+layout.onb.height<=layout.content.y+layout.content.height,JSON.stringify(layout.onb));
 assert.deepEqual(layout.buttons.map(b=>b.text),['Continue locally','Sign in with Google']);
 for(const button of layout.buttons)assert.ok(button.box.height>=44&&button.box.y+button.box.height<=height,JSON.stringify(button));
 assert.notEqual(layout.buttons[1].background,layout.buttons[0].background);
 assert.deepEqual(layout.overlaps,[]);
 assert.ok(layout.actions.y+layout.actions.height<=height,JSON.stringify(layout.actions));
 assert.ok(layout.card.height>=minCard,`card height ${layout.card.height}`);
 assert.ok(layout.scroll);
});

for(const [width,height,onboarding,all] of [[320,480,true,false],[320,568,true,true],[320,480,false,true],[375,667,true,true],[393,852,true,true]])test(`card buttons stay inside the card and clear of the first-run hint at ${width}×${height}${onboarding?' with the sync prompt':''}`,async t=>{
 const page=await mount(t,{width,height,touch:true,onboarding,items:Array.from({length:4},(_,index)=>item(index))});if(!page)return;
 const layout=await measure(page,`const overlap=(a,b)=>a.x<b.x+b.width-1&&b.x<a.x+a.width-1&&a.y<b.y+b.height-1&&b.y<a.y+a.height-1;const tools=['enlarge','open-photos','share'].map(id=>root.getElementById(id)).filter(e=>e.getClientRects().length);const labels=[...root.querySelectorAll('.coach .coach-arrows > *')].filter(e=>e.getClientRects().length);return {card:box('#card'),tools:tools.map(e=>({id:e.id,box:box(e)})),labels:labels.map(e=>box(e)),overlaps:tools.flatMap(e=>labels.filter(l=>overlap(box(e),box(l))).map(()=>e.id))};`);
 assert.ok(layout.labels.length===2,'the first-run hint is showing');
 assert.ok(layout.tools.some(tool=>tool.id==='enlarge'));
 if(all)assert.deepEqual(layout.tools.map(tool=>tool.id).sort(),['enlarge','open-photos','share']);
 for(const tool of layout.tools)assert.ok(tool.box.y>=layout.card.y&&tool.box.y+tool.box.height<=layout.card.y+layout.card.height,`${tool.id} ${JSON.stringify(tool.box)} in ${JSON.stringify(layout.card)}`);
 assert.deepEqual(layout.overlaps,[]);
});

test('the sync privacy disclosure uses the app vocabulary',async t=>{
 const page=await mount(t,{width:393,height:852,touch:true,onboarding:true,items:Array.from({length:3},(_,index)=>item(index))});if(!page)return;
 await measure(page,`root.getElementById('settings').click();`);await page.waitForTimeout(300);
 const text=await measure(page,`return q('.settings-sheet').textContent;`);
 assert.match(text,/Each Keep\/Delete decision, keyed by Google Photos' internal item ID/);
 assert.match(text,/Your review progress and undo history: for each photo you\u2019ve reviewed, its item ID/);
 assert.doesNotMatch(text,/review queue|Keep\/Remove/);
});

for(const [free,sentence] of [[1,'1 stored free, so it doesn\u2019t use storage'],[2,'2 stored free, so they don\u2019t use storage']])test(`Going to Trash says "${sentence}"`,async t=>{
 const page=await mount(t,{width:393,height:852,touch:true,items:Array.from({length:4},(_,index)=>item(index,index<3?{decision:'remove',revision:1,lastDecisionAt:1000+index,...(index<free?{takesUpSpace:false}:{})}:{}))});if(!page)return;
 await measure(page,`root.getElementById('review').click();`);await page.waitForTimeout(300);
 const subtitle=await measure(page,`return q('.trash-subtitle').textContent;`);
 assert.ok(subtitle.endsWith(` · ${sentence}`),subtitle);
});

for(const [marked,trashName] of [[0,'Going to Trash'],[1,'Going to Trash, 1 item'],[3,'Going to Trash, 3 items']])test(`controls are named after what they show, with ${marked} marked for deletion`,async t=>{
 const page=await mount(t,{width:393,height:852,touch:true,state:{exhausted:true},items:Array.from({length:5},(_,index)=>item(index,index<marked?{decision:'remove',revision:1,lastDecisionAt:1000+index}:{}))});if(!page)return;
 assert.equal(await page.getByRole('button',{name:trashName,exact:true}).count(),1);
 const order=page.locator('#order-switcher');
 assert.equal(await order.getAttribute('aria-label'),`Review order: ${(await order.innerText()).replace(/^\S+\s+/,'')}`);
 await measure(page,`root.getElementById('settings').click();`);await page.waitForTimeout(300);
 assert.equal(await page.getByRole('button',{name:'Done',exact:true}).count(),1);
 assert.equal(await page.getByRole('button',{name:'Close settings',exact:true}).count(),0);
});

for(const timezoneId of ['Asia/Tokyo','America/New_York'])test(`a photo taken on New Year's Eve in California shows that date to a viewer in ${timezoneId}`,async t=>{
 const page=await mount(t,{width:393,height:852,touch:true,timezoneId,state:{exhausted:true},items:[item(0,{name:'eve.jpg',date:'2026-01-01T07:30:00.000Z',timezoneOffset:-8*3600000,decision:'remove',revision:1,lastDecisionAt:1000}),item(1,{name:'eve.jpg',date:'2026-01-01T07:30:00.000Z',timezoneOffset:-8*3600000})]});if(!page)return;
 const shown=await measure(page,`return {caption:q('#caption').textContent,memory:q('.memory-label')?.textContent||''};`);
 assert.match(shown.caption,/^eve\.jpg · 12\/31\/2025 · /);
 if(shown.memory)assert.match(shown.memory,/^December 2025/);
 await measure(page,`root.getElementById('review').click();`);await page.waitForTimeout(300);
 await page.locator('.trash-tile [aria-label^="Preview "]').first().click();await page.waitForTimeout(300);
 assert.match(await measure(page,`return q('.trash-preview-caption small').textContent;`),/^12\/31\/2025/);
 await page.keyboard.press('Escape');await page.waitForTimeout(200);await page.keyboard.press('Escape');await page.waitForTimeout(300);
 await measure(page,`root.getElementById('share').click();`);await page.waitForTimeout(400);
 assert.match(await measure(page,`return q('.share-sub').textContent;`),/12\/31\/2025/);
});

for(const [marked,expected] of [[0,'back'],[2,'move-trash']])test(`opening Going to Trash from the keyboard with ${marked} marked moves focus into the panel`,async t=>{
 const page=await mount(t,{width:393,height:852,touch:true,state:{exhausted:true},items:Array.from({length:4},(_,index)=>item(index,index<marked?{decision:'remove',revision:1,lastDecisionAt:1000+index}:{}))});if(!page)return;
 await measure(page,`root.getElementById('review').focus();`);await page.keyboard.press('Enter');await page.waitForTimeout(300);
 const focus=await measure(page,`const e=root.activeElement,panel=root.getElementById('review-panel');return {open:!panel.hidden,inside:panel.contains(e),id:e?.id||'',text:e?.textContent?.trim()||''};`);
 assert.equal(focus.open,true);assert.equal(focus.inside,true,JSON.stringify(focus));
 if(expected==='back')assert.equal(focus.text,'\u2039 Back');else assert.equal(focus.id,'move-trash');
});

for(const marked of [0,2])test(`Going to Trash explains itself with ${marked} marked`,async t=>{
 const page=await mount(t,{width:393,height:852,touch:true,state:{exhausted:true},items:Array.from({length:4},(_,index)=>item(index,index<marked?{decision:'remove',revision:1,lastDecisionAt:1000+index}:{}))});if(!page)return;
 await measure(page,`root.getElementById('review').click();`);await page.waitForTimeout(300);
 const shown=await measure(page,`const p=root.getElementById('review-panel');return {sub:q('.trash-subtitle').textContent,help:q('.trash-help').textContent,selectAll:[...p.querySelectorAll('.trash-nav button')].some(b=>b.textContent==='Select All'&&b.getClientRects().length>0)};`);
 if(marked){assert.match(shown.sub,/^2 of 2 selected/);assert.match(shown.help,/^Tap a photo to preview/);assert.equal(shown.selectAll,true);}
 else{assert.equal(shown.sub,'Nothing marked for deletion');assert.match(shown.help,/^Swipe left or tap \u2715 to mark photos/);assert.equal(shown.selectAll,false);}
});

for(const how of ['keyboard','mouse'])test(`Esc with the order menu open (${how}) closes only the menu`,async t=>{
 const page=await mount(t,{width:1280,height:800,state:{exhausted:true},items:Array.from({length:4},(_,index)=>item(index))});if(!page)return;
 if(how==='keyboard'){await measure(page,`root.getElementById('order-switcher').focus();`);await page.keyboard.press('ArrowDown');}else await page.locator('#order-switcher').click({button:'right'});
 await page.waitForTimeout(200);
 assert.equal(await measure(page,`return !root.getElementById('order-menu').hidden;`),true);
 await page.keyboard.press('Escape');await page.waitForTimeout(200);
 assert.deepEqual(await measure(page,`return {overlay:!root.getElementById('overlay').hidden,menu:!root.getElementById('order-menu').hidden,focus:root.activeElement?.id};`),{overlay:true,menu:false,focus:'order-switcher'});
 await page.keyboard.press('Escape');await page.waitForTimeout(300);
 assert.equal(await measure(page,`return root.getElementById('overlay').hidden;`),true);
});

for(const how of ['Escape','Close'])test(`closing the share sheet with ${how} returns focus to Share`,async t=>{
 const page=await mount(t,{width:393,height:852,touch:true,state:{exhausted:true},items:Array.from({length:3},(_,index)=>item(index))});if(!page)return;
 await page.locator('#share').click();await page.waitForTimeout(400);
 assert.equal(await measure(page,`return !q('.share-sheet').hidden;`),true);
 if(how==='Escape')await page.keyboard.press('Escape');else await page.locator('.share-close').click();
 await page.waitForTimeout(300);
 assert.deepEqual(await measure(page,`return {sheet:q('.share-sheet').hidden,overlay:!root.getElementById('overlay').hidden,focus:root.activeElement?.id||null};`),{sheet:true,overlay:true,focus:'share'});
});

for(const how of ['Escape','Done'])test(`closing the Going to Trash preview with ${how} returns focus to that photo`,async t=>{
 const page=await mount(t,{width:393,height:852,touch:true,state:{exhausted:true},items:Array.from({length:4},(_,index)=>item(index,index<3?{decision:'remove',revision:1,lastDecisionAt:1000+index}:{}))});if(!page)return;
 await measure(page,`root.getElementById('review').click();`);await page.waitForTimeout(300);
 const tile=page.locator('.trash-tile [aria-label^="Preview "]').nth(1);const label=await tile.getAttribute('aria-label');
 await tile.focus();await page.keyboard.press('Enter');await page.waitForTimeout(300);
 assert.equal(await measure(page,`return !!q('.trash-preview');`),true);
 if(how==='Escape')await page.keyboard.press('Escape');else await page.locator('.trash-preview .trash-nav button',{hasText:'Done'}).click();
 await page.waitForTimeout(300);
 assert.deepEqual(await measure(page,`return {preview:!!q('.trash-preview'),panel:!root.getElementById('review-panel').hidden,focus:root.activeElement?.getAttribute('aria-label')||null};`),{preview:false,panel:true,focus:label});
});

test('the order menu works from the keyboard and arrow keys never decide the photo behind it',async t=>{
 const page=await mount(t,{width:1280,height:800,state:{exhausted:true},items:Array.from({length:6},(_,index)=>item(index))});if(!page)return;
 const state=()=>measure(page,`return {menu:!root.getElementById('order-menu').hidden,focus:root.activeElement?.textContent?.trim()||null,focusId:root.activeElement?.id||null,order:root.getElementById('order-switcher').textContent.trim(),caption:q('#caption').textContent,marked:q('#review .trash-badge').textContent};`);
 await measure(page,`root.getElementById('order-switcher').focus();`);
 await page.keyboard.press('ArrowDown');await page.waitForTimeout(150);
 const opened=await state();assert.equal(opened.menu,true);
 const labels=await measure(page,`return [...root.querySelectorAll('#order-menu button')].map(b=>b.textContent.trim());`);
 assert.equal(opened.focus,labels[0]);
 await page.keyboard.press('ArrowDown');await page.waitForTimeout(100);assert.equal((await state()).focus,labels[1]);
 await page.keyboard.press('End');await page.waitForTimeout(100);assert.equal((await state()).focus,labels.at(-1));
 await page.keyboard.press('ArrowDown');await page.waitForTimeout(100);assert.equal((await state()).focus,labels[0]);
 await page.keyboard.press('ArrowUp');await page.waitForTimeout(100);assert.equal((await state()).focus,labels.at(-1));
 for(const key of ['ArrowLeft','ArrowRight','z','f']){await page.keyboard.press(key);await page.waitForTimeout(150);}
 const after=await state();assert.equal(after.menu,true);assert.equal(after.caption,opened.caption);assert.equal(after.marked,opened.marked);
 await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await page.waitForTimeout(300);
 const chosen=await state();assert.equal(chosen.menu,false);assert.equal(chosen.order,labels[2]);assert.equal(chosen.focusId,'order-switcher');
 await page.keyboard.press('ArrowDown');await page.waitForTimeout(150);await page.keyboard.press('ArrowDown');await page.keyboard.press(' ');await page.waitForTimeout(300);
 const spaced=await state();assert.equal(spaced.menu,false);assert.equal(spaced.order,labels[1]);assert.equal(spaced.focusId,'order-switcher');
});

for(const how of ['Escape','button'])test(`leaving the enlarged view with ${how} resets the zoom so the card swipes again`,async t=>{
 const page=await mount(t,{width:1280,height:800,state:{exhausted:true},items:Array.from({length:4},(_,index)=>item(index))});if(!page)return;
 await page.keyboard.press('f');await page.waitForTimeout(400);
 const media=await page.locator('#media').boundingBox();await page.mouse.move(media.x+media.width/2,media.y+media.height/2);await page.mouse.wheel(0,-400);await page.waitForTimeout(300);
 assert.equal(await measure(page,`return q('#card').classList.contains('zoomed');`),true);
 if(how==='Escape')await page.keyboard.press('Escape');else await page.locator('#enlarge').click();
 await page.waitForTimeout(400);
 const shown=await measure(page,`const m=q('#media');return {expanded:q('#card').classList.contains('expanded'),zoomed:q('#card').classList.contains('zoomed'),scrolls:m.scrollWidth>m.clientWidth+1||m.scrollHeight>m.clientHeight+1,caption:q('#caption').textContent};`);
 assert.deepEqual([shown.expanded,shown.zoomed,shown.scrolls],[false,false,false]);
 const card=await page.locator('#card').boundingBox(),x=card.x+card.width/2,y=card.y+card.height/2;
 await page.mouse.move(x,y);await page.mouse.down();for(let step=1;step<=12;step++){await page.mouse.move(x+400*step/12,y);await page.waitForTimeout(16);}await page.mouse.up();await page.waitForTimeout(700);
 assert.notEqual(await measure(page,`return q('#caption').textContent;`),shown.caption);
});

for(const [width,height] of [[844,390],[1366,450]])test(`a short desktop window (${width}×${height}, no touch) puts the photo beside the controls`,async t=>{
 const page=await mount(t,{width,height,items:Array.from({length:4},(_,index)=>item(index)),state:{exhausted:false}});if(!page)return;
 const layout=await measure(page,`return {card:box('#card'),keep:box('#keep'),remove:box('#remove'),close:box('#close'),scroll:document.scrollingElement.scrollHeight<=innerHeight&&document.scrollingElement.scrollWidth<=innerWidth};`);
 assert.ok(layout.card.height>=300,`card height ${layout.card.height}`);
 for(const control of ['keep','remove','close']){assert.ok(layout[control].x>=layout.card.x+layout.card.width,control);assert.ok(layout[control].y+layout[control].height<=height,control);}
 assert.ok(layout.scroll);
});

test('a 600 px tall desktop window keeps the small window from #339',async t=>{
 const page=await mount(t,{width:1366,height:600,items:Array.from({length:4},(_,index)=>item(index)),state:{exhausted:false}});if(!page)return;
 const layout=await measure(page,`return {content:box('.content'),card:box('#card'),keep:box('#keep')};`);
 assert.ok(layout.content.width<=460,`content width ${layout.content.width}`);
 assert.ok(layout.keep.y>=layout.card.y+layout.card.height,'controls below the photo');
});

test('a phone held sideways puts the photo beside the controls instead of squeezing it',async t=>{
 const page=await mount(t,{width:852,height:393,touch:true,items:Array.from({length:4},(_,index)=>item(index)),state:{exhausted:false}});if(!page)return;
 const layout=await measure(page,`return {card:box('#card'),keep:box('#keep'),remove:box('#remove'),close:box('#close'),scroll:document.scrollingElement.scrollHeight<=innerHeight};`);
 assert.ok(layout.card.height>=300,`card height ${layout.card.height}`);assert.ok(layout.card.width>=500,`card width ${layout.card.width}`);
 for(const control of ['keep','remove','close']){assert.ok(layout[control].x>=layout.card.x+layout.card.width,control);assert.ok(layout[control].y+layout[control].height<=393,control);}
 assert.ok(layout.scroll);
 await measure(page,`root.getElementById('enlarge').click();`);await page.waitForTimeout(700);
 const full=await measure(page,`return box('#card');`);
 assert.ok(full.width>=840&&full.height>=380,JSON.stringify(full));
});

test('Enlarge takes the card fullscreen where the browser allows it and leaving fullscreen restores the card',async t=>{
 const page=await mount(t,{width:1280,height:800,items:Array.from({length:3},(_,index)=>item(index))});if(!page)return;
 await page.evaluate(()=>document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('enlarge').click());
 await page.waitForTimeout(700);
 const supported=await page.evaluate(()=>!!document.fullscreenEnabled);
 const entered=await measure(page,`return {expanded:q('#card').classList.contains('expanded'),fullscreen:root.fullscreenElement?.id||null,card:box('#card')};`);
 assert.equal(entered.expanded,true);
 if(supported){assert.equal(entered.fullscreen,'card');assert.ok(entered.card.width>=1270&&entered.card.height>=790,JSON.stringify(entered.card));
  await page.evaluate(()=>document.exitFullscreen());await page.waitForTimeout(500);
  assert.deepEqual(await measure(page,`return {expanded:q('#card').classList.contains('expanded'),fullscreen:root.fullscreenElement?.id||null};`),{expanded:false,fullscreen:null});}
});

test('Open in Google Photos links to the shown item and the Share sheet sends the photo itself',async t=>{
 const page=await mount(t,{width:393,height:852,items:[item(1,{takesUpSpace:false,spaceTaken:0}),item(2)]});if(!page)return;
 await page.evaluate(()=>{window.__shared=[];Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.__shared.push(data.files?data.files.map(file=>[file.name,file.size>0]):data.url);}});Object.defineProperty(navigator,'canShare',{configurable:true,value:data=>!!data.files});});
 const shown=await measure(page,`return {href:q('#open-photos').href,target:q('#open-photos').target,caption:q('#caption').textContent,share:box('#share'),open:box('#open-photos')};`);
 const key=/^(synthetic-\d+)/.exec(shown.caption)[1];
 assert.equal(shown.href,`https://photos.google.com/u/0/photo/${key}`);assert.equal(shown.target,'_blank');
 assert.equal(/stored free/.test(shown.caption),key==='synthetic-1');
 for(const control of ['share','open'])assert.ok(shown[control].width>=36&&shown[control].height>=36,control);
 await measure(page,`q('#share').click();`);
 await page.waitForFunction(()=>{const send=document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('share-send');return send&&!send.disabled;});
 await page.waitForTimeout(400);
 const sheet=await measure(page,`return {open:!q('.share-sheet').hidden,title:q('.share-title').textContent,send:q('#share-send .share-label').textContent,link:q('#share-link .share-label').textContent,box:box('.share-sheet')};`);
 assert.deepEqual({open:sheet.open,title:sheet.title,send:sheet.send,link:sheet.link},{open:true,title:`${key}.jpg`,send:'Send photo',link:'Create public link'});
 assert.ok(sheet.box.y+sheet.box.height<=852&&sheet.box.x>=0&&sheet.box.x+sheet.box.width<=393,JSON.stringify(sheet.box));
 await page.keyboard.press('ArrowLeft');
 assert.equal(await measure(page,`return q('#caption').textContent.startsWith('${key}');`),true,'arrow keys do not decide while the sheet is open');
 await measure(page,`q('#share-send').click();`);
 await page.waitForFunction(()=>window.__shared.length===1);
 assert.equal(JSON.stringify(await page.evaluate(()=>window.__shared)),JSON.stringify([[[`${key}.jpg`,true]]]));
 assert.equal(await measure(page,`return q('.share-sheet').hidden;`),true);
});

test('Create public link asks Google for a share link once and offers Copy and Share icons without pre-selecting the link',async t=>{
 const envelope=(id,data)=>`)]}'\n\n123\n${JSON.stringify([['wrb.fr','unrelated','[]'],['wrb.fr',id,JSON.stringify(data)]])}\n`;
 const calls=[];
 const page=await mount(t,{width:393,height:852,items:[item(1)],routes:(route,url)=>{if(url.hostname==='photos.google.com'&&url.pathname.endsWith('/data/batchexecute')){const call=JSON.parse(new URLSearchParams(route.request().postData()).get('f.req'))[0][0];calls.push(call);return route.fulfill({contentType:'text/plain',body:envelope(call[0],['AF1QipSyntheticSharedAlbum','https://photos.app.goo.gl/SyntheticLink1',null,null,'token',null,5,false,0])});}return null;}});if(!page)return;
 await page.evaluate(()=>{window.__shared=[];window.__copied=[];Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.__shared.push(data.url||'files');}});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copied.push(text);}}});});
 await measure(page,`q('#share').click();`);
 await measure(page,`q('#share-link').click();`);
 await page.waitForFunction(()=>!document.getElementById('photos-swipe-userscript-host').shadowRoot.querySelector('.share-link-row').hidden);
 assert.equal(await measure(page,`return q('.share-link-row input').value;`),'https://photos.app.goo.gl/SyntheticLink1');
 assert.equal(calls.length,1);assert.equal(calls[0][0],'SFKp8c');assert.match(calls[0][1],/\[\[\["synthetic-1"\]\]\]/);
 const row=await measure(page,`const field=q('.share-link-row input');const buttons=[...q('.share-link-row').querySelectorAll('button')];return {fieldFocused:root.activeElement===field,selected:field.selectionEnd-field.selectionStart,copyFocused:root.activeElement===buttons[0],buttons:buttons.map(button=>({label:button.getAttribute('aria-label'),text:button.textContent.trim(),icon:!!button.querySelector('svg'),box:box(button)}))};`);
 assert.equal(row.fieldFocused,false,'the link field is not focused, so iOS shows no selection callout over Copy');
 assert.equal(row.selected,0,'the link is not pre-selected');
 assert.equal(row.copyFocused,true);
 assert.deepEqual(row.buttons.map(button=>[button.label,button.text,button.icon]),[['Copy link','',true],['Share link','',true]]);
 for(const button of row.buttons)assert.ok(button.box.width>=44&&button.box.height>=44&&Math.abs(button.box.width-button.box.height)<1,JSON.stringify(button.box));
 await measure(page,`const buttons=q('.share-link-row').querySelectorAll('button');buttons[0].click();buttons[1].click();`);
 await page.waitForFunction(()=>window.__shared.length===1&&window.__copied.length===1);
 assert.deepEqual(await page.evaluate(()=>[window.__copied,window.__shared]),[['https://photos.app.goo.gl/SyntheticLink1'],['https://photos.app.goo.gl/SyntheticLink1']]);
 assert.equal(await measure(page,`return q('.share-link-row button').getAttribute('aria-label');`),'Copied');
 await measure(page,`q('.share-close').click();q('#share').click();`);
 assert.equal(await measure(page,`return [q('.share-link-row').hidden,q('#share-link').hidden];`).then(value=>JSON.stringify(value)),JSON.stringify([false,true]));
 assert.equal(calls.length,1,'reopening reuses the link instead of creating another album');
});
test('a large desktop window gives the photo most of the screen with the controls beside it',async t=>{
 const page=await mount(t,{width:1720,height:1297,items:Array.from({length:8},(_,index)=>item(index,index<6?{decision:'remove',revision:1,lastDecisionAt:1000+index}:{})),state:{exhausted:true}});if(!page)return;
 const layout=await measure(page,`return {card:box('#card'),keep:box('#keep'),close:box('#close'),caption:box('#caption'),scroll:document.scrollingElement.scrollHeight<=innerHeight};`);
 assert.ok(layout.card.width>=1200&&layout.card.height>=1100,JSON.stringify(layout.card));
 for(const control of ['keep','close','caption'])assert.ok(layout[control].x>=layout.card.x+layout.card.width,control);
 assert.ok(layout.scroll);
 await measure(page,`root.getElementById('review').click();`);await page.waitForTimeout(500);
 const review=await measure(page,`const tiles=[...root.querySelectorAll('.trash-tile')].map(tile=>box(tile));return {panel:box('#review-panel'),firstRow:tiles.filter(tile=>tile.y===tiles[0].y).length,tile:tiles[0]};`);
 assert.ok(review.panel.width>=1600,JSON.stringify(review.panel));assert.ok(review.firstRow>=6,String(review.firstRow));assert.ok(review.tile.width>=170,String(review.tile.width));
});

test('on a 3x phone the shown photo and the next one load at full screen density',async t=>{
 const requested=[];
 const page=await mount(t,{width:440,height:956,dpr:3,touch:true,items:Array.from({length:5},(_,index)=>item(index)),routes:(route,url)=>{if(url.hostname==='lh3.googleusercontent.com'){const size=/=w(\d+)-h(\d+)/.exec(url.pathname);if(size)requested.push([url.pathname.split('=')[0],+size[1],+size[2]]);}return null;}});if(!page)return;
 await page.waitForTimeout(1200);
 const shown=await measure(page,`const image=q('#media img'),card=q('#media');return {natural:image.naturalWidth,src:image.src,card:card.offsetWidth};`);
 assert.ok(shown.natural>=shown.card*3-2,JSON.stringify(shown));
 const key=new URL(shown.src).pathname.split('=')[0];
 assert.ok(requested.some(([path,width])=>path!==key&&width>=shown.card*3-2),'the next photo is fetched sharp ahead of time');
 await page.keyboard.press('ArrowRight');await page.waitForTimeout(80);
 const next=await measure(page,`const image=q('#media img');return {natural:image.naturalWidth,complete:image.complete};`);
 assert.ok(next.complete&&next.natural>=shown.card*3-2,JSON.stringify(next));
});

for(const [label,width,height,dpr,top] of [['a large 3x phone upgrades video to the original after 720p',440,956,3,'dv'],['a small 2x phone keeps video at 720p',375,667,2,'m22']])test(label,async t=>{
 const video=await readFile(new URL('fixtures/synthetic-video.webm',import.meta.url));
 const envelope=(id,data)=>`)]}'\n\n123\n${JSON.stringify([['wrb.fr','unrelated','[]'],['wrb.fr',id,JSON.stringify(data)]])}\n`;
 const page=await mount(t,{width,height,dpr,touch:true,state:{exhausted:true},items:[item(0,{type:'video',duration:8000})],routes:(route,url)=>{
  if(url.hostname==='photos.google.com'&&url.pathname.endsWith('/data/batchexecute')){const call=JSON.parse(new URLSearchParams(route.request().postData()).get('f.req'))[0][0];return route.fulfill({contentType:'text/plain',body:envelope(call[0],[[JSON.parse(call[1])[0],['https://lh3.googleusercontent.com/stream-'+JSON.parse(call[1])[0],800,600]],'https://video-downloads.googleusercontent.com/x'])});}
  if(url.hostname==='lh3.googleusercontent.com'&&url.pathname.startsWith('/stream-'))return fulfillVideo(route,video,'video/webm');
  return null;}});if(!page)return;
 await page.waitForFunction(top=>{const shown=document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('media').querySelector('video:not([hidden])');return shown&&(shown.currentSrc||shown.src).endsWith('='+top)&&shown.currentTime>0;},top,{timeout:15000});
 await page.waitForTimeout(1500);
 const final=await measure(page,`const shown=q('#media video:not([hidden])');return {src:(shown.currentSrc||shown.src).split('=').pop(),paused:shown.paused};`);
 assert.deepEqual(final,{src:top,paused:false});
});

test('a phone held sideways shows a full row of Going to Trash thumbnails and their ticks above the buttons',async t=>{
 const page=await mount(t,{width:750,height:342,touch:true,items:Array.from({length:6},(_,index)=>item(index,index<3?{decision:'remove',revision:1,lastDecisionAt:1000+index}:{})),state:{exhausted:true}});if(!page)return;
 await measure(page,`root.getElementById('review').click();`);await page.waitForTimeout(500);
 const layout=await measure(page,`const scroll=q('#review-panel .trash-scroll').getBoundingClientRect(),bar=q('#review-panel .trash-bar').getBoundingClientRect();return {scrollBottom:scroll.bottom,barTop:bar.top,tiles:[...root.querySelectorAll('#trash-review-grid .trash-tile')].map(tile=>({tile:tile.getBoundingClientRect().bottom,check:tile.querySelector('.trash-check').getBoundingClientRect().bottom}))};`);
 assert.equal(layout.tiles.length,3);
 for(const {tile,check} of layout.tiles){assert.ok(tile<=layout.scrollBottom&&tile<=layout.barTop,`thumbnail bottom ${tile} is hidden behind the buttons at ${layout.barTop}`);assert.ok(check<=layout.barTop);}
});

for(const [width,height] of [[1366,600],[750,342]])test(`a short window puts the video controls on one row so the picture keeps its height at ${width}×${height}`,async t=>{
 const video=await readFile(new URL('fixtures/synthetic-video.webm',import.meta.url));
 const envelope=(id,data)=>`)]}'\n\n123\n${JSON.stringify([['wrb.fr','unrelated','[]'],['wrb.fr',id,JSON.stringify(data)]])}\n`;
 const page=await mount(t,{width,height,touch:width<760,state:{exhausted:true},items:[item(0,{type:'video',duration:8000})],routes:(route,url)=>{
  if(url.hostname==='photos.google.com'&&url.pathname.endsWith('/data/batchexecute')){const call=JSON.parse(new URLSearchParams(route.request().postData()).get('f.req'))[0][0];return route.fulfill({contentType:'text/plain',body:envelope(call[0],[[JSON.parse(call[1])[0],['https://lh3.googleusercontent.com/stream-'+JSON.parse(call[1])[0],800,600]],'https://video-downloads.googleusercontent.com/x'])});}
  if(url.hostname==='lh3.googleusercontent.com'&&url.pathname.startsWith('/stream-'))return fulfillVideo(route,video,'video/webm');
  return null;}});if(!page)return;
 await page.waitForFunction(()=>{const video=document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('media').querySelector('video:not([hidden])');return !!video&&video.videoWidth>0&&!!document.getElementById('photos-swipe-userscript-host').shadowRoot.querySelector('#media>[data-video-control=seek]');},null,{timeout:15000});
 const layout=await measure(page,`const media=q('#media').getBoundingClientRect(),video=q('#media video:not([hidden])').getBoundingClientRect(),controls=Object.fromEntries([...q('#media').querySelectorAll('[data-video-control]')].filter(e=>!e.hidden).map(e=>{const r=e.getBoundingClientRect();return [e.dataset.videoControl,{left:r.left,right:r.right,top:r.top,bottom:r.bottom,middle:r.top+r.height/2}];}));return {media:{top:media.top,bottom:media.bottom,left:media.left,right:media.right},video:{bottom:video.bottom},controls};`);
 const {play,seek,time,mute}=layout.controls;
 assert.ok(layout.media.bottom-layout.video.bottom<=60,`the controls take ${layout.media.bottom-layout.video.bottom}px under the picture`);
 for(const control of [seek,time,mute])assert.ok(Math.abs(control.middle-play.middle)<=6,'the controls share one row');
 assert.ok(play.right<=seek.left&&seek.right<=time.left&&time.right<=mute.left,'the controls do not overlap');
 assert.ok(seek.bottom-seek.top>=44,`the timeline is a ${seek.bottom-seek.top}px touch target`);
 for(const control of [play,seek,time,mute])assert.ok(control.left>=layout.media.left&&control.right<=layout.media.right&&control.bottom<=layout.media.bottom+1);
});

test('with data saver on, a 3x phone keeps the card-sized photos and never fetches the full-density ones',async t=>{
 const requested=[];
 const page=await mount(t,{width:440,height:956,dpr:3,touch:true,init:()=>Object.defineProperty(navigator,'connection',{configurable:true,value:{saveData:true,effectiveType:'4g'}}),items:Array.from({length:5},(_,index)=>item(index)),routes:(route,url)=>{if(url.hostname==='lh3.googleusercontent.com'){const size=/=w(\d+)-h(\d+)/.exec(url.pathname);if(size)requested.push([url.pathname.split('=')[0],+size[1],+size[2]]);}return null;}});if(!page)return;
 await page.waitForTimeout(1200);
 const shown=await measure(page,`const image=q('#media img'),card=q('#media');return {natural:image.naturalWidth,card:card.offsetWidth,sharp:image.dataset.sharp||null};`);
 assert.ok(shown.natural>0);assert.equal(shown.sharp,null,'the shown photo was swapped for its full-density version');
 await page.keyboard.press('ArrowRight');await page.waitForTimeout(800);
 assert.deepEqual(requested.filter(([,width])=>width>=shown.card*3-2),[],'a full-density photo was requested with data saver on');
});

for(const scheme of ['light','dark'])test(`dragging the enlarged card on iPhone reveals the next photo in ${scheme} instead of black`,async t=>{
 const colors=['#c0392b','#2e86de','#27ae60'];
 const page=await mount(t,{width:393,height:852,scheme,items:Array.from({length:3},(_,index)=>item(index)),init:()=>{for(const target of [Element.prototype,HTMLElement.prototype])for(const name of ['requestFullscreen','webkitRequestFullscreen'])delete target[name];for(const name of ['fullscreenEnabled','webkitFullscreenEnabled'])Object.defineProperty(document,name,{configurable:true,get:()=>false});},routes:(route,url)=>{const index=/synthetic-(\d+)/.exec(url.pathname)?.[1];return url.hostname==='lh3.googleusercontent.com'&&index!==undefined?route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="1600" height="1200" fill="${colors[index]}"/></svg>`}):null;}});if(!page)return;
 await measure(page,`q('#enlarge').click();`);await page.waitForTimeout(500);
 const shown=await measure(page,`return {expanded:q('#card').classList.contains('expanded'),fullscreen:!!(root.fullscreenElement||document.fullscreenElement),caption:q('#caption').textContent,background:getComputedStyle(q('#card')).backgroundColor,surface:getComputedStyle(q('#media')).backgroundColor};`);
 assert.deepEqual([shown.expanded,shown.fullscreen],[true,false]);
 assert.notEqual(shown.background,'rgb(0, 0, 0)');assert.equal(shown.background,shown.surface);
 await page.waitForFunction(()=>{const image=document.getElementById('photos-swipe-userscript-host').shadowRoot.querySelector('#next-card img');return image&&image.complete&&image.naturalWidth>0;});
 const media=await page.locator('#media').boundingBox(),x=media.x+media.width/2,y=media.y+media.height/2;
 await page.mouse.move(x,y);await page.mouse.down();for(let step=1;step<=6;step++){await page.mouse.move(x+150*step/6,y);await page.waitForTimeout(16);}
 await page.waitForTimeout(100);
 const dragged=await measure(page,`const under=q('#next-card'),top=q('.top-card').getBoundingClientRect(),area=under.getBoundingClientRect(),style=getComputedStyle(under),gap={x:top.left/2,y:top.top+top.height/2};return {current:/^(synthetic-\\d+)/.exec(q('#caption').textContent)[1],next:under.querySelector('img')?.dataset.key,hidden:under.hidden,display:style.display,visibility:style.visibility,opacity:Number(style.opacity),moved:top.left>40,covers:area.left<=gap.x&&area.right>=gap.x&&area.top<=gap.y&&area.bottom>=gap.y};`);
 await page.mouse.up();
 assert.ok(dragged.moved,'the card follows the drag');
 assert.ok(dragged.next&&dragged.next!==dragged.current,JSON.stringify(dragged));
 assert.deepEqual({hidden:dragged.hidden,display:dragged.display==='none',visibility:dragged.visibility,covers:dragged.covers},{hidden:false,display:false,visibility:'visible',covers:true});
 assert.ok(dragged.opacity>0);
});
