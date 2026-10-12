import {LEASE_HEARTBEAT_MS,LEASE_EXPIRY_MS} from '../lib/userscript-db.mjs';
import {injectRelease,verifyRelease,releaseMessage} from '../lib/userscript-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access,mkdtemp,writeFile,rm,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {webcrypto,generateKeyPairSync,sign} from 'node:crypto';
import vm from 'node:vm';
import {buildPhotosRequest,parsePhotosResponse,createPhotosAPI} from '../lib/userscript-api.mjs';
import {emptyReview,reviewDeck,reviewQueue,reviewStorage,mergeReviewPage,canUndoReview,decideReview,finishReviewAlbum,sendReviewAlbum,readReviewTrash,reconcileReviewTrash,loadReviewPages} from '../lib/userscript-core.mjs';
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
test('first launcher activation after reload stays isolated from page input handlers',async()=>{
 const source=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8');
 for(const input of [['pointerdown','mousedown','pointerup','mouseup','click'],['touchstart','touchend','mousedown','mouseup','click']]){
  const mounted=bundleEnvironment();
  vm.runInNewContext(source,mounted.environment);
  const launcher=mounted.nodes.get('launcher'),overlay=mounted.nodes.get('overlay');
  assert.equal(overlay.hidden,true);
  let pageEvents=0,opening;
  for(const type of input){
   let stopped=false;
   const event={type,target:launcher,stopPropagation(){stopped=true;}};
   launcher.listeners[type]?.(event);
   if(type==='click')opening=launcher.onclick(event);
   if(!stopped)pageEvents++;
  }
  await opening;
  assert.equal(pageEvents,0,`${input[0]} must not reach Google Photos page handlers`);
  assert.equal(overlay.hidden,false);
  assert.equal(launcher.hidden,true);
  await mounted.nodes.get('close').onclick();
 }
});
test('page keyboard shortcuts remain available when close restores launcher focus',async()=>{
 const source=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8');
 const mounted=bundleEnvironment();
 vm.runInNewContext(source,mounted.environment);
 const launcher=mounted.nodes.get('launcher'),overlay=mounted.nodes.get('overlay');
 await launcher.onclick();
 for(const type of ['keydown','keyup','keypress']){
  let stopped=false;
  overlay.listeners[type]({stopPropagation(){stopped=true;}});
  assert.equal(stopped,true);
 }
 await mounted.nodes.get('close').onclick();
 assert.equal(overlay.hidden,true);
 assert.equal(mounted.root.activeElement,launcher);
 for(const type of ['keydown','keyup','keypress']){
  let stopped=false;
  launcher.listeners[type]?.({type,key:'ArrowRight',target:launcher,stopPropagation(){stopped=true;},preventDefault(){assert.fail('Page shortcuts must retain browser defaults');}});
  assert.equal(stopped,false,`${type} must reach page keyboard handlers after closing`);
 }
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
  mounted.nodes.get('settings').onclick();
  const sheet=mounted.nodes.get('settings-sheet'),footer=mounted.nodes.get('settings-version');
  assert.equal(sheet.hidden,false);
  assert.equal(footer.hidden,false);
  assert.ok(sheet.childNodes.includes(footer));
  assert.equal(footer.textContent,'Photos Swipe v'+metadataVersion);
  assert.equal(footer.class,'version-label');
  const headingIn=node=>node.tagName==='H1'?node:node.childNodes?.map(headingIn).find(Boolean);
  const title=headingIn(mounted.nodes.get('overlay'));
  assert.equal(title.tagName,'H1');
  assert.notEqual(title['aria-hidden'],'true');
  const styles=mounted.root.childNodes.filter(node=>node.tagName==='STYLE').map(node=>node.textContent).join('\n');
  assert.match(styles,/\.version-label\{font:var\(--ps-t-caption\);color:var\(--ps-label2\)\}/);
  assert.match(styles,/\.content h1\{flex-basis:100%;order:-1;font:var\(--ps-t-title\)\}/);
  assert.match(styles,/@media\(max-width:599px\)\{[^@]*\.content h1\{position:absolute;width:1px;height:1px;overflow:hidden\}/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('userscript installed without UTF-8 decoding preserves Unicode UI labels',async()=>{
 const bytes=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url));
 assert.ok(bytes.every(byte=>byte<128),'Installable userscript must contain only ASCII bytes');
 const mounted=bundleEnvironment();
 vm.runInNewContext(bytes.toString('latin1'),mounted.environment);
 await mounted.nodes.get('launcher').onclick();
 assert.equal(mounted.nodes.get('remove')['aria-label'],'Mark for deletion');assert.equal(mounted.nodes.get('remove').childNodes[0].tagName,'SVG');
 assert.equal(mounted.nodes.get('keep')['aria-label'],'Keep');
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
    get(key){const request={};queueMicrotask(()=>{request.result=structuredClone(staged.get(key));request.onsuccess();queueMicrotask(async()=>{if(name==='settings'&&String(key).startsWith('resume:')&&fault.resumeGate){fault.resumeStarted?.();await fault.resumeGate;}if(name==='accounts'&&fault.holdSave&&[...staged.values()].some(value=>value.items?.some(row=>row.decision)))await fault.holdSave;if(wrote&&name==='accounts'&&fault.saveGate)await fault.saveGate;if(wrote&&name==='leases'&&fault.leaseGate)await fault.leaseGate;if(releaseGate)await releaseGate;if(!aborted){stores.set(name,staged);tx.oncomplete();}});});return request;},
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
test('conditional lease renewal preserves live foreign owners and acquires expired leases',async()=>{
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs'),db=await openReviewDatabase(fakeIndexedDB());
 const foreign=await db.lease('account','other-tab');
 assert.deepEqual(await db.lease('account','background-tab',false,false),foreign);
 assert.deepEqual(await db.readLease('account'),foreign);
 const renewed=await db.lease('account','other-tab',false,false);
 assert.equal(renewed.owner,'other-tab');assert.ok(renewed.expires>Date.now());
 await db.lease('account','other-tab',true);
 const acquired=await db.lease('account','background-tab',false,false);
 assert.equal(acquired.owner,'background-tab');assert.ok(acquired.expires>Date.now());
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
 const element=tag=>({contains(node){return this===node||this.childNodes.some(child=>child.contains?.(node));},tagName:tag.toUpperCase(),style:{},dataset:{},childNodes:[],hidden:false,value:'',classList:{values:new Set(),remove(name){this.values.delete(name);},toggle(name,force){if(force===false||(force===undefined&&this.values.has(name)))this.values.delete(name);else this.values.add(name);},contains(name){return this.values.has(name);}},append(...children){for(const child of children){if(child.parentNode)child.parentNode.childNodes=child.parentNode.childNodes.filter(node=>node!==child);child.parentNode=this;child.parentElement=this;this.childNodes.push(child);}},insertBefore(child,before){this.childNodes.splice(this.childNodes.indexOf(before),0,child);},replaceChildren(...children){for(const child of this.childNodes)child.parentNode=null;this.childNodes=[];this.append(...children);},querySelector(selector){const match=node=>selector.startsWith('.')?(node.class||'').split(' ').includes(selector.slice(1)):node.tagName===selector.toUpperCase();const visit=node=>node.childNodes?.map(child=>match(child)?child:visit(child)).find(Boolean);return visit(this)||null;},querySelectorAll(selector){const result=[];const visit=node=>{for(const child of node.childNodes||[]){if(selector.startsWith('.')&&(child.class||'').split(' ').includes(selector.slice(1)))result.push(child);visit(child);}};visit(this);return result;},getAttribute(key){return this[key]??null;},remove(){if(this.parentNode)this.parentNode.childNodes=this.parentNode.childNodes.filter(child=>child!==this);},setAttribute(key,value){this[key]=value;if(key==='id'){nodes.set(value,this);if(['queue-details','history-details'].includes(value))this.open=true;}if(key==='value')this.value=value;},listeners:{},addEventListener(name,handler){this.listeners[name]=handler;},setPointerCapture(){},focus(){root.activeElement=this;},getBoundingClientRect(){return {width:this.id==='media'?820:300,height:440};},decode(){return Promise.resolve();},paused:true,play(){this.paused=false;this.playCalls=(this.playCalls||0)+1;return Promise.resolve();},pause(){this.paused=true;this.pauseCalls=(this.pauseCalls||0)+1;},removeAttribute(key){delete this[key];},load(){}});

 const root={childNodes:[],append(...children){this.childNodes.push(...children);},getElementById(id){const visit=node=>{for(const child of node.childNodes||[]){if(child.id===id)return child;const found=visit(child);if(found)return found;}return null;};return visit(this);},querySelectorAll:()=>[...nodes.values()].filter(node=>['BUTTON','SELECT'].includes(node.tagName))};
 Object.defineProperty(root,'innerHTML',{set(){throw new TypeError('TrustedHTML required');}});
 const result={nodes,hosts,root};
 const document={listeners:{},addEventListener(name,handler){this.listeners[name]=handler;},createTextNode:textContent=>({textContent}),getElementById:id=>hosts.find(host=>host.id===id),createElement:tag=>{const node=element(tag);if(tag==='select')node.value='';const append=node.append;node.append=function(...children){append.call(this,...children);if(tag==='select'&&!this.value)this.value=children[0].value;};node.attachShadow=options=>{result.shadowMode=options.mode;return root;};return node;},querySelector:()=>null,createElementNS:(namespace,tag)=>element(tag),head:element('head'),body:element('body'),documentElement:{style:{cssText:''},dataset:{},append:host=>hosts.push(host)}};
 const events=new EventTarget();
 const window={scrollX:0,scrollY:0,scrollTo(){},requestAnimationFrame:callback=>{callback();return null;},cancelAnimationFrame(){},dispatchEvent:event=>events.dispatchEvent(event),WIZ_global_data:{...tokens},crypto:webcrypto,indexedDB:fakeIndexedDB(fault),fetch:async()=>{throw Error('Unexpected fake network request');},setTimeout,clearTimeout,AbortController,listeners:{},addEventListener(name,handler){this.listeners[name]=handler;events.addEventListener(name,handler);}};window.top=window;
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
 assert.equal(mounted.root.getElementById('album'),mounted.nodes.get('album'));
 assert.equal(mounted.root.getElementById('album').href,'https://photos.google.com/u/2/album/album');
 assert.equal(mounted.nodes.get('keep').disabled,false);
 assert.equal(mounted.nodes.get('remove').disabled,false);
 mounted.nodes.get('keep').onclick();await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal((await db.read(account)).items[0].decision,'keep');
 fault.failSave=true;mounted.nodes.get('undo').onclick();
 assert.match(mounted.nodes.get('caption').textContent,/^a · /);
 assert.equal(mounted.nodes.get('keep').disabled,false);
 await waitForReview(()=>/Local save failed.*pending changes/.test(mounted.nodes.get('status').textContent));
 assert.match(mounted.nodes.get('status').textContent,/Local save failed.*pending changes/);
 assert.equal((await db.read(account)).items[0].decision,'keep');
 fault.failSave=false;mounted.nodes.get('keep').onclick();await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal((await db.read(account)).items[0].decision,'keep');
});
function dismissReviewPairing(mounted){
 const receiver=mounted.root.childNodes.find(node=>node.className==='pairing-receiver settings-sheet'&&!node.hidden);
 if(receiver){receiver.childNodes.find(node=>node.className==='toolbar').childNodes.find(node=>node.textContent==='Cancel').onclick();mounted.nodes.get('close').focus();}
}
async function mountedReview(items,windowOverrides={},syncSettings,environmentOverrides={}) {
 const source=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8'),mounted=bundleEnvironment(syncSettings?.url?{}:syncSettings);
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs');
 if(typeof windowOverrides==='function')windowOverrides={fetch:windowOverrides};
 if(windowOverrides?.indexedDB)mounted.environment.window.indexedDB=windowOverrides.indexedDB;
 const db=await openReviewDatabase(mounted.environment.window.indexedDB),account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 await db.save(account,{...emptyReview(),items});
 await db.saveSettings(syncSettings?.url?syncSettings:{onboardingDismissed:true,...(syncSettings?.onboardingDismissed===false?{onboardingDismissed:false}:{})});
 Object.assign(mounted.environment.window,windowOverrides);Object.assign(mounted.environment,environmentOverrides);
 vm.runInNewContext(source,mounted.environment);await mounted.nodes.get('launcher').onclick();
 if(syncSettings?.onboardingDismissed!==false)dismissReviewPairing(mounted);
 const settle=async()=>{await new Promise(resolve=>setTimeout(resolve,10));for(let count=0;count<100;count++){await new Promise(resolve=>setTimeout(resolve,1));if(mounted.nodes.get('overlay')['aria-busy']==='false')return;}throw Error('Fake UI stayed busy');};
 const click=async id=>{if(id==='move-trash'&&mounted.nodes.get('review-panel').hidden)mounted.nodes.get('review').onclick();mounted.nodes.get(id).onclick();await new Promise(resolve=>setTimeout(resolve,10));await settle();};
 return {...mounted,click,settle,read:()=>db.read(account)};
}
test('preview repeated Trash preserves swipe Undo and repeated Keep preserves state',async()=>{
 const mounted=await mountedReview([item('a')]);await mounted.click('remove');await mounted.click('review');
 mounted.nodes.get('trash-review-grid').childNodes[0].childNodes[0].onclick();
 const before=await mounted.read();mounted.nodes.get('trash-preview').childNodes.at(-1).childNodes[1].onclick();await mounted.settle();
 assert.deepEqual(await mounted.read(),before);assert.equal(canUndoReview(before,before.history.at(-1)),true);assert.equal(mounted.nodes.get('undo').disabled,false);
 mounted.nodes.get('review-panel').childNodes[0].childNodes[0].onclick();await mounted.click('undo');assert.equal((await mounted.read()).items[0].decision,null);
 await mounted.click('remove');await mounted.click('review');mounted.nodes.get('trash-review-grid').childNodes[0].childNodes[0].onclick();
 mounted.nodes.get('trash-preview').childNodes.at(-1).childNodes[0].onclick();await mounted.settle();const kept=await mounted.read();
 mounted.nodes.get('trash-preview').childNodes.at(-1).childNodes[0].onclick();await mounted.settle();assert.deepEqual(await mounted.read(),kept);
});
test('preview repeated Trash preserves legacy marking on the next open',async()=>{
 const mounted=await mountedReview([item('legacy',{decision:'remove',queueSent:true,revision:3})]);await mounted.click('review');
 mounted.nodes.get('trash-review-grid').childNodes[0].childNodes[0].onclick();const before=await mounted.read();
 mounted.nodes.get('trash-preview').childNodes.at(-1).childNodes[1].onclick();await mounted.settle();assert.deepEqual(await mounted.read(),before);
 mounted.nodes.get('review-panel').childNodes[0].childNodes[0].onclick();await mounted.click('review');
 assert.equal(mounted.nodes.get('trash-review-grid').childNodes[0].childNodes.at(-1).textContent,'Previously marked');
});
test('review Keep records Undo and retains the faded tile',async()=>{
 const mounted=await mountedReview([item('a')]);await mounted.click('remove');await mounted.click('review');
 const grid=mounted.nodes.get('trash-review-grid');grid.childNodes[0].childNodes[1].onclick();await mounted.settle();
 assert.equal((await mounted.read()).items[0].decision,'keep');assert.equal(grid.childNodes.length,1);assert.equal(grid.childNodes[0].class,'trash-tile kept');
 assert.equal(mounted.nodes.get('undo').disabled,false);assert.equal(mounted.nodes.get('move-trash').disabled,true);
 mounted.nodes.get('review-panel').childNodes[0].childNodes[0].onclick();await mounted.click('undo');assert.equal((await mounted.read()).items[0].decision,'remove');
 await mounted.click('undo');assert.equal((await mounted.read()).items[0].decision,null);
});
test('Undo after a synced Keep keeps its confirmation through the next sync',async()=>{
 let scheduledSync,syncGate;
 const uploads=[];
 const mounted=await mountedReview([item('synthetic-undo')],{
  setTimeout(callback,delay){if(delay===2000){scheduledSync=callback;return {unref(){}};}return setTimeout(callback,delay);},
  clearTimeout(timer){if(timer?.unref)return;clearTimeout(timer);},
  fetch:async(url,options)=>{
   assert.equal(new URL(url).origin,'https://sync.example');
   if(options.body)uploads.push(JSON.parse(options.body));
   if(syncGate)await syncGate;
   return {ok:true,json:async()=>new URL(url).pathname==='/api/progress'&&options.method==='PUT'?{items:JSON.parse(options.body).items}:{decisions:[],history:[],progress:{}}};
  }
 },{url:'https://sync.example',token:'synthetic-token'},{AbortSignal});
 const status=mounted.nodes.get('status'),syncStatus=mounted.nodes.get('sync-status');
 assert.match(syncStatus.textContent,/^Synced/);
 await mounted.click('keep');
 scheduledSync();
 await waitForReview(()=>syncStatus.textContent==='Synced · 1 reviewed IDs');
 await mounted.click('undo');
 assert.match(status.textContent,/Last swipe undone/);
 let releaseSync;
 syncGate=new Promise(resolve=>{releaseSync=resolve;});
 scheduledSync();
 await waitForReview(()=>syncStatus.textContent==='Syncing…');
 assert.match(status.textContent,/Last swipe undone/);
 releaseSync();
 await waitForReview(()=>syncStatus.textContent==='Synced · 0 reviewed IDs');
 assert.match(status.textContent,/Last swipe undone/);
 await waitForReview(async()=>{const state=await mounted.read();return state.items[0].decision===null&&state.history.length===0;});
 assert.equal((await mounted.read()).items[0].decision,null);
 assert.ok(uploads.some(value=>value.decisions?.some(row=>row.id==='synthetic-undo'&&row.decision===null)));
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
 await waitForReview(async()=>{const state=await first.read();return state.items[0].decision==='keep'&&state.history.length===1;});
 await first.nodes.get('close').onclick();const second=bundleEnvironment();second.environment.window.indexedDB=first.environment.window.indexedDB;
 const source=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8');
 vm.runInNewContext(source,second.environment);await second.nodes.get('launcher').onclick();
 second.nodes.get('sort').value='largest';second.nodes.get('sort').onchange();
 assert.match(second.nodes.get('caption').textContent,/^b · /);
 second.nodes.get('undo').onclick();
 await waitForReview(async()=>{const state=await first.read();return state.items[0].decision===null&&state.history.length===0;});
 assert.equal((await first.read()).items[0].decision,null);assert.equal((await first.read()).history.length,0);
 assert.equal(second.nodes.get('status').textContent,'Last swipe undone for a.');
 assert.match(second.nodes.get('caption').textContent,/^a · /);
 assert.equal(second.nodes.get('media').childNodes[0].alt,'a');
 second.nodes.get('keep').onclick();
 await waitForReview(async()=>{const state=await first.read();return state.items[0].decision==='keep'&&state.items[1].decision===null&&state.history.length===1;});
 assert.deepEqual((await first.read()).items.map(row=>row.decision),['keep',null]);
 assert.match(second.nodes.get('caption').textContent,/^b · /);
});
test('mounted Trash requires confirmation, confirms the exact count and verifies synthetic Trash',async()=>{
 const mounted=await mountedReview([item('a',{decision:'remove',dedupKey:'stable'})]);const requests=[],prompts=[];
 mounted.environment.window.fetch=async(url,options)=>{const entry=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0];requests.push(entry[0]);return {ok:true,text:async()=>envelope(entry[0],entry[0]==='XwAOJf'?[]:[[['a',null,null,'stable']],null])};};
 assert.equal(mounted.nodes.get('move-trash').hidden,false);assert.equal(requests.length,0);
 mounted.nodes.get('trash-opt-in').checked=true;mounted.nodes.get('trash-opt-in').onchange();
 mounted.environment.window.confirm=prompt=>{prompts.push(prompt);return false;};if(mounted.nodes.get('review-panel').hidden)await mounted.click('review');await mounted.click('move-trash');assert.equal(requests.length,0);assert.match(prompts[0],/exactly 1 items/);
 mounted.environment.window.confirm=()=>true;
 const source=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8');
 await mounted.nodes.get('close').onclick();const second=bundleEnvironment();second.environment.window.indexedDB=mounted.environment.window.indexedDB;second.environment.window.fetch=mounted.environment.window.fetch;second.environment.window.confirm=()=>true;
 vm.runInNewContext(source,second.environment);await second.nodes.get('launcher').onclick();second.nodes.get('trash-opt-in').checked=true;second.nodes.get('trash-opt-in').onchange();second.nodes.get('review').onclick();second.nodes.get('move-trash').onclick();
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
 const ready='';
 assert.match(mounted.nodes.get('stats').textContent,/In Trash: 55 KB \(running total\)/);
 mounted.nodes.get('trash-opt-in').checked=true;mounted.nodes.get('trash-opt-in').onchange();
 if(mounted.nodes.get('review-panel').hidden)await mounted.click('review');await mounted.click('move-trash');
 assert.equal(mounted.nodes.get('status').textContent,'Verified 5 items in Trash.');
 assert.match(mounted.nodes.get('stats').textContent,/In Trash: 112 KB \(running total\)/);
 await mounted.environment.window.listeners.pageshow({persisted:true});
 assert.equal(mounted.nodes.get('status').textContent,ready);
 assert.match(mounted.nodes.get('stats').textContent,/In Trash: 112 KB \(running total\)/);
 await mounted.nodes.get('close').onclick();const reloaded=bundleEnvironment();reloaded.environment.window.indexedDB=mounted.environment.window.indexedDB;
 vm.runInNewContext(await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8'),reloaded.environment);
 await reloaded.nodes.get('launcher').onclick();
 assert.equal(reloaded.nodes.get('status').textContent,ready);
 assert.match(reloaded.nodes.get('stats').textContent,/In Trash: 112 KB \(running total\)/);
 reloaded.nodes.get('review').onclick();assert.equal(reloaded.nodes.get('move-trash').textContent,'Move 0 to Trash');
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
test('legacy candidates share one Going to Trash grid and persist Keep across reload',async()=>{
 const sent=Array.from({length:5},(_,index)=>item(`QA-DUMMY-${index}`,{decision:'remove',queueSent:true,dedupKey:`stable-${index}`}));
 const mounted=await mountedReview([...sent,item('kept',{decision:'keep'}),item('trashed',{decision:'remove',state:'in_trash'}),item('undecided')]);await mounted.click('review');
 const grid=mounted.nodes.get('trash-review-grid');assert.equal(grid.childNodes.length,5);assert.equal(mounted.nodes.get('move-trash').textContent,'Move 5 to Trash');
 assert.ok(grid.childNodes.every(tile=>tile.childNodes.at(-1).textContent==='Previously marked'));
 let prompt;mounted.environment.window.confirm=value=>{prompt=value;return false;};if(mounted.nodes.get('review-panel').hidden)await mounted.click('review');await mounted.click('move-trash');assert.match(prompt,/exactly 5 items/);assert.doesNotMatch(prompt,/ID:/);
 grid.childNodes[0].childNodes[0].onclick();const preview=mounted.nodes.get('trash-preview');assert.equal(preview.childNodes[0].childNodes[1].textContent,'1 of 5');preview.childNodes.at(-1).childNodes[0].onclick();await mounted.settle();
 assert.equal((await mounted.read()).items[0].decision,'keep');assert.equal(grid.childNodes.length,5);assert.equal(mounted.nodes.get('move-trash').textContent,'Move 4 to Trash');
 await mounted.nodes.get('close').onclick();const second=bundleEnvironment();second.environment.window.indexedDB=mounted.environment.window.indexedDB;
 vm.runInNewContext(await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8'),second.environment);await second.nodes.get('launcher').onclick();second.nodes.get('review').onclick();assert.equal(second.nodes.get('trash-review-grid').childNodes.length,4);
});
test('Trash grid merges queued and legacy items regardless of filters',async()=>{
 const mounted=await mountedReview([item('queued',{decision:'remove',type:'video',duration:14000}),item('sent',{decision:'remove',queueSent:true}),item('kept',{decision:'keep'}),item('trashed',{decision:'remove',state:'in_trash'})]);
 mounted.nodes.get('filter').value='photo';mounted.nodes.get('filter').onchange();await mounted.click('review');const grid=mounted.nodes.get('trash-review-grid');
 assert.equal(grid.childNodes.length,2);assert.equal(grid.childNodes[0].childNodes[2].textContent,'▶ 0:14');assert.equal(grid.childNodes[1].childNodes[2].textContent,'Previously marked');
 assert.equal(mounted.nodes.get('move-trash').textContent,'Move 2 to Trash');grid.childNodes[0].childNodes[1].onclick();await mounted.settle();assert.match(mounted.nodes.get('trash-review-subtitle').textContent,/1 of 2 selected/);
 mounted.nodes.get('review-panel').childNodes[0].childNodes[1].onclick();await mounted.settle();assert.equal(mounted.nodes.get('move-trash').textContent,'Move 2 to Trash');
});
for(const mediaType of ['IMG','VIDEO'])test(`shadow overlay puts the card above stats and ${mediaType} touch swipes persist decisions`,async()=>{
 const mounted=await mountedReview([item('a')]);assert.equal(mounted.shadowMode,'open');
 const content=mounted.nodes.get('overlay').childNodes[0];assert.ok(content.childNodes.includes(mounted.nodes.get('card')));assert.equal(mounted.nodes.get('stats').hidden,true);
 mounted.nodes.get('card').offsetWidth=280;
 const media=mounted.nodes.get('media');media.listeners.pointerdown({isPrimary:true,button:0,target:{tagName:mediaType,getBoundingClientRect:()=>({bottom:300})},pointerId:1,clientX:20,clientY:20});media.listeners.pointermove({pointerId:1,clientX:120,clientY:25,preventDefault(){}});media.listeners.pointerup({pointerId:1,clientX:140,clientY:25});
 await waitForReview(async()=>(await mounted.read()).items[0].decision==='keep');

 assert.equal((await mounted.read()).items[0].decision,'keep');assert.equal((await mounted.read()).history.length,1);
});

function swipeEvent(overrides={}) {
 return {isPrimary:true,button:0,target:{tagName:'VIDEO'},pointerId:1,clientX:20,clientY:20,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},stopImmediatePropagation(){this.stopped=true;},...overrides};
}
test('expanded photos swipe at initial fit and after zoom reset, while zoomed photos block swipes',async()=>{
 for(const [clientX,decision,resetZoom] of [[150,'keep',false],[-150,'remove',false],[150,'keep',true],[-150,'remove',true]]){
  const mounted=await mountedReview([item('a'),item('b')]);
  const {nodes}=mounted,card=nodes.get('card'),media=nodes.get('media'),zoom=nodes.get('zoom');
  nodes.get('enlarge').onclick();
  assert.equal(card.classList.contains('expanded'),true);
  assert.equal(zoom.value,'1');
  const drag=()=>{
   const target=media.querySelector('img');
   media.listeners.pointerdown(swipeEvent({target,pointerType:'touch'}));
   media.listeners.pointermove(swipeEvent({target,pointerType:'touch',clientX}));
   media.listeners.pointerup(swipeEvent({target,pointerType:'touch',clientX}));
  };
  if(resetZoom){
   zoom.value='2';zoom.oninput();drag();
   assert.equal((await mounted.read()).history.length,0);
   zoom.value='1';zoom.oninput();
  }
  drag();
  await waitForReview(async()=>(await mounted.read()).items[0].decision===decision);
  assert.equal((await mounted.read()).history.length,1);
  assert.equal(card.classList.contains('expanded'),true);
 }
});

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
 assert.match(source,/\.card\{touch-action:none;user-select:none;-webkit-user-select:none;-webkit-user-drag:none;-webkit-touch-callout:none/);
 assert.match(source,/\.media\{touch-action:none;[^}]*overflow:auto/);
 assert.match(source,/\.card\.expanded \.media\{height:72vh;/);
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
 assert.equal(mounted.nodes.get('status').textContent,'Every candidate was verified in the review album. Choose Trash in Settings to use this panel, or open the review album to move items manually in Google Photos.');
 await mounted.click('review');assert.equal(mounted.nodes.get('trash-review-grid').childNodes.length,1);assert.equal(mounted.nodes.get('move-trash').hidden,false);
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
test('phone decision row has three icons and fullscreen belongs to the photo',async()=>{
 const mounted=await mountedReview([item('a')]),content=mounted.nodes.get('overlay').childNodes[0],actions=content.childNodes.find(node=>node.class==='actions');
 assert.deepEqual(actions.childNodes.filter(node=>node.tagName==='BUTTON').map(node=>node.id),['remove','undo','keep']);assert.equal(mounted.nodes.get('enlarge').parentNode.class,'top-card');assert.equal(mounted.nodes.get('undo').disabled,true);
 assert.ok(mounted.nodes.get('settings-sheet').contains(mounted.nodes.get('filter')));assert.ok(mounted.nodes.get('settings-sheet').contains(mounted.nodes.get('sort')));
 assert.equal(mounted.nodes.get('review-every').hidden,true);assert.equal(mounted.nodes.get('delete-method').hidden,true);
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
 assert.equal(mounted.nodes.get('status').textContent,'Every candidate was verified in the review album. Choose Trash in Settings to use this panel, or open the review album to move items manually in Google Photos.');
 assert.deepEqual(titles,['Photos Swipe · Review']);
 assert.equal((await mounted.read()).albumKey,'album');
 assert.equal((await mounted.read()).job,null);
 assert.equal(reviewQueue(await mounted.read()).length,0);
 assert.ok(requests.includes('E1Cajb'));
});

test('centered shell and loading video cards fit desktop and phone viewports in Chrome',async t=>{
 const browser=['google-chrome','chromium','chromium-browser'].find(command=>spawnSync(command,['--version'],{encoding:'utf8'}).status===0);
 if(!browser){t.skip('Chrome is unavailable');return;}
 const mounted=await mountedReview([item('clip',{type:'video',name:'synthetic-very-long-filename-'.repeat(8)+'.mp4'}),item('next')],async()=>({ok:true,text:async()=>envelope('VrseUb',[['clip'],'https://lh3.googleusercontent.com/synthetic-video'])}));
 mounted.nodes.get('overlay').hidden=false;mounted.nodes.get('move-trash').hidden=false;
 assert.equal(mounted.nodes.get('media')['aria-busy'],'true');
 assert.equal(mounted.nodes.get('media').querySelector('video').hidden,true);
 assert.equal(mounted.nodes.get('next-card').hidden,false);
 const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
 const parents=new Map();
 const recordParents=node=>{for(const child of node.childNodes||[]){parents.set(child,node);recordParents(child);}};recordParents(mounted.root);
 const serialize=node=>{
  if(!node.tagName)return escape(node.textContent||'');
  const tag=node.tagName.toLowerCase();
  const attributes=['id','class','type','min','max','step','value'].filter(key=>typeof node[key]==='string'&&node[key]).map(key=>` ${key}="${escape(node[key])}"`).join('');
  return `<${tag}${attributes}${node.className&&!node.class?` class="${escape(node.className)}"`: ''}${node.style?.cssText?` style="${escape(node.style.cssText)}"`:''}${node.dataset?.videoControl?` data-video-control="${node.dataset.videoControl}"`:''}${node.hidden?' hidden':''}>${(node.textContent!==undefined?escape(node.textContent):'')+node.childNodes.filter(child=>parents.get(child)===node).map(serialize).join('')}</${tag}>`;
 };
 const markup=mounted.root.childNodes.map(serialize).join('');
 const directory=await mkdtemp(join(tmpdir(),'photos-layout-'));
 try{
  const html=`<!doctype html><body><script>
  const results=[];
  for(const [width,height,expanded] of [[1440,900,false],[400,713,true],[320,633,true],[390,844,false],[320,480,false]]){
   const frame=document.createElement('iframe');frame.style.cssText='position:fixed;inset:0';frame.style.width=width+'px';frame.style.height=height+'px';document.body.append(frame);
   const doc=frame.contentDocument,host=doc.createElement('div');host.style.cssText='position:fixed;inset:0';doc.body.append(host);
   const root=host.attachShadow({mode:'open'});root.innerHTML=${JSON.stringify(markup)};
   const content=root.querySelector('.content'),overlay=root.querySelector('.overlay'),sheet=root.getElementById('settings-sheet');
   const bounds=element=>element.getBoundingClientRect();
   const modal=bounds(content),backdrop=bounds(overlay);
   const media=root.getElementById('media'),top=root.querySelector('.top-card'),caption=root.getElementById('caption'),poster=media.querySelector('img'),under=root.getElementById('next-card');
   media.setAttribute('aria-busy','true');
   poster.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="800"><rect width="200" height="800" fill="red"/></svg>');
   under.querySelector('img').src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="200"><rect width="800" height="200" fill="lime"/></svg>');
   root.getElementById('card').classList.toggle('expanded',expanded);
   const videoChecks=[];
   for(const background of ['rgb(255, 255, 255)','rgb(28, 28, 30)'])for(const loading of [true,false]){
    host.style.setProperty('--ps-surface-solid',background);
    media.setAttribute('aria-busy',String(loading));poster.hidden=!loading;media.querySelector('video').hidden=loading;
    const box=bounds(media),front=bounds(top),image=bounds(poster),behind=bounds(under),filename=bounds(caption);
    const playback=Array.from(media.querySelectorAll('[data-video-control]'));
    const opaque=doc.defaultView.getComputedStyle(top).backgroundColor===background&&doc.defaultView.getComputedStyle(media).backgroundColor===background;
    const covered=doc.defaultView.getComputedStyle(top).opacity==='1'&&doc.defaultView.getComputedStyle(top).visibility==='visible'&&front.left<=behind.left&&front.right>=behind.right&&front.top<=behind.top&&front.bottom>=behind.bottom&&doc.defaultView.getComputedStyle(top).zIndex>doc.defaultView.getComputedStyle(under).zIndex;
    const captionVisible=caption.parentElement===content&&filename.height>=caption.scrollHeight&&filename.top>=bounds(root.getElementById('card')).bottom&&filename.bottom<=bounds(root.getElementById('remove')).top&&filename.left>=modal.left&&filename.right<=modal.right&&doc.defaultView.getComputedStyle(caption).visibility==='visible';
    const clearOfControls=playback.every(button=>bounds(button).bottom<=filename.top&&bounds(button).left>=box.left&&bounds(button).right<=box.right);
    videoChecks.push({loading,background,opaque,covered,captionVisible,clearOfControls,posterFits:!loading||(image.left>=box.left&&image.right<=box.right&&image.top>=box.top&&image.bottom<=box.bottom&&doc.defaultView.getComputedStyle(poster).objectFit==='contain')});
   }
   sheet.hidden=false;
   const controls=['filter','sort'].map(id=>root.getElementById(id));
   const sheetBounds=bounds(sheet);
   const settings=root.getElementById('sync-settings');settings.open=true;
   const range=doc.createRange(),settingsStyle=doc.defaultView.getComputedStyle(settings),settingsContentWidth=settings.clientWidth-parseFloat(settingsStyle.paddingLeft)-parseFloat(settingsStyle.paddingRight);
   const buttons=Array.from(settings.querySelectorAll('button')).filter(button=>button.getClientRects().length);
   const syncFields=['sync-url','sync-token'].map(id=>{
    const input=root.getElementById(id),field=input.parentElement;
    range.selectNodeContents(field.firstChild);const text=range.getBoundingClientRect(),box=bounds(input),fieldBox=bounds(field);
    return {id,above:text.bottom<=box.top,leftAligned:Math.abs(text.left-box.left)<=1,fullWidth:Math.abs(box.width-settingsContentWidth)<=1&&Math.abs(fieldBox.width-settingsContentWidth)<=1,clearOfButtons:buttons.every(button=>text.bottom<=bounds(button).top||text.top>=bounds(button).bottom)};
   });
   const controlsFit=controls.every(control=>bounds(control).left>=sheetBounds.left&&bounds(control).right<=sheetBounds.right+1);
   const issuer=root.querySelector('.pairing-issuer');issuer.hidden=false;
   const pairingTargets=Array.from(issuer.children).slice(1,4);
   pairingTargets[0].innerHTML='<canvas width=270 height=270></canvas>';pairingTargets[1].textContent='123 456';pairingTargets[2].textContent='01:00';
   const pairingAboveSettings=Number(doc.defaultView.getComputedStyle(issuer).zIndex)>Number(doc.defaultView.getComputedStyle(sheet).zIndex);
   const pairingVisible=pairingTargets.every(target=>{const box=bounds(target),hit=root.elementFromPoint(box.left+box.width/2,box.top+box.height/2);return box.width>0&&box.height>0&&(hit===target||target.contains(hit));});
   results.push({width,height,syncFields,videoChecks,pairingAboveSettings,pairingVisible,modalWidth:modal.width,modalFits:modal.left>=0&&modal.right<=width+1&&modal.top>=0&&modal.bottom<=height+1,backdropFits:backdrop.width===width,controlsFit,filterBeforeOrder:bounds(controls[0]).top<bounds(controls[1]).top});
  }
  document.body.replaceChildren(Object.assign(document.createElement('pre'),{textContent:JSON.stringify(results)}));
  </script>`;
  const path=join(directory,'layout.html');await writeFile(path,html);
  const result=spawnSync(browser,['--headless','--no-sandbox','--disable-gpu','--disable-background-networking','--window-size=1600,1200',`--user-data-dir=${join(directory,'profile')}`,'--dump-dom',`file://${path}`],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  if(result.status!==0&&/Operation not permitted|operation not permitted/.test(result.stderr)){t.skip('Sandbox prevents Chrome from opening sockets');return;}
  assert.equal(result.status,0,result.stderr);
  const measurements=JSON.parse(result.stdout.match(/<pre>(.*?)<\/pre>/s)?.[1]||'null');assert.equal(measurements?.length,5,result.stdout);
  for(const measurement of measurements){
   for(const check of measurement.videoChecks)for(const key of ['opaque','covered','captionVisible','clearOfControls','posterFits'])assert.equal(check[key],true,JSON.stringify({width:measurement.width,...check}));
   for(const field of measurement.syncFields)for(const key of ['above','leftAligned','fullWidth','clearOfButtons'])assert.equal(field[key],true,JSON.stringify({width:measurement.width,...field}));
   for(const key of ['modalFits','backdropFits','controlsFit','filterBeforeOrder','pairingAboveSettings','pairingVisible'])assert.equal(measurement[key],true,JSON.stringify(measurement));
   assert.equal(measurement.modalWidth,Math.min(440,measurement.width),JSON.stringify(measurement));
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

test('opening with sync pauses if another tab takes ownership during sync',async()=>{
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
 assert.equal(syncCalls,0);
 finishTrash();await moving;await first.nodes.get('close').onclick();
 const completed=await first.read();
 assert.equal(completed.items[0].state,'in_trash');
 assert.equal(first.nodes.get('status').textContent,'Verified 1 items in Trash.');
 const account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 const opening=second.nodes.get('launcher').onclick();await syncing;
 await db.lease(account,(await db.readLease(account)).owner,true);
 await db.lease(account,'other-tab');
 assert.equal((await db.lease(account,'other-tab')).owner,'other-tab');
 assert.deepEqual(await first.read(),completed);
 finishSync();await opening;
 assert.deepEqual(await first.read(),completed);
 assert.equal(second.nodes.get('status').textContent,'Open in another tab');
 assert.equal((await first.read()).items[0].state,'in_trash');
 assert.equal((await db.lease(account,'other-tab')).owner,'other-tab');await second.nodes.get('close').onclick();await db.lease(account,'other-tab');await db.lease(account,'other-tab',true);
});

test('mounted stats distinguish queue savings from the Trash running total',async()=>{
 const mounted=await mountedReview([item('queued',{decision:'remove',spaceTaken:23000}),item('trashed',{decision:'remove',state:'in_trash',spaceTaken:112000})]);
 const stats=mounted.nodes.get('stats').textContent;
 assert.equal(stats,'0 to review · 2/2 reviewed · Queue: 1 (estimated savings: 23 KB) · In Trash: 112 KB (running total) · Lifetime freed: 112 KB');
 assert.equal(stats.match(/estimated savings/g).length,1);
});
test('mounted Keep names the decided item after advancing and during candidate inspection',async()=>{
 const mounted=await mountedReview([item('first.jpg'),item('next.jpg')]);
 await mounted.click('keep');
 assert.equal(mounted.nodes.get('status').textContent,'Kept first.jpg.');
 assert.match(mounted.nodes.get('caption').textContent,/^next.jpg · /);
 await mounted.click('remove');
 mounted.nodes.get('review').onclick();mounted.nodes.get('trash-review-grid').childNodes[0].childNodes[0].onclick();
 mounted.nodes.get('trash-preview').childNodes.at(-1).childNodes[0].onclick();await mounted.settle();assert.equal((await mounted.read()).items[1].decision,'keep');
});
test('filename stays below the card through status changes, decisions and undo',async()=>{
 const first='holiday <photo> & family.jpg',second='next-photo.jpg';
 const mounted=await mountedReview([item('first',{name:first}),item('second',{name:second})]);
 const caption=mounted.nodes.get('caption'),card=mounted.nodes.get('card');
 const findParent=node=>node.childNodes?.includes(card)?node:(node.childNodes||[]).map(findParent).find(Boolean);
 const content=findParent(mounted.root);
 assert.ok(content?.childNodes.includes(caption));
 assert.equal(content.childNodes.indexOf(caption),content.childNodes.indexOf(card)+1);
 assert.ok(caption.textContent.startsWith(first));
 mounted.nodes.get('status').textContent='';
 assert.ok(caption.textContent.startsWith(first));
 await mounted.click('keep');
 assert.ok(caption.textContent.startsWith(second));
 assert.equal(mounted.nodes.get('status').textContent,`Kept ${first}.`);
 await mounted.click('undo');
 assert.ok(caption.textContent.startsWith(first));
});

test('mounted photo and video captions show file size with explicit unknown metadata',async()=>{
 for(const type of ['photo','video']){
  for(const [size,label] of [[112000,'112 KB'],[2500000,'2.5 MB'],[1200000000,'1.2 GB'],[0,'0 KB'],[undefined,'Unknown size'],[null,'Unknown size']]){
   const name=type==='photo'?'sample.jpg':'sample.mp4';
   const mounted=await mountedReview([item('sample',{name,type,size,spaceTaken:1000})],{fetch:async()=>({ok:true,text:async()=>envelope('VrseUb',[['sample'],'https://lh3.googleusercontent.com/synthetic-video'])})});
   assert.equal(mounted.nodes.get('caption').textContent,`${name} · Unknown date · ${label}`);
   await mounted.click('remove');
   mounted.nodes.get('review').onclick();mounted.nodes.get('trash-review-grid').childNodes[0].childNodes[0].onclick();
   const caption=mounted.nodes.get('trash-preview').childNodes[2];assert.equal(caption.textContent,name);assert.match(caption.childNodes[0].textContent,new RegExp(label.replace('.', '\\.')));
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
 mounted.environment.GM={getValue:async key=>{if(key==='photos-swipe-pairing'&&++reads>1)throw Error('Synthetic pairing read failure');},setValue:async()=>{},deleteValue:async()=>{}};
 vm.runInNewContext(source,mounted.environment);await mounted.nodes.get('launcher').onclick();
 assert.equal(reads,2);
 assert.equal(mounted.nodes.get('account').textContent,tokens.oPEP7c);
 assert.match(mounted.nodes.get('caption').textContent,/^synthetic-photo · /);
 assert.equal(mounted.nodes.get('keep').disabled,false);
 assert.equal(mounted.nodes.get('status').textContent,'');
 assert.ok(mounted.nodes.get('sync-settings').childNodes.some(node=>node.textContent==='Pairing storage unavailable: Synthetic pairing read failure'));
 assert.deepEqual(await db.read(account),saved);
 await mounted.nodes.get('keep').onclick();
 await waitForReview(async()=>(await db.read(account)).items[0].decision==='keep');
 assert.equal(mounted.nodes.get('keep').disabled,false);
 assert.equal((await db.read(account)).items[0].decision,'keep');
 assert.equal(mounted.nodes.get('status').textContent,'Kept synthetic-photo.');
});

test('sync setup lives in the gear sheet and local dismissal survives reopening',async()=>{
 const mounted=await mountedReview([item('a')],{},{onboardingDismissed:false});
 const content=mounted.nodes.get('overlay').childNodes[0],settings=mounted.nodes.get('sync-settings');
 assert.equal(mounted.nodes.get('settings-sheet').hidden,true);
 mounted.nodes.get('settings').onclick();assert.equal(mounted.nodes.get('settings-sheet').hidden,false);
 assert.equal(settings.open,true);
 assert.equal(mounted.nodes.get('pair-onboarding').hidden,false);
 assert.ok(settings.childNodes.some(node=>node.textContent==='Pairing may not persist in this browser'));
 await mounted.click('sync-local');assert.equal(mounted.nodes.get('settings-sheet').hidden,true);assert.equal(mounted.nodes.get('pair-onboarding').hidden,true);
 await mounted.nodes.get('close').onclick();const reopened=bundleEnvironment();reopened.environment.window.indexedDB=mounted.environment.window.indexedDB;
 vm.runInNewContext(await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8'),reopened.environment);
 await reopened.nodes.get('launcher').onclick();assert.equal(reopened.nodes.get('settings-sheet').hidden,true);assert.equal(reopened.nodes.get('pair-onboarding').hidden,true);
 assert.equal(reopened.nodes.get('status').textContent,'');
});

test('sync setup actions preserve the saved album retry status and job',async()=>{
 for(const action of ['sync-local','sync-save']){
  const mounted=await mountedReview([item('a',{decision:'remove'})],{fetch:async(url,options)=>({ok:true,json:async()=>options?.method==='PUT'?{items:JSON.parse(options.body).items||[]}:{decisions:[],history:[],progress:{}}})});
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
  assert.equal(mounted.nodes.get('send').textContent,'Finish previous transfer');
  assert.deepEqual((await mounted.read()).job,job);
  assert.equal(mounted.nodes.get('sync-settings').open,true);
  if(action==='sync-save')assert.match(mounted.nodes.get('sync-status').textContent,/^Synced/);
 }
});

test('sync success stays quiet and errors show a toast and gear dot',async()=>{
 const mounted=await mountedReview([item('a')]);
 const source=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8');
 await mounted.nodes.get('close').onclick();const reopened=bundleEnvironment();reopened.environment.AbortSignal=AbortSignal;
 reopened.environment.window.indexedDB=mounted.environment.window.indexedDB;
 let fail=false,requests=0;
 reopened.environment.window.fetch=async(url,options)=>{
  assert.equal(new URL(url).origin,'https://sync.example');requests++;
  if(fail)throw Error('Synthetic offline');
  return {ok:true,json:async()=>options?.method==='PUT'?{items:JSON.parse(options.body).items||[]}:{decisions:[],history:[],progress:{}}};
 };
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs');
 const db=await openReviewDatabase(reopened.environment.window.indexedDB);
 await db.saveSettings({url:'https://sync.example',token:'synthetic-token'});
 vm.runInNewContext(source,reopened.environment);await reopened.nodes.get('launcher').onclick();
 assert.equal(requests,2);assert.equal(reopened.nodes.get('status').textContent,'');assert.equal(reopened.nodes.get('settings').classList.contains('gear-error'),false);
 assert.match(reopened.nodes.get('sync-status').textContent,/^Synced/);
 assert.equal(reopened.nodes.get('settings-sheet').hidden,true);
 fail=true;await reopened.nodes.get('launcher').onclick();
 assert.match(reopened.nodes.get('status').textContent,/Synthetic offline.*saved locally/);assert.equal(reopened.nodes.get('settings').classList.contains('gear-error'),true);
 reopened.nodes.get('sync-url').value='';reopened.nodes.get('sync-token').value='';
 reopened.nodes.get('sync-save').onclick();
 await new Promise(resolve=>setTimeout(resolve,10));for(let count=0;count<100&&reopened.nodes.get('keep').disabled;count++)await new Promise(resolve=>setTimeout(resolve,1));
 assert.equal(reopened.nodes.get('status').textContent,'');
 assert.equal(reopened.nodes.get('sync-status').textContent,'Sync off · saved locally');
});

test('decision history previews the same next Undo and updates after undo and reload',async()=>{
 const mounted=await mountedReview([item('a'),item('b')]);await mounted.click('remove');await mounted.click('keep');
 assert.match(mounted.nodes.get('undo-preview').textContent,/Next Undo: b · Unreviewed → Keep; restores Unreviewed/);assert.equal(mounted.nodes.get('undo')['aria-describedby'],'undo-preview');
 await mounted.nodes.get('close').onclick();const reopened=bundleEnvironment();reopened.environment.window.indexedDB=mounted.environment.window.indexedDB;vm.runInNewContext(await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8'),reopened.environment);await reopened.nodes.get('launcher').onclick();assert.equal(reopened.nodes.get('undo-preview').textContent,mounted.nodes.get('undo-preview').textContent);
 reopened.nodes.get('undo').onclick();await new Promise(resolve=>setTimeout(resolve,10));assert.match(reopened.nodes.get('undo-preview').textContent,/Unreviewed → Queue; restores Unreviewed/);reopened.nodes.get('undo').onclick();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(reopened.nodes.get('undo-preview').textContent,'No previous decisions can be undone.');
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
   if(new URL(url).pathname==='/api/progress')return {ok:true,json:async()=>({items:JSON.parse(options.body).items})};
   return new Promise(()=>{});
  },
  setTimeout:(task,delay)=>{const timer=setTimeout(task,delay);timer.unref();return timer;}
 },{url:'https://sync.example',token:'synthetic-token'});
 for(let index=0;index<10;index++)mounted.nodes.get('keep').onclick();
 assert.match(mounted.nodes.get('caption').textContent,/^batch-10 · /);
 for(let count=0;count<100&&!requests.some(request=>new URL(request.url).pathname==='/api/decisions');count++)await new Promise(resolve=>setTimeout(resolve,2));
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
 mounted.nodes.get('review').onclick();mounted.nodes.get('trash-review-grid').childNodes[0].childNodes[0].onclick();
 assert.doesNotThrow(()=>mounted.nodes.get('trash-preview').childNodes.at(-1).childNodes[0].onclick());
 assert.match(mounted.nodes.get('status').textContent,/Finish the saved album operation/);
 assert.equal(mounted.nodes.get('trash-preview').childNodes[2].textContent,'queued');
 assert.equal((await mounted.read()).items[0].decision,'remove');
 await mounted.nodes.get('close').onclick();
});
test('fresh foreign leases block library RPCs and recover automatically after expiry',async()=>{
 const timers=new Map();let timerId=0,rpcs=0;
 const mounted=await mountedReview([item('a')],{fetch:async()=>{rpcs++;throw Error('Unexpected RPC');}},undefined,{setInterval:handler=>{timers.set(++timerId,handler);return timerId;},clearInterval:id=>timers.delete(id)});
 const account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 const database=await new Promise(resolve=>{const request=mounted.environment.window.indexedDB.open();request.onsuccess=()=>resolve(request.result);});
 const readLease=()=>new Promise(resolve=>{const tx=database.transaction('leases'),request=tx.objectStore().get(account);request.onsuccess=()=>{};tx.oncomplete=()=>resolve(request.result);});
 const actualNow=Date.now;let now=actualNow();Date.now=()=>now;
 try{
  await new Promise(resolve=>{const tx=database.transaction('leases');const request=tx.objectStore().get(account);request.onsuccess=()=>tx.objectStore().put({owner:'other-tab',expires:now+LEASE_EXPIRY_MS},account);tx.oncomplete=resolve;});
  await mounted.click('load');
  assert.match(mounted.nodes.get('status').textContent,/busy in another tab/);
  assert.equal(rpcs,0);assert.equal((await mounted.read()).items.length,1);
  mounted.environment.document.listeners.visibilitychange();await mounted.settle();
  assert.match(mounted.nodes.get('status').textContent,/busy in another tab/);
  assert.equal((await readLease()).owner,'other-tab');
  now+=LEASE_EXPIRY_MS;await [...timers.values()][0]();
  assert.doesNotMatch(mounted.nodes.get('status').textContent,/busy in another tab/);
  const acquired=await readLease();assert.notEqual(acquired.owner,'other-tab');assert.ok(acquired.expires>now);
  await mounted.click('keep');assert.equal((await mounted.read()).items[0].decision,'keep');
 }finally{Date.now=actualNow;await mounted.nodes.get('close').onclick();}
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
test('a clean tab pauses for another owner and Use here reloads saved decisions',async()=>{
 for(const changed of [false,true]){
  const syncFetch=async()=>({ok:true,json:async()=>({decisions:[],history:[],progress:{}})});
  const first=await mountedReview([item('a'),item('b')],{fetch:syncFetch},{url:'https://sync.example',token:'synthetic-token'});
  const second=bundleEnvironment();second.environment.window.indexedDB=first.environment.window.indexedDB;second.environment.window.fetch=syncFetch;
  vm.runInNewContext(await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8'),second.environment);
  first.environment.document.hidden=true;first.environment.document.listeners.visibilitychange();await new Promise(resolve=>setTimeout(resolve,10));
  await second.nodes.get('launcher').onclick();
  if(changed){second.nodes.get('keep').onclick();await new Promise(resolve=>setTimeout(resolve,10));}
  const {openReviewDatabase}=await import('../lib/userscript-db.mjs'),db=await openReviewDatabase(first.environment.window.indexedDB);
  const account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
  const lease=await db.readLease(account),saved=await db.read(account);
  first.environment.document.hidden=false;first.environment.document.listeners.visibilitychange();await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(first.nodes.get('status').textContent,'Open in another tab');
  assert.equal(first.nodes.get('use-here').hidden,false);assert.equal(first.nodes.get('use-here').disabled,false);
  assert.equal(first.nodes.get('keep').disabled,true);
  first.nodes.get('keep').onclick();assert.match(first.nodes.get('caption').textContent,/^a ·/);
  first.environment.window.dispatchEvent(new Event('focus'));await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal((await db.readLease(account)).owner,lease.owner);assert.deepEqual(await db.read(account),saved);
  await db.lease(account,lease.owner,true);
  await first.nodes.get('use-here').onclick();
  assert.equal(first.nodes.get('use-here').hidden,true);assert.equal(first.nodes.get('keep').disabled,false);
  assert.match(first.nodes.get('caption').textContent,changed?/^b ·/:/^a ·/);
  assert.doesNotMatch(first.nodes.get('status').textContent,/conflict|Unsaved|another tab/);
  const acquired=await db.readLease(account);assert.notEqual(acquired.owner,lease.owner);
  await second.nodes.get('close').onclick();assert.equal((await db.readLease(account)).owner,acquired.owner);
  await first.nodes.get('close').onclick();
 }
});

test('a paused tab rejects swipes without hiding the current card',async()=>{
 const mounted=await mountedReview([item('a'),item('b')]);
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs'),db=await openReviewDatabase(mounted.environment.window.indexedDB);
 const account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 await db.lease(account,(await db.readLease(account)).owner,true);
 await db.lease(account,'other-tab');
 mounted.environment.document.listeners.visibilitychange();await mounted.settle();
 const media=mounted.nodes.get('media'),card=mounted.nodes.get('card').childNodes.find(node=>node.class==='top-card');
 media.listeners.pointerdown({isPrimary:true,button:0,target:{tagName:'IMG'},pointerId:1,clientX:0,clientY:0});
 media.listeners.pointerup({pointerId:1,clientX:150,clientY:0});
 assert.equal(mounted.nodes.get('status').textContent,'Open in another tab');
 assert.notEqual(card.style.visibility,'hidden');assert.match(mounted.nodes.get('caption').textContent,/^a ·/);
 assert.equal((await mounted.read()).items[0].decision,null);
 await mounted.nodes.get('close').onclick();
});

test('a hidden tab cannot renew over an owner acquired during its account check',async()=>{
 let finish,started,delay=false;
 const checking=new Promise(resolve=>{started=resolve;});
 const crypto={randomUUID:()=>webcrypto.randomUUID(),subtle:{digest:async(...args)=>{
  const result=await webcrypto.subtle.digest(...args);
  if(delay){delay=false;started();await new Promise(resolve=>{finish=resolve;});}
  return result;
 }}};
 const mounted=await mountedReview([item('a')],{crypto});
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs'),db=await openReviewDatabase(mounted.environment.window.indexedDB);
 const account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 delay=true;mounted.environment.document.listeners.visibilitychange();await checking;
 mounted.environment.document.hidden=true;mounted.environment.document.listeners.visibilitychange();
 await db.lease(account,(await db.readLease(account)).owner,true);
 await db.lease(account,'other-tab');
 await db.save(account,{...await db.read(account),cursor:'other-tab'});
 const saved=await db.read(account);
 finish();await mounted.settle();
 assert.equal((await db.readLease(account)).owner,'other-tab');
 assert.deepEqual(await db.read(account),saved);
 mounted.environment.document.hidden=false;mounted.environment.document.listeners.visibilitychange();await mounted.settle();await mounted.environment.window.listeners.focus();
 assert.equal(mounted.nodes.get('status').textContent,'Open in another tab');
 assert.deepEqual(await db.read(account),saved);
 assert.equal((await db.readLease(account)).owner,'other-tab');
 mounted.nodes.get('keep').onclick();assert.equal((await mounted.read()).items[0].decision,null);
 await mounted.nodes.get('close').onclick();
});

test('focus pauses an in-flight sync before it can save a stale revision',async()=>{
 let finish,started,delay=false;
 const syncing=new Promise(resolve=>{started=resolve;});
 const mounted=await mountedReview([item('a')],{fetch:async()=>{
  if(delay){delay=false;started();await new Promise(resolve=>{finish=resolve;});}
  return {ok:true,json:async()=>({decisions:[],history:[],progress:{}})};
 }},{url:'https://sync.example',token:'synthetic-token'});
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs'),db=await openReviewDatabase(mounted.environment.window.indexedDB);
 const account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 delay=true;const focusing=mounted.environment.window.listeners.focus();await syncing;
 await db.lease(account,(await db.readLease(account)).owner,true);
 await db.lease(account,'other-tab');await db.save(account,{...await db.read(account),cursor:'other-tab'});
 const saved=await db.read(account);
 await mounted.environment.window.listeners.focus();
 assert.equal(mounted.nodes.get('status').textContent,'Open in another tab');
 finish();await focusing;
 assert.deepEqual(await db.read(account),saved);assert.equal((await db.readLease(account)).owner,'other-tab');
 assert.equal(mounted.nodes.get('status').textContent,'Open in another tab');
 await mounted.nodes.get('close').onclick();
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
  else {mounted.environment.window.WIZ_global_data.oPEP7c='renewal-new@example.test';mounted.environment.document.listeners.visibilitychange();await waitForReview(()=>/Google account changed/.test(mounted.nodes.get('status').textContent));}
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
 assert.equal(values.has('photos-swipe-pairing'),false);assert.equal((await store.settings()).token,undefined);assert.equal((await store.settings()).unpaired,true);assert.deepEqual(await db.settings(),{url:replacement.url,deviceId:replacement.deviceId,deviceName:replacement.deviceName,onboardingDismissed:true,unpaired:true});
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
 mounted.environment.GM={getValue:async key=>key==='photos-swipe-pairing'?pairing:undefined,setValue:async(key,value)=>{if(key==='photos-swipe-pairing')pairing=value;},deleteValue:async key=>{if(key==='photos-swipe-pairing')pairing=undefined;}};
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
 mounted.environment.GM={getValue:async key=>key==='photos-swipe-pairing'?pairing:undefined,setValue:async(key,value)=>{if(fail)throw Error('Pairing write failed');if(key==='photos-swipe-pairing')pairing=value;},deleteValue:async key=>{if(key==='photos-swipe-pairing')pairing=undefined;}};
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
 document.documentElement={style:{cssText:''},dataset:{},append(element){if(element.tagName==='SCRIPT')vm.runInNewContext(element.textContent,context);else append(element);}};
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
  mounted.environment.GM={getValue:async key=>key==='photos-swipe-pairing'?pairing:undefined,setValue:async(key,value)=>{if(key==='photos-swipe-pairing')pairing=value;},deleteValue:async key=>{if(key==='photos-swipe-pairing')pairing=undefined;}};
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

for(const dismissal of ['Escape','backdrop'])test(`pairing dialog blocks viewer shortcuts and ${dismissal} burns the code`,async()=>{
 const calls=[];
 const mounted=await mountedReview([item('photo')],{fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({id:'pair-id',code:'abcdefghijklmnopqrstuv',short:'123456',expiresAt:Date.now()+60000})};}});
 mounted.environment.AbortSignal=AbortSignal;
 const {nodes,root}=mounted;
 const dialog=(node)=>node['aria-label']==='Pair another device'?node:node.childNodes?.map(dialog).find(Boolean);
 const pairingPanel= root.childNodes.map(dialog).find(Boolean);
 assert.ok(pairingPanel);
 assert.equal(pairingPanel.className,'pairing-issuer settings-sheet');
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs');
 const db=await openReviewDatabase(mounted.environment.window.indexedDB);
 await db.saveSettings({url:'https://worker.example',token:'secret-token'});
 nodes.get('settings').onclick();
 assert.equal(nodes.get('settings-sheet').hidden,false);
 await nodes.get('pair-another').onclick();
 assert.equal(pairingPanel.hidden,false);
 assert.equal(pairingPanel.style.cssText,'z-index:9;pointer-events:auto');
 assert.equal(nodes.get('settings-sheet').hidden,false);
 const before=await mounted.read();
 for(const key of ['ArrowLeft','ArrowRight','z','f',' ']){
  const event={type:'keydown',key,preventDefault(){throw Error('Pairing key swallowed');},stopImmediatePropagation(){throw Error('Pairing key stopped');}};
  mounted.environment.window.listeners.keydown(event);
 }
 assert.deepEqual(await mounted.read(),before);assert.equal(nodes.get('overlay').hidden,false);assert.equal(nodes.get('card').classList.contains('expanded'),false);
 if(dismissal==='Escape')mounted.environment.window.listeners.keydown({key:'Escape',preventDefault(){},stopImmediatePropagation(){}});
 else await nodes.get('overlay').listeners.click({target:nodes.get('overlay')});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(pairingPanel.hidden,true);assert.equal(nodes.get('overlay').hidden,false);
 assert.equal(calls.at(-2).options.method,'DELETE');assert.equal(calls.at(-2).options.body,JSON.stringify({id:'pair-id'}));
 await nodes.get('close').onclick();await nodes.get('launcher').onclick();assert.equal(pairingPanel.hidden,true);
 await nodes.get('close').onclick();
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
 const deadline=Date.now()+10000;
 while(Date.now()<deadline){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}
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
  assert.equal(animations[2].options.duration,350);
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

test('paired notice lives in Sync and opens the device list',async()=>{
 const requests=[];
 const mounted=await mountedReview([], {fetch:async url=>{
  const path=new URL(url).pathname;requests.push(path);
  return {ok:true,json:async()=>path==='/api/devices'?{deviceId:'caller',devices:[]}:{decisions:[],history:[],progress:{},suggestRevokeLegacy:true}};
 }});
 mounted.environment.AbortSignal=AbortSignal;
 mounted.nodes.get('sync-url').value='https://sync.example';mounted.nodes.get('sync-token').value='synthetic-token';
 await mounted.click('sync-save');
 const notice=mounted.nodes.get('paired-notice'),settings=mounted.nodes.get('sync-settings');
 assert.equal(settings.open,true);assert.equal(notice.hidden,false);
 assert.ok(settings.childNodes.includes(notice));
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
 const GM={getValue:async key=>key==='photos-swipe-pairing'?pairing:undefined,setValue:async(key,value)=>{if(key==='photos-swipe-pairing')pairing=value;},deleteValue:async key=>{if(key==='photos-swipe-pairing')pairing=undefined;}};
 const mount=async()=>{
  const mounted=bundleEnvironment();mounted.environment.window.indexedDB=indexedDB;mounted.environment.GM=GM;mounted.environment.AbortSignal=AbortSignal;
  mounted.environment.window.fetch=async()=>reject?new Response('{}',{status:401}):new Response(JSON.stringify({decisions:[],history:[],progress:{}}));
  vm.runInNewContext(source,mounted.environment);await mounted.nodes.get('launcher').onclick();return mounted;
 };
 const revoked=await mount();assert.equal(pairing,undefined);assert.equal(revoked.nodes.get('unpaired-banner').hidden,false);await revoked.nodes.get('close').onclick();
 const reopened=await mount();assert.equal(reopened.nodes.get('sync-url').value,'https://sync.example');assert.equal(reopened.nodes.get('unpaired-banner').hidden,false);
 reject=false;reopened.nodes.get('sync-token').value='synthetic-new-token';reopened.nodes.get('sync-save').onclick();await waitForReview(()=>reopened.nodes.get('overlay')['aria-busy']==='false');
 assert.equal(pairing.token,'synthetic-new-token');assert.equal(pairing.deviceId,'synthetic-device');assert.equal(pairing.deviceName,'Synthetic phone');assert.equal(reopened.nodes.get('unpaired-banner').hidden,true);assert.match(reopened.nodes.get('sync-status').textContent,/Synced/);
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs');assert.equal((await (await openReviewDatabase(indexedDB)).settings()).unpaired,undefined);
 await reopened.nodes.get('close').onclick();const repaired=await mount();assert.equal(repaired.nodes.get('unpaired-banner').hidden,true);assert.match(repaired.nodes.get('sync-status').textContent,/Synced/);
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


test('paired wiped database rebuilds synced batch, Undo and storage totals before rendering cards',async()=>{
 const fault={},mounted=bundleEnvironment(fault),account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 mounted.environment.AbortSignal=AbortSignal;
 const credentials={url:'https://sync.example',token:'synthetic-token',deviceId:'synthetic-device'};
 mounted.environment.GM={getValue:async()=>credentials,setValue:async()=>{},deleteValue:async()=>{}};
 const items=Array.from({length:64},(_,index)=>({mediaKey:`QA-DUMMY-${index}`,type:'photo',size:index===9?112000:1000,state:index===9?'in_trash':'active',revision:index<10?1:0}));
 const decisions=items.slice(0,10).map((item,index)=>({id:item.mediaKey,decision:index===9?'remove':'keep'}));
 const history=decisions.slice(0,5).map(entry=>({key:entry.id,previous:null,decision:entry.decision,revision:1}));
 const remote={decisions,history,progress:{started:true,reviewed:10,items,lifetimeFreed:224000}};
 let finishState,finishLibrary,stateStarted,libraryStarted,finishSave;
 const stateGate=new Promise(resolve=>{finishState=resolve;}),libraryGate=new Promise(resolve=>{finishLibrary=resolve;});
 const fetchingState=new Promise(resolve=>{stateStarted=resolve;}),fetchingLibrary=new Promise(resolve=>{libraryStarted=resolve;});
 fault.saveGate=new Promise(resolve=>{finishSave=resolve;});
 const requests=[];
 mounted.environment.window.fetch=async(url,options)=>{
  requests.push([new URL(url).pathname,options.method]);
  if(new URL(url).origin==='https://sync.example'){
   if(options.method==='GET'){stateStarted();await stateGate;}
   return {ok:true,json:async()=>remote};
  }
  const entry=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0];
  if(entry[0]==='lcxiM'){libraryStarted();await libraryGate;}
  return {ok:true,text:async()=>envelope(entry[0],entry[0]==='lcxiM'?[items.filter(item=>item.state!=='in_trash').map(item=>[item.mediaKey,['https://lh3.googleusercontent.com/synthetic'],1720000000000,'synthetic-dedup',0,{396644657:[item.mediaKey]}]),null]:[])};
 };
 vm.runInNewContext(await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8'),mounted.environment);
 const opening=mounted.nodes.get('launcher').onclick();
 try{
  await fetchingState;assert.equal(mounted.nodes.get('media').childNodes.length,0);assert.equal(mounted.nodes.get('keep').disabled,true);
  finishState();await fetchingLibrary;assert.equal(mounted.nodes.get('media').childNodes.length,0);
  finishLibrary();await new Promise(resolve=>setTimeout(resolve,20));assert.equal(mounted.nodes.get('media').childNodes.length,0);assert.equal(mounted.nodes.get('overlay')['aria-busy'],'true');
 }finally{finishState();finishLibrary();fault.saveGate=null;finishSave();}
 await opening;await settlePreviews();
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs'),db=await openReviewDatabase(mounted.environment.window.indexedDB),restored=await db.read(account);
 assert.equal(restored.started,true);assert.equal(restored.items.length,64);assert.equal(restored.items.filter(item=>item.decision).length,10);
 assert.deepEqual(restored.history,history);assert.equal(canUndoReview(restored,history.at(-1)),true);assert.equal(restored.lifetimeFreed,224000);
 assert.match(mounted.nodes.get('stats').textContent,/54 to review · 10\/64 reviewed.*In Trash: 112 KB.*Lifetime freed: 224 KB/);
 assert.match(mounted.nodes.get('undo-preview').textContent,/Next Undo: QA-DUMMY-4/);
 assert.match(mounted.nodes.get('caption').textContent,/^QA-DUMMY-10/);
 assert.equal(mounted.nodes.get('media').querySelector('img').src.includes('synthetic'),true);
 assert.equal(requests.filter(([path])=>path==='/api/state').length,1);
});

test('paired wiped database falls back without cards or a blocking error when state fetch fails',async()=>{
 const mounted=bundleEnvironment();mounted.environment.AbortSignal=AbortSignal;
 const credentials={url:'https://sync.example',token:'synthetic-token',deviceId:'synthetic-device'};
 mounted.environment.GM={getValue:async()=>credentials,setValue:async()=>{},deleteValue:async()=>{}};
 let syncRequests=0;
 mounted.environment.window.fetch=async(url,options)=>{
  if(new URL(url).origin==='https://sync.example'){syncRequests++;throw Error('Synthetic offline');}
  const entry=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0];
  return {ok:true,text:async()=>envelope(entry[0],entry[0]==='lcxiM'?[[['QA-FRESH',['https://lh3.googleusercontent.com/synthetic'],1720000000000,'synthetic-dedup',0,{396644657:['QA-FRESH']}]],null]:[])};
 };
 vm.runInNewContext(await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8'),mounted.environment);await mounted.nodes.get('launcher').onclick();
 assert.equal(syncRequests,1);assert.equal(mounted.nodes.get('media').querySelector('img'),null);
 assert.match(mounted.nodes.get('sync-status').textContent,/Synthetic offline.*saved locally/);
 assert.match(mounted.nodes.get('stats').textContent,/0\/0 reviewed/);assert.equal(mounted.nodes.get('load').disabled,false);
 await mounted.nodes.get('load').onclick();
 assert.match(mounted.nodes.get('caption').textContent,/^QA-FRESH/);assert.equal(mounted.nodes.get('keep').disabled,false);
});

test('loader panel displays the selected signed release version instead of the bundled version',async()=>{
 const code=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8');
 for(const version of ['1.2.99','1.2.8']){
  const mounted=bundleEnvironment();
  const GM={getValue:async()=>undefined,setValue:async()=>{},deleteValue:async()=>{}};
  const pair=generateKeyPairSync('ed25519'),release={version,code};
  release.signature=sign(null,Buffer.from(releaseMessage(release)),pair.privateKey).toString('base64');
  const key=Buffer.from(pair.publicKey.export({format:'jwk'}).x,'base64url').toString('base64');
  assert.equal(await verifyRelease(release,webcrypto,key),true);
  assert.equal(injectRelease({...mounted.environment,GM},release),true);
  assert.equal(mounted.nodes.get('running-version').textContent,'v'+version);
  assert.equal(mounted.nodes.get('settings-version').textContent,'Photos Swipe v'+version);
 }
});

test('resume record survives reload independently of decisions and is account scoped',async()=>{
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs');
 const indexedDB=fakeIndexedDB(),db=await openReviewDatabase(indexedDB);
 const saved=await db.save('synthetic-account',{...emptyReview(),items:[item('synthetic-video',{type:'video'}),item('synthetic-marked',{decision:'remove'})],history:[{key:'synthetic-marked',decision:'remove',previous:null,revision:1}]});
 const resume={currentId:'synthetic-video',video:{key:'synthetic-video',time:37.25},filter:'video',sort:'largest',reviewEvery:25,deleteMethod:'trash'};
 await db.saveResume('synthetic-account',resume);
 const reopened=await openReviewDatabase(indexedDB);
 assert.deepEqual(await reopened.resume('synthetic-account'),resume);
 assert.deepEqual(await reopened.resume('different-synthetic-account'),{});
 assert.deepEqual(await reopened.read('synthetic-account'),saved);
});

test('mounted shell restores exact card and Escape closes settings and enlarged view before shell',async()=>{
 const mounted=await mountedReview([item('synthetic-first'),item('synthetic-second')]);
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs');
 const db=await openReviewDatabase(mounted.environment.window.indexedDB);
 const account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 await new Promise(resolve=>setTimeout(resolve,20));
 mounted.nodes.get('close').onclick();
 await new Promise(resolve=>setTimeout(resolve,20));
 await db.saveResume(account,{currentId:'synthetic-second',reviewEvery:7});
 await mounted.nodes.get('launcher').onclick();
 dismissReviewPairing(mounted);
 assert.match(mounted.nodes.get('caption').textContent,/synthetic-second/);
 assert.equal(mounted.nodes.get('review-every').value,'7');
 const escape=()=>mounted.environment.window.listeners.keydown({key:'Escape',preventDefault(){},stopImmediatePropagation(){}});
 mounted.nodes.get('settings').onclick();
 assert.equal(mounted.nodes.get('settings-sheet').hidden,false);
 escape();assert.equal(mounted.nodes.get('settings-sheet').hidden,true);assert.equal(mounted.nodes.get('overlay').hidden,false);
 mounted.nodes.get('enlarge').onclick();escape();assert.equal(mounted.nodes.get('card').classList.contains('expanded'),false);assert.equal(mounted.nodes.get('overlay').hidden,false);
 escape();await mounted.nodes.get('close').onclick();assert.equal(mounted.nodes.get('overlay').hidden,true);
 await new Promise(resolve=>setTimeout(resolve,20));
 await db.saveResume(account,{currentId:'synthetic-missing'});
 await mounted.nodes.get('launcher').onclick();
 assert.match(mounted.nodes.get('caption').textContent,/synthetic-first/);
 assert.match(mounted.nodes.get('status').textContent,/Saved item is unavailable/);
});

test('video resume is throttled, flushed on close and seeks after metadata on reload',async()=>{
 const fetch=async()=>({ok:true,text:async()=>envelope('VrseUb',[['synthetic-video'],'https://lh3.googleusercontent.com/synthetic-video'])});
 const mounted=await mountedReview([item('synthetic-video',{type:'video',urlFetchedAt:Date.now()-41*60*1000})],{fetch});
 await new Promise(resolve=>setTimeout(resolve,20));
 const video=mounted.nodes.get('media').querySelector('video');video.duration=120;video.listeners.loadedmetadata();
 video.currentTime=12.5;video.listeners.timeupdate();
 await new Promise(resolve=>setTimeout(resolve,20));
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs');
 const db=await openReviewDatabase(mounted.environment.window.indexedDB);
 const account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 assert.equal((await db.resume(account)).video.time,12.5);
 video.currentTime=13;video.listeners.timeupdate();
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal((await db.resume(account)).video.time,12.5);
 video.currentTime=37.25;mounted.nodes.get('close').onclick();
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal((await db.resume(account)).video.time,37.25);
 const reopened=bundleEnvironment();reopened.environment.window.indexedDB=mounted.environment.window.indexedDB;reopened.environment.window.fetch=fetch;
 vm.runInNewContext(await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8'),reopened.environment);
 await reopened.nodes.get('launcher').onclick();await new Promise(resolve=>setTimeout(resolve,20));
 const restored=reopened.nodes.get('media').querySelector('video');restored.duration=120;restored.listeners.loadedmetadata();
 assert.equal(restored.currentTime,37.25);
 assert.equal((await db.read(account)).items[0].decision,null);
});

test('Tab traps focus in the shell and settings while backdrop click closes the window',async()=>{
 const mounted=await mountedReview([item('synthetic-card')]);
 const overlay=mounted.nodes.get('overlay'),sheet=mounted.nodes.get('settings-sheet');
 const controls=['settings','review','close','remove','undo','keep','enlarge'].map(id=>mounted.nodes.get(id));
 for(const control of controls)control.getClientRects=()=>[{}];
 overlay.querySelectorAll=()=>controls;
 const tab=shiftKey=>mounted.environment.window.listeners.keydown({key:'Tab',shiftKey,preventDefault(){},stopImmediatePropagation(){}});
 controls.at(-1).focus();tab(false);assert.equal(mounted.root.activeElement,controls[0]);
 controls[0].focus();tab(true);assert.equal(mounted.root.activeElement,controls.at(-1));
 mounted.nodes.get('settings').onclick();const done=sheet.childNodes[0];done.getClientRects=()=>[{}];sheet.querySelectorAll=()=>[done];
 done.focus();tab(false);assert.equal(mounted.root.activeElement,done);
 overlay.listeners.click({target:mounted.nodes.get('card')});assert.equal(overlay.hidden,false);
 overlay.listeners.click({target:overlay});await mounted.nodes.get('close').onclick();assert.equal(overlay.hidden,true);assert.equal(sheet.hidden,true);
});

test('Settings exposes Load more and continues the cursor after Refresh latest',async()=>{
 const cursors=[];
 const fetch=async(url,options)=>{
  const entry=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0],args=JSON.parse(entry[1]);
  if(entry[0]==='EWgK9e')return {ok:true,text:async()=>envelope(entry[0],[[]])};
  assert.equal(entry[0],'lcxiM');cursors.push(args[0]);
  const key=args[0]?'older-photo':'latest-photo';
  return {ok:true,text:async()=>envelope(entry[0],[[[key,['https://lh3.googleusercontent.com/fake'],1720000000000,key+'-stable',0,{}]],args[0]?null:'older-cursor'])};
 };
 const mounted=await mountedReview([],{fetch});
 mounted.nodes.get('settings').onclick();
 const load=mounted.nodes.get('load');
 assert.equal(load.hidden,false);
 assert.ok(mounted.nodes.get('settings-sheet').childNodes.some(group=>group.childNodes.includes(load)));
 const styles=mounted.root.childNodes.filter(node=>node.tagName==='STYLE').map(node=>node.textContent).join('\n');
 assert.doesNotMatch(styles,/[^{}]*#load[^{}]*\{[^}]*display:\s*none/);
 await mounted.click('refresh');await mounted.click('refresh');await mounted.click('load');
 assert.deepEqual(cursors,[null,'older-cursor',null]);
 assert.deepEqual((await mounted.read()).items.map(row=>row.mediaKey),['latest-photo','older-photo']);
 assert.equal((await mounted.read()).exhausted,true);
});

test('Trash mode remains usable for a second batch after a verified move',async()=>{
 const trashed=new Set(),batches=[];
 const fetch=async(url,options)=>{
  const entry=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0],args=JSON.parse(entry[1]);
  if(entry[0]==='XwAOJf'){batches.push(args[2]);for(const key of args[2])trashed.add(key);}
  return {ok:true,text:async()=>envelope(entry[0],entry[0]==='XwAOJf'?[]:[[...trashed].map(key=>[key.slice(7),null,null,key]),null])};
 };
 const mounted=await mountedReview([item('a',{decision:'remove',dedupKey:'stable-a'}),item('b',{dedupKey:'stable-b'})],{fetch,confirm:()=>true});
 if(mounted.nodes.get('review-panel').hidden)await mounted.click('review');await mounted.click('move-trash');
 assert.equal(mounted.nodes.get('delete-method').value,'trash');
 assert.equal(mounted.nodes.get('trash-opt-in').checked,true);
 mounted.nodes.get('review-panel').childNodes[0].childNodes[0].onclick();await mounted.click('remove');await mounted.click('review');
 assert.equal(mounted.nodes.get('move-trash').hidden,false);
 assert.equal(mounted.nodes.get('move-trash').textContent,'Move 1 to Trash');
 if(mounted.nodes.get('review-panel').hidden)await mounted.click('review');await mounted.click('move-trash');
 assert.deepEqual(batches,[['stable-a'],['stable-b']]);
 assert.ok((await mounted.read()).items.every(row=>row.state==='in_trash'));
});

test('resume stays on an uncommitted item and advances after persistence before reopening',async()=>{
 const fault={},mounted=await mountedReview([item('a'),item('b')],{},fault);
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs');
 const db=await openReviewDatabase(mounted.environment.window.indexedDB),account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal((await db.resume(account)).currentId,'a');
 let release;fault.saveGate=new Promise(resolve=>{release=resolve;});
 try{
  mounted.nodes.get('keep').onclick();
  assert.match(mounted.nodes.get('caption').textContent,/^b · /);
  mounted.nodes.get('close').onclick();
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal((await db.read(account)).items[0].decision,null);
  assert.equal((await db.resume(account)).currentId,'a');
  fault.saveGate=null;release();await mounted.nodes.get('close').onclick();
  const reopened=bundleEnvironment();reopened.environment.window.indexedDB=mounted.environment.window.indexedDB;
  vm.runInNewContext(await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8'),reopened.environment);
  await reopened.nodes.get('launcher').onclick();
  assert.match(reopened.nodes.get('caption').textContent,/^b · /);
 }finally{fault.saveGate=null;release();await mounted.settle();}
});

test('failed sync remains visible alongside keep, queue and undo confirmations',async()=>{
 const mounted=await mountedReview([item('a'),item('b')],{fetch:async()=>new Response('{}',{status:503})});
 mounted.environment.AbortSignal=AbortSignal;
 mounted.nodes.get('sync-url').value='https://sync.example';mounted.nodes.get('sync-token').value='synthetic-token';
 await mounted.click('sync-save');
 for(const [action,confirmation] of [['keep',/Kept a\./],['remove',/Added to the local removal queue\./],['undo',/Last swipe undone for b\./]]){
  await mounted.click(action);
  assert.match(mounted.nodes.get('status').textContent,confirmation);
  assert.match(mounted.nodes.get('status').textContent,/Sync HTTP 503 · saved locally; retry on next action/);
  assert.equal(mounted.nodes.get('settings').classList.contains('gear-error'),true);
 }
 await waitForReview(async()=>{const state=await mounted.read();return state.items[0].decision==='keep'&&state.items[1].decision===null&&state.history.length===1;});
 assert.deepEqual((await mounted.read()).items.map(row=>row.decision),['keep',null]);
});

test('URL refreshes preserve resume settings and inspection across close and reopen',async()=>{
 const fetch=async()=>({ok:true,text:async()=>envelope('VrseUb',[['synthetic-preview',['https://photos.fife.usercontent.google.com/synthetic-fresh',800,600]],'https://lh3.googleusercontent.com/synthetic-video'])});
 const mounted=await mountedReview([item('synthetic-preview',{urlFetchedAt:Date.now()-41*60*1000}),item('synthetic-queued',{decision:'remove'})],{fetch});
 await settlePreviews();
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs');
 const db=await openReviewDatabase(mounted.environment.window.indexedDB),account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 for(const [id,value] of [['filter','photo'],['sort','largest'],['review-every','7'],['delete-method','trash']]){mounted.nodes.get(id).value=value;mounted.nodes.get(id).onchange();}
 await mounted.settle();
 mounted.nodes.get('review').onclick();mounted.nodes.get('trash-review-grid').childNodes[0].childNodes[0].onclick();
 await mounted.nodes.get('close').onclick();
 const saved=await db.resume(account);
 assert.equal(saved.filter,'photo');assert.equal(saved.sort,'largest');assert.equal(saved.reviewEvery,7);assert.equal(saved.deleteMethod,'trash');assert.equal(saved.inspected,false);assert.equal(saved.currentId,'synthetic-preview');
 await mounted.nodes.get('launcher').onclick();
 await settlePreviews();
 await mounted.nodes.get('close').onclick();
 assert.deepEqual(await db.resume(account),saved);
});

test('URL refresh during a decision save advances resume only after the snapshot commits',async()=>{
 for(const laterDecision of [false,true]){
  const fault={},fetch=async()=>({ok:true,text:async()=>envelope('VrseUb',[['synthetic-refresh',['https://photos.fife.usercontent.google.com/synthetic-fresh',800,600]],'https://lh3.googleusercontent.com/synthetic-video'])});
  const mounted=await mountedReview([item('synthetic-a'),item('synthetic-b'),item('synthetic-c')],{fetch},fault);
  const {openReviewDatabase}=await import('../lib/userscript-db.mjs');
  const db=await openReviewDatabase(mounted.environment.window.indexedDB),account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
  await settlePreviews();
  let release;fault.saveGate=new Promise(resolve=>{release=resolve;});
  try{
   mounted.nodes.get('keep').onclick();await settlePreviews();
   const actualNow=Date.now;Date.now=()=>actualNow()+41*60*1000;
   try{mounted.environment.document.listeners.visibilitychange();await settlePreviews();}finally{Date.now=actualNow;}
   if(laterDecision)mounted.nodes.get('keep').onclick();
   mounted.nodes.get('sort').value='largest';mounted.nodes.get('sort').onchange();
   await settlePreviews();
   assert.equal((await db.resume(account)).currentId,'synthetic-a');
   fault.saveGate=null;release();await mounted.settle();await settlePreviews();
   assert.equal((await db.resume(account)).currentId,laterDecision?'synthetic-c':'synthetic-b');
   assert.equal((await db.resume(account)).sort,'largest');
  }finally{fault.saveGate=null;release();await mounted.nodes.get('close').onclick();}
 }
});

test('mounted settings close by Escape or Done blocks typing spillover before shortcuts resume',async()=>{
 for(const method of ['escape','done']){
  let time=10000;
  class ReviewDate extends Date {static now(){return time;}}
  const mounted=await mountedReview([item('keyboard-first'),item('keyboard-second')],{},undefined,{Date:ReviewDate});
  const press=key=>mounted.environment.window.listeners.keydown({key,preventDefault(){},stopImmediatePropagation(){}});
  mounted.nodes.get('settings').onclick();mounted.nodes.get('pair-code').focus();
  press('ArrowLeft');press('ArrowRight');
  if(method==='escape')press('Escape');else mounted.nodes.get('settings-sheet').querySelector('header').querySelector('button').onclick();
  assert.equal(mounted.nodes.get('settings-sheet').hidden,true);
  assert.equal(mounted.root.activeElement,mounted.nodes.get('settings'));
  const space=async type=>{
   const event={type,key:' ',repeat:type==='keydown',prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};
   mounted.environment.window.listeners[type](event);
   if(type==='keyup'&&!event.prevented)await mounted.root.activeElement?.onclick?.();
   assert.equal(event.prevented,true);assert.equal(event.stopped,true);
   assert.equal(mounted.nodes.get('settings-sheet').hidden,true);
  };
  await space('keydown');await space('keyup');
  press('ArrowLeft');time+=499;await space('keydown');await space('keyup');press('ArrowRight');await mounted.settle();
  assert.deepEqual((await mounted.read()).items.map(row=>row.decision),[null,null]);
  time++;press('ArrowRight');await mounted.settle();
  assert.deepEqual((await mounted.read()).items.map(row=>row.decision),['keep',null]);
 }
});

test('continuous deck prefetches at ten cards, preserves in-flight swipes and reaches the actual library end',async()=>{
 const cursors=[];
 let releasePage;
 const fetch=async(url,options)=>{
  const entry=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0],args=JSON.parse(entry[1]);
  if(entry[0]==='EWgK9e')return {ok:true,text:async()=>envelope(entry[0],[[]])};
  assert.equal(entry[0],'lcxiM');cursors.push(args[0]);
  if(args[0]==='second')await new Promise(resolve=>{releasePage=resolve;});
  const keys=args[0]===null?Array.from({length:50},(_,index)=>`first-${index}`):args[0]==='second'?['kept','queued',...Array.from({length:50},(_,index)=>`second-${index}`)]:['last'];
  const next=args[0]===null?'second':args[0]==='second'?'third':null;
  return {ok:true,text:async()=>envelope(entry[0],[keys.map(key=>[key,['https://lh3.googleusercontent.com/synthetic'],1720000000000,key+'-dedup',0,{}]),next])};
 };
 const mounted=await mountedReview([item('kept',{decision:'keep'}),item('queued',{decision:'remove'})],{fetch});
 await mounted.click('refresh');
 for(let index=0;index<39;index++)mounted.nodes.get('keep').onclick();
 await mounted.settle();assert.deepEqual(cursors,[null]);
 mounted.nodes.get('keep').onclick();
 for(let count=0;count<100&&!releasePage;count++)await new Promise(resolve=>setTimeout(resolve,2));
 assert.deepEqual(cursors,[null,'second']);
 for(let index=0;index<10;index++)mounted.nodes.get('keep').onclick();
 assert.match(mounted.nodes.get('caption').textContent,/Loading more/);
 releasePage();
 for(let count=0;count<100&&(await mounted.read()).items.length<102;count++)await new Promise(resolve=>setTimeout(resolve,2));
 await mounted.settle();
 assert.equal((await mounted.read()).items.filter(row=>row.mediaKey.startsWith('first-')&&row.decision==='keep').length,50);
 assert.equal(reviewDeck(await mounted.read())[0].mediaKey,'second-0');
 for(let index=0;index<40;index++)mounted.nodes.get('keep').onclick();
 for(let count=0;count<100&&!(await mounted.read()).exhausted;count++)await new Promise(resolve=>setTimeout(resolve,2));
 assert.deepEqual(cursors,[null,'second','third']);
 assert.doesNotMatch(mounted.nodes.get('caption').textContent,/reviewed everything/);
 for(let index=0;index<11;index++)mounted.nodes.get('keep').onclick();
 await mounted.settle();
 assert.equal(mounted.nodes.get('caption').textContent,'You’ve reviewed everything');
 assert.equal((await mounted.read()).items.find(row=>row.mediaKey==='queued').decision,'remove');
});

test('library loading crosses more than twelve fully reviewed pages without a manual continuation',async()=>{
 const reviewed=item('reviewed',{decision:'keep'}),queued=item('queued',{decision:'remove'});
 let state={...emptyReview(),items:[reviewed,queued]},calls=0;
 const result=await loadReviewPages({read:async()=>state,save:async next=>state=next,call:async(operation,{cursor})=>{
  assert.equal(cursor,calls?`page-${calls}`:null);calls++;
  return calls<=14?{items:[reviewed,queued],nextPageId:`page-${calls}`}:{items:[item('fresh')],nextPageId:null};
 }});
 assert.equal(calls,15);assert.equal(result.exhausted,true);assert.deepEqual(reviewDeck(state).map(row=>row.mediaKey),['fresh']);
});

for(const scenario of ['empty','oldest','largest'])test(`prefetched cards render before decisions while loading continues: ${scenario}`,async()=>{
 const second=Promise.withResolvers(),third=Promise.withResolvers();
 let secondRequested=false,thirdRequested=false;
 const fetch=async(url,options)=>{
  const entry=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0],args=JSON.parse(entry[1]);
  if(entry[0]==='EWgK9e'){
   const detail=['incoming',[]];detail[1][3]='incoming';detail[1][9]=500;
   return {ok:true,text:async()=>envelope(entry[0],[[null,[detail]]])};
  }
  assert.equal(entry[0],'lcxiM');
  if(args[0]==='second'){secondRequested=true;await second.promise;}
  if(args[0]==='third'){thirdRequested=true;await third.promise;}
  const keys=args[0]===null?Array.from({length:50},(_,index)=>`initial-${index}`):args[0]==='second'?['incoming']:[];
  const date=args[0]===null?1720000000000:1710000000000;
  return {ok:true,text:async()=>envelope(entry[0],[keys.map(key=>[key,['https://lh3.googleusercontent.com/synthetic'],date,key+'-dedup',0,{}]),args[0]===null?'second':args[0]==='second'?'third':null])};
 };
 const mounted=await mountedReview([],{fetch});
 try{
  await mounted.click('refresh');
  if(scenario!=='empty'){mounted.nodes.get('sort').value=scenario;mounted.nodes.get('sort').onchange();}
  for(let index=0;index<40;index++)mounted.nodes.get('keep').onclick();
  await waitForReview(()=>secondRequested);
  if(scenario==='empty')for(let index=0;index<10;index++)mounted.nodes.get('keep').onclick();
  second.resolve();
  await waitForReview(()=>thirdRequested);
  assert.match(mounted.nodes.get('caption').textContent,/^incoming · /);
  assert.equal(mounted.nodes.get('media').querySelector('img').alt,'incoming');
  if(scenario==='oldest')pressReviewKey(mounted,'ArrowLeft');
  else if(scenario==='largest')pressReviewKey(mounted,'ArrowRight');
  else mounted.nodes.get('keep').onclick();
  third.resolve();
  await waitForReview(async()=>(await mounted.read()).items.find(row=>row.mediaKey==='incoming')?.decision===(scenario==='oldest'?'remove':'keep'));
  const state=await mounted.read();
  assert.equal(state.items.filter(row=>row.mediaKey.startsWith('initial-')&&row.decision).length,scenario==='empty'?50:40);
 }finally{second.resolve();third.resolve();await mounted.nodes.get('close').onclick();}
});

test('queue pill grows beyond 25 while swipe decisions continue without opening review',async()=>{
 const mounted=await mountedReview(Array.from({length:40},(_,index)=>item(`queue-${index}`)));
 const content=mounted.nodes.get('overlay').childNodes[0],pill=content.childNodes.find(node=>node.class==='queue-pill');
 assert.equal(pill.hidden,true);
 for(let index=0;index<31;index++)mounted.nodes.get('remove').onclick();
 assert.equal(mounted.nodes.get('review-panel').hidden,true);assert.equal(pill.hidden,false);assert.equal(pill.childNodes[1].textContent,'31 going to Trash');assert.equal(pill.childNodes[2].textContent,'+6');assert.equal(pill.childNodes[0].childNodes.length,3);
 await mounted.settle();assert.equal(reviewQueue(await mounted.read()).length,31);assert.match(mounted.nodes.get('caption').textContent,/^queue-31 · /);
 pill.childNodes.at(-1).onclick();assert.equal(mounted.nodes.get('review-panel').hidden,false);assert.equal(mounted.nodes.get('trash-review-grid').childNodes.length,31);
 mounted.nodes.get('remove').onclick();mounted.nodes.get('keep').onclick();assert.equal(reviewQueue(await mounted.read()).length,31);
 mounted.nodes.get('review-panel').childNodes.at(-1).childNodes[0].onclick();mounted.nodes.get('remove').onclick();await mounted.settle();assert.equal(reviewQueue(await mounted.read()).length,32);
});

test('unticking keeps items immediately and only the remaining selection reaches Trash',async()=>{
 const trashed=new Set(),batches=[];
 const fetch=async(url,options)=>{const entry=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0],args=JSON.parse(entry[1]);if(entry[0]==='XwAOJf'){batches.push(args[2]);for(const key of args[2])trashed.add(key);}return {ok:true,text:async()=>envelope(entry[0],entry[0]==='XwAOJf'?[]:[[...trashed].map(key=>[key.slice(7),null,null,key]),null])};};
 const mounted=await mountedReview([item('a',{decision:'remove',dedupKey:'stable-a'}),item('b',{decision:'remove',queueSent:true,dedupKey:'stable-b'})],{fetch,confirm:()=>true});
 await mounted.click('review');const grid=mounted.nodes.get('trash-review-grid');grid.childNodes[1].childNodes[1].onclick();await mounted.settle();assert.equal(grid.childNodes.length,2);assert.equal(grid.childNodes[1].class,'trash-tile kept');
 await mounted.click('move-trash');assert.deepEqual(batches,[['stable-a']]);const state=await mounted.read();assert.equal(state.items[0].state,'in_trash');assert.equal(state.items[1].state,'active');assert.equal(state.items[1].decision,'keep');assert.equal(mounted.nodes.get('move-trash').disabled,true);
});

test('review preview Done and Escape return to grid before closing review',async()=>{
 const mounted=await mountedReview([item('a',{decision:'remove'}),item('b')]);await mounted.click('review');const grid=mounted.nodes.get('trash-review-grid');grid.childNodes[0].childNodes[0].onclick();
 assert.equal(mounted.nodes.get('trash-preview').childNodes[0].childNodes[1].textContent,'1 of 1');mounted.nodes.get('trash-preview').childNodes[0].childNodes[2].onclick();assert.equal(mounted.nodes.get('review-panel').querySelector('.trash-preview'),null);
 grid.childNodes[0].childNodes[0].onclick();const escape=()=>mounted.environment.window.listeners.keydown({key:'Escape',preventDefault(){},stopImmediatePropagation(){}});escape();assert.equal(mounted.nodes.get('review-panel').hidden,false);assert.equal(mounted.nodes.get('review-panel').querySelector('.trash-preview'),null);escape();assert.equal(mounted.nodes.get('review-panel').hidden,true);assert.equal(mounted.nodes.get('overlay').hidden,false);
});

for(const action of ['untick','selectAll','previewKeep','previewTrash'])test(`trash review ${action} undoes the latest change before earlier swipes`,async()=>{
 const mounted=await mountedReview([item('a'),item('b')]);
 await mounted.click('keep');await mounted.click('remove');await mounted.click('review');
 const grid=mounted.nodes.get('trash-review-grid');
 if(action==='untick')grid.childNodes[0].childNodes[1].onclick();
 else if(action==='selectAll'){
  grid.childNodes[0].childNodes[1].onclick();
  mounted.nodes.get('review-panel').childNodes[0].childNodes[1].onclick();
 }else{
  grid.childNodes[0].childNodes[0].onclick();
  mounted.nodes.get('trash-preview').childNodes.at(-1).childNodes[0].onclick();
  if(action==='previewTrash')mounted.nodes.get('trash-preview').childNodes.at(-1).childNodes[1].onclick();
 }
 await mounted.settle();
 const changed=await mounted.read();
 assert.equal(changed.history.length,action==='selectAll'||action==='previewTrash'?4:3);
 assert.equal(changed.history.at(-1).key,'b');
 assert.equal(canUndoReview(changed,changed.history.at(-1)),true);
 mounted.nodes.get('review-panel').childNodes[0].childNodes[0].onclick();
 const expected=action==='selectAll'||action==='previewTrash'?['keep','remove',null]:['remove',null];
 for(const decision of expected){
  await mounted.click('undo');const state=await mounted.read();
  assert.equal(state.items.find(row=>row.mediaKey==='b').decision,decision);
  assert.equal(state.items.find(row=>row.mediaKey==='a').decision,'keep');
 }
 await mounted.click('undo');assert.equal((await mounted.read()).items.find(row=>row.mediaKey==='a').decision,null);
});

test('undoing a review Keep returns to swipe review across reopen',async()=>{
 const mounted=await mountedReview([item('a'),item('b')]);
 await mounted.click('remove');await mounted.click('review');
 mounted.nodes.get('trash-review-grid').childNodes[0].childNodes[1].onclick();await mounted.settle();
 mounted.nodes.get('review-panel').childNodes[0].childNodes[0].onclick();await mounted.click('undo');
 assert.equal((await mounted.read()).items[0].decision,'remove');
 assert.match(mounted.nodes.get('caption').textContent,/^b · /);
 assert.equal(mounted.nodes.get('remove')['aria-label'],'Mark for deletion');
 await mounted.click('close');await mounted.click('launcher');
 assert.match(mounted.nodes.get('caption').textContent,/^b · /);
 assert.equal(mounted.nodes.get('remove')['aria-label'],'Mark for deletion');
 await mounted.click('remove');
 assert.deepEqual((await mounted.read()).items.map(row=>row.decision),['remove','remove']);
});

test('chained review undo uploads valid history and progress without remaining dirty',async()=>{
 let scheduledSync;
 const uploads=[];
 const mounted=await mountedReview([item('a'),item('b')],{
  setTimeout(callback,delay){if(delay===2000){scheduledSync=callback;return {unref(){}};}return setTimeout(callback,delay);},
  clearTimeout(timer){if(timer?.unref)return;clearTimeout(timer);},
  fetch:async(url,options)=>{
   const path=new URL(url).pathname,value=options.body?JSON.parse(options.body):null;
   if(path==='/api/undo'&&options.method==='PUT'){
    assert.ok(value.history.every(entry=>Object.keys(entry).every(key=>['key','previous','decision','revision'].includes(key))));
   }
   if(value)uploads.push({path,value});
   return {ok:true,json:async()=>path==='/api/progress'&&options.method==='PUT'?{items:value.items}:{decisions:[],history:[],progress:{}}};
  }
 },{url:'https://sync.example',token:'synthetic-token'},{AbortSignal});
 await mounted.click('remove');await mounted.click('review');
 const grid=mounted.nodes.get('trash-review-grid');grid.childNodes[0].childNodes[1].onclick();await mounted.settle();
 mounted.nodes.get('review-panel').childNodes[0].childNodes[1].onclick();await mounted.settle();
 mounted.nodes.get('review-panel').childNodes[0].childNodes[0].onclick();
 for(const decision of ['keep','remove',null]){
  await mounted.click('undo');
  assert.equal((await mounted.read()).items[0].decision,decision);
  const before=uploads.length;scheduledSync();
  await waitForReview(async()=>!(await mounted.read()).syncDirty);
  assert.ok(uploads.slice(before).some(upload=>upload.path==='/api/undo'));
  assert.ok(uploads.slice(before).some(upload=>upload.path==='/api/progress'));
 }
 assert.equal((await mounted.read()).history.length,0);
});

test('unpaired launcher shows the receiver with another Photos tab open',async()=>{
 const first=await mountedReview([item('a')]);
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs');
 const db=await openReviewDatabase(first.environment.window.indexedDB);await db.saveSettings({});
 const second=bundleEnvironment();second.environment.window.indexedDB=first.environment.window.indexedDB;
 vm.runInNewContext(await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8'),second.environment);
 await second.nodes.get('launcher').onclick();
 const receiver=second.root.childNodes.find(node=>node.className==='pairing-receiver settings-sheet');
 assert.ok(receiver);assert.equal(receiver.hidden,false);assert.ok(second.nodes.get('pairing-short-code'));
 const code=second.nodes.get('pairing-short-code');assert.equal(second.root.activeElement,code);
 for(const key of '123456'){
  let prevented=false;second.environment.window.listeners.keydown({key,preventDefault(){prevented=true;},stopImmediatePropagation(){}});
  assert.equal(prevented,false);assert.equal(second.root.activeElement,code);code.value+=key;code.oninput();
 }
 assert.equal(code.value,'123456');
 await second.nodes.get('close').onclick();await first.nodes.get('close').onclick();
});

test('unpaired script opens the receiver despite a paired script dismissing shared onboarding',async()=>{
 const credentials={url:'https://worker.example',token:'paired-script-token',onboardingDismissed:true};
 const first=await mountedReview([item('a')],{fetch:async()=>({ok:true,json:async()=>({decisions:[],history:[],progress:{}})})},credentials,{GM:{getValue:async()=>credentials,setValue:async()=>{},deleteValue:async()=>{}}});
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs');
 const db=await openReviewDatabase(first.environment.window.indexedDB);
 assert.deepEqual(await db.settings(),{onboardingDismissed:true});
 assert.equal(first.root.childNodes.some(node=>node.className==='pairing-receiver settings-sheet'&&!node.hidden),false);
 const second=bundleEnvironment();second.environment.window.indexedDB=first.environment.window.indexedDB;
 second.environment.GM={getValue:async()=>undefined,setValue:async()=>{},deleteValue:async()=>{}};
 vm.runInNewContext(await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8'),second.environment);
 try{
  await second.nodes.get('launcher').onclick();
  const receiver=second.root.childNodes.find(node=>node.className==='pairing-receiver settings-sheet');
  assert.ok(receiver);assert.equal(receiver.hidden,false);
  assert.equal(second.root.activeElement,second.nodes.get('pairing-short-code'));
  await second.nodes.get('close').onclick();await first.nodes.get('close').onclick();
  await second.nodes.get('launcher').onclick();
  assert.equal(second.root.childNodes.findLast(node=>node.className==='pairing-receiver settings-sheet').hidden,false);
  assert.deepEqual(await db.settings(),{onboardingDismissed:true});
 }finally{await second.nodes.get('close').onclick();await first.nodes.get('close').onclick();}
});

test('Settings pairing sends six digits and preserves credentials on failure',async()=>{
 const calls=[],mounted=await mountedReview([item('a')],{fetch:async(url,options)=>{calls.push({url,options});return {ok:false,status:400};}});
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs');
 const db=await openReviewDatabase(mounted.environment.window.indexedDB);
 const saved={url:'https://worker.example',token:'existing-token'};await db.saveSettings(saved);
 mounted.environment.window.fetch=async(url,options)=>{calls.push({url,options});return {ok:false,status:400};};
 mounted.nodes.get('sync-url').value='';mounted.nodes.get('pair-code').value='123 456';
 await mounted.nodes.get('pair-submit').onclick();
 assert.equal(calls[0].url,'https://worker.example/api/pair/claim');assert.equal(JSON.parse(calls[0].options.body).short,'123456');
 assert.deepEqual(await db.settings(),saved);
 const feedback=mounted.nodes.get('enter-pairing-code').childNodes.at(-1);
 assert.match(feedback.textContent,/Code expired or unavailable/);assert.equal(mounted.nodes.get('pair-submit').disabled,false);
 mounted.nodes.get('sync-url').value='invalid';await mounted.nodes.get('pair-submit').onclick();
 assert.match(feedback.textContent,/valid HTTPS Worker origin/);assert.equal(calls.length,1);assert.deepEqual(await db.settings(),saved);
 await mounted.nodes.get('close').onclick();
});


test('Settings pairing fills a blank Sync URL and keeps the claimed token on Save and sync',async()=>{
 for(const previous of [{},{url:'https://worker.example',token:'old-token'}]){
  const calls=[],mounted=await mountedReview([item('a')],{fetch:async(url,options)=>{
   calls.push({url,options});
   return {ok:true,json:async()=>url.endsWith('/api/pair/claim')?{token:'claimed-token'}:{decisions:[],history:[],progress:{}}};
  }});
  const {openReviewDatabase}=await import('../lib/userscript-db.mjs');
  const db=await openReviewDatabase(mounted.environment.window.indexedDB);await db.saveSettings(previous);
  try{
   mounted.nodes.get('sync-url').value='';mounted.nodes.get('pair-code').value='123456';
   await mounted.nodes.get('pair-submit').onclick();
   const origin=previous.url||'https://photoswiper-sync.sidlakkoju.workers.dev';
   assert.equal(mounted.nodes.get('sync-url').value,origin);assert.equal(mounted.nodes.get('sync-token').value,'');
   await mounted.click('sync-save');
   assert.deepEqual(await db.settings(),{url:origin,token:'claimed-token',onboardingDismissed:true});
   assert.ok(calls.some(({url,options})=>new URL(url).pathname==='/api/state'&&options.headers.Authorization==='Bearer claimed-token'));
  }finally{await mounted.nodes.get('close').onclick();}
 }
});

test('receiver claim during session opening activates the saved pairing after lease acquisition',async()=>{
 const fault={},mounted=bundleEnvironment(fault),calls=[];
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs');
 const db=await openReviewDatabase(mounted.environment.window.indexedDB);await db.saveSettings({});
 mounted.environment.window.fetch=async(url,options)=>{
  calls.push({url,options});
  return {ok:true,json:async()=>url.endsWith('/api/pair/claim')?{token:'receiver-token'}:{decisions:[],history:[],progress:{}}};
 };
 let release;fault.leaseGate=new Promise(resolve=>{release=resolve;});
 vm.runInNewContext(await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8'),mounted.environment);
 const opening=mounted.nodes.get('launcher').onclick();let claiming;
 try{
  await waitForReview(()=>fault.leaseWrites>0);
  const receiver=mounted.root.childNodes.find(node=>node.className==='pairing-receiver settings-sheet');
  mounted.nodes.get('pairing-short-code').value='123456';
  claiming=receiver.childNodes.find(node=>node.className==='toolbar').childNodes[0].onclick();
  await waitForReview(async()=>(await db.settings()).token==='receiver-token');
  assert.equal(mounted.nodes.get('overlay')['aria-busy'],'true');
  fault.leaseGate=null;release();await opening;await claiming;
  assert.equal(mounted.nodes.get('pair-onboarding').hidden,true);
  assert.equal(mounted.nodes.get('sync-url').value,'https://photoswiper-sync.sidlakkoju.workers.dev');
  assert.ok(calls.some(({url,options})=>new URL(url).pathname==='/api/state'&&options.headers.Authorization==='Bearer receiver-token'));
 }finally{fault.leaseGate=null;release();await opening;await claiming;await mounted.nodes.get('close').onclick();}
});


for(const failSave of [false,true])test(`Settings pairing retains the claimed token after an in-flight 401${failSave?' and a failed save':''}`,async()=>{
 let release,started=false,claimed=false,rejectOld=false,claims=0,stored,fail=failSave;
 const values=new Map();
 const GM={getValue:async key=>values.get(key),setValue:async(key,value)=>{if(fail&&value.token==='claimed-token')throw Error('Synthetic pairing save failure');values.set(key,value);if(key==='photos-swipe-pairing')stored=value;},deleteValue:async key=>{values.delete(key);if(key==='photos-swipe-pairing')stored=undefined;}};
 const mounted=await mountedReview([item('a')],{fetch:async(url,options)=>{
  if(url.endsWith('/api/pair/claim')){claims++;claimed=true;return {ok:true,json:async()=>({token:'claimed-token'})};}
  if(rejectOld&&options.headers.Authorization==='Bearer old-token'){started=true;return new Promise(resolve=>{release=()=>resolve({ok:false,status:401});});}
  return {ok:true,json:async()=>({decisions:[],history:[],progress:{},items:[{mediaKey:'a'}]})};
 }},{url:'https://worker.example',token:'old-token'},failSave?{GM}:{});
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs');
 const db=await openReviewDatabase(mounted.environment.window.indexedDB);
 rejectOld=true;await mounted.click('keep');let pairing;
 try{
  await waitForReview(()=>started);
  mounted.nodes.get('pair-code').value='123456';pairing=mounted.nodes.get('pair-submit').onclick();
  await waitForReview(()=>claimed);
  await new Promise(resolve=>setTimeout(resolve,10));
  release();await pairing;
  if(failSave){
   assert.equal(stored,undefined);
   assert.equal(mounted.nodes.get('unpaired-banner').hidden,false);
   assert.match(mounted.nodes.get('enter-pairing-code').childNodes.at(-1).textContent,/Device claimed.*retry saving/);
   fail=false;await mounted.nodes.get('pair-submit').onclick();
   assert.equal(stored.token,'claimed-token');
   assert.deepEqual(await db.settings(),{onboardingDismissed:true});
  }else assert.deepEqual(await db.settings(),{url:'https://worker.example',token:'claimed-token',onboardingDismissed:true});
  assert.equal(claims,1);
  mounted.nodes.get('settings').onclick();
  mounted.nodes.get('settings-sheet').querySelector('header').childNodes.find(node=>node.textContent==='Done').onclick();
  assert.equal(mounted.nodes.get('settings-sheet').hidden,true);
  assert.doesNotMatch(mounted.nodes.get('status').textContent,/unpaired/i);
  assert.equal(mounted.nodes.get('unpaired-banner').hidden,true);
  assert.match(mounted.nodes.get('enter-pairing-code').childNodes.at(-1).textContent,/Device paired/);
 }finally{release?.();await pairing;await mounted.nodes.get('close').onclick();}
});

test('onboarding dismissal belongs to the GM installation and survives reopening',async()=>{
 const {createPairingStore}=await import('../lib/userscript-settings.mjs');
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs');
 const db=await openReviewDatabase(fakeIndexedDB());
 await db.saveSettings({onboardingDismissed:true});
 const installation=()=>{const values=new Map();return {getValue:async key=>values.get(key),setValue:async(key,value)=>values.set(key,value),deleteValue:async key=>values.delete(key)};};
 const GM=installation(),otherGM=installation();
 const create=GM=>createPairingStore({GM,database:async()=>db,crypto:webcrypto});
 const store=await create(GM);
 assert.equal((await store.settings()).onboardingDismissed,undefined);
 await store.saveSettings({...await store.settings(),onboardingDismissed:true});
 assert.equal((await (await create(GM)).settings()).onboardingDismissed,true);
 assert.equal((await (await create(otherGM)).settings()).onboardingDismissed,undefined);

});

test('killed owners expire and foreign release cannot replace fresh ownership',async()=>{
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs'),db=await openReviewDatabase(fakeIndexedDB());
 const actualNow=Date.now;let now=100000;Date.now=()=>now;
 try{
  await db.lease('account','killed');
  now+=LEASE_EXPIRY_MS-1;
  await assert.rejects(db.lease('account','next'),/busy in another tab/);
  now++;
  await db.lease('account','next');
  await db.lease('account','killed',true);
  await assert.rejects(db.lease('account','killed'),/busy in another tab/);
 }finally{Date.now=actualNow;}
});

test('blocked review retries each heartbeat and loads progress after a killed owner expires',async()=>{
 const timers=new Map();let timerId=0;
 const mounted=await mountedReview([item('a')],{},undefined,{setInterval:(handler,delay)=>{assert.equal(delay,LEASE_HEARTBEAT_MS);timers.set(++timerId,handler);return timerId;},clearInterval:id=>timers.delete(id)});
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs'),db=await openReviewDatabase(mounted.environment.window.indexedDB);
 const account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 await mounted.nodes.get('close').onclick();
 const actualNow=Date.now;let now=actualNow();Date.now=()=>now;
 try{
  await db.lease(account,'killed');
  await mounted.nodes.get('launcher').onclick();
  assert.match(mounted.nodes.get('status').textContent,/busy in another tab/);
  now+=LEASE_HEARTBEAT_MS;await [...timers.values()][0]();
  assert.match(mounted.nodes.get('status').textContent,/busy in another tab/);
  now+=LEASE_EXPIRY_MS-LEASE_HEARTBEAT_MS;await [...timers.values()][0]();
  assert.doesNotMatch(mounted.nodes.get('status').textContent,/busy in another tab/);
  assert.match(mounted.nodes.get('caption').textContent,/^a ·/);
  now+=LEASE_EXPIRY_MS-1;await [...timers.values()][0]();
  now+=LEASE_EXPIRY_MS-1;
  await assert.rejects(db.lease(account,'other'),/busy in another tab/);
 }finally{Date.now=actualNow;await mounted.nodes.get('close').onclick();}
});

test('hidden and pagehide release ownership and resumed pages cannot steal a fresh lease',async()=>{
 for(const lifecycle of ['hidden','pagehide']){
  const mounted=await mountedReview([item('a')]);
  const {openReviewDatabase}=await import('../lib/userscript-db.mjs'),db=await openReviewDatabase(mounted.environment.window.indexedDB);
  const account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
  if(lifecycle==='hidden'){mounted.environment.document.hidden=true;mounted.environment.document.listeners.visibilitychange();}
  else mounted.environment.window.listeners.pagehide();
  await new Promise(resolve=>setTimeout(resolve,10));
  await db.lease(account,'live');
  if(lifecycle==='hidden'){mounted.environment.document.hidden=false;mounted.environment.document.listeners.visibilitychange();await new Promise(resolve=>setTimeout(resolve,10));}
  else await mounted.environment.window.listeners.pageshow({persisted:true});
  assert.match(mounted.nodes.get('status').textContent,lifecycle==='hidden'?/^Open in another tab$/:/busy in another tab/);
  await mounted.click('keep');assert.equal((await db.read(account)).items[0].decision,null);
  await assert.rejects(db.lease(account,'third'),/busy in another tab/);
  await mounted.nodes.get('close').onclick();
 }
});

for(const interruption of ['hidden','load','refresh'])test(`blocked review retries loading after recovery is interrupted by ${interruption}`,async()=>{
 const timers=new Map();let timerId=0,digests=0,holding=false,releaseRecovery,releaseOperation;
 const recoveryGate=new Promise(resolve=>{releaseRecovery=resolve;}),operationGate=new Promise(resolve=>{releaseOperation=resolve;});
 const crypto={randomUUID:()=>webcrypto.randomUUID(),subtle:{digest:async(...args)=>{
  if(holding){
   digests++;
   if(digests===(interruption==='hidden'?2:1))await recoveryGate;
   else if(interruption!=='hidden')await operationGate;
  }
  return webcrypto.subtle.digest(...args);
 }}};
 const mounted=await mountedReview([item('a')],{crypto},undefined,{setInterval:handler=>{timers.set(++timerId,handler);return timerId;},clearInterval:id=>timers.delete(id)});
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs'),db=await openReviewDatabase(mounted.environment.window.indexedDB);
 const account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 await mounted.nodes.get('close').onclick();
 await db.lease(account,'other');await mounted.nodes.get('launcher').onclick();
 assert.match(mounted.nodes.get('status').textContent,/busy in another tab/);
 await db.save(account,{...(await db.read(account)),items:[item('recovered')]});
 await db.lease(account,'other',true);
 holding=true;
 try{
  const recovering=[...timers.values()][0]();
  await waitForReview(()=>digests===(interruption==='hidden'?2:1));
  let operation;
  if(interruption==='hidden'){
   mounted.environment.document.hidden=true;mounted.environment.document.listeners.visibilitychange();
  }else{
   operation=mounted.nodes.get(interruption).onclick();
   await waitForReview(()=>digests>=2);
  }
  releaseRecovery();await recovering;
  holding=false;releaseOperation();await operation;await mounted.settle();
  if(interruption==='hidden'){mounted.environment.document.hidden=false;mounted.environment.document.listeners.visibilitychange();await mounted.settle();}
  await [...timers.values()][0]();
  assert.doesNotMatch(mounted.nodes.get('status').textContent,/busy in another tab/);
  assert.match(mounted.nodes.get('caption').textContent,/^recovered ·/);
 }finally{holding=false;releaseRecovery();releaseOperation();mounted.environment.document.hidden=false;await mounted.nodes.get('close').onclick();}
});

for(const lifecycle of ['hidden','pagehide'])test(`${lifecycle} drains a swipe awaiting identity before releasing ownership`,async()=>{
 let holding=false,started,finish;
 const checking=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{finish=resolve;});
 const crypto={randomUUID:()=>webcrypto.randomUUID(),subtle:{digest:async(...args)=>{if(holding){started();await gate;}return webcrypto.subtle.digest(...args);}}};
 const mounted=await mountedReview([item('a')],{crypto});
 mounted.nodes.get('keep').onclick();holding=true;await checking;
 if(lifecycle==='hidden'){mounted.environment.document.hidden=true;mounted.environment.document.listeners.visibilitychange();}
 else mounted.environment.window.listeners.pagehide();
 holding=false;finish();await mounted.settle();
 assert.equal((await mounted.read()).items[0].decision,'keep');
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs'),db=await openReviewDatabase(mounted.environment.window.indexedDB);
 const account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 await db.lease(account,'other');await db.lease(account,'other',true);
 mounted.environment.document.hidden=false;await mounted.nodes.get('close').onclick();
});

test('Close cancels a busy lease recovery awaiting identity',async()=>{
 const timers=new Map();let timerId=0,holding=false,started,finish;
 const checking=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{finish=resolve;});
 const crypto={randomUUID:()=>webcrypto.randomUUID(),subtle:{digest:async(...args)=>{if(holding){started();await gate;}return webcrypto.subtle.digest(...args);}}};
 const mounted=await mountedReview([item('a')],{crypto},undefined,{setInterval:handler=>{timers.set(++timerId,handler);return timerId;},clearInterval:id=>timers.delete(id)});
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs'),db=await openReviewDatabase(mounted.environment.window.indexedDB);
 const account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 await mounted.nodes.get('close').onclick();await db.lease(account,'other');await mounted.nodes.get('launcher').onclick();await db.lease(account,'other',true);
 holding=true;const recovering=[...timers.values()][0]();await checking;
 const closing=mounted.nodes.get('close').onclick();holding=false;finish();await Promise.all([recovering,closing]);await mounted.settle();
 assert.equal(mounted.nodes.get('overlay').hidden,true);assert.equal(timers.size,0);await db.lease(account,'other');
});

for(const lifecycle of ['hidden','pagehide'])test(`${lifecycle} stops album RPCs after an in-flight mutation`,async()=>{
 const requests=[];let started,finish;
 const creating=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{finish=resolve;});
 const mounted=await mountedReview([item('a',{decision:'remove',dedupKey:'stable'})],{confirm:()=>true,fetch:async(url,options)=>{
  const id=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0][0];requests.push(id);
  if(id==='OXvT9d'){started();await gate;}
  return {ok:true,text:async()=>envelope(id,id==='Z5xsfc'?[[],null]:id==='OXvT9d'?[['album']]:[])};
 }});
 const operation=mounted.nodes.get('send').onclick();await creating;
 if(lifecycle==='hidden'){mounted.environment.document.hidden=true;mounted.environment.document.listeners.visibilitychange();}
 else mounted.environment.window.listeners.pagehide();
 const before=requests.length;finish();await operation;await mounted.settle();
 assert.equal(requests.length,before);assert.match(mounted.nodes.get('status').textContent,/Session changed/);
 mounted.environment.document.hidden=false;await mounted.nodes.get('close').onclick();
});

for(const openingStage of ['identity','lease'])for(const resumeTiming of ['after opening','during opening'])test(`visibility resumes the first open interrupted at ${openingStage} when shown ${resumeTiming}`,async()=>{
 const mounted=bundleEnvironment();
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs'),db=await openReviewDatabase(mounted.environment.window.indexedDB);
 const account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 await db.save(account,{...emptyReview(),items:[item('saved-first-open')]});
 let started,finish,holding=true,digests=0;
 const checking=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{finish=resolve;});
 mounted.environment.window.crypto={randomUUID:()=>webcrypto.randomUUID(),subtle:{digest:async(...args)=>{if(holding&&++digests===(openingStage==='identity'?1:2)){started();await gate;}return webcrypto.subtle.digest(...args);}}};
 vm.runInNewContext(await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8'),mounted.environment);
 const opening=mounted.nodes.get('launcher').onclick();await checking;
 mounted.environment.document.hidden=true;mounted.environment.document.listeners.visibilitychange();
 if(resumeTiming==='during opening'){mounted.environment.document.hidden=false;mounted.environment.document.listeners.visibilitychange();}
 holding=false;finish();await opening;
 if(resumeTiming==='after opening'){mounted.environment.document.hidden=false;mounted.environment.document.listeners.visibilitychange();}
 await waitForReview(()=>mounted.nodes.get('caption').textContent.startsWith('saved-first-open ·'));
 assert.equal(mounted.nodes.get('keep').disabled,false);
 await mounted.nodes.get('close').onclick();
});


test('automatic library loading resumes after hiding an open that already read progress',async()=>{
 const fault={},mounted=bundleEnvironment(fault);
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs'),db=await openReviewDatabase(mounted.environment.window.indexedDB);
 const account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 await db.save(account,{...emptyReview(),started:true,items:[item('saved')]});
 let finish,started,libraryCalls=0;
 const reading=new Promise(resolve=>{started=resolve;});
 fault.resumeStarted=started;fault.resumeGate=new Promise(resolve=>{finish=resolve;});
 mounted.environment.window.fetch=async(url,options)=>{
  const id=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0][0];
  if(id==='lcxiM')libraryCalls++;
  return {ok:true,text:async()=>envelope(id,[[],null])};
 };
 vm.runInNewContext(await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8'),mounted.environment);
 const opening=mounted.nodes.get('launcher').onclick();await reading;
 mounted.environment.document.hidden=true;mounted.environment.document.listeners.visibilitychange();
 finish();await opening;
 assert.equal(libraryCalls,0);
 assert.doesNotMatch(mounted.nodes.get('status').textContent,/Library loading failed/);
 fault.resumeGate=null;mounted.environment.document.hidden=false;mounted.environment.document.listeners.visibilitychange();
 await waitForReview(async()=>libraryCalls===1&&(await db.read(account)).exhausted);
 await mounted.nodes.get('close').onclick();
});

for(const overlappingLoad of [false,true])test(`showing during a pending swipe save recovers ownership with overlapping Load more ${overlappingLoad}`,async()=>{
 const timers=new Map();let timerId=0,holding=false,started,finish;
 const checking=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{finish=resolve;});
 const crypto={randomUUID:()=>webcrypto.randomUUID(),subtle:{digest:async(...args)=>{if(holding){started();await gate;}return webcrypto.subtle.digest(...args);}}};
 const mounted=await mountedReview([item('a'),item('b'),item('c')],{crypto},undefined,{setInterval:handler=>{timers.set(++timerId,handler);return timerId;},clearInterval:id=>timers.delete(id)});
 mounted.nodes.get('keep').onclick();holding=true;await checking;
 const loading=overlappingLoad?mounted.nodes.get('load').onclick():null;
 mounted.environment.document.hidden=true;mounted.environment.document.listeners.visibilitychange();
 mounted.environment.document.hidden=false;mounted.environment.document.listeners.visibilitychange();
 holding=false;finish();await loading;await mounted.settle();
 await waitForReview(()=>mounted.nodes.get('caption').textContent.startsWith('b ·')&&mounted.nodes.get('keep').disabled===false);
 await mounted.click('keep');
 assert.deepEqual((await mounted.read()).items.map(row=>row.decision),['keep','keep',null]);
 assert.equal(timers.size,1);
 mounted.nodes.get('keep').onclick();mounted.environment.window.listeners.pagehide();await mounted.settle();
 assert.deepEqual((await mounted.read()).items.map(row=>row.decision),['keep','keep','keep']);
 await mounted.nodes.get('close').onclick();
});

for(const resumeTiming of ['after request','during request'])test(`automatic library loading retries a hidden in-flight request when shown ${resumeTiming}`,async()=>{
 const mounted=bundleEnvironment();
 const {openReviewDatabase}=await import('../lib/userscript-db.mjs'),db=await openReviewDatabase(mounted.environment.window.indexedDB);
 const account=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.oPEP7c))).toString('hex');
 await db.save(account,{...emptyReview(),started:true,items:[item('saved')]});
 let finish,started,libraryCalls=0;
 const requesting=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{finish=resolve;});
 mounted.environment.window.fetch=async(url,options)=>{
  const id=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0][0];
  if(id==='lcxiM'&&++libraryCalls===1){started();await gate;}
  return {ok:true,text:async()=>envelope(id,[[],null])};
 };
 vm.runInNewContext(await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8'),mounted.environment);
 await mounted.nodes.get('launcher').onclick();await requesting;
 mounted.environment.document.hidden=true;mounted.environment.document.listeners.visibilitychange();
 if(resumeTiming==='during request'){mounted.environment.document.hidden=false;mounted.environment.document.listeners.visibilitychange();}
 finish();await new Promise(resolve=>setTimeout(resolve,10));
 assert.doesNotMatch(mounted.nodes.get('status').textContent,/Library loading failed/);
 if(resumeTiming==='after request'){mounted.environment.document.hidden=false;mounted.environment.document.listeners.visibilitychange();}
 await waitForReview(async()=>libraryCalls===2&&(await db.read(account)).exhausted);
 await mounted.nodes.get('close').onclick();await mounted.nodes.get('launcher').onclick();
 assert.equal(libraryCalls,2);
 await mounted.nodes.get('close').onclick();
});
