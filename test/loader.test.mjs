import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {compareVersions,releaseMessage,verifyRelease,startLoader,injectRelease} from '../lib/userscript-loader.mjs';
const pair=generateKeyPairSync('ed25519');
const key=Buffer.from(pair.publicKey.export({format:'jwk'}).x,'base64url').toString('base64');
const signed=(version='1.2.3',code='globalThis.appRuns=(globalThis.appRuns||0)+1;')=>{
 const release={version,code};
 return {...release,signature:sign(null,Buffer.from(releaseMessage(release)),pair.privateKey).toString('base64')};
};
function environment(cached,latest){
 const scripts=[],dataset={},writes=[];
 const env={crypto:webcrypto,setTimeout,clearTimeout,document:{documentElement:{dataset},querySelector:()=>({nonce:'page-nonce'}),createElement:()=>({remove(){}}),head:{appendChild(script){scripts.push(script);}}},trustedTypes:{createPolicy(name,rules){return rules;}},GM:{getValue:async()=>cached,setValue:async(name,value)=>writes.push(value),xmlHttpRequest(options){env.request=options;queueMicrotask(()=>latest==='timeout'?options.ontimeout():options.onload({status:200,responseText:JSON.stringify(latest)}));}}};
 return {env,scripts,writes};
}
test('release signatures bind code and version and reject a wrong key',async()=>{
 const release=signed();
 assert.equal(await verifyRelease(release,webcrypto,key),true);
 for(const changed of [{...release,code:release.code+'x'},{...release,version:'2.0.0'},{...release,signature:'bad'}])assert.equal(await verifyRelease(changed,webcrypto,key),false);
 assert.equal(await verifyRelease(release,webcrypto),false);
});
test('semantic versions order numeric and prerelease components',()=>{
 for(const [a,b] of [['1.10.0','1.9.0'],['1.0.0','1.0.0-rc.1'],['1.0.0-rc.10','1.0.0-rc.2']])assert.equal(compareVersions(a,b),1);
 assert.equal(compareVersions('1.2.3+build','1.2.3'),0);
 assert.throws(()=>compareVersions('1.2','1.2.0'));
});
test('rollback and timeout fall back to verified cache',async()=>{
 for(const latest of [signed('1.0.0'),'timeout',{...signed(),code:'tampered'}]){
  const {env,scripts,writes}=environment(signed('2.0.0'),latest);
  assert.equal(await startLoader(env,key),true);
  const context={};vm.runInNewContext(scripts[0].textContent,context);assert.equal(context.appRuns,1);
  assert.match(scripts[0].textContent,/\}\)\("2\.0\.0"\);$/);
  assert.equal(scripts[0].nonce,'page-nonce');
  assert.equal(env.request.timeout,1500);
  assert.match(env.request.url,/photoswiper-release.json\?t=\d+/);
  assert.equal(writes.length,0);
 }
 const {env,scripts}=environment({...signed(),code:'bad'},'timeout');
 assert.equal(await startLoader(env,key),false);assert.equal(scripts.length,0);
});
test('valid newer and equal releases are cached and injected once',async()=>{
 for(const version of ['1.2.3','1.2.4']){
  const {env,scripts,writes}=environment(signed(),signed(version));
  await Promise.all([startLoader(env,key),startLoader(env,key)]);
  assert.equal(scripts.length,1);assert.equal(writes[0].version,version);
  assert.equal(injectRelease(env,signed()),false);
 }
 const {env,scripts}=environment(null,signed());env.document.documentElement.dataset.psLoaded='1';
 assert.equal(await startLoader(env,key),false);assert.equal(scripts.length,0);
});
test('legacy GM APIs and no Trusted Types are supported',async()=>{
 const {env,scripts}=environment(null,signed());
 env.GM_getValue=env.GM.getValue;env.GM_setValue=env.GM.setValue;env.GM_xmlhttpRequest=env.GM.xmlHttpRequest;
 delete env.GM;delete env.trustedTypes;
 assert.equal(await startLoader(env,key),true);assert.equal(scripts.length,1);
});
test('full app skips when the shared app marker is set',async()=>{
 const code=await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url),'utf8');
 vm.runInNewContext(code,{document:{documentElement:{dataset:{psLoaded:'1'}}}});
 assert.match(code,/if\(document.documentElement.dataset.psLoaded\)return;/);
});
test('loader metadata declares separate install URL and required grants',async()=>{
 const code=await readFile(new URL('../userscript/photoswiper-loader.user.js',import.meta.url),'utf8');
 for(const line of ['@match https://photos.google.com/*','@inject-into content','@grant GM.xmlHttpRequest','@grant GM.getValue','@grant GM.setValue','@grant GM_xmlhttpRequest','@grant GM_getValue','@grant GM_setValue','@connect photoswiper-sync.sidlakkoju.workers.dev'])assert.ok(code.includes(line));
 for(const field of ['downloadURL','updateURL'])assert.deepEqual([...code.slice(0,code.indexOf('// ==/UserScript==')).matchAll(new RegExp('^// @'+field+' (.*)$','gm'))].map(match=>match[1]),['https://photoswiper-sync.sidlakkoju.workers.dev/photoswiper-loader.user.js']);
});

test('loader watchdog falls back when the GM request never calls back',async()=>{
 const {env,scripts}=environment(signed(),'timeout');
 env.GM.xmlHttpRequest=()=>{};
 let delay;
 env.setTimeout=(callback,ms)=>{delay=ms;return setTimeout(callback,0);};
 assert.equal(await startLoader(env,key),true);assert.equal(delay,1500);assert.equal(scripts.length,1);
});
