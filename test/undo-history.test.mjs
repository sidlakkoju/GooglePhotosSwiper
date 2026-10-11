import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../lib/store.mjs';
import {loadUndoHistory,saveUndoHistory,validUndoHistory,undoLimit} from '../public/undo-history.js';
function tabStorage(){const data=new Map();return {getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)};}
test('tab undo history survives reload and restores fake media decisions in reverse order',()=>{
 const store=createStore(),storage=tabStorage();
 try{
  store.setSetting('account','fake');
  store.importItems(['a','b'].map(mediaKey=>({mediaKey,name:mediaKey+'.jpg',type:'photo',thumbUrl:'https://lh3.googleusercontent.com/fake'})),'fake');
  const entries=store.listItems().map((item,index)=>{
   const decision=index?'keep':'remove',result=store.decide(item.id,decision,item.revision);
   return {id:item.id,old:null,decision,revision:result.revision};
  });
  saveUndoHistory(storage,entries);
  let restored=validUndoHistory(loadUndoHistory(storage),store.listItems());
  assert.deepEqual(restored,entries);
  while(restored.length){
   const last=restored.at(-1);
   store.decide(last.id,last.old,last.revision);
   saveUndoHistory(storage,restored.slice(0,-1));
   restored=validUndoHistory(loadUndoHistory(storage),store.listItems());
  }
  assert.ok(store.listItems().every(item=>item.decision===null));
  assert.deepEqual(loadUndoHistory(storage),[]);
  assert.deepEqual(loadUndoHistory(tabStorage()),[]);
 }finally{store.close();}
});
test('restored undo rejects stale, sent, unavailable, protected and malformed entries',()=>{
 const entry={id:'a',old:null,decision:'remove',revision:1};
 const item={id:'a',decision:'remove',revision:1,state:'active'};
 for(const change of [{revision:2},{decision:'keep'},{queueSent:true},{state:'in_trash'},{cropPending:true},{generated:true}])assert.deepEqual(validUndoHistory([entry],[{...item,...change}]),[]);
 assert.deepEqual(validUndoHistory([entry],[]),[]);
 assert.deepEqual(validUndoHistory([null,{}, {...entry,old:'invalid'}],[item]),[]);
});
test('undo persistence is bounded and tolerates corrupt or unavailable browser storage',()=>{
 const storage=tabStorage(),entries=Array.from({length:undoLimit+5},(_,id)=>({id}));
 saveUndoHistory(storage,entries);
 assert.deepEqual(loadUndoHistory(storage),entries.slice(5));
 const broken={getItem:()=>'{',setItem:()=>{throw Error('unavailable');}};
 assert.deepEqual(loadUndoHistory(broken),[]);
 assert.doesNotThrow(()=>saveUndoHistory(broken,entries));
});
