/**
 * Organizer: files, titles, tags and tidies archived notes in the background.
 *
 * Jobs are queued in IndexedDB (kv) so they survive the app closing. Each job
 * uses the on-device model when it has been downloaded, otherwise the
 * rule-based fallback. The original text is always kept: a version snapshot
 * goes into history and the pre-organize state is stored for one-tap undo.
 */

import * as store from '../store.js';
import * as search from '../search.js';
import * as llm from './llm.js';
import { buildPrompt, parseResult } from './prompt.js';
import { planChanges, basicResult, voteProject } from './heuristics.js';

const IDLE_UNLOAD_MS = 90 * 1000;
const MAX_RECORDS = 400;

const listeners = new Set();
let status = { state: 'idle', queue: 0, current: null, progress: null, text: '' };
let running = false;
let idleTimer = null;
let engineOverride = null; // tests can inject a fake model
let busyNoteId = null;      // note open in the editor: never touch it

function setStatus(patch) {
  status = { ...status, ...patch, queue: queue().length };
  listeners.forEach((fn) => fn(status));
}

export function onStatus(fn) {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

export function getStatus() {
  return status;
}

// ============================================
// Settings
// ============================================

export function isAuto() {
  return store.getKV('autoOrganize', true);
}

export function setAuto(on) {
  return store.setKV('autoOrganize', on);
}

export function modelKey() {
  return store.getKV('organizerModel', 'standard');
}

export async function setModelKey(key) {
  await store.setKV('organizerModel', key);
  await store.setKV('llmReady', false);
  await llm.unload();
}

export function isModelReady() {
  return Boolean(store.getKV('llmReady', false));
}

/**
 * Download the selected model (user initiated; ~1-2 GB)
 */
export async function downloadModel(onProgress) {
  const key = modelKey();
  setStatus({ state: 'loading', text: 'Downloading model…', progress: 0 });
  try {
    await guarded('download', () => llm.load(key, (p) => {
      markProgress(p);
      setStatus({ state: 'loading', progress: p.progress, text: p.text });
      onProgress?.(p);
    }));
    await store.setKV('llmReady', true);
    await store.setKV('llmLastIssue', null);
    setStatus({ state: 'idle', progress: null, text: 'Model ready' });
    scheduleUnload();
    process();
  } catch (err) {
    setStatus({ state: 'error', progress: null, text: friendlyError(err) });
    throw err;
  }
}

export async function deleteModel() {
  await llm.remove(modelKey());
  await store.setKV('llmReady', false);
  setStatus({ state: 'idle', text: 'Model removed' });
}

/**
 * Crash guard. If iOS kills the app while the model is downloading, loading
 * or running, the page just reloads. A marker records which stage was in
 * progress; it's cleared when the work finishes. Finding it at startup tells
 * us how the last attempt died:
 *   download        -> interrupted (app closed / backgrounded): resume
 *   load / generate -> the model needs more GPU memory than iOS allows this
 *                      web app: step down to the next smaller model
 */
let marker = null;

async function guarded(phase, fn) {
  marker = { at: Date.now(), phase, model: modelKey(), progress: 0 };
  await store.setKV('llmInFlight', marker);
  try {
    return await fn();
  } finally {
    marker = null;
    await store.setKV('llmInFlight', null);
  }
}

// Called from progress callbacks; writes only when the stage changes or
// download progress moves another 10%, to keep IndexedDB writes cheap
function markProgress(p) {
  if (!marker) return;
  const phase = llm.phaseOf(p.text) || marker.phase;
  const progress = Math.round((p.progress || 0) * 100);
  if (phase !== marker.phase || progress - marker.progress >= 10) {
    marker = { ...marker, phase, progress };
    store.setKV('llmInFlight', marker);
  }
}

function markPhase(phase) {
  if (!marker || marker.phase === phase) return;
  marker = { ...marker, phase };
  store.setKV('llmInFlight', marker);
}

export function lastIssue() {
  return store.getKV('llmLastIssue', null);
}

async function recoverFromCrash() {
  let m = store.getKV('llmInFlight');
  if (!m) return;
  if (typeof m === 'number') m = { at: m, phase: 'load', model: modelKey(), progress: 0 };
  await store.setKV('llmInFlight', null);

  const model = llm.MODELS[m.model] || llm.MODELS[modelKey()];
  let text;
  if (m.phase === 'download') {
    text = `The download stopped at ${m.progress}%: Palate was closed or went to the background. ` +
      'Tap Download to resume. The finished part is kept.';
  } else {
    await store.setKV('llmReady', false);
    const order = llm.MODEL_ORDER;
    const smaller = order[order.indexOf(model.key) + 1];
    const what = m.phase === 'generate' ? 'running' : 'loading';
    if (smaller) {
      await store.setKV('organizerModel', smaller);
      const next = llm.MODELS[smaller];
      text = `iOS closed Palate while ${what} ${model.label}. It needs about ${(model.memoryMB / 1024).toFixed(1)} GB ` +
        `of GPU memory, more than iOS lets a web app use. Switched to ${next.short} (about ${(next.memoryMB / 1024).toFixed(1)} GB). Tap Download to try it.`;
    } else {
      text = `iOS closed Palate even with ${model.label}, so this phone can't run the model inside Safari. ` +
        'Basic tidy-up is used instead.';
    }
  }
  const issue = { at: Date.now(), phase: m.phase, model: model.key, progress: m.progress, text };
  await store.setKV('llmLastIssue', issue);
  setStatus({ state: 'error', text });
}

function friendlyError(err) {
  const raw = llm.errorText(err);
  let friendly = null;
  if (/memory|OOM|allocation|device lost|DeviceLost/i.test(raw)) {
    friendly = 'The phone ran out of GPU memory. Try a smaller model.';
  } else if (/quota|storage/i.test(raw)) {
    friendly = 'Not enough storage space for the model.';
  } else if (/fetch|network|load failed/i.test(raw)) {
    friendly = "Couldn't download the model files.";
  } else if (/worker/i.test(raw)) {
    friendly = "The model couldn't start.";
  }
  // Keep the real cause visible so it can be diagnosed
  return friendly ? `${friendly} (${raw})` : raw;
}

// ============================================
// Records (for the "Organized" banner and undo)
// ============================================

function records() {
  return store.getKV('organized', {});
}

export function getRecord(noteId) {
  return records()[noteId] || null;
}

async function saveRecord(noteId, rec) {
  const all = { ...records() };
  if (rec) all[noteId] = rec;
  else delete all[noteId];
  // Keep the map bounded: drop the oldest entries
  const ids = Object.keys(all);
  if (ids.length > MAX_RECORDS) {
    ids.sort((a, b) => all[a].at - all[b].at).slice(0, ids.length - MAX_RECORDS).forEach((id) => delete all[id]);
  }
  await store.setKV('organized', all);
}

export async function dismiss(noteId) {
  const rec = getRecord(noteId);
  if (rec) await saveRecord(noteId, { ...rec, dismissed: true });
}

export async function undo(noteId) {
  const rec = getRecord(noteId);
  const note = store.getNote(noteId);
  if (!rec || !note) return false;
  await store.snapshotNow(noteId);
  await store.updateNote(noteId, rec.before, { snapshot: false });
  await saveRecord(noteId, { ...rec, undone: true, dismissed: true });
  return true;
}

export async function acceptSuggestedProject(noteId) {
  const rec = getRecord(noteId);
  if (!rec?.report?.suggestedProject) return null;
  const project = await store.createProject(rec.report.suggestedProject);
  await store.updateNote(noteId, { projectId: project.id }, { snapshot: false });
  await saveRecord(noteId, { ...rec, report: { ...rec.report, suggestedProject: null, project: project.id } });
  return project;
}

// ============================================
// Queue
// ============================================

function queue() {
  return store.getKV('organizeQueue', []);
}

async function setQueue(q) {
  await store.setKV('organizeQueue', q);
  setStatus({});
}

export function isQueued(noteId) {
  return queue().some((j) => j.id === noteId) || status.current === noteId;
}

export async function enqueue(noteId, { keepProject = false } = {}) {
  const q = queue().filter((j) => j.id !== noteId);
  q.push({ id: noteId, keepProject, attempts: 0 });
  await setQueue(q);
  process();
}

/**
 * Queue every note that hasn't been organized (or was undone/edited since)
 */
export async function enqueueAll() {
  const recs = records();
  const q = queue();
  const queued = new Set(q.map((j) => j.id));
  let added = 0;
  for (const note of store.listNotes()) {
    const rec = recs[note.id];
    if (queued.has(note.id) || !note.body.trim()) continue;
    if (rec && (rec.undone || rec.method === 'model' || (rec.method === 'basic' && !isModelReady()))) continue;
    q.push({ id: note.id, keepProject: Boolean(note.projectId), attempts: 0 });
    added++;
  }
  await setQueue(q);
  process();
  return added;
}

/**
 * The editor calls this while a note is open, so organizing never races
 * the user's typing. Closing the note (null) resumes the queue.
 */
export function setBusyNote(noteId) {
  busyNoteId = noteId;
  if (!noteId) process();
}

export function setEngineForTests(engine) {
  engineOverride = engine;
}

async function useModel() {
  if (engineOverride) return true;
  if (!isModelReady()) return false;
  const s = await llm.checkSupport();
  return s.ok;
}

/**
 * Work through the queue while the app is in the foreground
 */
export async function process() {
  if (running) return;
  running = true;
  clearTimeout(idleTimer);
  try {
    while (document.visibilityState === 'visible') {
      const job = queue().find((j) => j.id !== busyNoteId);
      if (!job) break;
      setStatus({ state: 'working', current: job.id, text: 'Organizing…' });
      let requeue = false;
      try {
        requeue = await organize(job);
      } catch (err) {
        console.error('[organizer]', err);
        job.attempts = (job.attempts || 0) + 1;
        if (job.attempts < 2) requeue = true;
        else {
          // Model keeps failing on this note: fall back to the rules
          await organize({ ...job, forceBasic: true }).catch(() => {});
        }
        setStatus({ state: 'error', text: friendlyError(err) });
      }
      const rest = queue().filter((j) => j.id !== job.id);
      if (requeue) rest.push(job);
      await setQueue(rest);
    }
  } finally {
    running = false;
    setStatus({ state: status.state === 'error' ? 'error' : 'idle', current: null });
    scheduleUnload();
  }
}

/**
 * Organize one note. Returns true when it should be retried later.
 */
async function organize(job) {
  const note = store.getNote(job.id);
  if (!note || note.deletedAt || !note.body.trim()) return false;
  const startedAt = note.updatedAt;
  const projects = store.listProjects();
  const tags = store.listTags().map((t) => t.tag);

  let result;
  let method = 'basic';
  if (!job.forceBasic && await useModel()) {
    const prompt = buildPrompt(note, { projects, tags });
    if (engineOverride) {
      result = parseResult(await engineOverride(prompt));
    } else {
      result = await guarded('load', async () => {
        if (!llm.isLoaded(modelKey())) {
          setStatus({ state: 'loading', text: 'Waking up the model…' });
          await llm.load(modelKey(), (p) => {
            markProgress(p);
            setStatus({ state: 'loading', progress: p.progress, text: p.text });
          });
          setStatus({ state: 'working', progress: null, text: 'Organizing…' });
        }
        markPhase('generate');
        return parseResult(await llm.generateJSON(prompt));
      });
    }
    if (!prompt.cleans) result.cleaned = null;
    method = 'model';
  } else {
    result = basicResult(note);
  }

  const neighbours = search.related(`${note.title}\n${note.body}`, { excludeId: note.id, limit: 5, minScore: 0.1 });
  const { patch, report } = planChanges(note, result, {
    projects,
    tags,
    existingTags: tags,
    keepProject: job.keepProject,
    votedProjectId: voteProject(neighbours)
  });

  // The user edited (or opened) the note while we worked: retry later
  const current = store.getNote(job.id);
  if (!current) return false;
  if (current.updatedAt !== startedAt || busyNoteId === job.id) {
    job.attempts = (job.attempts || 0) + 1;
    return job.attempts < 3;
  }

  if (Object.keys(patch).length) {
    await store.snapshotNow(note.id);
    await store.updateNote(note.id, patch, { snapshot: false });
  }
  await saveRecord(note.id, {
    at: Date.now(),
    method,
    before: { title: note.title, body: note.body, projectId: note.projectId },
    changed: Object.keys(patch),
    report
  });
  return false;
}

function scheduleUnload() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!running) llm.unload();
  }, IDLE_UNLOAD_MS);
}

export async function start() {
  await recoverFromCrash();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // iOS kills backgrounded web apps holding lots of GPU memory
      if (!running) llm.unload();
    } else {
      process();
    }
  });
  setStatus({});
  if (queue().length) setTimeout(process, 1500);
}
