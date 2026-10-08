import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createApp} from '../server.mjs';

test('extension orchestration reconciles partial writes and retries only missing members',async()=>{
 const app=createApp({loginCode:'test-code'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const base=`http://localhost:${app.server.address().port}`;let listener,pair,firstWrite=true,missingTarget=false,failMembership=false,created=0;const members=new Set(),writes=[];
 const extensionId='a'.repeat(32),popup=`chrome-extension://${extensionId}/popup.html`;
 const fetchLocal=(url,options)=>fetch(String(url).replace('http://localhost:3000',base),options);
 const chrome={runtime:{id:extensionId,getURL:path=>`chrome-extension://${extensionId}/${path}`,onMessage:{addListener:fn=>listener=fn}},storage:{local:{get:async()=>({pair}),set:async data=>pair=data.pair,remove:async()=>pair=undefined}},tabs:{get:async()=>({url:'https://photos.google.com/'}),query:async()=>[{id:7,url:'https://photos.google.com/'}]},scripting:{executeScript:async({args:[operation,args]})=>{
  let data;
  if(operation==='identity')data={account:'testaccount',label:'Test account'};
  else if(operation==='trashPage'){members.delete('one');data={items:[{mediaKey:'changed-trash-id',dedupKey:'dedup-one'}],nextPageId:null};}
  else if(operation==='findAlbum')data={albumKey:null};
  else if(operation==='createAlbum'){created++;if(missingTarget)members.clear();missingTarget=false;data={albumKey:created===1?'testalbum':'replacementalbum'};}
  else if(operation==='albumMembers'){if(missingTarget||failMembership)return [{result:{ok:false,error:'Album unavailable'}}];data={keys:[...members].map(k=>`album-${k}`),dedupKeys:[...members].map(k=>`dedup-${k}`)};}
  else if(operation==='addToAlbum'){writes.push([...args.mediaKeys]);if(firstWrite){firstWrite=false;members.add(args.mediaKeys[0]);return [{result:{ok:false,error:'Lost connection after a partial write'}}];}args.mediaKeys.forEach(k=>members.add(k));data={requested:args.mediaKeys};}
  else throw Error(`Unexpected operation ${operation}`);
  return [{result:{ok:true,data}}];
 }}};
 vm.runInNewContext((await readFile(new URL('../extension/background.js',import.meta.url),'utf8')).replace("import { browserTrimUpload } from './trim-upload.js';",'const browserTrimUpload=()=>{};').replace("import { storedSourceDownload } from './trim-download.js';",'const storedSourceDownload=()=>{};').replace("import { photosOperation } from './photos-api.js';",'const photosOperation=()=>{};'),{chrome,fetch:fetchLocal,URL,AbortSignal,Uint8Array,btoa});
 const send=(operation,args={},sender={id:extensionId,url:popup})=>new Promise(r=>listener({operation,args},sender,r));
 const request=async(path,data,cookie='')=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(data)});return {r,data:await r.json()};};
 try{
  const login=await request('/api/login',{code:'test-code'}),cookie=login.r.headers.get('set-cookie').split(';')[0];
  const code=(await request('/api/pair-code',{},cookie)).data.code;
  assert.equal((await send('pair',{code})).ok,true);
  const rejected=await send('sendAlbum',{}, {id:extensionId,tab:{url:'https://evil.test/'},frameId:0});assert.equal(rejected.ok,false);
  app.store.importItems(['one','two'].map(mediaKey=>({mediaKey,dedupKey:`dedup-${mediaKey}`,name:'Test',type:'photo',thumbUrl:'https://lh3.googleusercontent.com/test'})),'testaccount');
  app.store.listItems().forEach(i=>app.store.decide(i.id,'remove',0));
  const job=app.store.createJob(app.store.listItems().map(i=>i.id));
  const sender={id:extensionId,frameId:0,tab:{url:'http://localhost:3000/'}};
  const first=await send('sendAlbum',{jobId:job.id},sender);assert.equal(first.ok,false);
  assert.equal(app.store.getJob(job.id).status,'failed');assert.deepEqual(app.store.getJob(job.id).confirmed,['one']);
  app.store.retryJob(job.id);assert.equal((await send('sendAlbum',{jobId:job.id},sender)).ok,true);
  assert.deepEqual(writes,[['one','two'],['two']]);assert.equal(app.store.getJob(job.id).status,'completed');
  assert.ok(app.store.listItems().every(i=>i.albumKey==='testalbum'));
  app.store.importItems([{mediaKey:'three',dedupKey:'dedup-three',name:'Third',type:'photo',thumbUrl:'https://lh3.googleusercontent.com/test'}],'testaccount');app.store.decide('testaccount:three','remove',0);
  const replacementJob=app.store.createJob(['testaccount:three']);missingTarget=true;const recovered=await send('sendAlbum',{jobId:replacementJob.id},sender);assert.equal(recovered.ok,true);assert.equal(recovered.data.albumKey,'replacementalbum');assert.equal(recovered.data.status,'completed');assert.equal(created,2);assert.deepEqual(writes.at(-1),['three']);failMembership=true;
  const synced=await send('reconcile',{},sender);assert.equal(synced.ok,true);assert.equal(synced.data.inTrash,1);assert.equal(synced.data.albumUnavailable,true);assert.equal(synced.data.unknown,1);assert.equal(app.store.getSetting('album'),'');assert.deepEqual(app.store.listItems().map(i=>i.mediaKey),['two','three']);assert.deepEqual(writes,[['one','two'],['two'],['three']]);
 }finally{await new Promise(r=>app.server.close(r));}
});
