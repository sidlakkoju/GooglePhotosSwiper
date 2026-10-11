export function createSwipeFeedback({window,targets,card,under,keep,remove,canSwipe,onDecide}) {
 let gesture=null,frame=null;
 const reduced=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;
 const paint=()=>{
  frame=null;
  if(!gesture?.locked)return;
  const {dx,dy,width}=gesture,progress=Math.min(1,Math.abs(dx)/65);
  card.style.transform=reduced()?'':`translate3d(${dx}px,${dy*.2}px,0) rotate(${Math.max(-15,Math.min(15,dx/width*15))}deg) scale(1.02)`;
  keep.style.opacity=String(dx>0?progress:0);
  remove.style.opacity=String(dx<0?progress:0);
  under.style.transform=`scale(${.94+.06*progress})`;
 };
 const reset=()=>{
  const previous=gesture;
  gesture=null;
  if(frame!==null)window.cancelAnimationFrame?.(frame);
  frame=null;
  card.style.transform='';card.style.willChange='';
  keep.style.opacity='0';remove.style.opacity='0';under.style.transform='scale(.94)';
  if(previous?.target.hasPointerCapture?.(previous.id))previous.target.releasePointerCapture(previous.id);
 };
 const update=event=>{
  if(!gesture||event.pointerId!==gesture.id)return;
  gesture.dx=event.clientX-gesture.x;gesture.dy=event.clientY-gesture.y;
  if(!gesture.locked){
   if(Math.hypot(gesture.dx,gesture.dy)<10)return;
   if(Math.abs(gesture.dy)>=Math.abs(gesture.dx)){reset();return;}
   gesture.locked=true;card.style.willChange='transform';
  }
  if(frame===null){if(window.requestAnimationFrame)frame=window.requestAnimationFrame(paint);else paint();}
 };
 for(const target of targets){
  target.addEventListener('pointerdown',event=>{
   if(gesture||!canSwipe()||event.isPrimary===false||event.button!==0||event.target.tagName==='VIDEO')return;
   gesture={id:event.pointerId,x:event.clientX,y:event.clientY,dx:0,dy:0,width:card.getBoundingClientRect?.().width||card.offsetWidth||300,target,locked:false};
   target.setPointerCapture(event.pointerId);
  });
  target.addEventListener('pointermove',update);
  target.addEventListener('pointerup',event=>{
   if(!gesture||event.pointerId!==gesture.id)return;
   update(event);
   if(!gesture)return;
   const {dx,dy,locked}=gesture,commit=locked&&Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)*1.5&&canSwipe();
   reset();if(commit)onDecide(dx>0?'keep':'remove');
  });
  for(const type of ['pointercancel','lostpointercapture'])target.addEventListener(type,event=>{if(gesture&&event.pointerId===gesture.id)reset();});
 }
 reset();
 return {reset};
}
