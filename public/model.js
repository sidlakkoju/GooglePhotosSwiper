export function pending(items, decisions, filter = 'all', sort = 'original') {
  const result = items.filter(i => !i.generated&&!i.cropPending&&!decisions[i.id] && (filter === 'all' || i.type === filter));
  if (sort === 'largest') result.sort((a, b) => (b.size || 0) - (a.size || 0));
  if (sort === 'oldest') result.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  return result;
}
export function summarize(items, decisions) {
  const kept = items.filter(i => decisions[i.id] === 'keep');
  const removed = items.filter(i => decisions[i.id] === 'remove');
  return { kept, removed, reviewed: kept.length + removed.length, bytes: removed.reduce((sum, i) => sum + (i.size || 0), 0), unknown: removed.filter(i => !i.size).length };
}
export function albumCandidates(items, decisions) {
  return items.filter(i => decisions[i.id] === 'remove' && !i.queueSent && !i.albumKey && !i.cropPending);
}
export function formatBytes(n) { return n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`; }

// A sent batch stays reviewed but is no longer in the working queue.
export function removalQueue(items,decisions){return items.filter(i=>decisions[i.id]==='remove'&&!i.queueSent&&!i.cropPending);}
export function storageTotals(items,decisions,persisted){
 const amount=i=>i.takesUpSpace===false?0:i.spaceTaken??i.size;
 const total=list=>list.reduce((out,i)=>{const value=amount(i);if(Number.isFinite(value)&&value>=0)out.bytes+=value;else out.unknown++;return out;},{bytes:0,unknown:0});
 // The selected counter uses exactly the same membership as the visible queue.
 const selected=total(removalQueue(items,decisions));
 const deleted=persisted?.deleted||{bytes:0,unknown:0};
 return {selected,deleted};
}
