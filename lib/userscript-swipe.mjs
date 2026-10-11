export function createSwipeFeedback({window,targets,card,under,keep,remove,canSwipe,onDecide}) {
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
  card.style.transform='';card.style.willChange='';
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
  return animate(reduced()?'':`translate3d(${direction*(Math.max(window.innerWidth||0,width)*1.5)}px,0,0) rotate(${direction*15}deg)`);
 };
 const update=event=>{
  if(!gesture||event.pointerId!==gesture.id)return;
  const dx=event.clientX-gesture.x,time=event.timeStamp;
  if(Number.isFinite(time)&&time>gesture.time){gesture.velocity=(dx-gesture.dx)/(time-gesture.time);gesture.time=time;}
  gesture.dx=dx;gesture.dy=event.clientY-gesture.y;
  if(!gesture.locked){
   if(Math.hypot(gesture.dx,gesture.dy)<10)return;
   if(Math.abs(gesture.dy)>=Math.abs(gesture.dx)){reset();return;}
   gesture.locked=true;card.style.willChange='transform';
  }
  if(frame===null){if(window.requestAnimationFrame)frame=window.requestAnimationFrame(paint);else paint();}
 };
 for(const target of targets){
  target.addEventListener('pointerdown',event=>{
   if(gesture||dismissing||!canSwipe()||event.isPrimary===false||event.button!==0)return;
   animation?.cancel();animation=null;
   gesture={id:event.pointerId,x:event.clientX,y:event.clientY,dx:0,dy:0,time:event.timeStamp,velocity:0,width:card.getBoundingClientRect?.().width||card.offsetWidth||300,target,video:event.target.tagName==='VIDEO'?event.target:null,locked:false};
   target.setPointerCapture(event.pointerId);
  });
  target.addEventListener('pointermove',update);
  target.addEventListener('pointerup',event=>{
   if(!gesture||event.pointerId!==gesture.id)return;
   update(event);
   if(!gesture)return;
   const value=gesture,commit=commits(value);
   if(commit){paint();release();dismiss(value.dx>0?'keep':'remove');onDecide(value.dx>0?'keep':'remove');}
   else {
    const transform=card.style.transform;
    reset();card.style.transform=transform;animate('');
    if(!value.locked&&Math.hypot(value.dx,value.dy)<10&&value.video){if(value.video.paused)value.video.play().catch(()=>{});else value.video.pause();}
   }
  });
  for(const type of ['pointercancel','lostpointercapture'])target.addEventListener(type,event=>{if(gesture&&event.pointerId===gesture.id)reset();});
 }
 reset();
 return {reset,dismiss,get finished(){return finished;}};
}
