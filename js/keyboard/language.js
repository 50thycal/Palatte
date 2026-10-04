/**
 * Language engine for Palate Keys: dictionary, autocorrect, completions,
 * next-word ranking and next-letter probabilities (for touch biasing).
 *
 * Pure module: the dictionary and personal vocabulary are injected, so it can
 * run in the browser and under node:test alike.
 */

import { NEIGHBOURS } from './layouts.js';

let ranked = [];             // words in frequency order
const rankOf = new Map();    // word -> rank
let sorted = [];             // words in alphabetical order (prefix search)
const byLength = new Map();  // length -> [word]
let personal = new Map();    // word -> weighted count (from Morph model)
let learned = new Set();     // words the user explicitly kept
let contextSource = null;    // async (context) => { trigrams, bigrams }

const CONTRACTIONS = {
  im: "I'm", ive: "I've", id: null, ill: null, i: 'I',
  "i'm": "I'm", "i've": "I've", "i'd": "I'd", "i'll": "I'll",
  dont: "don't", cant: "can't", wont: "won't", didnt: "didn't", doesnt: "doesn't",
  isnt: "isn't", wasnt: "wasn't", werent: "weren't", arent: "aren't",
  couldnt: "couldn't", wouldnt: "wouldn't", shouldnt: "shouldn't",
  havent: "haven't", hasnt: "hasn't", hadnt: "hadn't", mustnt: "mustn't",
  youre: "you're", theyre: "they're", youve: "you've", theyve: "they've",
  weve: "we've", youll: "you'll", theyll: "they'll", itll: "it'll",
  thats: "that's", whats: "what's", wheres: "where's", whos: "who's",
  hows: "how's", theres: "there's", heres: "here's",
  hes: "he's", shes: "she's", aint: "ain't", yall: "y'all",
  wouldve: "would've", couldve: "could've", shouldve: "should've",
  lets: null
};

// ============================================
// Setup
// ============================================

export function setDictionary(words) {
  ranked = words.filter(Boolean);
  rankOf.clear();
  byLength.clear();
  ranked.forEach((w, i) => {
    if (!rankOf.has(w)) rankOf.set(w, i);
    if (!byLength.has(w.length)) byLength.set(w.length, []);
    byLength.get(w.length).push(w);
  });
  sorted = [...rankOf.keys()].sort();
  letterCache.clear();
}

export function setPersonalVocabulary(map) {
  personal = map || new Map();
  letterCache.clear();
}

export function setLearnedWords(words) {
  learned = new Set((words || []).map((w) => w.toLowerCase()));
}

export function setContextSource(fn) {
  contextSource = fn;
}

export async function loadDictionary(url = '/data/words-en.txt') {
  const res = await fetch(url);
  if (!res.ok) throw new Error('dictionary ' + res.status);
  setDictionary((await res.text()).split('\n').map((w) => w.trim()));
}

export function dictionarySize() {
  return ranked.length;
}

// ============================================
// Scoring helpers
// ============================================

function logPrior(word) {
  const r = rankOf.get(word);
  const dict = r === undefined ? -11.5 : -Math.log(r + 30);
  const p = personal.get(word) || 0;
  return dict + (p > 0 ? 1.5 * Math.log(1 + p) : 0);
}

export function isKnown(word) {
  const w = word.toLowerCase();
  return rankOf.has(w) || learned.has(w) || (personal.get(w) || 0) >= 2;
}

export function matchCase(template, word) {
  if (word === 'I' || word.startsWith("I'")) return word;
  if (template.length > 1 && template === template.toUpperCase() && /[A-Z]/.test(template)) {
    return word.toUpperCase();
  }
  if (template[0] && template[0] !== template[0].toLowerCase()) {
    return word[0].toUpperCase() + word.slice(1);
  }
  return word;
}

// Substitution costs indexed by char code pair (a-z only; others cost 1)
const SUB = (() => {
  const t = new Float32Array(128 * 128).fill(1);
  for (let a = 0; a < 128; a++) t[a * 128 + a] = 0;
  const vowels = 'aeiou';
  for (const a of vowels) for (const b of vowels) if (a !== b) t[a.charCodeAt(0) * 128 + b.charCodeAt(0)] = 0.8;
  for (const [a, set] of Object.entries(NEIGHBOURS)) {
    for (const b of set) t[a.charCodeAt(0) * 128 + b.charCodeAt(0)] = 0.55;
  }
  return t;
})();

function subCost(a, b) {
  const x = a.charCodeAt(0);
  const y = b.charCodeAt(0);
  return x < 128 && y < 128 ? SUB[x * 128 + y] : (a === b ? 0 : 1);
}

