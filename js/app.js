import {
  getLivePalate,
  saveLivePalate,
  getProjects,
  getProject,
  createProject,
  archiveSnapshot,
  getSnapshot,
  formatDate,
  getActiveProjectId,
  setActiveProjectId,
  exportData,
  importData,
  getStats,
  clearAllData
} from './storage.js';

import * as morph from './morph.js';

const app = document.getElementById('app');

let currentView = 'palate';
let viewParams = {};

// Morph prediction state
let morphInitialized = false;
let currentSuggestions = [];
let morphUpdateTimer = null;

// Simple router
function navigate(view, params = {}) {
  currentView = view;
  viewParams = params;
  render();
}

function render() {
  switch (currentView) {
    case 'palate':
      renderPalateView();
      break;
    case 'projects':
      renderProjectsView();
      break;
    case 'project':
      renderProjectView(viewParams.projectId);
      break;
    case 'snapshot':
      renderSnapshotView(viewParams.projectId, viewParams.snapshotId);
      break;
    case 'settings':
      renderSettingsView();
      break;
    default:
      renderPalateView();
  }
}

// Toast notification
function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 2000);
}

// Copy to clipboard
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied');
  } catch {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast('Copied');
  }
}

// Palate View
function renderPalateView() {
  const content = getLivePalate();
  const activeProjectId = getActiveProjectId();
  const activeProject = activeProjectId ? getProject(activeProjectId) : null;

  app.innerHTML = `
    <div class="palate-view">
      <header class="header">
        <button class="header-btn" id="nav-projects">Projects</button>
        <button class="project-selector" id="project-selector">
          <span class="project-selector-label">${activeProject ? escapeHtml(activeProject.name) : 'No Project'}</span>
          <span class="project-selector-arrow">▼</span>
        </button>
        <span style="width: 60px"></span>
      </header>
      <div class="palate-textarea-wrapper">
        <textarea
          class="palate-textarea"
          id="palate-input"
          placeholder="Start typing..."
          autofocus
        >${escapeHtml(content)}</textarea>
      </div>
      <div class="palate-bottom" id="palate-bottom">
        <div class="morph-bar" id="morph-bar">
          <span class="morph-bar-empty">Start typing to see suggestions...</span>
        </div>
        <div class="palate-actions">
          <button class="btn btn-secondary" id="copy-all">Copy All</button>
          <button class="btn btn-primary" id="archive">Archive</button>
        </div>
      </div>
    </div>
  `;

  const textarea = document.getElementById('palate-input');
  const morphBar = document.getElementById('morph-bar');
  const palateBottom = document.getElementById('palate-bottom');
  const copyBtn = document.getElementById('copy-all');
  const archiveBtn = document.getElementById('archive');
  const projectsBtn = document.getElementById('nav-projects');
  const projectSelector = document.getElementById('project-selector');

  // Initialize morph if needed
  initMorph();

  // Setup keyboard detection for morph bar positioning
  setupKeyboardDetection(palateBottom);

  // Auto-save on input and update predictions
  textarea.addEventListener('input', () => {
    saveLivePalate(textarea.value);
    scheduleMorphUpdate(textarea);
  });

  // Also update on key events that might change cursor position
  textarea.addEventListener('keyup', (e) => {
    // Update on space, punctuation, or arrow keys
    if (e.key === ' ' || e.key === 'Enter' ||
        e.key === '.' || e.key === ',' || e.key === '!' || e.key === '?' ||
        e.key === 'ArrowLeft' || e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      scheduleMorphUpdate(textarea);
    }
  });

  // Handle morph bubble taps
  morphBar.addEventListener('click', (e) => {
    const bubble = e.target.closest('.morph-bubble');
    if (bubble) {
      const word = bubble.dataset.word;
      insertWordAtCursor(textarea, word);
      scheduleMorphUpdate(textarea);
    }
  });

  // Initial prediction update
  if (content) {
    scheduleMorphUpdate(textarea);
  }

  // Focus textarea
  setTimeout(() => textarea.focus(), 50);

  copyBtn.addEventListener('click', () => {
    const text = textarea.value;
    if (!text.trim()) {
      showToast('Nothing to copy');
      return;
    }
    copyToClipboard(text);
  });

  archiveBtn.addEventListener('click', async () => {
    const text = textarea.value;
    if (!text.trim()) {
      showToast('Nothing to archive');
      return;
    }

    // If active project is set, archive directly
    const activeId = getActiveProjectId();
    if (activeId) {
      await morph.archiveSnapshot(activeId, text, null);
      saveLivePalate('');
      showToast('Archived');
      render();
    } else {
      // No active project, show the full modal
      showArchiveModal(text);
    }
  });

  projectsBtn.addEventListener('click', () => {
    navigate('projects');
  });

  projectSelector.addEventListener('click', () => {
    showProjectPickerModal();
  });
}

