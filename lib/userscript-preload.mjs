export function reviewPreviewWindow(items,current,compact=false) {
 const index=items.findIndex(item=>item.mediaKey===current?.mediaKey),ahead=index<0?[]:items.slice(index+1);
 return [...(current?[current]:[]),...ahead.filter(item=>item.type!=='video').slice(0,compact?2:3),...ahead.filter(item=>item.type==='video').slice(0,compact?1:2)];
}
export const reviewURLStale = (item,now=Date.now()) => !item.urlFetchedAt||now-item.urlFetchedAt>=40*60*1000;
export function createReviewPreloader({createImage,createVideo,videoURL,previewURL,playbackURL}) {
 const entries=new Map();
 const active=entry=>entries.get(entry.key)===entry;
 function dispose(entry){
  entry.image?.removeAttribute('src');
  if(entry.video){entry.video.pause();entry.video.removeAttribute('src');entry.video.removeAttribute('poster');entry.video.load();}
 }
 function update(items,current,{width,height,compact=false}={}) {
  const windowItems=reviewPreviewWindow(items,current,compact),ahead=windowItems.filter(item=>item.mediaKey!==current?.mediaKey);
  const photos=ahead.filter(item=>item.type!=='video'),videos=ahead.filter(item=>item.type==='video');
  const wanted=new Map();
  for(const item of [...(current?[current]:[]),...photos,...videos]){
   try{const url=previewURL(item.thumbUrl,{width,height});wanted.set(item.mediaKey,{item,url});}catch{}
  }
  for(const [key,entry] of entries)if(wanted.get(key)?.url!==entry.preview){entries.delete(key);dispose(entry);}
  for(const {item,url} of [...photos,...videos].map(item=>wanted.get(item.mediaKey)).filter(Boolean)){
   if(entries.has(item.mediaKey))continue;
   const entry={key:item.mediaKey,preview:url};entries.set(entry.key,entry);
   Promise.resolve().then(async()=>{
    if(!active(entry))return;
    const image=createImage();entry.image=image;image.src=url;
    const decoded=image.decode();
    const warming=item.type==='video'?(entry.request=(async()=>{
     const result=await videoURL(item.mediaKey);
     if(!active(entry))return;
     const source=playbackURL(result.url),video=createVideo();entry.video=video;entry.source=source;
     video.preload='metadata';video.muted=true;video.poster=url;video.src=source;video.load();
     video.onerror=()=>{if(active(entry)){entries.delete(entry.key);dispose(entry);}};
     return source;
    })()):Promise.resolve();
    await Promise.all([decoded,warming]);
   }).catch(()=>{if(active(entry)){entries.delete(entry.key);dispose(entry);}});
  }
 }
 return {update,videoSource:key=>entries.get(key)?.source||entries.get(key)?.request,clear(){for(const entry of entries.values())dispose(entry);entries.clear();}};
}
