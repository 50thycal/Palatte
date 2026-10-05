/**
 * Step-by-step checks for the on-device model, run from Settings. Each step
 * mirrors what the real download needs, so the first red line is the cause.
 */

import { MODELS, modelId, checkSupport, getLog, errorText } from './llm.js';

const TIMEOUT_MS = 20000;

function withTimeout(promise, ms = TIMEOUT_MS, label = 'timed out') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} after ${ms / 1000}s`)), ms))
  ]);
}

const mb = (bytes) => `${Math.round(bytes / 1048576)} MB`;

async function step(results, name, fn) {
  const t = performance.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: `${detail || 'ok'} (${Math.round(performance.now() - t)} ms)` });
    return true;
  } catch (err) {
    results.push({ name, ok: false, detail: errorText(err) });
    return false;
  }
}

async function probe(url, { range = false } = {}) {
  const res = await withTimeout(fetch(url, {
    cache: 'no-store',
    headers: range ? { Range: 'bytes=0-1023' } : {}
  }));
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res;
}

export async function runDiagnostics(modelKey, onUpdate = () => {}) {
  const results = [];
  const push = () => onUpdate([...results]);
  const model = MODELS[modelKey] || MODELS.standard;

  results.push({
    name: 'Device',
    ok: true,
    detail: `${navigator.userAgent.match(/(iPhone|iPad|Mac|Android)[^;)]*/)?.[0] || 'unknown'} · ` +
      `${matchMedia('(display-mode: standalone)').matches ? 'home-screen app' : 'browser tab'} · ` +
      `${navigator.userAgent.match(/Version\/[\d.]+/)?.[0] || ''}`
  });
  push();

  await step(results, 'WebGPU', async () => {
    const s = await checkSupport();
    if (!s.ok) throw new Error(s.reason);
    const adapter = await navigator.gpu.requestAdapter();
    const device = await withTimeout(adapter.requestDevice(), 10000, 'requestDevice');
    const info = adapter.info || {};
    const out = `${info.vendor || '?'} ${info.architecture || ''} · shader-f16 ${s.f16 ? 'yes' : 'no'} · ` +
      `max buffer ${mb(adapter.limits.maxBufferSize)} · max storage binding ${mb(adapter.limits.maxStorageBufferBindingSize)}`;
    device.destroy?.();
    return out;
  });
  push();

  await step(results, 'Storage space', async () => {
    if (!navigator.storage?.estimate) return 'estimate not available';
    const { quota = 0, usage = 0 } = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    const free = quota - usage;
    const need = parseFloat(model.size.replace(/[^\d.]/g, '')) * 1073741824;
    const line = `${mb(usage)} used of ${mb(quota)} · persistent ${persisted ? 'yes' : 'no'}`;
    if (quota && free < need * 1.1) throw new Error(`${line}: not enough room for ${model.label} (${model.size})`);
    return line;
  });
  push();

  await step(results, 'Cache write (16 MB)', async () => {
    const cache = await caches.open('palate-diagnostics');
    const req = new Request('/__palate_diag_blob');
    await cache.put(req, new Response(new Uint8Array(16 * 1048576)));
    const back = await cache.match(req);
    const size = (await back.arrayBuffer()).byteLength;
    await caches.delete('palate-diagnostics');
    if (size !== 16 * 1048576) throw new Error(`read back ${size} bytes`);
    return 'ok';
  });
  push();

  let lib = null;
  await step(results, 'Load model library', async () => {
    lib = await withTimeout(import('/vendor/web-llm/index.js'), 30000, 'library download');
    return 'loaded';
  });
  push();

  await step(results, 'Start model worker', async () => {
    const worker = new Worker('/js/organize/llm-worker.js', { type: 'module' });
    try {
      const reply = await withTimeout(new Promise((resolve, reject) => {
        worker.addEventListener('message', (e) => e.data?.palatePong && resolve(e.data));
        worker.addEventListener('error', (e) => reject(new Error(`worker error${e.message ? `: ${e.message}` : ''}`)));
        worker.postMessage({ palatePing: true });
      }), 30000, 'worker start');
      return `running · WebGPU in worker ${reply.gpu ? 'yes' : 'NO (main-thread fallback will be used)'}`;
    } finally {
      worker.terminate();
    }
  });
  push();

  if (lib) {
    const id = modelId(modelKey);
    const record = lib.prebuiltAppConfig.model_list.find((m) => m.model_id === id);
    if (!record) {
      results.push({ name: 'Model record', ok: false, detail: `${id} not in WebLLM's model list` });
    } else {
      const base = record.model.replace(/\/$/, '') + '/resolve/main/';
      await step(results, 'Reach Hugging Face (model config)', async () => {
        const res = await probe(base + 'mlc-chat-config.json');
        const cfg = await res.json();
        return `ok · context ${cfg.context_window_size || '?'}`;
      });
      push();
      await step(results, 'Reach GitHub (model code)', async () => {
        await probe(record.model_lib, { range: true });
        return new URL(record.model_lib).host;
      });
      push();
      await step(results, 'Weights index', async () => {
        const res = await probe(base + 'ndarray-cache.json');
        const index = await res.json();
        const shards = index.records || [];
        const total = shards.reduce((sum, r) => sum + (r.nbytes || 0), 0);
        await probe(base + shards[0].dataPath, { range: true });
        return `${shards.length} files, ${mb(total)} · first file reachable`;
      });
      push();
      await step(results, 'Already downloaded', async () => {
        return (await lib.hasModelInCache(id)) ? 'yes, cached on this phone' : 'not yet';
      });
      push();
    }
  }

  return results;
}

export function formatReport(results, modelKey) {
  const lines = [
    `Palate model diagnostics · ${new Date().toISOString()}`,
    `Model: ${MODELS[modelKey]?.label || modelKey} (${modelId(modelKey)})`,
    '',
    ...results.map((r) => `${r.ok ? 'OK  ' : 'FAIL'} ${r.name}: ${r.detail}`),
    '',
    'Recent model log:',
    ...getLog().slice(-30)
  ];
  return lines.join('\n');
}
