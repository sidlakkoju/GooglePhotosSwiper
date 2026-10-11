import {photosOperation} from '../extension/photos-api.js';
export function buildPhotosRequest(tokens,location,id,payload) {
 const path=tokens.eptZe;
 if(location.origin!=='https://photos.google.com'||typeof path!=='string'||!/^\/(?:u\/\d+\/|_\/PhotosUi\/(?:u\/\d+\/)?)?$/.test(path)||!tokens.SNlM0e)throw Error('Unsupported Google Photos page tokens.');
 const query=new URLSearchParams({rpcids:id,'source-path':location.pathname,'f.sid':String(tokens.FdrFJe),bl:String(tokens.cfb2h),pageId:'none',rt:'c'});
 return {url:`https://photos.google.com${path}data/batchexecute?${query}`,options:{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:new URLSearchParams({'f.req':JSON.stringify([[[id,JSON.stringify(payload),null,'generic']]]),at:tokens.SNlM0e}),credentials:'include'}};
}
export function parsePhotosResponse(raw,id) {
 for(const line of raw.split('\n')) {
  let parsed;
  try {parsed=JSON.parse(line);}catch {continue;}
  if(!Array.isArray(parsed))continue;
  const envelope=parsed.find(entry=>Array.isArray(entry)&&entry[0]==='wrb.fr'&&entry[1]===id);
  if(!envelope)continue;
  if(typeof envelope[2]!=='string')throw Error('Google returned an unexpected response. No changes were confirmed.');
  try {return JSON.parse(envelope[2]);}catch {throw Error('Google response could not be read.');}
 }
 throw Error('Google returned an unexpected response. No changes were confirmed.');
}
export function createPhotosAPI(environment) {
 return (operation,args={})=>photosOperation(operation,args,environment);
}
