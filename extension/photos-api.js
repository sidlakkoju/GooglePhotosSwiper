// RPC payloads and array parsers adapted from xob0t/Google-Photos-Toolkit.
// MIT attribution and pinned source revision: see THIRD_PARTY_NOTICES.md.
// Serialized by chrome.scripting into the Google Photos MAIN world.
export async function photosOperation(operation,args={}) {
 try {
  if(location.origin!=='https://photos.google.com')throw Error('Open Google Photos before connecting.');
  const global=window.WIZ_global_data;
  if(!global?.SNlM0e||!global?.oPEP7c)throw Error('Google Photos is not signed in or its page format changed. Reload Google Photos.');
  const pageToken=global.SNlM0e;
  const label=String(global.oPEP7c).trim().toLowerCase();
  const account=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(label)))).map(b=>b.toString(16).padStart(2,'0')).join('');
  if(args.account&&args.account!==account)throw Error('Google account changed. Return to the account paired with Photos Swipe.');
  if(operation==='identity')return {ok:true,data:{account,label}};
  const path=global.eptZe;
  if(typeof path!=='string'||!/^\/(?:u\/\d+\/|_\/PhotosUi\/(?:u\/\d+\/)?)?$/.test(path))throw Error('Unsupported Google Photos account path.');
  const validKey=k=>typeof k==='string'&&/^[a-zA-Z0-9_-]{1,250}$/.test(k);
  const generatedName=n=>typeof n==='string'&&/^PhotosSwipe_CROP_[a-f0-9]{24}\.MOV$/.test(n);
  const safeMediaUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='photos.fife.usercontent.google.com'||u.hostname.endsWith('.googleusercontent.com'))&&!u.username&&!u.password&&!u.port;}catch{return false;}};
  const authuser=location.pathname.match(/^\/u\/(\d+)\//)?.[1]||path.match(/\/u\/(\d+)\//)?.[1]||'0';
  function uploadURL(value){if(typeof value!=='string'||value.length>16000)throw Error('Unexpected Google upload session.');const u=new URL(value);if(u.origin!=='https://photos.google.com'||u.pathname!=='/_/upload/uploadmedia/interactive'||!u.searchParams.get('upload_id')||u.searchParams.get('authuser')!==authuser||u.username||u.password||u.port||u.hash)throw Error('Unexpected Google upload session.');return u.href;}
  async function uploadToken(response){const type=response.headers.get('content-type')?.split(';')[0];if(type==='application/json'||Number(response.headers.get('content-length'))>65536)throw Error('Unexpected upload token response.');const bytes=new Uint8Array(await response.arrayBuffer());if(!bytes.length||bytes.length>65536)throw Error('The final upload token was not acknowledged.');const value=new TextDecoder().decode(bytes).trim();if(/^[A-Za-z0-9+/]+={0,2}$/.test(value)&&value.length%4===0)return value;let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);}
  function requireSamePage(){const current=window.WIZ_global_data;if(!current||String(current.oPEP7c).trim().toLowerCase()!==label||current.SNlM0e!==pageToken)throw Error('Google account or page authentication changed. Reload and retry.');}
  async function rpc(id,payload) {
   requireSamePage();
   const query=new URLSearchParams({rpcids:id,'source-path':location.pathname,'f.sid':String(global.FdrFJe),bl:String(global.cfb2h),pageId:'none',rt:'c'});
   const response=await fetch(`https://photos.google.com${path}data/batchexecute?${query}`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:new URLSearchParams({'f.req':JSON.stringify([[[id,JSON.stringify(payload),null,'generic']]]),at:pageToken}),credentials:'include',signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw Error(`Google Photos request failed (${response.status}). Reload its tab and try again.`);
   const raw=await response.text();let envelope;
   for(const line of raw.split('\n')) {if(!line.includes('wrb.fr'))continue;try {const parsed=JSON.parse(line);envelope=parsed.find(e=>Array.isArray(e)&&e[0]==='wrb.fr'&&e[1]===id);if(envelope)break;}catch{}}
   if(!envelope||typeof envelope[2]!=='string')throw Error('Google returned an unexpected response. No changes were confirmed.');
   let data;try{data=JSON.parse(envelope[2]);}catch{throw Error('Google response could not be read.');}return data;
  }
  async function trimInfo(mediaKey){
   if(!validKey(mediaKey))throw Error('Invalid crop media identity.');
   const info=await rpc('fDcn4b',[mediaKey,1,null,null,1]),row=info?.[0],video=await rpc('VrseUb',[mediaKey,null,null,null,null]);
   if(row?.[0]!==mediaKey||video?.[0]?.[0]!==mediaKey||typeof row?.[2]!=='string'||!(row[3]===null||Number.isFinite(row[3]))||!(row[4]===null||Number.isFinite(row[4])))throw Error('Google crop metadata format changed.');
   if(row.length<14||!(row[9]===null||Array.isArray(row[9]))||!(row[13]===null||Array.isArray(row[13])))throw Error('Google source location fields are unknown. No metadata was inferred.');
   const originalCoordinates=row[9]===null?null:row[9][0],editedCoordinates=row[13]===null?null:row[13][0];
   const coordinates=originalCoordinates??editedCoordinates;
   if(coordinates===undefined)throw Error('Google source location fields are unknown. No missing location was inferred.');
   const extra=video[0].find(x=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.hasOwn(x,'76647426'));
   if(coordinates!==null&&(!Array.isArray(coordinates)||coordinates.length<2||!coordinates.slice(0,2).every(Number.isFinite)))throw Error('Google location format changed.');
   const duration=Number.isFinite(extra?.[76647426]?.[0])?extra[76647426][0]/1000:null,url=safeMediaUrl(video[1])?video[1]:null;
   return {account,mediaKey,dedupKey:typeof row[11]==='string'?row[11]:null,name:row[2],date:row[3]===null?null:new Date(row[3]).toISOString(),timezoneOffset:Number.isFinite(row[4])?row[4]:null,location:coordinates?.slice(0,2)||null,width:row[6],height:row[7],size:row[5],duration,ready:Number.isFinite(duration)&&duration>0&&!!url&&video[0][12]?.[0]!==20,url};
  }
  if(operation==='trimUploadStart'){
   if(!generatedName(args.name)||!Number.isSafeInteger(args.size)||args.size<1||args.size>1024*1024*1024||typeof args.sha1!=='string'||!/^[A-Za-z0-9+/]{27}=$/.test(args.sha1))throw Error('Invalid generated upload.');
   requireSamePage();const response=await fetch(`https://photos.google.com/_/upload/uploadmedia/interactive?authuser=${authuser}`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8','X-Goog-Hash':`sha1=${args.sha1}`,'X-Goog-Upload-Command':'start','X-Goog-Upload-File-Name':encodeURIComponent(args.name),'X-Goog-Upload-Header-Content-Length':String(args.size),'X-Goog-Upload-Protocol':'resumable'},body:'',credentials:'include',redirect:'error',signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw Error(`Google upload initialization failed (${response.status}).`);const url=uploadURL(response.headers.get('x-goog-upload-url')),control=response.headers.get('x-goog-upload-control-url'),granularity=Number(response.headers.get('x-goog-upload-chunk-granularity'));
   if(!Number.isSafeInteger(granularity)||granularity<1||granularity>8*1024*1024||!['active','final'].includes(response.headers.get('x-goog-upload-status')))throw Error('Google upload initialization headers changed. No bytes were sent.');
   if(control){const c=new URL(uploadURL(control));if(c.searchParams.get('upload_id')!==new URL(url).searchParams.get('upload_id'))throw Error('Google returned mismatched upload controls.');}
   return {ok:true,data:{url,controlUrl:control||url,granularity}};
  }
  if(operation==='trimUploadQuery'){
   const url=uploadURL(args.url);if(!Number.isSafeInteger(args.size)||args.size<1)throw Error('Invalid upload query.');requireSamePage();const response=await fetch(url,{method:'POST',headers:{'X-Goog-Upload-Command':'query'},body:'',credentials:'include',redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error(`Google upload reconciliation failed (${response.status}). No duplicate upload was attempted.`);const status=response.headers.get('x-goog-upload-status');if(status==='final')return {ok:true,data:{status,offset:args.size,token:await uploadToken(response)}};const raw=response.headers.get('x-goog-upload-size-received'),offset=typeof raw==='string'&&/^\d+$/.test(raw)?Number(raw):NaN;if(status!=='active'||!Number.isSafeInteger(offset)||offset<0||offset>args.size)throw Error('Google did not confirm a resumable byte offset. No duplicate upload was attempted.');return {ok:true,data:{status,offset}};
  }
  if(operation==='trimUploadChunk'){
   const url=uploadURL(args.url);if(!generatedName(args.name)||typeof args.base64!=='string'||args.base64.length>12*1024*1024||!Number.isSafeInteger(args.offset)||args.offset<0||typeof args.final!=='boolean')throw Error('Invalid upload chunk.');let binary;try{binary=atob(args.base64);}catch{throw Error('Invalid upload chunk encoding.');}if(!binary.length||binary.length>8*1024*1024)throw Error('Invalid upload chunk size.');const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));requireSamePage();const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Goog-Upload-Command':args.final?'upload, finalize':'upload','X-Goog-Upload-Offset':String(args.offset),'X-Goog-Upload-File-Name':encodeURIComponent(args.name)},body:bytes,credentials:'include',redirect:'error',signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error(`Google byte upload failed (${response.status}). Resume to query the confirmed offset.`);const status=response.headers.get('x-goog-upload-status');if(args.final){if(status!=='final')throw Error('Google did not acknowledge upload finalization.');return {ok:true,data:{status,offset:args.offset+bytes.length,token:await uploadToken(response)}};}if(status!=='active')throw Error('Unexpected Google upload state.');return {ok:true,data:{status,offset:args.offset+bytes.length}};
  }
  if(operation==='trimCreate'){
   if(!generatedName(args.name)||typeof args.token!=='string'||args.token.length>100000||!/^[A-Za-z0-9+/]+={0,2}$/.test(args.token)||!(args.date===null||typeof args.date==='string'&&Number.isFinite(Date.parse(args.date))))throw Error('Invalid generated media creation.');
   const data=await rpc('mdpdU',[[[args.token,args.name,args.date===null?null:Date.parse(args.date)]]]),record=data?.[0]?.[0],row=record?.[1];
   if(!Array.isArray(data)||data.length!==1||!Array.isArray(data[0])||data[0].length!==1||!Array.isArray(row)||!validKey(row[0])||!safeMediaUrl(row[1]?.[0]))throw Error('Google creation acknowledgement changed. Reconcile the reserved filename before retrying; no second creation will be issued.');
   // The old client documented an echoed upload token, but the current response
   // has not established that field. Bind the exact returned key to its canonical
   // generated filename before acknowledging it; never infer identity from a URL.
   const canonical=await rpc('fDcn4b',[row[0],1,null,null,1]);if(canonical?.[0]?.[0]!==row[0]||canonical[0][2]!==args.name)throw Error('Google returned an existing or unconfirmed item with a different filename. Reconcile the crop; no second creation will be issued.');
   return {ok:true,data:{mediaKey:row[0],name:canonical[0][2]}};
  }
  if(operation==='trimSetTimestamp'){
   if(!validKey(args.mediaKey)||!validKey(args.sourceMediaKey)||args.mediaKey===args.sourceMediaKey||!generatedName(args.name)||typeof args.dedupKey!=='string'||args.dedupKey.length>1024||!/^[A-Za-z0-9_+/=-]+$/.test(args.dedupKey))throw Error('Only a confirmed generated copy can receive capture metadata.');const date=typeof args.date==='string'?Date.parse(args.date):NaN,zone=Number.isFinite(args.timezoneOffset)?args.timezoneOffset/1000:NaN;if(!Number.isFinite(date)||date%1000!==0||!Number.isSafeInteger(zone)||Math.abs(zone)>14*3600)throw Error('Capture date/timezone cannot be transferred precisely. Correct the generated copy in Google Photos and retry.');
   const before=await trimInfo(args.mediaKey);if(before.name!==args.name||before.dedupKey!==args.dedupKey||!before.ready)throw Error('Generated identity changed before metadata transfer.');await rpc('DaSgWe',[[[before.dedupKey,date/1000,zone]]]);return {ok:true,data:{attempted:true}};
  }
  if(operation==='library') {
   const data=await rpc('lcxiM',[args.cursor||null,null,50,null,1,1]);
   if(!Array.isArray(data)||!(data[0]==null||Array.isArray(data[0])))throw Error('Google library format changed.');
   const rawItems=data[0]||[];
   let details=new Map(),metadataWarning='';
   if(rawItems.length){try{
    const keys=rawItems.map(i=>[i[0]]);
    const fields=Array(36).fill(null);fields[24]=[];fields[35]=[];
    const bulk=await rpc('EWgK9e',[[[keys],[fields]]]);
    if(!Array.isArray(bulk?.[0]?.[1]))throw Error();
    details=new Map(bulk[0][1].map(i=>[i[0],{name:i[1]?.[3],size:i[1]?.[9],spaceTaken:i[1]?.at(-1)?.[1],takesUpSpace:i[1]?.at(-1)?.[0]===undefined?null:i[1]?.at(-1)?.[0]===1}]));
   }catch{metadataWarning='Extra file sizes could not be read. Photos can still be reviewed.';}}
   const items=rawItems.map(i=>{if(!validKey(i[0])||typeof i[1]?.[0]!=='string')throw Error('Google media format changed.');const extra=i.at(-1)||{},duration=extra[76647426]?.[0],info=details.get(i[0])||{},timestamp=Number(i[2]);return {...info,mediaKey:i[0],dedupKey:i[3],name:info.name||extra[396644657]?.[0]||`Memory ${new Date(timestamp).toLocaleDateString()}`,type:duration!=null?'video':'photo',date:Number.isFinite(timestamp)?new Date(timestamp).toISOString():null,thumbUrl:i[1][0],width:i[1][1],height:i[1][2],duration,timezoneOffset:Number.isFinite(i[4])?i[4]:null,location:Array.isArray(extra[129168200]?.[1]?.[0])?extra[129168200][1][0].slice(0,2):null};});
   return {ok:true,data:{items,nextPageId:data[1]||null,metadataWarning}};
  }
  if(operation==='trashPage') {
   const data=await rpc('zy0IHe',[args.cursor||null]);if(!Array.isArray(data)||!(data[0]==null||Array.isArray(data[0]))||!(data[1]==null||typeof data[1]==='string'))throw Error('Google Trash format changed. No deletion state was updated.');
   const items=(data[0]||[]).map(row=>{if(!validKey(row?.[0])||!(row[3]==null||typeof row[3]==='string'))throw Error('Google Trash item format changed.');return {mediaKey:row[0],dedupKey:row[3]||null};});return {ok:true,data:{items,nextPageId:data[1]||null}};
  }
  if(operation==='itemState') {
   if(!validKey(args.mediaKey))throw Error('Invalid media identifier.');const data=await rpc('VrseUb',[args.mediaKey,null,null,null,null]);
   if(data?.[0]?.[0]!==args.mediaKey)return {ok:true,data:{state:'unknown'}};
   const extra=data[0].find(value=>value&&typeof value==='object'&&!Array.isArray(value)&&['76647426','163238866','225032867','318563170','525000000'].some(k=>Object.hasOwn(value,k)));
   if(!extra)return {ok:true,data:{state:'unknown'}};
   const timestamp=extra[225032867]?.[0];return {ok:true,data:{state:Number(timestamp)>0?'in_trash':'active'}};
  }
  if(operation==='findAlbum') {
   let page=null;const seen=new Set();
   do {const data=await rpc('Z5xsfc',[page,null,null,null,1,null,null,100,[2],5]);if(!Array.isArray(data)||!(data[0]==null||Array.isArray(data[0])))throw Error('Google album format changed.');const matching=(data[0]||[]).filter(i=>i.at(-1)?.[72930366]?.[1]===args.title);if(matching.length>1)throw Error('Multiple review albums have the same name. Resolve the duplicate albums first.');if(matching.length)return {ok:true,data:{albumKey:matching[0][0]}};page=data[1]||null;if(page&&seen.has(page))throw Error('Google repeated an album page.');seen.add(page);}while(page);
   return {ok:true,data:{albumKey:null}};
  }
  if(operation==='createAlbum') {
   if(typeof args.title!=='string'||!args.title.startsWith('Photos Swipe · Review · ')||args.title.length>150)throw Error('Invalid review album title.');
   const data=await rpc('OXvT9d',[args.title,null,2]);const albumKey=data?.[0]?.[0];if(!validKey(albumKey))throw Error('Album creation was not confirmed. Retry to look for the album before creating another.');return {ok:true,data:{albumKey}};
  }
  if(operation==='albumMembers') {
   if(!validKey(args.albumKey))throw Error('Invalid album.');let page=null,keys=[],dedupKeys=[],seen=new Set();
   do{const data=await rpc('snAcKc',[args.albumKey,page,null,null]);if(!Array.isArray(data)||!(data[1]==null||Array.isArray(data[1]))||data[3]?.[0]!==args.albumKey)throw Error('Unable to verify the review album.');keys.push(...(data[1]||[]).map(i=>i[0]));dedupKeys.push(...(data[1]||[]).map(i=>i[3]).filter(k=>typeof k==='string'&&k));page=data[2]||null;if(page&&seen.has(page))throw Error('Google repeated an album page.');seen.add(page);}while(page);
   return {ok:true,data:{keys,dedupKeys}};
  }
  if(operation==='addToAlbum') {
   if(!validKey(args.albumKey)||!Array.isArray(args.mediaKeys)||!args.mediaKeys.length||args.mediaKeys.length>25||args.mediaKeys.some(k=>!validKey(k)))throw Error('Invalid album batch.');
   await rpc('E1Cajb',[args.mediaKeys,args.albumKey]);return {ok:true,data:{requested:args.mediaKeys.length}};
  }
  if(operation==='trimInfo'||operation==='trimFind') {
   let mediaKey=args.mediaKey;
   if(operation==='trimFind'){
    if(!generatedName(args.name))throw Error('Invalid generated filename.');
    const found=await rpc('EzkLib',[args.name,null,null]);if(!Array.isArray(found?.[0]))throw Error('Cannot reconcile the uploaded crop.');
    const candidates=[];for(const row of found[0]){if(!validKey(row?.[0]))continue;const info=await rpc('fDcn4b',[row[0],1,null,null,1]);if(info?.[0]?.[2]===args.name)candidates.push(row[0]);}
    if(candidates.length!==1)throw Error(candidates.length?'Multiple matching crops exist. Resolve the exact replacement before retrying.':'The crop is not searchable yet. Retry after Google finishes processing.');mediaKey=candidates[0];
   }
   return {ok:true,data:await trimInfo(mediaKey)};
  }
  if(operation==='trimDownloadStart'){
   if(!validKey(args.mediaKey))throw Error('Invalid source identity.');
   const result=await rpc('yCLA7',[[[args.mediaKey]]]);if(typeof result?.[0]!=='string'||!result[0]||result[0].length>100000)throw Error('Original download was not acknowledged.');
   return {ok:true,data:{token:result[0]}};
  }
  if(operation==='trimDownloadPoll'){
   if(typeof args.token!=='string'||!args.token||args.token.length>100000)throw Error('Invalid stored-original download checkpoint.');
   const checked=await rpc('dnv2s',[[args.token]]),record=checked?.[0]?.[0]?.[0];
   // Live Google response while preparing: [[[[token,1],0]]].
   if(Array.isArray(record)&&record.length===2&&record[0]===args.token&&record[1]===1&&checked[0][0][1]===0)return {ok:true,data:{state:'pending'}};
   if(!Array.isArray(record)||record[0]!==args.token)throw Error('Stored-original response belongs to another download request.');
   const entries=record?.[2];if(!Array.isArray(entries)||entries.length!==1||!Array.isArray(entries[0]))throw Error('Stored-original download response format changed. No file was accepted.');
   const entry=entries[0];if(typeof entry[0]!=='string'||!entry[0]||entry[0].length>512||!safeMediaUrl(entry[1])||!Number.isSafeInteger(entry[2])||entry[2]<1||entry[2]>(/\.zip$/i.test(entry[0])?1024*1024*1024+16*1024*1024:1024*1024*1024))throw Error('Stored-original download metadata is malformed. No file was accepted.');
   return {ok:true,data:{state:/\.zip$/i.test(entry[0])?'archive':'ready',url:entry[1],name:entry[0],size:entry[2]}};
  }
  if(operation==='video') {
   if(!validKey(args.mediaKey))throw Error('Invalid video.');const data=await rpc('VrseUb',[args.mediaKey,null,null,null,null]);
   if(data?.[0]?.[0]!==args.mediaKey||typeof data[1]!=='string')throw Error('Video preview unavailable. Open it in Google Photos.');return {ok:true,data:{url:data[1]}};
  }
  throw Error('Unsupported Google Photos operation.');
 }catch(e){return {ok:false,error:e.message||'Google Photos request failed.'};}
}
