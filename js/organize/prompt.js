/**
 * Prompt + output schema for the on-device organizer model.
 * Small models do best with short, concrete instructions and a JSON schema
 * that constrains decoding (WebLLM's json_object + schema mode).
 */

// The local models have a 4096-token window shared by prompt and output.
const CONTEXT_TOKENS = 4096;
const PROMPT_OVERHEAD_TOKENS = 700;

export const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    project: { type: 'string' },
    new_project: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    todos: { type: 'array', items: { type: 'string' } },
    cleaned: { type: 'string' }
  },
  required: ['title', 'project', 'new_project', 'tags', 'todos', 'cleaned']
};

// Same shape without the rewrite, for notes too long to clean in one pass
export const SCHEMA_NO_CLEAN = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    project: { type: 'string' },
    new_project: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    todos: { type: 'array', items: { type: 'string' } }
  },
  required: ['title', 'project', 'new_project', 'tags', 'todos']
};

export const SYSTEM = `You organize someone's personal notes. They write fast and sloppily. You return JSON only.

Fields:
- title: a short, specific title (3-8 words) describing what the note is about. No quotes, no trailing period.
- project: the best matching project name from the list, copied exactly, or "" if none clearly fits.
- new_project: if no project fits and the note starts a clear new topic, a short project name. Otherwise "".
- tags: 1-4 lowercase single-word topic tags. Prefer existing tags from the list.
- todos: action items the writer says they need to do, as short imperative phrases. [] if none. Never invent tasks.
- cleaned: the same note with spelling, punctuation, capitalization and paragraph breaks fixed. Keep the writer's words, meaning, order and voice. Do not summarize, do not add information, do not add headings, do not add the to-do list or tags.`;

export function estimateTokens(text) {
  return Math.ceil((text || '').length / 3.6);
}

/**
 * @returns {{ system, user, schema, maxTokens, cleans }}
 */
export function buildPrompt(note, { projects = [], tags = [] } = {}) {
  const body = (note.body || '').trim();
  const bodyTokens = estimateTokens(body);
  // Rewriting needs room for the note twice (in and out) plus metadata
  const cleans = PROMPT_OVERHEAD_TOKENS + bodyTokens * 2.2 + 200 < CONTEXT_TOKENS;
  const shown = cleans ? body : body.slice(0, 6000);

  const user = [
    `Projects: ${projects.length ? projects.map((p) => p.name).join(' | ') : '(none yet)'}`,
    `Existing tags: ${tags.length ? tags.slice(0, 40).join(', ') : '(none yet)'}`,
    '',
    'Note:',
    '<<<',
    shown,
    '>>>'
  ].join('\n');

  return {
    system: cleans ? SYSTEM : SYSTEM.replace(/\n- cleaned:.*$/s, ''),
    user,
    schema: cleans ? SCHEMA : SCHEMA_NO_CLEAN,
    maxTokens: cleans ? Math.min(2400, Math.ceil(bodyTokens * 1.3) + 260) : 260,
    cleans
  };
}

/**
 * Normalise the model's JSON into the shape planChanges() expects
 */
export function parseResult(json) {
  const obj = typeof json === 'string' ? JSON.parse(json) : json;
  const str = (v) => (typeof v === 'string' ? v : '');
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  return {
    title: str(obj.title),
    project: str(obj.project),
    newProject: str(obj.new_project),
    tags: list(obj.tags),
    todos: list(obj.todos),
    cleaned: typeof obj.cleaned === 'string' ? obj.cleaned : null
  };
}
