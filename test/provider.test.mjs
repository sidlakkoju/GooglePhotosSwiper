import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {photosOperation} from '../extension/photos-api.js';
function fixture(responder){const calls=[];const context={location:{origin:'https://photos.google.com',pathname:'/'},window:{WIZ_global_data:{SNlM0e:'fixture-page-token',oPEP7c:'fixture@example.test',eptZe:'/_/PhotosUi/',FdrFJe:'sid',cfb2h:'build'}},crypto:webcrypto,TextEncoder,URL,URLSearchParams,AbortController,AbortSignal,setTimeout,clearTimeout,fetch:async(url,options)=>{const form=new URLSearchParams(options.body),envelope=JSON.parse(form.get('f.req')),id=envelope[0][0][0],args=JSON.parse(envelope[0][0][1]);calls.push({id,args});const data=await responder(id,args);return {ok:true,text:async()=>")]}\n\n"+JSON.stringify([['wrb.fr',id,JSON.stringify(data)]])};}};return {calls,run:vm.runInNewContext(`(${photosOperation.toString()})`,context)};}
test('library parser, metadata payload, and pagination use toolkit RPC formats',async()=>{const row=['photo',[ 'https://lh3.googleusercontent.com/thumb',800,600],1720000000000,'dedup'];row.push(null,null,null,[]);row.push({76647426:[25000]});const bulk=['photo'];bulk[1]=[];bulk[1][3]='clip.mp4';bulk[1][9]=40000;const f=fixture(id=>id==='lcxiM'?[[row],'next-page']:id==='EWgK9e'?[[null,[bulk]]]:null);const r=await f.run('library');assert.equal(r.ok,true);assert.equal(r.data.items[0].type,'video');assert.equal(r.data.items[0].name,'clip.mp4');assert.equal(r.data.items[0].size,40000);assert.equal(r.data.nextPageId,'next-page');assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].args)),[null,null,50,null,1,1]);});
test('wrong account and unsupported deletion fail before network requests',async()=>{const f=fixture(()=>null);assert.equal((await f.run('library',{account:'different-account'})).ok,false);assert.equal((await f.run('trash')).ok,false);assert.equal(f.calls.length,0);});
test('unexpected Google response never acknowledges a mutation',async()=>{const f=fixture(()=>null);const r=await f.run('createAlbum',{title:'Photos Swipe · Review · test'});assert.equal(r.ok,false);assert.match(r.error,/not confirmed/);});
test('album membership validates the returned album identity',async()=>{const f=fixture(()=>[null,[['photo']],null,['different']]);assert.equal((await f.run('albumMembers',{albumKey:'album'})).ok,false);});
test('create, add, and membership use only supported narrow methods',async()=>{const f=fixture(id=>id==='OXvT9d'?[['album']]:id==='E1Cajb'?[]:id==='snAcKc'?[null,[['photo']],null,['album']]:null);assert.equal((await f.run('createAlbum',{title:'Photos Swipe · Review · test'})).data.albumKey,'album');assert.equal((await f.run('addToAlbum',{albumKey:'album',mediaKeys:['photo']})).ok,true);assert.equal((await f.run('albumMembers',{albumKey:'album'})).data.keys[0],'photo');assert.deepEqual(f.calls.map(i=>i.id),['OXvT9d','E1Cajb','snAcKc']);});

