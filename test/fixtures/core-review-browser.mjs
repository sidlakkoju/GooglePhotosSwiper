// Isolated browser QA. Synthetic media, in-memory SQLite, no Google requests.
import {readFile} from 'node:fs/promises';
import {createApp} from '../../server.mjs';
import {hash} from '../../lib/store.mjs';
const pagination=process.argv.includes('--pagination');
const video=await readFile((process.argv[2]&&!process.argv[2].startsWith('--')?process.argv[2]:null)||new URL('./synthetic-video.mov',import.meta.url));
const app=createApp({loginCode:'synthetic-browser-qa',mediaFetch:async()=>new Response(video,{headers:{'Content-Type':'video/quicktime','Content-Length':String(video.length)}})});
app.store.setSetting('account','synthetic');app.store.setSetting('accountLabel','Synthetic browser test');app.store.db.prepare('INSERT INTO pairs VALUES (?,?,?)').run(hash('synthetic-token'),'synthetic','Synthetic browser test');
app.store.importItems([{mediaKey:'testphoto',name:'Synthetic photo.jpg',type:'photo',size:1000000},{mediaKey:'testvideo',name:'Synthetic video.mov',type:'video',size:2000000,duration:3000},{mediaKey:'nextphoto',name:'Next synthetic photo.jpg',type:'photo',size:3000000}].map(i=>({...i,thumbUrl:'https://lh3.googleusercontent.com/synthetic'})),'synthetic');
const paginationItems=Array.from({length:50},(_,n)=>({mediaKey:'reviewed'+n,name:`Reviewed ${n}.jpg`,type:'photo',size:1000,thumbUrl:'https://lh3.googleusercontent.com/synthetic'}));
if(pagination){app.store.db.prepare('DELETE FROM items').run();app.store.importItems(paginationItems,'synthetic');for(const i of app.store.listItems())app.store.decide(i.id,'keep',0);app.store.setSetting('cursor','qa-page-1');app.store.setSetting('exhausted','false');}
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#426b53"/><circle cx="600" cy="360" r="190" fill="#dce8cc"/><text x="600" y="640" fill="white" font-size="44" text-anchor="middle">Synthetic preview</text></svg>';
const videoPoster='data:image/png;base64,'+(await readFile(new URL('./synthetic-video-poster.png',import.meta.url))).toString('base64');
const bridge=`window.addEventListener('message',async e=>{if(e.source!==window||e.data?.channel!=='photos-swipe-request')return;const {id,operation,args}=e.data;window.postMessage({channel:'photos-swipe-ack',id},location.origin);try{let data;if(operation==='status')data={installed:true,paired:true,version:'QA',label:'Synthetic browser test',reconciliationSupported:true,paginationSupported:true};else if(operation==='preview'){const r=await fetch('/qa-preview/'+encodeURIComponent(args.id));data=await r.json();if(!r.ok)throw Error(data.error);}else if(operation==='video')data={url:'https://lh3.googleusercontent.com/synthetic-video'};else if(operation==='sendAlbum'){const r=await fetch('/qa-album/'+args.jobId,{method:'POST'});data=await r.json();if(!r.ok)throw Error(data.error);}else if(operation==='import'){if(${pagination}){const r=await fetch('/qa-page',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});data=await r.json();if(!r.ok)throw Error(data.error);}else data={count:0};}else if(operation==='reconcile')data={inTrash:0,restored:0};else throw Error('Unexpected QA command '+operation);window.postMessage({channel:'photos-swipe-response',id,ok:true,data},location.origin);}catch(error){window.postMessage({channel:'photos-swipe-response',id,ok:false,error:error.message},location.origin);}});`;
const original=app.server.listeners('request')[0];app.server.removeAllListeners('request');
app.server.on('request',async(req,res)=>{
 if(pagination&&req.url==='/qa-page'&&req.method==='POST'){
  try{let raw='';for await(const c of req)raw+=c;const {restart=false}=JSON.parse(raw||'{}');const cursor=app.store.getSetting('cursor')||null;
   const page=restart?'qa-page-1':cursor;
   if(!['qa-page-1','qa-page-2','qa-page-3'].includes(page))throw Error('Unexpected synthetic pagination');
   const items=page==='qa-page-3'?Array.from({length:50},(_,n)=>({mediaKey:'fresh'+n,name:`Fresh ${n}.${n%15===0?'mov':'jpg'}`,type:n%15===0?'video':'photo',size:2000000,duration:n%15===0?3000:null,thumbUrl:'https://lh3.googleusercontent.com/synthetic'})):paginationItems;
   const nextPageId=page==='qa-page-1'?'qa-page-2':page==='qa-page-2'?'qa-page-3':null;
   const result=app.store.importPage(items,'synthetic',{requestCursor:restart?null:cursor,refreshLatest:restart,nextPageId});res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
  }catch(error){res.writeHead(409,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}return;
 }
 if(req.url?.startsWith('/qa-preview/')){const item=app.store.listItems().find(i=>i.id===decodeURIComponent(req.url.slice('/qa-preview/'.length)));res.writeHead(item?200:404,{'Content-Type':'application/json'});res.end(JSON.stringify(item?{dataUrl:item.type==='video'?videoPoster:'data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64')}:{error:'Synthetic item not found'}));return;}
 if(req.url==='/qa-bridge.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(bridge);return;}
 if(req.url?.startsWith('/qa-album/')&&req.method==='POST'){try{const job=app.store.getJob(req.url.slice('/qa-album/'.length));res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(app.store.progressJob(job.id,{status:'completed',albumKey:'synthetic-album',confirmed:job.mediaKeys})));}catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}return;}
 if(req.url==='/'){const html=(await readFile(new URL('../../public/index.html',import.meta.url),'utf8')).replace('<script type="module" src="/app.js">','<script type="module" src="/qa-bridge.js"></script><script type="module" src="/app.js">');res.writeHead(200,{'Content-Type':'text/html'});res.end(html);return;}
 original(req,res);
});
app.server.listen(3001,'127.0.0.1',()=>console.log('Synthetic QA: http://localhost:3001/#unlock=synthetic-browser-qa'));
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>app.server.close(()=>process.exit(0)));
