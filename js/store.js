/**
 * Local-first data store (IndexedDB, mirrored in memory)
 *
 * IndexedDB is the source of truth on the device. Everything is loaded into
 * memory on init so views can read synchronously; writes update memory first
 * and persist asynchronously. Every local write marks the record dirty so the
 * sync engine can push it to the server.
 */

const DB_NAME = 'palate';
const DB_VERSION = 1;
const LEGACY_KEY = 'palate_data';
const LEGACY_CORPUS_KEY = 'palate_corpus';

// Minimum gap between automatic version snapshots of the same note
const VERSION_INTERVAL_MS = 10 * 60 * 1000;

let db = null;
const projects = new Map();
const notes = new Map();
const kv = new Map();
const events = new EventTarget();

// ============================================
// IndexedDB plumbing
// ============================================

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const d = event.target.result;
      if (!d.objectStoreNames.contains('projects')) {
        d.createObjectStore('projects', { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains('notes')) {
        d.createObjectStore('notes', { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains('versions')) {
        const store = d.createObjectStore('versions', { keyPath: 'id', autoIncrement: true });
        store.createIndex('noteId', 'noteId', { unique: false });
      }
      if (!d.objectStoreNames.contains('kv')) {
        d.createObjectStore('kv', { keyPath: 'key' });
      }
    };
  });
}

function tx(storeNames, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
    result = fn(t);
  });
}

function getAllFrom(storeName) {
  return tx(storeName, 'readonly', (t) => {
    const out = [];
    t.objectStore(storeName).openCursor().onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        out.push(cursor.value);
        cursor.continue();
      }
    };
    return out;
  });
}

function putRecord(storeName, value) {
  return tx(storeName, 'readwrite', (t) => {
    t.objectStore(storeName).put(value);
  });
}

function emit(type, detail) {
  events.dispatchEvent(new CustomEvent(type, { detail }));
  events.dispatchEvent(new CustomEvent('change', { detail: { type, ...detail } }));
}

export function on(type, fn) {
  events.addEventListener(type, fn);
  return () => events.removeEventListener(type, fn);
}

// ============================================
// Helpers
// ============================================

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

const TAG_RE = /(^|[\s(])#([A-Za-z][\w-]{0,40})/g;
const LINK_RE = /\[\[([^\[\]\n]{1,120})\]\]/g;

export function extractTags(text) {
  const tags = new Set();
  for (const m of (text || '').matchAll(TAG_RE)) tags.add(m[2].toLowerCase());
  return [...tags];
}

export function extractLinks(text) {
  const links = new Set();
  for (const m of (text || '').matchAll(LINK_RE)) links.add(m[1].trim());
  return [...links];
}

export function autoTitle(body) {
  const firstLine = (body || '').trim().split('\n')[0].trim().replace(/^#+\s*/, '');
  if (!firstLine) {
    return new Date().toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  }
  return firstLine.length <= 60 ? firstLine : firstLine.slice(0, 57) + '...';
}

function withDerived(note) {
  note.tags = extractTags(note.title + '\n' + note.body);
  note.links = extractLinks(note.body);
  return note;
}

// ============================================
// Init + migration from the v0 localStorage blob
// ============================================

export async function init() {
  if (db) return;
  db = await openDB();

  const [p, n, k] = await Promise.all([
    getAllFrom('projects'),
    getAllFrom('notes'),
    getAllFrom('kv')
  ]);
  p.forEach((r) => projects.set(r.id, r));
  n.forEach((r) => notes.set(r.id, r));
  k.forEach((r) => kv.set(r.key, r.value));

  if (!kv.get('migratedV0')) {
    await migrateFromLocalStorage();
  }

  // Ask the browser not to evict our data under storage pressure
  if (navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {});
  }
}

async function migrateFromLocalStorage() {
  let legacy = null;
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
  } catch {
    legacy = null;
  }

  if (legacy && Array.isArray(legacy.projects)) {
    for (const lp of legacy.projects) {
      const createdAt = Date.parse(lp.createdAt) || Date.now();
      await putProject({
        id: lp.id,
        name: lp.name || 'Untitled',
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
        dirty: 1,
        seq: 0
      });
      for (const s of lp.snapshots || []) {
        const ts = Date.parse(s.createdAt) || Date.now();
        await putNote(withDerived({
          id: s.id,
          projectId: lp.id,
          title: s.title || autoTitle(s.content),
          body: s.content || '',
          pinned: false,
          createdAt: ts,
          updatedAt: ts,
          deletedAt: null,
          dirty: 1,
          seq: 0
        }));
      }
    }
    if (legacy.livePalate) await setKV('livePalate', legacy.livePalate);
    if (legacy.activeProjectId) await setKV('activeProjectId', legacy.activeProjectId);
  }

  const corpus = localStorage.getItem(LEGACY_CORPUS_KEY);
  if (corpus) await setKV('corpus', corpus);

  // The legacy blob is left in place untouched as a fallback copy.
  await setKV('migratedV0', Date.now());
}

