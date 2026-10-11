import {injectRelease} from '../lib/userscript-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access,mkdtemp,writeFile,rm,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {buildPhotosRequest,parsePhotosResponse,createPhotosAPI} from '../lib/userscript-api.mjs';
import {emptyReview,reviewDeck,reviewQueue,reviewStorage,mergeReviewPage,canUndoReview,decideReview,finishReviewAlbum,sendReviewAlbum,readReviewTrash,reconcileReviewTrash} from '../lib/userscript-core.mjs';
const tokens={SNlM0e:'fake-token',oPEP7c:'fake@example.test',eptZe:'/_/PhotosUi/u/2/',FdrFJe:'fake-session',cfb2h:'fake-build'};
const page={origin:'https://photos.google.com',pathname:'/u/2/'};
const envelope=(id,data)=>`)]}'\n\n123\n${JSON.stringify([['wrb.fr','unrelated','[]'],['wrb.fr',id,JSON.stringify(data)]])}\n`;
const item=(mediaKey,extra={})=>({mediaKey,name:mediaKey,type:'photo',urlFetchedAt:Date.now(),thumbUrl:'https://lh3.googleusercontent.com/fake',decision:null,state:'active',...extra});
function fixture(responder){
 const calls=[],window={WIZ_global_data:{...tokens}};
 const api=createPhotosAPI({window,location:page,crypto:webcrypto,AbortController,setTimeout,clearTimeout,fetch:async(url,options)=>{
  const body=new URLSearchParams(options.body),entry=JSON.parse(body.get('f.req'))[0][0],id=entry[0],args=JSON.parse(entry[1]);calls.push({url,options,id,args});
  const result=await responder(id,args,window);
  return result?.raw!==undefined?{ok:result.ok!==false,status:result.status||200,text:async()=>result.raw}:{ok:true,text:async()=>envelope(id,result)};
 }});
 return {calls,window,api};
}
async function call(f,operation,args){const result=await f.api(operation,args);if(!result.ok)throw Error(result.error);return result.data;}
test('userscript request builder scopes the session path, tokens, credentials and RPC payload',()=>{
 const request=buildPhotosRequest(tokens,page,'lcxiM',['next',null,50,null,1,1]);
 const url=new URL(request.url),body=new URLSearchParams(request.options.body);
 assert.equal(url.origin,page.origin);assert.equal(url.pathname,'/_/PhotosUi/u/2/data/batchexecute');assert.equal(url.searchParams.get('source-path'),'/u/2/');assert.equal(url.searchParams.get('f.sid'),'fake-session');
 assert.equal(request.options.credentials,'include');assert.equal(request.options.method,'POST');assert.equal(body.get('at'),'fake-token');
 assert.deepEqual(JSON.parse(body.get('f.req')),[[['lcxiM',JSON.stringify(['next',null,50,null,1,1]),null,'generic']]]);
 for(const path of ['https://invalid.test/','//invalid.test/','/u/2/../../'])assert.throws(()=>buildPhotosRequest({...tokens,eptZe:path},page,'rpc',[]));
 assert.throws(()=>buildPhotosRequest(tokens,{...page,origin:'https://invalid.test'},'rpc',[]));
});
test('userscript response parser handles XSSI and length framing and rejects mismatched or malformed envelopes',()=>{
 assert.deepEqual(parsePhotosResponse(envelope('rpc',[['fake']]),'rpc'),[['fake']]);
 for(const raw of ['garbage',envelope('wrong',[]),JSON.stringify([['wrb.fr','rpc',null]]),JSON.stringify([['wrb.fr','rpc','{']])])assert.throws(()=>parsePhotosResponse(raw,'rpc'));
});
test('fake library and bulk metadata responses produce photos/videos and preserve next-page tokens',async()=>{
 const row=['video',['https://lh3.googleusercontent.com/fake',800,600],1720000000000,'stable',0,{76647426:[25000]}];
 const detail=['video',[]];detail[1][3]='fake.mp4';detail[1][9]=500;detail[1][35]=[1,300];
 const f=fixture(id=>id==='lcxiM'?[[row],'next']:id==='EWgK9e'?[[null,[detail]]]:null);
 const result=await call(f,'library',{cursor:'previous'});
 assert.equal(result.items[0].type,'video');assert.equal(result.items[0].spaceTaken,300);assert.equal(result.items[0].size,500);assert.equal(result.items[0].name,'fake.mp4');assert.equal(result.nextPageId,'next');
 assert.deepEqual(f.calls[0].args,['previous',null,50,null,1,1]);assert.equal(f.calls[1].args[0][1][0].length,36);
});
test('metadata failures retain review items with unknown sizes; invalid preview hosts fail',async()=>{
 const row=['photo',['https://lh3.googleusercontent.com/fake'],1720000000000,'stable',0,{}];
 const f=fixture(id=>id==='lcxiM'?[[row],null]:null);const result=await call(f,'library');assert.equal(result.items.length,1);assert.match(result.metadataWarning,/sizes/);
 row[1][0]='https://invalid.test/fake';assert.equal((await f.api('library')).ok,false);
});
test('wrong account, changed session, failed HTTP and malformed responses never acknowledge success',async()=>{
 const f=fixture(()=>[]);assert.equal((await f.api('library',{account:'different'})).ok,false);assert.equal(f.calls.length,0);
 const changed=fixture((id,args,window)=>{window.WIZ_global_data.SNlM0e='changed';return [];});assert.equal((await changed.api('trashPage')).ok,false);
 const failed=fixture(()=>({raw:'',ok:false,status:403}));assert.match((await failed.api('trashPage')).error,/403/);
 const malformed=fixture(()=>({raw:'garbage'}));assert.equal((await malformed.api('addToAlbum',{albumKey:'album',mediaKeys:['photo']})).ok,false);
});
test('album discovery/create/add/membership use the extension request formats with paginated fakes',async()=>{
 const f=fixture((id,args)=>id==='Z5xsfc'?(args[0]?[[['album',{72930366:[null,'Photos Swipe · Review · fake']}]],null]:[[],'next']):id==='OXvT9d'?[['album']]:id==='E1Cajb'?[]:id==='snAcKc'?[null,[['photo',null,null,'stable']],null,['album']]:null);
 assert.equal((await call(f,'findAlbum',{title:'Photos Swipe · Review · fake'})).albumKey,'album');
 assert.equal((await call(f,'createAlbum',{title:'Photos Swipe · Review · fake'})).albumKey,'album');
 assert.equal((await call(f,'addToAlbum',{albumKey:'album',mediaKeys:['photo']})).requested,1);
 assert.deepEqual(await call(f,'albumMembers',{albumKey:'album'}),{keys:['photo'],dedupKeys:['stable']});
 assert.deepEqual(f.calls.find(c=>c.id==='E1Cajb').args,[['photo'],'album']);
 assert.equal((await f.api('addToAlbum',{albumKey:'album',mediaKeys:Array(26).fill('photo')})).ok,false);
 const wrong=fixture(()=>[null,[],null,['other']]);assert.equal((await wrong.api('albumMembers',{albumKey:'album'})).ok,false);
});
test('video and Trash reads use page-session RPCs and refuse direct deletion commands',async()=>{
 const f=fixture(id=>id==='VrseUb'?[['video'],'https://lh3.googleusercontent.com/video']:id==='zy0IHe'?[[['photo',null,null,'stable']],null]:null);
 assert.equal((await call(f,'video',{mediaKey:'video'})).url,'https://lh3.googleusercontent.com/video');
 assert.deepEqual((await call(f,'trashPage')).items,[{mediaKey:'photo',dedupKey:'stable'}]);
 const count=f.calls.length;assert.equal((await f.api('trash',{mediaKeys:['photo']})).ok,false);assert.equal(f.calls.length,count);
 const bad=fixture(()=>[['video'],'https://invalid.test/video']);assert.equal((await bad.api('video',{mediaKey:'video'})).ok,false);
});
test('media URL refresh selects the preview tuple while video keeps the playback URL',async()=>{
 const preview='https://photos.fife.usercontent.google.com/preview',playback='https://lh3.googleusercontent.com/playback';
 const f=fixture(()=>[['photo',[preview,800,600]],playback]);
 assert.deepEqual(await call(f,'mediaURL',{mediaKey:'photo'}),{url:preview});
 assert.deepEqual(await call(f,'video',{mediaKey:'photo'}),{url:playback});
 assert.deepEqual(f.calls[0].args,['photo',null,null,null,null]);
 const download=fixture(()=>[['photo',[preview,800,600]],'https://video-downloads.google.com/download']);
 assert.deepEqual(await call(download,'mediaURL',{mediaKey:'photo'}),{url:preview});
 for(const data of [[['other',[preview,800,600]],playback],[['photo'],playback],[['photo',['https://invalid.test/preview',800,600]],playback]]){
  assert.equal((await fixture(()=>data).api('mediaURL',{mediaKey:'photo'})).ok,false);
 }
});
test('page merges preserve decisions, sent markers and older progress through latest refresh',()=>{
 let state={...emptyReview(),items:[item('old',{decision:'remove',queueSent:true})]};
 state=mergeReviewPage(state,{items:[item('old'),item('new')],nextPageId:'older'},null);
 state=mergeReviewPage(state,{items:[item('head')],nextPageId:'head-cursor'},null,true);
 assert.equal(state.cursor,'older');assert.equal(state.items[0].decision,'remove');assert.equal(state.items[0].queueSent,true);assert.equal(reviewDeck(state).length,2);
 assert.throws(()=>mergeReviewPage(state,{items:[],nextPageId:'older'},'older'));
 assert.throws(()=>mergeReviewPage(state,{items:[],nextPageId:'later'},'stale'));
 const exhausted=mergeReviewPage(state,{items:[],nextPageId:null},'older');assert.equal(exhausted.exhausted,true);assert.equal(mergeReviewPage(exhausted,{items:[],nextPageId:'new'},null,true).exhausted,true);
});
test('decisions, undo, queue membership, saved job protection and quota accounting are pure',()=>{
 let state={...emptyReview(),items:[item('a',{size:900,spaceTaken:100}),item('b',{size:400,takesUpSpace:false}),item('c')]};
 for(const key of ['a','b','c'])state=decideReview(state,key,'remove',null);
 assert.deepEqual(reviewStorage(reviewQueue(state)),{bytes:100,unknown:1});assert.equal(reviewDeck(state).length,0);
 state=decideReview(state,'a',null,'remove');assert.equal(reviewDeck(state).length,1);
 assert.throws(()=>decideReview(state,'a','keep','remove'));
 assert.throws(()=>decideReview({...state,job:{mediaKeys:['a']}},'a','keep',null));
 assert.equal(reviewQueue({...state,items:state.items.map(i=>({...i,queueSent:true}))}).length,0);
});
function albumWorkspace(items){let state={...emptyReview(),items};return {read:async()=>state,save:async next=>{state=structuredClone(next);return state;},state:()=>state};}
test('partial album writes retain the whole queue and persisted checkpoint, then retry only missing items',async()=>{
 const workspace=albumWorkspace([item('a',{decision:'remove'}),item('b',{decision:'remove'})]),members=new Set(),writes=[];let partial=true;
 const call=async(operation,args)=>{
  if(operation==='findAlbum')return {albumKey:null};if(operation==='createAlbum')return {albumKey:'album'};
  if(operation==='albumMembers')return {keys:[...members],dedupKeys:[]};
  if(operation==='addToAlbum'){writes.push(args.mediaKeys);for(const key of partial?args.mediaKeys.slice(0,1):args.mediaKeys)members.add(key);}
 };
 await assert.rejects(sendReviewAlbum({...workspace,call,title:'Photos Swipe · Review · fake'}),/not confirmed/);
 assert.equal(reviewQueue(workspace.state()).length,2);assert.equal(workspace.state().job.albumKey,'album');partial=false;
 await sendReviewAlbum({...workspace,call,title:'ignored'});
 assert.deepEqual(writes,[['a','b'],['b']]);assert.equal(workspace.state().job,null);assert.equal(reviewQueue(workspace.state()).length,0);assert.equal(workspace.state().items[0].decision,'remove');
});
test('failed album write responses still verify membership, stable IDs count, and batches are bounded to 25',async()=>{
 const workspace=albumWorkspace(Array.from({length:27},(_,i)=>item(`k${i}`,{decision:'remove',dedupKey:`d${i}`}))),stable=new Set(),batches=[];
 const call=async(operation,args)=>{
  if(operation==='findAlbum')return {albumKey:'album'};
  if(operation==='albumMembers')return {keys:[],dedupKeys:[...stable]};
  if(operation==='addToAlbum'){batches.push(args.mediaKeys.length);for(const key of args.mediaKeys)stable.add(`d${key.slice(1)}`);throw Error('Fake lost response');}
 };
 await sendReviewAlbum({...workspace,call,title:'Photos Swipe · Review · fake'});assert.deepEqual(batches,[25,2]);assert.equal(reviewQueue(workspace.state()).length,0);
 assert.throws(()=>finishReviewAlbum({...emptyReview(),items:[item('a')],job:{mediaKeys:['a'],albumKey:'album'}},{keys:[],dedupKeys:[]}));
});
test('Trash pagination and unknown reconciliation preserve local state and do not infer deletion from absence',async()=>{
 const state={...emptyReview(),items:[item('a',{decision:'remove',dedupKey:'stable'}),item('b',{decision:'remove',state:'in_trash'}),item('c',{decision:'remove'})]};
 const calls=[],call=async(operation,args)=>{calls.push(operation);return operation==='itemState'?{state:args.mediaKey==='a'?'in_trash':'unknown'}:args.cursor?{items:[{mediaKey:'alternate',dedupKey:'stable'}],nextPageId:null}:{items:[],nextPageId:'next'};};
 const result=await reconcileReviewTrash(state,call);assert.deepEqual(result.items.map(i=>i.state),['in_trash','in_trash','active']);assert.deepEqual(calls,['trashPage','trashPage','itemState','itemState']);assert.equal(state.items[0].state,'active');
 await assert.rejects(readReviewTrash(async()=>({items:[],nextPageId:'loop'})),/repeated/);
 await assert.rejects(reconcileReviewTrash({...state,job:{}},call),/Finish/);
});
test('built userscript metadata, page isolation, privileged pairing storage and reproducible artifact',async()=>{
 const source=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8');
 const url='https://photoswiper-sync.sidlakkoju.workers.dev/photoswiper.user.js';
 for(const entry of ['@match https://photos.google.com/*','@run-at document-idle','@grant GM.getValue','@grant GM.setValue','@grant GM.deleteValue','@grant unsafeWindow','@inject-into content',`@updateURL ${url}`,`@downloadURL ${url}`])assert.ok(source.includes(`// ${entry}\n`));
 assert.match(source,/\/\/ @version \d+\.\d+\.\d+\n/);assert.doesNotMatch(source,/chrome\.|localhost|photos-swipe-request/);
 assert.match(source,/attachShadow\(\{mode:'open'\}\)/);assert.ok(source.indexOf('const cardElement=')<source.indexOf('const statsElement='));
 const body=source.slice(source.indexOf('// ==/UserScript==')+'// ==/UserScript=='.length);assert.doesNotMatch(body,/^\s*\/\/|\/\*/m);
 new vm.Script(source);
 const mounted=bundleEnvironment();
 vm.runInNewContext(source,mounted.environment);
 assert.equal(mounted.hosts.length,1);assert.equal(mounted.shadowMode,'open');
 assert.equal(mounted.nodes.get('running-version').textContent,'v'+/^\/\/ @version (\S+)$/m.exec(source)[1]);
 for(const field of ['updateURL','downloadURL'])assert.deepEqual([...source.slice(0,source.indexOf('// ==/UserScript==')).matchAll(new RegExp('^// @'+field+' (.*)$','gm'))].map(match=>match[1]),[url]);
 assert.equal(typeof mounted.nodes.get('launcher').onclick,'function');
 assert.match(mounted.root.childNodes[0].childNodes[0].textContent,/#zoom\{[^}]*min-height:44px/);
 assert.doesNotMatch(source,/innerHTML|outerHTML|insertAdjacentHTML/);
 const metadata=source.slice(0,source.indexOf('// ==/UserScript=='));
 for(const line of metadata.trim().split('\n').slice(1))assert.match(line,/^\/\/ @/);
 vm.runInNewContext(source,mounted.environment);assert.equal(mounted.hosts.length,1);
 const result=spawnSync(process.execPath,['scripts/build-userscript.mjs','--check'],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
});
test('rebuilt panel version follows a metadata version bump',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'photos-version-'));
 try{
  for(const name of ['scripts','lib','extension','public'])await cp(new URL('../'+name,import.meta.url),join(directory,name),{recursive:true});
  const builderPath=join(directory,'scripts/build-userscript.mjs');
  const builder=await readFile(builderPath,'utf8');
  const version='9.8.7';
  await writeFile(builderPath,builder.replace(/^\/\/ @version .*$/gm,'// @version '+version));
  const result=spawnSync(process.execPath,[builderPath],{cwd:directory,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const source=await readFile(join(directory,'userscript/photoswiper.user.js'),'utf8');
  const metadataVersion=/^\/\/ @version (\S+)$/m.exec(source)[1];
  assert.equal(metadataVersion,version);
  const mounted=bundleEnvironment();
  vm.runInNewContext(source,mounted.environment);
  assert.equal(mounted.nodes.get('running-version').textContent,'v'+metadataVersion);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('userscript installed without UTF-8 decoding preserves Unicode UI labels',async()=>{
 const bytes=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url));
 assert.ok(bytes.every(byte=>byte<128),'Installable userscript must contain only ASCII bytes');
 const mounted=bundleEnvironment();
 vm.runInNewContext(bytes.toString('latin1'),mounted.environment);
 await mounted.nodes.get('launcher').onclick();
 assert.equal(mounted.nodes.get('remove').textContent,'\u00d7 Queue');
 assert.equal(mounted.nodes.get('keep').textContent,'\u2713 Keep');
 assert.match(mounted.nodes.get('stats').textContent,/ to review \u00b7 /);
});
test('unreadable legacy albums retain their target with title-sensitive lookup and resume safely',async()=>{
 const workspace=albumWorkspace([item('a',{decision:'remove'}),item('sent',{decision:'remove',queueSent:true,albumKey:'legacy'})]);
 await workspace.save({...workspace.state(),albumKey:'legacy'});
 const calls=[],legacyTitle='Photos Swipe · Review · 9c2a3f30466c';let unreadable=true,added=false;
 const call=async(operation,args)=>{
  calls.push({operation,args});
  if(operation==='albumMembers'){assert.equal(args.albumKey,'legacy');if(unreadable)throw Error('Fake read failure');return {keys:added?['a','sent']:['sent'],dedupKeys:[]};}
  if(operation==='findAlbum')return {albumKey:args.title===legacyTitle?'legacy':null};
  if(operation==='createAlbum')throw Error('Unexpected duplicate album');
  if(operation==='addToAlbum'){assert.equal(args.albumKey,'legacy');added=true;}
 };
 await assert.rejects(sendReviewAlbum({...workspace,call,title:'Photos Swipe · Review'}),/read failure/);
 assert.equal(workspace.state().albumKey,'legacy');assert.equal(workspace.state().job.albumKey,'legacy');
 assert.equal(reviewQueue(workspace.state()).length,1);assert.equal(workspace.state().items[1].queueSent,true);
 assert.deepEqual(calls.map(entry=>entry.operation),['albumMembers','findAlbum']);
 unreadable=false;await sendReviewAlbum({...workspace,call,title:'Photos Swipe · Review'});
 assert.equal(workspace.state().albumKey,'legacy');assert.equal(workspace.state().job,null);assert.equal(reviewQueue(workspace.state()).length,0);
});
test('missing saved albums recreate under their original job title and finish the queue',async()=>{
 const workspace=albumWorkspace([item('a',{decision:'remove'})]);
 const title='Photos Swipe · Review · 9c2a3f30466c',calls=[];let added=false;
 await workspace.save({...workspace.state(),albumKey:'missing',job:{title,mediaKeys:['a'],albumKey:'missing'}});
 const call=async(operation,args)=>{
  calls.push({operation,args});
  if(operation==='albumMembers'){
   if(args.albumKey==='missing')throw Error('Album is gone');
   assert.equal(args.albumKey,'replacement');return {keys:added?['a']:[],dedupKeys:[]};
  }
  if(operation==='findAlbum'){assert.equal(args.title,title);return {albumKey:null};}
  if(operation==='createAlbum'){assert.equal(args.title,title);return {albumKey:'replacement'};}
  if(operation==='addToAlbum'){assert.equal(args.albumKey,'replacement');added=true;}
 };
 await sendReviewAlbum({...workspace,call,title:'Photos Swipe · Review'});
 assert.equal(workspace.state().albumKey,'replacement');assert.equal(workspace.state().job,null);
 assert.equal(reviewQueue(workspace.state()).length,0);
 assert.equal(calls.filter(entry=>entry.operation==='createAlbum').length,1);
});
test('failed saved album reads preserve the key when title lookup finds any album',async()=>{
 for(const foundKey of ['saved','different']){
  const workspace=albumWorkspace([item('a',{decision:'remove'})]);
  const title='Photos Swipe · Review · 9c2a3f30466c',calls=[];
  await workspace.save({...workspace.state(),albumKey:'saved',job:{title,mediaKeys:['a'],albumKey:'saved'}});
  const call=async(operation,args)=>{
   calls.push(operation);
   if(operation==='albumMembers')throw Error('Read failed');
   if(operation==='findAlbum'){assert.equal(args.title,title);return {albumKey:foundKey};}
   throw Error('Unexpected album mutation');
  };
  await assert.rejects(sendReviewAlbum({...workspace,call,title:'Photos Swipe · Review'}),/Read failed/);
  assert.equal(workspace.state().job.albumKey,'saved');assert.equal(workspace.state().albumKey,'saved');
  assert.deepEqual(calls,['albumMembers','findAlbum']);
 }
});
test('fake library scanning passes reviewed overlaps and retains a bounded continuation',async()=>{
 const {loadReviewPages}=await import('../lib/userscript-core.mjs');
 const reviewed=Array.from({length:50},(_,i)=>item(`r${i}`,{decision:'keep'}));const workspace=albumWorkspace(reviewed),cursors=[];
 const call=async(operation,args)=>{cursors.push(args.cursor);return cursors.length<3?{items:reviewed,nextPageId:`page${cursors.length}`}:{items:Array.from({length:50},(_,i)=>item(`n${i}`)),nextPageId:'older'};};
 const result=await loadReviewPages({...workspace,call});assert.equal(result.added,50);assert.equal(result.scanned,150);assert.deepEqual(cursors,[null,'page1','page2']);
 let limitPage=0;const limited=await loadReviewPages({...workspace,call:async()=>({items:reviewed,nextPageId:`limit${++limitPage}`}),maxPages:2});assert.equal(limited.limited,true);assert.equal(limited.added,0);
});
test('repeated library cursors do not commit their page, and refresh reads only one page',async()=>{
 const {loadReviewPages}=await import('../lib/userscript-core.mjs');const workspace=albumWorkspace([]);let count=0;
 await assert.rejects(loadReviewPages({...workspace,call:async()=>{count++;return {items:[item(`x${count}`)],nextPageId:'loop'};}}),/repeated/);
 assert.equal(workspace.state().items.length,1);assert.equal(workspace.state().cursor,'loop');
 count=0;await loadReviewPages({...workspace,refresh:true,call:async()=>{count++;return {items:[item('latest')],nextPageId:'head'};}});
 assert.equal(count,1);assert.equal(workspace.state().cursor,'loop');
});
function fakeIndexedDB(fault={}) {
 const stores=new Map();let initialized=false;
 const database={
  objectStoreNames:{contains:name=>stores.has(name)},
  createObjectStore:name=>stores.set(name,new Map()),close(){},
  transaction(name){
   const staged=new Map(stores.get(name));let aborted=false,wrote=false,releaseGate;
   const tx={objectStore:()=>({
    get(key){const request={};queueMicrotask(()=>{request.result=structuredClone(staged.get(key));request.onsuccess();queueMicrotask(async()=>{if(name==='accounts'&&fault.holdSave&&[...staged.values()].some(value=>value.items?.some(row=>row.decision)))await fault.holdSave;if(wrote&&name==='accounts'&&fault.saveGate)await fault.saveGate;if(releaseGate)await releaseGate;if(!aborted){stores.set(name,staged);tx.oncomplete();}});});return request;},
    delete:key=>staged.delete(key),
    put:(value,key)=>{if(name==='leases')fault.leaseWrites=(fault.leaseWrites||0)+1;if(name==='leases'&&fault.failLease)throw Error('Fake lease failure');if(name==='accounts'&&fault.failSave)throw Error('Fake storage failure');wrote=true;if(name==='leases'&&value.expires===0)releaseGate=fault.releaseGate;staged.set(key,structuredClone(value));}
   }),abort(){aborted=true;queueMicrotask(()=>tx.onabort());}};
   return tx;
  }
 };
 return {open(){const request={result:database};queueMicrotask(()=>{if(!initialized){initialized=true;request.onupgradeneeded();}request.onsuccess();});return request;}};
}
test('fake IndexedDB persists account-isolated progress and rejects stale revisions and foreign leases',async()=>{
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs'),indexedDB=fakeIndexedDB();
 const first=await openReviewDatabase(indexedDB),initial=await first.read('account-a');
 const saved=await first.save('account-a',{...initial,cursor:'older',items:[item('a',{decision:'keep'})]});assert.equal(saved.revision,1);
 await first.saveSettings({url:'https://sync.example',token:'synthetic-token'});
 const reopened=await openReviewDatabase(indexedDB);assert.deepEqual(await reopened.settings(),{url:'https://sync.example',token:'synthetic-token'});assert.deepEqual(await reopened.read('account-a'),saved);assert.deepEqual(await reopened.read('account-b'),emptyReview());
 await assert.rejects(first.save('account-a',initial),/another tab/);assert.deepEqual(await first.read('account-a'),saved);
 await first.lease('account-a','owner-a');await assert.rejects(reopened.lease('account-a','owner-b'),/busy/);
 await reopened.lease('account-b','owner-b');await first.lease('account-a','owner-a',true);await reopened.lease('account-a','owner-b');
});
test('item revisions prevent stale undo after another tab changes or sends the same decision',()=>{
 let state={...emptyReview(),items:[item('a')]};
 state=decideReview(state,'a','remove',null,0);state=decideReview(state,'a','keep','remove',1);state=decideReview(state,'a','remove','keep',2);
 assert.throws(()=>decideReview(state,'a',null,'remove',1),/changed/);
 const completed=finishReviewAlbum({...state,job:{albumKey:'album',mediaKeys:['a']}},{keys:['a'],dedupKeys:[]});
 assert.throws(()=>decideReview(completed,'a',null,'remove',3),/changed/);assert.equal(completed.items[0].queueSent,true);
});

function bundleEnvironment(fault={}) {
 const nodes=new Map(),hosts=[];
 const element=tag=>({contains(node){return this===node||this.childNodes.some(child=>child.contains?.(node));},tagName:tag.toUpperCase(),style:{},dataset:{},childNodes:[],hidden:false,value:'',classList:{values:new Set(),remove(name){this.values.delete(name);},toggle(name,force){if(force===false||(force===undefined&&this.values.has(name)))this.values.delete(name);else this.values.add(name);},contains(name){return this.values.has(name);}},append(...children){this.childNodes.push(...children);},insertBefore(child,before){this.childNodes.splice(this.childNodes.indexOf(before),0,child);},replaceChildren(...children){this.childNodes=children;},querySelector(tag){return this.childNodes.find(node=>node.tagName===tag.toUpperCase())||null;},setAttribute(key,value){this[key]=value;if(key==='id'){nodes.set(value,this);if(['queue-details','history-details'].includes(value))this.open=true;}if(key==='value')this.value=value;},listeners:{},addEventListener(name,handler){this.listeners[name]=handler;},setPointerCapture(){},focus(){root.activeElement=this;},getBoundingClientRect(){return {width:this.id==='media'?820:300,height:440};},decode(){return Promise.resolve();},paused:true,play(){this.paused=false;this.playCalls=(this.playCalls||0)+1;return Promise.resolve();},pause(){this.paused=true;this.pauseCalls=(this.pauseCalls||0)+1;},removeAttribute(key){delete this[key];},load(){}});

 const root={childNodes:[],append(...children){this.childNodes.push(...children);},getElementById:id=>nodes.get(id),querySelectorAll:()=>[...nodes.values()].filter(node=>['BUTTON','SELECT'].includes(node.tagName))};
 Object.defineProperty(root,'innerHTML',{set(){throw new TypeError('TrustedHTML required');}});
 const result={nodes,hosts,root};
 const document={listeners:{},addEventListener(name,handler){this.listeners[name]=handler;},createTextNode:textContent=>({textContent}),getElementById:id=>hosts.find(host=>host.id===id),createElement:tag=>{const node=element(tag);if(tag==='select')node.value='';const append=node.append;node.append=function(...children){append.call(this,...children);if(tag==='select'&&!this.value)this.value=children[0].value;};node.attachShadow=options=>{result.shadowMode=options.mode;return root;};return node;},documentElement:{dataset:{},append:host=>hosts.push(host)}};
 const events=new EventTarget();
 const window={dispatchEvent:event=>events.dispatchEvent(event),WIZ_global_data:{...tokens},crypto:webcrypto,indexedDB:fakeIndexedDB(fault),fetch:async()=>{throw Error('Unexpected fake network request');},setTimeout,clearTimeout,AbortController,listeners:{},addEventListener(name,handler){this.listeners[name]=handler;events.addEventListener(name,handler);}};window.top=window;
 result.environment={window,document,location:{...page},structuredClone,Date,URL,URLSearchParams,TextEncoder,Uint8Array,AbortController,AbortSignal,setInterval,clearInterval};
 return result;
}
test('library sightings restore active state and retain local album membership on load and refresh',()=>{
 for(const refresh of [false,true]){
  const state={...emptyReview(),items:[item('queued',{decision:'remove',state:'in_trash',albumKey:'album',revision:4}),item('unreviewed',{state:'in_trash'}),item('sent',{decision:'remove',queueSent:true,albumKey:'album'})]};
  const merged=mergeReviewPage(state,{items:state.items.map(row=>item(row.mediaKey)),nextPageId:null},null,refresh);
  assert.deepEqual(merged.items.map(row=>row.state),['active','active','active']);assert.equal(merged.items[0].albumKey,'album');assert.equal(merged.items[0].revision,5);
  assert.deepEqual(reviewQueue(merged).map(row=>row.mediaKey),['queued']);assert.deepEqual(reviewDeck(merged).map(row=>row.mediaKey),['unreviewed']);assert.equal(merged.items[2].queueSent,true);
 }
});
test('Trash reconciliation covers kept and undecided rows and verifies their restoration',async()=>{
 const state={...emptyReview(),items:[item('kept',{decision:'keep'}),item('new',{dedupKey:'stable'}),item('other')]};
 const marked=await reconcileReviewTrash(state,async operation=>operation==='itemState'?{state:'in_trash'}:{items:[{mediaKey:'kept'},{mediaKey:'alternate',dedupKey:'stable'}],nextPageId:null});
 assert.deepEqual(marked.items.map(row=>row.state),['in_trash','in_trash','active']);assert.deepEqual(reviewDeck(marked).map(row=>row.mediaKey),['other']);
 const restored=await reconcileReviewTrash(marked,async operation=>operation==='trashPage'?{items:[],nextPageId:null}:{state:'active'});
 assert.deepEqual(restored.items.map(row=>row.state),['active','active','active']);assert.equal(restored.items[0].decision,'keep');assert.equal(restored.items[1].revision,2);
});
test('dedup-only Trash matches require item-specific confirmation and repair false positives',async()=>{
 const state={...emptyReview(),items:[
  item('active',{dedupKey:'shared',revision:3}),
  item('unknown',{dedupKey:'shared'}),
  item('removed',{decision:'remove',dedupKey:'shared',queueSent:true}),
  item('kept',{decision:'keep',dedupKey:'shared'}),
  item('misclassified',{dedupKey:'shared',state:'in_trash',revision:7}),
  item('unresolved',{dedupKey:'shared',state:'in_trash'}),
  item('exact',{dedupKey:'shared'}),
  item('unmatched')
 ]};
 const checked=[],call=async(operation,args)=>{
  if(operation==='trashPage')return {items:[{mediaKey:'old-copy',dedupKey:'shared'},{mediaKey:'exact'}],nextPageId:null};
  assert.equal(operation,'itemState');checked.push(args.mediaKey);
  return {state:['unknown','unresolved'].includes(args.mediaKey)?'unknown':args.mediaKey==='removed'?'in_trash':'active'};
 };
 const result=await reconcileReviewTrash(state,call);
 assert.deepEqual(checked,['active','unknown','removed','kept','misclassified','unresolved']);
 assert.deepEqual(result.items.map(row=>row.state),['active','active','in_trash','active','active','in_trash','in_trash','active']);
 assert.deepEqual(reviewDeck(result).map(row=>row.mediaKey),['active','unknown','misclassified','unmatched']);
 assert.equal(result.items[0].revision,3);assert.equal(result.items[1].revision,0);assert.equal(result.items[4].revision,8);
 assert.equal(result.items[2].decision,'remove');assert.equal(result.items[2].queueSent,true);assert.equal(result.items[3].decision,'keep');
 assert.equal(state.items[4].state,'in_trash');
 await assert.rejects(reconcileReviewTrash(state,async(operation,args)=>operation==='trashPage'?call(operation,args):Promise.reject(Error('Fake read failure'))),/Fake read failure/);
 assert.equal(state.items[0].state,'active');
});
test('undo eligibility rejects missing, trashed, revised and job-locked decisions',()=>{
 const entry={key:'a',decision:'keep',revision:1},state={...emptyReview(),items:[item('a',{decision:'keep',revision:1})]};
 assert.equal(canUndoReview(state,entry),true);
 for(const changed of [{...state,items:[]},{...state,items:[item('a',{decision:'keep',revision:2})]},{...state,items:[item('a',{decision:'keep',revision:1,state:'in_trash'})]},{...state,job:{mediaKeys:['a']}}])assert.equal(canUndoReview(changed,entry),false);
});
test('mounted bundle keeps album links and Undo responds before failed storage',async()=>{
 const source=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8'),mounted=bundleEnvironment();
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs'),fault={};
 mounted.environment.window.indexedDB=fakeIndexedDB(fault);
 const db=await openReviewDatabase(mounted.environment.window.indexedDB),account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 await db.save(account,{...emptyReview(),albumKey:'album',items:[item('a'),item('b')]});
 vm.runInNewContext(source,mounted.environment);await mounted.nodes.get('launcher').onclick();
 assert.equal(mounted.nodes.get('album').href,'https://photos.google.com/u/2/album/album');
 mounted.nodes.get('keep').onclick();await new Promise(resolve=>setTimeout(resolve,10));
 fault.failSave=true;mounted.nodes.get('undo').onclick();
 assert.match(mounted.nodes.get('caption').textContent,/^a · /);
 assert.equal(mounted.nodes.get('keep').disabled,false);
 await new Promise(resolve=>setTimeout(resolve,10));
 assert.match(mounted.nodes.get('status').textContent,/Local save failed.*pending changes/);
 assert.equal((await db.read(account)).items[0].decision,'keep');
 fault.failSave=false;mounted.nodes.get('keep').onclick();await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal((await db.read(account)).items[0].decision,'keep');
});
async function mountedReview(items,windowOverrides={},syncSettings,environmentOverrides={}) {
 const source=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8'),mounted=bundleEnvironment(syncSettings?.url?{}:syncSettings);
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs');
 if(typeof windowOverrides==='function')windowOverrides={fetch:windowOverrides};
 if(windowOverrides?.indexedDB)mounted.environment.window.indexedDB=windowOverrides.indexedDB;
 const db=await openReviewDatabase(mounted.environment.window.indexedDB),account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 await db.save(account,{...emptyReview(),items});
 if(syncSettings?.url)await db.saveSettings(syncSettings);
 Object.assign(mounted.environment.window,windowOverrides);Object.assign(mounted.environment,environmentOverrides);
 vm.runInNewContext(source,mounted.environment);await mounted.nodes.get('launcher').onclick();
 const settle=async()=>{await new Promise(resolve=>setTimeout(resolve,10));for(let count=0;count<100;count++){await new Promise(resolve=>setTimeout(resolve,1));if(mounted.nodes.get('overlay')['aria-busy']==='false')return;}throw Error('Fake UI stayed busy');};
 const click=async id=>{mounted.nodes.get(id).onclick();await new Promise(resolve=>setTimeout(resolve,10));await settle();};
 return {...mounted,click,settle,read:()=>db.read(account)};
}
test('mounted undo restores undecided after queue, keep instead, and two undos',async()=>{
 const mounted=await mountedReview([item('a')]);
 await mounted.click('remove');
 mounted.nodes.get('queue').childNodes[0].onclick();
 await mounted.click('keep');
 assert.equal((await mounted.read()).items[0].decision,'keep');
 await mounted.click('undo');
 assert.equal((await mounted.read()).items[0].decision,'remove');
 assert.equal(mounted.nodes.get('queue').childNodes.length,1);
 assert.match(mounted.nodes.get('caption').textContent,/^Candidate inspection · a · /);
 assert.equal(mounted.nodes.get('keep').textContent,'Keep instead');
 await mounted.click('undo');
 const state=await mounted.read();
 assert.equal(state.items[0].decision,null);assert.equal(state.items[0].revision,4);
 assert.equal(mounted.nodes.get('queue').childNodes.length,0);
 assert.equal(mounted.nodes.get('status').textContent,'Decision undone for a.');
});
test('mounted oldest-first puts missing dates at the epoch before dated media',async()=>{
 const mounted=await mountedReview([item('dated',{date:'1990-01-01T00:00:00.000Z'}),item('missing')]);
 mounted.nodes.get('sort').value='oldest';mounted.nodes.get('sort').onchange();
 assert.match(mounted.nodes.get('caption').textContent,/^missing · Unknown date · Unknown size$/);
 await mounted.click('keep');
 assert.match(mounted.nodes.get('caption').textContent,/^dated · /);
 assert.deepEqual((await mounted.read()).items.map(row=>row.decision),[null,'keep']);
});
test('Trash writes require confirmation and bounded valid stable identifiers',async()=>{
 const f=fixture(()=>[]);
 for(const args of [{dedupKeys:['stable']},{confirmed:true,dedupKeys:[]},{confirmed:true,dedupKeys:['bad/key']},{confirmed:true,dedupKeys:Array(26).fill('stable')}])assert.equal((await f.api('moveToTrash',args)).ok,false);
 assert.equal(f.calls.length,0);
 assert.equal((await call(f,'moveToTrash',{confirmed:true,dedupKeys:['stable']})).requested,1);
 assert.equal(f.calls[0].id,'XwAOJf');assert.deepEqual(f.calls[0].args,[null,1,['stable'],3]);
});
test('mounted undo survives a fresh script instance with the same IndexedDB',async()=>{
 const first=await mountedReview([item('a',{size:1}),item('b',{size:100})]);await first.click('keep');
 await first.nodes.get('close').onclick();const second=bundleEnvironment();second.environment.window.indexedDB=first.environment.window.indexedDB;
 const source=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8');
 vm.runInNewContext(source,second.environment);await second.nodes.get('launcher').onclick();
 second.nodes.get('sort').value='largest';second.nodes.get('sort').onchange();
 assert.match(second.nodes.get('caption').textContent,/^b · /);
 second.nodes.get('undo').onclick();
 await new Promise(resolve=>setTimeout(resolve,10));for(let count=0;count<100&&second.nodes.get('keep').disabled;count++)await new Promise(resolve=>setTimeout(resolve,1));
 assert.equal((await first.read()).items[0].decision,null);assert.equal((await first.read()).history.length,0);
 assert.equal(second.nodes.get('status').textContent,'Decision undone for a.');
 assert.match(second.nodes.get('caption').textContent,/^a · /);
 assert.equal(second.nodes.get('media').childNodes[0].alt,'a');
 second.nodes.get('keep').onclick();
 await new Promise(resolve=>setTimeout(resolve,10));for(let count=0;count<100&&second.nodes.get('keep').disabled;count++)await new Promise(resolve=>setTimeout(resolve,1));
 assert.deepEqual((await first.read()).items.map(row=>row.decision),['keep',null]);
 assert.match(second.nodes.get('caption').textContent,/^b · /);
});
test('mounted Trash is opt-in, confirms the exact count and verifies synthetic Trash',async()=>{
 const mounted=await mountedReview([item('a',{decision:'remove',dedupKey:'stable'})]);const requests=[],prompts=[];
 mounted.environment.window.fetch=async(url,options)=>{const entry=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0];requests.push(entry[0]);return {ok:true,text:async()=>envelope(entry[0],entry[0]==='XwAOJf'?[]:[[['a',null,null,'stable']],null])};};
 assert.equal(mounted.nodes.get('move-trash').hidden,true);await mounted.click('move-trash');assert.equal(requests.length,0);
 mounted.nodes.get('trash-opt-in').checked=true;mounted.nodes.get('trash-opt-in').onchange();
 mounted.environment.window.confirm=prompt=>{prompts.push(prompt);return false;};await mounted.click('move-trash');assert.equal(requests.length,0);assert.match(prompts[0],/exactly 1 items/);
 mounted.environment.window.confirm=()=>true;
 const source=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8');
 await mounted.nodes.get('close').onclick();const second=bundleEnvironment();second.environment.window.indexedDB=mounted.environment.window.indexedDB;second.environment.window.fetch=mounted.environment.window.fetch;second.environment.window.confirm=()=>true;
 vm.runInNewContext(source,second.environment);await second.nodes.get('launcher').onclick();second.nodes.get('trash-opt-in').checked=true;second.nodes.get('trash-opt-in').onchange();second.nodes.get('move-trash').onclick();
 await new Promise(resolve=>setTimeout(resolve,10));for(let count=0;count<100&&second.nodes.get('keep').disabled;count++)await new Promise(resolve=>setTimeout(resolve,1));
 assert.deepEqual(requests,['XwAOJf','zy0IHe']);assert.equal((await mounted.read()).items[0].state,'in_trash');
});
test('Trash completion status resets on reload and cached-page restore while estimates retain a running total',async()=>{
 const candidates=Array.from({length:5},(_,index)=>item(`fake-${index}`,{decision:'remove',dedupKey:`stable-${index}`,spaceTaken:11400}));
 const fetch=async(url,options)=>{
  const entry=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0];
  assert.ok(['XwAOJf','zy0IHe'].includes(entry[0]));
  return {ok:true,text:async()=>envelope(entry[0],entry[0]==='XwAOJf'?[]:[[['previous'],...candidates.map(row=>[row.mediaKey,null,null,row.dedupKey])],null])};
 };
 const mounted=await mountedReview([item('previous',{decision:'remove',state:'in_trash',spaceTaken:55000}),...candidates],{fetch,confirm:()=>true});
 const ready='Ready. Decisions are saved locally on this browser.';
 assert.match(mounted.nodes.get('stats').textContent,/In Trash: 55 KB \(running total\)$/);
 mounted.nodes.get('trash-opt-in').checked=true;mounted.nodes.get('trash-opt-in').onchange();
 await mounted.click('move-trash');
 assert.equal(mounted.nodes.get('status').textContent,'Verified 5 items in Trash.');
 assert.match(mounted.nodes.get('stats').textContent,/In Trash: 112 KB \(running total\)$/);
 await mounted.environment.window.listeners.pageshow({persisted:true});
 assert.equal(mounted.nodes.get('status').textContent,ready);
 assert.match(mounted.nodes.get('stats').textContent,/In Trash: 112 KB \(running total\)$/);
 await mounted.nodes.get('close').onclick();const reloaded=bundleEnvironment();reloaded.environment.window.indexedDB=mounted.environment.window.indexedDB;
 vm.runInNewContext(await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8'),reloaded.environment);
 await reloaded.nodes.get('launcher').onclick();
 assert.equal(reloaded.nodes.get('status').textContent,ready);
 assert.match(reloaded.nodes.get('stats').textContent,/In Trash: 112 KB \(running total\)$/);
 assert.equal(reloaded.nodes.get('move-trash').textContent,'Move 0 items to Trash');
});
test('mounted Trash and deleted-item checks retain all 45 undecided items despite six older dedup matches',async()=>{
 for(const action of ['move-trash','trash']){
  const undecided=Array.from({length:45},(_,index)=>item(`new-${index}`,{dedupKey:`stable-${index}`}));
  const reviewed=Array.from({length:5},(_,index)=>item(`reviewed-${index}`,{decision:'remove',dedupKey:`removed-${index}`,queueSent:true}));
  const requests=[],fetch=async(url,options)=>{
   const entry=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0],args=JSON.parse(entry[1]);requests.push(entry[0]);
   let data;
   if(entry[0]==='XwAOJf'){assert.deepEqual(args,[null,1,reviewed.map(row=>row.dedupKey),3]);data=[];}
   else if(entry[0]==='zy0IHe')data=[[...undecided.slice(0,6).map(row=>[`old-${row.mediaKey}`,null,null,row.dedupKey]),...reviewed.map(row=>[row.mediaKey,null,null,row.dedupKey])],null];
   else {assert.equal(entry[0],'VrseUb');assert.ok(undecided.slice(0,6).some(row=>row.mediaKey===args[0]));data=[[args[0],{225032867:[0]}]];}
   return {ok:true,text:async()=>envelope(entry[0],data)};
  };
  const mounted=await mountedReview([...undecided,...reviewed],fetch);
  mounted.environment.window.confirm=()=>true;
  mounted.nodes.get('trash-opt-in').checked=true;mounted.nodes.get('trash-opt-in').onchange();
  await mounted.click(action);
  const state=await mounted.read();
  assert.equal(reviewDeck(state).length,45);assert.match(mounted.nodes.get('stats').textContent,/^45 to review/);
  assert.ok(state.items.slice(0,45).every(row=>row.state==='active'&&row.decision===null&&(row.revision||0)===0));
  assert.ok(state.items.slice(45).every(row=>row.state==='in_trash'&&row.decision==='remove'&&row.queueSent));
  assert.deepEqual(requests,[...(action==='move-trash'?['XwAOJf']:[]),'zy0IHe',...Array(6).fill('VrseUb')]);
 }
});
test('sent candidates remain listed for Trash after the removal queue clears and reloads',async()=>{
 const sent=Array.from({length:5},(_,index)=>item(`QA-DUMMY-${index}`,{decision:'remove',queueSent:true,dedupKey:`stable-${index}`}));
 const mounted=await mountedReview([...sent,item('kept',{decision:'keep'}),item('trashed',{decision:'remove',state:'in_trash'}),item('undecided')]);
 const enable=target=>{target.nodes.get('trash-opt-in').checked=true;target.nodes.get('trash-opt-in').onchange();};
 const listed=target=>target.nodes.get('trash-candidates-list').childNodes.map(button=>button.childNodes[1].textContent);
 assert.equal(mounted.nodes.get('queue-title').textContent,'Removal queue (0)');
 assert.equal(mounted.nodes.get('trash-candidates').hidden,true);
 enable(mounted);
 assert.equal(mounted.nodes.get('trash-candidates').hidden,false);
 assert.equal(mounted.nodes.get('move-trash').textContent,'Move 5 items to Trash');
 assert.equal(mounted.nodes.get('trash-candidates-title').textContent,'Move to Trash candidates (5)');
 assert.deepEqual(listed(mounted),sent.map(row=>`${row.name} · photo · Unknown date · Sent to review album · ID: ${row.mediaKey}`));
 let prompt;
 mounted.environment.window.confirm=value=>{prompt=value;assert.equal(listed(mounted).length,5);return false;};
 await mounted.click('move-trash');
 assert.match(prompt,/exactly 5 items/);
 for(const row of sent)assert.ok(prompt.includes(`${row.name} (ID: ${row.mediaKey})`));
 assert.deepEqual((await mounted.read()).items.slice(0,5),sent);
 mounted.nodes.get('trash-candidates-list').childNodes[0].onclick();
 assert.match(mounted.nodes.get('caption').textContent,/Candidate inspection · QA-DUMMY-0/);
 await mounted.click('keep');
 assert.equal(listed(mounted).length,4);assert.equal(mounted.nodes.get('move-trash').textContent,'Move 4 items to Trash');
 await mounted.nodes.get('close').onclick();const second=bundleEnvironment();second.environment.window.indexedDB=mounted.environment.window.indexedDB;
 vm.runInNewContext(await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8'),second.environment);
 await second.nodes.get('launcher').onclick();enable(second);
 assert.deepEqual(listed(second),listed(mounted));assert.equal(second.nodes.get('queue').childNodes.length,0);
});
test('Trash candidate list includes queued and sent items regardless of review filters',async()=>{
 const mounted=await mountedReview([item('queued',{decision:'remove',type:'video'}),item('sent',{decision:'remove',queueSent:true}),item('kept',{decision:'keep'}),item('trashed',{decision:'remove',state:'in_trash'})]);
 mounted.nodes.get('filter').value='photo';mounted.nodes.get('filter').onchange();
 mounted.nodes.get('trash-opt-in').checked=true;mounted.nodes.get('trash-opt-in').onchange();
 const rows=mounted.nodes.get('trash-candidates-list').childNodes;
 assert.equal(rows.length,2);assert.match(rows[0].childNodes[1].textContent,/queued · video .* · Queued · ID: queued/);assert.match(rows[1].childNodes[1].textContent,/Sent to review album · ID: sent/);
 assert.equal(mounted.nodes.get('move-trash').textContent,'Move 2 items to Trash');
 mounted.nodes.get('trash-opt-in').checked=false;mounted.nodes.get('trash-opt-in').onchange();
 assert.equal(mounted.nodes.get('trash-candidates').hidden,true);assert.equal(mounted.nodes.get('move-trash').hidden,true);
});
for(const mediaType of ['IMG','VIDEO'])test(`shadow overlay puts the card above stats and ${mediaType} touch swipes persist decisions`,async()=>{
 const mounted=await mountedReview([item('a')]);assert.equal(mounted.shadowMode,'open');
 const content=mounted.nodes.get('overlay').childNodes[0];assert.ok(content.childNodes.indexOf(mounted.nodes.get('card'))<content.childNodes.indexOf(mounted.nodes.get('stats')));
 mounted.nodes.get('card').offsetWidth=280;
 const media=mounted.nodes.get('media');media.listeners.pointerdown({isPrimary:true,button:0,target:{tagName:mediaType,getBoundingClientRect:()=>({bottom:300})},pointerId:1,clientX:20,clientY:20});media.listeners.pointermove({pointerId:1,clientX:120,clientY:25,preventDefault(){}});media.listeners.pointerup({pointerId:1,clientX:140,clientY:25});
 await waitForReview(async()=>(await mounted.read()).items[0].decision==='keep');

 assert.equal((await mounted.read()).items[0].decision,'keep');assert.equal((await mounted.read()).history.length,1);
});

function swipeEvent(overrides={}) {
 return {isPrimary:true,button:0,target:{tagName:'VIDEO'},pointerId:1,clientX:20,clientY:20,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},stopImmediatePropagation(){this.stopped=true;},...overrides};
}
test('zoomed photos allow touch panning without swiping and reset for the next photo',async()=>{
 const mounted=await mountedReview([item('a'),item('b')]);
 const {nodes}=mounted,card=nodes.get('card'),media=nodes.get('media'),zoom=nodes.get('zoom');
 const css=mounted.root.childNodes[0].childNodes[0].textContent;
 assert.match(css,/\.card\.zoomed,\.card\.zoomed \.media\{touch-action:pan-x pan-y pinch-zoom\}/);
 assert.match(css,/\.card\.zoomed \.media img\{pointer-events:auto\}/);
 assert.equal(card.classList.contains('expanded'),false);
 for(const value of ['2','2.5','1','3']){
  zoom.value=value;zoom.oninput();
  assert.equal(card.classList.contains('zoomed'),Number(value)>1);
 }
 const image=media.querySelector('img');
 assert.equal(image.style.touchAction,'pan-x pan-y pinch-zoom');
 media.setPointerCapture=()=>assert.fail('Zoomed photos must keep native touch panning');
 media.listeners.pointerdown(swipeEvent({target:image,pointerType:'touch'}));
 const move=swipeEvent({target:image,clientX:120});media.listeners.pointermove(move);
 media.listeners.pointerup(swipeEvent({target:image,clientX:120}));
 assert.equal(move.prevented,undefined);
 assert.equal((await mounted.read()).history.length,0);
 await mounted.click('keep');
 assert.equal(zoom.value,'1');
 assert.equal(card.classList.contains('zoomed'),false);
});

