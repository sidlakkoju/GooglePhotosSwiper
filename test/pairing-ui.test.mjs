import {createHash} from 'node:crypto';
import {pairPage} from '../worker/src/pair-page.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
function dom(){const document={createElement:tag=>({tag,style:{},children:[],hidden:false,textContent:'',setAttribute(key,value){this[key]=value;},append(...nodes){this.children.push(...nodes);},focus(){},addEventListener(){}})};return {document};}
const prePairingMainBytes=84973;
const photoURLRefreshGrowthBytes=3194;
const themeGrowthBytes=3078;
const performanceGrowthBytes=76764-58137;
const loaderPairingOnboardingGrowthBytes=701;
const iosSwipeCancelGrowthBytes=200;
const isolationModules=await Promise.all(['settings','bridge'].map(name=>readFile(new URL(`../lib/userscript-${name}.mjs`,import.meta.url),'utf8')));
const isolationBytes=isolationModules.reduce((size,module)=>size+Buffer.byteLength(module.replace(/[^\x00-\x7f]/g,character=>`\\u${character.charCodeAt(0).toString(16).padStart(4,'0')}`)),1024);
const centeredShellGrowthBytes=12000;
const keyboardIsolationGrowthBytes=1024;
const mobileLayoutGrowthBytes=512;
const continuousLibraryGrowthBytes=2*1024;
const videoTimelineGrowthBytes=4*1024;
const videoControlLayoutGrowthBytes=128+videoTimelineGrowthBytes;
const layoutAndTrashReviewGrowthBytes=20*1024+videoControlLayoutGrowthBytes;
const tabOwnershipGrowthBytes=1200+1024;
const storageCapsuleGrowthBytes=12*1024;
const prePairingCurrentBytes=storageCapsuleGrowthBytes+layoutAndTrashReviewGrowthBytes+tabOwnershipGrowthBytes+continuousLibraryGrowthBytes+keyboardIsolationGrowthBytes+performanceGrowthBytes+centeredShellGrowthBytes+mobileLayoutGrowthBytes+prePairingMainBytes+photoURLRefreshGrowthBytes+themeGrowthBytes+loaderPairingOnboardingGrowthBytes+iosSwipeCancelGrowthBytes+isolationBytes;
const recoveryGrowthBudgetBytes=4*1024;
const leaseLifecycleGrowthBudgetBytes=2*1024;
const pairingServerErrorGrowthBytes=256;
const pairingLeaseFixGrowthBytes=2048;
const googleSyncGrowthBudgetBytes=6*1024;
const flashbacksOrderGrowthBytes=10*1024;
const autoSignInGrowthBytes=1024;
const localThumbnailGrowthBytes=3*1024;
const pairingGrowthBudgetBytes=localThumbnailGrowthBytes+flashbacksOrderGrowthBytes+autoSignInGrowthBytes+googleSyncGrowthBudgetBytes+15*1024+recoveryGrowthBudgetBytes+leaseLifecycleGrowthBudgetBytes+pairingServerErrorGrowthBytes+pairingLeaseFixGrowthBytes;
function assertPairingBundleBudget(source){assert.ok(source.length<=prePairingCurrentBytes+pairingGrowthBudgetBytes);assert.doesNotMatch(source.toString(),/@require\b/);for(const match of source.toString().matchAll(/@connect\s+(\S+)/g))assert.equal(match[1],'photoswiper-sync.sidlakkoju.workers.dev');}
test('pairing and Google sync bundle stays within its growth budgets without runtime dependencies',async()=>{assertPairingBundleBudget(await readFile(new URL('../userscript/photoswiper-app.user.js',import.meta.url)));});
test('pairing budget accepts its exact boundary and rejects one extra byte',()=>{
 const boundary=Buffer.alloc(prePairingCurrentBytes+pairingGrowthBudgetBytes,32);
 assertPairingBundleBudget(boundary);
 assert.throws(()=>assertPairingBundleBudget(Buffer.concat([boundary,Buffer.from(' ')])),assert.AssertionError);
});
test('pairing budget rejects runtime dependencies even below the size limit',()=>{
 for(const directive of ['require','connect'])assert.throws(()=>assertPairingBundleBudget(Buffer.from(`// @${directive} https://synthetic.example/dependency.js`)),assert.AssertionError);
});

