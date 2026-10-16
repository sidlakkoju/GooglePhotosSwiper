import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,extname} from 'node:path';
import {spawnSync} from 'node:child_process';

let chromium;
try{({chromium}=await import('playwright'));}catch{}

const audit=()=>{
 const sr=document.getElementById('photos-swipe-userscript-host').shadowRoot;
 const name=e=>e.tagName.toLowerCase()+(e.id?'#'+e.id:e.classList.length?'.'+[...e.classList].slice(0,2).join('.'):'');
 const shown=e=>{const r=e.getBoundingClientRect();if(r.width<1||r.height<1)return false;for(let x=e;x&&x.nodeType===1;x=x.parentElement){const cs=getComputedStyle(x);if(cs.display==='none'||cs.visibility==='hidden'||+cs.opacity===0)return false;}return true;};
 const visible=e=>{const cs=getComputedStyle(e);return cs.backgroundColor!=='rgba(0, 0, 0, 0)'||cs.backgroundImage!=='none'||(cs.boxShadow!=='none'&&/inset/.test(cs.boxShadow))||parseFloat(cs.borderTopWidth)>0||(cs.backdropFilter&&cs.backdropFilter!=='none');};
 const radius=(e,corner)=>{const r=e.getBoundingClientRect();return Math.min(parseFloat(getComputedStyle(e)['border'+corner+'Radius'])||0,r.height/2,r.width/2);};
 const clipped=(e,a)=>{for(let x=e.parentElement;x;x=x.parentElement){if(getComputedStyle(x).overflow!=='visible')return true;if(x===a)break;}return false;};
 const elements=[...sr.querySelectorAll('*')].filter(e=>shown(e)&&visible(e));
 const corners=[],gaps=[],overlaps=[];
 for(const e of elements){
  if(e.tagName==='INPUT')continue;
  let a=e.parentElement;
  while(a&&!(visible(a)&&shown(a)&&['TopLeft','TopRight','BottomLeft','BottomRight'].some(c=>radius(a,c)>0)))a=a.parentElement;
  if(!a)continue;
  const er=e.getBoundingClientRect(),ar=a.getBoundingClientRect();
  for(const [corner,dx,dy] of [['TopLeft',er.left-ar.left,er.top-ar.top],['TopRight',ar.right-er.right,er.top-ar.top],['BottomLeft',er.left-ar.left,ar.bottom-er.bottom],['BottomRight',ar.right-er.right,ar.bottom-er.bottom]]){
   const R=radius(a,corner),r=radius(e,corner);
   if(R<=0||dx<0||dy<0||dx>=R||dy>=R)continue;
   if(dx<1.5&&dy<1.5&&clipped(e,a))continue;
   const want=Math.max(0,R-Math.max(dx,dy));
   if(Math.abs(r-want)>2.5||Math.abs(dx-dy)>3)corners.push(`${name(e)} in ${name(a)} ${corner}: r=${r.toFixed(1)} want=${want.toFixed(1)} inset=${dx.toFixed(1)}/${dy.toFixed(1)}`);
  }
 }
 for(const p of new Set(elements.map(e=>e.parentElement))){
  if(!p)continue;
  const kids=[...p.children].filter(k=>shown(k)&&visible(k)&&!['absolute','fixed'].includes(getComputedStyle(k).position));
  for(let i=1;i<kids.length;i++){
   const a=kids[i-1].getBoundingClientRect(),b=kids[i].getBoundingClientRect(),row=b.top<a.bottom-2&&a.top<b.bottom-2,gap=row?b.left-a.right:b.top-a.bottom;
   if(gap<6&&gap>-40&&!kids[i-1].classList.contains('trash-size'))gaps.push(`${name(kids[i-1])} | ${name(kids[i])}: ${gap.toFixed(1)}`);
  }
 }
 const header=[...sr.querySelector('.content > header').children].filter(shown);
 for(let i=0;i<header.length;i++)for(let j=i+1;j<header.length;j++){const a=header[i].getBoundingClientRect(),b=header[j].getBoundingClientRect();if(a.width>2&&b.width>2&&a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1)overlaps.push(`${name(header[i])} overlaps ${name(header[j])}`);}
 return {corners,gaps,overlaps};
};

test('every view keeps concentric corners, real gaps and a header without overlaps at phone, tablet and desktop sizes',{timeout:120000},async t=>{
 if(!chromium){t.skip('Playwright is unavailable');return;}
 const directory=await mkdtemp(join(tmpdir(),'photos-swipe-audit-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const built=spawnSync(process.execPath,['scripts/build-demo.mjs',directory],{encoding:'utf8'});
 assert.equal(built.status,0,built.stderr);
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const types={'.html':'text/html','.js':'text/javascript','.svg':'image/svg+xml','.mp4':'video/mp4'};
 for(const [width,height] of [[390,844],[768,1024],[1440,900]])for(const colorScheme of ['dark','light']){
  const page=await browser.newPage({viewport:{width,height},colorScheme});
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.hostname!=='demo.test')return route.abort();const path=url.pathname.slice(1)||'index.html';try{return route.fulfill({body:await readFile(join(directory,path)),contentType:types[extname(path)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}});
  await page.goto('https://demo.test/');
  await page.waitForFunction(()=>/to review/.test(document.getElementById('photos-swipe-userscript-host')?.shadowRoot.getElementById('stats')?.textContent||''),null,{timeout:15000});
  const click=selector=>page.evaluate(s=>document.getElementById('photos-swipe-userscript-host').shadowRoot.querySelector(s).click(),selector);
  await page.evaluate(()=>{document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('close').hidden=false;});
  await page.waitForTimeout(300);
  const views={swipe:await page.evaluate(audit)};
  await click('#settings');await page.waitForTimeout(600);
  views.settings=await page.evaluate(audit);
  await click('.settings-header button');await page.waitForTimeout(300);
  for(let i=0;i<3;i++){await click('#remove');await page.waitForTimeout(200);}
  await click('#review');await page.waitForTimeout(700);
  views.trash=await page.evaluate(audit);
  for(const [view,result] of Object.entries(views))assert.deepEqual(result,{corners:[],gaps:[],overlaps:[]},`${view} at ${width}x${height} ${colorScheme}`);
  await page.close();
 }
});
