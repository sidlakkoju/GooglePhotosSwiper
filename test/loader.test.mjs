import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {compareVersions,releaseMessage,verifyRelease,startLoader,injectRelease} from '../lib/userscript-loader.mjs';
const pair=generateKeyPairSync('ed25519');
const key=Buffer.from(pair.publicKey.export({format:'jwk'}).x,'base64url').toString('base64');
const signed=(version='1.2.3',code='window.appRuns=(window.appRuns||0)+1;')=>{
 const release={version,code};
 return {...release,signature:sign(null,Buffer.from(releaseMessage(release)),pair.privateKey).toString('base64')};
};
function environment(cached,latest){
 const scripts=[],dataset={},writes=[];
 const env={window:{},crypto:webcrypto,setTimeout,clearTimeout,document:{documentElement:{dataset},querySelector:()=>({nonce:'page-nonce'}),createElement:()=>({remove(){}}),head:{appendChild(script){scripts.push(script);}}},trustedTypes:{createPolicy(name,rules){return rules;}},GM:{getValue:async()=>cached,setValue:async(name,value)=>writes.push(value),deleteValue:async()=>{},xmlHttpRequest(options){env.request=options;queueMicrotask(()=>latest==='timeout'?options.ontimeout():options.onload({status:200,responseText:JSON.stringify(latest)}));}}};
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
  assert.equal(env.window.appRuns,1);assert.equal(scripts.length,0);
  assert.equal(env.request.timeout,1500);
  assert.match(env.request.url,/photoswiper-release.json\?t=\d+/);
  assert.equal(writes.length,0);
 }
 const {env,scripts}=environment({...signed(),code:'bad'},'timeout');
 assert.equal(await startLoader(env,key),false);assert.equal(scripts.length,0);
});

test('verified releases receive their signed version in the private execution context',async()=>{
 for(const version of ['2.0.0','2.1.0-rc.1']){
  const {env,scripts}=environment(null,signed(version,'window.releaseVersion=photosSwipeReleaseVersion;window.privateStore=GM;'));
  assert.equal(await startLoader(env,key),true);
  assert.equal(env.window.releaseVersion,version);assert.equal(env.window.privateStore,env.GM);assert.equal(scripts.length,0);
 }
});

test('valid newer and equal releases are cached and injected once',async()=>{
 for(const version of ['1.2.3','1.2.4']){
  const {env,scripts,writes}=environment(signed(),signed(version));
  await Promise.all([startLoader(env,key),startLoader(env,key)]);
  assert.equal(env.window.appRuns,1);assert.equal(scripts.length,0);assert.equal(writes[0].version,version);
  assert.equal(injectRelease(env,signed()),false);
 }
 const {env,scripts}=environment(null,signed());env.document.documentElement.dataset.psLoaded='1';
 assert.equal(await startLoader(env,key),false);assert.equal(scripts.length,0);
});
test('legacy GM APIs and no Trusted Types are supported',async()=>{
 const {env,scripts}=environment(null,signed());
 env.GM_deleteValue=env.GM.deleteValue;env.GM_getValue=env.GM.getValue;env.GM_setValue=env.GM.setValue;env.GM_xmlhttpRequest=env.GM.xmlHttpRequest;
 delete env.GM;delete env.trustedTypes;
 assert.equal(await startLoader(env,key),true);assert.equal(env.window.appRuns,1);assert.equal(scripts.length,0);
});
test('full app skips when the shared app marker is set',async()=>{
 const code=await readFile(new URL('../userscript/photoswiper-app.user.js',import.meta.url),'utf8');
 vm.runInNewContext(code,{document:{documentElement:{dataset:{psLoaded:'1'}}}});
 assert.match(code,/if\(document.documentElement.dataset.psLoaded\)return;/);
});
test('loader metadata declares separate install URL and required grants',async()=>{
 const code=await readFile(new URL('../userscript/photoswiper-loader.user.js',import.meta.url),'utf8');
 for(const line of ['@match https://photos.google.com/*','@inject-into content','@grant GM.xmlHttpRequest','@grant GM.getValue','@grant GM.setValue','@grant GM.deleteValue','@grant unsafeWindow','@grant GM_deleteValue','@grant GM_xmlhttpRequest','@grant GM_getValue','@grant GM_setValue','@connect photoswiper-sync.sidlakkoju.workers.dev'])assert.ok(code.includes(line));
 for(const field of ['downloadURL','updateURL'])assert.deepEqual([...code.slice(0,code.indexOf('// ==/UserScript==')).matchAll(new RegExp('^// @'+field+' (.*)$','gm'))].map(match=>match[1]),['https://photoswiper-sync.sidlakkoju.workers.dev/photoswiper-loader.user.js']);
});

