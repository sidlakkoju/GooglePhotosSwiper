import {readFile,writeFile,mkdir} from 'node:fs/promises';
const installURL='https://photoswiper-sync.sidlakkoju.workers.dev/photoswiper.user.js';
const metadata=`// ==UserScript==
// @name Photos Swipe
// @author sidlakkoju
// @namespace https://github.com/sidlakkoju/GooglePhotosSwiper
// @version 1.2.169
// @description Review Google Photos with local swipe decisions and verified review albums. RPC formats adapted from Google Photos Toolkit by xob0t.
// @match https://photos.google.com/*
// @run-at document-idle
// @grant GM.getValue
// @grant GM.setValue
// @grant GM.deleteValue
// @grant GM.xmlHttpRequest
// @grant GM.openInTab
// @connect photoswiper-sync.sidlakkoju.workers.dev
// @grant unsafeWindow
// @inject-into content
// @noframes
// @updateURL ${installURL}
// @downloadURL ${installURL}
// @license MIT
// ==/UserScript==
`;
const buildVersion=/^\/\/ @version (\S+)$/m.exec(metadata)[1];
const modules=['userscript-api','userscript-core','userscript-order','userscript-db','userscript-sync','userscript-settings','userscript-bridge','userscript-swipe','userscript-preload','userscript-video','userscript-performance','userscript-thumbnails','userscript-counter','userscript-stats','userscript-update','userscript-ui'];
const sources=await Promise.all(modules.map(name=>readFile(new URL(`../lib/${name}.mjs`,import.meta.url),'utf8')));
const swipeSource=await readFile(new URL('../lib/swipe.mjs',import.meta.url),'utf8');
const stillStart=swipeSource.indexOf('export function stillClonedVideos(');if(stillStart<0)throw Error('stillClonedVideos missing from lib/swipe.mjs');
sources.unshift(swipeSource.slice(stillStart,swipeSource.indexOf('\n}\n',stillStart)+3));
const browserSwipe=new URL('../public/swipe.js',import.meta.url);
if(process.argv.includes('--check')){if(await readFile(browserSwipe,'utf8')!==swipeSource)throw Error('Browser swipe module is stale. Run node scripts/build-userscript.mjs.');}
else await writeFile(browserSwipe,swipeSource);
const sharedAPI=await readFile(new URL('../extension/photos-api.js',import.meta.url),'utf8');
const bundled=[sharedAPI,...sources].map(source=>source.replace(/^import .*;\n/gm,'').replace(/^export /gm,'')).join('\n').replace(/[^\x00-\x7f]/g,character=>`\\u${character.charCodeAt(0).toString(16).padStart(4,'0')}`);
const output=`${metadata}\n(function () {\n'use strict';\nif(document.documentElement.dataset.psLoaded)return;\ndocument.documentElement.dataset.psLoaded='1';\n${bundled}\nconst pageWindow=typeof unsafeWindow==='undefined'?window:unsafeWindow;\nconst environment={version:typeof photosSwipeReleaseVersion==='undefined'?${JSON.stringify(buildVersion)}:photosSwipeReleaseVersion,autoUpdating:typeof photosSwipeReleaseVersion!=='undefined',window:pageWindow,document,location,GM:typeof GM==='undefined'?undefined:GM,fetch:pageWindow.fetch.bind(pageWindow),syncFetch:typeof fetch==='undefined'?window.fetch.bind(window):fetch.bind(globalThis),crypto:window.crypto,indexedDB:pageWindow.indexedDB,AbortController:pageWindow.AbortController,setTimeout:window.setTimeout.bind(window),clearTimeout:window.clearTimeout.bind(window)};\nif(!pageWindow.WIZ_global_data?.SNlM0e||!pageWindow.WIZ_global_data?.oPEP7c)environment.photosCall=createPagePhotosBridge(environment);\nmountPhotosSwipe(environment);\n})();\n`;
const destination=new URL('../userscript/photoswiper-app.user.js',import.meta.url);
if(process.argv.includes('--check')){if(await readFile(destination,'utf8')!==output)throw Error('Userscript is stale. Run node scripts/build-userscript.mjs.');}
else {await mkdir(new URL('../userscript/',import.meta.url),{recursive:true});await writeFile(destination,output);}

