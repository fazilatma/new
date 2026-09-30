#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")"

# WebConsole supplies PORT for the project. Agent Canvas uses 8000 by default;
# keep the default only when the console did not provide one.
export PORT="${PORT:-8000}"

# Persist a private key locally. --public is required when the app is exposed
# through a domain/reverse proxy, otherwise the session key may be exposed.
KEY_FILE=".openhands-backend-key"
if [ -z "${LOCAL_BACKEND_API_KEY:-}" ]; then
  if [ -s "$KEY_FILE" ]; then
    export LOCAL_BACKEND_API_KEY="$(cat "$KEY_FILE")"
  else
    if command -v openssl >/dev/null 2>&1; then
      export LOCAL_BACKEND_API_KEY="$(openssl rand -base64 32 | tr -d '\r\n')"
    else
      export LOCAL_BACKEND_API_KEY="$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')"
    fi
    printf '%s\n' "$LOCAL_BACKEND_API_KEY" > "$KEY_FILE"
    chmod 600 "$KEY_FILE" 2>/dev/null || true
  fi
fi

# The current OpenHands Agent Canvas requires Node 24+ and uv.
# WebConsole's per-project NVM selection supplies Node 24.
exec npx --no-install @openhands/agent-canvas --public