test('swipes lock direction after slop and cancellation releases capture without deciding',async()=>{
 for(const scenario of ['vertical','cancel','short','other-pointer']){
  const mounted=await mountedReview([item('synthetic')]),media=mounted.nodes.get('media');
  let captured=false,captures=0,releases=0;
  media.setPointerCapture=id=>{assert.equal(id,1);captured=true;captures++;};
  media.hasPointerCapture=()=>captured;
  media.releasePointerCapture=()=>{captured=false;releases++;};
  media.listeners.pointerdown(swipeEvent());assert.equal(captures,0);
  const slop=swipeEvent({clientX:25,clientY:24});media.listeners.pointermove(slop);
  assert.equal(captures,0);assert.equal(slop.prevented,undefined);
  if(scenario==='vertical'){
   const vertical=swipeEvent({clientX:24,clientY:35});media.listeners.pointermove(vertical);
   assert.equal(vertical.prevented,undefined);
   media.listeners.pointermove(swipeEvent({clientX:150,clientY:35}));
   assert.equal(captures,0);
  }else{
   const move=swipeEvent({clientX:scenario==='short'?40:150});media.listeners.pointermove(move);
   assert.equal(captures,1);assert.equal(move.prevented,true);assert.match(mounted.nodes.get('card').childNodes.find(node=>node.class==='top-card').style.transform,/translate3d/);
   if(scenario==='other-pointer'){
    media.listeners.pointercancel(swipeEvent({pointerId:2}));assert.equal(captured,true);
   }
   if(scenario!=='short')media.listeners.pointercancel(swipeEvent());
  }
  media.listeners.pointerup(swipeEvent({clientX:scenario==='short'?40:150}));
  assert.equal(mounted.nodes.get('card').childNodes.find(node=>node.class==='top-card').style.transform,'');assert.equal(captured,false);
  assert.equal(releases,scenario==='vertical'?0:1);
  assert.equal((await mounted.read()).items[0].decision,null);
 }
});
test('touch drag, spring-back and outgoing copy share the card transform',async()=>{
 for(const surface of ['media','swipe'])for(const release of ['short','cancel','keep','remove']){
  const mounted=await mountedReview([item('synthetic-video',{type:'video'})]);
  const card=mounted.nodes.get('card').childNodes.find(node=>node.class==='top-card'),target=mounted.nodes.get(surface),media=mounted.nodes.get('media'),video=media.querySelector('video');
  const animations=[],copies=[],dx=release==='short'?20:release==='remove'?-120:120;
  const committing=release==='keep'||release==='remove',pose=`translate3d(${dx}px,0px,0) rotate(${dx/300*15}deg) scale(1.02)`;
  card.animate=(frames,options)=>{animations.push({frames,options});return {finished:Promise.resolve(),cancel(){}};};
  card.parentNode={append(copy){copies.push(copy);}};
  card.cloneNode=deep=>{
   assert.equal(deep,true);
   assert.equal(card.style.transform,pose);
   assert.equal(media.style.transform,undefined);
   assert.equal(mounted.nodes.get('swipe').style.transform,undefined);
   return {style:{},querySelectorAll:()=>[],removeAttribute(){},setAttribute(){},animate(frames,options){animations.push({frames,options});return {finished:Promise.resolve(),finish(){},cancel(){}};},remove(){}};
  };
  let captured=false;
  target.setPointerCapture=()=>{captured=true;};
  target.hasPointerCapture=()=>captured;
  target.releasePointerCapture=()=>{captured=false;};
  target.listeners.pointerdown(swipeEvent({target:surface==='media'?video:target,pointerType:'touch',timeStamp:0}));
  const move=swipeEvent({clientX:20+dx,timeStamp:200});
  target.listeners.pointermove(move);
  assert.equal(move.prevented,true);
  assert.equal(card.style.transform,pose);
  assert.equal(target.style.transform,undefined);
  target.listeners[release==='cancel'?'pointercancel':'pointerup'](swipeEvent({clientX:20+dx,timeStamp:400}));
  if(committing)await mounted.settle();
  assert.equal(captured,false);
  assert.equal(card.style.transform,'');
  assert.equal(animations.length,1);
  assert.equal(animations[0].frames[0].transform,pose);
  if(release==='short'||release==='cancel'){
   assert.equal(animations[0].frames[1].transform,'none');
   assert.equal(copies.length,0);
   assert.equal((await mounted.read()).items[0].decision,null);
  }else{
   assert.equal(copies.length,1);
   assert.match(copies[0].style.transform,/translate3d/);
   assert.match(animations[0].frames[1].transform,new RegExp(`translate3d\\(${dx>0?'':'-'}[0-9]+px,0,0\\) rotate`));
   await mounted.settle();
   assert.equal((await mounted.read()).items[0].decision,release);
  }
 }
});
test('video capture transfer preserves the swipe until media capture ends',async()=>{
 for(const cancel of [false,true]){
  const mounted=await mountedReview([item('video',{type:'video'})]),media=mounted.nodes.get('media'),video=media.querySelector('video');
  let captured=false;
  media.setPointerCapture=()=>{captured=true;};
  media.hasPointerCapture=()=>captured;
  media.releasePointerCapture=()=>{captured=false;};
  media.listeners.pointerdown(swipeEvent({target:video,pointerType:'touch'}));
  media.listeners.pointermove(swipeEvent({target:video,clientX:120}));
  media.listeners.lostpointercapture(swipeEvent({target:video}));
  assert.equal(captured,true);assert.equal(mounted.nodes.get('card').childNodes.find(node=>node.class==='top-card').style.transform,'translate3d(100px,0px,0) rotate(5deg) scale(1.02)');
  if(cancel){
   captured=false;
   media.listeners.lostpointercapture(swipeEvent({target:media}));
   assert.equal(mounted.nodes.get('card').childNodes.find(node=>node.class==='top-card').style.transform,'');
  }
  media.listeners.pointerup(swipeEvent({target:media,clientX:120}));
  await mounted.settle();
  assert.equal((await mounted.read()).items[0].decision,cancel?null:'keep');
 }
});
test('mouse capture delivers release outside either swipe surface during slop and allows the next swipe',async()=>{
 for(const surface of ['media','swipe']){
  const mounted=await mountedReview([item('mouse')]),target=mounted.nodes.get(surface);
  let captured=false;
  target.setPointerCapture=()=>{captured=true;};
  target.hasPointerCapture=()=>captured;
  target.releasePointerCapture=()=>{captured=false;};
  target.listeners.pointerdown(swipeEvent({target,pointerType:'mouse'}));
  assert.equal(captured,true);
  target.listeners.pointermove(swipeEvent({target,clientX:25,clientY:24}));
  if(captured)target.listeners.pointerup(swipeEvent({target,clientX:25,clientY:24}));
  assert.equal(captured,false);assert.equal((await mounted.read()).items[0].decision,null);
  target.listeners.pointerdown(swipeEvent({target,pointerType:'mouse'}));
  target.listeners.pointermove(swipeEvent({target,clientX:120}));
  target.listeners.pointerup(swipeEvent({target,clientX:120}));
  await mounted.settle();
  assert.equal((await mounted.read()).items[0].decision,'keep');
 }
});
test('deck videos support tap playback and swiping with native controls only when enlarged',async()=>{
 const mounted=await mountedReview([item('synthetic-video',{type:'video'}),item('next')],{fetch:async()=>({ok:true,text:async()=>envelope('VrseUb',[['synthetic-video'],'https://lh3.googleusercontent.com/synthetic-video'])})});
 const media=mounted.nodes.get('media'),video=media.querySelector('video');
 for(let count=0;count<100&&!video.src;count++)await new Promise(resolve=>setTimeout(resolve,1));
 assert.ok(video.src);assert.equal(video.controls,false);
 assert.equal(video.paused,false);
 media.listeners.click(swipeEvent());assert.equal(video.paused,true);
 media.listeners.click(swipeEvent());assert.equal(video.paused,false);
 mounted.nodes.get('enlarge').onclick();assert.equal(video.controls,true);
 media.listeners.pointerdown(swipeEvent());media.listeners.pointermove(swipeEvent({clientX:150}));media.listeners.pointerup(swipeEvent({clientX:150}));
 assert.equal((await mounted.read()).items[0].decision,null);
 mounted.nodes.get('enlarge').onclick();assert.equal(video.controls,false);
 media.listeners.pointerdown(swipeEvent());media.listeners.pointermove(swipeEvent({clientX:150}));media.listeners.pointerup(swipeEvent({clientX:150}));
 const click=swipeEvent();media.listeners.click(click);assert.equal(click.prevented,true);assert.equal(click.stopped,true);
 await mounted.settle();
 assert.equal((await mounted.read()).items[0].decision,'keep');
});
test('overlay isolates pointer touch wheel and all key events while preserving native defaults',async()=>{
 const mounted=await mountedReview([item('synthetic')]),overlay=mounted.nodes.get('overlay');
 for(const type of ['pointerdown','pointermove','pointerup','pointercancel','touchstart','touchmove','touchend','touchcancel','wheel','keydown','keyup','keypress']){
  const event=swipeEvent();overlay.listeners[type](event);assert.equal(event.stopped,true,type);assert.equal(event.prevented,undefined,type);
 }
 const drag=swipeEvent();overlay.listeners.dragstart(drag);assert.equal(drag.prevented,true);
 const source=await readFile(new URL('../lib/userscript-ui.mjs',import.meta.url),'utf8');
 assert.match(source,/\.card\{touch-action:pan-y;user-select:none;-webkit-user-select:none;-webkit-user-drag:none;-webkit-touch-callout:none/);
 assert.match(source,/\.media\{touch-action:pan-y;[^}]*overflow:auto/);
 assert.match(source,/\.card\.expanded \.media\{touch-action:pan-x pan-y pinch-zoom;/);
 assert.match(source,/\.media img\{pointer-events:none;/);assert.match(source,/overscroll-behavior:contain/);
});

test('obsolete userscript artifact is absent',async()=>{await assert.rejects(access(new URL('../userscript/photos-swipe.user.js',import.meta.url)),{code:'ENOENT'});});

test('mounted album completion and footer point to the panel Trash controls',async()=>{
 const requests=[];
 const fetch=async(url,options)=>{
  const entry=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0];requests.push(entry[0]);
  const data=entry[0]==='Z5xsfc'?[[],null]:entry[0]==='OXvT9d'?[['album']]:entry[0]==='snAcKc'?[null,requests.includes('E1Cajb')?[['a',null,null,'stable']]:[],null,['album']]:[];
  return {ok:true,text:async()=>envelope(entry[0],data)};
 };
 const mounted=await mountedReview([item('a',{decision:'remove'})],{fetch,confirm:()=>true});
 await mounted.click('send');
 assert.equal((await mounted.read()).items[0].queueSent,true);
 assert.equal(mounted.nodes.get('status').textContent,'Every candidate was verified in the review album. Select Enable Move to Trash below to use this panel, or open the review album to move items manually in Google Photos.');
 const content=mounted.nodes.get('overlay').childNodes[0],toolbar=content.childNodes.find(node=>node.childNodes.includes(mounted.nodes.get('move-trash'))),footer=toolbar.childNodes.find(node=>node.childNodes[0]?.textContent==='Swipes never delete media. Send candidates to a review album, or explicitly enable Move to Trash.');
 assert.equal(footer.childNodes[0].textContent,'Swipes never delete media. Send candidates to a review album, or explicitly enable Move to Trash.');
 assert.ok(content.childNodes.indexOf(mounted.nodes.get('status'))<content.childNodes.indexOf(toolbar));
 assert.ok(toolbar.childNodes.includes(footer));
 assert.equal(footer.class,'album-explanation');
 assert.ok(content.childNodes.indexOf(mounted.nodes.get('trash-candidates'))<content.childNodes.indexOf(toolbar));
 assert.ok(toolbar.childNodes.some(node=>node.childNodes.includes(mounted.nodes.get('trash-opt-in'))));
 assert.equal(mounted.nodes.get('move-trash').hidden,true);
 assert.ok(!requests.includes('XwAOJf'));
});
test('card stack clips outgoing cards without a later overflow override',async()=>{
 const mounted=await mountedReview([item('a')]);
 const css=mounted.root.childNodes.filter(node=>node.tagName==='STYLE').map(node=>node.textContent||node.childNodes.map(child=>child.textContent).join('')).join('');
 const cardRules=[...css.matchAll(/\.card\{([^}]*)\}/g)].map(match=>match[1]);
 assert.ok(cardRules.length>0);
 assert.match(cardRules.at(-1),/overflow:hidden/);
 assert.ok(mounted.nodes.get('card').childNodes.some(node=>node.class==='top-card'));
});
test('phone controls keep zoom together, order in a grid and Trash below the library controls',async()=>{
 const mounted=await mountedReview([item('a')]);
 const css=mounted.root.childNodes[0].childNodes[0].textContent;
 const content=mounted.nodes.get('overlay').childNodes[0];
 const actions=content.childNodes.find(node=>node.class==='actions');
 const zoom=actions.childNodes.find(node=>node.class==='zoom-control');
 assert.equal(zoom.childNodes[0].textContent,'Zoom ');
 assert.equal(zoom.childNodes[1],mounted.nodes.get('zoom'));
 const library=content.childNodes.find(node=>node.class==='toolbar library-controls');
 assert.ok(library.childNodes.includes(mounted.nodes.get('filter')));
 assert.ok(library.childNodes.includes(mounted.nodes.get('sort')));
 const footer=content.childNodes.find(node=>node.class==='toolbar album-controls');
 assert.equal(footer.class,'toolbar album-controls');
 assert.ok(footer.childNodes.includes(mounted.nodes.get('move-trash')));
 assert.ok(footer.childNodes.some(node=>node.class==='trash-toggle'));
 assert.match(css,/\.zoom-control,\.trash-toggle\{display:flex;align-items:center/);
 assert.match(css,/@media\(max-width:599px\)/);
 assert.match(css,/\.library-controls\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(css,/\.album-controls\{position:relative;/);
 assert.match(css,/\.trash-toggle\{min-height:44px/);
 assert.match(css,/#history-list li\{overflow-wrap:anywhere\}/);
 assert.doesNotMatch(css,/--album-controls-height/);
 assert.match(css,/\.trash-toggle\{[^}]*white-space:normal/);
 assert.match(css,/\.album-controls button\{[^}]*min-width:0;white-space:normal;overflow-wrap:anywhere/);
 assert.match(css,/\.album-controls a,\.album-explanation\{grid-column:1 \/ -1;min-width:0/);
 assert.ok(footer.childNodes.some(node=>node.class==='album-explanation'));
});
test('mounted album send creates a readable title and saves the verified album',async()=>{
 const titles=[],requests=[];let added=false;
 const fetch=async(url,options)=>{
  const entry=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0],id=entry[0],args=JSON.parse(entry[1]);
  requests.push(id);
  if(id==='OXvT9d')titles.push(args[0]);
  if(id==='E1Cajb')added=true;
  const result=id==='Z5xsfc'?[[],null]:id==='OXvT9d'?[['album']]:id==='snAcKc'?[null,added?[['a',null,null,'stable']]:[],null,['album']]:[];
  return {ok:true,text:async()=>envelope(id,result)};
 };
 const mounted=await mountedReview([item('a',{decision:'remove',dedupKey:'stable'})],fetch);
 mounted.environment.window.confirm=()=>true;
 await mounted.click('send');
 assert.equal(mounted.nodes.get('status').textContent,'Every candidate was verified in the review album. Select Enable Move to Trash below to use this panel, or open the review album to move items manually in Google Photos.');
 assert.deepEqual(titles,['Photos Swipe · Review']);
 assert.equal((await mounted.read()).albumKey,'album');
 assert.equal((await mounted.read()).job,null);
 assert.equal(reviewQueue(await mounted.read()).length,0);
 assert.ok(requests.includes('E1Cajb'));
});

test('phone layout stacks sync fields and keeps library controls and Trash text clear in Chrome',async t=>{
 const browser=['google-chrome','chromium','chromium-browser'].find(command=>spawnSync(command,['--version'],{encoding:'utf8'}).status===0);
 if(!browser){t.skip('Chrome is unavailable');return;}
 const mounted=await mountedReview([item('a')]);
 mounted.nodes.get('overlay').hidden=false;mounted.nodes.get('move-trash').hidden=false;
 const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
 const serialize=node=>{
  if(!node.tagName)return escape(node.textContent||'');
  const tag=node.tagName.toLowerCase();
  const attributes=['id','class','type','min','max','step','value'].filter(key=>typeof node[key]==='string'&&node[key]).map(key=>` ${key}="${escape(node[key])}"`).join('');
  return `<${tag}${attributes}${node.hidden?' hidden':''}>${escape(node.textContent||'')}${node.childNodes.map(serialize).join('')}</${tag}>`;
 };
 const markup=mounted.root.childNodes.map(serialize).join('');
 const directory=await mkdtemp(join(tmpdir(),'photos-layout-'));
 try{
  const html=`<!doctype html><body><script>
  const results=[];
  for(const [width,height,expanded] of [[400,713,false],[400,633,true],[320,633,true],[390,844,false]]){
   const frame=document.createElement('iframe');frame.style.width=width+'px';frame.style.height=height+'px';document.body.append(frame);
   const doc=frame.contentDocument,host=doc.createElement('div');host.style.cssText='position:fixed;inset:0';doc.body.append(host);
   const root=host.attachShadow({mode:'open'});root.innerHTML=${JSON.stringify(markup)};
   root.getElementById('move-trash').hidden=!expanded;root.getElementById('album').hidden=!expanded;
   const footer=root.querySelector('.album-controls'),overlay=root.querySelector('.overlay'),label=root.querySelector('.trash-toggle');
   const bounds=element=>element.getBoundingClientRect();
   const controls=['load','refresh','filter','sort'].map(id=>root.getElementById(id)).filter(Boolean);
   const clear=()=>controls.every(control=>bounds(control).bottom<=bounds(footer).top);
   const initialClear=clear();overlay.scrollTop=overlay.scrollHeight;
   const range=doc.createRange();range.selectNodeContents(label);
   const textFits=range.getBoundingClientRect().right<=bounds(label).right+1;
   const zoom=root.querySelector('.zoom-control'),slider=root.getElementById('zoom');
   const zoomFits=bounds(slider).right<=bounds(zoom).right+1&&bounds(slider).top>=bounds(zoom).top&&bounds(slider).bottom<=bounds(zoom).bottom;
   const toggleVisible=bounds(label).top>=bounds(overlay).top&&bounds(label).bottom<=bounds(overlay).bottom;
   const explanation=root.querySelector('.album-explanation'),check=root.getElementById('trash');
   const inside=(element,container)=>bounds(element).left>=bounds(container).left&&bounds(element).right<=bounds(container).right+1&&bounds(element).top>=bounds(container).top&&bounds(element).bottom<=bounds(container).bottom;
   const textInside=element=>{range.selectNodeContents(element);return Array.from(range.getClientRects()).every(rect=>rect.left>=bounds(element).left&&rect.right<=bounds(element).right+1);};
   const explanationVisible=inside(explanation,footer)&&inside(explanation,overlay)&&textInside(explanation);
   const explanationClear=Array.from(footer.querySelectorAll('button,a,label')).filter(element=>!element.hidden).every(element=>bounds(element).bottom<=bounds(explanation).top||bounds(element).top>=bounds(explanation).bottom);
   const checkFits=inside(check,footer)&&textInside(check);
   const settings=root.getElementById('sync-settings');settings.open=true;
   const settingsStyle=doc.defaultView.getComputedStyle(settings),settingsContentWidth=settings.clientWidth-parseFloat(settingsStyle.paddingLeft)-parseFloat(settingsStyle.paddingRight);
   const buttons=Array.from(settings.querySelectorAll('button')).filter(button=>button.getClientRects().length);
   const syncFields=['sync-url','sync-token'].map(id=>{
    const input=root.getElementById(id),field=input.parentElement;
    range.selectNodeContents(field.firstChild);const text=range.getBoundingClientRect(),box=bounds(input),fieldBox=bounds(field);
    return {id,above:text.bottom<=box.top,leftAligned:Math.abs(text.left-box.left)<=1,fullWidth:Math.abs(box.width-settingsContentWidth)<=1&&Math.abs(fieldBox.width-settingsContentWidth)<=1,clearOfButtons:buttons.every(button=>text.bottom<=bounds(button).top||text.top>=bounds(button).bottom)};
   });
   const local=bounds(root.getElementById('sync-local'));
   const localOwnRow=Array.from(settings.children).filter(element=>element!==root.getElementById('sync-local')&&element.getClientRects().length).every(element=>bounds(element).bottom<=local.top||bounds(element).top>=local.bottom);
   const toggleHeight=bounds(label).height;overlay.scrollTop=overlay.scrollHeight;
   results.push({width,height,syncFields,localOwnRow,initialClear,toggleVisible,toggleHeight,bottomClear:clear(),textFits,zoomFits,explanationVisible,explanationClear,checkFits,filterTop:bounds(root.getElementById('filter')).top,sortTop:bounds(root.getElementById('sort')).top});
  }
  document.body.replaceChildren(Object.assign(document.createElement('pre'),{textContent:JSON.stringify(results)}));
  </script>`;
  const path=join(directory,'layout.html');await writeFile(path,html);
  const result=spawnSync(browser,['--headless','--no-sandbox','--disable-gpu','--disable-background-networking',`--user-data-dir=${join(directory,'profile')}`,'--dump-dom',`file://${path}`],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  if(result.status!==0&&/Operation not permitted|operation not permitted/.test(result.stderr)){t.skip('Sandbox prevents Chrome from opening sockets');return;}
  assert.equal(result.status,0,result.stderr);
  const measurements=JSON.parse(result.stdout.match(/<pre>(.*?)<\/pre>/s)?.[1]||'null');assert.equal(measurements?.length,4,result.stdout);
  for(const measurement of measurements){
   assert.equal(measurement.localOwnRow,true,JSON.stringify(measurement));
   for(const field of measurement.syncFields)for(const key of ['above','leftAligned','fullWidth','clearOfButtons'])assert.equal(field[key],true,JSON.stringify({width:measurement.width,...field}));
   assert.equal(measurement.initialClear,true,JSON.stringify(measurement));assert.equal(measurement.toggleVisible,true,JSON.stringify(measurement));assert.ok(measurement.toggleHeight>=44,JSON.stringify(measurement));assert.equal(measurement.bottomClear,true,JSON.stringify(measurement));
   assert.equal(measurement.textFits,true,JSON.stringify(measurement));assert.equal(measurement.zoomFits,true,JSON.stringify(measurement));
   for(const key of ['explanationVisible','explanationClear','checkFits'])assert.equal(measurement[key],true,JSON.stringify(measurement));
   assert.equal(measurement.filterTop,measurement.sortTop,JSON.stringify(measurement));
  }
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('opening with sync respects an in-flight Trash lease and holds the lease until sync saves',async()=>{
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs');
 let finishTrash,trashStarted;
 const started=new Promise(resolve=>{trashStarted=resolve;});
 const pendingTrash=new Promise(resolve=>{finishTrash=resolve;});
 const first=await mountedReview([item('a',{decision:'remove',dedupKey:'stable'})],{confirm:()=>true,fetch:async(url,options)=>{
  const entry=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0];
  if(entry[0]==='XwAOJf'){trashStarted();await pendingTrash;}
  return {ok:true,text:async()=>envelope(entry[0],entry[0]==='XwAOJf'?[]:[[['a',null,null,'stable']],null])};
 }});
 const db=await openReviewDatabase(first.environment.window.indexedDB);
 await db.saveSettings({url:'https://sync.example',token:'synthetic-token'});
 const second=bundleEnvironment();second.environment.window.indexedDB=first.environment.window.indexedDB;second.environment.AbortSignal=AbortSignal;
 let syncCalls=0,finishSync,syncStarted;
 const syncing=new Promise(resolve=>{syncStarted=resolve;});
 const pendingSync=new Promise(resolve=>{finishSync=resolve;});
 second.environment.window.fetch=async url=>{
  assert.equal(new URL(url).origin,'https://sync.example');syncCalls++;syncStarted();await pendingSync;
  return {ok:true,json:async()=>({decisions:[],history:[],progress:{}})};
 };
 vm.runInNewContext(await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8'),second.environment);
 first.nodes.get('trash-opt-in').checked=true;first.nodes.get('trash-opt-in').onchange();
 const moving=first.click('move-trash');await started;
 const before=await first.read();
 await second.nodes.get('launcher').onclick();
 assert.match(second.nodes.get('status').textContent,/busy in another tab/);
 assert.equal(syncCalls,0);assert.deepEqual(await first.read(),before);
 finishTrash();await moving;await first.nodes.get('close').onclick();
 const completed=await first.read();
 assert.equal(completed.items[0].state,'in_trash');
 assert.equal(first.nodes.get('status').textContent,'Verified 1 items in Trash.');
 const opening=second.nodes.get('launcher').onclick();await syncing;
 const account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 await assert.rejects(db.lease(account,'other-tab'),/busy in another tab/);
 assert.deepEqual(await first.read(),completed);
 finishSync();await opening;
 assert.equal((await first.read()).revision,completed.revision+1);
 assert.equal((await first.read()).items[0].state,'in_trash');
 await assert.rejects(db.lease(account,'other-tab'),/busy in another tab/);await second.nodes.get('close').onclick();await db.lease(account,'other-tab');await db.lease(account,'other-tab',true);
});

test('mounted stats distinguish queue savings from the Trash running total',async()=>{
 const mounted=await mountedReview([item('queued',{decision:'remove',spaceTaken:23000}),item('trashed',{decision:'remove',state:'in_trash',spaceTaken:112000})]);
 const stats=mounted.nodes.get('stats').textContent;
 assert.equal(stats,'0 to review · 2/2 reviewed · Queue: 1 (estimated savings: 23 KB) · In Trash: 112 KB (running total)');
 assert.equal(stats.match(/estimated savings/g).length,1);
});
test('mounted Keep names the decided item after advancing and during candidate inspection',async()=>{
 const mounted=await mountedReview([item('first.jpg'),item('next.jpg')]);
 await mounted.click('keep');
 assert.equal(mounted.nodes.get('status').textContent,'Kept first.jpg.');
 assert.match(mounted.nodes.get('caption').textContent,/^next.jpg · /);
 await mounted.click('remove');
 mounted.nodes.get('queue').childNodes[0].onclick();
 await mounted.click('keep');
 assert.equal(mounted.nodes.get('status').textContent,'Kept next.jpg.');
});
test('mounted photo and video captions show file size with explicit unknown metadata',async()=>{
 for(const type of ['photo','video']){
  for(const [size,label] of [[112000,'112 KB'],[2500000,'2.5 MB'],[1200000000,'1.2 GB'],[0,'0 KB'],[undefined,'Unknown size'],[null,'Unknown size']]){
   const name=type==='photo'?'sample.jpg':'sample.mp4';
   const mounted=await mountedReview([item('sample',{name,type,size,spaceTaken:1000})],{fetch:async()=>({ok:true,text:async()=>envelope('VrseUb',[['sample'],'https://lh3.googleusercontent.com/synthetic-video'])})});
   assert.equal(mounted.nodes.get('caption').textContent,`${name} · Unknown date · ${label}`);
   await mounted.click('remove');
   mounted.nodes.get('queue').childNodes[0].onclick();
   assert.equal(mounted.nodes.get('caption').textContent,`Candidate inspection · ${name} · Unknown date · ${label}`);
  }
 }
});

test('enlarged video owns Space down and up without scrolling, closing or replacing media',async()=>{
 const requests=[],response=Promise.withResolvers();
 const waitFor=async(predicate,message)=>{
  const deadline=Date.now()+5000;
  while(!predicate()){
   assert.ok(Date.now()<deadline,message);
   await new Promise(resolve=>setImmediate(resolve));
  }
 };
 const mounted=await mountedReview([item('video',{type:'video'})],async(url,options)=>{
  const entry=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0];requests.push(entry[0]);
  assert.equal(entry[0],'VrseUb');
  await response.promise;
  return {ok:true,text:async()=>envelope(entry[0],[['video'],'https://lh3.googleusercontent.com/synthetic-video'])};
 });
 await waitFor(()=>requests.length===1,'Video source request did not start');
 const {nodes,root}=mounted,video=nodes.get('media').querySelector('video');
 assert.ok(video);assert.equal(video.paused,true);assert.equal(video.src,undefined);
 response.resolve();
 await waitFor(()=>video.src&&video.paused===false,'Mounted video did not start playing');
 const dispatch=(type,key,extra={})=>{
  const event={type,key,prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra};
  mounted.environment.window.listeners[type](event);
  if(key===' '&&!event.prevented){if(type==='keydown')nodes.get('overlay').scrollTop=100;else root.activeElement?.onclick?.();}
  return event;
 };
 assert.equal(root.activeElement,nodes.get('close'));assert.equal(video.paused,false);
 dispatch('keydown','F');assert.equal(nodes.get('card').classList.contains('expanded'),true);
 for(const focused of [nodes.get('close'),nodes.get('enlarge'),video]){
  focused.focus();nodes.get('overlay').scrollTop=0;
  const before=video.playCalls;
  for(const extra of [{},{repeat:true},{repeat:true}]){
   const event=dispatch('keydown',' ',extra);assert.equal(event.prevented,true);assert.equal(event.stopped,true);
  }
  assert.equal(video.paused,true);assert.equal(video.playCalls,before);
  const released=dispatch('keyup',' ');assert.equal(released.prevented,true);assert.equal(released.stopped,true);
  assert.equal(nodes.get('overlay').hidden,false);assert.equal(nodes.get('overlay').scrollTop,0);
  assert.equal(nodes.get('media').querySelector('video'),video);assert.ok(video.src);
  dispatch('keydown',' ');dispatch('keyup',' ');assert.equal(video.paused,false);assert.equal(video.playCalls,before+1);
 }
 assert.deepEqual(requests,['VrseUb']);assert.equal((await mounted.read()).items[0].decision,null);
 dispatch('keydown','f');assert.equal(nodes.get('card').classList.contains('expanded'),false);
 for(const extra of [{ctrlKey:true},{altKey:true},{metaKey:true},{isComposing:true}])assert.equal(dispatch('keydown',' ',extra).prevented,false);
 for(const target of [nodes.get('sync-token'),nodes.get('filter'),{tagName:'TEXTAREA'},{tagName:'DIV',isContentEditable:true}]){
  root.activeElement=target;
  assert.equal(dispatch('keydown',' ').prevented,false);assert.equal(dispatch('keyup',' ').prevented,false);
 }
 root.activeElement=video;nodes.get('overlay').hidden=true;
 assert.equal(dispatch('keydown',' ').prevented,false);assert.equal(dispatch('keyup',' ').prevented,false);
});


test('photo viewer consumes Space without scrolling, closing or recording decisions',async()=>{
 const mounted=await mountedReview([item('photo')]);
 const {nodes,root}=mounted,image=nodes.get('media').querySelector('img'),before=await mounted.read();
 assert.ok(image);assert.equal(nodes.get('media').querySelector('video'),null);
 assert.equal(root.activeElement,nodes.get('close'));
 const dispatch=async(type,repeat=false)=>{
  const event={type,key:' ',repeat,prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};
  mounted.environment.window.listeners[type](event);
  if(!event.prevented){if(type==='keydown')nodes.get('overlay').scrollTop=100;else await root.activeElement?.onclick?.();}
  assert.equal(event.prevented,true);assert.equal(event.stopped,true);
 };
 for(const expanded of [false,true]){
  if(expanded)nodes.get('enlarge').onclick();
  for(const control of ['close','keep','remove']){
   nodes.get(control).focus();nodes.get('overlay').scrollTop=0;
   await dispatch('keydown');await dispatch('keydown',true);await dispatch('keyup');
   assert.equal(nodes.get('overlay').hidden,false);assert.equal(nodes.get('overlay').scrollTop,0);
   assert.equal(nodes.get('media').querySelector('img'),image);assert.ok(image.src);
   assert.deepEqual(await mounted.read(),before);
  }
 }
});

test('pairing settings failure after sign-in preserves the loaded review session',async()=>{
 const source=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8'),mounted=bundleEnvironment();
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs');
 const db=await openReviewDatabase(mounted.environment.window.indexedDB),account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 const saved=await db.save(account,{...emptyReview(),items:[item('synthetic-photo')]});
 let reads=0;
 mounted.environment.GM={getValue:async()=>{if(++reads>1)throw Error('Synthetic pairing read failure');},setValue:async()=>{},deleteValue:async()=>{}};
 vm.runInNewContext(source,mounted.environment);await mounted.nodes.get('launcher').onclick();
 assert.equal(reads,2);
 assert.equal(mounted.nodes.get('account').textContent,tokens.oPEP7c);
 assert.match(mounted.nodes.get('caption').textContent,/^synthetic-photo · /);
 assert.equal(mounted.nodes.get('keep').disabled,false);
 assert.equal(mounted.nodes.get('status').textContent,'Ready. Decisions are saved locally on this browser.');
 assert.ok(mounted.nodes.get('sync-settings').childNodes.some(node=>node.textContent==='Pairing storage unavailable: Synthetic pairing read failure'));
 assert.deepEqual(await db.read(account),saved);
 await mounted.nodes.get('keep').onclick();
 await waitForReview(async()=>(await db.read(account)).items[0].decision==='keep');
 assert.equal(mounted.nodes.get('keep').disabled,false);
 assert.equal((await db.read(account)).items[0].decision,'keep');
 assert.equal(mounted.nodes.get('status').textContent,'Kept synthetic-photo.');
});

test('first-use sync setup is above the card and local dismissal survives reopening',async()=>{
 const mounted=await mountedReview([item('a')]);
 const content=mounted.nodes.get('overlay').childNodes[0],settings=mounted.nodes.get('sync-settings');
 assert.ok(content.childNodes.indexOf(settings)<content.childNodes.indexOf(mounted.nodes.get('card')));
 assert.ok(content.childNodes.indexOf(mounted.nodes.get('sync-status'))<content.childNodes.indexOf(mounted.nodes.get('card')));
 assert.equal(settings.open,true);
 assert.ok(settings.childNodes.some(node=>node.textContent==='Pairing may not persist in this browser'));
 await mounted.click('sync-local');assert.equal(settings.open,false);
 await mounted.nodes.get('close').onclick();const reopened=bundleEnvironment();reopened.environment.window.indexedDB=mounted.environment.window.indexedDB;
 vm.runInNewContext(await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8'),reopened.environment);
 await reopened.nodes.get('launcher').onclick();assert.equal(reopened.nodes.get('sync-settings').open,false);
 assert.equal(reopened.nodes.get('status').textContent,'Ready. Decisions are saved locally on this browser.');
});

test('sync setup actions preserve the saved album retry status and job',async()=>{
 for(const action of ['sync-local','sync-save']){
  const mounted=await mountedReview([item('a',{decision:'remove'})],{fetch:async()=>({ok:true,json:async()=>({decisions:[],history:[],progress:{}})})});
  const {openReviewDatabase}=await import('../lib/userscript-db.mjs');
  const db=await openReviewDatabase(mounted.environment.window.indexedDB);
  const account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
  const job={title:'Photos Swipe · Review',mediaKeys:['a'],albumKey:'saved-album'};
  await db.save(account,{...await mounted.read(),job});
  mounted.environment.AbortSignal=AbortSignal;
  await mounted.nodes.get('launcher').onclick();
  assert.equal(mounted.nodes.get('status').textContent,'A saved album operation is ready to retry.');
  if(action==='sync-save'){
   mounted.nodes.get('sync-url').value='https://sync.example';
   mounted.nodes.get('sync-token').value='synthetic-token';
  }
  await mounted.click(action);
  assert.equal(mounted.nodes.get('status').textContent,'A saved album operation is ready to retry.');
  assert.equal(mounted.nodes.get('send').textContent,'Retry saved album operation');
  assert.deepEqual((await mounted.read()).job,job);
  assert.equal(mounted.nodes.get('sync-settings').open,false);
  if(action==='sync-save')assert.match(mounted.nodes.get('sync-status').textContent,/^Synced/);
 }
});

test('main and visible sync status report successful sync, failures and disabling sync',async()=>{
 const mounted=await mountedReview([item('a')]);
 const source=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8');
 await mounted.nodes.get('close').onclick();const reopened=bundleEnvironment();reopened.environment.AbortSignal=AbortSignal;
 reopened.environment.window.indexedDB=mounted.environment.window.indexedDB;
 let fail=false,requests=0;
 reopened.environment.window.fetch=async url=>{
  assert.equal(new URL(url).origin,'https://sync.example');requests++;
  if(fail)throw Error('Synthetic offline');
  return {ok:true,json:async()=>({decisions:[],history:[],progress:{}})};
 };
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs');
 const db=await openReviewDatabase(reopened.environment.window.indexedDB);
 await db.saveSettings({url:'https://sync.example',token:'synthetic-token'});
 vm.runInNewContext(source,reopened.environment);await reopened.nodes.get('launcher').onclick();
 assert.equal(requests,1);assert.match(reopened.nodes.get('status').textContent,/sync enabled.*Synced/);
 assert.match(reopened.nodes.get('sync-status').textContent,/^Synced/);
 assert.equal(reopened.nodes.get('sync-settings').open,false);
 fail=true;await reopened.nodes.get('launcher').onclick();
 assert.match(reopened.nodes.get('status').textContent,/Synthetic offline.*saved locally/);
 reopened.nodes.get('sync-url').value='';reopened.nodes.get('sync-token').value='';
 reopened.nodes.get('sync-save').onclick();
 await new Promise(resolve=>setTimeout(resolve,10));for(let count=0;count<100&&reopened.nodes.get('keep').disabled;count++)await new Promise(resolve=>setTimeout(resolve,1));
 assert.equal(reopened.nodes.get('status').textContent,'Ready. Decisions are saved locally on this browser.');
 assert.equal(reopened.nodes.get('sync-status').textContent,'Sync off · saved locally');
});

test('decision history previews the same next Undo and updates after undo and reload',async()=>{
 const mounted=await mountedReview([item('a')]);
 assert.match(mounted.nodes.get('history-list').childNodes[0].textContent,/No decisions yet/);
 await mounted.click('remove');mounted.nodes.get('queue').childNodes[0].onclick();await mounted.click('keep');
 assert.match(mounted.nodes.get('undo-preview').textContent,/Next Undo: a · Queue → Keep; restores Queue/);
 assert.ok(mounted.nodes.get('overlay').childNodes[0].childNodes.find(node=>node.class==='actions').childNodes.includes(mounted.nodes.get('undo-preview')));
 assert.equal(mounted.nodes.get('undo')['aria-describedby'],'undo-preview');
 assert.match(mounted.nodes.get('history-list').childNodes[0].textContent,/Next Undo/);
 assert.match(mounted.nodes.get('history-list').childNodes[1].textContent,/Unavailable for Undo/);
 const retainedRow=mounted.nodes.get('history-list').childNodes[0];
 mounted.nodes.get('filter').onchange();
 assert.equal(mounted.nodes.get('history-list').childNodes[0],retainedRow);
 await mounted.nodes.get('close').onclick();const reopened=bundleEnvironment();reopened.environment.window.indexedDB=mounted.environment.window.indexedDB;
 vm.runInNewContext(await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8'),reopened.environment);
 await reopened.nodes.get('launcher').onclick();assert.equal(reopened.nodes.get('undo-preview').textContent,mounted.nodes.get('undo-preview').textContent);
 reopened.nodes.get('undo').onclick();await new Promise(resolve=>setTimeout(resolve,10));assert.equal((await mounted.read()).items[0].decision,'remove');
 assert.match(reopened.nodes.get('undo-preview').textContent,/Unreviewed → Queue; restores Unreviewed/);
 reopened.nodes.get('undo').onclick();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(reopened.nodes.get('history-list').childNodes.length,1);
 assert.equal(reopened.nodes.get('undo-preview').textContent,'No previous decisions can be undone.');
});

test('release metadata names the author and install guide explains Chrome script execution',async()=>{
 const source=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8');
 assert.match(source,/\/\/ @version \d+\.\d+\.\d+\n/);assert.match(source,/\/\/ @author sidlakkoju\n/);
 const guide=await readFile(new URL('../docs/userscript.md',import.meta.url),'utf8');
 assert.match(guide,/chrome:\/\/extensions/);assert.match(guide,/Allow User Scripts.*off by default/);
});

test('rapid decisions and Undo repaint synchronously while storage and video never resolve',async()=>{
 const items=Array.from({length:12},(_,index)=>item(`fast-${index}`,{type:index===1?'video':'photo'}));
 const mounted=await mountedReview(items,{fetch:()=>new Promise(()=>{}),setTimeout:(task,delay)=>{const timer=setTimeout(task,delay);timer.unref();return timer;}});
 const database=await new Promise(resolve=>{const request=mounted.environment.window.indexedDB.open();request.onsuccess=()=>resolve(request.result);});
 const transaction=database.transaction;let blocked=false;
 database.transaction=function(name,...args){if(name==='accounts'&&!blocked){blocked=true;return {objectStore:()=>({get:()=>({})})};}return transaction.call(this,name,...args);};
 mounted.nodes.get('keep').onclick();
 assert.match(mounted.nodes.get('caption').textContent,/^fast-1 · /);
 assert.equal(mounted.nodes.get('keep').disabled,false);
 mounted.nodes.get('keep').onclick();
 assert.match(mounted.nodes.get('caption').textContent,/^fast-2 · /);
 for(let index=2;index<10;index++)mounted.nodes.get('keep').onclick();
 assert.match(mounted.nodes.get('caption').textContent,/^fast-10 · /);
 mounted.nodes.get('undo').onclick();assert.match(mounted.nodes.get('caption').textContent,/^fast-9 · /);
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(blocked,true);assert.equal((await mounted.read()).items.filter(item=>item.decision).length,0);
});

test('sync pushes ten rapid decisions in one request while further input stays accepted',async()=>{
 const requests=[];
 const mounted=await mountedReview(Array.from({length:15},(_,index)=>item(`batch-${index}`)),{
  fetch:async(url,options)=>{
   requests.push({url,options});
   if(options.method==='GET')return {ok:true,json:async()=>({decisions:[],history:[],progress:{}})};
   return new Promise(()=>{});
  },
  setTimeout:(task,delay)=>{const timer=setTimeout(task,delay);timer.unref();return timer;}
 },{url:'https://sync.example',token:'synthetic-token'});
 for(let index=0;index<10;index++)mounted.nodes.get('keep').onclick();
 assert.match(mounted.nodes.get('caption').textContent,/^batch-10 · /);
 await new Promise(resolve=>setTimeout(resolve,10));
 const batches=requests.filter(request=>new URL(request.url).pathname==='/api/decisions');
 assert.equal(batches.length,1);assert.equal(JSON.parse(batches[0].options.body).decisions.length,10);
 mounted.nodes.get('keep').onclick();assert.match(mounted.nodes.get('caption').textContent,/^batch-11 · /);
 mounted.nodes.get('undo').onclick();assert.match(mounted.nodes.get('caption').textContent,/^batch-10 · /);
 assert.equal(mounted.nodes.get('keep').disabled,false);
});

test('Keep instead reports saved album job locks without changing the candidate',async()=>{
 const mounted=await mountedReview([item('queued',{decision:'remove'})]);
 await mounted.nodes.get('close').onclick();
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs'),db=await openReviewDatabase(mounted.environment.window.indexedDB);
 const account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 const saved=await db.read(account);await db.save(account,{...saved,job:{albumKey:'album',mediaKeys:['queued']}});
 await mounted.nodes.get('launcher').onclick();
 mounted.nodes.get('queue').childNodes[0].onclick();
 assert.doesNotThrow(()=>mounted.nodes.get('keep').onclick());
 assert.match(mounted.nodes.get('status').textContent,/Finish the saved album operation/);
 assert.match(mounted.nodes.get('caption').textContent,/Candidate inspection/);
 assert.equal((await mounted.read()).items[0].decision,'remove');
 await mounted.nodes.get('close').onclick();
});
test('expired leases block library writes before any RPC and visible pages renew ownership',async()=>{
 const mounted=await mountedReview([item('a')]);
 const account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 const database=await new Promise(resolve=>{const request=mounted.environment.window.indexedDB.open();request.onsuccess=()=>resolve(request.result);});
 await new Promise(resolve=>{const tx=database.transaction('leases');const request=tx.objectStore().get(account);request.onsuccess=()=>tx.objectStore().put({owner:'other-tab',expires:Date.now()+90000},account);tx.oncomplete=resolve;});
 await mounted.click('load');
 assert.match(mounted.nodes.get('status').textContent,/busy in another tab/);
 assert.equal((await mounted.read()).items.length,1);
 mounted.environment.document.listeners.visibilitychange();await new Promise(resolve=>setTimeout(resolve,10));
 assert.match(mounted.nodes.get('status').textContent,/busy in another tab/);
});
test('page lifecycle events cannot sync over an in-flight library snapshot',async()=>{
 let finish,started;const loading=new Promise(resolve=>{started=resolve;}),requests=[];
 const mounted=await mountedReview([item('a')],{fetch:async(url,options)=>{
  requests.push(url);
  if(new URL(url).origin==='https://sync.example')return {ok:true,json:async()=>({decisions:[],history:[],progress:{}})};
  const entry=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0];
  if(entry[0]==='lcxiM'){started();await new Promise(resolve=>{finish=resolve;});return {ok:true,text:async()=>envelope('lcxiM',[[],null])};}
  throw Error('Unexpected RPC');
 }},{url:'https://sync.example',token:'test-secret'});
 const operation=mounted.nodes.get('load').onclick();await loading;
 const before=requests.length;
 mounted.environment.window.dispatchEvent(new Event('pagehide'));mounted.environment.document.listeners.visibilitychange();
 await new Promise(resolve=>setTimeout(resolve,10));assert.equal(requests.length,before);
 finish();await operation;assert.equal((await mounted.read()).items[0].decision,null);
 await mounted.nodes.get('close').onclick();
});
test('failed saves release the lease on close and retain pending decisions for reopen',async()=>{
 const mounted=bundleEnvironment(),fault={};mounted.environment.window.indexedDB=fakeIndexedDB(fault);
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs'),db=await openReviewDatabase(mounted.environment.window.indexedDB);
 const account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 await db.save(account,{...emptyReview(),items:[item('a'),item('b')]});
 vm.runInNewContext(await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8'),mounted.environment);
 await mounted.nodes.get('launcher').onclick();fault.failSave=true;mounted.nodes.get('keep').onclick();
 await mounted.nodes.get('close').onclick();assert.equal(mounted.nodes.get('overlay').hidden,true);
 await db.lease(account,'other-tab');await db.lease(account,'other-tab',true);
 await mounted.nodes.get('launcher').onclick();assert.equal(mounted.nodes.get('overlay').hidden,false);assert.match(mounted.nodes.get('caption').textContent,/^b ·/);
 fault.failSave=false;await mounted.nodes.get('close').onclick();assert.equal((await db.read(account)).items[0].decision,'keep');await db.lease(account,'other-tab');
});
test('revision conflicts stay visible and do not retry the stale snapshot',async()=>{
 const mounted=await mountedReview([item('a'),item('b')]);
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs'),db=await openReviewDatabase(mounted.environment.window.indexedDB);
 const account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 await db.save(account,{...await db.read(account),cursor:'other-tab'});
 mounted.nodes.get('keep').onclick();await new Promise(resolve=>setTimeout(resolve,10));
 await mounted.nodes.get('close').onclick();assert.equal(mounted.nodes.get('overlay').hidden,true);
 await db.lease(account,'other-tab');await db.lease(account,'other-tab',true);
 await mounted.nodes.get('launcher').onclick();
 assert.equal(mounted.nodes.get('overlay').hidden,false);assert.match(mounted.nodes.get('status').textContent,/Unsaved decisions remain visible.*Reload/);
 assert.match(mounted.nodes.get('caption').textContent,/^b ·/);assert.equal((await db.read(account)).cursor,'other-tab');
});

test('lease recovery saves pending decisions and resumes input through visibility, reopen and close',async()=>{
 for(const recovery of ['visibility','reopen','close']){
  const fault={},mounted=await mountedReview([item('a'),item('b'),item('c')]);
  const database=await new Promise(resolve=>{const request=mounted.environment.window.indexedDB.open();request.onsuccess=()=>resolve(request.result);});
  const transaction=database.transaction;
  database.transaction=function(name,...args){if(name==='accounts'&&fault.failSave)throw Error('Synthetic save failure');if(name==='leases'&&fault.failLease)throw Error('Synthetic lease failure');return transaction.call(this,name,...args);};
  fault.failSave=true;mounted.nodes.get('keep').onclick();await new Promise(resolve=>setTimeout(resolve,10));
  fault.failLease=true;mounted.environment.document.listeners.visibilitychange();await new Promise(resolve=>setTimeout(resolve,10));
  assert.match(mounted.nodes.get('status').textContent,/lease failure/);
  mounted.nodes.get('keep').onclick();assert.match(mounted.nodes.get('caption').textContent,/^b ·/);
  fault.failLease=false;fault.failSave=false;
  if(recovery==='visibility'){mounted.environment.document.listeners.visibilitychange();await new Promise(resolve=>setTimeout(resolve,10));}
  else if(recovery==='reopen')await mounted.nodes.get('launcher').onclick();
  else {await mounted.nodes.get('close').onclick();assert.equal(mounted.nodes.get('overlay').hidden,true);await mounted.nodes.get('launcher').onclick();}
  assert.equal((await mounted.read()).items[0].decision,'keep');
  await mounted.click('keep');assert.equal((await mounted.read()).items[1].decision,'keep');
  await mounted.nodes.get('close').onclick();assert.equal(mounted.nodes.get('overlay').hidden,true);
 }
});
test('a delayed save failure preserves the active lease failure status',async()=>{
 const mounted=await mountedReview([item('a'),item('b')]),current=await mounted.read();
 const database=await new Promise(resolve=>{const request=mounted.environment.window.indexedDB.open();request.onsuccess=()=>resolve(request.result);});
 const transaction=database.transaction;let finish,started,failLease=false,holdSave=true;
 const saving=new Promise(resolve=>{started=resolve;});
 database.transaction=function(name,...args){
  if(name==='leases'&&failLease)throw Error('Synthetic lease failure');
  if(name==='accounts'&&holdSave){
   holdSave=false;
   const tx={objectStore:()=>({get(){const request={result:structuredClone(current)};finish=()=>request.onsuccess();started();return request;},put(){throw Error('Synthetic delayed save failure');}}),abort(){queueMicrotask(()=>tx.onabort());}};
   return tx;
  }
  return transaction.call(this,name,...args);
 };
 mounted.nodes.get('keep').onclick();await saving;
 failLease=true;mounted.environment.document.listeners.visibilitychange();await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(mounted.nodes.get('status').textContent,'Synthetic lease failure');
 finish();await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(mounted.nodes.get('status').textContent,'Synthetic lease failure');
 assert.equal((await mounted.read()).items[0].decision,null);
 mounted.nodes.get('keep').onclick();assert.match(mounted.nodes.get('caption').textContent,/^b ·/);
 failLease=false;mounted.environment.document.listeners.visibilitychange();await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal((await mounted.read()).items[0].decision,'keep');
 await mounted.click('keep');assert.equal((await mounted.read()).items[1].decision,'keep');
 await mounted.nodes.get('close').onclick();
});
test('a failed video RPC does not reject the next visible video waiting for it',async()=>{
 let fail,started;const pending=new Promise(resolve=>{started=resolve;}),requests=[];
 const mounted=await mountedReview([item('first',{type:'video'}),item('second',{type:'video'})],{fetch:async(url,options)=>{
  const entry=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0];requests.push(JSON.parse(entry[1]));
  if(requests.length===1){started();await new Promise(resolve=>{fail=resolve;});throw Error('Synthetic video failure');}
  return {ok:true,text:async()=>envelope('VrseUb',[['second'],'https://lh3.googleusercontent.com/second-video'])};
 }});
 await pending;mounted.nodes.get('keep').onclick();const video=mounted.nodes.get('media').querySelector('video');
 fail();await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(requests.length,2);assert.match(video.src,/second-video/);assert.equal(video.paused,false);
 await mounted.nodes.get('close').onclick();
});

test('Close waits for an in-flight swipe account check before releasing the session',async()=>{
 let finish,started,delay=false;
 const checking=new Promise(resolve=>{started=resolve;});
 const crypto={randomUUID:()=>webcrypto.randomUUID(),subtle:{digest:async(...args)=>{
  const result=await webcrypto.subtle.digest(...args);
  if(delay){delay=false;started();await new Promise(resolve=>{finish=resolve;});}
  return result;
 }}};
 const mounted=await mountedReview([item('a')],{crypto});
 delay=true;mounted.nodes.get('keep').onclick();await checking;
 const closing=mounted.nodes.get('close').onclick();
 finish();await closing;
 assert.equal((await mounted.read()).items[0].decision,'keep');
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs'),db=await openReviewDatabase(mounted.environment.window.indexedDB);
 const account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 await db.lease(account,'other-tab');await db.lease(account,'other-tab',true);
});

test('pagehide and unload start release immediately while a library operation is pending',async()=>{
 for(const event of ['pagehide','unload']){
  let finish,started;const loading=new Promise(resolve=>{started=resolve;});
  const mounted=await mountedReview([item('a')],async(url,options)=>{
   const entry=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0];
   if(!finish){started();await new Promise(resolve=>{finish=resolve;});}
   return {ok:true,text:async()=>envelope(entry[0],[[],null])};
  });
  const {openReviewDatabase}=await import('../lib/userscript-db.mjs'),db=await openReviewDatabase(mounted.environment.window.indexedDB);
  const account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
  const database=await new Promise(resolve=>{const request=mounted.environment.window.indexedDB.open();request.onsuccess=()=>resolve(request.result);});
  const transaction=database.transaction;let releasing=false;
  database.transaction=function(name,...args){if(name==='leases')releasing=true;return transaction.call(this,name,...args);};
  const operation=mounted.nodes.get('load').onclick();await loading;releasing=false;
  mounted.environment.window.dispatchEvent(new Event(event));
  assert.equal(releasing,true);
  await new Promise(resolve=>setTimeout(resolve,10));
  await db.lease(account,'other-tab');await db.lease(account,'other-tab',true);
  const before=await db.read(account);
  finish();await operation;
  assert.deepEqual(await db.read(account),before);
  await mounted.nodes.get('close').onclick();
 }
});
test('visibility account changes allow close and reopening the new account',async()=>{
 const mounted=await mountedReview([item('old')]);
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs'),db=await openReviewDatabase(mounted.environment.window.indexedDB);
 const account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 const nextEmail='next@example.test',nextAccount=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(nextEmail))).toString('hex');
 await db.save(nextAccount,{...emptyReview(),items:[item('new')]});
 mounted.environment.window.WIZ_global_data.oPEP7c=nextEmail;
 mounted.environment.document.listeners.visibilitychange();await new Promise(resolve=>setTimeout(resolve,10));
 assert.match(mounted.nodes.get('status').textContent,/Google account changed/);
 await mounted.nodes.get('close').onclick();assert.equal(mounted.nodes.get('overlay').hidden,true);
 await db.lease(account,'other-tab');
 await mounted.nodes.get('launcher').onclick();assert.match(mounted.nodes.get('caption').textContent,/^new ·/);
 await mounted.click('keep');assert.equal((await db.read(nextAccount)).items[0].decision,'keep');
 await mounted.nodes.get('close').onclick();
});

test('reopening with a pending save starts renewal before returning',async()=>{
 const timers=new Map();let timerId=0;
 const mounted=await mountedReview([item('a'),item('b')],{},undefined,{setInterval:handler=>{timers.set(++timerId,handler);return timerId;},clearInterval:id=>timers.delete(id)});
 const database=await new Promise(resolve=>{const request=mounted.environment.window.indexedDB.open();request.onsuccess=()=>resolve(request.result);});
 const transaction=database.transaction;let fail=true;
 database.transaction=function(name,...args){if(name==='accounts'&&args[0]==='readwrite'&&fail)throw Error('Save unavailable');return transaction.call(this,name,...args);};
 await mounted.click('keep');await mounted.nodes.get('close').onclick();assert.equal(timers.size,0);
 await mounted.nodes.get('launcher').onclick();assert.equal(timers.size,1);
 fail=false;await [...timers.values()][0]();await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal((await mounted.read()).items[0].decision,'keep');
 await mounted.nodes.get('close').onclick();assert.equal(timers.size,0);
});
test('late account checks after Close or an account mismatch cannot renew or clear errors',async()=>{
 for(const ending of ['close','change']){
  let finish,started,delay=false;
  const checking=new Promise(resolve=>{started=resolve;});
  const crypto={randomUUID:()=>webcrypto.randomUUID(),subtle:{digest:async(...args)=>{const result=await webcrypto.subtle.digest(...args);if(delay){delay=false;started();await new Promise(resolve=>{finish=resolve;});}return result;}}};
  const mounted=await mountedReview([item('a')],{crypto});delay=true;
  mounted.environment.document.listeners.visibilitychange();await checking;
  if(ending==='close')await mounted.nodes.get('close').onclick();
  else {mounted.environment.window.WIZ_global_data.oPEP7c='changed@example.test';mounted.environment.document.listeners.visibilitychange();await new Promise(resolve=>setTimeout(resolve,10));}
  const status=mounted.nodes.get('status').textContent;finish();await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(mounted.nodes.get('status').textContent,status);
  const {openReviewDatabase}=await import('../lib/userscript-db.mjs'),db=await openReviewDatabase(mounted.environment.window.indexedDB);
  const account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
  await db.lease(account,'other-tab');await db.lease(account,'other-tab',true);
  await mounted.nodes.get('close').onclick();
 }
});
test('account changes during library operations block every old-account save and allow reopen',async()=>{
 let checks=0,loading=false;
 const crypto={randomUUID:()=>webcrypto.randomUUID(),subtle:{digest:async(...args)=>{
  const result=await webcrypto.subtle.digest(...args);
  if(loading&&++checks===4)mounted.environment.window.WIZ_global_data.oPEP7c='new-library@example.test';
  return result;
 }}};
 const mounted=await mountedReview([item('old')],{crypto,fetch:async(url,options)=>{
  const entry=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0];
  return {ok:true,text:async()=>envelope(entry[0],[[],null])};
 }});loading=true;
 await mounted.click('load');assert.match(mounted.nodes.get('status').textContent,/Google account changed/);
 assert.equal((await mounted.read()).items.length,1);
 await mounted.click('keep');assert.equal((await mounted.read()).items[0].decision,null);
 await mounted.nodes.get('close').onclick();await mounted.nodes.get('launcher').onclick();
 assert.equal(mounted.nodes.get('account').textContent,'new-library@example.test');
 await mounted.nodes.get('close').onclick();
});
test('late lease renewal results after Close or account change do not restore ownership',async()=>{
 for(const ending of ['close','change']){
  const mounted=await mountedReview([item('a')]);
  const database=await new Promise(resolve=>{const request=mounted.environment.window.indexedDB.open();request.onsuccess=()=>resolve(request.result);});
  const transaction=database.transaction;let finish,started,delay=true;
  const renewing=new Promise(resolve=>{started=resolve;});
  database.transaction=function(name,...args){
   const tx=transaction.call(this,name,...args);
   if(name==='leases'&&delay){delay=false;Object.defineProperty(tx,'oncomplete',{set(handler){this.complete=()=>{finish=handler;started();};},get(){return this.complete;}});}
   return tx;
  };
  mounted.environment.document.listeners.visibilitychange();await renewing;
  if(ending==='close')await mounted.nodes.get('close').onclick();
  else {mounted.environment.window.WIZ_global_data.oPEP7c='renewal-new@example.test';mounted.environment.document.listeners.visibilitychange();await new Promise(resolve=>setTimeout(resolve,10));}
  const status=mounted.nodes.get('status').textContent;finish();await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(mounted.nodes.get('status').textContent,status);
  const {openReviewDatabase}=await import('../lib/userscript-db.mjs'),db=await openReviewDatabase(mounted.environment.window.indexedDB);
  const account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
  await db.lease(account,'other-tab');await db.lease(account,'other-tab',true);
  await mounted.nodes.get('close').onclick();
 }
});
test('pagehide releases ownership while sync is pending',async()=>{
 let finish,started,block=false;const syncing=new Promise(resolve=>{started=resolve;});
 const mounted=await mountedReview([item('a')],{fetch:async(url)=>{
  if(block&&new URL(url).pathname==='/api/decisions'){block=false;started();await new Promise(resolve=>{finish=resolve;});}
  return {ok:true,json:async()=>({decisions:[],history:[],progress:{}})};
 }},{url:'https://sync.example',token:'test-secret'});
 await mounted.click('keep');block=true;mounted.environment.window.dispatchEvent(new Event('focus'));await syncing;
 mounted.environment.window.dispatchEvent(new Event('pagehide'));
 await new Promise(resolve=>setTimeout(resolve,10));
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs'),db=await openReviewDatabase(mounted.environment.window.indexedDB);
 const account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 await db.lease(account,'other-tab');await db.lease(account,'other-tab',true);
 finish();await mounted.nodes.get('close').onclick();
});
test('GM pairing migrates once, removes page credentials and survives page storage replacement',async()=>{
 const {createPairingStore}=await import('../lib/userscript-settings.mjs');
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs');
 let db=await openReviewDatabase(fakeIndexedDB());
 await db.saveSettings({url:'https://sync.example',token:'synthetic-device-token',deviceName:'Test phone',onboardingDismissed:true,unrelated:'discard'});
 const values=new Map(),writes=[];
 const GM={getValue:async key=>values.get(key),setValue:async(key,value)=>{writes.push(value);values.set(key,structuredClone(value));},deleteValue:async key=>values.delete(key)};
 const store=await createPairingStore({GM,database:async()=>db,crypto:webcrypto});
 const first=await store.settings();assert.equal(store.durable,true);assert.ok(first.deviceId);assert.equal(first.deviceName,'Test phone');
 assert.deepEqual(await db.settings(),{onboardingDismissed:true});assert.equal(writes.length,1);assert.equal(writes[0].unrelated,undefined);
 await store.settings();assert.equal(writes.length,1);
 db=await openReviewDatabase(fakeIndexedDB());
 const reinstalled=await createPairingStore({GM,database:async()=>db,crypto:webcrypto});
 assert.equal((await reinstalled.settings()).token,first.token);assert.equal((await reinstalled.settings()).deviceId,first.deviceId);
 await db.saveSettings({url:'https://old.example',token:'stale'});assert.equal((await store.settings()).token,first.token);assert.deepEqual(await db.settings(),{});
 await store.saveSettings({url:'https://sync.example',token:'replacement-token',deviceName:'New phone',onboardingDismissed:true,items:['excluded']});
 const replacement=await store.settings();assert.equal(replacement.token,'replacement-token');assert.ok(replacement.deviceId);assert.equal(writes.at(-1).items,undefined);assert.equal(writes.at(-1).onboardingDismissed,undefined);assert.deepEqual(await db.settings(),{onboardingDismissed:true});
 await store.saveSettings({...replacement,token:'',unpaired:true,onboardingDismissed:true});
 assert.equal(values.size,0);assert.equal((await store.settings()).token,undefined);assert.equal((await store.settings()).unpaired,true);assert.deepEqual(await db.settings(),{url:replacement.url,deviceId:replacement.deviceId,deviceName:replacement.deviceName,onboardingDismissed:true,unpaired:true});
 assert.equal((await store.settings()).url,replacement.url);assert.equal((await store.settings()).deviceId,replacement.deviceId);assert.equal((await store.settings()).deviceName,replacement.deviceName);
 await store.saveSettings({...await store.settings(),onboardingDismissed:true});assert.equal((await store.settings()).url,replacement.url);
 await store.saveSettings({url:'https://sync.example',token:'synthetic-repaired-token',onboardingDismissed:true});
 assert.equal((await store.settings()).unpaired,undefined);assert.equal((await store.settings()).token,'synthetic-repaired-token');
 await store.saveSettings({url:'',token:''});assert.equal(values.size,0);assert.equal((await store.settings()).token,undefined);
});

test('GM failures preserve migration credentials and undefined GM uses local fallback',async()=>{
 const {createPairingStore}=await import('../lib/userscript-settings.mjs');
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs');
 const db=await openReviewDatabase(fakeIndexedDB()),credentials={url:'https://sync.example',token:'synthetic-token'};
 await db.saveSettings(credentials);
 const broken=await createPairingStore({GM:{getValue:async()=>undefined,setValue:async()=>{throw Error('Synthetic GM failure');},deleteValue:async()=>{}},database:async()=>db,crypto:webcrypto});
 await assert.rejects(broken.settings(),/Synthetic GM failure/);assert.deepEqual(await db.settings(),credentials);
 for(const GM of [undefined,{}]){
  const fallback=await createPairingStore({GM,database:async()=>db,crypto:webcrypto});assert.equal(fallback.durable,false);
  assert.deepEqual(await fallback.settings(),credentials);await fallback.saveSettings({...credentials,deviceId:'local-device'});assert.equal((await db.settings()).deviceId,'local-device');await db.saveSettings(credentials);
 }
});

test('privileged bundle keeps sync fetch and saved credentials away from the page',async()=>{
 const source=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8');
 const mounted=bundleEnvironment(),pageWindow=mounted.environment.window;
 mounted.environment.window={...pageWindow,WIZ_global_data:undefined};
 mounted.environment.unsafeWindow=pageWindow;
 mounted.environment.AbortSignal=AbortSignal;
 let pairing={url:'https://sync.example',token:'synthetic-private-token',deviceId:'device'};
 mounted.environment.GM={getValue:async()=>pairing,setValue:async(key,value)=>{pairing=value;},deleteValue:async()=>{pairing=undefined;}};
 let calls=0;
 mounted.environment.fetch=async(url,options)=>{calls++;assert.equal(options.headers.Authorization,'Bearer synthetic-private-token');return {ok:true,json:async()=>({decisions:[],history:[],progress:{}})};};
 vm.runInNewContext(source,mounted.environment);await mounted.nodes.get('launcher').onclick();
 assert.equal(calls,1);assert.equal(mounted.nodes.get('sync-token').value,'');assert.match(mounted.nodes.get('sync-status').textContent,/Synced/);
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs');assert.deepEqual(await (await openReviewDatabase(pageWindow.indexedDB)).settings(),{});
 assert.ok(!JSON.stringify(Object.entries(pageWindow).filter(([key])=>key!=='top')).includes('synthetic-private-token'));
});

test('content-only manager bridges Google operations without passing pairing credentials',async()=>{
 const {createPagePhotosBridge}=await import('../lib/userscript-bridge.mjs');
 const pageListeners=[],contentListeners=[],messages=[],requests=[];
 const pageWindow={WIZ_global_data:{...tokens},addEventListener:(type,listener)=>pageListeners.push(listener)};
 const contentWindow={addEventListener:(type,listener)=>contentListeners.push(listener)};
 const send=(listeners,source,data)=>{messages.push(structuredClone(data));queueMicrotask(()=>listeners.forEach(listener=>listener({source,data:structuredClone(data)})));};
 pageWindow.postMessage=data=>send(contentListeners,contentWindow,data);
 contentWindow.postMessage=data=>send(pageListeners,pageWindow,data);
 const pageContext={window:pageWindow,location:page,crypto:webcrypto,AbortController,setTimeout,clearTimeout,TextEncoder,Uint8Array,URL,URLSearchParams,fetch:async(url,options)=>{
  const entry=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0];requests.push(entry[0]);
  return {ok:true,text:async()=>envelope(entry[0],['lcxiM','zy0IHe'].includes(entry[0])?[[],null]:[['synthetic-album']])};
 }};
 const document={querySelector:()=>({nonce:'synthetic-nonce'}),createElement:()=>({setAttribute(key,value){this[key]=value;},remove(){this.removed=true;}}),documentElement:{append(script){assert.equal(script.nonce,'synthetic-nonce');vm.runInNewContext(script.textContent,pageContext);}}};
 const call=createPagePhotosBridge({window:contentWindow,document,crypto:webcrypto,setTimeout,clearTimeout});
 assert.equal((await call('identity')).data.label,tokens.oPEP7c);
 assert.equal((await call('library')).ok,true);assert.equal((await call('trashPage')).ok,true);
 assert.equal((await call('createAlbum',{title:'Photos Swipe · Review · QA-DUMMY'})).ok,true);
 assert.deepEqual(requests,['lcxiM','zy0IHe','OXvT9d']);
 assert.ok(messages.every(message=>!JSON.stringify(message).includes('synthetic-private-token')));
 assert.equal((await call('unsupported')).ok,false);
});

test('sync saves reuse tokens for equivalent origins and retain typed tokens after storage failure',async()=>{
 const source=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8');
 const mounted=bundleEnvironment();mounted.environment.AbortSignal=AbortSignal;
 let pairing={url:'https://sync.example',token:'saved-token',deviceId:'device'},fail=false,requests=0;
 mounted.environment.GM={getValue:async()=>pairing,setValue:async(key,value)=>{if(fail)throw Error('Pairing write failed');pairing=value;},deleteValue:async()=>{pairing=undefined;}};
 mounted.environment.fetch=async()=>{requests++;return {ok:true,json:async()=>({decisions:[],history:[],progress:{}})};};
 vm.runInNewContext(source,mounted.environment);await mounted.nodes.get('launcher').onclick();
 const save=async()=>{mounted.nodes.get('sync-save').onclick();for(let count=0;count<100;count++){await new Promise(resolve=>setTimeout(resolve,1));if(!mounted.nodes.get('keep').disabled)return;}throw Error('UI stayed busy');};
 for(const url of ['https://sync.example/','https://sync.example:443','https://SYNC.EXAMPLE']){
  mounted.nodes.get('sync-url').value=url;await save();assert.equal(pairing.url,'https://sync.example');assert.equal(pairing.token,'saved-token');assert.match(mounted.nodes.get('sync-status').textContent,/^Synced/);
 }
 assert.equal(requests,4);
 mounted.nodes.get('sync-url').value='https://other.example';await save();assert.equal(pairing.url,'https://sync.example');assert.equal(requests,4);
 mounted.nodes.get('sync-url').value='https://sync.example/path';await save();assert.equal(requests,4);
 mounted.nodes.get('sync-url').value='https://sync.example';mounted.nodes.get('sync-token').value='replacement-token';fail=true;await save();
 assert.equal(mounted.nodes.get('sync-token').value,'replacement-token');assert.match(mounted.nodes.get('status').textContent,/Pairing write failed/);assert.equal(pairing.token,'saved-token');
 fail=false;await save();assert.equal(pairing.token,'replacement-token');assert.equal(mounted.nodes.get('sync-token').value,'');
});

function isolatedPageBridge(mounted,timers={setTimeout,clearTimeout},fetchOverride) {
 const pageWindow=mounted.environment.window,pageListeners=[],contentListeners=[],messages=[];
 const contentWindow=new Proxy(pageWindow,{get(target,key){if(key==='top')return contentWindow;if(key==='WIZ_global_data')return undefined;if(key==='addEventListener')return (type,listener)=>{if(type==='message')contentListeners.push(listener);};if(key==='postMessage')return data=>{messages.push(structuredClone(data));queueMicrotask(()=>pageListeners.forEach(listener=>listener({source:pageWindow,data:structuredClone(data)})));};return Reflect.get(target,key);}});
 pageWindow.addEventListener=(type,listener)=>{if(type==='message')pageListeners.push(listener);};
 pageWindow.postMessage=data=>{messages.push(structuredClone(data));queueMicrotask(()=>contentListeners.forEach(listener=>listener({source:contentWindow,data:structuredClone(data)})));};
 const context={window:pageWindow,location:page,crypto:webcrypto,AbortController,...timers,TextEncoder,Uint8Array,URL,URLSearchParams,fetch:fetchOverride||pageWindow.fetch};
 const document=mounted.environment.document,append=document.documentElement.append,createElement=document.createElement;
 document.querySelector=()=>null;document.createElement=tag=>{const element=createElement(tag);element.remove=()=>{};return element;};
 document.documentElement={dataset:{},append(element){if(element.tagName==='SCRIPT')vm.runInNewContext(element.textContent,context);else append(element);}};
 return {pageWindow,contentWindow,messages};
}

test('bundle bridges hidden page data with or without unsafeWindow and migrates page storage',async()=>{
 const source=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8');
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs');
 for(const hasUnsafeWindow of [true,false]){
  const mounted=bundleEnvironment(),bridge=isolatedPageBridge(mounted);
  const db=await openReviewDatabase(bridge.pageWindow.indexedDB);
  await db.saveSettings({url:'https://sync.example',token:'legacy-private-token'});
  mounted.environment.window={...bridge.contentWindow,indexedDB:fakeIndexedDB()};
  mounted.environment.window.top=mounted.environment.window;
  if(hasUnsafeWindow)mounted.environment.unsafeWindow=bridge.contentWindow;
  else mounted.environment.window=bridge.contentWindow;
  let pairing;
  mounted.environment.GM={getValue:async()=>pairing,setValue:async(key,value)=>{pairing=value;},deleteValue:async()=>{pairing=undefined;}};
  mounted.environment.AbortSignal=AbortSignal;mounted.environment.fetch=async()=>({ok:true,json:async()=>({decisions:[],history:[],progress:{}})});
  vm.runInNewContext(source,mounted.environment);await mounted.nodes.get('launcher').onclick();
  assert.equal(mounted.nodes.get('account').textContent,tokens.oPEP7c);assert.equal(pairing.token,'legacy-private-token');assert.deepEqual(await db.settings(),{});
  assert.ok(bridge.messages.some(message=>message.kind==='photos-call'));
  assert.ok(bridge.messages.every(message=>!JSON.stringify(message).includes('legacy-private-token')));
  assert.ok(!Object.values(bridge.pageWindow).includes('legacy-private-token'));
 }
});

test('accepted bridge operations outlive the injection deadline while missing injection times out',async()=>{
 const {createPagePhotosBridge}=await import('../lib/userscript-bridge.mjs');
 let now=0,nextId=0;const scheduled=new Map();
 const timers={setTimeout(callback,delay){const id=++nextId;scheduled.set(id,{callback,due:now+delay});return id;},clearTimeout(id){scheduled.delete(id);}};
 const flush=async()=>{for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));};
 const waitForRequest=async count=>{const deadline=Date.now()+5000;while(requests.length<count){assert.ok(Date.now()<deadline,'Google RPC did not start');await new Promise(resolve=>setTimeout(resolve,1));}};
 const advance=async duration=>{now+=duration;for(const [id,entry] of [...scheduled])if(entry.due<=now){scheduled.delete(id);entry.callback();}await flush();};
 const mounted=bundleEnvironment(),requests=[];
 const bridge=isolatedPageBridge(mounted,timers,async(url,options)=>{
  const id=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0][0];requests.push(id);
  await new Promise(resolve=>timers.setTimeout(resolve,20000));
  const row=['photo',['https://lh3.googleusercontent.com/fake'],1720000000000,'stable',0,{}];
  return {ok:true,text:async()=>envelope(id,id==='lcxiM'?[[row],null]:[[null,[]]])};
 });
 const call=createPagePhotosBridge({window:bridge.contentWindow,document:mounted.environment.document,crypto:webcrypto,...timers});
 let settled=false;const result=call('library').then(value=>{settled=true;return value;});await flush();
 await waitForRequest(1);await advance(20000);await waitForRequest(2);assert.deepEqual(requests,['lcxiM','EWgK9e']);
 await advance(15000);assert.equal(settled,false);
 await advance(5000);assert.equal((await result).ok,true);assert.equal(scheduled.size,0);
 let receiver,request;const missingWindow={addEventListener(type,listener){receiver=listener;},postMessage(data){request=data;}};
 const missing=createPagePhotosBridge({window:missingWindow,document:{querySelector(){},createElement:()=>({remove(){}}),documentElement:{append(){}}},crypto:webcrypto,...timers});
 const unavailable=missing('identity');receiver({source:{},data:{...request,kind:'photos-accepted'}});await advance(35000);assert.match((await unavailable).error,/bridge unavailable/);assert.equal(scheduled.size,0);
 const lostResult=missing('identity');receiver({source:missingWindow,data:{...request,kind:'photos-accepted'}});assert.equal(scheduled.size,1);await advance(35000);assert.match((await lostResult).error,/bridge unavailable/);assert.equal(scheduled.size,0);
 receiver({source:missingWindow,data:{...request,kind:'photos-result',result:{ok:true}}});assert.equal(scheduled.size,0);
});

test('incomplete GM values migrate complete legacy pairing and preserve partial legacy credentials',async()=>{
 const {createPairingStore}=await import('../lib/userscript-settings.mjs');
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs');
 for(const initial of [undefined,null,{}, {url:'https://sync.example'}, {token:'partial'}]){
  const db=await openReviewDatabase(fakeIndexedDB());
  let value=initial,writes=0;
  const GM={getValue:async()=>value,setValue:async(key,next)=>{value=next;writes++;},deleteValue:async()=>{}};
  const store=await createPairingStore({GM,database:async()=>db,crypto:webcrypto});
  const partial={token:'legacy-token',deviceName:'Phone'};
  await db.saveSettings(partial);await store.settings();assert.deepEqual(await db.settings(),partial);assert.equal(writes,0);
  await db.saveSettings({...partial,url:'https://sync.example',onboardingDismissed:true});
  const migrated=await store.settings();assert.equal(migrated.token,'legacy-token');assert.ok(migrated.deviceId);assert.equal(writes,1);
  assert.deepEqual(await db.settings(),{onboardingDismissed:true});await store.settings();assert.equal(writes,1);
 }
});

test('failed GM migration preserves legacy pairing until a durable write succeeds',async()=>{
 const {createPairingStore}=await import('../lib/userscript-settings.mjs');
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs');
 const db=await openReviewDatabase(fakeIndexedDB());
 const legacy={url:'https://sync.example',token:'legacy-token',deviceId:'device',deviceName:'Phone',onboardingDismissed:true};
 await db.saveSettings(legacy);
 let value=null,fail=true;
 const GM={getValue:async()=>value,setValue:async(key,next)=>{if(fail)throw Error('Storage unavailable');value=next;},deleteValue:async()=>{}};
 const store=await createPairingStore({GM,database:async()=>db,crypto:webcrypto});
 await assert.rejects(store.settings(),/Storage unavailable/);
 assert.deepEqual(await db.settings(),legacy);
 fail=false;
 assert.equal((await store.settings()).token,legacy.token);
 assert.equal(value.token,legacy.token);
 assert.deepEqual(await db.settings(),{onboardingDismissed:true});
});

test('signed-in privileged bundle uses page AbortSignals for library, album and Trash requests',async()=>{
 const source=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8');
 const mounted=bundleEnvironment(),pageWindow=mounted.environment.window,requests=[];
 const pageSignals=new WeakSet();
 class PageAbortController extends AbortController {constructor(){super();pageSignals.add(this.signal);}}
 class ContentAbortController {constructor(){throw Error('Content AbortController used for page fetch');}}
 pageWindow.AbortController=PageAbortController;
 pageWindow.fetch=async(url,options)=>{
  assert.ok(pageSignals.has(options.signal));
  const id=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0][0];requests.push(id);
  return {ok:true,text:async()=>envelope(id,id==='OXvT9d'?[['album']]:[[],null])};
 };
 mounted.environment.unsafeWindow=pageWindow;
 mounted.environment.window={...pageWindow,AbortController:ContentAbortController};
 const instrumented=source.replace('mountPhotosSwipe(environment);','globalThis.pageAPI=createPhotosAPI(environment);mountPhotosSwipe(environment);');
 vm.runInNewContext(instrumented,mounted.environment);
 for(const [name,args] of [['library',{}],['createAlbum',{title:'Photos Swipe · Review'}],['trashPage',{}]]){
  const result=await mounted.environment.pageAPI(name,args);assert.equal(result.ok,true,result.error);
 }
 assert.deepEqual(requests,['lcxiM','OXvT9d','zy0IHe']);
});

 test('mounted next preview is reused after a swipe and respects the review filter',async()=>{
 const mounted=await mountedReview([item('a'),item('b'),item('c')]);
 const under=mounted.nodes.get('next-card'),preview=under.querySelector('img');
 assert.equal(under.hidden,false);assert.equal(preview.dataset.key,'b');preview.complete=true;preview.naturalWidth=800;
 await mounted.click('keep');
 assert.equal(mounted.nodes.get('media').querySelector('img'),preview);assert.equal(preview.hidden,false);
 assert.equal(under.querySelector('img').dataset.key,'c');
 mounted.nodes.get('filter').value='video';mounted.nodes.get('filter').onchange();
 assert.equal(under.hidden,true);
 });

test('a failed reused under-card preview refreshes and exposes Retry on another failure',async()=>{
 const calls=[],mounted=await mountedReview([item('a'),item('b'),item('c')],async(url,options)=>{
  const entry=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0],key=JSON.parse(entry[1])[0];calls.push(key);
  return {ok:true,text:async()=>envelope('VrseUb',[[key,['https://photos.fife.usercontent.google.com/synthetic-fresh',800,600]],'https://video-downloads.google.com/download'])};
 });
 const under=mounted.nodes.get('next-card'),preview=under.querySelector('img');preview.complete=true;preview.naturalWidth=0;
 await mounted.click('keep');await settlePreviews();
 assert.deepEqual(calls,['b']);
 const media=mounted.nodes.get('media'),refreshed=media.querySelector('img');assert.ok(refreshed);assert.notEqual(refreshed,preview);
 assert.equal(under.hidden,false);assert.equal(under.querySelector('img').dataset.key,'c');
 await refreshed.onerror();assert.equal(media.querySelector('button').textContent,'Retry');
 media.querySelector('button').onclick();await settlePreviews();
 assert.deepEqual(calls,['b','b']);assert.ok(media.querySelector('img'));
 assert.equal(under.hidden,false);assert.equal(under.querySelector('img').dataset.key,'c');
});

