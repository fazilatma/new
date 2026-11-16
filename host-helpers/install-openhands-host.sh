#!/usr/bin/env bash
set -Eeuo pipefail

# OpenHands Host Helper
# Installs user-local Node.js 24+, npm, uv, and OpenHands Agent Canvas
# Designed for shared hosting where HOME may incorrectly point to / and sudo is unavailable.

VERSION_NVM="v0.40.3"
NODE_MAJOR="24"
BASE_DIR="${OPENHANDS_HOME:-$PWD/.openhands}"
NVM_DIR="${NVM_DIR:-$BASE_DIR/nvm}"
UV_DIR="$BASE_DIR/bin"
ENV_FILE="$BASE_DIR/env.sh"

mkdir -p "$BASE_DIR" "$UV_DIR"

echo "==> OpenHands host helper"
echo "    install directory: $BASE_DIR"

# Install nvm without touching /.bashrc or other root-owned shell profiles.
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo "==> Installing nvm $VERSION_NVM ..."
  tmp="$BASE_DIR/nvm.tar.gz"
  curl -fsSL "https://github.com/nvm-sh/nvm/archive/refs/tags/$VERSION_NVM.tar.gz" -o "$tmp"
  rm -rf "$NVM_DIR" "$BASE_DIR/nvm-$VERSION_NVM"
  tar -xzf "$tmp" -C "$BASE_DIR"
  mv "$BASE_DIR/nvm-$VERSION_NVM" "$NVM_DIR"
  rm -f "$tmp"
fi

export NVM_DIR
# shellcheck disable=SC1090
. "$NVM_DIR/nvm.sh"

echo "==> Installing Node.js $NODE_MAJOR ..."
nvm install "$NODE_MAJOR"
nvm alias default "$NODE_MAJOR" >/dev/null 2>&1 || true
nvm use "$NODE_MAJOR" >/dev/null

NODE_BIN="$(dirname "$(nvm which "$NODE_MAJOR")")"
export PATH="$NODE_BIN:$UV_DIR:$PATH"

echo "==> Installing uv ..."
if [ ! -x "$UV_DIR/uv" ]; then
  curl -LsSf https://astral.sh/uv/install.sh | env UV_UNMANAGED_INSTALL="$UV_DIR" sh
fi
export PATH="$UV_DIR:$PATH"

echo "==> Installing OpenHands Agent Canvas ..."
npm install -g @openhands/agent-canvas

# Persist the environment for future shell sessions without relying on HOME.
cat > "$ENV_FILE" <<EOF
export OPENHANDS_HOME="$(printf '%q' "$BASE_DIR")"
export NVM_DIR="$(printf '%q' "$NVM_DIR")"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="$NVM_DIR/versions/node/v$(node -v | sed 's/^v//' | cut -d. -f1-2)/bin:$UV_DIR:$PATH"
EOF

# Add a project-local launcher so it remains usable even if the hosting shell has a broken HOME.
cat > "$BASE_DIR/openhands-env" <<EOF
#!/usr/bin/env bash
set -e
export OPENHANDS_HOME="$(printf '%q' "$BASE_DIR")"
export NVM_DIR="$(printf '%q' "$NVM_DIR")"
. "$NVM_DIR/nvm.sh"
nvm use "$NODE_MAJOR" >/dev/null
export PATH="$NVM_DIR/versions/node/v$(node -v | sed 's/^v//' | cut -d. -f1-2)/bin:$UV_DIR:$PATH"
exec "$@"
EOF
chmod +x "$BASE_DIR/openhands-env"

echo
echo "==> Versions"
node -v
npm -v
uv --version
agent-canvas --version 2>/dev/null || true

echo
echo "==> Installation complete."
echo "==> Environment file: $ENV_FILE"
echo
echo "To use it in a new shell:"
echo "  source "$ENV_FILE""
echo
echo "To start OpenHands now:"
echo "  "$BASE_DIR/openhands-env" agent-canvas"
echo
echo "NOTE: Agent Canvas requires a model access path and runs the agent with access to the host filesystem."
echo "      For a public deployment, configure authentication before exposing port 8000."
