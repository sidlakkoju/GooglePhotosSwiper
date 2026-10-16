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

test('paginated Flashbacks build immediately, extend across years, and keep boundary memories together',async()=>{
 const {emptyReview,loadReviewPages}=await import('../lib/userscript-core.mjs');
 const rows=Array.from({length:244},(_,index)=>({mediaKey:`QA${String(index).padStart(4,'0')}`,date:new Date(Date.UTC(2008+Math.floor(index/13),0,1,0,index%13)).toISOString(),decision:null,state:'active'})).reverse();
 let state=emptyReview(),pages=0;
 const saved={},rng=random();
 await loadReviewPages({read:async()=>state,save:async next=>{
  state=next;
  const deck=flashbackDeck(state,saved,rng);assert.ok(deck.length>0);
  if(!state.exhausted){const boundary=reviewMemories(state.items)[0];assert.ok(boundary.every(item=>!deck.includes(item)));}
  if(pages>1)assert.ok(deck.length>50);
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

test('persisted played boundary memories continue before the remaining shuffled deck without a second label',()=>{
 const older=items.slice(0,4),played=items.slice(4,8).map(item=>({...item,decision:'remove'})),remaining=items.slice(8,16);
 const state={started:true,exhausted:false,items:[...played,...remaining],history:[]};
 let saved=JSON.parse(JSON.stringify({keys:[...played,...remaining].map(item=>item.mediaKey),seen:played.map(item=>item.mediaKey),starts:[played[0].mediaKey,remaining[0].mediaKey]}));
 const persisted=structuredClone(saved);
 assert.deepEqual(flashbackDeck(state,saved,()=>0).map(item=>item.mediaKey),remaining.map(item=>item.mediaKey));
 state.items.push(...older);
 state.exhausted=true;
 const expected=[...older,...remaining].map(item=>item.mediaKey);
 assert.deepEqual(flashbackDeck(state,saved,()=>0).map(item=>item.mediaKey),expected);
 assert.deepEqual(saved.starts,persisted.starts);
 assert.deepEqual(saved.seen,persisted.seen);
 saved=JSON.parse(JSON.stringify(saved));
 assert.deepEqual(flashbackDeck(state,saved,()=>0).map(item=>item.mediaKey),expected);
 assert.deepEqual(saved.starts,persisted.starts);
});

 test('kept photos previously seen in Flashbacks resurface after both cooldowns',()=>{
 const now=Date.UTC(2026,8,1),kept={...items[0],decision:'keep',lastDecisionAt:now-31*86400000,lastDecisionSwipe:0,keepCount:1},saved={keys:[],seen:[kept.mediaKey],starts:[kept.mediaKey]};
 assert.deepEqual(flashbackDeck({items:[kept],swipeCount:499},saved,()=>0,now),[]);
 assert.deepEqual(saved.seen,[kept.mediaKey]);
 assert.deepEqual(flashbackDeck({items:[kept],swipeCount:500},saved,()=>0,now),[kept]);
 assert.deepEqual(saved.seen,[]);
 });
 for(const split of [false,true])test(`legacy boundary resume repairs continuation with stripped seen entries: ${split}`,()=>{
 const older=items.slice(0,4),played=items.slice(4,8).map(item=>({...item,decision:'remove'})),remaining=items.slice(8,16),saved={keys:[...remaining,...(split?older:[])].map(item=>item.mediaKey),seen:[],starts:[played[0].mediaKey,remaining[0].mediaKey,...(split?[older[0].mediaKey]:[])]};
 const state={items:[...older,...played,...remaining],started:true,exhausted:true};
 const expected=[...older,...remaining].map(item=>item.mediaKey);
 assert.deepEqual(flashbackDeck(state,saved,()=>0).map(item=>item.mediaKey),expected);
 assert.deepEqual(saved.starts,[played[0].mediaKey,remaining[0].mediaKey]);
 assert.deepEqual(flashbackDeck(state,JSON.parse(JSON.stringify(saved)),()=>0).map(item=>item.mediaKey),expected);
 });

test('cooldown keeps preserve waiting order and seen entries outside the allowance',()=>{
 const now=Date.UTC(2026,8,1),newer={...items[8],decision:'keep',lastDecisionAt:now-90*86400000,lastDecisionSwipe:0},older={...items[0],decision:'keep',lastDecisionAt:now-40*86400000,lastDecisionSwipe:0};
 const saved={keys:[],seen:[older.mediaKey,newer.mediaKey],starts:[older.mediaKey,newer.mediaKey]};
 assert.deepEqual(flashbackDeck({items:[older,newer],swipeCount:500},structuredClone(saved),()=>0,now),[newer,older]);
 const unplayed=items.slice(16,35),limited=structuredClone(saved);
 limited.keys=[...unplayed,older,newer].map(item=>item.mediaKey);
 assert.deepEqual(flashbackDeck({items:[older,newer,...unplayed],swipeCount:500},limited,()=>0,now),[...unplayed,newer]);
 assert.deepEqual(limited.seen,[older.mediaKey]);
 assert.deepEqual(flashbackDeck({items:[older,newer,...unplayed],swipeCount:500},limited,()=>0,now),[...unplayed,newer]);
});

test('late continuation of another played memory waits for the active memory to finish',()=>{
 const older=items.slice(0,4),olderPlayed={...items[0],decision:'remove'},newer=items.slice(8,12),newerPlayed={...items[10],decision:'remove'};
 const state={items:[olderPlayed,...older.slice(1),...newer.slice(0,2),newerPlayed,newer[3]],exhausted:true};
 const saved={keys:[...older.slice(1),newer[3]].map(item=>item.mediaKey),seen:[olderPlayed.mediaKey,newerPlayed.mediaKey],starts:[olderPlayed.mediaKey,newerPlayed.mediaKey]};
 const expected=[...older.slice(1),...newer.slice(0,2),newer[3]];
 assert.deepEqual(flashbackDeck(state,saved,()=>0),expected);
 assert.deepEqual(flashbackDeck(state,structuredClone(saved),()=>0),expected);
 assert.deepEqual(saved.starts,[olderPlayed.mediaKey,newerPlayed.mediaKey]);
});

for(const source of ['failed partial load','saved first-page queue'])test(`expanded ${source} shuffles all pending memories and moves an unplayed boundary label`,()=>{
 const recent=items.slice(28,48),state={items:recent,started:true,exhausted:false},saved=source==='failed partial load'?{}:{keys:recent.map(item=>item.mediaKey),starts:[items[28].mediaKey,items[32].mediaKey,items[40].mediaKey]};
 if(source==='failed partial load')flashbackDeck(state,saved,()=>0,Date.now(),null,true);
 const originalKeys=[...saved.keys];
 state.items=items.slice(0,48);state.exhausted=true;
 const deck=flashbackDeck(state,saved,()=>0),groups=reviewMemories(state.items),runs=[];
 for(const row of deck){const group=groups.findIndex(memory=>memory.includes(row));if(runs.at(-1)?.group!==group)runs.push({group,items:[]});runs.at(-1).items.push(row);}
 assert.equal(deck.length,48);
 assert.equal(runs.length,groups.length);
 for(const run of runs)assert.deepEqual(run.items,groups[run.group]);
 assert.notDeepEqual(deck.slice(0,originalKeys.length).map(row=>row.mediaKey),originalKeys);
 assert.ok(deck.slice(0,originalKeys.length).some(row=>!originalKeys.includes(row.mediaKey)));
 assert.ok(saved.starts.includes(items[24].mediaKey));
 assert.ok(!saved.starts.includes(items[28].mediaKey));
 assert.deepEqual(new Set(saved.starts),new Set(groups.map(group=>group[0].mediaKey)));
 assert.deepEqual(flashbackDeck(state,JSON.parse(JSON.stringify(saved)),()=>.99),deck);
});

test('expanding a partial deck preserves the active memory while shuffling pending memories',()=>{
 const recent=items.slice(24,48),state={items:recent,started:true,exhausted:false},saved={};
 const initial=flashbackDeck(state,saved,()=>0,Date.now(),null,true),played=initial[0],active=reviewMemories(recent).find(group=>group.includes(played));
 saved.seen=[played.mediaKey];
 state.items=items.slice(0,48).map(row=>row===played?{...row,decision:'remove'}:row);state.exhausted=true;
 const deck=flashbackDeck(state,saved,()=>0);
 assert.deepEqual(deck.slice(0,active.length-1),active.slice(1));
 assert.ok(saved.starts.includes(played.mediaKey));
 assert.ok(!saved.starts.includes(deck[0].mediaKey));
 assert.ok(deck.slice(active.length-1,recent.length-1).some(row=>!recent.includes(row)));
 assert.deepEqual(flashbackDeck(state,structuredClone(saved),()=>.99),deck);
});

test('loading older pages preserves the shown memory and releases a complete boundary with one label',()=>{
 const state={items:items.slice(28,48),started:true,exhausted:false},saved={},rng=random();
 const initial=flashbackDeck(state,saved,rng),boundary=items.slice(24,32),shown=initial[0],active=reviewMemories(initial).find(group=>group.includes(shown));
 assert.ok(initial.length>0);
 assert.ok(boundary.every(item=>!initial.includes(item)));
 state.items=items.slice(12,48);
 const extended=flashbackDeck(state,saved,rng,Date.now(),shown.mediaKey);
 assert.deepEqual(extended.slice(0,active.length),active);
 assert.ok(extended.length>initial.length);
 assert.ok(extended.slice(active.length,initial.length).some(item=>!initial.includes(item)));
 const offset=extended.indexOf(boundary[0]);
 assert.deepEqual(extended.slice(offset,offset+boundary.length),boundary);
 assert.deepEqual(saved.starts.filter(key=>boundary.some(item=>item.mediaKey===key)),[boundary[0].mediaKey]);
 for(const item of active){saved.seen.push(item.mediaKey);state.items=state.items.map(row=>row===item?{...row,decision:'remove'}:row);}
 const next=flashbackDeck(state,saved,rng);
 assert.ok(active.every(item=>!next.includes(item)));
 assert.ok(saved.starts.includes(shown.mediaKey));
});

test('a failed later page retains the first-page deck and releases its held boundary',async()=>{
 const {emptyReview,loadReviewPages}=await import('../lib/userscript-core.mjs');
 let state=emptyReview(),calls=0,initial;
 const saved={};
 await assert.rejects(loadReviewPages({read:async()=>state,save:async next=>{state=next;initial=flashbackDeck(state,saved,()=>0);return state;},call:async()=>{
  if(calls++)throw Error('Synthetic page failure');
  return {items:items.slice(28,48),nextPageId:'synthetic-next'};
 },target:Infinity}),/Synthetic page failure/);
 assert.ok(initial.length>0);
 const shown=initial[0],deck=flashbackDeck(state,saved,()=>0,Date.now(),shown.mediaKey,true);
 assert.equal(deck[0],shown);
 assert.equal(deck.length,state.items.length);
 saved.seen.push(shown.mediaKey);state.items=state.items.map(item=>item===shown?{...item,decision:'remove'}:item);
 assert.equal(flashbackDeck(state,saved,()=>0,Date.now(),null,true).length,state.items.length-1);
});

test('kept photos resurface one in twenty outside Flashbacks and fill the deck once nothing is unreviewed',async()=>{
 const {resurfaceKept}=await import('../lib/userscript-order.mjs');
 const unreviewed=Array.from({length:45},(_,index)=>({mediaKey:`u${index}`})),kept=[{mediaKey:'k0'},{mediaKey:'k1'},{mediaKey:'k2'},{mediaKey:'k3'}];
 const merged=resurfaceKept(unreviewed,kept);
 assert.deepEqual(merged.map((item,index)=>item.mediaKey.startsWith('k')?index:null).filter(index=>index!==null),[19,39]);
 assert.equal(merged.length,47);
 assert.deepEqual(resurfaceKept([],kept),kept);
 assert.deepEqual(resurfaceKept(unreviewed,kept,20,0).slice(0,2).map(item=>item.mediaKey),['k0','u0']);
 assert.deepEqual(resurfaceKept(unreviewed,kept,20,0).map((item,index)=>item.mediaKey.startsWith('k')?index:null).filter(index=>index!==null),[0,20,40]);
 assert.equal(resurfaceKept(unreviewed,[]),unreviewed);
});

test('ready kept photos respect cooldowns and the next return date ignores photos still inside their swipe cooldown',async()=>{
 const {keptReady,nextKeptReturn,flashbackDeck}=await import('../lib/userscript-order.mjs');
 const day=86400000,now=Date.UTC(2026,9,14);
 const items=[
  {mediaKey:'old',decision:'keep',lastDecisionAt:now-60*day,lastDecisionSwipe:0,keepCount:1,state:'active'},
  {mediaKey:'older',decision:'keep',lastDecisionAt:now-90*day,lastDecisionSwipe:0,keepCount:1,state:'active'},
  {mediaKey:'recent',decision:'keep',lastDecisionAt:now-5*day,lastDecisionSwipe:10,keepCount:1,state:'active'},
  {mediaKey:'fresh-swipe',decision:'keep',lastDecisionAt:now-90*day,lastDecisionSwipe:590,keepCount:1,state:'active'},
  {mediaKey:'trashed',decision:'keep',lastDecisionAt:now-90*day,lastDecisionSwipe:0,keepCount:1,state:'in_trash'},
  {mediaKey:'u',decision:null,state:'active',lastDecisionSwipe:600}
 ];
 const state={items,swipeCount:600};
 assert.deepEqual(keptReady(state,now).map(item=>item.mediaKey),['older','old']);
 assert.equal(nextKeptReturn({items:items.filter(item=>item.mediaKey==='recent'||item.mediaKey==='u'),swipeCount:600},now),now-5*day+30*day);
 assert.equal(nextKeptReturn({items:[{mediaKey:'fresh-swipe',decision:'keep',lastDecisionAt:now-90*day,lastDecisionSwipe:590,state:'active'}],swipeCount:600},now),null);
 assert.equal(nextKeptReturn(state,now),now);
 const reviewed=items.filter(item=>item.decision);
 const on=flashbackDeck({items:reviewed,swipeCount:600,started:true,exhausted:true},{},()=>0,now).map(item=>item.mediaKey);
 const off=flashbackDeck({items:reviewed,swipeCount:600,started:true,exhausted:true},{keptOff:true},()=>0,now).map(item=>item.mediaKey);
 assert.deepEqual(on.slice().sort(),['old','older']);
 assert.deepEqual(off,[]);
});

test('building a Flashbacks deck for a 28,000-item library stays far below quadratic time',()=>{
 const now=Date.UTC(2026,9,14),large=Array.from({length:28000},(_,index)=>({mediaKey:`perf-${index}`,date:new Date(Date.UTC(2010,0,1)+index*5*3600000).toISOString(),decision:index%3===0?'keep':null,state:'active',lastDecisionAt:now-90*86400000,lastDecisionSwipe:0,keepCount:1}));
 const state={items:large,started:true,exhausted:false,swipeCount:5000},saved={};
 let started=performance.now();flashbackDeck(state,saved,()=>0.5,now,null,true);const first=performance.now()-started;
 const next={...state,items:large.map((item,index)=>index===1?{...item,decision:'keep'}:item)};
 started=performance.now();flashbackDeck(next,saved,()=>0.5,now,saved.keys[1],true);const again=performance.now()-started;
 assert.ok(first<1500,`first build ${first.toFixed(0)} ms`);assert.ok(again<1500,`rebuild ${again.toFixed(0)} ms`);
});
test('a first Flashbacks build over 30,000 items spread across thousands of memories stays fast',()=>{
 const next=random(),large=Array.from({length:30000},(_,index)=>({mediaKey:`spread-${index}`,date:new Date(Date.UTC(2009,0,1)+Math.floor(next()*6000)*86400000+Math.floor(next()*4)*3600000).toISOString(),decision:null,state:'active'}));
 assert.ok(reviewMemories(large).length>5000);
 const started=performance.now(),deck=flashbackDeck({items:large,started:true,exhausted:true},{},random(),Date.UTC(2026,9,14),null,true),elapsed=performance.now()-started;
 assert.equal(deck.length,30000);assert.ok(elapsed<1500,`first build ${elapsed.toFixed(0)} ms`);
});

test('a decision copies the item list once and keeps the local history bounded',async()=>{
 const {recordReviewDecision,reviewSwipeCount,REVIEW_HISTORY_LIMIT}=await import('../lib/userscript-core.mjs');
 const items=Array.from({length:5000},(_,index)=>({mediaKey:`bounded-${index}`,decision:null,revision:0}));
 let state={items,history:[],swipeCount:0};
 for(let index=0;index<REVIEW_HISTORY_LIMIT+25;index++)state=recordReviewDecision(state,state.items[index],index%2?'keep':'remove',1000+index);
 assert.equal(state.history.length,REVIEW_HISTORY_LIMIT);
 assert.equal(state.history.at(-1).key,`bounded-${REVIEW_HISTORY_LIMIT+24}`);
 assert.equal(reviewSwipeCount(state),REVIEW_HISTORY_LIMIT+25);
 assert.equal(state.items[REVIEW_HISTORY_LIMIT+24].lastDecisionSwipe,REVIEW_HISTORY_LIMIT+25);
 assert.equal(state.items[REVIEW_HISTORY_LIMIT+25],items[REVIEW_HISTORY_LIMIT+25]);
 assert.throws(()=>recordReviewDecision(state,{...state.items[0],decision:null},'keep'),/changed/);
});