const loaderSource=await readFile(new URL('../lib/userscript-loader.mjs',import.meta.url),'utf8');
const loaderURL='https://photoswiper-sync.sidlakkoju.workers.dev/photoswiper-loader.user.js';
const loaderMetadata=`// ==UserScript==
// @name Photos Swipe (signed test loader)
// @namespace https://github.com/sidlakkoju/GooglePhotosSwiper
// @version 1.2.169
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
// @grant GM.xmlHttpRequest
// @grant GM.openInTab
// @connect photoswiper-sync.sidlakkoju.workers.dev
// @grant unsafeWindow
// @grant GM_deleteValue
// @grant GM_xmlhttpRequest
// @grant GM_openInTab
// @grant GM_getValue
// @grant GM_setValue
// @connect photoswiper-sync.sidlakkoju.workers.dev
// @downloadURL ${loaderURL}
// @updateURL ${loaderURL}
// ==/UserScript==
`;
const uniqueMetadata=value=>value.split('\n').filter((line,index,lines)=>!/^\/\/ @(grant|connect) /.test(line)||lines.indexOf(line)===index).join('\n');
const loaderOutput=uniqueMetadata(loaderMetadata)+'\n(async()=>{\n'+loaderSource.replace(/^export /gm,'')+'\nawait startLoader({document,window,location,crypto:window.crypto,setTimeout:window.setTimeout.bind(window),clearTimeout:window.clearTimeout.bind(window),fetch:fetch.bind(globalThis),unsafeWindow:typeof unsafeWindow===\'undefined\'?window:unsafeWindow,GM:typeof GM===\'undefined\'?undefined:GM,GM_getValue:typeof GM_getValue===\'undefined\'?undefined:GM_getValue,GM_setValue:typeof GM_setValue===\'undefined\'?undefined:GM_setValue,GM_deleteValue:typeof GM_deleteValue===\'undefined\'?undefined:GM_deleteValue,GM_xmlhttpRequest:typeof GM_xmlhttpRequest===\'undefined\'?undefined:GM_xmlhttpRequest,GM_openInTab:typeof GM_openInTab===\'undefined\'?undefined:GM_openInTab});\n})();\n';
const loaderDestination=new URL('../userscript/photoswiper-loader.user.js',import.meta.url);
if(process.argv.includes('--check')){if(await readFile(loaderDestination,'utf8')!==loaderOutput)throw Error('Loader is stale. Run node scripts/build-userscript.mjs.');}
else await writeFile(loaderDestination,loaderOutput);

const autoSource=await readFile(new URL('../lib/userscript-auto-loader.mjs',import.meta.url),'utf8');
const versionSource=loaderSource.slice(loaderSource.indexOf('export function compareVersions'),loaderSource.indexOf('export async function verifyRelease'));
const autoMetadata=metadata.replace(/^\/\/ @version \S+$/m,/^\/\/ @version \S+$/m.exec(loaderMetadata)[0]).replace('// @grant GM.getValue','// @grant GM.xmlHttpRequest\n// @grant GM_info\n// @grant GM_xmlhttpRequest\n// @grant GM_getValue\n// @grant GM_setValue\n// @grant GM_deleteValue\n// @connect photoswiper-sync.sidlakkoju.workers.dev\n// @grant GM.getValue');
const autoOutput=uniqueMetadata(autoMetadata)+'\n(async()=>{\n'+versionSource.replace(/^export /gm,'')+autoSource.replace(/^import .*;\n/gm,'').replace(/^export /gm,'')+loaderOutput.slice(loaderOutput.indexOf('await startLoader({')).replace('await startLoader({','await startAutoLoader({').replace('document,window,location,','document,window,location,GM_info:typeof GM_info===\'undefined\'?undefined:GM_info,');
const autoDestination=new URL('../userscript/photoswiper.user.js',import.meta.url);
if(process.argv.includes('--check')){if(await readFile(autoDestination,'utf8')!==autoOutput)throw Error('Auto loader is stale. Run node scripts/build-userscript.mjs.');}
else await writeFile(autoDestination,autoOutput);
