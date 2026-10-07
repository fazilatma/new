#!/usr/bin/env node
// esbuild-check.mjs
// ---------------------------------------------------------------------------
// Verifies that esbuild is present and usable on this machine, and repairs it
// automatically when it is missing or broken. Prints one short line and exits
// with code 0 on success or 1 on failure so it can be chained safely in
// PowerShell / Command Prompt / bash:
//   node scripts/esbuild-check.mjs || npm install esbuild --no-audit
// ---------------------------------------------------------------------------
import { loadEsbuild } from './esbuild-loader.mjs';

try {
  const module = await loadEsbuild();
  const version = module.version || '?';
  console.log(`esbuild OK: v${version} (${process.platform}-${process.arch})`);
  process.exit(0);
} catch (error) {
  console.error(String(error && error.message ? error.message : error));
  process.exit(1);
}