// Archive Modal
function showArchiveModal(content) {
  const projects = getProjects();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">Archive to Project</span>
        <button class="modal-close" id="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <input type="text" class="input" id="snapshot-title" placeholder="Title (optional)">
        <div id="project-list">
          <div class="project-option project-option-new" data-new="true">
            + New Project
          </div>
          ${projects.map(p => `
            <div class="project-option" data-id="${p.id}">
              ${escapeHtml(p.name)}
            </div>
          `).join('')}
        </div>
        <div id="new-project-input" style="display: none; margin-top: 12px;">
          <input type="text" class="input" id="new-project-name" placeholder="Project name">
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="confirm-archive" disabled>Archive</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeBtn = overlay.querySelector('#modal-close');
  const confirmBtn = overlay.querySelector('#confirm-archive');
  const titleInput = overlay.querySelector('#snapshot-title');
  const projectList = overlay.querySelector('#project-list');
  const newProjectSection = overlay.querySelector('#new-project-input');
  const newProjectInput = overlay.querySelector('#new-project-name');

  let selectedProjectId = null;
  let isNewProject = false;

  const close = () => overlay.remove();

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  projectList.addEventListener('click', (e) => {
    const option = e.target.closest('.project-option');
    if (!option) return;

    // Clear previous selection
    projectList.querySelectorAll('.project-option').forEach(el => {
      el.classList.remove('selected');
    });
    option.classList.add('selected');

    if (option.dataset.new) {
      isNewProject = true;
      selectedProjectId = null;
      newProjectSection.style.display = 'block';
      newProjectInput.focus();
      updateConfirmState();
    } else {
      isNewProject = false;
      selectedProjectId = option.dataset.id;
      newProjectSection.style.display = 'none';
      confirmBtn.disabled = false;
    }
  });

  newProjectInput.addEventListener('input', updateConfirmState);

  function updateConfirmState() {
    if (isNewProject) {
      confirmBtn.disabled = !newProjectInput.value.trim();
    } else {
      confirmBtn.disabled = !selectedProjectId;
    }
  }

  confirmBtn.addEventListener('click', async () => {
    let targetProjectId = selectedProjectId;

    if (isNewProject) {
      const name = newProjectInput.value.trim();
      if (!name) return;
      const project = createProject(name);
      targetProjectId = project.id;
    }

    if (!targetProjectId) return;

    const title = titleInput.value.trim();
    await morph.archiveSnapshot(targetProjectId, content, title);

    // Clear palate after archiving
    saveLivePalate('');

    close();
    showToast('Archived');
    render();
  });
}

// Project Picker Modal (for selecting active project)
function showProjectPickerModal() {
  const projects = getProjects();
  const currentActiveId = getActiveProjectId();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">Select Project</span>
        <button class="modal-close" id="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div id="project-list">
          <div class="project-option ${!currentActiveId ? 'selected' : ''}" data-id="">
            No Project
          </div>
          <div class="project-option project-option-new" data-new="true">
            + New Project
          </div>
          ${projects.map(p => `
            <div class="project-option ${p.id === currentActiveId ? 'selected' : ''}" data-id="${p.id}">
              ${escapeHtml(p.name)}
            </div>
          `).join('')}
        </div>
        <div id="new-project-input" style="display: none; margin-top: 12px;">
          <input type="text" class="input" id="new-project-name" placeholder="Project name">
          <button class="btn btn-primary" id="create-project" style="margin-top: 8px;">Create</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeBtn = overlay.querySelector('#modal-close');
  const projectList = overlay.querySelector('#project-list');
  const newProjectSection = overlay.querySelector('#new-project-input');
  const newProjectInput = overlay.querySelector('#new-project-name');
  const createProjectBtn = overlay.querySelector('#create-project');

  const close = () => overlay.remove();

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  projectList.addEventListener('click', (e) => {
    const option = e.target.closest('.project-option');
    if (!option) return;

    if (option.dataset.new) {
      newProjectSection.style.display = 'block';
      newProjectInput.focus();
      return;
    }

    // Select project (or clear if empty id)
    const projectId = option.dataset.id || null;
    setActiveProjectId(projectId);
    close();
    render();
  });

  createProjectBtn.addEventListener('click', () => {
    const name = newProjectInput.value.trim();
    if (!name) return;
    const project = createProject(name);
    setActiveProjectId(project.id);
    close();
    render();
  });

  newProjectInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      createProjectBtn.click();
    }
  });
}

