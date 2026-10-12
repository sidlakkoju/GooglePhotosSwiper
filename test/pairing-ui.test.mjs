import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {pairingQR,renderPairingQR} from '../lib/userscript-qr.mjs';
import {createPairingModal,receivePairingLink} from '../lib/userscript-pairing.mjs';
import {pairPage} from '../worker/src/pair-page.mjs';
function dom(){const document={createElement:tag=>({tag,style:{},children:[],hidden:false,textContent:'',setAttribute(key,value){this[key]=value;},append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},focus(){},addEventListener(){}})};return {document,parent:document.createElement('div')};}
function descendants(node){return node.children.flatMap(child=>[child,...descendants(child)]);}
function pairingField(panel,id){return descendants(panel).find(node=>node.id===id);}
function pairingSubmit(panel){return descendants(panel).find(node=>node.tag==='button'&&node.textContent==='Pair this device');}
function fixture(){const elements=dom(),calls=[],timers=[];let time=10000,claimed=false;const pairing={id:'pair-id',code:'abcdefghijklmnopqrstuv',short:'123456',expiresAt:15000};const modal=createPairingModal({...elements,settings:async()=>({url:'https://worker.example',token:'secret-token'}),fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>url.includes('status')?{claimed,name:'iPhone (Safari)'}:pairing};},now:()=>time,setTimeout:callback=>{timers.push(callback);return callback;},clearTimeout:callback=>{const index=timers.indexOf(callback);if(index>=0)timers.splice(index,1);},renderQR:(document,url)=>{const node=document.createElement('canvas');node.url=url;return node;}});return {...modal,calls,timers,pairing,setTime:value=>time=value,claim:()=>claimed=true};}
test('modal shows QR, short code and server expiry, polls and announces paired device',async()=>{const f=fixture();const pending=f.open();assert.equal(f.modal.children[0].textContent,'Loading pairing code…');await pending;assert.equal(f.modal.children[2].textContent,'123 456');assert.equal(f.modal.children[3].textContent,'00:05');assert.equal(f.modal.children[1].children[0].url,'https://worker.example/pair#abcdefghijklmnopqrstuv');assert.ok(!JSON.stringify(f.modal).includes('secret-token'));f.setTime(12500);f.claim();await f.timers.shift()();assert.equal(f.modal.children[0].textContent,'New device paired: iPhone (Safari)');assert.equal(f.modal.children[6].hidden,false);assert.equal(f.timers.length,0);});
test('expiry burns the code and offers a new code; cancel burns and stops timers',async()=>{const f=fixture();await f.open();f.setTime(15000);await f.timers.shift()();assert.equal(f.modal.children[0].textContent,'Code expired');assert.equal(f.modal.children[5].hidden,false);assert.equal(f.calls.at(-2).options.method,'DELETE');f.setTime(10000);await f.modal.children[5].onclick();await f.close();assert.equal(f.modal.hidden,true);assert.equal(f.timers.length,0);assert.equal(f.calls.at(-2).options.body,JSON.stringify({id:'pair-id'}));});
test('unpaired and revoked devices cannot create a QR',async()=>{for(const token of ['', 'revoked']){const elements=dom();let requests=0;const f=createPairingModal({...elements,settings:async()=>({url:'https://worker.example',token}),fetch:async()=>{requests++;return {ok:false,status:401};},setTimeout,clearTimeout});await f.open();assert.equal(f.modal.children[0].textContent,'Pair this device first.');assert.equal(requests,token?1:0);assert.equal(f.modal.children[1].children.length,0);}});
test('cancel during start burns the returned code without reopening the modal',async()=>{const elements=dom(),calls=[];let resolve;const f=createPairingModal({...elements,settings:async()=>({url:'https://worker.example',token:'token'}),fetch:async(url,options)=>{calls.push(options.method);if(options.method==='POST')return new Promise(done=>resolve=done);return {ok:true,json:async()=>({ok:true})};},setTimeout,clearTimeout});const pending=f.open();await new Promise(done=>setImmediate(done));await f.close();resolve({ok:true,json:async()=>({id:'late-code'})});await pending;assert.deepEqual(calls,['POST','DELETE']);assert.equal(f.modal.hidden,true);});
test('pair hand-off uses a hash-bound CSP, never fetches and exposes only valid Safari links',async()=>{for(const code of ['', 'invalid', 'abcdefghijklmnopqrstuv']){const response=await pairPage(new Request('https://worker.example/pair'));const html=await response.text(),script=html.match(/<script>(.*?)<\/script>/s)[1];assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');assert.equal(response.headers.get('Cache-Control'),'no-store');assert.ok(response.headers.get('Content-Security-Policy').includes("script-src 'sha256-"+createHash('sha256').update(script).digest('base64')+"'"));const nodes={open:{hidden:true},copy:{hidden:true},status:{}};vm.runInNewContext(script,{location:{hash:'#'+code,origin:'https://worker.example'},document:{getElementById:id=>nodes[id]},navigator:{clipboard:{writeText:async value=>assert.equal(value,nodes.open.href)}}});assert.equal(nodes.open.hidden,code.length!==22);if(code.length===22){assert.equal(nodes.open.href,'https://photos.google.com/#pswipe-pair='+code+'&origin=https%3A%2F%2Fworker.example');await nodes.copy.onclick();}}});
test('receiving the hand-off waits for consent, removes the fragment and stores the claimed token',async()=>{const elements=dom(),calls=[];let saved,opened=false,removed=false;receivePairingLink({...elements,location:{hash:'#pswipe-pair=abcdefghijklmnopqrstuv',pathname:'/',search:''},window:{history:{replaceState:()=>removed=true},navigator:{userAgent:'iPhone',platform:'iPhone'}},fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({token:'new-token'})};},saveSettings:async value=>saved=value,onPaired:async()=>opened=true});assert.equal(calls.length,0);assert.equal(removed,true);await pairingSubmit(elements.parent.children[0]).onclick();assert.equal(saved.token,'new-token');assert.equal(opened,true);assert.equal(JSON.parse(calls[0].options.body).name,'iPhone (Safari)');});
test('QR byte payload round-trips 20 random codes with ECC M and a four-module quiet zone',()=>{for(let sample=0;sample<20;sample++){const url='https://photoswiper-sync.sidlakkoju.workers.dev/pair#'+randomBytes(16).toString('base64url'),matrix=pairingQR(url),stream=[];const reserved=(x,y)=>(x<=8&&y<=8)||(x>=29&&y<=8)||(x<=8&&y>=29)||x===6||y===6||(x>=28&&x<=32&&y>=28&&y<=32);let up=true;for(let right=36;right>=1;right-=2){if(right===6)right=5;for(let step=0;step<37;step++){const y=up?36-step:step;for(let offset=0;offset<2;offset++){const x=right-offset;if(!reserved(x,y))stream.push(Number(matrix[y][x])^Number((x+y)%2===0));}}up=!up;}const bytes=[];for(let i=0;i<134;i++)bytes.push(stream.slice(i*8,i*8+8).reduce((a,b)=>a*2+b,0));const data=[];for(let block=0;block<2;block++)for(let i=0;i<43;i++)data.push(bytes[i*2+block]);const bits=data.flatMap(byte=>Array.from({length:8},(_,i)=>byte>>>(7-i)&1));const integer=(start,length)=>bits.slice(start,start+length).reduce((a,b)=>a*2+b,0);assert.equal(integer(0,4),4);assert.equal(integer(4,8),url.length);assert.equal(String.fromCharCode(...Array.from({length:url.length},(_,i)=>integer(12+i*8,8))),url);}});
test('QR matches an independent version 5 M byte-mode vector',()=>assert.equal(createHash('sha256').update(JSON.stringify(pairingQR('https://photoswiper-sync.sidlakkoju.workers.dev/pair#abcdefghijklmnopqrstuv'))).digest('hex'),'36c38d85871a0f1b59ad7e26abbb64a5b4fe2ec92e758a132b2e6804c9744552'));
test('manual fallback sends only the six-digit short code in the claim body',async()=>{const elements=dom();let body;receivePairingLink({...elements,location:{hash:''},window:{navigator:{}},manual:true,fetch:async(url,options)=>{body=JSON.parse(options.body);return {ok:true,json:async()=>({token:'token'})};},saveSettings:async()=>{},onPaired:async()=>{}});const panel=elements.parent.children[0];pairingField(panel,'pairing-short-code').value='123 456';await pairingSubmit(panel).onclick();assert.equal(body.short,'123456');assert.equal(body.code,undefined);});
test('countdown keeps updating while a status request is slow',async()=>{const elements=dom(),timers=[];let time=10000,resolve;const f=createPairingModal({...elements,settings:async()=>({url:'https://worker.example',token:'token'}),fetch:async url=>url.includes('status')?new Promise(done=>resolve=done):{ok:true,json:async()=>({id:'id',code:'abcdefghijklmnopqrstuv',short:'123456',expiresAt:20000})},now:()=>time,setTimeout:callback=>{timers.push(callback);return callback;},clearTimeout:callback=>{const index=timers.indexOf(callback);if(index>=0)timers.splice(index,1);},renderQR:document=>document.createElement('canvas')});await f.open();time=12500;const pending=timers.shift()();time=14000;await timers.shift()();assert.equal(f.modal.children[3].textContent,'00:06');resolve({ok:true,json:async()=>({claimed:true,name:'Phone'})});await pending;assert.equal(timers.length,0);});

test('QR renderer includes a four-module white quiet zone',()=>{const elements=dom(),fills=[];const create=elements.document.createElement;elements.document.createElement=tag=>{const canvas=create(tag);canvas.getContext=()=>({fillRect:(...args)=>fills.push(args)});return canvas;};const canvas=renderPairingQR(elements.document,'https://photoswiper-sync.sidlakkoju.workers.dev/pair#abcdefghijklmnopqrstuv');assert.equal(canvas.width,270);assert.equal(canvas.height,270);assert.deepEqual(fills[0],[0,0,270,270]);for(const [x,y,width,height] of fills.slice(1)){assert.ok(x>=24&&y>=24&&x+width<=246&&y+height<=246);}});
const prePairingMainBytes=84973;
const photoURLRefreshGrowthBytes=3194;
const themeGrowthBytes=3078;
const performanceGrowthBytes=76764-58137;
const loaderPairingOnboardingGrowthBytes=701;
const iosSwipeCancelGrowthBytes=200;
const isolationModules=await Promise.all(['settings','bridge'].map(name=>readFile(new URL(`../lib/userscript-${name}.mjs`,import.meta.url),'utf8')));
const isolationBytes=isolationModules.reduce((size,module)=>size+Buffer.byteLength(module.replace(/[^\x00-\x7f]/g,character=>`\\u${character.charCodeAt(0).toString(16).padStart(4,'0')}`)),1024);
const centeredShellGrowthBytes=12000;
const prePairingCurrentBytes=performanceGrowthBytes+centeredShellGrowthBytes+prePairingMainBytes+photoURLRefreshGrowthBytes+themeGrowthBytes+loaderPairingOnboardingGrowthBytes+iosSwipeCancelGrowthBytes+isolationBytes;
const recoveryGrowthBudgetBytes=4*1024;
const pairingServerErrorGrowthBytes=256;
const pairingGrowthBudgetBytes=15*1024+recoveryGrowthBudgetBytes+pairingServerErrorGrowthBytes;
function assertPairingBundleBudget(source){assert.ok(source.length<=prePairingCurrentBytes+pairingGrowthBudgetBytes);assert.doesNotMatch(source.toString(),/@(?:require|connect)\b/);}
test('pairing bundle stays within the 15 KB pairing and 4 KB recovery growth budgets without runtime dependencies',async()=>{assertPairingBundleBudget(await readFile(new URL('../userscript/photoswiper.user.js',import.meta.url)));});
test('pairing budget accepts its exact boundary and rejects one extra byte',()=>{
 const boundary=Buffer.alloc(prePairingCurrentBytes+pairingGrowthBudgetBytes,32);
 assertPairingBundleBudget(boundary);
 assert.throws(()=>assertPairingBundleBudget(Buffer.concat([boundary,Buffer.from(' ')])),assert.AssertionError);
});
test('pairing budget rejects runtime dependencies even below the size limit',()=>{
 for(const directive of ['require','connect'])assert.throws(()=>assertPairingBundleBudget(Buffer.from(`// @${directive} https://synthetic.example/dependency.js`)),assert.AssertionError);
});

test('custom Worker hand-off and manual codes claim and save the issuing origin',async()=>{
 for(const manual of [false,true]){
  const elements=dom(),calls=[];let saved;
  const panel=receivePairingLink({...elements,manual,url:'https://configured.example',location:{hash:manual?'':'#pswipe-pair=abcdefghijklmnopqrstuv&origin=https%3A%2F%2Fissuer.example',pathname:'/',search:''},window:{history:{replaceState(){}},navigator:{}},fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({token:'claimed-token'})};},saveSettings:async value=>saved=value,onPaired:async()=>{}});
  if(manual){pairingField(panel,'pairing-short-code').value='123 456';assert.equal(pairingField(panel,'pairing-server').value,'https://configured.example');pairingField(panel,'pairing-server').value='https://issuer.example/';}
  await pairingSubmit(panel).onclick();
  assert.equal(calls[0].url,'https://issuer.example/api/pair/claim');assert.equal(saved.url,'https://issuer.example');assert.equal(saved.token,'claimed-token');assert.equal(JSON.parse(calls[0].options.body)[manual?'short':'code'],manual?'123456':'abcdefghijklmnopqrstuv');
 }
});

