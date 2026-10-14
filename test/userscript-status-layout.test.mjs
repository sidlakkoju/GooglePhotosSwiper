import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const source=await readFile(new URL('../lib/userscript-ui.mjs',import.meta.url),'utf8');
const base=JSON.parse(source.match(/styleElement1\.append\(document\.createTextNode\((".*")\)\);/)[1]);
const shell=source.match(/shellStyle\.textContent='([^']+)'/)[1];
const redesign=source.match(/redesignStyle\.textContent=`([^`]+)`/)[1];
const chrome=['google-chrome','chromium','chromium-browser','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(command=>spawnSync(command,['--version']).status===0);

test('status reserves space even when empty and bounds wrapping messages',()=>{
 assert.doesNotMatch(shell,/\.status:empty\{[^}]*display:none/);
 assert.match(redesign,/\.content \.status\{[^}]*height:24px;min-height:24px/);
 assert.match(source,/statusElement\.setAttribute\("role","status"\)/);
 assert.match(source,/statusElement\.setAttribute\("aria-live","polite"\)/);
});

test('status changes preserve window and decision control positions on desktop and phone',{skip:!chrome&&'Chrome is not installed'},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'userscript-status-'));
 try{
  const page=join(dir,'layout.html');
  await writeFile(page,`<!doctype html><div id="host" style="position:fixed;inset:0"></div><script>
   const root=document.querySelector('#host').attachShadow({mode:'open'});
   root.innerHTML=${JSON.stringify(`<style>${base}${shell}${redesign}</style><section class="overlay"><div class="content"><header><button id="settings">Settings</button><button id="close">Close</button></header><div class="card"><div class="media"></div></div><div class="actions"><button id="remove">Remove</button><button id="undo">Undo</button><button id="keep">Keep</button></div><p class="status" role="status" aria-live="polite"></p></div></section>`)};
   const status=root.querySelector('.status');
   const bounds=()=>Object.fromEntries(['.content','#close','#undo','#keep','#remove','.status'].map(selector=>{const rect=root.querySelector(selector).getBoundingClientRect();return [selector,[rect.x,rect.y,rect.width,rect.height]];}));
   const initial=bounds();
   const messages=['Kept fixture.jpg.','Decision undone · fixture.jpg.','Kept '+('long filename '.repeat(50))+'.',''];
   const snapshots=messages.map(message=>{status.textContent=message;return {bounds:bounds(),text:status.textContent,scrollable:status.scrollHeight>status.clientHeight};});
   document.body.replaceChildren(Object.assign(document.createElement('pre'),{textContent:JSON.stringify({initial,snapshots})}));
  </script>`);
  for(const [width,height] of [[1280,1000],[393,852],[393,600]]){
   const frame=join(dir,'frame.html');
   await writeFile(frame,`<!doctype html><iframe style="border:0;width:${width}px;height:${height}px" src="file://${page}"></iframe><script>document.querySelector('iframe').onload=event=>document.body.replaceChildren(Object.assign(document.createElement('pre'),{textContent:event.target.contentDocument.querySelector('pre').textContent}));</script>`);
   const result=spawnSync(chrome,['--headless','--no-sandbox','--disable-gpu','--allow-file-access-from-files',`--user-data-dir=${join(dir,`chrome-${width}-${height}`)}`,'--dump-dom',`file://${frame}`],{encoding:'utf8',timeout:30000});
   assert.equal(result.status,0,result.stderr);
   const {initial,snapshots}=JSON.parse(result.stdout.match(/<pre>(.*?)<\/pre>/s)[1]);
   assert.equal(initial['.status'][3],24);
   for(const snapshot of snapshots)assert.deepEqual(snapshot.bounds,initial,`${width}×${height}: ${snapshot.text}`);
   assert.equal(snapshots[2].scrollable,true);
   assert.equal(snapshots[3].text,'');
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
