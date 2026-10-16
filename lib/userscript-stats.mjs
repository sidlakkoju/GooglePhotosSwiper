import {reviewStorage} from './userscript-core.mjs';
import {formatStorageBytes} from './userscript-counter.mjs';
const statsFormatters=new Map();
export function statsDayKey(time,timeZone) {
 const id=timeZone||'';
 if(!statsFormatters.has(id))statsFormatters.set(id,new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}));
 const parts=Object.fromEntries(statsFormatters.get(id).formatToParts(new Date(time)).map(part=>[part.type,part.value]));
 return `${parts.year}-${parts.month}-${parts.day}`;
}
export function statsDayRange(now,count=30,timeZone) {
 const [year,month,day]=statsDayKey(now,timeZone).split('-').map(Number);
 return Array.from({length:count},(_,index)=>new Date(Date.UTC(year,month-1,day-(count-1-index))).toISOString().slice(0,10));
}
const statsBytes=item=>reviewStorage([item]).bytes;
export function reviewStatistics(state,{now=Date.now(),timeZone,extra=[],days=30}={}) {
 const keys=statsDayRange(now,days,timeZone),index=new Map(keys.map((key,position)=>[key,position]));
 const rows=keys.map(key=>({key,keep:0,remove:0,freed:0,marked:0}));
 const slot=time=>{if(!Number.isFinite(time))return -1;const key=statsDayKey(time,timeZone);if(key<keys[0])return -1;return key>keys.at(-1)?keys.length-1:index.get(key);};
 let kept=0,trashed=0,markedInWindow=0,freedInWindow=0;
 const realTrashed=[],extraTrashed=[],marked=[],waiting=[];
 const visit=(item,synthetic)=>{
  if(item.decision!=='keep'&&item.decision!=='remove')return;
  const day=slot(item.lastDecisionAt);
  if(item.decision==='keep'){kept++;if(day>=0)rows[day].keep++;return;}
  trashed++;marked.push(item);if(day>=0)rows[day].remove++;
  const bytes=statsBytes(item);if(day>=0){rows[day].marked+=bytes;markedInWindow+=bytes;}
  if(item.state==='in_trash'){(synthetic?extraTrashed:realTrashed).push(item);const freedDay=slot(item.trashedAt??item.lastDecisionAt);if(freedDay>=0){rows[freedDay].freed+=bytes;freedInWindow+=bytes;}}
  else if(!item.needsPreview)waiting.push(item);
 };
 for(const item of state.items||[])visit(item,false);
 for(const item of extra)visit(item,true);
 const realStorage=reviewStorage(realTrashed),surplus=Math.max(0,(state.lifetimeFreed||0)-realStorage.bytes);
 const freed={bytes:realStorage.bytes+surplus+reviewStorage(extraTrashed).bytes,unknown:surplus?0:realStorage.unknown+reviewStorage(extraTrashed).unknown};
 const markedTotal=reviewStorage(marked).bytes+surplus,waitingStorage=reviewStorage(waiting);
 let freedRunning=freed.bytes-freedInWindow,markedRunning=markedTotal-markedInWindow;
 for(const row of rows){freedRunning+=row.freed;markedRunning+=row.marked;row.freed=freedRunning;row.marked=Math.max(markedRunning,freedRunning);}
 return {reviewed:kept+trashed,kept,trashed,freed,marked:{bytes:markedTotal},waiting:{count:waiting.length,bytes:waitingStorage.bytes,unknown:waitingStorage.unknown},days:rows};
}
export function statsDayLabel(key) {
 return new Date(`${key}T00:00:00Z`).toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'});
}
export function statsCount(value) {
 return value>=10000?new Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:1}).format(value):value.toLocaleString();
}
function statsNiceStep(value) {
 const power=10**Math.floor(Math.log10(value)),fraction=value/power;
 return (fraction<=1?1:fraction<=2?2:fraction<=2.5?2.5:fraction<=5?5:10)*power;
}
export function statsTicks(max,{bytes=false}={}) {
 if(!(max>0))return [0];
 let step=statsNiceStep(max/2);
 if(!bytes)step=Math.max(1,Math.ceil(step));
 return [0,step,step*2];
}
export function reviewStatsSummary(stats) {
 const window=stats.days.reduce((total,day)=>({keep:total.keep+day.keep,remove:total.remove+day.remove}),{keep:0,remove:0});
 const busiest=stats.days.reduce((best,day)=>day.keep+day.remove>best.keep+best.remove?day:best,stats.days[0]);
 const reviews=window.keep+window.remove;
 const first=stats.days[0],last=stats.days.at(-1);
 return {
  reviews:reviews?`Reviews per day over the last ${stats.days.length} days: ${reviews.toLocaleString()} reviewed, ${window.keep.toLocaleString()} kept and ${window.remove.toLocaleString()} marked for Trash. Busiest day ${statsDayLabel(busiest.key)} with ${(busiest.keep+busiest.remove).toLocaleString()}.`:`No reviews in the last ${stats.days.length} days.`,
  storage:`Storage over the last ${stats.days.length} days: freed grew from ${formatStorageBytes(first.freed)} to ${formatStorageBytes(last.freed)}, and marked for Trash grew from ${formatStorageBytes(first.marked)} to ${formatStorageBytes(last.marked)}.`
 };
}
export const statsPanelCSS=`.settings-sheet .stats-group{container-type:inline-size}
.stats-body{display:flex;flex-direction:column;gap:8px}
.stats-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
@container (min-width:520px){.stats-tiles{grid-template-columns:repeat(4,minmax(0,1fr))}}
.stats-tile,.stats-chart{box-sizing:border-box;min-width:0;border-radius:22px;background:var(--ps-glass-fill-strong);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke)}
.stats-tile{display:flex;flex-direction:column;gap:2px;padding:12px 14px}
.stats-label{font:600 12px/16px var(--ps-font);color:var(--ps-label2)}
.stats-value{display:flex;align-items:center;gap:6px;min-width:0;font:600 22px/28px var(--ps-font);color:var(--ps-label);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stats-pair{display:inline-flex;align-items:center;gap:4px}
.stats-note{font:400 12px/16px var(--ps-font);color:var(--ps-label2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stats-chart{display:flex;flex-direction:column;gap:8px;padding:14px}
.stats-chart h3{margin:0;font:600 15px/20px var(--ps-font);color:var(--ps-label)}
.stats-legend{display:flex;flex-wrap:wrap;gap:4px 16px;margin:0;font:400 12px/16px var(--ps-font);color:var(--ps-label2)}
.stats-legend span{display:inline-flex;align-items:center;gap:6px}
.settings-sheet .stats-group svg.stats-swatch{flex:none;width:12px;height:12px}
.settings-sheet .stats-group svg.stats-plot{display:block;width:100%;height:auto;overflow:visible}
.stats-plot text{fill:var(--ps-label2);font:400 11px var(--ps-font);font-variant-numeric:tabular-nums}
.stats-grid{stroke:var(--ps-sep);stroke-width:1;shape-rendering:crispEdges}
.stats-keep{fill:var(--ps-accent)}
.stats-trash{fill:var(--ps-destructive)}
.stats-wash{fill:var(--ps-destructive);opacity:.16}
.stats-line{fill:none;stroke:var(--ps-destructive);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.stats-dashed{stroke-dasharray:4 4;opacity:.75}
.stats-ring{stroke:var(--ps-glass-solid);stroke-width:2}
.stats-hit{fill:transparent}
.stats-hit:hover{fill:var(--ps-fill)}
.stats-empty{display:flex;flex-direction:column;justify-content:center;gap:4px;min-height:96px;margin:0;text-align:center;font:400 13px/18px var(--ps-font);color:var(--ps-label2)}
.stats-empty strong{font:600 15px/20px var(--ps-font);color:var(--ps-label)}
.stats-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}`;
export function renderReviewStats({document,container,stats,width=320}) {
 const svgNS='http://www.w3.org/2000/svg';
 const node=(tag,attributes={},...children)=>{const element=document.createElementNS(svgNS,tag);for(const [key,value] of Object.entries(attributes))element.setAttribute(key,String(value));element.append(...children);return element;};
 const html=(tag,className,text)=>{const element=document.createElement(tag);if(className)element.setAttribute('class',className);if(text!==undefined)element.textContent=text;return element;};
 const swatch=(kind)=>{const svg=node('svg',{class:'stats-swatch',viewBox:'0 0 12 12','aria-hidden':'true'});if(kind==='line'||kind==='dashed')svg.append(node('path',{class:`stats-line${kind==='dashed'?' stats-dashed':''}`,d:'M1 6H11'}));else svg.append(node('rect',{class:kind==='keep'?'stats-keep':'stats-trash',x:1,y:1,width:10,height:10,rx:3}));return svg;};
 const legend=entries=>{const row=html('p','stats-legend');for(const [kind,text] of entries){const item=html('span');item.append(swatch(kind),document.createTextNode(text));row.append(item);}return row;};
 const table=(caption,headings,rows)=>{const element=html('table','stats-sr'),head=html('tr');element.append(html('caption','',caption));for(const heading of headings)head.append(html('th','',heading));element.append(head);for(const cells of rows){const row=html('tr');for(const cell of cells)row.append(html('td','',cell));element.append(row);}return element;};
 const tile=(label,value,note)=>{const element=html('div','stats-tile');const valueElement=html('span','stats-value');if(typeof value==='string')valueElement.textContent=value;else valueElement.append(...value);element.append(html('span','stats-label',label),valueElement,html('span','stats-note',note));return element;};
 const pair=(kind,count,label)=>{const element=html('span','stats-pair');element.append(swatch(kind),document.createTextNode(statsCount(count)),html('span','stats-sr',` ${label}`));return element;};
 const tiles=html('div','stats-tiles');tiles.setAttribute('id','stats-tiles');
 const freedText=`${formatStorageBytes(stats.freed.bytes)}${stats.freed.unknown?` + ${stats.freed.unknown} unknown`:''}`;
 tiles.append(
  tile('Reviewed',statsCount(stats.reviewed),stats.reviewed===1?'photo or video':'photos & videos'),
  tile('Kept vs Trash',[pair('keep',stats.kept,'kept'),pair('trash',stats.trashed,'marked for Trash')],stats.reviewed?`${Math.round(stats.kept/stats.reviewed*100)}% kept`:'nothing yet'),
  tile('Storage freed',freedText,'confirmed in Trash'),
  tile('Going to Trash',statsCount(stats.waiting.count),stats.waiting.count?`${formatStorageBytes(stats.waiting.bytes)}${stats.waiting.unknown?` + ${stats.waiting.unknown} unknown`:''} waiting`:'nothing waiting')
 );
 const children=[tiles];
 const card=(id,title)=>{const element=html('section','stats-chart');element.setAttribute('id',id);const heading=html('h3','',title);heading.setAttribute('id',`${id}-title`);element.setAttribute('aria-labelledby',`${id}-title`);element.append(heading);return element;};
 const summary=reviewStatsSummary(stats),count=stats.days.length;
 const reviewsCard=card('stats-reviews',`Reviews per day · last ${count} days`);children.push(reviewsCard);
 if(!stats.reviewed){const empty=html('p','stats-empty');empty.append(html('strong','','No reviews yet'),document.createTextNode('Swipe a few photos and your daily activity shows up here.'));reviewsCard.append(empty);container.replaceChildren(...children);return;}
 const W=Math.max(240,Math.round(width)),H=140,top=10,bottom=H-24,plotH=bottom-top;
 const active=stats.days.filter(day=>day.keep||day.remove);
 if(!active.length){const empty=html('p','stats-empty');empty.append(html('strong','',`No reviews in the last ${count} days`),document.createTextNode('Older decisions still count toward the totals above.'));reviewsCard.append(empty);}
 else{
  const max=Math.max(...stats.days.map(day=>day.keep+day.remove)),ticks=statsTicks(max),labelWidth=Math.max(...ticks.map(tick=>String(tick).length))*7+8,plotW=W-labelWidth,yMax=ticks.at(-1),slotW=plotW/count,barW=Math.min(24,Math.max(2,slotW*.62));
  const y=value=>bottom-value/yMax*plotH;
  const svg=node('svg',{class:'stats-plot',viewBox:`0 0 ${W} ${H}`,width:W,height:H,role:'img','aria-label':summary.reviews});
  for(const tick of ticks)svg.append(node('line',{class:'stats-grid',x1:0,x2:plotW,y1:Math.round(y(tick))+.5,y2:Math.round(y(tick))+.5}),node('text',{x:W,y:y(tick)+4,'text-anchor':'end'},document.createTextNode(tick.toLocaleString())));
  const segment=(x,low,high,rounded)=>{const r=rounded?Math.min(4,barW/2,low-high):0;return `M${x.toFixed(1)} ${low.toFixed(1)}V${(high+r).toFixed(1)}${r?`A${r} ${r} 0 0 1 ${(x+r).toFixed(1)} ${high.toFixed(1)}`:''}H${(x+barW-r).toFixed(1)}${r?`A${r} ${r} 0 0 1 ${(x+barW).toFixed(1)} ${(high+r).toFixed(1)}`:''}V${low.toFixed(1)}Z`;};
  stats.days.forEach((day,position)=>{
   const x=position*slotW+(slotW-barW)/2;
   const keepH=day.keep?Math.max(2,day.keep/yMax*plotH):0,removeH=day.remove?Math.max(2,day.remove/yMax*plotH):0,gap=keepH&&removeH?2:0;
   if(keepH)svg.append(node('path',{class:'stats-keep',d:segment(x,bottom,bottom-keepH,!removeH)}));
   if(removeH)svg.append(node('path',{class:'stats-trash',d:segment(x,bottom-keepH-gap,bottom-keepH-gap-removeH,true)}));
   const hit=node('rect',{class:'stats-hit',x:position*slotW,y:top,width:slotW,height:plotH,rx:2});hit.append(node('title',{},document.createTextNode(`${statsDayLabel(day.key)}: ${day.keep.toLocaleString()} kept, ${day.remove.toLocaleString()} marked for Trash`)));svg.append(hit);
  });
  for(const [position,anchor] of [[0,'start'],[Math.floor((count-1)/2),'middle'],[count-1,'end']])svg.append(node('text',{x:anchor==='start'?0:anchor==='end'?plotW:position*slotW+slotW/2,y:H-6,'text-anchor':anchor},document.createTextNode(position===count-1?'Today':statsDayLabel(stats.days[position].key))));
  reviewsCard.append(legend([['keep','Kept'],['trash','Marked for Trash']]),svg,table('Reviews per day',['Day','Kept','Marked for Trash'],active.map(day=>[statsDayLabel(day.key),day.keep.toLocaleString(),day.remove.toLocaleString()])));
 }
 const storageCard=card('stats-storage',`Storage · last ${count} days`);children.push(storageCard);
 const last=stats.days.at(-1);
 if(!last.marked){const empty=html('p','stats-empty');empty.append(html('strong','','Nothing marked for Trash yet'),document.createTextNode('Swipe left on photos you don’t need to see storage add up here.'));storageCard.append(empty);}
 else{
  const ticks=statsTicks(last.marked,{bytes:true}),labels=ticks.map(tick=>tick?formatStorageBytes(tick).replace(/\.0+ /,' '):'0'),labelWidth=Math.max(...labels.map(label=>label.length))*6.6+8,plotW=W-labelWidth,yMax=ticks.at(-1);
  const y=value=>bottom-value/yMax*plotH,x=position=>count>1?position/(count-1)*plotW:plotW/2;
  const svg=node('svg',{class:'stats-plot',viewBox:`0 0 ${W} ${H}`,width:W,height:H,role:'img','aria-label':summary.storage});
  ticks.forEach((tick,position)=>svg.append(node('line',{class:'stats-grid',x1:0,x2:plotW,y1:Math.round(y(tick))+.5,y2:Math.round(y(tick))+.5}),node('text',{x:W,y:y(tick)+4,'text-anchor':'end'},document.createTextNode(labels[position]))));
  const line=key=>stats.days.map((day,position)=>`${position?'L':'M'}${x(position).toFixed(1)} ${y(day[key]).toFixed(1)}`).join('');
  svg.append(node('path',{class:'stats-wash',d:`${line('freed')}L${x(count-1).toFixed(1)} ${bottom}L${x(0).toFixed(1)} ${bottom}Z`}),node('path',{class:'stats-line stats-dashed',d:line('marked')}),node('path',{class:'stats-line',d:line('freed')}),node('circle',{class:'stats-trash stats-ring',cx:x(count-1),cy:y(last.freed),r:4}));
  stats.days.forEach((day,position)=>{const hit=node('rect',{class:'stats-hit',x:Math.max(0,x(position)-plotW/(count-1||1)/2),y:top,width:plotW/(count-1||1),height:plotH,rx:2});hit.append(node('title',{},document.createTextNode(`${statsDayLabel(day.key)}: ${formatStorageBytes(day.freed)} freed, ${formatStorageBytes(day.marked)} marked for Trash`)));svg.append(hit);});
  for(const [position,anchor] of [[0,'start'],[Math.floor((count-1)/2),'middle'],[count-1,'end']])svg.append(node('text',{x:x(position),y:H-6,'text-anchor':anchor},document.createTextNode(position===count-1?'Today':statsDayLabel(stats.days[position].key))));
  const changes=stats.days.filter((day,position)=>!position||day.freed!==stats.days[position-1].freed||day.marked!==stats.days[position-1].marked);
  storageCard.append(legend([['line',`Freed ${formatStorageBytes(last.freed)}`],['dashed',`Marked ${formatStorageBytes(last.marked)}`]]),svg,table('Storage freed and marked for Trash, running total',['Day','Freed','Marked for Trash'],changes.map(day=>[statsDayLabel(day.key),formatStorageBytes(day.freed),formatStorageBytes(day.marked)])));
 }
 container.replaceChildren(...children);
}
