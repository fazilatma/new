#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-5500}"
export PORT
export AGENT_CANVAS_PORT="${AGENT_CANVAS_PORT:-$PORT}"

if [ ! -s ".openhands-backend-key" ]; then
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32 | tr -d '\n' > .openhands-backend-key
  else
    node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))" > .openhands-backend-key
  fi
  chmod 600 .openhands-backend-key 2>/dev/null || true
fi

export LOCAL_BACKEND_API_KEY="$(cat .openhands-backend-key)"

# HostConsole may skip dependency installation when importing a project.
# Self-heal on first start so the service does not depend on a manual npm install.
if [ ! -x "node_modules/.bin/agent-canvas" ]; then
  echo "[openhands] Installing Agent Canvas dependencies..."
  npm install --no-audit --no-fund --include=prod
fi

if [ ! -x "node_modules/.bin/agent-canvas" ]; then
  echo "[openhands] Agent Canvas installation did not produce node_modules/.bin/agent-canvas" >&2
  exit 1
fi

exec node_modules/.bin/agent-canvas --public