test('poll failures retain the code, retry polling and burn it at expiry',async()=>{
 const elements=dom(),timers=[],calls=[];let time=10000,fail=true;
 const f=createPairingModal({...elements,settings:async()=>({url:'https://worker.example',token:'token'}),fetch:async(url,options)=>{calls.push(options.method);if(url.includes('status')&&fail)throw Error('Offline');return {ok:true,json:async()=>url.includes('status')?{claimed:false}:{id:'id',code:'abcdefghijklmnopqrstuv',short:'123456',expiresAt:20000}};},now:()=>time,setTimeout:callback=>{timers.push(callback);return callback;},clearTimeout:callback=>{const index=timers.indexOf(callback);if(index>=0)timers.splice(index,1);},renderQR:document=>document.createElement('canvas')});
 await f.open();time=12500;await timers.shift()();assert.equal(f.modal.children[2].textContent,'123 456');assert.equal(f.modal.children[1].children.length,1);assert.equal(timers.length,1);fail=false;time=15000;await timers.shift()();assert.equal(calls.filter(method=>method==='GET').length,2);fail=true;time=20000;await timers.shift()();assert.equal(calls.at(-2),'DELETE');assert.equal(f.modal.children[0].textContent,'Code expired. Offline');assert.equal(timers.length,0);
});

