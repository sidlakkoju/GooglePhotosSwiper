import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {buildPhotosRequest,parsePhotosResponse,createPhotosAPI} from '../lib/userscript-api.mjs';
import {emptyReview,reviewDeck,reviewQueue,reviewStorage,mergeReviewPage,canUndoReview,decideReview,finishReviewAlbum,sendReviewAlbum,readReviewTrash,reconcileReviewTrash} from '../lib/userscript-core.mjs';
const tokens={SNlM0e:'fake-token',oPEP7c:'fake@example.test',eptZe:'/_/PhotosUi/u/2/',FdrFJe:'fake-session',cfb2h:'fake-build'};
const page={origin:'https://photos.google.com',pathname:'/u/2/'};
const envelope=(id,data)=>`)]}'\n\n123\n${JSON.stringify([['wrb.fr','unrelated','[]'],['wrb.fr',id,JSON.stringify(data)]])}\n`;
const item=(mediaKey,extra={})=>({mediaKey,name:mediaKey,type:'photo',thumbUrl:'https://lh3.googleusercontent.com/fake',decision:null,state:'active',...extra});
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
test('built userscript metadata, page isolation, no privileged APIs and reproducible artifact',async()=>{
 const source=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8');
 const url='https://raw.githubusercontent.com/sidlakkoju/GooglePhotosSwiper/main/userscript/photoswiper.user.js';
 for(const entry of ['@match https://photos.google.com/*','@run-at document-idle','@grant none','@inject-into page',`@updateURL ${url}`,`@downloadURL ${url}`])assert.ok(source.includes(`// ${entry}\n`));
 assert.match(source,/\/\/ @version \d+\.\d+\.\d+\n/);assert.doesNotMatch(source,/\bGM[_\.]|chrome\.|localhost|photos-swipe-request/);
 assert.match(source,/attachShadow\(\{mode:'open'\}\)/);assert.ok(source.indexOf('const cardElement=')<source.indexOf('const statsElement='));
 const body=source.slice(source.indexOf('// ==/UserScript==')+'// ==/UserScript=='.length);assert.doesNotMatch(body,/^\s*\/\/|\/\*/m);
 new vm.Script(source);
 const mounted=bundleEnvironment();
 vm.runInNewContext(source,mounted.environment);
 assert.equal(mounted.hosts.length,1);assert.equal(mounted.shadowMode,'open');
 assert.equal(typeof mounted.nodes.get('launcher').onclick,'function');
 assert.match(mounted.root.childNodes[0].childNodes[0].textContent,/#zoom\{[^}]*min-height:44px/);
 assert.doesNotMatch(source,/innerHTML|outerHTML|insertAdjacentHTML/);
 const metadata=source.slice(0,source.indexOf('// ==/UserScript=='));
 for(const line of metadata.trim().split('\n').slice(1))assert.match(line,/^\/\/ @/);
 vm.runInNewContext(source,mounted.environment);assert.equal(mounted.hosts.length,1);
 const result=spawnSync(process.execPath,['scripts/build-userscript.mjs','--check'],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
});
test('unavailable saved albums can be replaced without resetting sent decisions',async()=>{
 const workspace=albumWorkspace([item('a',{decision:'remove'}),item('sent',{decision:'remove',queueSent:true})]);
 await workspace.save({...workspace.state(),albumKey:'old-album'});const writes=[];
 const call=async(operation,args)=>{
  if(operation==='albumMembers'){if(args.albumKey==='old-album')throw Error('Fake unavailable album');return {keys:writes.flat(),dedupKeys:[]};}
  if(operation==='findAlbum')return {albumKey:null};if(operation==='createAlbum')return {albumKey:'replacement'};
  if(operation==='addToAlbum')writes.push(args.mediaKeys);
 };
 await sendReviewAlbum({...workspace,call,title:'Photos Swipe · Review · fake'});
 assert.deepEqual(writes,[['a']]);assert.equal(workspace.state().albumKey,'replacement');assert.equal(workspace.state().items[1].queueSent,true);
});
test('an existing but unreadable album is retained for retry instead of creating a duplicate',async()=>{
 const workspace=albumWorkspace([item('a',{decision:'remove'})]);await workspace.save({...workspace.state(),albumKey:'album'});const calls=[];
 const call=async operation=>{calls.push(operation);if(operation==='albumMembers')throw Error('Fake read failure');if(operation==='findAlbum')return {albumKey:'album'};};
 await assert.rejects(sendReviewAlbum({...workspace,call,title:'Photos Swipe · Review · fake'}),/read failure/);
 assert.equal(workspace.state().job.albumKey,'album');assert.equal(reviewQueue(workspace.state()).length,1);assert.ok(!calls.includes('createAlbum'));
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
  createObjectStore:name=>stores.set(name,new Map()),close(){},
  transaction(name){
   const staged=new Map(stores.get(name));let aborted=false;
   const tx={objectStore:()=>({
    get(key){const request={};queueMicrotask(()=>{request.result=structuredClone(staged.get(key));request.onsuccess();queueMicrotask(()=>{if(!aborted){stores.set(name,staged);tx.oncomplete();}});});return request;},
    put:(value,key)=>{if(name==='accounts'&&fault.failSave)throw Error('Fake storage failure');staged.set(key,structuredClone(value));}
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
 const reopened=await openReviewDatabase(indexedDB);assert.deepEqual(await reopened.read('account-a'),saved);assert.deepEqual(await reopened.read('account-b'),emptyReview());
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

function bundleEnvironment() {
 const nodes=new Map(),hosts=[];
 const element=tag=>({tagName:tag.toUpperCase(),style:{},childNodes:[],hidden:false,value:'',classList:{toggle(){},contains(){return false;}},append(...children){this.childNodes.push(...children);},replaceChildren(...children){this.childNodes=children;},querySelector(){return null;},setAttribute(key,value){this[key]=value;if(key==='id')nodes.set(value,this);if(key==='value')this.value=value;},listeners:{},addEventListener(name,handler){this.listeners[name]=handler;},setPointerCapture(){},focus(){}});
 const root={childNodes:[],append(...children){this.childNodes.push(...children);},getElementById:id=>nodes.get(id),querySelectorAll:()=>[...nodes.values()].filter(node=>['BUTTON','SELECT'].includes(node.tagName))};
 Object.defineProperty(root,'innerHTML',{set(){throw new TypeError('TrustedHTML required');}});
 const result={nodes,hosts,root};
 const document={createTextNode:textContent=>({textContent}),getElementById:id=>hosts.find(host=>host.id===id),createElement:tag=>{const node=element(tag);if(tag==='select')node.value='';const append=node.append;node.append=function(...children){append.call(this,...children);if(tag==='select'&&!this.value)this.value=children[0].value;};node.attachShadow=options=>{result.shadowMode=options.mode;return root;};return node;},documentElement:{append:host=>hosts.push(host)}};
 const window={WIZ_global_data:{...tokens},crypto:webcrypto,indexedDB:fakeIndexedDB(),fetch:async()=>{throw Error('Unexpected fake network request');},setTimeout,clearTimeout,AbortController,addEventListener(){}};window.top=window;
 result.environment={window,document,location:{...page},structuredClone,URL,URLSearchParams,TextEncoder,Uint8Array,setInterval,clearInterval};
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
test('mounted bundle keeps album links in the page account and undo skips stale history',async()=>{
 const source=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8'),mounted=bundleEnvironment();
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs'),fault={};
 mounted.environment.window.indexedDB=fakeIndexedDB(fault);
 if(fetch)mounted.environment.window.fetch=fetch;
 const db=await openReviewDatabase(mounted.environment.window.indexedDB),account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 await db.save(account,{...emptyReview(),albumKey:'album',items:[item('a'),item('b')]});
 vm.runInNewContext(source,mounted.environment);await mounted.nodes.get('launcher').onclick();
 assert.equal(mounted.nodes.get('album').href,'https://photos.google.com/u/2/album/album');
 const idle=async()=>{for(let count=0;count<100;count++){await new Promise(resolve=>setTimeout(resolve,1));if(mounted.nodes.get('keep').disabled===false)return;}throw Error('Fake UI stayed busy');};
 mounted.nodes.get('keep').onclick();await idle();mounted.nodes.get('keep').onclick();await idle();
 const state=await db.read(account);await db.save(account,{...state,items:state.items.map(row=>row.mediaKey==='b'?{...row,state:'in_trash',revision:row.revision+1}:row)});
 fault.failSave=true;mounted.nodes.get('undo').onclick();await idle();
 assert.equal(mounted.nodes.get('status').textContent,'Fake storage failure');assert.equal((await db.read(account)).items[0].decision,'keep');
 fault.failSave=false;mounted.nodes.get('undo').onclick();await idle();
 const undone=await db.read(account);assert.equal(undone.items[0].decision,null);assert.equal(undone.items[1].decision,'keep');assert.equal(mounted.nodes.get('status').textContent,'Decision undone.');
});
async function mountedReview(items,fetch) {
 const source=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8'),mounted=bundleEnvironment();
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs');
 if(fetch)mounted.environment.window.fetch=fetch;
 const db=await openReviewDatabase(mounted.environment.window.indexedDB),account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 await db.save(account,{...emptyReview(),items});
 vm.runInNewContext(source,mounted.environment);await mounted.nodes.get('launcher').onclick();
 const click=async id=>{mounted.nodes.get(id).onclick();for(let count=0;count<100;count++){await new Promise(resolve=>setTimeout(resolve,1));if(mounted.nodes.get('keep').disabled===false)return;}throw Error('Fake UI stayed busy');};
 return {...mounted,click,read:()=>db.read(account)};
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
 await mounted.click('undo');
 const state=await mounted.read();
 assert.equal(state.items[0].decision,null);assert.equal(state.items[0].revision,4);
 assert.equal(mounted.nodes.get('queue').childNodes.length,0);
 assert.equal(mounted.nodes.get('status').textContent,'Decision undone.');
});
test('mounted oldest-first puts missing dates at the epoch before dated media',async()=>{
 const mounted=await mountedReview([item('dated',{date:'1990-01-01T00:00:00.000Z'}),item('missing')]);
 mounted.nodes.get('sort').value='oldest';mounted.nodes.get('sort').onchange();
 assert.match(mounted.nodes.get('caption').textContent,/^missing · Unknown date$/);
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
 const first=await mountedReview([item('a')]);await first.click('keep');
 const second=bundleEnvironment();second.environment.window.indexedDB=first.environment.window.indexedDB;
 const source=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8');
 vm.runInNewContext(source,second.environment);await second.nodes.get('launcher').onclick();second.nodes.get('undo').onclick();
 for(let count=0;count<100&&second.nodes.get('keep').disabled;count++)await new Promise(resolve=>setTimeout(resolve,1));
 assert.equal((await first.read()).items[0].decision,null);assert.equal((await first.read()).history.length,0);
});
test('mounted Trash is opt-in, confirms the exact count and verifies synthetic Trash',async()=>{
 const mounted=await mountedReview([item('a',{decision:'remove',dedupKey:'stable'})]);const requests=[],prompts=[];
 mounted.environment.window.fetch=async(url,options)=>{const entry=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0];requests.push(entry[0]);return {ok:true,text:async()=>envelope(entry[0],entry[0]==='XwAOJf'?[]:[[['a',null,null,'stable']],null])};};
 assert.equal(mounted.nodes.get('move-trash').hidden,true);await mounted.click('move-trash');assert.equal(requests.length,0);
 mounted.nodes.get('trash-opt-in').checked=true;mounted.nodes.get('trash-opt-in').onchange();
 mounted.environment.window.confirm=prompt=>{prompts.push(prompt);return false;};await mounted.click('move-trash');assert.equal(requests.length,0);assert.match(prompts[0],/exactly 1 items/);
 mounted.environment.window.confirm=()=>true;
 const source=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8');
 const second=bundleEnvironment();second.environment.window.indexedDB=mounted.environment.window.indexedDB;second.environment.window.fetch=mounted.environment.window.fetch;second.environment.window.confirm=()=>true;
 vm.runInNewContext(source,second.environment);await second.nodes.get('launcher').onclick();second.nodes.get('trash-opt-in').checked=true;second.nodes.get('trash-opt-in').onchange();second.nodes.get('move-trash').onclick();
 for(let count=0;count<100&&second.nodes.get('keep').disabled;count++)await new Promise(resolve=>setTimeout(resolve,1));
 assert.deepEqual(requests,['XwAOJf','zy0IHe']);assert.equal((await mounted.read()).items[0].state,'in_trash');
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
 const second=bundleEnvironment();second.environment.window.indexedDB=mounted.environment.window.indexedDB;
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
test('shadow overlay puts the card above stats and touch swipes persist decisions',async()=>{
 const mounted=await mountedReview([item('a')]);assert.equal(mounted.shadowMode,'open');
 const content=mounted.nodes.get('overlay').childNodes[0];assert.ok(content.childNodes.indexOf(mounted.nodes.get('card'))<content.childNodes.indexOf(mounted.nodes.get('stats')));
 const media=mounted.nodes.get('media');media.listeners.pointerdown({isPrimary:true,button:0,target:{tagName:'IMG'},pointerId:1,clientX:20,clientY:20});media.listeners.pointerup({pointerId:1,clientX:120,clientY:25});
 for(let count=0;count<100&&mounted.nodes.get('keep').disabled;count++)await new Promise(resolve=>setTimeout(resolve,1));
 assert.equal((await mounted.read()).items[0].decision,'keep');assert.equal((await mounted.read()).history.length,1);
});

test('obsolete userscript artifact is absent',async()=>{await assert.rejects(access(new URL('../userscript/photos-swipe.user.js',import.meta.url)),{code:'ENOENT'});});
