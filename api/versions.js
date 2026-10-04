/**
 * GET /api/versions?noteId=...
 * Server-side version history for one note (newest first).
 */

import { authedDb, send } from './_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return send(res, 405, { error: 'method_not_allowed' });
  }

  const url = new URL(req.url, 'http://localhost');
  const noteId = url.searchParams.get('noteId');
  if (!noteId) return send(res, 400, { error: 'noteId_required' });

  try {
    const sql = await authedDb(req, res);
    if (!sql) return;

    const rows = await sql`
      select id, title, body, saved_at, captured_at, reason
      from note_versions where note_id = ${noteId}
      order by id desc limit 200`;

    return send(res, 200, {
      versions: rows.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        savedAt: r.saved_at,
        capturedAt: r.captured_at,
        reason: r.reason
      }))
    });
  } catch (err) {
    console.error('[versions]', err);
    return send(res, 500, { error: 'server_error' });
  }
}
