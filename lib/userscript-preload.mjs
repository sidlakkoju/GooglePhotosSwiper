export function reviewPreviewWindow(items,current,compact=false) {
 const index=items.findIndex(item=>item.mediaKey===current?.mediaKey),ahead=index<0?[]:items.slice(index+1);
 return [...(current?[current]:[]),...ahead.filter(item=>item.type!=='video').slice(0,compact?2:3),...ahead.filter(item=>item.type==='video').slice(0,2)];
}
export const reviewURLStale = (item,now=Date.now()) => !item.urlFetchedAt||now-item.urlFetchedAt>=40*60*1000;
export function createReviewPreloader({createImage,createVideo,videoURL,previewURL,playbackURL}) {
 const entries=new Map(),links=new Map(),warmed=new Map();
 let warmKey=null,videosHeld=false;
 const active=entry=>entries.get(entry.key)===entry;
 const activeLink=entry=>links.get(entry.key)===entry;
 function disposeVideo(entry){
  const video=warmed.get(entry.source);
  if(!video)return;
  warmed.delete(entry.source);video.pause();video.removeAttribute('src');video.removeAttribute('poster');video.load();
 }
 function dispose(entry){entry.image?.removeAttribute('src');}
 function removeLink(entry){links.delete(entry.key);disposeVideo(entry);}
 function warm(entry){
  if(videosHeld||!activeLink(entry)||entry.key!==warmKey||!entry.source)return;
  const preview=entries.get(entry.key)?.preview,existing=warmed.get(entry.source);
  if(existing){if(preview)existing.poster=preview;return;}
  const video=createVideo();warmed.set(entry.source,video);
  video.preload='auto';video.muted=true;video.playsInline=true;if(preview)video.poster=preview;video.src=entry.source;
  video.onerror=()=>{if(activeLink(entry)&&warmed.get(entry.source)===video)removeLink(entry);};
  video.load();
 }
 function update(items,current,{width,height,compact=false}={}) {
  const windowItems=reviewPreviewWindow(items,current,compact),ahead=windowItems.filter(item=>item.mediaKey!==current?.mediaKey);
  const photos=ahead.filter(item=>item.type!=='video'),videos=ahead.filter(item=>item.type==='video');
  warmKey=videos[0]?.mediaKey||null;
  for(const entry of links.values())if(entry.key!==warmKey&&entry.key!==current?.mediaKey)disposeVideo(entry);
  const wanted=new Map();
  for(const item of [...(current?[current]:[]),...photos,...videos]){
   try{const url=previewURL(item.thumbUrl,{width,height});wanted.set(item.mediaKey,{item,url});}catch{}
  }
  for(const [key,entry] of entries)if(wanted.get(key)?.url!==entry.preview){entries.delete(key);dispose(entry);}
  for(const [key,entry] of links)if(!wanted.has(key))removeLink(entry);
  for(const {item,url} of [...photos,...videos].map(item=>wanted.get(item.mediaKey)).filter(Boolean)){
   if(entries.has(item.mediaKey)&&(item.type!=='video'||links.has(item.mediaKey))){warm(links.get(item.mediaKey)||{});continue;}
   const previous=entries.get(item.mediaKey);if(previous)dispose(previous);
   const entry={key:item.mediaKey,preview:url};entries.set(entry.key,entry);
   Promise.resolve().then(async()=>{
    if(!active(entry))return;
    const image=createImage();entry.image=image;image.src=url;
    const decoded=image.decode();
    let link=links.get(item.mediaKey);
    if(item.type==='video'&&!link){
     link={key:item.mediaKey};links.set(link.key,link);
     link.request=(async()=>{
      const result=await videoURL(item.mediaKey);
      if(!activeLink(link))return;
      const source=playbackURL(result.url);link.source=source;warm(link);
      return source;
     })().catch(()=>{if(activeLink(link)){removeLink(link);const preview=entries.get(link.key);if(preview){entries.delete(link.key);dispose(preview);}}});
    }
    if(link)warm(link);
    await Promise.all([decoded,link?.request]);
    if(active(entry))entry.ready=true;
   }).catch(()=>{if(active(entry)){entries.delete(entry.key);dispose(entry);}});
  }
 }
 function holdVideos(held){videosHeld=held;const link=links.get(warmKey);if(!held&&link)warm(link);}
 return {update,holdVideos,take(key,url){const entry=entries.get(key);if(!entry?.ready||entry.preview!==url)return null;entries.delete(key);return entry.image;},cancelVideos(){warmKey=null;for(const entry of links.values())disposeVideo(entry);},takeVideo(key){const source=links.get(key)?.source,video=warmed.get(source);if(!video)return null;warmed.delete(source);return video;},videoSource:key=>links.get(key)?.source||links.get(key)?.request,clear(items=[],size){const wanted=new Map();for(const item of items){try{wanted.set(item.mediaKey,previewURL(item.thumbUrl,size));}catch{}}for(const [key,entry] of entries){if(wanted.get(key)===entry.preview)continue;entries.delete(key);dispose(entry);}for(const [key,entry] of links)if(!wanted.has(key))removeLink(entry);}};
}
