const STORAGE_KEY = 'palate_data';

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function getDefaultData() {
  return {
    livePalate: '',
    projects: [],
    activeProjectId: null
  };
}

export function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultData();
    return JSON.parse(raw);
  } catch {
    return getDefaultData();
  }
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function getLivePalate() {
  return loadData().livePalate;
}

export function saveLivePalate(content) {
  const data = loadData();
  data.livePalate = content;
  saveData(data);
}

export function getProjects() {
  return loadData().projects;
}

export function getProject(projectId) {
  return getProjects().find(p => p.id === projectId);
}

export function createProject(name) {
  const data = loadData();
  const project = {
    id: generateId(),
    name,
    createdAt: new Date().toISOString(),
    snapshots: []
  };
  data.projects.unshift(project);
  saveData(data);
  return project;
}

export function archiveSnapshot(projectId, content, title) {
  const data = loadData();
  const project = data.projects.find(p => p.id === projectId);
  if (!project) return null;

  const autoTitle = title?.trim() || generateAutoTitle(content);

  const snapshot = {
    id: generateId(),
    title: autoTitle,
    content,
    createdAt: new Date().toISOString()
  };

  project.snapshots.unshift(snapshot);
  saveData(data);
  return snapshot;
}

export function getSnapshot(projectId, snapshotId) {
  const project = getProject(projectId);
  if (!project) return null;
  return project.snapshots.find(s => s.id === snapshotId);
}

function generateAutoTitle(content) {
  const trimmed = content.trim();
  if (!trimmed) {
    return formatTimestamp(new Date());
  }

  const firstLine = trimmed.split('\n')[0].trim();
  if (firstLine.length <= 50) {
    return firstLine;
  }
  return firstLine.slice(0, 47) + '...';
}

function formatTimestamp(date) {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

export function formatDate(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });
}

export function getActiveProjectId() {
  const data = loadData();
  // Validate that the project still exists
  if (data.activeProjectId && data.projects.some(p => p.id === data.activeProjectId)) {
    return data.activeProjectId;
  }
  return null;
}

export function setActiveProjectId(projectId) {
  const data = loadData();
  data.activeProjectId = projectId;
  saveData(data);
}

// Data management
export function exportData() {
  const data = loadData();
  return JSON.stringify(data, null, 2);
}

export function importData(jsonString) {
  try {
    const data = JSON.parse(jsonString);
    // Basic validation
    if (typeof data !== 'object') throw new Error('Invalid data');
    if (!Array.isArray(data.projects)) throw new Error('Invalid projects');

    // Ensure required fields
    data.livePalate = data.livePalate || '';
    data.activeProjectId = data.activeProjectId || null;

    saveData(data);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export function getStats() {
  const data = loadData();
  const totalSnapshots = data.projects.reduce((sum, p) => sum + p.snapshots.length, 0);
  return {
    projectCount: data.projects.length,
    snapshotCount: totalSnapshots
  };
}

export function clearAllData() {
  localStorage.removeItem(STORAGE_KEY);
}
