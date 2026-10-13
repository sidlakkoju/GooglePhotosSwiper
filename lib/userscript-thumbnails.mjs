export function createLocalThumbnails({refresh,stale,scope=()=>'',placeholder}) {
 const cache=new Map(),pending=new Map(),retriedKeys=new Set(),failedKeys=new Map();
 async function resolve(item,force=false) {
  const key=`${scope()}:${item.mediaKey}`;
  const failure=failedKeys.get(key);
  if(failure&&item.thumbUrl&&item.thumbUrl!==failure.thumbUrl&&item.thumbUrl!==failure.originalUrl&&!stale(item)){failedKeys.delete(key);retriedKeys.delete(key);cache.delete(key);}
  else if(failure)throw Error('Thumbnail unavailable');
  const local=cache.get(key);
  if(pending.has(key))return pending.get(key);
  if(!force&&local&&!stale(local))return local;
  if(!force&&!stale(item)&&item.thumbUrl){cache.set(key,item);if(cache.size>512)cache.delete(cache.keys().next().value);return item;}
  if(force)retriedKeys.add(key);
  const request=Promise.resolve().then(()=>refresh(item)).then(fresh=>{cache.delete(key);cache.set(key,fresh);if(cache.size>512)cache.delete(cache.keys().next().value);return fresh;});
  pending.set(key,request);
  try{return await request;}finally{pending.delete(key);}
 }
 function bind(image,item,source) {
  const key=`${scope()}:${item.mediaKey}`;
  let refreshing=false,failed=false,currentSource;
  const fail=()=>{if(failed)return;failed=true;failedKeys.set(key,{thumbUrl:(cache.get(key)||item).thumbUrl,originalUrl:item.thumbUrl});image.onerror=null;placeholder(image,item);};
  image.onerror=async()=>{
   if(failed||refreshing)return;
   if(retriedKeys.has(key)&&!pending.has(key)){
    const fresh=cache.get(key),nextSource=fresh&&source(fresh);
    if(failedKeys.has(key)||!nextSource||nextSource===currentSource)fail();
    else{currentSource=nextSource;image.src=nextSource;}
    return;
   }
   refreshing=true;
   try{const fresh=await resolve(item,true);if(!failed){const nextSource=source(fresh);if(nextSource===currentSource)fail();else{currentSource=nextSource;image.src=nextSource;}}}catch{fail();}finally{refreshing=false;}
  };
  const ready=resolve(item).then(fresh=>{if(failedKeys.has(key)){fail();return;}if(!failed){currentSource=source(fresh);image.src=currentSource;}},fail);
  return ready;
 }
 return {resolve,bind};
}
