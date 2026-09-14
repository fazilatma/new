import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Locks in the production-branch pointers behind every environment. The
// Cloudflare Worker sat at 1.127 while the repo moved past 1.155 for one
// reason: deploy instructions named dead session branches instead of the
// branch the work actually lands on. The static pins ban those dead names
// from every deploy instruction; the dynamic pin resolves the checked-out
// git branch and requires the Cloudflare doc to name it.

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEPLOY_DOCS = ['CLOUDFLARE-WORKER.md', '.github/workflows/deploy-cloudflare.yml', 'deploy-setup/deploy-cloudflare.yml.txt'];
const DEAD_BRANCHES = ['arena/01a02198-code', 'arena/01a0765b-new', 'arena/01a0803e-new', 'arena/01a0813e-new'];

test('deploy pointers: no dead session branch in deploy instructions', () => {
  for (const rel of DEPLOY_DOCS) {
    const text = readFileSync(join(ROOT, rel), 'utf8');
    for (const dead of DEAD_BRANCHES) assert.ok(!text.includes(dead), `${rel} must not point at dead branch ${dead}`);
  }
});

test('deploy pointers: Cloudflare doc names the checked-out branch', () => {
  let branch = '';
  try {
    branch = execFileSync('git', ['-C', ROOT, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', timeout: 15000 }).trim();
  } catch { branch = ''; }
  if (!branch || branch === 'HEAD') {
    console.warn('deploy-branch: no git branch detected, skipping dynamic pin');
    return;
  }
  const doc = readFileSync(join(ROOT, 'CLOUDFLARE-WORKER.md'), 'utf8');
  assert.ok(doc.includes(branch), `CLOUDFLARE-WORKER.md must name the production branch ${branch}`);
});

test('deploy pointers: stale-deployment recovery is documented', () => {
  const doc = readFileSync(join(ROOT, 'CLOUDFLARE-WORKER.md'), 'utf8');
  for (const token of ['Production branch', 'Retry deployment', 'Rollback', '/api/version', 'package.json']) {
    assert.ok(doc.includes(token), `the recovery guide must mention ${token}`);
  }
});
