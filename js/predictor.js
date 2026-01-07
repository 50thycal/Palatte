/**
 * N-gram based next-word predictor
 * Uses trigram -> bigram -> unigram backoff strategy
 */

import * as db from './db.js';
import { extractNgrams, normalizeWord } from './tokenizer.js';

// In-memory cache for fast predictions
const predictionCache = new Map();
const CACHE_MAX_SIZE = 100;

// In-memory n-gram stores for fast access
let memoryUnigrams = null;
let memoryBigrams = null;
let memoryTrigrams = null;
let memoryLoaded = false;

/**
 * Load n-gram data into memory for fast access
 */
export async function loadIntoMemory() {
  if (memoryLoaded) return;

  const [unigrams, bigrams, trigrams] = await Promise.all([
    db.getAll(db.STORES.UNIGRAMS),
    db.getAll(db.STORES.BIGRAMS),
    db.getAll(db.STORES.TRIGRAMS)
  ]);

  // Index unigrams by word
  memoryUnigrams = new Map();
  for (const u of unigrams) {
    memoryUnigrams.set(u.word, u.count);
  }

  // Index bigrams by prev word
  memoryBigrams = new Map();
  for (const b of bigrams) {
    if (!memoryBigrams.has(b.prev)) {
      memoryBigrams.set(b.prev, []);
    }
    memoryBigrams.get(b.prev).push({ word: b.word, count: b.count });
  }

  // Index trigrams by context (prevPrev|prev)
  memoryTrigrams = new Map();
  for (const t of trigrams) {
    if (!memoryTrigrams.has(t.context)) {
      memoryTrigrams.set(t.context, []);
    }
    memoryTrigrams.get(t.context).push({ word: t.word, count: t.count });
  }

  memoryLoaded = true;
}

/**
 * Invalidate in-memory cache (call after training)
 */
export function invalidateCache() {
  predictionCache.clear();
  memoryLoaded = false;
  memoryUnigrams = null;
  memoryBigrams = null;
  memoryTrigrams = null;
}

/**
 * Train the model with new text
 * @param {string} text - Text to train on
 * @param {number} weight - Weight for recency (default 1)
 */
export async function train(text, weight = 1) {
  if (!text || !text.trim()) return;

  const { unigrams, bigrams, trigrams } = extractNgrams(text, weight);

  await db.batchUpdateCounts(unigrams, bigrams, trigrams);

  // Invalidate cache since model changed
  invalidateCache();
}

/**
 * Get predictions for a given context
 * @param {string[]} context - Array of 0-2 previous words (normalized/lowercase)
 * @param {number} k - Number of suggestions to return
 * @param {string} partialWord - Optional partial word being typed for filtering
 * @returns {Promise<{word: string, score: number}[]>} Sorted suggestions
 */
export async function predict(context, k = 6, partialWord = null) {
  // Ensure memory is loaded
  await loadIntoMemory();

  // Create cache key
  const cacheKey = context.join('|') + (partialWord ? `~${partialWord}` : '');

  // Check cache
  if (predictionCache.has(cacheKey)) {
    return predictionCache.get(cacheKey);
  }

  let candidates = [];
  let source = 'unigram'; // Track which n-gram level provided results

  // Normalize context
  const normalizedContext = context.map(normalizeWord);

  // Try trigram first (if we have 2 context words)
  if (normalizedContext.length >= 2) {
    const prevPrev = normalizedContext[normalizedContext.length - 2];
    const prev = normalizedContext[normalizedContext.length - 1];
    const trigramContext = `${prevPrev}|${prev}`;

    const trigramCandidates = memoryTrigrams?.get(trigramContext) || [];
    if (trigramCandidates.length > 0) {
      candidates = trigramCandidates;
      source = 'trigram';
    }
  }

  // Backoff to bigram if no trigram results
  if (candidates.length === 0 && normalizedContext.length >= 1) {
    const prev = normalizedContext[normalizedContext.length - 1];
    const bigramCandidates = memoryBigrams?.get(prev) || [];
    if (bigramCandidates.length > 0) {
      candidates = bigramCandidates;
      source = 'bigram';
    }
  }

  // Backoff to unigram if no bigram results
  if (candidates.length === 0) {
    // Get top unigrams
    if (memoryUnigrams && memoryUnigrams.size > 0) {
      candidates = Array.from(memoryUnigrams.entries())
        .map(([word, count]) => ({ word, count }));
      source = 'unigram';
    }
  }

  // Filter by partial word if provided
  if (partialWord) {
    const partial = partialWord.toLowerCase();
    candidates = candidates.filter(c =>
      c.word.startsWith(partial) && c.word !== partial
    );
  }

  // Filter out very short/common words for better suggestions
  candidates = candidates.filter(c => c.word.length > 1);

  // Sort by count (descending)
  candidates.sort((a, b) => b.count - a.count);

  // Take top K
  const topK = candidates.slice(0, k);

  // Calculate normalized scores
  const totalCount = topK.reduce((sum, c) => sum + c.count, 0);
  const results = topK.map(c => ({
    word: c.word,
    score: totalCount > 0 ? c.count / totalCount : 0,
    source // Include source for debugging
  }));

  // Cache result
  if (predictionCache.size >= CACHE_MAX_SIZE) {
    // Remove oldest entry
    const firstKey = predictionCache.keys().next().value;
    predictionCache.delete(firstKey);
  }
  predictionCache.set(cacheKey, results);

  return results;
}

