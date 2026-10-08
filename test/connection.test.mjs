import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createConnectionCheck,describeConnection} from '../public/connection.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('connection visibly checks once, then verifies identity with a fresh timestamp',async()=>{
 const wait=deferred(),changes=[],calls=[];
 const check=createConnectionCheck({refresh:async()=>calls.push('refresh'),bridge:async(...args)=>{calls.push(args);return wait.promise;},change:s=>changes.push(s),now:()=>new Date('2026-10-06T10:00:00Z')});
 const first=check.check();assert.equal(check.check(),first);assert.equal(changes[0].phase,'checking');assert.equal(changes[0].connected,false);assert.match(changes[0].detail,/local sign-in/);
 await Promise.resolve();wait.resolve({installed:true,paired:true,version:'1.2.2',label:'Test account',trimUploadSupported:true,trimArchiveSupported:true,reconciliationSupported:true});
 const result=await first;assert.equal(result.phase,'connected');assert.match(result.detail,/Connection verified.*Test account.*at /);assert.equal(calls.length,2);assert.equal(calls[1][2],35000);assert.equal(changes.length,2);
});
test('expired local sign-in prevents the Google check and clears old success',async()=>{
 const changes=[];let calls=0;
 const check=createConnectionCheck({refresh:async()=>{throw Error('Your local sign-in expired. Sign in again.');},bridge:async()=>calls++,change:s=>changes.push(s)});
 const result=await check.check();assert.equal(calls,0);assert.equal(result.connected,false);assert.match(result.detail,/Sign in again/);assert.equal(changes.at(-1).phase,'error');
});
test('connection errors are recoverable and a later check succeeds',async()=>{
 let available=false;const changes=[];
 const check=createConnectionCheck({refresh:async()=>{},bridge:async()=>{if(!available)throw Error('Extension disconnected. Reload this tab.');return {installed:true,paired:true,version:'1.2.2',trimUploadSupported:true,trimArchiveSupported:true,recoveredTab:true};},change:s=>changes.push(s)});
 assert.equal((await check.check()).phase,'error');available=true;assert.equal((await check.check()).phase,'connected');assert.match(changes.at(-1).detail,/open Google Photos tab/);
});
test('core review accepts the installed bridge without requiring crop capabilities; unpaired needs fresh code',()=>{
 const legacy=describeConnection({installed:true,paired:true,label:'Test'});assert.equal(legacy.connected,true);assert.equal(legacy.phase,'connected');assert.doesNotMatch(legacy.detail,/crop/);
 const preArchive=describeConnection({installed:true,paired:true,version:'1.2.1',trimUploadSupported:true});assert.equal(preArchive.connected,true);assert.equal(preArchive.phase,'connected');
 const unpaired=describeConnection({installed:true,paired:false,version:'1.2.0'});assert.equal(unpaired.connected,false);assert.match(unpaired.detail,/fresh code/);
 assert.throws(()=>describeConnection(null),/invalid status/);
});

