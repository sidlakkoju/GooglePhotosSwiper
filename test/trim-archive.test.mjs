import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,stat,symlink,readlink,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {extractStoredMovie} from '../lib/trim-archive.mjs';
import {createStore} from '../lib/store.mjs';
import {trimJobs} from '../lib/trim-jobs.mjs';
import {trimRuntime} from '../lib/trim-runtime.mjs';
const run=promisify(execFile);
const generator=String.raw`import sys,zipfile,stat,struct
path,case=sys.argv[1:]
with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as z:
 if case=='empty': pass
 elif case=='nested':
  z.writestr('folder/','');z.writestr('folder/original.MOV',b'clip')
 elif case=='duplicates':
  z.writestr('original.MOV',b'clip');z.writestr('original.MOV',b'clip')
 elif case=='extras':
  z.writestr('original.MOV',b'clip');z.writestr('other.MOV',b'clip')
 elif case=='symlink':
  i=zipfile.ZipInfo('original.MOV');i.create_system=3;i.external_attr=(stat.S_IFLNK|0o777)<<16;z.writestr(i,b'clip')
 elif case=='unsupported': z.writestr('original.MOV',b'clip',compress_type=zipfile.ZIP_BZIP2)
 elif case=='force64':
  with z.open('original.MOV','w',force_zip64=True) as out:out.write(b'clip')
 else:z.writestr({'traversal':'../original.MOV','absolute':'/original.MOV','backslash':'folder\\original.MOV','drive':'C:/original.MOV','dot':'folder/./original.MOV','wrong':'another.MOV'}.get(case,'original.MOV'),b'clip' if case!='large' else b'x'*1024*1024)
if case in ('zip64directory','zip64count','zip64disk'):
 data=bytearray(open(path,'rb').read());end=data.rindex(b'PK\x05\x06');fields=struct.unpack('<4s4H2IH',data[end:end+22]);count=fields[4];size=fields[5];start=fields[6]
 record=struct.pack('<4sQ2H2I4Q',b'PK\x06\x06',44,45,45,1 if case=='zip64disk' else 0,0,1000 if case=='zip64count' else count,1000 if case=='zip64count' else count,size,start)
 locator=struct.pack('<4sIQI',b'PK\x06\x07',0,end,1);tail=struct.pack('<4s4H2IH',b'PK\x05\x06',0,0,65535,65535,0xffffffff,0xffffffff,0)
 open(path,'wb').write(data[:end]+record+locator+tail)
if case in ('crc','encrypted','count','bomb','nul'):
 data=bytearray(open(path,'rb').read());central=data.index(b'PK\x01\x02');end=data.rindex(b'PK\x05\x06')
 if case=='crc':data[central+16]^=0xff
 elif case=='encrypted':
  data[6]|=1;data[central+8]|=1
 elif case=='count':struct.pack_into('<HH',data,end+8,65534,65534)
 elif case=='bomb':
  struct.pack_into('<I',data,22,0xffffffff);struct.pack_into('<I',data,central+24,0xffffffff)
 elif case=='nul':
  local_len=struct.unpack_from('<H',data,26)[0];data[30+local_len-1]=0;data[central+46+local_len-1]=0
 open(path,'wb').write(data)
`;
async function fixture(kind='valid'){const root=await mkdtemp(join(tmpdir(),'trim-zip-')),archive=join(root,'source.zip'),target=join(root,'extracted.MOV');await run('/usr/bin/python3',['-c',generator,archive,kind],{timeout:10000});return {root,archive,target,source:{name:'original.MOV',size:4},close:()=>rm(root,{recursive:true,force:true})};}
test('bounded ZIP extraction accepts only one exact stored movie, including safe nested paths and ZIP64 entry headers',async()=>{for(const kind of ['valid','nested','force64','zip64directory']){const f=await fixture(kind);try{assert.equal((await extractStoredMovie(f.archive,f.target,f.source)).bytes,4);assert.equal((await readFile(f.target)).toString(),'clip');assert.equal((await stat(f.target)).mode&0o777,0o600);}finally{await f.close();}}});
test('ZIP safety rejects traversal, links, ambiguity, encryption, CRC damage, bombs and wrong canonical size',async()=>{for(const kind of ['empty','traversal','absolute','backslash','drive','dot','wrong','duplicates','extras','symlink','unsupported','crc','encrypted','count','bomb','nul','large','zip64count','zip64disk']){const f=await fixture(kind);try{await assert.rejects(extractStoredMovie(f.archive,f.target,f.source));assert.equal(await stat(f.target).then(()=>true,()=>false),false,kind);}finally{await f.close();}}const f=await fixture();try{await assert.rejects(extractStoredMovie(f.archive,f.target,{...f.source,size:5}),/byte size/);}finally{await f.close();}});
test('extractor never removes preexisting files or symlinks it did not create',async()=>{for(const link of [false,true]){const f=await fixture();try{const keep=join(f.root,'keep');await writeFile(keep,'keep');if(link)await symlink(keep,f.target);else await writeFile(f.target,'keep');await assert.rejects(extractStoredMovie(f.archive,f.target,f.source));assert.equal((await readFile(f.target)).toString(),'keep');if(link)assert.equal(await readlink(f.target),keep);}finally{await f.close();}}});
function setup(root){const store=createStore();store.setSetting('account','fixture');store.importItems([{mediaKey:'original',name:'original.MOV',type:'video',date:null,thumbUrl:'https://lh3.googleusercontent.com/fixture',width:1,height:1,duration:3000,size:4}],'fixture');const jobs=trimJobs(store),runtime=trimRuntime(jobs,root),job=jobs.create({id:'fixture:original',revision:0,start:0,end:2,duration:3});jobs.save(job.id,{sourceMetadataConfirmed:true});return {store,jobs,runtime,job};}
async function* bytes(data){yield data;}
test('archive chunks resume confirmed offsets, reject changed sizes and roll back disconnected writes',async()=>{const f=await fixture(),state=setup(join(f.root,'jobs'));try{const data=await readFile(f.archive),first=data.subarray(0,20);const partial=await state.runtime.receiveArchive(state.job.id,bytes(first),{offset:0,size:data.length});assert.equal(partial.archiveBytes,20);assert.equal(partial.sourceBytes,undefined);await assert.rejects(state.runtime.receiveArchive(state.job.id,bytes(first),{offset:0,size:data.length}),/offset/);await assert.rejects(state.runtime.receiveArchive(state.job.id,bytes(first),{offset:20,size:data.length+1}),/byte size changed/);
 async function* disconnected(){yield data.subarray(20,30);throw Error('client disconnected');}await assert.rejects(state.runtime.receiveArchive(state.job.id,disconnected(),{offset:20,size:data.length}));assert.equal((await stat(state.runtime.file(state.job.id,'source.zip'))).size,20);assert.equal(state.jobs.read(state.job.id).archiveBytes,20);const completed=await state.runtime.receiveArchive(state.job.id,bytes(data.subarray(20)),{offset:20,size:data.length});assert.equal(completed.archiveBytes,data.length);assert.equal(state.store.listItems()[0].decision,'remove');
 state.jobs.cancel(state.job.id);await assert.rejects(state.runtime.receiveArchive(state.job.id,bytes(Buffer.alloc(0)),{offset:data.length,size:data.length,final:true}),/closed/);assert.equal(state.jobs.read(state.job.id).status,'cancelled');
 }finally{state.store.close();await f.close();}});
test('cancellation during archive stream never reopens the crop or writes source bytes',async()=>{const f=await fixture(),s=setup(join(f.root,'jobs'));try{const data=await readFile(f.archive);async function* cancel(){s.jobs.cancel(s.job.id);yield data;}await assert.rejects(s.runtime.receiveArchive(s.job.id,cancel(),{size:data.length,final:true}),/closed/);assert.equal(s.jobs.read(s.job.id).status,'cancelled');assert.equal(s.jobs.read(s.job.id).sourceBytes,undefined);assert.equal(s.store.listItems()[0].decision,null);}finally{s.store.close();await f.close();}});
