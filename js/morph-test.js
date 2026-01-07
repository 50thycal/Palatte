/**
 * Test harness for Morph prediction system
 * Run in browser console or import as module
 */

import {
  tokenize,
  extractNgrams,
  getContextBeforeCursor,
  getPartialWord,
  getLastNTokens
} from './tokenizer.js';

import * as predictor from './predictor.js';
import * as morph from './morph.js';

// Test results collector
const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, passed: true });
    console.log(`✓ ${name}`);
  } catch (err) {
    results.push({ name, passed: false, error: err.message });
    console.error(`✗ ${name}: ${err.message}`);
  }
}

function assertEqual(actual, expected, msg = '') {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(`${msg}\nExpected: ${expectedStr}\nActual: ${actualStr}`);
  }
}

function assertTrue(value, msg = '') {
  if (!value) {
    throw new Error(msg || 'Expected true but got false');
  }
}

// ============================================
// Tokenizer Tests
// ============================================

function runTokenizerTests() {
  console.log('\n--- Tokenizer Tests ---');

  test('tokenize: basic sentence', () => {
    const tokens = tokenize('Hello world');
    assertEqual(tokens, ['hello', 'world']);
  });

  test('tokenize: with punctuation', () => {
    const tokens = tokenize('Hello, world! How are you?');
    assertEqual(tokens, ['hello', 'world', 'how', 'are', 'you']);
  });

  test('tokenize: with newlines', () => {
    const tokens = tokenize('Hello\nworld\n\ntest');
    assertEqual(tokens, ['hello', 'world', 'test']);
  });

  test('tokenize: preserve case option', () => {
    const tokens = tokenize('Hello World', { lowercase: false });
    assertEqual(tokens, ['Hello', 'World']);
  });

  test('tokenize: empty string', () => {
    const tokens = tokenize('');
    assertEqual(tokens, []);
  });

  test('tokenize: only whitespace', () => {
    const tokens = tokenize('   \n\t  ');
    assertEqual(tokens, []);
  });

  test('getLastNTokens: basic', () => {
    const tokens = getLastNTokens('one two three four five', 2);
    assertEqual(tokens, ['four', 'five']);
  });

  test('getContextBeforeCursor: end of text after space', () => {
    const context = getContextBeforeCursor('hello world ', null, 2);
    assertEqual(context, ['hello', 'world']);
  });

  test('getContextBeforeCursor: mid-word', () => {
    const context = getContextBeforeCursor('hello world test', null, 2);
    // Should exclude 'test' since cursor is right after it (mid-word)
    assertEqual(context, ['hello', 'world']);
  });

  test('getPartialWord: typing in progress', () => {
    const partial = getPartialWord('hello wor');
    assertEqual(partial, 'wor');
  });

  test('getPartialWord: after space', () => {
    const partial = getPartialWord('hello world ');
    assertEqual(partial, null);
  });

  test('extractNgrams: basic', () => {
    const { unigrams, bigrams, trigrams } = extractNgrams('a b c');
    assertEqual(Object.keys(unigrams).sort(), ['a', 'b', 'c']);
    assertTrue(bigrams['a|b'] !== undefined, 'Should have bigram a|b');
    assertTrue(bigrams['b|c'] !== undefined, 'Should have bigram b|c');
    assertTrue(trigrams['a|b|c'] !== undefined, 'Should have trigram a|b|c');
  });

  test('extractNgrams: with weight', () => {
    const { unigrams } = extractNgrams('hello hello', 2);
    assertEqual(unigrams['hello'], 4); // 2 occurrences * weight 2
  });
}

// ============================================
// Predictor Tests
// ============================================

