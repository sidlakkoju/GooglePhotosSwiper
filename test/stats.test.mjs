import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyReview,markReviewTrash,reconcileReviewTrash} from '../lib/userscript-core.mjs';
import {reviewSyncProgress} from '../lib/userscript-sync.mjs';
import {reviewStatistics,renderReviewStats,statsDayKey,statsDayRange,statsTicks,statsCount} from '../lib/userscript-stats.mjs';
import {demoPastDecisions} from '../lib/userscript-demo.mjs';

const day=24*3600000;
const fakeDocument=()=>{
 const element=tag=>({tagName:tag,attributes:{},childNodes:[],textContent:'',setAttribute(key,value){this.attributes[key]=value;},append(...children){this.childNodes.push(...children);},replaceChildren(...children){this.childNodes=children;}});
 return {createElement:element,createElementNS:(namespace,tag)=>element(tag),createTextNode:textContent=>({textContent,childNodes:[]})};
};
const textOf=node=>(node.textContent||'')+node.childNodes.map(textOf).join('');
const find=(node,predicate)=>predicate(node)?[node]:node.childNodes.flatMap(child=>find(child,predicate));

test('stats count kept, marked, freed and waiting items the same way the rest of the app does',()=>{
 const now=Date.parse('2026-10-15T18:00:00Z');
 const state={...emptyReview(),lifetimeFreed:0,items:[
  {mediaKey:'keep-1',decision:'keep',lastDecisionAt:now-day,size:5},
  {mediaKey:'keep-2',decision:'keep',lastDecisionAt:now,size:5},
  {mediaKey:'waiting',decision:'remove',lastDecisionAt:now,size:1000,spaceTaken:800},
  {mediaKey:'preview',decision:'remove',lastDecisionAt:now,size:50,needsPreview:true},
  {mediaKey:'free',decision:'remove',lastDecisionAt:now-2*day,size:999,takesUpSpace:false,state:'in_trash'},
  {mediaKey:'trashed',decision:'remove',lastDecisionAt:now-3*day,trashedAt:now-day,size:4000,state:'in_trash'},
  {mediaKey:'unreviewed',decision:null,size:7}
 ]};
 const stats=reviewStatistics(state,{now,timeZone:'UTC'});
 assert.equal(stats.reviewed,6);assert.equal(stats.kept,2);assert.equal(stats.trashed,4);
 assert.deepEqual(stats.freed,{bytes:4000,unknown:0});
 assert.deepEqual(stats.waiting,{count:1,bytes:800,unknown:0});
 assert.equal(stats.days.length,30);assert.equal(stats.days.at(-1).key,'2026-10-15');
 assert.deepEqual(stats.days.slice(-4).map(row=>[row.keep,row.remove]),[[0,1],[0,1],[1,0],[1,2]]);
 assert.deepEqual(stats.days.slice(-4).map(row=>row.freed),[0,0,4000,4000],'freed follows trashedAt, not the decision day');
 assert.equal(stats.days.at(-1).marked,4850);
 for(const row of stats.days)assert.ok(row.marked>=row.freed);
 const surplus=reviewStatistics({...state,lifetimeFreed:9000},{now,timeZone:'UTC'});
 assert.equal(surplus.freed.bytes,9000);assert.equal(surplus.days.at(-1).freed,9000);assert.equal(surplus.days[0].freed,5000);
 const extra=reviewStatistics({...state,lifetimeFreed:9000},{now,timeZone:'UTC',extra:[{mediaKey:'demo-past-0',decision:'remove',lastDecisionAt:now-5*day,trashedAt:now-4*day,size:100,state:'in_trash'}]});
 assert.equal(extra.freed.bytes,9100);assert.equal(extra.reviewed,7);assert.equal(extra.waiting.count,1);
 assert.deepEqual(reviewStatistics({...state,items:[{mediaKey:'u',decision:'remove',state:'in_trash'}]},{now,timeZone:'UTC'}).freed,{bytes:0,unknown:1});
});

