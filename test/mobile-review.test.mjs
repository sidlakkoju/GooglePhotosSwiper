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
 const context={$:id=>elements.get(id),items:[{id:'a'},{id:'b'},{id:'c'}],decisions:{a:'keep',b:'remove'},workspace:{},summarize,removalQueue,active:()=>null,pending:()=>[],renderStorage(){},resetCardGesture(){},renderCard(){},renderQueue(){},renderOperations(){},renderReconciliation(){},renderControls(){},prefetchReview(){}};
 runInNewContext(app.match(/^function render\(\).*$/m)[0]+';render();',context);
 assert.equal(elements.get('mobile-remaining').textContent,1);
 assert.equal(elements.get('mobile-queue-count').textContent,1);
 runInNewContext(app.match(/^function showView\(v\).*$/m)[0]+";showView('queue');",context);
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

test('mobile CSS prioritizes review and preserves labels while hiding keyboard hints',()=>{
 const mobile=css.slice(css.lastIndexOf('@media(max-width:760px)'));
 assert.match(mobile,/main\{display:flex;flex-direction:column\}/);
 assert.match(mobile,/#review-view,#queue-view\{order:-2\}/);
 assert.match(mobile,/\.mobile-actions\{order:-3;/);
 assert.match(mobile,/\.review-toolbar\{flex-wrap:wrap;/);
 assert.match(mobile,/\.keyboard-hint,\.viewer-help\{display:none\}/);
 assert.doesNotMatch(css,/\.sort\{font-size:0[;}]/);
 assert.match(html,/id="mobile-review" class="active" aria-current="page"/);
});

const chrome=['google-chrome','chromium','chromium-browser'].find(command=>spawnSync(command,['--version']).status===0);
const chromeProbe=chrome?spawnSync(chrome,['--headless','--no-sandbox','--disable-gpu','--dump-dom','about:blank'],{encoding:'utf8',timeout:10000}):null;
const browserUnavailable=!chrome?'Chrome is not installed':chromeProbe.status!==0?'Chrome cannot launch in this environment':false;
test('phone layout puts the card above stats and import controls with visible navigation and sorting',{skip:browserUnavailable},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mobile-review-'));
 try{
  const assertions=`
  const rect=selector=>document.querySelector(selector).getBoundingClientRect();
  const style=selector=>getComputedStyle(document.querySelector(selector));
  const results={width:innerWidth,cardBeforeStats:rect('#card').bottom<rect('.stats').top,cardBeforeImport:rect('#card').bottom<rect('.collection-actions').top,cardVisible:rect('#card').top>0&&rect('#card').bottom<innerHeight,decisionsVisible:rect('.decision-actions').bottom<innerHeight,sortLabelVisible:parseFloat(style('.sort').fontSize)>0,hintsHidden:style('.keyboard-hint').display==='none',viewerHintsHidden:style('.viewer-help').display==='none',countsVisible:rect('#mobile-remaining').width>0&&rect('#mobile-queue-count').width>0,activeDistinct:style('#mobile-review').backgroundColor!==style('#mobile-queue').backgroundColor,noOverflow:document.documentElement.scrollWidth===innerWidth};
  document.body.replaceChildren(Object.assign(document.createElement('pre'),{textContent:JSON.stringify(results)}));`;
  const page=html.replace(/<link[^>]+>|<script[^>]+><\/script>/g,'').replace('</head>',`<style>${css}</style></head>`).replace('</body>',`<script>${assertions}</script></body>`);
  const path=join(dir,'layout.html');await writeFile(path,page);
  for(const [width,height] of [[370,800],[320,568],[390,844]]){
   const result=spawnSync(chrome,['--headless','--no-sandbox','--disable-gpu',`--user-data-dir=${join(dir,`chrome-${width}`)}`,`--window-size=${width},${height}`,'--dump-dom',`file://${path}`],{encoding:'utf8',timeout:30000});
   assert.equal(result.status,0,result.stderr);
   const results=JSON.parse(result.stdout.match(/<pre>(.*?)<\/pre>/s)[1]);
   assert.equal(results.width,width);
   for(const [name,value] of Object.entries(results).filter(([name])=>name!=='width'))assert.equal(value,true,`${width}×${height}: ${name}`);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
