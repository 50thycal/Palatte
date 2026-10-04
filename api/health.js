/**
 * GET /api/health
 * Reports which pieces of server configuration are present (no secrets).
 * With a valid token it also verifies the database connection.
 */

import { isAuthorized, send } from './_lib/http.js';
import { getSql, ensureSchema, databaseUrl } from './_lib/db.js';

export default async function handler(req, res) {
  const token = process.env.PALATE_TOKEN;
  const status = {
    ok: true,
    tokenConfigured: Boolean(token),
    databaseConfigured: Boolean(databaseUrl()),
    backupConfigured: Boolean(process.env.GITHUB_BACKUP_TOKEN && process.env.GITHUB_BACKUP_REPO)
  };

  if (token && isAuthorized(req, [token])) {
    status.authorized = true;
    const sql = getSql();
    if (sql) {
      try {
        await ensureSchema(sql);
        const [row] = await sql`
          select (select count(*) from notes where deleted_at is null)::int as notes,
                 (select count(*) from projects where deleted_at is null)::int as projects`;
        status.database = { reachable: true, ...row };
      } catch (err) {
        console.error('[health]', err);
        status.database = { reachable: false };
      }
    }
  }

  return send(res, 200, status);
}
