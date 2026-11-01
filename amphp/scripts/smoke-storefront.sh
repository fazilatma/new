#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/.arena-preview"
if [[ ! -d node_modules/happy-dom ]]; then
  npm install happy-dom@15.11.7 --no-save --silent
fi
echo "== storefront smoke =="
node smoke-test.mjs
