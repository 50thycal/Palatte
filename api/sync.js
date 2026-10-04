/**
 * POST /api/sync
 *
 * Body:     { cursor, projects: [...], notes: [...] }
 * Response: { cursor, hasMore, projects: [...], notes: [...], applied, conflicts }
 *
 * Each pushed record is applied last-write-wins on updatedAt. Every accepted
 * write takes the next value of palate_seq; the pull half returns everything
 * with seq > cursor. The whole request runs under one advisory lock so
 * sequence order always matches commit order (no skipped rows on pull).
 *
 * Nothing is lost on conflict: the losing note body goes to note_versions.
 */

import { authedDb, send, readJson } from './_lib/http.js';
import { projectFromRow, noteFromRow } from './_lib/db.js';

const PULL_LIMIT = 500;
const MAX_PUSH = 200;
const VERSION_INTERVAL_MS = 10 * 60 * 1000;
const MAX_BODY_CHARS = 1_000_000;

function num(v, fallback = null) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function cleanProject(p) {
  if (!p || typeof p.id !== 'string' || !p.id || p.id.length > 64) return null;
  const now = Date.now();
  return {
    id: p.id,
    name: String(p.name ?? '').slice(0, 200) || 'Untitled',
    createdAt: num(p.createdAt, now),
    updatedAt: num(p.updatedAt, now),
    deletedAt: num(p.deletedAt, null)
  };
}

function cleanNote(n) {
  if (!n || typeof n.id !== 'string' || !n.id || n.id.length > 64) return null;
  const now = Date.now();
  return {
    id: n.id,
    projectId: typeof n.projectId === 'string' ? n.projectId : null,
    title: String(n.title ?? '').slice(0, 500),
    body: String(n.body ?? '').slice(0, MAX_BODY_CHARS),
    pinned: Boolean(n.pinned),
    createdAt: num(n.createdAt, now),
    updatedAt: num(n.updatedAt, now),
    deletedAt: num(n.deletedAt, null)
  };
}

async function applyProject(tx, p) {
  const rows = await tx`
    insert into projects (id, name, created_at, updated_at, deleted_at, seq)
    values (${p.id}, ${p.name}, ${p.createdAt}, ${p.updatedAt}, ${p.deletedAt}, nextval('palate_seq'))
    on conflict (id) do update set
      name = excluded.name,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at,
      seq = nextval('palate_seq')
    where projects.updated_at < excluded.updated_at
    returning seq`;
  return rows.length ? rows[0].seq : null;
}

async function applyNote(tx, n) {
  const [existing] = await tx`
    select id, title, body, updated_at from notes where id = ${n.id} for update`;

  if (existing && existing.updated_at >= n.updatedAt) {
    // Server copy wins. Keep the losing edit if its content differs.
    if (existing.body !== n.body || existing.title !== n.title) {
      await tx`
        insert into note_versions (note_id, title, body, saved_at, captured_at, reason)
        values (${n.id}, ${n.title}, ${n.body}, ${n.updatedAt}, ${Date.now()}, 'conflict')`;
    }
    return null;
  }

  if (existing && (existing.body !== n.body || existing.title !== n.title)) {
    const [recent] = await tx`
      select captured_at from note_versions
      where note_id = ${n.id} and reason = 'edit'
      order by id desc limit 1`;
    if (!recent || Date.now() - recent.captured_at >= VERSION_INTERVAL_MS) {
      await tx`
        insert into note_versions (note_id, title, body, saved_at, captured_at, reason)
        values (${n.id}, ${existing.title}, ${existing.body}, ${existing.updated_at}, ${Date.now()}, 'edit')`;
    }
  }

  const [row] = await tx`
    insert into notes (id, project_id, title, body, pinned, created_at, updated_at, deleted_at, seq)
    values (${n.id}, ${n.projectId}, ${n.title}, ${n.body}, ${n.pinned},
            ${n.createdAt}, ${n.updatedAt}, ${n.deletedAt}, nextval('palate_seq'))
    on conflict (id) do update set
      project_id = excluded.project_id,
      title = excluded.title,
      body = excluded.body,
      pinned = excluded.pinned,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at,
      seq = nextval('palate_seq')
    returning seq`;
  return row.seq;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'method_not_allowed' });
  }

  let body;
  try {
    body = await readJson(req);
  } catch {
    return send(res, 400, { error: 'invalid_json' });
  }

  try {
    const sql = await authedDb(req, res);
    if (!sql) return;

    const cursor = Math.max(0, num(body.cursor, 0));
    const pushProjects = (Array.isArray(body.projects) ? body.projects : []).map(cleanProject).filter(Boolean);
    const pushNotes = (Array.isArray(body.notes) ? body.notes : []).map(cleanNote).filter(Boolean);

    if (pushProjects.length + pushNotes.length > MAX_PUSH) {
      return send(res, 413, { error: 'too_many_records', max: MAX_PUSH });
    }

    const result = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(7462)`;

      const applied = { projects: {}, notes: {} };
      const conflicts = { projects: [], notes: [] };

      for (const p of pushProjects) {
        const seq = await applyProject(tx, p);
        if (seq !== null) applied.projects[p.id] = seq;
        else conflicts.projects.push(p.id);
      }
      for (const n of pushNotes) {
        const seq = await applyNote(tx, n);
        if (seq !== null) applied.notes[n.id] = seq;
        else conflicts.notes.push(n.id);
      }

      const projectRows = await tx`
        select * from projects where seq > ${cursor} order by seq limit ${PULL_LIMIT + 1}`;
      const noteRows = await tx`
        select id, project_id, title, body, pinned, created_at, updated_at, deleted_at, seq
        from notes where seq > ${cursor} order by seq limit ${PULL_LIMIT + 1}`;

      // Merge both tables in sequence order and cut at the page size
      const merged = [
        ...projectRows.map((r) => ({ kind: 'projects', seq: r.seq, rec: projectFromRow(r) })),
        ...noteRows.map((r) => ({ kind: 'notes', seq: r.seq, rec: noteFromRow(r) }))
      ].sort((a, b) => a.seq - b.seq);

      const page = merged.slice(0, PULL_LIMIT);
      const hasMore = merged.length > PULL_LIMIT;
      const nextCursor = page.length ? page[page.length - 1].seq : cursor;

      // Records the client lost on: send the server copy even if outside the page
      const pageIds = new Set(page.map((e) => e.rec.id));
      const extraProjects = conflicts.projects.length
        ? (await tx`select * from projects where id in ${tx(conflicts.projects)}`)
            .filter((r) => !pageIds.has(r.id)).map(projectFromRow)
        : [];
      const extraNotes = conflicts.notes.length
        ? (await tx`
            select id, project_id, title, body, pinned, created_at, updated_at, deleted_at, seq
            from notes where id in ${tx(conflicts.notes)}`)
            .filter((r) => !pageIds.has(r.id)).map(noteFromRow)
        : [];

      return {
        cursor: nextCursor,
        hasMore,
        projects: [...page.filter((e) => e.kind === 'projects').map((e) => e.rec), ...extraProjects],
        notes: [...page.filter((e) => e.kind === 'notes').map((e) => e.rec), ...extraNotes],
        applied,
        conflicts
      };
    });

    return send(res, 200, result);
  } catch (err) {
    console.error('[sync]', err);
    return send(res, 500, { error: 'server_error' });
  }
}