test('an unresolved fly animation never blocks the next decision',async()=>{
 const mounted=await mountedReview([item('a'),item('b'),item('c')]);
 const top=mounted.nodes.get('card').childNodes.find(node=>node.class==='top-card');
 top.animate=()=>({finished:new Promise(()=>{}),cancel(){}});
 mounted.nodes.get('keep').onclick();await mounted.settle();
 assert.equal(mounted.nodes.get('keep').disabled,false);
 assert.equal(mounted.nodes.get('media').querySelector('img').alt,'b');
 mounted.nodes.get('remove').onclick();await mounted.settle();
 assert.equal((await mounted.read()).items[1].decision,'remove');
});
test('mounted under-card shares the media origin and image gestures reach the media container',async()=>{
 const mounted=await mountedReview([item('a'),item('b')]);
 const card=mounted.nodes.get('card'),under=mounted.nodes.get('next-card'),hint=mounted.nodes.get('swipe');
 const top=card.childNodes.find(node=>node.class==='top-card');
 assert.deepEqual(card.childNodes.slice(0,3),[under,top,hint]);
 assert.equal(top.childNodes[0],mounted.nodes.get('media'));
 const styles=mounted.root.childNodes.filter(node=>node.tagName==='STYLE');
 const css=styles.map(node=>node.textContent||node.childNodes.map(child=>child.textContent||'').join('')).join('');
 assert.match(css,/\.under-card\{position:absolute;inset:0 0 auto;/);
 assert.match(css,/\.media img\{pointer-events:none;/);
 mounted.nodes.get('media').listeners.dblclick({target:{tagName:'IMG'}});assert.equal(mounted.nodes.get('card').classList.contains('expanded'),true);
});

test('empty and filtered decks cannot latch swipe dismissal',async()=>{
 const mounted=await mountedReview([item('a')]);
 const {nodes}=mounted,media=nodes.get('media');
 const swipe=()=>{media.listeners.pointerdown({isPrimary:true,button:0,target:{tagName:'IMG'},pointerId:1,clientX:0,clientY:0});media.listeners.pointerup({pointerId:1,clientX:150,clientY:0});};
 nodes.get('filter').value='video';nodes.get('filter').onchange();swipe();
 nodes.get('filter').value='all';nodes.get('filter').onchange();swipe();await mounted.settle();
 assert.equal((await mounted.read()).items[0].decision,'keep');swipe();
 nodes.get('undo').onclick();await mounted.settle();swipe();await mounted.settle();
 assert.equal((await mounted.read()).items[0].decision,'keep');
});
test('deck video buttons control playback and audio and enlarge restores native controls',async()=>{
 const mounted=await mountedReview([item('v',{type:'video'})],async()=>({ok:true,text:async()=>envelope('VrseUb',[['v'],'https://lh3.googleusercontent.com/video'])}));
 const media=mounted.nodes.get('media'),video=media.querySelector('video');
 const buttons=media.childNodes.filter(node=>node.dataset.videoControl);
 assert.equal(video.controls,false);assert.equal(buttons.length,2);
 video.paused=false;buttons[0].onclick();assert.equal(video.paused,true);
 buttons[0].onclick();assert.equal(video.paused,false);
 buttons[1].onclick();assert.equal(video.muted,false);
 mounted.nodes.get('enlarge').onclick();assert.equal(video.controls,true);assert.ok(buttons.every(button=>button.hidden));
 mounted.nodes.get('enlarge').onclick();assert.equal(video.controls,false);assert.ok(buttons.every(button=>!button.hidden));
});
test('overlay stops pointer touch and wheel propagation without cancelling browser defaults',async()=>{
 const mounted=await mountedReview([item('a')]);
 for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','touchstart','touchmove','touchend','touchcancel','wheel']){
  let stopped=false;mounted.nodes.get('overlay').listeners[type]({stopPropagation(){stopped=true;},preventDefault(){assert.fail('Browser defaults must remain available');}});assert.equal(stopped,true);
 }
});

for(const delayed of ['identity','save'])test(`swipes, arrow keys and buttons advance immediately during a delayed ${delayed}`,async()=>{
 const fault={},indexedDB=fakeIndexedDB(fault);let release,holdIdentity=false;
 const gate=new Promise(resolve=>{release=resolve;});
 const crypto={randomUUID:()=>webcrypto.randomUUID(),subtle:{digest:async(...args)=>{if(holdIdentity)await gate;return webcrypto.subtle.digest(...args);}}};
 const mounted=await mountedReview(['a','b','c','d','e'].map(key=>item(key)),{indexedDB,crypto});
 if(delayed==='identity')holdIdentity=true;
 else fault.saveGate=gate;
 const {nodes}=mounted,media=nodes.get('media'),top=nodes.get('card').childNodes.find(node=>node.class==='top-card');
 const swipe=dx=>{media.listeners.pointerdown({isPrimary:true,button:0,target:{tagName:'IMG'},pointerId:1,clientX:0,clientY:0});media.listeners.pointerup({pointerId:1,clientX:dx,clientY:0});};
 const shown=name=>{assert.equal(media.querySelector('img').alt,name);assert.equal(top.style.visibility,'');assert.equal(nodes.get('keep').disabled,false);assert.equal(nodes.get('remove').disabled,false);};
 try {
  swipe(150);shown('b');
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(nodes.get('overlay')['aria-busy'],'false');
  swipe(-150);shown('c');
  mounted.environment.window.listeners.keydown({key:'ArrowRight',preventDefault(){},stopImmediatePropagation(){}});shown('d');
  nodes.get('remove').onclick();shown('e');
  assert.deepEqual((await mounted.read()).items.map(row=>row.decision),[null,null,null,null,null]);
 }finally{release();}
 await mounted.settle();
 const saved=await mounted.read();
 assert.deepEqual(saved.items.map(row=>row.decision),['keep','remove','keep','remove',null]);
 assert.deepEqual(saved.history.map(entry=>[entry.key,entry.decision,entry.revision]),[['a','keep',1],['b','remove',1],['c','keep',1],['d','remove',1]]);
 shown('e');
});

test('a failed decision save retains visible pending decisions and retries them on fresh input',async()=>{
 const fault={},mounted=await mountedReview(['a','b','c'].map(key=>item(key)),{indexedDB:fakeIndexedDB(fault)});
 fault.failSave=true;
 mounted.nodes.get('keep').onclick();mounted.nodes.get('remove').onclick();
 await mounted.settle();
 assert.equal(mounted.nodes.get('media').querySelector('img').alt,'c');
 assert.deepEqual((await mounted.read()).items.map(row=>row.decision),[null,null,null]);
 assert.match(mounted.nodes.get('status').textContent,/Fake storage failure/);
 fault.failSave=false;
 await mounted.click('remove');
 assert.deepEqual((await mounted.read()).items.map(row=>row.decision),['keep','remove','remove']);
});

test('a decision arriving as the save operation finishes remains queued for its own item',async()=>{
 const fault={},mounted=await mountedReview(['a','b','c'].map(key=>item(key)),{indexedDB:fakeIndexedDB(fault)});
 let release;fault.releaseGate=new Promise(resolve=>{release=resolve;});
 try {
  mounted.nodes.get('keep').onclick();
  for(let count=0;count<100;count++){if((await mounted.read()).items[0].decision==='keep')break;await new Promise(resolve=>setTimeout(resolve,1));}
  assert.equal((await mounted.read()).items[0].decision,'keep');
  assert.equal(mounted.nodes.get('overlay')['aria-busy'],'false');
  mounted.nodes.get('remove').onclick();
  assert.equal(mounted.nodes.get('media').querySelector('img').alt,'c');
 }finally{release();}
 await mounted.settle();
 assert.deepEqual((await mounted.read()).items.map(row=>row.decision),['keep','remove',null]);
});

test('pairing dialog blocks viewer shortcuts and Escape burns the code',async()=>{
 const calls=[];
 const mounted=await mountedReview([item('photo')],{fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({id:'pair-id',code:'abcdefghijklmnopqrstuv',short:'123456',expiresAt:Date.now()+60000})};}});
 mounted.environment.AbortSignal=AbortSignal;
 const {nodes,root}=mounted;
 const panel=root.childNodes.find(node=>node['aria-label']==='Pair another device');
 assert.ok(panel);
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs');
 const db=await openReviewDatabase(mounted.environment.window.indexedDB);
 await db.saveSettings({url:'https://worker.example',token:'secret-token'});
 await nodes.get('pair-another').onclick();
 assert.equal(panel.hidden,false);
 const before=await mounted.read();
 for(const key of ['ArrowLeft','ArrowRight','z','f',' ']){
  const event={type:'keydown',key,preventDefault(){throw Error('Pairing key swallowed');},stopImmediatePropagation(){throw Error('Pairing key stopped');}};
  mounted.environment.window.listeners.keydown(event);
 }
 assert.deepEqual(await mounted.read(),before);assert.equal(nodes.get('overlay').hidden,false);assert.equal(nodes.get('card').classList.contains('expanded'),false);
 mounted.environment.window.listeners.keydown({key:'Escape',preventDefault(){},stopImmediatePropagation(){}});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(panel.hidden,true);assert.equal(nodes.get('overlay').hidden,false);
 assert.equal(calls.at(-2).options.method,'DELETE');assert.equal(calls.at(-2).options.body,JSON.stringify({id:'pair-id'}));
});
test('userscript cancels the live snap-back before a filter renders another photo',async()=>{
 const mounted=await mountedReview([item('a'),item('b',{type:'video'})]);
 const card=mounted.nodes.get('card').childNodes.find(node=>node.class==='top-card'),media=mounted.nodes.get('media');
 let running=false,cancelled=0;
 card.animate=()=>{running=true;return {finished:Promise.resolve(),cancel(){running=false;cancelled++;}};};
 card.getAnimations=()=>running?[{cancel(){running=false;cancelled++;}}]:[];
 media.listeners.pointerdown({isPrimary:true,button:0,target:{tagName:'VIDEO',getBoundingClientRect:()=>({bottom:300})},pointerId:1,clientX:20,clientY:20,timeStamp:0});
 media.listeners.pointerup({pointerId:1,clientX:40,clientY:20,timeStamp:200});
 assert.equal(running,true);
 mounted.nodes.get('filter').value='video';
 mounted.nodes.get('filter').onchange();
 assert.equal(running,false);
 assert.equal(cancelled,1);
});

