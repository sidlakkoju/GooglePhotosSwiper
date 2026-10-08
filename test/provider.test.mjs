import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {photosOperation} from '../extension/photos-api.js';
function fixture(responder){const calls=[];const context={location:{origin:'https://photos.google.com',pathname:'/'},window:{WIZ_global_data:{SNlM0e:'fixture-page-token',oPEP7c:'fixture@example.test',eptZe:'/_/PhotosUi/',FdrFJe:'sid',cfb2h:'build'}},crypto:webcrypto,TextEncoder,URLSearchParams,AbortSignal,setTimeout,fetch:async(url,options)=>{const form=new URLSearchParams(options.body),envelope=JSON.parse(form.get('f.req')),id=envelope[0][0][0],args=JSON.parse(envelope[0][0][1]);calls.push({id,args});const data=await responder(id,args);return {ok:true,text:async()=>")]}\n\n"+JSON.stringify([['wrb.fr',id,JSON.stringify(data)]])};}};return {calls,run:vm.runInNewContext(`(${photosOperation.toString()})`,context)};}
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
