import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {Script} from 'node:vm';

const source=await readFile(new URL('../lib/userscript-ui.mjs',import.meta.url),'utf8');
const counterSource=(await readFile(new URL('../lib/userscript-counter.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const orderSource=(await readFile(new URL('../lib/userscript-order.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const setup=orderSource+source.slice(source.indexOf(" const host=document.createElement('div');"),source.indexOf(' const $=id=>root.getElementById(id);'));
test('mobile layout setup parses as a classic browser script',()=>{
 assert.doesNotThrow(()=>new Script(counterSource+setup));
});

const chrome=['google-chrome','chromium','chromium-browser','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(command=>spawnSync(command,['--version']).status===0);
const probe=chrome&&spawnSync(chrome,['--headless','--no-sandbox','--disable-gpu','--dump-dom','about:blank'],{encoding:'utf8',timeout:10000});

test('userscript status keeps a bounded layout slot even when empty',()=>{
 assert.match(source,/\.status:empty\{visibility:hidden\}/);
 assert.match(source,/\.status\{position:relative;height:60px;min-height:60px;overflow:auto;margin:0/);
 assert.match(source,/\.counter\{[^}]*white-space:nowrap/);
});

test('settings Done uses a capsule while main header icons stay circular',()=>{
 assert.match(source,/\.content > header button\{position:relative;width:36px;height:36px;min-height:36px;padding:8px;border-radius:50%;flex:none\}/);
 assert.doesNotMatch(source,/\.content header button\{[^}]*width:36px/);
 assert.match(source,/\.content \.settings-header button\{position:relative;width:auto;min-width:44px;height:36px;min-height:36px;padding:0 14px;border-radius:18px\}/);
});

test('generated settings Done and main header icons have 44 by 44 hit areas while the icons stay 36px circles',async()=>{
 const bundle=await readFile(new URL('../userscript/photoswiper-app.user.js',import.meta.url),'utf8');
 const declarations=selector=>Object.fromEntries(bundle.match(new RegExp(selector+'\\{([^}]+)\\}'))[1].split(';').map(declaration=>declaration.split(':')));
 const pill=declarations('\\.content \\.settings-header button');
 const hitArea=declarations('\\.content \\.settings-header button::before');
 const icons=declarations('\\.content > header button');
 assert.equal(pill.position,'relative');
 assert.equal(pill.height,'36px');
 assert.equal(pill['min-height'],'36px');
 assert.equal(pill.padding,'0 14px');
 assert.equal(pill['border-radius'],'18px');
 assert.equal(hitArea.content,'""');
 assert.equal(hitArea.position,'absolute');
 assert.equal(hitArea.background,'transparent');
 const expansion=-2*parseFloat(hitArea.inset);
 assert.ok(parseFloat(pill.height)+expansion>=44);
 assert.ok(parseFloat(pill['min-width'])+expansion>=44);
 assert.equal(icons.width,'36px');
 assert.equal(icons.height,'36px');
 assert.equal(icons['min-height'],'36px');
 assert.equal(icons.padding,'8px');
 assert.equal(icons['border-radius'],'50%');
 const iconHitArea=declarations('\\.content > header button::before,#enlarge::before');
 assert.equal(iconHitArea.background,'transparent');
 assert.ok(parseFloat(icons.height)-2*parseFloat(iconHitArea.inset)>=44);
});

test('iPhone capsule stays centered without clipping and status updates do not add window scrolling',{skip:!chrome||probe.status!==0},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'userscript-mobile-'));
 try{
  const page=join(dir,'layout.html');
  await writeFile(page,`<!doctype html><html><body><script>
  const environment={version:'test'};
  const createPairingModal=()=>({open(){}});
  ${counterSource}
  ${setup}
  overlayElement.hidden=false;
  storageCapsule.update(1.24e9);
  reviewButton.textContent='🗑 0';
  const rect=element=>element.getBoundingClientRect();
  const snapshot=()=>({height:rect(divElement4).height,scrollHeight:divElement4.scrollHeight,clientHeight:divElement4.clientHeight,outerScroll:overlayElement.scrollHeight,outerHeight:overlayElement.clientHeight});
  const before=snapshot();
  const capsule=counter.querySelector('.sv-value');
  const results={width:innerWidth,height:innerHeight,countLabel:capsule.dataset.text,headerHeight:rect(headerElement5).height,counterCentered:Math.abs((rect(capsule).left+rect(capsule).right)/2-(rect(headerElement5).left+rect(headerElement5).right)/2)<1,countUnclipped:rect(capsule).left>=rect(gear).right&&rect(capsule).right<=rect(reviewButton).left,headerInside:rect(closeElement).right<=rect(divElement4).right,noInitialScroll:before.scrollHeight===before.clientHeight&&before.outerScroll===before.outerHeight};
  for(const [name,value] of Object.entries({short:'Saved locally',long:'Local save failed. '+('Please retry after checking your connection. '.repeat(30)),empty:''})){
   statusElement.textContent=value;
   const after=snapshot();
   results[name+'Stable']=JSON.stringify(after)===JSON.stringify(before);
   if(name==='long')results.longReadable=statusElement.scrollWidth>statusElement.clientWidth&&getComputedStyle(statusElement).overflowX==='auto'&&statusElement.scrollHeight<=statusElement.clientHeight+4;
  }
  document.body.replaceChildren(Object.assign(document.createElement('pre'),{textContent:JSON.stringify(results)}));
  </script></body></html>`);
  for(const [width,height] of [[393,852],[320,568],[1280,900]]){
   const frame=join(dir,'frame.html');
   await writeFile(frame,`<!doctype html><iframe style="border:0;width:${width}px;height:${height}px" src="file://${page}"></iframe><script>document.querySelector('iframe').onload=event=>document.body.replaceChildren(Object.assign(document.createElement('pre'),{textContent:event.target.contentDocument.querySelector('pre').textContent}));</script>`);
   const result=spawnSync(chrome,['--headless','--no-sandbox','--disable-gpu','--allow-file-access-from-files','--virtual-time-budget=1000','--dump-dom',`file://${frame}`],{encoding:'utf8',timeout:30000});
   assert.equal(result.status,0,result.stderr);
   const values=JSON.parse(result.stdout.match(/<pre>(.*?)<\/pre>/s)[1]);
   assert.equal(values.width,width);assert.equal(values.height,height);assert.equal(values.countLabel,'1.24 GB');assert.equal(values.headerHeight,56);assert.equal(values.counterCentered,true);
   for(const [name,value] of Object.entries(values).filter(([name])=>!['width','height','countLabel','headerHeight','noInitialScroll','countUnclipped'].includes(name)))assert.equal(value,true,`${width}×${height}: ${name}`);
   if(width===393){assert.equal(values.noInitialScroll,true);assert.equal(values.countUnclipped,true);}
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('decision controls and status fit short viewports with Enlarge on and off',{skip:!chrome||probe.status!==0},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'userscript-enlarge-'));
 try{
  const page=join(dir,'layout.html');
  await writeFile(page,`<!doctype html><html><body><script>
   const environment={version:'test'};
   const createPairingModal=()=>({open(){}});
   ${counterSource}
   ${setup}
   overlayElement.hidden=false;
   storageCapsule.update(1.24e9);
   const image=document.createElement('img');
   image.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="1600" height="1200" fill="blue"/></svg>');
   root.getElementById('media').append(image);
   const bounds=element=>{const r=element.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
   const snapshots=[];
   for(const expanded of [false,true]){
    cardElement.classList.toggle('expanded',expanded);
    for(const message of ['', 'Saved locally', 'Synthetic status '.repeat(100)]){
     statusElement.textContent=message;
     snapshots.push({expanded,message,status:bounds(statusElement),controls:['remove','undo','keep'].map(id=>bounds(root.getElementById(id))),enlarge:bounds(root.getElementById('enlarge')),media:bounds(root.getElementById('media')),scrollHeight:divElement4.scrollHeight,clientHeight:divElement4.clientHeight});
    }
   }
   document.body.replaceChildren(Object.assign(document.createElement('pre'),{textContent:JSON.stringify({width:innerWidth,height:innerHeight,snapshots})}));
  </script></body></html>`);
  for(const [width,height] of [[1280,600],[1280,800],[1440,900],[1280,400],[390,844],[390,600],[320,400]]){
   const frame=join(dir,'frame.html');
   await writeFile(frame,`<!doctype html><iframe style="border:0;width:${width}px;height:${height}px" src="file://${page}"></iframe><script>document.querySelector('iframe').onload=event=>document.body.replaceChildren(Object.assign(document.createElement('pre'),{textContent:event.target.contentDocument.querySelector('pre').textContent}));</script>`);
   const result=spawnSync(chrome,['--headless','--no-sandbox','--disable-gpu','--allow-file-access-from-files','--virtual-time-budget=1000','--dump-dom',`file://${frame}`],{encoding:'utf8',timeout:30000});
   assert.equal(result.status,0,result.stderr);
   const values=JSON.parse(result.stdout.match(/<pre>(.*?)<\/pre>/s)[1]);
   assert.equal(values.width,width);assert.equal(values.height,height);
   for(const snapshot of values.snapshots){
    const label=`${width}×${height}, expanded=${snapshot.expanded}`;
    for(const rect of [...snapshot.controls,snapshot.status]){
     assert.ok(rect.left>=0&&rect.top>=0&&rect.right<=width&&rect.bottom<=height,label+': inside viewport');
     assert.ok(rect.width>0&&rect.height>0,label+': visible');
    }
    for(const control of snapshot.controls)assert.ok(snapshot.status.bottom<=control.top,label+': status above controls');const apart=(a,b)=>a.bottom<=b.top||b.bottom<=a.top||a.right<=b.left||b.right<=a.left;assert.ok(apart(snapshot.enlarge,snapshot.status),label+': fullscreen clear of status');
    assert.ok(snapshot.media.height>0,label+': media visible');assert.ok(apart(snapshot.media,snapshot.status),label+': media clear of status');
    assert.equal(snapshot.scrollHeight,snapshot.clientHeight,label+': no shell scrolling');
   }
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('settings header keeps Done visible and clickable while the sheet scrolls',{skip:!chrome||probe.status!==0},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'userscript-settings-'));
 try{
  const page=join(dir,'layout.html');
  await writeFile(page,`<!doctype html><html><body><script>
   const environment={version:'test'};
   const createPairingModal=()=>({open(){}});
   ${counterSource}
   ${setup}
   overlayElement.hidden=false;
   gear.click();
   const rect=element=>element.getBoundingClientRect();
   const doneStyle=getComputedStyle(sheetClose);
   const label=document.createRange();label.selectNodeContents(sheetClose);
   const textBounds=label.getBoundingClientRect(),doneBounds=rect(sheetClose);
   const capsule=doneBounds.width>36&&doneBounds.height===36&&doneStyle.minWidth==='44px'&&doneStyle.borderRadius==='18px'&&doneStyle.paddingLeft==='14px'&&doneStyle.paddingRight==='14px'&&textBounds.left>=doneBounds.left+14&&textBounds.right<=doneBounds.right-14;
   const circularIcons=[gear,closeElement].every(button=>rect(button).width===36&&rect(button).height===36&&getComputedStyle(button).borderRadius==='50%');
   const initialTop=rect(sheetClose).top;
   const initialContentTop=rect(settingsPanel).top;
   const hitStyle=getComputedStyle(sheetClose,'::before');
   const hitHeight=doneBounds.height-parseFloat(hitStyle.top)-parseFloat(hitStyle.bottom);
   const hitWidth=doneBounds.width-parseFloat(hitStyle.left)-parseFloat(hitStyle.right);
   const expandedTargetClickable=[doneBounds.top-3,doneBounds.bottom+3].every(y=>root.elementFromPoint(doneBounds.left+doneBounds.width/2,y)===sheetClose);
   const results={capsule,circularIcons,hitAreaLargeEnough:hitHeight>=44&&hitWidth>=44,expandedTargetClickable,headerContainsDone:sheetClose.parentElement===sheetHeader,headerContainsTitle:sheetTitle.parentElement===sheetHeader,sticky:getComputedStyle(sheetHeader).position==='sticky',snapshots:[]};
   for(const fraction of [0.5,1]){
    sheet.scrollTop=(sheet.scrollHeight-sheet.clientHeight)*fraction;
    const button=rect(sheetClose),header=rect(sheetHeader),bounds=rect(sheet);
    results.snapshots.push({scrolled:sheet.scrollTop>0,contentMoved:rect(settingsPanel).top<initialContentTop,stable:Math.abs(button.top-initialTop)<1,inside:button.top>=bounds.top&&button.bottom<=bounds.bottom&&button.left>=bounds.left&&button.right<=bounds.right,inViewport:button.top>=0&&button.bottom<=innerHeight,aboveContent:header.top===bounds.top,clickable:root.elementFromPoint(button.left+button.width/2,button.top+button.height/2)===sheetClose});
   }
   sheetClose.click();
   results.closed=sheet.hidden;
   results.focusReturned=root.activeElement===gear;
   document.body.replaceChildren(Object.assign(document.createElement('pre'),{textContent:JSON.stringify(results)}));
  </script></body></html>`);
  for(const [width,height] of [[1280,800],[390,844],[393,852],[320,568]])for(const dark of [false,true]){
   const frame=join(dir,'frame.html');
   await writeFile(frame,`<!doctype html><iframe style="border:0;width:${width}px;height:${height}px" src="file://${page}"></iframe><script>document.querySelector('iframe').onload=event=>document.body.replaceChildren(Object.assign(document.createElement('pre'),{textContent:event.target.contentDocument.querySelector('pre').textContent}));</script>`);
   const result=spawnSync(chrome,['--headless','--no-sandbox','--disable-gpu','--allow-file-access-from-files',...(dark?['--force-dark-mode']:['--blink-settings=preferredColorScheme=1']),'--virtual-time-budget=1000','--dump-dom',`file://${frame}`],{encoding:'utf8',timeout:30000});
   assert.equal(result.status,0,result.stderr);
   const values=JSON.parse(result.stdout.match(/<pre>(.*?)<\/pre>/s)[1]);
   const {snapshots,...checks}=values;
   for(const snapshot of [checks,...snapshots])for(const [name,value] of Object.entries(snapshot))assert.equal(value,true,`${width}×${height}, dark=${dark}: ${name}`);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('phone fullscreen locks and restores page styles, viewport and scroll',{skip:!chrome||probe.status!==0},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'userscript-scroll-lock-'));
 try{
  const page=join(dir,'lock.html');
  await writeFile(page,`<!doctype html><html style="overflow:auto"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:pink"><div style="height:3000px"></div><script>
  const environment={version:'test'},createPairingModal=()=>({open(){}});
  ${counterSource}
  ${setup}
  scrollTo(0,180);const before={html:document.documentElement.style.cssText,body:document.body.style.cssText,viewport:document.querySelector('meta[name=viewport]').content,y:scrollY};
  overlayElement.hidden=false;lockPage();lockPage();
  const locked={html:document.documentElement.style.overflow,body:document.body.style.overflow,overscroll:document.body.style.overscrollBehavior,position:document.body.style.position,top:document.body.style.top,viewport:document.querySelector('meta[name=viewport]').content};
  unlockPage();unlockPage();const after={html:document.documentElement.style.cssText,body:document.body.style.cssText,viewport:document.querySelector('meta[name=viewport]').content,y:scrollY};
  document.querySelector('meta[name=viewport]').remove();lockPage();const added=document.querySelector('meta[name=viewport]').content;unlockPage();const removed=!document.querySelector('meta[name=viewport]');
  document.body.replaceChildren(Object.assign(document.createElement('pre'),{textContent:JSON.stringify({before,locked,after,added,removed})}));
  </script></body></html>`);
  const result=spawnSync(chrome,['--headless','--no-sandbox','--disable-gpu','--allow-file-access-from-files','--window-size=393,852','--dump-dom',`file://${page}`],{encoding:'utf8',timeout:30000});assert.equal(result.status,0,result.stderr);
  const values=JSON.parse(result.stdout.match(/<pre>(.*?)<\/pre>/s)[1]);assert.equal(values.before.y,180);assert.deepEqual(values.after,values.before);assert.equal(values.locked.html,'hidden');assert.equal(values.locked.body,'hidden');assert.equal(values.locked.overscroll,'none');assert.equal(values.locked.position,'fixed');assert.equal(values.locked.top,'-180px');assert.match(values.locked.viewport,/viewport-fit=cover/);assert.match(values.added,/viewport-fit=cover/);assert.equal(values.removed,true);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('Going to Trash grid and preview fit phone and desktop in both themes',{skip:!chrome||probe.status!==0},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'userscript-trash-layout-'));
 try{
  const methods=source.slice(source.indexOf(' function reviewRows()'),source.indexOf(' function renderLists()'));
  const page=join(dir,'review.html');
  await writeFile(page,`<!doctype html><html><body><script>
   const environment={version:'test'},createPairingModal=()=>({open(){}});
   ${counterSource}
   ${setup}
   const $=id=>root.getElementById(id),swipeFeedback={reset(){}};
   let busy=false,identity={},leaseError=null,state={items:Array.from({length:6},(_,index)=>({mediaKey:'fixture-'+index,name:'IMG_'+index+'.JPG',type:index===2?'video':'photo',duration:14000,decision:index===1?'keep':'remove',queueSent:index===4,state:'active',thumbUrl:'synthetic'}))};
   const mediaURL=()=> 'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#436887"/></svg>');
   const previewSource=mediaURL;
   const thumbnails={bind:(image,item,source)=>{image.src=source(item);},resolve:async item=>item};
   const estimate=()=> '96.4 MB',itemSize=()=> '4.1 MB',previewSize=()=>({}),message=()=>{},reviewTrashCandidates=state=>state.items;
   const apply=next=>{state=next;renderTrashReview();},decideReview=(state,key,decision)=>({...state,items:state.items.map(item=>item.mediaKey===key?{...item,decision}:item)});
   ${methods}
   overlayElement.hidden=false;openReview();
   const bounds=element=>{const r=element.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
   const title=bounds(reviewHeading),panel=bounds(reviewPanel),tiles=Array.from(reviewGrid.children).map(bounds),bar=bounds(reviewBar);
   const result={titleVisible:title.width>100&&title.height>=30,panel,gridThree:tiles[0].top===tiles[1].top&&tiles[1].top===tiles[2].top&&(innerWidth>=900&&innerHeight>=700||tiles[3].top>tiles[0].top),square:tiles.every(tile=>Math.abs(tile.width-tile.height)<1),barInside:bar.bottom<=innerHeight&&bar.top>=0,keptFaded:getComputedStyle(reviewGrid.children[1].firstChild).opacity==='0.45',gridScrollable:getComputedStyle(reviewScroll).overflowY==='auto'};
   previewKey='fixture-0';renderTrashReview();const preview=root.getElementById('trash-preview'),image=bounds(preview.querySelector('.trash-preview-media')),previewBar=bounds(preview.querySelector('.trash-bar'));
   result.previewFits=image.height>0&&image.bottom<=previewBar.top&&previewBar.bottom<=innerHeight;result.previewCount=preview.querySelector('.trash-nav').children[1].textContent;result.theme=getComputedStyle(reviewPanel).backgroundColor;
   const output=document.createElement('pre');output.hidden=true;output.textContent=JSON.stringify(result);document.body.append(output);
  </script></body></html>`);
  for(const [width,height] of [[393,852],[320,400],[600,600],[601,800],[1280,900]])for(const dark of [false,true]){
   const frame=join(dir,'frame.html');
   await writeFile(frame,`<!doctype html><iframe style="border:0;width:${width}px;height:${height}px" src="file://${page}"></iframe><script>document.querySelector('iframe').onload=event=>document.body.replaceChildren(Object.assign(document.createElement('pre'),{textContent:event.target.contentDocument.querySelector('pre').textContent}));</script>`);
   const result=spawnSync(chrome,['--headless','--no-sandbox','--disable-gpu','--allow-file-access-from-files',...(dark?['--force-dark-mode']:['--blink-settings=preferredColorScheme=1']),'--dump-dom',`file://${frame}`],{encoding:'utf8',timeout:30000});assert.equal(result.status,0,result.stderr);
   const values=JSON.parse(result.stdout.match(/<pre>(.*?)<\/pre>/s)[1]);for(const key of ['titleVisible','gridThree','square','barInside','keptFaded','gridScrollable','previewFits'])assert.equal(values[key],true,`${width}×${height}, dark=${dark}: ${key}`);
   assert.equal(values.previewCount,'1 of 6');if(width>=900&&height>=700)assert.ok(values.panel.width>=width-96,String(values.panel.width));else assert.equal(values.panel.width,width<=600?width:440);assert.equal(values.theme,dark?'rgb(0, 0, 0)':'rgb(242, 242, 247)');if(width<=600){assert.equal(values.panel.top,0);assert.equal(values.panel.bottom,height);}
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('Flashbacks long place leaves the memory count clear of fullscreen on narrow cards',{skip:!chrome||probe.status!==0},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'userscript-memory-'));
 try{
  const page=join(dir,'layout.html');
  await writeFile(page,`<!doctype html><html><body><script>
   const environment={version:'test'};
   const createPairingModal=()=>({open(){}});
   ${counterSource}
   ${setup}
   overlayElement.hidden=false;
   memoryLabel.hidden=false;
   memoryDate.textContent='September 2025';
   memoryPlace.textContent=' · Synthetic city with a very long location name repeated across the card';
   memoryPosition.textContent=' · 12 of 99';
   const labels=[];
   for(const place of ['', ' · Seoul']){
    memoryDate.textContent='May 2017';memoryPlace.textContent=place;memoryPlace.hidden=!place;memoryPosition.textContent=' · 1 of 12';
    labels.push([...memoryLabel.children].filter(span=>!span.hidden).map(span=>span.innerText).join(''));
   }
   memoryDate.textContent='September 2025';memoryPlace.hidden=false;memoryPlace.textContent=' · Synthetic city with a very long location name repeated across the card';memoryPosition.textContent=' · 12 of 99';
   const snapshots=[];
   for(const expanded of [false,true]){
    cardElement.classList.toggle('expanded',expanded);
    const pill=memoryLabel.getBoundingClientRect(),button=enlargeElement.getBoundingClientRect(),place=memoryPlace.getBoundingClientRect();
    const range=document.createRange();range.selectNodeContents(memoryPosition);
    const count=range.getBoundingClientRect();
    snapshots.push({labels,expanded,gap:button.left-pill.right,countInside:count.left>=pill.left&&count.right<=pill.right,countClear:count.right<button.left,placeShrinks:memoryPlace.scrollWidth>memoryPlace.clientWidth,ellipsis:getComputedStyle(memoryPlace).textOverflow,placeWidth:place.width});
   }
   document.body.replaceChildren(Object.assign(document.createElement('pre'),{textContent:JSON.stringify(snapshots)}));
  </script></body></html>`);
  for(const width of [320,375,393,1280]){
   const frame=join(dir,'frame.html');
   await writeFile(frame,`<!doctype html><iframe style="border:0;width:${width}px;height:852px" src="file://${page}"></iframe><script>document.querySelector('iframe').onload=event=>document.body.replaceChildren(Object.assign(document.createElement('pre'),{textContent:event.target.contentDocument.querySelector('pre').textContent}));</script>`);
   const result=spawnSync(chrome,['--headless','--no-sandbox','--disable-gpu','--allow-file-access-from-files','--virtual-time-budget=1000','--dump-dom',`file://${frame}`],{encoding:'utf8',timeout:30000});
   assert.equal(result.status,0,result.stderr);
   const snapshots=JSON.parse(result.stdout.match(/<pre>(.*?)<\/pre>/s)[1]);
   for(const snapshot of snapshots){
    assert.deepEqual(snapshot.labels,['May 2017 · 1 of 12','May 2017 · Seoul · 1 of 12']);
    const label=`width=${width}, expanded=${snapshot.expanded}`;
    assert.ok(snapshot.gap>=8,label+': pill clears fullscreen');
    assert.equal(snapshot.countInside,true,label+': count inside pill');
    assert.equal(snapshot.countClear,true,label+': count clears fullscreen');
    if(width<900&&!(width>600&&snapshot.expanded)){assert.equal(snapshot.placeShrinks,true,label+': long place shrinks');assert.equal(snapshot.ellipsis,'ellipsis',label+': place ellipsizes');}
    assert.ok(snapshot.placeWidth>0,label+': place remains visible');
   }
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