for(const action of ['cancel','expiry'])test(`${action} announces a claim returned by an in-flight status request`,async()=>{
 const elements=dom(),timers=[],calls=[];let time=10000,resolve,statusReads=0;
 const f=createPairingModal({...elements,settings:async()=>({url:'https://worker.example',token:'synthetic-token'}),fetch:async(url,options)=>{calls.push({url,method:options.method});if(url.includes('status')){statusReads++;if(statusReads===1)return new Promise(done=>resolve=done);return {ok:true,json:async()=>({claimed:false})};}return {ok:true,json:async()=>({id:'id',code:'abcdefghijklmnopqrstuv',short:'123456',expiresAt:15000})};},now:()=>time,setTimeout:callback=>{timers.push(callback);return callback;},clearTimeout:callback=>{const index=timers.indexOf(callback);if(index>=0)timers.splice(index,1);},renderQR:document=>document.createElement('canvas')});
 await f.open();time=12500;const pending=timers.shift()();time=15000;const finishing=action==='cancel'?f.close():timers.shift()();
 assert.equal(calls.at(-1).method,'DELETE');resolve({ok:true,json:async()=>({claimed:true,name:'Synthetic phone'})});await Promise.all([pending,finishing]);
 assert.equal(statusReads,2);assert.equal(f.modal.hidden,false);assert.equal(f.modal.children[0].textContent,'New device paired: Synthetic phone');assert.equal(f.modal.children[6].hidden,false);assert.equal(timers.length,0);
});

