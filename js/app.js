import * as store from './store.js';
import * as sync from './sync.js';
import * as search from './search.js';
import * as morph from './morph.js';
import * as predictor from './predictor.js';
import * as keys from './keyboard/keyboard.js';
import * as lang from './keyboard/language.js';
import { getTheme, applyTheme, toggleTheme } from './theme.js';
import { buildMarkdownFiles } from './markdown.js';
import { createZip } from './zip.js';
import * as organizer from './organize/organizer.js';
import * as llm from './organize/llm.js';

const app = document.getElementById('app');
applyTheme(getTheme());

let currentView = 'palate';
let viewParams = {};
let cleanupView = () => {};

// ============================================
// Utilities
// ============================================

function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]
  ));
}

function formatDate(ms) {
  const date = new Date(ms);
  const now = new Date();
  const diff = now - date;
  if (diff < 60 * 1000) return 'just now';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}m ago`;
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  const opts = { month: 'short', day: 'numeric' };
  if (date.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString('en-US', opts);
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function showToast(message, action) {
  document.querySelector('.toast')?.remove();
  const toast = document.createElement('div');
  toast.className = action ? 'toast toast-sticky' : 'toast';
  toast.innerHTML = `<span>${esc(message)}</span>${action ? `<button class="toast-action">${esc(action.label)}</button>` : ''}`;
  document.body.appendChild(toast);
  if (action) {
    toast.querySelector('.toast-action').addEventListener('click', () => {
      toast.remove();
      action.onTap();
    });
  }
  setTimeout(() => toast.remove(), action ? 4500 : 2000);
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  showToast('Copied');
}

function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function debounce(fn, ms) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.flush = (...args) => {
    clearTimeout(timer);
    fn(...args);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

const ICONS = {
  back: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  library: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 5h16M4 12h16M4 19h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  more: '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>',
  settings: '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  pin: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M9 3h6l-1 6 4 4H6l4-4zM12 13v8" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  sun: '<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  moon: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>'
};

// ============================================
// Router
// ============================================

function navigate(view, params = {}) {
  document.querySelector('.toast:not(.toast-sticky)')?.remove();
  cleanupView();
  cleanupView = () => {};
  currentView = view;
  viewParams = params;
  keys.setAction(null);
  render();
}

function render() {
  // Re-rendering a view must release the previous render's listeners
  cleanupView();
  cleanupView = () => {};
  switch (currentView) {
    case 'library': return renderLibraryView();
    case 'note': return renderNoteView(viewParams.noteId);
    case 'settings': return renderSettingsView();
    default: return renderPalateView();
  }
}

// ============================================
// Shared widgets
// ============================================

function syncDotHtml() {
  return '<button class="sync-dot" id="sync-dot" aria-label="Sync status"><span></span></button>';
}

function bindSyncDot() {
  const dot = document.getElementById('sync-dot');
  if (!dot) return () => {};
  dot.addEventListener('click', () => navigate('settings', { focus: 'sync' }));
  return sync.onStatus(({ status, detail }) => {
    dot.dataset.status = status;
    dot.title = detail || status;
  });
}

/**
 * Recall strip: related notes for whatever is being written
 */
function bindRecall(input, strip, { excludeId = null } = {}) {
  const update = debounce(() => {
    const text = input.value.slice(-1500);
    const hits = search.related(text, { excludeId, limit: 2 });
    if (!hits.length) {
      strip.classList.remove('recall-on');
      strip.innerHTML = '';
      return;
    }
    strip.innerHTML = '<span class="recall-label">Related</span>' + hits.map((h) =>
      `<button class="recall-chip" data-id="${h.note.id}">${esc(h.note.title)}</button>`
    ).join('');
    strip.classList.add('recall-on');
  }, 900);

  input.addEventListener('input', update);
  strip.addEventListener('pointerdown', (e) => e.preventDefault());
  strip.addEventListener('click', (e) => {
    const chip = e.target.closest('.recall-chip');
    if (chip) showPeek(chip.dataset.id, input);
  });
  update();
  return () => update.cancel();
}

function showPeek(noteId, input) {
  const note = store.getNote(noteId);
  if (!note) return;
  const project = note.projectId ? store.getProject(note.projectId) : null;
  const overlay = sheet(`
    <div class="modal-header">
      <div>
        <div class="modal-title">${esc(note.title)}</div>
        <div class="modal-sub">${esc(project ? project.name : 'Inbox')} · ${formatDate(note.updatedAt)}</div>
      </div>
      <button class="modal-close" data-close>&times;</button>
    </div>
    <div class="modal-body peek-body">${esc(note.body)}</div>
    <div class="modal-actions modal-actions-row">
      <button class="btn btn-secondary" id="peek-link">Insert [[link]]</button>
      <button class="btn btn-primary" id="peek-open">Open</button>
    </div>
  `, { keepFocus: true });
  overlay.querySelector('#peek-open').addEventListener('click', () => {
    overlay.close();
    navigate('note', { noteId });
  });
  overlay.querySelector('#peek-link').addEventListener('click', () => {
    overlay.close();
    input.focus();
    const pos = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, pos);
    const text = (before && !/\s$/.test(before) ? ' ' : '') + `[[${note.title}]] `;
    input.setSelectionRange(pos, pos);
    if (!document.execCommand('insertText', false, text)) {
      input.setRangeText(text, pos, pos, 'end');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
}

/**
 * Bottom sheet. Returns the overlay element with a close() method.
 * keepFocus: tapping the sheet doesn't blur the text field underneath.
 */
function sheet(innerHtml, { keepFocus = false, className = '' } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal ${className}">${innerHtml}</div>`;
  document.body.appendChild(overlay);
  overlay.close = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-close]')) overlay.close();
  });
  if (keepFocus) {
    overlay.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('input, textarea')) e.preventDefault();
    });
  }
  keys.decorate(overlay);
  return overlay;
}

/**
 * Pick a project (or create one). Resolves to a project id, null for Inbox,
 * or undefined when dismissed.
 */
