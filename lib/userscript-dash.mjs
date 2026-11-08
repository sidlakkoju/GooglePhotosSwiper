const streamSuffixes={dash:'=mm,dash-vm-vf,dr.sdr,sdrCodec.vp9.h264',hls:'=mm,hls-vm-vf,dr.sdr,sdrCodec.vp9.h264'};
export function streamURL(value,kind='dash'){const url=new URL(value);url.pathname=url.pathname.replace(/=.+$/,'')+streamSuffixes[kind];return url.href;}
const decodeEntities=value=>value.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'");
const dashAttribute=(tag,name)=>{const match=tag.match(new RegExp(`\\s${name}="([^"]*)"`));return match?decodeEntities(match[1]):'';};
const dashSeconds=value=>{const match=/^P(?:\d+D)?T?(?:([\d.]+)H)?(?:([\d.]+)M)?(?:([\d.]+)S)?$/.exec(value||'');return match?(+match[1]||0)*3600+(+match[2]||0)*60+(+match[3]||0):0;};
const dashTimeline=block=>{
 const list=block.match(/<SegmentList[^>]*>/)?.[0]||block.match(/<SegmentTemplate[^>]*>/)?.[0]||'',scale=+dashAttribute(list,'timescale')||1,times=[];let at=0;
 for(const entry of block.match(/<S\s[^>]*>/g)||[]){const start=dashAttribute(entry,'t');if(start)at=+start;const length=+dashAttribute(entry,'d'),repeat=+dashAttribute(entry,'r')||0;if(!(length>0))break;for(let count=0;count<=repeat;count++){times.push([at/scale,(at+length)/scale]);at+=length;}}
 return times;
};
export function parseDashManifest(text,base){
 const head=text.match(/<MPD[^>]*>/)?.[0]||'',duration=dashSeconds(dashAttribute(head,'mediaPresentationDuration')),tracks=[];
 for(const set of text.match(/<AdaptationSet[\s\S]*?<\/AdaptationSet>/g)||[]){
  const opening=set.match(/<AdaptationSet[^>]*>/)[0],representations=set.match(/<Representation[\s\S]*?<\/Representation>/g)||[],shared=dashTimeline(set.replace(/<Representation[\s\S]*?<\/Representation>/g,''));
  for(const block of representations){
   const tag=block.match(/<Representation[^>]*>/)[0],mime=dashAttribute(tag,'mimeType')||dashAttribute(opening,'mimeType'),root=new URL(decodeEntities(block.match(/<BaseURL>([^<]*)<\/BaseURL>/)?.[1]||''),base).href;
   const init=dashAttribute(block.match(/<Initialization[^>]*>/)?.[0]||'','sourceURL'),media=(block.match(/<SegmentURL[^>]*>/g)||[]).map(entry=>dashAttribute(entry,'media'));
   if(!mime||!init||!media.length||media.some(value=>!value))continue;
   const own=dashTimeline(block),times=own.length?own:shared,step=duration/media.length;
   tracks.push({id:dashAttribute(tag,'id'),kind:mime.split('/')[0],mime,codecs:dashAttribute(tag,'codecs')||dashAttribute(opening,'codecs'),width:+dashAttribute(tag,'width')||0,height:+dashAttribute(tag,'height')||0,bandwidth:+dashAttribute(tag,'bandwidth')||0,init:new URL(init,root).href,segments:media.map((value,index)=>({url:new URL(value,root).href,start:times[index]?.[0]??index*step,end:times[index]?.[1]??(index+1)*step}))});
  }
 }
 return {duration:duration||Math.max(0,...tracks.map(track=>track.segments.at(-1).end)),tracks};
}
const dashLongSide=track=>Math.max(track.width,track.height);
export function chooseTracks(tracks,{supported,need=1920}){
 const usable=tracks.filter(track=>{try{return !!supported(`${track.mime}; codecs="${track.codecs}"`);}catch{return false;}});
 const videos=usable.filter(track=>track.kind==='video'&&dashLongSide(track)>0).sort((a,b)=>dashLongSide(a)-dashLongSide(b)||(b.mime==='video/mp4')-(a.mime==='video/mp4')||a.bandwidth-b.bandwidth);
 if(!videos.length)return [];
 const size=dashLongSide(videos.find(track=>dashLongSide(track)>=need)||videos.at(-1)),video=videos.find(track=>dashLongSide(track)===size);
 const audio=usable.filter(track=>track.kind==='audio').sort((a,b)=>b.bandwidth-a.bandwidth)[0];
 return audio?[video,audio]:[video];
}
const bufferedReach=(ranges,time)=>{let end=time;for(let index=0;index<(ranges?.length||0);index++){const start=ranges.start(index),stop=ranges.end(index);if(start<=end+.3&&stop>end)end=stop;}return end;};
export function attachDash({video,url,window,fetch,need=1920,ahead=15,startTime=()=>0,onFail=()=>{}}){
 const Source=window.MediaSource;
 if(typeof Source?.isTypeSupported!=='function'||typeof window.URL?.createObjectURL!=='function'||typeof fetch!=='function')return false;
 const source=new Source(),address=window.URL.createObjectURL(source),states=[],aborted=new Error('aborted');
 let stopped=false,ready=false,duration=0;
 const pause=delay=>new Promise(resolve=>setTimeout(resolve,delay));
 const get=async(target,state,credentials='omit',tries=3)=>{
  for(let attempt=0;;attempt++){
   const controller=new window.AbortController();let timedOut=false;
   const timer=setTimeout(()=>{timedOut=true;controller.abort();},20000);
   if(state)state.abort=()=>controller.abort();
   try{
    const response=await fetch(target,{credentials,signal:controller.signal});
    if(!response.ok){const error=new Error(`HTTP ${response.status}`);error.final=response.status===404||response.status===410;throw error;}
    return credentials==='include'?await response.text():new Uint8Array(await response.arrayBuffer());
   }catch(error){
    if(stopped||(controller.signal.aborted&&!timedOut))throw aborted;
    if(error.final||attempt>=tries-1)throw error;
   }finally{clearTimeout(timer);if(state)state.abort=null;}
   await pause(1000*2**attempt);if(stopped)throw aborted;
  }
 };
 const manifest=get(streamURL(url),null,'include',1);manifest.catch(()=>{});
 const stop=()=>{
  if(stopped)return;stopped=true;
  for(const state of states)state.abort?.();
  video.removeEventListener('seeking',pump);video.removeEventListener('timeupdate',pump);video.removeEventListener('waiting',pump);
  try{window.URL.revokeObjectURL(address);}catch{}
  if(video.detachAdaptive===stop)delete video.detachAdaptive;
 };
 const fail=state=>{if(stopped)return;if(state&&onFail()===false){state.blockedUntil=Date.now()+5000;setTimeout(pump,5000);return;}stop();if(!state)onFail();};
 const settle=buffer=>new Promise((resolve,reject)=>{
  const done=()=>{buffer.removeEventListener('updateend',done);buffer.removeEventListener('error',broken);resolve();};
  const broken=()=>{buffer.removeEventListener('updateend',done);buffer.removeEventListener('error',broken);reject(new Error('append failed'));};
  buffer.addEventListener('updateend',done);buffer.addEventListener('error',broken);
 });
 const trim=async(state,hard)=>{
  const ranges=state.buffer.buffered,time=video.currentTime;if(!ranges.length)return;
  const first=ranges.start(0),last=ranges.end(ranges.length-1),keep=hard?2:20;
  if(time-keep>first+.5){state.buffer.remove(first,time-keep);await settle(state.buffer);}
  else if(hard&&last>time+ahead){state.buffer.remove(time+ahead,last);await settle(state.buffer);}
 };
 const append=async(state,data)=>{
  try{state.buffer.appendBuffer(data);}catch(error){if(error?.name!=='QuotaExceededError')throw error;await trim(state,true);state.buffer.appendBuffer(data);}
  await settle(state.buffer);
 };
 const finish=()=>{
  if(stopped||source.readyState!=='open'||states.some(state=>state.loading||state.buffer.updating))return;
  const time=video.currentTime;
  if(states.every(state=>bufferedReach(state.buffer.buffered,time)>=state.segments.at(-1).end-.3))try{source.endOfStream();}catch{}
 };
 const feed=state=>{
  const time=video.currentTime;
  if(state.loading){if(state.loading.end<time-.5||state.loading.start>time+ahead+5)state.abort?.();return;}
  if(state.buffer.updating||Date.now()<state.blockedUntil)return;
  const end=bufferedReach(state.buffer.buffered,time);
  if(end-time>=ahead){finish();return;}
  let index=state.segments.findIndex(segment=>segment.end>end+.1);
  if(index>=0&&index===state.done)index++;
  if(index<0||index>=state.segments.length){finish();return;}
  const segment=state.segments[index];state.loading=segment;
  get(segment.url,state).then(async data=>{if(stopped)throw aborted;await trim(state,false);await append(state,data);state.done=index;}).then(()=>{state.loading=null;pump();},error=>{state.loading=null;if(error===aborted){pump();return;}fail(state);});
 };
 function pump(){if(stopped||!ready)return;for(const state of states)feed(state);}
 source.addEventListener('sourceopen',async()=>{
  try{
   const text=await manifest;if(stopped)return;
   const parsed=parseDashManifest(text,streamURL(url)),picked=chooseTracks(parsed.tracks,{supported:type=>Source.isTypeSupported(type),need});
   if(!picked.length)throw new Error('no playable tracks');
   duration=parsed.duration;
   for(const track of picked)states.push({track,segments:track.segments,buffer:source.addSourceBuffer(`${track.mime}; codecs="${track.codecs}"`),loading:null,done:-1,blockedUntil:0});
   if(duration>0)source.duration=duration;
   const inits=await Promise.all(states.map(state=>get(state.track.init,state)));
   if(stopped)return;
   await Promise.all(states.map((state,index)=>append(state,inits[index])));
   if(stopped)return;
   const start=startTime();if(start>0&&(!duration||start<duration))video.currentTime=start;
   ready=true;
   for(const type of ['seeking','timeupdate','waiting'])video.addEventListener(type,pump);
   pump();
  }catch(error){if(error!==aborted)fail();}
 },{once:true});
 video.detachAdaptive=stop;
 video.addEventListener('emptied',()=>{if(video.src!==address)stop();});
 video.src=address;
 return true;
}
export function attachAdaptive({video,url,window,fetch,need,startTime,onFail}){
 if(attachDash({video,url,window,fetch,need,startTime,onFail}))return 'dash';
 if(video.canPlayType?.('application/vnd.apple.mpegurl')){video.src=streamURL(url,'hls');video.load();return 'hls';}
 return '';
}
