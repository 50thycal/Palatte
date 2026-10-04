/**
 * Morph API - High-level interface for the prediction system
 * Coordinates between the note store, tokenizer, and n-gram predictor
 */

import * as db from './db.js';
import * as predictor from './predictor.js';
import { getContextBeforeCursor, getPartialWord } from './tokenizer.js';
import * as store from './store.js';

const DEFAULT_SUGGESTIONS = 6;
const RECENCY_DECAY = 0.9; // Weight of the oldest note relative to the newest

/**
 * Train model from all notes (recency weighted), the live draft and the
 * personal writing-style corpus
 */
export async function trainModelFromCorpus(personalCorpus = store.getKV('corpus', '')) {
  await predictor.clearModel();

  const notes = store.listNotes().slice().sort((a, b) => a.createdAt - b.createdAt);
  const total = notes.length;
  for (let i = 0; i < total; i++) {
    const weight = RECENCY_DECAY + (1 - RECENCY_DECAY) * (i / Math.max(1, total - 1));
    await predictor.train(notes[i].title + '\n' + notes[i].body, weight);
    await db.addProcessedSnapshot(notes[i].id);
  }

  const draft = store.getKV('livePalate', '');
  if (draft.trim()) await predictor.train(draft, 1.0);

  if (personalCorpus && personalCorpus.trim()) {
    await predictor.train(personalCorpus, 1.2);
  }

  return {
    notesProcessed: total,
    hasPersonalCorpus: Boolean(personalCorpus && personalCorpus.trim()),
    stats: await predictor.getModelStats()
  };
}

/**
 * Incrementally learn from new text (e.g. when a note is archived)
 */
export async function learn(text, weight = 1.0) {
  await predictor.train(text, weight);
}

/**
 * Next-word suggestions for the text before the cursor
 */
export async function getNextWordSuggestions(text, cursorPos = null, k = DEFAULT_SUGGESTIONS) {
  const context = getContextBeforeCursor(text, cursorPos, 2);
  const partialWord = getPartialWord(text, cursorPos);
  return predictor.predict(context, k, partialWord);
}

export async function getModelStats() {
  return predictor.getModelStats();
}

export async function clearModel() {
  await predictor.clearModel();
}

export async function getVocabulary() {
  return predictor.getVocabulary();
}

let initialized = false;

export async function initialize() {
  if (initialized) return;
  try {
    await db.openDB();
    const stats = await predictor.getModelStats();
    if (stats.unigramCount === 0 && (store.listNotes().length || store.getKV('corpus', ''))) {
      await trainModelFromCorpus();
    }
    initialized = true;
  } catch (err) {
    console.error('[Morph] Initialization error:', err);
  }
}
