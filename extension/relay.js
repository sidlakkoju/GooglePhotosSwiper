// The local app is the only page allowed to contact this bridge.
if(location.origin==='http://localhost:3000'&&window.top===window){
 window.addEventListener('message',async e=>{
  if(e.source!==window||e.origin!==location.origin||e.data?.channel!=='photos-swipe-request'||typeof e.data.id!=='string')return;
  const {id,operation,args}=e.data;
  window.postMessage({channel:'photos-swipe-ack',id},location.origin);
  try{const response=await chrome.runtime.sendMessage({operation,args});if(!response||typeof response.ok!=='boolean')throw Error('Missing bridge response');
   window.postMessage({channel:'photos-swipe-response',id,...response},location.origin);}catch(e){window.postMessage({channel:'photos-swipe-response',id,ok:false,error:'Extension disconnected. Reload this tab after reloading the extension.'},location.origin);}
 });
}
