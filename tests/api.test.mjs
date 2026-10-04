/**
 * Integration tests for the sync API against a real Postgres.
 *   TEST_DATABASE_URL=postgres://palate:palate@localhost/palate npm test
 * Skipped when TEST_DATABASE_URL is unset.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const DB = process.env.TEST_DATABASE_URL;
const TOKEN = 'test-token';

let server;
let base;
let sql;

async function call(path, { method = 'GET', body, token = TOKEN } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, data: await res.json() };
}

const note = (id, updatedAt, body, extra = {}) => ({
  id, projectId: null, title: id, body, pinned: false,
  createdAt: 1000, updatedAt, deletedAt: null, ...extra
});

before(async () => {
  if (!DB) return;
  process.env.DATABASE_URL = DB;
  process.env.PALATE_TOKEN = TOKEN;
  const { getSql } = await import('../api/_lib/db.js');
  sql = getSql();
  await sql`drop table if exists notes, projects, note_versions cascade`;
  await sql`drop sequence if exists palate_seq`;

  const routes = {
    sync: (await import('../api/sync.js')).default,
    versions: (await import('../api/versions.js')).default,
    health: (await import('../api/health.js')).default,
    backup: (await import('../api/backup.js')).default
  };
  server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://x').pathname.split('/')[2];
    routes[name](req, res);
  });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  server?.close();
  await sql?.end();
});

test('rejects missing or wrong token', { skip: !DB }, async () => {
  assert.equal((await call('/api/sync', { method: 'POST', body: {}, token: null })).status, 401);
  assert.equal((await call('/api/sync', { method: 'POST', body: {}, token: 'nope' })).status, 401);
});

test('push then pull round-trips records with increasing cursor', { skip: !DB }, async () => {
  const r1 = await call('/api/sync', {
    method: 'POST',
    body: {
      cursor: 0,
      projects: [{ id: 'p1', name: 'Work', createdAt: 1, updatedAt: 1 }],
      notes: [note('n1', 2000, 'hello'), note('n2', 2000, 'world', { projectId: 'p1' })]
    }
  });
  assert.equal(r1.status, 200);
  assert.equal(Object.keys(r1.data.applied.notes).length, 2);
  assert.equal(r1.data.notes.length, 2);
  assert.equal(r1.data.projects.length, 1);
  assert.equal(r1.data.notes[0].deletedAt, null);
  assert.equal(r1.data.projects[0].deletedAt, null);
  assert.ok(r1.data.cursor > 0);

  // Nothing new since the returned cursor
  const r2 = await call('/api/sync', { method: 'POST', body: { cursor: r1.data.cursor } });
  assert.equal(r2.data.notes.length, 0);
  assert.equal(r2.data.cursor, r1.data.cursor);
});

test('last write wins and the losing edit is kept as a version', { skip: !DB }, async () => {
  // Newer edit applies; previous body is snapshotted
  const newer = await call('/api/sync', { method: 'POST', body: { cursor: 0, notes: [note('n1', 3000, 'hello v2')] } });
  assert.ok(newer.data.applied.notes.n1);

  // Stale edit from another device loses
  const stale = await call('/api/sync', { method: 'POST', body: { cursor: 999999, notes: [note('n1', 2500, 'stale edit')] } });
  assert.deepEqual(stale.data.conflicts.notes, ['n1']);
  // Server copy is returned even though it is outside the pull window
  assert.equal(stale.data.notes.find((n) => n.id === 'n1').body, 'hello v2');

  const v = await call('/api/versions?noteId=n1');
  const bodies = v.data.versions.map((x) => [x.reason, x.body]);
  assert.deepEqual(bodies, [['conflict', 'stale edit'], ['edit', 'hello']]);
});

test('pull pages at the limit with hasMore', { skip: !DB }, async () => {
  const before = await call('/api/sync', { method: 'POST', body: { cursor: 0 } });
  let cursor = before.data.cursor;
  for (let batch = 0; batch < 3; batch++) {
    const notes = Array.from({ length: 200 }, (_, i) => note(`bulk-${batch}-${i}`, 5000, 'x'));
    const r = await call('/api/sync', { method: 'POST', body: { cursor: 999999, notes } });
    assert.equal(r.status, 200);
  }
  const p1 = await call('/api/sync', { method: 'POST', body: { cursor } });
  assert.equal(p1.data.notes.length, 500);
  assert.equal(p1.data.hasMore, true);
  const p2 = await call('/api/sync', { method: 'POST', body: { cursor: p1.data.cursor } });
  assert.equal(p2.data.notes.length, 100);
  assert.equal(p2.data.hasMore, false);
});

test('rejects oversized pushes', { skip: !DB }, async () => {
  const notes = Array.from({ length: 201 }, (_, i) => note(`big-${i}`, 1, 'x'));
  assert.equal((await call('/api/sync', { method: 'POST', body: { notes } })).status, 413);
});

test('health reports configuration and counts when authorized', { skip: !DB }, async () => {
  const anon = await call('/api/health', { token: null });
  assert.equal(anon.data.tokenConfigured, true);
  assert.equal(anon.data.database, undefined);
  const authed = await call('/api/health');
  assert.equal(authed.data.database.reachable, true);
  assert.ok(authed.data.database.notes >= 602);
});

test('backup commits markdown to GitHub and skips unchanged trees', { skip: !DB }, async () => {
  const { createHash } = await import('node:crypto');
  process.env.GITHUB_BACKUP_TOKEN = 'gh-test';
  process.env.GITHUB_BACKUP_REPO = 'me/notes';
  const realFetch = globalThis.fetch;
  const commits = { c0: { tree: 'empty' } };
  let head = 'c0';
  let commitCount = 0;
  globalThis.fetch = async (url, opts = {}) => {
    if (!String(url).startsWith('https://api.github.com')) return realFetch(url, opts);
    const path = String(url).replace('https://api.github.com/repos/me/notes/git', '');
    const body = opts.body ? JSON.parse(opts.body) : null;
    const json = (status, data) => new Response(JSON.stringify(data), { status });
    if (path === '/ref/heads/main') return json(200, { object: { sha: head } });
    if (path.startsWith('/commits/')) return json(200, { tree: { sha: commits[path.slice(9)].tree } });
    if (path === '/trees') {
      return json(201, { sha: createHash('sha1').update(JSON.stringify(body.tree)).digest('hex') });
    }
    if (path === '/commits') {
      const sha = 'c' + ++commitCount;
      commits[sha] = { tree: body.tree, parents: body.parents };
      return json(201, { sha });
    }
    if (path === '/refs/heads/main' && opts.method === 'PATCH') {
      head = body.sha;
      return json(200, {});
    }
    return json(404, {});
  };
  try {
    assert.equal((await call('/api/backup', { token: null })).status, 401);

    const first = await call('/api/backup');
    assert.equal(first.status, 200);
    assert.equal(first.data.changed, true);
    assert.equal(head, 'c1');
    assert.deepEqual(commits.c1.parents, ['c0']);

    const second = await call('/api/backup');
    assert.equal(second.data.changed, false);
    assert.equal(head, 'c1');

    await call('/api/sync', { method: 'POST', body: { cursor: 0, notes: [note('n-new', 9e12, 'fresh note')] } });
    const third = await call('/api/backup');
    assert.equal(third.data.changed, true);
    assert.equal(head, 'c2');
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.GITHUB_BACKUP_TOKEN;
    delete process.env.GITHUB_BACKUP_REPO;
  }
});