/**
 * Get model statistics
 */
export async function getModelStats() {
  await loadIntoMemory();

  return {
    unigramCount: memoryUnigrams?.size || 0,
    bigramCount: memoryBigrams?.size || 0,
    trigramCount: memoryTrigrams?.size || 0,
    cacheSize: predictionCache.size
  };
}

/**
 * Clear all model data
 */
export async function clearModel() {
  await db.clearAllLMData();
  invalidateCache();
}

/**
 * Interpolated prediction (weighted combination of n-gram levels)
 * More sophisticated than simple backoff
 * @param {string[]} context - Context words
 * @param {number} k - Number of suggestions
 * @param {Object} weights - Interpolation weights
 */
export async function predictInterpolated(
  context,
  k = 6,
  weights = { trigram: 0.6, bigram: 0.3, unigram: 0.1 }
) {
  await loadIntoMemory();

  const normalizedContext = context.map(normalizeWord);
  const scores = new Map(); // word -> weighted score

  // Get trigram contributions
  if (normalizedContext.length >= 2) {
    const prevPrev = normalizedContext[normalizedContext.length - 2];
    const prev = normalizedContext[normalizedContext.length - 1];
    const trigramContext = `${prevPrev}|${prev}`;

    const trigramCandidates = memoryTrigrams?.get(trigramContext) || [];
    const triTotal = trigramCandidates.reduce((s, c) => s + c.count, 0);

    for (const c of trigramCandidates) {
      const prob = triTotal > 0 ? c.count / triTotal : 0;
      scores.set(c.word, (scores.get(c.word) || 0) + weights.trigram * prob);
    }
  }

  // Get bigram contributions
  if (normalizedContext.length >= 1) {
    const prev = normalizedContext[normalizedContext.length - 1];
    const bigramCandidates = memoryBigrams?.get(prev) || [];
    const biTotal = bigramCandidates.reduce((s, c) => s + c.count, 0);

    for (const c of bigramCandidates) {
      const prob = biTotal > 0 ? c.count / biTotal : 0;
      scores.set(c.word, (scores.get(c.word) || 0) + weights.bigram * prob);
    }
  }

  // Get unigram contributions
  if (memoryUnigrams && memoryUnigrams.size > 0) {
    const uniTotal = Array.from(memoryUnigrams.values()).reduce((s, c) => s + c, 0);

    for (const [word, count] of memoryUnigrams.entries()) {
      const prob = uniTotal > 0 ? count / uniTotal : 0;
      scores.set(word, (scores.get(word) || 0) + weights.unigram * prob);
    }
  }

  // Convert to array and sort
  const results = Array.from(scores.entries())
    .filter(([word]) => word.length > 1)
    .map(([word, score]) => ({ word, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  // Normalize scores to sum to 1
  const totalScore = results.reduce((s, r) => s + r.score, 0);
  return results.map(r => ({
    word: r.word,
    score: totalScore > 0 ? r.score / totalScore : 0
  }));
}
