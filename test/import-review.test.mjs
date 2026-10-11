import test from 'node:test';
import assert from 'node:assert/strict';
import {loadReviewBatch,importMessage} from '../public/import-review.js';
import {createStore} from '../lib/store.mjs';
const media=(mediaKey,extra={})=>({mediaKey,name:mediaKey+'.jpg',type:'photo',thumbUrl:'https://lh3.googleusercontent.com/test',...extra});
const reviewed=Array.from({length:50},(_,n)=>({id:'old'+n,decision:n%2?'keep':'remove',queueSent:true}));
async function run(initial,pages,options={}){let current=initial,calls=0;const flags=[];const result=await loadReviewBatch({initial,fetchPage:async restart=>{flags.push(restart);current=pages[calls++];return {count:current.count??50};},readWorkspace:async()=>current,...options});return {result,calls,flags};}
test('load skips already-reviewed overlapping pages and reports new review items rather than raw page size',async()=>{
 const fresh=Array.from({length:50},(_,n)=>({id:'new'+n,decision:null}));
 const {result,calls}=await run({items:reviewed,cursor:'old-cursor'},[{items:reviewed,cursor:'page2'},{items:reviewed,cursor:'page3'},{items:[...reviewed,...fresh],cursor:'page4'}]);
 assert.equal(calls,3);assert.equal(result.scanned,150);assert.equal(result.added,50);assert.match(importMessage(result),/50 new items to review · 150 library items checked/);assert.equal(result.workspace.items[0].decision,reviewed[0].decision);
});
test('generated copies and pending crop originals never count as new review work; end-of-library is explicit',async()=>{
 const {result}=await run({items:[],cursor:'start'},[{items:[{id:'clip',generated:true},{id:'protected',cropPending:true}],cursor:'next',count:2},{items:[{id:'clip',generated:true},{id:'protected',cropPending:true},{id:'new',decision:null}],cursor:null,exhausted:true,count:1}]);assert.equal(result.added,1);assert.equal(result.exhausted,true);assert.match(importMessage(result),/1 new item to review.*End of library/);
});
test('repeated cursors and cycles stop safely instead of reporting empty success indefinitely',async()=>{
 let f=await run({items:reviewed,cursor:'start'},[{items:reviewed,cursor:'start'}]);assert.equal(f.calls,1);assert.equal(f.result.stalled,true);assert.equal(importMessage(f.result),'No new photos or videos were loaded. Reload your Google Photos tab.');
 f=await run({items:reviewed,cursor:'start'},[{items:reviewed,cursor:'second'},{items:reviewed,cursor:'start'}]);assert.equal(f.calls,2);assert.equal(f.result.stalled,true);
});
test('an empty repeated page in a fresh workspace gives one user-facing action',async()=>{
 const {result,calls}=await run({items:[],cursor:null},[{items:[],cursor:null,count:0}]);
 assert.equal(calls,1);assert.equal(result.stalled,true);assert.equal(result.scanned,0);assert.equal(result.added,0);
 assert.equal(importMessage(result),'No new photos or videos were loaded. Reload your Google Photos tab.');
});
test('bounded scans preserve continuation and latest refresh intentionally reads only the head',async()=>{
 let f=await run({items:reviewed,cursor:'start'},[{items:reviewed,cursor:'second'},{items:reviewed,cursor:'third'}],{maxPages:2});assert.equal(f.result.limited,true);assert.match(importMessage(f.result),/Scan limit reached/);assert.equal(f.result.workspace.cursor,'third');
 f=await run({items:reviewed,cursor:'older-progress'},[{items:reviewed,cursor:'older-progress'}],{restart:true});assert.equal(f.calls,1);assert.deepEqual(f.flags,[true]);assert.equal(f.result.stalled,false);assert.match(importMessage(f.result,true),/50 recent items refreshed · 0 new/);
});
test('exhaustion does not trigger another fetch or claim old items are new',async()=>{
 const f=await run({items:reviewed,cursor:null,exhausted:true},[]);assert.equal(f.calls,0);assert.equal(f.result.added,0);assert.match(importMessage(f.result),/0 new items.*End of library/);
});
test('refresh latest preserves older cursor and exhaustion while updating metadata and decisions',()=>{
 const s=createStore();try{s.setSetting('account','account');s.importPage([media('old')],'account',{nextPageId:'older'});s.decide('account:old','keep',0);
 s.importPage([media('old',{name:'Updated'}),media('new')],'account',{refreshLatest:true,requestCursor:null,nextPageId:'head-page2'});assert.equal(s.getSetting('cursor'),'older');assert.equal(s.listItems()[0].decision,'keep');assert.equal(s.listItems()[0].name,'Updated');
 s.importPage([],'account',{requestCursor:'older',nextPageId:null});s.importPage([media('latest')],'account',{refreshLatest:true,requestCursor:null,nextPageId:'head-page2'});assert.equal(s.getSetting('cursor'),'');assert.equal(s.getSetting('exhausted'),'true');
 }finally{s.close();}
});
test('first latest refresh seeds pagination; invalid/stale/repeated pages change neither metadata nor cursor',()=>{
 const s=createStore();try{s.setSetting('account','account');s.importPage([media('first')],'account',{refreshLatest:true,requestCursor:null,nextPageId:'next'});assert.equal(s.getSetting('cursor'),'next');
 for(const progress of [{requestCursor:'stale',nextPageId:'later'},{requestCursor:'next',nextPageId:'next'},{requestCursor:'next',nextPageId:['bad']}])assert.throws(()=>s.importPage([media('bad')],'account',progress));
 assert.throws(()=>s.importPage([media('valid'),media('invalid',{thumbUrl:'https://evil.test/a'})],'account',{requestCursor:'next',nextPageId:'later'}));assert.equal(s.listItems().length,1);assert.equal(s.getSetting('cursor'),'next');
 }finally{s.close();}
});