test('review preloads match card sizing, respect compact viewports and refresh on resize',async()=>{
 for(const compact of [false,true]){
  const created=[],mounted=await mountedReview(Array.from({length:6},(_,index)=>item(`sized-${index}`))),document=mounted.environment.document;
  const create=document.createElement;
  document.createElement=tag=>{const node=create(tag);if(tag==='img')created.push(node);return node;};
  mounted.environment.window.matchMedia=query=>({matches:query==='(max-width:760px), (pointer:coarse)'&&compact});
  const media=mounted.nodes.get('media');media.getBoundingClientRect=()=>({width:compact?360:900,height:compact?260:500});
  mounted.environment.window.listeners.resize();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(created.length,compact?2:3);
  const expected=compact?'=w360-h260-k-no':'=w900-h500-k-no';
  assert.ok([...created,media.querySelector('img')].every(image=>new URL(image.src).pathname.endsWith(expected)));
  assert.ok(created.every(image=>new URL(image.src).searchParams.get('authuser')==='2'));
  await mounted.click('keep');assert.equal(new URL(media.querySelector('img').src).pathname.endsWith(expected),true);
  mounted.nodes.get('close').onclick();
 }
});


test('ahead video completion does not write leases during an active sync',async()=>{
 const response=Promise.withResolvers(),sync=Promise.withResolvers(),started=Promise.withResolvers(),fault={};
 const indexedDB=fakeIndexedDB(fault);
 const mounted=await mountedReview([item('first'),item('next'),item('ahead',{type:'video'})],{indexedDB,fetch:async(url,options)=>{
  if(new URL(url).origin==='https://sync.example'){started.resolve();await sync.promise;return {ok:true,json:async()=>({decisions:[],history:[],progress:{}})};}
  const entry=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0];
  assert.equal(entry[0],'VrseUb');await response.promise;
  return {ok:true,text:async()=>envelope(entry[0],[['ahead'],'https://lh3.googleusercontent.com/ahead-video'])};
 }});
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs'),db=await openReviewDatabase(indexedDB);
 const account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 await db.save(account,{...await db.read(account),items:[item('first'),item('next'),item('ahead',{type:'video'})]});
 await mounted.nodes.get('launcher').onclick();
 mounted.environment.AbortSignal=AbortSignal;
 mounted.nodes.get('sync-url').value='https://sync.example';mounted.nodes.get('sync-token').value='synthetic-token';
 mounted.nodes.get('sync-save').onclick();await started.promise;
 const before=fault.leaseWrites;
 response.resolve();await new Promise(resolve=>setImmediate(resolve));
 try{assert.equal(fault.leaseWrites,before);}finally{sync.resolve();}
 for(let count=0;count<100&&mounted.nodes.get('keep').disabled;count++)await new Promise(resolve=>setTimeout(resolve,1));
 await mounted.nodes.get('close').onclick();await db.lease(account,'other-tab');await db.lease(account,'other-tab',true);
});