test('Trash reads return identifiers only and reject malformed responses',async()=>{
 const f=fixture(id=>id==='zy0IHe'?[[['trash-key',[],0,'stable-content']],'next']:null);const result=await f.run('trashPage',{cursor:'previous'});assert.equal(result.ok,true);assert.equal(result.data.items[0].dedupKey,'stable-content');assert.equal(result.data.nextPageId,'next');assert.deepEqual(f.calls.map(c=>c.id),['zy0IHe']);
 assert.equal((await fixture(()=>null).run('trashPage')).ok,false);
});
test('individual state checks use explicit trash evidence and leave missing media unknown',async()=>{
 const missing=fixture(()=>null);assert.equal((await missing.run('itemState',{mediaKey:'photo'})).data.state,'unknown');
 const trashed=fixture(()=>[['photo',null,null,null,{225032867:[1720000000000]}]]);assert.equal((await trashed.run('itemState',{mediaKey:'photo'})).data.state,'in_trash');
 const restored=fixture(()=>[['photo',null,null,null,{163238866:[1]}]]);assert.equal((await restored.run('itemState',{mediaKey:'photo'})).data.state,'active');
});
test('a network failure or timeout reaching Google gives a readable message instead of the raw browser error',async()=>{
 const offline=await fixture(()=>{throw new TypeError('Failed to fetch');}).run('library');
 assert.equal(offline.ok,false);assert.equal(offline.error,'Couldn’t reach Google Photos. Check your connection and try again.');
 const safari=await fixture(()=>{throw new TypeError('Load failed');}).run('moveToTrash',{dedupKeys:['stable-content'],confirmed:true});
 assert.equal(safari.error,'Couldn’t reach Google Photos. Check your connection and try again.');
 const timeout=await fixture(()=>{throw Object.assign(new Error('signal is aborted without reason'),{name:'AbortError'});}).run('trashPage');
 assert.equal(timeout.error,'Google Photos didn’t respond in time. Check your connection and try again.');
 const cut=vm.runInNewContext(`(${photosOperation.toString()})`,{...Object.fromEntries(['location','window','crypto','TextEncoder','URL','URLSearchParams','AbortController','AbortSignal','setTimeout','clearTimeout'].map(key=>[key,globalThis[key]])),location:{origin:'https://photos.google.com',pathname:'/'},window:{WIZ_global_data:{SNlM0e:'fixture-page-token',oPEP7c:'fixture@example.test',eptZe:'/_/PhotosUi/',FdrFJe:'sid',cfb2h:'build'}},crypto:webcrypto,fetch:async()=>({ok:true,text:async()=>{throw new TypeError('network error');}})});
 assert.equal((await cut('library')).error,'Couldn’t reach Google Photos. Check your connection and try again.');
});
test('an untitled item is named after the date it was taken, in its own time zone',async()=>{
 const zone=process.env.TZ;process.env.TZ='Asia/Tokyo';
 try{
 const row=['untitled',['https://lh3.googleusercontent.com/thumb',800,600],Date.parse('2026-01-01T07:30:00Z'),'dedup',-8*3600000,{}];
 const result=await fixture(id=>id==='lcxiM'?[[row],null]:id==='EWgK9e'?[[null,[]]]:null).run('library');
 assert.equal(result.data.items[0].name,`Memory ${new Date(Date.UTC(2025,11,31,23,30)).toLocaleDateString(undefined,{timeZone:'UTC'})}`);
 assert.equal(result.data.items[0].timezoneOffset,-8*3600000);
 }finally{if(zone===undefined)delete process.env.TZ;else process.env.TZ=zone;}
});
function rawFixture(text,{eptZe='/_/PhotosUi/u/2/',origin='https://photos.google.com',pathname='/u/2/'}={}){const requests=[];const context={location:{origin,pathname},window:{WIZ_global_data:{SNlM0e:'fake-token',oPEP7c:'fixture@example.test',eptZe,FdrFJe:'fake-session',cfb2h:'build'}},crypto:webcrypto,TextEncoder,URL,URLSearchParams,AbortController,AbortSignal,setTimeout,clearTimeout,fetch:async(url,options)=>{requests.push({url,options});return {ok:true,text:async()=>text};}};return {requests,run:vm.runInNewContext(`(${photosOperation.toString()})`,context)};}
const framed=(id,data)=>`)]}'\n\n123\n${JSON.stringify([['wrb.fr',id,JSON.stringify(data)]])}\n`;
test('Google Photos requests stay on the signed-in page path with its session, token and credentials',async()=>{
 const f=rawFixture(framed('lcxiM',[[],null]));assert.equal((await f.run('library')).ok,true);
 const {url,options}=f.requests[0],request=new URL(url),body=new URLSearchParams(options.body);
 assert.equal(request.origin,'https://photos.google.com');assert.equal(request.pathname,'/_/PhotosUi/u/2/data/batchexecute');assert.equal(request.searchParams.get('source-path'),'/u/2/');assert.equal(request.searchParams.get('f.sid'),'fake-session');assert.equal(request.searchParams.get('rpcids'),'lcxiM');
 assert.equal(options.credentials,'include');assert.equal(options.method,'POST');assert.equal(body.get('at'),'fake-token');
 assert.deepEqual(JSON.parse(body.get('f.req')),[[['lcxiM',JSON.stringify([null,null,50,null,1,1]),null,'generic']]]);
 for(const eptZe of ['https://invalid.test/','//invalid.test/','/u/2/../../']){const unsafe=rawFixture('',{eptZe});assert.equal((await unsafe.run('library')).ok,false);assert.equal(unsafe.requests.length,0);}
 const elsewhere=rawFixture('',{origin:'https://invalid.test'});assert.equal((await elsewhere.run('library')).ok,false);assert.equal(elsewhere.requests.length,0);
});
test('Google Photos responses are read only from the matching envelope, through XSSI and length framing',async()=>{
 assert.equal((await rawFixture(framed('lcxiM',[[],null])).run('library')).data.items.length,0);
 for(const text of ['garbage',framed('wrong',[]),JSON.stringify([['wrb.fr','lcxiM',null]]),JSON.stringify([['wrb.fr','lcxiM','{']])])assert.equal((await rawFixture(text).run('library')).ok,false,text);
});