async function transport(){
 const listeners=new Set(),timers=new Map();let number=0,request;
 const window={addEventListener:(kind,fn)=>listeners.add(fn),removeEventListener:(kind,fn)=>listeners.delete(fn),postMessage:message=>request=message};
 const context={window,location:{origin:'http://localhost:3000'},crypto:{randomUUID:()=>`test${++number}`},setTimeout:fn=>{timers.set(number,fn);return number;},clearTimeout:id=>timers.delete(id),Error};
 vm.runInNewContext((await readFile(new URL('../public/bridge.js',import.meta.url),'utf8')).replace('export function bridge','function bridge'),context);
 return {context,listeners,timers,get request(){return request;},emit:data=>[...listeners].forEach(fn=>fn({source:window,origin:'http://localhost:3000',data}))};
}
test('missing relay and acknowledged worker timeout have distinct actionable messages',async()=>{
 for(const acknowledged of [false,true]){const t=await transport(),promise=t.context.bridge('status',{},1);if(acknowledged)t.emit({channel:'photos-swipe-ack',id:t.request.id});[...t.timers.values()][0]();await assert.rejects(promise,acknowledged?/received the check but did not finish/:/No response from the extension/);assert.equal(t.listeners.size,0);}
});
test('bridge accepts legacy replies and exposes disconnected errors after acknowledgement',async()=>{
 const t=await transport();const promise=t.context.bridge('status');t.emit({channel:'photos-swipe-ack',id:t.request.id});t.emit({channel:'photos-swipe-response',id:t.request.id,ok:false,error:'Extension disconnected. Reload this tab.'});await assert.rejects(promise,/Extension disconnected/);assert.equal(t.timers.size,0);
 const next=t.context.bridge('status');t.emit({channel:'photos-swipe-response',id:t.request.id,ok:true,data:{installed:true,paired:false}});assert.equal((await next).paired,false);
});
test('relay acknowledges promptly and converts missing worker response into a recovery error',async()=>{
 const outputs=[];let listener;const window={top:null,addEventListener:(kind,fn)=>listener=fn,postMessage:data=>outputs.push(data)};window.top=window;
 vm.runInNewContext(await readFile(new URL('../extension/relay.js',import.meta.url),'utf8'),{window,location:{origin:'http://localhost:3000'},chrome:{runtime:{sendMessage:async()=>undefined}}});
 await listener({source:window,origin:'http://localhost:3000',data:{channel:'photos-swipe-request',id:'test',operation:'status'}});
 assert.equal(outputs[0].channel,'photos-swipe-ack');assert.equal(outputs[1].ok,false);assert.match(outputs[1].error,/Extension disconnected/);
});

async function popup(){
 const initial=deferred(),pairing=deferred(),buttons={pair:{disabled:false},forget:{disabled:false}},status={textContent:'',setAttribute(name,value){this[name]=value;}},form={querySelector:()=>buttons.pair},code={value:'123456'};
 const elements={'pair-form':form,status,code,forget:buttons.forget},timers=new Map();let id=0;
 vm.runInNewContext(await readFile(new URL('../extension/popup.js',import.meta.url),'utf8'),{document:{getElementById:id=>elements[id]},chrome:{runtime:{sendMessage:({operation})=>operation==='status'?initial.promise:pairing.promise}},setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:id=>timers.delete(id),Error,Promise});
 return {initial,pairing,status,form,buttons,timers};
}
test('popup pairing shows pending and success without an older status overwriting it',async()=>{
 const p=await popup();const run=p.form.onsubmit({preventDefault(){}});assert.match(p.status.textContent,/Pairing with/);assert.equal(p.buttons.pair.disabled,true);
 p.pairing.resolve({ok:true,data:{label:'Test account'}});await run;assert.match(p.status.textContent,/Paired with Test account/);assert.match(p.status.textContent,/Check connection/);assert.equal(p.buttons.pair.disabled,false);
 p.initial.resolve({ok:true,data:{paired:false}});await Promise.resolve();await Promise.resolve();assert.match(p.status.textContent,/Paired with Test account/);assert.equal(p.status['aria-busy'],'false');
});
test('popup rejected code releases its controls and forget failures are visible',async()=>{
 const p=await popup();const run=p.form.onsubmit({preventDefault(){}});p.pairing.resolve({ok:false,error:'Pairing code expired or incorrect. Generate a new one.'});await run;assert.match(p.status.textContent,/expired or incorrect/);assert.equal(p.buttons.forget.disabled,false);
 await p.buttons.forget.onclick();assert.match(p.status.textContent,/expired or incorrect/);assert.equal(p.buttons.pair.disabled,false);p.initial.resolve({ok:true,data:{paired:true,label:'Old account'}});await Promise.resolve();await Promise.resolve();assert.match(p.status.textContent,/expired or incorrect/);
});