const ui=await readFile(new URL('../lib/userscript-ui.mjs',import.meta.url),'utf8');
async function googleFixture(outcome='done',options={}){
 const elements=dom(),requests=[],values=new Map(),timers=new Map();let saved,opened,closed=0;
 const store={durable:true,settings:async()=>({token:'previous-token'}),saveSettings:async value=>{saved=value;}};
 const gm={setValue:async(key,value)=>values.set(key,value),getValue:async key=>values.get(key),deleteValue:async key=>{values.delete(key);if(options.cleanupFailure)throw Error('Storage unavailable');},openInTab:(url,options)=>{assert.equal(options.active,true);opened=url;return {close(){closed++;}};},xmlHttpRequest:request=>{requests.push(request);if(options.slow&&request.url.endsWith('/poll'))return;if(request.url.endsWith('/poll')&&options.pollResponses?.length){options.pollResponses.shift()(request);return;}request.onload({status:options.sessionFailure?500:200,responseText:JSON.stringify(request.url.endsWith('/session')?{url:'https://worker.example/auth/start'}:{status:outcome,token:'new-token',deviceId:'same-device'})});}};
 const sheet=elements.document.createElement('section'),settingsPanel=elements.document.createElement('details'),notice=elements.document.createElement('p'),button={id:'google-sign-in'},settingsButton={id:'google-settings'};sheet.hidden=true;sheet.append(settingsPanel);settingsPanel.append(notice);
 const messageListeners=new Set();
 const popup={location:{href:'about:blank'},close(){closed++;}};
 const context={writes:{flush:async()=>{},pending:false},syncRunning:null,sheet,settingsPanel,gear:elements.document.createElement('button'),sheetClose:elements.document.createElement('button'),environment:{GM:gm,crypto,setTimeout:(fn,delay)=>{timers.set(fn,delay);return fn;},clearTimeout:fn=>timers.delete(fn)},pairingPromise:Promise.resolve(store),googleSignIn:button,googleSettings:settingsButton,location:{href:'https://photos.google.com/u/0/'},URL,URLSearchParams,window:{history:{replaceState:(state,title,url)=>{context.restoredURL=url;}},addEventListener:(type,listener)=>messageListeners.add(listener),removeEventListener:(type,listener)=>messageListeners.delete(listener),location:options.sameTab?{}:Object.defineProperty({},'href',{set(){throw Error('Navigation unavailable');}}),navigator:{userAgent:options.ios?'iPhone':''},open:(url,target,features)=>{opened={url,target,features};return options.blockedPopup?null:popup;}},document:elements.document,pairingNotice:notice,identity:{account:'scope'},btoa,Uint8Array,suppressViewerShortcuts(){},syncClient:{configure(value){context.configured=value;}},onboarding:{},syncLocal:{},showSyncAccount(){},synchronize:async()=>{}};
 const start=ui.indexOf(' const signInGoogle=async(resumeState)=>{'),end=ui.indexOf(' const clearCredentials=',start);
 vm.runInNewContext('let cancelGoogleSignIn=null;'+ui.slice(ui.indexOf(' const openSettings='),ui.indexOf(' const openReview='))+ui.slice(start,end),context);
 Object.assign(context,{busy:false,otherTab:false,syncEnabled:false,pairSubmit:{},root:{querySelectorAll:()=>[button,settingsButton,...notice.children]},pairingModal:{modal:{contains:()=>false}},receivingPanel:null,$:()=>({setAttribute(){}})});
 vm.runInNewContext(ui.split('\n').find(line=>line.includes(' function controls()'))+'\nglobalThis.refreshControls=controls;',context);
 if(options.resume){values.set('photos-swipe-google-claim-secret','p'.repeat(43));values.set('photos-swipe-google-state','r'.repeat(43));if(options.fragment)context.location.href+='#photos-swipe-state='+ (options.mismatchedState?'s':'r').repeat(43)+'&photos-swipe-code='+ 'c'.repeat(43)+'&photos-swipe-return-hash=album';}
 const pending=options.resume?vm.runInNewContext('resumeGoogleSignIn()',context):button.onclick();
 const flush=()=>new Promise(resolve=>setImmediate(resolve));await flush();
 const deliverCode=(overrides={})=>{for(const listener of messageListeners)listener({origin:'https://photoswiper-sync.sidlakkoju.workers.dev',source:popup,data:{type:'photos-swipe-google-sign-in',state:values.get('photos-swipe-google-state'),code:'c'.repeat(43)},...overrides});};
 if(!options.withholdCode)deliverCode();
 const tick=async delay=>{const fn=[...timers].find(([,ms])=>ms===delay)?.[0];assert.ok(fn);timers.delete(fn);fn();await flush();};
 return {context,requests,timers,notice,button,settingsButton,pending,tick,flush,popup,deliverCode,get saved(){return saved;},get opened(){return opened;},get closed(){return closed;}};
}
for(const ios of [false])test(`Google poll done signs in automatically (${ios?'iOS tab':'desktop popup'})`,async()=>{
 const f=await googleFixture('done',{ios});assert.equal(f.opened.url,'https://worker.example/auth/start?return=https%3A%2F%2Fphotos.google.com%2Fu%2F0%2F');assert.equal(f.opened.features,ios?'':'popup,width=560,height=700');assert.match(f.notice.textContent,/Waiting for Google sign-in/);assert.equal(f.notice.children[0].textContent,'Cancel');
 await f.tick(2000);await f.pending;assert.equal(f.saved.token,'new-token');assert.equal(f.context.configured.token,'new-token');assert.equal(f.context.onboarding.hidden,true);assert.equal(f.requests[1].headers.Authorization,'Bearer previous-token');assert.equal(JSON.parse(f.requests[1].data).code,'c'.repeat(43));assert.ok(f.requests[1].url.endsWith('/poll'));assert.equal(f.button.disabled,false);assert.equal(f.settingsButton.disabled,false);assert.equal(f.timers.size,0);
});
for(const outcome of ['cancel','close','timeout','failed','expired','session','cleanup','inflight'])test(`Google sign-in ${outcome} stops and restores both buttons`,async()=>{
 const f=await googleFixture(outcome==='cleanup'?'done':outcome,{sessionFailure:outcome==='session',cleanupFailure:outcome==='cleanup',slow:outcome==='inflight'});
 if(outcome==='cancel')f.notice.children[0].onclick();
 else if(outcome==='close')f.context.sheetClose.onclick();
 else if(outcome==='timeout')await f.tick(300000);
 else if(outcome==='inflight'){await f.tick(2000);f.notice.children[0].onclick();}
 else if(outcome!=='session')await f.tick(2000);
 await f.pending;assert.equal(f.button.disabled,false);assert.equal(f.settingsButton.disabled,false);assert.equal(f.timers.size,0);assert.equal(f.notice.children[0]?.hidden,true);
 if(outcome!=='cleanup')assert.equal(f.saved,undefined);
 const count=f.requests.length;await f.flush();assert.equal(f.requests.length,count);
});

