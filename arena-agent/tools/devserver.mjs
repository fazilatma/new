#!/usr/bin/env node
/**
 * Development web server for Arena Agent.
 *
 * There is no PHP binary in this sandbox, so this serves the application by
 * running the real public/index.php inside the PHP 8.3 WebAssembly runtime,
 * one request at a time. It is a development aid only — on a real host the
 * app is served by the host's own PHP.
 *
 *   node tools/devserver.mjs [port]
 *
 * Requires the dependencies installed in ../agent-php/tools (php-wasm).
 */
import http from 'http';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

const here = path.dirname(new URL(import.meta.url).pathname);
const appRoot = path.resolve(here, '..');
const port = Number(process.argv[2] || 3000);

// php-wasm lives in the sibling project's tools directory.
const shared = path.resolve(appRoot, '../agent-php/tools/node_modules');
if (!fs.existsSync(shared)) {
  console.error('php-wasm not found. Run:  cd ../agent-php/tools && npm install');
  process.exit(1);
}
const require_ = createRequire(path.join(shared, 'index.js'));
const { loadNodeRuntime, createNodeFsMountHandler } = require_('@php-wasm/node');
const { PHP } = require_('@php-wasm/universal');

const rt = await loadNodeRuntime('8.3', { emscriptenOptions: { processId: 1 } });
const php = new PHP(rt);
php.mkdir('/app');
await php.mount('/app', createNodeFsMountHandler(appRoot));
php.chdir('/app');

// Writable state lives outside the mount so the host filesystem stays clean.
php.mkdirTree('/state/data');
php.mkdirTree('/state/storage');

const TEXT = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
};

let busy = Promise.resolve();

http.createServer((req, res) => {
  // The runtime is single-threaded; serialise requests onto it.
  busy = busy.then(() => handle(req, res)).catch((e) => {
    console.error(e);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('dev server error: ' + e.message);
  });
}).listen(port, '0.0.0.0', () => {
  console.log(`Arena Agent dev server on http://0.0.0.0:${port}`);
  console.log('running real PHP 8.3 (wasm) against ' + appRoot);
});

async function handle(req, res) {
  const body = await readBody(req);
  const url = new URL(req.url, 'http://localhost');

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
  }

  const result = await php.run({
    scriptPath: '/app/public/index.php',
    // relativeUri is what makes the runtime populate $_GET from the query
    // string; passing QUERY_STRING in $_SERVER alone is not enough.
    relativeUri: url.pathname + url.search,
    protocol: 'http',
    method: req.method,
    headers,
    body: body.length ? new Uint8Array(body) : undefined,
    $_SERVER: {
      REQUEST_URI: url.pathname + url.search,
      REQUEST_METHOD: req.method,
      QUERY_STRING: url.search.replace(/^\?/, ''),
      SCRIPT_NAME: '/index.php',
      SCRIPT_FILENAME: '/app/public/index.php',
      DOCUMENT_ROOT: '/app/public',
      HTTP_HOST: headers.host || `localhost:${port}`,
      SERVER_PROTOCOL: 'HTTP/1.1',
      CONTENT_TYPE: headers['content-type'] || '',
      CONTENT_LENGTH: String(body.length),
      HTTP_COOKIE: headers.cookie || '',
      HTTP_AUTHORIZATION: headers.authorization || '',
    },
    env: {
      ARENA_DATA_DIR: '/state/data',
      ARENA_STORAGE_DIR: '/state/storage',
      ARENA_AUTH: 'false',        // the preview signs you straight in
      ARENA_SHELL: 'false',
    },
  });

  const out = {};
  for (const [k, v] of Object.entries(result.headers || {})) {
    out[k] = Array.isArray(v) ? v.join(', ') : v;
  }
  if (!out['content-type'] && !out['Content-Type']) {
    out['Content-Type'] = TEXT[path.extname(url.pathname)] || 'text/html; charset=utf-8';
  }
  res.writeHead(result.httpStatusCode || 200, out);
  res.end(Buffer.from(result.bytes));
  console.log(`${req.method} ${url.pathname}${url.search} -> ${result.httpStatusCode}`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