// Typed an extra character
function delCost(typed, i) {
  const ch = typed[i];
  if (i > 0 && typed[i - 1] === ch) return 0.4;            // doubled key
  const prev = typed[i - 1];
  const next = typed[i + 1];
  if ((prev && NEIGHBOURS[ch]?.has(prev)) || (next && NEIGHBOURS[ch]?.has(next))) {
    return 0.6;                                            // brushed a neighbour
  }
  return 1;
}

// Missed a character
function insCost(target, j) {
  const ch = target[j];
  if (j > 0 && target[j - 1] === ch) return 0.45;          // missed a double letter
  if (ch === '\'') return 0.3;                             // missing apostrophe
  if (ch === 'g' && j === target.length - 1 && target.endsWith('ing')) return 0.3; // "lookin"
  if (ch === 'e' && j === target.length - 2 && target.endsWith('ed')) return 0.5;  // "happend"
  if ('aeiou'.includes(ch)) return 0.75;                   // skipped vowel
  return 1;
}

/**
 * Keyboard-aware Damerau-Levenshtein (optimal string alignment).
 * typed -> target. Bails out early once every path exceeds `max`.
 */
const ROWS = [new Float64Array(64), new Float64Array(64), new Float64Array(64)];
const DEL = new Float64Array(64);
const INS = new Float64Array(64);
const TC = new Uint16Array(64);
const GC = new Uint16Array(64);
let lastTyped = null;

export function editCost(typed, target, max = Infinity) {
  const n = typed.length;
  const m = target.length;
  if (Math.abs(n - m) > 3 || n > 60 || m > 60) return Infinity;

  if (typed !== lastTyped) {
    for (let i = 0; i < n; i++) {
      DEL[i] = delCost(typed, i);
      TC[i] = Math.min(127, typed.charCodeAt(i));
    }
    lastTyped = typed;
  }
  for (let j = 0; j < m; j++) {
    INS[j] = insCost(target, j);
    GC[j] = Math.min(127, target.charCodeAt(j));
  }

  let prev2 = ROWS[0];
  let prev = ROWS[1];
  let cur = ROWS[2];
  prev[0] = 0;
  for (let j = 1; j <= m; j++) prev[j] = prev[j - 1] + INS[j - 1];

  for (let i = 1; i <= n; i++) {
    const del = DEL[i - 1];
    const t = TC[i - 1];
    const tRow = t * 128;
    cur[0] = prev[0] + del;
    let rowMin = cur[0];
    for (let j = 1; j <= m; j++) {
      const g = GC[j - 1];
      let v = prev[j - 1] + SUB[tRow + g];
      const d = prev[j] + del;
      if (d < v) v = d;
      const a = cur[j - 1] + INS[j - 1];
      if (a < v) v = a;
      if (i > 1 && j > 1 && t === GC[j - 2] && TC[i - 2] === g) {
        const x = prev2[j - 2] + 0.5;
        if (x < v) v = x;
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return Infinity;
    const tmp = prev2;
    prev2 = prev;
    prev = cur;
    cur = tmp;
  }
  return prev[m];
}

function maxCostFor(len) {
  if (len <= 2) return 0;
  if (len === 3) return 1;
  if (len <= 5) return 1.3;
  if (len <= 8) return 2;
  return 2.5;
}

// ============================================
// Autocorrect
// ============================================

/**
 * Returns the corrected word, or null to leave it alone.
 * @param {string} word        word as typed
 * @param {object} opts
 * @param {boolean} opts.sentenceStart  word begins a sentence
 * @param {string[]} opts.context       previous words (lowercase)
 */
export function correct(word, { sentenceStart = false, contextCounts = null } = {}) {
  if (!word || /[0-9_]/.test(word)) return null;
  const lower = word.toLowerCase();

  if (Object.prototype.hasOwnProperty.call(CONTRACTIONS, lower)) {
    const fix = CONTRACTIONS[lower];
    if (!fix || learned.has(lower)) return null;
    return fix.startsWith('I') ? fix : matchCase(word, fix);
  }

  if (isKnown(lower)) return null;
  // Acronyms and mid-sentence capitalised words are probably names
  if (word.length > 1 && word === word.toUpperCase()) return null;
  if (!sentenceStart && word[0] !== lower[0]) return null;

  const len = lower.length;
  const max = maxCostFor(len);
  if (max === 0) return null;

  let best = null;
  let bestScore = -Infinity;
  const consider = (cand) => {
    const cost = editCost(lower, cand, max);
    if (cost > max) return;
    let score = logPrior(cand) - 3 * cost;
    if (contextCounts?.has(cand)) score += 2 * contextCounts.get(cand);
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  };

  for (let l = Math.max(1, len - 2); l <= len + 2; l++) {
    for (const cand of byLength.get(l) || []) {
      // Cheap filters before the full edit-distance computation
      if (len < 6) {
        if (cand[0] !== lower[0] && !NEIGHBOURS[lower[0]]?.has(cand[0])) continue;
      } else if (cand[0] !== lower[0] && cand[1] !== lower[1] && cand[0] !== lower[1]) {
        continue;
      }
      consider(cand);
    }
  }
  for (const [cand, count] of personal) {
    if (count >= 2 && Math.abs(cand.length - len) <= 2 && !rankOf.has(cand)) consider(cand);
  }

  return best ? matchCase(word, best) : null;
}

// ============================================
// Completions / predictions
// ============================================

function prefixRange(prefix) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < prefix) lo = mid + 1;
    else hi = mid;
  }
  const out = [];
  for (let i = lo; i < sorted.length && sorted[i].startsWith(prefix); i++) out.push(sorted[i]);
  return out;
}

