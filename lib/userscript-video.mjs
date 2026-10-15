export function smallerVideoURL(value,compact=false){
 const url=new URL(value);
 url.pathname=url.pathname.replace(/=.+$/,'')+(compact?'=m18':'=m22');
 return url.href;
}
export function startProgressiveVideo({video,url,compact,createVideo,onSwap,onError,onFallback=()=>{},isActive,held=()=>false,runOutAfter=2000}){
 let original=null,finished=false,seeking=false,wantsPlayback=true,seekIssued=0,retries=0,retryAt=0,unstick=()=>{},chaseUntil=0,giveUp=()=>{};
 const release=element=>{element.pause();element.removeAttribute('src');element.load();if(element!==video)element.remove();};
 const cancel=()=>{finished=true;if(original){release(original);original=null;}};
 video.cancelUpgrade=cancel;video.upgradeActive=()=>!finished;
 video.addEventListener('play',()=>{wantsPlayback=true;});
 video.addEventListener('pause',()=>{if(!video.error)wantsPlayback=false;});
 const fallback=()=>{
  if(finished||!isActive())return;
  const time=video.currentTime,paused=!wantsPlayback,restoreTime=video.dataset.resumeReady!=='pending';
  cancel();video.onerror=onError;onFallback();
  video.addEventListener('loadedmetadata',()=>{if(isActive()&&restoreTime&&Number.isFinite(time))video.currentTime=time;},{once:true});
  video.src=url;video.load();if(!paused)video.play().catch(()=>{});
 };
 const watchRunOut=(element,lower)=>{
  let timer=0,done=false,last=element.currentTime,armedAt=0;
  const check=()=>{
   timer=0;
   if(done||!isActive()||!element.src||element.paused||element.ownerDocument?.hidden||element.upgradeActive?.())return;
   if(Date.now()-armedAt>runOutAfter*2){arm();return;}
   done=true;const time=element.currentTime;
   element.addEventListener('loadedmetadata',()=>{if(isActive()&&Number.isFinite(time))element.currentTime=time;},{once:true});
   element.src=lower;element.load();element.play().catch(()=>{});onFallback();
  };
  const arm=()=>{if(done||!isActive())return;clearTimeout(timer);armedAt=Date.now();timer=setTimeout(check,runOutAfter);};
  element.addEventListener('timeupdate',()=>{if(element.currentTime!==last){last=element.currentTime;arm();}});
  for(const event of ['play','playing'])element.addEventListener(event,arm);
  element.addEventListener('pause',()=>{clearTimeout(timer);timer=0;});
  if(!element.paused)arm();
 };
 const prepare=()=>{
  if(finished||original||!isActive())return;
  if(held()){retryAt=retryAt||Date.now();return;}
  original=createVideo();const full=original;
  full.hidden=false;Object.assign(full.style,{position:'absolute',inset:'0',opacity:'0',pointerEvents:'none'});video.parentNode.append(full);full.preload='auto';full.muted=true;full.loop=video.loop;full.playsInline=true;full.poster=video.poster;
  let seekStart=0,seekAttempts=0,frameQueued=false,chasing=false;
  const abandon=()=>{if(finished||original!==full)return;release(full);original=null;seeking=false;chasing=false;chaseUntil=0;if(retries<3)retryAt=Date.now()+5000*2**retries++;};
  const bufferedTo=time=>{const ranges=full.buffered;for(let index=0;index<(ranges?.length||0);index++)if(ranges.start(index)<=time&&time<=ranges.end(index))return ranges.end(index);return time;};
  const caughtUp=()=>{frameQueued=false;align();};
  const onFrame=callback=>{if(full.requestVideoFrameCallback)full.requestVideoFrameCallback((now,frame)=>callback(frame?.mediaTime));else full.addEventListener('timeupdate',()=>callback(),{once:true});};
  const position=frameTime=>Number.isFinite(frameTime)?frameTime:full.currentTime;
  const swap=frameTime=>{
   if(finished||original!==full||!isActive())return;
   const ahead=position(frameTime)-video.currentTime;
   if(Math.abs(ahead)>.08){if(!video.paused&&video.playbackRate>0&&Math.abs(ahead)<=1.6){chase(frameTime);return;}chasing=false;chaseUntil=0;full.pause();align();return;}
   const muted=video.muted;if(video.paused)full.pause();video.pause();full.muted=muted;full.playbackRate=video.playbackRate;full.hidden=false;full.style.position='';full.style.inset='';full.style.opacity='';full.style.pointerEvents='';
   finished=true;original=null;chasing=false;chaseUntil=0;full.onerror=onError;full.dataset.resumeReady='ready';
   const lower=video.src;onSwap(full);release(video);if(lower)watchRunOut(full,lower);
  };
  const chase=frameTime=>{
   if(finished||original!==full||!isActive())return;
   const ahead=position(frameTime)-video.currentTime;
   if(!chasing){chasing=true;chaseUntil=Date.now()+8000;}
   if(video.paused||video.playbackRate<=0||Math.abs(ahead)>1.6){chasing=false;chaseUntil=0;full.pause();full.playbackRate=video.playbackRate;align();return;}
   if(Math.abs(ahead)<=.04){swap(frameTime);return;}
   const rate=video.playbackRate*(ahead<0?1.5:.75);
   if(full.playbackRate!==rate)full.playbackRate=rate;
   if(full.paused)full.play().catch(abandon);
   onFrame(chase);
  };
  giveUp=abandon;
  const align=()=>{
   if(finished||original!==full||!isActive()||full.readyState<2||seeking||chasing)return;
   const ahead=full.currentTime-video.currentTime,playing=!video.paused&&video.playbackRate>0;
   if(playing&&seekAttempts>=1&&ahead<-.04&&ahead>=-1.5&&bufferedTo(full.currentTime)-full.currentTime>=.5){chase();return;}
   if(playing&&ahead>.04&&ahead<=1.6){
    if(!frameQueued){frameQueued=true;if(video.requestVideoFrameCallback)video.requestVideoFrameCallback(caughtUp);else video.addEventListener('timeupdate',caughtUp,{once:true});}
    return;
   }
   if(Math.abs(ahead)>.04){
    if(seekAttempts>=8){abandon();return;}
    seekAttempts++;seekStart=full.currentTime;seeking=true;seekIssued=Date.now();full.currentTime=video.currentTime;return;
   }
   const paused=video.paused;
   full.playbackRate=video.playbackRate;full.volume=video.volume;
   if(paused){swap();return;}
   full.play().then(()=>{if(full.requestVideoFrameCallback)onFrame(swap);else swap();}).catch(abandon);
  };
  full.addEventListener('seeked',()=>{if(!seeking)return;seeking=false;if(Math.abs(full.currentTime-seekStart)<.001&&Math.abs(full.currentTime-video.currentTime)>.04){abandon();return;}align();});
  unstick=()=>{if(seekAttempts>=8){abandon();return;}seekAttempts++;seekStart=full.currentTime;seekIssued=Date.now();full.currentTime=video.currentTime;};
  full.addEventListener('canplay',align);
  full.onerror=()=>{release(full);original=null;};
  full.src=compact?smallerVideoURL(url):url;full.load();
 };
 video.onerror=fallback;
 let smallRetried=false,stallPending=false,lastTime=video.currentTime,movedAt=0;
 video.addEventListener('timeupdate',()=>{if(video.currentTime!==lastTime){lastTime=video.currentTime;movedAt=Date.now();}});
 const stall=()=>{
  if(finished||!isActive())return;
  if(!smallRetried&&video.readyState<2){
   smallRetried=true;const time=video.currentTime,restoreTime=video.dataset.resumeReady!=='pending';
   video.addEventListener('loadedmetadata',()=>{if(isActive()&&restoreTime&&time>0)video.currentTime=time;},{once:true});
   video.load();if(wantsPlayback)video.play().catch(()=>{});return;
  }
  fallback();
 };
 video.addEventListener('stalled',()=>{
  if(finished||!isActive())return;
  if(!video.paused&&Date.now()-movedAt<1000){stallPending=true;return;}
  stall();
 });
 video.addEventListener('waiting',()=>{if(stallPending){stallPending=false;stall();}});
 video.addEventListener('progress',()=>{stallPending=false;});
 for(const event of ['loadeddata','playing','timeupdate'])video.addEventListener(event,prepare,{once:true});
 video.addEventListener('timeupdate',()=>{
  if(finished||!isActive())return;
  const now=Date.now();
  if(original&&seeking&&now-seekIssued>4000){unstick();return;}
  if(original&&chaseUntil&&now>chaseUntil){chaseUntil=0;giveUp();return;}
  if(!original&&retryAt&&now>=retryAt&&!video.paused&&!held()){retryAt=0;prepare();}
 });
 const small=smallerVideoURL(url,compact);
 if(video.src!==small){video.src=small;video.play().catch(()=>{});}
 else if(video.paused)video.play().catch(()=>{});
 if(video.readyState>=2)prepare();
 return cancel;
}

export function loopOnEnd(video,isActive){
 video.loop=false;
 video.addEventListener('ended',()=>{if(!isActive())return;video.currentTime=0;video.play().catch(()=>{});});
}

export function watchVideoLoading({video,isActive,onReady}){
 let time=video.currentTime;
 const ready=()=>{if(isActive())onReady();};
 for(const event of ['loadeddata','canplay','playing'])video.addEventListener(event,ready);
 video.addEventListener('timeupdate',()=>{const next=video.currentTime;if(next>time)ready();time=next;});
 if(video.requestVideoFrameCallback)video.requestVideoFrameCallback(ready);
 if(video.readyState>=2)ready();
}
