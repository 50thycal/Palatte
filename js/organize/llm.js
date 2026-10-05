/**
 * On-device language model (WebLLM over WebGPU).
 *
 * The library is vendored at /vendor/web-llm and only loaded when needed.
 * Model weights come from Hugging Face on first download and are cached by
 * the browser, after which everything runs offline on the phone's GPU.
 */

export const MODELS = {
  standard: {
    key: 'standard',
    short: 'Standard 3B',
    label: 'Qwen 2.5 3B',
    f16: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
    f32: 'Qwen2.5-3B-Instruct-q4f32_1-MLC',
    size: 'about 1.7 GB',
    memoryMB: 2505
  },
  lite: {
    key: 'lite',
    short: 'Lite 1.5B',
    label: 'Qwen 2.5 1.5B',
    f16: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    f32: 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC',
    size: 'about 0.9 GB',
    memoryMB: 1630
  },
  tiny: {
    key: 'tiny',
    short: 'Tiny 1B',
    label: 'Llama 3.2 1B',
    f16: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    f32: 'Llama-3.2-1B-Instruct-q4f32_1-MLC',
    size: 'about 0.7 GB',
    memoryMB: 880
  }
};

// Largest to smallest: where to step down after a memory crash
export const MODEL_ORDER = ['standard', 'lite', 'tiny'];

/**
 * Which stage a WebLLM progress message belongs to. Download progress
 * survives interruptions (finished shards stay cached); a crash while
 * loading onto the GPU or generating means the model is too big.
 */
export function phaseOf(text) {
  if (/fetching param cache|downloading|fetch/i.test(text || '')) return 'download';
  if (/loading model from cache|finish loading|shader|compil|loading/i.test(text || '')) return 'load';
  return null;
}

const LIB_URL = '/vendor/web-llm/index.js';
const WORKER_URL = '/js/organize/llm-worker.js';

// If the worker hasn't reported any progress by now, it's stuck (WebLLM
// waits forever on a worker that failed to start)
const WORKER_START_MS = 45 * 1000;
// Between progress updates (one weight shard on a slow connection, or GPU
// shader compilation, can legitimately take a while)
const WORKER_STALL_MS = 4 * 60 * 1000;
const LOG_LIMIT = 120;

let lib = null;
const log = [];

/**
 * Model event log (shown in Settings > On-device model > Details), so a
 * failure on the phone can be read and reported.
 */
export function logEvent(text) {
  const line = `${new Date().toISOString().slice(11, 19)} ${text}`;
  log.push(line);
  if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT);
  try {
    localStorage.setItem('palate_llm_log', JSON.stringify(log.slice(-60)));
  } catch { /* storage full or unavailable */ }
}

export function getLog() {
  if (!log.length) {
    // Include the previous session's log (e.g. before an iOS kill)
    try {
      const prev = JSON.parse(localStorage.getItem('palate_llm_log') || '[]');
      if (prev.length) return ['(previous session)', ...prev];
    } catch { /* ignore */ }
  }
  return [...log];
}

/**
 * WebLLM rejects with strings from the worker and Errors from the main
 * thread; keep whatever text there is.
 */
export function errorText(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err.message) return err.name && !err.message.startsWith(err.name) ? `${err.name}: ${err.message}` : err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
let engine = null;
let engineModel = null;
let loading = null;
let support = null;

async function getLib() {
  if (!lib) lib = await import(LIB_URL);
  return lib;
}

/**
 * What can this device run? Cached after the first call.
 */
export async function checkSupport() {
  if (support) return support;
  if (!('gpu' in navigator)) {
    support = { ok: false, reason: 'This browser has no WebGPU (needs iOS 26 or a recent desktop browser).' };
    return support;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      support = { ok: false, reason: 'WebGPU is present but no GPU adapter is available.' };
      return support;
    }
    support = {
      ok: true,
      f16: adapter.features.has('shader-f16'),
      maxBufferMB: Math.round((adapter.limits.maxBufferSize || 0) / 1048576),
      deviceMemoryGB: navigator.deviceMemory || null
    };
  } catch (err) {
    support = { ok: false, reason: `WebGPU failed to start: ${err.message}` };
  }
  return support;
}

export function modelId(key) {
  const m = MODELS[key] || MODELS.standard;
  // q4f16 needs half-precision shaders; fall back to the f32 build otherwise
  return support && support.ok && !support.f16 ? m.f32 : m.f16;
}

