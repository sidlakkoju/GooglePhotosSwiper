import {mkdir,chmod,readFile,writeFile,stat,open,rm,statfs,rename} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {problem} from './store.mjs';
import {ARCHIVE_MAX,extractStoredMovie} from './trim-archive.mjs';
const run=promisify(execFile),MAX=1024*1024*1024;
const exportMessage=error=>error.status?error.message:error.stderr?.match(/NSLocalizedDescription=([^}\n]+)/)?.[1]||'Local source/export failed. The original is unchanged; inspect the stored source and retry.';
export function trimRuntime(jobs,root){
 const directory=id=>join(root,id),file=(id,name)=>join(directory(id),name);let active=null;
 const ensureOpen=id=>{const j=jobs.read(id);if(['completed','cancelled'].includes(j.status))throw problem(409,'This crop was closed.');return j;};
 async function privateDir(id){await mkdir(directory(id),{recursive:true,mode:0o700});await chmod(directory(id),0o700);}
 async function exporter(){const binary=join(root,'trim-export');await mkdir(root,{recursive:true,mode:0o700});try{const [built,source]=await Promise.all([stat(binary),stat('scripts/trim-export.swift')]);if(built.mtimeMs<source.mtimeMs)throw Error('Rebuild exporter.');}catch{if(process.platform!=='darwin')throw problem(409,'The preserving video exporter requires macOS and Xcode.');await run('/usr/bin/xcrun',['swiftc','-parse-as-library','-swift-version','5','-target','arm64-apple-macosx15.0','-sdk','/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX27.0.sdk','-module-cache-path',join(root,'module-cache'),'scripts/trim-export.swift','-o',binary],{timeout:120000,maxBuffer:1024*1024});}return binary;}
 async function receive(id,request,{offset=0,final=false}={}){
  const j=jobs.read(id);if(!['preparing','failed'].includes(j.status)||j.exportReport)throw problem(409,'This crop already has a stored source.');
  if(active)throw problem(409,'Another media operation is running.');if(!Number.isSafeInteger(offset)||offset<0||offset>MAX)throw problem(400,'Invalid source offset.');active=id;
  try{await privateDir(id);const target=file(id,'source.MOV'),existing=await stat(target).catch(()=>null);if(offset!==(existing?.size||0))throw problem(409,'Source offset changed. Resume from confirmed bytes.');const disk=await statfs(root);if(disk.bavail*disk.bsize<MAX*2)throw problem(413,'At least 2 GB free disk space is required.');const handle=await open(target,offset?'a':'w',0o600);let count=offset;
   try{for await(const chunk of request){count+=chunk.length;if(count>MAX)throw problem(413,'Stored source exceeds the 1 GB local limit.');await handle.write(chunk);}await handle.sync();}catch(error){await handle.truncate(offset);throw error;}finally{await handle.close();}
   ensureOpen(id);jobs.save(id,{sourceBytes:count,error:null,status:'preparing'});if(!final)return jobs.read(id);
   return await finishSource(id,count);
  }catch(error){const message=exportMessage(error);if(!['completed','cancelled'].includes(jobs.read(id).status))jobs.save(id,{status:'failed',error:message});throw error.status?error:problem(409,message);}finally{active=null;}
 }
 async function finishSource(id,count){
  const j=ensureOpen(id);jobs.validateSource(id);
  if(j.source.size&&count!==j.source.size)throw problem(409,'Stored file size differs from the selected original. The original decision is unchanged.');
  const report=JSON.parse((await run(await exporter(),['inspect',file(id,'source.MOV')],{timeout:120000})).stdout);
  if(!Number.isFinite(report.duration)||Math.abs(report.duration-j.selection.previewDuration)>.25||report.width!==j.source.width||report.height!==j.source.height)throw problem(409,'Stored file does not match the selected original.');
  ensureOpen(id);jobs.validateSource(id);jobs.save(id,{status:'exporting',checkpoint:'exporting',sourceReport:report});return exportJob(id);
 }
 async function receiveArchive(id,request,{offset=0,final=false,size}={}){
  const j=ensureOpen(id);jobs.validateSource(id);
  if(!['preparing','failed'].includes(j.status)||j.exportReport||j.sourceReport||!j.sourceMetadataConfirmed)throw problem(409,'Confirm the exact original metadata before downloading its archive.');
  if(active)throw problem(409,'Another media operation is running.');
  if(!Number.isSafeInteger(size)||size<22||size>ARCHIVE_MAX||!Number.isSafeInteger(offset)||offset<0||offset>size)throw problem(400,'Invalid original archive size or offset.');
  if(j.archiveSize&&j.archiveSize!==size)throw problem(409,'The archive byte size changed. Its confirmed checkpoint was retained.');
  active=id;const archive=file(id,'source.zip'),target=file(id,'source-extracted.MOV');
  try{
   await privateDir(id);const existing=await stat(archive).catch(()=>null);
   if(offset!==(existing?.size||0)||offset!==(j.archiveBytes||0))throw problem(409,'Archive offset changed. Resume from confirmed bytes.');
   const disk=await statfs(root);if(disk.bavail*disk.bsize<MAX*2+size+j.source.size)throw problem(413,'Free disk space is insufficient for bounded archive extraction and export.');
   const handle=await open(archive,offset?'a':'w',0o600);let count=offset;
   try{for await(const chunk of request){count+=chunk.length;if(count>size)throw problem(413,'Archive stream exceeds its acknowledged byte size.');await handle.write(chunk);}await handle.sync();}catch(error){await handle.truncate(offset);throw error;}finally{await handle.close();}
   ensureOpen(id);jobs.validateSource(id);jobs.save(id,{archiveSize:size,archiveBytes:count,status:'preparing',error:null});
   if(!final)return jobs.read(id);if(count!==size)throw problem(409,'Original archive download is incomplete. Resume its confirmed bytes.');
   await rm(target,{force:true});await extractStoredMovie(archive,target,j.source);
   ensureOpen(id);jobs.validateSource(id);await rename(target,file(id,'source.MOV'));
   jobs.save(id,{sourceBytes:j.source.size,archiveValidated:true,status:'preparing',error:null});
   const prepared=await finishSource(id,j.source.size);await rm(archive,{force:true});return prepared;
  }catch(error){await rm(target,{force:true}).catch(()=>{});if(!['completed','cancelled'].includes(jobs.read(id).status))jobs.save(id,{status:'failed',error:exportMessage(error)});throw error.status?error:problem(409,'Original ZIP preparation failed. Its crop remains saved.');}
  finally{active=null;}
 }
 async function exportJob(id){const j=ensureOpen(id);await privateDir(id);const output=file(id,j.name),metadata=file(id,'metadata.json');await writeFile(metadata,JSON.stringify({date:j.source.date,timezoneOffset:j.source.timezoneOffset,location:j.source.location}),{mode:0o600});await rm(output,{force:true});
  const report=JSON.parse((await run(await exporter(),['export',file(id,'source.MOV'),output,String(j.selection.start),String(j.selection.end),metadata],{timeout:300000,maxBuffer:1024*1024})).stdout);
  const digest=createHash('sha256'),sha1=createHash('sha1');for await(const chunk of createReadStream(output)){digest.update(chunk);sha1.update(chunk);}const outputBytes=(await stat(output)).size;await chmod(output,0o600);
  ensureOpen(id);jobs.reserve(id);return jobs.save(id,{exportReport:report,digest:digest.digest('hex'),sha1:sha1.digest('base64'),outputBytes,status:'awaiting_upload',checkpoint:'awaiting_upload',error:null});
 }
 async function retryExport(id){if(active)throw problem(409,'A video operation is running.');const j=ensureOpen(id);if(j.exportReport)return j;if(!j.sourceReport&&!j.archiveValidated)throw problem(409,'Resume the stored-file download first.');active=id;try{const prepared=j.sourceReport?await exportJob(id):await finishSource(id,j.sourceBytes);if(j.archiveValidated)await rm(file(id,'source.zip'),{force:true});return prepared;}catch(error){const message=exportMessage(error);if(!['completed','cancelled'].includes(jobs.read(id).status))jobs.save(id,{status:'failed',error:message});throw error.status?error:problem(409,message);}finally{active=null;}}
 async function cleanup(id){const j=jobs.read(id);if(active===id)throw problem(409,'Wait for the local media operation to stop before cleaning its files.');if(!['completed','cancelled'].includes(j.status))throw problem(409,'Cancel or verify this job before removing recovery files.');await rm(directory(id),{recursive:true,force:true});return jobs.save(id,{cleaned:true});}
 async function inspectPlayback(id,stream){if(active)throw problem(409,'Another media operation is running.');active=id;try{await privateDir(id);const target=file(id,'verified-playback.MOV'),handle=await open(target,'w',0o600);let count=0;try{for await(const chunk of stream){count+=chunk.length;if(count>MAX)throw problem(413,'Playback exceeds local limit.');await handle.write(chunk);}}finally{await handle.close();}const report=JSON.parse((await run(await exporter(),['inspect',target],{timeout:120000})).stdout);jobs.save(id,{playbackReport:report});return target;}finally{active=null;}}
 return {receive,receiveArchive,retryExport,cleanup,inspectPlayback,file,MAX};
}
