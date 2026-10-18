// ==UserScript==
// @name Photos Swipe (signed test loader)
// @namespace https://github.com/sidlakkoju/GooglePhotosSwiper
// @version 1.2.170
// @description Fetch and verify signed Photos Swipe releases.
// @match https://photos.google.com/*
// @inject-into content
// @run-at document-idle
// @noframes
// @grant GM.xmlHttpRequest
// @grant GM.openInTab
// @grant GM.getValue
// @grant GM.setValue
// @grant GM.deleteValue
// @connect photoswiper-sync.sidlakkoju.workers.dev
// @grant unsafeWindow
// @grant GM_deleteValue
// @grant GM_xmlhttpRequest
// @grant GM_openInTab
// @grant GM_getValue
// @grant GM_setValue
// @downloadURL https://photoswiper-sync.sidlakkoju.workers.dev/photoswiper-loader.user.js
// @updateURL https://photoswiper-sync.sidlakkoju.workers.dev/photoswiper-loader.user.js
// ==/UserScript==

(async()=>{
const verifiedReleases=new WeakMap();
const loaderPolicies=new WeakMap();
const pinnedReleaseKey='wPP8HXN0V1jAGqFb+M5kQycKc9/sUrOm6YTKPJM+SLw=';
const releaseMessage=release=>'photoswiper-release-v1\n'+release.version+'\n'+release.code;
function compareVersions(left,right){
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
async function verifyRelease(release,crypto,key=pinnedReleaseKey){
 try{
  if(!release||typeof release.version!=='string'||typeof release.code!=='string'||typeof release.signature!=='string')return false;
  compareVersions(release.version,release.version);
  const decode=value=>Uint8Array.from(atob(value),character=>character.charCodeAt(0));
  const publicKey=await crypto.subtle.importKey('raw',decode(key),{name:'Ed25519'},false,['verify']);
  const message=releaseMessage(release),signature=release.signature;
  const verified=await crypto.subtle.verify('Ed25519',publicKey,decode(signature),new TextEncoder().encode(message));
  if(verified)verifiedReleases.set(release,{message,signature});
  return verified;
 }catch{return false;}
}
function fetchRelease(environment,request){
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
function injectRelease(environment,release){
 const document=environment.document,root=document.documentElement;
 if(root.dataset.psLoaded||root.dataset.psLoaderInjected)return false;
 const verified=verifiedReleases.get(release);
 if(!verified||verified.message!==releaseMessage(release)||verified.signature!==release.signature)return false;
 const gm=environment.GM||{getValue:environment.GM_getValue,setValue:environment.GM_setValue,deleteValue:environment.GM_deleteValue,xmlHttpRequest:environment.GM_xmlhttpRequest,openInTab:environment.GM_openInTab};
 if(!['getValue','setValue','deleteValue'].every(name=>typeof gm[name]==='function'))return false;
 let execute;
 try{
  let source='(function(GM,unsafeWindow,window,document,location,fetch,photosSwipeReleaseVersion){'+release.code+'\n})';
  const trustedTypes=environment.trustedTypes||environment.window.trustedTypes;
  if(trustedTypes){
   let policy=loaderPolicies.get(trustedTypes);
   if(!policy){
    policy=trustedTypes.createPolicy('photoswiper-loader-'+environment.crypto.randomUUID(),{createScript:input=>input});
    loaderPolicies.set(trustedTypes,policy);
   }
   source=policy.createScript(source);
  }
  execute=(0,environment.eval||eval)(source);
 }catch{delete root.dataset.psLoaderInjected;return false;}
 root.dataset.psLoaderInjected='1';
 try{execute(gm,environment.unsafeWindow||environment.window,environment.window,document,environment.location,environment.fetch,release.version);}catch(error){delete root.dataset.psLoaderInjected;throw error;}
 return true;
}
async function startLoader(environment,key=pinnedReleaseKey){
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
  verifiedReleases.set(selected,verifiedReleases.get(latest));
  try{await set('photoswiper-signed-release',selected);}catch{}
 }
 if(!selected)return false;
 return injectRelease(environment,selected);
}

await startLoader({document,window,location,crypto:window.crypto,setTimeout:window.setTimeout.bind(window),clearTimeout:window.clearTimeout.bind(window),fetch:fetch.bind(globalThis),unsafeWindow:typeof unsafeWindow==='undefined'?window:unsafeWindow,GM:typeof GM==='undefined'?undefined:GM,GM_getValue:typeof GM_getValue==='undefined'?undefined:GM_getValue,GM_setValue:typeof GM_setValue==='undefined'?undefined:GM_setValue,GM_deleteValue:typeof GM_deleteValue==='undefined'?undefined:GM_deleteValue,GM_xmlhttpRequest:typeof GM_xmlhttpRequest==='undefined'?undefined:GM_xmlhttpRequest,GM_openInTab:typeof GM_openInTab==='undefined'?undefined:GM_openInTab});
})();
