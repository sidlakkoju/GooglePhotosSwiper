export function sampleSwipe(samples,event){
  const time=Number.isFinite(event.timeStamp)?event.timeStamp:0;
  samples.push({x:event.clientX,time});
  while(samples.length>1&&samples[0].time<time-100)samples.shift();
  return samples;
}
export function releaseSwipe(samples,event,startX,width,cancel=false){
  sampleSwipe(samples,event);
  const dx=event.clientX-startX,first=samples[0],last=samples.at(-1),elapsed=last.time-first.time;
  const velocity=elapsed>0?(last.x-first.x)/elapsed:0;
  return {dx,velocity,commit:!cancel&&(Math.abs(dx)>width/3||(Math.abs(velocity)>.5&&velocity*dx>0)),duration:Math.round(Math.max(180,Math.min(300,300-Math.abs(velocity)*60)))};
}
export function animateSwipe(element,dx,commit,duration=320){
  if(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
  const start=element.style.transform||'translateX(0px)',direction=dx>0?1:-1;
  const distance=(globalThis.innerWidth||1000)+(element.getBoundingClientRect?.().width||350);
  return element.animate?.([{transform:start,opacity:1},{transform:commit?`translateX(${direction*distance}px) rotate(${direction*18}deg)`:'translateX(0px)',opacity:commit?0:1}],{duration,easing:commit?'ease-out':'cubic-bezier(.2,1.5,.5,1)'});
}
export function throwSwipe(element,dx,duration){
  if(!element.cloneNode||!element.ownerDocument?.body)return;
  const transform=element.style.transform,transition=element.style.transition;
  element.style.transition='none';
  element.style.transform='none';
  const rect=element.getBoundingClientRect();
  element.style.transform=transform;
  element.style.transition=transition;
  const copy=element.cloneNode(true);
  if(globalThis.getComputedStyle){
    const originals=[element,...element.querySelectorAll('*')],copies=[copy,...copy.querySelectorAll('*')];
    originals.forEach((original,index)=>{const computed=globalThis.getComputedStyle(original);for(const property of computed)copies[index].style.setProperty(property,computed.getPropertyValue(property));});
  }
  copy.removeAttribute('id');
  for(const child of copy.querySelectorAll('[id]'))child.removeAttribute('id');
  copy.setAttribute('aria-hidden','true');
  copy.inert=true;
  Object.assign(copy.style,{position:'fixed',left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`,margin:'0',boxSizing:'border-box',right:'auto',bottom:'auto',transform,pointerEvents:'none',zIndex:'2147483647',transition:'none'});
  (element.parentNode||element.ownerDocument.body).append(copy);
  const animation=animateSwipe(copy,dx,true,duration);
  if(animation)animation.finished.then(()=>copy.remove(),()=>copy.remove());
  else copy.remove();
  return animation;
}
