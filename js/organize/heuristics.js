/**
 * Organizer building blocks that need no model: light tidy-up rules, to-do
 * extraction, change measurement, and turning a model's answer into a safe
 * patch for a note. Pure functions (no DOM, no storage) so they run under
 * node:test as well as in the app.
 */

const TAG_RE = /(^|[\s(])#([A-Za-z][\w-]{0,40})/g;

// ============================================
// Light tidy-up (rule based, used when no model is available)
// ============================================

export function tidy(text) {
  if (!text) return text;
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((line) => {
    let l = line.replace(/[ \t]+$/g, '');
    // Bullets: "* item" / "• item" -> "- item"
    l = l.replace(/^(\s*)[*•]\s+/, '$1- ');
    // Collapse runs of spaces inside the line (keep indentation)
    l = l.replace(/(\S) {2,}/g, '$1 ');
    // No space before punctuation: "word ," -> "word,"
    l = l.replace(/(\w) +([,!?;:])(?=\s|$|[A-Za-z])/g, '$1$2');
    l = l.replace(/(\w) +\.(?=\s|$)/g, '$1.');
    // Space after comma / ! / ? between words: "a,b" -> "a, b" (not numbers)
    l = l.replace(/([A-Za-z])([,!?])([A-Za-z])/g, '$1$2 $3');
    // Standalone i -> I
    l = l.replace(/(^|[\s(])i(?=$|[\s,.!?;:)])/g, '$1I');
    l = l.replace(/(^|[\s(])i'(m|ll|ve|d)\b/g, "$1I'$2");
    return capitaliseSentences(l);
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function capitaliseSentences(line) {
  // Start of line (after an optional bullet / checkbox) and after . ! ?
  return line
    .replace(/^(\s*(?:- (?:\[[ xX]\] )?)?)([a-z])(?=[a-z]*[\s,.!?;:]|[a-z]*$)/, (m, pre, ch) => pre + ch.toUpperCase())
    .replace(/([.!?]\s+)([a-z])(?=[a-z]*[\s,.!?;:]|[a-z]*$)/g, (m, pre, ch) => pre + ch.toUpperCase());
}

// ============================================
// To-dos
// ============================================

const TODO_LINE = /^\s*(?:[-*•]\s*)?(?:todo:?|to-do:?|to do:?|\[ ?\])\s+(.+)$/i;
const TODO_PHRASE = /^\s*(?:[-*•]\s*)?((?:need to|remember to|don't forget to|dont forget to|must)\s+.+)$/i;

export function extractTodos(text) {
  const items = [];
  for (const line of (text || '').split('\n')) {
    if (/^\s*- \[[ xX]\]/.test(line)) continue; // already a checklist item
    const m = line.match(TODO_LINE) || line.match(TODO_PHRASE);
    if (m) items.push(cleanTodo(m[1]));
  }
  return dedupe(items);
}

function cleanTodo(s) {
  const t = s.trim().replace(/[.;]+$/, '');
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((x) => {
    const k = x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function existingChecklist(text) {
  const set = new Set();
  for (const m of (text || '').matchAll(/^\s*- \[[ xX]\]\s+(.+)$/gm)) {
    set.add(m[1].toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
  }
  return set;
}

// ============================================
// How much did a rewrite change? (word-level LCS ratio, 0..1)
// ============================================

function words(text) {
  return (text || '').toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter(Boolean);
}

export function similarity(a, b) {
  const x = words(a);
  const y = words(b);
  if (!x.length && !y.length) return 1;
  if (!x.length || !y.length) return 0;
  // Bound the work for very long notes
  if (x.length * y.length > 4_000_000) return x.join(' ') === y.join(' ') ? 1 : 0;
  let prev = new Uint16Array(y.length + 1);
  let cur = new Uint16Array(y.length + 1);
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      cur[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
    cur.fill(0);
  }
  return (2 * prev[y.length]) / (x.length + y.length);
}

// ============================================
// Project vote from similar notes
// ============================================

const SINGLE_MATCH_SCORE = 0.18;

/**
 * neighbours: [{ note, score }] from search.related()
 * Returns a projectId when similar notes clearly agree, else null.
 */
export function voteProject(neighbours) {
  const weights = new Map();
  let total = 0;
  let counted = 0;
  for (const { note, score } of neighbours) {
    total += score;
    if (!note.projectId) continue;
    counted++;
    weights.set(note.projectId, (weights.get(note.projectId) || 0) + score);
  }
  if (!counted || !total) return null;
  const [best, w] = [...weights.entries()].sort((a, b) => b[1] - a[1])[0];
  if (counted === 1) {
    // One strongly similar note and nothing pointing elsewhere (small libraries)
    const only = neighbours.find((n) => n.note.projectId === best);
    return only.score >= SINGLE_MATCH_SCORE && weights.size === 1 ? best : null;
  }
  return w / total >= 0.6 ? best : null;
}

// ============================================
// Turning an organizer result into a safe patch
// ============================================

export const MIN_SIMILARITY = 0.72;

/**
 * Build the change for one note.
 *
 * note:     current note { title, body, projectId }
 * result:   { title, project, newProject, tags, cleaned, todos } (any may be missing)
 * ctx:      { projects: [{id, name}], keepProject, votedProjectId, existingTags }
 *
 * Returns { patch, report } where patch only contains fields that change.
 */
export function planChanges(note, result, ctx) {
  const report = { cleanup: 'skipped', project: null, suggestedProject: null, tagsAdded: [], todosAdded: 0 };
  const patch = {};
  let body = note.body;

  // 1. Cleaned text, only if it kept the user's words
  const cleaned = typeof result.cleaned === 'string' ? result.cleaned.trim() : '';
  if (cleaned && cleaned !== body.trim()) {
    const sim = similarity(body, cleaned);
    const lengthRatio = cleaned.length / Math.max(1, body.trim().length);
    if (sim >= MIN_SIMILARITY && lengthRatio > 0.6 && lengthRatio < 1.6) {
      body = cleaned;
      report.cleanup = 'applied';
    } else {
      report.cleanup = 'rejected';
      report.similarity = Math.round(sim * 100) / 100;
    }
  }

  // 2. To-dos as a checklist at the end (skip ones already listed)
  const have = existingChecklist(body);
  const todos = dedupe((result.todos || []).map(cleanTodo))
    .filter((t) => t && t.length <= 200 && !have.has(t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()))
    .slice(0, 12);
  if (todos.length) {
    body = body.replace(/\s+$/, '') + '\n\nTo-do\n' + todos.map((t) => `- [ ] ${t}`).join('\n');
    report.todosAdded = todos.length;
  }

  // 3. Tags as a final line of #hashtags (reusing existing spellings)
  const present = new Set([...body.matchAll(TAG_RE)].map((m) => m[2].toLowerCase()));
  const existing = new Map((ctx.existingTags || []).map((t) => [t.replace(/[^a-z0-9]/g, ''), t]));
  const tags = [];
  for (const raw of result.tags || []) {
    let t = String(raw).toLowerCase().replace(/^#/, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
    if (!t || !/^[a-z]/.test(t)) continue;
    t = existing.get(t.replace(/[^a-z0-9]/g, '')) || t;
    if (!present.has(t) && !tags.includes(t)) tags.push(t);
  }
  if (tags.length) {
    const tagLine = tags.slice(0, 4).map((t) => '#' + t).join(' ');
    body = body.replace(/\s+$/, '') + '\n\n' + tagLine;
    report.tagsAdded = tags.slice(0, 4);
  }

  if (body !== note.body) patch.body = body;

  // 4. Title
  const title = typeof result.title === 'string' ? result.title.replace(/\s+/g, ' ').replace(/^["'#\s]+|["'\s]+$/g, '').trim() : '';
  if (title && title.length <= 80 && title !== note.title) patch.title = title;

  // 5. Project: only for notes filed to the Inbox ("auto")
  if (!ctx.keepProject && !note.projectId) {
    const byName = (name) => ctx.projects.find((p) => p.name.trim().toLowerCase() === String(name || '').trim().toLowerCase());
    const named = result.project ? byName(result.project) : null;
    const pick = named?.id || ctx.votedProjectId || null;
    if (pick) {
      patch.projectId = pick;
      report.project = pick;
    } else {
      const suggestion = String(result.newProject || '').trim().slice(0, 40);
      if (suggestion && !byName(suggestion)) report.suggestedProject = suggestion;
    }
  }

  return { patch, report };
}

/**
 * Rule-based organizing for when the local model isn't available
 */
export function basicResult(note) {
  return {
    title: null,
    cleaned: tidy(note.body),
    todos: extractTodos(note.body),
    tags: [],
    project: null,
    newProject: null
  };
}
