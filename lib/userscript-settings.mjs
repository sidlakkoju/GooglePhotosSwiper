export async function createPairingStore({GM,database,crypto}) {
 const durable=!!GM&&['getValue','setValue','deleteValue'].every(name=>typeof GM[name]==='function');
 const key='photos-swipe-pairing';
 const complete=value=>typeof value?.url==='string'&&!!value.url&&typeof value?.token==='string'&&!!value.token;
 const select=value=>Object.fromEntries(['url','token','deviceId','deviceName'].filter(name=>typeof value?.[name]==='string').map(name=>[name,value[name]]));
 async function settings() {
  const db=await database();
  if(!durable)return db.settings();
  let value=await GM.getValue(key);
  const legacy=await db.settings();
  if(!complete(value)&&complete(legacy)){
   value={...select(legacy),deviceId:legacy.deviceId||crypto.randomUUID()};
   await GM.setValue(key,value);
  }
  if(complete(value)&&(legacy.token||legacy.url||legacy.deviceId||legacy.deviceName)){await db.deleteSettings();if(legacy.onboardingDismissed)await db.saveSettings({onboardingDismissed:true});}
  return {...select(value),onboardingDismissed:legacy.onboardingDismissed};
 }
 async function saveSettings(value) {
  const db=await database();
  if(!durable)return db.saveSettings(value);
  if(value.url&&value.token)await GM.setValue(key,{...select(value),deviceId:value.deviceId||crypto.randomUUID()});
  else await GM.deleteValue(key);
  await db.saveSettings(value.onboardingDismissed?{onboardingDismissed:true}:{});
 }
 return {durable,settings,saveSettings};
}
