import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const source=await readFile(new URL('../lib/userscript-ui.mjs',import.meta.url),'utf8');
const counterSource=(await readFile(new URL('../lib/userscript-counter.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const setup=source.slice(source.indexOf(" const host=document.createElement('div');"),source.indexOf(' const $=id=>root.getElementById(id);'));
const chrome=['google-chrome','chromium','chromium-browser'].find(command=>spawnSync(command,['--version']).status===0);
const probe=chrome&&spawnSync(chrome,['--headless','--no-sandbox','--disable-gpu','--dump-dom','about:blank'],{encoding:'utf8',timeout:10000});

test('userscript status keeps a bounded layout slot even when empty',()=>{
 assert.match(source,/\.status:empty\{visibility:hidden\}/);
 assert.match(source,/\.status\{position:relative;height:60px;min-height:60px;overflow:auto;margin:0/);
 assert.match(source,/\.counter\{[^}]*white-space:nowrap/);
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
  const capsule=counter.querySelector('svg'),face=counter.querySelector('.face');
  const results={width:innerWidth,height:innerHeight,countLabel:face.textContent,headerHeight:rect(headerElement5).height,counterCentered:Math.abs((rect(capsule).left+rect(capsule).right)/2-(rect(headerElement5).left+rect(headerElement5).right)/2)<1,countUnclipped:rect(capsule).left>=rect(gear).right&&rect(capsule).right<=rect(reviewButton).left,headerInside:rect(closeElement).right<=rect(divElement4).right,noInitialScroll:before.scrollHeight===before.clientHeight&&before.outerScroll===before.outerHeight};
  for(const [name,value] of Object.entries({short:'Saved locally',long:'Local save failed. '+('Please retry after checking your connection. '.repeat(30)),empty:''})){
   statusElement.textContent=value;
   const after=snapshot();
   results[name+'Stable']=JSON.stringify(after)===JSON.stringify(before);
   if(name==='long')results.longReadable=statusElement.scrollHeight>statusElement.clientHeight&&getComputedStyle(statusElement).overflowY==='auto';
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
   root.querySelector('.media').append(image);
   const bounds=element=>{const r=element.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
   const snapshots=[];
   for(const expanded of [false,true]){
    cardElement.classList.toggle('expanded',expanded);
    for(const message of ['', 'Saved locally', 'Synthetic status '.repeat(100)]){
     statusElement.textContent=message;
     snapshots.push({expanded,message,status:bounds(statusElement),controls:['remove','undo','keep'].map(id=>bounds(root.getElementById(id))),enlarge:bounds(root.getElementById('enlarge')),media:bounds(root.querySelector('.media')),scrollHeight:divElement4.scrollHeight,clientHeight:divElement4.clientHeight});
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
    for(const control of snapshot.controls)assert.ok(snapshot.status.bottom<=control.top,label+': status above controls');assert.ok(snapshot.enlarge.bottom<=snapshot.status.top,label+': fullscreen clear of status');
    assert.ok(snapshot.media.bottom<=snapshot.status.top,label+': media above status');
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
   const initialTop=rect(sheetClose).top;
   const initialContentTop=rect(settingsPanel).top;
   const results={headerContainsDone:sheetClose.parentElement===sheetHeader,headerContainsTitle:sheetTitle.parentElement===sheetHeader,sticky:getComputedStyle(sheetHeader).position==='sticky',snapshots:[]};
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
  for(const [width,height] of [[1280,900],[393,852],[320,568]]){
   const frame=join(dir,'frame.html');
   await writeFile(frame,`<!doctype html><iframe style="border:0;width:${width}px;height:${height}px" src="file://${page}"></iframe><script>document.querySelector('iframe').onload=event=>document.body.replaceChildren(Object.assign(document.createElement('pre'),{textContent:event.target.contentDocument.querySelector('pre').textContent}));</script>`);
   const result=spawnSync(chrome,['--headless','--no-sandbox','--disable-gpu','--allow-file-access-from-files','--virtual-time-budget=1000','--dump-dom',`file://${frame}`],{encoding:'utf8',timeout:30000});
   assert.equal(result.status,0,result.stderr);
   const values=JSON.parse(result.stdout.match(/<pre>(.*?)<\/pre>/s)[1]);
   const {snapshots,...checks}=values;
   for(const snapshot of [checks,...snapshots])for(const [name,value] of Object.entries(snapshot))assert.equal(value,true,`${width}×${height}: ${name}`);
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
   const estimate=()=> '96.4 MB',itemSize=()=> '4.1 MB',previewSize=()=>({}),message=()=>{},reviewTrashCandidates=state=>state.items;
   const apply=next=>{state=next;renderTrashReview();},decideReview=(state,key,decision)=>({...state,items:state.items.map(item=>item.mediaKey===key?{...item,decision}:item)});
   ${methods}
   overlayElement.hidden=false;openReview();
   const bounds=element=>{const r=element.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
   const title=bounds(reviewHeading),panel=bounds(reviewPanel),tiles=Array.from(reviewGrid.children).map(bounds),bar=bounds(reviewBar);
   const result={titleVisible:title.width>100&&title.height>=30,panel,gridThree:tiles[0].top===tiles[1].top&&tiles[1].top===tiles[2].top&&tiles[3].top>tiles[0].top,square:tiles.every(tile=>Math.abs(tile.width-tile.height)<1),barInside:bar.bottom<=innerHeight&&bar.top>=0,keptFaded:getComputedStyle(reviewGrid.children[1].firstChild).opacity==='0.45',gridScrollable:getComputedStyle(reviewScroll).overflowY==='auto'};
   previewKey='fixture-0';renderTrashReview();const preview=root.getElementById('trash-preview'),image=bounds(preview.querySelector('.trash-preview-media')),previewBar=bounds(preview.querySelector('.trash-bar'));
   result.previewFits=image.height>0&&image.bottom<=previewBar.top&&previewBar.bottom<=innerHeight;result.previewCount=preview.querySelector('.trash-nav').children[1].textContent;result.theme=getComputedStyle(reviewPanel).backgroundColor;
   const output=document.createElement('pre');output.hidden=true;output.textContent=JSON.stringify(result);document.body.append(output);
  </script></body></html>`);
  for(const [width,height] of [[393,852],[320,400],[600,600],[601,800],[1280,900]])for(const dark of [false,true]){
   const frame=join(dir,'frame.html');
   await writeFile(frame,`<!doctype html><iframe style="border:0;width:${width}px;height:${height}px" src="file://${page}"></iframe><script>document.querySelector('iframe').onload=event=>document.body.replaceChildren(Object.assign(document.createElement('pre'),{textContent:event.target.contentDocument.querySelector('pre').textContent}));</script>`);
   const result=spawnSync(chrome,['--headless','--no-sandbox','--disable-gpu','--allow-file-access-from-files',...(dark?['--force-dark-mode']:[]),'--dump-dom',`file://${frame}`],{encoding:'utf8',timeout:30000});assert.equal(result.status,0,result.stderr);
   const values=JSON.parse(result.stdout.match(/<pre>(.*?)<\/pre>/s)[1]);for(const key of ['titleVisible','gridThree','square','barInside','keptFaded','gridScrollable','previewFits'])assert.equal(values[key],true,`${width}×${height}, dark=${dark}: ${key}`);
   assert.equal(values.previewCount,'1 of 6');assert.equal(values.panel.width,width<=600?width:440);assert.equal(values.theme,dark?'rgb(0, 0, 0)':'rgb(242, 242, 247)');if(width<=600){assert.equal(values.panel.top,0);assert.equal(values.panel.bottom,height);}
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