test('decisions outside the window still count in the totals but not in the bars',()=>{
 const now=Date.parse('2026-10-15T12:00:00Z');
 const stats=reviewStatistics({items:[{mediaKey:'old',decision:'remove',lastDecisionAt:now-90*day,size:300,state:'in_trash'},{mediaKey:'nodate',decision:'keep'},{mediaKey:'future',decision:'keep',lastDecisionAt:now+3*day}]},{now,timeZone:'UTC'});
 assert.equal(stats.reviewed,3);
 assert.equal(stats.days.reduce((total,row)=>total+row.keep+row.remove,0),1);
 assert.equal(stats.days.at(-1).keep,1,'a clock running ahead lands on today');
 assert.equal(stats.days[0].freed,300);assert.equal(stats.days.at(-1).freed,300);
});

test('days bucket by the viewer’s local calendar across time zones and daylight saving changes',()=>{
 const late=Date.parse('2026-03-08T07:30:00Z');
 assert.equal(statsDayKey(late,'UTC'),'2026-03-08');
 assert.equal(statsDayKey(late,'America/Los_Angeles'),'2026-03-07');
 assert.equal(statsDayKey(late,'Asia/Kolkata'),'2026-03-08');
 assert.equal(statsDayKey(Date.parse('2026-03-08T18:45:00Z'),'Pacific/Kiritimati'),'2026-03-09');
 for(const [now,zone,first,last] of [[Date.parse('2026-03-20T12:00:00Z'),'America/New_York','2026-02-19','2026-03-20'],[Date.parse('2026-11-10T09:00:00Z'),'Europe/London','2026-10-12','2026-11-10'],[Date.parse('2026-04-10T12:00:00Z'),'Australia/Sydney','2026-03-12','2026-04-10']]){
  const keys=statsDayRange(now,30,zone);
  assert.equal(keys.length,30);assert.equal(new Set(keys).size,30);assert.equal(keys[0],first);assert.equal(keys.at(-1),last);
  for(let index=1;index<keys.length;index++)assert.equal(Date.parse(keys[index])-Date.parse(keys[index-1]),day,`${zone} ${keys[index]}`);
 }
 const now=Date.parse('2026-03-09T15:00:00Z'),zone='America/New_York';
 const before=Date.parse('2026-03-08T04:30:00Z'),after=Date.parse('2026-03-09T03:30:00Z');
 const stats=reviewStatistics({items:[{mediaKey:'a',decision:'keep',lastDecisionAt:before},{mediaKey:'b',decision:'remove',lastDecisionAt:after,size:1}]},{now,timeZone:zone});
 const counts=Object.fromEntries(stats.days.filter(row=>row.keep||row.remove).map(row=>[row.key,[row.keep,row.remove]]));
 assert.deepEqual(counts,{'2026-03-07':[1,0],'2026-03-08':[0,1]});
 const fall=reviewStatistics({items:[{mediaKey:'c',decision:'keep',lastDecisionAt:Date.parse('2026-10-25T00:30:00Z')},{mediaKey:'d',decision:'keep',lastDecisionAt:Date.parse('2026-10-25T23:30:00Z')}]},{now:Date.parse('2026-10-26T12:00:00Z'),timeZone:'Europe/London'});
 assert.deepEqual(Object.fromEntries(fall.days.filter(row=>row.keep).map(row=>[row.key,row.keep])),{'2026-10-25':2});
});

test('an empty library shows a friendly empty state instead of empty axes',()=>{
 const stats=reviewStatistics(emptyReview(),{now:Date.parse('2026-10-15T12:00:00Z'),timeZone:'UTC'});
 assert.deepEqual([stats.reviewed,stats.kept,stats.trashed,stats.freed.bytes,stats.waiting.count],[0,0,0,0,0]);
 assert.ok(stats.days.every(row=>!row.keep&&!row.remove&&!row.freed&&!row.marked));
 const document=fakeDocument(),container=document.createElement('div');
 renderReviewStats({document,container,stats});
 const text=textOf(container);
 assert.match(text,/No reviews yet/);assert.match(text,/Reviewed0/);assert.match(text,/Storage freed0 KB/);
 assert.equal(find(container,node=>node.tagName==='svg'&&node.attributes.class==='stats-plot').length,0);
});

