import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as aim from '../js/keyboard/aim.js';
import * as shortcuts from '../js/keyboard/shortcuts.js';
import * as clips from '../js/keyboard/clips.js';

test('aim offsets apply only after enough samples and stay bounded', () => {
  aim.reset();
  for (let i = 0; i < 11; i++) aim.record('g', 0.3, -0.2);
  assert.deepEqual(aim.offset('g'), { dx: 0, dy: 0 }, 'not enough samples yet');
  aim.record('g', 0.3, -0.2);
  const o = aim.offset('g');
  assert.ok(Math.abs(o.dx - 0.3) < 0.02 && Math.abs(o.dy + 0.2) < 0.02, JSON.stringify(o));
  for (let i = 0; i < 40; i++) aim.record('h', 0.9, 0);
  assert.equal(aim.offset('h').dx, 0.35, 'clamped');
  aim.record('h', 5, 5); // wild tap ignored
  assert.equal(aim.stats().keysLearned, 2);
  aim.reset();
  assert.equal(aim.stats().taps, 0);
});

test('shortcuts expand exact triggers with live date tokens', () => {
  shortcuts.setShortcuts([{ trigger: ';e', expansion: 'me@example.com' }, { trigger: ';d', expansion: 'Today is {day}' }, { trigger: 'x', expansion: 'too short' }]);
  assert.equal(shortcuts.expand(';e'), 'me@example.com');
  assert.equal(shortcuts.expand(';E'), 'me@example.com', 'case-insensitive');
  assert.match(shortcuts.expand(';d'), /^Today is (Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day$/);
  assert.equal(shortcuts.expand('x'), null, 'single-character triggers rejected');
  assert.equal(shortcuts.expand(';ee'), null);
  assert.equal(shortcuts.fill('{iso}', new Date('2026-03-04T10:00:00Z')), '2026-03-04');
  assert.equal(shortcuts.validate({ trigger: 'a b', expansion: 'x' }), 'Shortcuts can’t contain spaces');
  assert.equal(shortcuts.validate({ trigger: ';z', expansion: ' ' }), 'Add the text it should expand to');
  assert.equal(shortcuts.validate({ trigger: ';z', expansion: 'ok' }), null);
});

test('clipboard history keeps the latest 10, newest first, deduped', () => {
  clips.clear();
  for (let i = 0; i < 12; i++) clips.push(`clip ${i}`);
  clips.push('clip 5');
  const list = clips.list().map((c) => c.text);
  assert.equal(list.length, 10);
  assert.equal(list[0], 'clip 5');
  assert.equal(list.filter((t) => t === 'clip 5').length, 1);
  assert.equal(clips.preview('a'.repeat(40), 10), 'aaaaaaaaa…');
  clips.clear();
});
