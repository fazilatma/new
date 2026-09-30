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
 *   node tools/phprun.mjs tools/tests/routing.php tools/tests/requests.php
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
import fs from 'fs';
import path from 'path';

const scripts = process.argv.slice(2);
if (!scripts.length) {
  console.error('usage: node tools/phprun.mjs <script.php> [more.php ...]');
  process.exit(2);
}

const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const rt = await loadNodeRuntime('8.3', { emscriptenOptions: { processId: 1 } });
const php = new PHP(rt);

php.mkdir('/app');
await php.mount('/app', createNodeFsMountHandler(appRoot));
php.chdir('/app');

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
