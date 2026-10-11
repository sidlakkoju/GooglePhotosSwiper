import {renderPairingQR} from './userscript-qr.mjs';
export function createPairingModal({document,parent,fetch,settings,setTimeout,clearTimeout,now=Date.now,renderQR=renderPairingQR}) {
 const modal=document.createElement('section');modal.hidden=true;modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','Pair another device');modal.style.cssText='position:fixed;inset:0;overflow:auto;background:#f4f7f1;padding:24px;z-index:1;pointer-events:auto';
 const status=document.createElement('p'),qr=document.createElement('div'),short=document.createElement('p'),countdown=document.createElement('p'),cancel=document.createElement('button'),renew=document.createElement('button'),devices=document.createElement('button');
 status.setAttribute('role','status');cancel.textContent='Cancel';renew.textContent='New code';devices.textContent='View devices';modal.append(status,qr,short,countdown,cancel,renew,devices);parent.append(modal);
 let generation=0,current=null,timer=null,credentials=null,nextPollAt=0,polling=false;
 const request=async(path,method='GET',body)=>{
  const response=await fetch(new URL('/api/'+path,credentials.url).href,{method,headers:{Authorization:`Bearer ${credentials.token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error(response.status===401?'Pair this device first.':`Pairing request failed (${response.status})`);
  return response.json();
 };
 const reset=()=>{clearTimeout(timer);qr.replaceChildren();short.textContent='';countdown.textContent='';renew.hidden=true;devices.hidden=true;};
 const burn=async id=>{await request('pair/start','DELETE',{id});};
 const tick=async version=>{
  if(version!==generation||modal.hidden||!current)return;
  const seconds=Math.max(0,Math.ceil((current.expiresAt-now())/1000));countdown.textContent=`${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;
  timer=setTimeout(()=>tick(version),250);
  if(polling)return;
  try {
   if(now()>=nextPollAt||!seconds){polling=true;const result=await request('pair/status?id='+encodeURIComponent(current.id));if(version!==generation)return;polling=false;if(result.claimed){reset();status.textContent='New device paired: '+result.name;devices.hidden=false;current=null;return;}nextPollAt=now()+2500;}
   if(!seconds){const id=current.id;reset();status.textContent='Code expired';renew.hidden=false;current=null;await burn(id);return;}
  }catch(error){if(version!==generation)return;polling=false;reset();status.textContent=error.message;renew.hidden=false;}
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
   if(version!==generation){await burn(result.id);return;}
   current=result;polling=false;nextPollAt=now()+2500;qr.append(renderQR(document,new URL('/pair',credentials.url).href+'#'+result.code));short.textContent=result.short.slice(0,3)+' '+result.short.slice(3);status.textContent='Scan this QR or enter the code on your other device.';tick(version);
  }catch(error){if(version===generation){reset();status.textContent=error.message;renew.hidden=error.message==='Pair this device first.';}}
 };
 const close=async()=>{
  ++generation;reset();const id=current?.id;
  if(id)try{await burn(id);}catch(error){status.textContent=error.message;renew.hidden=false;return;}
  current=null;modal.hidden=true;
 };
 cancel.onclick=close;renew.onclick=start;modal.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
 devices.onclick=async()=>{try{const result=await request('devices');status.textContent='Devices';qr.replaceChildren();for(const device of result.devices.filter(device=>!device.revoked_at)){const row=document.createElement('p');row.textContent=device.name+' ('+device.platform+')';qr.append(row);}}catch(error){status.textContent=error.message;}};
 return {open,close,modal};
}
export function receivePairingLink({document,parent,location,window,fetch,saveSettings,onPaired,manual=false,url='https://photoswiper-sync.sidlakkoju.workers.dev'}) {
 const match=location.hash?.match(/^#pswipe-pair=([A-Za-z0-9_-]{22})(?:&origin=([^&]+))?$/);if(!match&&!manual)return;
 if(match)window.history.replaceState(null,'',location.pathname+location.search);
 const panel=document.createElement('section'),name=document.createElement('input'),button=document.createElement('button'),status=document.createElement('p'),shortCode=document.createElement('input'),origin=document.createElement('input'),cancel=document.createElement('button');
 panel.style.cssText='position:fixed;inset:0;background:#f4f7f1;padding:24px;pointer-events:auto;z-index:2';name.value=/iPhone/.test(window.navigator?.userAgent||'')?'iPhone (Safari)':'New browser';name.setAttribute('aria-label','Device name');button.textContent='Pair this device';panel.append(name,button,status);if(manual){shortCode.setAttribute('aria-label','Six-digit pairing code');shortCode.inputMode='numeric';shortCode.maxLength=7;origin.setAttribute('aria-label','Worker origin');origin.type='url';origin.value=url;panel.append(shortCode,origin);}cancel.textContent='Cancel';cancel.onclick=()=>{panel.hidden=true;};panel.onkeydown=event=>{if(event.key==='Escape')cancel.onclick();};panel.append(cancel);parent.append(panel);
 button.onclick=async()=>{button.disabled=true;try{const worker=new URL(match?.[2]?decodeURIComponent(match[2]):manual?origin.value:url);if(worker.protocol!=='https:'||worker.username||worker.password)throw Error('Enter a valid HTTPS Worker origin.');const claimedURL=worker.origin;const response=await fetch(claimedURL+'/api/pair/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...(match?{code:match[1]}:{short:shortCode.value.replace(/\s/g,'')}),name:name.value,platform:window.navigator?.platform||'browser'}),credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('Code expired or unavailable. Ask the paired device for a new code.');const result=await response.json();await saveSettings({url:claimedURL,token:result.token,onboardingDismissed:true});panel.hidden=true;await onPaired();}catch(error){status.textContent=error.message;button.disabled=false;}};
 return panel;
}