export async function isDownloaded(key) {
  const s = await checkSupport();
  if (!s.ok) return false;
  try {
    return await (await getLib()).hasModelInCache(modelId(key));
  } catch {
    return false;
  }
}

export function isLoaded(key) {
  return Boolean(engine && engineModel === modelId(key));
}

/**
 * Download (first time) and load the model onto the GPU.
 * onProgress({ progress: 0..1, text })
 */
export async function load(key, onProgress = () => {}) {
  const id = modelId(key);
  if (engine && engineModel === id) return engine;
  if (loading) return loading;

  loading = (async () => {
    const s = await checkSupport();
    if (!s.ok) throw new Error(s.reason);
    logEvent(`load ${id} (shader-f16: ${s.f16 ? 'yes' : 'no'})`);
    const webllm = await getLib();
    await unload();

    let lastText = '';
    const engineConfig = {
      initProgressCallback: (r) => {
        if (r.text !== lastText && (!/\d+%/.test(r.text) || /(\b[05]0|100)% completed/.test(r.text))) {
          logEvent(r.text);
        }
        lastText = r.text;
        onProgress({ progress: r.progress, text: r.text });
      }
    };

    try {
      engine = await createInWorker(webllm, id, engineConfig);
      logEvent('engine ready (worker)');
    } catch (err) {
      logEvent(`worker engine failed: ${errorText(err)}`);
      if (/fetch|network|load failed|quota|storage/i.test(errorText(err))) throw err;
      // Some browsers can't run WebGPU in a worker: try the main thread
      logEvent('retrying on the main thread');
      engine = await webllm.CreateMLCEngine(id, engineConfig);
      logEvent('engine ready (main thread)');
    }
    engineModel = id;
    return engine;
  })().catch((err) => {
    logEvent(`load failed: ${errorText(err)}`);
    throw err;
  });

  try {
    return await loading;
  } finally {
    loading = null;
  }
}

/**
 * Start the engine in a worker, but never hang: a worker that fails to load
 * (error event) or never reports progress is terminated and rejected.
 */
function createInWorker(webllm, id, engineConfig) {
  const worker = new Worker(WORKER_URL, { type: 'module' });
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const fail = (reason) => {
      worker.terminate();
      finish(reject, reason);
    };
    const armWatchdog = (ms, message) => {
      clearTimeout(timer);
      timer = setTimeout(() => fail(new Error(message)), ms);
    };
    worker.addEventListener('error', (e) => {
      e.preventDefault?.();
      fail(new Error(`The model worker failed to start${e.message ? `: ${e.message}` : ''}`));
    });
    const config = {
      ...engineConfig,
      initProgressCallback: (r) => {
        armWatchdog(WORKER_STALL_MS, 'The model download stalled (no progress for 4 minutes)');
        engineConfig.initProgressCallback(r);
      }
    };
    armWatchdog(WORKER_START_MS, 'The model worker never started (no response in 45 seconds)');
    webllm.CreateWebWorkerMLCEngine(worker, id, config).then(
      (eng) => finish(resolve, eng),
      (err) => fail(err)
    );
  });
}

/**
 * Free GPU memory (iOS kills backgrounded web apps that hold a lot of it)
 */
export async function unload() {
  if (!engine) return;
  const e = engine;
  engine = null;
  engineModel = null;
  try {
    await e.unload();
  } catch { /* already gone */ }
}

export async function remove(key) {
  await unload();
  const webllm = await getLib();
  for (const id of [MODELS[key].f16, MODELS[key].f32]) {
    try {
      await webllm.deleteModelAllInfoInCache(id);
    } catch { /* not cached */ }
  }
}

/**
 * Generate schema-constrained JSON
 */
export async function generateJSON({ system, user, schema, maxTokens }) {
  if (!engine) throw new Error('Model not loaded');
  const reply = await engine.chat.completions.create({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: 0.2,
    max_tokens: maxTokens,
    response_format: { type: 'json_object', schema: JSON.stringify(schema) }
  });
  const choice = reply.choices?.[0];
  if (!choice?.message?.content) throw new Error('Empty model reply');
  if (choice.finish_reason === 'length') throw new Error('Model reply was cut off');
  return JSON.parse(choice.message.content);
}
