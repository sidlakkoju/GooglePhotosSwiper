import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {register} from 'node:module';

register('./fixtures/worker-text-loader.mjs', import.meta.url);
const {default: worker} = await import('../worker/src/index.mjs');
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