for(const ending of ['done','cancel','close'])test(`viewer control refresh preserves a single Google sign-in and ${ending}`,async()=>{
 const f=await googleFixture('done');
 for(const busy of [false,true])for(const identity of [{account:'scope'},null]){
  f.context.busy=busy;f.context.identity=identity;f.context.refreshControls();
  assert.equal(f.button.disabled,true);assert.equal(f.settingsButton.disabled,true);assert.ok(!f.notice.children[0].disabled);
  await f.button.onclick();await f.settingsButton.onclick();
  assert.equal(f.requests.length,1);assert.equal(f.closed,0);
 }
 if(ending==='done')await f.tick(2000);
 else if(ending==='cancel')f.notice.children[0].onclick();
 else f.context.sheetClose.onclick();
 await f.pending;
 assert.equal(f.button.disabled,false);assert.equal(f.settingsButton.disabled,false);assert.equal(f.closed,1);assert.equal(f.timers.size,0);
 assert.equal(f.saved?.token,ending==='done'?'new-token':undefined);
});

for(const failure of ['network','timeout','http','json'])test(`Google polling retries ${failure} failures until sign-in completes`,async()=>{
 const response=request=>{if(failure==='network')request.onerror();else if(failure==='timeout')request.ontimeout();else request.onload({status:failure==='http'?503:200,responseText:failure==='json'?'invalid':JSON.stringify({error:'Unavailable'})});};
 const f=await googleFixture('done',{pollResponses:[response,request=>request.onload({status:200,responseText:JSON.stringify({status:'pending'})})]});
 for(let attempt=0;attempt<2;attempt++){await f.tick(2000);assert.equal(f.closed,0);assert.equal(f.saved,undefined);assert.equal(f.button.disabled,true);assert.equal(f.settingsButton.disabled,true);}
 await f.tick(2000);await f.pending;assert.equal(f.saved.token,'new-token');assert.equal(f.closed,1);assert.equal(f.timers.size,0);
});
test('Google polling failures remain cancellable and respect the session deadline',async()=>{
 for(const ending of ['cancel','deadline']){
  const f=await googleFixture('done',{pollResponses:[request=>request.onerror()]});
  await f.tick(2000);assert.equal(f.closed,0);
  if(ending==='cancel')f.notice.children[0].onclick();else await f.tick(300000);
  await f.pending;assert.equal(f.saved,undefined);assert.equal(f.closed,1);assert.equal(f.button.disabled,false);assert.equal(f.settingsButton.disabled,false);assert.equal(f.timers.size,0);
 }
});

