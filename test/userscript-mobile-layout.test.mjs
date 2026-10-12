import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const source=await readFile(new URL('../lib/userscript-ui.mjs',import.meta.url),'utf8');
const setup=source.slice(source.indexOf(" const host=document.createElement('div');"),source.indexOf(' const $=id=>root.getElementById(id);'));
const chrome=['google-chrome','chromium','chromium-browser'].find(command=>spawnSync(command,['--version']).status===0);
const probe=chrome&&spawnSync(chrome,['--headless','--no-sandbox','--disable-gpu','--dump-dom','about:blank'],{encoding:'utf8',timeout:10000});

test('userscript status keeps a bounded layout slot even when empty',()=>{
 assert.match(source,/\.status:empty\{visibility:hidden\}/);
 assert.match(source,/\.status\{position:relative;height:60px;min-height:60px;overflow:auto;margin:0/);
 assert.match(source,/\.counter\{[^}]*white-space:nowrap/);
});

test('iPhone counts stay on one line and status updates do not add window scrolling',{skip:!chrome||probe.status!==0},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'userscript-mobile-'));
 try{
  const page=join(dir,'layout.html');
  await writeFile(page,`<!doctype html><html><body><script>
  const environment={version:'test'};
  const createPairingModal=()=>({open(){}});
  ${setup}
  overlayElement.hidden=false;
  counter.textContent='2 reviewed · 0 marked';
  reviewButton.textContent='🗑 0';
  const rect=element=>element.getBoundingClientRect();
  const snapshot=()=>({height:rect(divElement4).height,scrollHeight:divElement4.scrollHeight,clientHeight:divElement4.clientHeight,outerScroll:overlayElement.scrollHeight,outerHeight:overlayElement.clientHeight});
  const before=snapshot();
  const range=document.createRange();range.selectNodeContents(counter);
  const results={width:innerWidth,height:innerHeight,countLines:new Set(Array.from(range.getClientRects(),rect=>rect.top)).size,countUnclipped:counter.scrollWidth<=counter.clientWidth,headerInside:rect(closeElement).right<=rect(divElement4).right,noInitialScroll:before.scrollHeight===before.clientHeight&&before.outerScroll===before.outerHeight};
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
   assert.equal(values.width,width);assert.equal(values.height,height);assert.equal(values.countLines,1);
   for(const [name,value] of Object.entries(values).filter(([name])=>!['width','height','countLines','noInitialScroll','countUnclipped'].includes(name)))assert.equal(value,true,`${width}×${height}: ${name}`);
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
   ${setup}
   overlayElement.hidden=false;
   counter.textContent='2 reviewed · 0 marked';
   const image=document.createElement('img');
   image.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="1600" height="1200" fill="blue"/></svg>');
   root.querySelector('.media').append(image);
   const bounds=element=>{const r=element.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
   const snapshots=[];
   for(const expanded of [false,true]){
    cardElement.classList.toggle('expanded',expanded);
    for(const message of ['', 'Saved locally', 'Synthetic status '.repeat(100)]){
     statusElement.textContent=message;
     snapshots.push({expanded,message,status:bounds(statusElement),controls:['remove','enlarge','keep'].map(id=>bounds(root.getElementById(id))),media:bounds(root.querySelector('.media')),scrollHeight:divElement4.scrollHeight,clientHeight:divElement4.clientHeight});
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
    for(const control of snapshot.controls)assert.ok(control.bottom<=snapshot.status.top,label+': above status');
    assert.ok(snapshot.media.bottom<=Math.min(...snapshot.controls.map(control=>control.top)),label+': media above controls');
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
