#!/usr/bin/env node
/**
 * Run real PHP against this codebase — no system PHP required.
 *
 * Uses the WordPress Playground PHP-8.3 WebAssembly build, which ships
 * openssl, pdo_sqlite, sqlite3, mbstring, json, zip and curl, so the
 * application actually boots and its routes can be exercised.
 *
 *   cd tools && npm install && cd ..
 *   node tools/phprun.mjs tools/tests/import.php
 *   node tools/phprun.mjs --root=../arena-agent ../arena-agent/tools/tests/smoke.php
 *   node tools/phprun.mjs tools/tests/routing.php tools/tests/requests.php
 *   node tools/phprun.mjs --root=../arena-agent --spawn ../arena-agent/tools/tests/git.php
 *
 * --spawn lets PHP's proc_open() start *real* host processes (git, node,
 * python) by handing them to Node's child_process. Without it the wasm build
 * refuses to spawn, which is the right default for a test runner; with it,
 * code that shells out can be exercised properly. It is opt-in because it
 * lets the script under test run arbitrary commands on this machine.
 *
 * The repository is mounted at /app and the working directory is /app, so
 * scripts should require '/app/app/Bootstrap.php'.
 *
 * Note: runtime start-up takes a couple of minutes (the wasm binary is large
 * and JSPI detection is slow). Pass every script you want to run in one
 * invocation — they share the same runtime, and each is a separate PHP
 * request with clean superglobals.
 */
import { loadNodeRuntime, createNodeFsMountHandler } from '@php-wasm/node';
import { PHP } from '@php-wasm/universal';
import { createSpawnHandler } from '@php-wasm/util';
import { spawn } from 'node:child_process';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
// --root lets the same runtime exercise a sibling project without a second
// (very large) node_modules install.
let rootFlag = null;
let allowSpawn = false;
const scripts = args.filter((a) => {
  const m = /^--root=(.+)$/.exec(a);
  if (m) { rootFlag = m[1]; return false; }
  if (a === '--spawn') { allowSpawn = true; return false; }
  return true;
});
if (!scripts.length) {
  console.error('usage: node tools/phprun.mjs <script.php> [more.php ...]');
  process.exit(2);
}

const appRoot = rootFlag
  ? path.resolve(rootFlag)
  : path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const rt = await loadNodeRuntime('8.3', { emscriptenOptions: { processId: 1 } });
const php = new PHP(rt);

php.mkdir('/app');
await php.mount('/app', createNodeFsMountHandler(appRoot));
php.chdir('/app');

if (allowSpawn) {
  /* Paths inside the guest are rooted at /app; the host sees them under
     appRoot. Anything else is passed through unchanged. */
  const toHost = (p) => {
    const mapped = !p ? appRoot
      : p === '/app' ? appRoot
      : p.startsWith('/app/') ? path.join(appRoot, p.slice(5))
      : p;
    /* A guest-only path (say /tmp, which is not mounted) has no host
       equivalent; running there would fail with a baffling ENOENT. */
    return fs.existsSync(mapped) ? mapped : appRoot;
  };

  await php.setSpawnHandler(
    createSpawnHandler((command, api, options) => {
      /* proc_open with an argument array arrives as an array; the string form
         arrives already wrapped in a shell invocation. */
      const argv = Array.isArray(command) ? command : ['/bin/sh', '-c', String(command)];
      /* The guest's PATH points at the wasm image's own bin directory, which
         does not exist out here. Keep whatever else the caller asked for, but
         let the host's PATH win, or nothing is findable. */
      const env = { ...process.env, ...(options?.env || {}) };
      env.PATH = [process.env.PATH, options?.env?.PATH].filter(Boolean).join(path.delimiter);

      const child = spawn(argv[0], argv.slice(1), { cwd: toHost(options?.cwd), env });

      /* The callback has to return a promise that settles only after the
         process is done, and exit() has to come a tick later — otherwise the
         runtime closes the pipes before PHP has read what was written. */
      return new Promise((resolve) => {
        const finish = async (code) => {
          await new Promise((r) => setTimeout(r, 1));
          api.exit(code);
          resolve();
        };
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
}

let failed = 0;
for (const sp of scripts) {
  php.writeFile('/tmp/_run.php', fs.readFileSync(sp, 'utf8'));
  const out = await php.runStream({ scriptPath: '/tmp/_run.php' });
  const stdout = await out.stdoutText;
  const stderr = await out.errors;
  process.stdout.write(stdout);
  if (stderr && String(stderr).trim()) {
    failed++;
    console.error(`--- STDERR (${sp}) ---\n${stderr}`);
  }
}
process.exit(failed ? 1 : 0);
