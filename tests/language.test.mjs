import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as lang from '../js/keyboard/language.js';

before(() => {
  lang.setDictionary(readFileSync(new URL('../data/words-en.txt', import.meta.url), 'utf8').split('\n'));
});

test('fixes common typos', () => {
  const cases = {
    teh: 'the', recieve: 'receive', becuase: 'because', tomorow: 'tomorrow',
    definately: 'definitely', thier: 'their', wierd: 'weird', jsut: 'just',
    meetign: 'meeting', realy: 'really', sonething: 'something',
    peopel: 'people', wiht: 'with', abotu: 'about', yoyr: 'your', adress: 'address',
    tge: 'the', ans: null, lookin: 'looking', happend: 'happened', untill: 'until', seperate: 'separate', occured: 'occurred'
  };
  const misses = [];
  for (const [typo, want] of Object.entries(cases)) {
    const got = lang.correct(typo);
    if (got !== want) misses.push(`${typo} -> ${got} (want ${want})`);
  }
  assert.deepEqual(misses, []);
});

test('leaves valid words, names and acronyms alone', () => {
  for (const w of ['hello', 'their', 'there', 'its', 'were', 'NASA', 'API']) {
    assert.equal(lang.correct(w), null, w);
  }
  assert.equal(lang.correct('Zorblax'), null);
});

test('contractions and capital I', () => {
  assert.equal(lang.correct('im'), "I'm");
  assert.equal(lang.correct('i'), 'I');
  assert.equal(lang.correct('dont'), "don't");
  assert.equal(lang.correct('Dont', { sentenceStart: true }), "Don't");
  assert.equal(lang.correct('ill'), null);
});

test('learned words are never corrected', () => {
  lang.setLearnedWords(['palate', 'gonna']);
  assert.equal(lang.correct('palate'), null);
  lang.setLearnedWords([]);
});

test('preserves capitalisation', () => {
  assert.equal(lang.correct('Teh', { sentenceStart: true }), 'The');
  assert.equal(lang.correct('TEH'), null); // all caps treated as acronym
});

test('completions rank by frequency', async () => {
  const got = await lang.complete('tom', [], 3);
  assert.ok(got.includes('tomorrow'), got.join());
  assert.equal((await lang.complete('i', [], 1))[0], 'I');
});

test('next-letter probabilities favour real continuations', () => {
  const p = lang.nextLetterProbs('th');
  assert.ok(p.get('e') > p.get('x') || !p.get('x'));
  assert.ok(p.get('e') > 0.3);
});

test('correction is fast enough to run per word', () => {
  const t = performance.now();
  for (let i = 0; i < 50; i++) lang.correct('sonethimg');
  const per = (performance.now() - t) / 50;
  assert.ok(per < 15, `${per.toFixed(1)}ms per correction`);
});