test('loader watchdog falls back when the GM request never calls back',async()=>{
 const {env,scripts}=environment(signed(),'timeout');
 env.GM.xmlHttpRequest=()=>{};
 let delay;
 env.setTimeout=(callback,ms)=>{delay=ms;return setTimeout(callback,0);};
 assert.equal(await startLoader(env,key),true);assert.equal(delay,1500);assert.equal(env.window.appRuns,1);assert.equal(scripts.length,0);
});

test('verified loader pairing stays in its GM store and restores server state after claiming',async()=>{
 const modules=await Promise.all(['core','settings','pairing','sync'].map(name=>readFile(new URL(`../lib/userscript-${name}.mjs`,import.meta.url),'utf8')));
 const code=modules.map(source=>source.replace(/^import .*;\n/gm,'').replace(/^export /gm,'')).join('\n')+`
 window.completed=(async()=>{
  const store=await createPairingStore({GM,database:window.database,crypto:window.crypto});
  const panel=receivePairingLink({document,parent:window.parent,location:{hash:''},window,fetch,manual:true,saveSettings:store.saveSettings,onPaired:async()=>{
   const client=createSyncClient({fetch});client.configure(await store.settings());
   window.restored=await client.sync('synthetic-account',{items:[],history:[]},async value=>value);
  }});
  const nodes=node=>node.children.flatMap(child=>[child,...nodes(child)]);
  nodes(panel).find(node=>node.id==='pairing-short-code').value='123456';await nodes(panel).find(node=>node.tag==='button'&&node.textContent==='Pair this device').onclick();
 })();`;
 const {env,scripts}=environment(null,signed('1.2.3',code));
 const storage=new Map(),pageWorld={localStorage:{},indexedDB:{}},persisted=[];
 let settings={};
 env.GM.getValue=async name=>storage.get(name);env.GM.setValue=async(name,value)=>storage.set(name,value);
 env.GM.deleteValue=async name=>storage.delete(name);
 env.document.createElement=tag=>({tag,children:[],style:{},setAttribute(key,value){this[key]=value;},append(...nodes){this.children.push(...nodes);},focus(){}});
 env.window={crypto:webcrypto,navigator:{},parent:{children:[],append(node){this.children.push(node);}},database:async()=>({settings:async()=>settings,deleteSettings:async()=>{settings={};},saveSettings:async value=>{settings=value;persisted.push(value);}})};
 env.unsafeWindow=pageWorld;
 const calls=[],remote={decisions:[{id:'photo',decision:'keep'}],history:[{key:'photo',decision:'keep',previous:null,revision:1}],progress:{started:true,reviewed:1}};
 env.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>url.endsWith('/api/pair/claim')?{token:'loader-private-token'}:remote};};
 assert.equal(await startLoader(env,key),true);await env.window.completed;
 assert.equal(storage.get('photos-swipe-pairing').token,'loader-private-token');
 assert.deepEqual(env.window.restored.history,remote.history);assert.deepEqual(env.window.restored.syncProgress,remote.progress);assert.deepEqual(env.window.restored.syncDecisions,{photo:'keep'});
 assert.equal(calls.length,2);assert.match(calls[1].url,/\/api\/state\?scope=synthetic-account$/);assert.equal(calls[1].options.headers.Authorization,'Bearer loader-private-token');
 for(const value of [pageWorld,env.document.documentElement,env.window.parent,persisted])assert.ok(!JSON.stringify(value).includes('loader-private-token'));
 assert.equal(scripts.length,0);
 const {createPairingStore}=await import('../lib/userscript-settings.mjs');
 const reloaded=await createPairingStore({GM:env.GM,database:env.window.database,crypto:webcrypto});assert.equal((await reloaded.settings()).token,'loader-private-token');
});

