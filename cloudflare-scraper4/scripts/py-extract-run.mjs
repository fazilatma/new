#!/usr/bin/env node
// 1.143.0 — Node wrapper around scripts/py-auto-extract.py (the Termux CLI
// that extracts products with NO manual selectors: structural parsing plus
// auto-discovery, with native XPath support). The local deployer UI calls
// this for its "Python extract" tab; worker-tests/deployer-py.test.mjs
// exercises it against fixtures. Input validation runs BEFORE any spawn so
// bad input fails fast with a fixable message even when Python is missing.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** First working interpreter: `python3` (Termux/macOS/Linux), else `python` (Windows). */
export function resolvePythonBin(bins = ['python3', 'python']) {
  for (const bin of bins) {
    try {
      const probed = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 15000 });
      if (probed.status === 0) return bin;
    } catch { /* try the next name */ }
  }
  return '';
}

export function pyStatus(projectDir, bins) {
  const bin = resolvePythonBin(bins);
  const script = join(String(projectDir || ''), 'scripts', 'py-auto-extract.py');
  const status = { ok: false, python: bin, version: '', hasBs4: false, hasLxml: false, hasRequests: false, scriptExists: existsSync(script) };
  if (!bin) return status;
  try {
    const probed = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 15000 });
    status.version = String(probed.stdout || probed.stderr || '').trim().split(/\s+/).pop() || '';
    // find_spec reports importability WITHOUT importing (fast, side-effect free).
    const deps = spawnSync(bin, ['-c', 'import importlib.util as u;print(",".join(m for m in ("bs4","lxml","requests") if u.find_spec(m)))'], { encoding: 'utf8', timeout: 15000 });
    const found = new Set(String(deps.stdout || '').trim().split(',').filter(Boolean));
    status.hasBs4 = found.has('bs4');
    status.hasLxml = found.has('lxml');
    status.hasRequests = found.has('requests');
    status.ok = status.scriptExists && status.hasBs4;
  } catch { /* partial status (python seen, probe failed) is still useful */ }
  return status;
}

export function pyExtract({ projectDir, url = '', htmlFile = '', base = '', selectors = '', timeoutMs = 120000, limit = 500, bins } = {}) {
  const script = join(String(projectDir || ''), 'scripts', 'py-auto-extract.py');
  // Inputs first: a bad URL/selectors string is the caller's bug and must be
  // reported as such even on a box without Python installed.
  const target = String(url || '').trim();
  const file = String(htmlFile || '').trim();
  if (file) {
    if (!existsSync(file)) return { ok: false, error: `HTML file not found: ${file}` };
  } else {
    if (!/^https?:\/\/.+/i.test(target)) return { ok: false, error: 'Give an http(s) URL (or an HTML file).' };
    if (target.length > 2000) return { ok: false, error: 'URL is too long (2000 chars max).' };
  }
  let selectorArg = '';
  if (String(selectors || '').trim()) {
    try {
      const parsed = JSON.parse(selectors);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      selectorArg = JSON.stringify(parsed);
    } catch { return { ok: false, error: 'Explicit selectors must be a JSON object.' }; }
  }
  if (!existsSync(script)) return { ok: false, error: 'py-auto-extract.py is missing from scripts/.' };
  const bin = resolvePythonBin(bins);
  if (!bin) return { ok: false, error: 'No python3/python interpreter found. Install Python first.' };
  const args = [script];
  if (file) args.push('--html-file', file);
  else args.push(target);
  if (String(base || '').trim()) args.push('--base', String(base).trim());
  if (selectorArg) args.push('--selectors', selectorArg);
  args.push('--json');
  const started = Date.now();
  let run;
  try {
    run = spawnSync(bin, args, { encoding: 'utf8', timeout: Math.max(5000, Math.min(300000, Number(timeoutMs) || 120000)), maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    return { ok: false, error: `Python spawn failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  const elapsedMs = Date.now() - started;
  if (run.error) {
    const timedOut = String(run.error.code || '').includes('TIMEDOUT');
    return { ok: false, error: timedOut ? `Python extraction timed out after ${elapsedMs}ms.` : `Python spawn failed: ${run.error.message}`, elapsedMs };
  }
  if (run.status !== 0) {
    const detail = String(run.stderr || '').trim().split('\n').pop() || `Python exited with code ${run.status}`;
    return { ok: false, error: detail.slice(0, 500), exitCode: run.status, elapsedMs };
  }
  let out;
  try {
    out = JSON.parse(String(run.stdout || ''));
  } catch {
    return { ok: false, error: 'Python printed invalid JSON.', elapsedMs };
  }
  const products = Array.isArray(out.products) ? out.products : [];
  const capped = products.slice(0, Math.max(1, Number(limit) || 500));
  return { ok: true, products: capped, total: products.length, truncated: products.length > capped.length, diag: out.diag || {}, discovered: out.discovered || {}, source: out.source || target || file, elapsedMs };
}
