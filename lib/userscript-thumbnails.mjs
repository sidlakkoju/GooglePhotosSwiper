export function createLocalThumbnails({refresh,stale,scope=()=>'',placeholder}) {
 const cache=new Map(),pending=new Map(),retriedKeys=new Set(),failedKeys=new Map();
 async function resolve(item,force=false) {
  const key=`${scope()}:${item.mediaKey}`,local=cache.get(key);
  if(failedKeys.has(key))throw Error('Thumbnail unavailable');
  if(!force&&local&&!stale(local))return local;
  if(!force&&!stale(item)&&item.thumbUrl){cache.set(key,item);if(cache.size>512)cache.delete(cache.keys().next().value);return item;}
  if(pending.has(key))return pending.get(key);
  retriedKeys.add(key);
  const request=Promise.resolve().then(()=>refresh(item)).then(fresh=>{cache.delete(key);cache.set(key,fresh);if(cache.size>512)cache.delete(cache.keys().next().value);return fresh;});
  pending.set(key,request);
  try{return await request;}finally{pending.delete(key);}
 }
 function bind(image,item,source) {
  const key=`${scope()}:${item.mediaKey}`;
  let refreshing=false,failed=false,currentSource;
  const fail=()=>{if(failed)return;failed=true;failedKeys.set(key,cache.get(key)||item);image.onerror=null;placeholder(image,item);};
  image.onerror=async()=>{
   if(failed||refreshing)return;
   if(retriedKeys.has(key)&&!pending.has(key)){fail();return;}
   refreshing=true;
   try{const fresh=await resolve(item,true);if(!failed){const nextSource=source(fresh);if(nextSource===currentSource)fail();else{currentSource=nextSource;image.src=nextSource;}}}catch{fail();}finally{refreshing=false;}
  };
  const ready=resolve(item).then(fresh=>{if(failedKeys.has(key)){fail();return;}if(!failed){currentSource=source(fresh);image.src=currentSource;}},fail);
  return ready;
 }
 return {resolve,bind};
}