function pickProject({ title = 'Choose project', current = undefined, allowInbox = true, inboxLabel = 'Inbox' } = {}) {
  return new Promise((resolve) => {
    const projects = store.listProjects();
    const overlay = sheet(`
      <div class="modal-header">
        <span class="modal-title">${esc(title)}</span>
        <button class="modal-close" data-close>&times;</button>
      </div>
      <div class="modal-body">
        <div class="new-project-row">
          <input type="text" class="input" id="new-project-name" placeholder="New project…" data-pk enterkeyhint="done">
          <button class="btn btn-primary btn-small" id="create-project">Add</button>
        </div>
        ${allowInbox ? `<div class="project-option ${current === null ? 'selected' : ''}" data-id="">${esc(inboxLabel)} <span class="option-meta">${inboxLabel === 'Inbox' ? 'no project' : 'organizer picks'}</span></div>` : ''}
        ${projects.map((p) => `
          <div class="project-option ${p.id === current ? 'selected' : ''}" data-id="${p.id}">
            ${esc(p.name)} <span class="option-meta">${store.listNotes({ projectId: p.id }).length}</span>
          </div>`).join('')}
      </div>
    `);
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      overlay.close();
      resolve(value);
    };
    const origClose = overlay.close;
    overlay.close = () => {
      origClose();
      if (!done) {
        done = true;
        resolve(undefined);
      }
    };
    overlay.querySelector('.modal-body').addEventListener('click', (e) => {
      const opt = e.target.closest('.project-option');
      if (opt) finish(opt.dataset.id || null);
    });
    const input = overlay.querySelector('#new-project-name');
    const create = async () => {
      const name = input.value.trim();
      if (!name) return;
      const project = await store.createProject(name);
      finish(project.id);
    };
    overlay.querySelector('#create-project').addEventListener('click', create);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
  });
}

// ============================================
// Palate (capture) view
// ============================================

function renderPalateView() {
  const content = store.getKV('livePalate', '');
  const activeId = store.getActiveProjectId();
  const active = activeId ? store.getProject(activeId) : null;
  const theme = getTheme();

  app.innerHTML = `
    <div class="view palate-view">
      <header class="header">
        <button class="icon-btn" id="nav-library" aria-label="Library">${ICONS.library}</button>
        <button class="project-selector" id="project-selector">
          <span class="project-selector-label">${active ? esc(active.name) : (organizer.isAuto() ? 'Auto-file' : 'Inbox')}</span>
          <span class="project-selector-arrow">▾</span>
        </button>
        <div class="header-right">
          ${syncDotHtml()}
          <button class="icon-btn" id="theme-toggle" aria-label="Toggle theme">${theme === 'dark' ? ICONS.sun : ICONS.moon}</button>
        </div>
      </header>
      <div class="palate-textarea-wrapper">
        <textarea class="palate-textarea" id="palate-input" placeholder="Start typing…" data-pk>${esc(content)}</textarea>
      </div>
      <div class="recall-strip" id="recall"></div>
      <div class="palate-actions">
        <button class="btn btn-secondary" id="copy-all">Copy</button>
        <button class="btn btn-primary" id="archive">Archive${active ? ` to ${esc(active.name)}` : ''}</button>
      </div>
    </div>
  `;
  keys.decorate(app);

  const textarea = document.getElementById('palate-input');
  const save = debounce(() => store.setKV('livePalate', textarea.value), 250);
  textarea.addEventListener('input', () => save());
  textarea.addEventListener('blur', () => save.flush());

  const archive = async () => {
    save.flush();
    const text = textarea.value;
    if (!text.trim()) {
      showToast('Nothing to archive');
      return;
    }
    const auto = organizer.isAuto();
    let projectId = store.getActiveProjectId();
    if (!auto && projectId === null && store.listProjects().length) {
      const picked = await pickProject({ title: 'Archive to…', current: null });
      if (picked === undefined) return;
      projectId = picked;
    }
    const note = await store.createNote({ projectId, body: text });
    await store.setKV('livePalate', '');
    morph.learn(text).then(refreshVocabulary);
    // Auto mode: just write. Filing, title, tags and tidy-up happen in the background
    if (auto) organizer.enqueue(note.id, { keepProject: projectId !== null });
    showToast(auto ? 'Archived · organizing' : 'Archived', { label: 'Open', onTap: () => navigate('note', { noteId: note.id }) });
    render();
  };

  keys.setAction({ label: 'Archive', onTap: archive });
  document.getElementById('archive').addEventListener('click', archive);
  document.getElementById('copy-all').addEventListener('click', () => {
    if (!textarea.value.trim()) return showToast('Nothing to copy');
    copyToClipboard(textarea.value);
  });
  document.getElementById('nav-library').addEventListener('click', () => {
    save.flush();
    navigate('library');
  });
  document.getElementById('project-selector').addEventListener('click', async () => {
    const picked = await pickProject({
      title: organizer.isAuto() ? 'Archive into (or Auto-file)' : 'Archive into',
      current: store.getActiveProjectId(),
      inboxLabel: organizer.isAuto() ? 'Auto-file' : 'Inbox'
    });
    if (picked === undefined) return;
    await store.setActiveProjectId(picked);
    render();
  });
  document.getElementById('theme-toggle').addEventListener('click', (e) => {
    const next = toggleTheme();
    e.currentTarget.innerHTML = next === 'dark' ? ICONS.sun : ICONS.moon;
  });

  const unsubSync = bindSyncDot();
  const unsubRecall = bindRecall(textarea, document.getElementById('recall'));
  const edges = initEdgeSwitcher();
  cleanupView = () => {
    save.flush();
    unsubSync();
    unsubRecall();
    edges();
  };

  // Empty draft: ready to type immediately
  if (!content) setTimeout(() => textarea.focus(), 50);
  else textarea.setSelectionRange(content.length, content.length);
}

// ============================================
// Library view
// ============================================

