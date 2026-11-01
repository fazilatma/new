import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PREVIEW = __dirname;
const PORT = 8765;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  try {
    const rawUrl = req.url || '/';
    const u = new URL(rawUrl, 'http://127.0.0.1');
    // Mirror WP PHP proxy: /?amphp_sf=storefront.js
    if (u.searchParams.get('amphp_sf')) {
      const f = path.basename(u.searchParams.get('amphp_sf'));
      const candidates = [
        path.join(ROOT, 'asset/js/storefront', f),
        path.join(ROOT, 'includes/storefront', f),
      ];
      const hit = candidates.find((c) => fs.existsSync(c));
      if (!hit) { res.writeHead(404); res.end('missing '+f); return; }
      const ext = path.extname(hit).toLowerCase();
      res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(hit).pipe(res);
      return;
    }

    let urlPath = decodeURIComponent(u.pathname);
    if (urlPath === '/') urlPath = '/index.html';

    let filePath;
    if (urlPath.startsWith('/asset/')) {
      filePath = path.join(ROOT, urlPath);
    } else {
      filePath = path.join(PREVIEW, urlPath);
    }

    // prevent escape
    if (!filePath.startsWith(ROOT) && !filePath.startsWith(PREVIEW)) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404); res.end('not found: ' + urlPath); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': mime[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (e) {
    res.writeHead(500); res.end(String(e));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`AMPHP preview http://0.0.0.0:${PORT}/`);
});
