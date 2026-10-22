// Test server: serves the repo at /tier-ranker/ like GitHub Pages behind the
// thorsteingames.com proxy, but ONLY the files pages.yml copies into _site.
// A file the page needs but the deploy forgets therefore 404s in tests too.
import { createServer } from 'node:http';
import { readFileSync, statSync, createReadStream } from 'node:fs';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 4317;
const BASE = '/tier-ranker';

export function deployedEntries() {
  const yml = readFileSync(join(ROOT, '.github/workflows/pages.yml'), 'utf8');
  const m = yml.match(/\bcp -r (.+?) _site\/?/);
  if (!m) throw new Error('No "cp -r … _site/" line in pages.yml');
  return m[1].trim().split(/\s+/);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json',
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const entries = deployedEntries();
  createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === BASE || path === `${BASE}/`) return send(res, 'index.html');
    if (!path.startsWith(`${BASE}/`)) return notFound(res);
    const rel = normalize(path.slice(BASE.length + 1));
    if (rel.startsWith('..') || !entries.some((e) => rel === e || rel.startsWith(e + sep))) return notFound(res);
    send(res, rel);
  }).listen(PORT, () => console.log(`Serving deployed files at http://localhost:${PORT}${BASE}/`));
}

function send(res, rel) {
  const file = join(ROOT, rel);
  try {
    if (!statSync(file).isFile()) return notFound(res);
  } catch {
    return notFound(res);
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
}

function notFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Not found');
}
