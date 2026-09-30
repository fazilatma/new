#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-5500}"
export PORT
export AGENT_CANVAS_PORT="${AGENT_CANVAS_PORT:-$PORT}"

# HostConsole publishes this app under /openhands/ using its htaccess proxy.
# Agent Canvas must know its public base path or the SPA assets/routes point
# to the domain root and the result is a blank page.
export AGENT_CANVAS_BASE_PATH="${AGENT_CANVAS_BASE_PATH:-/openhands}"
export VITE_BASE_PATH="${VITE_BASE_PATH:-$AGENT_CANVAS_BASE_PATH}"

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
echo "[openhands] Ensuring Agent Canvas ${AGENT_CANVAS_VERSION:-1.24.0} is installed..."
npm install --no-audit --no-fund --include=prod --prefer-online

exec npm exec --yes --package="@openhands/agent-canvas@${AGENT_CANVAS_VERSION:-1.24.0}" -- agent-canvas --public
