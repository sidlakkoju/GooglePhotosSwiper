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
  if(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return commit?element.animate?.([{opacity:1},{opacity:0}],{duration:150,easing:'ease-out'}):undefined;
  const start=element.style.transform||'translateX(0px)',direction=dx>0?1:-1;
  const distance=(globalThis.innerWidth||1000)+(Number.parseFloat(element.style.width)||350);
  return element.animate?.([{transform:start,opacity:1},{transform:commit?`translateX(${direction*distance}px) rotate(${direction*18}deg)`:'translateX(0px)',opacity:commit?0:1}],{duration,easing:commit?'ease-out':'cubic-bezier(.2,1.5,.5,1)'});
}
export function stillClonedVideos(copy,source){
 const canvases=[...(source.querySelectorAll?.('canvas')||[])];
 [...(copy.querySelectorAll?.('canvas')||[])].forEach((clone,index)=>{const original=canvases[index];if(!original?.width||!original.height)return;try{clone.width=original.width;clone.height=original.height;clone.getContext('2d').drawImage(original,0,0);}catch{}});
 const originals=[...(source.querySelectorAll?.('video')||[])];
 [...(copy.querySelectorAll?.('video')||[])].forEach((clone,index)=>{
  clone.removeAttribute?.('src');clone.preload='none';
  for(const child of [...(clone.querySelectorAll?.('source')||[])])child.remove?.();
  const original=originals[index];
  if(!original||original.hidden||original.style?.opacity==='0'){clone.remove?.();return;}
  const width=original.clientWidth,height=original.clientHeight,document=clone.ownerDocument;
  if(!original.videoWidth||original.readyState<2||!width||!height||!document?.createElement)return;
  try{
   const canvas=document.createElement('canvas'),ratio=globalThis.devicePixelRatio||1;
   canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
   const scale=Math.min(canvas.width/original.videoWidth,canvas.height/original.videoHeight),drawnWidth=original.videoWidth*scale,drawnHeight=original.videoHeight*scale;
   canvas.getContext('2d').drawImage(original,(canvas.width-drawnWidth)/2,(canvas.height-drawnHeight)/2,drawnWidth,drawnHeight);
   canvas.className=clone.className;canvas.style.cssText=clone.style.cssText;canvas.style.width=`${width}px`;canvas.style.height=`${height}px`;
   clone.replaceWith?.(canvas);
  }catch{}
 });
 return copy;
}
export function throwSwipe(element,dx,duration,bounds){
  if(!element.cloneNode||!element.ownerDocument?.body)return;
  const transform=element.style.transform,transition=element.style.transition;
  let rect=bounds;
  if(!rect){
    element.style.transition='none';
    element.style.transform='none';
    rect=element.getBoundingClientRect();
    element.style.transform=transform;
    element.style.transition=transition;
  }
  const copy=stillClonedVideos(element.cloneNode(true),element);
  copy.removeAttribute('id');
  for(const child of copy.querySelectorAll('[id]')){if(child.getAttribute?.('id')==='media')child.classList.add('swipe-media');child.removeAttribute('id');}
  copy.setAttribute('aria-hidden','true');
  copy.inert=true;
  Object.assign(copy.style,{position:'fixed',left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`,margin:'0',boxSizing:'border-box',right:'auto',bottom:'auto',transform:globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'none':transform,pointerEvents:'none',zIndex:'2147483647',transition:'none',willChange:''});
  (element.parentNode||element.ownerDocument.body).append(copy);
  const animation=animateSwipe(copy,dx,true,duration);
  if(animation){copy.style.opacity='0';animation.finished.then(()=>copy.remove(),()=>copy.remove());}
  else copy.remove();
  return animation;
}
