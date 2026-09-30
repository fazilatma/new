#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-5500}"
export PORT
export AGENT_CANVAS_PORT="${AGENT_CANVAS_PORT:-$PORT}"

# Agent Canvas npm/source launcher serves the UI from the origin root.
# HostConsole must strip /openhands/ before proxying to this local port.
unset AGENT_CANVAS_BASE_PATH VITE_BASE_PATH

# Dynamically select three consecutive free loopback ports. This prevents
# stale Agent Canvas processes from blocking startup.
read -r OH_CANVAS_SAFE_BACKEND_PORT OH_CANVAS_SAFE_AUTOMATION_PORT OH_CANVAS_SAFE_VITE_PORT <<EOF
$(node <<'NODE'
const net = require('net');
const start = Number(process.env.OH_CANVAS_PORT_START || 19000);
function free(port) {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}
(async () => {
  for (let p = start; p < start + 1000; p++) {
    if (await free(p) && await free(p + 1) && await free(p + 2)) {
      process.stdout.write(`${p} ${p + 1} ${p + 2}`);
      return;
    }
  }
  process.exit(1);
})().catch(() => process.exit(1));
NODE
)
EOF
export OH_CANVAS_SAFE_BACKEND_PORT OH_CANVAS_SAFE_AUTOMATION_PORT OH_CANVAS_SAFE_VITE_PORT

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

echo "[openhands] Starting Agent Canvas on port $PORT"
echo "[openhands] Internal ports: backend=$OH_CANVAS_SAFE_BACKEND_PORT automation=$OH_CANVAS_SAFE_AUTOMATION_PORT frontend=$OH_CANVAS_SAFE_VITE_PORT"
echo "[openhands] Ensuring Agent Canvas ${AGENT_CANVAS_VERSION:-1.24.0} is installed..."
npm install --no-audit --no-fund --include=prod --prefer-online

exec npm exec --yes --package="@openhands/agent-canvas@${AGENT_CANVAS_VERSION:-1.24.0}" -- agent-canvas --public