function renderLibraryView() {
  const filter = viewParams.filter || { kind: 'all' };
  const query = viewParams.query || '';

  app.innerHTML = `
    <div class="view library-view">
      <header class="header">
        <button class="icon-btn" id="back-palate" aria-label="Back to Palate">${ICONS.back}</button>
        <span class="header-title">Library</span>
        <div class="header-right">
          ${syncDotHtml()}
          <button class="icon-btn" id="nav-settings" aria-label="Settings">${ICONS.settings}</button>
        </div>
      </header>
      <div class="search-row">
        <input type="search" class="search-input" id="search" placeholder="Search notes, #tags…"
               value="${esc(query)}" data-pk data-pk-cap="off" data-pk-correct="off" enterkeyhint="search">
      </div>
      <div class="chips" id="chips"></div>
      <div class="project-bar" id="project-bar"></div>
      <div class="list" id="note-list"></div>
      <button class="fab" id="new-note" aria-label="New note">${ICONS.plus}</button>
    </div>
  `;
  keys.decorate(app);

  const searchInput = document.getElementById('search');
  const chipsEl = document.getElementById('chips');
  const listEl = document.getElementById('note-list');
  const projectBar = document.getElementById('project-bar');

  function renderChips() {
    const projects = store.listProjects();
    const tags = store.listTags().slice(0, 12);
    const chip = (kind, id, label, count) => {
      const on = filter.kind === kind && (filter.id ?? null) === (id ?? null);
      return `<button class="chip ${on ? 'chip-on' : ''}" data-kind="${kind}" data-id="${esc(id ?? '')}">${esc(label)}${count !== undefined ? `<span class="chip-count">${count}</span>` : ''}</button>`;
    };
    chipsEl.innerHTML = [
      chip('all', null, 'All', store.listNotes().length),
      chip('inbox', null, 'Inbox', store.listNotes({ projectId: null }).length),
      ...projects.map((p) => chip('project', p.id, p.name, store.listNotes({ projectId: p.id }).length)),
      ...tags.map((t) => chip('tag', t.tag, '#' + t.tag, t.count))
    ].join('');

    if (filter.kind === 'project' && store.getProject(filter.id)) {
      projectBar.innerHTML = `
        <button class="link-btn" id="rename-project">Rename</button>
        <button class="link-btn link-danger" id="delete-project">Delete project</button>`;
      projectBar.classList.add('project-bar-on');
    } else {
      projectBar.innerHTML = '';
      projectBar.classList.remove('project-bar-on');
    }
  }

  function filteredNotes() {
    const q = searchInput.value;
    let base;
    if (q.trim()) {
      base = search.search(q).map((r) => r.note);
    } else {
      base = store.listNotes();
    }
    if (filter.kind === 'inbox') base = base.filter((n) => !n.projectId);
    if (filter.kind === 'project') base = base.filter((n) => n.projectId === filter.id);
    if (filter.kind === 'tag') base = base.filter((n) => n.tags?.includes(filter.id));
    return base;
  }

  function renderList() {
    const q = searchInput.value;
    const notes = filteredNotes();
    viewParams.query = q;
    let html = '';

    if (!q.trim() && filter.kind === 'all') {
      const old = search.resurface();
      if (old) {
        html += `
          <div class="resurface" data-id="${old.id}">
            <div class="resurface-label">From your archive · ${formatDate(old.createdAt)}</div>
            <div class="resurface-title">${esc(old.title)}</div>
            <div class="resurface-body">${esc(old.body.slice(0, 160))}</div>
          </div>`;
      }
    }

    if (!notes.length) {
      html += `<div class="empty-state"><p>${q.trim() ? 'No matches.' : 'No notes here yet.<br>Archive something from the Palate to start.'}</p></div>`;
    } else {
      html += notes.slice(0, 300).map((n) => {
        const project = n.projectId ? store.getProject(n.projectId) : null;
        const preview = q.trim()
          ? search.snippet(n, q, esc)
          : esc(n.body.replace(/\s+/g, ' ').trim().slice(n.body.trim().startsWith(n.title) ? n.title.length : 0).trim().slice(0, 120));
        return `
          <div class="note-item" data-id="${n.id}">
            <div class="note-item-title">${n.pinned ? `<span class="pin">${ICONS.pin}</span>` : ''}${esc(n.title)}</div>
            ${preview ? `<div class="note-item-preview">${preview}</div>` : ''}
            <div class="note-item-meta">${organizer.isQueued(n.id) ? '<span class="organizing">✨ organizing…</span> · ' : ''}${formatDate(n.updatedAt)}${filter.kind !== 'project' && project ? ` · ${esc(project.name)}` : ''}${n.tags?.length ? ` · ${n.tags.slice(0, 3).map((t) => '#' + esc(t)).join(' ')}` : ''}</div>
          </div>`;
      }).join('');
    }
    listEl.innerHTML = html;
  }

  renderChips();
  renderList();

  searchInput.addEventListener('input', debounce(renderList, 80));
  chipsEl.addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    const next = { kind: c.dataset.kind, id: c.dataset.id || null };
    viewParams.filter = filter.kind === next.kind && filter.id === next.id ? { kind: 'all' } : next;
    navigate('library', viewParams);
  });
  listEl.addEventListener('click', (e) => {
    const item = e.target.closest('[data-id]');
    if (item) navigate('note', { noteId: item.dataset.id, from: { ...viewParams } });
  });
  projectBar.addEventListener('click', async (e) => {
    const project = store.getProject(filter.id);
    if (!project) return;
    if (e.target.id === 'rename-project') {
      const name = prompt('Rename project', project.name);
      if (name && name.trim()) {
        await store.updateProject(project.id, { name: name.trim() });
        renderChips();
      }
    } else if (e.target.id === 'delete-project') {
      if (confirm(`Delete "${project.name}"? Its notes move to the Inbox.`)) {
        await store.deleteProject(project.id);
        viewParams.filter = { kind: 'all' };
        navigate('library', viewParams);
      }
    }
  });
  document.getElementById('new-note').addEventListener('click', async () => {
    const projectId = filter.kind === 'project' ? filter.id : null;
    const note = await store.createNote({ projectId, title: '', body: '' });
    navigate('note', { noteId: note.id, from: { ...viewParams }, isNew: true });
  });
  document.getElementById('back-palate').addEventListener('click', () => navigate('palate'));
  document.getElementById('nav-settings').addEventListener('click', () => navigate('settings'));

  const unsubSync = bindSyncDot();
  // Remote sync and background organizing both change notes under us
  const refresh = debounce(() => {
    renderChips();
    renderList();
  }, 250);
  const unsubNotes = store.on('notes', refresh);
  const unsubProjects = store.on('projects', refresh);
  const unsubOrg = organizer.onStatus(refresh);
  cleanupView = () => {
    refresh.cancel();
    unsubSync();
    unsubNotes();
    unsubProjects();
    unsubOrg();
  };
}

// ============================================
// Note view (editor)
// ============================================

