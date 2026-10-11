import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {pending,summarize,removalQueue} from '../public/model.js';

test('review progress starts empty and follows decisions and undo',async()=>{
 const [html,css,app]=await Promise.all(['index.html','styles.css','app.js'].map(name=>readFile(new URL('../public/'+name,import.meta.url),'utf8')));
 assert.match(html,/<span id="progress-text">0 of 0 reviewed<\/span>/);
 const fillRule=css.match(/\.progress-track i\{([^}]+)\}/)?.[1];
 assert.ok(fillRule);
 assert.match(fillRule,/(?:^|;)width:0%(?:;|$)/);
 const elements=new Map();
 const $=id=>{
  if(!elements.has(id))elements.set(id,{style:{},dataset:{},querySelector:()=>null});
  return elements.get(id);
 };
 const context={$,items:[],decisions:{},workspace:{},summarize,pending,removalQueue};
 context.active=()=>pending(context.items,context.decisions)[0];
 for(const name of ['resetCardGesture','renderStorage','renderCard','renderQueue','renderOperations','renderReconciliation','renderControls','prefetchReview'])context[name]=()=>{};
 const renderSource=app.match(/^function render\(\)\{.*\}$/m)?.[0];
 assert.ok(renderSource);
 runInNewContext(renderSource+';render();',context);
 const check=(reviewed,total)=>{
  context.render();
  assert.equal($('progress-text').textContent,`${reviewed} of ${total} reviewed`);
  assert.equal($('progress').style.width,`${total?reviewed/total*100:0}%`);
 };
 check(0,0);
 context.items=Array.from({length:3},(_,n)=>({id:'synthetic:'+n,type:'photo'}));
 check(0,3);
 context.decisions['synthetic:0']='keep';
 check(1,3);
 context.decisions['synthetic:1']='remove';
 check(2,3);
 context.decisions['synthetic:2']='keep';
 check(3,3);
 delete context.decisions['synthetic:2'];
 check(2,3);
 context.decisions={};
 check(0,3);
});
