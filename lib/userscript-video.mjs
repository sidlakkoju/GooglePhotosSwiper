export function smallerVideoURL(value,compact=false){
 const url=new URL(value);
 url.pathname=url.pathname.replace(/=.+$/,'')+(compact?'=m18':'=m22');
 return url.href;
}
export function startProgressiveVideo({video,url,compact,createVideo,onSwap,onError,isActive}){
 let original=null,finished=false,seeking=false,hasFrame=false;
 const release=element=>{element.pause();element.removeAttribute('src');element.load();};
 const cancel=()=>{finished=true;if(original){release(original);original=null;}};
 video.cancelUpgrade=cancel;
 const fallback=()=>{
  if(finished||!isActive())return;
  const time=video.currentTime,paused=video.paused,restoreTime=video.dataset.resumeReady!=='pending';
  cancel();video.onerror=onError;
  video.addEventListener('loadedmetadata',()=>{if(isActive()&&restoreTime&&Number.isFinite(time))video.currentTime=time;},{once:true});
  video.src=url;video.load();if(!paused)video.play().catch(()=>{});
 };
 const prepare=()=>{
  if(finished||original||!isActive())return;
  original=createVideo();const full=original;
  full.hidden=true;full.preload='auto';full.muted=true;full.loop=video.loop;full.playsInline=true;full.poster=video.poster;
  const align=()=>{
   if(finished||original!==full||!isActive()||full.readyState<2||seeking)return;
   if(Math.abs(full.currentTime-video.currentTime)>.04){seeking=true;full.currentTime=video.currentTime;return;}
   const paused=video.paused;
   full.playbackRate=video.playbackRate;full.volume=video.volume;
   const swap=()=>{
    if(finished||original!==full||!isActive())return;
    if(Math.abs(full.currentTime-video.currentTime)>.08){full.pause();align();return;}
    const muted=video.muted;if(video.paused)full.pause();video.pause();full.muted=muted;full.hidden=false;
    finished=true;original=null;full.onerror=onError;full.dataset.resumeReady='ready';
    onSwap(full);release(video);
   };
   if(paused){swap();return;}
   full.play().then(()=>{if(full.requestVideoFrameCallback)full.requestVideoFrameCallback(swap);else swap();}).catch(()=>{});
  };
  full.addEventListener('seeked',()=>{seeking=false;align();});
  full.addEventListener('canplay',align);
  full.onerror=()=>{release(full);original=null;};
  full.src=url;full.load();
 };
 video.onerror=fallback;
 video.addEventListener('stalled',fallback);
 video.addEventListener('waiting',()=>{if(hasFrame)fallback();});
 video.addEventListener('loadeddata',()=>{hasFrame=true;prepare();},{once:true});
 const small=smallerVideoURL(url,compact);
 if(video.src!==small)video.src=small;
 video.play().catch(()=>{});
 if(video.readyState>=2){hasFrame=true;prepare();}
 return cancel;
}
