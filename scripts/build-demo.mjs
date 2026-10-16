import {readFile,writeFile,mkdir,rm,copyFile,access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {demoLibrary,demoLandscapeSVG,demoMediaFile} from '../lib/userscript-demo.mjs';
const root=new URL('../',import.meta.url);
const output=resolve(process.argv[2]||fileURLToPath(new URL('demo-dist',root)));
const builder=await readFile(new URL('scripts/build-userscript.mjs',root),'utf8');
const version=/^\/\/ @version (\S+)$/m.exec(builder)[1];
const modules=['userscript-core','userscript-order','userscript-db','userscript-sync','userscript-settings','userscript-swipe','userscript-preload','userscript-video','userscript-performance','userscript-thumbnails','userscript-counter','userscript-stats','userscript-update','userscript-demo','userscript-ui'];
const sources=await Promise.all(modules.map(name=>readFile(new URL(`lib/${name}.mjs`,root),'utf8')));
const swipeSource=await readFile(new URL('lib/swipe.mjs',root),'utf8');
const stillStart=swipeSource.indexOf('export function stillClonedVideos(');
if(stillStart<0)throw Error('stillClonedVideos missing from lib/swipe.mjs');
sources.unshift(swipeSource.slice(stillStart,swipeSource.indexOf('\n}\n',stillStart)+3));
const bundled=sources.map(source=>source.replace(/^import .*;\n/gm,'').replace(/^export /gm,'')).join('\n').replace(/[^\x00-\x7f]/g,character=>`\\u${character.charCodeAt(0).toString(16).padStart(4,'0')}`);
const script=`(function () {\n'use strict';\n${bundled}\nconst params=new URLSearchParams(location.search);\nconst embed=params.get('embed')==='1';\nif(embed)document.documentElement.dataset.embed='1';\nmountPhotosSwipe(createDemoEnvironment({window,document,location,base:new URL('media/',document.baseURI).href,embed,top:params.get('top'),version:${JSON.stringify(version)}}));\n})();\n`;
const html=`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'none'; font-src 'none'; base-uri 'self'; form-action 'none'">
<meta name="color-scheme" content="dark light">
<meta name="robots" content="noindex">
<title>Photos Swipe demo</title>
<link rel="icon" href="data:,">
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000;color:#fff;font:15px/1.4 -apple-system,BlinkMacSystemFont,system-ui,sans-serif}noscript{display:grid;place-items:center;height:100%;padding:24px;text-align:center}</style>
</head>
<body>
<noscript>The Photos Swipe demo needs JavaScript.</noscript>
<script src="photos-swipe-demo.js"></script>
</body>
</html>
`;
await rm(output,{recursive:true,force:true});
await mkdir(resolve(output,'media'),{recursive:true});
await writeFile(resolve(output,'index.html'),html);
await writeFile(resolve(output,'photos-swipe-demo.js'),script);
for(const entry of demoLibrary)await writeFile(resolve(output,'media',demoMediaFile(entry)),demoLandscapeSVG(entry.palette,{seed:entry.seed,...(entry.landscape?{width:1200,height:900}:{})}));
for(const entry of demoLibrary.filter(entry=>entry.video)){
 const source=new URL(`demo/media/${entry.video}`,root);
 try{await access(source);}catch{throw Error(`Missing ${entry.video}. Run node scripts/record-demo-video.mjs first.`);}
 await copyFile(source,resolve(output,'media',entry.video));
}
console.log(`Built the Photos Swipe demo in ${output}`);
