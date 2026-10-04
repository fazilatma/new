#!/bin/bash
# Auto recover sabashopping.ir scraper when 503
# Usage: bash recover-sabashopping.sh [branch]
# Default branch arena/01a0aa17-new
set -e
BRANCH=${1:-arena/01a0aa17-new}
HOSTCONSOLE_BRANCH=${2:-arena/hostconsole-v7}
echo "[$(date)] Starting recover for branch $BRANCH, hostconsole $HOSTCONSOLE_BRANCH"

# Find hostconsole.php
HC=$(find / -type f -name "hostconsole.php" 2>/dev/null | head -n 1 || echo "")
if [ -z "$HC" ]; then
  for d in /home/*/public_html/project /home/*/www/project /var/www/html/project /home/*/domains/*/public_html/project; do
    if [ -f "$d/hostconsole.php" ]; then HC="$d/hostconsole.php"; break; fi
  done
fi
if [ -z "$HC" ]; then HC="/home/$(whoami)/public_html/project/hostconsole.php"; fi
echo "Hostconsole: $HC"
HCDIR=$(dirname "$HC")
cd "$HCDIR"
pwd
ls -lh hostconsole.php | head -n 5

echo "=== Updating hostconsole.php from $HOSTCONSOLE_BRANCH ==="
curl -s -L --max-time 30 -o hostconsole.php.new "https://raw.githubusercontent.com/fazilatma/new/${HOSTCONSOLE_BRANCH}/hostconsole.php?cb=$(date +%s)" || true
if [ ! -f hostconsole.php.new ]; then
  curl -s -L --max-time 30 -o hostconsole.php.new "https://cdn.jsdelivr.net/gh/fazilatma/new@${HOSTCONSOLE_BRANCH}/hostconsole.php?cb=$(date +%s)" || true
fi
ls -lh hostconsole.php.new || true
if [ -f hostconsole.php.new ] && [ $(wc -c < hostconsole.php.new) -gt 50000 ] && head -c 5 hostconsole.php.new | grep -q "<?php"; then
  cp hostconsole.php hostconsole.php.bak.$(date +%Y%m%d-%H%M%S)
  mv hostconsole.php.new hostconsole.php
  echo "Hostconsole updated to $(wc -c < hostconsole.php) bytes"
else
  echo "Hostconsole download failed or invalid"
  cat hostconsole.php.new | head -c 500 || true
fi

echo "=== Finding scraper4-cloudflare project ==="
# Find via hostconsole data dir or via find
SC=""
for d in /home/*/public_html /home/*/www /var/www/html /opt/scraper* /root/scraper*; do
  if [ -f "$d/cloudflare-scraper4/package.json" ]; then SC="$d"; break; fi
done
if [ -z "$SC" ]; then
  SC=$(find / -type f -path "*cloudflare-scraper4/package.json" 2>/dev/null | head -n 1 | xargs dirname | xargs dirname || echo "")
fi
if [ -z "$SC" ]; then
  # Try via hostconsole projects
  if [ -d "$HCDIR/../.wconsole_data" ]; then
    echo "Checking hostconsole data"
    ls "$HCDIR/../.wconsole_data" | head
  fi
fi
echo "Scraper path guess: $SC"

# Try to get deploy_path from hostconsole via php
if [ -f "$HC" ]; then
  DEPLOY=$(php -r '
  $cfgFile = dirname($argv[1])."/../.wconsole_data/config.json";
  if (!is_file($cfgFile)) $cfgFile = dirname($argv[1])."/.wconsole_data/config.json";
  $files = glob(dirname($argv[1])."/../.wconsole_data/projects/*.json");
  if (!$files) $files = glob("/home/*/.wconsole_data/projects/*.json");
  foreach ($files as $f) {
    $p = json_decode(file_get_contents($f), true);
    if (($p["name"]??"") === "scraper4-cloudflare") { echo $p["deploy_path"]??""; exit; }
  }
  ' "$HC" 2>&1 || echo "")
  echo "Deploy from hostconsole: $DEPLOY"
  if [ -n "$DEPLOY" ] && [ -d "$DEPLOY" ]; then SC="$DEPLOY"; fi
fi

if [ -z "$SC" ] || [ ! -d "$SC" ]; then
  # Fallback: find any dir with cloudflare-scraper4
  SC=$(find /home -type d -name "cloudflare-scraper4" 2>/dev/null | head -n 1 | xargs dirname || echo "")
fi

echo "Final scraper path: $SC"
if [ -z "$SC" ] || [ ! -d "$SC/cloudflare-scraper4" ]; then
  echo "Scraper path not found, trying /home/*/scraper4-cloudflare"
  SC=$(ls -d /home/*/scraper4-cloudflare 2>/dev/null | head -n 1 || echo "")
fi

if [ -n "$SC" ] && [ -d "$SC/cloudflare-scraper4" ]; then
  cd "$SC"
  echo "=== Git fetch reset $BRANCH ==="
  git fetch origin $BRANCH 2>&1 | tail -n 20 || true
  git reset --hard origin/$BRANCH 2>&1 | tail -n 20 || true
  echo "Head: $(git rev-parse --short HEAD 2>&1)"
  cd cloudflare-scraper4
  echo "=== npm install ==="
  npm install --no-audit --prefer-online 2>&1 | tail -n 20 || true
  echo "=== render:build ==="
  npm run render:build 2>&1 | tail -n 30 || true
  ls -lh render-dist/ | head -n 20 || true
  echo "=== Killing ports 8790 3000 ==="
  fuser -k 8790/tcp 2>&1 || ss -K dport 8790 2>&1 || true
  fuser -k 3000/tcp 2>&1 || ss -K dport 3000 2>&1 || true
  pkill -f "node.*8790" 2>&1 || true
  pkill -f "node.*3000" 2>&1 || true
  echo "=== Reap stalled jobs ==="
  cat > /tmp/reap.mjs <<'REAP'
import { reapStalledJobs, pool } from './render-dist/db.js';
let n = await reapStalledJobs(5);
console.log('reaped '+n);
await pool.end();
REAP
  node /tmp/reap.mjs 2>&1 | tail -n 20 || node reap.mjs 2>&1 | tail -n 20 || true
  echo "=== Restart via hostconsole job ==="
  # Try to restart via hostconsole CLI if available
  cd "$HCDIR"
  php -r '
  $files = glob(__DIR__."/../.wconsole_data/projects/*.json");
  if (!$files) $files = glob("/home/*/.wconsole_data/projects/*.json");
  foreach ($files as $f) {
    $p = json_decode(file_get_contents($f), true);
    if (($p["name"]??"") === "scraper4-cloudflare" && ($p["port"]??"") == "3000") {
      echo $p["id"]." ".$p["deploy_path"]."\n";
    }
  }
  ' 2>&1 || true
else
  echo "Scraper path not found, cannot git update"
fi

echo "=== Check local versions ==="
curl -s --max-time 5 http://127.0.0.1:8790/api/version 2>&1 | head -c 500 || echo "8790 down"
curl -s --max-time 5 http://127.0.0.1:3000/api/version 2>&1 | head -c 500 || echo "3000 down"

echo "=== Public version ==="
curl -s --max-time 10 https://sabashopping.ir/app/api/version 2>&1 | head -c 1000 || echo "public down"

echo "[$(date)] Recover done"
