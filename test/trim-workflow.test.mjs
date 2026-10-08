import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrimWorkflow} from '../public/trim-workflow.js';

function node(tag='div') {
 return {tag,children:[],append(...children){this.children.push(...children);},replaceChildren(){this.children=[];}};
}
const job={id:'fixture',source:{name:'fixture.MOV'},status:'failed'};

test('resuming an exported crop immediately shows progress and prevents duplicate runs',async()=>{
 const savedDocument=globalThis.document;
 globalThis.document={createElement:tag=>node(tag)};
 const container=node(),saved={...job,error:'Previous failure',exportReport:{duration:5},provider:'browser'};
 let release,calls=0,workflow;
 const waiting=new Promise((resolve,reject)=>{release=reject;});
 try{
  workflow=createTrimWorkflow({api:async()=>({}),bridge:async()=>{calls++;return waiting;},toast:()=>{},completed:()=>assert.fail('failed upload cannot complete'),refresh:async()=>workflow.render({trimJobs:[saved]},container)});
  workflow.render({trimJobs:[saved]},container);
  const attempt=workflow.run(saved);
  const children=container.children[0].children;
  assert.match(children.find(n=>n.tag==='strong').textContent,/working/);
  assert.match(children.find(n=>n.tag==='p').textContent,/Uploading and verifying/);
  assert.ok(children.filter(n=>n.tag==='button').every(b=>b.disabled));
  await workflow.run(saved);assert.equal(calls,1);
  release(Error('upload interrupted'));await attempt;
  assert.ok(container.children[0].children.filter(n=>n.tag==='button').every(b=>!b.disabled));
 }finally{globalThis.document=savedDocument;}
});

test('failed preparation releases Retry and Cancel without a reload',async()=>{
 const savedDocument=globalThis.document;
 globalThis.document={createElement:tag=>node(tag)};
 const container=node(),errors=[];let workflow;
 try {
  workflow=createTrimWorkflow({api:async()=>({}),bridge:async()=>{throw Error('bridge unavailable');},toast:e=>errors.push(e),completed:()=>assert.fail('incomplete crop cannot complete'),refresh:async()=>workflow.render({trimJobs:[job]},container)});
  await workflow.run(job);
  const buttons=container.children[0].children.filter(n=>n.tag==='button');
  assert.equal(errors[0],'bridge unavailable');
  assert.equal(buttons.length,2);
  assert.ok(buttons.every(b=>b.disabled===false));
 } finally {globalThis.document=savedDocument;}
});

test('browser crops use the paired bridge; existing official uploads never switch provider',async()=>{
 for(const state of [{provider:'browser'},{provider:'official'},{uploadStarted:true}]) {
  const calls=[];
  const workflow=createTrimWorkflow({api:async(path)=>{calls.push(path);return {status:'processing',apiReady:false};},bridge:async(operation)=>{calls.push(operation);return {status:'processing',playbackReady:false};},refresh:async()=>{},toast:()=>{},completed:()=>assert.fail('processing crop cannot complete')});
  await workflow.run({...job,exportReport:{duration:5},...state});
  assert.deepEqual(calls,state.provider==='browser'?['trimUpload']:['trimConfirmSource','/trim-jobs/fixture/upload']);
 }
});

test('a validated extracted source resumes locally without downloading its archive again',async()=>{
 const calls=[];
 const workflow=createTrimWorkflow({api:async path=>{calls.push(path);return {...job,provider:'browser',exportReport:{duration:5}};},bridge:async operation=>{calls.push(operation);return {status:'processing',playbackReady:false};},refresh:async()=>{},toast:()=>{},completed:()=>assert.fail('processing crop cannot complete')});
 await workflow.run({...job,provider:'browser',archiveValidated:true});
 assert.deepEqual(calls,['/trim-jobs/fixture/resume','trimUpload']);
});
