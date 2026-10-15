import {stillClonedVideos} from './swipe.mjs';
export function createSwipeFeedback({window,targets,card,under,keep,remove,canSwipe,onDecide,playbackOnClick=false}) {
 let gesture=null,frame=null,animation=null,incoming=null,dismissing=false,finished=Promise.resolve(),cardWidth=300;
 const FLIGHT_MS=340,FLIGHT_EASING='cubic-bezier(.3,.2,.3,1)',FLING_MS=280,FLING_EASING='cubic-bezier(.2,.7,.3,1)';
 const motionPreference=window.matchMedia?.('(prefers-reduced-motion: reduce)');
 const reduced=()=>motionPreference?.matches===true;
 const eligible=({dx,dy})=>Math.abs(dx)>Math.abs(dy)*1.5;
 const commits=value=>value.locked&&eligible(value)&&(Math.abs(value.dx)>=value.width*.33||Math.abs(value.velocity)>.5&&Math.sign(value.velocity)===Math.sign(value.dx))&&canSwipe();
 const paint=()=>{
  frame=null;
  if(!gesture)return;
  if(gesture.cancelled){reset();return;}
  if(!gesture.locked)return;
  card.style.willChange=reduced()?'':'transform';
  const {dx,dy,width}=gesture,progress=eligible(gesture)?Math.min(1,Math.abs(dx)/(width*.33)):0;
  card.style.transform=reduced()?'':`translate3d(${dx}px,${dy*.2}px,0) rotate(${Math.max(-15,Math.min(15,dx/width*15))}deg) scale(1.02)`;
  keep.style.opacity=String(dx>0?progress:0);
  remove.style.opacity=String(dx<0?progress:0);
  under.style.transform=reduced()?'':`scale(${.94+.06*progress})`;
 };
 const release=()=>{
  const previous=gesture;
  gesture=null;
  if(frame!==null)window.cancelAnimationFrame?.(frame);
  frame=null;
  card.style.willChange='';
  if(previous?.target.hasPointerCapture?.(previous.id))previous.target.releasePointerCapture(previous.id);
 };
 const reset=()=>{
  release();animation?.cancel();animation=null;dismissing=false;finished=Promise.resolve();
  card.style.transform='';card.style.willChange='';card.style.visibility='';
  keep.style.opacity='0';remove.style.opacity='0';under.style.transform=reduced()?'':'scale(.94)';
 };
 const animate=(transform,{duration=180,easing='ease-out'}={})=>{
  const start=card.style.transform||'none';
  animation?.cancel();animation=null;
  card.style.transform=transform;
  if(!reduced()&&card.animate){animation=card.animate([{transform:start},{transform:transform||'none'}],{duration,easing});finished=animation.finished.catch(()=>{});}
  else finished=Promise.resolve();
  return finished;
 };
 const dismiss=decision=>{
  if(dismissing)return finished;
  dismissing=true;const width=gesture?.width||cardWidth,flung=!!card.style.transform,duration=flung?FLING_MS:FLIGHT_MS,easing=flung?FLING_EASING:FLIGHT_EASING;release();
  const direction=decision==='keep'?1:-1;
  keep.style.opacity=decision==='keep'?'1':'0';remove.style.opacity=decision==='remove'?'1':'0';under.style.transform=reduced()?'':'scale(1)';
  const destination=reduced()?'':`translate3d(${Math.round(direction*width*1.3)}px,${Math.round((gesture?.dy||0)*.2)}px,0) rotate(${direction*16}deg)`;
  if(card.cloneNode&&card.parentNode){
   const outgoing=stillClonedVideos(card.cloneNode(true),card);
   outgoing.setAttribute('aria-hidden','true');outgoing.inert=true;
   for(const control of outgoing.querySelectorAll?.('button,a,input')||[])control.remove();
   for(const element of outgoing.querySelectorAll?.('[id]')||[])element.removeAttribute('id');
   outgoing.removeAttribute?.('id');outgoing.style.willChange='';outgoing.style.transform=reduced()?'':card.style.transform;
   outgoing.style.position='absolute';outgoing.style.inset='0';outgoing.style.pointerEvents='none';outgoing.style.zIndex='3';
   card.parentNode.append(outgoing);
   card.style.visibility='hidden';
   const flight=outgoing.animate?.(reduced()?[{opacity:1},{opacity:0}]:[{transform:card.style.transform||'none',opacity:1,offset:0},{opacity:1,offset:.7},{transform:destination,opacity:0,offset:1}],{duration:reduced()?150:duration,easing:reduced()?'ease-out':easing});
   outgoing.style.transform=destination;outgoing.style.opacity='0';
   incoming?.cancel();incoming=null;
   if(!reduced()&&card.animate)incoming=card.animate([{transform:'scale(.95)'},{transform:'none'}],{duration,easing:'cubic-bezier(.2,.8,.2,1)'});
   finished=flight?flight.finished.catch(()=>{}).then(()=>outgoing.remove()):Promise.resolve(outgoing.remove());
   return finished;
  }
  return animate(destination,{duration,easing});
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
   if(Math.abs(gesture.dy)>=Math.abs(gesture.dx))gesture.cancelled=true;
   else {gesture.locked=true;gesture.target.setPointerCapture(gesture.id);}
  }
  gesture.suppressClick();
  if(!gesture.cancelled)event.preventDefault?.();
  if(frame===null){if(window.requestAnimationFrame)frame=window.requestAnimationFrame(paint);else paint();}
 };
 const finishGesture=event=>{
   if(!gesture||event.pointerId!==gesture.id)return;
   update(event);
   if(!gesture)return;
   const value=gesture,commit=!value.cancelled&&commits(value);
   if(commit){if(frame!==null)window.cancelAnimationFrame?.(frame);frame=null;paint();release();dismiss(value.dx>0?'keep':'remove');onDecide(value.dx>0?'keep':'remove');}
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
   if(event.target.closest?.('[data-video-control]')||gesture||dismissing||!canSwipe()||event.isPrimary===false||event.button!==0)return;
   suppressClick=false;animation?.cancel();animation=null;incoming?.finish?.();incoming=null;
   cardWidth=card.getBoundingClientRect?.().width||card.offsetWidth||300;
   gesture={id:event.pointerId,x:event.clientX,y:event.clientY,dx:0,dy:0,samples:Number.isFinite(event.timeStamp)?[{dx:0,time:event.timeStamp}]:[],velocity:0,width:cardWidth,target,suppressClick:()=>{suppressClick=true;},video:event.target.tagName==='VIDEO'?event.target:null,locked:false};
   if(event.pointerType==='mouse')target.setPointerCapture(event.pointerId);
  });
  target.addEventListener('pointermove',update);
  target.addEventListener('pointerup',finishGesture);
  for(const type of ['pointercancel'])target.addEventListener(type,event=>{if(gesture&&event.pointerId===gesture.id){suppressClick=true;cancelGesture();}});
  target.addEventListener('touchmove',event=>{if(gesture?.locked&&event.cancelable)event.preventDefault();},{passive:false});
  target.addEventListener('lostpointercapture',event=>{if(event.target===target&&gesture?.id===event.pointerId){suppressClick=true;reset();}});
  target.addEventListener('click',event=>{
   if(suppressClick){event.preventDefault();event.stopImmediatePropagation();suppressClick=false;return;}
   if(event.target.closest?.('button, [data-video-control]'))return;
   const video=playbackOnClick&&target.querySelector?.('video');
   if(video&&!video.controls){if(video.paused)video.play().catch(()=>{});else video.pause();}
  });
 }
 reset();
 return {reset,dismiss,get finished(){return finished;},get dragging(){return !!gesture;}};
}
