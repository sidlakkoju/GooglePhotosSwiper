import {createPhotosAPI} from './userscript-api.mjs';
import {emptyReview,reviewDeck,reviewQueue,reviewStorage,mergeReviewPage,canUndoReview,decideReview,sendReviewAlbum,reconcileReviewTrash,loadReviewPages} from './userscript-core.mjs';
import {openReviewDatabase} from './userscript-db.mjs';
export function mountPhotosSwipe(environment) {
 const {window,document,location}=environment;
 if(window.top!==window||location.origin!=='https://photos.google.com'||document.getElementById('photos-swipe-userscript-host'))return;
 const rawCall=createPhotosAPI(environment),owner=environment.crypto.randomUUID();
 const host=document.createElement('div');host.id='photos-swipe-userscript-host';
 host.style.cssText='all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
 const root=host.attachShadow({mode:'open'});
 root.innerHTML=`<style>
 :host{font:16px system-ui;color:#193426}*{box-sizing:border-box}button,select,input{font:inherit}button,a,select{touch-action:manipulation}button{min-height:44px;border:0;border-radius:12px;background:#e3ebdf;color:#193426;padding:10px 16px;cursor:pointer}button:disabled{opacity:.5;cursor:wait}button:focus-visible,a:focus-visible,select:focus-visible{outline:3px solid #0075ff;outline-offset:2px}a{color:#236541}p{margin:8px 0;overflow-wrap:anywhere}[hidden]{display:none!important}
 .launcher{pointer-events:auto;position:absolute;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));background:#245b3d;color:white;box-shadow:0 3px 20px #0005}
 .overlay{pointer-events:auto;position:absolute;inset:0;background:#f4f7f1;overflow:auto;overscroll-behavior:contain;padding:calc(12px + env(safe-area-inset-top)) 12px calc(18px + env(safe-area-inset-bottom))}
 .content{max-width:850px;margin:auto}header,.actions,.toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}header{justify-content:space-between}h1{font-size:22px;margin:0}.account{font-size:13px}.card{margin-top:12px;background:#13281f;border-radius:18px;overflow:hidden;position:relative}.media{height:48vh;height:48dvh;min-height:180px;display:flex;align-items:center;justify-content:center;overflow:auto}.media img,.media video{display:block;max-width:100%;max-height:100%;object-fit:contain}.media img{touch-action:pan-y pinch-zoom;user-select:none;-webkit-user-drag:none}.card.expanded .media{height:72vh;height:72dvh}.caption{color:white;padding:10px 14px}.swipe{color:white;text-align:center;padding:12px;touch-action:pan-y pinch-zoom;background:#264638}.actions{justify-content:center;margin:12px 0}.keep{background:#245b3d;color:white}.remove{background:#8c3535;color:white}.stats{padding:12px;background:#e3ebdf;border-radius:12px;margin:12px 0}.toolbar{margin:10px 0}select{max-width:100%;min-height:44px;border-radius:8px}details{margin:16px 0}.queue{display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px}.queue button{padding:6px;overflow:hidden}.queue img{width:100%;height:75px;object-fit:cover}.queue span{display:block;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.status{min-height:24px}#zoom{width:120px;min-height:44px} @media(min-width:800px){.media{height:55vh}.overlay{padding:24px}}
 </style>
 <button class="launcher" id="launcher">Photos Swipe</button>
 <section class="overlay" id="overlay" hidden role="dialog" aria-modal="true" aria-label="Photos Swipe"><div class="content">
 <header><h1>Photos Swipe</h1><button id="close">Close</button></header><p class="account" id="account"></p>
 <div class="card" id="card"><div class="media" id="media"></div><div class="swipe" id="swipe">Swipe left to queue · right to keep</div><p class="caption" id="caption">Load a batch to start reviewing.</p></div>
 <div class="actions"><button class="remove" id="remove">× Queue</button><button id="undo">Undo</button><button class="keep" id="keep">✓ Keep</button><button id="enlarge">Enlarge</button><label>Zoom <input id="zoom" type="range" min="1" max="3" step="0.25" value="1"></label></div>
 <div class="stats" id="stats"></div>
 <div class="toolbar"><button id="load">Load 50 more</button><button id="refresh">Refresh latest</button><select id="filter" aria-label="Media filter"><option value="all">All media</option><option value="photo">Photos</option><option value="video">Videos</option></select><select id="sort" aria-label="Review order"><option value="original">Library order</option><option value="oldest">Oldest first</option><option value="largest">Largest first</option></select></div>
 <p role="status" aria-live="polite" class="status" id="status"></p>
 <details id="queue-details"><summary id="queue-title">Removal queue</summary><div class="queue" id="queue"></div></details>
 <div class="toolbar"><button id="send">Send to review album</button><button id="trash">Check deleted items</button><a id="album" target="_blank" rel="noopener" hidden>Open review album ↗</a></div>
 <p>Swipes never delete media. Send candidates to a review album, then move them to Trash yourself in Google Photos.</p>
 </div></section>`;
 document.documentElement.append(host);
 const $=id=>root.getElementById(id);
 let dbPromise,db,state=emptyReview(),identity,busy=false,history=[],inspected=null,shown=null,generation=0,leaseError=null,lockedAccount=null;
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
 function deck(){const items=reviewDeck(state).filter(item=>$('filter').value==='all'||item.type===$('filter').value);if($('sort').value==='oldest')items.sort((a,b)=>Date.parse(a.date||0)-Date.parse(b.date||0));if($('sort').value==='largest')items.sort((a,b)=>(b.size||0)-(a.size||0));return items;}
 function current(){return inspected?state.items.find(item=>item.mediaKey===inspected):deck()[0];}
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
  const item=current(),queue=reviewQueue(state);
  $('caption').textContent=item?`${inspected?'Queue inspection · ':''}${item.name} · ${item.date?new Date(item.date).toLocaleDateString():'Unknown date'}`:'No unreviewed items in this batch.';
  if(!$('overlay').hidden&&(shown!==(item?.mediaKey||null)||!$('media').childNodes.length))display(item);
  $('stats').textContent=`${deck().length} to review · ${state.items.filter(item=>item.decision).length}/${state.items.length} reviewed · Queue: ${queue.length} · estimated savings ${estimate(queue)} · In Trash: ${estimate(state.items.filter(item=>item.decision==='remove'&&item.state==='in_trash'))}`;
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
  try{const result=await rawCall('identity');if(!result.ok)throw Error(result.error);if(identity?.account!==result.data.account){history=[];inspected=null;stopMedia();}identity=result.data;$('account').textContent=identity.label;db=await database();state=await db.read(identity.account);message(state.job?'A saved album operation is ready to retry.':'Ready. Decisions are saved locally on this browser.');}
  catch(error){identity=null;state=emptyReview();stopMedia();message(error.message);}finally{busy=false;render();controls();}
 }
 function close(){$('overlay').hidden=true;$('launcher').hidden=false;stopMedia();$('launcher').focus();}
 function decide(decision){
  if(busy)return;
  if(inspected&&decision==='remove'){inspected=null;render();return;}
  const item=current();if(!item)return;
  run(async()=>{const previous=item.decision;await save(decideReview(state,item.mediaKey,decision,previous,item.revision||0));history.push({key:item.mediaKey,previous,decision,revision:(item.revision||0)+1});inspected=null;message(decision==='remove'?'Added to the local removal queue.':'Kept.');});
 }
 function undo(){if(busy||!history.length)return;run(async()=>{while(history.length&&!canUndoReview(state,history.at(-1)))history.pop();const last=history.at(-1);if(!last){message('No previous decisions can be undone.');return;}await save(decideReview(state,last.key,last.previous,last.decision,last.revision));history.pop();inspected=null;message('Decision undone.');});}
 async function load(refresh=false) {
  const result=await loadReviewPages({read:async()=>state,save,call,refresh,progress:scanned=>message(`Loading library · ${scanned} rows checked…`)});
  message(`${result.added} new items to review · ${result.scanned} library rows checked${result.exhausted?' · End of library':''}${result.limited?' · Scan limit reached; Load more continues from here':''}${result.warning?'. '+result.warning:''}`);
 }

 function toggleEnlarge(){$('card').classList.toggle('expanded');$('enlarge').textContent=$('card').classList.contains('expanded')?'Fit view':'Enlarge';}
 $('launcher').onclick=open;$('close').onclick=close;$('keep').onclick=()=>decide('keep');$('remove').onclick=()=>decide('remove');$('undo').onclick=undo;$('load').onclick=()=>run(()=>load());$('refresh').onclick=()=>run(()=>load(true));$('enlarge').onclick=toggleEnlarge;
 $('filter').onchange=$('sort').onchange=()=>{inspected=null;render();};
 $('zoom').oninput=()=>{const image=$('media').querySelector('img');if(image){image.style.maxWidth='none';image.style.maxHeight='none';image.style.width=`${Number($('zoom').value)*100}%`;image.style.touchAction=Number($('zoom').value)>1?'pan-x pan-y pinch-zoom':'pan-y pinch-zoom';}};
 $('send').onclick=()=>{if(busy)return;const confirmedKeys=[...(state.job?.mediaKeys||reviewQueue(state).map(item=>item.mediaKey))];const count=confirmedKeys.length;if(!count){message('The removal queue is empty.');return;}if(!window.confirm(`Add ${count} candidates to a private review album? This does not delete media.`))return;run(async()=>{const keys=state.job?.mediaKeys||reviewQueue(state).map(item=>item.mediaKey);if(keys.length!==confirmedKeys.length||keys.some(key=>!confirmedKeys.includes(key)))throw Error('The queue changed in another tab. Review it and confirm again.');message('Updating and verifying the review album…');await sendReviewAlbum({read:async()=>state,save,call,title:`Photos Swipe · Review · ${identity.account.slice(0,12)}`});history=[];inspected=null;message('Every candidate was verified in the review album. Open it in Google Photos to move items to Trash.');});};
 $('trash').onclick=()=>run(async()=>{message('Reading Google Photos Trash…');await save(await reconcileReviewTrash(state,call));message('Trash check complete. Unknown results leave local state unchanged.');});
 let swipeStart=null;
 for(const target of [$('media'),$('swipe')]){
  target.addEventListener('pointerdown',event=>{if(busy||event.isPrimary===false||event.button!==0||event.target.tagName==='VIDEO'||Number($('zoom').value)>1)return;swipeStart={id:event.pointerId,x:event.clientX,y:event.clientY};target.setPointerCapture(event.pointerId);});
  target.addEventListener('pointerup',event=>{if(!swipeStart||event.pointerId!==swipeStart.id)return;const dx=event.clientX-swipeStart.x,dy=event.clientY-swipeStart.y;swipeStart=null;if(Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)*1.5)decide(dx>0?'keep':'remove');});
  target.addEventListener('pointercancel',()=>{swipeStart=null;});
 }
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
