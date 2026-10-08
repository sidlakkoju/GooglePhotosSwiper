import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';
import {hash} from '../lib/store.mjs';

test('archive bridge routes authenticate account, origins, binary offsets/bounds and preflight headers',async()=>{
 const root=await mkdtemp(join(tmpdir(),'crop-zip-http-')),app=createApp({loginCode:'fixture',trimRoot:root});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base=`http://localhost:${app.server.address().port}`,pair='fixture-pair';
 const request=async(path,body=Buffer.alloc(0),headers={},method='PUT')=>{const response=await fetch(base+path,{method,headers:{Authorization:`Bearer ${pair}`,'Content-Type':'application/octet-stream','X-Archive-Size':'100','X-Source-Offset':'0',...headers},body:method==='PUT'?body:undefined});return {response,data:response.status===204?null:await response.json()};};
 try{app.store.setSetting('account','fixture');app.store.importItems([{mediaKey:'original',name:'original.MOV',type:'video',date:null,thumbUrl:'https://lh3.googleusercontent.com/source',width:1,height:1,duration:3000,size:4}],'fixture');const j=app.trims.create({id:'fixture:original',revision:0,start:0,end:2,duration:3}),path=`/api/bridge/trim-jobs/${j.id}/source-archive`;app.trims.save(j.id,{sourceMetadataConfirmed:true});app.store.db.prepare('INSERT INTO pairs VALUES (?,?,?)').run(hash(pair),'fixture','fixture');
 assert.equal((await request(path,undefined,{Authorization:''})).response.status,401);assert.equal((await request(path,undefined,{Origin:'https://evil.test'})).response.status,403);assert.equal((await request(path,undefined,{'Content-Type':'application/json'})).response.status,415);assert.equal((await request(path,undefined,{'X-Archive-Size':'-1'})).response.status,400);assert.equal((await request(path,undefined,{'X-Source-Offset':'1'})).response.status,409);
 const origin=`chrome-extension://${'a'.repeat(32)}`,preflight=await request(path,undefined,{Origin:origin,'Access-Control-Request-Method':'PUT','Access-Control-Request-Headers':'authorization,content-type,x-archive-size,x-source-offset'},'OPTIONS');assert.equal(preflight.response.status,204);assert.match(preflight.response.headers.get('access-control-allow-headers'),/X-Archive-Size/);assert.equal(preflight.response.headers.get('access-control-allow-origin'),origin);
 const partial=await request(path,Buffer.from('1234'));assert.equal(partial.response.status,200);assert.equal(partial.data.archiveBytes,4);assert.equal(partial.data.sourceBytes,undefined);assert.equal((await request(path,Buffer.alloc(101),{'X-Source-Offset':'4'})).response.status,413);assert.equal((await stat(join(root,j.id,'source.zip'))).size,4);assert.equal(app.store.listItems()[0].decision,'remove');
 app.store.setSetting('account','another');assert.equal((await request(path)).response.status,401);app.store.setSetting('account','fixture');app.trims.cancel(j.id);assert.equal((await request(path,undefined,{'X-Source-Offset':'4','X-Source-Final':'true'})).response.status,409);assert.equal(app.trims.read(j.id).status,'cancelled');assert.equal(app.store.listItems()[0].decision,null);
 }finally{await new Promise(resolve=>app.server.close(resolve));await rm(root,{recursive:true,force:true});}
});
