export function createSwipeFeedback({window,targets,card,under,keep,remove,canSwipe,onDecide,playbackOnClick=false}) {
 let gesture=null,frame=null,animation=null,dismissing=false,finished=Promise.resolve();
 const reduced=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;
 const eligible=({dx,dy})=>Math.abs(dx)>Math.abs(dy)*1.5;
 const commits=value=>value.locked&&eligible(value)&&(Math.abs(value.dx)>=value.width*.33||Math.abs(value.velocity)>.5&&Math.sign(value.velocity)===Math.sign(value.dx))&&canSwipe();
 const paint=()=>{
  frame=null;
  if(!gesture?.locked)return;
  const {dx,dy,width}=gesture,progress=eligible(gesture)?Math.min(1,Math.abs(dx)/(width*.33)):0;
  card.style.transform=reduced()?'':`translate3d(${dx}px,${dy*.2}px,0) rotate(${Math.max(-15,Math.min(15,dx/width*15))}deg) scale(1.02)`;
  keep.style.opacity=String(dx>0?progress:0);
  remove.style.opacity=String(dx<0?progress:0);
  under.style.transform=`scale(${.94+.06*progress})`;
 };
 const release=()=>{
  const previous=gesture;
  gesture=null;
  if(frame!==null)window.cancelAnimationFrame?.(frame);
  frame=null;
  if(previous?.target.hasPointerCapture?.(previous.id))previous.target.releasePointerCapture(previous.id);
 };
 const reset=()=>{
  release();animation?.cancel();animation=null;dismissing=false;finished=Promise.resolve();
  card.style.transform='';card.style.willChange='';card.style.visibility='';
  keep.style.opacity='0';remove.style.opacity='0';under.style.transform='scale(.94)';
 };
 const animate=transform=>{
  const start=card.style.transform||'none';
  animation?.cancel();animation=null;
  card.style.transform=transform;
  if(!reduced()&&card.animate){animation=card.animate([{transform:start},{transform:transform||'none'}],{duration:180,easing:'ease-out'});finished=animation.finished.catch(()=>{});}
  else finished=Promise.resolve();
  return finished;
 };
 const dismiss=decision=>{
  if(dismissing)return finished;
  dismissing=true;release();
  const direction=decision==='keep'?1:-1,width=card.getBoundingClientRect?.().width||card.offsetWidth||300;
  keep.style.opacity=decision==='keep'?'1':'0';remove.style.opacity=decision==='remove'?'1':'0';under.style.transform='scale(1)';
  const destination=reduced()?'':`translate3d(${direction*(Math.max(window.innerWidth||0,width)*1.5)}px,0,0) rotate(${direction*15}deg)`;
  if(card.cloneNode&&card.parentNode&&!reduced()){
   const outgoing=card.cloneNode(true);
   outgoing.setAttribute('aria-hidden','true');outgoing.inert=true;
   for(const element of outgoing.querySelectorAll?.('[id]')||[])element.removeAttribute('id');
   outgoing.style.position='absolute';outgoing.style.inset='0';outgoing.style.pointerEvents='none';outgoing.style.zIndex='3';
   card.parentNode.append(outgoing);
   card.style.visibility='hidden';
   const flight=outgoing.animate?.([{transform:card.style.transform||'none'},{transform:destination}],{duration:180,easing:'ease-out'});
   outgoing.style.transform=destination;
   finished=flight?flight.finished.catch(()=>{}).then(()=>outgoing.remove()):Promise.resolve(outgoing.remove());
   return finished;
  }
  return animate(destination);
 };
 const cancelGesture=()=>{
  if(!gesture)return;
  gesture.suppressClick();
  const transform=gesture.locked?card.style.transform:null;
  reset();
  if(transform){card.style.transform=transform;animate('');}
 };
 const update=event=>{
  if(!gesture||event.pointerId!==gesture.id)return;
  const dx=event.clientX-gesture.x,time=event.timeStamp;
  if(Number.isFinite(time)){
   gesture.samples.push({dx,time});
   while(gesture.samples.length>1&&gesture.samples[0].time<time-80)gesture.samples.shift();
   const first=gesture.samples[0],elapsed=time-first.time;
   gesture.velocity=elapsed>=16?(dx-first.dx)/elapsed:0;
  }
  gesture.dx=dx;gesture.dy=event.clientY-gesture.y;
  if(!gesture.locked){
   if(Math.hypot(gesture.dx,gesture.dy)<10)return;
   if(Math.abs(gesture.dy)>=Math.abs(gesture.dx)){gesture.suppressClick();reset();return;}
   gesture.locked=true;gesture.target.setPointerCapture(gesture.id);card.style.willChange='transform';
  }
  gesture.suppressClick();event.preventDefault?.();
  if(frame===null){if(window.requestAnimationFrame)frame=window.requestAnimationFrame(paint);else paint();}
 };
 const finishGesture=event=>{
   if(!gesture||event.pointerId!==gesture.id)return;
   update(event);
   if(!gesture)return;
   const value=gesture,commit=commits(value);
   if(commit){paint();release();dismiss(value.dx>0?'keep':'remove');onDecide(value.dx>0?'keep':'remove');}
   else {
    const transform=card.style.transform;
    reset();card.style.transform=transform;animate('');
    if(!playbackOnClick&&!value.locked&&Math.hypot(value.dx,value.dy)<10&&value.video){if(value.video.paused)value.video.play().catch(()=>{});else value.video.pause();}
   }
 };
 window.addEventListener?.('pointermove',update,true);
 window.addEventListener?.('pointerup',finishGesture,true);
 window.addEventListener?.('pointercancel',event=>{if(gesture&&event.pointerId===gesture.id)cancelGesture();},true);
 for(const target of targets){
  let suppressClick=false;
  target.addEventListener('pointerdown',event=>{
   if(gesture||dismissing||!canSwipe()||event.isPrimary===false||event.button!==0)return;
   suppressClick=false;animation?.cancel();animation=null;
   gesture={id:event.pointerId,x:event.clientX,y:event.clientY,dx:0,dy:0,samples:Number.isFinite(event.timeStamp)?[{dx:0,time:event.timeStamp}]:[],velocity:0,width:card.getBoundingClientRect?.().width||card.offsetWidth||300,target,suppressClick:()=>{suppressClick=true;},video:event.target.tagName==='VIDEO'?event.target:null,locked:false};
   if(event.pointerType==='mouse')target.setPointerCapture(event.pointerId);
  });
  target.addEventListener('pointermove',update);
  target.addEventListener('pointerup',finishGesture);
  for(const type of ['pointercancel'])target.addEventListener(type,event=>{if(gesture&&event.pointerId===gesture.id){suppressClick=true;cancelGesture();}});
  target.addEventListener('lostpointercapture',event=>{if(event.target===target&&gesture?.id===event.pointerId){suppressClick=true;reset();}});
  target.addEventListener('click',event=>{
   if(suppressClick){event.preventDefault();event.stopImmediatePropagation();suppressClick=false;return;}
   if(event.target.closest?.('button'))return;
   const video=playbackOnClick&&target.querySelector?.('video');
   if(video&&!video.controls){if(video.paused)video.play().catch(()=>{});else video.pause();}
  });
 }
 reset();
 return {reset,dismiss,get finished(){return finished;}};
}
