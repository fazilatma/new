#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-5500}"
export PORT
export AGENT_CANVAS_PORT="${AGENT_CANVAS_PORT:-$PORT}"

# Agent Canvas serves the UI from the origin root. HostConsole should strip
# /openhands/ before proxying to this local port.
unset AGENT_CANVAS_BASE_PATH
# The HostConsole proxy keeps /openhands/ in the request path. Tell the
# static server to mount the prebuilt SPA at the same prefix. API/WebSocket
# routes remain /api and /sockets and are handled by the Agent Canvas ingress.
unset VITE_BASE_PATH

# Create the workspace root expected by AutomationService.
export OPENHANDS_WORKSPACE_ROOT="${OPENHANDS_WORKSPACE_ROOT:-$HOME/.openhands/agent-canvas/workspaces}"
export OPENHANDS_AUTOMATION_WORKSPACE_ROOT="${OPENHANDS_AUTOMATION_WORKSPACE_ROOT:-$OPENHANDS_WORKSPACE_ROOT/automation-runs}"
mkdir -p "$OPENHANDS_AUTOMATION_WORKSPACE_ROOT" "$OPENHANDS_WORKSPACE_ROOT" 2>/dev/null || true

# Dynamically select three consecutive free loopback ports.
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

# Lightweight diagnostics for shared-host resource kills (code 137).
DIAG_DIR="${OPENHANDS_DIAG_DIR:-$HOME/.openhands/agent-canvas}"
mkdir -p "$DIAG_DIR" 2>/dev/null || true
DIAG_LOG="$DIAG_DIR/resource.log"
diag_loop() {
  while :; do
    {
      printf '[%s] pid=%s ports=%s,%s,%s ' "$(date '+%Y-%m-%d %H:%M:%S')" "$$"         "$OH_CANVAS_SAFE_BACKEND_PORT" "$OH_CANVAS_SAFE_AUTOMATION_PORT" "$OH_CANVAS_SAFE_VITE_PORT"
      if [ -r /proc/meminfo ]; then
        awk '/MemTotal:|MemAvailable:|SwapTotal:|SwapFree:/{printf "%s=%sKB ", $1, $2}' /proc/meminfo
      fi
      printf '\n'
    } >> "$DIAG_LOG" 2>/dev/null || true
    sleep 30
  done
}
diag_loop &
DIAG_PID=$!
cleanup() { kill "$DIAG_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

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
echo "[openhands] Workspace: $OPENHANDS_AUTOMATION_WORKSPACE_ROOT"
echo "[openhands] Resource diagnostics: $DIAG_LOG"
echo "[openhands] Ensuring Agent Canvas ${AGENT_CANVAS_VERSION:-1.24.0} is installed..."
npm install --no-audit --no-fund --include=prod --prefer-online

exec npm exec --yes --package="@openhands/agent-canvas@${AGENT_CANVAS_VERSION:-1.24.0}" -- agent-canvas
