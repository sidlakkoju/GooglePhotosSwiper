import { readdir,readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const paths=['server.mjs','userscript/photoswiper.user.js','userscript/photoswiper-app.user.js','userscript/photoswiper-loader.user.js','scripts/sign-release.mjs','scripts/build-userscript.mjs','worker/src/index.mjs','worker/src/sync.mjs','worker/src/decision-merge.mjs','worker/src/pairing.mjs','worker/src/google-auth.mjs',...(await readdir('lib')).filter(p=>p.endsWith('.mjs')).map(p=>`lib/${p}`),...(await readdir('public')).filter(p=>p.endsWith('.js')).map(p=>`public/${p}`),...(await readdir('extension')).filter(p=>p.endsWith('.js')).map(p=>`extension/${p}`)];
for(const path of paths){const result=spawnSync(process.execPath,['--check',path],{encoding:'utf8'});if(result.status){process.stderr.write(result.stderr);process.exit(1);}}
const userscriptBuild=spawnSync(process.execPath,['scripts/build-userscript.mjs','--check'],{encoding:'utf8'});if(userscriptBuild.status){process.stderr.write(userscriptBuild.stderr);process.exit(1);}
const manifest=JSON.parse(await readFile('extension/manifest.json'));if(manifest.manifest_version!==3)throw Error('Expected MV3');
const html=await readFile('public/index.html','utf8'),js=await readFile('public/app.js','utf8');for(const m of js.matchAll(/\$\('([^']+)'\)/g))if(!html.includes(`id="${m[1]}"`))throw Error(`Missing UI element: ${m[1]}`);
console.log(`Syntax and UI wiring checked for ${paths.length} files.`);