for(const action of ['cancel','expiry'])test(`${action} reads final status after burning and announces a claim`,async()=>{
 const f=fixture();await f.open();f.claim();f.setTime(15000);await (action==='cancel'?f.close():f.timers.shift()());
 assert.equal(f.calls.at(-2).options.method,'DELETE');assert.match(f.calls.at(-1).url,/pair\/status/);assert.equal(f.modal.hidden,false);assert.equal(f.modal.children[0].textContent,'New device paired: iPhone (Safari)');assert.equal(f.modal.children[6].hidden,false);
});

test('failed cleanup after cancellation exposes a retryable Cancel',async()=>{
 const elements=dom();let resolve,fail=true,deletes=0;
 const f=createPairingModal({...elements,settings:async()=>({url:'https://worker.example',token:'token'}),fetch:async(url,options)=>{if(options.method==='POST')return new Promise(done=>resolve=done);if(options.method==='DELETE')deletes++;if(fail)throw Error('Offline');return {ok:true,json:async()=>({ok:true})};},setTimeout,clearTimeout});
 const pending=f.open();await new Promise(done=>setImmediate(done));await f.close();resolve({ok:true,json:async()=>({id:'late-code'})});await pending;assert.equal(f.modal.hidden,false);assert.match(f.modal.children[0].textContent,/Could not cancel/);fail=false;await f.modal.children[4].onclick();assert.equal(deletes,2);assert.equal(f.modal.hidden,true);
});

