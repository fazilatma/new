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
exec npx --no-install @openhands/agent-canvas --public
