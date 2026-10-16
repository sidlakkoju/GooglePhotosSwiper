export const demoPalettes={
 sunset:{sky:['#FF8E5E','#FFB487'],sun:'#FFF1C7',far:'#C0707F',near:'#5C3758',water:['#E7A38C','#7E5574']},
 golden:{sky:['#FFC46B','#FF9A57'],sun:'#FFF6DA',far:'#C76A4E',near:'#6B3A3A',water:['#F0A070','#9A5550']},
 dusk:{sky:['#3B2E6E','#E3778A'],sun:'#FFD1A8',far:'#7A4F86',near:'#3A2A52',water:['#C76D86','#46325E']},
 lake:{sky:['#5E9FE6','#A9D2F2'],sun:'#F7F5DE',far:'#9DB6C9',near:'#2F5D45',water:['#4F8DB5','#2B648A']},
 alpine:{sky:['#9ED6F3','#FDF0D3'],sun:'#FFFBE8',far:'#7EA7C4',near:'#3F6F5A',water:['#6AA6C9','#3A759B'],snow:true},
 night:{sky:['#0F1534','#2A356B'],sun:'#E8E2C0',far:'#2B3566',near:'#121733',water:['#1E2A5C','#0E1638'],stars:true},
 dawn:{sky:['#F2C3BE','#C9D6EA'],sun:'#FFFFFF',far:'#A9B4C9',near:'#6C7A92',water:['#B8C6DC','#7F8FAD']},
 desert:{sky:['#F6D29C','#F3C38E'],sun:'#FFF8EC',far:'#D9A066',near:'#A8683E',water:['#D9A46C','#B4774A'],sand:true},
 desertDusk:{sky:['#F2A57C','#7A5FA0'],sun:'#FFE6C4',far:'#B56A6A',near:'#5A3A4F',water:['#C98A6A','#6E4558'],sand:true},
 teal:{sky:['#94DCCB','#C9F0E4'],sun:'#FBF8DC',far:'#5FB59A',near:'#2E7D6A',water:['#2FB3C4','#1B8399']},
 tropical:{sky:['#FF8F6B','#6B4A9E'],sun:'#FFE0A3',far:'#4A3F7A',near:'#1F2A4A',water:['#6B5AA8','#28285A']},
 lavender:{sky:['#D2AEEE','#E6CDF6'],sun:'#FDF2FB',far:'#A07AC8',near:'#6A4A8F',water:['#B58AD8','#83599F']},
 glacier:{sky:['#BCE1F4','#E8F5FB'],sun:'#FFFFFF',far:'#8FB3C9',near:'#3D6B7D',water:['#4CC3D0','#25879C'],snow:true}
};
export const demoLibrary=[
 {key:'bigsur-1',file:'IMG_4820.HEIC',palette:'sunset',place:'Big Sur, CA',date:'2025-06-14T19:42:00-07:00',size:2.1e6,seed:11},
 {key:'bigsur-2',file:'IMG_4821.HEIC',palette:'golden',place:'Big Sur, CA',date:'2025-06-14T19:58:00-07:00',size:2.4e6,seed:12},
 {key:'bigsur-3',file:'IMG_4824.HEIC',palette:'dusk',place:'Big Sur, CA',date:'2025-06-14T20:31:00-07:00',size:3.2e6,seed:13,landscape:true},
 {key:'tahoe-1',file:'IMG_2317.HEIC',palette:'lake',place:'Lake Tahoe, CA',date:'2024-08-02T10:14:00-07:00',size:4.6e6,seed:21},
 {key:'tahoe-video',file:'IMG_2318.MOV',palette:'lake',place:'Lake Tahoe, CA',date:'2024-08-02T10:16:00-07:00',size:7.9e6,seed:22,video:'lake-loop.mp4',duration:4000},
 {key:'tahoe-2',file:'IMG_2325.HEIC',palette:'alpine',place:'Lake Tahoe, CA',date:'2024-08-02T11:03:00-07:00',size:3.8e6,seed:23,free:true},
 {key:'joshua-1',file:'IMG_3391.JPG',palette:'desert',place:'Joshua Tree, CA',date:'2025-03-09T13:20:00-07:00',size:5.3e6,seed:31},
 {key:'joshua-2',file:'IMG_3402.JPG',palette:'desertDusk',place:'Joshua Tree, CA',date:'2025-03-09T18:47:00-07:00',size:2.9e6,seed:32,landscape:true},
 {key:'yosemite-1',file:'IMG_0917.HEIC',palette:'night',place:'Yosemite Valley, CA',date:'2024-10-19T22:05:00-07:00',size:6.4e6,seed:41},
 {key:'yosemite-2',file:'IMG_0931.HEIC',palette:'dawn',place:'Yosemite Valley, CA',date:'2024-10-20T06:52:00-07:00',size:1.7e6,seed:42},
 {key:'maui-1',file:'IMG_5512.HEIC',palette:'teal',place:'Kapalua, Maui',date:'2025-01-24T15:10:00-10:00',size:3.5e6,seed:51},
 {key:'maui-2',file:'IMG_5530.HEIC',palette:'tropical',place:'Kapalua, Maui',date:'2025-01-24T18:36:00-10:00',size:4.1e6,seed:52,free:true},
 {key:'valensole-1',file:'IMG_6203.HEIC',palette:'lavender',place:'Valensole, France',date:'2025-07-06T09:28:00+02:00',size:2.6e6,seed:61},
 {key:'banff-1',file:'IMG_1148.HEIC',palette:'glacier',place:'Banff, Alberta',date:'2024-09-12T08:15:00-06:00',size:5.8e6,seed:71}
];
function seeded(seed){let value=seed>>>0||1;return ()=>{value=Math.imul(value^value>>>15,0x2c1b3c6d)+0x9e3779b9>>>0;value^=value>>>13;return (value>>>0)/4294967296;};}
function ridge(random,width,base,height,peaks){const points=[[0,base-height*(.3+random()*.4)]];const step=width/peaks;for(let index=1;index<=peaks;index++){const x=index*step-step*random()*.5;points.push([x-step*.5,base-height*(.85+random()*.25)]);points.push([x,base-height*(.25+random()*.45)]);}points.push([width,base-height*(.35+random()*.45)]);return points.map(([x,y])=>[Math.round(Math.max(0,Math.min(width,x))),Math.round(y)]);}
const path=points=>points.map(([x,y],index)=>`${index?'L':'M'}${x} ${y}`).join('');
export function demoLandscapeSVG(name,{seed=1,width=900,height=1200}={}) {
 const palette=demoPalettes[name],random=seeded(seed),horizon=Math.round(height*.58),sunX=Math.round(width*(.3+random()*.4)),sunY=Math.round(height*(.2+random()*.08)),sunR=Math.round(Math.min(width,height)*.11);
 const far=ridge(random,width,horizon,height*.24,3+Math.floor(random()*2)),near=ridge(random,width,horizon,height*.12,2+Math.floor(random()*3));
 const id=`${name}${seed}`,parts=[];
 parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
 parts.push(`<defs><linearGradient id="s${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${palette.sky[0]}"/><stop offset="1" stop-color="${palette.sky[1]}"/></linearGradient><linearGradient id="w${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${palette.water[0]}"/><stop offset="1" stop-color="${palette.water[1]}"/></linearGradient><radialGradient id="g${id}"><stop offset="0" stop-color="${palette.sun}" stop-opacity=".55"/><stop offset="1" stop-color="${palette.sun}" stop-opacity="0"/></radialGradient></defs>`);
 parts.push(`<rect width="${width}" height="${horizon}" fill="url(#s${id})"/>`);
 if(palette.stars)for(let index=0;index<70;index++)parts.push(`<circle cx="${Math.round(random()*width)}" cy="${Math.round(random()*horizon*.8)}" r="${(random()*1.8+.6).toFixed(1)}" fill="#FFFFFF" opacity="${(random()*.6+.3).toFixed(2)}"/>`);
 parts.push(`<circle cx="${sunX}" cy="${sunY}" r="${sunR*2.6}" fill="url(#g${id})"/><circle cx="${sunX}" cy="${sunY}" r="${sunR}" fill="${palette.sun}"/>`);
 if(!palette.stars)for(let index=0;index<2;index++){const y=Math.round(height*(.12+random()*.2)),x=Math.round(random()*width);parts.push(`<ellipse cx="${x}" cy="${y}" rx="${Math.round(width*(.14+random()*.1))}" ry="${Math.round(height*.012+random()*8)}" fill="#FFFFFF" opacity=".22"/>`);}
 parts.push(`<path d="${path(far)}L${width} ${horizon}L0 ${horizon}Z" fill="${palette.far}"/>`);
 if(palette.snow)for(let index=1;index<far.length-1;index++){const [x,y]=far[index];if(y<horizon-height*.17)parts.push(`<path d="M${x-26} ${y+30}L${x} ${y}L${x+24} ${y+28}L${x+8} ${y+22}L${x-6} ${y+34}Z" fill="#FFFFFF" opacity=".85"/>`);}
 parts.push(`<path d="${path(near)}L${width} ${horizon}L0 ${horizon}Z" fill="${palette.near}"/>`);
 parts.push(`<rect y="${horizon}" width="${width}" height="${height-horizon}" fill="url(#w${id})"/>`);
 parts.push(`<path d="${path(near.map(([x,y])=>[x,2*horizon-y]))}L${width} ${horizon}L0 ${horizon}Z" fill="${palette.near}" opacity=".28"/>`);
 if(!palette.sand){parts.push(`<ellipse cx="${sunX}" cy="${Math.round(horizon+(height-horizon)*.42)}" rx="${Math.round(sunR*.32)}" ry="${Math.round((height-horizon)*.34)}" fill="${palette.sun}" opacity=".32"/>`);for(let index=0;index<5;index++){const y=Math.round(horizon+(height-horizon)*(.12+index*.17));parts.push(`<rect x="${Math.round(sunX-sunR*(.9-index*.1))}" y="${y}" width="${Math.round(sunR*(1.8-index*.2))}" height="3" rx="1.5" fill="${palette.sun}" opacity=".35"/>`);}}
 else for(let index=0;index<4;index++){const y=Math.round(horizon+(height-horizon)*(.2+index*.2));parts.push(`<path d="M0 ${y}Q${width*.3} ${y-18} ${width*.55} ${y}T${width} ${y-6}" stroke="${palette.near}" stroke-width="3" fill="none" opacity=".25"/>`);}
 parts.push('</svg>');
 return parts.join('');
}
export const demoMediaFile=entry=>`${entry.key}.svg`;
export function demoItems(base,library=demoLibrary) {
 return library.map(entry=>{
  const date=new Date(entry.date),zone=/([+-])(\d\d):(\d\d)$/.exec(entry.date),offset=zone?(zone[1]==='-'?-1:1)*(Number(zone[2])*60+Number(zone[3]))*60000:null;
  const [width,height]=entry.landscape?[1200,900]:[900,1200];
  return {mediaKey:`AF1QipDemo${entry.key.replace(/[^A-Za-z0-9]/g,'')}`,dedupKey:`demo-${entry.key}`,name:entry.file,type:entry.video?'video':'photo',date:date.toISOString(),timezoneOffset:offset,thumbUrl:new URL(demoMediaFile(entry),base).href,videoUrl:entry.video?new URL(entry.video,base).href:null,width,height,...(entry.video?{duration:entry.duration}:{}),locationName:entry.place,location:null,size:Math.round(entry.size),spaceTaken:entry.free?0:Math.round(entry.size),takesUpSpace:!entry.free};
 });
}
export function demoPastDecisions(now=Date.now(),{days=21,seed=2024}={}) {
 const random=seeded(seed),today=new Date(now);today.setHours(0,0,0,0);
 const evening=(ago,hour)=>{const date=new Date(today);date.setDate(date.getDate()-ago);return date.getTime()+hour*3600000;};
 const sweeps=[days-3,days-7,days-12,days-16,1].filter(ago=>ago>=1).sort((a,b)=>b-a);
 const items=[];
 for(let ago=days;ago>=1;ago--){
  if(random()<.3)continue;
  const count=4+Math.floor(random()*(ago%6===0?40:22)),start=18+random()*2.5;
  for(let index=0;index<count;index++){
   const at=Math.round(evening(ago,start+index*.012+random()*.01)),video=random()<.08,free=!video&&random()<.15,size=Math.round((video?18e6+random()*60e6:1.2e6+random()*6e6));
   const remove=random()<(video?.55:.3),sweep=sweeps.find(day=>day<=ago&&evening(day,21.5)>at),trashedAt=remove&&sweep!==undefined?evening(sweep,21.5):null;
   items.push({mediaKey:`demo-past-${items.length}`,type:video?'video':'photo',decision:remove?'remove':'keep',lastDecisionAt:at,size,spaceTaken:free?0:size,takesUpSpace:!free,state:remove?'in_trash':'active',...(trashedAt?{trashedAt}:{})});
  }
 }
 return items;
}
export function createDemoPhotos({items}) {
 const trashed=new Set(),find=mediaKey=>{const item=items.find(row=>row.mediaKey===mediaKey);if(!item)throw Error('Unknown demo item.');return item;};
 const listed=item=>{const {videoUrl:_unused,...row}=item;return {...row};};
 const handlers={
  identity:()=>({account:'photos-swipe-demo',label:'Demo library'}),
  library:()=>({items:items.filter(item=>!trashed.has(item.mediaKey)).map(listed),nextPageId:null}),
  mediaURL:({mediaKey})=>({url:find(mediaKey).thumbUrl}),
  video:({mediaKey})=>{const item=find(mediaKey);if(!item.videoUrl)throw Error('Not a video.');return {url:item.videoUrl};},
  moveToTrash:({dedupKeys=[]})=>{const keys=new Set(dedupKeys);for(const item of items)if(keys.has(item.dedupKey))trashed.add(item.mediaKey);return {requested:keys.size};},
  trashPage:()=>({items:items.filter(item=>trashed.has(item.mediaKey)).map(item=>({mediaKey:item.mediaKey,dedupKey:item.dedupKey})),nextPageId:null}),
  itemState:({mediaKey})=>({state:trashed.has(mediaKey)?'in_trash':'active'})
 };
 const call=async(operation,args={})=>{
  const handler=Object.hasOwn(handlers,operation)?handlers[operation]:null;
  if(!handler)return {ok:false,error:'That isn’t available in the demo.'};
  try{return {ok:true,data:structuredClone(handler(args))};}catch(error){return {ok:false,error:error.message};}
 };
 return {call,trashed,calls:handlers};
}
export function createMemoryIndexedDB() {
 const databases=new Map();
 const later=task=>Promise.resolve().then(task);
 function database(stores){
  return {
   objectStoreNames:{contains:name=>stores.has(name)},
   createObjectStore:name=>{stores.set(name,new Map());},
   close(){},
   transaction(names,mode='readonly'){
    const scope=[].concat(names),staged=new Map(scope.map(name=>[name,new Map(stores.get(name))]));let pending=0,finished=false,aborted=false,wrote=false;
    const tx={error:null,oncomplete:null,onabort:null,onerror:null};
    const settle=()=>later(()=>{if(finished||aborted||pending>0)return;finished=true;if(wrote&&mode==='readwrite')for(const [name,table] of staged)stores.set(name,table);tx.oncomplete?.();});
    tx.abort=()=>{if(finished||aborted)return;aborted=true;later(()=>tx.onabort?.());};
    tx.objectStore=name=>{
     const table=staged.get(name);if(!table)throw Error(`Unknown store ${name}`);
     return {
      get(key){const request={result:undefined,onsuccess:null,onerror:null};pending++;later(()=>{if(aborted)return;request.result=structuredClone(table.get(key));try{request.onsuccess?.();}finally{pending--;settle();}});return request;},
      put(value,key){if(mode!=='readwrite')throw Error('Read-only transaction.');wrote=true;table.set(key,structuredClone(value));},
      delete(key){if(mode!=='readwrite')throw Error('Read-only transaction.');wrote=true;table.delete(key);}
     };
    };
    settle();
    return tx;
   }
  };
 }
 return {
  open(name){
   const request={result:null,error:null,onsuccess:null,onerror:null,onupgradeneeded:null,onblocked:null};
   later(()=>{let stores=databases.get(name);const created=!stores;if(created){stores=new Map();databases.set(name,stores);}request.result=database(stores);if(created)request.onupgradeneeded?.();request.onsuccess?.();});
   return request;
  },
  databases:async()=>[...databases.keys()].map(name=>({name,version:2}))
 };
}
export function demoSafeTop(value){const text=String(value??'').trim();if(!/^\d+(\.\d+)?$/.test(text))return null;const number=Number(text);return number<=100?number:null;}
export function createDemoEnvironment({window,document,location,base,embed=false,top=null,scheme=null,version='demo'}) {
 const items=demoItems(base),photos=createDemoPhotos({items});
 let firstSwipe=false,announced=false;
 const parent=window.parent&&window.parent!==window?window.parent:null;
 const post=event=>{try{parent?.postMessage({type:'photos-swipe-demo',event},'*');}catch{}};
 const reset=()=>{try{window.location.reload();}catch{}};
 window.addEventListener('message',event=>{if(!parent||event.source!==parent)return;if(event.data?.type==='photos-swipe-demo'&&event.data.command==='reset')reset();});
 return {
  version,autoUpdating:false,window,document,location,crypto:window.crypto,
  indexedDB:createMemoryIndexedDB(),
  fetch:()=>Promise.reject(Error('The demo makes no network requests.')),
  AbortController:window.AbortController,setTimeout:window.setTimeout.bind(window),clearTimeout:window.clearTimeout.bind(window),
  photosCall:photos.call,
  demo:{embed,safeTop:embed?demoSafeTop(top):null,scheme:['dark','light'].includes(scheme)?scheme:null,reset,history:demoPastDecisions(),notify(event){if(event==='ready'&&!announced){announced=true;post('ready');}if(event==='decision'&&!firstSwipe){firstSwipe=true;post('first-swipe');}if(event==='escape')post('escape');}}
 };
}
