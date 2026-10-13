export function createLocalThumbnails({refresh,stale,scope=()=>'',placeholder}) {
 const cache=new Map(),pending=new Map();
 async function resolve(item,force=false) {
  const key=`${scope()}:${item.mediaKey}`,local=cache.get(key);
  if(!force&&local&&!stale(local))return local;
  if(!force&&!stale(item)&&item.thumbUrl){cache.set(key,item);if(cache.size>512)cache.delete(cache.keys().next().value);return item;}
  if(pending.has(key))return pending.get(key);
  const request=Promise.resolve().then(()=>refresh(item)).then(fresh=>{cache.delete(key);cache.set(key,fresh);if(cache.size>512)cache.delete(cache.keys().next().value);return fresh;});
  pending.set(key,request);
  try{return await request;}finally{pending.delete(key);}
 }
 function bind(image,item,source) {
  let retried=false,refreshing=false,failed=false,currentSource;
  const fail=()=>{if(failed)return;failed=true;image.onerror=null;placeholder(image,item);};
  image.onerror=async()=>{
   if(failed||refreshing)return;
   if(retried){fail();return;}
   retried=true;refreshing=true;
   try{const fresh=await resolve(item,true);if(!failed){const nextSource=source(fresh);if(nextSource===currentSource)fail();else{currentSource=nextSource;image.src=nextSource;}}}catch{fail();}finally{refreshing=false;}
  };
  const ready=resolve(item).then(fresh=>{if(!failed){currentSource=source(fresh);image.src=currentSource;}},fail);
  return ready;
 }
 return {resolve,bind};
}
