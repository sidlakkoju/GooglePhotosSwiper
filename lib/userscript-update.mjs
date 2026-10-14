export const updateOrigin='https://photoswiper-sync.sidlakkoju.workers.dev';
export const updateTargetKey='photoswiper-update-target';
export const openAfterUpdateKey='photoswiper-open-after-update';
export function releaseNewer(candidate,current){
 const parse=value=>/^(\d+)\.(\d+)\.(\d+)$/.exec(value)?.slice(1).map(Number);
 const a=parse(candidate),b=parse(current);
 if(!a||!b)return false;
 for(let index=0;index<3;index++)if(a[index]!==b[index])return a[index]>b[index];
 return false;
}
export async function availableUpdate({fetch,version,setTimeout,clearTimeout,timeout=3000}){
 if(typeof fetch!=='function')return null;
 let timer;
 try{
  const response=await Promise.race([fetch(updateOrigin+'/version?t='+Date.now(),{method:'GET'}),new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Update check timed out')),timeout);})]);
  if(!response?.ok)return null;
  const latest=(await response.json())?.version;
  return releaseNewer(latest,version)?latest:null;
 }catch{return null;}finally{clearTimeout(timer);}
}
export function downloadRelease({GM,version,setTimeout,clearTimeout,timeout=30000}){
 const request=GM?.xmlHttpRequest?.bind(GM),store=GM?.setValue?.bind(GM);
 if(typeof request!=='function'||typeof store!=='function')return Promise.resolve(false);
 return new Promise(resolve=>{
  let settled=false;
  const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);resolve(value);};
  const timer=setTimeout(()=>finish(false),timeout);
  const loaded=async response=>{
   try{
    const headers=response?.responseHeaders||'';
    const served=/^x-photoswiper-version:\s*(\S+)/im.exec(headers)?.[1],required=/^x-photoswiper-required-loader-version:\s*(\S+)/im.exec(headers)?.[1];
    if(response.status!==200||served!==version||!response.responseText?.trim()){finish(false);return;}
    await store('photoswiper-app',{code:response.responseText,version,...(required?{requiredLoaderVersion:required}:{})});
    finish(true);
   }catch{finish(false);}
  };
  try{const result=request({method:'GET',url:updateOrigin+'/app.js?t='+Date.now(),timeout,onload:loaded,onerror:()=>finish(false),ontimeout:()=>finish(false),onabort:()=>finish(false)});result?.then?.(loaded,()=>finish(false));}catch{finish(false);}
 });
}
export function claimUpdateReload(storage,latest){
 try{
  if(storage.getItem(updateTargetKey)===latest)return false;
  storage.setItem(updateTargetKey,latest);
  storage.setItem(openAfterUpdateKey,'1');
  return true;
 }catch{return false;}
}
export function consumeOpenAfterUpdate(storage){
 try{
  const pending=storage.getItem(openAfterUpdateKey)==='1';
  storage.removeItem(openAfterUpdateKey);
  return pending;
 }catch{return false;}
}