// Projects View
function renderProjectsView() {
  const projects = getProjects();

  app.innerHTML = `
    <div class="view">
      <header class="header">
        <button class="header-btn" id="back-palate">Palate</button>
        <span class="header-title">Projects</span>
        <button class="header-btn" id="nav-settings">Settings</button>
      </header>
      <div class="list" id="projects-list">
        ${projects.length === 0 ? `
          <div class="empty-state">
            <p>No projects yet.<br>Archive something to get started.</p>
          </div>
        ` : projects.map(p => `
          <div class="list-item" data-id="${p.id}">
            <div class="list-item-content">
              <div class="list-item-title">${escapeHtml(p.name)}</div>
              <div class="list-item-meta">${p.snapshots.length} snapshot${p.snapshots.length !== 1 ? 's' : ''}</div>
            </div>
            <span class="list-item-arrow">›</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  document.getElementById('back-palate').addEventListener('click', () => {
    navigate('palate');
  });

  document.getElementById('nav-settings').addEventListener('click', () => {
    navigate('settings');
  });

  document.getElementById('projects-list').addEventListener('click', (e) => {
    const item = e.target.closest('.list-item');
    if (!item) return;
    navigate('project', { projectId: item.dataset.id });
  });
}

// Project View (snapshots list)
function renderProjectView(projectId) {
  const project = getProject(projectId);

  if (!project) {
    navigate('projects');
    return;
  }

  app.innerHTML = `
    <div class="view">
      <header class="header">
        <button class="header-btn" id="back-projects">Projects</button>
        <span class="header-title">${escapeHtml(project.name)}</span>
        <span style="width: 60px"></span>
      </header>
      <div class="list" id="snapshots-list">
        ${project.snapshots.length === 0 ? `
          <div class="empty-state">
            <p>No snapshots in this project yet.</p>
          </div>
        ` : project.snapshots.map(s => `
          <div class="list-item" data-id="${s.id}">
            <div class="list-item-content">
              <div class="list-item-title">${escapeHtml(s.title)}</div>
              <div class="list-item-meta">${formatDate(s.createdAt)}</div>
            </div>
            <span class="list-item-arrow">›</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  document.getElementById('back-projects').addEventListener('click', () => {
    navigate('projects');
  });

  document.getElementById('snapshots-list').addEventListener('click', (e) => {
    const item = e.target.closest('.list-item');
    if (!item) return;
    navigate('snapshot', { projectId, snapshotId: item.dataset.id });
  });
}

// Snapshot View (read-only)
function renderSnapshotView(projectId, snapshotId) {
  const project = getProject(projectId);
  const snapshot = getSnapshot(projectId, snapshotId);

  if (!project || !snapshot) {
    navigate('projects');
    return;
  }

  app.innerHTML = `
    <div class="view">
      <header class="header">
        <button class="header-btn" id="back-project">Back</button>
        <span class="header-title">${escapeHtml(snapshot.title)}</span>
        <button class="header-btn" id="copy-snapshot">Copy</button>
      </header>
      <div class="snapshot-content">${escapeHtml(snapshot.content)}</div>
    </div>
  `;

  document.getElementById('back-project').addEventListener('click', () => {
    navigate('project', { projectId });
  });

  document.getElementById('copy-snapshot').addEventListener('click', () => {
    copyToClipboard(snapshot.content);
  });
}

