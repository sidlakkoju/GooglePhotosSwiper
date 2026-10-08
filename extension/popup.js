const status=document.getElementById('status');
const form=document.getElementById('pair-form'),pairButton=form.querySelector('button'),forget=document.getElementById('forget');
let generation=0;
const message=async(operation,args={})=>{
 let result,timer;try{result=await Promise.race([chrome.runtime.sendMessage({operation,args}),new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('The extension did not finish. Reload Google Photos, close this popup, and try again.')),45000);})]);}catch(e){throw Error(e.message?.startsWith('The extension did not finish')?e.message:'Extension disconnected. Close this popup, reload the project extension, and reopen it.');}finally{clearTimeout(timer);}
 if(!result||typeof result.ok!=='boolean')throw Error('Extension did not respond. Close and reopen this popup.');
 if(!result.ok)throw Error(result.error||'Bridge request failed.');return result.data;
};
function pending(text){status.textContent=text;status.setAttribute('aria-busy','true');pairButton.disabled=true;forget.disabled=true;}
function finished(){status.setAttribute('aria-busy','false');pairButton.disabled=false;forget.disabled=false;}
form.onsubmit=async e=>{
 e.preventDefault();++generation;pending('Pairing with the local app and checking this Google account…');
 try{const result=await message('pair',{code:document.getElementById('code').value});status.textContent=`Paired with ${result.label}. Return to Photos Swipe and click Check connection.`;}
 catch(e){status.textContent=e.message;}finally{finished();}
};
forget.onclick=async()=>{
 ++generation;pending('Forgetting this browser pairing…');
 try{await message('forget');status.textContent='Pairing forgotten on this browser. You can also revoke access in the app.';}
 catch(e){status.textContent=e.message;}finally{finished();}
};
const initial=generation;status.textContent='Checking existing pairing…';
message('status').then(s=>{if(initial===generation)status.textContent=s.paired?`Connection verified: ${s.label}. Bridge ${s.version||'older version'}.`:'Not paired yet. Generate a fresh code in the local app.';}).catch(e=>{if(initial===generation)status.textContent=e.message;});
