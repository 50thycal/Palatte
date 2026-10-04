import { timingSafeEqual, createHash } from 'node:crypto';
import { getSql, ensureSchema } from './db.js';

function digest(value) {
  return createHash('sha256').update(String(value)).digest();
}

/**
 * Constant-time comparison of the bearer token against any of the allowed secrets
 */
export function isAuthorized(req, secrets) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const given = digest(match[1].trim());
  return secrets.filter(Boolean).some((s) => timingSafeEqual(given, digest(s)));
}

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export async function readJson(req) {
  if (req.body !== undefined && req.body !== null) {
    return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

/**
 * Shared preamble: auth check + database availability + schema.
 * Returns the sql client, or null after sending an error response.
 */
export async function authedDb(req, res) {
  const token = process.env.PALATE_TOKEN;
  if (!token) {
    send(res, 503, { error: 'not_configured', message: 'PALATE_TOKEN is not set on the server' });
    return null;
  }
  if (!isAuthorized(req, [token])) {
    send(res, 401, { error: 'unauthorized' });
    return null;
  }
  const sql = getSql();
  if (!sql) {
    send(res, 503, { error: 'no_database', message: 'DATABASE_URL is not set on the server' });
    return null;
  }
  await ensureSchema(sql);
  return sql;
}