test('resize and enlarge preserve the next media node while a decision awaits sync',async()=>{
 for(const type of ['photo','video']){
  let holdSync=false;
  const sync=Promise.withResolvers(),started=Promise.withResolvers();
  const mounted=await mountedReview([item('shown',{type,thumbUrl:'https://lh3.googleusercontent.com/shown'}),item('next',{thumbUrl:'https://lh3.googleusercontent.com/next'})],async url=>{
   if(new URL(url).origin==='https://sync.example'){if(holdSync){started.resolve();await sync.promise;}return {ok:true,json:async()=>({decisions:[],history:[],progress:{}})};}
   return {ok:true,text:async()=>envelope('VrseUb',[['shown'],'https://lh3.googleusercontent.com/shown-video'])};
  });
  await new Promise(resolve=>setImmediate(resolve));
  mounted.environment.AbortSignal=AbortSignal;
  mounted.nodes.get('sync-url').value='https://sync.example';mounted.nodes.get('sync-token').value='synthetic-token';
  await mounted.click('sync-save');
  holdSync=true;
  const media=mounted.nodes.get('media');
  const deciding=mounted.click('keep');await deciding;mounted.environment.window.dispatchEvent(new Event('focus'));await started.promise;
  const node=media.childNodes[0];
  assert.equal((await mounted.read()).items[0].decision,'keep');
  media.getBoundingClientRect=()=>({width:900,height:500});
  try{
  mounted.environment.window.listeners.resize();
  mounted.environment.window.listeners.keydown({key:'f',preventDefault(){},stopImmediatePropagation(){}});
  assert.equal(media.childNodes[0],node);assert.match(node.src,/next=w900-h500/);
  }finally{sync.resolve();await deciding;}
  assert.equal(media.childNodes[0],node);assert.match(media.childNodes[0].src,/next=w900-h500/);
 }
});

