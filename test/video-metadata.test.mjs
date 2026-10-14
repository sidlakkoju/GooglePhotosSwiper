import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {formatBytes} from '../public/model.js';

const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const css=await readFile(new URL('../public/styles.css',import.meta.url),'utf8');

function reviewCard(){
 const elements=new Map();
 const $=id=>{
  if(!elements.has(id))elements.set(id,{dataset:{},textContent:''});
  return elements.get(id);
 };
 const context=vm.createContext({$,formatBytes,showMedia(){}});
 for(const name of ['date','renderCard'])vm.runInContext(app.split('\n').find(line=>line.startsWith(`function ${name}(`)),context);
 return {context,$};
}

test('synthetic video cards show filename, date and size and reset for photos',()=>{
 const {context,$}=reviewCard();
 const video={id:'fake-video',type:'video',name:'Synthetic clip.mp4',date:'2026-10-10T12:00:00Z',size:12500000,width:1920,height:1080,duration:16000,url:'/fake-video-poster.png'};
 context.renderCard(video);
 assert.equal($('card').dataset.mediaType,'video');
 assert.equal($('photo-name').textContent,video.name);
 assert.equal($('photo-date').textContent,context.date(video.date));
 assert.equal($('photo-details').textContent,'12.5 MB · 1920 × 1080 · VIDEO · 16s');
 assert.equal($('media-badge').textContent,'▷ VIDEO');
 context.renderCard({id:'fake-photo',type:'photo',name:'Synthetic photo.jpg',url:'/fake-photo.jpg'});
 assert.equal($('card').dataset.mediaType,'photo');
 assert.equal($('photo-name').textContent,'Synthetic photo.jpg');
 assert.equal($('photo-date').textContent,'Date unavailable');
 assert.equal($('photo-details').textContent,'File size unavailable · PHOTO');
 context.renderCard({id:'fake-video-unknown',type:'video',name:'Unknown clip.mp4',url:'/fake-video-poster.png'});
 assert.equal($('photo-date').textContent,'Date unavailable');
 assert.equal($('photo-details').textContent,'File size unavailable · VIDEO');
});

test('video metadata has a visible footer outside the player and its native controls',()=>{
 const rule=selector=>css.slice(css.indexOf(selector+'{')+selector.length+1).split('}')[0];
 assert.match(rule('.photo-card[data-media-type=video]'),/display:flex;flex-direction:column/);
 assert.match(rule('.photo-card[data-media-type=video] :is(#media,.swipe-media)'),/position:relative;flex:1;min-height:0/);
 assert.match(rule('.photo-card[data-media-type=video] :is(#media,.swipe-media)'),/overflow:hidden;isolation:isolate/);
 assert.match(rule('.photo-card[data-media-type=video] :is(#media,.swipe-media) video'),/position:absolute;inset:0;display:block/);
 assert.match(rule('.photo-card[data-media-type=video] .photo-meta'),/position:relative;flex:none/);
 assert.doesNotMatch(css,/\.photo-card:has\(video\) \.photo-meta\{display:none\}/);
});

