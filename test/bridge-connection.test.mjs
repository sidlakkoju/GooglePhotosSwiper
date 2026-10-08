import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
async function fixture({tabs=[{id:7,url:'https://photos.google.com/',account:'account',label:'Test account'}],saved={token:'saved-token',account:'account',tabId:7},serverError=null}={}){
 let listener,pair=saved,active=tabs[0];const requests=[],reads=[];const id='a'.repeat(32);
 const chrome={runtime:{id,getURL:path=>`chrome-extension://${id}/${path}`,getManifest:()=>({version:'1.2.0'}),onMessage:{addListener:fn=>listener=fn}},storage:{local:{get:async()=>({pair}),set:async data=>pair=data.pair,remove:async()=>pair=undefined}},tabs:{get:async tabId=>{const tab=tabs.find(t=>t.id===tabId);if(!tab)throw Error('No tab with id');return tab;},query:async options=>options.active?[active]:tabs},scripting:{executeScript:async({target,args:[operation]})=>{reads.push([target.tabId,operation]);const tab=tabs.find(t=>t.id===target.tabId);return [{result:tab.broken?{ok:false,error:'Google Photos is not signed in. Reload Google Photos.'}:{ok:true,data:{account:tab.account,label:tab.label}}}];}}};
 const fetch=async(url,options)=>{requests.push({url,options});const failed=serverError||url.endsWith('/pair')&&['000000','824221'].includes(JSON.parse(options.body).code);return {ok:!failed,json:async()=>failed?{error:typeof failed==='string'?failed:'Pairing code expired or incorrect. Generate a new one.'}:url.endsWith('/pair')?{token:'new-token'}:{account:'account'}};};
 const source=(await readFile(new URL('../extension/background.js',import.meta.url),'utf8')).replace("import { browserTrimUpload } from './trim-upload.js';",'const browserTrimUpload=()=>{};').replace("import { storedSourceDownload } from './trim-download.js';",'const storedSourceDownload=()=>{};').replace("import { photosOperation } from './photos-api.js';",'const photosOperation=()=>{};');
 vm.runInNewContext(source,{chrome,fetch,URL,AbortSignal,Uint8Array,btoa});
 return {requests,reads,get pair(){return pair;},send:(operation,args={},popup=false)=>new Promise(resolve=>listener({operation,args},popup?{id,url:chrome.runtime.getURL('popup.html')}:{id,frameId:0,tab:{url:'http://localhost:3000/'}},resolve))};
}
test('status validates both server pairing and live Photos identity, with installed capabilities',async()=>{
 const f=await fixture(),result=await f.send('status');assert.equal(result.ok,true);assert.equal(result.data.version,'1.2.0');assert.equal(result.data.trimUploadSupported,true);assert.equal(result.data.recoveredTab,false);assert.deepEqual(f.reads,[[7,'identity']]);assert.equal(f.requests[0].options.headers.Authorization,'Bearer saved-token');assert.ok(f.requests[0].options.signal);
});
test('closed paired tab recovers only an exact-account open tab, retaining token',async()=>{
 const f=await fixture({saved:{token:'saved-token',account:'account',tabId:99},tabs:[{id:1,url:'https://photos.google.com/',account:'other'},{id:2,url:'https://photos.google.com/u/1/',account:'account',label:'Same account'}]});
 const result=await f.send('status');assert.equal(result.ok,true);assert.equal(result.data.recoveredTab,true);assert.equal(f.pair.tabId,2);assert.equal(f.pair.token,'saved-token');assert.equal(f.pair.account,'account');
});
test('missing Photos tab or signed-out page reports recovery without discarding pairing',async()=>{
 for(const tabs of [[],[{id:7,url:'https://photos.google.com/',account:'account',broken:true}]]){const f=await fixture({tabs});const before=f.pair;const result=await f.send('status');assert.equal(result.ok,false);assert.match(result.error,/Google Photos/);assert.equal(f.pair,before);}
});
test('live tab that changed accounts never silently switches to another Photos account',async()=>{
 const f=await fixture({tabs:[{id:7,url:'https://photos.google.com/',account:'other'},{id:8,url:'https://photos.google.com/',account:'account'}]});const result=await f.send('status');assert.equal(result.ok,false);assert.match(result.error,/different account/);assert.equal(f.pair.tabId,7);assert.equal(f.reads.length,1);
});
test('wrong and expired codes leave an existing working pair untouched; fresh code replaces it',async()=>{
 const f=await fixture(),before=f.pair;
 for(const code of ['000000','824221']){const result=await f.send('pair',{code},true);assert.equal(result.ok,false);assert.match(result.error,/expired or incorrect/);assert.equal(f.pair,before);}
 assert.equal((await f.send('pair',{code:'123456'},true)).ok,true);assert.equal(f.pair.token,'new-token');assert.equal(f.pair.tabId,7);
});
test('unpaired, revoked local grant and wrong active popup tab have distinct recovery states',async()=>{
 const unpaired=await fixture({saved:null});assert.equal((await unpaired.send('status')).data.paired,false);assert.equal(unpaired.reads.length,0);
 const revoked=await fixture({serverError:'Extension is not paired.'});assert.match((await revoked.send('status')).error,/not paired/);assert.equal(revoked.reads.length,0);assert.equal(revoked.pair.token,'saved-token');
 const wrong=await fixture({tabs:[{id:7,url:'https://evil.test/',account:'account'}]});assert.match((await wrong.send('pair',{code:'123456'},true)).error,/Open your Google Photos tab/);assert.equal(wrong.requests.length,0);
});
