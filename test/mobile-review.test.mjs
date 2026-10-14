import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import {summarize,removalQueue} from '../public/model.js';

const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const css=await readFile(new URL('../public/styles.css',import.meta.url),'utf8');
const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');

test('mobile navigation follows review counts and the selected view',()=>{
 const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(([,id])=>[id,{hidden:false,textContent:'',style:{},dataset:{},attributes:{},classes:new Set(),querySelector:()=>null,setAttribute(name,value){this.attributes[name]=value;},removeAttribute(name){delete this.attributes[name];},classList:{toggle(name,on){elements.get(id).classes[on?'add':'delete'](name);}}}]));
 const context={reviewActionsPending:0,$:id=>elements.get(id),items:[{id:'a'},{id:'b'},{id:'c'}],decisions:{a:'keep',b:'remove'},workspace:{},summarize,removalQueue,active:()=>null,pending:()=>[],arrangeCollection(){},renderGuide(){},renderStorage(){},resetCardGesture(){},renderCard(){},renderQueue(){},renderOperations(){},renderReconciliation(){},renderControls(){},prefetchReview(){}};
 runInNewContext(app.match(/^function render\(\).*$/m)[0]+';render();',context);
 assert.equal(elements.get('mobile-remaining').textContent,1);
 assert.equal(elements.get('mobile-queue-count').textContent,1);
 runInNewContext(app.match(/^function showView\(.*$/m)[0]+";showView('queue');",context);
 for(const prefix of ['mobile','nav']){
  assert.equal(elements.get(`${prefix}-queue`).attributes['aria-current'],'page');
  assert.ok(elements.get(`${prefix}-queue`).classes.has('active'));
  assert.ok(!elements.get(`${prefix}-review`).classes.has('active'));
 }
 assert.equal(elements.get('review-view').hidden,true);
 runInNewContext("showView('review');decisions={};render();",context);
 assert.equal(elements.get('mobile-review').attributes['aria-current'],'page');
 assert.equal(elements.get('mobile-queue').attributes['aria-current'],undefined);
 assert.equal(elements.get('mobile-remaining').textContent,3);
 assert.equal(elements.get('mobile-queue-count').textContent,0);
});

test('collection controls follow view changes and viewport changes in DOM order',()=>{
 const order=['stats','storage-detail','collection-actions','review-view','queue-view'];
 const elements=Object.fromEntries(order.map(id=>[id,{id,hidden:id==='queue-view',before(element){order.splice(order.indexOf(element.id),1);order.splice(order.indexOf(id),0,element.id);}}]));
 let resize;
 const viewport={matches:false,addEventListener(type,listener){assert.equal(type,'change');resize=listener;}};
 const context={$:id=>elements[id],document:{querySelector:selector=>elements[selector.slice(1)]},matchMedia:query=>{assert.equal(query,'(max-width:760px)');return viewport;}};
 const setup=app.slice(app.indexOf('const phoneLayout='),app.indexOf('function showView('));
 runInNewContext(setup,context);
 assert.deepEqual(order,['stats','storage-detail','collection-actions','review-view','queue-view']);
 viewport.matches=true;resize();
 assert.deepEqual(order,['review-view','stats','storage-detail','collection-actions','queue-view']);
 elements['review-view'].hidden=true;elements['queue-view'].hidden=false;
 runInNewContext('arrangeCollection();',context);
 assert.deepEqual(order,['stats','storage-detail','collection-actions','review-view','queue-view']);
 elements['review-view'].hidden=false;elements['queue-view'].hidden=true;
 runInNewContext('arrangeCollection();',context);
 assert.deepEqual(order,['review-view','stats','storage-detail','collection-actions','queue-view']);
 viewport.matches=false;resize();
 assert.deepEqual(order,['stats','storage-detail','collection-actions','review-view','queue-view']);
});

