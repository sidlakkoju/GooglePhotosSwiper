import {compareVersions} from './userscript-loader.mjs';
export const loaderAPIVersion='1.0.0';
const appOrigin='https://photoswiper-sync.sidlakkoju.workers.dev';
const appPolicies=new WeakMap();
export function showUpdateBanner(environment,version){
 if(version!==undefined){try{if(compareVersions(version,loaderAPIVersion)<=0)return false;}catch{return false;}}
 const document=environment.document;
 if(document.getElementById('photoswiper-update'))return false;
 const failed=version===undefined,banner=document.createElement(failed?'div':'a');
 banner.id='photoswiper-update';banner.textContent=failed?'Photos Swipe couldn\u2019t load. Check your connection and reload the page.':'Update available - tap to update Photos Swipe';
 if(failed)banner.setAttribute?.('role','alert');else{banner.href=appOrigin+'/photoswiper.user.js';banner.target='_blank';banner.rel='noopener noreferrer';}
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
export function requestVersion(environment,request,timeout=3000){
 return requestPath(environment,request,'/version',timeout,response=>{
  if(response.status!==200)return null;
  const value=JSON.parse(response.responseText);
  compareVersions(value.version,value.version);
  if(value.requiredLoaderVersion!==undefined)compareVersions(value.requiredLoaderVersion,value.requiredLoaderVersion);
  return {version:value.version,...(value.requiredLoaderVersion===undefined?{}:{requiredLoaderVersion:value.requiredLoaderVersion})};
 });
}
export function requestApp(environment,request,timeout=30000){
 return requestPath(environment,request,'/app.js',timeout,response=>{
  const version=/^x-photoswiper-version:\s*(\S+)/im.exec(response.responseHeaders||'')?.[1];
  compareVersions(version,version);
  const requiredLoaderVersion=/^x-photoswiper-required-loader-version:\s*(\S+)/im.exec(response.responseHeaders||'')?.[1];
  if(requiredLoaderVersion!==undefined)compareVersions(requiredLoaderVersion,requiredLoaderVersion);
  return response.status===200&&response.responseText?.trim()?{code:response.responseText,version,...(requiredLoaderVersion===undefined?{}:{requiredLoaderVersion})}:null;
 });
}
export function executeApp(environment,app){
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
export async function startAutoLoader(environment){
 const root=environment.document.documentElement,started=()=>root.dataset.psLoaded||root.dataset.psLoaderInjected;
 if(started())return false;
 const gm=environment.GM;
 const get=gm?.getValue?.bind(gm)||environment.GM_getValue,set=gm?.setValue?.bind(gm)||environment.GM_setValue;
 const request=gm?.xmlHttpRequest?.bind(gm)||environment.GM_xmlhttpRequest;
 const runnable=app=>{try{return Boolean(app&&typeof app.code==='string'&&typeof app.version==='string'&&compareVersions(app.version,app.version)===0);}catch{return false;}};
 const liveVersion=requestVersion(environment,request);
 let cached=null;
 try{cached=await get('photoswiper-app',null);}catch{}
 if(!runnable(cached))cached=null;
 if(started())return false;
 let waited;
 const live=cached?await Promise.race([liveVersion,new Promise(resolve=>{waited=environment.setTimeout(()=>resolve(null),1000);})]):await liveVersion;
 environment.clearTimeout(waited);
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
 const run=candidate=>{try{return executeApp(environment,candidate);}catch{return false;}};
 if(run(app))return true;
 if(started())return false;
 const fallback=app===cached?await requestApp(environment,request):cached;
 if(started())return false;
 if(fallback&&run(fallback)){try{await set('photoswiper-app',fallback);}catch{}return true;}
 showUpdateBanner(environment);return false;
}
