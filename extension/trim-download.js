// Download credentials remain in Chrome. Retry polls the acknowledged request,
// rather than generating a new Google download on every click.
export async function storedSourceDownload({job,pair,call,storage,readJob,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=()=>Date.now(),attempts=12,waitMs=2000,timeout=90000}){
 const key=`trim-source:${pair.account}:${job.id}`,source=job.source;
 if(job.account!==pair.account||!source?.mediaKey||!Number.isSafeInteger(source.size)||source.size<1)throw Error('Stored-original download does not match this crop account.');
 const guard=async()=>{const current=await readJob();if(['completed','cancelled'].includes(current.status)){await storage.remove(key);throw Error('This crop closed while preparing its original.');}if(current.account!==pair.account||current.source.mediaKey!==source.mediaKey||current.sourceRevision!==job.sourceRevision)throw Error('This crop changed or closed while preparing its original.');};
 let saved=(await storage.get(key))[key];
 if(saved&&(saved.account!==pair.account||saved.jobId!==job.id||saved.mediaKey!==source.mediaKey||saved.name!==source.name||saved.size!==source.size))throw Error('Stored-original Chrome checkpoint belongs to another crop.');
 await guard();
 if(!saved){const ack=await call('trimDownloadStart',{mediaKey:source.mediaKey});if(typeof ack?.token!=='string'||!ack.token||ack.token.length>100000)throw Error('Original download was not acknowledged.');await guard();saved={account:pair.account,jobId:job.id,mediaKey:source.mediaKey,name:source.name,size:source.size,token:ack.token};await storage.set({[key]:saved});}
 const deadline=now()+timeout;
 for(let count=0;count<attempts&&now()<deadline;count++){
  await guard();const result=await call('trimDownloadPoll',{token:saved.token});
  if(result?.state==='ready'){
   if(result.name!==source.name||result.size!==source.size)throw Error('Stored-file download filename or byte size does not match the exact original.');
   await guard();return result;
  }
  if(result?.state==='archive'){if(!Number.isSafeInteger(result.size)||result.size<22||result.size>1024*1024*1024+16*1024*1024||typeof result.name!=='string'||!/\.zip$/i.test(result.name))throw Error('Stored-original archive metadata is invalid.');await guard();return result;}
  if(result?.state!=='pending')throw Error('Google returned an unexpected stored-original download status.');
  if(count+1<attempts&&now()+waitMs<deadline)await sleep(waitMs);
 }
 throw Error('Google is still preparing the stored original. Resume to check the same download request; the crop and selection are saved.');
}
