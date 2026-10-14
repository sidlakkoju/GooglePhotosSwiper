import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {emptyReview} from '../lib/userscript-core.mjs';

let chromium;
try{const playwright=await import('playwright');chromium=playwright[process.env.PS_ENGINE||'chromium'];}catch{}
const item=(index,extra={})=>({mediaKey:`synthetic-${index}`,name:`synthetic-${index}.jpg`,date:new Date(2020,0,1+index).toISOString(),size:2e7,thumbUrl:`https://lh3.googleusercontent.com/synthetic-${index}`,type:'photo',state:'active',decision:null,revision:0,urlFetchedAt:Date.now(),...extra});

async function mount(t,{width,height,items,state={},scheme='light'}){
 if(!chromium){t.skip('Playwright is unavailable');return null;}
 const browser=await chromium.launch({headless:true});
 t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width,height},colorScheme:scheme});
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.hostname==='photos-swipe.test')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'});
  if(url.hostname==='lh3.googleusercontent.com')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="1600" height="1200" fill="#3a7"/></svg>'});
  return route.abort();
 });
 await page.goto('https://photos-swipe.test');
 await page.evaluate(async review=>{
  window.WIZ_global_data={SNlM0e:'synthetic-token',oPEP7c:'synthetic@example.test',eptZe:'/_/PhotosUi/u/0/'};
  const account=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(window.WIZ_global_data.oPEP7c))),byte=>byte.toString(16).padStart(2,'0')).join('');
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('photos-swipe-userscript',2);request.onupgradeneeded=()=>{for(const name of ['accounts','leases','settings'])request.result.createObjectStore(name);};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  await new Promise((resolve,reject)=>{const tx=db.transaction(['accounts','settings'],'readwrite');tx.objectStore('accounts').put(review,account);tx.objectStore('settings').put({onboardingDismissed:true},'sync');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
 },{...emptyReview(),revision:1,started:true,exhausted:true,...state,items});
 const source=(await readFile(new URL('../userscript/photoswiper-app.user.js',import.meta.url),'utf8')).replace('document,location,GM:',"document,location:{origin:'https://photos.google.com',pathname:'/u/0/'},GM:");
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
 assert.ok(after.card.height>before.height+80,`${before.height} → ${after.card.height}`);
 if(width>600)assert.ok(after.card.width>before.width*2,`${before.width} → ${after.card.width}`);
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
