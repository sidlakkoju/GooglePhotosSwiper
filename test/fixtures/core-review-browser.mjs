// Isolated browser QA. Synthetic media, in-memory SQLite, no Google requests.
import {readFile} from 'node:fs/promises';
import {createApp} from '../../server.mjs';
import {hash} from '../../lib/store.mjs';
const video=await readFile(process.argv[2]||new URL('./synthetic-video.mov',import.meta.url));
const app=createApp({loginCode:'synthetic-browser-qa',mediaFetch:async()=>new Response(video,{headers:{'Content-Type':'video/quicktime','Content-Length':String(video.length)}})});
app.store.setSetting('account','synthetic');app.store.setSetting('accountLabel','Synthetic browser test');app.store.db.prepare('INSERT INTO pairs VALUES (?,?,?)').run(hash('synthetic-token'),'synthetic','Synthetic browser test');
app.store.importItems([{mediaKey:'testphoto',name:'Synthetic photo.jpg',type:'photo',size:1000000},{mediaKey:'testvideo',name:'Synthetic video.mov',type:'video',size:2000000,duration:3000},{mediaKey:'nextphoto',name:'Next synthetic photo.jpg',type:'photo',size:3000000}].map(i=>({...i,thumbUrl:'https://lh3.googleusercontent.com/synthetic'})),'synthetic');
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#426b53"/><circle cx="600" cy="360" r="190" fill="#dce8cc"/><text x="600" y="640" fill="white" font-size="44" text-anchor="middle">Synthetic preview</text></svg>';
const bridge=`const preview=${JSON.stringify('data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64'))};window.addEventListener('message',async e=>{if(e.source!==window||e.data?.channel!=='photos-swipe-request')return;const {id,operation,args}=e.data;window.postMessage({channel:'photos-swipe-ack',id},location.origin);try{let data;if(operation==='status')data={installed:true,paired:true,version:'QA',label:'Synthetic browser test',reconciliationSupported:true};else if(operation==='preview')data={dataUrl:preview};else if(operation==='video')data={url:'https://lh3.googleusercontent.com/synthetic-video'};else if(operation==='sendAlbum'){const r=await fetch('/qa-album/'+args.jobId,{method:'POST'});data=await r.json();if(!r.ok)throw Error(data.error);}else if(operation==='import')data={count:0};else if(operation==='reconcile')data={inTrash:0,restored:0};else throw Error('Unexpected QA command '+operation);window.postMessage({channel:'photos-swipe-response',id,ok:true,data},location.origin);}catch(error){window.postMessage({channel:'photos-swipe-response',id,ok:false,error:error.message},location.origin);}});`;
const original=app.server.listeners('request')[0];app.server.removeAllListeners('request');
app.server.on('request',async(req,res)=>{
 if(req.url==='/qa-bridge.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(bridge);return;}
 if(req.url?.startsWith('/qa-album/')&&req.method==='POST'){try{const job=app.store.getJob(req.url.slice('/qa-album/'.length));res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(app.store.progressJob(job.id,{status:'completed',albumKey:'synthetic-album',confirmed:job.mediaKeys})));}catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}return;}
 if(req.url==='/'){const html=(await readFile(new URL('../../public/index.html',import.meta.url),'utf8')).replace('<script type="module" src="/app.js">','<script type="module" src="/qa-bridge.js"></script><script type="module" src="/app.js">');res.writeHead(200,{'Content-Type':'text/html'});res.end(html);return;}
 original(req,res);
});
app.server.listen(3001,'127.0.0.1',()=>console.log('Synthetic QA: http://localhost:3001/#unlock=synthetic-browser-qa'));
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>app.server.close(()=>process.exit(0)));