// ============================================
// Key/value settings
// ============================================

export function getKV(key, fallback = null) {
  return kv.has(key) ? kv.get(key) : fallback;
}

export async function setKV(key, value) {
  kv.set(key, value);
  await putRecord('kv', { key, value });
  emit('kv', { key });
}

// ============================================
// Projects
// ============================================

async function putProject(project) {
  projects.set(project.id, project);
  await putRecord('projects', project);
}

export function listProjects() {
  return [...projects.values()]
    .filter((p) => !p.deletedAt)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function getProject(id) {
  const p = projects.get(id);
  return p && !p.deletedAt ? p : null;
}

export async function createProject(name) {
  const now = Date.now();
  const project = {
    id: generateId(),
    name: name.trim(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    dirty: 1,
    seq: 0
  };
  await putProject(project);
  emit('projects', { id: project.id });
  return project;
}

export async function updateProject(id, patch) {
  const existing = projects.get(id);
  if (!existing) return null;
  const project = { ...existing, ...patch, updatedAt: Date.now(), dirty: 1 };
  await putProject(project);
  emit('projects', { id });
  return project;
}

export async function deleteProject(id) {
  // Notes inside are kept and moved to "no project"
  for (const note of notes.values()) {
    if (note.projectId === id && !note.deletedAt) {
      await updateNote(note.id, { projectId: null }, { snapshot: false });
    }
  }
  if (getKV('activeProjectId') === id) await setKV('activeProjectId', null);
  return updateProject(id, { deletedAt: Date.now() });
}

export function getActiveProjectId() {
  const id = getKV('activeProjectId');
  return id && getProject(id) ? id : null;
}

export function setActiveProjectId(id) {
  return setKV('activeProjectId', id || null);
}

// ============================================
// Notes
// ============================================

async function putNote(note) {
  notes.set(note.id, note);
  await putRecord('notes', note);
}

export function listNotes({ projectId, includeDeleted = false, onlyDeleted = false } = {}) {
  let out = [...notes.values()];
  if (onlyDeleted) out = out.filter((n) => n.deletedAt);
  else if (!includeDeleted) out = out.filter((n) => !n.deletedAt);
  if (projectId !== undefined) out = out.filter((n) => n.projectId === projectId);
  return out.sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));
}

export function getNote(id) {
  return notes.get(id) || null;
}

export function findNoteByTitle(title) {
  const t = title.trim().toLowerCase();
  return listNotes().find((n) => n.title.trim().toLowerCase() === t) || null;
}

export function backlinksTo(note) {
  const t = note.title.trim().toLowerCase();
  return listNotes().filter(
    (n) => n.id !== note.id && n.links?.some((l) => l.toLowerCase() === t)
  );
}

export function listTags() {
  const counts = new Map();
  for (const n of listNotes()) {
    for (const tag of n.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count }));
}

export async function createNote({ projectId = null, title = '', body = '' }) {
  const now = Date.now();
  const note = withDerived({
    id: generateId(),
    projectId,
    title: title.trim() || autoTitle(body),
    body,
    pinned: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    dirty: 1,
    seq: 0
  });
  await putNote(note);
  emit('notes', { id: note.id });
  return note;
}

export async function updateNote(id, patch, { snapshot = true } = {}) {
  const existing = notes.get(id);
  if (!existing) return null;

  const contentChanged =
    (patch.body !== undefined && patch.body !== existing.body) ||
    (patch.title !== undefined && patch.title !== existing.title);

  if (snapshot && contentChanged) {
    await maybeSnapshotVersion(existing);
  }

  const note = withDerived({ ...existing, ...patch, updatedAt: Date.now(), dirty: 1 });
  await putNote(note);
  emit('notes', { id });
  return note;
}

export function deleteNote(id) {
  return updateNote(id, { deletedAt: Date.now() }, { snapshot: false });
}

export function restoreNote(id) {
  return updateNote(id, { deletedAt: null }, { snapshot: false });
}

// ============================================
// Version history (local)
// ============================================

async function maybeSnapshotVersion(note) {
  const versions = await listLocalVersions(note.id);
  const last = versions[0];
  // A recent snapshot already covers this editing session
  if (last && Date.now() - (last.capturedAt || last.savedAt) < VERSION_INTERVAL_MS) return;
  if (last && last.body === note.body && last.title === note.title) return;
  await putRecord('versions', {
    noteId: note.id,
    title: note.title,
    body: note.body,
    savedAt: note.updatedAt,
    capturedAt: Date.now()
  });
}