test('mobile CSS prioritizes review and preserves labels while hiding keyboard hints',()=>{
 const mobile=css.slice(css.lastIndexOf('@media(max-width:760px)'),css.indexOf('#album-confirmation'));
 assert.match(mobile,/main\{display:flex;flex-direction:column\}/);
 assert.match(mobile,/\.mobile-actions\{order:-3;/);
 assert.match(mobile,/\.review-toolbar\{flex-wrap:wrap;/);
 assert.match(mobile,/\.keyboard-hint\{display:none\}/);
 assert.match(mobile,/\.card-area\{height:max\(240px,min\(385px,50dvh,calc\(100dvh - 300px\)\)\)\}/);
 assert.doesNotMatch(css,/\.sort\{font-size:0[;}]/);
 assert.ok(html.indexOf('id="import-next"')<html.indexOf('id="card"'));
 assert.ok(html.indexOf('id="rescan"')<html.indexOf('id="card"'));
 assert.doesNotMatch(css,/@media\(min-width:761px\).*order:/);
 assert.match(html,/id="mobile-review" class="active" aria-current="page"/);
 assert.match(css,/\.header-actions button\{[^}]*min-width:44px;min-height:44px/);
 assert.match(css,/#lock\{padding:10px 12px;font-size:12px\}/);
 assert.match(mobile,/\.mobile-actions button\.active\{[^}]*box-shadow:inset 0 -3px #436a50/);
 assert.match(css,/@media\(pointer:coarse\)\{\s*\.keyboard-hint\{display:none\}/);
});

const chrome=['google-chrome','chromium','chromium-browser','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(command=>spawnSync(command,['--version']).status===0);
const chromeProbe=chrome?spawnSync(chrome,['--headless','--no-sandbox','--disable-gpu','--dump-dom','about:blank'],{encoding:'utf8',timeout:10000}):null;
const browserUnavailable=!chrome?'Chrome is not installed':chromeProbe.status!==0?'Chrome cannot launch in this environment':false;
test('app layout preserves phone review priority, queue controls, and desktop spacing and focus order',{skip:browserUnavailable},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mobile-review-'));
 try{
  const model=await readFile(new URL('../public/model.js',import.meta.url),'utf8');
  const runtime=model.replace(/export /g,'')+`
  const createPhotoViewer=()=>({refreshControls(){}});
  const createConnectionCheck=()=>({check:async()=>{}});
  const bridge=()=>{throw Error('Unexpected bridge request');};
  const cached=async()=>null;
  window.fetch=async path=>{if(path!=='/api/session')throw Error('Unexpected request: '+path);return {ok:true,json:async()=>({authenticated:false})};};
  `+app.replace(/^import .*;$/gm,'')+`
  items=Array.from({length:7},(_,index)=>({id:String(index),name:'Fixture '+index,type:'photo',size:1000,url:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',mediaKey:'fixture-'+index}));
  decisions=Object.fromEntries(items.slice(1).map(item=>[item.id,'remove']));
  authenticated=true;bridgeConnected=true;
  render();
  `;
  const assertions=`
  const rect=selector=>document.querySelector(selector).getBoundingClientRect();
  const style=selector=>getComputedStyle(document.querySelector(selector));
  const results={width:innerWidth,height:innerHeight,cardBeforeStats:rect('#card').bottom<rect('.stats').top,cardBeforeImport:rect('#card').bottom<rect('.collection-actions').top,cardVisible:rect('#card').top>0&&rect('#card').bottom<innerHeight,decisionsVisible:rect('.decision-actions').bottom<innerHeight,sortLabelVisible:parseFloat(style('.sort').fontSize)>0,hintsHidden:style('.keyboard-hint').display==='none',countsVisible:rect('#mobile-remaining').width>0&&rect('#mobile-queue-count').width>0,activeDistinct:style('#mobile-review').backgroundColor!==style('#mobile-queue').backgroundColor,noOverflow:document.documentElement.scrollWidth===innerWidth};
  const inputProfile=new URLSearchParams(location.search).get('input');
  if(inputProfile){
   results.pointerProfile=matchMedia('(pointer:'+inputProfile+')').matches;
   results.hoverProfile=matchMedia(inputProfile==='fine'?'(hover:hover)':'(hover:none)').matches;
  }
  const phone=innerWidth<=760;
  if(phone){
   results.signOutTouchTarget=rect('#lock').width>=44&&rect('#lock').height>=44;
   results.reviewSelected=document.querySelector('#mobile-review').getAttribute('aria-current')==='page'&&style('#mobile-review').boxShadow!==style('#mobile-queue').boxShadow;
   results.cardHasMinimumHeight=rect('#card').height>=240;
   results.metadataInsideCard=rect('.photo-meta').top>=rect('#card').top&&rect('.photo-meta').bottom<=rect('#card').bottom;
   if(innerHeight<568){
    delete results.cardVisible;delete results.decisionsVisible;
    document.querySelector('.decision-actions').scrollIntoView({block:'end'});
    results.decisionsReachable=rect('.decision-actions').top>=0&&rect('.decision-actions').bottom<=innerHeight;
    window.scrollTo(0,0);
   }
  }
  if(!phone){
   results.cardBeforeStats=rect('.stats').bottom<rect('#card').top;
   results.cardBeforeImport=rect('.collection-actions').bottom<rect('#card').top;
   delete results.cardVisible;delete results.decisionsVisible;delete results.countsVisible;delete results.activeDistinct;
   results.hintsHidden=matchMedia('(pointer:coarse)').matches?style('.keyboard-hint').display==='none':style('.keyboard-hint').display!=='none';
   results.storageGap=rect('.collection-actions').top-rect('#storage-detail').bottom===20;
   results.toolbarGap=rect('.review-toolbar').top-rect('.collection-actions').bottom===29;
  }
  const before=(a,b)=>!!(document.querySelector(a).compareDocumentPosition(document.querySelector(b))&Node.DOCUMENT_POSITION_FOLLOWING);
  results.reviewFocusOrder=phone?before('#keep','#import-next'):before('#rescan','#card');
  showView('queue');
  results.queueControlsAboveList=rect('.collection-actions').bottom<rect('#queue-list').top&&rect('.stats').bottom<rect('#queue-list').top&&rect('#storage-detail').bottom<rect('#queue-list').top;
  results.queueFocusOrder=before('#rescan','.queue-thumb');
  results.queueRows=document.querySelectorAll('.queue-row').length===6;
  if(phone)results.queueSelected=document.querySelector('#mobile-queue').getAttribute('aria-current')==='page'&&!document.querySelector('#mobile-review').hasAttribute('aria-current')&&style('#mobile-review').backgroundColor!==style('#mobile-queue').backgroundColor&&style('#mobile-review').boxShadow!==style('#mobile-queue').boxShadow;
  showView('review');
  if(phone)results.reviewSelectedAgain=document.querySelector('#mobile-review').getAttribute('aria-current')==='page'&&!document.querySelector('#mobile-queue').hasAttribute('aria-current')&&style('#mobile-review').boxShadow!==style('#mobile-queue').boxShadow;
  results.returnToReview=phone?rect('#card').bottom<rect('.stats').top:rect('.stats').bottom<rect('#card').top;
  document.querySelector('#photo-viewer').showModal();
  results.viewerHelpVisible=style('.viewer-help').display!=='none'&&rect('.viewer-help').height>0&&rect('.viewer-help').bottom<=innerHeight;
  results.touchHelpPresent=document.querySelector('.viewer-help').textContent.includes('pinch to zoom · Drag to pan');
  document.body.replaceChildren(Object.assign(document.createElement('pre'),{textContent:JSON.stringify(results)}));`;
  const page=html.replace(/<link[^>]+>|<script[^>]+><\/script>/g,'').replace('</head>',`<style>${css}</style></head>`).replace('</body>',`<script>${runtime}\n${assertions}</script></body>`);
  const path=join(dir,'layout.html');await writeFile(path,page);
  const viewports=[[400,844],[370,800],[370,700],[320,568],[390,844],[412,915],[667,375],[568,320],[320,320],[1280,800],[761,800],[768,1024]];
  const inputProfiles=[['none',1,1],['fine',4,2],['coarse',2,1]];
  const scenarios=viewports.flatMap(([width,height])=>width>760?inputProfiles.map(([input,pointer,hover])=>({width,height,input,pointer,hover})):[{width,height}]);
  for(const {width,height,input,pointer,hover} of scenarios){
   const framePath=join(dir,'frame.html');
   await writeFile(framePath,`<!doctype html><iframe scrolling="no" style="border:0;width:${width}px;height:${height}px" src="file://${path}${input?`?input=${input}`:''}"></iframe><script>const frame=document.querySelector('iframe');frame.onload=()=>document.body.replaceChildren(Object.assign(document.createElement('pre'),{textContent:frame.contentDocument.querySelector('pre').textContent}));</script>`);
   const result=spawnSync(chrome,['--headless','--no-sandbox','--disable-gpu',`--user-data-dir=${join(dir,`chrome-${width}-${input||'phone'}`)}`,...(input?[`--blink-settings=primaryPointerType=${pointer},availablePointerTypes=${pointer},primaryHoverType=${hover},availableHoverTypes=${hover}`]:[]),`--window-size=${width},${height}`,'--allow-file-access-from-files','--virtual-time-budget=1000','--dump-dom',`file://${framePath}`],{encoding:'utf8',timeout:30000});
   assert.equal(result.status,0,result.stderr);
   const results=JSON.parse(result.stdout.match(/<pre>(.*?)<\/pre>/s)[1]);
   assert.equal(results.width,width);
   assert.equal(results.height,height);
   for(const [name,value] of Object.entries(results).filter(([name])=>name!=='width'&&name!=='height'))assert.equal(value,true,`${width}×${height} ${input||'phone'}: ${name}`);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