const ui=await readFile(new URL('../lib/userscript-ui.mjs',import.meta.url),'utf8');
test('pairing dialog traps Tab in both directions and blocks background activation',()=>{
 let listener,focused,closed=0;
 const buttons=Array.from({length:3},()=>({getClientRects:()=>[{}],focus(){focused=this;root.activeElement=this;}}));
 const dialog={hidden:false,contains:element=>buttons.includes(element),querySelectorAll:()=>buttons,querySelector:()=>buttons[0]};
 const root={activeElement:{}};
 vm.runInNewContext(ui.slice(ui.indexOf(" window.addEventListener('keydown',event=>{"),ui.lastIndexOf('\n}')),{window:{addEventListener:(type,handler)=>listener=handler},root,activePairingDialog:()=>dialog,pairingModal:{modal:dialog,close:()=>closed++},handleViewerSpace:()=>false});
 const press=(key,shiftKey=false)=>{const event={key,shiftKey,prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};listener(event);assert.equal(event.prevented,true);assert.equal(event.stopped,true);};
 press('Tab');assert.equal(focused,buttons[0]);press('Tab',true);assert.equal(focused,buttons[2]);press('Tab');assert.equal(focused,buttons[0]);root.activeElement={};press('Enter');assert.equal(focused,buttons[0]);press('Escape');assert.equal(closed,1);
});

test('repeated receiver activation reuses one panel and focuses it',()=>{
 let panels=0,focuses=0;
 const panel={hidden:false,querySelector:()=>({focus:()=>focuses++})};
 const context={receivePairingLink:()=>{panels++;return panel;},document:{},root:{},location:{},window:{},environment:{},database:async()=>{},open(){},$:()=>({value:''})};
 vm.createContext(context);vm.runInContext(ui.slice(ui.indexOf(' let receivingPanel;'),ui.indexOf(' const pairThis='))+'\nglobalThis.receive=receivePairing;',context);
 context.receive(true);context.receive(true);assert.equal(panels,1);assert.equal(focuses,1);panel.hidden=true;context.receive(true);assert.equal(panels,1);assert.equal(panel.hidden,false);
});

test('busy viewer controls leave pairing Cancel enabled',()=>{
 const cancel={id:'',disabled:false},keep={id:'keep',disabled:false},receiverCancel={id:'',disabled:false};
 const context={root:{querySelectorAll:()=>[cancel,keep,receiverCancel]},pairingModal:{modal:{contains:button=>button===cancel}},receivingPanel:{contains:button=>button===receiverCancel},busy:true,identity:null,savingDecisions:false,reviewingUndo:false,syncEnabled:false,$:()=>({setAttribute(){}})};
 vm.runInNewContext(ui.slice(ui.indexOf(' function controls()'),ui.indexOf('\n',ui.indexOf(' function controls()')))+'\ncontrols();',context);
 assert.equal(cancel.disabled,false);assert.equal(receiverCancel.disabled,false);assert.equal(keep.disabled,true);
});

