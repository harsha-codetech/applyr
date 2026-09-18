/**
 * Static file server for the fixtures.
 *
 * Content scripts do not run on file:// URLs unless the user ticks "Allow access
 * to file URLs", so the fixtures are served over HTTP instead - which also
 * matches how the real boards behave.
 *
 *   npm run serve   ->  http://localhost:5173/fixtures/
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let rel = url === '/' ? '/fixtures/index.html' : url;
  if (rel.endsWith('/')) rel += 'index.html';

  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      // Dev-only: lets the engine be imported into a live page for read-only
      // selector checks (see tests/MANUAL.md). Never used by the extension.
      'access-control-allow-origin': '*'
    });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`fixtures: http://localhost:${PORT}/fixtures/`);
});
