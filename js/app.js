import {
  getLivePalate,
  saveLivePalate,
  getProjects,
  getProject,
  createProject,
  archiveSnapshot,
  getSnapshot,
  formatDate
} from './storage.js';

const app = document.getElementById('app');

let currentView = 'palate';
let viewParams = {};

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

  app.innerHTML = `
    <div class="palate-view">
      <header class="header">
        <span class="header-title">Palate</span>
        <button class="header-btn" id="nav-projects">Projects</button>
      </header>
      <textarea
        class="palate-textarea"
        id="palate-input"
        placeholder="Start typing..."
        autofocus
      >${escapeHtml(content)}</textarea>
      <div class="palate-actions">
        <button class="btn btn-secondary" id="copy-all">Copy All</button>
        <button class="btn btn-primary" id="archive">Archive</button>
      </div>
    </div>
  `;

  const textarea = document.getElementById('palate-input');
  const copyBtn = document.getElementById('copy-all');
  const archiveBtn = document.getElementById('archive');
  const projectsBtn = document.getElementById('nav-projects');

  // Auto-save on input
  textarea.addEventListener('input', () => {
    saveLivePalate(textarea.value);
  });

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

  archiveBtn.addEventListener('click', () => {
    const text = textarea.value;
    if (!text.trim()) {
      showToast('Nothing to archive');
      return;
    }
    showArchiveModal(text);
  });

  projectsBtn.addEventListener('click', () => {
    navigate('projects');
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

  confirmBtn.addEventListener('click', () => {
    let targetProjectId = selectedProjectId;

    if (isNewProject) {
      const name = newProjectInput.value.trim();
      if (!name) return;
      const project = createProject(name);
      targetProjectId = project.id;
    }

    if (!targetProjectId) return;

    const title = titleInput.value.trim();
    archiveSnapshot(targetProjectId, content, title);

    // Clear palate after archiving
    saveLivePalate('');

    close();
    showToast('Archived');
    render();
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
        <span style="width: 50px"></span>
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

// Utility
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize
render();
