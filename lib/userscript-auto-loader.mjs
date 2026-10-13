import {compareVersions} from './userscript-loader.mjs';
export const loaderAPIVersion='1.0.0';
const appOrigin='https://photoswiper-sync.sidlakkoju.workers.dev';
const appPolicies=new WeakMap();
export function showUpdateBanner(environment,version){
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
export function requestApp(environment,request){
 return new Promise(resolve=>{
  let settled=false;
  const finish=value=>{if(settled)return;settled=true;environment.clearTimeout(timer);resolve(value);};
  const timer=environment.setTimeout(()=>finish(null),5000);
  const loaded=response=>{
   const version=/^x-photoswiper-version:\s*(\S+)/im.exec(response.responseHeaders||'')?.[1];
   try{compareVersions(version,version);}catch{finish(null);return;}
   const requiredLoaderVersion=/^x-photoswiper-required-loader-version:\s*(\S+)/im.exec(response.responseHeaders||'')?.[1];
   if(requiredLoaderVersion!==undefined){try{compareVersions(requiredLoaderVersion,requiredLoaderVersion);}catch{finish(null);return;}}
   finish(response.status===200&&response.responseText?.trim()&&version?{code:response.responseText,version,...(requiredLoaderVersion===undefined?{}:{requiredLoaderVersion})}:null);
  };
  try{const result=request({method:'GET',url:appOrigin+'/app.js?t='+Date.now(),timeout:5000,onload:loaded,onerror:()=>finish(null),ontimeout:()=>finish(null),onabort:()=>finish(null)});result?.then?.(loaded,()=>finish(null));}catch{finish(null);}
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
  if(types){let policy=appPolicies.get(types);if(!policy){policy=types.createPolicy('photoswiper-auto-loader',{createScript:value=>value});appPolicies.set(types,policy);}trusted=policy.createScript(source);}
  try{execute=(0,environment.eval||eval)(trusted);}catch{
   const key='__photoswiperExecute'+environment.crypto.randomUUID().replaceAll('-','');
   const script=environment.document.createElement('script');
   const nonce=environment.document.querySelector('script[nonce]')?.nonce;
   if(nonce)script.nonce=nonce;
   try{script.text=types?appPolicies.get(types).createScript('window['+JSON.stringify(key)+']='+source+';'):'window['+JSON.stringify(key)+']='+source+';';(environment.document.head||root).appendChild(script);execute=page[key];}finally{delete page[key];script.remove();}
  }
  if(typeof execute!=='function')return false;
 }catch{return false;}
 root.dataset.psLoaderInjected='1';
 try{execute(gm,page,environment.window,environment.document,environment.location,environment.fetch,app.version);}catch(error){delete root.dataset.psLoaderInjected;throw error;}
 return true;
}
export async function startAutoLoader(environment){
 if(environment.document.documentElement.dataset.psLoaded||environment.document.documentElement.dataset.psLoaderInjected)return false;
 const gm=environment.GM;
 const get=gm?.getValue?.bind(gm)||environment.GM_getValue,set=gm?.setValue?.bind(gm)||environment.GM_setValue;
 let cached;
 try{cached=await get('photoswiper-app',null);}catch{}
 if(environment.document.documentElement.dataset.psLoaded||environment.document.documentElement.dataset.psLoaderInjected)return false;
 const latest=await requestApp(environment,gm?.xmlHttpRequest?.bind(gm)||environment.GM_xmlhttpRequest);
 if(environment.document.documentElement.dataset.psLoaded||environment.document.documentElement.dataset.psLoaderInjected)return false;
 if(latest){try{await set('photoswiper-app',latest);}catch{}}
 else showUpdateBanner(environment);
 const app=latest||cached;
 if(environment.document.documentElement.dataset.psLoaded||environment.document.documentElement.dataset.psLoaderInjected)return false;
 if(latest?.requiredLoaderVersion)showUpdateBanner(environment,latest.requiredLoaderVersion);
 if(!app||typeof app.code!=='string'||typeof app.version!=='string'){showUpdateBanner(environment);return false;}
 try{compareVersions(app.version,app.version);const executed=executeApp(environment,app);if(!executed)showUpdateBanner(environment);return executed;}catch{showUpdateBanner(environment);return false;}
}
