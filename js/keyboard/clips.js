/**
 * Palate's own clipboard history. Text cut or copied inside Palate pastes
 * instantly from here (iOS shows a permission bubble whenever a web app
 * reads the system clipboard, so that path is only for text from other
 * apps). Kept on this device only.
 */

const STORE_KEY = 'palate_clips';
const MAX = 10;

let clips = load();

function load() {
  try {
    const list = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(clips));
  } catch { /* storage unavailable */ }
}

export function push(text) {
  if (!text || !text.trim()) return;
  clips = [{ text, at: Date.now() }, ...clips.filter((c) => c.text !== text)].slice(0, MAX);
  save();
}

export function list() {
  return clips;
}

export function latest() {
  return clips[0] || null;
}

export function clear() {
  clips = [];
  save();
}

export function preview(text, max = 28) {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
