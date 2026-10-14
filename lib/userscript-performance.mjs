export function previewURL(value,{width=512,height=512,dpr=1,mobile=false,expanded=false,authuser='0',video=false}={}) {
 const url=new URL(value);
 if(url.protocol!=='https:'||!(url.hostname==='photos.fife.usercontent.google.com'||url.hostname.endsWith('.googleusercontent.com'))||url.username||url.password||url.port)throw Error('Unexpected preview host.');
 if(!video){
  const ratio=Math.min(dpr||1,2),pixels=Math.ceil(Math.max(width,height)*ratio);
  const bucket=[512,768,1024,1600].find(size=>size>=pixels)||1600;
  const size=mobile?Math.min(bucket,1024):bucket;
  url.pathname=url.pathname.replace(/=.+$/,'')+(expanded?`=w${Math.min(Math.ceil(width*ratio),mobile?1024:Infinity)}-h${Math.min(Math.ceil(height*ratio),mobile?1024:Infinity)}-k-no`:`=w${size}-h${size}-k-no`);
  url.searchParams.set('authuser',authuser);
 }
 return url.href;
}
export function cardPreviewURL(value,{width,height,authuser='0'}={}) {
 const url=new URL(previewURL(value,{authuser}));
 url.pathname=url.pathname.replace(/=.+$/,'')+`=w${Math.max(1,Math.ceil(width))}-h${Math.max(1,Math.ceil(height))}-k-no`;
 return url.href;
}
export function reusablePreview(element,source) {
 return element?.src===source&&element.complete&&element.naturalWidth>0?element:null;
}
export function pendingPreview(element,source) {
 return element?.src===source&&!element.complete?element:null;
}
export function createPreloadBuffer({load,source=item=>item.thumbUrl,concurrency=2,size=3}) {
 const entries=new Map();let active=0;
 function pump(){
  for(const entry of entries.values()){
   if(active>=concurrency)break;
   if(entry.state!=='queued')continue;
   entry.state='loading';active++;
   Promise.resolve().then(()=>load(entry.item,entry.controller.signal,entry.source)).then(el=>{
    if(entries.get(entry.key)===entry&&!entry.controller.signal.aborted){entry.el=el;entry.state='ready';}
   },()=>{entry.state='failed';}).finally(()=>{active--;pump();});
  }
 }
 const drop=(key,entry)=>{entry.controller.abort();if(entry.el)entry.el.src='';entries.delete(key);};
 const current=(entry,item)=>entry.item.thumbUrl===item.thumbUrl&&entry.source===source(item);
 function update(items,previous,keep){
  const wanted=items.slice(0,size),keys=new Set(wanted.map(item=>item.mediaKey));
  if(previous)keys.add(previous);
  if(keep)keys.add(keep);
  for(const [key,entry] of entries)if(!keys.has(key))drop(key,entry);
  for(const item of wanted){
   const entry=entries.get(item.mediaKey);
   if(entry&&entry.state!=='failed'&&current(entry,item))continue;
   if(entry)drop(item.mediaKey,entry);
   entries.set(item.mediaKey,{key:item.mediaKey,item,source:source(item),state:'queued',controller:new AbortController()});
  }
  pump();
 }
 function clear(items=[]){const wanted=new Map(items.map(item=>[item.mediaKey,item]));for(const [key,entry] of entries){if(wanted.has(key)&&current(entry,wanted.get(key)))continue;drop(key,entry);}}
 return {update,clear,retain(item,el){const existing=entries.get(item.mediaKey);if(existing?.el!==el)existing?.controller.abort();entries.set(item.mediaKey,{key:item.mediaKey,item,source:el.src,el,state:'ready',controller:new AbortController()});},get:key=>entries.get(key)?.state==='ready'?entries.get(key).el:null,take(key,wanted){const entry=entries.get(key);if(entry?.state!=='ready'||(wanted!==undefined&&entry.source!==wanted))return null;entries.delete(key);return entry.el;},entries};
}
export function createWriteQueue({write,snapshot,committed,error=()=>{}}) {
 let pending=false,running=null;
 function flush(){
  if(running)return running;
  if(!pending)return Promise.resolve();
  running=Promise.resolve().then(async()=>{
   while(pending){
    pending=false;
    try{const value=snapshot();const started=Date.now();const saved=await write(value);committed(saved,value,Date.now()-started);}
    catch(failure){pending=true;error(failure);break;}
   }
  }).finally(()=>{running=null;});
  return running;
 }
 return {enqueue(){pending=true;return flush();},flush,get flushing(){return !!running;},get pending(){return pending;}};
}
