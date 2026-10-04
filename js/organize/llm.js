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

let lib = null;
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
    const webllm = await getLib();
    await unload();
    const engineConfig = { initProgressCallback: (r) => onProgress({ progress: r.progress, text: r.text }) };
    try {
      const worker = new Worker(WORKER_URL, { type: 'module' });
      engine = await webllm.CreateWebWorkerMLCEngine(worker, id, engineConfig);
    } catch (err) {
      // Some browsers can't use WebGPU from workers: run on the main thread
      console.warn('[llm] worker engine failed, using main thread', err);
      engine = await webllm.CreateMLCEngine(id, engineConfig);
    }
    engineModel = id;
    return engine;
  })();

  try {
    return await loading;
  } finally {
    loading = null;
  }
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
