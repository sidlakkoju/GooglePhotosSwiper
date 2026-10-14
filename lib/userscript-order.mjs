import {reviewSwipeCount} from './userscript-core.mjs';
export const reviewOrders=[['flashbacks','Flashbacks','⤨'],['original','Timeline','◷'],['oldest','Oldest first','↑'],['largest','Largest first','▣']];
export function reviewMemories(items){
 const dated=items.map(item=>({item,time:Date.parse(item.date)})).sort((a,b)=>(a.time||0)-(b.time||0)),memories=[];
 let previous=null;
 for(const entry of dated){if(!previous||!!entry.time!==!!previous.time||entry.time-previous.time>6*3600000)memories.push([]);memories[memories.length-1].push(entry.item);previous=entry;}
 return memories;
}
export function keptEligible(item,swipes,now=Date.now()){
 const multiplier=2**Math.max(0,(item.keepCount||1)-1);
 return item.decision==='keep'&&Number.isFinite(item.lastDecisionAt)&&now-item.lastDecisionAt>=30*86400000*multiplier&&swipes-(item.lastDecisionSwipe||0)>=500*multiplier;
}
export function flashbackDeck(state,saved={},random=Math.random,now=Date.now(),focused=null,allowPartial=false){
 const previousOrder=saved.keys||[],previousKeys=new Set(previousOrder),initialSeen=new Set(saved.seen||[]),initialStarts=new Set(saved.starts||[]);
 const memories=reviewMemories(state.items.filter(item=>!item.needsPreview&&item.state!=='in_trash')),boundary=state.started&&!state.exhausted&&!allowPartial?memories[0]:null;
 const memoryOf=new Map();for(const group of memories)for(const item of group)memoryOf.set(item.mediaKey,group);
 const boundaryStarted=boundary?.some(item=>item.mediaKey===focused||initialSeen.has(item.mediaKey)||item.decision&&initialStarts.has(item.mediaKey));
 const held=new Set(boundary&&!boundaryStarted?boundary.map(item=>item.mediaKey):[]);
 const swipes=reviewSwipeCount(state),eligible=state.items.filter(item=>!held.has(item.mediaKey)&&!item.needsPreview&&item.state!=='in_trash'&&(!item.decision||(!saved.keptOff&&keptEligible(item,swipes,now)))),byKey=new Map(eligible.map(item=>[item.mediaKey,item]));
 const seen=(saved.seen||[]).filter(key=>byKey.get(key)?.decision!=='keep');
 let keys=(saved.keys||[]).filter(key=>byKey.has(key)&&!initialSeen.has(key)),known=new Set([...keys,...seen]);
 const unreviewed=eligible.filter(item=>!item.decision&&!known.has(item.mediaKey)),kept=eligible.filter(item=>item.decision==='keep'&&!known.has(item.mediaKey)).sort((a,b)=>a.lastDecisionAt-b.lastDecisionAt),remainingUnswiped=eligible.filter(item=>!item.decision).length;
 const allowance=remainingUnswiped?Math.max(0,Math.floor(remainingUnswiped/19)-keys.filter(key=>byKey.get(key)?.decision==='keep').length):kept.length;
 const selected=new Set([...unreviewed,...kept.slice(0,allowance)].map(item=>item.mediaKey));
 saved.seen=(saved.seen||[]).filter(key=>!selected.has(key)||byKey.get(key)?.decision!=='keep');
 const headMemory=keys.length?memoryOf.get(keys[0]):undefined;
 const activeMemory=memoryOf.get(focused)||(headMemory?.some(item=>item.decision&&initialStarts.has(item.mediaKey))?headMemory:null);
 const reshuffle=keys.length>0&&unreviewed.length>0;
 const fresh=memories.map(memory=>memory.filter(item=>selected.has(item.mediaKey))).filter(memory=>memory.length);
 for(let i=reshuffle?0:fresh.length-1;i>0;i--){if(!fresh[i][0].date)continue;const j=Math.floor(random()*(i+1));[fresh[i],fresh[j]]=[fresh[j],fresh[i]];}
 if(!remainingUnswiped&&!keys.length)fresh.sort((a,b)=>Math.min(...a.map(item=>item.lastDecisionAt))-Math.min(...b.map(item=>item.lastDecisionAt)));
 let keySet=new Set(keys);
 for(const memory of fresh){
  const fullMemory=memoryOf.get(memory[0].mediaKey),existing=keys.findIndex(key=>memoryOf.get(key)===fullMemory);
  if(existing>=0){const merged=fullMemory.filter(item=>keySet.has(item.mediaKey)||selected.has(item.mediaKey)).map(item=>item.mediaKey);const members=new Set(merged);keys.splice(existing,0,...merged);for(let index=keys.length-1;index>=existing+merged.length;index--)if(members.has(keys[index]))keys.splice(index,1);}
  else keys.push(...memory.map(item=>item.mediaKey));
  keySet=new Set(keys);
 }
 if(reshuffle){
  const groups=memories.map(group=>group.filter(item=>keySet.has(item.mediaKey))).filter(group=>group.length);
  for(let i=groups.length-1;i>0;i--){if(!groups[i][0].date)continue;const j=Math.floor(random()*(i+1));[groups[i],groups[j]]=[groups[j],groups[i]];}
  if(activeMemory){const index=groups.findIndex(group=>activeMemory.includes(group[0]));if(index>0)groups.unshift(...groups.splice(index,1));}
  keys=groups.flatMap(group=>group.map(item=>item.mediaKey));keySet=new Set(keys);
 }
 let startSet=new Set(saved.starts||[]);
 for(const group of memories){
  let playedStart=null;for(const item of group)if(item.decision&&startSet.has(item.mediaKey)){playedStart=item;break;}
  if(!playedStart)continue;
  const startIndex=group.indexOf(playedStart);let continuation=false;
  for(let index=0;index<startIndex;index++){const item=group[index];if(!item.decision&&keySet.has(item.mediaKey)){continuation=true;break;}}
  if(!continuation)continue;
  const members=new Set(group.map(item=>item.mediaKey));
  const ordered=group.some(item=>keySet.has(item.mediaKey)&&!previousKeys.has(item.mediaKey))?group.filter(item=>keySet.has(item.mediaKey)).map(item=>item.mediaKey):keys.filter(key=>members.has(key));
  saved.starts=saved.starts.filter(key=>key===playedStart.mediaKey||!members.has(key));startSet=new Set(saved.starts);
  const remainder=keys.filter(key=>!members.has(key));
  const insertion=activeMemory&&activeMemory!==group?remainder.findIndex(key=>!activeMemory.some(item=>item.mediaKey===key)):0;
  remainder.splice(insertion<0?remainder.length:insertion,0,...ordered);keys=remainder;keySet=new Set(keys);
 }
 const memory=focused&&memoryOf.get(focused);
 if(memory&&keySet.has(focused)){
  const members=new Set(memory.map(item=>item.mediaKey)),ordered=memory.filter(item=>keySet.has(item.mediaKey)).map(item=>item.mediaKey),index=ordered.indexOf(focused);
  const earlier=ordered.slice(0,index),remaining=keys.filter(key=>!members.has(key)),previousRemaining=previousOrder.find(key=>!members.has(key));
  keys=earlier.some(key=>!previousKeys.has(key))||earlier.length&&earlier.every(key=>previousOrder.indexOf(key)>previousOrder.indexOf(focused)&&(!previousRemaining||previousOrder.indexOf(key)<previousOrder.indexOf(previousRemaining)))?[...ordered.slice(index),...earlier,...remaining]:[...ordered.slice(index),...remaining,...earlier];
 }
 const loadedKeys=new Set(state.items.map(item=>item.mediaKey));
 saved.keys=keys;saved.seen=(saved.seen||[]).filter(key=>loadedKeys.has(key));
 const firstKey=new Map();for(const key of keys){const group=memoryOf.get(key);if(group&&!firstKey.has(group))firstKey.set(group,key);}
 const currentStarts=saved.starts||[],startsBefore=new Set(currentStarts),removed=new Set(),added=[];
 for(const group of memories){
  let start=false;for(const item of group)if(item.decision&&startsBefore.has(item.mediaKey)){start=true;break;}
  if(start)continue;
  for(const item of group)removed.add(item.mediaKey);
  const first=byKey.get(firstKey.get(group));
  if(first)added.push(first.mediaKey);
 }
 saved.starts=[...new Set([...currentStarts.filter(key=>!removed.has(key)),...added])];
 return keys.map(key=>byKey.get(key));
}
export function keptReady(state,now=Date.now()){
 const swipes=reviewSwipeCount(state);
 return state.items.filter(item=>!item.needsPreview&&item.state!=='in_trash'&&keptEligible(item,swipes,now)).sort((a,b)=>(a.lastDecisionAt||0)-(b.lastDecisionAt||0));
}
export function resurfaceKept(unreviewed,kept,every=20,start=every-1){
 if(!kept.length)return unreviewed;
 if(!unreviewed.length)return kept;
 const result=[];let next=0,index=0;
 while(index<unreviewed.length){
  if(next<kept.length&&result.length===start+next*every){result.push(kept[next++]);continue;}
  result.push(unreviewed[index++]);
 }
 return result;
}
export function nextKeptReturn(state,now=Date.now()){
 const swipes=reviewSwipeCount(state);let next=Infinity;
 for(const item of state.items){
  if(item.decision!=='keep'||item.state==='in_trash'||item.needsPreview||!Number.isFinite(item.lastDecisionAt))continue;
  const multiplier=2**Math.max(0,(item.keepCount||1)-1);
  if(swipes-(item.lastDecisionSwipe||0)<500*multiplier)continue;
  next=Math.min(next,item.lastDecisionAt+30*86400000*multiplier);
 }
 return Number.isFinite(next)?Math.max(next,now):null;
}
