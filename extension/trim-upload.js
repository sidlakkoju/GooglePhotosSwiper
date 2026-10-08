// Upload session URLs and opaque upload tokens stay in Chrome storage.
// Google cookies and WIZ authentication never leave the MAIN-world adapter.
export async function browserTrimUpload({jobId,pair,server,call,storage,fetcher=fetch,app='http://localhost:3000'}){
 if(typeof jobId!=='string'||! /^[a-f0-9]{24}$/.test(jobId))throw Error('Invalid crop job.');
 const path=`/trim-jobs/${jobId}`,checkpointKey=`trim-upload:${pair.account}:${jobId}`;
 let job=await server(path),checkpoint=(await storage.get(checkpointKey))[checkpointKey];
 const persist=async patch=>{checkpoint={...checkpoint,...patch};await storage.set({[checkpointKey]:checkpoint});};
 if(job.account!==pair.account)throw Error('Crop account does not match this Chrome pairing.');
 if(['completed','cancelled'].includes(job.status)){await storage.remove(checkpointKey);return job;}
 if(job.provider!=='browser')throw Error('This crop is bound to another upload provider.');
 try{
  if(!job.uploadStarted){const state=await call('itemState',{mediaKey:job.source.mediaKey});if(state.state!=='active')throw Error('The original is not confirmed active in Google Photos. No upload was started.');const source=await call('trimInfo',{mediaKey:job.source.mediaKey});job=await server(path+'/source-info',source);}
  if(!job.sourceMetadataConfirmed)throw Error('Canonical original metadata was not confirmed before upload. Leave the original unchanged and recreate the crop after confirming its metadata.');
  job=await server(path+'/browser-prepare');
  if(checkpoint&&(checkpoint.account!==pair.account||checkpoint.jobId!==job.id||checkpoint.digest!==job.digest||checkpoint.name!==job.name||checkpoint.size!==job.outputBytes))throw Error('Chrome upload checkpoint does not match this exact crop. Reconcile the saved upload before retrying.');
  if(!checkpoint)await persist({account:pair.account,jobId:job.id,digest:job.digest,name:job.name,size:job.outputBytes,offset:0});
  // Creation was issued once. A lost acknowledgement is reconciled by the unique
  // reserved filename instead of issuing mdpdU or another byte upload again.
  if(job.browserCreationStarted||checkpoint.creationStarted){
   if(!job.replacement){const info=await call('trimFind',{name:job.name});job=await server(path+'/browser-ack',{mediaKey:info.mediaKey,name:info.name});await persist({replacementKey:info.mediaKey});}
  }else{
   if(!checkpoint.session){if(job.browserPhase&&job.browserPhase!=='session')throw Error('The Chrome upload session checkpoint is missing. Reconcile before trying a new upload.');job=await server(path+'/browser-progress',{phase:'session',offset:0});const session=await call('trimUploadStart',{name:job.name,size:job.outputBytes,sha1:job.sha1});await persist({session});}
   if(!checkpoint.token){
    const queried=await call('trimUploadQuery',{url:checkpoint.session.controlUrl||checkpoint.session.url,size:job.outputBytes});
    if(queried.status==='final'){await persist({offset:job.outputBytes,token:queried.token});job=await server(path+'/browser-progress',{phase:'finalized',offset:job.outputBytes});}
    else{
     if(queried.offset<(job.browserOffset||0))throw Error('Google upload offset went backwards. No bytes were repeated.');await persist({offset:queried.offset});job=await server(path+'/browser-progress',{phase:'bytes',offset:queried.offset});
     const chunkSize=Math.max(checkpoint.session.granularity,Math.floor(8*1024*1024/checkpoint.session.granularity)*checkpoint.session.granularity);
     while(checkpoint.offset<job.outputBytes){
      const offset=checkpoint.offset,length=Math.min(chunkSize,job.outputBytes-offset),response=await fetcher(`${app}/api/bridge${path}/export-bytes?offset=${offset}&length=${length}`,{headers:{Authorization:`Bearer ${pair.token}`},redirect:'error',signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error((await response.json()).error||'Saved export bytes unavailable.');const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length!==length)throw Error('Export byte range was incomplete.');let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));const final=offset+length===job.outputBytes,result=await call('trimUploadChunk',{url:checkpoint.session.url,name:job.name,offset,base64:btoa(binary),final});
      if(result.offset!==offset+length)throw Error('Google confirmed a different byte offset.');await persist({offset:result.offset,...(final?{token:result.token}:{})});job=await server(path+'/browser-progress',{phase:final?'finalized':'bytes',offset:result.offset});
     }
    }
   }
   if(!checkpoint.token)throw Error('No finalized upload token was acknowledged. Reconcile before retrying.');
   if(!job.browserFinalized)job=await server(path+'/browser-progress',{phase:'finalized',offset:job.outputBytes});
   job=await server(path+'/browser-progress',{phase:'creating',offset:job.outputBytes});await persist({creationStarted:true});
   const created=await call('trimCreate',{name:job.name,token:checkpoint.token,date:job.source.date});job=await server(path+'/browser-ack',created);await persist({replacementKey:created.mediaKey});
  }
  let observed=await call('trimInfo',{mediaKey:job.replacement.mediaKey});
  if(observed.name!==job.name||observed.mediaKey!==job.replacement.mediaKey||observed.account!==pair.account)throw Error('Generated replacement identity changed. The original is unchanged.');
  if(!observed.ready){job=await server(path+'/browser-progress',{phase:'processing',offset:job.outputBytes});return {...job,playbackReady:false,error:'Google is still processing the cropped clip. Resume verification later.'};}
  const dateChanged=job.source.date!==null&&Date.parse(observed.date)!==Date.parse(job.source.date),zoneChanged=job.source.timezoneOffset!==null&&observed.timezoneOffset!==job.source.timezoneOffset;
  if((dateChanged||zoneChanged)&&job.source.date!==null&&job.source.timezoneOffset!==null&&observed.dedupKey){
   await call('trimSetTimestamp',{mediaKey:observed.mediaKey,sourceMediaKey:job.source.mediaKey,name:job.name,dedupKey:observed.dedupKey,date:job.source.date,timezoneOffset:job.source.timezoneOffset});observed=await call('trimInfo',{mediaKey:job.replacement.mediaKey});
  }
  const state=await call('itemState',{mediaKey:job.source.mediaKey});job=await server(path+'/browser-original-state',{mediaKey:job.source.mediaKey,state:state.state});
  job=await server(path+'/metadata',observed);
  if(!observed.ready||!observed.url)throw Error('Replacement playback is not ready. Resume verification later.');
  job=await server(path+'/browser-playback',{mediaKey:observed.mediaKey,url:observed.url});return job;
 }catch(error){const failed=await server(path+'/browser-failure',{error:error.message}).catch(()=>null);if(failed&&['completed','cancelled'].includes(failed.status)&&failed.account===pair.account)await storage.remove(checkpointKey);throw error;}
}
