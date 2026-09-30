#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-5500}"
export PORT
export AGENT_CANVAS_PORT="${AGENT_CANVAS_PORT:-$PORT}"

# Agent Canvas npm/source launcher serves the UI from the origin root.
# HostConsole must strip /openhands/ before proxying to this local port.
unset AGENT_CANVAS_BASE_PATH VITE_BASE_PATH

# Dedicated internal ports prevent stale/default OpenHands instances on
# 18000/18001/3001 from blocking this instance.
export OH_CANVAS_SAFE_BACKEND_PORT="${OH_CANVAS_SAFE_BACKEND_PORT:-19000}"
export OH_CANVAS_SAFE_AUTOMATION_PORT="${OH_CANVAS_SAFE_AUTOMATION_PORT:-19001}"
export OH_CANVAS_SAFE_VITE_PORT="${OH_CANVAS_SAFE_VITE_PORT:-19002}"

if [ ! -s ".openhands-backend-key" ]; then
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32 | tr -d '\n' > .openhands-backend-key
  else
    node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))" > .openhands-backend-key
  fi
  chmod 600 .openhands-backend-key 2>/dev/null || true
fi

export LOCAL_BACKEND_API_KEY="$(cat .openhands-backend-key)"

if ! command -v uv >/dev/null 2>&1; then
  export UV_INSTALL_DIR="${HOME}/.local/bin"
  mkdir -p "$UV_INSTALL_DIR"
  if command -v curl >/dev/null 2>&1; then
    echo "[openhands] Installing uv into $UV_INSTALL_DIR..."
    curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR="$UV_INSTALL_DIR" sh
  fi
fi
if [ -x "${HOME}/.local/bin/uv" ]; then
  export PATH="${HOME}/.local/bin:$PATH"
fi

echo "[openhands] Starting Agent Canvas on port $PORT with base path $AGENT_CANVAS_BASE_PATH"
echo "[openhands] Internal ports: backend=$OH_CANVAS_SAFE_BACKEND_PORT automation=$OH_CANVAS_SAFE_AUTOMATION_PORT frontend=$OH_CANVAS_SAFE_VITE_PORT"
echo "[openhands] Ensuring Agent Canvas ${AGENT_CANVAS_VERSION:-1.24.0} is installed..."
npm install --no-audit --no-fund --include=prod --prefer-online

exec npm exec --yes --package="@openhands/agent-canvas@${AGENT_CANVAS_VERSION:-1.24.0}" -- agent-canvas --public