function shareMap(list) {
  const total = list.reduce((s, c) => s + c.count, 0) || 1;
  return new Map(list.map((c) => [c.word, c.count / total]));
}

async function contextShares(context) {
  if (!contextSource || !context.length) return { tri: new Map(), bi: new Map() };
  const { trigrams, bigrams } = await contextSource(context);
  return { tri: shareMap(trigrams || []), bi: shareMap(bigrams || []) };
}

/**
 * Words starting with `prefix`, ranked by frequency, personal use and context
 */
export async function complete(prefix, context = [], k = 3) {
  const p = prefix.toLowerCase();
  if (!p) return [];
  const { tri, bi } = await contextShares(context);
  const scores = new Map();
  const add = (w) => {
    if (scores.has(w)) return;
    scores.set(w, logPrior(w) + 4 * (tri.get(w) || 0) + 2.5 * (bi.get(w) || 0));
  };
  for (const w of prefixRange(p).slice(0, 4000)) add(w);
  for (const w of personal.keys()) if (w.startsWith(p)) add(w);
  for (const w of tri.keys()) if (w.startsWith(p)) add(w);
  for (const w of bi.keys()) if (w.startsWith(p)) add(w);
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([w]) => (w === 'i' || w.startsWith("i'") ? 'I' + w.slice(1) : w));
}

const STARTERS = ['I', 'The', "I'm", 'We', 'It', 'This', 'What', 'So'];

/**
 * Next-word suggestions after a word boundary
 */
export async function nextWords(context = [], k = 3, sentenceStart = false) {
  if (sentenceStart && !context.length) return STARTERS.slice(0, k);
  const { tri, bi } = await contextShares(context);
  const scores = new Map();
  for (const [w, s] of tri) scores.set(w, (scores.get(w) || 0) + 3 * s);
  for (const [w, s] of bi) scores.set(w, (scores.get(w) || 0) + 1.5 * s);
  // Tie-break with general frequency
  for (const [w, s] of scores) scores.set(w, s + 0.02 * logPrior(w));
  let out = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);
  if (out.length < k) {
    const fallback = sentenceStart ? STARTERS.map((s) => s.toLowerCase()) : ranked.slice(0, 12);
    for (const w of fallback) if (!out.includes(w)) out.push(w);
  }
  return out.slice(0, k).map((w) => (w === 'i' || w.startsWith("i'") ? 'I' + w.slice(1) : w));
}

/**
 * Context counts for autocorrect tie-breaking (word -> share)
 */
export async function contextCountsFor(context) {
  const { tri, bi } = await contextShares(context);
  const out = new Map(bi);
  for (const [w, s] of tri) out.set(w, Math.max(out.get(w) || 0, s * 1.5));
  return out;
}

// ============================================
// Next-letter distribution (touch-target biasing)
// ============================================

const letterCache = new Map();

export function nextLetterProbs(prefix) {
  const p = prefix.toLowerCase();
  if (letterCache.has(p)) return letterCache.get(p);
  const weights = new Map();
  let total = 0;
  const add = (w, weight) => {
    const ch = w[p.length];
    if (!ch) return;
    weights.set(ch, (weights.get(ch) || 0) + weight);
    total += weight;
  };
  for (const w of prefixRange(p)) add(w, 1 / (rankOf.get(w) + 30));
  for (const [w, c] of personal) if (w.startsWith(p)) add(w, 0.02 * Math.log(1 + c));
  const probs = new Map();
  for (const [ch, wt] of weights) probs.set(ch, wt / total);
  if (letterCache.size > 500) letterCache.clear();
  letterCache.set(p, probs);
  return probs;
}