const chrome=['google-chrome','chromium','chromium-browser','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(command=>spawnSync(command,['--version']).status===0);
const probeDirectory=await mkdtemp(join(tmpdir(),'video-metadata-probe-'));
const probe=chrome?spawnSync(chrome,['--headless','--no-sandbox','--disable-gpu',`--user-data-dir=${probeDirectory}`,'--dump-dom','about:blank'],{encoding:'utf8',timeout:10000}):null;
await rm(probeDirectory,{recursive:true,force:true});

test('synthetic video player leaves filename, date and size visible inside the card',{skip:!chrome?'Chrome is not installed':probe.status!==0?'Chrome cannot launch in this environment':false},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'video-metadata-'));
 try{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const video=await readFile(new URL('fixtures/synthetic-video.mov',import.meta.url));
  const runtime=`
   const $=id=>document.getElementById(id);
   const formatBytes=${formatBytes.toString()};
   ${app.split('\n').filter(line=>['date','renderCard'].some(name=>line.startsWith('function '+name+'('))).join('\n')}
   function showMedia(){
    $('media').innerHTML='<video controls muted loop></video>';
    $('media').querySelector('video').src='data:video/quicktime;base64,${video.toString('base64')}';
   }
   ${app.slice(app.indexOf('const phoneLayout='),app.indexOf('function showView('))}
   const filename=new URLSearchParams(location.search).get('name');
   renderCard({type:'video',name:filename,date:'2026-10-10T12:00:00Z',size:12500000,url:'fake'});
   const phone=innerWidth<=760;
   const initialCard=$('card').getBoundingClientRect();
   const layout={width:innerWidth,height:innerHeight,phoneLayout:!phone||(initialCard.bottom<document.querySelector('.stats').getBoundingClientRect().top&&initialCard.top>=0&&initialCard.bottom<=innerHeight)};
   $('card').scrollIntoView({block:'center'});
   const rect=element=>element.getBoundingClientRect();
   const card=rect($('card')),media=rect($('media')),player=rect($('media').querySelector('video'));
   const results=['photo-name','photo-date','photo-details'].map(id=>{
    const element=$(id),bounds=rect(element);
    return {id,text:element.textContent,visible:bounds.height>0&&bounds.left>=card.left&&bounds.right<=card.right&&bounds.top>=0&&bounds.bottom<=innerHeight&&bounds.top>=media.bottom&&bounds.bottom<=card.bottom&&document.elementFromPoint(bounds.left+2,bounds.top+2)===$('card')};
   });
   results.push({id:'player',visible:player.height>0&&player.bottom<=media.bottom&&media.bottom<=document.querySelector('.photo-meta').getBoundingClientRect().top});
   document.body.replaceChildren(Object.assign(document.createElement('pre'),{textContent:JSON.stringify({layout,results})}));
  `;
  const page=html.replace(/<link[^>]+>|<script[^>]+><\/script>/g,'').replace('</head>',`<style>${css}</style></head>`).replace('</body>',`<script>${runtime}</script></body>`);
  const path=join(directory,'card.html');
  await writeFile(path,page);
  for(const [width,height,filename] of [[1280,800,'Synthetic clip.mp4'],[390,844,'Synthetic clip.mp4'],[320,568,'Synthetic clip with a very long filename for a narrow phone screen.mp4']]){
   const framePath=join(directory,'frame.html');
   await writeFile(framePath,`<!doctype html><iframe scrolling="no" style="border:0;width:${width}px;height:${height}px" src="file://${path}?name=${encodeURIComponent(filename)}"></iframe><script>const frame=document.querySelector('iframe');frame.onload=()=>document.body.replaceChildren(Object.assign(document.createElement('pre'),{textContent:frame.contentDocument.querySelector('pre').textContent}));</script>`);
   const result=spawnSync(chrome,['--headless','--no-sandbox','--disable-gpu',`--user-data-dir=${join(directory,'chrome-'+width)}`,`--window-size=${width},${height}`,'--allow-file-access-from-files','--virtual-time-budget=1000','--dump-dom',`file://${framePath}`],{encoding:'utf8',timeout:30000});
   assert.equal(result.status,0,result.stderr);
   const {layout,results}=JSON.parse(result.stdout.match(/<pre>(.*?)<\/pre>/s)[1]);
   assert.equal(layout.width,width);
   assert.equal(layout.height,height);
   assert.equal(layout.phoneLayout,true,`${width}×${height}: mobile review layout`);
   for(const item of results)assert.equal(item.visible,true,`${width}×${height}: ${item.id}`);
   assert.equal(results[0].text,filename);
   assert.ok(results[1].text);
   assert.equal(results[2].text,'12.5 MB · VIDEO');
  }
 }finally{await rm(directory,{recursive:true,force:true});}
});
