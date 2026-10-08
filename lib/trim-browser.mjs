import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {problem,key,mediaURL,text} from './store.mjs';
import {canonicalGoogleLocation} from './trim-verification.mjs';

export function trimBrowser(store,jobs,runtime,oauth){
 const selected=()=>store.getSetting(`trim-provider:${store.account()}`)||'browser';
 const kind=j=>j.provider||(j.uploadSession||j.uploadToken||j.apiItem?'official':j.uploadStarted||j.createStarted?'unknown':'browser');
 async function status(){const official=await oauth.status();return {...official,provider:selected(),selected:selected(),browserUploadVerified:store.getSetting(`trim-browser-verified:${store.account()}`)==='true'};}
 async function select(provider){if(!['browser','official'].includes(provider))throw problem(400,'Choose browser or official uploads.');if(provider==='official'&&!(await oauth.status()).connected)throw problem(409,'Connect the official provider to this account before selecting it.');store.setSetting(`trim-provider:${store.account()}`,provider);return status();}
 function open(id){const j=jobs.read(id);if(['cancelled','completed'].includes(j.status))throw problem(409,'This crop is closed.');if(kind(j)!=='browser')throw problem(409,'This crop is bound to another upload provider.');return j;}
 async function sourceInfo(id,b){const j=jobs.read(id);if(['completed','cancelled'].includes(j.status)||j.uploadStarted||j.createStarted||j.apiItem||j.browserCreationStarted)throw problem(409,'Source metadata cannot change after upload starts.');
  // Report the failing field without echoing account IDs, paths or metadata.
  if(b.account!==j.account)throw problem(400,'Canonical original account does not match this job.');
  if(b.mediaKey!==j.source.mediaKey)throw problem(400,'Canonical original media identity does not match this job.');
  if(b.size!==j.source.size)throw problem(400,'Canonical original stored-file size does not match this job.');
  if(!(b.date===null||typeof b.date==='string'&&Number.isFinite(Date.parse(b.date))))throw problem(400,'Canonical original capture date has an unsupported format.');
  if(!(b.timezoneOffset===null||Number.isFinite(b.timezoneOffset)))throw problem(400,'Canonical original timezone offset has an unsupported format.');
  const location=canonicalGoogleLocation(b.location);
  const source={...j.source,date:b.date,location,timezoneOffset:b.timezoneOffset};const changed=JSON.stringify([source.date,source.location,source.timezoneOffset])!==JSON.stringify([j.source.date,j.source.location,j.source.timezoneOffset]);
  jobs.save(id,{source,sourceMetadataConfirmed:true});
  if(changed&&j.exportReport){jobs.save(id,{exportReport:null,digest:null,sha1:null,outputBytes:null,status:'exporting',checkpoint:'exporting'});return runtime.retryExport(id);}return jobs.read(id);
 }
 async function prepare(id){let j=open(id);const row=store.db.prepare('SELECT revision,state FROM items WHERE id=? AND account=?').get(j.source_id,j.account);if(!row||row.revision!==j.sourceRevision||row.state!=='active')throw problem(409,'The original changed. Its decision remains unchanged.');if(!j.sourceMetadataConfirmed||!j.exportReport||!j.digest||!j.outputBytes||j.cleaned)throw problem(409,'Confirm canonical source metadata and export before uploading.');
  const target=runtime.file(id,j.name),size=(await stat(target)).size;if(size!==j.outputBytes)throw problem(409,'The exported file changed. Re-export before uploading.');const sha256=createHash('sha256'),sha1=createHash('sha1');for await(const chunk of createReadStream(target)){sha256.update(chunk);sha1.update(chunk);}if(sha256.digest('hex')!==j.digest)throw problem(409,'The exported digest changed. No bytes were uploaded.');j=jobs.save(id,{provider:'browser',sha1:sha1.digest('base64')});jobs.reserve(id);return j;
 }
 function progress(id,b){const j=open(id);if(!j.sourceMetadataConfirmed||!j.exportReport||!j.sha1)throw problem(409,'Prepare and confirm the stored source first.');
  const phases=['session','bytes','finalized','creating','processing'];if(!phases.includes(b.phase))throw problem(400,'Invalid browser upload checkpoint.');const rank=phases.indexOf(b.phase),previous=phases.indexOf(j.browserPhase);if(rank<previous)throw problem(409,'Browser upload progress cannot go backwards.');
  if(Object.hasOwn(b,'offset')&&!Number.isSafeInteger(b.offset))throw problem(400,'Invalid confirmed browser upload offset.');
  const offset=b.offset??j.browserOffset??0;if(!Number.isSafeInteger(offset)||offset<0||offset>j.outputBytes||offset<(j.browserOffset||0)||rank>=2&&offset!==j.outputBytes)throw problem(400,'Invalid confirmed browser upload offset.');
  if(rank>=3&&!j.browserFinalized)throw problem(409,'A finalized byte upload is required before creation.');
  return jobs.save(id,{provider:'browser',uploadStarted:true,browserPhase:b.phase,browserOffset:offset,browserFinalized:rank>=2||!!j.browserFinalized,browserCreationStarted:rank>=3||!!j.browserCreationStarted,status:rank>=3?'processing':'uploading',checkpoint:rank>=3?'processing':'uploading',error:null});
 }
 function acknowledge(id,b){const j=open(id);if(!j.browserCreationStarted||!j.digest||!key(b.mediaKey)||b.mediaKey===j.source.mediaKey||b.name!==j.name)throw problem(409,'Exact generated replacement identity was not confirmed.');return jobs.acknowledge(id,{mediaKey:b.mediaKey,url:`https://photos.google.com/photo/${b.mediaKey}`});}
 function playable(id,b){const j=open(id);if(!j.replacement||b.mediaKey!==j.replacement.mediaKey||!j.metadataVerified||typeof b.url!=='string'||b.url.length>16000||!mediaURL(b.url))throw problem(409,'Confirm replacement metadata and its canonical playback URL first.');return jobs.save(id,{browserReady:true,playbackUrl:b.url,status:'verifying',checkpoint:'verifying',error:null});}
 function originalState(id,b){const j=jobs.read(id);if(['completed','cancelled'].includes(j.status))throw problem(409,'This crop is closed.');if(b.mediaKey!==j.source.mediaKey||!['active','in_trash','unknown'].includes(b.state))throw problem(400,'Invalid canonical original state.');const updated=jobs.save(id,{sourceRemoteState:b.state,sourceRemoteCheckedAt:Date.now()});if(b.state!=='active')throw problem(409,'The original is no longer confirmed active in Google Photos. Its decision remains unchanged.');return updated;}
 function failure(id,error){const j=jobs.read(id);return ['cancelled','completed'].includes(j.status)?j:jobs.save(id,{status:'failed',error:text(error,500)||'Browser upload interrupted. Reconcile its saved checkpoint before retrying.'});}
 return {status,select,selected,kind,sourceInfo,prepare,progress,acknowledge,playable,originalState,failure};
}
