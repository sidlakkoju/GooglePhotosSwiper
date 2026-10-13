import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {googleAuthRequest} from '../worker/src/google-auth.mjs';

const chrome=['google-chrome','chromium','chromium-browser'].find(command=>spawnSync(command,['--version'],{stdio:'ignore'}).status===0);

test('browser applies injected GIS inline styles without CSP violations and blocks untrusted scripts',{skip:!chrome,timeout:30000},async()=>{
 const DB={prepare:()=>({bind:()=>({first:async()=>({nonce:'test-nonce',login_hint:null}),run:async()=>({})})})};
 const response=await googleAuthRequest(new Request('http://localhost/auth/start?state=test'),{DB});
 const stub=`const violations=[];document.addEventListener('securitypolicyviolation',event=>violations.push(event.effectiveDirective));globalThis.google={accounts:{id:{initialize:()=>{},renderButton:element=>{const style=document.createElement('style');style.id='googleidentityservice_button_styles';style.textContent='#button{width:123px}';document.head.append(style);element.textContent='Sign in with Google';}}}};window.addEventListener('load',()=>{setTimeout(()=>{const result=document.createElement('pre');result.id='csp-result';result.textContent=JSON.stringify({width:getComputedStyle(document.getElementById('button')).width,violations:[...violations]});document.body.append(result);const script=document.createElement('script');script.textContent='document.body.dataset.untrusted="executed"';document.body.append(script);setTimeout(()=>{const blocked=document.createElement('pre');blocked.id='script-result';blocked.textContent=JSON.stringify({executed:document.body.dataset.untrusted==='executed',violations});document.body.append(blocked);},50);},50);});`;
 const stubHash=createHash('sha256').update(stub).digest('base64');
 const html=(await response.text()).replace('<script src="https://accounts.google.com/gsi/client"></script>',`<script>${stub}</script>`);
 const policy=response.headers.get('Content-Security-Policy').replace('script-src ',`script-src 'sha256-${stubHash}' `);
 const server=createServer((request,res)=>{
  res.writeHead(200,{'Content-Type':'text/html','Content-Security-Policy':policy});
  res.end(html);
 });
 const profile=await mkdtemp(join(tmpdir(),'photoswipe-csp-'));
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const output=await new Promise((resolve,reject)=>{
   const child=spawn(chrome,['--headless','--no-sandbox','--disable-gpu','--disable-background-networking','--disable-component-update','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,'--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--dump-dom','--virtual-time-budget=1000',`http://127.0.0.1:${server.address().port}/auth/start`]);
   let stdout='',stderr='';
   child.stdout.on('data',data=>stdout+=data);
   child.stderr.on('data',data=>stderr+=data);
   child.on('error',reject);
   child.on('close',code=>code===0?resolve(stdout):reject(Error(stderr)));
  });
  const result=JSON.parse(output.match(/<pre id="csp-result">(.*?)<\/pre>/s)?.[1]||'null');
  assert.deepEqual(result,{width:'123px',violations:[]});
  const scriptResult=JSON.parse(output.match(/<pre id="script-result">(.*?)<\/pre>/s)?.[1]||'null');
  assert.deepEqual(scriptResult,{executed:false,violations:['script-src-elem']});
 }finally{
  await new Promise(resolve=>server.close(resolve));
  await rm(profile,{recursive:true,force:true});
 }
});