function renderNoteView(noteId) {
  const note = store.getNote(noteId);
  if (!note || note.deletedAt) {
    navigate('library');
    return;
  }
  const project = note.projectId ? store.getProject(note.projectId) : null;
  const back = () => navigate('library', viewParams.from || {});

  app.innerHTML = `
    <div class="view note-view">
      <header class="header">
        <button class="icon-btn" id="back" aria-label="Back">${ICONS.back}</button>
        <button class="project-selector" id="move">
          <span class="project-selector-label">${esc(project ? project.name : 'Inbox')}</span>
          <span class="project-selector-arrow">▾</span>
        </button>
        <div class="header-right">
          ${syncDotHtml()}
          <button class="icon-btn" id="menu" aria-label="More">${ICONS.more}</button>
        </div>
      </header>
      <div class="organize-banner" id="org-banner"></div>
      <div class="note-editor">
        <input class="note-title" id="title" value="" placeholder="Title" data-pk enterkeyhint="next">
        <textarea class="note-body" id="body" placeholder="Write…" data-pk>${esc(note.body)}</textarea>
      </div>
      <div class="recall-strip" id="recall"></div>
      <div class="note-footer" id="footer"></div>
    </div>
  `;
  keys.decorate(app);

  const titleEl = document.getElementById('title');
  const bodyEl = document.getElementById('body');
  const footer = document.getElementById('footer');
  // Like Apple Notes, the first line is the title. A separate title field
  // only shows for custom titles (migrated ones, or set from the menu).
  let titleTouched = note.body.trim() ? note.title !== store.autoTitle(note.body) : false;
  const showTitle = (on) => titleEl.classList.toggle('hidden', !on);
  if (titleTouched) titleEl.value = note.title;
  showTitle(titleTouched);

  // Set when the note's text is replaced underneath the editor (undo,
  // organize): the editor's stale copy must not be saved back over it
  let saveDisabled = false;
  const save = debounce(async () => {
    const current = store.getNote(noteId);
    if (!current || saveDisabled) return;
    let title = titleEl.value.trim();
    if (!titleTouched || !title) title = store.autoTitle(bodyEl.value);
    if (title !== current.title || bodyEl.value !== current.body) {
      await store.updateNote(noteId, { title, body: bodyEl.value });
      renderFooter();
    }
  }, 400);

  titleEl.addEventListener('input', () => {
    titleTouched = titleEl.value.trim().length > 0;
    save();
  });
  titleEl.addEventListener('blur', () => {
    if (!titleEl.value.trim()) showTitle(false);
  });
  titleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      bodyEl.focus();
    }
  });
  bodyEl.addEventListener('input', () => save());

  function renderFooter() {
    const n = store.getNote(noteId);
    if (!n) return;
    const links = (n.links || []).map((title) => {
      const target = store.findNoteByTitle(title);
      return `<button class="link-chip ${target ? '' : 'link-missing'}" data-link="${esc(title)}">[[${esc(title)}]]</button>`;
    });
    const backlinks = store.backlinksTo(n).map((b) =>
      `<button class="link-chip link-back" data-open="${b.id}">← ${esc(b.title)}</button>`);
    const tags = (n.tags || []).map((t) => `<button class="link-chip link-tag" data-tag="${esc(t)}">#${esc(t)}</button>`);
    footer.innerHTML = `
      ${links.length || backlinks.length || tags.length ? `<div class="footer-chips">${[...tags, ...links, ...backlinks].join('')}</div>` : ''}
      <div class="footer-meta">Edited ${formatDate(n.updatedAt)} · created ${formatDate(n.createdAt)}</div>`;
  }
  renderFooter();

  // ---- Organizer banner ----
  const banner = document.getElementById('org-banner');
  organizer.setBusyNote(noteId);

  function renderBanner() {
    const rec = organizer.getRecord(noteId);
    if (organizer.isQueued(noteId)) {
      banner.innerHTML = `<span>⏳ Will organize when you close this note</span>
        <button class="link-btn" data-org="now">Organize now</button>`;
      banner.classList.add('on');
      return;
    }
    if (!rec || rec.dismissed || rec.undone) {
      banner.classList.remove('on');
      banner.innerHTML = '';
      return;
    }
    const r = rec.report || {};
    const bits = [];
    if (rec.changed.includes('title')) bits.push('title');
    if (r.project) bits.push(`filed in ${esc(store.getProject(r.project)?.name || 'project')}`);
    if (r.tagsAdded?.length) bits.push(r.tagsAdded.map((t) => '#' + esc(t)).join(' '));
    if (r.todosAdded) bits.push(`${r.todosAdded} to-do${r.todosAdded === 1 ? '' : 's'}`);
    if (r.cleanup === 'applied') bits.push('cleaned up');
    if (r.cleanup === 'rejected') bits.push('kept your wording');
    banner.innerHTML = `
      <span>✨ Organized${rec.method === 'basic' ? ' (basic)' : ''}${bits.length ? ': ' + bits.join(' · ') : ''}</span>
      <span class="banner-actions">
        ${r.suggestedProject ? `<button class="link-btn" data-org="project">Create “${esc(r.suggestedProject)}” &amp; move</button>` : ''}
        ${rec.changed.length ? '<button class="link-btn" data-org="original">See original</button><button class="link-btn" data-org="undo">Undo</button>' : ''}
        <button class="link-btn banner-close" data-org="dismiss" aria-label="Dismiss">✕</button>
      </span>`;
    banner.classList.add('on');
  }
  renderBanner();

  async function organizeNow() {
    save.flush();
    saveDisabled = true;
    document.activeElement?.blur();
    bodyEl.readOnly = true;
    titleEl.readOnly = true;
    banner.innerHTML = '<span>✨ Organizing…</span>';
    banner.classList.add('on');
    await organizer.enqueue(noteId, { keepProject: Boolean(store.getNote(noteId)?.projectId) });
    organizer.setBusyNote(null);
    const stop = organizer.onStatus(() => {
      if (!organizer.isQueued(noteId)) {
        stop();
        if (currentView === 'note' && viewParams.noteId === noteId) render();
      }
    });
  }

  banner.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-org]')?.dataset.org;
    if (!act) return;
    const rec = organizer.getRecord(noteId);
    if (act === 'now') organizeNow();
    if (act === 'dismiss') {
      await organizer.dismiss(noteId);
      renderBanner();
    }
    if (act === 'undo') {
      save.flush();
      saveDisabled = true;
      await organizer.undo(noteId);
      showToast('Restored your original');
      render();
    }
    if (act === 'project') {
      save.flush();
      const project = await organizer.acceptSuggestedProject(noteId);
      if (project) showToast(`Moved to ${project.name}`);
      render();
    }
    if (act === 'original' && rec) {
      sheet(`
        <div class="modal-header">
          <span class="modal-title">Original</span>
          <button class="modal-close" data-close>&times;</button>
        </div>
        <div class="modal-body peek-body">${esc(rec.before.body)}</div>
      `);
    }
  });

  footer.addEventListener('click', async (e) => {
    const link = e.target.closest('[data-link]');
    const open = e.target.closest('[data-open]');
    const tag = e.target.closest('[data-tag]');
    save.flush();
    if (open) navigate('note', { noteId: open.dataset.open, from: viewParams.from });
    if (tag) navigate('library', { filter: { kind: 'tag', id: tag.dataset.tag } });
    if (link) {
      let target = store.findNoteByTitle(link.dataset.link);
      if (!target) {
        if (!confirm(`Create a note called "${link.dataset.link}"?`)) return;
        target = await store.createNote({ projectId: note.projectId, title: link.dataset.link, body: link.dataset.link + '\n\n' });
      }
      navigate('note', { noteId: target.id, from: viewParams.from });
    }
  });

  document.getElementById('back').addEventListener('click', () => {
    save.flush();
    const n = store.getNote(noteId);
    if (n && viewParams.isNew && !n.body.trim() && !titleTouched) {
      store.deleteNote(noteId); // discard an untouched new note
    }
    back();
  });

  document.getElementById('move').addEventListener('click', async () => {
    save.flush();
    const picked = await pickProject({ title: 'Move to', current: store.getNote(noteId).projectId });
    if (picked === undefined) return;
    await store.updateNote(noteId, { projectId: picked }, { snapshot: false });
    render();
  });

  document.getElementById('menu').addEventListener('click', () => {
    save.flush();
    const n = store.getNote(noteId);
    const overlay = sheet(`
      <div class="menu">
        <button class="menu-item" data-act="pin">${n.pinned ? 'Unpin' : 'Pin to top'}</button>
        <button class="menu-item" data-act="title">${titleTouched ? 'Edit title' : 'Set a custom title'}</button>
        <button class="menu-item" data-act="copy">Copy text</button>
        <button class="menu-item" data-act="organize">Organize this note</button>
        <button class="menu-item" data-act="history">Version history</button>
        <button class="menu-item" data-act="palate">Send to Palate</button>
        <button class="menu-item menu-danger" data-act="delete">Delete note</button>
        <button class="menu-item menu-cancel" data-close>Cancel</button>
      </div>
    `);
    overlay.querySelector('.menu').addEventListener('click', async (e) => {
      const act = e.target.dataset.act;
      if (!act) return;
      overlay.close();
      if (act === 'pin') {
        await store.updateNote(noteId, { pinned: !n.pinned }, { snapshot: false });
        showToast(n.pinned ? 'Unpinned' : 'Pinned');
      } else if (act === 'title') {
        showTitle(true);
        if (!titleEl.value) titleEl.value = n.title;
        titleTouched = true;
        titleEl.focus();
        titleEl.select();
      } else if (act === 'copy') {
        copyToClipboard(n.body);
      } else if (act === 'organize') {
        organizeNow();
      } else if (act === 'history') {
        save.flush();
        showHistory(noteId, () => {
          saveDisabled = true;
          render();
        });
      } else if (act === 'palate') {
        const draft = store.getKV('livePalate', '');
        await store.setKV('livePalate', draft ? draft + '\n\n' + n.body : n.body);
        navigate('palate');
      } else if (act === 'delete') {
        await store.deleteNote(noteId);
        back();
        showToast('Note deleted', { label: 'Undo', onTap: async () => {
          await store.restoreNote(noteId);
          navigate('note', { noteId });
        } });
      }
    });
  });

  keys.setAction({ label: 'Done', onTap: () => document.activeElement?.blur() });

  const unsubSync = bindSyncDot();
  const unsubRecall = bindRecall(bodyEl, document.getElementById('recall'), { excludeId: noteId });
  const unsubNotes = store.on('notes', (e) => {
    if (!e.detail.remote || e.detail.id !== noteId) return;
    const n = store.getNote(noteId);
    if (!n) return;
    if (n.deletedAt) return back();
    // Only adopt remote content when the user isn't mid-edit
    if (document.activeElement !== bodyEl && document.activeElement !== titleEl) {
      bodyEl.value = n.body;
      titleTouched = n.body.trim() ? n.title !== store.autoTitle(n.body) : false;
      titleEl.value = titleTouched ? n.title : '';
      showTitle(titleTouched);
    }
    renderFooter();
  });
  cleanupView = () => {
    save.flush();
    unsubSync();
    unsubRecall();
    unsubNotes();
    organizer.setBusyNote(null);
  };

  if (viewParams.isNew) setTimeout(() => bodyEl.focus(), 50);
}

