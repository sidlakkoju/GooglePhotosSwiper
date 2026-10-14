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
