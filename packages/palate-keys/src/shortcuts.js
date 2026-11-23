/**
 * Text shortcuts: a short trigger (";d", "@@", "omw") expands to longer text
 * when followed by a space, punctuation or return. Expansions can contain
 * {date}, {time}, {day} and {iso}, filled in at the moment of expansion.
 */

export const DEFAULT_SHORTCUTS = [
  { trigger: ';d', expansion: '{date}' },
  { trigger: ';t', expansion: '{time}' }
];

let map = new Map();

export function setShortcuts(list) {
  map = new Map();
  for (const { trigger, expansion } of list || []) {
    const t = String(trigger || '').trim();
    if (t.length >= 2 && !/\s/.test(t) && expansion) map.set(t.toLowerCase(), expansion);
  }
}

export function fill(expansion, now = new Date()) {
  return expansion
    .replace(/\{date\}/g, now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))
    .replace(/\{time\}/g, now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))
    .replace(/\{day\}/g, now.toLocaleDateString('en-US', { weekday: 'long' }))
    .replace(/\{iso\}/g, now.toISOString().slice(0, 10));
}

/**
 * Expansion for a token typed just before the caret, or null
 */
export function expand(token) {
  const exp = map.get(String(token || '').toLowerCase());
  return exp ? fill(exp) : null;
}

export function validate({ trigger, expansion }) {
  const t = String(trigger || '').trim();
  if (t.length < 2) return 'Use at least 2 characters for the shortcut';
  if (/\s/.test(t)) return 'Shortcuts can’t contain spaces';
  if (!String(expansion || '').trim()) return 'Add the text it should expand to';
  return null;
}
