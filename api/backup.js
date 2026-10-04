/**
 * GET /api/backup — nightly Vercel Cron job (also callable manually)
 *
 * Writes every live note as a Markdown file into a private GitHub repo and
 * commits the result. The tree is rebuilt from scratch each run, so deleted
 * notes disappear from the latest commit but remain in git history.
 *
 * Env: GITHUB_BACKUP_TOKEN (contents:write), GITHUB_BACKUP_REPO (owner/repo),
 *      GITHUB_BACKUP_BRANCH (default "main"), CRON_SECRET (set by Vercel Cron).
 */

import { isAuthorized, send } from './_lib/http.js';
import { getSql, ensureSchema, noteFromRow, projectFromRow } from './_lib/db.js';
import { buildMarkdownFiles } from '../js/markdown.js';

const TAG_RE = /(^|[\s(])#([A-Za-z][\w-]{0,40})/g;

function extractTags(text) {
  const tags = new Set();
  for (const m of (text || '').matchAll(TAG_RE)) tags.add(m[2].toLowerCase());
  return [...tags];
}

async function gh(path, { method = 'GET', body } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_BACKUP_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'palate-backup',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, data };
}

export default async function handler(req, res) {
  if (!isAuthorized(req, [process.env.CRON_SECRET, process.env.PALATE_TOKEN])) {
    return send(res, 401, { error: 'unauthorized' });
  }

  const repo = process.env.GITHUB_BACKUP_REPO;
  const branch = process.env.GITHUB_BACKUP_BRANCH || 'main';
  if (!repo || !process.env.GITHUB_BACKUP_TOKEN) {
    return send(res, 200, { skipped: true, reason: 'GITHUB_BACKUP_REPO / GITHUB_BACKUP_TOKEN not set' });
  }

  const sql = getSql();
  if (!sql) return send(res, 503, { error: 'no_database' });

  try {
    await ensureSchema(sql);
    const notes = (await sql`
      select id, project_id, title, body, pinned, created_at, updated_at, deleted_at, seq
      from notes where deleted_at is null`).map(noteFromRow);
    const projects = (await sql`select * from projects`).map(projectFromRow);
    const files = buildMarkdownFiles(notes, projects, extractTags);

    // Current head (absent for an empty repo)
    const ref = await gh(`/repos/${repo}/git/ref/heads/${branch}`);
    let parentSha = null;
    let parentTree = null;
    if (ref.status === 200) {
      parentSha = ref.data.object.sha;
      const commit = await gh(`/repos/${repo}/git/commits/${parentSha}`);
      parentTree = commit.data?.tree?.sha || null;
    } else if (ref.status !== 404 && ref.status !== 409) {
      return send(res, 502, { error: 'github_ref_failed', status: ref.status });
    }

    const tree = await gh(`/repos/${repo}/git/trees`, {
      method: 'POST',
      body: {
        tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content }))
      }
    });
    if (tree.status !== 201) {
      return send(res, 502, {
        error: 'github_tree_failed',
        status: tree.status,
        hint: tree.status === 409 ? 'The backup repo is empty: create it with a README first' : undefined
      });
    }

    if (tree.data.sha === parentTree) {
      return send(res, 200, { ok: true, changed: false, files: files.length });
    }

    const commit = await gh(`/repos/${repo}/git/commits`, {
      method: 'POST',
      body: {
        message: `Palate backup ${new Date().toISOString().slice(0, 10)} (${files.length - 1} notes)`,
        tree: tree.data.sha,
        parents: parentSha ? [parentSha] : []
      }
    });
    if (commit.status !== 201) {
      return send(res, 502, { error: 'github_commit_failed', status: commit.status });
    }

    const update = parentSha
      ? await gh(`/repos/${repo}/git/refs/heads/${branch}`, {
          method: 'PATCH',
          body: { sha: commit.data.sha }
        })
      : await gh(`/repos/${repo}/git/refs`, {
          method: 'POST',
          body: { ref: `refs/heads/${branch}`, sha: commit.data.sha }
        });
    if (update.status !== 200 && update.status !== 201) {
      return send(res, 502, { error: 'github_ref_update_failed', status: update.status });
    }

    return send(res, 200, { ok: true, changed: true, files: files.length, commit: commit.data.sha });
  } catch (err) {
    console.error('[backup]', err);
    return send(res, 500, { error: 'server_error' });
  }
}
