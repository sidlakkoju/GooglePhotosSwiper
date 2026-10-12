import {readFile} from 'node:fs/promises';

const userscriptURL = new URL('../../userscript/photoswiper.user.js', import.meta.url).href;

export async function load(url, context, nextLoad) {
  if(url.endsWith('/worker/generated/release.mjs'))return {format:'module',source:'export default {version:"0.0.0",code:"",signature:""};',shortCircuit:true};
  if (url !== userscriptURL && !url.endsWith('/userscript/photoswiper-loader.user.js') && !url.endsWith('/userscript/photoswiper-app.user.js')) return nextLoad(url, context);
  const source = await readFile(new URL(url), 'utf8');
  return {format: 'module', source: `export default ${JSON.stringify(source)};`, shortCircuit: true};
}

export async function resolve(specifier,context,nextResolve){
 if(specifier==='../generated/release.mjs')return {url:new URL(specifier,context.parentURL).href,shortCircuit:true};
 return nextResolve(specifier,context);
}
