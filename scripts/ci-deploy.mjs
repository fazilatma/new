#!/usr/bin/env node
/* دیپلوی خودکار CI: بیلد ← ساخت D1 (اگر نباشد) ← تزریق database_id ← دیپلوی */
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const DB_NAME = 'hesabdar-db';
const run = (cmd) => execSync(cmd, { stdio: 'pipe', encoding: 'utf8' });

if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
  console.error('❌ Missing secrets: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID');
  process.exit(1);
}

console.log('▸ building...');
run('npm run build');

function findDbId() {
  const out = run('npx wrangler d1 list 2>&1');
  for (const line of out.split('\n')) {
    if (line.includes(DB_NAME)) {
      const m = line.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      if (m) return m[0];
    }
  }
  return null;
}

console.log('▸ checking D1 database...');
let id = null;
try {
  id = findDbId();
  if (id) console.log('  database exists:', id);
} catch (e) {
  console.log('  list failed, will try creating...');
}
if (!id) {
  console.log('  creating D1 database...');
  run(`npx wrangler d1 create ${DB_NAME}`);
  id = findDbId();
  if (!id) throw new Error('Could not determine database_id after create');
  console.log('  created:', id);
}

console.log('▸ patching wrangler.toml...');
let toml = fs.readFileSync('wrangler.toml', 'utf8');
const block = `[[d1_databases]]\nbinding = "DB"\ndatabase_name = "${DB_NAME}"\ndatabase_id = "${id}"`;
const commented = `# [[d1_databases]]\n# binding = "DB"\n# database_name = "hesabdar-db"\n# database_id = "PASTE_YOUR_DATABASE_ID_HERE"`;
if (toml.includes(commented)) {
  toml = toml.replace(commented, block);
} else if (/^\[\[d1_databases\]\]/m.test(toml)) {
  toml = toml.replace(/database_id\s*=\s*"[^"]*"/, `database_id = "${id}"`);
} else {
  throw new Error('D1 block template not found in wrangler.toml');
}
if (!toml.includes(`database_id = "${id}"`)) throw new Error('Failed to patch wrangler.toml');
fs.writeFileSync('wrangler.toml', toml);

console.log('▸ deploying...');
execSync('npx wrangler deploy', { stdio: 'inherit' });
console.log('✅ deployed with D1:', id);
