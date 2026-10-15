import {reviewStorage} from './userscript-core.mjs';
export function createSessionStorageCounter() {
 const excluded=new Set(),seen=new Set();
 function total(items){
  for(const item of items){if(!seen.has(item.mediaKey)&&item.state==='in_trash')excluded.add(item.mediaKey);seen.add(item.mediaKey);}
  for(const item of items)if(item.decision!=='remove'&&item.state!=='in_trash')excluded.delete(item.mediaKey);
  return reviewStorage(items.filter(item=>item.decision==='remove'&&!item.needsPreview&&!excluded.has(item.mediaKey))).bytes;
 }
 return {total,reset(submittedItems){for(const item of submittedItems)if(item.decision==='remove'||item.state==='in_trash')excluded.add(item.mediaKey);}};
}
export function formatStorageBytes(bytes){const fit=value=>[2,1,0].map(digits=>value.toFixed(digits)).find((text,index)=>Math.abs(text)<10**(index+1))??value.toFixed(0),megabytes=fit(bytes/1e6);return bytes<1e9&&Math.abs(megabytes)<1000?megabytes+' MB':fit(bytes/1e9)+' GB';}
export function createStorageCapsule({document,window,root,element,isVisible}) {
 const renderingWindow=document.defaultView||window;
 const style=document.createElement('style');style.textContent='.content .storage-counter{position:absolute;left:50%;top:50%;width:auto;height:auto;min-width:0;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:2px;padding:0;background:none;border-radius:0;overflow:visible;line-height:1;z-index:3;font-variant-numeric:tabular-nums;cursor:default}.sv-label{font:600 10px/12px var(--ps-font);letter-spacing:.09em;text-transform:uppercase;color:var(--ps-label2)}.sv-value{display:flex;align-items:baseline;color:var(--ps-label);font:700 21px/24px var(--ps-font);letter-spacing:-.01em;transition:color .9s ease}.sv-value.sv-bump{color:var(--sv-flash);transition:none}.sv-digits{display:flex}.sv-col{display:inline-block;height:24px;overflow:hidden;position:relative}.sv-strip{display:flex;flex-direction:column;transform:translateY(calc(var(--n,0) * -24px));transition:transform .7s cubic-bezier(.2,.9,.25,1);transition-delay:calc(var(--i,0) * 35ms)}.sv-strip span,.sv-sep{display:block;height:24px}.sv-unit{font:600 12px/24px var(--ps-font);color:var(--ps-label2);margin-left:3px;letter-spacing:.02em}.sv-delta{position:absolute;left:50%;top:0;white-space:nowrap;font:700 10px/12px var(--ps-font);letter-spacing:.06em;text-transform:uppercase;color:var(--sv-flash);opacity:0;pointer-events:none;transform:translateX(-50%)}.sv-delta.sv-free{color:var(--ps-label2)}.sv-delta.sv-go{animation:sv-note 1.7s cubic-bezier(.2,.8,.2,1) forwards}.storage-counter.sv-noting .sv-label{animation:sv-hide 1.7s ease forwards}@keyframes sv-note{0%{opacity:0;transform:translate(-50%,5px)}12%{opacity:1;transform:translate(-50%,0)}80%{opacity:1;transform:translate(-50%,0)}100%{opacity:0;transform:translate(-50%,-4px)}}@keyframes sv-hide{0%{opacity:1}8%{opacity:0;transform:translateY(-4px)}84%{opacity:0;transform:translateY(5px)}100%{opacity:1;transform:none}}.storage-counter{--sv-flash:var(--ps-accent)}@media(prefers-reduced-motion:reduce){.sv-strip,.sv-value{transition:none}}.content>header:first-child{position:relative;height:56px}.content header #settings{margin-right:auto}.queue-size{color:var(--ps-label2);font-variant-numeric:tabular-nums}.trash-badge{background:var(--ps-destructive)}';root.append(style);
 const label=document.createElement('span'),value=document.createElement('span'),digits=document.createElement('span'),unit=document.createElement('span'),delta=document.createElement('span');
 label.className='sv-label';label.textContent='Freed';value.className='sv-value';digits.className='sv-digits';unit.className='sv-unit';delta.className='sv-delta';
 for(const part of [label,value,delta])part.setAttribute('aria-hidden','true');value.append(digits,unit);element.append(label,value,delta);
 element.setAttribute('role','img');element.title='Storage your deletions free in Google Photos this session. Items Google stores free, like most photos backed up before June 2021, add nothing.';
 const motion=renderingWindow.matchMedia?.('(prefers-reduced-motion: reduce)');
 let shape='',target=0,initialized=false,bumpTimer=null;
 const parts=bytes=>{const text=formatStorageBytes(bytes),space=text.lastIndexOf(' ');return [text.slice(0,space),text.slice(space+1)];};
 function build(number){
  digits.replaceChildren();
  [...number].forEach((character,index)=>{
   if(!/\d/.test(character)){const separator=document.createElement('span');separator.className='sv-sep';separator.textContent=character;digits.append(separator);return;}
   const column=document.createElement('span'),strip=document.createElement('span');column.className='sv-col';strip.className='sv-strip';
   for(let digit=0;digit<10;digit++){const cell=document.createElement('span');cell.textContent=String(digit);strip.append(cell);}
   strip.style.setProperty('--i',String(number.length-1-index));column.append(strip);digits.append(column);
  });
 }
 function show(bytes,animate){
  const [number,suffix]=parts(bytes),pattern=number.replace(/\d/g,'0');
  unit.textContent=suffix;value.dataset.text=number+' '+suffix;
  if(pattern!==shape){shape=pattern;build(number);if(animate){void digits.offsetWidth;}}
  const strips=digits.querySelectorAll?.('.sv-strip')||[];let position=0;
  for(const character of number){if(!/\d/.test(character))continue;const strip=strips[position++];if(!strip)continue;if(!animate){strip.style.transition='none';strip.style.setProperty('--n',character);void strip.offsetWidth;strip.style.transition='';}else strip.style.setProperty('--n',character);}
 }
 function float(text,free){
  delta.textContent=text;delta.classList.toggle('sv-free',free);delta.classList.remove('sv-go');element.classList.remove('sv-noting');
  if(motion?.matches)return;void delta.offsetWidth;delta.classList.add('sv-go');element.classList.add('sv-noting');
 }
 return {update(bytes,{animate=initialized,delta:added=0,free=false}={}){
  const changed=bytes!==target,moving=animate&&!motion?.matches;
  if(changed||!initialized){target=bytes;show(bytes,moving&&initialized);}
  initialized=true;
  element.setAttribute('aria-label',`${formatStorageBytes(bytes)} approximate storage freed this session`);
  if(moving&&changed&&added>0){float('+'+formatStorageBytes(added),false);value.classList.add('sv-bump');renderingWindow.clearTimeout?.(bumpTimer);bumpTimer=renderingWindow.setTimeout?.(()=>value.classList.remove('sv-bump'),60);}
  else if(moving&&free)float('Stored free',true);
 },reset(){target=-1;delta.classList.remove('sv-go');element.classList.remove('sv-noting');this.update(0,{animate:false});}};
}