// Settings View
function renderSettingsView() {
  const stats = getStats();

  app.innerHTML = `
    <div class="view">
      <header class="header">
        <button class="header-btn" id="back-projects">Back</button>
        <span class="header-title">Settings</span>
        <span style="width: 50px"></span>
      </header>
      <div class="settings-content">
        <div class="settings-section">
          <div class="settings-label">Data</div>
          <div class="settings-stats">
            ${stats.projectCount} project${stats.projectCount !== 1 ? 's' : ''},
            ${stats.snapshotCount} snapshot${stats.snapshotCount !== 1 ? 's' : ''}
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-label">Backup</div>
          <button class="btn btn-secondary settings-btn" id="export-data">Export Data</button>
          <p class="settings-hint">Download all your data as a JSON file</p>
        </div>

        <div class="settings-section">
          <div class="settings-label">Restore</div>
          <input type="file" id="import-file" accept=".json" style="display: none">
          <button class="btn btn-secondary settings-btn" id="import-data">Import Data</button>
          <p class="settings-hint">Restore from a previous backup (replaces current data)</p>
        </div>

        <div class="settings-section settings-danger">
          <div class="settings-label">Danger Zone</div>
          <button class="btn btn-danger settings-btn" id="clear-data">Clear All Data</button>
          <p class="settings-hint">Permanently delete all projects and snapshots</p>
        </div>
      </div>
    </div>
  `;

  document.getElementById('back-projects').addEventListener('click', () => {
    navigate('projects');
  });

  document.getElementById('export-data').addEventListener('click', () => {
    const data = exportData();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `palate-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Data exported');
  });

  const fileInput = document.getElementById('import-file');
  document.getElementById('import-data').addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = importData(event.target.result);
      if (result.success) {
        showToast('Data imported');
        render();
      } else {
        showToast('Import failed: ' + result.error);
      }
    };
    reader.readAsText(file);
  });

  document.getElementById('clear-data').addEventListener('click', () => {
    if (confirm('Delete all data? This cannot be undone.')) {
      clearAllData();
      showToast('All data cleared');
      navigate('palate');
    }
  });
}

// Utility
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Morph Bar Functions
async function initMorph() {
  if (morphInitialized) return;
  try {
    await morph.initialize();
    morphInitialized = true;
    console.log('[Morph] Ready');
  } catch (err) {
    console.error('[Morph] Init failed:', err);
  }
}

function scheduleMorphUpdate(textarea) {
  // Debounce updates to avoid excessive calls
  if (morphUpdateTimer) {
    clearTimeout(morphUpdateTimer);
  }
  morphUpdateTimer = setTimeout(() => {
    updateMorphSuggestions(textarea);
  }, 50); // 50ms debounce
}

async function updateMorphSuggestions(textarea) {
  if (!morphInitialized) return;

  const morphBar = document.getElementById('morph-bar');
  if (!morphBar) return;

  const text = textarea.value;
  const cursorPos = textarea.selectionStart;

  try {
    const suggestions = await morph.getNextWordSuggestions(text, cursorPos, 6);
    currentSuggestions = suggestions;
    renderMorphBar(morphBar, suggestions);
  } catch (err) {
    console.error('[Morph] Prediction error:', err);
  }
}

function renderMorphBar(morphBar, suggestions) {
  if (!suggestions || suggestions.length === 0) {
    morphBar.innerHTML = '<span class="morph-bar-empty">Keep typing to see suggestions...</span>';
    return;
  }

  // Determine size class based on relative score
  // Top 1-2 get large, middle get medium, rest get small
  const bubbles = suggestions.map((s, i) => {
    let sizeClass = 'morph-bubble-sm';
    if (i === 0 && s.score > 0.25) {
      sizeClass = 'morph-bubble-lg';
    } else if (i <= 1 && s.score > 0.15) {
      sizeClass = 'morph-bubble-md';
    } else if (s.score > 0.1) {
      sizeClass = 'morph-bubble-md';
    }

    return `<button class="morph-bubble ${sizeClass}" data-word="${escapeHtml(s.word)}">${escapeHtml(s.word)}</button>`;
  });

  morphBar.innerHTML = bubbles.join('');
}

function insertWordAtCursor(textarea, word) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;

  // Check if we need to handle partial word replacement
  // Find the start of the current word (if any)
  let wordStart = start;
  while (wordStart > 0 && !/\s/.test(text[wordStart - 1])) {
    wordStart--;
  }

  // Check if cursor is at end of text or after whitespace
  const beforeCursor = text.slice(0, start);
  const isAfterSpace = beforeCursor.length === 0 ||
                       /\s$/.test(beforeCursor);

  let newText;
  let newCursorPos;

  if (isAfterSpace) {
    // Insert word with trailing space
    newText = text.slice(0, start) + word + ' ' + text.slice(end);
    newCursorPos = start + word.length + 1;
  } else {
    // Replace partial word
    newText = text.slice(0, wordStart) + word + ' ' + text.slice(end);
    newCursorPos = wordStart + word.length + 1;
  }

  textarea.value = newText;
  textarea.setSelectionRange(newCursorPos, newCursorPos);
  saveLivePalate(newText);

  // Refocus textarea
  textarea.focus();
}

// Keyboard Detection for Morph Bar positioning
function setupKeyboardDetection(palateBottom) {
  if (!window.visualViewport) {
    // Fallback for browsers without Visual Viewport API
    console.log('[Keyboard] Visual Viewport API not available');
    return;
  }

  const viewport = window.visualViewport;
  let initialHeight = viewport.height;
  let keyboardOpen = false;

  function handleViewportChange() {
    const currentHeight = viewport.height;
    const heightDiff = initialHeight - currentHeight;

    // Consider keyboard open if viewport shrinks by more than 150px
    const isKeyboardOpen = heightDiff > 150;

    if (isKeyboardOpen && !keyboardOpen) {
      // Keyboard just opened
      keyboardOpen = true;
      palateBottom.classList.add('keyboard-open');

      // Position at bottom of visible viewport
      const bottomOffset = initialHeight - currentHeight;
      palateBottom.style.bottom = `${bottomOffset}px`;
    } else if (!isKeyboardOpen && keyboardOpen) {
      // Keyboard just closed
      keyboardOpen = false;
      palateBottom.classList.remove('keyboard-open');
      palateBottom.style.bottom = '';
    } else if (isKeyboardOpen) {
      // Keyboard is open, update position (for keyboard height changes)
      const bottomOffset = initialHeight - currentHeight;
      palateBottom.style.bottom = `${bottomOffset}px`;
    }
  }

  // Update initial height on orientation changes
  function handleResize() {
    if (!keyboardOpen) {
      initialHeight = viewport.height;
    }
  }

  viewport.addEventListener('resize', handleViewportChange);
  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      initialHeight = viewport.height;
      handleViewportChange();
    }, 100);
  });

  // Also handle scroll events on the viewport (iOS quirk)
  viewport.addEventListener('scroll', handleViewportChange);
}

// Project Switcher (iOS app-switcher style)
function initProjectSwitcher() {
  // Create edge zones for long-press detection
  const leftZone = document.createElement('div');
  leftZone.className = 'edge-zone edge-zone-left';
  document.body.appendChild(leftZone);

  const rightZone = document.createElement('div');
  rightZone.className = 'edge-zone edge-zone-right';
  document.body.appendChild(rightZone);

  let longPressTimer = null;
  const LONG_PRESS_DURATION = 400;

  function startLongPress(e) {
    e.preventDefault();
    longPressTimer = setTimeout(() => {
      showProjectSwitcher();
    }, LONG_PRESS_DURATION);
  }

  function cancelLongPress() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  // Touch events for both zones
  [leftZone, rightZone].forEach(zone => {
    zone.addEventListener('touchstart', startLongPress, { passive: false });
    zone.addEventListener('touchend', cancelLongPress);
    zone.addEventListener('touchmove', cancelLongPress);
    zone.addEventListener('touchcancel', cancelLongPress);
  });
}

function showProjectSwitcher() {
  const projects = getProjects();
  const activeProjectId = getActiveProjectId();

  const overlay = document.createElement('div');
  overlay.className = 'switcher-overlay';

  if (projects.length === 0) {
    overlay.innerHTML = `
      <div class="switcher-empty">
        No projects yet.<br>Archive something to create your first project.
      </div>
      <div class="switcher-hint">Tap anywhere to close</div>
    `;
  } else {
    overlay.innerHTML = `
      <div class="switcher-title">Switch Project</div>
      <div class="switcher-carousel" id="switcher-carousel">
        ${projects.map(p => {
          const latestSnapshot = p.snapshots[0];
          const preview = latestSnapshot
            ? latestSnapshot.content.slice(0, 200)
            : 'No snapshots yet';
          return `
            <div class="switcher-card ${p.id === activeProjectId ? 'active' : ''}" data-id="${p.id}">
              <div class="switcher-card-header">
                <div class="switcher-card-title">${escapeHtml(p.name)}</div>
                <div class="switcher-card-meta">${p.snapshots.length} snapshot${p.snapshots.length !== 1 ? 's' : ''}</div>
              </div>
              <div class="switcher-card-preview">${escapeHtml(preview)}</div>
            </div>
          `;
        }).join('')}
      </div>
      <div class="switcher-hint">Tap a project to switch</div>
    `;
  }

  document.body.appendChild(overlay);

  // Animated close function
  function closeSwitcher(callback) {
    overlay.classList.add('closing');
    overlay.addEventListener('animationend', () => {
      overlay.remove();
      if (callback) callback();
    }, { once: true });
  }

  // Scroll to active project
  const carousel = document.getElementById('switcher-carousel');
  if (carousel) {
    const activeCard = carousel.querySelector('.switcher-card.active');
    if (activeCard) {
      setTimeout(() => {
        activeCard.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'center' });
      }, 10);
    }

    // Handle card taps
    carousel.addEventListener('click', (e) => {
      const card = e.target.closest('.switcher-card');
      if (card) {
        const projectId = card.dataset.id;
        setActiveProjectId(projectId);
        closeSwitcher(() => {
          render();
          showToast('Switched to ' + getProject(projectId).name);
        });
      }
    });
  }

  // Close on background tap
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.classList.contains('switcher-hint') || e.target.classList.contains('switcher-empty')) {
      closeSwitcher();
    }
  });
}

// Initialize
initProjectSwitcher();
render();
