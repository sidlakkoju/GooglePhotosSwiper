import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../lib/store.mjs';
import {pending,removalQueue,albumCandidates,storageTotals} from '../public/model.js';
const media=(mediaKey,size=1000,extra={})=>({mediaKey,name:mediaKey+'.jpg',type:'photo',thumbUrl:'https://lh3.googleusercontent.com/test',size,...extra});
const decisions=s=>Object.fromEntries(s.listItems().map(i=>[i.id,i.decision]));
function setup(){const s=createStore();s.setSetting('account','test');return s;}
test('queue clears only on full verification; decisions persist and queue storage clears with it',()=>{
 const s=setup();try{s.importItems([media('a'),media('b',2000),media('next')],'test');s.decide('test:a','remove',0);s.decide('test:b','remove',0);
 const j=s.createJob(['test:a','test:b']);s.progressJob(j.id,{status:'running',albumKey:'album',confirmed:['a']});s.progressJob(j.id,{status:'failed',error:'interrupted'});
 assert.equal(removalQueue(s.listItems(),decisions(s)).length,2);assert.equal(s.storageSummary().selected.bytes,3000);
 s.retryJob(j.id);s.progressJob(j.id,{status:'completed',confirmed:['a','b']});assert.equal(removalQueue(s.listItems(),decisions(s)).length,0);
 assert.deepEqual(pending(s.listItems(),decisions(s)).map(i=>i.mediaKey),['next']);assert.equal(s.storageSummary().selected.bytes,0);
 assert.equal(s.storageSummary().deleted.bytes,0);assert.equal(s.listItems()[0].decision,'remove');
 const a=s.listItems()[0];s.reconcile([{id:a.id,revision:a.revision,state:'active',inAlbum:false}]);assert.equal(removalQueue(s.listItems(),decisions(s)).length,0);
 assert.deepEqual(albumCandidates(s.listItems(),decisions(s)),[]);
 }finally{s.close();}
});
test('queue clearance survives restart, reimport and a missing album',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'core-review-'));let s;try{const path=join(dir,'db.sqlite');s=createStore(path);s.setSetting('account','test');s.importItems([media('a')],'test');s.decide('test:a','remove',0);const j=s.createJob(['test:a']);s.progressJob(j.id,{status:'completed',albumKey:'album',confirmed:['a']});s.close();s=createStore(path);s.importItems([media('a')],'test');assert.equal(removalQueue(s.listItems(),decisions(s)).length,0);assert.equal(s.listItems()[0].decision,'remove');const a=s.listItems()[0];s.reconcile([{id:a.id,revision:a.revision,state:'unknown',inAlbum:null}],{albumUnavailable:true,albumKey:'album'});assert.equal(removalQueue(s.listItems(),decisions(s)).length,0);}finally{s?.close();await rm(dir,{recursive:true,force:true});}
});
test('queue storage follows swipe/undo, excludes sent and trashed items, and retains a separate Trash estimate',()=>{
 const s=setup();try{s.importItems([media('a',1000,{spaceTaken:600}),media('free',2000,{takesUpSpace:false}),media('unknown',null),media('later',3000)],'test');
 for(const id of ['a','free','unknown'])s.decide('test:'+id,'remove',0);const a=s.listItems()[0];s.reconcile([{id:a.id,revision:a.revision,state:'in_trash',inAlbum:false}]);
 assert.deepEqual(s.storageSummary().selected,{bytes:0,unknown:1});assert.deepEqual(s.storageSummary().deleted,{bytes:600,unknown:0});
 const items=s.listItems(),d=decisions(s);d['test:later']='remove';assert.deepEqual(storageTotals(items,d,s.storageSummary()).selected,{bytes:3000,unknown:1});delete d['test:later'];assert.deepEqual(storageTotals(items,d,s.storageSummary()).selected,{bytes:0,unknown:1});
 }finally{s.close();}
});
test('saved pending crop originals stay quarantined; crop data and generated exclusions remain intact',()=>{
 const s=setup();try{s.importItems([media('source'),media('ordinary'),media('generated')],'test');s.db.prepare('INSERT INTO trim_jobs VALUES (?,?,?,?,?,?,?)').run('saved','test','test:source','failed',JSON.stringify({previousDecision:null}),1,1);s.db.prepare('INSERT INTO generated_clips VALUES (?,?,?,?,?)').run('test','done','generated.jpg','generated',1);s.decide('test:ordinary','remove',0);s.db.prepare("UPDATE items SET decision='remove' WHERE id='test:source'").run();s.importItems([media('generated')],'test');
 assert.deepEqual(removalQueue(s.listItems(),decisions(s)).map(i=>i.mediaKey),['ordinary']);assert.equal(s.storageSummary().selected.bytes,1000);assert.deepEqual(pending(s.listItems(),{}).map(i=>i.mediaKey),['ordinary']);assert.throws(()=>s.createJob(['test:source']),/saved crop/);assert.equal(s.db.prepare('SELECT status FROM trim_jobs').get().status,'failed');
 }finally{s.close();}
});

test('legacy completed batches migrate out of the queue, including previously trashed originals',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'legacy-queue-'));let s;try{const path=join(dir,'db.sqlite');s=createStore(path);s.setSetting('account','test');s.importItems([media('sent'),media('partial')],'test');for(const i of s.listItems())s.decide(i.id,'remove',0);const j=s.createJob(['test:sent']);s.progressJob(j.id,{status:'completed',albumKey:'album',confirmed:['sent']});const item=s.listItems().find(i=>i.mediaKey==='sent');s.reconcile([{id:item.id,revision:item.revision,state:'in_trash',inAlbum:false}]);s.db.prepare('UPDATE items SET queue_sent=0').run();s.db.prepare("DELETE FROM settings WHERE key='coreQueueMigration'").run();s.close();s=createStore(path);s.importItems([media('sent')],'test');assert.deepEqual(removalQueue(s.listItems(),decisions(s)).map(i=>i.mediaKey),['partial']);assert.equal(s.listItems().find(i=>i.mediaKey==='sent').decision,'remove');}finally{s?.close();await rm(dir,{recursive:true,force:true});}
});

test('empty removal queue has zero savings even when sent and deleted history is large',()=>{
 const items=[{id:'sent',queueSent:true,size:600000000},{id:'protected',cropPending:true,size:40000000},{id:'kept',size:100000000}];
 const decisions={sent:'remove',protected:'remove',kept:'keep'};
 const totals=storageTotals(items,decisions,{deleted:{bytes:388000000,unknown:0}});
 assert.deepEqual(removalQueue(items,decisions),[]);assert.deepEqual(totals.selected,{bytes:0,unknown:0});assert.equal(totals.deleted.bytes,388000000);
});
