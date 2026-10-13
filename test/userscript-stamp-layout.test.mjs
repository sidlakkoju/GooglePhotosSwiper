import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {Script} from 'node:vm';

const source=await readFile(new URL('../lib/userscript-ui.mjs',import.meta.url),'utf8');
const counterSource=(await readFile(new URL('../lib/userscript-counter.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const swipeSource=(await readFile(new URL('../lib/userscript-swipe.mjs',import.meta.url),'utf8')).replace(/^export /gm,'');
const orderSource=(await readFile(new URL('../lib/userscript-order.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const setup=orderSource+source.slice(source.indexOf(" const host=document.createElement('div');"),source.indexOf(' const $=id=>root.getElementById(id);'));
const binding=source.match(/ const swipeFeedback=createSwipeFeedback\([^\n]+/)[0];
test('stamp layout setup parses as a classic browser script',()=>{
 assert.doesNotThrow(()=>new Script(counterSource+setup));
});

const chrome=['google-chrome','chromium','chromium-browser'].find(command=>spawnSync(command,['--version']).status===0);

for(const reduced of [false,true])for(const theme of ['light','dark'])for(const [width,height,pointerType] of [[1280,900,'mouse'],[393,852,'touch']]){
 test(`KEEP and REMOVE stay inside the dragged card at ${width}×${height} in ${theme}, reduced motion ${reduced}`,{skip:!chrome&&'Chrome is not installed'},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'userscript-stamp-'));
  try{
   const page=join(dir,'layout.html');
   await writeFile(page,`<!doctype html><html><body><script>
    const environment={version:'test'};
    const createPairingModal=()=>({open(){}});
    ${counterSource}
    ${swipeSource}
    ${setup}
    overlayElement.hidden=false;
    const $=id=>root.getElementById(id);
    const current=()=>({mediaKey:'synthetic'}),busy=false,otherTab=false,leaseError=null,inspected=null;
    const decide=()=>{throw Error('Mid-drag must not decide');};
    const matchMedia=window.matchMedia.bind(window);
    window.matchMedia=query=>query==='(prefers-reduced-motion: reduce)'?{matches:${reduced}}:matchMedia(query);
    ${binding}
    const bounds=element=>{const r=element.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    mediaElement.setPointerCapture=()=>{};
    mediaElement.hasPointerCapture=()=>false;
    const results=[];
    const frames=[];
    window.requestAnimationFrame=callback=>{frames.push(callback);return frames.length;};
    window.cancelAnimationFrame=()=>{};
    for(const direction of [1,-1]){
     swipeFeedback.reset();
     const before=bounds(topCard);
     const positionedBefore=stamps.every(stamp=>stamp.offsetParent===topCard);
     mediaElement.dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,pointerType:${JSON.stringify(pointerType)},isPrimary:true,button:0,clientX:200,clientY:200,bubbles:true}));
     mediaElement.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,pointerType:${JSON.stringify(pointerType)},isPrimary:true,clientX:200+direction*before.width*.25,clientY:210,bubbles:true,cancelable:true}));
     while(frames.length)frames.shift()();
     const stamp=stamps[direction>0?0:1];
     results.push({label:stamp.textContent,positionedBefore,parent:stamp.parentElement===topCard,containingCard:stamp.offsetParent===topCard,card:bounds(topCard),stamp:bounds(stamp),before,transform:topCard.style.transform,opacity:Number(getComputedStyle(stamp).opacity),theme:getComputedStyle(host).colorScheme});
    }
    document.body.replaceChildren(Object.assign(document.createElement('pre'),{textContent:JSON.stringify(results)}));
   </script>`);
   const frame=join(dir,'frame.html');
   await writeFile(frame,`<!doctype html><iframe style="border:0;width:${width}px;height:${height}px" src="file://${page}"></iframe><script>document.querySelector('iframe').onload=event=>document.body.replaceChildren(Object.assign(document.createElement('pre'),{textContent:event.target.contentDocument.querySelector('pre').textContent}));</script>`);
   const result=spawnSync(chrome,['--headless','--no-sandbox','--disable-gpu','--allow-file-access-from-files',...(theme==='dark'?['--force-dark-mode']:[]),'--dump-dom',`file://${frame}`],{encoding:'utf8',timeout:30000});
   assert.equal(result.status,0,result.stderr);
   const output=result.stdout.match(/<pre>(.*?)<\/pre>/s);
   assert.ok(output,result.stdout);
   const snapshots=JSON.parse(output[1]);
   assert.deepEqual(snapshots.map(snapshot=>snapshot.label),['KEEP','REMOVE']);
   for(const snapshot of snapshots){
    assert.equal(snapshot.theme,theme);
    assert.equal(snapshot.positionedBefore,true);
    assert.equal(snapshot.parent,true);
    assert.equal(snapshot.containingCard,true);
    assert.ok(snapshot.opacity>0);
    if(reduced){
     assert.equal(snapshot.transform,'');
     assert.deepEqual(snapshot.card,snapshot.before);
    }else{
     assert.match(snapshot.transform,/translate3d\(.+rotate\(.+scale\(1.02\)/);
     assert.notEqual(snapshot.card.left,snapshot.before.left);
    }
    assert.ok(snapshot.card.width>0&&snapshot.card.height>0);
    assert.ok(snapshot.stamp.width>0&&snapshot.stamp.height>0);
    for(const edge of ['left','top'])assert.ok(snapshot.stamp[edge]>=snapshot.card[edge],JSON.stringify(snapshot));
    for(const edge of ['right','bottom'])assert.ok(snapshot.stamp[edge]<=snapshot.card[edge],JSON.stringify(snapshot));
   }
  }finally{await rm(dir,{recursive:true,force:true});}
 });
}
