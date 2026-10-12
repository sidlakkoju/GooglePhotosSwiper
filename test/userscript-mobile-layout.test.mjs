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
 assert.match(source,/\.status\{position:sticky;bottom:0;height:60px;min-height:60px;overflow:auto;margin:0/);
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
