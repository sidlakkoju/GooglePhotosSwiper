import test from 'node:test';
import assert from 'node:assert/strict';
import {flashbackDeck,reviewMemories,keptEligible,reviewOrders} from '../lib/userscript-order.mjs';
const random=()=>{let seed=248;return ()=>((seed=(seed*1664525+1013904223)>>>0)/2**32);};
const items=Array.from({length:320},(_,index)=>({mediaKey:`synthetic-${index}`,date:new Date(Date.UTC(2000+Math.floor(index/8),1,10,0,index%8)).toISOString(),decision:null,state:'active',type:index%3?'photo':'video'}));
test('320 synthetic items form unbroken chronological memories in a shuffled timeline',()=>{
 const state={items,history:[]},saved={},deck=flashbackDeck(state,saved,random()),groups=reviewMemories(items),membership=new Map(groups.flatMap((group,index)=>group.map(item=>[item.mediaKey,index]))),runs=[];
 for(const item of deck){const memory=membership.get(item.mediaKey);if(runs.at(-1)?.memory!==memory)runs.push({memory,items:[]});runs.at(-1).items.push(item);}
 assert.equal(deck.length,320);assert.equal(runs.length,40);assert.equal(new Set(runs.map(run=>run.memory)).size,40);
 for(const run of runs)assert.deepEqual(run.items,groups[run.memory]);
 assert.notDeepEqual(runs.map(run=>run.memory),groups.map((_,index)=>index));assert.ok(runs.some((run,index)=>index&&Math.abs(run.memory-runs[index-1].memory)>10));
 assert.deepEqual(saved.starts,runs.map(run=>run.items[0].mediaKey).sort((a,b)=>membership.get(a)-membership.get(b)));
});
test('serialized mid-memory resume preserves the remainder and its first-card label',()=>{
 let state={items,history:[]},saved={},deck=flashbackDeck(state,saved,random());
 const first=deck[0].mediaKey,consumed=deck.slice(0,3).map(item=>item.mediaKey),expected=deck.slice(3).map(item=>item.mediaKey);
 state={...state,items:items.map(item=>consumed.includes(item.mediaKey)?{...item,decision:'remove'}:item)};
 saved=JSON.parse(JSON.stringify(saved));const resumed=flashbackDeck(state,saved,()=>0);
 assert.deepEqual(resumed.map(item=>item.mediaKey),expected);assert.ok(saved.starts.includes(first));assert.ok(!saved.starts.includes(resumed[0].mediaKey));
});
test('kept resurfacing respects both cooldowns, doubling, and queued or trashed exclusions',()=>{
 const now=Date.UTC(2026,1,1),kept={mediaKey:'synthetic-kept',decision:'keep',state:'active',lastDecisionAt:now-31*86400000,lastDecisionSwipe:0,keepCount:1};
 assert.equal(keptEligible(kept,500,now),true);assert.equal(keptEligible(kept,499,now),false);assert.equal(keptEligible({...kept,lastDecisionAt:now-29*86400000},500,now),false);assert.equal(keptEligible({...kept,keepCount:2},1000,now),false);
 const state={items:[...items,...Array.from({length:30},(_,index)=>({...kept,mediaKey:`synthetic-kept-${index}`})),{...kept,mediaKey:'synthetic-trash',state:'in_trash'},{...kept,mediaKey:'synthetic-queue',decision:'remove'}],history:Array(500).fill({})},deck=flashbackDeck(state,{},random(),now);
 const resurfaced=deck.filter(item=>item.decision==='keep');assert.ok(resurfaced.length>0);assert.ok(resurfaced.length/deck.length<=.05);assert.ok(!deck.some(item=>['synthetic-trash','synthetic-queue'].includes(item.mediaKey)));
 assert.deepEqual(flashbackDeck({items:[kept],history:Array(500).fill({})},{},random(),now),[kept]);assert.deepEqual(flashbackDeck({items:[kept],history:[]},{},random(),now),[]);
});
test('approved order names and cycle are stable',()=>assert.deepEqual(reviewOrders.map(([value,name])=>[value,name]),[['flashbacks','Flashbacks'],['original','Timeline'],['oldest','Oldest first'],['largest','Largest first']]));