test('loader refuses page injection when private GM storage is unavailable',async()=>{
 const {env,scripts}=environment(null,signed());delete env.GM.deleteValue;
 assert.equal(await startLoader(env,key),false);assert.equal(scripts.length,0);assert.equal(env.window.appRuns,undefined);
});

test('Trusted Types execution keeps GM private and reuses its policy',async()=>{
 const release=signed('1.2.3',"if(!GM.privateToken)throw Error('Missing private GM');window.appRuns=(window.appRuns||0)+1;");
 const {env,scripts}=environment(null,release);
 env.GM.privateToken='private-sync-token';
 const trustedScripts=new WeakMap(),sources=[],names=[];
 delete env.trustedTypes;
 env.window.trustedTypes={createPolicy(name,rules){
  names.push(name);
  return {createScript(input){sources.push(input);const trusted={};trustedScripts.set(trusted,rules.createScript(input));return trusted;}};
 }};
 const context=vm.createContext({Function(){throw new EvalError('Function constructor unavailable');}});
 env.eval=value=>{
  assert.ok(trustedScripts.has(value),'eval requires a TrustedScript');
  return vm.runInContext(trustedScripts.get(value),context);
 };
 assert.equal(await startLoader(env,key),true);
 assert.equal(env.window.appRuns,1);
 delete env.document.documentElement.dataset.psLoaderInjected;
 assert.equal(await startLoader(env,key),true);
 assert.equal(env.window.appRuns,2);
 assert.equal(names.length,1);assert.match(names[0],/^photoswiper-loader-/);
 assert.equal(sources.length,2);assert.equal(scripts.length,0);
 for(const value of [env.window,env.document,env.unsafeWindow])assert.ok(!JSON.stringify(value)?.includes('private-sync-token'));
 assert.ok(!Object.values(env.window).includes(env.GM));
});

test('unverified and modified releases never reach Trusted Types or eval',async()=>{
 for(const release of [{...signed(),code:'window.tampered=true;'},{version:'1.2.3',code:'window.unsigned=true;'}]){
  const {env}=environment(null,release);
  env.trustedTypes={createPolicy(){assert.fail('Unverified code created a policy');}};
  env.eval=()=>assert.fail('Unverified code executed');
  assert.equal(await startLoader(env,key),false);
  assert.equal(injectRelease(env,release),false);
 }
 const release=signed(),{env}=environment(null,null);
 assert.equal(await verifyRelease(release,webcrypto,key),true);
 release.code+='window.tampered=true;';
 env.trustedTypes={createPolicy(){return {createScript(){assert.fail('Modified code reached createScript');}};}};
 env.eval=()=>assert.fail('Modified code executed');
 assert.equal(injectRelease(env,release),false);
});

test('Trusted Types policy failure returns false and clears the injection marker',async()=>{
 const {env,scripts}=environment(null,signed());
 env.trustedTypes={createPolicy(){throw new TypeError('Policy denied');}};
 env.eval=()=>assert.fail('Policy failure executed code');
 assert.equal(await startLoader(env,key),false);
 assert.equal(env.document.documentElement.dataset.psLoaderInjected,undefined);
 assert.equal(env.window.appRuns,undefined);assert.equal(scripts.length,0);
});

test('loader sources never use the Function constructor',async()=>{
 for(const path of ['../lib/userscript-loader.mjs','../userscript/photoswiper-loader.user.js']){
  const source=await readFile(new URL(path,import.meta.url),'utf8');
  assert.doesNotMatch(source,/new\s+Function\b|\bFunction\s*\(/);
 }
});

test('built app releases upgrade signed caches from 1.2.52 and 1.2.53',async()=>{
 const code=await readFile(new URL('../userscript/photoswiper-app.user.js',import.meta.url),'utf8');
 const version=/^\/\/ @version (\S+)$/m.exec(code)[1];
 for(const cachedVersion of ['1.2.52','1.2.53']){
  assert.ok(compareVersions(version,cachedVersion)>0);
  const latest=signed(version,code);
  const {env,writes}=environment(signed(cachedVersion),latest);
  env.eval=source=>{
   assert.ok(source.includes(code));
   return (gm,page,window,document,location,fetch,releaseVersion)=>{window.releaseVersion=releaseVersion;};
  };
  assert.equal(await startLoader(env,key),true);
  assert.equal(env.window.releaseVersion,version);
  assert.deepEqual(writes,[latest]);
 }
});
