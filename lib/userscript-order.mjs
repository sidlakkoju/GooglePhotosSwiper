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
export function flashbackDeck(state,saved={},random=Math.random,now=Date.now(),focused=null){
 const swipes=reviewSwipeCount(state),eligible=state.items.filter(item=>!item.needsPreview&&item.state!=='in_trash'&&(!item.decision||keptEligible(item,swipes,now))),byKey=new Map(eligible.map(item=>[item.mediaKey,item]));
 let keys=(saved.keys||[]).filter(key=>byKey.has(key)&&!(saved.seen||[]).includes(key)),known=new Set([...keys,...(saved.seen||[])]),memories=reviewMemories(state.items.filter(item=>!item.needsPreview&&item.state!=='in_trash'));
 const unreviewed=eligible.filter(item=>!item.decision&&!known.has(item.mediaKey)),kept=eligible.filter(item=>item.decision==='keep'&&!known.has(item.mediaKey)).sort((a,b)=>a.lastDecisionAt-b.lastDecisionAt),remainingUnswiped=eligible.filter(item=>!item.decision).length;
 const allowance=remainingUnswiped?Math.max(0,Math.floor(remainingUnswiped/19)-keys.filter(key=>byKey.get(key)?.decision==='keep').length):kept.length;
 const selected=new Set([...unreviewed,...kept.slice(0,allowance)].map(item=>item.mediaKey));
 const fresh=memories.map(memory=>memory.filter(item=>selected.has(item.mediaKey))).filter(memory=>memory.length);
 for(let i=fresh.length-1;i>0;i--){if(!fresh[i][0].date)continue;const j=Math.floor(random()*(i+1));[fresh[i],fresh[j]]=[fresh[j],fresh[i]];}
 if(!remainingUnswiped&&!keys.length)fresh.sort((a,b)=>Math.min(...a.map(item=>item.lastDecisionAt))-Math.min(...b.map(item=>item.lastDecisionAt)));
 for(const memory of fresh){const fullMemory=memories.find(group=>group.some(item=>item.mediaKey===memory[0].mediaKey)),existing=keys.findIndex(key=>fullMemory.some(item=>item.mediaKey===key));if(existing>=0){const merged=fullMemory.filter(item=>keys.includes(item.mediaKey)||selected.has(item.mediaKey)).map(item=>item.mediaKey);const members=new Set(merged);keys.splice(existing,0,...merged);for(let index=keys.length-1;index>=existing+merged.length;index--)if(members.has(keys[index]))keys.splice(index,1);}else keys.push(...memory.map(item=>item.mediaKey));}

 const memory=focused&&memories.find(group=>group.some(item=>item.mediaKey===focused));
 if(memory&&keys.includes(focused)){
  const members=new Set(memory.map(item=>item.mediaKey)),ordered=memory.filter(item=>keys.includes(item.mediaKey)).map(item=>item.mediaKey),index=ordered.indexOf(focused);
  keys=[...ordered.slice(index),...keys.filter(key=>!members.has(key)),...ordered.slice(0,index)];
 }
 saved.keys=keys;saved.seen=(saved.seen||[]).filter(key=>byKey.has(key));
 saved.starts=[...new Set([...(saved.starts||[]),...memories.map(memory=>memory.find(item=>keys.includes(item.mediaKey)&&!known.has(item.mediaKey))?.mediaKey).filter(Boolean)])];
 return keys.map(key=>byKey.get(key));
}
