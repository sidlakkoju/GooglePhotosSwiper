import {createLocalThumbnails} from './userscript-thumbnails.mjs';
import {reviewOrders,reviewMemories,flashbackDeck,keptEligible} from './userscript-order.mjs';
import {createSessionStorageCounter,createStorageCapsule,formatStorageBytes} from './userscript-counter.mjs';
import {cardPreviewURL,reusablePreview,previewURL,createPreloadBuffer,createWriteQueue} from './userscript-performance.mjs';
import {privateSyncFetch,createSyncClient,markSyncChanges,mergeSyncResult,rebuildSyncedReview} from './userscript-sync.mjs';
import {createSwipeFeedback} from './userscript-swipe.mjs';
import {createReviewPreloader,reviewPreviewWindow,reviewURLStale} from './userscript-preload.mjs';
import {createPhotosAPI} from './userscript-api.mjs';
import {reviewSwipeCount,recordReviewDecision,emptyReview,reviewDeck,reviewQueue,reviewTrashCandidates,reviewStorage,mergeReviewPage,canUndoReview,decideReview,sendReviewAlbum,reconcileReviewTrash,loadReviewPages} from './userscript-core.mjs';
import {createPairingStore} from './userscript-settings.mjs';
import {openReviewDatabase,createLeaseOwner,LEASE_HEARTBEAT_MS} from './userscript-db.mjs';
export function restoreVideoTime(video,savedTime){
 if(video.dataset.resumeReady!=='pending')return;
 if(Number.isFinite(savedTime))video.currentTime=Math.max(0,Math.min(savedTime,Number.isFinite(video.duration)?video.duration:savedTime));
 video.dataset.resumeReady='ready';
}
export function createVideoTimeline({document,video,onSeek}){
 const timeline=document.createElement('input'),label=document.createElement('span');
 timeline.type='range';timeline.min='0';timeline.max='1';timeline.step='any';timeline.value='0';timeline.dataset.videoControl='seek';
 timeline.setAttribute('aria-label','Video timeline');
 timeline.style.cssText='position:absolute;bottom:52px;left:12px;width:calc(100% - 24px);height:32px;touch-action:none;z-index:2';
 label.dataset.videoControl='time';label.style.cssText='position:absolute;bottom:22px;left:50%;transform:translateX(-50%);pointer-events:none';
 const format=time=>{const seconds=Math.floor(Number.isFinite(time)?Math.max(0,time):0);return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;};
 const update=()=>{timeline.value=String(Number.isFinite(video.duration)&&video.duration>0?video.currentTime/video.duration:0);label.textContent=`${format(video.currentTime)} / ${format(video.duration)}`;};
 const seek=fraction=>{if(!Number.isFinite(video.duration)||video.duration<=0)return;video.currentTime=Math.max(0,Math.min(1,fraction))*video.duration;video.dataset.resumeReady='ready';update();onSeek();};
 const seekAt=event=>{const rect=timeline.getBoundingClientRect();if(rect.width>0)seek((event.clientX-rect.left)/rect.width);};
 let pointer=null;
 timeline.addEventListener('pointerdown',event=>{event.stopPropagation();if(event.isPrimary===false||event.button!==0)return;event.preventDefault();pointer=event.pointerId;timeline.setPointerCapture?.(pointer);seekAt(event);});
 timeline.addEventListener('pointermove',event=>{event.stopPropagation();if(event.pointerId===pointer){event.preventDefault();seekAt(event);}});
 timeline.addEventListener('pointerup',event=>{event.stopPropagation();if(event.pointerId!==pointer)return;seekAt(event);pointer=null;if(timeline.hasPointerCapture?.(event.pointerId))timeline.releasePointerCapture(event.pointerId);});
 for(const type of ['pointercancel','lostpointercapture'])timeline.addEventListener(type,event=>{event.stopPropagation();pointer=null;});
 timeline.addEventListener('click',event=>{event.stopPropagation();seekAt(event);});
 for(const type of ['touchstart','touchmove','touchend'])timeline.addEventListener(type,event=>event.stopPropagation());
 timeline.addEventListener('input',()=>seek(Number(timeline.value)));
 for(const type of ['timeupdate','loadedmetadata','durationchange','seeked'])video.addEventListener(type,update);
 update();return [timeline,label];
}
export function mountPhotosSwipe(environment) {
 if(typeof environment.GM?.xmlHttpRequest==='function')environment.syncFetch=privateSyncFetch(environment.GM);
 const {window,document,location}=environment;
 if(window.top!==window||location.origin!=='https://photos.google.com'||document.getElementById('photos-swipe-userscript-host'))return;
 const rawCall=environment.photosCall||createPhotosAPI(environment);
 let owner;
 const ownerReady=createLeaseOwner(window,environment.crypto).then(value=>{owner=value;});
 let tabChannel;
 try{if(window.BroadcastChannel)tabChannel=new window.BroadcastChannel('photos-swipe-tabs');}catch{}
 const notifyTabs=account=>{try{tabChannel?.postMessage({account,owner});}catch{}};
 const host=document.createElement('div');host.id='photos-swipe-userscript-host';
 host.style.cssText='position:fixed;inset:0;z-index:2147483647;pointer-events:none';
 const root=host.attachShadow({mode:'open'});
 const styleElement1=document.createElement('style');
 root.append(styleElement1);
 styleElement1.append(document.createTextNode(":host{all:initial;--ps-bg:#F2F2F7;--ps-surface:rgba(255,255,255,.72);--ps-surface-solid:#FFF;--ps-fill:rgba(120,120,128,.12);--ps-label:#000;--ps-label2:rgba(60,60,67,.6);--ps-sep:rgba(60,60,67,.18);--ps-accent:#007AFF;--ps-destructive:#FF3B30;--ps-on-action:#FFF;--ps-shadow-color:rgba(0,0,0,.12);--ps-r-sm:10px;--ps-r-md:16px;--ps-r-lg:24px;--ps-r-pill:999px;--ps-s1:4px;--ps-s2:8px;--ps-s3:12px;--ps-s4:16px;--ps-s5:24px;--ps-s6:32px;--ps-font:-apple-system,BlinkMacSystemFont,\"SF Pro Text\",system-ui,Inter,sans-serif;--ps-t-large:600 28px/34px var(--ps-font);--ps-t-title:600 20px/25px var(--ps-font);--ps-t-body:400 17px/22px var(--ps-font);--ps-t-callout:500 15px/20px var(--ps-font);--ps-t-caption:400 12px/16px var(--ps-font);font:var(--ps-t-body);color:var(--ps-label);color-scheme:light}@media(prefers-color-scheme:dark){:host{--ps-bg:#000;--ps-surface:rgba(28,28,30,.72);--ps-surface-solid:#1C1C1E;--ps-fill:rgba(120,120,128,.24);--ps-label:#FFF;--ps-label2:rgba(235,235,245,.6);--ps-sep:rgba(84,84,88,.6);--ps-accent:#0A84FF;--ps-destructive:#FF453A;--ps-shadow-color:rgba(0,0,0,.5);color-scheme:dark}}*{box-sizing:border-box}button,select,input{font:var(--ps-t-callout);appearance:none;-webkit-appearance:none;color:var(--ps-label);background:var(--ps-surface-solid);border:1px solid var(--ps-sep);border-radius:var(--ps-r-sm);padding:var(--ps-s2) var(--ps-s3);accent-color:var(--ps-accent)}button,a,select{touch-action:manipulation}button{min-height:44px;border:0;background:var(--ps-fill);padding:10px 16px;cursor:pointer}button:disabled{opacity:.5;cursor:wait}button:focus-visible,a:focus-visible,select:focus-visible,input:focus-visible{outline:3px solid var(--ps-accent);outline-offset:2px}a{color:var(--ps-accent)}p{margin:8px 0;overflow-wrap:anywhere}[hidden]{display:none!important}.launcher{pointer-events:auto;position:absolute;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));background:var(--ps-accent);color:var(--ps-on-action);box-shadow:0 3px 20px var(--ps-shadow-color)}.overlay{pointer-events:auto;position:absolute;inset:0;background:var(--ps-bg);overflow:auto;overscroll-behavior:contain;padding:calc(12px + env(safe-area-inset-top)) 12px calc(18px + env(safe-area-inset-bottom))}.content{max-width:850px;margin:auto}header,.actions,.toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}header{justify-content:space-between}h1{font:var(--ps-t-large);margin:0}.account{font:var(--ps-t-caption);color:var(--ps-label2)}.card{touch-action:none;user-select:none;-webkit-user-select:none;-webkit-user-drag:none;-webkit-touch-callout:none;margin-top:12px;background:var(--ps-surface-solid);border-radius:var(--ps-r-lg);position:relative}.media{touch-action:none;height:48vh;height:48dvh;min-height:180px;display:flex;align-items:center;justify-content:center;overflow:auto}.media[aria-busy=true]{background:var(--ps-surface-solid)}.media[aria-busy=true]::after{content:'Loading…';position:absolute;color:var(--ps-label);background:var(--ps-surface);padding:8px;border-radius:8px}.media img,.media video{display:block;max-width:100%;max-height:100%;object-fit:contain}.media img{pointer-events:none;-webkit-user-drag:none}.card.zoomed,.card.zoomed .media{touch-action:pan-x pan-y pinch-zoom}.card.zoomed .media img{pointer-events:auto}.card.expanded .media img{pointer-events:auto}.card.expanded .media{height:72vh;height:72dvh}.caption{padding:10px 14px}.swipe{color:var(--ps-label2);text-align:center;padding:12px;touch-action:none;background:var(--ps-fill)}.actions{justify-content:center;margin:12px 0}.stats{padding:12px;background:var(--ps-fill);border-radius:var(--ps-r-sm);margin:12px 0}.toolbar{margin:10px 0}select{max-width:100%;min-height:44px}details{margin:16px 0}#sync-local{display:block}#sync-settings>label{display:block;width:100%;margin:12px 0}#sync-settings>label>input{display:block;width:100%;min-width:0;margin-top:4px}.queue{display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px}.queue button{padding:6px;overflow:hidden}.queue img{width:100%;height:75px;object-fit:cover}.queue span{display:block;font:var(--ps-t-caption);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.status{min-height:24px}.zoom-control,.trash-toggle{display:flex;align-items:center;gap:8px;white-space:nowrap}#zoom{width:120px;min-width:0;min-height:44px}#history-list li{overflow-wrap:anywhere}#undo-preview{font-size:13px;min-width:0;flex-basis:100%} @media(max-width:599px){.overlay{scrollbar-gutter:stable;padding-right:18px}.actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.actions button{padding:8px}#undo-preview{grid-column:1 / -1;grid-row:2;margin:0}.zoom-control{grid-column:span 2}.zoom-control input{flex:1}.library-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.library-controls>*{width:100%;min-width:0}.album-controls{position:relative;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;padding:8px 0 calc(8px + env(safe-area-inset-bottom));margin-bottom:0}.album-controls button{padding:8px;font-size:14px;min-width:0;white-space:normal;overflow-wrap:anywhere}.album-controls a,.album-explanation{grid-column:1 / -1;min-width:0}.album-explanation{margin:0;font-size:13px}.trash-toggle{min-height:44px;font-size:14px;white-space:normal;min-width:0}.trash-toggle input{flex-shrink:0}.media{height:32vh;height:32dvh}.stats{font-size:14px;padding:8px}} @media(min-width:800px){.media{height:55vh}.overlay{padding:24px}}h2{font:var(--ps-t-title)}.status,#sync-status,.album-explanation{color:var(--ps-label2)}select{padding-right:var(--ps-s6);background-image:linear-gradient(45deg,transparent 50%,var(--ps-label2) 50%),linear-gradient(135deg,var(--ps-label2) 50%,transparent 50%);background-position:calc(100% - 15px) 50%,calc(100% - 10px) 50%;background-size:5px 5px;background-repeat:no-repeat}input[type=checkbox]{width:22px;height:22px;min-width:22px;padding:0;display:grid;place-content:center}input[type=checkbox]:checked{background:var(--ps-accent);border-color:var(--ps-accent)}input[type=checkbox]:checked::before{content:'\u2713';color:var(--ps-on-action)}input[type=range]{padding:0;background:transparent;border:0}input[type=range]::-webkit-slider-runnable-track{height:4px;background:var(--ps-fill);border-radius:var(--ps-r-pill)}input[type=range]::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:22px;height:22px;margin-top:-9px;border:0;border-radius:var(--ps-r-pill);background:var(--ps-accent)}input[type=range]::-moz-range-track{height:4px;background:var(--ps-fill);border-radius:var(--ps-r-pill)}input[type=range]::-moz-range-thumb{width:22px;height:22px;border:0;border-radius:var(--ps-r-pill);background:var(--ps-accent)}.keep,.remove{background:var(--ps-surface-solid)}.keep{color:var(--ps-accent)}.remove{color:var(--ps-destructive)}#move-trash{background:var(--ps-destructive);color:var(--ps-on-action)}.album-controls,#sync-settings{background:var(--ps-surface-solid);border-radius:var(--ps-r-md)}#sync-settings{padding:var(--ps-s3)}@supports ((backdrop-filter:blur(20px)) or (-webkit-backdrop-filter:blur(20px))){.album-controls,#sync-settings{background:var(--ps-surface);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}}"));
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
 const versionElement=document.createElement('span');
 versionElement.setAttribute('id','running-version');
 versionElement.setAttribute('class','version-label');
 versionElement.textContent=`v${environment.version}`;
 h1Element6.append(document.createTextNode(' '),versionElement);
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
 const topCard=document.createElement('div');topCard.setAttribute('class','top-card');cardElement.append(topCard);topCard.append(mediaElement);
 const underCard=document.createElement('div');underCard.setAttribute('id','next-card');underCard.setAttribute('class','media under-card');underCard.setAttribute('aria-hidden','true');underCard.hidden=true;
 cardElement.insertBefore(underCard,topCard);
 const stamps=['KEEP','REMOVE'].map(label=>{const stamp=document.createElement('span');stamp.setAttribute('class',`swipe-stamp stamp-${label.toLowerCase()}`);stamp.textContent=label;stamp.setAttribute('aria-hidden','true');topCard.append(stamp);return stamp;});
 const feedbackStyles=document.createElement('style');feedbackStyles.textContent='.card{overflow:hidden}.top-card{position:relative;z-index:1;background:var(--ps-surface-solid)}.media{position:relative;z-index:1;background:var(--ps-surface-solid);border-radius:var(--ps-r-lg);-webkit-user-select:none;-webkit-touch-callout:none}.media:has(>[data-video-control]:not([hidden])){padding-bottom:96px}.media .video-poster{width:100%;height:100%;min-width:0;min-height:0;object-fit:contain}.under-card{position:absolute;inset:0 0 auto;z-index:0;pointer-events:none;transform:scale(.94)}.swipe-stamp{position:absolute;top:24px;z-index:2;padding:8px 14px;border:4px solid currentColor;border-radius:8px;font-size:28px;font-weight:800;opacity:0;pointer-events:none}.stamp-keep{left:24px;color:var(--ps-accent);transform:rotate(-12deg)}.stamp-remove{right:24px;color:var(--ps-destructive);transform:rotate(12deg)}';root.append(feedbackStyles);
 const swipeElement=document.createElement('div');
 swipeElement.setAttribute("class","swipe");
 swipeElement.setAttribute("id","swipe");
 cardElement.append(swipeElement);
 swipeElement.append(document.createTextNode("Swipe left to queue \u00b7 right to keep \u00b7 Tap video to play/pause"));
 const captionElement=document.createElement('p');
 captionElement.setAttribute("class","caption");
 captionElement.setAttribute("id","caption");
 divElement4.append(captionElement);
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
 const flashbacksOption=document.createElement('option');flashbacksOption.value='flashbacks';flashbacksOption.textContent='Flashbacks';sortElement.append(flashbacksOption);sortElement.value='flashbacks';
 const optionElement29=document.createElement('option');
 optionElement29.setAttribute("value","original");
 sortElement.append(optionElement29);
 optionElement29.append(document.createTextNode("Timeline"));
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
 pElement40.setAttribute('class','album-explanation');
 divElement36.append(pElement40);
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
 const settingsPanel=document.createElement('details');settingsPanel.setAttribute('id','sync-settings');const settingsTitle=document.createElement('summary');settingsTitle.textContent='Sync settings';settingsPanel.append(settingsTitle);
 const syncExplanation=document.createElement('p');syncExplanation.textContent='Sign in with Google to sync your progress across devices.';settingsPanel.append(syncExplanation);
 const onboarding=document.createElement('section');onboarding.setAttribute('id','pair-onboarding');onboarding.hidden=true;
 const onboardingTitle=document.createElement('h2');onboardingTitle.textContent='Sync across devices';
 const onboardingText=document.createElement('p');onboardingText.textContent='Sign in once on each device to sync with your Google account.';
 onboarding.append(onboardingTitle,onboardingText);divElement4.insertBefore(onboarding,cardElement);
 const syncLocal=document.createElement('button');syncLocal.setAttribute('id','sync-local');syncLocal.textContent='Continue locally';settingsPanel.append(syncLocal);
 const onboardingLocal=document.createElement('button');onboardingLocal.textContent='Continue locally';onboarding.append(onboardingLocal);onboardingLocal.onclick=()=>syncLocal.onclick();
 let viewerShortcutsBlockedUntil=0;
 const suppressViewerShortcuts=()=>{viewerShortcutsBlockedUntil=Date.now()+500;};
 const syncStatus=document.createElement('p');syncStatus.setAttribute('id','sync-status');syncStatus.setAttribute('role','status');divElement4.insertBefore(settingsPanel,cardElement);divElement4.insertBefore(syncStatus,cardElement);
 const historyPanel=document.createElement('details');historyPanel.setAttribute('id','history-details');
 const historyTitle=document.createElement('summary');historyTitle.textContent='Decision history';
 const undoPreview=document.createElement('p');undoPreview.setAttribute('id','undo-preview');
 const historyList=document.createElement('ol');historyList.setAttribute('id','history-list');
 historyPanel.append(historyTitle,historyList);divElement13.insertBefore(undoPreview,enlargeElement);divElement4.insertBefore(historyPanel,queue_detailsElement);
 const shellStyle=document.createElement('style');shellStyle.textContent='.overlay{scrollbar-gutter:auto;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);padding:24px}.content{display:flex;flex-direction:column;position:relative;width:540px;max-width:100%;max-height:calc(100dvh - 48px);overflow:auto;margin:0;background:var(--ps-bg);border-radius:28px;padding:20px}.content>*{flex-shrink:0}.content .card{display:flex;flex-direction:column;flex-shrink:1;min-height:0;overflow:hidden}.content .top-card{display:flex;flex-direction:column;flex:1 1 auto;min-height:0}.content .media{flex:1 1 auto;min-height:0}.content .caption{flex-shrink:0;margin:0;border-radius:0 0 var(--ps-r-lg) var(--ps-r-lg)}.content .under-card{max-height:100%;overflow:hidden}.content header{flex-wrap:nowrap}.content header button{flex-shrink:0}.content h1{flex-basis:100%;font:var(--ps-t-title)}.content header{flex-wrap:wrap}.version-label{font:var(--ps-t-caption);color:var(--ps-label2)}.media{height:56dvh}.caption{position:relative;overflow-wrap:anywhere;background:var(--ps-surface-solid);pointer-events:none}.actions{display:flex}.actions #remove,.actions #keep{width:72px;height:72px;border-radius:50%;font-size:30px}.actions #undo,.actions #enlarge{border-radius:50%}.settings-sheet{position:absolute;inset:0;z-index:5;overflow:auto;padding:0 20px 20px;background:var(--ps-surface-solid);border-radius:28px}.settings-sheet .settings-header{position:sticky;top:0;z-index:1;flex-wrap:nowrap;margin:0 -20px;padding:20px;background:var(--ps-surface-solid)}.settings-header h2{margin:0}.settings-sheet .group{padding:12px;background:var(--ps-fill);border-radius:16px;margin:12px 0}.settings-sheet label{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:8px 0}.settings-sheet input{max-width:100%;min-width:0}.settings-sheet #sync-settings{margin:0}.settings-sheet #sync-settings label{display:block}.settings-sheet #sync-settings input{width:100%}.settings-sheet #stats{margin:0}.gear-error::after{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--ps-destructive)}#sync-status,#undo-preview,.swipe,.zoom-control{display:none}.counter{font:var(--ps-t-callout);border-radius:999px;background:var(--ps-fill);padding:8px;white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis}.status:empty{visibility:hidden}.status{position:relative;height:60px;min-height:60px;overflow:auto;margin:0;background:var(--ps-surface);border-radius:16px;padding:8px;text-align:center}.review-panel{padding:12px;background:var(--ps-surface-solid);border-radius:16px;margin-top:12px}@supports(backdrop-filter:blur(20px)){.settings-sheet{background:var(--ps-surface);backdrop-filter:blur(20px)}}@media(max-width:599px){.overlay{padding:0}.content{width:100%;max-height:100dvh;border-radius:0;padding:16px}.settings-sheet{border-radius:0}.content h1{position:absolute;width:1px;height:1px;overflow:hidden}.content header{flex-wrap:nowrap;gap:6px}.content header button{padding:10px 12px}.counter{font:var(--ps-t-caption)}.media{height:56dvh}.actions{display:flex}}';root.append(shellStyle);
 const gear=document.createElement('button');gear.setAttribute('id','settings');gear.textContent='⚙';gear.setAttribute('aria-label','Settings');gear.setAttribute('aria-haspopup','dialog');headerElement5.insertBefore(gear,closeElement);
 const counter=document.createElement('span');counter.setAttribute('class','counter storage-counter');headerElement5.insertBefore(counter,closeElement);
 const storageSession=createSessionStorageCounter();const storageCapsule=createStorageCapsule({document,window,root,element:counter,isVisible:()=>!overlayElement.hidden});
 const reviewButton=document.createElement('button');reviewButton.setAttribute('id','review');reviewButton.setAttribute('aria-label','Review marked items');headerElement5.insertBefore(reviewButton,closeElement);
 closeElement.textContent='✕';closeElement.setAttribute('aria-label','Close Photos Swipe');
 const sheet=document.createElement('section');sheet.setAttribute('id','settings-sheet');sheet.setAttribute('class','settings-sheet');sheet.hidden=true;sheet.setAttribute('role','dialog');sheet.setAttribute('aria-label','Settings');
 const sheetHeader=document.createElement('header');sheetHeader.setAttribute('class','settings-header');sheet.append(sheetHeader);
 const sheetClose=document.createElement('button');sheetClose.textContent='Done';sheetClose.setAttribute('aria-label','Close settings');
 const sheetTitle=document.createElement('h2');sheetTitle.textContent='Settings';sheetHeader.append(sheetTitle,sheetClose);divElement4.append(sheet);
 const group=(title,...children)=>{const section=document.createElement('section');section.setAttribute('class','group');const heading=document.createElement('h2');heading.textContent=title;section.append(heading,...children);sheet.append(section);return section;};
 settingsTitle.textContent='Sync';settingsPanel.open=true;settingsPanel.insertBefore(accountElement,syncExplanation);group('Sync',settingsPanel);group('Show',filterElement);sortElement.hidden=true;
 const reviewEvery=document.createElement('input');reviewEvery.setAttribute('id','review-every');reviewEvery.type='number';reviewEvery.min='1';reviewEvery.max='10000';reviewEvery.value='25';reviewEvery.setAttribute('aria-label','Review every N marked');reviewEvery.hidden=true;
 group('History',historyPanel);
 const deleteMethod=document.createElement('select');deleteMethod.setAttribute('id','delete-method');deleteMethod.setAttribute('aria-label','Delete method');for(const [value,label] of [['trash','Trash']]){const option=document.createElement('option');option.value=value;option.textContent=label;deleteMethod.append(option);}deleteMethod.hidden=true;const lifetime=document.createElement('p');lifetime.setAttribute('id','lifetime-freed');lifetime.hidden=true;statsElement.hidden=true;sheet.append(statsElement);group('Refresh',refreshElement,loadElement,trashElement);group('Previous transfer',sendElement,albumElement).hidden=true;
 const settingsVersion=document.createElement('p');settingsVersion.setAttribute('id','settings-version');settingsVersion.setAttribute('class','version-label');settingsVersion.textContent=`Photos Swipe v${environment.version}`;sheet.append(settingsVersion);
 const reviewPanel=document.createElement('section');reviewPanel.setAttribute('class','review-panel');reviewPanel.setAttribute('id','review-panel');reviewPanel.hidden=true;reviewPanel.append(queue_detailsElement,trashCandidates,divElement36);divElement4.append(reviewPanel);queue_detailsElement.open=true;trashLabel.hidden=true;trashOptIn.checked=true;pElement40.textContent='Review marked items before moving them to Google Photos Trash.';
 let cancelGoogleSignIn=null;
 const openSettings=()=>{sheet.hidden=false;settingsPanel.open=true;gear.setAttribute('aria-expanded','true');sheetClose.focus();};const closeSettings=()=>{cancelGoogleSignIn?.();suppressViewerShortcuts();sheet.hidden=true;gear.setAttribute('aria-expanded','false');gear.focus();};gear.onclick=openSettings;sheetClose.onclick=closeSettings;
 const openReview=()=>{swipeFeedback.reset();const video=mediaElement.querySelector('video');if(video&&!video.paused){video.pause();resumeReviewPlayback=true;}reviewItems=reviewTrashCandidates(state).map(item=>({...item,legacy:!!item.queueSent}));previewKey=null;reviewPanel.hidden=false;reviewStatus.textContent='';reviewStatus.hidden=true;renderTrashReview();moveTrash.focus();};reviewButton.onclick=openReview;
 overlayElement.addEventListener('click',event=>{if(event.target===overlayElement){return close();}});
 document.documentElement.append(host);
 const icon=(button,label,paths)=>{button.replaceChildren();button.setAttribute('aria-label',label);const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'2','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(key,value);for(const path of paths){const element=document.createElementNS('http://www.w3.org/2000/svg','path');element.setAttribute('d',path);svg.append(element);}button.append(svg);};
 icon(removeElement,'Mark for deletion',['M6 6l12 12M18 6L6 18']);icon(keepElement,'Keep',['M12 21s-10-6-10-12a5 5 0 0 1 10-3 5 5 0 0 1 10 3c0 6-10 12-10 12Z']);icon(undoElement,'Undo',['M9 14L4 9l5-5','M4 9h10.5a5.5 5.5 0 0 1 0 11H11']);icon(enlargeElement,'Fullscreen photo',['M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7']);icon(closeElement,'Close Photos Swipe',['M6 6l12 12M18 6L6 18']);icon(gear,'Settings',['M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2','M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0']);icon(reviewButton,'Going to Trash',['M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13']);
 const trashBadge=document.createElement('span');trashBadge.setAttribute('class','trash-badge');trashBadge.textContent='0';reviewButton.append(trashBadge);topCard.append(enlargeElement);
 const queuePill=document.createElement('div');queuePill.setAttribute('class','queue-pill');queuePill.hidden=true;const queueThumbs=document.createElement('span');queueThumbs.setAttribute('class','queue-thumbs');const queueSize=document.createElement('span');queueSize.setAttribute('class','queue-size');const queuePillText=document.createElement('span'),queueGrowth=document.createElement('span'),queueReview=document.createElement('button');queueGrowth.setAttribute('class','queue-growth');queueReview.textContent='Review';queueReview.onclick=openReview;queuePill.append(queueThumbs,queuePillText,queueSize,queueGrowth,queueReview);divElement4.insertBefore(queuePill,divElement13);
 const redesignStyle=document.createElement('style');redesignStyle.textContent=`.overlay{padding:0}.content{width:440px;height:min(860px,90vh);max-height:90dvh;padding:8px 0 0;overflow:hidden;border-radius:24px}.content header{height:48px;flex:none;flex-wrap:nowrap;gap:8px;padding:0 12px}.content h1{position:absolute;width:1px;height:1px;overflow:hidden}.content > header button{position:relative;width:36px;height:36px;min-height:36px;padding:8px;border-radius:50%;flex:none}.content .settings-header button{position:relative;width:auto;min-width:44px;height:36px;min-height:36px;padding:0 14px;border-radius:18px}.content .settings-header button::before{content:"";position:absolute;inset:-4px;background:transparent}.content svg{width:100%;height:100%}.counter{flex:1;text-align:center;background:none;padding:0;font-size:12px}.trash-badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 4px;border-radius:9px;background:var(--ps-accent);color:#fff;font:600 11px/18px var(--ps-font)}.content .card{flex:1;min-height:0;margin:4px 8px 0;border-radius:20px;background:var(--ps-surface-solid);overflow:hidden}.content .top-card{height:100%}.content .media,.content .card.expanded .media{height:100%;min-height:0;overflow:hidden;border-radius:20px}.content .media img,.content .media video{width:100%;height:100%;object-fit:contain}.content .caption{position:relative;flex:none;order:1;margin:0;padding:8px 14px;background:var(--ps-surface-solid);color:var(--ps-label);font-size:12px;overflow-wrap:anywhere}.content .actions{flex:none;display:flex;align-items:center;gap:28px;margin:0;padding:14px 0 calc(env(safe-area-inset-bottom) + 10px)}.actions #remove,.actions #keep{width:72px;height:72px;min-height:72px;padding:21px;box-shadow:0 10px 30px var(--ps-shadow-color)}.actions #remove{color:var(--ps-label);background:var(--ps-surface)}.actions #keep{background:var(--ps-accent);color:#fff}.actions #undo{width:48px;height:48px;min-height:48px;padding:13px;border-radius:50%;background:var(--ps-fill)}#undo:disabled{opacity:.3;cursor:default}.actions button,#enlarge{transition:transform .35s cubic-bezier(.34,1.56,.64,1)}.actions button:active:not(:disabled),#enlarge:active{transform:scale(.92)}#enlarge{position:absolute;top:12px;right:12px;z-index:3;width:36px;height:36px;min-height:36px;padding:9px;border-radius:50%;background:rgba(30,30,30,.35);color:#fff;border:.5px solid rgba(255,255,255,.25);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}.content .card.expanded{position:relative;inset:auto;z-index:4;margin:4px 0 0;border-radius:0}.content .card.expanded .caption{display:none}.content .status{position:relative;order:2;flex:none;height:24px;min-height:24px;margin:0 8px;padding:2px 6px;background:none;font-size:12px}.content .actions{order:4}.queue-pill{order:3}.trash-review-status{margin:0;padding:8px 16px;color:var(--ps-label2);font-size:13px}.content .status:empty{visibility:hidden}.queue-pill{flex:none;display:flex;gap:8px;align-items:center;align-self:center;max-width:calc(100% - 16px);margin-top:10px;padding:6px 10px;border-radius:999px;background:var(--ps-surface);backdrop-filter:blur(20px);font-size:12px}.queue-pill button{color:var(--ps-accent);background:none;padding:6px;min-height:32px}.queue-thumbs{display:flex;padding-left:8px}.queue-thumbs img{width:26px;height:30px;object-fit:cover;border:2px solid var(--ps-bg);border-radius:6px;margin-left:-8px;transform:rotate(-8deg)}.queue-growth{background:var(--ps-accent);color:#fff;border-radius:12px;padding:3px 5px}.review-panel{position:absolute;inset:0;z-index:7;margin:0;padding:0;border-radius:24px;background:var(--ps-bg);display:flex;flex-direction:column;overflow:hidden}.trash-nav{height:48px;flex:none;display:flex;justify-content:space-between;align-items:center;padding:0 12px}.trash-nav button{background:none;color:var(--ps-accent);padding:8px}.trash-scroll{flex:1;min-height:0;overflow:auto}.content .trash-heading{position:static;width:auto;height:auto;overflow:visible;flex-basis:auto;order:0;font:700 30px/36px var(--ps-font);padding:4px 16px 0;margin:0}.trash-size{padding:8px 16px 0;color:var(--ps-accent);font:800 44px/46px var(--ps-font)}.trash-size small{display:block;color:var(--ps-label2);font:600 13px/18px var(--ps-font);text-transform:uppercase;letter-spacing:.6px}.trash-subtitle{padding:2px 16px 12px;color:var(--ps-label2);font-size:15px}.trash-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:2px}.trash-tile{position:relative;aspect-ratio:1;min-width:0}.trash-photo{position:absolute;inset:0;width:100%;height:100%;padding:0;border-radius:0;background:var(--ps-fill)}.trash-photo img{width:100%;height:100%;object-fit:cover;display:block}.trash-tile.kept .trash-photo{opacity:.45}.trash-check{position:absolute;right:6px;bottom:6px;width:26px;height:26px;min-height:26px;padding:4px;border-radius:50%;border:2px solid #fff;background:var(--ps-accent);color:#fff}.trash-tile.kept .trash-check{background:rgba(0,0,0,.2)}.trash-tile.kept .trash-check svg{visibility:hidden}.trash-duration{position:absolute;left:6px;bottom:6px;color:#fff;font-size:12px;text-shadow:0 1px 2px #000;pointer-events:none}.trash-legacy{position:absolute;left:6px;top:6px;border-radius:6px;padding:2px 4px;background:rgba(0,0,0,.6);color:#fff;font-size:10px;pointer-events:none}.trash-help{padding:12px 16px;text-align:center;color:var(--ps-label2);font-size:13px}.trash-bar{flex:none;display:flex;gap:10px;padding:12px 16px calc(env(safe-area-inset-bottom) + 12px);background:var(--ps-surface);border-top:1px solid var(--ps-sep)}.trash-bar button{flex:1;height:50px;border-radius:14px;font-weight:600}.trash-bar #move-trash,.trash-bar .preview-trash{background:var(--ps-destructive);color:#fff}.trash-preview{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--ps-bg);z-index:1}.trash-preview-media{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;background:var(--ps-surface-solid)}.trash-preview-media img,.trash-preview-media video{width:100%;height:100%;object-fit:contain}.trash-preview-caption{text-align:center;font-size:15px;padding:10px 12px 0}.trash-preview-caption small{display:block;color:var(--ps-label2);font-size:12px}.trash-strip{display:flex;gap:3px;overflow:auto;padding:8px;flex:none}.trash-strip button{width:34px;height:34px;min-height:34px;padding:0;flex:none;border-radius:4px;opacity:.6}.trash-strip button.active{opacity:1;outline:2px solid var(--ps-accent)}.trash-strip img{width:100%;height:100%;object-fit:cover}.settings-sheet{z-index:8}@media(max-width:600px){.overlay{position:fixed;inset:0;height:100vh;height:100dvh;background:var(--ps-bg);backdrop-filter:none;-webkit-backdrop-filter:none;overflow:hidden}.content{width:100%;height:100vh;height:100dvh;max-height:none;border-radius:0;padding:env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left)}.review-panel{position:fixed;border-radius:0;padding-top:env(safe-area-inset-top)}.trash-preview{padding-top:env(safe-area-inset-top)}.settings-sheet{position:fixed;padding-top:0}.settings-sheet .settings-header{height:auto;padding-top:calc(env(safe-area-inset-top) + 20px)}}@media(prefers-reduced-motion:reduce){.actions button,#enlarge{transition:none}}`;root.append(redesignStyle);
 reviewPanel.replaceChildren();reviewPanel.setAttribute('role','dialog');reviewPanel.setAttribute('aria-label','Going to Trash');
 const reviewNav=document.createElement('div');reviewNav.setAttribute('class','trash-nav');const reviewBack=document.createElement('button'),selectAll=document.createElement('button');reviewBack.textContent='‹ Back';selectAll.textContent='Select All';reviewBack.onclick=()=>{reviewPanel.hidden=true;previewKey=null;renderTrashReview();reviewButton.focus();};reviewNav.append(reviewBack,selectAll);
 const reviewScroll=document.createElement('div');reviewScroll.setAttribute('class','trash-scroll');const reviewHeading=document.createElement('h1');reviewHeading.setAttribute('class','trash-heading');reviewHeading.textContent='Going to Trash';const reviewSubtitle=document.createElement('p');reviewSubtitle.setAttribute('class','trash-subtitle');reviewSubtitle.setAttribute('id','trash-review-subtitle');const reviewGrid=document.createElement('div');reviewGrid.setAttribute('class','trash-grid');reviewGrid.setAttribute('id','trash-review-grid');const reviewHelp=document.createElement('p');reviewHelp.setAttribute('class','trash-help');reviewHelp.textContent='Tap a photo to preview. Untick to keep it. Items stay in Google Photos Trash for 60 days.';const reviewSize=document.createElement('div');reviewSize.setAttribute('class','trash-size');const sizeLabel=document.createElement('small'),sizeValue=document.createElement('span');sizeLabel.textContent='Free up';reviewSize.append(sizeLabel,sizeValue);reviewScroll.append(reviewHeading,reviewSize,reviewSubtitle,reviewGrid,reviewHelp);
 const reviewBar=document.createElement('div');reviewBar.setAttribute('class','trash-bar');const reviewCancel=document.createElement('button');reviewCancel.textContent='Cancel';reviewCancel.onclick=reviewBack.onclick;const reviewStatus=document.createElement('p');reviewStatus.setAttribute('role','status');reviewStatus.setAttribute('class','trash-review-status');reviewStatus.hidden=true;moveTrash.hidden=false;reviewBar.append(reviewCancel,moveTrash);reviewPanel.append(reviewNav,reviewScroll,reviewStatus,reviewBar);
 const settingsReview=document.createElement('button');settingsReview.textContent='Going to Trash';settingsReview.onclick=()=>{closeSettings();openReview();};group('Going to Trash',settingsReview);sheet.append(settingsVersion);
 const orderRow=document.createElement('div'),orderButton=document.createElement('button'),orderLabel=document.createElement('span'),orderMenu=document.createElement('div'),memoryLabel=document.createElement('div');
 orderRow.setAttribute('class','order-row');orderButton.setAttribute('id','order-switcher');orderButton.setAttribute('aria-label','Change review order');orderButton.setAttribute('aria-haspopup','menu');orderMenu.setAttribute('id','order-menu');orderMenu.setAttribute('role','menu');orderMenu.hidden=true;orderButton.append(orderLabel);const hapticSwitch=document.createElement('input');if('switch' in hapticSwitch){hapticSwitch.type='checkbox';hapticSwitch.setAttribute('switch','');hapticSwitch.setAttribute('aria-hidden','true');hapticSwitch.tabIndex=-1;hapticSwitch.style.cssText='position:absolute;inset:0;width:100%;height:100%;opacity:0;margin:0;cursor:pointer';orderButton.append(hapticSwitch);}orderRow.append(orderButton,orderMenu);cardElement.parentNode.insertBefore(orderRow,cardElement);memoryLabel.setAttribute('class','memory-label');const memoryDate=document.createElement('span'),memoryPlace=document.createElement('span'),memoryPosition=document.createElement('span');memoryPlace.setAttribute('class','memory-place');memoryLabel.append(memoryDate,memoryPlace,memoryPosition);topCard.append(memoryLabel);
 function updateOrder(){const order=reviewOrders.find(order=>order[0]===sortElement.value)||reviewOrders[0];orderLabel.textContent=`${order[2]} ${order[1]}`;orderButton.setAttribute('aria-expanded',String(!orderMenu.hidden));for(const button of orderMenu.childNodes)button.setAttribute('aria-checked',String(button.dataset.order===sortElement.value));}
 function chooseOrder(value){if(busy||otherTab||leaseError||inspected||!sheet.hidden||!reviewPanel.hidden)return;const key=current()?.mediaKey;sortElement.value=value;focused=key||null;inspected=null;deckItems=null;orderMenu.hidden=true;buffer.clear();updateOrder();if(!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)orderLabel.animate?.([{transform:'translateY(100%)',opacity:0},{transform:'translateY(0)',opacity:1}],{duration:200});window.navigator?.vibrate?.(10);render();}
 for(const [value,name,icon] of reviewOrders){const button=document.createElement('button');button.dataset.order=value;button.setAttribute('role','menuitemradio');button.textContent=`${icon} ${name}`;button.onclick=()=>chooseOrder(value);orderMenu.append(button);}
 let orderTimer=null,longPressed=false;
 const cancelOrderPress=()=>{window.clearTimeout(orderTimer);orderTimer=null;};
 orderButton.addEventListener('pointerdown',event=>{if(event.button!==0)return;longPressed=false;orderTimer=window.setTimeout(()=>{longPressed=true;orderMenu.hidden=false;updateOrder();},500);});
 for(const type of ['pointerup','pointercancel','pointerleave'])orderButton.addEventListener(type,cancelOrderPress);
 orderButton.onclick=()=>{cancelOrderPress();if(longPressed){longPressed=false;return;}if(!orderMenu.hidden){orderMenu.hidden=true;updateOrder();return;}chooseOrder(reviewOrders[(reviewOrders.findIndex(order=>order[0]===sortElement.value)+1)%reviewOrders.length][0]);};
 orderButton.addEventListener('contextmenu',event=>{event.preventDefault();cancelOrderPress();longPressed=true;orderMenu.hidden=false;updateOrder();});
 overlayElement.addEventListener('pointerdown',event=>{if(!orderRow.contains(event.target)){orderMenu.hidden=true;updateOrder();}});
 orderRow.addEventListener('keydown',event=>{if(event.key==='Escape'){orderMenu.hidden=true;updateOrder();orderButton.focus();}if(event.key==='ArrowDown'){event.preventDefault();orderMenu.hidden=false;updateOrder();orderMenu.childNodes[0].focus();}});
 const orderStyle=document.createElement('style');orderStyle.textContent='.order-row{position:relative;flex:none;align-self:center;margin:10px 0 12px;z-index:3}.order-row>button{display:flex;align-items:center;border-radius:999px;min-height:44px;padding:8px 18px;background:var(--ps-surface);border:1px solid var(--ps-sep);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);overflow:hidden;font-weight:600}.order-row span{display:block;white-space:nowrap}.order-row span::first-letter{color:var(--ps-accent)}#order-menu{position:absolute;top:calc(100% + 8px);left:50%;transform:translateX(-50%);width:240px;border-radius:18px;background:var(--ps-surface-solid);border:1px solid var(--ps-sep);overflow:hidden;box-shadow:0 10px 30px var(--ps-shadow-color)}#order-menu button{display:block;width:100%;text-align:left;background:none;border-radius:0;border-bottom:1px solid var(--ps-sep)}#order-menu button::before{content:"";display:inline-block;width:20px}#order-menu button[aria-checked=true]{color:var(--ps-accent)}#order-menu button[aria-checked=true]::before{content:"✓"}.memory-label{display:flex;max-width:calc(100% - 72px);box-sizing:border-box;white-space:nowrap;position:absolute;top:16px;left:16px;z-index:2;pointer-events:none;border-radius:999px;background:rgba(30,30,30,.6);color:#fff;padding:8px 14px;font:600 15px/20px var(--ps-font);backdrop-filter:blur(20px)}.memory-label[hidden]{display:none}.memory-label>span{flex:none;white-space:pre}.memory-label>.memory-place{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}';root.append(orderStyle);
 let reviewItems=[],previewKey=null,reviewSignature='',previewVideo=null,previewGeneration=0,pageLock=null,resumeReviewPlayback=false;
 function lockPage(){
  if(pageLock)return;
  const viewport=document.querySelector('meta[name="viewport"]'),created=!viewport,meta=viewport||document.createElement('meta');
  pageLock={html:document.documentElement.style.cssText,body:document.body.style.cssText,x:window.scrollX,y:window.scrollY,meta,content:meta.getAttribute('content'),created};
  if(created){meta.setAttribute('name','viewport');document.head.append(meta);}
  meta.setAttribute('content',`${(pageLock.content||'width=device-width, initial-scale=1').replace(/,?\s*viewport-fit\s*=\s*[^,\s]+/gi,'')}, viewport-fit=cover`);
  document.documentElement.style.overflow='hidden';document.documentElement.style.overscrollBehavior='none';Object.assign(document.body.style,{overflow:'hidden',overscrollBehavior:'none',position:'fixed',top:`-${pageLock.y}px`,left:`-${pageLock.x}px`,width:'100%'});
 }
 function unlockPage(){if(!pageLock)return;const saved=pageLock;pageLock=null;document.documentElement.style.cssText=saved.html;document.body.style.cssText=saved.body;if(saved.created)saved.meta.remove();else if(saved.content===null)saved.meta.removeAttribute('content');else saved.meta.setAttribute('content',saved.content);window.scrollTo(saved.x,saved.y);}
 const $=id=>root.getElementById(id);
 let resume={},resumeWrite=Promise.resolve(),videoSavedAt=0;
 let dbPromise,db,state=emptyReview(),identity,busy=false,inspected=null,focused=null,shown=null,generation=0,leaseError=null,leaseRecoveryPending=false,lockedAccount=null,syncEnabled=false,syncSummary='Sync off · saved locally';
 const database=()=>dbPromise||(dbPromise=openReviewDatabase(environment.indexedDB).catch(error=>{dbPromise=null;throw error;}));
 const pairingNotice=document.createElement('p');settingsPanel.append(pairingNotice);
 const pairingPromise=createPairingStore({GM:environment.GM,database,crypto:environment.crypto}).then(async store=>{

  try{await store.settings();}catch(error){pairingNotice.textContent=`Sync storage unavailable: ${error.message}`;}
  return store;
 });
 const accountMismatch=document.createElement('p');accountMismatch.hidden=true;divElement4.insertBefore(accountMismatch,cardElement);
 const googleSignIn=document.createElement('button');googleSignIn.setAttribute('id','google-sign-in');googleSignIn.textContent='Sign in with Google';onboarding.append(googleSignIn);
 const googleSettings=document.createElement('button');googleSettings.setAttribute('id','google-settings');settingsPanel.append(googleSettings);
 const googleSignOut=document.createElement('button');googleSignOut.setAttribute('id','google-sign-out');googleSignOut.textContent='Sign out';settingsPanel.append(googleSignOut);
 const storageDetails=document.createElement('div');const storageTitle=document.createElement('h3');storageTitle.textContent='What we store';storageDetails.append(storageTitle);
 for(const text of ["Your Google account email and Google account ID, to link your devices to one sync space.","Each Keep/Remove decision, keyed by Google Photos' internal item ID, with when and from which device it was made.","Your review queue and undo history: item IDs plus the details the app already shows (such as dates, type, and Google's own thumbnail link). The link only works for your signed-in Google account.","Each device's name (like \"Chrome on Mac\") and a hashed sign-in token. Pending sign-ins expire after 5 minutes.","No photos or videos, no image files, and no Google password or Google access token are ever stored."]){const paragraph=document.createElement('p');paragraph.textContent=text;storageDetails.append(paragraph);}settingsPanel.append(storageDetails);
 const showSyncAccount=settings=>{const signedIn=!!(settings.token&&settings.email);pairingNotice.textContent=signedIn?'Sync account: '+settings.email:settings.token?'Sign in with Google to link your existing sync progress.':'';googleSettings.textContent=signedIn?'Switch account':'Sign in with Google';googleSignOut.hidden=!signedIn;syncLocal.hidden=signedIn;accountMismatch.hidden=!signedIn||!identity?.label||identity.label===settings.email.toLowerCase();accountMismatch.textContent=accountMismatch.hidden?'':'This device syncs as '+settings.email+'; Photos is showing '+identity.label+'. Switch account in Settings.';};
 showSyncAccount({});
 googleSignOut.onclick=()=>run(async()=>{cancelGoogleSignIn?.();await syncRunning;const store=await pairingPromise,settings=await store.settings();await store.saveSettings({...settings,token:'',email:'',onboardingDismissed:true});syncEnabled=false;syncClient.configure({});showSyncAccount({});message('Signed out · progress saved locally');});
 const signInGoogle=async(resumeState)=>{
  if(cancelGoogleSignIn||googleSignIn.disabled||googleSettings.disabled)return;
  openSettings();googleSignIn.disabled=true;googleSettings.disabled=true;
  const gm=environment.GM,origin='https://photoswiper-sync.sidlakkoju.workers.dev';
  let popup,timer,deadline,cancelled=false,rejectStop,navigating=false,claimCode=resumeState?.code;
  const receiveCode=event=>{if(!popup||event.origin!==origin||event.source!==popup||event.data?.type!=='photos-swipe-google-sign-in'||event.data.state!==activeState||!/^[A-Za-z0-9_-]{43}$/.test(event.data.code||''))return;claimCode=event.data.code;};
  let activeState;
  window.addEventListener?.('message',receiveCode);
  const stopped=new Promise((resolve,reject)=>{rejectStop=reject;});stopped.catch(()=>{});
  const stop=reason=>{cancelled=true;rejectStop(Error(reason));};
  cancelGoogleSignIn=()=>stop('Sign-in cancelled');
  const cancel=document.createElement('button');cancel.id='google-sign-in-cancel';cancel.textContent='Cancel';cancel.onclick=cancelGoogleSignIn;
  const privateRequest=(path,value,token)=>new Promise((resolve,reject)=>{gm.xmlHttpRequest({method:'POST',url:origin+path,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},data:JSON.stringify(value),timeout:10000,onload:response=>{try{resolve({status:response.status,value:JSON.parse(response.responseText)});}catch(error){reject(error);}},onerror:()=>reject(Error('Sign-in request failed')),ontimeout:()=>reject(Error('Sign-in request timed out'))});});
  const wait=promise=>Promise.race([promise,stopped]);
  try{
   if(typeof gm?.xmlHttpRequest!=='function')throw Error('Google sync requires private userscript storage and GM.xmlHttpRequest.');
   const ios=/iPhone|iPad|iPod/.test(window.navigator?.userAgent||'')||(window.navigator?.platform==='MacIntel'&&window.navigator?.maxTouchPoints>1);

   pairingNotice.textContent=resumeState?'Completing Google sign-in…':'Opening Google sign-in…';pairingNotice.append(cancel);
   deadline=environment.setTimeout(()=>stop('Google sign-in timed out. Please try again.'),300000);
   const store=await wait(pairingPromise);
   if(!store.durable)throw Error('Google sync requires private userscript storage and GM.xmlHttpRequest.');
   const state=resumeState?.state||btoa(String.fromCharCode(...environment.crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
   const claimSecret=resumeState?.claimSecret||btoa(String.fromCharCode(...environment.crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
   activeState=state;
   await wait(gm.setValue('photos-swipe-google-state',state));
   await wait(gm.setValue('photos-swipe-google-claim-secret',claimSecret));
   const previous=await wait(store.settings());
   if(!resumeState){
    const session=await wait(privateRequest('/auth/session',{state,automatic:true,claimSecret,name:ios?'iPhone (Safari)':'Browser',platform:window.navigator?.platform||'browser',loginHint:identity?.label||'',sourceScope:identity?.account||'default'},previous.token));
    if(session.status!==200)throw Error('Could not start Google sign-in');
    const target=new URL(session.value.url);
    target.searchParams.set('return',location.href);
    await wait(writes.flush());if(writes.pending)throw Error('Local changes could not be saved. Please retry sign-in after saving.');
    try{window.location.href=target.href;navigating=true;return;}catch{}
    target.searchParams.delete('return');
    popup=window.open?.(target.href,'_blank','popup,width=560,height=700')||gm.openInTab?.(target.href,{active:true});
    if(!popup)throw Error('Could not open Google sign-in. Please try again.');
    pairingNotice.textContent='Sign-in page opened. Waiting for Google sign-in…';pairingNotice.append(cancel);
   }
   let claim;
   while(!cancelled){
    if(!resumeState)await wait(new Promise(resolve=>{timer=environment.setTimeout(resolve,2000);}));
    resumeState=null;
    if(sheet.hidden)throw Error('Sign-in cancelled');
    if(await wait(gm.getValue('photos-swipe-google-state'))!==state)throw Error('Sign-in cancelled');
    try{claim=await wait(privateRequest('/auth/poll',{state,claimSecret,...(claimCode?{code:claimCode}:{})},previous.token));}catch(error){if(cancelled)throw error;continue;}
    if(claim.status===400||claim.status===401)throw Error('Google sign-in failed. Please try again.');
    if(claim.status!==200)continue;
    if(claim.value.status==='done')break;
    if(claim.value.status!=='pending')throw Error(claim.value.error||(claim.value.status==='expired'?'Google sign-in timed out. Please try again.':'Google sign-in failed. Please try again.'));
   }
   const {status,...credentials}=claim.value;
   await wait(syncRunning);
   await wait(store.saveSettings({url:origin,...credentials,onboardingDismissed:true}));
   syncClient.configure({url:origin,...credentials});syncEnabled=true;onboarding.hidden=true;syncLocal.hidden=true;showSyncAccount(credentials);await synchronize();
  }catch(error){pairingNotice.textContent=error.message;}finally{
   window.removeEventListener?.('message',receiveCode);
   environment.clearTimeout(timer);environment.clearTimeout(deadline);cancel.hidden=true;
   try{popup?.close();}catch{}
   try{if(!navigating){await gm?.deleteValue('photos-swipe-google-state');await gm?.deleteValue('photos-swipe-google-claim-secret');}}catch{}finally{if(!navigating){cancelGoogleSignIn=null;googleSignIn.disabled=false;googleSettings.disabled=false;}}
  }
 };
 googleSignIn.onclick=()=>signInGoogle();googleSettings.onclick=()=>signInGoogle();
 const resumeGoogleSignIn=async()=>{try{
  const target=new URL(location.href),fragment=new URLSearchParams(target.hash.slice(1)),state=fragment.get('photos-swipe-state'),code=fragment.get('photos-swipe-code');
  if(fragment.has('photos-swipe-code')){target.hash=fragment.get('photos-swipe-return-hash')||'';window.history?.replaceState(null,'',target.href);}
  const stored=await environment.GM?.getValue('photos-swipe-google-state');
  if(/^[A-Za-z0-9_-]{43}$/.test(stored||''))await signInGoogle({state:stored,claimSecret:await environment.GM.getValue('photos-swipe-google-claim-secret'),...(state===stored&&/^[A-Za-z0-9_-]{43}$/.test(code||'')?{code}:{})});
  else if(stored){await environment.GM.deleteValue('photos-swipe-google-state');pairingNotice.textContent='Google sign-in failed. Please try again.';}
 }catch(error){pairingNotice.textContent=error.message;}};
 const clearCredentials=async()=>{const store=await pairingPromise,settings=await store.settings();await store.saveSettings({...settings,token:'',email:'',unpaired:true});syncEnabled=false;showSyncAccount({});};
 const syncClient=createSyncClient({fetch:environment.syncFetch||environment.fetch,unpaired:clearCredentials,status:value=>{syncSummary=value;syncStatus.textContent=value;const failed=/saved locally; retry|unpaired/i.test(value);gear.classList.toggle('gear-error',failed);gear.setAttribute('aria-label',failed?'Settings · sync error':'Settings');if(failed)message(value);}});
 const googleSignInResumed=resumeGoogleSignIn();
 let pageActive=true,suspendingPromise=null,resumeOpening=false;
 let sessionClosing=false;
 let leaseTimer,syncTimer,openingPromise=null,closingPromise=null,activeOperation=null,syncRunning=null,decisionCount=0,writeRevision=0,leaseTicks=0,writeConflict=null,leaseGeneration=0,acquiringAccount=null,otherTab=false,takeoverPending=false;
 const useHere=document.createElement('button');useHere.setAttribute('id','use-here');useHere.textContent='Use here';useHere.hidden=true;useHere.onclick=()=>open(true);
 const createWrites=()=>createWriteQueue({snapshot:()=>({...state,revision:writeRevision}),write:async next=>{await assertSaveAccount();if(writeConflict)throw writeConflict;if(leaseError)throw leaseError;return db.save(identity.account,next);},committed:(saved,value,duration)=>{if(window.localStorage?.psDebug==='1')window.console?.table({persistenceMs:duration});writeRevision=saved.revision;state={...state,revision:writeRevision};persistedItems=value.items;while(refreshedItems.has(persistedItems))persistedItems=refreshedItems.get(persistedItems);if(state.items===persistedItems)persistResume();},error:error=>{if(error.message.includes('Progress changed in another tab'))writeConflict=error;message(leaseError?leaseError.message:writeConflict?'Local save conflict. Unsaved decisions remain visible. Reload the page to read the other tab’s progress; unsaved decisions will be lost.':`Local save failed: ${error.message} · pending changes will retry.`);}});
 const refreshedItems=new WeakMap();
 let writes=createWrites(),persistedItems=null;
 const synchronize=(pull=true)=>{
  if(!identity||!syncEnabled||otherTab||leaseError||writeConflict||leaseRecoveryPending||!lockedAccount)return Promise.resolve();
  if(syncRunning)return syncRunning.then(()=>synchronize(pull));
  const account=identity.account,token=leaseGeneration;let version;
  syncRunning=(async()=>{
   await writes.flush();if(writes.pending)return;
   if(!await renewLease())return;
   if(token!==leaseGeneration||otherTab||leaseError||writeConflict||lockedAccount!==account||identity?.account!==account)return;
   version=state;
   const next=await syncClient.sync(account,version,async value=>value,{pull,rebuild:next=>rebuildSyncedReview(next,call)});
   if(token!==leaseGeneration||leaseRecoveryPending)return;
   await refreshLease();
   if(token===leaseGeneration&&!otherTab&&!leaseError&&identity?.account===account&&next!==version){
    state={...mergeSyncResult(state,version,next),revision:writeRevision};
    await writes.enqueue();render();
   }
  })().finally(()=>{syncRunning=null;});
  return syncRunning;
 };
 function scheduleSync(){
  if(!syncEnabled||sessionClosing||otherTab)return;
  window.clearTimeout(syncTimer);
  if(++decisionCount>=10&&!busy&&!activeOperation){decisionCount=0;synchronize(false);}
  else syncTimer=window.setTimeout(()=>{decisionCount=0;if(!busy&&!activeOperation)synchronize(false);},2000);
  syncTimer?.unref?.();
 }
 function apply(next,removedKey){state=markSyncChanges(state,next);if(removedKey&&deckCache){deckCache=deckCache.filter(item=>item.mediaKey!==removedKey);deckItems=state.items;}render();writes.enqueue();scheduleSync();}
 const readyMessage=()=>gear.classList.contains('gear-error')?syncSummary:'';
 const idleMessage=()=>state.job?'A saved album operation is ready to retry.':readyMessage();
 const message=value=>{$('status').textContent=otherTab?'Open in another tab':value;reviewStatus.textContent=reviewPanel.hidden?'':value;reviewStatus.hidden=!reviewStatus.textContent;useHere.hidden=!(otherTab||leaseError?.message.includes('busy in another tab'));if(!useHere.hidden)showLockCard();};
 function persistResume(){if(otherTab||!identity||!db||state.items!==persistedItems)return;const account=identity.account,item=current();resume={...resume,currentId:item?.mediaKey||null,inspected:!!inspected,filter:$('filter').value,sort:$('sort').value,reviewEvery:Number(reviewEvery.value)||25,deleteMethod:deleteMethod.value};const value=structuredClone(resume);resumeWrite=resumeWrite.catch(()=>{}).then(()=>db.saveResume(account,value)).catch(error=>message(`Could not save resume: ${error.message}`));}
 function captureVideo(){const video=$('media').querySelector('video');if(video&&video.dataset.resumeReady!=='pending'&&shown&&Number.isFinite(video.currentTime)){resume={...resume,video:{key:shown,time:video.currentTime}};persistResume();}}
 async function call(operation,args={}) {
  if(!pageVisible())throw sessionChanged();
  if(leaseError)throw leaseError;
  const token=leaseGeneration;
  const result=await rawCall(operation,{...args,...(identity?{account:identity.account}:{})});
  if(!result.ok)throw Error(result.error);
  if(!pageVisible()||token!==leaseGeneration)throw sessionChanged();
  if(leaseError)throw leaseError;
  return result.data;
 }
 const pageVisible=()=>pageActive&&!document.hidden;
 const sessionChanged=()=>Error('Session changed. Close and reopen Photos Swipe.');
 function stopSync(){window.clearTimeout(syncTimer);syncTimer=null;}
 function stopRenewal(){clearInterval(leaseTimer);leaseTimer=null;}
 function releaseLease(){
  leaseGeneration++;
  stopRenewal();
  const account=lockedAccount||acquiringAccount;lockedAccount=null;acquiringAccount=null;
  return account?db.lease(account,owner,true).then(()=>notifyTabs(account)).catch(()=>{}):Promise.resolve();
 }
 async function assertAccount(){
  const token=leaseGeneration,account=identity?.account;
  if(!account)throw Error('Close and reopen Photos Swipe after signing into Google Photos.');
  const response=await rawCall('identity');
  if(token!==leaseGeneration||account!==identity?.account)throw sessionChanged();
  if(!response.ok)throw Error(response.error);
  if(response.data.account!==account){
   leaseError=Error('Google account changed. Close and reopen Photos Swipe.');
   releaseLease();message(leaseError.message);throw leaseError;
  }
 }
 function assertLockedAccount(){if(!lockedAccount||lockedAccount!==identity?.account)throw sessionChanged();}
 async function assertSaveAccount(){
  assertLockedAccount();
  await assertAccount();
  try{await db.lease(identity.account,owner);}catch(error){lockedAccount=null;leaseError=error;startRenewal();message(error.message);throw error;}
  assertLockedAccount();
 }
 async function save(next){await syncRunning;await assertSaveAccount();state=markSyncChanges(state,next);await writes.enqueue();if(writes.pending)throw leaseError||Error('Local changes have not been saved.');return state;}
 function controls(){for(const button of root.querySelectorAll('button,select'))if(!['close','launcher','pair-submit','google-sign-in','google-settings','google-sign-in-cancel'].includes(button.id))button.disabled=busy||!identity||(otherTab&&button!==useHere)||(button.id==='undo'&&!historyView().nextUndo)||(button.id==='move-trash'&&!reviewRows().some(item=>item.decision==='remove'))||(!syncEnabled&&['refresh-devices','revoke-other-devices'].includes(button.id));$('overlay').setAttribute('aria-busy',String(busy));}
 function startRenewal(){
  if(leaseTimer||sessionClosing||!pageVisible()||$('overlay').hidden)return;
  leaseTimer=setInterval(()=>refreshLease(),LEASE_HEARTBEAT_MS);
  leaseTimer?.unref?.();
 }
 function pauseForOtherTab(){
  if(!sheet.hidden)closeSettings();reviewPanel.hidden=true;previewKey=null;resumeReviewPlayback=false;renderTrashReview();$('close').focus();
  leaseGeneration++;cancelLibraryFill();stopSync();libraryFailure=null;otherTab=true;acquiringAccount=null;swipeFeedback.reset();leaseError=Error('Open in another tab');lockedAccount=null;stopRenewal();startRenewal();message(leaseError.message);controls();
 }
 const hasLocalChanges=()=>activeOperation||writes.pending||state.items!==persistedItems;
 async function renewLease(takeover=false,claim=false){
  await ownerReady;
  const token=leaseGeneration,account=identity?.account;
  const sessionCurrent=()=>token===leaseGeneration&&!otherTab&&account===identity?.account;
  if(!account||otherTab||!pageVisible())return false;
  try{
   await assertAccount();
   if(!sessionCurrent())return false;
   acquiringAccount=account;
   let lease=await db.lease(account,owner,false,takeover||!!leaseError||hasLocalChanges(),claim);
   if(!sessionCurrent())return false;
   if(lease.owner!==owner&&hasLocalChanges())lease=await db.lease(account,owner,false,true);
   if(!sessionCurrent())return false;
   if(lease.owner!==owner){pauseForOtherTab();return false;}
   const acquired=lockedAccount!==account;lockedAccount=account;leaseError=null;startRenewal();if(acquired)notifyTabs(account);return true;
  }catch(error){
   if(token===leaseGeneration){lockedAccount=null;leaseError=error;message(error.message);startRenewal();}
   return false;
  }finally{if(token===leaseGeneration)acquiringAccount=null;}
 }
 async function refreshLease(){
  await suspendingPromise;
  if(sessionClosing||!pageVisible()||$('overlay').hidden)return;
  if(otherTab){const lease=await db.readLease(identity.account);if(!busy&&!openingPromise&&(!lease||lease.expires<=Date.now()))await open();return;}
  const token=leaseGeneration,recovering=leaseRecoveryPending||!!leaseError;
  const account=identity?.account;
  if(!account)return;
  if(recovering)leaseRecoveryPending=true;
  if(!await renewLease()||token!==leaseGeneration)return;
  if(recovering){if(busy||activeOperation||syncRunning||closingPromise||$('overlay').hidden)return;await open();return;}
  if(!busy&&!activeOperation&&!syncRunning){writes.flush();refill();}
  if(syncEnabled&&!busy&&!activeOperation&&!syncRunning&&!$('overlay').hidden)synchronize();
 }
 async function withAccountLease(task) {
  if(!await renewLease(true))throw leaseError||sessionChanged();
  await writes.flush();if(writes.pending)throw Error('Save pending local changes before this operation.');
  await task();scheduleSync();
 }
 async function run(task) {
  if(busy||activeOperation)return;
  activeOperation=(async()=>{
   try {
    db=await database();
    await libraryLoading;await syncRunning;
    busy=true;controls();
    await assertAccount();
    await withAccountLease(task);
   }catch(error){message(error.message);}finally{
    busy=false;render();controls();
   }
  })();
  await activeOperation;activeOperation=null;
 }
 const bytes=value=>value>=1e9?`${(value/1e9).toFixed(1)} GB`:value>=1e6?`${(value/1e6).toFixed(1)} MB`:`${Math.round(value/1e3)} KB`;
 const itemSize=item=>Number.isFinite(item.size)&&item.size>=0?bytes(item.size):'Unknown size';
 const estimate=items=>{const total=reviewStorage(items);return `${bytes(total.bytes)}${total.unknown?` + ${total.unknown} unknown`:''}`;};
 let deckCache=null,deckItems=null,deckFilter=null,deckSort=null;
 function deck(){if(deckItems===state.items&&deckFilter===$('filter').value&&deckSort===$('sort').value)return deckCache;deckItems=state.items;deckFilter=$('filter').value;deckSort=$('sort').value;let items=deckSort==='flashbacks'?flashbackDeck(state,resume.flashbacks||={},Math.random,Date.now(),focused,true):reviewDeck(state);items=items.filter(item=>deckFilter==='all'||item.type===deckFilter);if(deckSort==='oldest')items.sort((a,b)=>new Date(a.date||0)-new Date(b.date||0));if(deckSort==='largest')items.sort((a,b)=>(b.size||0)-(a.size||0));const pinned=state.items.find(item=>item.mediaKey===focused&&!item.needsPreview&&item.state!=='in_trash'&&(!item.decision||keptEligible(item,reviewSwipeCount(state))));if(pinned&&deckSort!=='flashbacks')items=[pinned,...items.filter(item=>item!==pinned)];deckCache=items;return items;}

 function current(){return inspected?state.items.find(item=>item.mediaKey===inspected):deck().find(item=>item.mediaKey===focused)||deck()[0];}
 function mediaURL(value,video=false,expanded=false) {
  if(typeof expanded==='object')return cardPreviewURL(value,{...expanded,authuser:location.pathname.match(/^\/u\/(\d+)/)?.[1]||'0'});
  return previewURL(value,{video,expanded,width:expanded?(window.innerWidth||512):($('media').getBoundingClientRect?.().width||window.innerWidth||512),height:expanded?(window.innerHeight||800):($('media').getBoundingClientRect?.().height||Math.round((window.innerHeight||800)*.48)),dpr:window.devicePixelRatio,mobile:/iPhone|iPad/.test(window.navigator?.userAgent||''),authuser:location.pathname.match(/^\/u\/(\d+)/)?.[1]||'0'});
 }
 const previewOwners=new Map(),loadedPreviews=new Map();
 function rememberPreview(map,key,value){map.delete(key);map.set(key,value);if(map.size>512)map.delete(map.keys().next().value);}
 function previewImage(image=document.createElement('img')){image.addEventListener('load',()=>{const source=image.currentSrc||image.src,owner=previewOwners.get(source);if(owner&&image.naturalWidth>0)rememberPreview(loadedPreviews,owner,source);});return image;}
 function queueThumbnailSource(item){const loaded=loadedPreviews.get(item.thumbUrl);if(loaded)return loaded;const ratio=Number(window.devicePixelRatio),size=Math.ceil(96*Math.min(3,Math.max(1,Number.isFinite(ratio)?ratio:1)));return mediaURL(item.thumbUrl,false,{width:size,height:size});}
 const preloader=createReviewPreloader({createImage:()=>previewImage(),createVideo:()=>document.createElement('video'),videoURL:async mediaKey=>({url:await videoURL(state.items.find(item=>item.mediaKey===mediaKey))}),previewURL:previewSource,playbackURL:url=>mediaURL(url,true)});
 function previewSource(value,size=previewSize()){const source=mediaURL(value,false,size);rememberPreview(previewOwners,source,value);return source;}
 function previewSize(){const {width,height}=$('media').getBoundingClientRect();return {width:width||1,height:height||1,compact:!!window.matchMedia?.('(max-width:760px), (pointer:coarse)').matches};}
 function preloadReview(item){const size=previewSize(),items=reviewPreviewWindow(deck(),item,size.compact).filter(candidate=>candidate.mediaKey===item?.mediaKey||!reviewURLStale(candidate));preloader.update($('overlay').hidden||inspected?[]:items,$('overlay').hidden?null:item,size);}
 function clearPreviewWindow(){const size=previewSize(),items=reviewPreviewWindow(inspected?[]:deck(),current(),size.compact);preloader.clear(items,size);buffer.clear(items);}
 const thumbnails=createLocalThumbnails({refresh:refreshItemURL,stale:reviewURLStale,scope:()=>identity?.account,placeholder:(image,item)=>{const label=document.createElement('span');label.textContent=item.name||'Preview unavailable';label.setAttribute('class','thumbnail-placeholder');label.style.cssText='display:flex;align-items:center;justify-content:center;background:var(--ps-fill);color:var(--ps-label2);width:100%;height:100%;overflow:hidden;font-size:11px';if(image.parentElement===queueThumbs){label.style.width='26px';label.style.height='30px';}image.replaceWith(label);}});
 function queueImage(image,item){return thumbnails.bind(image,item,queueThumbnailSource);}
 const urlRefreshes=new Map();
 async function refreshItemURL(item) {
  const account=identity?.account,key=`${account}:${item.mediaKey}`;
  if(urlRefreshes.has(key))return urlRefreshes.get(key);
  const request=(async()=>{
   const response=await rawCall('mediaURL',{mediaKey:item.mediaKey,account});
   if(!response.ok)throw Error(response.error);
   const result=response.data;mediaURL(result.url);
   if(identity?.account!==account)return item;
   const fresh={...item,thumbUrl:result.url,urlFetchedAt:Date.now()};
   const previousItems=state.items;
   state={...state,items:state.items.map(saved=>saved.mediaKey===item.mediaKey?{...saved,thumbUrl:fresh.thumbUrl,urlFetchedAt:fresh.urlFetchedAt}:saved)};
   refreshedItems.set(previousItems,state.items);
   if(persistedItems===previousItems)persistedItems=state.items;
   return fresh;
  })();
  urlRefreshes.set(key,request);
  try{return await request;}finally{urlRefreshes.delete(key);}
 }
 async function refreshStalePreviews() {
  if($('overlay').hidden||!identity)return;
  const item=current(),account=identity.account;
  const windowItems=reviewPreviewWindow(inspected?[]:deck(),item,previewSize().compact);
  const results=await Promise.allSettled(windowItems.filter(item=>reviewURLStale(item)).map(refreshItemURL));
  if($('overlay').hidden||identity?.account!==account)return;
  if(results.some(result=>result.status==='fulfilled')){clearPreviewWindow();if(current()?.mediaKey===item?.mediaKey)display(current());preloadReview(current());}
 }
  const mobile=/iPhone|iPad/.test(window.navigator?.userAgent||'');
 const smallBuffer=mobile||window.navigator?.deviceMemory<=4||window.navigator?.connection?.saveData;
 let previousKey=null,swipeAt=null,idlePending=false;
 const metrics={paint:[],hits:0,misses:0};
 const buffer=createPreloadBuffer({size:smallBuffer?2:3,load:(item,signal)=>new Promise((resolve,reject)=>{
  const image=previewImage(window.Image?new window.Image():document.createElement('img'));
  const abort=()=>{image.src='';reject(Error('Aborted'));};
  signal.addEventListener('abort',abort,{once:true});
  image.onload=async()=>{try{if(image.decode)await image.decode();signal.removeEventListener('abort',abort);if(!signal.aborted)resolve(image);}catch(error){reject(error);}};
  image.onerror=()=>reject(Error('Preview unavailable'));
  image.src=previewSource(item.thumbUrl);
 })});
 const videoURLs=new Map(),videoRequests=new Map();
 function videoURL(item){
  const account=identity?.account;const cached=videoURLs.get(item.mediaKey);
  if(cached&&Date.now()-cached.fetchedAt<1800000)return Promise.resolve(cached.url);
  const requestKey=`${account}:${item.mediaKey}`;
  if(videoRequests.has(requestKey))return videoRequests.get(requestKey);
  const request=call('video',{mediaKey:item.mediaKey}).then(result=>{const url=mediaURL(result.url,true);if(identity?.account===account){videoURLs.set(item.mediaKey,{url,fetchedAt:Date.now()});if(videoURLs.size>32)videoURLs.delete(videoURLs.keys().next().value);}return url;}).finally(()=>{videoRequests.delete(requestKey);});
  videoRequests.set(requestKey,request);
  return request;
 }
 let libraryLoading=null,libraryFailure=null,cancelLibraryLoading=null;
 function cancelLibraryFill(){cancelLibraryLoading?.();cancelLibraryLoading=null;libraryLoading=null;}
 function fillLibrary(){
  if(libraryLoading||libraryFailure||sessionClosing||closingPromise||busy||leaseError||leaseRecoveryPending||!pageVisible()||!lockedAccount||!identity||!state.started||state.exhausted||($('sort').value!=='flashbacks'&&reviewDeck(state).length>10)||$('overlay').hidden)return;
  const token=leaseGeneration;
  let cancel;
  const cancelled=new Promise((resolve,reject)=>{cancel=()=>reject(Error('Library loading session changed.'));});
  cancelLibraryLoading=cancel;
  const loading=load(false,cancelled).catch(error=>{if(token!==leaseGeneration||sessionClosing||!pageVisible())return;libraryFailure=error;deckItems=null;message(`Library loading failed: ${error.message}. Retry Load more.`);}).finally(()=>{if(libraryLoading!==loading)return;libraryLoading=null;cancelLibraryLoading=null;render();});
  libraryLoading=loading;
 }
 function refill(){
  if(idlePending||!window.Image||$('overlay').hidden)return;
  idlePending=true;
  const idle=window.requestIdleCallback?.bind(window)||((task)=>window.setTimeout(task,0));
  idle(()=>{
   idlePending=false;if($('overlay').hidden)return;
   const upcoming=deck().filter(item=>item.mediaKey!==shown&&!reviewURLStale(item)).slice(0,smallBuffer?2:3);
   buffer.update(smallBuffer&&previousKey?upcoming.slice(0,1):upcoming,previousKey);
  });
 }
 function painted(media,token){
  if(token!==generation||swipeAt===null)return;
  const finish=()=>{if(token!==generation||swipeAt===null)return;window.performance?.mark('painted');metrics.paint.push(window.performance.now()-swipeAt);swipeAt=null;
   if(window.localStorage?.psDebug==='1'){const times=[...metrics.paint].sort((a,b)=>a-b);window.console?.table({p50:times[Math.floor(times.length*.5)],p95:times[Math.min(times.length-1,Math.floor(times.length*.95))],bufferHitRate:metrics.hits/(metrics.hits+metrics.misses)});}
  };
  (window.requestAnimationFrame?.bind(window)||((task)=>window.setTimeout(task,0)))(finish);
 }
 function dropWarmVideo(){preloader.cancelVideos();}
 function stopMedia(clearUnderCard=true){captureVideo();swipeFeedback.reset();if(clearUnderCard){underCard.replaceChildren();underCard.hidden=true;}generation++;const image=$('media').querySelector('img');const old=state.items.find(item=>item.mediaKey===shown);if(image&&old&&image.complete&&image.naturalWidth)buffer.retain(old,image);const video=$('media').querySelector('video');if(video){video.pause();video.removeAttribute('src');video.load();}$('media').replaceChildren();shown=null;}
 function showLockCard(){
  stopMedia();
  const card=document.createElement('div'),title=document.createElement('p');
  card.setAttribute('class','tab-lock-card');card.style.padding='24px';title.textContent='Open in another tab';useHere.hidden=false;card.append(title,useHere);$('media').replaceChildren(card);
 }
 async function display(item,retried=false,forceRefresh=false) {
  const preview=underCard.querySelector('img'),preloaded=preview?.dataset?.key===item?.mediaKey?preview:null;
  stopMedia(shown!==(item?.mediaKey||null));$('zoom').value='1';$('card').classList.remove('zoomed');mediaElement.style.touchAction='';shown=item?.mediaKey||null;const token=generation;
  $('media').style.color='var(--ps-label)';$('media').setAttribute('aria-busy','false');
  if(otherTab||leaseError?.message.includes('busy in another tab')){showLockCard();return;}
  if(!item){$('media').textContent=$('sort').value==='flashbacks'&&state.started&&!state.exhausted&&!libraryFailure?'Loading more items…':'No items to review. Load more or refresh latest.';return;}
  let handlingError=false;
  const failed=async()=>{
   if(token!==generation||handlingError)return;
   handlingError=true;
   const video=$('media').querySelector('video');if(video){video.pause();video.removeAttribute('src');video.load();}
   $('media').setAttribute('aria-busy','false');$('media').replaceChildren();
   if(!retried){$('media').textContent='Refreshing preview…';try{const fresh=await refreshItemURL(item);if(token===generation){clearPreviewWindow();videoURLs.delete(item.mediaKey);dropWarmVideo();display(fresh,true);preloadReview(fresh);}return;}catch{}}
   if(token!==generation)return;
   const label=document.createElement('p'),retry=document.createElement('button');
   label.textContent='Preview unavailable.';retry.textContent='Retry';retry.onclick=()=>display(current(),false,true);
   $('media').replaceChildren(label,retry);
  };
  try {
   if(forceRefresh||reviewURLStale(item)){
    $('media').textContent='Refreshing preview…';
    try{item=await refreshItemURL(item);if(forceRefresh)retried=true;}catch{if(forceRefresh){retried=true;await failed();return;}}
    if(token!==generation)return;
    $('media').replaceChildren();
   }
   const source=previewSource(item.thumbUrl);const buffered=!retried&&!forceRefresh?buffer.take(item.mediaKey):null;const cached=!retried&&!forceRefresh?(reusablePreview(buffered,source)||reusablePreview(preloaded,source)||preloader.take(item.mediaKey,source)):null;const warmed=item.type==='video'&&!retried&&!forceRefresh?preloader.takeVideo(item.mediaKey):null;const media=item.type==='video'?(warmed||document.createElement('video')):(cached||previewImage());if(cached||warmed)metrics.hits++;else metrics.misses++;
   media.onerror=failed;
   if(item.type==='video'){const savedTime=resume.video?.key===item.mediaKey?resume.video.time:0;media.dataset.resumeReady='pending';media.addEventListener('loadedmetadata',()=>{if(token!==generation)return;restoreVideoTime(media,savedTime);});media.addEventListener('timeupdate',()=>{if(Date.now()-videoSavedAt>=1000){videoSavedAt=Date.now();captureVideo();}});media.addEventListener('pause',captureVideo);if(media.readyState>=1)restoreVideoTime(media,savedTime);
    media.controls=false;media.muted=true;media.loop=true;media.playsInline=true;media.preload='metadata';media.poster=previewSource(item.thumbUrl);
    const poster=cached||previewImage();poster.alt=item.name;poster.setAttribute('class','video-poster');poster.style.width='';poster.style.maxWidth='100%';poster.style.maxHeight='100%';
    poster.onload=()=>painted(poster,token);if(!cached)poster.src=media.poster;
    media.hidden=true;$('media').replaceChildren(poster,media);addVideoControls(media);$('media').setAttribute('aria-busy','true');
    if(poster.complete&&poster.naturalWidth)painted(poster,token);
    const started=window.performance?.now();
    media.oncanplay=()=>{if(token===generation)$('media').setAttribute('aria-busy','false');};
    media.onloadeddata=()=>{
     if(token!==generation)return;
     media.hidden=false;$('media').replaceChildren(media);addVideoControls(media);painted(media,token);
     if(window.localStorage?.psDebug==='1')window.console?.table({videoFirstFrameMs:window.performance.now()-started});
    };
    if(retried||forceRefresh)videoURLs.delete(item.mediaKey);const url=await videoURL(item);if(token!==generation)return;
    if(media.src!==url)media.src=url;media.play().catch(()=>{});
    if(media.readyState>=2)media.onloadeddata();
   }
   else {media.style.maxWidth='100%';media.style.maxHeight='100%';media.style.width='';media.style.touchAction='';media.alt=item.name;media.draggable=false;media.hidden=true;media.onload=()=>{if(token===generation){media.hidden=false;$('media').setAttribute('aria-busy','false');painted(media,token);}};$('media').append(media);const reused=!!cached;$('media').setAttribute('aria-busy',String(!reused));if(!reused)media.src=source;if(reused&&media.complete){if(media.naturalWidth>0){media.hidden=false;$('media').setAttribute('aria-busy','false');painted(media,token);}else await failed();}}
  }catch{await failed();}
 }
 function updateVideoControls(){
  const video=mediaElement.querySelector('video');
  if(video)video.controls=false;
  for(const button of mediaElement.childNodes)if(button.dataset?.videoControl)button.hidden=false;
 }
 function addVideoControls(video){
  for(const action of ['play','mute']){
   const button=document.createElement('button');button.dataset.videoControl=action;
   button.textContent=action==='play'?(video.paused?'Play':'Pause'):'Unmute';
   button.style.cssText=`position:absolute;bottom:12px;${action==='play'?'left':'right'}:12px;z-index:2`;
   button.addEventListener('pointerdown',event=>event.stopPropagation());
   button.onclick=()=>{if(action==='play'){if(video.paused)video.play().catch(()=>{});else video.pause();button.textContent=video.paused?'Play':'Pause';}else{video.muted=!video.muted;button.textContent=video.muted?'Unmute':'Mute';}};
   if(action==='play')for(const type of ['play','pause'])video.addEventListener(type,()=>{button.textContent=video.paused?'Play':'Pause';});
   mediaElement.append(button);
  }
  for(const control of createVideoTimeline({document,video,onSeek:captureVideo}))mediaElement.append(control);
  updateVideoControls();
 }
 let renderedHistory='';
 queue_detailsElement.addEventListener('toggle',()=>render());historyPanel.addEventListener('toggle',()=>render());
 function historyView(){
  const entries=[...(state.history||[])].reverse(),nextUndo=entries.find(entry=>canUndoReview(state,entry));
  const decisionLabel=value=>value==='remove'?'Queue':value==='keep'?'Keep':'Unreviewed';
  const historyLabel=entry=>`${state.items.find(item=>item.mediaKey===entry.key)?.name||entry.key} · ${decisionLabel(entry.previous)} → ${decisionLabel(entry.decision)}`;
  return {entries,nextUndo,historyLabel,decisionLabel};
 }
 function renderCard(){
  const item=current();
  $('caption').textContent=item?`${inspected?'Candidate inspection · ':''}${item.name} · ${item.date?new Date(item.date).toLocaleDateString():'Unknown date'} · ${itemSize(item)}`:(reviewDeck(state).length&&(!state.started||state.exhausted||$('sort').value!=='flashbacks')?'No items match this filter.':state.exhausted?"You’ve reviewed everything":libraryFailure?'Library loading failed. Retry Load more.':'Loading more items…');
  if(!$('overlay').hidden&&(shown!==(item?.mediaKey||null)||!$('media').childNodes.length))display(item);
 }
 function renderStats(){
  const queue=reviewQueue(state),candidates=reviewTrashCandidates(state);
  lifetime.textContent=estimate(state.items.filter(item=>item.state==='in_trash'&&item.decision==='remove'));
  storageCapsule.update(storageSession.total(state.items));queueSize.textContent='· '+formatStorageBytes(reviewStorage(candidates).bytes);trashBadge.textContent=String(candidates.length);queuePill.hidden=candidates.length<25;queuePillText.textContent=`${candidates.length} going to Trash`;queueGrowth.hidden=candidates.length<=25;queueGrowth.textContent=`+${candidates.length-25}`;queueThumbs.replaceChildren();for(const item of candidates.slice(-3)){const image=document.createElement('img');image.alt='';queueImage(image,item);queueThumbs.append(image);}
  $('stats').textContent=`${deck().length} to review · ${state.items.filter(item=>item.decision).length}/${state.items.length} reviewed · Queue: ${queue.length} (estimated savings: ${estimate(queue)}) · In Trash: ${estimate(state.items.filter(item=>item.decision==='remove'&&item.state==='in_trash'))} (running total)`;
  const {nextUndo,historyLabel,decisionLabel}=historyView();
  undoPreview.textContent=nextUndo?`Next Undo: ${historyLabel(nextUndo)}; restores ${decisionLabel(nextUndo.previous)}.`:'No previous decisions can be undone.';
  $('undo').title=undoPreview.textContent;$('undo').setAttribute('aria-describedby','undo-preview');
$('remove').setAttribute('aria-label',inspected?'Back to review':'Mark for deletion');$('keep').setAttribute('aria-label',inspected?'Keep instead':'Keep');
  $('send').textContent='Finish previous transfer';$('send').parentElement.hidden=!state.job;
  $('album').hidden=!state.albumKey;if(state.albumKey)$('album').href=`https://photos.google.com/u/${location.pathname.match(/^\/u\/(\d+)/)?.[1]||'0'}/album/${encodeURIComponent(state.albumKey)}`;
 }
 function reviewRows(){const items=new Map(state.items.map(item=>[item.mediaKey,item]));return reviewItems.filter(saved=>items.has(saved.mediaKey)).map(saved=>({...saved,...items.get(saved.mediaKey)})).filter(item=>item.state!=='in_trash'&&!item.needsPreview);}
 function decideWithHistory(current,item,decision){
  return recordReviewDecision(current,item,decision);
 }
 function selectTrashItem(key,selected){
  if(busy||!identity||leaseError)return;
  const item=state.items.find(item=>item.mediaKey===key);if(!item||item.state==='in_trash')return;
  const decision=selected?'remove':'keep';if(item.decision===decision)return;
  try{apply(decideWithHistory(state,item,decision));}catch(error){message(error.message);}
 }
 selectAll.onclick=()=>{if(busy||!identity||leaseError)return;try{let next=state;for(const item of reviewRows())if(item.decision!=='remove')next=decideWithHistory(next,item,'remove');apply(next);}catch(error){message(error.message);}};
 function renderTrashReview(){
  if(reviewPanel.hidden){if(resumeReviewPlayback&&!overlayElement.hidden){mediaElement.querySelector('video')?.play().catch(()=>{});resumeReviewPlayback=false;}previewGeneration++;if(previewVideo){previewVideo.pause();previewVideo.removeAttribute('src');previewVideo.load();previewVideo=null;}reviewSignature='';return;}
  const rows=reviewRows(),selected=rows.filter(item=>item.decision==='remove');
  sizeValue.textContent=estimate(selected);reviewSubtitle.textContent=`${selected.length} of ${rows.length} selected · ${estimate(selected)}`;moveTrash.textContent=`Move ${selected.length} to Trash`;moveTrash.disabled=busy||!identity||!selected.length;
  const signature=JSON.stringify([previewKey,rows.map(item=>[item.mediaKey,item.decision,item.thumbUrl,item.name,item.state])]);if(signature===reviewSignature)return;reviewSignature=signature;
  reviewGrid.replaceChildren();
  for(const item of rows){
   const tile=document.createElement('div');tile.setAttribute('class',`trash-tile${item.decision==='remove'?'':' kept'}`);
   const photo=document.createElement('button'),image=document.createElement('img');photo.setAttribute('class','trash-photo');photo.setAttribute('aria-label',`Preview ${item.name}`);image.alt=item.name;image.loading='lazy';thumbnails.bind(image,item,fresh=>mediaURL(fresh.thumbUrl));photo.append(image);photo.onclick=()=>{if(busy)return;previewKey=item.mediaKey;renderTrashReview();};
   const check=document.createElement('button');check.setAttribute('class','trash-check');icon(check,`Keep ${item.name}`,['M5 12l4 4L19 6']);check.setAttribute('aria-label',`${item.decision==='remove'?'Keep':'Trash'} ${item.name}`);check.setAttribute('aria-pressed',String(item.decision==='remove'));check.onclick=()=>{selectTrashItem(item.mediaKey,item.decision!=='remove');[...reviewGrid.querySelectorAll('.trash-check')].find(button=>button.dataset.key===item.mediaKey)?.focus();};check.dataset.key=item.mediaKey;tile.append(photo,check);
   if(item.type==='video'){const duration=document.createElement('span');duration.setAttribute('class','trash-duration');duration.textContent=`▶ ${videoDuration(item)}`;tile.append(duration);}
   if(item.legacy){const legacy=document.createElement('span');legacy.setAttribute('class','trash-legacy');legacy.textContent='Previously marked';tile.append(legacy);}
   reviewGrid.append(tile);
  }
  reviewPanel.querySelector('.trash-preview')?.remove();previewGeneration++;if(previewVideo){previewVideo.pause();previewVideo.removeAttribute('src');previewVideo.load();previewVideo=null;}
  const item=rows.find(item=>item.mediaKey===previewKey);if(!item){previewKey=null;return;}
  const preview=document.createElement('section');preview.setAttribute('class','trash-preview');preview.setAttribute('id','trash-preview');preview.setAttribute('role','dialog');preview.setAttribute('aria-label',`Preview ${item.name}`);const nav=document.createElement('div');nav.setAttribute('class','trash-nav');const back=document.createElement('button'),position=document.createElement('span'),done=document.createElement('button');back.textContent='‹ Going to Trash';position.textContent=`${rows.indexOf(item)+1} of ${rows.length}`;done.textContent='Done';back.onclick=done.onclick=()=>{previewKey=null;renderTrashReview();};nav.append(back,position,done);
  const media=document.createElement('div');media.setAttribute('class','trash-preview-media');const image=document.createElement(item.type==='video'?'video':'img');if(item.type==='video'){image.controls=true;image.playsInline=true;previewVideo=image;const token=previewGeneration;const poster=document.createElement('img');poster.alt=item.name;media.append(poster);thumbnails.bind(poster,item,fresh=>previewSource(fresh.thumbUrl),{retryLookup:true});const loaded=poster.onload;poster.onload=()=>{loaded();if(token===previewGeneration){image.poster=poster.src;poster.hidden=true;}};videoURL(item).then(url=>{if(token===previewGeneration)image.src=url;}).catch(error=>message(error.message));}else{image.alt=item.name;thumbnails.bind(image,item,fresh=>previewSource(fresh.thumbUrl));}media.append(image);
  const caption=document.createElement('div'),details=document.createElement('small');caption.setAttribute('class','trash-preview-caption');caption.textContent=item.name;details.textContent=[item.date?new Date(item.date).toLocaleDateString():'Unknown date',item.type==='video'?videoDuration(item):null,itemSize(item),item.legacy?'Previously marked':null].filter(Boolean).join(' · ');caption.append(details);
  const strip=document.createElement('div');strip.setAttribute('class','trash-strip');for(const row of rows){const button=document.createElement('button'),thumb=document.createElement('img');button.setAttribute('class',row.mediaKey===previewKey?'active':'');button.setAttribute('aria-label',`Preview ${row.name}`);thumb.alt='';thumbnails.bind(thumb,row,fresh=>mediaURL(fresh.thumbUrl));button.append(thumb);button.onclick=()=>{previewKey=row.mediaKey;renderTrashReview();};strip.append(button);}
  const bar=document.createElement('div');bar.setAttribute('class','trash-bar');const keep=document.createElement('button'),trash=document.createElement('button');keep.textContent='Keep';trash.textContent='Trash';trash.setAttribute('class','preview-trash');keep.setAttribute('aria-pressed',String(item.decision==='keep'));trash.setAttribute('aria-pressed',String(item.decision==='remove'));keep.onclick=()=>selectTrashItem(item.mediaKey,false);trash.onclick=()=>selectTrashItem(item.mediaKey,true);bar.append(keep,trash);preview.append(nav,media,caption,strip,bar);reviewPanel.append(preview);done.focus();
 }
 function videoDuration(item){const seconds=Math.max(0,Math.floor((Number(item.duration)||0)/1000));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;}
 function renderLists(){
  const queue=reviewQueue(state),candidates=reviewTrashCandidates(state);
  const {entries,nextUndo,historyLabel}=historyView();
  if(historyPanel.open){
  const historyRows=entries.slice(0,100).map(entry=>`${historyLabel(entry)} · ID: ${entry.key}${entry===nextUndo?' · Next Undo':canUndoReview(state,entry)?'':' · Unavailable for Undo'}`);
  if(entries.length>100)historyRows.push(`Showing the latest 100 of ${entries.length} decisions.`);
  if(!entries.length)historyRows.push('No decisions yet.');
  const historySignature=JSON.stringify(historyRows);
  if(historySignature!==renderedHistory){
   renderedHistory=historySignature;historyList.replaceChildren();
   for(const text of historyRows){const row=document.createElement('li');row.textContent=text;historyList.append(row);}
  }
  }
  renderTrashReview();
 }

 function render(){
  updateOrder();renderCard();const item=current();memoryLabel.hidden=!item||$('sort').value!=='flashbacks';
  const memory=item?reviewMemories(state.items.filter(row=>!row.needsPreview&&row.state!=='in_trash')).find(group=>group.some(row=>row.mediaKey===item.mediaKey)):null;
  const place=typeof item?.locationName==='string'?item.locationName.trim():'';
  memoryDate.textContent=item?.date?new Date(item.date).toLocaleDateString(undefined,{month:'long',year:'numeric'}):'Unknown date';memoryPlace.textContent=place?` · ${place}`:'';memoryPlace.hidden=!place;memoryPlace.title=place;memoryPosition.textContent=memory?` · ${memory.findIndex(row=>row.mediaKey===item.mediaKey)+1} of ${memory.length}`:'';
  const next=inspected||$('card').classList.contains('expanded')?null:deck().find(candidate=>candidate.mediaKey!==item?.mediaKey);
  if(next&&underCard.querySelector('img')?.dataset?.key!==next.mediaKey){try{const preview=previewImage();preview.dataset.key=next.mediaKey;preview.alt='';preview.draggable=false;preview.src=previewSource(next.thumbUrl);underCard.replaceChildren(preview);}catch{underCard.replaceChildren();}}
  if(!next)underCard.replaceChildren();underCard.hidden=!next;
  preloadReview(item);
  renderStats();controls();renderLists();refill();fillLibrary();
  if(identity&&!$('overlay').hidden)persistResume();
 }
 let cardAnimation=null;
 function finishCardAnimation(){if(cardAnimation)cardAnimation.finish();}
 function clearCardAnimation(){if(cardAnimation){cardAnimation.cancel();cardAnimation=null;}$('card').style.visibility='';}
 async function animateCard(decision){
  clearCardAnimation();
  if(!$('card').animate||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
  const side=decision==='keep'?1:-1,center={transform:'translateX(0) rotate(0deg)',opacity:1},edge={transform:`translateX(${side*120}vw) rotate(${side*18}deg)`,opacity:0};
  $('undo').querySelector('svg')?.animate?.([{transform:'rotate(-45deg)'},{transform:'rotate(0)'}],{duration:350,easing:'cubic-bezier(.34,1.56,.64,1)'});
  const animation=$('card').animate([edge,center],{duration:350,easing:'cubic-bezier(.34,1.56,.64,1)',fill:'forwards'});cardAnimation=animation;
  let timer;
  try{await Promise.race([animation.finished,new Promise(resolve=>{timer=window.setTimeout(()=>{animation.finish();resolve();},350);})]);}catch{}finally{window.clearTimeout(timer);}
 }
 async function openSession(claim=false) {
  const requestedGeneration=leaseGeneration;
  if(closingPromise){await closingPromise;if(requestedGeneration!==leaseGeneration)return;}
  await suspendingPromise;
  if(busy||!pageVisible())return;
  const token=++leaseGeneration;
  cancelLibraryFill();stopSync();stopRenewal();libraryFailure=null;otherTab=false;useHere.hidden=true;
  await resumeWrite;preloader.clear();busy=true;controls();$('overlay').hidden=false;lockPage();$('launcher').hidden=true;buffer.clear();await syncRunning;
  try{
   await googleSignInResumed;
   const result=await rawCall('identity');
   if(token!==leaseGeneration)return;
   if(!result.ok)throw Error(result.error);
   const changed=identity?.account!==result.data.account;
   if(changed){
    await releaseLease();
    await writes.flush();writes=createWrites();writeConflict=null;leaseError=null;
    inspected=null;focused=null;clearMedia();videoURLs.clear();previousKey=null;
   }
   identity=result.data;$('account').textContent=identity.label;db=await database();
   let settings={},settingsError;try{settings=await (await pairingPromise).settings();}catch(error){settingsError=error;}
   syncEnabled=!!(settings.url&&settings.token);syncClient.configure(settings);
   settingsPanel.open=true;onboarding.hidden=syncEnabled||!!settings.onboardingDismissed;
   showSyncAccount(settings);if(settingsError)pairingNotice.textContent=`Sync storage unavailable: ${settingsError.message}`;
   if(!await renewLease(true,claim))return;
   const sessionGeneration=leaseGeneration;
   if(!changed){
    await writes.flush();
    if(writes.pending){if(!writeConflict)message('Local changes are still pending. Close and reopen to retry saving.');return;}
   }
   $('close').focus();message('Reading local progress…');
   state=await db.read(identity.account);writeRevision=state.revision;persistedItems=state.items;
   resume=await db.resume(identity.account);$('filter').value=resume.filter||'all';$('sort').value=resume.sort||'flashbacks';reviewEvery.value=String(resume.reviewEvery||25);deleteMethod.value='trash';trashOptIn.checked=true;focused=resume.currentId||null;inspected=resume.inspected&&state.items.some(item=>item.mediaKey===focused)?focused:null;const missing=focused&&!state.items.some(item=>item.mediaKey===focused&&item.state==='active');if(missing){focused=null;inspected=null;}
   if(syncEnabled)await synchronize();
   if(!pageVisible()||sessionGeneration!==leaseGeneration)return;
   leaseRecoveryPending=false;takeoverPending=false;
   message(missing?'Saved item is unavailable. Continuing with the next unreviewed item.':idleMessage());
  }catch(error){
   await releaseLease();identity=null;state=emptyReview();stopMedia();buffer.clear();message(error.message);
  }finally{busy=false;render();controls();}
 }
 function open(claim=false){
  takeoverPending=takeoverPending||claim;
  if(openingPromise)return openingPromise;
  openingPromise=openSession(takeoverPending).then(()=>{refreshStalePreviews();}).finally(()=>{openingPromise=null;if(resumeOpening){resumeOpening=false;if(pageVisible()&&!$('overlay').hidden&&!closingPromise)open();}});
  return openingPromise;
 }
 async function closeSession(){
  takeoverPending=false;sessionClosing=true;cancelLibraryFill();stopRenewal();stopSync();
  captureVideo();persistResume();if(!sheet.hidden)suppressViewerShortcuts();sheet.hidden=true;resumeReviewPlayback=false;
  preloader.clear();finishCardAnimation();clearCardAnimation();await openingPromise;await activeOperation;await libraryLoading;await writes.flush();
  leaseGeneration++;stopRenewal();
  $('overlay').hidden=true;unlockPage();reviewPanel.hidden=true;previewKey=null;renderTrashReview();$('launcher').hidden=false;$('launcher').focus();
  clearMedia();
  await openingPromise;await activeOperation;
  $('overlay').hidden=true;unlockPage();reviewPanel.hidden=true;previewKey=null;renderTrashReview();$('launcher').hidden=false;clearMedia();
  try{
   if(!otherTab&&(!identity||await renewLease())){
    await writes.flush();
    await synchronize(false);
   }
  }finally{
   await releaseLease();
  }
  buffer.clear();
 }
 function close(){
  if(closingPromise)return closingPromise;
  closingPromise=closeSession().finally(()=>{sessionClosing=false;closingPromise=null;});
  return closingPromise;
 }
 function decide(decision){
  if(busy||otherTab||!identity||leaseError||$('overlay').hidden||!reviewPanel.hidden||!sheet.hidden)return;
  if(inspected&&decision==='remove'){inspected=null;render();return;}
  const item=current();if(!item)return;
  try{
  swipeFeedback.dismiss(decision);window.performance?.mark('swipe');swipeAt=window.performance?.now()??null;const previous=item.decision,next=decideWithHistory(state,item,decision);if($('sort').value==='flashbacks'){const memory=resume.flashbacks||={};memory.seen=[...(memory.seen||[]),item.mediaKey];}inspected=null;focused=null;previousKey=item.mediaKey;if(decision==='remove'&&previous!=='remove')storageCapsule.update(storageSession.total(next.items),{animate:true,delta:reviewStorage([item]).bytes});apply(next,item.mediaKey);message([decision==='remove'?'Added to the local removal queue.':`Kept ${item.name}.`,readyMessage()].filter(Boolean).join(' '));
  }catch(error){message(error.message);}
 }
 async function undo(){if(busy||otherTab||!identity||leaseError||$('overlay').hidden||!reviewPanel.hidden||!sheet.hidden)return;try{const history=structuredClone(state.history||[]);while(history.length&&!canUndoReview(state,history.at(-1)))history.pop();const last=history.pop();if(!last){message('No previous decisions can be undone.');return;}if(resume.flashbacks){resume.flashbacks.seen=(resume.flashbacks.seen||[]).filter(key=>key!==last.key);}const next=decideReview(state,last.key,last.previous,last.decision,last.revision);if(last.cooldown)next.items=next.items.map(item=>item.mediaKey===last.key?{...item,...last.cooldown}:item);const previous=[...history].reverse().find(entry=>entry.key===last.key);const restored=next.items.find(item=>item.mediaKey===last.key);if(previous&&previous.revision===last.revision-1){const revisionOffset=restored.revision-previous.revision;for(const entry of history)if(entry.key===last.key)entry.revision+=revisionOffset;}inspected=null;focused=restored.decision===null?last.key:null;apply({...next,history});await animateCard(last.decision);clearCardAnimation();message([`Last swipe undone for ${restored.name}.`,readyMessage()].filter(Boolean).join(' '));}catch(error){message(error.message);}}
 async function loadRequested(refresh=false){
  let cancel;
  const cancelled=new Promise((resolve,reject)=>{cancel=()=>reject(Error('Library loading session changed.'));});
  cancelLibraryLoading=cancel;
  try{await load(refresh,cancelled,$('sort').value==='flashbacks'?1:Infinity);}finally{if(cancelLibraryLoading===cancel)cancelLibraryLoading=null;}
 }
 async function load(refresh=false,cancelled=null,maxPages=Infinity) {
  const token=leaseGeneration;
  const assertLoadSession=()=>{if(token!==leaseGeneration||(cancelled&&sessionClosing))throw Error('Library loading session changed.');};
  const loadCall=async(operation,args)=>{assertLoadSession();const request=call(operation,args);const result=await (cancelled?Promise.race([request,cancelled]):request);assertLoadSession();return result;};
  buffer.clear();previousKey=null;
  libraryFailure=null;deckItems=null;
  const savePage=async(next,page,cursor,refresh)=>{assertLoadSession();await syncRunning;assertLoadSession();await assertSaveAccount();assertLoadSession();if($('sort').value==='flashbacks'&&!inspected)focused=shown||focused;state=markSyncChanges(state,mergeReviewPage(state,page,cursor,refresh));render();await writes.enqueue();if(writes.pending)throw leaseError||Error('Local changes have not been saved.');return state;};
  let result;
  try{result=await loadReviewPages({read:async()=>state,save:savePage,call:loadCall,refresh,maxPages,target:$('sort').value==='flashbacks'?Infinity:50,progress:scanned=>message(`Loading library · ${scanned} rows checked…`)});}catch(error){if(token===leaseGeneration&&!sessionClosing&&pageVisible()){if($('sort').value==='flashbacks'&&!inspected)focused=shown||focused;libraryFailure=error;deckItems=null;}throw error;}
  assertLoadSession();
  message(`${result.added} new items to review · ${result.scanned} library rows checked${result.exhausted?' · End of library':''}${result.warning?'. '+result.warning:''}`);
 }

 mediaElement.addEventListener('wheel',event=>{if(!$('card').classList.contains('expanded'))return;event.preventDefault();$('zoom').value=String(Math.max(1,Math.min(3,Number($('zoom').value)+(event.deltaY<0?.25:-.25))));$('zoom').oninput();},{passive:false});
 function toggleEnlarge(){swipeFeedback.reset();const before=$('card').getBoundingClientRect?.();const expanded=$('card').classList.toggle('expanded');updateVideoControls();if($('enlarge').setAttribute)$('enlarge').setAttribute('aria-label',expanded?'Exit fullscreen':'Fullscreen photo');if($('card').animate&&!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)$('card').animate([{transform:before?`translate(${before.left-$('card').getBoundingClientRect().left}px,${before.top-$('card').getBoundingClientRect().top}px) scale(${before.width/$('card').getBoundingClientRect().width},${before.height/$('card').getBoundingClientRect().height})`:'scale(.92)',transformOrigin:'top left'},{transform:'none',transformOrigin:'top left'}],{duration:350,easing:'cubic-bezier(.34,1.56,.64,1)'});refreshPreviews();}
 function refreshPreviews(){const next=underCard.querySelector('img'),candidate=state.items.find(item=>item.mediaKey===next?.dataset?.key);if(candidate)next.src=previewSource(candidate.thumbUrl);if($('overlay').hidden)return;const item=current(),media=$('media').querySelector('img')||$('media').querySelector('video');if(item&&item.mediaKey===shown&&media?.tagName===(item.type==='video'?'VIDEO':'IMG')){const url=previewSource(item.thumbUrl);if(item.type==='video')media.poster=url;else media.src=url;}preloadReview(item);}
 window.addEventListener('resize',refreshPreviews);
 $('sync-local').onclick=()=>run(async()=>{const settings=await (await pairingPromise).settings();await (await pairingPromise).saveSettings({...settings,onboardingDismissed:true});onboarding.hidden=true;closeSettings();message(idleMessage());});

 $('launcher').onclick=()=>open();$('close').onclick=close;$('keep').onclick=()=>decide('keep');$('remove').onclick=()=>decide('remove');$('undo').onclick=undo;$('load').onclick=()=>run(()=>loadRequested());$('refresh').onclick=()=>run(()=>loadRequested(true));$('enlarge').onclick=toggleEnlarge;
 reviewEvery.onchange=deleteMethod.onchange=()=>{trashOptIn.checked=deleteMethod.value==='trash';persistResume();render();};
 $('filter').onchange=()=>{inspected=null;focused=null;deckItems=null;buffer.clear();render();};
 $('sort').onchange=()=>{focused=shown||null;inspected=null;deckItems=null;buffer.clear();updateOrder();render();};
 $('zoom').oninput=()=>{swipeFeedback.reset();mediaElement.style.touchAction=Number($('zoom').value)>1?'pan-x pan-y pinch-zoom':'';const image=$('media').querySelector('img');if(image){$('card').classList.toggle('zoomed',Number($('zoom').value)>1);image.style.maxWidth='none';image.style.maxHeight='none';image.style.width=`${Number($('zoom').value)*100}%`;image.style.touchAction=Number($('zoom').value)>1?'pan-x pan-y pinch-zoom':'';}};
 $('send').onclick=()=>{if(busy)return;const confirmedKeys=[...(state.job?.mediaKeys||reviewQueue(state).map(item=>item.mediaKey))];const count=confirmedKeys.length;if(!count){message('The removal queue is empty.');return;}if(!window.confirm(`Add ${count} candidates to a private review album? This does not delete media.`))return;run(async()=>{const keys=state.job?.mediaKeys||reviewQueue(state).map(item=>item.mediaKey);if(keys.length!==confirmedKeys.length||keys.some(key=>!confirmedKeys.includes(key)))throw Error('The queue changed in another tab. Review it and confirm again.');message('Updating and verifying the review album…');await sendReviewAlbum({read:async()=>state,save,call,title:'Photos Swipe · Review'});inspected=null;message('Every candidate was verified in the review album. Choose Trash in Settings to use this panel, or open the review album to move items manually in Google Photos.');});};
 trashOptIn.onchange=()=>render();
 moveTrash.onclick=()=>{if(busy||reviewPanel.hidden||!trashOptIn.checked)return;const candidates=reviewRows().filter(item=>item.decision==='remove'),keys=candidates.map(item=>item.mediaKey);if(!keys.length){message('No candidates to move to Trash.');return;}if(!window.confirm(`Move exactly ${keys.length} items to Google Photos Trash?\n\nItems stay in Google Photos Trash for 60 days.`))return;run(async()=>{if(state.job)throw Error('Finish the saved album operation before moving items to Trash.');const currentKeys=reviewRows().filter(item=>item.decision==='remove').map(item=>item.mediaKey);if(currentKeys.length!==keys.length||currentKeys.some(key=>!keys.includes(key)))throw Error('Candidates changed. Review the item list and confirm again.');if(state.items.some(item=>keys.includes(item.mediaKey)&&!item.dedupKey))throw Error('Missing Trash identifiers. Refresh latest before retrying.');for(let index=0;index<keys.length;index+=25){const batch=keys.slice(index,index+25);if(syncEnabled){await synchronize();if(!(await syncClient.trashCheck(identity.account,batch)).safe)throw Error('Sync decisions changed. Review candidates before moving to Trash.');}await call('moveToTrash',{dedupKeys:state.items.filter(item=>batch.includes(item.mediaKey)).map(item=>item.dedupKey),confirmed:true});await save(await reconcileReviewTrash(state,call));if(state.items.some(item=>batch.includes(item.mediaKey)&&item.state!=='in_trash'))throw Error('Trash move was not verified. Check deleted items before retrying.');}storageSession.reset(state.items.filter(item=>item.state==='in_trash'||keys.includes(item.mediaKey)));storageCapsule.reset();reviewItems=reviewItems.filter(item=>!keys.includes(item.mediaKey));previewKey=null;renderTrashReview();message(`Verified ${keys.length} items in Trash.`);});};
 $('trash').onclick=()=>run(async()=>{message('Reading Google Photos Trash…');await save(await reconcileReviewTrash(state,call));message('Trash check complete. Unknown results leave local state unchanged.');});
 for(const target of [launcherElement,overlayElement])for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','touchstart','touchmove','touchend','touchcancel','wheel','mousedown','mouseup'])target.addEventListener(type,event=>event.stopPropagation());
 for(const type of ['keydown','keyup','keypress'])overlayElement.addEventListener(type,event=>event.stopPropagation());
 launcherElement.addEventListener('click',event=>event.stopPropagation());
 const swipeFeedback=createSwipeFeedback({window,targets:[$('media'),$('swipe')],card:topCard,under:underCard,keep:stamps[0],remove:stamps[1],canSwipe:()=>!!current()&&!busy&&!otherTab&&!leaseError&&reviewPanel.hidden&&sheet.hidden&&!inspected&&!$('overlay').hidden&&Number($('zoom').value)<=1,onDecide:decide,playbackOnClick:true});
 $('overlay').addEventListener('dragstart',event=>event.preventDefault());
 $('media').addEventListener('dblclick',event=>{if(event.target.tagName!=='VIDEO')toggleEnlarge();});
 function suspendPage(){
  pageActive=false;leaseRecoveryPending=true;
  stopRenewal();
  if(suspendingPromise)return suspendingPromise;
  const releasing=releaseLease();
  if(!writes.pending&&!writes.flushing)return releasing;
  suspendingPromise=Promise.all([releasing,writes.flush()]).finally(()=>{suspendingPromise=null;});
  return suspendingPromise;
 }
 async function resumeLease(){
  await suspendingPromise;await activeOperation;await syncRunning;
  if(takeoverPending&&pageVisible()&&!closingPromise)return open(true);
  if(!leaseRecoveryPending)await refreshLease();
  await libraryLoading;
  if(!pageVisible()||!identity||$('overlay').hidden||closingPromise)return;
  startRenewal();await refreshLease();refreshStalePreviews();
 }
 function clearMedia(){stopMedia();dropWarmVideo();buffer.clear();window.clearTimeout(syncTimer);}
 function leavePage(){
  const releasing=suspendPage();
  clearMedia();return releasing;
 }
 if(tabChannel)tabChannel.onmessage=async({data})=>{if(!identity||data?.account!==identity.account||data.owner===owner||!pageVisible()||$('overlay').hidden)return;try{await refreshLease();}catch{}};
 for(const event of ['pagehide','unload'])window.addEventListener(event,leavePage);
 window.addEventListener('focus',async()=>{if(identity&&!busy&&!activeOperation&&!$('overlay').hidden){await refreshLease();if(!otherTab)await synchronize();}});
 document.addEventListener?.('visibilitychange',()=>{if(document.hidden){captureVideo();suspendPage();clearPreviewWindow();dropWarmVideo();}else{pageActive=true;if(openingPromise&&!$('overlay').hidden)resumeOpening=true;else if(leaseRecoveryPending&&!identity&&!$('overlay').hidden&&!closingPromise)open();if(identity&&!$('overlay').hidden)resumeLease();}});
 window.addEventListener('pageshow',function restorePage(){pageActive=true;if(!document.hidden&&!$('overlay').hidden){if(openingPromise)resumeOpening=true;return open();}});
 function editingFieldFocused(event){
  const editable=element=>['INPUT','SELECT','TEXTAREA'].includes(element?.tagName)||element?.isContentEditable;
  const focused=[document.activeElement,root.activeElement];
  for(let index=0;index<focused.length;index++){const nested=focused[index]?.shadowRoot?.activeElement;if(nested)focused.push(nested);}
  return [...focused,event.target,...(event.composedPath?.()||[])].some(editable);
 }
 function handleViewerSpace(event){
  if(!sheet.hidden||!reviewPanel.hidden)return false;
  if($('overlay').hidden||event.altKey||event.ctrlKey||event.metaKey||event.isComposing||event.key!==' ')return false;
  if(editingFieldFocused(event))return false;
  event.preventDefault();event.stopImmediatePropagation();
  if(Date.now()<viewerShortcutsBlockedUntil)return true;
  const video=$('media').querySelector('video');
  if(video&&event.type==='keydown'&&!event.repeat){if(video.paused)video.play().catch(()=>{});else video.pause();}
  return true;
 }
 window.addEventListener('keyup',handleViewerSpace,true);
 window.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!$('overlay').hidden){event.preventDefault();event.stopImmediatePropagation();if(!sheet.hidden)closeSettings();else if(!reviewPanel.hidden){if(previewKey){previewKey=null;renderTrashReview();}else{reviewPanel.hidden=true;renderTrashReview();reviewButton.focus();}}else if($('card').classList.contains('expanded'))toggleEnlarge();else close();return;}
  if((!sheet.hidden||!reviewPanel.hidden)&&event.key!=='Tab'){event.stopImmediatePropagation();return;}
  if(handleViewerSpace(event))return;
  if($('overlay').hidden||event.altKey||event.ctrlKey||event.metaKey||event.isComposing)return;
  if(event.key==='Tab'){
   const focusable=[...(!sheet.hidden?sheet:!reviewPanel.hidden?(reviewPanel.querySelector('.trash-preview')||reviewPanel):overlayElement).querySelectorAll('button:not(:disabled),select,input,a[href],summary,video[controls]')].filter(element=>element.getClientRects().length);
   const index=focusable.indexOf(root.activeElement),next=event.shiftKey?(index<=0?focusable.length-1:index-1):(index+1)%focusable.length;
   event.preventDefault();event.stopImmediatePropagation();focusable[next]?.focus();return;
  }
  if(Date.now()<viewerShortcutsBlockedUntil||editingFieldFocused(event))return;
  const actions={ArrowLeft:()=>decide('remove'),ArrowRight:()=>decide('keep'),z:undo,Z:undo,f:toggleEnlarge,F:toggleEnlarge,Escape:close};
  if(actions[event.key]){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat||!['ArrowLeft','ArrowRight','z','Z'].includes(event.key))actions[event.key]();}
 },true);
}
