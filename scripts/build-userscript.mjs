import {readFile,writeFile,mkdir} from 'node:fs/promises';
const installURL='https://photoswiper-sync.sidlakkoju.workers.dev/photoswiper.user.js';
const metadata=`// ==UserScript==
// @name Photos Swipe
// @author sidlakkoju
// @namespace https://github.com/sidlakkoju/GooglePhotosSwiper
// @version 1.2.19
// @description Review Google Photos with local swipe decisions and verified review albums. RPC formats adapted from Google Photos Toolkit by xob0t.
// @match https://photos.google.com/*
// @run-at document-idle
// @grant GM.getValue
// @grant GM.setValue
// @grant GM.deleteValue
// @grant unsafeWindow
// @inject-into content
// @noframes
// @updateURL ${installURL}
// @downloadURL ${installURL}
// @license MIT
// ==/UserScript==
`;
const buildVersion=/^\/\/ @version (\S+)$/m.exec(metadata)[1];
const modules=['userscript-api','userscript-core','userscript-db','userscript-sync','userscript-settings','userscript-bridge','userscript-swipe','userscript-qr','userscript-pairing','userscript-preload','userscript-ui'];
const sources=await Promise.all(modules.map(name=>readFile(new URL(`../lib/${name}.mjs`,import.meta.url),'utf8')));
const swipeSource=await readFile(new URL('../lib/swipe.mjs',import.meta.url),'utf8');
sources.unshift(swipeSource);
const browserSwipe=new URL('../public/swipe.js',import.meta.url);
if(process.argv.includes('--check')){if(await readFile(browserSwipe,'utf8')!==swipeSource)throw Error('Browser swipe module is stale. Run node scripts/build-userscript.mjs.');}
else await writeFile(browserSwipe,swipeSource);
const sharedAPI=await readFile(new URL('../extension/photos-api.js',import.meta.url),'utf8');
const bundled=[sharedAPI,...sources].map(source=>source.replace(/^import .*;\n/gm,'').replace(/^export /gm,'')).join('\n').replace(/[^\x00-\x7f]/g,character=>`\\u${character.charCodeAt(0).toString(16).padStart(4,'0')}`);
const output=`${metadata}\n(function () {\n'use strict';\nif(document.documentElement.dataset.psLoaded)return;\ndocument.documentElement.dataset.psLoaded='1';\n${bundled}\nconst pageWindow=typeof unsafeWindow==='undefined'?window:unsafeWindow;\nconst environment={version:typeof photosSwipeReleaseVersion==='undefined'?${JSON.stringify(buildVersion)}:photosSwipeReleaseVersion,window:pageWindow,document,location,GM:typeof GM==='undefined'?undefined:GM,fetch:pageWindow.fetch.bind(pageWindow),syncFetch:typeof fetch==='undefined'?window.fetch.bind(window):fetch.bind(globalThis),crypto:window.crypto,indexedDB:pageWindow.indexedDB,AbortController:pageWindow.AbortController,setTimeout:window.setTimeout.bind(window),clearTimeout:window.clearTimeout.bind(window)};\nif(!pageWindow.WIZ_global_data?.SNlM0e||!pageWindow.WIZ_global_data?.oPEP7c)environment.photosCall=createPagePhotosBridge(environment);\nmountPhotosSwipe(environment);\n})();\n`;
const destination=new URL('../userscript/photoswiper.user.js',import.meta.url);
if(process.argv.includes('--check')){if(await readFile(destination,'utf8')!==output)throw Error('Userscript is stale. Run node scripts/build-userscript.mjs.');}
else {await mkdir(new URL('../userscript/',import.meta.url),{recursive:true});await writeFile(destination,output);}

const loaderSource=await readFile(new URL('../lib/userscript-loader.mjs',import.meta.url),'utf8');
const loaderURL='https://photoswiper-sync.sidlakkoju.workers.dev/photoswiper-loader.user.js';
const loaderMetadata=`// ==UserScript==
// @name Photos Swipe (signed test loader)
// @namespace https://github.com/sidlakkoju/GooglePhotosSwiper
// @version 1.2.19
// @description Fetch and verify signed Photos Swipe releases.
// @match https://photos.google.com/*
// @inject-into content
// @run-at document-idle
// @noframes
// @grant GM.xmlHttpRequest
// @grant GM.getValue
// @grant GM.setValue
// @grant GM_xmlhttpRequest
// @grant GM_getValue
// @grant GM_setValue
// @connect photoswiper-sync.sidlakkoju.workers.dev
// @downloadURL ${loaderURL}
// @updateURL ${loaderURL}
// ==/UserScript==
`;
const loaderOutput=loaderMetadata+'\n(async()=>{\n'+loaderSource.replace(/^export /gm,'')+'\nawait startLoader(globalThis);\n})();\n';
const loaderDestination=new URL('../userscript/photoswiper-loader.user.js',import.meta.url);
if(process.argv.includes('--check')){if(await readFile(loaderDestination,'utf8')!==loaderOutput)throw Error('Loader is stale. Run node scripts/build-userscript.mjs.');}
else await writeFile(loaderDestination,loaderOutput);