function controlledCardAnimations(mounted){
 const animations=[];
 const animate=(frames,options)=>{
  let resolve;
  const animation={frames,options,finished:new Promise(done=>{resolve=done;}),finish(){this.finishedInstantly=true;resolve();},cancel(){this.cancelled=true;resolve();}};
  animations.push(animation);return animation;
 };
 mounted.nodes.get('card').animate=animate;
 mounted.nodes.get('card').childNodes.find(node=>node.class==='top-card').animate=animate;
 return animations;
}
async function waitForReview(predicate){
 for(let count=0;count<200;count++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,1));}
 assert.fail('Synthetic review did not settle');
}
function pressReviewKey(mounted,key){mounted.environment.window.listeners.keydown({key,preventDefault(){},stopImmediatePropagation(){}});}

for(const [key,button,decision,side] of [['ArrowLeft','remove','remove',-1],['ArrowRight','keep','keep',1]]){
 test(`mounted ${key} and ${button} share the fly-off and Undo returns from that side`,async()=>{
  const mounted=await mountedReview([item('a'),item('b')]),animations=controlledCardAnimations(mounted);
  pressReviewKey(mounted,key);
  await mounted.settle();
  assert.match(animations[0].frames[1].transform,new RegExp(`translate3d\\(${side*450}px`));
  mounted.nodes.get(button).onclick();
  mounted.nodes.get('undo').onclick();
  await waitForReview(()=>animations.length===3);
  assert.match(animations[2].frames[0].transform,new RegExp(`translateX\\(${side*120}vw\\)`));
  assert.equal(animations[2].options.duration,250);
  assert.equal((await mounted.read()).items[1].decision,null);
  animations[2].finish();
  await mounted.settle();
  assert.equal((await mounted.read()).items[0].decision,decision);
 });
}

