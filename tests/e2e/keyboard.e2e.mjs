/**
 * End-to-end check of Palate Keys in an emulated iPhone with real touch input.
 *
 *   npm run dev            # in one terminal (http://localhost:3000)
 *   node tests/e2e/keyboard.e2e.mjs
 *
 * Requires Playwright (`npx playwright install chromium` if not present).
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
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(BASE);
await page.evaluate(() => localStorage.clear());
await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('palate'); q.onsuccess = q.onerror = q.onblocked = r; }));
await page.reload();
await page.waitForTimeout(1500);

const box = (label) => page.evaluate((label) => {
  const k = [...document.querySelectorAll('.pk-key')].find((el) =>
    el.querySelector('.pk-key-label').textContent.trim().toLowerCase() === label ||
    (label === 'bs' && el.classList.contains('pk-key-backspace')));
  const r = k.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, label);

async function tap(label) {
  const b = await box(label);
  await page.touchscreen.tap(b.x, b.y);
  await page.waitForTimeout(30);
}
async function type(text) {
  for (const ch of text) await tap(ch === ' ' ? 'space' : ch);
}
async function drag(label, dx, dy, id) {
  const b = await box(label);
  await page.evaluate(({ x, y, dx, dy, id }) => {
    const el = document.querySelector('.pk-rows');
    const ev = (t, f) => el.dispatchEvent(new PointerEvent(t, {
      pointerId: id, pointerType: 'touch', isPrimary: true, bubbles: true,
      clientX: x + dx * f, clientY: y + dy * f
    }));
    ev('pointerdown', 0);
    for (let i = 1; i <= 12; i++) ev('pointermove', i / 12);
    ev('pointerup', 1);
  }, { ...b, dx, dy, id });
}
const value = () => page.$eval('#palate-input', (el) => el.value);
const caret = () => page.$eval('#palate-input', (el) => el.selectionStart);
const preds = () => page.$$eval('.pk-pred', (els) => els.map((e) => e.textContent));

assert.equal(await page.$eval('#palate-input', (el) => el.getAttribute('inputmode')), 'none');

await type('teh ');
assert.equal(await value(), 'The ', 'autocorrect + auto-capitalisation');

await tap('bs');
assert.equal(await value(), 'Teh', 'backspace after autocorrect reverts');

await type(' quick ');
assert.equal(await value(), 'Teh quick ', 'reverted word was learned');

await tap('space');
assert.equal(await value(), 'Teh quick. ', 'double-space inserts a period');

await type('i dont knwo ');
assert.equal(await value(), "Teh quick. I don't know ", 'contractions, capital I and typo fix');

await drag('q', 0, -40, 11);
assert.ok((await value()).endsWith('1'), 'swipe up types the alternate');

const before = await caret();
await drag('space', -48, 0, 12);
assert.equal(await caret(), before - 5, 'space bar trackpad moves the caret');

await page.$eval('#palate-input', (el) => el.setSelectionRange(el.value.length, el.value.length));
await drag('bs', -40, 0, 13);
assert.equal(await value(), "Teh quick. I don't know ", 'swipe left on backspace deletes a word');

await type('see you tom');
await page.waitForTimeout(150);
const p = await preds();
const i = p.findIndex((t) => t === 'tomorrow');
assert.ok(i >= 0, `tomorrow predicted (${p})`);
await page.locator('.pk-pred').nth(i).tap();
await tap('.');
assert.equal(await value(), "Teh quick. I don't know see you tomorrow. ", 'prediction + smart punctuation');

// iOS quirk: after focusing a field iOS may scroll the page, so touches on a
// fixed keyboard report coordinates shifted from what's drawn. The browser's
// own target is still the key under the finger; that must win.
await page.$eval('#palate-input', (el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
for (const [i, ch] of [...'zxcvbnm'].entries()) {
  await page.evaluate(({ ch, id }) => {
    const keyEl = [...document.querySelectorAll('.pk-key')]
      .find((k) => k.querySelector('.pk-key-label').textContent.trim().toLowerCase() === ch);
    const r = keyEl.getBoundingClientRect();
    const o = { pointerId: id, pointerType: 'touch', isPrimary: true, bubbles: true,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 - 108 };
    keyEl.dispatchEvent(new PointerEvent('pointerdown', o));
    document.querySelector('.pk-rows').dispatchEvent(new PointerEvent('pointerup', o));
  }, { ch, id: 200 + i });
  await page.waitForTimeout(30);
}
assert.equal((await value()).toLowerCase(), 'zxcvbnm', 'shifted touch coordinates still hit the touched key');

assert.deepEqual(errors, []);
await browser.close();
console.log('keyboard e2e: all checks passed');
