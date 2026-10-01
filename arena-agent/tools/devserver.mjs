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
 * State lives in .devstate/ on the *host*, not inside the wasm filesystem, so
 * that the real git binary can operate on the preview's workspace. PHP's
 * proc_open is wired to Node's child_process for the same reason: without it
 * the wasm build throws on any attempt to spawn, which takes the server down.
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
const { createSpawnHandler } = require_('@php-wasm/util');
const { spawn } = require_('child_process');

const rt = await loadNodeRuntime('8.3', { emscriptenOptions: { processId: 1 } });
const php = new PHP(rt);
php.mkdir('/app');
await php.mount('/app', createNodeFsMountHandler(appRoot));
php.chdir('/app');

/* Writable state is a real host directory. Keeping it in the wasm filesystem
   would be tidier, but then the workspace would be invisible to git. */
const stateRoot = path.join(appRoot, '.devstate');
for (const dir of ['data', 'storage/workspaces/default']) {
  fs.mkdirSync(path.join(stateRoot, dir), { recursive: true });
}
php.mkdir('/state');
await php.mount('/state', createNodeFsMountHandler(stateRoot));

/* Guest paths have to be translated before a host process can use them. */
const toHost = (p) => {
  const mapped = !p ? appRoot
    : p === '/app' ? appRoot
    : p.startsWith('/app/') ? path.join(appRoot, p.slice(5))
    : p === '/state' ? stateRoot
    : p.startsWith('/state/') ? path.join(stateRoot, p.slice(7))
    : p;
  return fs.existsSync(mapped) ? mapped : appRoot;
};

await php.setSpawnHandler(
  createSpawnHandler((command, api, options) => {
    const argv = Array.isArray(command) ? command : ['/bin/sh', '-c', String(command)];
    const env = { ...process.env, ...(options?.env || {}) };
    env.PATH = process.env.PATH;     // the guest's PATH means nothing out here

    return new Promise((resolve) => {
      let child;
      const finish = async (code) => {
        await new Promise((r) => setTimeout(r, 1));
        api.exit(code);
        resolve();
      };
      try {
        child = spawn(argv[0], argv.slice(1), { cwd: toHost(options?.cwd), env });
      } catch (e) {
        api.stderr(String(e.message) + '\n');
        return finish(127);
      }
      child.stdout.on('data', (d) => api.stdout(d));
      child.stderr.on('data', (d) => api.stderr(d));
      child.on('error', (e) => { api.stderr(String(e.message) + '\n'); finish(127); });
      child.on('close', (code) => finish(code ?? 0));
      api.on('stdin', (d) => child.stdin.write(d));
      api.on('stdinEnd', () => child.stdin.end());
      api.notifySpawn();
    });
  })
);

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
  console.log('state in ' + stateRoot + '  (delete it to start over)');
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
      ARENA_SHELL: 'true',        // real commands, via the spawn handler above
      ARENA_GIT: 'true',
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
