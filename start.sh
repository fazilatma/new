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

# Agent Canvas requires Node 24+ and uv for the local agent backend.
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

# Do not rely on a pre-existing node_modules/.bin entry. HostConsole can
# restore/copy a project with a stale or incomplete dependency tree.
echo "[openhands] Ensuring Agent Canvas ${AGENT_CANVAS_VERSION:-1.24.0} is installed..."
npm install --no-audit --no-fund --include=prod --prefer-online

# Run through npm's package executor so the correct package binary is put on PATH
# even when npm's local .bin symlink is missing or stale.
exec npm exec --yes --package="@openhands/agent-canvas@${AGENT_CANVAS_VERSION:-1.24.0}" -- agent-canvas --public
