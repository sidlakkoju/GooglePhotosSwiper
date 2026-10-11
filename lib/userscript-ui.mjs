import {createPhotosAPI} from './userscript-api.mjs';
import {emptyReview,reviewDeck,reviewQueue,reviewTrashCandidates,reviewStorage,mergeReviewPage,canUndoReview,decideReview,sendReviewAlbum,reconcileReviewTrash,loadReviewPages} from './userscript-core.mjs';
import {openReviewDatabase} from './userscript-db.mjs';
export function mountPhotosSwipe(environment) {
 const {window,document,location}=environment;
 if(window.top!==window||location.origin!=='https://photos.google.com'||document.getElementById('photos-swipe-userscript-host'))return;
 const rawCall=createPhotosAPI(environment),owner=environment.crypto.randomUUID();
 const host=document.createElement('div');host.id='photos-swipe-userscript-host';
 host.style.cssText='all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
 const root=host.attachShadow({mode:'open'});
 const styleElement1=document.createElement('style');
 root.append(styleElement1);
 styleElement1.append(document.createTextNode("\n :host{font:16px system-ui;color:#193426}*{box-sizing:border-box}button,select,input{font:inherit}button,a,select{touch-action:manipulation}button{min-height:44px;border:0;border-radius:12px;background:#e3ebdf;color:#193426;padding:10px 16px;cursor:pointer}button:disabled{opacity:.5;cursor:wait}button:focus-visible,a:focus-visible,select:focus-visible{outline:3px solid #0075ff;outline-offset:2px}a{color:#236541}p{margin:8px 0;overflow-wrap:anywhere}[hidden]{display:none!important}\n .launcher{pointer-events:auto;position:absolute;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));background:#245b3d;color:white;box-shadow:0 3px 20px #0005}\n .overlay{pointer-events:auto;position:absolute;inset:0;background:#f4f7f1;overflow:auto;overscroll-behavior:contain;padding:calc(12px + env(safe-area-inset-top)) 12px calc(18px + env(safe-area-inset-bottom))}\n .content{max-width:850px;margin:auto}header,.actions,.toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}header{justify-content:space-between}h1{font-size:22px;margin:0}.account{font-size:13px}.card{margin-top:12px;background:#13281f;border-radius:18px;overflow:hidden;position:relative}.media{height:48vh;height:48dvh;min-height:180px;display:flex;align-items:center;justify-content:center;overflow:auto}.media img,.media video{display:block;max-width:100%;max-height:100%;object-fit:contain}.media img{touch-action:pan-y pinch-zoom;user-select:none;-webkit-user-drag:none}.card.expanded .media{height:72vh;height:72dvh}.caption{color:white;padding:10px 14px}.swipe{color:white;text-align:center;padding:12px;touch-action:pan-y pinch-zoom;background:#264638}.actions{justify-content:center;margin:12px 0}.keep{background:#245b3d;color:white}.remove{background:#8c3535;color:white}.stats{padding:12px;background:#e3ebdf;border-radius:12px;margin:12px 0}.toolbar{margin:10px 0}select{max-width:100%;min-height:44px;border-radius:8px}details{margin:16px 0}.queue{display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px}.queue button{padding:6px;overflow:hidden}.queue img{width:100%;height:75px;object-fit:cover}.queue span{display:block;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.status{min-height:24px}.zoom-control,.trash-toggle{display:flex;align-items:center;gap:8px;white-space:nowrap}#zoom{width:120px;min-width:0;min-height:44px}.album-controls{background:#f4f7f1} @media(max-width:599px){.actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.actions button{padding:8px}.zoom-control{grid-column:span 2}.zoom-control input{flex:1}.library-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.library-controls>*{width:100%;min-width:0}.album-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;padding:8px 0 calc(8px + env(safe-area-inset-bottom));margin-bottom:0}.album-controls button{padding:8px;font-size:14px}.album-controls a{grid-column:1 / -1}.trash-toggle{font-size:14px;white-space:normal;min-width:0}.trash-toggle input{flex-shrink:0}.media{height:32vh;height:32dvh}.stats{font-size:14px;padding:8px}} @media(min-width:800px){.media{height:55vh}.overlay{padding:24px}}\n "));
 const launcherElement=document.createElement('button');
 launcherElement.setAttribute("class","launcher");
 launcherElement.setAttribute("id","launcher");
 root.append(launcherElement);
 launcherElement.append(document.createTextNode("Photos Swipe"));
 const overlayElement=document.createElement('section');
 overlayElement.setAttribute("class","overlay");
 overlayElement.setAttribute("id","overlay");
 overlayElement.hidden=true;
 overlayElement.setAttribute("role","dialog");
 overlayElement.setAttribute("aria-modal","true");
 overlayElement.setAttribute("aria-label","Photos Swipe");
 root.append(overlayElement);
 const divElement4=document.createElement('div');
 divElement4.setAttribute("class","content");
 overlayElement.append(divElement4);
 const headerElement5=document.createElement('header');
 divElement4.append(headerElement5);
 const h1Element6=document.createElement('h1');
 headerElement5.append(h1Element6);
 h1Element6.append(document.createTextNode("Photos Swipe"));
 const closeElement=document.createElement('button');
 closeElement.setAttribute("id","close");
 headerElement5.append(closeElement);
 closeElement.append(document.createTextNode("Close"));
 const accountElement=document.createElement('p');
 accountElement.setAttribute("class","account");
 accountElement.setAttribute("id","account");
 divElement4.append(accountElement);
 const cardElement=document.createElement('div');
 cardElement.setAttribute("class","card");
 cardElement.setAttribute("id","card");
 divElement4.append(cardElement);
 const mediaElement=document.createElement('div');
 mediaElement.setAttribute("class","media");
 mediaElement.setAttribute("id","media");
 cardElement.append(mediaElement);
 const swipeElement=document.createElement('div');
 swipeElement.setAttribute("class","swipe");
 swipeElement.setAttribute("id","swipe");
 cardElement.append(swipeElement);
 swipeElement.append(document.createTextNode("Swipe left to queue \u00b7 right to keep"));
 const captionElement=document.createElement('p');
 captionElement.setAttribute("class","caption");
 captionElement.setAttribute("id","caption");
 cardElement.append(captionElement);
 captionElement.append(document.createTextNode("Load a batch to start reviewing."));
 const divElement13=document.createElement('div');
 divElement13.setAttribute("class","actions");
 divElement4.append(divElement13);
 const removeElement=document.createElement('button');
 removeElement.setAttribute("class","remove");
 removeElement.setAttribute("id","remove");
 divElement13.append(removeElement);
 removeElement.append(document.createTextNode("\u00d7 Queue"));
 const undoElement=document.createElement('button');
 undoElement.setAttribute("id","undo");
 divElement13.append(undoElement);
 undoElement.append(document.createTextNode("Undo"));
 const keepElement=document.createElement('button');
 keepElement.setAttribute("class","keep");
 keepElement.setAttribute("id","keep");
 divElement13.append(keepElement);
 keepElement.append(document.createTextNode("\u2713 Keep"));
 const enlargeElement=document.createElement('button');
 enlargeElement.setAttribute("id","enlarge");
 divElement13.append(enlargeElement);
 enlargeElement.append(document.createTextNode("Enlarge"));
 const labelElement18=document.createElement('label');
 labelElement18.setAttribute('class','zoom-control');
 divElement13.append(labelElement18);
 labelElement18.append(document.createTextNode("Zoom "));
 const zoomElement=document.createElement('input');
 zoomElement.setAttribute("id","zoom");
 zoomElement.setAttribute("type","range");
 zoomElement.setAttribute("min","1");
 zoomElement.setAttribute("max","3");
 zoomElement.setAttribute("step","0.25");
 zoomElement.setAttribute("value","1");
 labelElement18.append(zoomElement);
 const statsElement=document.createElement('div');
 statsElement.setAttribute("class","stats");
 statsElement.setAttribute("id","stats");
 divElement4.append(statsElement);
 const divElement21=document.createElement('div');
 divElement21.setAttribute("class","toolbar library-controls");
 divElement4.append(divElement21);
 const loadElement=document.createElement('button');
 loadElement.setAttribute("id","load");
 divElement21.append(loadElement);
 loadElement.append(document.createTextNode("Load 50 more"));
 const refreshElement=document.createElement('button');
 refreshElement.setAttribute("id","refresh");
 divElement21.append(refreshElement);
 refreshElement.append(document.createTextNode("Refresh latest"));
 const filterElement=document.createElement('select');
 filterElement.setAttribute("id","filter");
 filterElement.setAttribute("aria-label","Media filter");
 divElement21.append(filterElement);
 const optionElement25=document.createElement('option');
 optionElement25.setAttribute("value","all");
 filterElement.append(optionElement25);
 optionElement25.append(document.createTextNode("All media"));
 const optionElement26=document.createElement('option');
 optionElement26.setAttribute("value","photo");
 filterElement.append(optionElement26);
 optionElement26.append(document.createTextNode("Photos"));
 const optionElement27=document.createElement('option');
 optionElement27.setAttribute("value","video");
 filterElement.append(optionElement27);
 optionElement27.append(document.createTextNode("Videos"));
 const sortElement=document.createElement('select');
 sortElement.setAttribute("id","sort");
 sortElement.setAttribute("aria-label","Review order");
 divElement21.append(sortElement);
 const optionElement29=document.createElement('option');
 optionElement29.setAttribute("value","original");
 sortElement.append(optionElement29);
 optionElement29.append(document.createTextNode("Library order"));
 const optionElement30=document.createElement('option');
 optionElement30.setAttribute("value","oldest");
 sortElement.append(optionElement30);
 optionElement30.append(document.createTextNode("Oldest first"));
 const optionElement31=document.createElement('option');
 optionElement31.setAttribute("value","largest");
 sortElement.append(optionElement31);
 optionElement31.append(document.createTextNode("Largest first"));
 const statusElement=document.createElement('p');
 statusElement.setAttribute("role","status");
 statusElement.setAttribute("aria-live","polite");
 statusElement.setAttribute("class","status");
 statusElement.setAttribute("id","status");
 divElement4.append(statusElement);
 const queue_detailsElement=document.createElement('details');
 queue_detailsElement.setAttribute("id","queue-details");
 divElement4.append(queue_detailsElement);
 const queue_titleElement=document.createElement('summary');
 queue_titleElement.setAttribute("id","queue-title");
 queue_detailsElement.append(queue_titleElement);
 queue_titleElement.append(document.createTextNode("Removal queue"));
 const queueElement=document.createElement('div');
 queueElement.setAttribute("class","queue");
 queueElement.setAttribute("id","queue");
 queue_detailsElement.append(queueElement);
 const divElement36=document.createElement('div');
 divElement36.setAttribute("class","toolbar album-controls");
 const sendElement=document.createElement('button');
 sendElement.setAttribute("id","send");
 divElement36.append(sendElement);
 sendElement.append(document.createTextNode("Send to review album"));
 const trashElement=document.createElement('button');
 trashElement.setAttribute("id","trash");
 divElement36.append(trashElement);
 trashElement.append(document.createTextNode("Check deleted items"));
 const albumElement=document.createElement('a');
 albumElement.setAttribute("id","album");
 albumElement.setAttribute("target","_blank");
 albumElement.setAttribute("rel","noopener");
 albumElement.hidden=true;
 divElement36.append(albumElement);
 albumElement.append(document.createTextNode("Open review album \u2197"));
 const pElement40=document.createElement('p');
 divElement4.append(pElement40);
 pElement40.append(document.createTextNode("Swipes never delete media. Send candidates to a review album, or explicitly enable Move to Trash."));
 const trashOptIn=document.createElement('input');trashOptIn.setAttribute('id','trash-opt-in');trashOptIn.type='checkbox';
 const trashLabel=document.createElement('label');trashLabel.setAttribute('class','trash-toggle');trashLabel.append(trashOptIn,document.createTextNode('Enable Move to Trash'));
 const moveTrash=document.createElement('button');moveTrash.setAttribute('id','move-trash');moveTrash.hidden=true;
 const trashCandidates=document.createElement('section');trashCandidates.setAttribute('id','trash-candidates');trashCandidates.hidden=true;
 const trashTitle=document.createElement('h2');trashTitle.setAttribute('id','trash-candidates-title');
 const trashExplanation=document.createElement('p');trashExplanation.textContent='These exact items will move to Trash, including candidates already sent to the review album. Select a thumbnail to inspect it or choose Keep instead.';
 const trashList=document.createElement('div');trashList.setAttribute('id','trash-candidates-list');trashList.setAttribute('class','queue');
 trashCandidates.append(trashTitle,trashExplanation,trashList);
 divElement4.append(trashCandidates);
 divElement4.append(divElement36);
 divElement36.append(trashLabel,moveTrash);
 document.documentElement.append(host);
 const $=id=>root.getElementById(id);
 let dbPromise,db,state=emptyReview(),identity,busy=false,inspected=null,focused=null,shown=null,generation=0,leaseError=null,lockedAccount=null;
 const database=()=>dbPromise||(dbPromise=openReviewDatabase(environment.indexedDB).catch(error=>{dbPromise=null;throw error;}));
 const message=value=>{$('status').textContent=value;};
 async function call(operation,args={}) {
  if(leaseError)throw leaseError;
  if(lockedAccount)await db.lease(lockedAccount,owner);
  const result=await rawCall(operation,{...args,...(identity?{account:identity.account}:{})});
  if(!result.ok)throw Error(result.error);
  if(leaseError)throw leaseError;
  if(lockedAccount)await db.lease(lockedAccount,owner);
  return result.data;
 }
 async function assertAccount(){if(!identity)throw Error('Close and reopen Photos Swipe after signing into Google Photos.');const result=await call('identity');if(result.account!==identity.account)throw Error('Google account changed. Close and reopen Photos Swipe.');}
 async function save(next){await assertAccount();state=await db.save(identity.account,next);return state;}
 function controls(){for(const button of root.querySelectorAll('button,select'))if(!['close','launcher'].includes(button.id))button.disabled=busy||!identity;$('overlay').setAttribute('aria-busy',String(busy));}
 async function run(task) {
  if(busy)return;
  busy=true;leaseError=null;controls();let acquired=false,timer;
  try {
   db=await database();
   await assertAccount();
   await db.lease(identity.account,owner);acquired=true;lockedAccount=identity.account;
   timer=setInterval(()=>{db.lease(identity.account,owner).catch(error=>{leaseError=error;});},20000);
   state=await db.read(identity.account);
   await task();
  }catch(error){message(error.message);}finally{
   clearInterval(timer);
   if(acquired)try{await db.lease(identity.account,owner,true);}catch{}
   lockedAccount=null;busy=false;render();controls();
  }
 }
 const bytes=value=>value>=1e9?`${(value/1e9).toFixed(1)} GB`:value>=1e6?`${(value/1e6).toFixed(1)} MB`:`${Math.round(value/1e3)} KB`;
 const estimate=items=>{const total=reviewStorage(items);return `${bytes(total.bytes)}${total.unknown?` + ${total.unknown} unknown`:''}`;};
 function deck(){const items=reviewDeck(state).filter(item=>$('filter').value==='all'||item.type===$('filter').value);if($('sort').value==='oldest')items.sort((a,b)=>new Date(a.date||0)-new Date(b.date||0));if($('sort').value==='largest')items.sort((a,b)=>(b.size||0)-(a.size||0));return items;}
 function current(){return inspected?state.items.find(item=>item.mediaKey===inspected):reviewDeck(state).find(item=>item.mediaKey===focused)||deck()[0];}
 function mediaURL(value,video=false) {
  const url=new URL(value);
  if(url.protocol!=='https:'||!(url.hostname==='photos.fife.usercontent.google.com'||url.hostname.endsWith('.googleusercontent.com'))||url.username||url.password||url.port)throw Error('Unexpected preview host.');
  if(!video){url.pathname=url.pathname.replace(/=.+$/,'')+'=w1200-h1200-k-no';url.searchParams.set('authuser',location.pathname.match(/^\/u\/(\d+)/)?.[1]||'0');}
  return url.href;
 }
 function stopMedia(){generation++;const video=$('media').querySelector('video');if(video){video.pause();video.removeAttribute('src');video.load();}$('media').replaceChildren();shown=null;}
 async function display(item) {
  stopMedia();$('zoom').value='1';shown=item?.mediaKey||null;const token=generation;
  if(!item){$('media').textContent='No items to review. Load more or refresh latest.';$('media').style.color='white';return;}
  try {
   const media=document.createElement(item.type==='video'?'video':'img');
   if(item.type==='video'){media.controls=true;media.muted=true;media.loop=true;media.playsInline=true;media.preload='metadata';media.poster=mediaURL(item.thumbUrl);$('media').append(media);const result=await call('video',{mediaKey:item.mediaKey});if(token!==generation)return;media.src=mediaURL(result.url,true);media.play().catch(()=>{});}
   else {media.alt=item.name;media.draggable=false;media.src=mediaURL(item.thumbUrl);media.ondblclick=()=>toggleEnlarge();$('media').append(media);}
   media.onerror=()=>{if(token===generation)message('Preview unavailable. Reload Google Photos and try again.');};
  }catch(error){if(token===generation)message(error.message);}
 }
 function render() {
  const item=current(),queue=reviewQueue(state),candidates=reviewTrashCandidates(state);
  $('caption').textContent=item?`${inspected?'Candidate inspection · ':''}${item.name} · ${item.date?new Date(item.date).toLocaleDateString():'Unknown date'}`:'No unreviewed items in this batch.';
  if(!$('overlay').hidden&&(shown!==(item?.mediaKey||null)||!$('media').childNodes.length))display(item);
  $('stats').textContent=`${deck().length} to review · ${state.items.filter(item=>item.decision).length}/${state.items.length} reviewed · Queue: ${queue.length} · estimated savings ${estimate(queue)} · In Trash · running total · estimated savings: ${estimate(state.items.filter(item=>item.decision==='remove'&&item.state==='in_trash'))}`;
  moveTrash.textContent=`Move ${candidates.length} items to Trash`;
  trashCandidates.hidden=!trashOptIn.checked;moveTrash.hidden=!trashOptIn.checked;
  trashTitle.textContent=`Move to Trash candidates (${candidates.length})`;
  trashList.replaceChildren();
  for(const candidate of candidates){
   const button=document.createElement('button'),image=document.createElement('img'),label=document.createElement('span');
   image.src=mediaURL(candidate.thumbUrl);image.alt='';image.loading='lazy';
   label.textContent=`${candidate.name} · ${candidate.type} · ${candidate.date?new Date(candidate.date).toLocaleDateString():'Unknown date'} · ${candidate.queueSent?'Sent to review album':'Queued'} · ID: ${candidate.mediaKey}`;
   label.style.cssText='white-space:normal;overflow-wrap:anywhere';
   button.append(image,label);button.setAttribute('aria-label',`Inspect ${label.textContent}`);
   button.onclick=()=>{if(!busy){inspected=candidate.mediaKey;render();}};trashList.append(button);
  }
  $('queue-title').textContent=`Removal queue (${queue.length})`;
  $('queue').replaceChildren();
  for(const item of queue){const button=document.createElement('button'),image=document.createElement('img'),label=document.createElement('span');image.src=mediaURL(item.thumbUrl);image.alt='';image.loading='lazy';label.textContent=item.name;button.append(image,label);button.setAttribute('aria-label',`Inspect ${item.name}`);button.onclick=()=>{if(!busy){inspected=item.mediaKey;render();}};$('queue').append(button);}
  $('remove').textContent=inspected?'Back to review':'× Queue';$('keep').textContent=inspected?'Keep instead':'✓ Keep';
  $('send').textContent=state.job?'Retry saved album operation':'Send to review album';
  $('album').hidden=!state.albumKey;if(state.albumKey)$('album').href=`https://photos.google.com/u/${location.pathname.match(/^\/u\/(\d+)/)?.[1]||'0'}/album/${encodeURIComponent(state.albumKey)}`;
 }
 async function open() {
  if(busy)return;
  $('overlay').hidden=false;$('launcher').hidden=true;$('close').focus();message('Reading local progress…');
  busy=true;controls();
  try{const result=await rawCall('identity');if(!result.ok)throw Error(result.error);if(identity?.account!==result.data.account){inspected=null;focused=null;stopMedia();}identity=result.data;$('account').textContent=identity.label;db=await database();state=await db.read(identity.account);message(state.job?'A saved album operation is ready to retry.':'Ready. Decisions are saved locally on this browser.');}
  catch(error){identity=null;state=emptyReview();stopMedia();message(error.message);}finally{busy=false;render();controls();}
 }
 function close(){$('overlay').hidden=true;$('launcher').hidden=false;stopMedia();$('launcher').focus();}
 function decide(decision){
  if(busy)return;
  if(inspected&&decision==='remove'){inspected=null;render();return;}
  const item=current();if(!item)return;
  run(async()=>{const previous=item.decision,next=decideReview(state,item.mediaKey,decision,previous,item.revision||0);await save({...next,history:[...(state.history||[]),{key:item.mediaKey,previous,decision,revision:(item.revision||0)+1}]});inspected=null;focused=null;message(decision==='remove'?'Added to the local removal queue.':'Kept.');});
 }
 function undo(){if(busy)return;run(async()=>{const history=structuredClone(state.history||[]);while(history.length&&!canUndoReview(state,history.at(-1)))history.pop();const last=history.pop();if(!last){message('No previous decisions can be undone.');return;}const next=decideReview(state,last.key,last.previous,last.decision,last.revision);const previous=[...history].reverse().find(entry=>entry.key===last.key);if(previous&&previous.revision===last.revision-1)previous.revision=next.items.find(item=>item.mediaKey===last.key).revision;await save({...next,history});const restored=state.items.find(item=>item.mediaKey===last.key);inspected=restored.decision==='remove'?last.key:null;focused=restored.decision===null?last.key:null;message(`Decision undone for ${restored.name}.`);});}
 async function load(refresh=false) {
  const result=await loadReviewPages({read:async()=>state,save,call,refresh,progress:scanned=>message(`Loading library · ${scanned} rows checked…`)});
  message(`${result.added} new items to review · ${result.scanned} library rows checked${result.exhausted?' · End of library':''}${result.limited?' · Scan limit reached; Load more continues from here':''}${result.warning?'. '+result.warning:''}`);
 }

 function toggleEnlarge(){$('card').classList.toggle('expanded');$('enlarge').textContent=$('card').classList.contains('expanded')?'Fit view':'Enlarge';}
 $('launcher').onclick=open;$('close').onclick=close;$('keep').onclick=()=>decide('keep');$('remove').onclick=()=>decide('remove');$('undo').onclick=undo;$('load').onclick=()=>run(()=>load());$('refresh').onclick=()=>run(()=>load(true));$('enlarge').onclick=toggleEnlarge;
 $('filter').onchange=$('sort').onchange=()=>{inspected=null;focused=null;render();};
 $('zoom').oninput=()=>{const image=$('media').querySelector('img');if(image){image.style.maxWidth='none';image.style.maxHeight='none';image.style.width=`${Number($('zoom').value)*100}%`;image.style.touchAction=Number($('zoom').value)>1?'pan-x pan-y pinch-zoom':'pan-y pinch-zoom';}};
 $('send').onclick=()=>{if(busy)return;const confirmedKeys=[...(state.job?.mediaKeys||reviewQueue(state).map(item=>item.mediaKey))];const count=confirmedKeys.length;if(!count){message('The removal queue is empty.');return;}if(!window.confirm(`Add ${count} candidates to a private review album? This does not delete media.`))return;run(async()=>{const keys=state.job?.mediaKeys||reviewQueue(state).map(item=>item.mediaKey);if(keys.length!==confirmedKeys.length||keys.some(key=>!confirmedKeys.includes(key)))throw Error('The queue changed in another tab. Review it and confirm again.');message('Updating and verifying the review album…');await sendReviewAlbum({read:async()=>state,save,call,title:'Photos Swipe · Review'});inspected=null;message('Every candidate was verified in the review album. Select Enable Move to Trash below to use this panel, or open the review album to move items manually in Google Photos.');});};
 trashOptIn.onchange=()=>render();
 moveTrash.onclick=()=>{if(busy||!trashOptIn.checked)return;const candidates=reviewTrashCandidates(state),keys=candidates.map(item=>item.mediaKey);if(!keys.length){message('No candidates to move to Trash.');return;}if(!window.confirm(`Move exactly ${keys.length} items to Google Photos Trash?\n\n${candidates.map(item=>`${item.name} (ID: ${item.mediaKey})`).join('\n')}`))return;run(async()=>{if(state.job)throw Error('Finish the saved album operation before moving items to Trash.');const currentKeys=reviewTrashCandidates(state).map(item=>item.mediaKey);if(currentKeys.length!==keys.length||currentKeys.some(key=>!keys.includes(key)))throw Error('Candidates changed. Review the item list and confirm again.');if(state.items.some(item=>keys.includes(item.mediaKey)&&!item.dedupKey))throw Error('Missing Trash identifiers. Refresh latest before retrying.');for(let index=0;index<keys.length;index+=25){const batch=keys.slice(index,index+25);await call('moveToTrash',{dedupKeys:state.items.filter(item=>batch.includes(item.mediaKey)).map(item=>item.dedupKey),confirmed:true});await save(await reconcileReviewTrash(state,call));if(state.items.some(item=>batch.includes(item.mediaKey)&&item.state!=='in_trash'))throw Error('Trash move was not verified. Check deleted items before retrying.');}trashOptIn.checked=false;moveTrash.hidden=true;message(`Verified ${keys.length} items in Trash.`);});};
 $('trash').onclick=()=>run(async()=>{message('Reading Google Photos Trash…');await save(await reconcileReviewTrash(state,call));message('Trash check complete. Unknown results leave local state unchanged.');});
 let swipeStart=null;
 for(const target of [$('media'),$('swipe')]){
  target.addEventListener('pointerdown',event=>{if(busy||event.isPrimary===false||event.button!==0||event.target.tagName==='VIDEO'||Number($('zoom').value)>1)return;swipeStart={id:event.pointerId,x:event.clientX,y:event.clientY};target.setPointerCapture(event.pointerId);});
  target.addEventListener('pointerup',event=>{if(!swipeStart||event.pointerId!==swipeStart.id)return;const dx=event.clientX-swipeStart.x,dy=event.clientY-swipeStart.y;swipeStart=null;if(Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)*1.5)decide(dx>0?'keep':'remove');});
  target.addEventListener('pointercancel',()=>{swipeStart=null;});
 }
 window.addEventListener('pageshow',event=>{if(event.persisted&&!$('overlay').hidden)return open();});
 window.addEventListener('keydown',event=>{
  if($('overlay').hidden||event.altKey||event.ctrlKey||event.metaKey)return;
  if(event.key==='Tab'){
   const focusable=[...root.querySelectorAll('button:not(:disabled),select,input,a[href],summary,video[controls]')].filter(element=>element.getClientRects().length);
   const index=focusable.indexOf(root.activeElement),next=event.shiftKey?(index-1+focusable.length)%focusable.length:(index+1)%focusable.length;
   event.preventDefault();event.stopImmediatePropagation();focusable[next]?.focus();return;
  }
  if(['INPUT','SELECT','TEXTAREA'].includes(root.activeElement?.tagName))return;
  const actions={ArrowLeft:()=>decide('remove'),ArrowRight:()=>decide('keep'),z:undo,Z:undo,f:toggleEnlarge,F:toggleEnlarge,Escape:close,' ':()=>{const video=$('media').querySelector('video');if(video){if(video.paused)video.play().catch(()=>{});else video.pause();}}};
  if(actions[event.key]){event.preventDefault();event.stopImmediatePropagation();actions[event.key]();}
 },true);
}
