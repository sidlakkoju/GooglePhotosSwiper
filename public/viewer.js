import {sampleSwipe,releaseSwipe,animateSwipe,throwSwipe} from './swipe.js';
export function createPhotoViewer(dialog, loadPreview, loadVideo, review = {}) {
  const stage=dialog.querySelector('.viewer-stage'), image=stage.querySelector('img'), video=stage.querySelector('video');
  const status=dialog.querySelector('[data-status]'), title=dialog.querySelector('[data-title]'), zoomLabel=dialog.querySelector('[data-zoom]');
  const zoomIn=dialog.querySelector('[data-in]'), zoomOut=dialog.querySelector('[data-out]'), fitButton=dialog.querySelector('[data-fit]');
  const actions=dialog.querySelector('.viewer-review'), swipeZone=dialog.querySelector('[data-swipe-zone]'), stamp=dialog.querySelector('[data-review-stamp]');
  const removeButton=dialog.querySelector('[data-remove]'), keepButton=dialog.querySelector('[data-keep]'), undoButton=dialog.querySelector('[data-undo]');
  const help=dialog.querySelector('.viewer-help'), pointers=new Map();
  let scale=1,x=0,y=0,width=0,height=0,ready=false,request=0,gesture=null,swipe=null,canReview=false,working=false,current=null;
  const localPoint=e=>{const r=stage.getBoundingClientRect();return {x:e.clientX-r.left-r.width/2,y:e.clientY-r.top-r.height/2};};
  function clampPan(){const maxX=Math.max(0,(width*scale-stage.clientWidth)/2),maxY=Math.max(0,(height*scale-stage.clientHeight)/2);x=Math.max(-maxX,Math.min(maxX,x));y=Math.max(-maxY,Math.min(maxY,y));}
  function paint(){clampPan();image.style.transform=`translate(-50%,-50%) translate(${x}px,${y}px) scale(${scale})`;zoomLabel.textContent=`${Math.round(scale*100)}%`;zoomOut.disabled=!ready||scale<=1;zoomIn.disabled=!ready||scale>=6;fitButton.disabled=!ready;stage.classList.toggle('zoomed',ready&&scale>1);}
  function fit(){if(!ready)return;const ratio=Math.min((stage.clientWidth-24)/image.naturalWidth,(stage.clientHeight-24)/image.naturalHeight);width=image.naturalWidth*ratio;height=image.naturalHeight*ratio;image.style.width=`${width}px`;image.style.height=`${height}px`;scale=1;x=y=0;paint();}
  function zoom(value,anchorX=0,anchorY=0){if(!ready)return;const next=Math.min(6,Math.max(1,value));x=anchorX-(anchorX-x)*next/scale;y=anchorY-(anchorY-y)*next/scale;scale=next;paint();}
  function metrics(){const points=[...pointers.values()];if(points.length<2)return points[0]?{...points[0],distance:null}:null;return {x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2,distance:Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y)};}
  function clearSwipe(){swipe=null;stage.style.transform='';stamp.hidden=true;swipeZone.textContent='Swipe left or right';stage.classList.remove('review-dragging');}
  function controls(){actions.hidden=!canReview;removeButton.disabled=keepButton.disabled=working||!current||review.canDecide?.()===false;undoButton.disabled=working||!review.canUndo?.();}
  function clearMedia(){ready=false;video.pause();video.removeAttribute('src');video.load();video.hidden=true;image.removeAttribute('src');image.hidden=true;pointers.clear();gesture=null;clearSwipe();stage.classList.remove('panning');}
  async function show(item,playback={}){
    const token=++request;clearMedia();current=item;scale=1;x=y=0;controls();
    if(!item){paint();for(const control of [zoomIn,zoomOut,fitButton,zoomLabel])control.hidden=true;title.textContent='Review complete';status.hidden=false;status.textContent='No more items in this review. Undo or close to load more.';help.textContent='Z to undo · F or Esc to close';return;}
    title.textContent=item.name;image.alt=item.name;status.hidden=false;status.textContent=item.type==='video'?'Loading video…':'Loading photo…';
    for(const control of [zoomIn,zoomOut,fitButton,zoomLabel])control.hidden=item.type==='video';
    help.textContent=canReview?'← Remove · → Keep · Z Undo · F or Esc Close'+(item.type==='video'?' · Space Play/Pause':' · Drag zoomed photo to pan'):(item.type==='video'?'Space to play or pause · F or Esc to close':'Scroll or pinch to zoom · Drag to pan · F or Esc to close');paint();
    try{
      const url=await (item.type==='video'?loadVideo(item):loadPreview(item));if(token!==request||!dialog.open)return;if(!url)throw Error('Preview unavailable.');
      if(item.type==='video'){video.muted=playback.muted??video.muted;video.src=url;video.currentTime=playback.time||0;video.hidden=false;status.hidden=true;if(playback.playing)video.play().catch(()=>{});}
      else{image.src=url;await image.decode();if(token!==request||!dialog.open)return;ready=true;image.hidden=false;status.hidden=true;fit();}
    }catch(error){if(token===request&&dialog.open)status.textContent=error.message;}
  }
  async function decide(decision,swipeResult=null){if(!canReview||working||!current||review.canDecide?.()===false)return;working=true;controls();const visibility=stage.style.visibility;if(swipeResult){throwSwipe(stage,swipeResult.dx,swipeResult.duration);stage.style.visibility='hidden';}const token=request;try{const next=await review.decide(decision,current.id);if(dialog.open&&token===request)await show(next,{playing:next?.type==='video'});}catch(error){if(dialog.open){status.textContent=error.message;status.hidden=false;}}finally{if(swipeResult)stage.style.visibility=visibility;working=false;controls();if(dialog.open)dialog.focus({preventScroll:true});}}
  async function undo(){if(!canReview||working||!review.canUndo?.())return;working=true;controls();const token=request;try{const next=await review.undo();if(dialog.open&&token===request)await show(next);}finally{working=false;controls();if(dialog.open)dialog.focus({preventScroll:true});}}
  removeButton.onclick=()=>decide('remove');keepButton.onclick=()=>decide('keep');undoButton.onclick=undo;
  zoomIn.onclick=()=>zoom(scale*1.25);zoomOut.onclick=()=>zoom(scale/1.25);fitButton.onclick=fit;
  dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.tabIndex=-1;
  video.addEventListener('seeked',()=>{if(dialog.open&&document.activeElement===video)dialog.focus({preventScroll:true});});
  video.addEventListener('error',()=>{if(dialog.open&&!video.hidden){status.textContent='This video could not be played here. Close the viewer and retry playback.';status.hidden=false;}});
  stage.addEventListener('wheel',e=>{if(!video.hidden)return;e.preventDefault();const p=localPoint(e);zoom(scale*Math.exp(-e.deltaY*.002),p.x,p.y);},{passive:false});
  function down(e){
    if(working||e.button!==0||e.target.closest('button,video'))return;
    const onZone=e.currentTarget===swipeZone;
    if(canReview&&current&&review.canDecide?.()!==false&&((ready&&scale===1&&pointers.size===0)||onZone)&&!swipe){for(const animation of stage.getAnimations?.()||[])animation.cancel();swipe={id:e.pointerId,x:e.clientX,y:e.clientY,dx:0,dy:0,samples:sampleSwipe([],e),target:e.currentTarget};e.currentTarget.setPointerCapture(e.pointerId);return;}
    if(!ready||onZone)return;
    if(swipe){const r=stage.getBoundingClientRect();pointers.set(swipe.id,{x:swipe.x+swipe.dx-r.left-r.width/2,y:swipe.y+swipe.dy-r.top-r.height/2});clearSwipe();}
    pointers.set(e.pointerId,localPoint(e));stage.setPointerCapture(e.pointerId);gesture=metrics();stage.classList.add('panning');
  }
  function move(e){
    if(swipe?.id===e.pointerId){sampleSwipe(swipe.samples,e);swipe.dx=e.clientX-swipe.x;stage.style.transform=`translateX(${swipe.dx}px)`;swipe.dy=e.clientY-swipe.y;const horizontal=Math.abs(swipe.dx)>Math.abs(swipe.dy)*1.4;stamp.hidden=!horizontal||Math.abs(swipe.dx)<20;if(!stamp.hidden){stamp.textContent=swipe.dx>0?'KEEP':'REMOVE';stamp.dataset.direction=swipe.dx>0?'keep':'remove';swipeZone.textContent=swipe.dx>0?'Release to keep':'Release to queue removal';}return;}
    if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,localPoint(e));const next=metrics();if(gesture&&next){if(next.distance&&gesture.distance)zoom(scale*next.distance/gesture.distance,gesture.x,gesture.y);x+=next.x-gesture.x;y+=next.y-gesture.y;paint();}gesture=next;
  }
  function release(e,cancel=false){
    if(swipe?.id===e.pointerId){const result=releaseSwipe(swipe.samples,e,swipe.x,stage.getBoundingClientRect().width,cancel),dy=e.clientY-swipe.y,commit=result.commit&&Math.abs(result.dx)>Math.abs(dy)*1.4&&!working&&review.canDecide?.()!==false;if(commit)decide(result.dx>0?'keep':'remove',result);else animateSwipe(stage,result.dx,false);clearSwipe();return;}
    pointers.delete(e.pointerId);gesture=metrics();if(!pointers.size)stage.classList.remove('panning');
  }
  for(const target of [stage,swipeZone]){target.addEventListener('pointerdown',down);target.addEventListener('pointermove',move);target.addEventListener('pointerup',e=>release(e));target.addEventListener('pointercancel',e=>release(e,true));target.addEventListener('lostpointercapture',e=>release(e,true));}
  stage.addEventListener('dblclick',e=>{if(!e.target.closest('video'))scale>1?fit():zoom(2.5);});
  dialog.addEventListener('keydown',e=>{
    if(e.ctrlKey||e.metaKey||e.altKey||e.target.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;
    if(e.key.toLowerCase()==='f'){e.preventDefault();e.stopPropagation();dialog.close();return;}
    if(canReview&&(['ArrowLeft','ArrowRight'].includes(e.key)||e.key.toLowerCase()==='z')){e.preventDefault();e.stopPropagation();if(!e.repeat){if(e.key.toLowerCase()==='z')undo();else decide(e.key==='ArrowLeft'?'remove':'keep');}return;}
    if(e.code==='Space'&&!video.hidden){e.preventDefault();e.stopPropagation();if(!e.repeat){if(video.paused)video.play().catch(()=>{});else video.pause();}return;}
    if(!video.hidden)return;
    if(['+','=','-','0','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();if(e.key==='+'||e.key==='=')zoom(scale*1.25);else if(e.key==='-')zoom(scale/1.25);else if(e.key==='0')fit();else{if(e.key==='ArrowLeft')x+=60;if(e.key==='ArrowRight')x-=60;if(e.key==='ArrowUp')y+=60;if(e.key==='ArrowDown')y-=60;paint();}}
  },{capture:true});
  dialog.addEventListener('close',()=>{request++;current=null;clearMedia();paint();});
  new ResizeObserver(()=>{if(dialog.open&&ready)fit();}).observe(stage);
  return {replace:show,refreshControls:controls,async open(item,playback={}){if(dialog.open)return;canReview=!!playback.review;dialog.showModal();const loading=show(item,playback);dialog.focus({preventScroll:true});await loading;}};
}
