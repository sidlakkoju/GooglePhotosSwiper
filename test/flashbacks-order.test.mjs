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