test('charts carry text alternatives and never show media IDs or file names',()=>{
 const now=Date.parse('2026-10-15T20:00:00Z');
 const items=[{mediaKey:'AF1QipSecretKey',name:'IMG_1234.HEIC',decision:'remove',lastDecisionAt:now-day,trashedAt:now,size:2e6,state:'in_trash'},{mediaKey:'AF1QipOther',name:'IMG_9999.HEIC',decision:'keep',lastDecisionAt:now}];
 const document=fakeDocument(),container=document.createElement('div');
 renderReviewStats({document,container,stats:reviewStatistics({items},{now,timeZone:'UTC'}),width:320});
 const text=textOf(container),plots=find(container,node=>node.attributes?.class==='stats-plot');
 assert.doesNotMatch(text,/AF1Qip|IMG_\d|→|Undo/);
 assert.equal(plots.length,2);
 for(const plot of plots){assert.equal(plot.attributes.role,'img');assert.ok(plot.attributes['aria-label'].length>20);}
 assert.match(plots[0].attributes['aria-label'],/2 reviewed, 1 kept and 1 marked for Trash/);
 assert.match(plots[1].attributes['aria-label'],/freed grew from 0 KB to 2.00 MB/);
 const tables=find(container,node=>node.tagName==='table');
 assert.equal(tables.length,2);assert.match(textOf(tables[0]),/Kept.*Marked for Trash/);
 assert.equal(find(tables[0],node=>node.tagName==='tr').length,3);
});

test('axis ticks and counts stay round and compact',()=>{
 assert.deepEqual(statsTicks(0),[0]);assert.deepEqual(statsTicks(1),[0,1,2]);assert.deepEqual(statsTicks(37),[0,20,40]);assert.deepEqual(statsTicks(7),[0,5,10]);
 assert.deepEqual(statsTicks(809e6,{bytes:true}),[0,500e6,1e9]);
 assert.equal(statsCount(1284),(1284).toLocaleString());assert.match(statsCount(12345),/^12\.3\s?K$/);
});

test('confirmed Trash gets a local trashedAt that never reaches sync',async()=>{
 const state={...emptyReview(),items:[{mediaKey:'a',decision:'remove',state:'active',size:10,revision:1},{mediaKey:'b',decision:'remove',state:'active',size:20,revision:1}]};
 const marked=markReviewTrash(state,['a'],1234);
 assert.equal(marked.items[0].trashedAt,1234);assert.equal(marked.items[1].trashedAt,undefined);
 assert.equal(markReviewTrash(marked,['a'],9999).items[0].trashedAt,1234);
 const call=async operation=>operation==='trashPage'?{items:[{mediaKey:'a'},{mediaKey:'b'}],nextPageId:null}:{state:'in_trash'};
 const reconciled=await reconcileReviewTrash(marked,call,5678);
 assert.deepEqual(reconciled.items.map(item=>item.trashedAt),[1234,5678]);
 const progress=reviewSyncProgress(reconciled);
 assert.ok(progress.items.every(item=>!('trashedAt' in item)));
});

test('the demo’s past decisions are synthetic, spread over earlier days and leave nothing waiting',()=>{
 const now=Date.parse('2026-10-15T18:00:00Z'),past=demoPastDecisions(now);
 assert.deepEqual(demoPastDecisions(now),past);
 assert.ok(past.length>=100);
 assert.ok(past.every(item=>/^demo-past-\d+$/.test(item.mediaKey)&&!item.name&&!item.thumbUrl));
 const today=new Date(now);today.setHours(0,0,0,0);
 assert.ok(past.every(item=>item.lastDecisionAt<today.getTime()&&item.lastDecisionAt>today.getTime()-22*day));
 assert.ok(past.every(item=>item.decision==='keep'?item.state==='active':item.state==='in_trash'&&item.trashedAt>=item.lastDecisionAt&&item.trashedAt<today.getTime()));
 const stats=reviewStatistics(emptyReview(),{now,extra:past});
 assert.equal(stats.waiting.count,0);assert.ok(stats.kept>stats.trashed&&stats.trashed>0);
 assert.ok(stats.days.filter(row=>row.keep||row.remove).length>=10);
 assert.equal(stats.days.at(-1).keep+stats.days.at(-1).remove,0);
});
