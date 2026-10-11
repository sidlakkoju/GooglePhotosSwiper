export const pinnedReleaseKey='wPP8HXN0V1jAGqFb+M5kQycKc9/sUrOm6YTKPJM+SLw=';
export const releaseMessage=release=>'photoswiper-release-v1\n'+release.version+'\n'+release.code;
export function compareVersions(left,right){
 const parse=value=>{
  const match=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.exec(value);
  if(!match)throw Error('Invalid release version');
  const pre=match[4]?.split('.');
  if(pre?.some(part=>/^\d+$/.test(part)&&part.length>1&&part[0]==='0'))throw Error('Invalid prerelease');
  return {parts:match.slice(1,4).map(BigInt),pre};
 };
 const a=parse(left),b=parse(right);
 for(let i=0;i<3;i++)if(a.parts[i]!==b.parts[i])return a.parts[i]>b.parts[i]?1:-1;
 if(!a.pre||!b.pre)return a.pre? -1:b.pre?1:0;
 for(let i=0;i<Math.max(a.pre.length,b.pre.length);i++){
  const x=a.pre[i],y=b.pre[i];
  if(x===y)continue;
  if(x===undefined||y===undefined)return x===undefined?-1:1;
  const nx=/^\d+$/.test(x),ny=/^\d+$/.test(y);
  if(nx&&ny)return BigInt(x)>BigInt(y)?1:-1;
  if(nx!==ny)return nx?-1:1;
  return x>y?1:-1;
 }
 return 0;
}
export async function verifyRelease(release,crypto,key=pinnedReleaseKey){
 try{
  if(!release||typeof release.version!=='string'||typeof release.code!=='string'||typeof release.signature!=='string')return false;
  compareVersions(release.version,release.version);
  const decode=value=>Uint8Array.from(atob(value),character=>character.charCodeAt(0));
  const publicKey=await crypto.subtle.importKey('raw',decode(key),{name:'Ed25519'},false,['verify']);
  return await crypto.subtle.verify('Ed25519',publicKey,decode(release.signature),new TextEncoder().encode(releaseMessage(release)));
 }catch{return false;}
}
export function fetchRelease(environment,request){
 return new Promise(resolve=>{
  let settled=false;
  const finish=value=>{if(settled)return;settled=true;environment.clearTimeout(timer);resolve(value);};
  const timer=environment.setTimeout(()=>finish(null),1500);
  try{
   const result=request({method:'GET',url:'https://photoswiper-sync.sidlakkoju.workers.dev/photoswiper-release.json?t='+Date.now(),timeout:1500,onload:response=>{try{finish(response.status===200?JSON.parse(response.responseText):null);}catch{finish(null);}},onerror:()=>finish(null),ontimeout:()=>finish(null),onabort:()=>finish(null)});
   result?.catch?.(()=>finish(null));
  }catch{finish(null);}
 });
}
export function injectRelease(environment,release){
 const document=environment.document,root=document.documentElement;
 if(root.dataset.psLoaded||root.dataset.psLoaderInjected)return false;
 const script=document.createElement('script'),nonce=document.querySelector('script[nonce]');
 if(nonce)script.nonce=nonce.nonce||nonce.getAttribute('nonce');
 let code=release.code;
 if(environment.trustedTypes)code=environment.trustedTypes.createPolicy('photoswiper-loader',{createScript:value=>value}).createScript(code);
 script.textContent=code;
 root.dataset.psLoaderInjected='1';
 try{(document.head||root).appendChild(script);}catch(error){delete root.dataset.psLoaderInjected;throw error;}
 script.remove();
 return true;
}
export async function startLoader(environment,key=pinnedReleaseKey){
 if(environment.document.documentElement.dataset.psLoaded||environment.document.documentElement.dataset.psLoaderInjected)return false;
 const gm=environment.GM;
 const get=gm?.getValue?.bind(gm)||environment.GM_getValue;
 const set=gm?.setValue?.bind(gm)||environment.GM_setValue;
 const request=gm?.xmlHttpRequest?.bind(gm)||environment.GM_xmlhttpRequest;
 let cached=null;
 try{cached=await get('photoswiper-signed-release',null);}catch{}
 const validCache=await verifyRelease(cached,environment.crypto,key);
 const latest=await fetchRelease(environment,request);
 let selected=validCache?cached:null;
 if(await verifyRelease(latest,environment.crypto,key)&&(!validCache||compareVersions(latest.version,cached.version)>=0)){
  selected={version:latest.version,code:latest.code,signature:latest.signature};
  try{await set('photoswiper-signed-release',selected);}catch{}
 }
 if(!selected)return false;
 return injectRelease(environment,selected);
}
