const storageKey='photos-swipe:undo:v1';
export const undoLimit=100;
export function loadUndoHistory(storage){
 try{const entries=JSON.parse(storage.getItem(storageKey)||'[]');return Array.isArray(entries)?entries.slice(-undoLimit):[];}catch{return [];}
}
export function saveUndoHistory(storage,entries){
 try{storage.setItem(storageKey,JSON.stringify(entries.slice(-undoLimit)));}catch{}
}
export function validUndoHistory(entries,items){
 const current=new Map(items.map(item=>[item.id,item]));
 return entries.filter(entry=>{
  if(!entry||typeof entry.id!=='string'||![null,'keep','remove'].includes(entry.old)||!['keep','remove'].includes(entry.decision)||!Number.isInteger(entry.revision))return false;
  const item=current.get(entry.id);
  return item&&item.revision===entry.revision&&item.decision===entry.decision&&!item.queueSent&&!item.cropPending&&!item.generated&&(!item.state||item.state==='active');
 }).slice(-undoLimit);
}
