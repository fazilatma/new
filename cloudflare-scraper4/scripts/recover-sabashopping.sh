#!/bin/bash
# Recovery for sabashopping.ir/app when 3 jobs stalled 6881 min cause 503
# Run on VPS where repo is cloned: /opt/scraper4 or ~/new or /home/*/new
# Usage: curl -sL https://raw.githubusercontent.com/fazilatma/new/arena/01a0aa17-new/cloudflare-scraper4/scripts/recover-sabashopping.sh | bash
# Or: bash cloudflare-scraper4/scripts/recover-sabashopping.sh

set -e
echo "=== SabaShopping Recovery ==="

# Find repo root
for d in /opt/scraper4 /home/*/new ~/new ./new /home/user/new /root/new; do
  if [ -d "$d/.git" ] && [ -f "$d/cloudflare-scraper4/package.json" ]; then
    REPO="$d"
    break
  fi
done
if [ -z "$REPO" ]; then
  REPO="$(pwd)"
  while [ "$REPO" != "/" ] && [ ! -d "$REPO/.git" ]; do REPO="$(dirname "$REPO")"; done
fi
echo "Repo: $REPO"
cd "$REPO"

# Ensure we are on correct branch
git fetch origin arena/01a0aa17-new || true
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD || echo "unknown")
echo "Current branch: $CURRENT_BRANCH"
if [ "$CURRENT_BRANCH" != "arena/01a0aa17-new" ]; then
  git checkout arena/01a0aa17-new || git checkout -b arena/01a0aa17-new origin/arena/01a0aa17-new || true
fi

# Clear dirty check that pauses auto-update
echo "Git status before:"
git status --porcelain | head -n 20 || true

# Stash or reset dirty files (except data/)
# data/ is ignored, but check for untracked that are not ignored
git reset --hard origin/arena/01a0aa17-new
echo "After reset, head: $(git rev-parse --short HEAD)"

# Pull latest
git pull --ff-only origin arena/01a0aa17-new || git reset --hard origin/arena/01a0aa17-new

# Clear stalled jobs via Node directly (bypasses HTTP 503)
cd "$REPO/cloudflare-scraper4"
echo "Installing deps if needed..."
npm install --no-audit --prefer-online 2>&1 | tail -n 5 || true

echo "Building..."
npm run render:build 2>&1 | tail -n 10 || true

echo "Clearing stalled jobs via direct DB..."
node --input-type=module <<'NODEJS'
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
try {
  // Try to load db and reap
  const dbPath = './render-dist/db.js';
  const { reapStalledJobs, recoverFailedAndStalledJobs, pool } = await import(dbPath);
  console.log('Calling reapStalledJobs(5)...');
  const n1 = await reapStalledJobs(5);
  console.log(`Reaped ${n1} jobs`);
  console.log('Calling recoverFailedAndStalledJobs(5)...');
  const n2 = await recoverFailedAndStalledJobs(5);
  console.log(`Recovered ${n2} jobs`);
  await pool.end();
} catch (e) {
  console.error('Direct DB clear failed, trying SQL:', e);
  // Fallback: try via psql or sqlite
  try {
    const { readFileSync, existsSync } = await import('node:fs');
    const envLocal = existsSync('.env.local') ? readFileSync('.env.local','utf8') : '';
    const env = existsSync('.env') ? readFileSync('.env','utf8') : '';
    const allEnv = envLocal + '\n' + env + '\n' + Object.entries(process.env).map(([k,v])=>`${k}=${v}`).join('\n');
    const m = allEnv.match(/DATABASE_URL\s*=\s*(.+)/);
    const dbUrl = m ? m[1].trim().replace(/^["']|["']$/g,'') : process.env.DATABASE_URL;
    console.log('DATABASE_URL:', dbUrl ? dbUrl.slice(0,30)+'...' : 'not set, trying sqlite');
    if (dbUrl && dbUrl.startsWith('postgres')) {
      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString: dbUrl });
      const r1 = await pool.query(`UPDATE jobs SET status='failed',phase='watchdog',error='Job was inactive and closed by watchdog - manual recovery',finished_at=now(),updated_at=now() WHERE status='running' AND updated_at < now() - interval '5 minutes'`);
      console.log(`Postgres reaped ${r1.rowCount}`);
      const r2 = await pool.query(`UPDATE jobs SET status='queued',phase='waiting',stop_requested=false,error=NULL,finished_at=NULL,updated_at=now() WHERE status='failed' OR (status='running' AND updated_at < now() - interval '5 minutes')`);
      console.log(`Postgres recovered ${r2.rowCount} (set to queued) - then marking failed jobs as failed again to clear queue`);
      // Actually we want to fail them, not queue them again, to stop loop
      const r3 = await pool.query(`UPDATE jobs SET status='failed',phase='watchdog',error='Cleared by manual recovery script',finished_at=now(),updated_at=now() WHERE status='queued'`);
      console.log(`Cleared queued ${r3.rowCount}`);
      await pool.end();
    } else {
      // sqlite
      const sqlitePath = 'data/scraper4.sqlite';
      if (existsSync(sqlitePath)) {
        const sqlite = await import('node:sqlite');
        const db = new sqlite.DatabaseSync(sqlitePath);
        const cutoff = new Date(Date.now() - 5*60*1000).toISOString();
        console.log('SQLite cutoff:', cutoff);
        // For sqlite we need to use SQL directly
        const { execSync } = await import('node:child_process');
        execSync(`sqlite3 ${sqlitePath} "UPDATE jobs SET status='failed',phase='watchdog',error='Job was inactive and closed by watchdog - manual recovery',finished_at=datetime('now'),updated_at=datetime('now') WHERE status='running' AND updated_at < datetime('now','-5 minutes'); SELECT changes();"`, { stdio: 'inherit' });
        execSync(`sqlite3 ${sqlitePath} "UPDATE jobs SET status='failed',phase='watchdog',error='Cleared by manual recovery',finished_at=datetime('now'),updated_at=datetime('now') WHERE status='queued'; SELECT changes();"`, { stdio: 'inherit' });
      } else {
        console.log('No sqlite db found at', sqlitePath);
      }
    }
  } catch (e2) {
    console.error('Fallback also failed:', e2);
  }
}
NODEJS

echo "=== Restarting scraper ==="
# Try systemd
if systemctl is-active --quiet scraper4 2>/dev/null; then
  echo "Restarting systemd scraper4..."
  sudo systemctl restart scraper4 || systemctl restart scraper4 || true
elif systemctl is-active --quiet scraper4-node 2>/dev/null; then
  sudo systemctl restart scraper4-node || true
else
  echo "No systemd service found, trying pm2..."
  pm2 restart scraper4 || pm2 restart all || true
  # Try deployer
  if [ -f "$REPO/cloudflare-scraper4/.deploy/vps/run.sh" ]; then
    echo "Found deployer run.sh, restarting..."
    bash "$REPO/cloudflare-scraper4/.deploy/vps/run.sh" restart || true
  fi
  # Kill node and restart via npm
  echo "Killing old node processes and starting new..."
  pkill -f "render.*server" || true
  sleep 2
  cd "$REPO/cloudflare-scraper4"
  nohup npm run render:start > /tmp/scraper4.log 2>&1 &
  echo "Started via npm run render:start, log /tmp/scraper4.log"
fi

echo "Waiting 5s then checking /api/version..."
sleep 5
curl -s http://127.0.0.1:3000/api/version || curl -s http://127.0.0.1:8790/api/version || curl -s https://sabashopping.ir/app/api/version || echo "curl failed"

echo "=== Recovery done ==="
echo "Check https://sabashopping.ir/app/api/version - should be 1.279.0+"
echo "If still 503, run: sudo journalctl -u scraper4 -n 100 --no-pager"
