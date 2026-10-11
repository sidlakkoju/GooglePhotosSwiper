import {previewURL,createPreloadBuffer,createWriteQueue} from './userscript-performance.mjs';
import {createSyncClient,markSyncChanges,mergeSyncResult,validateSyncSettings} from './userscript-sync.mjs';
import {createSwipeFeedback} from './userscript-swipe.mjs';
import {createPairingModal,receivePairingLink} from './userscript-pairing.mjs';
import {createReviewPreloader} from './userscript-preload.mjs';
import {createPhotosAPI} from './userscript-api.mjs';
import {emptyReview,reviewDeck,reviewQueue,reviewTrashCandidates,reviewStorage,mergeReviewPage,canUndoReview,decideReview,sendReviewAlbum,reconcileReviewTrash,loadReviewPages} from './userscript-core.mjs';
import {createPairingStore} from './userscript-settings.mjs';
import {openReviewDatabase} from './userscript-db.mjs';
export function mountPhotosSwipe(environment) {
 const {window,document,location}=environment;
 if(window.top!==window||location.origin!=='https://photos.google.com'||document.getElementById('photos-swipe-userscript-host'))return;
 const rawCall=environment.photosCall||createPhotosAPI(environment),owner=environment.crypto.randomUUID();
 const host=document.createElement('div');host.id='photos-swipe-userscript-host';
 host.style.cssText='all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
 const root=host.attachShadow({mode:'open'});
 const styleElement1=document.createElement('style');
 root.append(styleElement1);
 styleElement1.append(document.createTextNode("\n :host{font:16px system-ui;color:#193426}*{box-sizing:border-box}button,select,input{font:inherit}button,a,select{touch-action:manipulation}button{min-height:44px;border:0;border-radius:12px;background:#e3ebdf;color:#193426;padding:10px 16px;cursor:pointer}button:disabled{opacity:.5;cursor:wait}button:focus-visible,a:focus-visible,select:focus-visible{outline:3px solid #0075ff;outline-offset:2px}a{color:#236541}p{margin:8px 0;overflow-wrap:anywhere}[hidden]{display:none!important}\n .launcher{pointer-events:auto;position:absolute;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));background:#245b3d;color:white;box-shadow:0 3px 20px #0005}\n .overlay{pointer-events:auto;position:absolute;inset:0;background:#f4f7f1;overflow:auto;overscroll-behavior:contain;padding:calc(12px + env(safe-area-inset-top)) 12px calc(18px + env(safe-area-inset-bottom))}\n .content{max-width:850px;margin:auto}header,.actions,.toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}header{justify-content:space-between}h1{font-size:22px;margin:0}.account{font-size:13px}.card{margin-top:12px;background:#13281f;border-radius:18px;overflow:hidden;position:relative}.media{height:48vh;height:48dvh;min-height:180px;display:flex;align-items:center;justify-content:center;overflow:auto}.media[aria-busy=true]{background:linear-gradient(110deg,#13281f,#264638,#13281f)}.media[aria-busy=true]::after{content:'Loading…';position:absolute;color:white;background:#13281fcc;padding:8px;border-radius:8px}.media img,.media video{display:block;max-width:100%;max-height:100%;object-fit:contain}.media img{pointer-events:none;touch-action:pan-y pinch-zoom;user-select:none;-webkit-user-drag:none}.card.expanded .media{height:72vh;height:72dvh}.caption{color:white;padding:10px 14px}.swipe{color:white;text-align:center;padding:12px;touch-action:pan-y pinch-zoom;background:#264638}.actions{justify-content:center;margin:12px 0}.keep{background:#245b3d;color:white}.remove{background:#8c3535;color:white}.stats{padding:12px;background:#e3ebdf;border-radius:12px;margin:12px 0}.toolbar{margin:10px 0}select{max-width:100%;min-height:44px;border-radius:8px}details{margin:16px 0}.queue{display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px}.queue button{padding:6px;overflow:hidden}.queue img{width:100%;height:75px;object-fit:cover}.queue span{display:block;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.status{min-height:24px}.zoom-control,.trash-toggle{display:flex;align-items:center;gap:8px;white-space:nowrap}#zoom{width:120px;min-width:0;min-height:44px}.album-controls{background:#f4f7f1} @media(max-width:599px){.overlay{padding-bottom:calc(var(--album-controls-height,240px) + 18px + env(safe-area-inset-bottom))}.actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.actions button{padding:8px}.zoom-control{grid-column:span 2}.zoom-control input{flex:1}.library-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.library-controls>*{width:100%;min-width:0}.album-controls{position:fixed;bottom:0;left:12px;right:12px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;padding:8px 0 calc(8px + env(safe-area-inset-bottom));margin-bottom:0}.album-controls button{padding:8px;font-size:14px;min-width:0;white-space:normal;overflow-wrap:anywhere}.album-controls a,.album-explanation{grid-column:1 / -1;min-width:0}.album-explanation{margin:0;font-size:13px}.trash-toggle{min-height:44px;font-size:14px;white-space:normal;min-width:0}.trash-toggle input{flex-shrink:0}.media{height:32vh;height:32dvh}.stats{font-size:14px;padding:8px}} @media(min-width:800px){.media{height:55vh}.overlay{padding:24px}}\n "));
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
 const topCard=document.createElement('div');topCard.setAttribute('class','top-card');cardElement.append(topCard);topCard.append(mediaElement);
 const underCard=document.createElement('div');underCard.setAttribute('id','next-card');underCard.setAttribute('class','media under-card');underCard.setAttribute('aria-hidden','true');underCard.hidden=true;
 cardElement.insertBefore(underCard,topCard);
 const stamps=['KEEP','REMOVE'].map(label=>{const stamp=document.createElement('span');stamp.setAttribute('class',`swipe-stamp stamp-${label.toLowerCase()}`);stamp.textContent=label;stamp.setAttribute('aria-hidden','true');topCard.append(stamp);return stamp;});
 const feedbackStyles=document.createElement('style');feedbackStyles.textContent='.card{overflow:visible}.top-card{position:relative;z-index:1}.media{position:relative;z-index:1;background:#13281f;border-radius:18px;touch-action:pan-y pinch-zoom;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}.under-card{position:absolute;inset:0 0 auto;z-index:0;pointer-events:none;transform:scale(.94)}.swipe-stamp{position:absolute;top:24px;z-index:2;padding:8px 14px;border:4px solid currentColor;border-radius:8px;font-size:28px;font-weight:800;opacity:0;pointer-events:none}.stamp-keep{left:24px;color:#70ef95;transform:rotate(-12deg)}.stamp-remove{right:24px;color:#ff8989;transform:rotate(12deg)}.card.expanded .media{touch-action:pan-x pan-y pinch-zoom}';root.append(feedbackStyles);
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
 const syncExplanation=document.createElement('p');syncExplanation.textContent='Optional sync shares decisions and undo history between devices. Enter your Worker URL and token, or continue locally on this browser.';settingsPanel.append(syncExplanation);
 const syncLocal=document.createElement('button');syncLocal.setAttribute('id','sync-local');syncLocal.textContent='Continue locally';settingsPanel.append(syncLocal);
 for(const [id,title,type] of [['sync-url','Sync URL','url'],['sync-token','Sync token','password']]){const label=document.createElement('label'),input=document.createElement('input');label.textContent=title+' ';input.setAttribute('id',id);input.type=type;input.autocomplete='off';label.append(input);settingsPanel.append(label);}
 const syncSave=document.createElement('button');syncSave.setAttribute('id','sync-save');syncSave.textContent='Save and sync';settingsPanel.append(syncSave);
 const pairAnother=document.createElement('button');pairAnother.textContent='Pair another device';pairAnother.setAttribute('id','pair-another');settingsPanel.append(pairAnother);
 const pairingModal=createPairingModal({document,parent:root,fetch:environment.syncFetch||environment.fetch,settings:async()=>(await pairingPromise).settings(),setTimeout:environment.setTimeout,clearTimeout:environment.clearTimeout});pairAnother.onclick=pairingModal.open;
 const syncStatus=document.createElement('p');syncStatus.setAttribute('id','sync-status');syncStatus.setAttribute('role','status');divElement4.insertBefore(settingsPanel,cardElement);divElement4.insertBefore(syncStatus,cardElement);
 const unpairedBanner=document.createElement('div');unpairedBanner.setAttribute('id','unpaired-banner');unpairedBanner.setAttribute('role','alert');unpairedBanner.hidden=true;
 const unpairedText=document.createElement('span');unpairedText.textContent='This device was unpaired.';
 const pairAgain=document.createElement('button');pairAgain.setAttribute('id','pair-again');pairAgain.textContent='Pair again';
 const dismissUnpaired=document.createElement('button');dismissUnpaired.setAttribute('id','dismiss-unpaired');dismissUnpaired.textContent='Dismiss';unpairedBanner.append(unpairedText,pairAgain,dismissUnpaired);divElement4.insertBefore(unpairedBanner,cardElement);
 const pairingPanel=document.createElement('details');pairingPanel.setAttribute('id','enter-pairing-code');const pairingTitle=document.createElement('summary');pairingTitle.textContent='Enter pairing code';pairingPanel.append(pairingTitle);
 for(const [id,title] of [['pair-code','Pairing code'],['pair-name','Device name']]){const label=document.createElement('label'),input=document.createElement('input');input.setAttribute('id',id);label.textContent=title;label.append(input);pairingPanel.append(label);}
 const pairSubmit=document.createElement('button');pairSubmit.setAttribute('id','pair-submit');pairSubmit.textContent='Pair and sync';pairingPanel.append(pairSubmit);settingsPanel.append(pairingPanel);
 const devicesPanel=document.createElement('details');devicesPanel.setAttribute('id','paired-devices');const devicesTitle=document.createElement('summary');devicesTitle.textContent='Paired devices';
 const devicesList=document.createElement('div');devicesList.setAttribute('id','devices-list');const refreshDevices=document.createElement('button');refreshDevices.setAttribute('id','refresh-devices');refreshDevices.textContent='Refresh devices';
 const revokeOthers=document.createElement('button');revokeOthers.setAttribute('id','revoke-other-devices');revokeOthers.textContent='Revoke all other devices';devicesPanel.append(devicesTitle,refreshDevices,devicesList,revokeOthers);settingsPanel.append(devicesPanel);
 const pairedNotice=document.createElement('button');pairedNotice.setAttribute('id','paired-notice');pairedNotice.textContent='New device paired · View paired devices';pairedNotice.hidden=true;divElement4.insertBefore(pairedNotice,cardElement);
 const historyPanel=document.createElement('details');historyPanel.setAttribute('id','history-details');
 const historyTitle=document.createElement('summary');historyTitle.textContent='Decision history';
 const undoPreview=document.createElement('p');undoPreview.setAttribute('id','undo-preview');
 const historyList=document.createElement('ol');historyList.setAttribute('id','history-list');
 historyPanel.append(historyTitle,historyList);divElement4.insertBefore(undoPreview,queue_detailsElement);divElement4.insertBefore(historyPanel,queue_detailsElement);
 document.documentElement.append(host);
 const $=id=>root.getElementById(id);
 if(window.ResizeObserver){
  const albumControlsObserver=new window.ResizeObserver(()=>{
   const height=divElement36.getBoundingClientRect().height;
   if(height)overlayElement.style.setProperty('--album-controls-height',`${height}px`);
  });
  albumControlsObserver.observe(divElement36);
 }
 let dbPromise,db,state=emptyReview(),identity,busy=false,inspected=null,focused=null,shown=null,generation=0,leaseError=null,lockedAccount=null,syncEnabled=false,syncSummary='Sync off · saved locally';
 const database=()=>dbPromise||(dbPromise=openReviewDatabase(environment.indexedDB).catch(error=>{dbPromise=null;throw error;}));
 const pairingNotice=document.createElement('p');settingsPanel.append(pairingNotice);
 const pairingPromise=createPairingStore({GM:environment.GM,database,crypto:environment.crypto}).then(async store=>{
  if(!store.durable)pairingNotice.textContent='Pairing may not persist in this browser';
  try{await store.settings();}catch(error){pairingNotice.textContent=`Pairing storage unavailable: ${error.message}`;}
  return store;
 });
 const clearCredentials=async()=>{const settings=await (await pairingPromise).settings();await (await pairingPromise).saveSettings({...settings,token:'',unpaired:true});$('sync-token').value='';syncEnabled=false;unpairedBanner.hidden=false;};
 const syncClient=createSyncClient({fetch:environment.syncFetch||environment.fetch,unpaired:clearCredentials,status:value=>{syncSummary=value;$('sync-status').textContent=value;pairedNotice.hidden=!value.includes('Device paired');}});
 async function showDevices(){
  const result=await syncClient.devices();devicesList.replaceChildren();
  for(const device of result.devices.filter(device=>device.revoked_at==null).sort((a,b)=>b.created_at-a.created_at)){
   const row=document.createElement('div'),label=document.createElement('p'),rename=document.createElement('button'),revoke=document.createElement('button');
   const minutes=Math.max(0,Math.floor((Date.now()/1000-device.last_seen_at)/60));
   label.textContent=`${device.name} · ${device.platform} · Paired ${new Date(device.created_at*1000).toLocaleDateString('en-US',{month:'short',day:'numeric'})} · Last seen ${minutes<1?'just now':`${minutes} min ago`}${device.id===result.deviceId?' · This device':''}${device.is_legacy?' · Legacy shared token · Shared in chat; revoke once your devices are paired.':''}`;
   rename.textContent='Rename';rename.onclick=()=>{const input=document.createElement('input'),submit=document.createElement('button');input.value=device.name;input.maxLength=40;input.setAttribute('aria-label','Device name');submit.textContent='Save name';submit.onclick=()=>run(async()=>{const name=input.value.trim();if(!name||name.length>40||/[\p{Cc}\p{Cf}<>]/u.test(name))throw Error('Enter a plain text name of 1–40 characters.');await syncClient.rename(device.id,name);await showDevices();});row.append(input,submit);rename.disabled=true;};
   revoke.textContent='Revoke';revoke.onclick=()=>{if(window.confirm(`Revoke ${device.name}? It will stop syncing immediately.`))return run(async()=>{await syncClient.revoke(device.id);if(device.id===result.deviceId){await clearCredentials();syncClient.configure({});devicesList.replaceChildren();}else await showDevices();});};row.append(label,rename,revoke);devicesList.append(row);
  }
 }
 refreshDevices.onclick=()=>run(showDevices);devicesPanel.ontoggle=()=>{if(devicesPanel.open&&syncEnabled)return run(showDevices);};
 revokeOthers.onclick=()=>{if(window.confirm('Revoke all other devices? They will stop syncing immediately, including the legacy shared token.'))return run(async()=>{await syncClient.revokeOthers();await showDevices();});};
 pairAgain.onclick=()=>{settingsPanel.open=true;pairingPanel.open=true;$('pair-code').focus();};dismissUnpaired.onclick=()=>{unpairedBanner.hidden=true;};pairedNotice.onclick=()=>{settingsPanel.open=true;devicesPanel.open=true;return run(showDevices);};
 pairSubmit.onclick=()=>run(async()=>{const url=validateSyncSettings($('sync-url').value.trim(),'pairing').url,code=$('pair-code').value.trim(),name=$('pair-name').value.trim();if(!/^\d{6}$/.test(code))throw Error('Enter a six-digit pairing code.');const result=await syncClient.pair(url,code,name,window.navigator?.platform||'Browser');const settings={url,token:result.token,onboardingDismissed:true};await (await pairingPromise).saveSettings(settings);$('sync-token').value='';$('sync-token').placeholder='Leave blank to keep saved token';syncClient.configure(settings);syncEnabled=true;unpairedBanner.hidden=true;pairingPanel.open=false;await synchronize();await showDevices();});
 let leaseTimer,syncTimer,openingPromise=null,closingPromise=null,activeOperation=null,syncRunning=null,decisionCount=0,writeRevision=0,leaseTicks=0,writeConflict=null,leaseGeneration=0,acquiringAccount=null;
 const createWrites=()=>createWriteQueue({snapshot:()=>({...state,revision:writeRevision}),write:async next=>{await assertSaveAccount();if(writeConflict)throw writeConflict;if(leaseError)throw leaseError;return db.save(identity.account,next);},committed:(saved,value,duration)=>{if(window.localStorage?.psDebug==='1')window.console?.table({persistenceMs:duration});writeRevision=saved.revision;state={...state,revision:writeRevision};},error:error=>{if(error.message.includes('Progress changed in another tab'))writeConflict=error;message(writeConflict?'Local save conflict. Unsaved decisions remain visible. Reload the page to read the other tab’s progress; unsaved decisions will be lost.':`Local save failed: ${error.message} · pending changes will retry.`);}});
 let writes=createWrites();
 const synchronize=(pull=true)=>{
  if(!identity||!syncEnabled||leaseError||writeConflict||!lockedAccount)return Promise.resolve();
  if(syncRunning)return syncRunning.then(()=>synchronize(pull));
  const account=identity.account;let version;
  syncRunning=(async()=>{
   await writes.flush();if(writes.pending)return;version=state;
   const next=await syncClient.sync(account,version,async value=>value,{pull});
   if(identity?.account===account&&next!==version){
    state={...mergeSyncResult(state,version,next),revision:writeRevision};
    await writes.enqueue();render();
   }
  })().finally(()=>{syncRunning=null;});
  return syncRunning;
 };
 function scheduleSync(){
  if(!syncEnabled)return;
  window.clearTimeout(syncTimer);
  if(++decisionCount>=10&&!busy&&!activeOperation){decisionCount=0;synchronize(false);}
  else syncTimer=window.setTimeout(()=>{decisionCount=0;if(!busy&&!activeOperation)synchronize(false);},2000);
  syncTimer?.unref?.();
 }
 function apply(next,removedKey){state=markSyncChanges(state,next);if(removedKey&&deckCache){deckCache=deckCache.filter(item=>item.mediaKey!==removedKey);deckItems=state.items;}render();writes.enqueue();scheduleSync();}
 const readyMessage=()=>syncEnabled?`Ready. Decisions are saved locally with sync enabled. ${syncSummary}`:'Ready. Decisions are saved locally on this browser.';
 const idleMessage=()=>state.job?'A saved album operation is ready to retry.':readyMessage();
 const message=value=>{$('status').textContent=value;};
 async function call(operation,args={}) {
  if(leaseError)throw leaseError;
  const result=await rawCall(operation,{...args,...(identity?{account:identity.account}:{})});
  if(!result.ok)throw Error(result.error);
  if(leaseError)throw leaseError;
  return result.data;
 }
 function releaseLease(){
  leaseGeneration++;
  clearInterval(leaseTimer);leaseTimer=null;
  const account=lockedAccount||acquiringAccount;lockedAccount=null;acquiringAccount=null;
  return account?db.lease(account,owner,true).catch(()=>{}):Promise.resolve();
 }
 async function assertAccount(){
  const token=leaseGeneration,account=identity?.account;
  if(!account)throw Error('Close and reopen Photos Swipe after signing into Google Photos.');
  const response=await rawCall('identity');
  if(token!==leaseGeneration||account!==identity?.account)throw Error('Session changed. Close and reopen Photos Swipe.');
  if(!response.ok)throw Error(response.error);
  if(response.data.account!==account){
   leaseError=Error('Google account changed. Close and reopen Photos Swipe.');
   releaseLease();message(leaseError.message);throw leaseError;
  }
 }
 async function assertSaveAccount(){
  if(!lockedAccount||lockedAccount!==identity?.account)throw Error('Session changed. Close and reopen Photos Swipe.');
  await assertAccount();
  if(!lockedAccount||lockedAccount!==identity?.account)throw Error('Session changed. Close and reopen Photos Swipe.');
 }
 async function save(next){await syncRunning;await assertSaveAccount();state=markSyncChanges(state,next);await writes.enqueue();if(writes.pending)throw leaseError||Error('Local changes have not been saved.');return state;}
 function controls(){for(const button of root.querySelectorAll('button,select'))if(!['close','launcher'].includes(button.id)&&!pairingModal.modal.contains(button)&&!receivingPanel?.contains(button))button.disabled=busy||!identity||(!syncEnabled&&['refresh-devices','revoke-other-devices'].includes(button.id));$('overlay').setAttribute('aria-busy',String(busy));}
 function startRenewal(){
  if(leaseTimer)return;
  leaseTimer=setInterval(()=>{refreshLease();},20000);
  leaseTimer?.unref?.();
 }
 async function renewLease(){
  const token=leaseGeneration,account=identity?.account;
  if(!account)return false;
  try{
   await assertAccount();
   if(token!==leaseGeneration||account!==identity?.account)return false;
   acquiringAccount=account;
   await db.lease(account,owner);
   if(token!==leaseGeneration||account!==identity?.account)return false;
   lockedAccount=account;leaseError=null;startRenewal();return true;
  }catch(error){
   if(token===leaseGeneration){leaseError=error;message(error.message);}
   return false;
  }finally{if(token===leaseGeneration)acquiringAccount=null;}
 }
 async function refreshLease(){
  const token=leaseGeneration;
  if(!await renewLease()||token!==leaseGeneration)return;
  writes.flush();refill();
  if(++leaseTicks%3===0&&syncEnabled&&!busy&&!activeOperation&&!$('overlay').hidden)synchronize();
 }
 async function recoverLease(){
  if(!identity)return true;
  if(!leaseError&&lockedAccount){startRenewal();return true;}
  return renewLease();
 }
 async function withAccountLease(task) {
  if(!await renewLease())throw leaseError||Error('Session changed. Close and reopen Photos Swipe.');
  await writes.flush();if(writes.pending)throw Error('Save pending local changes before this operation.');
  await task();scheduleSync();
 }
 async function run(task) {
  if(busy)return;
  busy=true;controls();
  activeOperation=(async()=>{
   try {
    db=await database();
    await syncRunning;
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
 function deck(){if(deckItems===state.items&&deckFilter===$('filter').value&&deckSort===$('sort').value)return deckCache;deckItems=state.items;deckFilter=$('filter').value;deckSort=$('sort').value;const items=reviewDeck(state).filter(item=>$('filter').value==='all'||item.type===$('filter').value);if($('sort').value==='oldest')items.sort((a,b)=>new Date(a.date||0)-new Date(b.date||0));if($('sort').value==='largest')items.sort((a,b)=>(b.size||0)-(a.size||0));deckCache=items;return items;}
 function current(){return inspected?state.items.find(item=>item.mediaKey===inspected):deck().find(item=>item.mediaKey===focused)||deck()[0];}
 function mediaURL(value,video=false,expanded=false) {
  if(typeof expanded==='object'){const url=new URL(previewURL(value,{video,authuser:location.pathname.match(/^\/u\/(\d+)/)?.[1]||'0'}));if(!video)url.pathname=url.pathname.replace(/=.+$/,'')+`=w${Math.max(1,Math.ceil(expanded.width))}-h${Math.max(1,Math.ceil(expanded.height))}-k-no`;return url.href;}
  return previewURL(value,{video,expanded,width:expanded?(window.innerWidth||512):($('media').getBoundingClientRect?.().width||window.innerWidth||512),height:expanded?(window.innerHeight||800):($('media').getBoundingClientRect?.().height||Math.round((window.innerHeight||800)*.48)),dpr:window.devicePixelRatio,mobile:/iPhone|iPad/.test(window.navigator?.userAgent||''),authuser:location.pathname.match(/^\/u\/(\d+)/)?.[1]||'0'});
 }
 const preloader=createReviewPreloader({createImage:()=>document.createElement('img'),createVideo:()=>document.createElement('video'),videoURL:async mediaKey=>({url:await videoURL(state.items.find(item=>item.mediaKey===mediaKey))}),previewURL:(url,size)=>mediaURL(url,false,size),playbackURL:url=>mediaURL(url,true)});
 function previewSize(){const {width,height}=$('media').getBoundingClientRect();return {width:width||1,height:height||1,compact:!!window.matchMedia?.('(max-width:760px), (pointer:coarse)').matches};}
 function preloadReview(item){preloader.update($('overlay').hidden||inspected?[]:deck(),$('overlay').hidden?null:item,previewSize());}
 const mobile=/iPhone|iPad/.test(window.navigator?.userAgent||'');
 const smallBuffer=mobile||window.navigator?.deviceMemory<=4||window.navigator?.connection?.saveData;
 let previousKey=null,swipeAt=null,idlePending=false;
 const metrics={paint:[],hits:0,misses:0};
 const buffer=createPreloadBuffer({size:smallBuffer?2:3,load:(item,signal)=>new Promise((resolve,reject)=>{
  const image=window.Image?new window.Image():document.createElement('img');
  const abort=()=>{image.src='';reject(Error('Aborted'));};
  signal.addEventListener('abort',abort,{once:true});
  image.onload=async()=>{try{if(image.decode)await image.decode();signal.removeEventListener('abort',abort);if(!signal.aborted)resolve(image);}catch(error){reject(error);}};
  image.onerror=()=>reject(Error('Preview unavailable'));
  image.src=mediaURL(item.thumbUrl);
 })});
 const videoURLs=new Map();let videoRPC=null,warmedVideo=null,warmedKey=null;
 function videoURL(item){
  const account=identity?.account;const cached=videoURLs.get(item.mediaKey);
  if(cached&&Date.now()-cached.fetchedAt<1800000)return Promise.resolve(cached.url);
  if(videoRPC)return videoRPC.then(()=>videoURL(item),()=>videoURL(item));
  videoRPC=call('video',{mediaKey:item.mediaKey}).then(result=>{const url=mediaURL(result.url,true);if(identity?.account===account){videoURLs.set(item.mediaKey,{url,fetchedAt:Date.now()});if(videoURLs.size>32)videoURLs.delete(videoURLs.keys().next().value);}return url;}).finally(()=>{videoRPC=null;});
  return videoRPC;
 }
 function refill(){
  if(idlePending||!window.Image||$('overlay').hidden)return;
  idlePending=true;
  const idle=window.requestIdleCallback?.bind(window)||((task)=>window.setTimeout(task,0));
  idle(()=>{
   idlePending=false;if($('overlay').hidden)return;
   const upcoming=deck().filter(item=>item.mediaKey!==shown).slice(0,smallBuffer?2:3);
   buffer.update(smallBuffer&&previousKey?upcoming.slice(0,1):upcoming,previousKey);
   for(const item of upcoming.slice(0,2).filter(item=>item.type==='video'))videoURL(item).catch(()=>{});
   const next=upcoming[0];
   if(warmedKey!==next?.mediaKey){if(warmedVideo){warmedVideo.pause();warmedVideo.removeAttribute('src');warmedVideo.load();}warmedVideo=null;warmedKey=null;}
   if(!mobile&&next?.type==='video'&&!warmedVideo){
    const video=document.createElement('video');warmedVideo=video;warmedKey=next.mediaKey;video.preload='metadata';video.muted=true;video.playsInline=true;
    videoURL(next).then(url=>{if(warmedVideo===video)video.src=url;}).catch(()=>{});
   }
  });
 }
 function painted(media,token){
  if(token!==generation||swipeAt===null)return;
  const finish=()=>{if(token!==generation||swipeAt===null)return;window.performance?.mark('painted');metrics.paint.push(window.performance.now()-swipeAt);swipeAt=null;
   if(window.localStorage?.psDebug==='1'){const times=[...metrics.paint].sort((a,b)=>a-b);window.console?.table({p50:times[Math.floor(times.length*.5)],p95:times[Math.min(times.length-1,Math.floor(times.length*.95))],bufferHitRate:metrics.hits/(metrics.hits+metrics.misses)});}
  };
  (window.requestAnimationFrame?.bind(window)||((task)=>window.setTimeout(task,0)))(finish);
 }
 function dropWarmVideo(){if(warmedVideo){warmedVideo.pause();warmedVideo.removeAttribute('src');warmedVideo.load();}warmedVideo=null;warmedKey=null;}
 function stopMedia(){swipeFeedback.reset();underCard.replaceChildren();underCard.hidden=true;generation++;const image=$('media').querySelector('img');const old=state.items.find(item=>item.mediaKey===shown);if(image&&old&&image.complete&&image.naturalWidth)buffer.retain(old,image);const video=$('media').querySelector('video');if(video){video.pause();video.removeAttribute('src');video.load();}$('media').replaceChildren();shown=null;}
 async function display(item) {
  const preview=underCard.querySelector('img'),preloaded=preview?.dataset?.key===item?.mediaKey?preview:null;
  stopMedia();$('zoom').value='1';shown=item?.mediaKey||null;const token=generation;
  if(!item){$('media').setAttribute('aria-busy','false');$('media').textContent='No items to review. Load more or refresh latest.';$('media').style.color='white';return;}
  try {
   const cached=(item.type==='photo'?preloaded:null)||buffer.take(item.mediaKey);const media=item.type==='video'?(warmedKey===item.mediaKey?warmedVideo:document.createElement('video')):(cached||document.createElement('img'));if(cached)metrics.hits++;else metrics.misses++;if(media===warmedVideo){warmedVideo=null;warmedKey=null;}
   if(item.type==='video'){
    media.controls=$('card').classList.contains('expanded');media.muted=true;media.loop=true;media.playsInline=true;media.preload='metadata';media.poster=mediaURL(item.thumbUrl);
    const poster=cached||document.createElement('img');poster.alt=item.name;
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
    const url=await videoURL(item);if(token!==generation)return;
    if(media.src!==url)media.src=url;media.play().catch(()=>{});
    if(media.readyState>=2)media.onloadeddata();
   }else {
    media.style.maxWidth='100%';media.style.maxHeight='100%';media.style.width='';media.style.touchAction='pan-y pinch-zoom';media.alt=item.name;media.draggable=false;
    $('media').setAttribute('aria-busy',String(!cached));
    media.onload=()=>{if(token===generation)$('media').setAttribute('aria-busy','false');painted(media,token);};
    mediaElement.ondblclick=()=>toggleEnlarge();
    if(!cached)media.src=mediaURL(item.thumbUrl,false,previewSize());
    $('media').replaceChildren(media);
    if(media.complete&&media.naturalWidth)painted(media,token);
   }
   media.onerror=()=>{if(token===generation)message('Preview unavailable. Reload Google Photos and try again.');};
  }catch(error){if(token===generation)message(error.message);}
 }
 function updateVideoControls(){
  const video=mediaElement.querySelector('video');
  if(video)video.controls=$('card').classList.contains('expanded');
  for(const button of mediaElement.childNodes)if(button.dataset?.videoControl)button.hidden=$('card').classList.contains('expanded');
 }
 function addVideoControls(video){
  for(const action of ['play','mute']){
   const button=document.createElement('button');button.dataset.videoControl=action;
   button.textContent=action==='play'?'Pause':'Unmute';
   button.style.cssText=`position:absolute;bottom:12px;${action==='play'?'left':'right'}:12px;z-index:2`;
   button.addEventListener('pointerdown',event=>event.stopPropagation());
   button.onclick=()=>{if(action==='play'){if(video.paused)video.play().catch(()=>{});else video.pause();button.textContent=video.paused?'Play':'Pause';}else{video.muted=!video.muted;button.textContent=video.muted?'Unmute':'Mute';}};
   if(action==='play')for(const type of ['play','pause'])video.addEventListener(type,()=>{button.textContent=video.paused?'Play':'Pause';});
   mediaElement.append(button);
  }
  updateVideoControls();
 }
 let trashListKey=null,queueListKey=null;
 queue_detailsElement.addEventListener('toggle',()=>render());historyPanel.addEventListener('toggle',()=>render());
 function historyView(){
  const entries=[...(state.history||[])].reverse(),nextUndo=entries.find(entry=>canUndoReview(state,entry));
  const decisionLabel=value=>value==='remove'?'Queue':value==='keep'?'Keep':'Unreviewed';
  const historyLabel=entry=>`${state.items.find(item=>item.mediaKey===entry.key)?.name||entry.key} · ${decisionLabel(entry.previous)} → ${decisionLabel(entry.decision)}`;
  return {entries,nextUndo,historyLabel,decisionLabel};
 }
 function renderCard(){
  const item=current();
  $('caption').textContent=item?`${inspected?'Candidate inspection · ':''}${item.name} · ${item.date?new Date(item.date).toLocaleDateString():'Unknown date'} · ${itemSize(item)}`:'No unreviewed items in this batch.';
  if(!$('overlay').hidden&&(shown!==(item?.mediaKey||null)||!$('media').childNodes.length))display(item);
 }
 function renderStats(){
  const queue=reviewQueue(state);
  $('stats').textContent=`${deck().length} to review · ${state.items.filter(item=>item.decision).length}/${state.items.length} reviewed · Queue: ${queue.length} (estimated savings: ${estimate(queue)}) · In Trash: ${estimate(state.items.filter(item=>item.decision==='remove'&&item.state==='in_trash'))} (running total)`;
  const {nextUndo,historyLabel,decisionLabel}=historyView();
  undoPreview.textContent=nextUndo?`Next Undo: ${historyLabel(nextUndo)}; restores ${decisionLabel(nextUndo.previous)}.`:'No previous decisions can be undone.';
  $('undo').title=undoPreview.textContent;$('undo').setAttribute('aria-describedby','undo-preview');
  $('remove').textContent=inspected?'Back to review':'× Queue';$('keep').textContent=inspected?'Keep instead':'✓ Keep';
  $('send').textContent=state.job?'Retry saved album operation':'Send to review album';
  $('album').hidden=!state.albumKey;if(state.albumKey)$('album').href=`https://photos.google.com/u/${location.pathname.match(/^\/u\/(\d+)/)?.[1]||'0'}/album/${encodeURIComponent(state.albumKey)}`;
 }
 function renderLists(){
  const queue=reviewQueue(state),candidates=reviewTrashCandidates(state);
  const {entries,nextUndo,historyLabel}=historyView();
  if(historyPanel.open){historyList.replaceChildren();
  for(const entry of entries){const row=document.createElement('li');row.textContent=`${historyLabel(entry)} · ID: ${entry.key}${entry===nextUndo?' · Next Undo':canUndoReview(state,entry)?'':' · Unavailable for Undo'}`;historyList.append(row);}
  if(!entries.length){const row=document.createElement('li');row.textContent='No decisions yet.';historyList.append(row);}
  }
  moveTrash.textContent=`Move ${candidates.length} items to Trash`;
  trashCandidates.hidden=!trashOptIn.checked;moveTrash.hidden=!trashOptIn.checked;
  trashTitle.textContent=`Move to Trash candidates (${candidates.length})`;
  const candidateKey=JSON.stringify(candidates.map(item=>[item.mediaKey,item.name,item.thumbUrl,item.type,item.date,item.queueSent]));
  if(trashOptIn.checked&&trashListKey!==candidateKey){trashListKey=candidateKey;trashList.replaceChildren();
  for(const candidate of candidates){
   const button=document.createElement('button'),image=document.createElement('img'),label=document.createElement('span');
   image.src=mediaURL(candidate.thumbUrl);image.alt='';image.loading='lazy';
   label.textContent=`${candidate.name} · ${candidate.type} · ${candidate.date?new Date(candidate.date).toLocaleDateString():'Unknown date'} · ${candidate.queueSent?'Sent to review album':'Queued'} · ID: ${candidate.mediaKey}`;
   label.style.cssText='white-space:normal;overflow-wrap:anywhere';
   button.append(image,label);button.setAttribute('aria-label',`Inspect ${label.textContent}`);
   button.onclick=()=>{if(!busy){inspected=candidate.mediaKey;render();}};trashList.append(button);
  }
  }
  $('queue-title').textContent=`Removal queue (${queue.length})`;
  const queueKey=JSON.stringify(queue.map(item=>[item.mediaKey,item.name,item.thumbUrl]));
  if(queue_detailsElement.open&&queueListKey!==queueKey){queueListKey=queueKey;$('queue').replaceChildren();
  for(const item of queue){const button=document.createElement('button'),image=document.createElement('img'),label=document.createElement('span');image.src=mediaURL(item.thumbUrl);image.alt='';image.loading='lazy';label.textContent=item.name;button.append(image,label);button.setAttribute('aria-label',`Inspect ${item.name}`);button.onclick=()=>{if(!busy){inspected=item.mediaKey;render();}};$('queue').append(button);}
  }
 }
 function render(){
  renderCard();const item=current();
  const next=inspected||$('card').classList.contains('expanded')?null:deck().find(candidate=>candidate.mediaKey!==item?.mediaKey);
  if(next&&underCard.querySelector('img')?.dataset?.key!==next.mediaKey){try{const preview=document.createElement('img');preview.dataset.key=next.mediaKey;preview.alt='';preview.draggable=false;preview.src=mediaURL(next.thumbUrl,false,previewSize());underCard.replaceChildren(preview);}catch{underCard.replaceChildren();}}
  if(!next)underCard.replaceChildren();underCard.hidden=!next;
  preloadReview(item);
  renderStats();renderLists();refill();
 }
 let cardAnimation=null;
 function finishCardAnimation(){if(cardAnimation)cardAnimation.finish();}
 function clearCardAnimation(){if(cardAnimation){cardAnimation.cancel();cardAnimation=null;}$('card').style.visibility='';}
 async function animateCard(decision){
  clearCardAnimation();
  if(!$('card').animate||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
  const side=decision==='keep'?1:-1,center={transform:'translateX(0) rotate(0deg)',opacity:1},edge={transform:`translateX(${side*120}vw) rotate(${side*18}deg)`,opacity:0};
  const animation=$('card').animate([edge,center],{duration:250,easing:'ease-out',fill:'forwards'});cardAnimation=animation;
  let timer;
  try{await Promise.race([animation.finished,new Promise(resolve=>{timer=window.setTimeout(()=>{animation.finish();resolve();},350);})]);}catch{}finally{window.clearTimeout(timer);}
 }
 async function openSession() {
  if(closingPromise)await closingPromise;
  if(busy)return;
  preloader.clear();busy=true;controls();$('overlay').hidden=false;$('launcher').hidden=true;buffer.clear();await syncRunning;
  const token=++leaseGeneration;
  try{
   const result=await rawCall('identity');
   if(token!==leaseGeneration)return;
   if(!result.ok)throw Error(result.error);
   const changed=identity?.account!==result.data.account;
   if(changed){
    await releaseLease();
    await writes.flush();writes=createWrites();writeConflict=null;leaseError=null;
    inspected=null;focused=null;stopMedia();dropWarmVideo();buffer.clear();videoURLs.clear();previousKey=null;
   }
   identity=result.data;$('account').textContent=identity.label;db=await database();
   if(!await renewLease())return;
   if(!changed){
    await writes.flush();
    if(writes.pending){if(!writeConflict)message('Local changes are still pending. Close and reopen to retry saving.');return;}
   }
   $('close').focus();message('Reading local progress…');
   state=await db.read(identity.account);writeRevision=state.revision;
   let settings={};try{settings=await (await pairingPromise).settings();}catch(error){pairingNotice.textContent=`Pairing storage unavailable: ${error.message}`;}unpairedBanner.hidden=!settings.unpaired;
   $('sync-url').value=settings.url||'';$('sync-token').value='';$('sync-token').placeholder=settings.token?'Leave blank to keep saved token':'Enter sync token';
   syncEnabled=!!(settings.url&&settings.token);syncClient.configure(settings);
   settingsPanel.open=!syncEnabled&&!settings.onboardingDismissed;syncLocal.hidden=syncEnabled;
   if(syncEnabled)await synchronize();
   message(idleMessage());
  }catch(error){
   await releaseLease();identity=null;state=emptyReview();stopMedia();buffer.clear();message(error.message);
  }finally{busy=false;render();controls();}
 }
 function open(){
  if(openingPromise)return openingPromise;
  openingPromise=openSession().finally(()=>{openingPromise=null;});
  return openingPromise;
 }
 async function closeSession(){
  preloader.clear();finishCardAnimation();clearCardAnimation();await openingPromise;await activeOperation;await writes.flush();
  leaseGeneration++;clearInterval(leaseTimer);leaseTimer=null;
  $('overlay').hidden=true;$('launcher').hidden=false;$('launcher').focus();
  stopMedia();dropWarmVideo();buffer.clear();window.clearTimeout(syncTimer);
  await openingPromise;await activeOperation;
  $('overlay').hidden=true;$('launcher').hidden=false;stopMedia();dropWarmVideo();buffer.clear();
  try{
   if(await recoverLease()){
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
  closingPromise=closeSession().finally(()=>{closingPromise=null;});
  return closingPromise;
 }
 function decide(decision){
  if(busy||!identity||leaseError||$('overlay').hidden)return;
  if(inspected&&decision==='remove'){inspected=null;render();return;}
  const item=current();if(!item)return;
  try{
  swipeFeedback.dismiss(decision);window.performance?.mark('swipe');swipeAt=window.performance?.now()??null;const previous=item.decision,next=decideReview(state,item.mediaKey,decision,previous,item.revision||0);inspected=null;focused=null;previousKey=item.mediaKey;apply({...next,history:[...(state.history||[]),{key:item.mediaKey,previous,decision,revision:(item.revision||0)+1}]},item.mediaKey);message(decision==='remove'?'Added to the local removal queue.':`Kept ${item.name}.`);
  }catch(error){message(error.message);}
 }
 async function undo(){if(busy||!identity||leaseError||$('overlay').hidden)return;try{const history=structuredClone(state.history||[]);while(history.length&&!canUndoReview(state,history.at(-1)))history.pop();const last=history.pop();if(!last){message('No previous decisions can be undone.');return;}const next=decideReview(state,last.key,last.previous,last.decision,last.revision);const previous=[...history].reverse().find(entry=>entry.key===last.key);if(previous&&previous.revision===last.revision-1)previous.revision=next.items.find(item=>item.mediaKey===last.key).revision;const restored=next.items.find(item=>item.mediaKey===last.key);inspected=restored.decision==='remove'?last.key:null;focused=restored.decision===null?last.key:null;apply({...next,history});await animateCard(last.decision);clearCardAnimation();message(`Decision undone for ${restored.name}.`);}catch(error){message(error.message);}}
 async function load(refresh=false) {
  buffer.clear();previousKey=null;
  const result=await loadReviewPages({read:async()=>state,save,call,refresh,progress:scanned=>message(`Loading library · ${scanned} rows checked…`)});
  message(`${result.added} new items to review · ${result.scanned} library rows checked${result.exhausted?' · End of library':''}${result.limited?' · Scan limit reached; Load more continues from here':''}${result.warning?'. '+result.warning:''}`);
 }

 function toggleEnlarge(){swipeFeedback.reset();$('card').classList.toggle('expanded');updateVideoControls();$('enlarge').textContent=$('card').classList.contains('expanded')?'Fit view':'Enlarge';refreshPreviews();}
 function refreshPreviews(){const next=underCard.querySelector('img'),candidate=state.items.find(item=>item.mediaKey===next?.dataset?.key);if(candidate)next.src=mediaURL(candidate.thumbUrl,false,previewSize());if($('overlay').hidden)return;const item=current(),media=$('media').querySelector('img')||$('media').querySelector('video');if(item&&item.mediaKey===shown&&media?.tagName===(item.type==='video'?'VIDEO':'IMG')){const url=mediaURL(item.thumbUrl,false,previewSize());if(item.type==='video')media.poster=url;else media.src=url;}preloadReview(item);}
 window.addEventListener('resize',refreshPreviews);
 $('sync-save').onclick=()=>run(async()=>{const previous=await (await pairingPromise).settings();const url=$('sync-url').value.trim();const normalized=url?new URL(url).origin:'';const settings={...previous,...validateSyncSettings(url,$('sync-token').value||(normalized===previous.url?previous.token||'':''))};if(settings.token)delete settings.unpaired;await (await pairingPromise).saveSettings({...settings,onboardingDismissed:true});$('sync-token').value='';if(settings.token)unpairedBanner.hidden=true;syncEnabled=!!(settings.url&&settings.token);syncLocal.hidden=syncEnabled;syncClient.configure(settings);await synchronize();settingsPanel.open=!syncEnabled;message(idleMessage());});
 $('sync-local').onclick=()=>run(async()=>{const settings=await (await pairingPromise).settings();await (await pairingPromise).saveSettings({...settings,onboardingDismissed:true});settingsPanel.open=false;message(idleMessage());});
 let receivingPanel;
 const receivePairing=manual=>{if(!manual&&/^#pswipe-pair=([A-Za-z0-9_-]{22})(?:&origin=([^&]+))?$/.test(location.hash||'')){receivingPanel?.remove();receivingPanel=null;}else if(!manual)return;if(receivingPanel){receivingPanel.hidden=false;receivingPanel.querySelector('input').focus();return receivingPanel;}return receivingPanel=receivePairingLink({document,parent:root,location:manual?{...location,hash:''}:location,window,fetch:environment.syncFetch||environment.fetch,saveSettings:async settings=>{await (await pairingPromise).saveSettings(settings);},onPaired:open,manual,url:$('sync-url').value.trim()||undefined});};
 const pairThis=document.createElement('button');pairThis.textContent='Pair this device';settingsPanel.append(pairThis);pairThis.onclick=()=>receivePairing(true);receivePairing(false);
 window.addEventListener('hashchange',()=>receivePairing(false));
 $('launcher').onclick=open;$('close').onclick=close;$('keep').onclick=()=>decide('keep');$('remove').onclick=()=>decide('remove');$('undo').onclick=undo;$('load').onclick=()=>run(()=>load());$('refresh').onclick=()=>run(()=>load(true));$('enlarge').onclick=toggleEnlarge;
 $('filter').onchange=$('sort').onchange=()=>{inspected=null;focused=null;buffer.clear();render();};
 $('zoom').oninput=()=>{swipeFeedback.reset();mediaElement.style.touchAction=Number($('zoom').value)>1?'pan-x pan-y pinch-zoom':'pan-y pinch-zoom';const image=$('media').querySelector('img');if(image){image.style.maxWidth='none';image.style.maxHeight='none';image.style.width=`${Number($('zoom').value)*100}%`;image.style.touchAction=Number($('zoom').value)>1?'pan-x pan-y pinch-zoom':'pan-y pinch-zoom';}};
 $('send').onclick=()=>{if(busy)return;const confirmedKeys=[...(state.job?.mediaKeys||reviewQueue(state).map(item=>item.mediaKey))];const count=confirmedKeys.length;if(!count){message('The removal queue is empty.');return;}if(!window.confirm(`Add ${count} candidates to a private review album? This does not delete media.`))return;run(async()=>{const keys=state.job?.mediaKeys||reviewQueue(state).map(item=>item.mediaKey);if(keys.length!==confirmedKeys.length||keys.some(key=>!confirmedKeys.includes(key)))throw Error('The queue changed in another tab. Review it and confirm again.');message('Updating and verifying the review album…');await sendReviewAlbum({read:async()=>state,save,call,title:'Photos Swipe · Review'});inspected=null;message('Every candidate was verified in the review album. Select Enable Move to Trash below to use this panel, or open the review album to move items manually in Google Photos.');});};
 trashOptIn.onchange=()=>render();
 moveTrash.onclick=()=>{if(busy||!trashOptIn.checked)return;const candidates=reviewTrashCandidates(state),keys=candidates.map(item=>item.mediaKey);if(!keys.length){message('No candidates to move to Trash.');return;}if(!window.confirm(`Move exactly ${keys.length} items to Google Photos Trash?\n\n${candidates.map(item=>`${item.name} (ID: ${item.mediaKey})`).join('\n')}`))return;run(async()=>{if(state.job)throw Error('Finish the saved album operation before moving items to Trash.');const currentKeys=reviewTrashCandidates(state).map(item=>item.mediaKey);if(currentKeys.length!==keys.length||currentKeys.some(key=>!keys.includes(key)))throw Error('Candidates changed. Review the item list and confirm again.');if(state.items.some(item=>keys.includes(item.mediaKey)&&!item.dedupKey))throw Error('Missing Trash identifiers. Refresh latest before retrying.');for(let index=0;index<keys.length;index+=25){const batch=keys.slice(index,index+25);await call('moveToTrash',{dedupKeys:state.items.filter(item=>batch.includes(item.mediaKey)).map(item=>item.dedupKey),confirmed:true});await save(await reconcileReviewTrash(state,call));if(state.items.some(item=>batch.includes(item.mediaKey)&&item.state!=='in_trash'))throw Error('Trash move was not verified. Check deleted items before retrying.');}trashOptIn.checked=false;moveTrash.hidden=true;message(`Verified ${keys.length} items in Trash.`);});};
 $('trash').onclick=()=>run(async()=>{message('Reading Google Photos Trash…');await save(await reconcileReviewTrash(state,call));message('Trash check complete. Unknown results leave local state unchanged.');});
 for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','touchstart','touchmove','touchend','touchcancel','wheel'])overlayElement.addEventListener(type,event=>event.stopPropagation());
 const swipeFeedback=createSwipeFeedback({window,targets:[$('media'),$('swipe')],card:topCard,under:underCard,keep:stamps[0],remove:stamps[1],canSwipe:()=>!!current()&&!busy&&!inspected&&!$('overlay').hidden&&!$('card').classList.contains('expanded')&&Number($('zoom').value)<=1,onDecide:decide});
 function leavePage(){
  releaseLease();
  stopMedia();dropWarmVideo();buffer.clear();window.clearTimeout(syncTimer);
 }
 window.addEventListener('pagehide',leavePage);
 window.addEventListener('unload',leavePage);
 window.addEventListener('focus',()=>{if(identity&&!busy&&!$('overlay').hidden)synchronize();});
 document.addEventListener?.('visibilitychange',()=>{if(document.hidden){buffer.clear();if(warmedVideo){warmedVideo.removeAttribute('src');warmedVideo.load();warmedVideo=null;warmedKey=null;}}else if(identity&&!busy&&!activeOperation&&!$('overlay').hidden)refreshLease();});
 window.addEventListener('pageshow',event=>{if(event.persisted&&!$('overlay').hidden)return open();});
 const activePairingDialog=()=>!pairingModal.modal.hidden?pairingModal.modal:receivingPanel&&!receivingPanel.hidden?receivingPanel:null;
 function handleViewerSpace(event){
  if(activePairingDialog())return false;
  if($('overlay').hidden||event.altKey||event.ctrlKey||event.metaKey||event.isComposing||event.key!==' ')return false;
  if(['INPUT','SELECT','TEXTAREA'].includes(root.activeElement?.tagName)||root.activeElement?.isContentEditable)return false;
  const video=$('media').querySelector('video');
  event.preventDefault();event.stopImmediatePropagation();
  if(video&&event.type==='keydown'&&!event.repeat){if(video.paused)video.play().catch(()=>{});else video.pause();}
  return true;
 }
 window.addEventListener('keyup',handleViewerSpace,true);
 window.addEventListener('keydown',event=>{
  const dialog=activePairingDialog();
  if(dialog){if(event.key==='Tab'){const focusable=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled)')].filter(element=>element.getClientRects().length);const index=focusable.indexOf(root.activeElement),next=event.shiftKey?(index<=0?focusable.length-1:index-1):(index+1)%focusable.length;event.preventDefault();event.stopImmediatePropagation();focusable[next]?.focus();}else if(!dialog.contains(root.activeElement)){event.preventDefault();event.stopImmediatePropagation();dialog.querySelector('button:not(:disabled),input:not(:disabled)')?.focus();}if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();if(dialog===pairingModal.modal)pairingModal.close();else dialog.onkeydown(event);}return;}
  if(handleViewerSpace(event))return;
  if($('overlay').hidden||event.altKey||event.ctrlKey||event.metaKey||event.isComposing)return;
  if(event.key==='Tab'){
   const focusable=[...root.querySelectorAll('button:not(:disabled),select,input,a[href],summary,video[controls]')].filter(element=>element.getClientRects().length);
   const index=focusable.indexOf(root.activeElement),next=event.shiftKey?(index-1+focusable.length)%focusable.length:(index+1)%focusable.length;
   event.preventDefault();event.stopImmediatePropagation();focusable[next]?.focus();return;
  }
  if(['INPUT','SELECT','TEXTAREA'].includes(root.activeElement?.tagName)||root.activeElement?.isContentEditable)return;
  const actions={ArrowLeft:()=>decide('remove'),ArrowRight:()=>decide('keep'),z:undo,Z:undo,f:toggleEnlarge,F:toggleEnlarge,Escape:close};
  if(actions[event.key]){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat||!['ArrowLeft','ArrowRight','z','Z'].includes(event.key))actions[event.key]();}
 },true);
}
