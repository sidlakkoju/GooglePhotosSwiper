import {renderPairingQR} from './userscript-qr.mjs';
const pairingServerError='Pairing is unavailable on the sync server (server misconfigured)';
export function createPairingModal({document,parent,fetch,settings,setTimeout,clearTimeout,now=Date.now,onClose=()=>{},renderQR=renderPairingQR}) {
 const modal=document.createElement('section');modal.hidden=true;modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','Pair another device');modal.className='pairing-issuer settings-sheet';modal.style.cssText='z-index:6;pointer-events:auto';
 const status=document.createElement('p'),qr=document.createElement('div'),short=document.createElement('p'),countdown=document.createElement('p'),cancel=document.createElement('button'),renew=document.createElement('button'),devices=document.createElement('button');
 status.setAttribute('role','status');cancel.textContent='Cancel';renew.textContent='New code';devices.textContent='View devices';modal.append(status,qr,short,countdown,cancel,renew,devices);parent.append(modal);
 let generation=0,current=null,timer=null,credentials=null,nextPollAt=0,polling=false,pendingStatus=null;
 const request=async(path,method='GET',body)=>{
  const response=await fetch(new URL('/api/'+path,credentials.url).href,{method,headers:{Authorization:`Bearer ${credentials.token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error(response.status>=500?pairingServerError:response.status===401?'Pair this device first.':`Pairing request failed (${response.status})`);
  return response.json();
 };
 const reset=()=>{clearTimeout(timer);qr.replaceChildren();short.textContent='';countdown.textContent='';renew.hidden=true;devices.hidden=true;};
 const burn=async id=>{await request('pair/start','DELETE',{id});};
 const showClaim=result=>{reset();modal.hidden=false;status.textContent='New device paired: '+result.name;devices.hidden=false;current=null;};
 const finish=async id=>{
  const pending=pendingStatus;await burn(id);
  const previous=await pending?.catch(()=>null);
  try{const result=await request('pair/status?id='+encodeURIComponent(id));return result.claimed?result:previous;}catch(error){if(previous?.claimed)return previous;throw error;}
 };
 const tick=async version=>{
  if(version!==generation||modal.hidden||!current)return;
  const seconds=Math.max(0,Math.ceil((current.expiresAt-now())/1000));countdown.textContent=`${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;
  timer=setTimeout(()=>tick(version),250);
  if(!seconds){const id=current.id,finalVersion=++generation;reset();status.textContent='Code expired';renew.hidden=false;try{const result=await finish(id);if(finalVersion===generation){if(result?.claimed)showClaim(result);else current=null;}}catch(error){if(finalVersion===generation)status.textContent='Code expired. '+error.message;}return;}
  if(polling)return;
  try {
   if(now()>=nextPollAt){polling=true;pendingStatus=request('pair/status?id='+encodeURIComponent(current.id));const result=await pendingStatus;if(version!==generation||!current)return;polling=false;if(result.claimed){showClaim(result);return;}nextPollAt=now()+2500;}
  }catch(error){if(version!==generation||!current)return;polling=false;nextPollAt=now()+2500;status.textContent=error.message;}
 };
 const open=async()=>{
  if(!modal.hidden)return;
  modal.hidden=false;cancel.focus();await start();
 };
 const start=async()=>{
  const version=++generation;reset();status.textContent='Loading pairing code…';
  try{
   credentials=await settings();if(!credentials.url||!credentials.token)throw Error('Pair this device first.');
   const result=await request('pair/start','POST');
   if(version!==generation){try{await burn(result.id);}catch(error){current=result;modal.hidden=false;status.textContent='Could not cancel pairing code. '+error.message;cancel.focus();}return;}
   current=result;polling=false;pendingStatus=null;nextPollAt=now()+2500;qr.append(renderQR(document,new URL('/pair',credentials.url).href+'#'+result.code));short.textContent=result.short.slice(0,3)+' '+result.short.slice(3);status.textContent='Scan this QR or enter the code on your other device.';tick(version);
  }catch(error){if(version===generation){reset();status.textContent=error.message;renew.hidden=error.message==='Pair this device first.';}}
 };
 const close=async()=>{
  const version=++generation;reset();const id=current?.id;
  if(id)try{const result=await finish(id);if(version!==generation)return;if(result?.claimed){showClaim(result);return;}}catch(error){if(version===generation){status.textContent=error.message;renew.hidden=false;}return;}
  if(version===generation){current=null;modal.hidden=true;onClose();}
 };
 cancel.onclick=close;renew.onclick=start;modal.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
 devices.onclick=async()=>{try{const result=await request('devices');status.textContent='Devices';qr.replaceChildren();for(const device of result.devices.filter(device=>!device.revoked_at)){const row=document.createElement('p');row.textContent=device.name+' ('+device.platform+')';qr.append(row);}}catch(error){status.textContent=error.message;}};
 return {open,close,modal};
}
export function receivePairingLink({document,parent,location,window,fetch,saveSettings,onPaired,onClose=()=>{},manual=false,url='https://photoswiper-sync.sidlakkoju.workers.dev'}) {
 const match=location.hash?.match(/^#pswipe-pair=([A-Za-z0-9_-]{22})(?:&origin=([^&]+))?$/);if(!match&&!manual)return;
 if(match)window.history.replaceState(null,'',location.pathname+location.search);
 const panel=document.createElement('section'),name=document.createElement('input'),button=document.createElement('button'),status=document.createElement('p'),shortCode=document.createElement('input'),origin=document.createElement('input'),cancel=document.createElement('button');
 panel.className='pairing-receiver settings-sheet';
 const title=document.createElement('h2');title.textContent='Pair this device';panel.append(title);
 const field=(input,id,text,parent=panel)=>{const label=document.createElement('label');label.textContent=text;label.setAttribute('for',id);input.setAttribute('id',id);parent.append(label,input);};
 name.value=/iPhone/.test(window.navigator?.userAgent||'')?'iPhone (Safari)':'New browser';field(name,'pairing-device-name','Device name');
 if(manual){
  field(shortCode,'pairing-short-code','6-digit code from a paired device');shortCode.setAttribute('inputmode','numeric');shortCode.setAttribute('pattern','[0-9]{6}');shortCode.setAttribute('autocomplete','one-time-code');shortCode.oninput=()=>{shortCode.value=shortCode.value.replace(/[^0-9]/g,'').slice(0,6);};
  const hint=document.createElement('p');hint.setAttribute('id','pairing-code-hint');hint.textContent="Get a code from Settings > Sync on a device that's already paired";shortCode.setAttribute('aria-describedby','pairing-code-hint');panel.append(hint);
  const advanced=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Advanced';advanced.open=false;advanced.append(summary);origin.type='url';origin.value=url;field(origin,'pairing-server','Sync server',advanced);panel.append(advanced);
 }
 const actions=document.createElement('div');actions.className='toolbar';button.textContent='Pair this device';cancel.textContent='Cancel';actions.append(button,cancel);status.setAttribute('role','status');panel.append(actions,status);
 cancel.onclick=()=>{panel.hidden=true;onClose();};panel.onkeydown=event=>{if(event.key==='Escape')cancel.onclick();};panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Pair this device');parent.append(panel);(manual?shortCode:name).focus();
 button.onclick=async()=>{button.disabled=true;try{const worker=new URL(match?.[2]?decodeURIComponent(match[2]):manual?origin.value:url);if(worker.protocol!=='https:'||worker.username||worker.password)throw Error('Enter a valid HTTPS Worker origin.');const claimedURL=worker.origin;const response=await fetch(claimedURL+'/api/pair/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...(match?{code:match[1]}:{short:shortCode.value.replace(/\s/g,'')}),name:name.value,platform:window.navigator?.platform||'browser'}),credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error(response.status>=500?pairingServerError:'Code expired or unavailable. Ask the paired device for a new code.');const result=await response.json();await saveSettings({url:claimedURL,token:result.token,onboardingDismissed:true});panel.hidden=true;onClose();await onPaired();}catch(error){status.textContent=error.message;button.disabled=false;}};
 return panel;
}
