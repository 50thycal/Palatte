/**
 * End-to-end checks for select mode, Palate's clipboard, text shortcuts and
 * learned aim, in an emulated iPhone with touch input.
 *
 *   npm run dev
 *   node tests/e2e/select.e2e.mjs
 */

import assert from 'node:assert/strict';

let playwright;
try {
  playwright = await import('playwright');
} catch {
  console.error('Playwright is not installed: npm i -D playwright');
  process.exit(1);
}

const BASE = process.env.BASE_URL || 'http://localhost:3000/';
const browser = await playwright.chromium.launch();
const ctx = await browser.newContext({ ...playwright.devices['iPhone 13'], serviceWorkers: 'block' });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(BASE);
await page.evaluate(() => localStorage.clear());
await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('palate'); q.onsuccess = q.onerror = q.onblocked = r; }));
await page.reload();
await page.waitForTimeout(1500);

const value = () => page.$eval('#palate-input', (el) => el.value);
const selection = () => page.$eval('#palate-input', (el) => el.value.slice(el.selectionStart, el.selectionEnd));
const setText = (t, caret = t.length) => page.$eval('#palate-input', (el, [t, c]) => {
  el.focus();
  el.value = t;
  el.setSelectionRange(c, c);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, [t, caret]);
const chip = (cmd) => page.locator(`.pk-chip[data-cmd="${cmd}"]`).tap();
const keyCentre = (label) => page.evaluate((label) => {
  const k = [...document.querySelectorAll('.pk-key')].find((el) =>
    el.querySelector('.pk-key-label').textContent.trim().toLowerCase() === label ||
    (label === 'bs' && el.classList.contains('pk-key-backspace')));
  const r = k.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
}, label);
async function tap(label) {
  const b = await keyCentre(label);
  await page.touchscreen.tap(b.x, b.y);
  await page.waitForTimeout(40);
}
async function dragSpace(dx, id) {
  const b = await keyCentre('space');
  await page.evaluate(({ x, y, dx, id }) => {
    const el = document.querySelector('.pk-rows');
    const ev = (t, f) => el.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: 'touch', isPrimary: true, bubbles: true, clientX: x + dx * f, clientY: y }));
    ev('pointerdown', 0);
    for (let i = 1; i <= 12; i++) ev('pointermove', i / 12);
    ev('pointerup', 1);
  }, { ...b, dx, id });
}
async function longPress(selector) {
  await page.evaluate(async (selector) => {
    const btn = document.querySelector(selector);
    const r = btn.getBoundingClientRect();
    const o = { pointerId: 77, pointerType: 'touch', isPrimary: true, bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    btn.dispatchEvent(new PointerEvent('pointerdown', o));
    await new Promise((res) => setTimeout(res, 700));
    btn.dispatchEvent(new PointerEvent('pointerup', o));
  }, selector);
}

// ---------- Select mode ----------
await setText('Hello brave new world. Second sentence here.\nNext line', 8); // caret inside "brave"
await page.locator('.pk-select').tap();
assert.ok(await page.$eval('.pk-select', (el) => el.classList.contains('pk-on')), 'select button lit');
assert.deepEqual(await page.$$eval('.pk-chip', (els) => els.map((e) => e.textContent)), ['Word', 'Sentence', 'Para', 'All', 'Paste']);

await chip('word');
assert.equal(await selection(), 'brave', 'Word selects the word at the caret');
assert.deepEqual(await page.$$eval('.pk-chip', (els) => els.map((e) => e.textContent)), ['Cut', 'Copy', 'Paste', 'Aa']);
assert.equal(await page.$eval('.pk-action', (el) => el.textContent), '5 chars');

await chip('copy');
assert.equal(await page.$eval('.pk-bar-note', (el) => el.textContent), 'Copied');
assert.ok(!(await page.$eval('.pk-select', (el) => el.classList.contains('pk-on'))), 'copy ends select mode');
await page.waitForTimeout(1300);
const pasteSlot = await page.$eval('.pk-pred-paste', (el) => el.textContent);
assert.match(pasteSlot, /Paste “brave”/, 'paste chip offered after copy');
await page.$eval('#palate-input', (el) => el.setSelectionRange(el.value.length, el.value.length));
await tap('space');
await page.waitForTimeout(150);
await page.locator('.pk-pred-paste').tap();
assert.equal(await value(), 'Hello brave new world. Second sentence here.\nNext line brave', 'paste inserts the clip');

// Sentence / Paragraph / All
await setText('Hello brave new world. Second sentence here.\nNext line', 26); // in "Second"
await page.locator('.pk-select').tap();
await chip('sentence');
assert.equal(await selection(), 'Second sentence here.');
await page.locator('.pk-select').tap(); // done: collapse
await page.locator('.pk-select').tap();
await chip('paragraph');
assert.equal(await selection(), 'Hello brave new world. Second sentence here.');
await page.locator('.pk-select').tap();
await page.locator('.pk-select').tap();
await chip('all');
assert.equal(await selection(), 'Hello brave new world. Second sentence here.\nNext line');

// Aa on a selection
await chip('case');
assert.equal(await selection(), 'Hello Brave New World. Second Sentence Here.\nNext Line', 'Aa capitalizes the selection');
await page.locator('.pk-select').tap();

// Drag the space bar to grow a selection, then Cut
await setText('one two three', 0);
await page.locator('.pk-select').tap();
await dragSpace(9 * 7 + 4, 41); // 7 characters
assert.equal(await selection(), 'one two');
await chip('cut');
assert.equal(await value(), ' three', 'cut removed the selection');

// Typing replaces a selection and leaves select mode
await setText('replace me', 0);
await page.locator('.pk-select').tap();
await chip('all');
await tap('x');
assert.equal(await value(), 'X', 'typing replaced the selection');
assert.ok(!(await page.$eval('.pk-select', (el) => el.classList.contains('pk-on'))));

// Clipboard history: hold Paste
await setText('', 0);
await page.locator('.pk-select').tap();
await longPress('.pk-chip[data-cmd="paste"]');
const clipItems = await page.$$eval('.pk-clip', (els) => els.map((e) => e.textContent));
assert.deepEqual(clipItems.slice(0, 2), ['one two', 'brave'], 'history newest first');
assert.match(clipItems[clipItems.length - 1], /iPhone clipboard/);
await page.locator('.pk-clip[data-clip="1"]').tap();
assert.equal(await value(), 'brave', 'picked an older clip');

// ---------- Text shortcuts ----------
await setText('', 0);
await tap('123');
await tap(';');
const onNumbers = await page.evaluate(() => [...document.querySelectorAll('.pk-key-label')].some((el) => el.textContent.trim() === 'ABC'));
if (onNumbers) await tap('abc');
await tap('d');
assert.equal(await value(), ';d', 'typed the trigger');
await page.waitForTimeout(150);
const preview = await page.$$eval('.pk-pred', (els) => els.map((e) => e.textContent));
assert.ok(preview.some((t) => t.startsWith('→ ')), `shortcut preview shown: ${preview}`);
await tap('space');
const expanded = await value();
assert.match(expanded, /^[A-Z][a-z]+ \d{1,2}, \d{4} $/, `;d expanded to the date: ${JSON.stringify(expanded)}`);
await tap('bs');
assert.equal(await value(), ';d', 'backspace right after undoes the expansion');
const learned = await page.evaluate(async () => (await import('/js/store.js')).getKV('learnedWords', []));
assert.ok(!learned.includes(';d'), 'undoing a shortcut does not learn it as a word');

// ---------- Learned aim ----------
await setText('', 0);
const g = await keyCentre('g');
const between = { x: g.x + g.w * 0.45, y: g.y };
await page.evaluate(async () => (await import('/js/keyboard/aim.js')).reset());
await page.touchscreen.tap(between.x, between.y);
await page.waitForTimeout(60);
const withoutAim = (await value()).toLowerCase();
await setText('', 0);
await page.evaluate(async () => {
  const aim = await import('/js/keyboard/aim.js');
  aim.reset();
  // This person hits "h" well left of its centre
  for (let i = 0; i < 40; i++) aim.record('h', -0.6, 0);
});
await page.touchscreen.tap(between.x, between.y);
await page.waitForTimeout(60);
const withAim = (await value()).toLowerCase();
assert.equal(withoutAim, 'g', 'default: the drawn key wins');
assert.equal(withAim, 'h', 'learned aim: the key they mean wins');

// Backspace-and-retype teaches the intended key
await page.evaluate(async () => (await import('/js/keyboard/aim.js')).reset());
await setText('', 0);
await tap('f');
await tap('bs');
const before = await page.evaluate(async () => (await import('/js/keyboard/aim.js')).stats().taps);
await tap('g');
const after = await page.evaluate(async () => (await import('/js/keyboard/aim.js')).stats().taps);
assert.equal(after - before, 2, 'retype recorded the miss and the new tap');

assert.deepEqual(errors, []);
await browser.close();
console.log('select/clipboard/shortcuts/aim e2e: all checks passed');
