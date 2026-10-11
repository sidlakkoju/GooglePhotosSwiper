import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const functions=['renderControls','enqueueReviewAction','choose','undo','applyDecision','applyUndo','runJob'].map(name=>{
 const line=source.split('\n').find(line=>line.startsWith(`function ${name}(`)||line.startsWith(`async function ${name}(`));
 assert.ok(line,`${name} exists`);
 return line;
}).join('\n');

function harness({fail=false}={}){
 const elements=new Map(),writes=[],messages=[];
 const context={
  busy:false,animating:false,generation:0,reviewActionVersion:0,reviewActionsPending:0,reviewActions:Promise.resolve(),authenticated:true,bridgeConnected:true,reconciliationSupported:true,mode:'google',workspace:{},
  items:[{id:'kept'},{id:'sent'},{id:'next'}],decisions:{kept:'keep',sent:'remove'},history:[{id:'kept',old:null},{id:'sent',old:null}],
  $:id=>{if(!elements.has(id))elements.set(id,{style:{},open:id==='photo-viewer',querySelector:()=>null});return elements.get(id);},
  active:()=>context.items.find(item=>!context.decisions[item.id]),albumCandidates:()=>[],
  photoViewer:{open:true,refreshControls(){}},dismissToast(){},toast:message=>messages.push(message),
  updateDecision:async(item,decision)=>{writes.push({id:item.id,decision});if(decision)context.decisions[item.id]=decision;else delete context.decisions[item.id];return true;},
  bridge:async(operation,args)=>{assert.equal(operation,'sendAlbum');assert.equal(args.jobId,'job');assert.equal(context.$('undo').disabled,true);if(fail)throw Error('Album update interrupted');},
  api:async()=>({id:'job',ids:['sent'],status:'queued'}),refreshWorkspace:async()=>{},
  setBusy:value=>{context.busy=value;context.renderControls();},render:()=>context.renderControls()
 };
 context.setHistory=entries=>{context.history=entries;};
 vm.runInNewContext(functions,context);
 context.renderControls();
 return {context,writes,messages};
}

test('successful album send disables Undo for all prior swipes; a new swipe can be undone',async()=>{
 const {context,writes}=harness();
 assert.equal(context.$('undo').disabled,false);
 await context.runJob({id:'job',ids:['sent'],status:'queued'});
 assert.equal(context.$('undo').disabled,true);
 assert.equal(context.history.length,0);
 await context.undo();
 assert.deepEqual(writes,[]);
 assert.deepEqual(context.decisions,{kept:'keep',sent:'remove'});
 await context.choose('keep');
 assert.equal(context.$('undo').disabled,false);
 await context.undo();
 assert.deepEqual(writes,[{id:'next',decision:'keep'},{id:'next',decision:null}]);
 assert.equal(context.$('undo').disabled,true);
});

test('failed album send preserves Undo history; successful retry clears it',async()=>{
 const {context,messages}=harness({fail:true});
 await context.runJob({id:'job',ids:['sent'],status:'queued'});
 assert.equal(context.history.length,2);
 assert.equal(context.$('undo').disabled,false);
 assert.equal(messages.at(-1),'Album update interrupted');
 context.bridge=async()=>({status:'completed'});
 await context.runJob({id:'job',ids:['sent'],status:'failed'},true);
 assert.equal(context.history.length,0);
 assert.equal(context.$('undo').disabled,true);
});
