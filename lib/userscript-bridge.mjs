import {photosOperation} from '../extension/photos-api.js';
export function createPagePhotosBridge({window,document,crypto,setTimeout,clearTimeout}) {
 const channel=crypto.randomUUID();
 const pending=new Map();
 window.addEventListener('message',event=>{
  if(event.source!==window||event.data?.channel!==channel||!['photos-result','photos-accepted'].includes(event.data?.kind))return;
  const entry=pending.get(event.data.id);
  if(!entry)return;
  clearTimeout(entry.timer);
  if(event.data.kind==='photos-accepted')return;
  pending.delete(event.data.id);entry.resolve(event.data.result);
 });
 const script=document.createElement('script');
 const nonce=document.querySelector('script[nonce]')?.nonce;
 if(nonce)script.setAttribute('nonce',nonce);
 script.textContent=`(${function(channel,operation){
  window.addEventListener('message',async event=>{
   if(event.source!==window||event.data?.channel!==channel||event.data?.kind!=='photos-call')return;
   const {id,name,args}=event.data;
   window.postMessage({channel,kind:'photos-accepted',id},location.origin);
   const result=await operation(name,args);
   window.postMessage({channel,kind:'photos-result',id,result},location.origin);
  });
 }.toString()})(${JSON.stringify(channel)},${photosOperation.toString()});`;
 document.documentElement.append(script);script.remove();
 return (name,args={})=>new Promise(resolve=>{
  const id=crypto.randomUUID();
  const timer=setTimeout(()=>{pending.delete(id);resolve({ok:false,error:'Google Photos page bridge unavailable. Reload or check userscript injection permissions.'});},35000);
  pending.set(id,{resolve,timer});
  window.postMessage({channel,kind:'photos-call',id,name,args},'https://photos.google.com');
 });
}