test('hash changes in an already mounted Photos tab open consent for the latest code',async()=>{
 const elements=dom(),listeners={},calls=[],location={hash:'',pathname:'/',search:''};let saved;
 elements.document.createElement=((create)=>tag=>{const node=create(tag);node.remove=()=>{elements.parent.children=elements.parent.children.filter(child=>child!==node);};return node;})(elements.document.createElement);
 const context={receivePairingLink,document:elements.document,root:elements.parent,location,window:{navigator:{},history:{replaceState(){location.hash='';}},addEventListener:(type,handler)=>listeners[type]=handler},environment:{fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({token:'synthetic-token'})};}},pairingPromise:Promise.resolve({saveSettings:async value=>saved=value}),open(){},$:()=>({value:''}),settingsPanel:elements.document.createElement('div'),onboardPair:{onclick(){}}};
 vm.runInNewContext(ui.slice(ui.indexOf(' let receivingPanel;'),ui.indexOf(" $('launcher').onclick=open;")),context);
 assert.equal(elements.parent.children.length,0);
 for(const code of ['abcdefghijklmnopqrstuv','zyxwvutsrqponmlkjihgfe']){
  location.hash='#pswipe-pair='+code+'&origin=https%3A%2F%2Fissuer.example';listeners.hashchange();assert.equal(location.hash,'');assert.equal(elements.parent.children.length,1);assert.equal(calls.length,code.startsWith('a')?0:1);
  await pairingSubmit(elements.parent.children[0]).onclick();assert.equal(calls.at(-1).body.code,code);assert.equal(saved.url,'https://issuer.example');
 }
 location.hash='#unrelated';listeners.hashchange();assert.equal(elements.parent.children[0].hidden,true);
});

test('unpaired onboarding opens the existing receiver and Continue locally dismisses it',async()=>{
 const ui=await readFile(new URL('../lib/userscript-ui.mjs',import.meta.url),'utf8'),elements=dom();
 let received=false;
 const context={document:elements.document,divElement4:{insertBefore(){}},cardElement:{},receivePairing:manual=>received=manual};
 vm.runInNewContext(ui.slice(ui.indexOf(" const onboarding=document.createElement"),ui.indexOf(" for(const [id,title,type]"))+ '\nglobalThis.card=onboarding;globalThis.local=syncLocal;',context);
 const card=context.card;
 assert.equal(card.children[0].textContent,'Pair this device');assert.match(card.children[1].textContent,/paired device.*6-digit code/);
 card.children[2].onclick();assert.equal(received,true);assert.equal(context.local.textContent,'Continue locally');
 const opening=ui.slice(ui.indexOf('   let settings={};',ui.indexOf(' async function openSession()')),ui.indexOf('  }catch(error)',ui.indexOf(' async function openSession()')));
 for(const settings of [{},{onboardingDismissed:true},{url:'https://worker.example',token:'synthetic-token'}]){
  const nodes={},node=id=>nodes[id]||(nodes[id]={});
  const state={$:node,pairingPromise:Promise.resolve({settings:async()=>settings}),pairingNotice:{},unpairedBanner:{},syncClient:{configure(){}},settingsPanel:{},onboarding:card,syncLocal:context.local,synchronize:async()=>{},missing:false,message(){},idleMessage:()=>''};
  await vm.runInNewContext('(async()=>{'+opening+'})()',state);
  assert.equal(card.hidden,!!(settings.token||settings.onboardingDismissed));assert.equal(node('sync-token').value,'');
 }
 let saved;
 const dismissal={closeSettings(){},$:()=>context.local,run:fn=>fn(),pairingPromise:Promise.resolve({settings:async()=>({}),saveSettings:async value=>saved=value}),settingsPanel:{},onboarding:card,message(){},idleMessage:()=>''};
 vm.runInNewContext(ui.split('\n').find(line=>line.includes("$('sync-local').onclick=")),dismissal);await context.local.onclick();
 assert.equal(saved.onboardingDismissed,true);assert.equal(card.hidden,true);
});

test('settings and onboarding pairing buttons share receiver activation',()=>{
 const elements=dom();let received=0;
 const onboardPair={onclick:()=>received++};
 const context={document:elements.document,settingsPanel:elements.parent,onboardPair,receivePairing:()=>{}};
 vm.runInNewContext(ui.split('\n').find(line=>line.includes(' const pairThis=')),context);
 const button=elements.parent.children[0];
 assert.equal(button.textContent,'Pair this device');assert.equal(button.onclick,onboardPair.onclick);
 button.onclick();assert.equal(received,1);
});

