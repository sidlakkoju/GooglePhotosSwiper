let database;
async function db(){return database ||= new Promise((resolve,reject)=>{const r=indexedDB.open('photos-swipe-previews',1);r.onupgradeneeded=()=>r.result.createObjectStore('previews');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function request(mode,action){const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction('previews',mode),r=action(tx.objectStore('previews'));r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export const cached=id=>request('readonly',s=>s.get(id));
export const evict=id=>request('readwrite',s=>s.delete(id));
export const cache=(id,blob)=>request('readwrite',s=>s.put(blob,id));
export function dataBlob(url){const match=/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(url);if(!match)throw Error('Invalid image preview.');const binary=atob(match[2]),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return new Blob([bytes],{type:match[1]});}
