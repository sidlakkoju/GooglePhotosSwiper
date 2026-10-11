import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
export const hash = value => createHash('sha256').update(value).digest('hex');
export const secret = () => randomBytes(32).toString('base64url');
export const problem = (status,message) => Object.assign(new Error(message),{status});
export const text = (v,max=300) => typeof v==='string' ? v.slice(0,max) : '';
export const key = v => typeof v==='string' && /^[a-zA-Z0-9_-]{1,250}$/.test(v);
export function mediaURL(v) { try {const u=new URL(v);return u.protocol==='https:' && (u.hostname==='photos.fife.usercontent.google.com' || u.hostname==='googleusercontent.com' || u.hostname.endsWith('.googleusercontent.com')) && !u.username && !u.password && !u.port;}catch{return false;} }
export function createStore(path=':memory:') {
 const db=new DatabaseSync(path);
 db.exec(`PRAGMA journal_mode=WAL;CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS pairs(hash TEXT PRIMARY KEY,account TEXT NOT NULL,label TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY,account TEXT NOT NULL,media_key TEXT NOT NULL,data TEXT NOT NULL,decision TEXT,revision INTEGER NOT NULL DEFAULT 0,album_key TEXT);
 CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,account TEXT NOT NULL,data TEXT NOT NULL,status TEXT NOT NULL,error TEXT,album_key TEXT,created INTEGER NOT NULL,updated INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS account_items ON items(account);
 CREATE TABLE IF NOT EXISTS trim_jobs(id TEXT PRIMARY KEY,account TEXT NOT NULL,source_id TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS generated_seen(account TEXT NOT NULL,media_key TEXT NOT NULL,job_id TEXT NOT NULL,PRIMARY KEY(account,media_key));
 CREATE TABLE IF NOT EXISTS generated_clips(account TEXT NOT NULL,job_id TEXT NOT NULL,name TEXT NOT NULL,media_key TEXT,excluded INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(account,job_id));`);
 for(const [name,definition] of [['state',"TEXT NOT NULL DEFAULT 'active'"],['checked_at','INTEGER'],['queue_sent',"INTEGER NOT NULL DEFAULT 0"]])if(!db.prepare('PRAGMA table_info(items)').all().some(c=>c.name===name))db.exec(`ALTER TABLE items ADD COLUMN ${name} ${definition}`);
 const getSetting=k=>db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value;
 const setSetting=(k,v)=>db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run(k,String(v));
 const account=()=>getSetting('account')||'';
 const albumTitle=()=>getSetting('albumTitle')||`Photos Swipe · Review · ${account()}`;
 if(getSetting('coreQueueMigration')!=='2'){db.exec('BEGIN');try{for(const job of db.prepare("SELECT account,data,album_key FROM jobs WHERE status='completed'").all()){const data=JSON.parse(job.data);for(let i=0;i<(data.ids||[]).length;i++)if((data.confirmed||[]).includes(data.mediaKeys[i]))db.prepare("UPDATE items SET queue_sent=1 WHERE id=? AND account=? AND decision='remove'").run(data.ids[i],job.account);}setSetting('coreQueueMigration','2');db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}

 const listItems=(includeRemoved=false)=>db.prepare(`SELECT * FROM items WHERE account=? ${includeRemoved?'':"AND state='active'"} ORDER BY rowid`).all(account()).map(r=>({...JSON.parse(r.data),decision:r.decision,revision:r.revision,albumKey:r.album_key,state:r.state,checkedAt:r.checked_at,queueSent:!!r.queue_sent,cropPending:!!db.prepare("SELECT id FROM trim_jobs WHERE account=? AND source_id=? AND status NOT IN ('completed','cancelled')").get(r.account,r.id),generated:!!db.prepare('SELECT job_id FROM generated_clips WHERE account=? AND excluded=1 AND (media_key=? OR (media_key IS NULL AND name=?) OR job_id IN (SELECT job_id FROM generated_seen WHERE account=? AND media_key=?))').get(r.account,r.media_key,JSON.parse(r.data).name,r.account,r.media_key)}));
 function getJob(id){const r=db.prepare('SELECT * FROM jobs WHERE id=? AND account=?').get(id,account());if(!r)throw problem(404,'Operation not found.');return {id:r.id,account:r.account,status:r.status,error:r.error,albumKey:r.album_key,created:r.created,updated:r.updated,...JSON.parse(r.data),dedupKeys:JSON.parse(r.data).dedupKeys||JSON.parse(r.data).ids.map(id=>{const item=db.prepare('SELECT data FROM items WHERE id=?').get(id);return item?JSON.parse(item.data).dedupKey||null:null;})};}
 function importItems(list,owner,{inTransaction=false}={}){
  if(!Array.isArray(list)||list.length>100)throw problem(400,'Import at most 100 items per batch.');
  const normalized=list.map(i=>{if(!key(i.mediaKey)||!mediaURL(i.thumbUrl)||!['photo','video'].includes(i.type))throw problem(400,!key(i.mediaKey)?'Invalid Google media identifier.':!mediaURL(i.thumbUrl)?`Unsupported preview host: ${(()=>{try{return new URL(i.thumbUrl).hostname;}catch{return 'invalid URL';}})()}`:'Invalid Google media type.');const n=x=>Number.isFinite(x)&&x>=0?x:null;return {id:`${owner}:${i.mediaKey}`,mediaKey:i.mediaKey,dedupKey:text(i.dedupKey,1024)||null,name:text(i.name)||'Untitled memory',type:i.type,date:Number.isFinite(Date.parse(i.date))?i.date:null,thumbUrl:i.thumbUrl,width:n(i.width),height:n(i.height),size:n(i.size),spaceTaken:n(i.spaceTaken),takesUpSpace:typeof i.takesUpSpace==='boolean'?i.takesUpSpace:null,duration:n(i.duration),timezoneOffset:Number.isFinite(i.timezoneOffset)?i.timezoneOffset:null,location:Array.isArray(i.location)&&i.location.length===2&&i.location.every(Number.isFinite)?i.location:null,source:'google'};});
  const stmt=db.prepare(`INSERT INTO items(id,account,media_key,data) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,state='active',revision=items.revision+CASE WHEN items.state<>'active' THEN 1 ELSE 0 END`);if(!inTransaction)db.exec('BEGIN');try{for(const i of normalized){stmt.run(i.id,owner,i.mediaKey,JSON.stringify(i));const generated=db.prepare('SELECT job_id,excluded FROM generated_clips WHERE account=? AND (media_key=? OR name=?)').get(owner,i.mediaKey,i.name);if(generated){db.prepare('INSERT OR IGNORE INTO generated_seen VALUES (?,?,?)').run(owner,i.mediaKey,generated.job_id);if(generated.excluded)db.prepare("UPDATE items SET decision='keep',revision=revision+CASE WHEN decision IS NOT 'keep' THEN 1 ELSE 0 END WHERE id=?").run(i.id);}}if(!inTransaction)db.exec('COMMIT');}catch(e){if(!inTransaction)db.exec('ROLLBACK');throw e;}return normalized.length;
 }
 function importPage(list,owner,{nextPageId=null,requestCursor,refreshLatest=false}={}){
  if(!(nextPageId===null||typeof nextPageId==='string'&&nextPageId.length>0&&nextPageId.length<=4000)||typeof refreshLatest!=='boolean'||!(requestCursor===undefined||requestCursor===null||typeof requestCursor==='string'&&requestCursor.length<=4000))throw problem(400,'Invalid library pagination.');
  const storedCursor=getSetting('cursor');
  if(!refreshLatest&&requestCursor!==undefined&&requestCursor!==(storedCursor||null))throw problem(409,'Library progress changed in another tab. Retry Load more.');
  if(!refreshLatest&&nextPageId&&requestCursor===nextPageId)throw problem(409,'Google repeated the library cursor. Reload Google Photos before retrying.');
  db.exec('BEGIN');try{
   const count=importItems(list,owner,{inTransaction:true});
   // Refresh reads the head page, but must not rewind an established older scan.
   if(!refreshLatest||storedCursor===undefined){setSetting('cursor',nextPageId||'');setSetting('exhausted',nextPageId?'false':'true');}
   db.exec('COMMIT');return {count};
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 function decide(id,decision,revision){
  if(![null,'keep','remove'].includes(decision))throw problem(400,'Invalid decision.');const row=db.prepare('SELECT * FROM items WHERE id=? AND account=?').get(id,account());if(!row)throw problem(404,'Photo not found.');if(row.state!=='active')throw problem(409,'This item is in Google Photos Trash. Restore it and refresh before reviewing.');
  for(const j of db.prepare("SELECT data FROM jobs WHERE account=? AND status IN ('queued','running')").all(account()))if(JSON.parse(j.data).ids.includes(id))throw problem(409,'Wait for the album operation before changing this decision.');
  if(db.prepare("SELECT id FROM trim_jobs WHERE account=? AND source_id=? AND status NOT IN ('completed','cancelled')").get(account(),id))throw problem(409,'This original belongs to a saved crop on the video-cropping feature branch.');
  const r=db.prepare('UPDATE items SET decision=?,queue_sent=0,revision=revision+1 WHERE id=? AND revision=?').run(decision,id,revision);if(!r.changes)throw problem(409,'This photo changed in another tab. Refresh and try again.');return {decision,revision:row.revision+1};
 }
 function createJob(ids){
  if(!Array.isArray(ids)||!ids.length||ids.length>500||new Set(ids).size!==ids.length)throw problem(400,'Choose 1–500 unique removal candidates.');if(db.prepare("SELECT id FROM jobs WHERE account=? AND status IN ('queued','running')").get(account()))throw problem(409,'An album operation is already pending.');
  if(ids.some(id=>db.prepare("SELECT id FROM trim_jobs WHERE account=? AND source_id=? AND status NOT IN ('completed','cancelled')").get(account(),id)))throw problem(409,'This original belongs to a saved crop. Its replacement must be verified on the video-cropping feature branch first.');
  const rows=ids.map(id=>db.prepare('SELECT * FROM items WHERE id=? AND account=?').get(id,account()));if(rows.some(r=>!r||r.decision!=='remove'||r.album_key||r.queue_sent||r.state!=='active'))throw problem(409,'Only unsent removal candidates can be added.');
  const id=randomBytes(12).toString('hex'),now=Date.now(),title=albumTitle();setSetting('albumTitle',title);
  const data={ids,mediaKeys:rows.map(r=>r.media_key),dedupKeys:rows.map(r=>JSON.parse(r.data).dedupKey||null),confirmed:[],title};db.prepare('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?)').run(id,account(),JSON.stringify(data),'queued',null,getSetting('album')||null,now,now);return getJob(id);
 }
 function progressJob(id,b){
  const j=getJob(id);if(j.status==='completed')return j;const confirmed=b.confirmed??j.confirmed;
  if(!Array.isArray(confirmed)||confirmed.some(k=>!j.mediaKeys.includes(k))||j.confirmed.some(k=>!confirmed.includes(k)))throw problem(400,'Invalid confirmation set.');const albumKey=b.albumKey||j.albumKey;
  if(albumKey&&!key(albumKey))throw problem(400,'Invalid album identifier.');if(j.albumKey&&albumKey!==j.albumKey)throw problem(409,'Operation album cannot be changed.');if(confirmed.length&&!albumKey)throw problem(400,'An album is required to acknowledge photos.');
  const status=b.status||'running';if(!['running','failed','completed'].includes(status)||(status==='completed'&&new Set(confirmed).size!==j.mediaKeys.length))throw problem(400,'Cannot complete an unverified operation.');
  const data={ids:j.ids,mediaKeys:j.mediaKeys,dedupKeys:j.dedupKeys,confirmed:[...new Set(confirmed)],title:j.title};db.exec('BEGIN');try{if(albumKey)setSetting('album',albumKey);for(let i=0;i<j.mediaKeys.length;i++)if(confirmed.includes(j.mediaKeys[i]))db.prepare('UPDATE items SET album_key=?,revision=revision+CASE WHEN album_key IS NOT ? THEN 1 ELSE 0 END WHERE id=?').run(albumKey,albumKey,j.ids[i]);if(status==='completed')for(const itemId of j.ids)db.prepare('UPDATE items SET queue_sent=1 WHERE id=? AND account=?').run(itemId,account());db.prepare('UPDATE jobs SET data=?,status=?,error=?,album_key=?,updated=? WHERE id=?').run(JSON.stringify(data),status,status==='failed'?text(b.error,500)||'Operation interrupted. Retry to reconcile album membership.':null,albumKey||null,Date.now(),id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return getJob(id);
 }
 function retryJob(id){const j=getJob(id);if(j.status==='completed')return j;if(j.status==='running'&&Date.now()-j.updated<90000)throw problem(409,'The extension is still working.');if(db.prepare("SELECT id FROM jobs WHERE account=? AND id<>? AND status IN ('queued','running')").get(account(),id))throw problem(409,'Another operation is pending.');for(const id of j.ids)if(db.prepare("SELECT decision FROM items WHERE id=? AND state='active'").get(id)?.decision!=='remove')throw problem(409,'A candidate was kept. Start a new operation for the remaining queue.');db.prepare("UPDATE jobs SET status='queued',error=NULL,updated=? WHERE id=?").run(Date.now(),id);return getJob(id);}
 function resetJobAlbum(id,previousAlbumKey){
  const j=getJob(id);if(j.status==='completed'||!key(previousAlbumKey)||j.albumKey!==previousAlbumKey)throw problem(409,'Album assignment changed. Refresh the operation.');
  const data={ids:j.ids,mediaKeys:j.mediaKeys,dedupKeys:j.dedupKeys,confirmed:[],title:j.title};db.exec('BEGIN');try{
   db.prepare('UPDATE items SET album_key=NULL,revision=revision+1 WHERE account=? AND album_key=?').run(account(),previousAlbumKey);
   db.prepare('UPDATE jobs SET data=?,album_key=NULL,error=NULL,updated=? WHERE id=?').run(JSON.stringify(data),Date.now(),id);
   setSetting('unavailableAlbum',previousAlbumKey);if(getSetting('album')===previousAlbumKey)setSetting('album','');db.exec('COMMIT');return getJob(id);
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 function reconciliationSnapshot(){if(db.prepare("SELECT id FROM jobs WHERE account=? AND status IN ('queued','running')").get(account()))throw problem(409,'Finish the pending album update before checking deletions.');return {items:listItems(true),albumKey:getSetting('album')||null,albumTitle:getSetting('albumTitle')||null};}
 function reconcile(results,{albumUnavailable=false,albumKey=null}={}){
  if(!Array.isArray(results)||results.length>10000)throw problem(400,'Invalid reconciliation results.');reconciliationSnapshot();if(typeof albumUnavailable!=='boolean'||albumUnavailable&&(!key(albumKey)||albumKey!==getSetting('album')))throw problem(409,'The review album changed during the check. Retry.');
  const ids=new Set();for(const result of results){if(!result||typeof result.id!=='string'||ids.has(result.id)||!Number.isInteger(result.revision)||!['active','in_trash','unknown'].includes(result.state)||!(result.inAlbum===null||typeof result.inAlbum==='boolean'))throw problem(400,'Invalid reconciliation result.');ids.add(result.id);}
  const counts={inTrash:0,restored:0,albumCleared:0,unknown:0,changed:0},checkedAt=Date.now();
  db.exec('BEGIN');try{for(const result of results){const row=db.prepare('SELECT * FROM items WHERE id=? AND account=?').get(result.id,account());if(!row||row.revision!==result.revision){counts.changed++;continue;}
   if(result.state==='unknown'){counts.unknown++;continue;}
   const state=result.state,albumKey=state==='in_trash'||result.inAlbum===false?null:row.album_key;
   if(state==='in_trash'&&row.state!=='in_trash')counts.inTrash++;if(state==='active'&&row.state==='in_trash')counts.restored++;if(row.album_key&&!albumKey)counts.albumCleared++;
   const changed=state!==row.state||albumKey!==row.album_key;db.prepare('UPDATE items SET state=?,album_key=?,checked_at=?,revision=revision+? WHERE id=?').run(state,albumKey,checkedAt,changed?1:0,row.id);
  }if(albumUnavailable){setSetting('unavailableAlbum',albumKey);setSetting('album','');}const report={...counts,checkedAt,albumUnavailable};setSetting('lastReconciliation',JSON.stringify(report));db.exec('COMMIT');return report;}catch(e){db.exec('ROLLBACK');throw e;}
 }
 function storageSummary(){
  const values=listItems(true).filter(i=>i.decision==='remove'&&!i.cropPending);
  const total=list=>list.reduce((out,i)=>{let bytes=i.takesUpSpace===false?0:i.spaceTaken??i.size;if(Number.isFinite(bytes)&&bytes>=0)out.bytes+=bytes;else out.unknown++;return out;},{bytes:0,unknown:0});
  return {selected:total(values.filter(i=>i.state==='active'&&!i.queueSent)),deleted:total(values.filter(i=>i.state==='in_trash')),active:total(values.filter(i=>i.state==='active'))};
 }
 const reconciliationInfo=()=>({unavailableAlbum:getSetting('unavailableAlbum')||null,inTrashCount:db.prepare("SELECT count(*) AS n FROM items WHERE account=? AND state='in_trash'").get(account()).n,lastReconciliation:JSON.parse(getSetting('lastReconciliation')||'null')});
 return {db,getSetting,setSetting,account,albumTitle,listItems,importItems,importPage,decide,createJob,getJob,progressJob,retryJob,resetJobAlbum,reconciliationSnapshot,reconcile,reconciliationInfo,storageSummary,close:()=>db.close()};
}
