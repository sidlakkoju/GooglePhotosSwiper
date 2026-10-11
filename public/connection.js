// A connection check includes local authentication and a fresh Google identity read.
// Coalesce repeated clicks so a slower previous result cannot overwrite a new one.
export function describeConnection(state,checkedAt=new Date()) {
 if(!state?.installed)throw Error('The desktop bridge returned an invalid status. Reload the extension and this app tab.');
 if(!state.paired)return {phase:'pairing',connected:false,reconciliationSupported:false,summary:'Extension needs pairing',detail:`Extension ${state.version||'(older version)'} is installed. Generate a fresh code, pair in Google Photos, then check again.`};
 return {phase:'connected',connected:true,reconciliationSupported:!!state.reconciliationSupported,summary:'Google Photos connected via Chrome extension · Keep the Photos tab open',detail:`Connection verified${state.recoveredTab?' in the open Google Photos tab':''} with ${state.label||'your Google account'} at ${checkedAt.toLocaleTimeString()}. Ready to import.${state.version?` Bridge ${state.version}.`:''}`};
}
export function createConnectionCheck({refresh,bridge,change,now=()=>new Date()}) {
 let running=null;
 function check(){
  if(running)return running;
  change({phase:'checking',connected:false,reconciliationSupported:false,summary:'Checking desktop connection…',detail:'Checking local sign-in, the extension, and your Google Photos account…'});
  running=(async()=>{
   try {await refresh();const result=describeConnection(await bridge('status',{},35000),now());change(result);return result;}
   catch(error){const result={phase:'error',connected:false,reconciliationSupported:false,summary:'Desktop bridge not connected',detail:error.message||'Connection check failed. Reload this tab and try again.'};change(result);return result;}
   finally {running=null;}
  })();
  return running;
 }
 return {check};
}