async function runPredictorTests() {
  console.log('\n--- Predictor Tests ---');

  // Clear any existing data
  await predictor.clearModel();

  test('predictor: initial state is empty', async () => {
    const stats = await predictor.getModelStats();
    assertEqual(stats.unigramCount, 0);
  });

  // Train with sample text
  const sampleText = `
    The quick brown fox jumps over the lazy dog.
    The quick brown fox is very quick.
    The lazy dog sleeps all day.
    I love the quick fox.
  `;

  await predictor.train(sampleText);

  test('predictor: model has data after training', async () => {
    const stats = await predictor.getModelStats();
    assertTrue(stats.unigramCount > 0, 'Should have unigrams');
    assertTrue(stats.bigramCount > 0, 'Should have bigrams');
    assertTrue(stats.trigramCount > 0, 'Should have trigrams');
  });

  test('predictor: trigram prediction', async () => {
    // "quick brown" should predict "fox"
    const predictions = await predictor.predict(['quick', 'brown'], 3);
    assertTrue(predictions.length > 0, 'Should have predictions');
    assertEqual(predictions[0].word, 'fox');
  });

  test('predictor: bigram backoff', async () => {
    // "the" should predict common followers
    const predictions = await predictor.predict(['the'], 5);
    assertTrue(predictions.length > 0, 'Should have predictions');
    // "quick" or "lazy" should be top predictions after "the"
    const words = predictions.map(p => p.word);
    assertTrue(
      words.includes('quick') || words.includes('lazy'),
      'Should predict quick or lazy after the'
    );
  });

  test('predictor: unigram backoff', async () => {
    // Unknown context should fall back to unigrams
    const predictions = await predictor.predict(['xyz', 'abc'], 5);
    assertTrue(predictions.length > 0, 'Should have unigram fallback');
  });

  test('predictor: scores sum to ~1', async () => {
    const predictions = await predictor.predict(['the'], 5);
    const totalScore = predictions.reduce((sum, p) => sum + p.score, 0);
    assertTrue(
      Math.abs(totalScore - 1.0) < 0.01,
      `Scores should sum to 1, got ${totalScore}`
    );
  });

  test('predictor: caching works', async () => {
    // First call
    const t1 = performance.now();
    await predictor.predict(['quick', 'brown'], 3);
    const first = performance.now() - t1;

    // Second call (should be cached)
    const t2 = performance.now();
    await predictor.predict(['quick', 'brown'], 3);
    const second = performance.now() - t2;

    // Cached should be faster (or at least not slower)
    assertTrue(second <= first + 1, 'Cached prediction should be fast');
  });

  test('predictor: partial word filtering', async () => {
    // With partial "qu", should filter to words starting with "qu"
    const predictions = await predictor.predict(['the'], 5, 'qu');
    assertTrue(predictions.length > 0, 'Should have predictions');
    for (const p of predictions) {
      assertTrue(p.word.startsWith('qu'), `${p.word} should start with qu`);
    }
  });
}

// ============================================
// Morph API Tests
// ============================================

async function runMorphTests() {
  console.log('\n--- Morph API Tests ---');

  // Clear and rebuild
  await morph.clearModel();

  test('morph: getNextWordSuggestions with empty text', async () => {
    const suggestions = await morph.getNextWordSuggestions('', null, 3);
    // May or may not have suggestions depending on corpus
    assertTrue(Array.isArray(suggestions), 'Should return array');
  });

  // Train with some text first
  await morph.updateModelWithText('I want to build something great today');
  await morph.updateModelWithText('I want to learn new things');
  await morph.updateModelWithText('Building great things is fun');

  test('morph: predictions after training', async () => {
    const suggestions = await morph.getNextWordSuggestions('I want ', null, 3);
    assertTrue(suggestions.length > 0, 'Should have suggestions');
    // "to" should be a top prediction after "I want"
    const words = suggestions.map(s => s.word);
    assertTrue(words.includes('to'), '"to" should be predicted after "I want"');
  });

  test('morph: mid-sentence predictions', async () => {
    const suggestions = await morph.getNextWordSuggestions('Building great ', null, 3);
    assertTrue(suggestions.length > 0, 'Should have suggestions');
  });

  test('morph: shouldShowPredictions', () => {
    assertTrue(morph.shouldShowPredictions('hello '), 'Should show after space');
    assertTrue(morph.shouldShowPredictions(''), 'Should show for empty');
    assertTrue(morph.shouldShowPredictions('hello'), 'Should show mid-word for filtering');
  });

  test('morph: getModelStats', async () => {
    const stats = await morph.getModelStats();
    assertTrue(stats.unigramCount > 0, 'Should have stats');
  });
}

// ============================================
// Performance Tests
// ============================================

async function runPerformanceTests() {
  console.log('\n--- Performance Tests ---');

  // Train with more text for realistic testing
  const loremIpsum = `
    Lorem ipsum dolor sit amet consectetur adipiscing elit.
    Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
    Ut enim ad minim veniam quis nostrud exercitation ullamco laboris.
    Duis aute irure dolor in reprehenderit in voluptate velit esse cillum.
    Excepteur sint occaecat cupidatat non proident sunt in culpa qui officia.
  `.repeat(10);

  await predictor.train(loremIpsum);

  test('performance: prediction under 50ms', async () => {
    // Warm up cache
    await predictor.predict(['lorem', 'ipsum'], 6);

    // Measure
    const iterations = 100;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      await morph.getNextWordSuggestions('Lorem ipsum ', null, 6);
    }
    const elapsed = performance.now() - start;
    const avg = elapsed / iterations;

    console.log(`  Average prediction time: ${avg.toFixed(2)}ms`);
    assertTrue(avg < 50, `Average should be under 50ms, got ${avg.toFixed(2)}ms`);
  });
}

// ============================================
// Run All Tests
// ============================================

export async function runAllTests() {
  console.log('=== Morph System Tests ===\n');
  results.length = 0;

  runTokenizerTests();
  await runPredictorTests();
  await runMorphTests();
  await runPerformanceTests();

  // Summary
  console.log('\n=== Summary ===');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`Passed: ${passed}, Failed: ${failed}`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
  }

  return { passed, failed, results };
}

// Export for console usage
window.MorphTest = { runAllTests, runTokenizerTests, runPredictorTests, runMorphTests };

console.log('Morph test harness loaded. Run MorphTest.runAllTests() to execute.');
