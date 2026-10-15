import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const worker='https://photoswiper-sync.sidlakkoju.workers.dev';
const signInURL=`${worker}/auth/google/start?session=synthetic`;
const envelope=(id,data)=>`)]}'\n\n123\n${JSON.stringify([['wrb.fr',id,JSON.stringify(data)]])}\n`;
const gmStub=withRequest=>`(()=>{const values=new Map();window.GM={getValue:async(key,fallback)=>values.has(key)?structuredClone(values.get(key)):fallback,setValue:async(key,value)=>{values.set(key,structuredClone(value));},deleteValue:async key=>{values.delete(key);}${withRequest?`,xmlHttpRequest:options=>{window.recordSignIn({method:options.method,url:options.url,body:JSON.parse(options.data||'{}')});setTimeout(()=>options.onload({status:200,responseText:JSON.stringify({url:${JSON.stringify(signInURL)}})}),20);}`:''}};})();`;

for(const engineName of ['chromium','webkit'])for(const withRequest of [true,false])test(`Sign in with Google on the first-run sync card ${withRequest?'starts the Google sign-in':'explains what is missing without GM.xmlHttpRequest'} (${engineName})`,{timeout:120000},async t=>{
 let engine;
 try{({[engineName]:engine}=await import('playwright'));}catch{t.skip('Playwright is unavailable');return;}
 let browser;
 try{browser=await engine.launch({headless:true});}catch(error){t.skip(`${engineName} is unavailable: ${error.message.split('\n')[0]}`);return;}
 t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
 const opened=[],requests=[];
 await page.exposeFunction('recordSignIn',request=>{requests.push(request);});
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin===worker){opened.push(url.href);return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic sign-in</title>'});}
  if(url.hostname==='photos.google.com'&&url.pathname.endsWith('/data/batchexecute')){
   const id=url.searchParams.get('rpcids');
   return route.fulfill({contentType:'application/json',body:envelope(id,id==='lcxiM'?[[['AF1QipSynthetic0x',['https://lh3.googleusercontent.com/synthetic',800,600],Date.parse('2026-01-01'),'dedupSynthetic',0,{}]],null]:id==='EWgK9e'?[[null,[]]]:[[],null])});
  }
  if(url.hostname==='photos.google.com')return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1"><script>window.WIZ_global_data={SNlM0e:'synthetic-token',oPEP7c:'synthetic@example.test',eptZe:'/',FdrFJe:'0',cfb2h:'synthetic'}</script></head><body></body></html>`});
  if(url.hostname==='lh3.googleusercontent.com')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#3a7"/></svg>'});
  return route.abort();
 });
 await page.goto('https://photos.google.com/');
 await page.addScriptTag({content:gmStub(withRequest)});
 await page.addScriptTag({content:await readFile(new URL('../userscript/photoswiper-app.user.js',import.meta.url),'utf8')});
 await page.locator('#launcher').click();
 const button=page.locator('#pair-onboarding #google-sign-in');
 await button.waitFor({state:'visible',timeout:15000});
 await button.click();
 if(withRequest){
  await page.waitForURL(url=>url.href.startsWith(signInURL),{timeout:15000});
  const target=new URL(page.url());
  assert.equal(requests.length,1);
  assert.equal(requests[0].method,'POST');assert.equal(requests[0].url,`${worker}/auth/session`);
  assert.match(requests[0].body.state,/^[A-Za-z0-9_-]{43}$/);assert.equal(requests[0].body.automatic,true);
  assert.equal(target.searchParams.get('return'),'https://photos.google.com/');
  assert.ok(opened.some(href=>href.startsWith(signInURL)));
  return;
 }
 const notice=page.getByText('Google sync requires private userscript storage and GM.xmlHttpRequest.');
 await notice.waitFor({state:'visible',timeout:10000});
 assert.equal(page.url(),'https://photos.google.com/');
 assert.deepEqual(opened,[]);assert.deepEqual(requests,[]);
 assert.equal(await page.locator('#pair-onboarding #google-sign-in').isEnabled(),true);
});