test('mounted ten rapid arrow inputs advance and persist ten ordered decisions',async()=>{
 const mounted=await mountedReview(Array.from({length:11},(_,index)=>item(String(index)))),animations=controlledCardAnimations(mounted);
 for(let index=0;index<10;index++)pressReviewKey(mounted,index%2?'ArrowRight':'ArrowLeft');
 await mounted.settle();
 const state=await mounted.read();
 assert.equal(animations.length,10);
 assert.equal(state.history.length,10);
 assert.deepEqual(state.items.slice(0,10).map(row=>row.decision),Array.from({length:10},(_,index)=>index%2?'keep':'remove'));
 assert.equal(state.items[10].decision,null);
});

test('failed decisions retain the burst locally and retry when the page becomes visible',async()=>{
 const fault={},mounted=await mountedReview([item('a'),item('b'),item('c')],{},fault);
 fault.failSave=true;
 pressReviewKey(mounted,'ArrowLeft');pressReviewKey(mounted,'ArrowRight');pressReviewKey(mounted,'ArrowLeft');
 await mounted.settle();
 assert.match(mounted.nodes.get('status').textContent,/Fake storage failure/);
 assert.equal((await mounted.read()).history.length,0);
 fault.failSave=false;
 mounted.environment.document.listeners.visibilitychange();await mounted.settle();
 assert.deepEqual((await mounted.read()).items.map(row=>row.decision),['remove','keep','remove']);
});

