export function createLocalThumbnails({refresh,stale,scope=()=>'',placeholder}) {
 const cache=new Map(),pending=new Map(),retriedKeys=new Set(),failedKeys=new Map();
 async function resolve(item,force=false) {
  const key=`${scope()}:${item.mediaKey}`;
  const failure=failedKeys.get(key);
  if(failure&&item.thumbUrl&&item.thumbUrl!==failure.thumbUrl&&item.thumbUrl!==failure.originalUrl&&!stale(item)){failedKeys.delete(key);retriedKeys.delete(key);cache.delete(key);}
  else if(failure)throw Error('Thumbnail unavailable');
  const local=cache.get(key);
  if(pending.has(key)){const active=pending.get(key);if(!force&&item.thumbUrl&&item.thumbUrl!==active.item.thumbUrl&&!stale(item)){retriedKeys.delete(key);cache.set(key,item);return item;}return active.request;}
  if(!force&&local&&!stale(local))return local;
  if(!force&&!stale(item)&&item.thumbUrl){cache.set(key,item);if(cache.size>512)cache.delete(cache.keys().next().value);return item;}
  if(force)retriedKeys.add(key);
  const request=Promise.resolve().then(()=>refresh(item)).then(fresh=>{if(cache.has(key)&&cache.get(key)!==local)return cache.get(key);cache.delete(key);cache.set(key,fresh);if(cache.size>512)cache.delete(cache.keys().next().value);return fresh;},error=>{if(!cache.has(key)||cache.get(key)===local)retriedKeys.delete(key);throw error;});
  pending.set(key,{request,item});
  try{return await request;}finally{pending.delete(key);}
 }
 function bind(image,item,source) {
  const key=`${scope()}:${item.mediaKey}`;
  let refreshing=false,failed=false,currentSource,currentItem;
  const fail=(remember=true)=>{if(failed)return;failed=true;if(remember&&currentItem&&cache.get(key)?.thumbUrl===currentItem.thumbUrl)failedKeys.set(key,{thumbUrl:currentItem.thumbUrl,originalUrl:item.thumbUrl});image.onerror=null;placeholder(image,item);};
  image.onerror=async()=>{
   if(failed||refreshing)return;
   if(retriedKeys.has(key)&&!pending.has(key)){
    const fresh=cache.get(key),nextSource=fresh&&source(fresh);
    if(failedKeys.has(key)||!nextSource||nextSource===currentSource)fail();
    else{currentItem=fresh;currentSource=nextSource;image.src=nextSource;}
    return;
   }
   refreshing=true;
   try{const fresh=await resolve(item,true);if(!failed){const nextSource=source(fresh);if(nextSource===currentSource)fail();else{currentItem=fresh;currentSource=nextSource;image.src=nextSource;}}}catch{fail(false);}finally{refreshing=false;}
  };
  const ready=resolve(item).then(fresh=>{if(failedKeys.has(key)){fail();return;}if(!failed){currentItem=fresh;currentSource=source(fresh);image.src=currentSource;}},()=>fail(false));
  return ready;
 }
 return {resolve,bind};
}
