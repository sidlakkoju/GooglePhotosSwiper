export function zoomLimits({box,base,content,scale}) {
 const axis=(boxStart,boxSize,center,size)=>{
  const half=size*scale/2;
  if(size*scale<=boxSize)return {min:boxStart+boxSize/2-center,max:boxStart+boxSize/2-center};
  return {min:boxStart+boxSize-half-center,max:boxStart+half-center};
 };
 return {x:axis(box.left,box.width,base.x,content.width),y:axis(box.top,box.height,base.y,content.height)};
}

export function rubberBand(value,min,max,factor=.35) {
 if(value<min)return min-(min-value)*factor;
 if(value>max)return max+(value-max)*factor;
 return value;
}

export function createZoomController({window,media,target,onChange=()=>{},onGesture=()=>{},max=5}) {
 let scale=1,x=0,y=0,element=null,pointers=new Map(),pinch=null,pan=null,glide=null,moved=false;
 const now=()=>window.performance?.now?.()??Date.now();
 const contentSize=(el,width,height)=>{
  const naturalWidth=el.naturalWidth||el.videoWidth||0,naturalHeight=el.naturalHeight||el.videoHeight||0;
  if(!naturalWidth||!naturalHeight||!width||!height)return {width,height};
  const ratio=naturalWidth/naturalHeight,fitted=Math.min(width,height*ratio);
  return {width:fitted,height:fitted/ratio};
 };
 const geometry=()=>{
  const el=element||target();if(!el)return null;
  const rect=el.getBoundingClientRect(),box=media.getBoundingClientRect();
  const width=rect.width/scale,height=rect.height/scale;
  return {box,base:{x:rect.left+rect.width/2-x,y:rect.top+rect.height/2-y},content:contentSize(el,width,height)};
 };
 const paint=(animate=false)=>{
  const el=element||target();if(!el)return;element=el;
  el.style.transition=animate?'transform .28s cubic-bezier(.2,.8,.2,1)':'';
  el.style.transformOrigin='center center';
  el.style.transform=scale===1&&x===0&&y===0?'':`translate3d(${x}px,${y}px,0) scale(${scale})`;
  el.style.willChange=pinch||pan?'transform':'';
 };
 const clamp=(value,minimum,maximum)=>Math.max(minimum,Math.min(maximum,value));
 const settle=(animate=true)=>{
  const goal=clamp(scale,1,max);
  if(goal!==scale){const g=geometry();if(g){const focus={x:g.box.left+g.box.width/2-g.base.x,y:g.box.top+g.box.height/2-g.base.y};x=focus.x-(goal/scale)*(focus.x-x);y=focus.y-(goal/scale)*(focus.y-y);}scale=goal;}
  if(scale<=1.01){scale=1;x=0;y=0;}
  else {const g=geometry();if(g){const limits=zoomLimits({...g,scale});x=clamp(x,limits.x.min,limits.x.max);y=clamp(y,limits.y.min,limits.y.max);}}
  paint(animate);onChange(scale);
 };
 const zoomAt=(next,clientX,clientY,animate=false)=>{
  const g=geometry();if(!g)return;
  next=clamp(next,1,max);
  const fx=clientX-g.base.x,fy=clientY-g.base.y;
  x=fx-(next/scale)*(fx-x);y=fy-(next/scale)*(fy-y);scale=next;
  settle(animate);
 };
 const stopGlide=()=>{if(glide!==null)window.cancelAnimationFrame?.(glide);glide=null;};
 const startGlide=(vx,vy)=>{
  stopGlide();
  if(!window.requestAnimationFrame||Math.hypot(vx,vy)<.05){settle(true);return;}
  let last=now();
  const step=()=>{
   const time=now(),dt=Math.min(32,time-last);last=time;
   const g=geometry();if(!g){glide=null;return;}
   const limits=zoomLimits({...g,scale});
   x+=vx*dt;y+=vy*dt;
   if(x<limits.x.min||x>limits.x.max){x=clamp(x,limits.x.min,limits.x.max);vx=0;}
   if(y<limits.y.min||y>limits.y.max){y=clamp(y,limits.y.min,limits.y.max);vy=0;}
   const decay=Math.pow(.995,dt);vx*=decay;vy*=decay;
   paint();
   if(Math.hypot(vx,vy)<.02){glide=null;settle(false);return;}
   glide=window.requestAnimationFrame(step);
  };
  glide=window.requestAnimationFrame(step);
 };
 const midpoint=()=>{const [a,b]=[...pointers.values()];return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:Math.hypot(a.x-b.x,a.y-b.y)||1};};
 const beginPinch=()=>{
  const g=geometry();if(!g)return;
  const m=midpoint();pan=null;stopGlide();
  pinch={scale,x,y,distance:m.distance,focus:{x:m.x-g.base.x,y:m.y-g.base.y},base:g.base};
  onGesture();paint();
 };
 const beginPan=pointer=>{pan={id:pointer.id,x:pointer.x,y:pointer.y,startX:x,startY:y,samples:[{x:pointer.x,y:pointer.y,time:now()}]};};
 const down=event=>{
  if(!target()||event.target?.closest?.('[data-video-control]'))return;
  if(event.pointerType==='mouse'&&(event.button!==0||scale<=1))return;
  pointers.set(event.pointerId,{id:event.pointerId,x:event.clientX,y:event.clientY});
  if(pointers.size===1)moved=false;
  element=target();
  if(pointers.size===2){event.preventDefault?.();beginPinch();}
  else if(pointers.size===1&&scale>1){stopGlide();beginPan(pointers.get(event.pointerId));if(event.pointerType==='mouse'){media.setPointerCapture?.(event.pointerId);event.preventDefault?.();}}
 };
 const move=event=>{
  const pointer=pointers.get(event.pointerId);if(!pointer)return;
  pointer.x=event.clientX;pointer.y=event.clientY;
  if(pinch&&pointers.size>=2){
   const m=midpoint();
   const raw=pinch.scale*m.distance/pinch.distance;
   const next=raw<1?1-(1-raw)*.4:raw>max?max+(raw-max)*.25:raw;
   const contentX=(pinch.focus.x-pinch.x)/pinch.scale,contentY=(pinch.focus.y-pinch.y)/pinch.scale;
   scale=next;x=m.x-pinch.base.x-next*contentX;y=m.y-pinch.base.y-next*contentY;
   moved=true;paint();onChange(scale);event.preventDefault?.();return;
  }
  if(pan&&pan.id===event.pointerId){
   const dx=pointer.x-pan.x,dy=pointer.y-pan.y;
   if(!moved&&Math.hypot(dx,dy)<6)return;
   moved=true;
   const g=geometry();
   if(g){const limits=zoomLimits({...g,scale});x=rubberBand(pan.startX+dx,limits.x.min,limits.x.max);y=rubberBand(pan.startY+dy,limits.y.min,limits.y.max);}
   pan.samples.push({x:pointer.x,y:pointer.y,time:now()});while(pan.samples.length>2&&pan.samples[0].time<now()-80)pan.samples.shift();
   paint();event.preventDefault?.();
  }
 };
 const up=event=>{
  if(!pointers.has(event.pointerId))return;
  pointers.delete(event.pointerId);
  if(pinch){
   if(pointers.size>=2){beginPinch();return;}
   pinch=null;
   if(pointers.size===1){settle(false);if(scale>1)beginPan([...pointers.values()][0]);else pan=null;return;}
   settle(true);return;
  }
  if(pan&&pan.id===event.pointerId){
   const samples=pan.samples,first=samples[0],last=samples.at(-1),elapsed=last.time-first.time;
   pan=null;
   if(event.type==='pointercancel'||elapsed<=0||now()-last.time>100)settle(true);
   else startGlide((last.x-first.x)/elapsed,(last.y-first.y)/elapsed);
  }
 };
 media.addEventListener('pointerdown',down);
 window.addEventListener?.('pointermove',move,{capture:true,passive:false});
 window.addEventListener?.('pointerup',up,true);
 window.addEventListener?.('pointercancel',up,true);
 media.addEventListener('lostpointercapture',event=>{if(event.pointerType==='mouse')up(event);});
 media.addEventListener('click',event=>{if(moved){moved=false;event.preventDefault();event.stopImmediatePropagation();}},true);
 for(const type of ['gesturestart','gesturechange'])media.addEventListener(type,event=>event.preventDefault?.());
 const reset=(animate=false)=>{
  stopGlide();pointers.clear();pinch=null;pan=null;
  const el=element;scale=1;x=0;y=0;
  if(el){el.style.transition=animate?'transform .28s cubic-bezier(.2,.8,.2,1)':'';el.style.transform='';el.style.willChange='';}
  if(!animate)element=null;
  onChange(1);
 };
 return {
  get scale(){return scale;},
  get gesturing(){return !!pinch||pointers.size>1;},
  zoomTo(next,clientX,clientY,animate=false){
   element=target()||element;if(!element)return;
   if(clientX===undefined){const box=media.getBoundingClientRect();clientX=box.left+box.width/2;clientY=box.top+box.height/2;}
   zoomAt(next,clientX,clientY,animate);
  },
  panBy(dx,dy){if(scale<=1)return;stopGlide();x-=dx;y-=dy;settle(false);},
  reset
 };
}
