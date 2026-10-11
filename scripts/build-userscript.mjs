import {readFile,writeFile,mkdir} from 'node:fs/promises';
const installURL='https://photoswiper-sync.sidlakkoju.workers.dev/photoswiper.user.js';
const metadata=`// ==UserScript==
// @name Photos Swipe
// @namespace https://github.com/sidlakkoju/GooglePhotosSwiper
// @version 1.1.1
// @description Review Google Photos with local swipe decisions and verified review albums. RPC formats adapted from Google Photos Toolkit by xob0t.
// @match https://photos.google.com/*
// @run-at document-idle
// @grant none
// @inject-into page
// @noframes
// @updateURL ${installURL}
// @downloadURL ${installURL}
// @license MIT
// ==/UserScript==
`;
const modules=['userscript-api','userscript-core','userscript-db','userscript-ui'];
const sources=await Promise.all(modules.map(name=>readFile(new URL(`../lib/${name}.mjs`,import.meta.url),'utf8')));
const sharedAPI=await readFile(new URL('../extension/photos-api.js',import.meta.url),'utf8');
const bundled=[sharedAPI,...sources].map(source=>source.replace(/^import .*;\n/gm,'').replace(/^export /gm,'')).join('\n').replace(/[^\x00-\x7f]/g,character=>`\\u${character.charCodeAt(0).toString(16).padStart(4,'0')}`);
const output=`${metadata}\n(function () {\n'use strict';\n${bundled}\nmountPhotosSwipe({window,document,location,fetch:window.fetch.bind(window),crypto:window.crypto,indexedDB:window.indexedDB,AbortController:window.AbortController,setTimeout:window.setTimeout.bind(window),clearTimeout:window.clearTimeout.bind(window)});\n})();\n`;
const destination=new URL('../userscript/photoswiper.user.js',import.meta.url);
if(process.argv.includes('--check')){if(await readFile(destination,'utf8')!==output)throw Error('Userscript is stale. Run node scripts/build-userscript.mjs.');}
else {await mkdir(new URL('../userscript/',import.meta.url),{recursive:true});await writeFile(destination,output);}