test('decision and Undo key repeats do not enqueue actions',async()=>{
 const mounted=await mountedReview([item('a'),item('b')]),animations=controlledCardAnimations(mounted);
 pressReviewKey(mounted,'ArrowRight');
 for(const key of ['ArrowLeft','ArrowRight','z','Z'])mounted.environment.window.listeners.keydown({key,repeat:true,preventDefault(){},stopImmediatePropagation(){}});
 await mounted.settle();
 assert.deepEqual((await mounted.read()).items.map(row=>row.decision),['keep',null]);
 assert.equal(animations.length,1);
});

test('a slow save preserves the next card and accepts another swipe',async()=>{
 const fault={},mounted=await mountedReview([item('a'),item('b'),item('c')],{},fault),animations=controlledCardAnimations(mounted);
 let release;fault.holdSave=new Promise(resolve=>{release=resolve;});
 try{
  pressReviewKey(mounted,'ArrowLeft');
  animations[0].finish();
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.match(mounted.nodes.get('caption').textContent,/^b /);
  assert.equal(mounted.nodes.get('keep').disabled,false);
  const swipe=mounted.nodes.get('swipe');
  swipe.listeners.pointerdown({button:0,pointerId:1,clientX:0,clientY:0,target:swipe});
  swipe.listeners.pointerup({pointerId:1,clientX:120,clientY:0});
  assert.match(mounted.nodes.get('caption').textContent,/^c /);
 }finally{fault.holdSave=null;release();}
 await mounted.settle();
 assert.deepEqual((await mounted.read()).items.map(row=>row.decision),['remove','keep',null]);
});

test('an Undo animation that never settles releases the review task at its deadline',async()=>{
 const mounted=await mountedReview([item('a'),item('b')]);
 await mounted.click('keep');
 let cancelled=false;
 mounted.nodes.get('card').animate=()=>({finished:new Promise(()=>{}),finish(){},cancel(){cancelled=true;}});
 pressReviewKey(mounted,'z');
 await new Promise(resolve=>setTimeout(resolve,400));
 assert.equal(mounted.nodes.get('overlay')['aria-busy'],'false');
 assert.equal(cancelled,true);
 assert.equal((await mounted.read()).items[0].decision,null);
});

test('revoked userscript shows recovery, keeps local swipes and clears credentials',async()=>{
 const mounted=await mountedReview([item('synthetic')]);await mounted.nodes.get('close').onclick();
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs');const db=await openReviewDatabase(mounted.environment.window.indexedDB);
 await db.saveSettings({url:'https://sync.example',token:'synthetic-token'});
 const reopened=bundleEnvironment();reopened.environment.window.indexedDB=mounted.environment.window.indexedDB;reopened.environment.AbortSignal=AbortSignal;
 let requests=0;reopened.environment.window.fetch=async()=>{requests++;return new Response('{}',{status:401});};
 vm.runInNewContext(await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8'),reopened.environment);
 await reopened.nodes.get('launcher').onclick();assert.equal(reopened.nodes.get('unpaired-banner').hidden,false);assert.equal((await db.settings()).token,'');
 reopened.nodes.get('keep').onclick();await waitForReview(async()=>(await mounted.read()).items[0].decision==='keep');
 const saved=await mounted.read();assert.equal(saved.items[0].decision,'keep');assert.equal(saved.syncPending.synthetic,'keep');assert.equal(requests,1);
 reopened.nodes.get('pair-again').onclick();assert.equal(reopened.nodes.get('enter-pairing-code').open,true);
 reopened.nodes.get('dismiss-unpaired').onclick();assert.equal(reopened.nodes.get('unpaired-banner').hidden,true);
});


test('paired devices render names safely and inline rename and confirmed revoke refresh server state',async()=>{
 const requests=[],prompts=[];let name='<synthetic>',active=true;
 const mounted=await mountedReview([], {confirm:prompt=>{prompts.push(prompt);return true;},fetch:async(url,options)=>{
  const path=new URL(url).pathname;requests.push([path,options.method]);
  if(path==='/api/devices/qa'&&options.method==='PATCH')name=JSON.parse(options.body).name;
  if(path==='/api/devices/qa'&&options.method==='DELETE')active=false;
  return {ok:true,json:async()=>path==='/api/devices'?{deviceId:'caller',devices:active?[{id:'qa',name,platform:'Browser',created_at:1,last_seen_at:1,revoked_at:null,is_legacy:1}]:[]}:{decisions:[],history:[],progress:{}}};
 }});
 mounted.environment.AbortSignal=AbortSignal;mounted.nodes.get('sync-url').value='https://sync.example';mounted.nodes.get('sync-token').value='synthetic-token';await mounted.click('sync-save');await mounted.click('refresh-devices');
 const list=mounted.nodes.get('devices-list'),row=list.childNodes[0];assert.match(row.childNodes[0].textContent,/<synthetic>.*Legacy shared token/);
 row.childNodes[1].onclick();row.childNodes[3].value='  QA phone  ';await row.childNodes[4].onclick();assert.equal(name,'QA phone');
 await list.childNodes[0].childNodes[2].onclick();assert.equal(list.childNodes.length,0);assert.equal(prompts[0],'Revoke QA phone? It will stop syncing immediately.');
 assert.ok(requests.some(([path,method])=>path==='/api/devices/qa'&&method==='PATCH'));
});

test('paired notice stays visible with settings closed and opens the device list',async()=>{
 const requests=[];
 const mounted=await mountedReview([], {fetch:async url=>{
  const path=new URL(url).pathname;requests.push(path);
  return {ok:true,json:async()=>path==='/api/devices'?{deviceId:'caller',devices:[]}:{decisions:[],history:[],progress:{},suggestRevokeLegacy:true}};
 }});
 mounted.environment.AbortSignal=AbortSignal;
 mounted.nodes.get('sync-url').value='https://sync.example';mounted.nodes.get('sync-token').value='synthetic-token';
 await mounted.click('sync-save');
 const notice=mounted.nodes.get('paired-notice'),settings=mounted.nodes.get('sync-settings');
 assert.equal(settings.open,false);assert.equal(notice.hidden,false);
 assert.ok(mounted.nodes.get('overlay').childNodes[0].childNodes.includes(notice));
 await mounted.click('paired-notice');
 assert.equal(settings.open,true);assert.equal(mounted.nodes.get('paired-devices').open,true);
 assert.ok(requests.includes('/api/devices'));
});

test('device actions are disabled before configuration and after revoking this device',async()=>{
 const requests=[];
 const mounted=await mountedReview([], {confirm:()=>true,fetch:async(url,options)=>{
  const path=new URL(url).pathname;requests.push([path,options.method]);
  return {ok:true,json:async()=>path==='/api/devices'?{deviceId:'caller',devices:[{id:'caller',name:'This browser',platform:'Browser',created_at:1,last_seen_at:1,revoked_at:null}]}:{decisions:[],history:[],progress:{}}};
 }});
 for(const id of ['refresh-devices','revoke-other-devices'])assert.equal(mounted.nodes.get(id).disabled,true);
 assert.equal(requests.length,0);
 mounted.environment.AbortSignal=AbortSignal;
 mounted.nodes.get('sync-url').value='https://sync.example';mounted.nodes.get('sync-token').value='synthetic-token';await mounted.click('sync-save');
 for(const id of ['refresh-devices','revoke-other-devices'])assert.equal(mounted.nodes.get(id).disabled,false);
 await mounted.click('refresh-devices');await mounted.nodes.get('devices-list').childNodes[0].childNodes[2].onclick();
 for(const id of ['refresh-devices','revoke-other-devices'])assert.equal(mounted.nodes.get(id).disabled,true);
 assert.equal(mounted.nodes.get('devices-list').childNodes.length,0);
 assert.equal(mounted.nodes.get('unpaired-banner').hidden,false);
});

const settlePreviews=()=>new Promise(resolve=>setTimeout(resolve,30));

test('stale saved previews refresh only the current and preload window on open and resume',async()=>{
 const calls=[],items=Array.from({length:7},(_,i)=>item(`saved${i}`,{urlFetchedAt:Date.now()-41*60*1000}));
 const mounted=await mountedReview(items,async(url,options)=>{
  const entry=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0],key=JSON.parse(entry[1])[0];calls.push(key);
  return {ok:true,text:async()=>envelope('VrseUb',[[key,[`https://photos.fife.usercontent.google.com/fresh-${key}`,800,600]],'https://video-downloads.google.com/download'])};
 });
 await settlePreviews();
 assert.deepEqual([...new Set(calls)].sort(),['saved0','saved1','saved2','saved3']);
 assert.equal(calls.length,4);
 assert.match(mounted.nodes.get('media').querySelector('img').src,/fresh-saved0/);
 assert.equal(mounted.nodes.get('next-card').hidden,false);assert.equal(mounted.nodes.get('next-card').querySelector('img').dataset.key,'saved1');
 assert.equal((await mounted.read()).items.filter(row=>row.decision).length,0);
 calls.length=0;
 mounted.environment.document.visibilityState='visible';
 mounted.environment.document.listeners.visibilitychange();await settlePreviews();
 assert.equal(calls.length,0);
 const actualNow=Date.now;Date.now=()=>actualNow()+41*60*1000;
 try{mounted.environment.document.listeners.visibilitychange();await settlePreviews();}finally{Date.now=actualNow;}
 assert.equal(calls.length,4);
 assert.equal(mounted.nodes.get('next-card').hidden,false);assert.equal(mounted.nodes.get('next-card').querySelector('img').dataset.key,'saved1');
 mounted.nodes.get('close').onclick();calls.length=0;
 mounted.environment.document.listeners.visibilitychange();await settlePreviews();assert.equal(calls.length,0);
});

test('photo and video errors refresh once then replace failed media with an explicit Retry card',async()=>{
 for(const type of ['photo','video']){
  const calls=[];
  const mounted=await mountedReview([item('expired',{type})],async(url,options)=>{
   const entry=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0];calls.push(entry[0]);
   return {ok:true,text:async()=>envelope('VrseUb',[['expired',[`https://photos.fife.usercontent.google.com/fresh-preview-${calls.length}`,800,600]],`https://lh3.googleusercontent.com/fresh-playback-${calls.length}`])};
  });
  await settlePreviews();calls.length=0;
  const container=mounted.nodes.get('media'),tag=type==='video'?'video':'img',first=container.querySelector(tag);
  await first.onerror();await settlePreviews();
  const retried=container.querySelector(tag);assert.ok(retried);assert.notEqual(retried,first);assert.match(retried.src,type==='video'?/fresh-playback-/:/^https:\/\/photos\.fife\.usercontent\.google\.com\/fresh-preview-.*=w\d+-h\d+-k-no\?authuser=2$/);
  assert.equal(calls.length,type==='video'?2:1);
  await retried.onerror();assert.equal(container.querySelector(tag),null);
  const retry=container.querySelector('button');assert.equal(retry.textContent,'Retry');
  const count=calls.length;retry.onclick();await settlePreviews();
  assert.ok(container.querySelector(tag));assert.ok(calls.length>count);
  assert.equal((await mounted.read()).items[0].decision,null);
 }
});

test('late expired preview responses cannot replace a newly selected card',async()=>{
 const response=Promise.withResolvers();
 const mounted=await mountedReview([item('old'),item('next')],async()=>{await response.promise;return {ok:true,text:async()=>envelope('VrseUb',[['old',['https://photos.fife.usercontent.google.com/fresh-old',800,600]],'https://video-downloads.google.com/download'])};});
 const failed=mounted.nodes.get('media').querySelector('img').onerror();
 await mounted.click('keep');const next=mounted.nodes.get('media').querySelector('img');
 response.resolve();await failed;await settlePreviews();
 assert.equal(mounted.nodes.get('media').querySelector('img'),next);
 assert.match(mounted.nodes.get('caption').textContent,/^next/);
});

test('durable unpair preserves settings on reopen and saving a new token clears recovery',async()=>{
 const source=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8');
 const first=bundleEnvironment(),indexedDB=first.environment.window.indexedDB;
 let pairing={url:'https://sync.example',token:'synthetic-revoked-token',deviceId:'synthetic-device',deviceName:'Synthetic phone'},reject=true;
 const GM={getValue:async()=>pairing,setValue:async(key,value)=>{pairing=value;},deleteValue:async()=>{pairing=undefined;}};
 const mount=async()=>{
  const mounted=bundleEnvironment();mounted.environment.window.indexedDB=indexedDB;mounted.environment.GM=GM;mounted.environment.AbortSignal=AbortSignal;
  mounted.environment.window.fetch=async()=>reject?new Response('{}',{status:401}):new Response(JSON.stringify({decisions:[],history:[],progress:{}}));
  vm.runInNewContext(source,mounted.environment);await mounted.nodes.get('launcher').onclick();return mounted;
 };
 const revoked=await mount();assert.equal(pairing,undefined);assert.equal(revoked.nodes.get('unpaired-banner').hidden,false);revoked.nodes.get('close').onclick();
 const reopened=await mount();assert.equal(reopened.nodes.get('sync-url').value,'https://sync.example');assert.equal(reopened.nodes.get('unpaired-banner').hidden,false);
 reject=false;reopened.nodes.get('sync-token').value='synthetic-new-token';reopened.nodes.get('sync-save').onclick();await waitForReview(()=>reopened.nodes.get('overlay')['aria-busy']==='false');
 assert.equal(pairing.token,'synthetic-new-token');assert.equal(pairing.deviceId,'synthetic-device');assert.equal(pairing.deviceName,'Synthetic phone');assert.equal(reopened.nodes.get('unpaired-banner').hidden,true);assert.match(reopened.nodes.get('sync-status').textContent,/Synced/);
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs');assert.equal((await (await openReviewDatabase(indexedDB)).settings()).unpaired,undefined);
 reopened.nodes.get('close').onclick();const repaired=await mount();assert.equal(repaired.nodes.get('unpaired-banner').hidden,true);assert.match(repaired.nodes.get('sync-status').textContent,/Synced/);
});

test('mixed decisions and Undo retain input order across a delayed save',async()=>{
 const fault={},mounted=await mountedReview([item('a'),item('b'),item('c')],{},fault);
 let release;fault.saveGate=new Promise(resolve=>{release=resolve;});
 try{
  pressReviewKey(mounted,'ArrowRight');
  pressReviewKey(mounted,'z');
  pressReviewKey(mounted,'ArrowLeft');
  pressReviewKey(mounted,'ArrowRight');
 }finally{fault.saveGate=null;release();}
 await mounted.settle();
 const state=await mounted.read();
 assert.deepEqual(state.items.map(row=>row.decision),['remove','keep',null]);
 assert.deepEqual(state.history.map(entry=>[entry.key,entry.decision]),[['a','remove'],['b','keep']]);
});

test('decision history caps visible rows while retaining all Undo entries',async()=>{
 const mounted=await mountedReview(Array.from({length:105},(_,index)=>item(`synthetic-${index}-${'x'.repeat(160)}`)));
 for(let index=0;index<105;index++)await mounted.click('keep');
 const rows=mounted.nodes.get('history-list').childNodes;
 assert.equal(rows.length,101);
 assert.equal(rows[100].textContent,'Showing the latest 100 of 105 decisions.');
 assert.match(rows[0].textContent,/synthetic-104-/);
 assert.equal((await mounted.read()).history.length,105);
});

test('loader panel displays the selected signed release version instead of the bundled version',async()=>{
 const code=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8');
 for(const version of ['1.2.99','1.2.8']){
  const mounted=bundleEnvironment();
  const document={documentElement:{dataset:{}},querySelector:()=>null,createElement:()=>({remove(){}}),head:{appendChild:script=>vm.runInNewContext(script.textContent,mounted.environment)}};
  assert.equal(injectRelease({document},{version,code}),true);
  assert.equal(mounted.nodes.get('running-version').textContent,'v'+version);
 }
});
