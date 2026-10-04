/**
 * End-to-end check of auto-organize (archive -> organize -> banner -> undo).
 * Uses a stand-in model so it runs without downloading real weights.
 *
 *   npm run dev            # in one terminal
 *   node tests/e2e/organize.e2e.mjs
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
await page.waitForTimeout(1200);

const mod = (path) => `(await import('${path}'))`;
const waitIdle = () => page.waitForFunction(async () => {
  const o = await import('/js/organize/organizer.js');
  return o.getStatus().queue === 0 && !o.getStatus().current;
}, null, { timeout: 10000 });

async function archive(text) {
  await page.$eval('#palate-input', (el, t) => {
    el.focus();
    el.value = t;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
  await page.waitForTimeout(300);
  await page.locator('.pk-action').tap();
  await page.waitForTimeout(300);
}

// Seed a project with a couple of notes so similar-note voting has signal
await page.evaluate(async () => {
  const st = await import('/js/store.js');
  const p = await st.createProject('Home Reno');
  await st.createNote({ projectId: p.id, body: 'Kitchen tiles quote from the contractor, grey tiles' });
  await st.createNote({ projectId: p.id, body: 'Bathroom tiles and contractor schedule for the reno' });
});

// 1. No model downloaded: rule-based organize
assert.equal(await page.$eval('.project-selector-label', (e) => e.textContent), 'Auto-file');
await archive('the contractor said kitchen tiles  ,grey ones are cheaper\ntodo: call contractor back');
await waitIdle();
const basic = await page.evaluate(async () => {
  const st = await import('/js/store.js');
  return st.listNotes().find((n) => n.body.includes('ontractor said'));
});
assert.match(basic.body, /^The contractor said kitchen tiles, grey ones are cheaper/, 'tidied');
assert.match(basic.body, /To-do\n- \[ \] Call contractor back$/, 'to-do checklist');
assert.ok(basic.projectId, 'filed into the project its similar notes share');

// Banner + see original + undo
await page.$eval('#palate-input', (e) => e.blur());
await page.evaluate(async (id) => {
  const app = document.querySelector('#nav-library');
  app.click();
}, basic.id);
await page.waitForTimeout(300);
await page.locator(`.note-item[data-id="${basic.id}"]`).tap();
await page.waitForTimeout(300);
const bannerText = await page.$eval('#org-banner', (e) => e.textContent.replace(/\s+/g, ' '));
assert.match(bannerText, /Organized \(basic\)/);
assert.match(bannerText, /1 to-do/);
await page.locator('[data-org="undo"]').tap();
await page.waitForTimeout(400);
const undone = await page.evaluate(async (id) => (await import('/js/store.js')).getNote(id), basic.id);
assert.equal(undone.body, 'the contractor said kitchen tiles  ,grey ones are cheaper\ntodo: call contractor back', 'undo restores original');
assert.equal(undone.projectId, null, 'undo restores the Inbox');

// 2. With a model (stand-in that returns schema-shaped JSON)
await page.evaluate(async () => {
  const o = await import('/js/organize/organizer.js');
  o.setEngineForTests(async (prompt) => {
    window.__lastPrompt = prompt;
    return {
      title: 'Garden planting plan',
      project: '',
      new_project: 'Garden',
      tags: ['garden', 'spring'],
      todos: ['Buy basil seeds'],
      cleaned: 'Plant tomatoes along the fence. Basil goes in pots; I need to buy basil seeds.'
    };
  });
});
await page.locator('#back').tap();
await page.waitForTimeout(200);
await page.locator('#back-palate').tap();
await page.waitForTimeout(400);
await archive('plant tomatoes along the fence. basil goes in pots i need to buy basil seeds');
await waitIdle();
const modelNote = await page.evaluate(async () => (await import('/js/store.js')).listNotes().find((n) => n.body.includes('omatoes')));
assert.equal(modelNote.title, 'Garden planting plan');
assert.equal(modelNote.body, 'Plant tomatoes along the fence. Basil goes in pots; I need to buy basil seeds.\n\nTo-do\n- [ ] Buy basil seeds\n\n#garden #spring');
assert.deepEqual(modelNote.tags.sort(), ['garden', 'spring']);
const prompt = await page.evaluate(() => window.__lastPrompt);
assert.match(prompt.user, /Projects: Home Reno/);
assert.equal(prompt.cleans, true);

// Suggested new project -> create & move from the banner
await page.$eval('#palate-input', (e) => e.blur());
await page.waitForTimeout(200);
await page.locator('#nav-library').tap();
await page.waitForTimeout(300);
await page.locator(`.note-item[data-id="${modelNote.id}"]`).tap();
await page.waitForTimeout(300);
assert.equal(await page.$eval('#title', (e) => e.value), 'Garden planting plan', 'custom title shown');
await page.locator('[data-org="project"]').tap();
await page.waitForTimeout(400);
assert.equal(await page.$eval('#move .project-selector-label', (e) => e.textContent), 'Garden');
if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/org-note.png` });

// 3. A note open in the editor is never organized under the user
const openId = modelNote.id;
await page.evaluate(async (id) => (await import('/js/organize/organizer.js')).enqueue(id, { keepProject: true }), openId);
await page.waitForTimeout(500);
assert.ok(await page.evaluate(async (id) => (await import('/js/organize/organizer.js')).isQueued(id), openId), 'waits while open');
await page.locator('#back').tap();
await waitIdle();

// 4. Settings section renders and reports device support
await page.locator('#nav-settings').tap();
await page.waitForTimeout(800);
const support = await page.$eval('#org-support', (e) => e.textContent);
assert.ok(support && !/Checking/.test(support), `device check: ${support}`);

// 5. The vendored WebLLM library loads in the browser
const exportsOk = await page.evaluate(async () => {
  const lib = await import('/vendor/web-llm/index.js');
  return ['CreateWebWorkerMLCEngine', 'CreateMLCEngine', 'hasModelInCache', 'WebWorkerMLCEngineHandler']
    .every((k) => typeof lib[k] === 'function');
});
assert.ok(exportsOk, 'web-llm exports');

// 6. Crash guard: what the app was doing when iOS killed it decides the advice
async function crashWith(marker, model = 'standard') {
  await page.evaluate(async ({ marker, model }) => {
    const st = await import('/js/store.js');
    await st.setKV('organizerModel', model);
    await st.setKV('llmReady', true);
    await st.setKV('llmInFlight', marker);
  }, { marker, model });
  await page.reload();
  await page.waitForTimeout(1200);
  return page.evaluate(async () => {
    const st = await import('/js/store.js');
    const o = await import('/js/organize/organizer.js');
    return { ready: st.getKV('llmReady'), inFlight: st.getKV('llmInFlight'), model: st.getKV('organizerModel'), status: o.getStatus() };
  });
}

// Interrupted download (app closed/backgrounded): resume, same model
let after = await crashWith({ at: 1, phase: 'download', model: 'standard', progress: 40 });
assert.equal(after.inFlight, null);
assert.equal(after.model, 'standard');
assert.match(after.status.text, /download stopped at 40%/);

// Killed while loading onto the GPU: step down to the next smaller model
after = await crashWith({ at: 1, phase: 'load', model: 'standard', progress: 100 });
assert.equal(after.ready, false);
assert.equal(after.model, 'lite');
assert.match(after.status.text, /Switched to Lite 1\.5B/);

after = await crashWith({ at: 1, phase: 'generate', model: 'lite', progress: 100 }, 'lite');
assert.equal(after.model, 'tiny');

after = await crashWith({ at: 1, phase: 'load', model: 'tiny', progress: 100 }, 'tiny');
assert.equal(after.model, 'tiny');
assert.match(after.status.text, /can't run the model/);

// Markers written by the previous version (a bare timestamp) still recover
after = await crashWith(Date.now(), 'standard');
assert.equal(after.model, 'lite');
await page.evaluate(async () => (await import('/js/store.js')).setKV('organizerModel', 'lite'));
if (process.env.SHOTS) {
  await page.evaluate(() => document.activeElement?.blur());
  await page.waitForTimeout(300);
  await page.locator('#nav-library').tap();
  await page.waitForTimeout(300);
  await page.locator('#nav-settings').tap();
  await page.waitForTimeout(800);
  await page.$eval('#organize-section', (e) => e.scrollIntoView());
  await page.screenshot({ path: `${process.env.SHOTS}/org-settings.png` });
}

assert.deepEqual(errors, []);
await browser.close();
console.log('organize e2e: all checks passed');