async function showHistory(noteId, onRestore) {
  const note = store.getNote(noteId);
  const [local, remote] = await Promise.all([
    store.listLocalVersions(noteId),
    sync.fetchServerVersions(noteId)
  ]);
  const seen = new Set();
  const versions = [...local.map((v) => ({ ...v, source: 'device' })), ...remote.map((v) => ({ ...v, source: 'server' }))]
    .filter((v) => {
      const key = v.body + '\u0000' + v.title;
      if (seen.has(key) || (v.body === note.body && v.title === note.title)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.savedAt - a.savedAt);

  const overlay = sheet(`
    <div class="modal-header">
      <span class="modal-title">Version history</span>
      <button class="modal-close" data-close>&times;</button>
    </div>
    <div class="modal-body">
      ${versions.length ? versions.map((v, i) => `
        <div class="version-item" data-i="${i}">
          <div class="version-date">${new Date(v.savedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            <span class="version-source">${v.reason === 'conflict' ? 'conflict copy' : v.source}</span></div>
          <div class="version-preview">${esc(v.body.replace(/\s+/g, ' ').slice(0, 140))}</div>
        </div>`).join('') : '<div class="empty-state"><p>No earlier versions yet.<br>Versions are saved as you edit (every 10 minutes at most).</p></div>'}
    </div>
  `);

  overlay.querySelector('.modal-body').addEventListener('click', (e) => {
    const item = e.target.closest('.version-item');
    if (!item) return;
    const v = versions[Number(item.dataset.i)];
    const preview = sheet(`
      <div class="modal-header">
        <span class="modal-title">${esc(v.title)}</span>
        <button class="modal-close" data-close>&times;</button>
      </div>
      <div class="modal-body peek-body">${esc(v.body)}</div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="restore">Restore this version</button>
      </div>
    `);
    preview.querySelector('#restore').addEventListener('click', async () => {
      await store.snapshotNow(noteId);
      await store.updateNote(noteId, { title: v.title, body: v.body }, { snapshot: false });
      preview.close();
      overlay.close();
      showToast('Version restored');
      onRestore();
    });
  });
}

// ============================================
// Settings view
// ============================================

function renderSettingsView() {
  const stats = store.getStats();
  const corpus = store.getKV('corpus', '');
  const corpusWords = corpus.trim() ? corpus.trim().split(/\s+/).length : 0;
  const mode = store.getKV('keyboardMode', 'auto');
  const autocorrect = store.getKV('autocorrect', true);
  const hapticsOn = store.getKV('haptics', true);
  const touchDebug = store.getKV('touchDebug', false);
  const learned = store.getKV('learnedWords', []);
  const trash = store.listNotes({ onlyDeleted: true }).filter((n) => n.body.trim());
  const token = sync.getToken();

  app.innerHTML = `
    <div class="view">
      <header class="header">
        <button class="icon-btn" id="back" aria-label="Back">${ICONS.back}</button>
        <span class="header-title">Settings</span>
        <span class="icon-btn-spacer"></span>
      </header>
      <div class="settings-content">

        <section class="settings-section" id="sync-section">
          <div class="settings-label">Sync &amp; storage</div>
          <div class="sync-status" id="sync-status"></div>
          <input type="password" class="input" id="sync-token" placeholder="Sync token (PALATE_TOKEN)"
                 value="${esc(token)}" data-pk data-pk-cap="off" data-pk-correct="off" autocomplete="off">
          <div class="row-buttons">
            <button class="btn btn-primary" id="save-token">${token ? 'Update token' : 'Turn on sync'}</button>
            <button class="btn btn-secondary" id="sync-now" ${token ? '' : 'disabled'}>Sync now</button>
          </div>
          <p class="settings-hint" id="health-hint">Notes are always saved on this device first. With a token, they also sync to your Postgres database on Vercel.</p>
        </section>

        <section class="settings-section" id="organize-section">
          <div class="settings-label">Auto-organize</div>
          <label class="toggle-row"><span>Organize notes when I archive</span><input type="checkbox" id="org-auto" ${organizer.isAuto() ? 'checked' : ''}></label>
          <p class="settings-hint">Gives each note a title, files it in a project, adds #tags, fixes spelling and punctuation, and pulls to-dos into a checklist. The original is kept in version history with one-tap Undo.</p>
          <div class="org-engine">
            <div class="org-engine-head">
              <strong>On-device model</strong>
              <span class="org-chip" id="org-ready"></span>
            </div>
            <div class="muted small" id="org-support">Checking this device…</div>
            <div class="segmented" id="org-model">
              ${Object.values(llm.MODELS).map((m) => `<button data-model="${m.key}" class="${organizer.modelKey() === m.key ? 'seg-on' : ''}">${m.short}</button>`).join('')}
            </div>
            <div class="muted small" id="org-model-info"></div>
            <div class="org-progress" id="org-progress"><div></div></div>
            <div class="muted small" id="org-status"></div>
            <div class="row-buttons">
              <button class="btn btn-primary" id="org-download"></button>
              <button class="btn btn-secondary" id="org-delete">Remove</button>
            </div>
            <p class="settings-hint">Runs entirely on your phone's GPU: notes never leave the device and it works offline. Keep Palate open while it downloads. Until it's downloaded, a basic rule-based tidy-up is used.</p>
          </div>
          <button class="btn btn-secondary settings-btn" id="org-all">Organize existing notes</button>
          <div class="muted small" id="org-queue"></div>
        </section>

        <section class="settings-section">
          <div class="settings-label">Keyboard</div>
          <div class="segmented" id="kb-mode">
            ${['auto', 'always', 'off'].map((m) => `<button data-mode="${m}" class="${mode === m ? 'seg-on' : ''}">${{ auto: 'Auto', always: 'Always', off: 'iOS keyboard' }[m]}</button>`).join('')}
          </div>
          <p class="settings-hint">Auto uses Palate Keys on touch screens. "iOS keyboard" switches back to the system keyboard (for dictation).</p>
          <label class="toggle-row"><span>Autocorrect</span><input type="checkbox" id="kb-autocorrect" ${autocorrect ? 'checked' : ''}></label>
          <label class="toggle-row"><span>Key haptics</span><input type="checkbox" id="kb-haptics" ${hapticsOn ? 'checked' : ''}></label>
          <label class="toggle-row"><span>Touch debug overlay</span><input type="checkbox" id="kb-debug" ${touchDebug ? 'checked' : ''}></label>
          <div class="toggle-row"><span>Learned words: ${learned.length}</span>${learned.length ? '<button class="link-btn" id="clear-learned">Clear</button>' : ''}</div>
          <p class="settings-hint">Tips: drag along the space bar to move the cursor · swipe left on ⌫ to delete words · swipe up on a key for its number or symbol · hold a key for accents · backspace right after an autocorrect undoes it and learns the word.</p>
        </section>

        <section class="settings-section">
          <div class="settings-label">Writing style</div>
          <p class="settings-hint" style="margin: 0 0 12px">Paste samples of your writing so predictions match how you write.</p>
          <textarea class="corpus-textarea" id="corpus" placeholder="Paste emails, messages, notes…" data-pk>${esc(corpus)}</textarea>
          <div class="corpus-stats"><span>${corpusWords.toLocaleString()} words</span></div>
          <div class="row-buttons">
            <button class="btn btn-secondary" id="save-corpus">Save</button>
            <button class="btn btn-primary" id="train">Retrain predictions</button>
          </div>
        </section>

        <section class="settings-section">
          <div class="settings-label">Your data</div>
          <div class="settings-stats">${plural(stats.noteCount, 'note')} · ${plural(stats.projectCount, 'project')}</div>
          <button class="btn btn-secondary settings-btn" id="export-md">Export Markdown (.zip)</button>
          <button class="btn btn-secondary settings-btn" id="export-json">Export full backup (.json)</button>
          <input type="file" id="import-file" accept=".json" hidden>
          <button class="btn btn-secondary settings-btn" id="import">Import backup</button>
          <p class="settings-hint">Markdown files open in any editor (Obsidian, iA Writer, VS Code). The nightly GitHub backup uses the same format.</p>
        </section>

        ${trash.length ? `
        <section class="settings-section">
          <div class="settings-label">Recently deleted (${trash.length})</div>
          ${trash.slice(0, 30).map((n) => `
            <div class="trash-item"><span>${esc(n.title)}</span><button class="link-btn" data-restore="${n.id}">Restore</button></div>`).join('')}
        </section>` : ''}

        <section class="settings-section settings-danger">
          <div class="settings-label">Danger zone</div>
          <button class="btn btn-danger settings-btn" id="clear-data">Erase everything on this device</button>
          <p class="settings-hint">Synced data stays in your database.</p>
        </section>
      </div>
    </div>
  `;
  keys.decorate(app);

  document.getElementById('back').addEventListener('click', () => navigate('library'));

  // Sync
  const statusEl = document.getElementById('sync-status');
  const STATUS_TEXT = {
    local: 'Local only',
    synced: 'Synced',
    syncing: 'Syncing…',
    pending: 'Changes waiting to sync',
    offline: 'Offline',
    error: 'Sync error',
    unauthorized: 'Token rejected',
    unconfigured: 'Server not set up'
  };
  const unsub = sync.onStatus(({ status, detail }) => {
    const last = store.getKV('lastSyncAt');
    statusEl.dataset.status = status;
    statusEl.innerHTML = `<span class="dot"></span><strong>${STATUS_TEXT[status] || status}</strong>
      ${last ? `<span class="muted"> · last sync ${formatDate(last)}</span>` : ''}
      ${detail && status !== 'synced' ? `<div class="muted small">${esc(detail)}</div>` : ''}`;
  });
  cleanupView = unsub;

  const tokenInput = document.getElementById('sync-token');
  document.getElementById('save-token').addEventListener('click', async () => {
    const value = tokenInput.value.trim();
    const hint = document.getElementById('health-hint');
    if (value) {
      try {
        const health = await sync.testConnection(value);
        if (!health.tokenConfigured) throw new Error('PALATE_TOKEN is not set on the server yet');
        if (!health.authorized) throw new Error('That token does not match the server');
        if (!health.databaseConfigured) throw new Error('No database connected to the Vercel project yet');
        hint.textContent = `Connected. Server has ${plural(health.database?.notes ?? 0, 'note')}.`;
      } catch (err) {
        hint.textContent = `Could not verify: ${err.message}`;
        showToast('Sync not enabled');
        return;
      }
    }
    await sync.setToken(value);
    showToast(value ? 'Sync on' : 'Sync off');
    render();
  });
  document.getElementById('sync-now').addEventListener('click', () => sync.syncNow());

  // Organizer
  const orgReady = document.getElementById('org-ready');
  const orgSupport = document.getElementById('org-support');
  const orgProgress = document.getElementById('org-progress');
  const orgStatus = document.getElementById('org-status');
  const orgDownload = document.getElementById('org-download');
  const orgDelete = document.getElementById('org-delete');
  const orgQueue = document.getElementById('org-queue');
  let deviceOk = false;

  function paintOrganizer(st = organizer.getStatus()) {
    const model = llm.MODELS[organizer.modelKey()];
    const ready = organizer.isModelReady();
    orgReady.textContent = ready ? 'Ready' : 'Not downloaded';
    orgReady.dataset.ready = ready ? 'yes' : 'no';
    const busy = st.state === 'loading' && st.progress !== null && !ready;
    orgDownload.textContent = busy ? 'Downloading…' : ready ? 'Downloaded' : `Download (${model.size.replace('about ', '')})`;
    orgDownload.disabled = !deviceOk || ready || busy;
    orgDelete.disabled = !ready;
    const showBar = st.state === 'loading' && typeof st.progress === 'number';
    orgProgress.classList.toggle('on', showBar);
    orgProgress.firstElementChild.style.width = `${Math.round((st.progress || 0) * 100)}%`;
    document.getElementById('org-model-info').textContent =
      `${model.label}: ${model.size} download, needs about ${(model.memoryMB / 1024).toFixed(1)} GB of GPU memory.`;
    // The last problem survives restarts, so it stays visible until fixed
    const issue = !ready && organizer.lastIssue();
    const text = st.text || (issue ? issue.text : '');
    orgStatus.textContent = text;
    orgStatus.classList.toggle('error', st.state === 'error' || (!st.text && Boolean(issue)));
    orgQueue.textContent = st.queue ? `${st.queue} note${st.queue === 1 ? '' : 's'} waiting to be organized` : '';
  }

  llm.checkSupport().then((sup) => {
    deviceOk = sup.ok;
    orgSupport.textContent = sup.ok
      ? `WebGPU ready${sup.f16 ? ' · fast half-precision' : ' · full-precision fallback'}${sup.deviceMemoryGB ? ` · ${sup.deviceMemoryGB} GB+ RAM` : ''}`
      : sup.reason;
    paintOrganizer();
  });
  const unsubOrg = organizer.onStatus(paintOrganizer);
  const prevCleanup = cleanupView;
  cleanupView = () => {
    prevCleanup();
    unsubOrg();
  };

  document.getElementById('org-auto').addEventListener('change', async (e) => {
    await organizer.setAuto(e.target.checked);
  });
  document.getElementById('org-model').addEventListener('click', async (e) => {
    const key = e.target.dataset.model;
    if (!key || key === organizer.modelKey()) return;
    await organizer.setModelKey(key);
    render();
  });
  orgDownload.addEventListener('click', async () => {
    const model = llm.MODELS[organizer.modelKey()];
    if (!confirm(`Download ${model.label} (${model.size})? Use Wi-Fi and keep Palate open until it finishes.`)) return;
    let wakeLock = null;
    try {
      wakeLock = await navigator.wakeLock?.request('screen');
    } catch { /* not supported */ }
    try {
      await organizer.downloadModel();
      showToast('Model ready');
    } catch {
      showToast('Download failed');
    } finally {
      wakeLock?.release?.();
    }
  });
  orgDelete.addEventListener('click', async () => {
    if (!confirm('Remove the downloaded model from this phone?')) return;
    await organizer.deleteModel();
    paintOrganizer();
  });
  document.getElementById('org-all').addEventListener('click', async () => {
    const n = await organizer.enqueueAll();
    showToast(n ? `Organizing ${plural(n, 'note')}` : 'Everything is already organized');
  });

  // Keyboard
  document.getElementById('kb-mode').addEventListener('click', async (e) => {
    const m = e.target.dataset.mode;
    if (!m) return;
    await store.setKV('keyboardMode', m);
    keys.setMode(m);
    render();
  });
  document.getElementById('kb-autocorrect').addEventListener('change', async (e) => {
    await store.setKV('autocorrect', e.target.checked);
    keys.setAutocorrect(e.target.checked);
  });
  document.getElementById('kb-haptics').addEventListener('change', async (e) => {
    await store.setKV('haptics', e.target.checked);
    keys.setHaptics(e.target.checked);
  });
  document.getElementById('kb-debug').addEventListener('change', async (e) => {
    await store.setKV('touchDebug', e.target.checked);
    keys.setDebug(e.target.checked);
  });
  document.getElementById('clear-learned')?.addEventListener('click', async () => {
    await store.setKV('learnedWords', []);
    lang.setLearnedWords([]);
    render();
  });

  // Writing style
  const corpusEl = document.getElementById('corpus');
  document.getElementById('save-corpus').addEventListener('click', async () => {
    await store.setKV('corpus', corpusEl.value);
    showToast('Saved');
    render();
  });
  document.getElementById('train').addEventListener('click', async () => {
    await store.setKV('corpus', corpusEl.value);
    showToast('Training…');
    try {
      await morph.trainModelFromCorpus(corpusEl.value);
      await refreshVocabulary();
      showToast('Predictions retrained');
    } catch (err) {
      console.error(err);
      showToast('Training failed');
    }
  });

  // Data
  const stamp = new Date().toISOString().slice(0, 10);
  document.getElementById('export-md').addEventListener('click', () => {
    const files = buildMarkdownFiles(store.listNotes(), store.listProjects(), store.extractTags);
    download(`palate-notes-${stamp}.zip`, createZip(files));
    showToast(`Exported ${plural(files.length - 1, 'note')}`);
  });
  document.getElementById('export-json').addEventListener('click', () => {
    download(`palate-backup-${stamp}.json`, new Blob([store.exportJSON()], { type: 'application/json' }));
  });
  const fileInput = document.getElementById('import-file');
  document.getElementById('import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      await store.importJSON(await file.text());
      showToast('Imported');
      render();
    } catch (err) {
      showToast('Import failed: ' + err.message);
    }
  });

  app.querySelectorAll('[data-restore]').forEach((btn) => btn.addEventListener('click', async () => {
    await store.restoreNote(btn.dataset.restore);
    showToast('Restored');
    render();
  }));

  document.getElementById('clear-data').addEventListener('click', async () => {
    if (!confirm('Erase all notes, projects and settings on this device? This cannot be undone.')) return;
    await store.clearAll();
    await morph.clearModel();
    showToast('Erased');
    navigate('palate');
  });

  if (viewParams.focus === 'sync') {
    document.getElementById('sync-section').scrollIntoView({ block: 'start' });
  }
}

// ============================================
// Project switcher (long-press screen edges on the Palate)
// ============================================

function initEdgeSwitcher() {
  const zones = ['left', 'right'].map((side) => {
    const zone = document.createElement('div');
    zone.className = `edge-zone edge-zone-${side}`;
    document.body.appendChild(zone);
    return zone;
  });
  let timer = null;
  const start = (e) => {
    e.preventDefault();
    timer = setTimeout(showProjectSwitcher, 400);
  };
  const cancel = () => clearTimeout(timer);
  zones.forEach((zone) => {
    zone.addEventListener('touchstart', start, { passive: false });
    zone.addEventListener('touchend', cancel);
    zone.addEventListener('touchmove', cancel);
    zone.addEventListener('touchcancel', cancel);
  });
  return () => zones.forEach((z) => z.remove());
}

function showProjectSwitcher() {
  const projects = store.listProjects();
  const activeId = store.getActiveProjectId();
  const overlay = document.createElement('div');
  overlay.className = 'switcher-overlay';
  const cards = [{ id: '', name: 'Inbox' }, ...projects];
  overlay.innerHTML = `
    <div class="switcher-title">Archive into</div>
    <div class="switcher-carousel" id="switcher-carousel">
      ${cards.map((p) => {
        const notes = store.listNotes({ projectId: p.id || null });
        const preview = notes[0] ? notes[0].body.slice(0, 200) : 'No notes yet';
        return `
          <div class="switcher-card ${(p.id || null) === activeId ? 'active' : ''}" data-id="${p.id}">
            <div class="switcher-card-header">
              <div class="switcher-card-title">${esc(p.name)}</div>
              <div class="switcher-card-meta">${plural(notes.length, 'note')}</div>
            </div>
            <div class="switcher-card-preview">${esc(preview)}</div>
          </div>`;
      }).join('')}
    </div>
    <div class="switcher-hint">Tap a project to switch</div>
  `;
  document.body.appendChild(overlay);

  const close = (cb) => {
    overlay.classList.add('closing');
    overlay.addEventListener('animationend', () => {
      overlay.remove();
      cb?.();
    }, { once: true });
  };

  const carousel = overlay.querySelector('#switcher-carousel');
  setTimeout(() => carousel.querySelector('.switcher-card.active')?.scrollIntoView({ inline: 'center', block: 'center' }), 10);
  carousel.addEventListener('click', (e) => {
    const card = e.target.closest('.switcher-card');
    if (!card) return;
    const id = card.dataset.id || null;
    store.setActiveProjectId(id).then(() => close(() => {
      render();
      showToast('Archiving into ' + (id ? store.getProject(id).name : 'Inbox'));
    }));
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.classList.contains('switcher-hint')) close();
  });
}

// ============================================
// Boot
// ============================================

async function refreshVocabulary() {
  lang.setPersonalVocabulary(await morph.getVocabulary());
}

async function boot() {
  try {
    await store.init();
  } catch (err) {
    console.error('[store] init failed', err);
    app.innerHTML = '<div class="empty-state"><p>Storage is unavailable in this browser mode (private browsing?).</p></div>';
    return;
  }

  keys.init({
    mode: store.getKV('keyboardMode', 'auto'),
    autocorrect: store.getKV('autocorrect', true),
    haptics: store.getKV('haptics', true),
    onLearn: (word) => {
      const list = store.getKV('learnedWords', []);
      const w = word.toLowerCase();
      if (!list.includes(w)) {
        const next = [...list, w];
        lang.setLearnedWords(next); // effective immediately, persisted async
        store.setKV('learnedWords', next);
      }
    }
  });
  keys.setDebug(store.getKV('touchDebug', false));
  lang.setLearnedWords(store.getKV('learnedWords', []));
  lang.setContextSource((context) => predictor.getContextCandidates(context));

  render();
  sync.start();
  organizer.start();

  // Heavier work after first paint
  lang.loadDictionary().then(() => keys.refresh()).catch((err) => console.warn('[keys] dictionary', err));
  morph.initialize().then(refreshVocabulary).then(() => keys.refresh());
}

boot();
