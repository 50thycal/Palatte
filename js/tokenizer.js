/**
 * Tokenizer for text processing
 * Handles word tokenization with normalization for n-gram counting
 */

// Punctuation that should be treated as word boundaries
const PUNCTUATION = /[.,!?;:'"()\[\]{}—–\-\/\\@#$%^&*+=<>|`~]+/g;

// Whitespace pattern
const WHITESPACE = /\s+/g;

/**
 * Tokenize text into words
 * @param {string} text - Input text
 * @param {Object} options - Tokenization options
 * @param {boolean} options.lowercase - Convert to lowercase (default: true)
 * @param {boolean} options.preserveCase - Return both normalized and original (default: false)
 * @returns {string[]|{normalized: string, original: string}[]} Array of tokens
 */
export function tokenize(text, options = {}) {
  const { lowercase = true, preserveCase = false } = options;

  if (!text || typeof text !== 'string') {
    return [];
  }

  // Replace punctuation with spaces, then split on whitespace
  const cleaned = text
    .replace(PUNCTUATION, ' ')
    .replace(WHITESPACE, ' ')
    .trim();

  if (!cleaned) {
    return [];
  }

  const words = cleaned.split(' ').filter(w => w.length > 0);

  if (preserveCase) {
    return words.map(w => ({
      normalized: w.toLowerCase(),
      original: w
    }));
  }

  return lowercase ? words.map(w => w.toLowerCase()) : words;
}

/**
 * Get the last N tokens from text
 * @param {string} text - Input text
 * @param {number} n - Number of tokens to return
 * @returns {string[]} Last N tokens (lowercase)
 */
export function getLastNTokens(text, n) {
  const tokens = tokenize(text);
  return tokens.slice(-n);
}

/**
 * Get context tokens before cursor position
 * @param {string} text - Full text
 * @param {number} cursorPos - Cursor position (defaults to end)
 * @param {number} n - Number of context tokens
 * @returns {string[]} Context tokens before cursor
 */
export function getContextBeforeCursor(text, cursorPos = null, n = 2) {
  if (!text) return [];

  // If no cursor position, use end of text
  const pos = cursorPos ?? text.length;
  const textBeforeCursor = text.slice(0, pos);

  // Check if we're in the middle of typing a word
  const trimmed = textBeforeCursor.trimEnd();
  const endsWithSpace = textBeforeCursor.endsWith(' ') ||
                        textBeforeCursor.endsWith('\n') ||
                        textBeforeCursor.endsWith('\t');

  // Get tokens from text before cursor
  const tokens = tokenize(trimmed);

  if (endsWithSpace) {
    // Cursor is after a completed word, use last N tokens as context
    return tokens.slice(-n);
  } else {
    // Cursor is in the middle of a word, exclude the partial word
    // and use the N tokens before it
    return tokens.slice(-(n + 1), -1);
  }
}

/**
 * Get the partial word being typed (if any)
 * @param {string} text - Full text
 * @param {number} cursorPos - Cursor position (defaults to end)
 * @returns {string|null} Partial word or null if cursor is after whitespace
 */
export function getPartialWord(text, cursorPos = null) {
  if (!text) return null;

  const pos = cursorPos ?? text.length;
  const textBeforeCursor = text.slice(0, pos);

  const endsWithSpace = textBeforeCursor.endsWith(' ') ||
                        textBeforeCursor.endsWith('\n') ||
                        textBeforeCursor.endsWith('\t');

  if (endsWithSpace || !textBeforeCursor.trim()) {
    return null;
  }

  const tokens = tokenize(textBeforeCursor, { lowercase: false });
  return tokens.length > 0 ? tokens[tokens.length - 1] : null;
}

/**
 * Extract n-grams from text
 * @param {string} text - Input text
 * @param {number} weight - Weight multiplier for counts (for recency)
 * @returns {Object} { unigrams, bigrams, trigrams } with counts
 */
export function extractNgrams(text, weight = 1) {
  const tokens = tokenize(text);

  const unigrams = {};
  const bigrams = {};
  const trigrams = {};

  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i];

    // Unigram
    unigrams[word] = (unigrams[word] || 0) + weight;

    // Bigram (need previous word)
    if (i >= 1) {
      const prev = tokens[i - 1];
      const key = `${prev}|${word}`;
      if (!bigrams[key]) {
        bigrams[key] = { prev, word, count: 0 };
      }
      bigrams[key].count += weight;
    }

    // Trigram (need two previous words)
    if (i >= 2) {
      const prevPrev = tokens[i - 2];
      const prev = tokens[i - 1];
      const context = `${prevPrev}|${prev}`;
      const key = `${prevPrev}|${prev}|${word}`;
      if (!trigrams[key]) {
        trigrams[key] = { prevPrev, prev, word, context, count: 0 };
      }
      trigrams[key].count += weight;
    }
  }

  return { unigrams, bigrams, trigrams };
}

/**
 * Check if text ends with a word boundary (space, punctuation, newline)
 * @param {string} text - Input text
 * @returns {boolean}
 */
export function endsWithWordBoundary(text) {
  if (!text) return true;
  const lastChar = text[text.length - 1];
  return /[\s.,!?;:'"()\[\]{}—–\-\/\\@#$%^&*+=<>|`~\n\t]/.test(lastChar);
}

/**
 * Normalize a word for lookup (lowercase)
 * @param {string} word - Input word
 * @returns {string} Normalized word
 */
export function normalizeWord(word) {
  return word?.toLowerCase() || '';
}
