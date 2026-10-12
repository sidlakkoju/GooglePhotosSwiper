import {reviewStorage} from './userscript-core.mjs';
export function createSessionStorageCounter() {
 const excluded=new Set(),seen=new Set();
 function total(items){
  for(const item of items){if(!seen.has(item.mediaKey)&&item.state==='in_trash')excluded.add(item.mediaKey);seen.add(item.mediaKey);}
  for(const item of items)if(item.decision!=='remove'&&item.state!=='in_trash')excluded.delete(item.mediaKey);
  return reviewStorage(items.filter(item=>item.decision==='remove'&&!item.needsPreview&&!excluded.has(item.mediaKey))).bytes;
 }
 return {total,reset(items){for(const item of items)if(item.decision==='remove'||item.state==='in_trash')excluded.add(item.mediaKey);}};
}
export function formatStorageBytes(bytes){const [value,unit]=bytes>=1e9?[bytes/1e9,'GB']:[bytes/1e6,'MB'];return `${value>=100?value.toFixed(0):value>=10?value.toFixed(1):value.toFixed(2)} ${unit}`;}
export function createStorageCapsule({document,window,root,element,isVisible}) {
 const renderingWindow=document.defaultView||window;
 const style=document.createElement('style');style.textContent='.storage-counter{position:absolute;left:50%;top:50%;width:0;height:0;z-index:3}\n.storage-orb{position:absolute;left:0;top:0;transform:translate(-50%,-50%) scale(var(--s,1),var(--sy,1))}\n.spin{position:relative}\n.spin svg{display:block;overflow:visible;filter:drop-shadow(0 0 5px var(--gl,transparent))}\n.face{position:absolute;left:50%;top:50%;width:0;height:0;pointer-events:none;color:#161616;font-variant-numeric:tabular-nums;line-height:1}\n.face span{position:absolute;top:0;left:0;font-weight:800;white-space:pre;transform-origin:50% 50%;will-change:transform,opacity}\n.face span.u{font-size:.74em}\n.storage-chip{opacity:0;pointer-events:none;white-space:nowrap;border-radius:11px;position:absolute;left:auto;right:auto;top:auto;transform:none;z-index:4;background:var(--chipc,#34C759);color:#161616;box-shadow:none;font-weight:700;font-size:11px;line-height:14px;padding:2px 7px}\n.storage-chip.go{animation:fly2 1.1s ease-out forwards}\n.storage-chip.hold{opacity:1;transform:translate(-50%,0)}\n@keyframes fly2{0%{opacity:0;transform:translate(-50%,6px) scale(.6)}20%{opacity:1;transform:translate(-50%,0) scale(1.05)}100%{opacity:0;transform:translate(-50%,-22px) scale(.95)}}\n .content>header:first-child{position:relative;height:56px}.content header #settings{margin-right:auto}.content .storage-counter{overflow:visible;padding:0;background:none;min-width:0}.content .storage-orb svg{width:auto;height:auto}.queue-size{color:var(--ps-label2);font-variant-numeric:tabular-nums}.trash-badge{background:var(--ps-destructive)}'; root.append(style);
 const orb=document.createElement('div'),chip=document.createElement('span');orb.className='storage-orb';chip.className='storage-chip';element.append(orb,chip);element.setAttribute('role','img');element.title='Approximate storage freed: queued plus trashed this session';
 const mctx=document.createElement('canvas').getContext('2d');
const tOf=b=>Math.min(1,Math.max(0,Math.log10(Math.max(b,1)/1e6)/Math.log10(5e4)));
const STOPS=[[0,[52,199,89]],[.3,[255,214,10]],[.5,[255,176,130]],[.72,[255,128,48]],[1,[255,69,58]]];
function rgb(t){for(let i=0;i<STOPS.length-1;i++){const[a,c]=STOPS[i],[b,d]=STOPS[i+1];if(t<=b){const k=(t-a)/(b-a);return c.map((v,j)=>Math.round(v+(d[j]-v)*k))}}return STOPS.at(-1)[1]}
const col=(t,al=1)=>`rgba(${rgb(t).join(',')},${al})`;
function fmt(b){const[v,u]=b>=1e9?[b/1e9,'GB']:[b/1e6,'MB'];return[v>=100?v.toFixed(0):v>=10?v.toFixed(1):v.toFixed(2),u]}
const dims=t=>({w:78+38*t,h:32+6*t,f:13+2.5*t});

function capsule(w,h){const r=h/2,L=w/2-r,n=2.15,N=28,p=[];const e=(a)=>[Math.sign(Math.cos(a))*Math.pow(Math.abs(Math.cos(a)),2/n)*r,Math.sign(Math.sin(a))*Math.pow(Math.abs(Math.sin(a)),2/n)*r];
 for(let i=0;i<=N;i++){const a=-Math.PI/2+Math.PI*i/N,[x,y]=e(a);p.push([L+x,y])}for(let i=0;i<=N;i++){const a=Math.PI/2+Math.PI*i/N,[x,y]=e(a);p.push([-L+x,y])}
 return 'M'+p.map(q=>q[0].toFixed(2)+','+q[1].toFixed(2)).join('L')+'Z'}
let gid=0;
function mkOrb(el){
 const id='ps-storage-gradient-'+(gid++),spin=document.createElement('div'),face=document.createElement('div');spin.setAttribute('class','spin');face.setAttribute('class','face');face.setAttribute('aria-hidden','true');
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),defs=document.createElementNS('http://www.w3.org/2000/svg','defs');svg.setAttribute('aria-hidden','true');svg.append(defs);
 for(const [suffix,attributes,stops] of [['',{x1:0,x2:1},[[0,'#000',.13],[.22,'#000',0],[.78,'#000',0],[1,'#000',.13]]],['v',{x1:0,x2:0,y1:0,y2:1},[[0,'#fff',.10],[.35,'#fff',0],[.75,'#000',0],[1,'#000',.07]]]]){
  const gradient=document.createElementNS('http://www.w3.org/2000/svg','linearGradient');gradient.setAttribute('id',id+suffix);for(const [key,value] of Object.entries(attributes))gradient.setAttribute(key,value);
  for(const [offset,color,opacity] of stops){const stop=document.createElementNS('http://www.w3.org/2000/svg','stop');stop.setAttribute('offset',offset);stop.setAttribute('stop-color',color);stop.setAttribute('stop-opacity',opacity);gradient.append(stop);}defs.append(gradient);
 }
 const paths=['b','l','l2'].map((name,index)=>{const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('class',name);if(index)path.setAttribute('fill',`url(#${id}${index===2?'v':''})`);svg.append(path);return path;});spin.append(svg,face);el.append(spin);
 return {el,svg,b:paths[0],l:paths[1],l2:paths[2],face,txt:'',g:[]};
}
function layout(o,f){const[n,u]=o.lbl;const parts=[];for(const ch of n)parts.push([ch,f,0]);parts.push([' ',f*.74,1]);for(const ch of u)parts.push([ch,f*.74,1]);
 o.face.replaceChildren();let x=0;const ws=parts.map(([c,sz])=>{mctx.font=`800 ${sz}px -apple-system,system-ui,Inter,sans-serif`;return mctx.measureText(c).width});const W=ws.reduce((a,b)=>a+b,0);
 o.g=parts.map(([c,sz,isu],i)=>{const sp=document.createElement('span');sp.textContent=c;sp.style.fontSize=sz+'px';if(isu)sp.className='u';o.face.append(sp);const cx=x+ws[i]/2-W/2;x+=ws[i];return{sp,cx,w:ws[i],sz}})}
