// ==UserScript==
// @name Photos Swipe
// @author sidlakkoju
// @namespace https://github.com/sidlakkoju/GooglePhotosSwiper
// @version 1.2.79
// @description Review Google Photos with local swipe decisions and verified review albums. RPC formats adapted from Google Photos Toolkit by xob0t.
// @match https://photos.google.com/*
// @run-at document-idle
// @grant GM.xmlHttpRequest
// @grant GM_info
// @grant GM_xmlhttpRequest
// @grant GM_getValue
// @grant GM_setValue
// @grant GM_deleteValue
// @connect photoswiper-sync.sidlakkoju.workers.dev
// @grant GM.getValue
// @grant GM.setValue
// @grant GM.deleteValue
// @grant GM.openInTab
// @grant unsafeWindow
// @inject-into content
// @noframes
// @updateURL https://photoswiper-sync.sidlakkoju.workers.dev/photoswiper.user.js
// @downloadURL https://photoswiper-sync.sidlakkoju.workers.dev/photoswiper.user.js
// @license MIT
// ==/UserScript==

(async()=>{
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
const loaderAPIVersion='1.0.0';
const appOrigin='https://photoswiper-sync.sidlakkoju.workers.dev';
const appPolicies=new WeakMap();
function showUpdateBanner(environment,version){
 if(version!==undefined){try{if(compareVersions(version,loaderAPIVersion)<=0)return false;}catch{return false;}}
 const document=environment.document;
 if(document.getElementById('photoswiper-update'))return false;
 const banner=document.createElement('a');
 banner.id='photoswiper-update';banner.textContent='Update available - tap to update Photos Swipe';
 banner.href=appOrigin+'/photoswiper.user.js';banner.target='_blank';banner.rel='noopener noreferrer';
 banner.style.cssText='position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#1967d2;color:white;padding:16px;text-align:center;font:16px system-ui;text-decoration:none;';
 (document.body||document.documentElement).appendChild(banner);
 return true;
}
function requestPath(environment,request,path,timeout,parse){
 return new Promise(resolve=>{
  let settled=false;
  const finish=value=>{if(settled)return;settled=true;environment.clearTimeout(timer);resolve(value);};
  const timer=environment.setTimeout(()=>finish(null),timeout);
  const loaded=response=>{try{finish(parse(response));}catch{finish(null);}};
  try{const result=request({method:'GET',url:appOrigin+path+'?t='+Date.now(),timeout,onload:loaded,onerror:()=>finish(null),ontimeout:()=>finish(null),onabort:()=>finish(null)});result?.then?.(loaded,()=>finish(null));}catch{finish(null);}
 });
}
function requestVersion(environment,request,timeout=3000){
 return requestPath(environment,request,'/version',timeout,response=>{
  if(response.status!==200)return null;
  const value=JSON.parse(response.responseText);
  compareVersions(value.version,value.version);
  if(value.requiredLoaderVersion!==undefined)compareVersions(value.requiredLoaderVersion,value.requiredLoaderVersion);
  return {version:value.version,...(value.requiredLoaderVersion===undefined?{}:{requiredLoaderVersion:value.requiredLoaderVersion})};
 });
}
function requestApp(environment,request,timeout=30000){
 return requestPath(environment,request,'/app.js',timeout,response=>{
  const version=/^x-photoswiper-version:\s*(\S+)/im.exec(response.responseHeaders||'')?.[1];
  compareVersions(version,version);
  const requiredLoaderVersion=/^x-photoswiper-required-loader-version:\s*(\S+)/im.exec(response.responseHeaders||'')?.[1];
  if(requiredLoaderVersion!==undefined)compareVersions(requiredLoaderVersion,requiredLoaderVersion);
  return response.status===200&&response.responseText?.trim()?{code:response.responseText,version,...(requiredLoaderVersion===undefined?{}:{requiredLoaderVersion})}:null;
 });
}
function executeApp(environment,app){
 const root=environment.document.documentElement;
 if(root.dataset.psLoaded||root.dataset.psLoaderInjected)return false;
 const gm=environment.GM||{getValue:environment.GM_getValue,setValue:environment.GM_setValue,deleteValue:environment.GM_deleteValue};
 const page=environment.unsafeWindow||environment.window;
 const source='(function(GM,unsafeWindow,window,document,location,fetch,photosSwipeReleaseVersion){'+app.code+'\n})';
 let trusted=source,execute;
 try{
  const types=environment.trustedTypes||environment.window.trustedTypes||page.trustedTypes;
  if(types){let policy=appPolicies.get(types);if(!policy){for(const name of ['photoswiper-auto-loader','photoswiper-auto-loader-'+environment.crypto.randomUUID()]){try{policy=types.createPolicy(name,{createScript:value=>value});break;}catch{}}if(policy)appPolicies.set(types,policy);}if(policy)trusted=policy.createScript(source);}
  try{execute=(0,environment.eval||eval)(trusted);}catch{
   const key='__photoswiperExecute'+environment.crypto.randomUUID().replaceAll('-','');
   const script=environment.document.createElement('script');
   const nonce=environment.document.querySelector('script[nonce]')?.nonce;
   if(nonce)script.nonce=nonce;
   try{script.text=appPolicies.get(types)?appPolicies.get(types).createScript('window['+JSON.stringify(key)+']='+source+';'):'window['+JSON.stringify(key)+']='+source+';';(environment.document.head||root).appendChild(script);execute=page[key];}finally{delete page[key];script.remove();}
  }
  if(typeof execute!=='function')return false;
 }catch{return false;}
 root.dataset.psLoaderInjected='1';
 try{execute(gm,page,environment.window,environment.document,environment.location,environment.fetch,app.version);}catch(error){delete root.dataset.psLoaderInjected;throw error;}
 return true;
}
async function startAutoLoader(environment){
 const root=environment.document.documentElement,started=()=>root.dataset.psLoaded||root.dataset.psLoaderInjected;
 if(started())return false;
 const gm=environment.GM;
 const get=gm?.getValue?.bind(gm)||environment.GM_getValue,set=gm?.setValue?.bind(gm)||environment.GM_setValue;
 const request=gm?.xmlHttpRequest?.bind(gm)||environment.GM_xmlhttpRequest;
 const runnable=app=>{try{return Boolean(app&&typeof app.code==='string'&&typeof app.version==='string'&&compareVersions(app.version,app.version)===0);}catch{return false;}};
 let cached=null;
 try{cached=await get('photoswiper-app',null);}catch{}
 if(!runnable(cached))cached=null;
 if(started())return false;
 const live=await requestVersion(environment,request);
 if(started())return false;
 let app=cached,required=live?.requiredLoaderVersion;
 if(!cached||(live&&compareVersions(live.version,cached.version)!==0)){
  const latest=await requestApp(environment,request);
  if(started())return false;
  if(latest){
   app=latest;required=required||latest.requiredLoaderVersion;
   try{await set('photoswiper-app',latest);}catch{}
   if(started())return false;
  }
 }
 if(required)showUpdateBanner(environment,required);
 if(!app){showUpdateBanner(environment);return false;}
 try{const executed=executeApp(environment,app);if(!executed)showUpdateBanner(environment);return executed;}catch{showUpdateBanner(environment);return false;}
}
await startAutoLoader({document,window,location,GM_info:typeof GM_info==='undefined'?undefined:GM_info,crypto:window.crypto,setTimeout:window.setTimeout.bind(window),clearTimeout:window.clearTimeout.bind(window),fetch:fetch.bind(globalThis),unsafeWindow:typeof unsafeWindow==='undefined'?window:unsafeWindow,GM:typeof GM==='undefined'?undefined:GM,GM_getValue:typeof GM_getValue==='undefined'?undefined:GM_getValue,GM_setValue:typeof GM_setValue==='undefined'?undefined:GM_setValue,GM_deleteValue:typeof GM_deleteValue==='undefined'?undefined:GM_deleteValue,GM_xmlhttpRequest:typeof GM_xmlhttpRequest==='undefined'?undefined:GM_xmlhttpRequest,GM_openInTab:typeof GM_openInTab==='undefined'?undefined:GM_openInTab});
})();
