export const SHARE_LIMIT_BYTES=300e6;

export async function downloadShareFile({window,fetch,source,name,video,signal,onProgress=()=>{}}) {
 let response;
 try{response=await fetch(source,{credentials:'include',signal});}
 catch(error){if(error?.name==='AbortError')throw error;response=await fetch(source,{credentials:'omit',signal});}
 if(!response.ok)throw Error('Unavailable');
 const header=Number(response.headers?.get?.('content-length'))||0,total=header>0?header:null;
 const declared=String(response.headers?.get?.('content-type')||'').split(';')[0].trim();
 let blob;
 const reader=response.body?.getReader?.();
 if(reader){
  const chunks=[];let loaded=0;
  onProgress(0,total);
  for(;;){
   const {done,value}=await reader.read();
   if(done)break;
   chunks.push(value);loaded+=value.byteLength;
   if(loaded>SHARE_LIMIT_BYTES){reader.cancel?.().catch?.(()=>{});throw Error('Too large');}
   onProgress(loaded,total&&Math.max(total,loaded));
  }
  blob=new window.Blob(chunks,declared?{type:declared}:{});
 }else{blob=await response.blob();onProgress(blob.size,blob.size);}
 if(!blob.size||blob.size>SHARE_LIMIT_BYTES)throw Error('Unavailable');
 const type=blob.type||declared||(video?'video/mp4':'image/jpeg');
 const extension={'image/png':'png','image/webp':'webp','image/heic':'heic','image/gif':'gif','video/quicktime':'mov','video/webm':'webm','video/mp4':'mp4'}[type]||(video?'mp4':'jpg');
 const file=new window.File([blob],`${String(name||'photo').replace(/\.[^.]+$/,'')}.${extension}`,{type});
 if(window.navigator?.canShare&&!window.navigator.canShare({files:[file]}))throw Error('Unsupported');
 return file;
}

export function shareFraction(entries) {
 let loaded=0,total=0,unknown=false,active=false;
 for(const entry of entries){
  if(entry.state==='ready'){if(entry.file){loaded+=entry.file.size;total+=entry.file.size;}continue;}
  if(entry.state!=='downloading'&&entry.state!=='waiting')continue;
  active=true;
  if(entry.state==='waiting'||!entry.total){unknown=true;continue;}
  loaded+=entry.loaded;total+=entry.total;
 }
 if(!active)return null;
 if(unknown&&!total)return {fraction:null};
 return {fraction:total?Math.min(1,loaded/total):null};
}

export function createShareQueue({download,onChange=()=>{},concurrency=2,AbortController}) {
 const entries=new Map();
 const changed=()=>onChange([...entries.values()]);
 const pump=()=>{
  let running=[...entries.values()].filter(entry=>entry.state==='downloading').length;
  for(const entry of entries.values()){
   if(running>=concurrency)break;
   if(entry.state!=='waiting')continue;
   running++;start(entry);
  }
 };
 const start=entry=>{
  const controller=AbortController?new AbortController():null;
  entry.state='downloading';entry.loaded=0;entry.total=null;entry.error=null;entry.controller=controller;
  const token=entry.token=(entry.token||0)+1;
  Promise.resolve().then(()=>download(entry.item,{signal:controller?.signal,onProgress:(loaded,total)=>{if(entry.token!==token||entries.get(entry.key)!==entry)return;entry.loaded=loaded;entry.total=total||null;changed();}})).then(file=>{
   if(entry.token!==token||entries.get(entry.key)!==entry)return;
   entry.state='ready';entry.file=file;entry.loaded=entry.total=file.size;entry.controller=null;changed();pump();
  },error=>{
   if(entry.token!==token||entries.get(entry.key)!==entry)return;
   entry.state='failed';entry.error=error;entry.controller=null;changed();pump();
  });
 };
 return {
  get(key){return entries.get(key)||null;},
  list(){return [...entries.values()];},
  add(item,{kept=false}={}){
   let entry=entries.get(item.mediaKey);
   if(entry){if(kept)entry.kept=true;if(entry.state==='failed'){entry.state='waiting';pump();}changed();return entry;}
   entry={key:item.mediaKey,item,state:'waiting',loaded:0,total:null,file:null,error:null,kept,addedAt:Date.now()};
   entries.set(item.mediaKey,entry);pump();changed();return entry;
  },
  keep(key){const entry=entries.get(key);if(entry&&!entry.kept){entry.kept=true;changed();}return entry||null;},
  retry(key){const entry=entries.get(key);if(entry?.state==='failed'){entry.state='waiting';pump();changed();}},
  remove(key){const entry=entries.get(key);if(!entry)return;entries.delete(key);entry.token=(entry.token||0)+1;entry.controller?.abort?.();entry.controller=null;pump();changed();}
 };
}
