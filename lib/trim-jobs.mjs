import {randomBytes} from 'node:crypto';
import {problem,key} from './store.mjs';
import {trimSelection} from '../public/trim-model.js';

export function trimJobs(store){
 const {db}=store;
 db.exec(`CREATE TABLE IF NOT EXISTS trim_jobs(id TEXT PRIMARY KEY,account TEXT NOT NULL,source_id TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS generated_clips(account TEXT NOT NULL,job_id TEXT NOT NULL,name TEXT NOT NULL,media_key TEXT,excluded INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(account,job_id));`);
 const read=id=>{const r=db.prepare('SELECT * FROM trim_jobs WHERE id=? AND account=?').get(id,store.account());if(!r)throw problem(404,'Crop job not found in this account.');return {...r,...JSON.parse(r.data)};};
 const list=(limit=30)=>db.prepare('SELECT id FROM trim_jobs WHERE account=? ORDER BY created DESC LIMIT ?').all(store.account(),limit).map(r=>read(r.id));
 function save(id,patch){const j=read(id);if(j.provider&&patch.provider&&patch.provider!==j.provider)throw problem(409,'A crop upload provider cannot change.');if(['completed','cancelled'].includes(j.status)&&patch.status&&patch.status!==j.status)throw problem(409,'This crop is already closed; late progress cannot reopen it.');const data={...JSON.parse(j.data),...patch};db.prepare('UPDATE trim_jobs SET status=?,data=?,updated=? WHERE id=?').run(patch.status||j.status,JSON.stringify(data),Date.now(),id);return read(id);}
 function locked(id){return db.prepare("SELECT id FROM trim_jobs WHERE account=? AND source_id=? AND status NOT IN ('completed','cancelled')").get(store.account(),id);}
 function create({id,revision,start,end,duration}){
  if(!store.account())throw problem(409,'Connect Google Photos first.');
  const item=store.listItems().find(i=>i.id===id);if(!item||item.type!=='video'||item.generated)throw problem(400,'Choose an original video.');
  for(const row of db.prepare("SELECT data FROM jobs WHERE account=? AND status IN ('queued','running')").all(store.account()))if(JSON.parse(row.data).ids.includes(id))throw problem(409,'Finish the album operation before cropping this video.');
  if(list(-1).some(j=>!['completed','cancelled'].includes(j.status)))throw problem(409,'Resume or cancel the existing crop first.');
  if(item.revision!==revision)throw problem(409,'This video changed. Refresh before cropping.');
  let selection;try{selection=trimSelection(duration,start,end);}catch(e){throw problem(400,e.message);}
  if(!selection.changed||selection.start!==start||selection.end!==end)throw problem(400,'Select a valid shorter segment.');
  if(!Number.isFinite(item.duration)||Math.abs(duration-item.duration/1000)>.25)throw problem(400,'Video duration does not match the original.');
  const jobId=randomBytes(12).toString('hex'),name=`PhotosSwipe_CROP_${jobId}.MOV`,now=Date.now();
  const provider=store.getSetting(`trim-provider:${store.account()}`)||'browser';
  const data={provider,queuedOnApproval:true,sourceMetadataConfirmed:false,source:{...item,decision:'remove',revision:revision+1,date:item.date??null,location:item.location??null,timezoneOffset:item.timezoneOffset??null},sourceRevision:revision+1,previousDecision:item.decision,selection:{start,end,previewDuration:duration},name,error:null,checkpoint:'preparing'};
  db.exec('BEGIN');try{db.prepare("UPDATE items SET decision='remove',album_key=NULL,revision=revision+1 WHERE id=? AND account=? AND revision=?").run(id,store.account(),revision);db.prepare('INSERT INTO trim_jobs VALUES (?,?,?,?,?,?,?)').run(jobId,store.account(),id,'preparing',JSON.stringify(data),now,now);db.exec('COMMIT');return read(jobId);}catch(error){db.exec('ROLLBACK');throw error;}
 }
 function validateSource(id){const j=read(id),row=db.prepare('SELECT revision,state FROM items WHERE id=? AND account=?').get(j.source_id,j.account);if(!row||row.revision!==j.sourceRevision||row.state!=='active')throw problem(409,'The original changed during stored-file preparation.');return j;}
 function reserve(id){const j=read(id);db.prepare('INSERT OR IGNORE INTO generated_clips(account,job_id,name) VALUES (?,?,?)').run(j.account,j.id,j.name);return j;}
 function acknowledge(id,replacement){const j=read(id);if(['cancelled','completed'].includes(j.status))throw problem(409,'This crop is already closed.');if(!key(replacement?.mediaKey)||replacement.mediaKey===j.source.mediaKey)throw problem(400,'Invalid replacement identity.');if(j.replacement?.mediaKey&&j.replacement.mediaKey!==replacement.mediaKey)throw problem(409,'Replacement identity cannot change.');reserve(id);db.prepare('UPDATE generated_clips SET media_key=? WHERE account=? AND job_id=?').run(replacement.mediaKey,j.account,id);return save(id,{replacement,status:'verifying',checkpoint:'verifying'});}
 function complete(id,evidence){
  const j=read(id);if(j.status==='completed')return j;
  if(j.status!=='verifying')throw problem(409,'This crop is not awaiting verified completion.');
  if(!j.replacement||!j.exportReport||!evidence||!Number.isFinite(evidence.duration)||!Number.isFinite(j.exportReport.duration)||!Number.isFinite(j.exportReport.frameTolerance)||evidence.mediaKey!==j.replacement.mediaKey||evidence.account!==j.account||evidence.ready!==true||evidence.playback!==true||evidence.audio!==true||evidence.metadata!==true||Math.abs(evidence.duration-j.exportReport.duration)>Math.max(1/30,j.exportReport.frameTolerance||0)||evidence.width!==j.exportReport.width||evidence.height!==j.exportReport.height)throw problem(409,'Replacement playback, audio, duration, dimensions and metadata must all be verified.');
  const row=db.prepare('SELECT * FROM items WHERE id=? AND account=?').get(j.source_id,j.account);if(!row||row.revision!==j.sourceRevision||row.state!=='active')throw problem(409,'The original changed. Its decision was preserved.');
  db.exec('BEGIN');try{db.prepare("UPDATE items SET decision='remove',album_key=NULL,revision=revision+1 WHERE id=?").run(j.source_id);db.prepare("UPDATE items SET decision='keep',revision=revision+1 WHERE account=? AND media_key=?").run(j.account,j.replacement.mediaKey);const result=save(id,{status:'completed',checkpoint:'completed',evidence,error:null});db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}
 }
 function closeAndRestore(j,patch={}){
  if(j.status==='cancelled')return j;
  db.exec('BEGIN');try{
   let sourceRevision=j.sourceRevision;
   if(j.queuedOnApproval){const row=db.prepare('SELECT revision,decision,album_key FROM items WHERE id=? AND account=?').get(j.source_id,j.account);if(!row||row.revision!==j.sourceRevision||row.decision!=='remove'||row.album_key)throw problem(409,'The original changed. Refresh before undoing this crop.');db.prepare('UPDATE items SET decision=?,revision=revision+1 WHERE id=? AND account=?').run(j.previousDecision??null,j.source_id,j.account);sourceRevision++;}
   const result=save(j.id,{status:'cancelled',error:null,sourceRevision,...patch});db.exec('COMMIT');return result;
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 function queueApproved(id){const j=read(id);if(j.queuedOnApproval||['completed','cancelled'].includes(j.status))return j;const row=db.prepare('SELECT * FROM items WHERE id=? AND account=?').get(j.source_id,j.account);if(!row||row.revision!==j.sourceRevision||row.state!=='active'||row.album_key)throw problem(409,'The original changed before its approved crop could be queued.');db.exec('BEGIN');try{db.prepare("UPDATE items SET decision='remove',revision=revision+1 WHERE id=? AND account=?").run(j.source_id,j.account);const result=save(id,{queuedOnApproval:true,sourceRevision:row.revision+1,source:{...j.source,decision:'remove',revision:row.revision+1}});db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
 function queuePendingApprovals(){for(const j of list(-1))if(!j.queuedOnApproval&&!['completed','cancelled'].includes(j.status)){try{queueApproved(j.id);}catch(error){save(j.id,{status:'failed',error:error.message});}}}
 function cancel(id){const j=read(id);if(j.status==='completed')throw problem(409,'Use Undo to restore the original decision; the replacement stays kept.');const browserBeforeCreation=j.provider==='browser'&&!j.browserCreationStarted&&!j.replacement&&!j.createStarted&&!j.apiItem&&!j.uploadSession&&!j.uploadToken;if((j.uploadStarted||j.replacement||j.createStarted||j.browserCreationStarted)&&!browserBeforeCreation)throw problem(409,'A media item may exist. Reconcile it before cancelling to avoid duplicate copies.');return closeAndRestore(j);}
 function abandon(id){const j=read(id);if(!j.replacement||!(j.apiItem||j.browserCreationStarted)||!j.digest||j.status==='completed')throw problem(409,'Reconcile the exact uploaded replacement before abandoning this crop.');return closeAndRestore(j,{abandoned:true});}
 function correctDuration(id){const j=read(id);if(['completed','cancelled'].includes(j.status)||j.uploadStarted||j.exportReport||!j.sourceReport||!Number.isFinite(j.sourceReport.duration))throw problem(409,'This job cannot change its export range.');const end=Math.min(j.selection.end,j.sourceReport.duration);if(end-j.selection.start<.5)throw problem(409,'Choose a longer segment inside the stored source.');return save(id,{selection:{...j.selection,end},status:'exporting',error:null});}
 function generated(){return db.prepare('SELECT * FROM generated_clips WHERE account=?').all(store.account());}
 function reviewGenerated(jobId){const j=read(jobId);if(j.status!=='completed'||!j.replacement)throw problem(409,'Verify the replacement first.');db.prepare('UPDATE generated_clips SET excluded=0 WHERE account=? AND job_id=?').run(j.account,jobId);db.prepare('UPDATE items SET decision=NULL,revision=revision+1 WHERE account=? AND media_key=?').run(j.account,j.replacement.mediaKey);return read(jobId);}
 return {read,list,save,locked,create,queueApproved,queuePendingApprovals,validateSource,reserve,acknowledge,complete,cancel,abandon,correctDuration,generated,reviewGenerated};
}
