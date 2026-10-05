import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Run sw.js against a fake Cache Storage and fire its activate event
async function activateWith(existing) {
  const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  const store = new Set(existing);
  const listeners = {};
  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting() {},
    clients: { claim() {} },
    location: { origin: 'https://palate.test' }
  };
  const caches = {
    keys: async () => [...store],
    delete: async (key) => store.delete(key),
    open: async () => ({ addAll: async () => {}, put: async () => {}, match: async () => undefined })
  };
  vm.runInNewContext(source, { self, caches, URL, Response, fetch, setTimeout, Promise });
  let pending;
  listeners.activate({ waitUntil: (p) => { pending = p; } });
  await pending;
  const cacheName = source.match(/CACHE_NAME = '([^']+)'/)[1];
  return { remaining: store, cacheName };
}

test('an app update keeps the downloaded on-device model', async () => {
  const { remaining, cacheName } = await activateWith([
    'palate-v15', 'palate-v16', 'webllm/model', 'webllm/config', 'webllm/wasm', 'palate-diagnostics'
  ]);
  assert.ok(remaining.has('webllm/model'), 'model weights kept');
  assert.ok(remaining.has('webllm/config'));
  assert.ok(remaining.has('webllm/wasm'));
  assert.ok(!remaining.has('palate-v15') && !remaining.has('palate-v16'), 'old app caches removed');
  assert.ok(!remaining.has(cacheName) || cacheName.startsWith('palate-v'));
});
