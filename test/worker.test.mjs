import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {register} from 'node:module';

register('./fixtures/worker-text-loader.mjs', import.meta.url);
const {default: worker,requiredLoaderVersion} = await import('../worker/src/index.mjs');
const installURL = 'https://photoswiper-sync.sidlakkoju.workers.dev/photoswiper.user.js';

test('Worker publicly serves the exact built userscript with JavaScript and cache headers', async () => {
  const response = await worker.fetch(new Request(installURL));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'text/javascript; charset=utf-8');
  assert.equal(response.headers.get('Cache-Control'), 'max-age=300');
  assert.equal(await response.text(), await readFile(new URL('../userscript/photoswiper.user.js', import.meta.url), 'utf8'));
});

test('Worker HEAD returns GET headers with no body', async () => {
  const response = await worker.fetch(new Request(installURL, {method: 'HEAD'}));
  const get = await worker.fetch(new Request(installURL));
  assert.equal(response.status, 200);
  assert.deepEqual([...response.headers], [...get.headers]);
  assert.equal(response.body, null);
  assert.equal(await response.text(), '');
});

test('Worker ignores query parameters on the install path', async () => {
  const response = await worker.fetch(new Request(`${installURL}?version=latest`));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /^\/\/ ==UserScript==/);
});

test('Worker returns 404 for unknown paths for all methods', async () => {
  for (const path of ['/', '/photoswiper.user.js/extra', '/unknown']) {
    for (const method of ['GET', 'HEAD', 'POST']) {
      const response = await worker.fetch(new Request(new URL(path, installURL), {method}));
      assert.equal(response.status, 404);
      if (method === 'HEAD') assert.equal(response.body, null);
    }
  }
});

test('Worker rejects unsupported methods on the install path', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const response = await worker.fetch(new Request(installURL, {method}));
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'GET, HEAD');
  }
});
test('Worker serves the pairing hand-off publicly with strict security headers',async()=>{
 const url=new URL('/pair',installURL),response=await worker.fetch(new Request(url));
 assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'text/html; charset=utf-8');
 assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');assert.equal(response.headers.get('Cache-Control'),'no-store');
 assert.match(response.headers.get('Content-Security-Policy'),/^default-src 'none'; script-src 'sha256-/);
 assert.match(await response.text(),/location.hash/);
 const head=await worker.fetch(new Request(url,{method:'HEAD'}));assert.equal(head.body,null);assert.deepEqual([...head.headers],[...response.headers]);
 assert.equal((await worker.fetch(new Request(url,{method:'POST'}))).status,405);
});

test('Worker serves separate loader and uncached release routes',async()=>{
 for(const [path,type] of [['photoswiper-loader.user.js','text/javascript; charset=utf-8'],['photoswiper-release.json','application/json; charset=utf-8']]){
  const url=new URL('/'+path+'?t=123',installURL);
  const response=await worker.fetch(new Request(url));
  assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),type);
  if(path.endsWith('.json')){assert.equal(response.headers.get('Cache-Control'),'no-store');assert.deepEqual(Object.keys(await response.json()),['version','code','signature']);}
  else assert.equal(await response.text(),await readFile(new URL('../userscript/'+path,import.meta.url),'utf8'));
  const head=await worker.fetch(new Request(url,{method:'HEAD'}));assert.equal(head.body,null);assert.deepEqual([...head.headers],[...response.headers]);
  assert.equal((await worker.fetch(new Request(url,{method:'POST'}))).status,405);
 }
});

test('Worker publishes headerless app and matching live version with CORS and fresh caching',async()=>{
 const bundle=await readFile(new URL('../userscript/photoswiper-app.user.js',import.meta.url),'utf8');
 const version=/^\/\/ @version (\S+)$/m.exec(bundle)[1];
 for(const path of ['/app.js','/version']){
  const response=await worker.fetch(new Request(new URL(path,installURL)));
  assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');assert.equal(response.headers.get('X-Photoswiper-Version'),version);
  assert.equal(response.headers.get('X-Photoswiper-Required-Loader-Version'),requiredLoaderVersion);
  assert.ok(response.headers.get('Access-Control-Expose-Headers').includes('X-Photoswiper-Required-Loader-Version'));
  if(path==='/app.js'){assert.equal(response.headers.get('Content-Type'),'text/javascript; charset=utf-8');assert.equal(await response.text(),bundle.split('// ==/UserScript==')[1].trimStart());}
  else assert.deepEqual(await response.json(),{version,requiredLoaderVersion});
  const head=await worker.fetch(new Request(new URL(path,installURL),{method:'HEAD'}));assert.equal(head.body,null);assert.deepEqual([...head.headers],[...response.headers]);
  assert.equal((await worker.fetch(new Request(new URL(path,installURL),{method:'OPTIONS'}))).status,204);
  assert.equal((await worker.fetch(new Request(new URL(path,installURL),{method:'POST'}))).status,405);
 }
});
