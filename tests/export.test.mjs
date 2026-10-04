import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMarkdownFiles, notePath, slugify } from '../js/markdown.js';
import { createZip } from '../js/zip.js';

const notes = [
  { id: 'n1', projectId: 'p1', title: 'Pricing: v2 / ideas', body: 'Per seat #pricing', pinned: true, createdAt: 0, updatedAt: 1000, deletedAt: null },
  { id: 'n2', projectId: null, title: 'Café notes', body: 'résumé', pinned: false, createdAt: 0, updatedAt: 0, deletedAt: null },
  { id: 'n3', projectId: null, title: 'gone', body: 'x', pinned: false, createdAt: 0, updatedAt: 0, deletedAt: 5 }
];
const projects = [{ id: 'p1', name: 'Work Stuff', deletedAt: null }];
const tags = (t) => [...t.matchAll(/#(\w+)/g)].map((m) => m[1]);

test('slugs and paths are filesystem safe', () => {
  assert.equal(slugify('Pricing: v2 / ideas'), 'pricing-v2-ideas');
  assert.equal(slugify('Café'), 'cafe');
  assert.equal(slugify('!!!'), 'untitled');
  assert.equal(notePath(notes[0], 'Work Stuff'), 'projects/work-stuff/pricing-v2-ideas--n1.md');
  assert.equal(notePath(notes[1], null), 'inbox/cafe-notes--n2.md');
});

test('markdown files carry front matter and skip deleted notes', () => {
  const files = buildMarkdownFiles(notes, projects, tags);
  assert.deepEqual(files.map((f) => f.path), [
    'README.md', 'inbox/cafe-notes--n2.md', 'projects/work-stuff/pricing-v2-ideas--n1.md'
  ]);
  const md = files[2].content;
  assert.match(md, /^---\nid: "n1"\ntitle: "Pricing: v2 \/ ideas"\nproject: "Work Stuff"\ntags: \["pricing"\]\npinned: true\n/);
  assert.match(md, /---\n\nPer seat #pricing\n$/);
});

test('zip archive is valid and round-trips UTF-8 content', (t) => {
  let hasUnzip = true;
  try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); } catch { hasUnzip = false; }
  if (!hasUnzip) return t.skip('unzip not installed');
  return createZip(buildMarkdownFiles(notes, projects, tags)).arrayBuffer().then((buf) => {
    const dir = mkdtempSync(join(tmpdir(), 'palate-'));
    const file = join(dir, 'notes.zip');
    writeFileSync(file, Buffer.from(buf));
    execFileSync('unzip', ['-tq', file]);
    const out = execFileSync('unzip', ['-p', file, 'inbox/cafe-notes--n2.md']).toString();
    assert.match(out, /résumé/);
  });
});
