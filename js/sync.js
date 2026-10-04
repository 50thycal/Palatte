/**
 * Sync engine: pushes dirty records to /api/sync and pulls everything newer
 * than our cursor. Local-first: the UI never waits on this.
 */

import * as store from './store.js';

const BATCH = 150;
const DEBOUNCE_MS = 2000;
const INTERVAL_MS = 60 * 1000;

const listeners = new Set();
let status = 'local';
let detail = '';
let running = null;
let again = false;
let debounceTimer = null;
let intervalTimer = null;

function setStatus(next, message = '') {
  status = next;
  detail = message;
  listeners.forEach((fn) => fn({ status, detail }));
}

export function onStatus(fn) {
  listeners.add(fn);
  fn({ status, detail });
  return () => listeners.delete(fn);
}

export function getStatus() {
  return { status, detail, lastSyncAt: store.getKV('lastSyncAt') };
}

export function getToken() {
  return store.getKV('syncToken', '');
}

function endpoint(path) {
  const base = (store.getKV('syncServer', '') || '').replace(/\/+$/, '');
  return `${base}${path}`;
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(endpoint(path), {
    method,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store'
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

async function runOnce() {
  let cursor = store.getKV('syncCursor', 0);

  for (let round = 0; round < 50; round++) {
    const dirty = store.getDirty();
    const projects = dirty.projects.slice(0, BATCH);
    const notes = dirty.notes.slice(0, BATCH - projects.length);
    const strip = ({ dirty: _d, tags: _t, links: _l, seq: _s, ...rest }) => rest;

    const sent = new Map();
    projects.forEach((p) => sent.set('projects:' + p.id, p.updatedAt));
    notes.forEach((n) => sent.set('notes:' + n.id, n.updatedAt));

    const res = await api('/api/sync', {
      method: 'POST',
      body: { cursor, projects: projects.map(strip), notes: notes.map(strip) }
    });

    if (res.status === 401) throw Object.assign(new Error('Token rejected'), { code: 'unauthorized' });
    if (res.status === 503) {
      throw Object.assign(new Error(res.data?.message || 'Server not configured'), { code: 'unconfigured' });
    }
    if (res.status !== 200 || !res.data) throw new Error(`Sync failed (${res.status})`);

    const { applied, projects: pulledProjects, notes: pulledNotes } = res.data;

    for (const [id, seq] of Object.entries(applied.projects || {})) {
      await store.markClean('projects', id, sent.get('projects:' + id), seq);
    }
    for (const [id, seq] of Object.entries(applied.notes || {})) {
      await store.markClean('notes', id, sent.get('notes:' + id), seq);
    }
    // Projects first so notes never reference an unknown project
    for (const p of pulledProjects) await store.applyRemote('projects', p);
    for (const n of pulledNotes) await store.applyRemote('notes', n);

    cursor = res.data.cursor;
    await store.setKV('syncCursor', cursor);

    const pushedEverything = dirty.projects.length + dirty.notes.length <= BATCH;
    if (!res.data.hasMore && pushedEverything) break;
  }

  await store.setKV('lastSyncAt', Date.now());
}

/**
 * Run a sync now. Concurrent calls coalesce into one follow-up run.
 */
export async function syncNow() {
  if (!getToken()) {
    setStatus('local', 'Sync is off: data lives on this device only');
    return;
  }
  if (!navigator.onLine) {
    setStatus('offline', 'Offline: changes are saved on this device');
    return;
  }
  if (running) {
    again = true;
    return running;
  }

  setStatus('syncing');
  running = (async () => {
    try {
      do {
        again = false;
        await runOnce();
      } while (again);
      setStatus(store.hasDirty() ? 'pending' : 'synced');
    } catch (err) {
      if (err.code === 'unauthorized') setStatus('unauthorized', 'The server rejected the sync token');
      else if (err.code === 'unconfigured') setStatus('unconfigured', err.message);
      else setStatus(navigator.onLine ? 'error' : 'offline', err.message);
    } finally {
      running = null;
    }
  })();
  return running;
}

function schedule(delay = DEBOUNCE_MS) {
  if (!getToken()) return;
  if (status === 'synced') setStatus('pending');
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(syncNow, delay);
}

export async function testConnection(token, server = store.getKV('syncServer', '')) {
  const base = (server || '').replace(/\/+$/, '');
  const res = await fetch(`${base}/api/health`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(`Server responded ${res.status}`);
  return res.json();
}

export async function setToken(token) {
  await store.setKV('syncToken', token.trim());
  if (token.trim()) {
    // A fresh token may point at a fresh database: pull everything and re-push all local data
    await store.setKV('syncCursor', 0);
    await store.markAllDirty();
    await syncNow();
  } else {
    setStatus('local', 'Sync is off: data lives on this device only');
  }
}

export function fetchServerVersions(noteId) {
  if (!getToken()) return Promise.resolve([]);
  return api(`/api/versions?noteId=${encodeURIComponent(noteId)}`)
    .then((r) => (r.status === 200 ? r.data.versions : []))
    .catch(() => []);
}

export function start() {
  store.on('change', (e) => {
    const { type, remote } = e.detail;
    if (!remote && (type === 'notes' || type === 'projects')) schedule();
  });

  window.addEventListener('online', () => syncNow());
  window.addEventListener('offline', () => setStatus('offline', 'Offline: changes are saved on this device'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && store.hasDirty()) syncNow();
    if (document.visibilityState === 'visible') syncNow();
  });

  clearInterval(intervalTimer);
  intervalTimer = setInterval(() => {
    if (document.visibilityState === 'visible') syncNow();
  }, INTERVAL_MS);

  if (getToken()) syncNow();
  else setStatus('local', 'Sync is off: data lives on this device only');
}
