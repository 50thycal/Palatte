/**
 * On-device search and recall.
 *
 * search(): BM25 full-text ranking with prefix matching on the last term
 *           and #tag filters.
 * related(): TF-IDF cosine similarity between what you're writing and every
 *           note, used for the Recall strip.
 */

import * as store from './store.js';

const STOP = new Set(`a about above after again against all am an and any are as at be because been before
being below between both but by can did do does doing down during each few for from further had has have
having he her here hers herself him himself his how i if in into is it its itself just me more most my myself
no nor not now of off on once only or other our ours ourselves out over own same she should so some such than
that the their theirs them themselves then there these they this those through to too under until up very was
we were what when where which while who whom why will with you your yours yourself yourselves im ive dont cant
its id ill youre thats get got like also one would could really thing things going go`.split(/\s+/));

let index = null;
let dirty = true;

store.on('notes', () => { dirty = true; });

function stem(t) {
  if (t.startsWith('#')) return t;
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 5 && t.endsWith('ing')) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith('ed')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

export function terms(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^a-z0-9#]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(stem);
}

function countTerms(list, weight = 1, into = new Map()) {
  for (const t of list) into.set(t, (into.get(t) || 0) + weight);
  return into;
}

function build() {
  const notes = store.listNotes();
  const docs = [];
  const df = new Map();
  let totalLen = 0;
  for (const note of notes) {
    const tf = countTerms(terms(note.title), 3);
    countTerms(terms(note.body), 1, tf);
    for (const tag of note.tags || []) tf.set('#' + tag, (tf.get('#' + tag) || 0) + 2);
    let len = 0;
    for (const c of tf.values()) len += c;
    totalLen += len;
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    docs.push({ note, tf, len, norm: 0 });
  }
  const N = docs.length || 1;
  const idf = new Map();
  for (const [t, d] of df) idf.set(t, Math.log(1 + (N - d + 0.5) / (d + 0.5)));
  for (const doc of docs) {
    let sum = 0;
    for (const [t, c] of doc.tf) {
      const w = (1 + Math.log(c)) * (idf.get(t) || 0);
      sum += w * w;
    }
    doc.norm = Math.sqrt(sum) || 1;
  }
  index = { docs, idf, avgLen: totalLen / N || 1, vocab: [...df.keys()] };
  dirty = false;
}

function getIndex() {
  if (dirty || !index) build();
  return index;
}

/**
 * Full-text search. Supports "#tag" filters; the last word matches as a prefix.
 */
export function search(query, { projectId } = {}) {
  const q = query.trim();
  if (!q) return [];
  const idx = getIndex();
  const tagFilters = [...q.matchAll(/#([\w-]+)/g)].map((m) => m[1].toLowerCase());
  const words = terms(q.replace(/#[\w-]+/g, ' '));
  const lastRaw = q.replace(/#[\w-]+/g, ' ').trim().split(/\s+/).pop()?.toLowerCase() || '';
  const prefixMode = lastRaw.length >= 1 && !q.endsWith(' ');

  // Expand the last term to every indexed term it prefixes
  const expanded = words.map((w, i) => {
    if (i === words.length - 1 && prefixMode) {
      const p = lastRaw.replace(/[^a-z0-9]/g, '');
      const matches = idx.vocab.filter((t) => t.startsWith(p));
      return matches.length ? matches.slice(0, 50) : [w];
    }
    return [w];
  });

  const k1 = 1.2;
  const b = 0.75;
  const results = [];
  for (const doc of idx.docs) {
    const note = doc.note;
    if (projectId !== undefined && note.projectId !== projectId) continue;
    if (tagFilters.length && !tagFilters.every((t) => note.tags?.includes(t))) continue;

    let score = 0;
    let matchedAll = true;
    for (const group of expanded) {
      let best = 0;
      for (const t of group) {
        const tf = doc.tf.get(t);
        if (!tf) continue;
        const idf = idx.idf.get(t) || 0;
        best = Math.max(best, idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * doc.len / idx.avgLen)));
      }
      if (!best) matchedAll = false;
      score += best;
    }
    if (expanded.length && !matchedAll) {
      // Fall back to a plain substring match (names, numbers, partial words)
      const hay = (note.title + '\n' + note.body).toLowerCase();
      if (!hay.includes(q.replace(/#[\w-]+/g, '').trim().toLowerCase())) continue;
      score = 0.5;
    }
    if (!expanded.length) score = 1; // tag-only query
    if (note.title.toLowerCase().includes(lastRaw)) score += 1;
    if (note.pinned) score += 0.2;
    results.push({ note, score });
  }
  return results.sort((a, b2) => b2.score - a.score || b2.note.updatedAt - a.note.updatedAt);
}

/**
 * Snippet around the first matching word, HTML-escaped with <mark> highlights
 */
export function snippet(note, query, escapeHtml, length = 120) {
  const body = note.body.replace(/\s+/g, ' ').trim();
  const words = query.toLowerCase().replace(/#/g, '').split(/\s+/).filter((w) => w.length > 1);
  let pos = -1;
  for (const w of words) {
    pos = body.toLowerCase().indexOf(w);
    if (pos !== -1) break;
  }
  const start = Math.max(0, pos === -1 ? 0 : pos - 40);
  let text = body.slice(start, start + length);
  if (start > 0) text = '…' + text;
  if (start + length < body.length) text += '…';
  let html = escapeHtml(text);
  for (const w of words) {
    const re = new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    html = html.replace(re, '<mark>$1</mark>');
  }
  return html;
}

/**
 * Notes related to `text` (TF-IDF cosine), best first
 */
export function related(text, { excludeId = null, limit = 3, minScore = 0.14 } = {}) {
  const idx = getIndex();
  const qtf = countTerms(terms(text));
  if (qtf.size < 2) return [];
  const qvec = new Map();
  let qnorm = 0;
  for (const [t, c] of qtf) {
    const idf = idx.idf.get(t);
    if (!idf) continue;
    const w = (1 + Math.log(c)) * idf;
    qvec.set(t, w);
    qnorm += w * w;
  }
  qnorm = Math.sqrt(qnorm);
  if (!qnorm) return [];

  const out = [];
  for (const doc of idx.docs) {
    if (doc.note.id === excludeId) continue;
    let dot = 0;
    for (const [t, w] of qvec) {
      const c = doc.tf.get(t);
      if (c) dot += w * (1 + Math.log(c)) * (idx.idf.get(t) || 0);
    }
    const score = dot / (qnorm * doc.norm);
    if (score >= minScore) out.push({ note: doc.note, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * One older note to resurface today (stable for the whole day)
 */
export function resurface() {
  const cutoff = Date.now() - 21 * 24 * 3600 * 1000;
  const old = store.listNotes().filter((n) => n.createdAt < cutoff && n.body.trim().length > 40);
  if (!old.length) return null;
  const day = Math.floor(Date.now() / 86400000);
  return old[(day * 2654435761) % old.length];
}
