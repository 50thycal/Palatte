/**
 * End-to-end check of the host-defined hotkey strip, custom layers, pluggable
 * storage and dictionary options of palate-keys.
 *
 *   npm run dev            # in one terminal (http://localhost:3000)
 *   node tests/e2e/hotkeys.e2e.mjs
 */

import assert from 'node:assert/strict';

const playwright = await import('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000/';
const browser = await playwright.chromium.launch();
const ctx = await browser.newContext({ ...playwright.devices['iPhone 13'], serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(BASE);
await page.waitForTimeout(1200);

// Install hotkeys through the same module instance the app uses
await page.evaluate(async () => {
  const keys = await import('/packages/palate-keys/src/keyboard.js');
  window.__ran = [];
  keys.registerLayout('fn', [
    [{ k: 'a', alt: '1' }, 'b'],
    [{ action: 'layer', to: 'letters', label: 'ABC', w: 1.4 }]
  ]);
  keys.setHotkeys([
    { label: 'GG', insert: 'good game ', alt: { label: 'ty', insert: 'thank you ' }, hold: { label: 'gl', insert: 'good luck ' } },
    { label: 'Hi', insert: 'Hello {cursor}!' },
    { label: 'UP', run: (ctx) => ctx.replaceAll(ctx.text.toUpperCase()) },
    { label: 'Ping', run: (ctx) => { window.__ran.push(ctx.selection.text); }, style: 'plain' },
    { label: 'FN', layer: 'fn' },
    { label: 'Mic', dictate: true }
  ]);
  keys.setHotkeys('chat', [{ label: 'Chat', insert: 'chat ' }]);
});
await page.locator('#palate-input').tap();
await page.waitForTimeout(400);

const hot = (label) => page.evaluate((label) => {
  const k = [...document.querySelectorAll('.pk-row-hot .pk-key')].find((el) =>
    el.querySelector('.pk-key-label').textContent.trim() === label);
  if (!k) return null;
  const r = k.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, label);
const value = () => page.$eval('#palate-input', (el) => el.value);
const setText = (t) => page.$eval('#palate-input', (el, t) => {
  el.value = t;
  el.setSelectionRange(t.length, t.length);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, t);
async function gesture(label, { dx = 0, dy = 0, holdMs = 0, id = 40 }) {
  const b = await hot(label);
  assert.ok(b, `hotkey ${label} is on screen`);
  await page.evaluate(async ({ x, y, dx, dy, holdMs, id }) => {
    const el = document.querySelector('.pk-rows');
    const ev = (t, f) => el.dispatchEvent(new PointerEvent(t, {
      pointerId: id, pointerType: 'touch', isPrimary: true, bubbles: true,
      clientX: x + dx * f, clientY: y + dy * f
    }));
    ev('pointerdown', 0);
    for (let i = 1; i <= 12; i++) ev('pointermove', i / 12);
    if (holdMs) await new Promise((r) => setTimeout(r, holdMs));
    ev('pointerup', 1);
  }, { ...b, dx, dy, holdMs, id });
  await page.waitForTimeout(60);
}

// The strip renders above the letters
assert.equal(await page.$$eval('.pk-row-hot .pk-key', (els) => els.length), 6, 'six hotkeys');
assert.ok(await page.$eval('.pk-row-hot + .pk-row .pk-key-label', (el) => el.textContent.trim().toLowerCase() === 'q'), 'letters follow the strip');
assert.equal(await page.$eval('.pk-row-hot .pk-key-hot .pk-key-alt', (el) => el.textContent), 'ty', 'swipe-up label is shown');

await setText('');
const b = await hot('GG');
await page.touchscreen.tap(b.x, b.y);
await page.waitForTimeout(60);
assert.equal(await value(), 'good game ', 'tap inserts');

await gesture('GG', { dy: -40, id: 41 });
assert.equal(await value(), 'good game thank you ', 'swipe up runs the alternate');

await gesture('GG', { holdMs: 700, id: 42 });
assert.equal(await value(), 'good game thank you good luck ', 'hold runs the long-press action only once');

await setText('');
const hi = await hot('Hi');
await page.touchscreen.tap(hi.x, hi.y);
await page.waitForTimeout(60);
assert.equal(await value(), 'Hello !', '{cursor} is removed');
assert.equal(await page.$eval('#palate-input', (el) => el.selectionStart), 'Hello '.length, 'caret lands at {cursor}');

await setText('ready');
const up = await hot('UP');
await page.touchscreen.tap(up.x, up.y);
await page.waitForTimeout(60);
assert.equal(await value(), 'READY', 'run(ctx) edits through the context');
await page.evaluate(() => document.execCommand('undo'));
assert.equal(await value(), 'ready', 'a hotkey edit is one native undo step');

await page.$eval('#palate-input', (el) => el.setSelectionRange(1, 4));
const ping = await hot('Ping');
await page.touchscreen.tap(ping.x, ping.y);
await page.waitForTimeout(60);
assert.deepEqual(await page.evaluate(() => window.__ran), ['ead'], 'run(ctx) sees the selection');
assert.ok(!await page.$eval('.pk-row-hot .pk-key:nth-child(4)', (el) => el.classList.contains('pk-key-hot')), 'plain style has no hot colour');

// Layer key from a hotkey, custom layer content
const fn = await hot('FN');
await page.touchscreen.tap(fn.x, fn.y);
await page.waitForTimeout(80);
assert.equal(await page.$$eval('.pk-row-hot', (e) => e.length), 0, 'the strip is for the letters layer only');
assert.ok(await page.$$eval('.pk-key-label', (els) => els.some((e) => e.textContent === 'b')), 'custom layer rendered');
await page.evaluate(async () => (await import('/packages/palate-keys/src/keyboard.js')).registerLayout('fn', [[{ action: 'layer', to: 'letters', label: 'ABC' }]]));
await page.locator('.pk-key-layer').first().tap();
await page.waitForTimeout(80);
assert.equal(await page.$$eval('.pk-row-hot', (e) => e.length), 1, 'back on letters, strip is back');

// A field can pick its own hotkey set
await page.evaluate(() => document.querySelector('#palate-input').setAttribute('data-pk-hotkeys', 'chat'));
await page.evaluate(() => document.activeElement.blur());
await page.waitForTimeout(100);
await page.locator('#palate-input').tap();
await page.waitForTimeout(300);
assert.deepEqual(await page.$$eval('.pk-row-hot .pk-key-label', (els) => els.map((e) => e.textContent)), ['Chat'], 'data-pk-hotkeys picks a set');
await page.evaluate(() => document.querySelector('#palate-input').setAttribute('data-pk-hotkeys', 'none'));
await page.evaluate(() => document.activeElement.blur());
await page.waitForTimeout(100);
await page.locator('#palate-input').tap();
await page.waitForTimeout(300);
assert.equal(await page.$$eval('.pk-row-hot', (e) => e.length), 0, 'an unknown set shows no strip');

// Dictation: the field is handed to the system keyboard, then reclaimed on blur
await page.evaluate(() => document.querySelector('#palate-input').setAttribute('data-pk-hotkeys', 'default'));
await page.evaluate(() => document.activeElement.blur());
await page.waitForTimeout(100);
await page.locator('#palate-input').tap();
await page.waitForTimeout(300);
const mic = await hot('Mic');
await page.touchscreen.tap(mic.x, mic.y);
await page.waitForTimeout(150);
assert.equal(await page.$eval('#palate-input', (el) => el.hasAttribute('data-pk-system')), true, 'dictate hands the field over');
assert.equal(await page.$eval('#palate-input', (el) => el.getAttribute('inputmode')), null, 'system keyboard allowed');
assert.equal(await page.$eval('#palate-input', (el) => document.activeElement === el), true, 'field keeps focus');
assert.equal(await page.$eval('.pk', (el) => el.classList.contains('pk-visible')), false, 'in-app keyboard steps aside');
await page.evaluate(() => document.activeElement.blur());
await page.waitForTimeout(150);
assert.equal(await page.$eval('#palate-input', (el) => el.hasAttribute('data-pk-system')), false, 'field is reclaimed on blur');
assert.equal(await page.$eval('#palate-input', (el) => el.getAttribute('inputmode')), 'none', 'in-app keyboard is back');

assert.deepEqual(errors, [], 'no page errors');
await browser.close();
console.log('hotkeys e2e: all checks passed');
