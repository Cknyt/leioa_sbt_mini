// Servidor estático mínimo para previsualizar public/ en local (http://localhost:8080).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.ics': 'text/calendar; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  let path;
  try { path = decodeURIComponent(new URL(req.url.replace(/^\/+/, '/'), 'http://x').pathname); }
  catch { res.writeHead(400).end(); return; }
  const file = normalize(join(PUBLIC, path.endsWith('/') ? `${path}index.html` : path));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('No encontrado');
  }
}).listen(8080, () => console.log('http://localhost:8080'));
