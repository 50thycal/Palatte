/**
 * Local dev server that mimics Vercel: static files from the repo root and
 * /api/<name> routed to api/<name>.js default-export handlers.
 *
 *   DATABASE_URL=postgres://... PALATE_TOKEN=dev npm run dev
 */

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT || 3000);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png'
};

async function serveApi(req, res, name) {
  if (!/^[a-z0-9-]+$/.test(name)) {
    res.statusCode = 404;
    return res.end('not found');
  }
  try {
    const mod = await import(pathToFileURL(join(root, 'api', `${name}.js`)).href);
    await mod.default(req, res);
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND') {
      res.statusCode = 404;
      return res.end('not found');
    }
    console.error(err);
    res.statusCode = 500;
    res.end('error');
  }
}

async function serveStatic(req, res, pathname) {
  let filePath = normalize(join(root, decodeURIComponent(pathname)));
  if (!filePath.startsWith(root) || filePath.includes('node_modules') || filePath.includes('/.')) {
    res.statusCode = 403;
    return res.end('forbidden');
  }
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) filePath = join(filePath, 'index.html');
    const data = await readFile(filePath);
    res.setHeader('Content-Type', TYPES[extname(filePath)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
}

http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const api = pathname.match(/^\/api\/([^/]+)\/?$/);
  if (api) return serveApi(req, res, api[1]);
  return serveStatic(req, res, pathname);
}).listen(port, () => {
  console.log(`Palate dev server on http://localhost:${port}`);
});
