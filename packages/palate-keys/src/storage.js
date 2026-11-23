/**
 * Pluggable persistence for the keyboard's small on-device state (learned
 * aim, clipboard history). Defaults to localStorage under the "palate_"
 * prefix (so existing Palate data keeps working). A host app can pass its own
 * backend: { getItem(key), setItem(key, value), removeItem(key) }, which is
 * the Storage interface, so localStorage, sessionStorage and Capacitor
 * Preferences wrappers all fit.
 */

let backend = null;
let prefix = 'palate_';
const listeners = new Set();

export function configure({ storage, prefix: p } = {}) {
  if (storage !== undefined) backend = storage;
  if (p !== undefined) prefix = p;
  listeners.forEach((fn) => fn());
}

/** Modules that cache a loaded copy re-read it when the backend changes */
export function onConfigure(fn) {
  listeners.add(fn);
}

function store() {
  if (backend) return backend;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function read(name, fallback) {
  try {
    const raw = store()?.getItem(prefix + name);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function write(name, value) {
  try {
    store()?.setItem(prefix + name, JSON.stringify(value));
  } catch { /* storage unavailable */ }
}

export function remove(name) {
  try {
    store()?.removeItem(prefix + name);
  } catch { /* ignore */ }
}