function paint(o,b,th){const t=tOf(b),{w,h,f}=dims(t),R=w/2;
 o.svg.setAttribute('width',w);o.svg.setAttribute('height',h);o.svg.setAttribute('viewBox',`${-w/2} ${-h/2} ${w} ${h}`);
 const d=capsule(w,h);for(const e of[o.b,o.l,o.l2])e.setAttribute('d',d);o.b.setAttribute('fill',col(t));
 o.svg.style.setProperty('--gl',col(t,.28));
 const lbl=fmt(b),key=lbl.join(' ')+'|'+f.toFixed(1);if(key!==o.txt){o.txt=key;o.lbl=lbl;layout(o,f)}
 const Rt=R*0.98;
 for(const g of o.g){const a=th+g.cx/Rt,c=Math.cos(a),x=Rt*Math.sin(a);

  const op=Math.min(1,Math.max(0,(c-0.18)/0.3));
  g.sp.style.opacity=op.toFixed(3);
  g.sp.style.transform=`translate(${(x-g.w/2).toFixed(2)}px,${(-g.sz*0.5).toFixed(2)}px) scaleX(${Math.max(.02,c).toFixed(3)})`}
 return t}

const HOLD=900,TURN=550;function spinAngle(t){const k=t%(HOLD+TURN);if(k<HOLD)return 0;const p=(k-HOLD)/TURN;const c1=1.85,c3=c1+1,e=1+c3*Math.pow(p-1,3)+c1*Math.pow(p-1,2);return 2*Math.PI*e}

 const o=mkOrb(orb),motion=renderingWindow.matchMedia?.('(prefers-reduced-motion: reduce)');
 let current=0,target=0,from=0,started=0,frame=null,last=0,origin=0,y=0,vy=0;
 function paintFrame(now){
  frame=null;
  if(!isVisible()||document.hidden)return;
  if(!origin)origin=now;
  const reduced=motion?.matches,dt=Math.min(.033,Math.max(0,(now-last)/1000));last=now;
  const k=reduced?1:Math.min(1,(now-started)/550);current=from+(target-from)*(1-Math.pow(1-k,3));
  vy+=(-320*y-11*vy)*dt;y+=vy*dt;
  orb.style.setProperty('--s',(1+(reduced?0:y)).toFixed(4));orb.style.setProperty('--sy',(1-(reduced?0:y)*1.3).toFixed(4));
  const t=paint(o,current,reduced?0:spinAngle(now-origin)),{w,h}=dims(t);element.style.setProperty('--chipc',col(t));chip.style.top=(h/2+3)+'px';chip.style.left=(w/2+4)+'px';
  if(!reduced||k<1)frame=renderingWindow.requestAnimationFrame(paintFrame);
 }
 function wake(){if(frame===null&&isVisible()&&!document.hidden)frame=renderingWindow.requestAnimationFrame(paintFrame);}
 document.addEventListener('visibilitychange',wake);
 return {update(bytes,{animate=false,delta=0}={}){
  if(bytes!==target){from=animate?current:bytes;target=bytes;started=renderingWindow.performance.now();if(!animate)current=bytes;}
  element.setAttribute('aria-label',`${formatStorageBytes(bytes)} approximate storage freed this session`);
  if(animate&&delta>0){chip.textContent='+'+formatStorageBytes(delta);chip.classList.remove('go');if(!motion?.matches){void chip.offsetWidth;chip.classList.add('go');vy+=2.4;}}
  if(!animate)paint(o,current,0);
  wake();
 },reset(){current=target=from=0;y=vy=0;chip.classList.remove('go');this.update(0);}};
}
