import {reviewSwipeCount} from './userscript-core.mjs';
export const reviewOrders=[['flashbacks','Flashbacks','⤨'],['original','Timeline','◷'],['oldest','Oldest first','↑'],['largest','Largest first','▣']];
export function reviewMemories(items){
 const dated=[...items].sort((a,b)=>(Date.parse(a.date)||0)-(Date.parse(b.date)||0)),memories=[];
 for(const item of dated){const previous=memories.at(-1)?.at(-1);if(!previous||!!Date.parse(item.date)!==!!Date.parse(previous.date)||Date.parse(item.date)-Date.parse(previous.date)>6*3600000)memories.push([]);memories.at(-1).push(item);}
 return memories;
}
export function keptEligible(item,swipes,now=Date.now()){
 const multiplier=2**Math.max(0,(item.keepCount||1)-1);
 return item.decision==='keep'&&Number.isFinite(item.lastDecisionAt)&&now-item.lastDecisionAt>=30*86400000*multiplier&&swipes-(item.lastDecisionSwipe||0)>=500*multiplier;
}
export function flashbackDeck(state,saved={},random=Math.random,now=Date.now(),focused=null,allowPartial=false){
 const previousKeys=new Set(saved.keys||[]);
 const memories=reviewMemories(state.items.filter(item=>!item.needsPreview&&item.state!=='in_trash')),boundary=state.started&&!state.exhausted&&!allowPartial?memories[0]:null;
 const boundaryStarted=boundary?.some(item=>item.mediaKey===focused||(saved.seen||[]).includes(item.mediaKey)||item.decision&&(saved.starts||[]).includes(item.mediaKey));
 const held=new Set(boundary&&!boundaryStarted?boundary.map(item=>item.mediaKey):[]);
 const swipes=reviewSwipeCount(state),eligible=state.items.filter(item=>!held.has(item.mediaKey)&&!item.needsPreview&&item.state!=='in_trash'&&(!item.decision||keptEligible(item,swipes,now))),byKey=new Map(eligible.map(item=>[item.mediaKey,item]));
 const seen=(saved.seen||[]).filter(key=>byKey.get(key)?.decision!=='keep');
 let keys=(saved.keys||[]).filter(key=>byKey.has(key)&&!(saved.seen||[]).includes(key)),known=new Set([...keys,...seen]);
 const unreviewed=eligible.filter(item=>!item.decision&&!known.has(item.mediaKey)),kept=eligible.filter(item=>item.decision==='keep'&&!known.has(item.mediaKey)).sort((a,b)=>a.lastDecisionAt-b.lastDecisionAt),remainingUnswiped=eligible.filter(item=>!item.decision).length;
 const allowance=remainingUnswiped?Math.max(0,Math.floor(remainingUnswiped/19)-keys.filter(key=>byKey.get(key)?.decision==='keep').length):kept.length;
 const selected=new Set([...unreviewed,...kept.slice(0,allowance)].map(item=>item.mediaKey));
 saved.seen=(saved.seen||[]).filter(key=>!selected.has(key)||byKey.get(key)?.decision!=='keep');
 const headMemory=memories.find(group=>group.some(item=>item.mediaKey===keys[0]));
 const activeMemory=memories.find(group=>group.some(item=>item.mediaKey===focused))||(headMemory?.some(item=>item.decision&&(saved.starts||[]).includes(item.mediaKey))?headMemory:null);
 const reshuffle=keys.length>0&&unreviewed.length>0;
 const fresh=memories.map(memory=>memory.filter(item=>selected.has(item.mediaKey))).filter(memory=>memory.length);
 for(let i=reshuffle?0:fresh.length-1;i>0;i--){if(!fresh[i][0].date)continue;const j=Math.floor(random()*(i+1));[fresh[i],fresh[j]]=[fresh[j],fresh[i]];}
 if(!remainingUnswiped&&!keys.length)fresh.sort((a,b)=>Math.min(...a.map(item=>item.lastDecisionAt))-Math.min(...b.map(item=>item.lastDecisionAt)));
 for(const memory of fresh){const fullMemory=memories.find(group=>group.some(item=>item.mediaKey===memory[0].mediaKey)),existing=keys.findIndex(key=>fullMemory.some(item=>item.mediaKey===key));if(existing>=0){const merged=fullMemory.filter(item=>keys.includes(item.mediaKey)||selected.has(item.mediaKey)).map(item=>item.mediaKey);const members=new Set(merged);keys.splice(existing,0,...merged);for(let index=keys.length-1;index>=existing+merged.length;index--)if(members.has(keys[index]))keys.splice(index,1);}else keys.push(...memory.map(item=>item.mediaKey));}
 if(reshuffle){
  const pending=new Set(keys),groups=memories.map(group=>group.filter(item=>pending.has(item.mediaKey))).filter(group=>group.length);
  for(let i=groups.length-1;i>0;i--){if(!groups[i][0].date)continue;const j=Math.floor(random()*(i+1));[groups[i],groups[j]]=[groups[j],groups[i]];}
  if(activeMemory){const index=groups.findIndex(group=>activeMemory.includes(group[0]));if(index>0)groups.unshift(...groups.splice(index,1));}
  keys=groups.flatMap(group=>group.map(item=>item.mediaKey));
 }

 for(const group of memories){
  const members=new Set(group.map(item=>item.mediaKey)),ordered=group.some(item=>keys.includes(item.mediaKey)&&!previousKeys.has(item.mediaKey))?group.filter(item=>keys.includes(item.mediaKey)).map(item=>item.mediaKey):keys.filter(key=>members.has(key));
  const playedStart=group.find(item=>item.decision&&(saved.starts||[]).includes(item.mediaKey));
  const continuation=playedStart&&group.some(item=>!item.decision&&keys.includes(item.mediaKey)&&group.indexOf(item)<group.indexOf(playedStart));
  if(!continuation)continue;
  saved.starts=saved.starts.filter(key=>key===playedStart.mediaKey||!members.has(key));
  const remainder=keys.filter(key=>!members.has(key));
  const insertion=activeMemory&&activeMemory!==group?remainder.findIndex(key=>!activeMemory.some(item=>item.mediaKey===key)):0;
  remainder.splice(insertion<0?remainder.length:insertion,0,...ordered);keys=remainder;
 }
 const memory=focused&&memories.find(group=>group.some(item=>item.mediaKey===focused));
 if(memory&&keys.includes(focused)){
  const members=new Set(memory.map(item=>item.mediaKey)),ordered=memory.filter(item=>keys.includes(item.mediaKey)).map(item=>item.mediaKey),index=ordered.indexOf(focused);
  const earlier=ordered.slice(0,index),remaining=keys.filter(key=>!members.has(key));
  keys=earlier.some(key=>!previousKeys.has(key))||earlier.length&&earlier.every(key=>keys.indexOf(key)>keys.indexOf(focused)&&(!remaining.length||keys.indexOf(key)<keys.indexOf(remaining[0])))?[...ordered.slice(index),...earlier,...remaining]:[...ordered.slice(index),...remaining,...earlier];
 }
 const loadedKeys=new Set(state.items.map(item=>item.mediaKey));
 saved.keys=keys;saved.seen=(saved.seen||[]).filter(key=>loadedKeys.has(key));
 for(const group of memories){
  const members=new Set(group.map(item=>item.mediaKey)),start=group.find(item=>item.decision&&(saved.starts||[]).includes(item.mediaKey));
  if(start)continue;
  const first=byKey.get(keys.find(key=>members.has(key)));
  saved.starts=(saved.starts||[]).filter(key=>!members.has(key));
  if(first)saved.starts.push(first.mediaKey);
 }
 saved.starts=[...new Set(saved.starts)];
 return keys.map(key=>byKey.get(key));
}
