import {writeFile,mkdir} from 'node:fs/promises';
import {webkit} from 'playwright';
import {demoLibrary,demoLandscapeSVG} from '../lib/userscript-demo.mjs';
const entry=demoLibrary.find(row=>row.video);
const svg=demoLandscapeSVG(entry.palette,{seed:entry.seed});
const browser=await webkit.launch();
try{
 const page=await browser.newPage();
 const base64=await page.evaluate(async({svg,seconds})=>{
  const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(svg);await image.decode();
  const canvas=document.createElement('canvas');canvas.width=540;canvas.height=720;document.body.append(canvas);
  const context=canvas.getContext('2d'),horizon=canvas.height*.58,period=seconds*1000;
  const draw=time=>{
   const phase=(time%period)/period*Math.PI*2;
   context.drawImage(image,0,0,canvas.width,canvas.height);
   context.save();context.globalAlpha=.16+.06*Math.sin(phase);context.fillStyle='#FFFFFF';
   context.beginPath();context.ellipse(canvas.width*(.25+.5*((time%period)/period)),canvas.height*.17,canvas.width*.16,10,0,0,Math.PI*2);context.fill();context.restore();
   for(let row=0;row<14;row++){
    const y=horizon+12+row*((canvas.height-horizon-16)/14),width=40+((row*37)%70),offset=Math.sin(phase+row*.9)*28;
    context.save();context.globalAlpha=.1+.12*(.5+.5*Math.sin(phase*2+row));context.fillStyle='#FFFFFF';
    context.fillRect((row*97)%canvas.width+offset,y,width,2);context.fillRect((row*211+180)%canvas.width-offset,y+6,width*.6,2);context.restore();
   }
  };
  const stream=canvas.captureStream(30),chunks=[];
  const recorder=new MediaRecorder(stream,{mimeType:'video/mp4;codecs=avc1',videoBitsPerSecond:1400000});
  recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
  const stopped=new Promise(resolve=>{recorder.onstop=resolve;});
  const started=performance.now();draw(0);recorder.start(250);
  await new Promise(resolve=>{const frame=()=>{const time=performance.now()-started;draw(time);if(time<period)requestAnimationFrame(frame);else resolve();};requestAnimationFrame(frame);});
  recorder.stop();await stopped;
  const bytes=new Uint8Array(await new Blob(chunks,{type:'video/mp4'}).arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary);
 },{svg,seconds:entry.duration/1000});
 await mkdir(new URL('../demo/media/',import.meta.url),{recursive:true});
 const destination=new URL(`../demo/media/${entry.video}`,import.meta.url);
 await writeFile(destination,Buffer.from(base64,'base64'));
 console.log(`Recorded ${destination.pathname}`);
}finally{await browser.close();}
