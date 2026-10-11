import {pending} from './model.js';
const reviewable=w=>pending(w.items||[],Object.fromEntries((w.items||[]).map(i=>[i.id,i.decision])));
// Pages can contain already-reviewed items after a rescan or a changing library.
// Advance until useful new review items arrive; never equate page size with new work.
export async function loadReviewBatch({initial,fetchPage,readWorkspace,progress=()=>{},restart=false,target=50,maxPages=12}){
 const before=new Set(reviewable(initial).map(i=>i.id)),seen=new Set(initial.cursor?[initial.cursor]:[]),warnings=new Set();
 let workspace=initial,pages=0,scanned=0,added=0,stalled=false;
 if(!restart&&initial.exhausted)return {workspace,pages,scanned,added,exhausted:true,stalled,warnings:[]};
 while(pages<maxPages){
  progress({pages,scanned,added});const page=await fetchPage(restart&&pages===0);pages++;scanned+=page.count||0;if(page.warning)warnings.add(page.warning);
  workspace=await readWorkspace();added=reviewable(workspace).filter(i=>!before.has(i.id)).length;
  if(restart||workspace.exhausted||added>=target)break;
  if(!workspace.cursor||seen.has(workspace.cursor)){stalled=true;break;}seen.add(workspace.cursor);
 }
 return {workspace,pages,scanned,added,exhausted:!!workspace.exhausted,stalled,limited:!restart&&!workspace.exhausted&&!stalled&&added<target&&pages===maxPages,warnings:[...warnings]};
}
export function importMessage(result,restart=false){
 let message;
 if(result.stalled&&result.added===0)message='No new photos or videos were loaded. Reload your Google Photos tab.';
 else{
 message=restart?`${result.scanned} recent items refreshed · ${result.added} new items to review`:`${result.added} new item${result.added===1?'':'s'} to review · ${result.scanned} library items checked`;
 if(result.exhausted)message+=' · End of library';
 if(result.stalled)message+='. Reload your Google Photos tab.';
 if(result.limited)message+=' · Scan limit reached; Load more continues from here';
 }
 if(result.warnings.length)message+=(message.endsWith('.')?' ':'. ')+result.warnings.join(' ');
 return message;
}
