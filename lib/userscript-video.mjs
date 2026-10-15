export function smallerVideoURL(value,compact=false){
 const url=new URL(value);
 url.pathname=url.pathname.replace(/=.+$/,'')+(compact?'=m18':'=m22');
 return url.href;
}
export function startProgressiveVideo({video,url,compact,createVideo,onSwap,onError,onFallback=()=>{},isActive}){
 let original=null,finished=false,seeking=false,wantsPlayback=true,seekIssued=0,retries=0,retryAt=0,realign=()=>{};
 const release=element=>{element.pause();element.removeAttribute('src');element.load();if(element!==video)element.remove();};
 const cancel=()=>{finished=true;if(original){release(original);original=null;}};
 video.cancelUpgrade=cancel;
 video.addEventListener('play',()=>{wantsPlayback=true;});
 video.addEventListener('pause',()=>{if(!video.error)wantsPlayback=false;});
 const fallback=()=>{
  if(finished||!isActive())return;
  const time=video.currentTime,paused=!wantsPlayback,restoreTime=video.dataset.resumeReady!=='pending';
  cancel();video.onerror=onError;onFallback();
  video.addEventListener('loadedmetadata',()=>{if(isActive()&&restoreTime&&Number.isFinite(time))video.currentTime=time;},{once:true});
  video.src=url;video.load();if(!paused)video.play().catch(()=>{});
 };
 const prepare=()=>{
  if(finished||original||!isActive())return;
  original=createVideo();const full=original;
  full.hidden=false;Object.assign(full.style,{position:'absolute',inset:'0',opacity:'0',pointerEvents:'none'});video.parentNode.append(full);full.preload='auto';full.muted=true;full.loop=video.loop;full.playsInline=true;full.poster=video.poster;
  let seekStart=0,seekAttempts=0;
  const abandon=()=>{if(finished||original!==full)return;release(full);original=null;seeking=false;if(retries<3)retryAt=Date.now()+5000*2**retries++;};
  const align=()=>{
   if(finished||original!==full||!isActive()||full.readyState<2||seeking)return;
   if(Math.abs(full.currentTime-video.currentTime)>.04){if(seekAttempts>=8){abandon();return;}seekAttempts++;seekStart=full.currentTime;seeking=true;seekIssued=Date.now();full.currentTime=video.currentTime;return;}
   const paused=video.paused;
   full.playbackRate=video.playbackRate;full.volume=video.volume;
   const swap=()=>{
    if(finished||original!==full||!isActive())return;
    if(Math.abs(full.currentTime-video.currentTime)>.08){full.pause();align();return;}
    const muted=video.muted;if(video.paused)full.pause();video.pause();full.muted=muted;full.hidden=false;full.style.position='';full.style.inset='';full.style.opacity='';full.style.pointerEvents='';
    finished=true;original=null;full.onerror=onError;full.dataset.resumeReady='ready';
    onSwap(full);release(video);
   };
   if(paused){swap();return;}
   full.play().then(()=>{if(full.requestVideoFrameCallback)full.requestVideoFrameCallback(swap);else swap();}).catch(abandon);
  };
  full.addEventListener('seeked',()=>{if(!seeking)return;seeking=false;if(Math.abs(full.currentTime-seekStart)<.001&&Math.abs(full.currentTime-video.currentTime)>.04){abandon();return;}align();});
  realign=align;
  full.addEventListener('canplay',align);
  full.onerror=()=>{release(full);original=null;};
  full.src=compact?smallerVideoURL(url):url;full.load();
 };
 video.onerror=fallback;
 let smallRetried=false;
 video.addEventListener('stalled',()=>{
  if(finished||!isActive())return;
  if(!smallRetried&&video.readyState<2){smallRetried=true;video.load();if(wantsPlayback)video.play().catch(()=>{});return;}
  fallback();
 });
 for(const event of ['loadeddata','playing','timeupdate'])video.addEventListener(event,prepare,{once:true});
 video.addEventListener('timeupdate',()=>{
  if(finished||!isActive())return;
  const now=Date.now();
  if(original&&seeking&&now-seekIssued>4000){seeking=false;realign();return;}
  if(!original&&retryAt&&now>=retryAt&&!video.paused){retryAt=0;prepare();}
 });
 const small=smallerVideoURL(url,compact);
 if(video.src!==small){video.src=small;video.play().catch(()=>{});}
 else if(video.paused)video.play().catch(()=>{});
 if(video.readyState>=2)prepare();
 return cancel;
}

export function watchVideoLoading({video,isActive,onReady}){
 let time=video.currentTime;
 const ready=()=>{if(isActive())onReady();};
 for(const event of ['loadeddata','canplay','playing'])video.addEventListener(event,ready);
 video.addEventListener('timeupdate',()=>{const next=video.currentTime;if(next>time)ready();time=next;});
 if(video.requestVideoFrameCallback)video.requestVideoFrameCallback(ready);
 if(video.readyState>=2)ready();
}
