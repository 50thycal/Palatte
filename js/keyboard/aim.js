/**
 * Learned aim: where this person's taps actually land on each key.
 *
 * Every confident tap records its offset from the key centre (in key widths
 * and heights). A tap that is immediately backspaced and retyped as a
 * different key is the strongest signal: it records where the person
 * touched when they *meant* the new key. Hit testing then measures distance
 * to each key's learned centre instead of its drawn centre.
 */

const STORE_KEY = 'palate_aim';
const MIN_SAMPLES = 12;     // per key before its offset is used
const MAX_OFFSET = 0.35;    // never shift a key's centre more than this
const ALPHA = 0.06;         // moving-average weight of a normal tap

let model = load();

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(model));
    } catch { /* storage unavailable */ }
  }, 800);
}

const clamp = (v) => Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, v));

/**
 * nx, ny: touch offset from the key's drawn centre, in key sizes
 * weight: 1 for a normal tap, higher for a corrected miss
 */
export function record(key, nx, ny, weight = 1) {
  if (!key || Math.abs(nx) > 1.3 || Math.abs(ny) > 1.3) return;
  const k = model[key] || { dx: 0, dy: 0, n: 0 };
  // Early on, average plainly; later, a slow moving average adapts to drift
  const a = Math.min(0.5, Math.max(ALPHA, 1 / (k.n + 1))) * weight;
  k.dx += (nx - k.dx) * Math.min(a, 0.6);
  k.dy += (ny - k.dy) * Math.min(a, 0.6);
  k.n += 1;
  model[key] = k;
  save();
}

/**
 * Learned centre offset for a key, or zero until there's enough data
 */
export function offset(key) {
  const k = model[key];
  if (!k || k.n < MIN_SAMPLES) return { dx: 0, dy: 0 };
  return { dx: clamp(k.dx), dy: clamp(k.dy) };
}

export function ready() {
  return Object.values(model).some((k) => k.n >= MIN_SAMPLES);
}

export function stats() {
  const keys = Object.values(model);
  return {
    taps: keys.reduce((sum, k) => sum + k.n, 0),
    keysLearned: keys.filter((k) => k.n >= MIN_SAMPLES).length
  };
}

export function reset() {
  model = {};
  try {
    localStorage.removeItem(STORE_KEY);
  } catch { /* ignore */ }
}

// For tests
export function _setModel(m) {
  model = m;
}