test('large libraries retain swipe counts and apply decisions without argument overflow',async()=>{
 const {reviewSwipeCount,recordReviewDecision}=await import('../lib/userscript-core.mjs');
 const items=Array.from({length:200000},(_,index)=>({mediaKey:`large-${index}`,decision:null,revision:0,lastDecisionSwipe:index===199999?250000:0}));
 const state={items,history:[],swipeCount:10};
 assert.equal(reviewSwipeCount(state),250000);
 const next=recordReviewDecision(state,items[0],'keep',123);
 assert.equal(next.swipeCount,250001);
 assert.equal(next.items[0].decision,'keep');
 assert.equal(next.items[0].lastDecisionSwipe,250001);
 assert.equal(next.history.length,1);
});

test('switching into Flashbacks finishes the focused memory before returning to earlier photos',()=>{
 const state={items:items.slice(0,16),history:[]},saved={keys:items.slice(0,16).map(item=>item.mediaKey)};
 const expected=[...items.slice(2,8),...items.slice(8,16),...items.slice(0,2)].map(item=>item.mediaKey);
 assert.deepEqual(flashbackDeck(state,saved,()=>0,Date.now(),items[2].mediaKey).map(item=>item.mediaKey),expected);
 const resumed=JSON.parse(JSON.stringify(saved));
 resumed.seen=[items[2].mediaKey];
 assert.deepEqual(flashbackDeck(state,resumed,()=>0).map(item=>item.mediaKey),expected.slice(1));
 assert.equal(new Set(resumed.keys).size,15);
});

test('paginated Flashbacks wait for the whole timeline and keep boundary memories together',async()=>{
 const {emptyReview,loadReviewPages}=await import('../lib/userscript-core.mjs');
 const rows=Array.from({length:244},(_,index)=>({mediaKey:`QA${String(index).padStart(4,'0')}`,date:new Date(Date.UTC(2008+Math.floor(index/13),0,1,0,index%13)).toISOString(),decision:null,state:'active'})).reverse();
 let state=emptyReview(),pages=0;
 const saved={},rng=random();
 await loadReviewPages({read:async()=>state,save:async next=>{
  state=next;
  if(!state.exhausted){assert.deepEqual(flashbackDeck(state,saved,rng),[]);assert.deepEqual(saved,{});}
  return state;
 },call:async(operation,{cursor})=>{
  assert.equal(cursor,pages?String(pages*50):null);
  const offset=pages++*50;
  return {items:rows.slice(offset,offset+50),nextPageId:offset+50<rows.length?String(offset+50):null};
 },target:Infinity});
 assert.equal(pages,5);
 const groups=reviewMemories(state.items),deck=flashbackDeck(state,saved,rng),membership=new Map(groups.flatMap((group,index)=>group.map(row=>[row.mediaKey,index]))),runs=[];
 for(const row of deck){const memory=membership.get(row.mediaKey);if(runs.at(-1)?.memory!==memory)runs.push({memory,items:[]});runs.at(-1).items.push(row);}
 assert.equal(deck.length,244);assert.equal(runs.length,groups.length);
 for(const run of runs)assert.deepEqual(run.items,groups[run.memory]);
 assert.ok(deck.slice(0,50).some(row=>!rows.slice(0,50).some(loaded=>loaded.mediaKey===row.mediaKey)));
 assert.equal(saved.starts.length,groups.length);
 const consumed=deck.slice(0,50).map(row=>row.mediaKey);
 saved.seen=consumed;
 state={...state,items:state.items.map(row=>consumed.includes(row.mediaKey)?{...row,decision:'remove'}:row)};
 assert.deepEqual(flashbackDeck(state,JSON.parse(JSON.stringify(saved)),()=>0).map(row=>row.mediaKey),deck.slice(50).map(row=>row.mediaKey));
});