test('manual pairing has visible bound labels, a code hint and a collapsed default server',()=>{
 const elements=dom();
 const panel=receivePairingLink({...elements,manual:true,location:{hash:''},window:{navigator:{}}});
 const nodes=descendants(panel),labels=nodes.filter(node=>node.tag==='label');
 assert.deepEqual(labels.map(label=>label.textContent),['Device name','6-digit code from a paired device','Sync server']);
 assert.equal(new Set(labels.map(label=>label.for)).size,3);
 for(const label of labels){assert.ok(label.for);assert.equal(pairingField(panel,label.for).tag,'input');}
 const hint=pairingField(panel,'pairing-code-hint');
 assert.equal(hint.textContent,"Get a code from Settings > Sync on a device that's already paired");
 assert.equal(pairingField(panel,'pairing-short-code')['aria-describedby'],hint.id);
 const advanced=nodes.find(node=>node.tag==='details');
 assert.equal(advanced.open,false);assert.equal(advanced.children[0].tag,'summary');assert.equal(advanced.children[0].textContent,'Advanced');
 assert.ok(advanced.children.includes(pairingField(panel,'pairing-server')));
 assert.equal(pairingField(panel,'pairing-server').value,'https://photoswiper-sync.sidlakkoju.workers.dev');
 assert.equal(panel.className,'pairing-receiver settings-sheet');
 assert.match(ui,/\.pairing-receiver\{[^}]*background:var\(--ps-bg\)/);
 assert.match(ui,/\.pairing-receiver input\{[^}]*min-height:44px/);
});

test('manual pairing code accepts only six ASCII digits on input',()=>{
 const elements=dom();
 const panel=receivePairingLink({...elements,manual:true,location:{hash:''},window:{navigator:{}}});
 const code=pairingField(panel,'pairing-short-code');
 assert.equal(code.inputmode,'numeric');assert.equal(code.pattern,'[0-9]{6}');assert.equal(code.maxlength,undefined);assert.equal(code.autocomplete,'one-time-code');
 for(const [value,expected] of [['12a 3-456','123456'],['123456789','123456'],['abc１２٣!',''],['000012','000012']]){code.value=value;code.oninput();assert.equal(code.value,expected);}
});


test('pasting a displayed pairing code preserves all six digits in the claim',async()=>{
 for(const pasted of ['123 456','000 012','12a 3-456','123456789']){
  const elements=dom();let body;
  const panel=receivePairingLink({...elements,manual:true,location:{hash:''},window:{navigator:{}},fetch:async(url,options)=>{body=JSON.parse(options.body);return {ok:true,json:async()=>({token:'token'})};},saveSettings:async()=>{},onPaired:async()=>{}});
  const code=pairingField(panel,'pairing-short-code');
  const maximumLength=code.maxlength===undefined?Infinity:Number(code.maxlength);
  code.value=pasted.slice(0,maximumLength);code.oninput();
  const expected=pasted.replace(/[^0-9]/g,'').slice(0,6);
  assert.equal(code.value,expected);
  await pairingSubmit(panel).onclick();
  assert.equal(body.short,expected);assert.equal(body.code,undefined);
 }
});

test('pairing claims distinguish server failures from unavailable codes and allow retry',async()=>{
 for(const manual of [true,false])for(const status of [400,429,500,503]){
  const elements=dom();let saves=0,paired=0;
  const panel=receivePairingLink({...elements,manual,location:{hash:manual?'':'#pswipe-pair=abcdefghijklmnopqrstuv',pathname:'/',search:''},window:{navigator:{},history:{replaceState(){}}},fetch:async()=>({ok:false,status}),saveSettings:async()=>{saves++;},onPaired:async()=>{paired++;}});
  if(manual)pairingField(panel,'pairing-short-code').value='123456';
  const button=pairingSubmit(panel);
  await button.onclick();
  assert.equal(descendants(panel).find(node=>node.role==='status').textContent,status>=500?'Pairing is unavailable on the sync server (server misconfigured)':'Code expired or unavailable. Ask the paired device for a new code.');
  assert.equal(button.disabled,false);
  assert.equal(panel.hidden,false);
  assert.equal(saves,0);assert.equal(paired,0);
 }
});

test('pairing code creation reports server misconfiguration for server failures',async()=>{
 const elements=dom();
 const pairing=createPairingModal({...elements,settings:async()=>({url:'https://worker.example',token:'test-token'}),fetch:async()=>({ok:false,status:500}),setTimeout,clearTimeout});
 await pairing.open();
 assert.equal(pairing.modal.children[0].textContent,'Pairing is unavailable on the sync server (server misconfigured)');
 assert.equal(pairing.modal.children[1].children.length,0);
});
