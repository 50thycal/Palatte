/**
 * Palate Keys layouts.
 *
 * A key is either a character string, or an object:
 *   { k: 'q', alt: '1' }        character with a swipe-up alternate
 *   { action: 'shift', w: 1.4 } special key, w = width in key units
 */

const letterRow = (chars, alts) => chars.split('').map((k, i) => ({ k, alt: alts[i] }));

export const LAYOUTS = {
  letters: [
    letterRow('qwertyuiop', '1234567890'),
    letterRow('asdfghjkl', '@#$&*()\'"'),
    [
      { action: 'shift', w: 1.4 },
      ...letterRow('zxcvbnm', '%-+=/;:'),
      { action: 'backspace', w: 1.4 }
    ],
    [
      { action: 'layer', to: 'numbers', label: '123', w: 1.4 },
      { k: ',', alt: '!' },
      { action: 'space', w: 4.6 },
      { k: '.', alt: '?' },
      { action: 'enter', w: 2 }
    ]
  ],
  numbers: [
    '1234567890'.split(''),
    ['-', '/', ':', ';', '(', ')', '$', '&', '@', '"'],
    [
      { action: 'layer', to: 'symbols', label: '#+=', w: 1.4 },
      { action: 'undo', label: '↶', w: 1.1 },
      '.', ',', '?', '!', '\'',
      { action: 'backspace', w: 1.4 }
    ],
    [
      { action: 'layer', to: 'letters', label: 'ABC', w: 1.4 },
      { k: ',', alt: '!' },
      { action: 'space', w: 4.6 },
      { k: '.', alt: '?' },
      { action: 'enter', w: 2 }
    ]
  ],
  symbols: [
    ['[', ']', '{', '}', '#', '%', '^', '*', '+', '='],
    ['_', '\\', '|', '~', '<', '>', '€', '£', '¥', '•'],
    [
      { action: 'layer', to: 'numbers', label: '123', w: 1.4 },
      { action: 'redo', label: '↷', w: 1.1 },
      '.', ',', '?', '!', '\'',
      { action: 'backspace', w: 1.4 }
    ],
    [
      { action: 'layer', to: 'letters', label: 'ABC', w: 1.4 },
      { k: ',', alt: '!' },
      { action: 'space', w: 4.6 },
      { k: '.', alt: '?' },
      { action: 'enter', w: 2 }
    ]
  ]
};

// Long-press alternates
export const ACCENTS = {
  a: ['à', 'á', 'â', 'ä', 'æ', 'ã', 'å'],
  e: ['è', 'é', 'ê', 'ë', 'ē'],
  i: ['ì', 'í', 'î', 'ï'],
  o: ['ò', 'ó', 'ô', 'ö', 'õ', 'ø', 'œ'],
  u: ['ù', 'ú', 'û', 'ü'],
  n: ['ñ'],
  c: ['ç'],
  s: ['ß'],
  y: ['ÿ'],
  '.': ['…', '•', '·'],
  ',': [';', ':'],
  '-': ['–', '—', '_'],
  '\'': ['’', '‘', '`'],
  '"': ['“', '”', '«', '»'],
  '?': ['¿'],
  '!': ['¡'],
  '$': ['€', '£', '¥', '¢'],
  '/': ['\\', '|'],
  '0': ['°']
};

// Physical neighbours on QWERTY, used by autocorrect's error model
export const NEIGHBOURS = (() => {
  const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  const offsets = [0, 0.5, 1.5];
  const pos = {};
  rows.forEach((row, r) => row.split('').forEach((ch, c) => { pos[ch] = [c + offsets[r], r]; }));
  const map = {};
  for (const a of Object.keys(pos)) {
    map[a] = new Set();
    for (const b of Object.keys(pos)) {
      if (a === b) continue;
      const dx = pos[a][0] - pos[b][0];
      const dy = pos[a][1] - pos[b][1];
      if (Math.abs(dy) <= 1 && Math.abs(dx) <= 1.01) map[a].add(b);
    }
  }
  return map;
})();