for(const outcome of ['done','expired','failed'])test('claim on load handles '+outcome,async()=>{const f=await googleFixture(outcome,{resume:true});await f.pending;assert.equal(f.opened,undefined);assert.equal(f.requests.length,1);assert.ok(f.requests[0].url.endsWith('/poll'));assert.equal(await f.context.environment.GM.getValue('photos-swipe-google-state'),undefined);assert.equal(f.button.disabled,false);if(outcome==='done')assert.equal(f.saved.token,'new-token');else{assert.equal(f.saved,undefined);assert.match(f.notice.textContent,/timed out|failed/);}});

for(const invalid of ['origin','source','state','code'])test(`Google popup ignores completion with invalid ${invalid}`,async()=>{
 const f=await googleFixture('done',{withholdCode:true,pollResponses:[request=>request.onload({status:200,responseText:JSON.stringify({status:'pending'})})]});
 const overrides=invalid==='origin'?{origin:'https://evil.test'}:invalid==='source'?{source:{}}:{data:{type:'photos-swipe-google-sign-in',state:await f.context.environment.GM.getValue('photos-swipe-google-state'),code:'c'.repeat(43),[invalid]:invalid==='state'?'s'.repeat(43):'invalid'}};
 f.deliverCode(overrides);await f.tick(2000);assert.equal(JSON.parse(f.requests[1].data).code,undefined);assert.equal(f.saved,undefined);
 f.deliverCode();await f.tick(2000);await f.pending;assert.equal(JSON.parse(f.requests[2].data).code,'c'.repeat(43));assert.equal(f.saved.token,'new-token');
});

