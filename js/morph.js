/**
 * Morph API - High-level interface for the prediction system
 * Coordinates between storage, tokenizer, and predictor
 */

import * as db from './db.js';
import * as predictor from './predictor.js';
import {
  getContextBeforeCursor,
  getPartialWord,
  endsWithWordBoundary,
  extractNgrams
} from './tokenizer.js';
import { getProjects, getProject, loadData } from './storage.js';

// Configuration
const DEFAULT_SUGGESTIONS = 6;
const RECENCY_DECAY = 0.9; // Weight decay for older snapshots

/**
 * Train model from all existing corpus data
 * Processes all archived snapshots with recency weighting
 */
export async function trainModelFromCorpus() {
  // Clear existing model
  await predictor.clearModel();

  // Get all projects and their snapshots
  const projects = getProjects();

  // Collect all snapshots with timestamps
  const allSnapshots = [];
  for (const project of projects) {
    for (const snapshot of project.snapshots) {
      allSnapshots.push({
        id: snapshot.id,
        content: snapshot.content,
        createdAt: new Date(snapshot.createdAt).getTime()
      });
    }
  }

  // Sort by date (oldest first for weight calculation)
  allSnapshots.sort((a, b) => a.createdAt - b.createdAt);

  // Train on each snapshot with recency weighting
  const totalSnapshots = allSnapshots.length;
  for (let i = 0; i < totalSnapshots; i++) {
    const snapshot = allSnapshots[i];
    // More recent snapshots get higher weight
    // Weight increases linearly from RECENCY_DECAY to 1.0
    const recencyWeight = RECENCY_DECAY + (1 - RECENCY_DECAY) * (i / Math.max(1, totalSnapshots - 1));

    await predictor.train(snapshot.content, recencyWeight);
    await db.addProcessedSnapshot(snapshot.id);
  }

  // Also train on current live draft (with highest weight)
  const data = loadData();
  if (data.livePalate && data.livePalate.trim()) {
    await predictor.train(data.livePalate, 1.0);
  }

  return {
    snapshotsProcessed: totalSnapshots,
    stats: await predictor.getModelStats()
  };
}

/**
 * Incrementally update model with new text
 * Use when a new snapshot is archived
 * @param {string} text - New text to add to model
 * @param {number} weight - Weight for this text (default 1.0)
 */
export async function updateModelWithText(text, weight = 1.0) {
  await predictor.train(text, weight);
}

/**
 * Get next word suggestions based on text and cursor position
 * @param {string} text - Full text content
 * @param {number} cursorPos - Cursor position (null = end of text)
 * @param {number} k - Number of suggestions (default 6)
 * @returns {Promise<{word: string, score: number}[]>} Suggestions sorted by confidence
 */
export async function getNextWordSuggestions(text, cursorPos = null, k = DEFAULT_SUGGESTIONS) {
  // Get context tokens before cursor
  const context = getContextBeforeCursor(text, cursorPos, 2);

  // Get partial word if user is mid-word
  const partialWord = getPartialWord(text, cursorPos);

  // If user is typing a partial word, filter suggestions to match
  // Otherwise get predictions based on context
  const suggestions = await predictor.predict(context, k, partialWord);

  return suggestions;
}

/**
 * Check if we should show predictions
 * (e.g., after word boundary, not in middle of word unless filtering)
 * @param {string} text - Full text
 * @param {number} cursorPos - Cursor position
 * @returns {boolean}
 */
export function shouldShowPredictions(text, cursorPos = null) {
  if (!text) return true; // Show for empty text

  const pos = cursorPos ?? text.length;
  const textBeforeCursor = text.slice(0, pos);

  // Always show if text is empty or ends with boundary
  if (!textBeforeCursor.trim()) return true;
  if (endsWithWordBoundary(textBeforeCursor)) return true;

  // Also show when typing (for autocomplete filtering)
  return true;
}

/**
 * Get model statistics for debugging/display
 */
export async function getModelStats() {
  return predictor.getModelStats();
}

/**
 * Clear all prediction model data
 */
export async function clearModel() {
  await predictor.clearModel();
}

/**
 * Rebuild model from scratch
 * Use when data might be out of sync
 */
export async function rebuildModel() {
  return trainModelFromCorpus();
}

// ============================================
// Storage API (re-exports + extensions)
// ============================================

import {
  getProjects as _getProjects,
  getProject as _getProject,
  createProject as _createProject,
  archiveSnapshot as _archiveSnapshot,
  getSnapshot as _getSnapshot,
  getLivePalate,
  saveLivePalate
} from './storage.js';

export { getLivePalate, saveLivePalate };

/**
 * List all projects
 */
export function listProjects() {
  return _getProjects();
}

/**
 * Get a single project by ID
 */
export function getProjectById(projectId) {
  return _getProject(projectId);
}

/**
 * Create a new project
 */
export function createProject(name) {
  return _createProject(name);
}

/**
 * Archive current content as a snapshot
 * Also updates the prediction model
 * @param {string} projectId - Target project ID
 * @param {string} content - Content to archive
 * @param {string} title - Optional title
 */
export async function archiveSnapshot(projectId, content, title = null) {
  // Archive using existing storage
  const snapshot = _archiveSnapshot(projectId, content, title);

  if (snapshot) {
    // Update model with new content (high weight for recent)
    await updateModelWithText(content, 1.0);
    await db.addProcessedSnapshot(snapshot.id);
  }

  return snapshot;
}

/**
 * List snapshots for a project
 */
export function listSnapshots(projectId) {
  const project = _getProject(projectId);
  return project?.snapshots || [];
}

/**
 * Get a single snapshot
 */
export function getSnapshotById(projectId, snapshotId) {
  return _getSnapshot(projectId, snapshotId);
}

/**
 * Get live draft content
 */
export function getLiveDraft() {
  return getLivePalate();
}

/**
 * Set live draft content
 */
export function setLiveDraft(content) {
  saveLivePalate(content);
}

// ============================================
// Initialization
// ============================================

let initialized = false;

/**
 * Initialize the Morph system
 * Call this on app startup
 */
export async function initialize() {
  if (initialized) return;

  try {
    // Open database
    await db.openDB();

    // Check if model needs training
    const stats = await predictor.getModelStats();

    if (stats.unigramCount === 0) {
      // No model data, train from existing corpus
      const processedIds = await db.getProcessedSnapshots();

      // Get all current snapshot IDs
      const projects = getProjects();
      const allSnapshotIds = projects.flatMap(p => p.snapshots.map(s => s.id));

      // Check if we have unprocessed snapshots
      const unprocessed = allSnapshotIds.filter(id => !processedIds.includes(id));

      if (unprocessed.length > 0 || allSnapshotIds.length > 0) {
        console.log('[Morph] Training model from corpus...');
        await trainModelFromCorpus();
      }
    } else {
      // Model exists, preload into memory
      await predictor.loadIntoMemory();
    }

    initialized = true;
    console.log('[Morph] Initialized', await getModelStats());
  } catch (err) {
    console.error('[Morph] Initialization error:', err);
  }
}