export function listLocalVersions(noteId) {
  return tx('versions', 'readonly', (t) => {
    const out = [];
    t.objectStore('versions').index('noteId').openCursor(IDBKeyRange.only(noteId)).onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        out.push(cursor.value);
        cursor.continue();
      }
    };
    return out;
  }).then((list) => list.sort((a, b) => b.id - a.id));
}

export async function snapshotNow(noteId) {
  const note = notes.get(noteId);
  if (note) {
    await putRecord('versions', {
      noteId: note.id, title: note.title, body: note.body, savedAt: Date.now(), capturedAt: Date.now()
    });
  }
}

// ============================================
// Sync support
// ============================================

export function getDirty() {
  return {
    projects: [...projects.values()].filter((p) => p.dirty),
    notes: [...notes.values()].filter((n) => n.dirty)
  };
}

export function hasDirty() {
  for (const p of projects.values()) if (p.dirty) return true;
  for (const n of notes.values()) if (n.dirty) return true;
  return false;
}

export async function markAllDirty() {
  for (const [kind, map] of [['projects', projects], ['notes', notes]]) {
    for (const rec of map.values()) {
      if (!rec.dirty) {
        const next = { ...rec, dirty: 1 };
        map.set(rec.id, next);
        await putRecord(kind, next);
      }
    }
  }
}

/**
 * Mark a pushed record clean, unless it changed again while in flight
 */
export async function markClean(kind, id, sentUpdatedAt, seq) {
  const map = kind === 'projects' ? projects : notes;
  const rec = map.get(id);
  if (!rec || rec.updatedAt !== sentUpdatedAt) return;
  const clean = { ...rec, dirty: 0, seq: seq ?? rec.seq };
  map.set(id, clean);
  await putRecord(kind, clean);
}

/**
 * Apply a record that came from the server. Local unsynced edits that are
 * newer win; the server keeps the loser in its version history.
 */
export async function applyRemote(kind, remote) {
  const map = kind === 'projects' ? projects : notes;
  const local = map.get(remote.id);
  if (local && local.dirty && local.updatedAt > remote.updatedAt) return false;

  // Echo of our own write: just record the server sequence, no UI churn
  if (local && local.updatedAt === remote.updatedAt && !local.dirty) {
    if (local.seq !== remote.seq) {
      const rec = { ...local, seq: remote.seq };
      map.set(rec.id, rec);
      await putRecord(kind, rec);
    }
    return false;
  }

  let rec = { ...remote, dirty: 0 };
  if (kind === 'notes') {
    if (local && local.body !== remote.body && !local.dirty) {
      await maybeSnapshotVersion(local);
    }
    rec = withDerived(rec);
  }
  map.set(rec.id, rec);
  await putRecord(kind, rec);
  emit(kind, { id: rec.id, remote: true });
  return true;
}

// ============================================
// Bulk data management
// ============================================

export function exportJSON() {
  return JSON.stringify({
    format: 'palate-v1',
    exportedAt: new Date().toISOString(),
    projects: [...projects.values()],
    notes: [...notes.values()],
    livePalate: getKV('livePalate', ''),
    corpus: getKV('corpus', '')
  }, null, 2);
}

export async function importJSON(text) {
  const data = JSON.parse(text);
  if (data.format === 'palate-v1') {
    for (const p of data.projects || []) await putProject({ ...p, dirty: 1 });
    for (const n of data.notes || []) await putNote(withDerived({ ...n, dirty: 1 }));
    if (data.livePalate) await setKV('livePalate', data.livePalate);
    if (data.corpus) await setKV('corpus', data.corpus);
  } else if (Array.isArray(data.projects)) {
    // v0 backup file: reuse the migration path
    localStorage.setItem(LEGACY_KEY, JSON.stringify(data));
    await migrateFromLocalStorage();
  } else {
    throw new Error('Unrecognised backup file');
  }
  emit('notes', {});
  emit('projects', {});
}

export async function clearAll() {
  await tx(['projects', 'notes', 'versions', 'kv'], 'readwrite', (t) => {
    ['projects', 'notes', 'versions', 'kv'].forEach((s) => t.objectStore(s).clear());
  });
  projects.clear();
  notes.clear();
  kv.clear();
  localStorage.removeItem(LEGACY_KEY);
  localStorage.removeItem(LEGACY_CORPUS_KEY);
  // Prevent the legacy blob from being re-imported on next launch
  await setKV('migratedV0', Date.now());
  emit('notes', {});
  emit('projects', {});
}

export function getStats() {
  return {
    projectCount: listProjects().length,
    noteCount: listNotes().length
  };
}