for(const ios of [false,true])test('same-tab sign-in is primary and preserves state '+ios,async()=>{
 const f=await googleFixture('done',{ios,sameTab:true});await f.pending;
 assert.equal(f.opened,undefined);assert.equal(f.requests.length,1);assert.equal(f.context.window.location.href,'https://worker.example/auth/start?return=https%3A%2F%2Fphotos.google.com%2Fu%2F0%2F');
 const state=await f.context.environment.GM.getValue('photos-swipe-google-state');assert.equal(state.length,43);
 assert.equal(f.requests[0].headers.Authorization,'Bearer previous-token');assert.equal(JSON.parse(f.requests[0].data).automatic,true);
 await f.button.onclick();assert.equal(f.requests.length,1);assert.equal(await f.context.environment.GM.getValue('photos-swipe-google-state'),state);
});
test('pending state without a return code stays available for retry',async()=>{
 const f=await googleFixture('pending',{resume:true,withholdCode:true});
 assert.equal(JSON.parse(f.requests[0].data).code,undefined);assert.equal(f.saved,undefined);
 assert.equal(await f.context.environment.GM.getValue('photos-swipe-google-state'),'r'.repeat(43));
 await f.tick(2000);assert.equal(f.saved,undefined);assert.equal(f.button.disabled,true);
 f.notice.children[0].onclick();await f.pending;
});
test('opener-less fallback returns to Photos for a cookie-less code claim',async()=>{
 const f=await googleFixture('pending',{blockedPopup:true,withholdCode:true});
 assert.equal(f.opened,'https://worker.example/auth/start?return=https%3A%2F%2Fphotos.google.com%2Fu%2F0%2F');
 await f.tick(2000);assert.equal(f.saved,undefined);assert.equal(JSON.parse(f.requests[1].data).code,undefined);
 const returned=await googleFixture('done',{resume:true,fragment:true,withholdCode:true});await returned.pending;
 assert.equal(JSON.parse(returned.requests[0].data).code,'c'.repeat(43));assert.equal(returned.requests[0].headers.Cookie,undefined);assert.equal(returned.saved.token,'new-token');
 f.notice.children[0].onclick();await f.pending;
});

test('same-tab return consumes the one-time code without a browser cookie and restores the hash',async()=>{
 const f=await googleFixture('done',{resume:true,fragment:true,withholdCode:true});await f.pending;
 assert.equal(JSON.parse(f.requests[0].data).code,'c'.repeat(43));assert.equal(f.requests[0].headers.Cookie,undefined);
 assert.equal(f.context.restoredURL,'https://photos.google.com/u/0/#album');assert.equal(f.saved.token,'new-token');
 assert.equal(await f.context.environment.GM.getValue('photos-swipe-google-state'),undefined);
});

test('pair hand-off uses a hash-bound CSP, never fetches and exposes only valid Safari links',async()=>{for(const code of ['', 'invalid', 'abcdefghijklmnopqrstuv']){const response=await pairPage(new Request('https://worker.example/pair'));const html=await response.text(),script=html.match(/<script>(.*?)<\/script>/s)[1];assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');assert.equal(response.headers.get('Cache-Control'),'no-store');assert.ok(response.headers.get('Content-Security-Policy').includes("script-src 'sha256-"+createHash('sha256').update(script).digest('base64')+"'"));const nodes={open:{hidden:true},copy:{hidden:true},status:{}};vm.runInNewContext(script,{location:{hash:'#'+code,origin:'https://worker.example'},document:{getElementById:id=>nodes[id]},navigator:{clipboard:{writeText:async value=>assert.equal(value,nodes.open.href)}}});assert.equal(nodes.open.hidden,code.length!==22);if(code.length===22){assert.equal(nodes.open.href,'https://photos.google.com/#pswipe-pair='+code+'&origin=https%3A%2F%2Fworker.example');await nodes.copy.onclick();}}});

test('same-tab claim proof stays in private storage and resumes without cookies or URL secrets',async()=>{
 const started=await googleFixture('done',{sameTab:true});await started.pending;
 const session=JSON.parse(started.requests[0].data),secret=await started.context.environment.GM.getValue('photos-swipe-google-claim-secret');
 assert.equal(session.automatic,true);assert.match(secret,/^[A-Za-z0-9_-]{43}$/);assert.equal(session.claimSecret,secret);assert.notEqual(secret,session.state);assert.ok(!started.context.window.location.href.includes(secret));
 const returned=await googleFixture('done',{resume:true,withholdCode:true});await returned.pending;
 const poll=JSON.parse(returned.requests[0].data);assert.equal(poll.claimSecret,'p'.repeat(43));assert.equal(poll.code,undefined);assert.equal(returned.requests[0].headers.Cookie,undefined);assert.equal(returned.saved.token,'new-token');
 assert.equal(await returned.context.environment.GM.getValue('photos-swipe-google-claim-secret'),undefined);
});
