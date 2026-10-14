#!/usr/bin/env bash
# Add OpenAI-compatible models and optional terminal tools to Copilot Chat in code-server.
# Designed for Android Termux; also works on ordinary Linux installations.
set -Eeuo pipefail

RAW_BASE_DEFAULT="https://raw.githubusercontent.com/fazilatma/new/refs/heads/arena/f1997f2f-new/host-helpers"
RAW_BASE="${COPILOT_MODELS_RAW_BASE:-$RAW_BASE_DEFAULT}"
HELPER_VERSION="0.1.11"
SCRIPT_DIR=""
if [[ -n "${BASH_SOURCE[0]:-}" && "${BASH_SOURCE[0]}" != /dev/fd/* ]]; then
  SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)"
fi

log() { printf '%s\n' "$*" >&2; }
die() { log "error: $*"; exit 1; }

find_python() {
  if command -v python3 >/dev/null 2>&1 \
    && python3 -c 'import sys; raise SystemExit(sys.version_info < (3, 9))' 2>/dev/null; then
    command -v python3
  elif command -v python >/dev/null 2>&1 \
    && python -c 'import sys; raise SystemExit(sys.version_info < (3, 9))' 2>/dev/null; then
    command -v python
  else
    return 1
  fi
}

PYTHON_BIN="$(find_python || true)"
if [[ -z "$PYTHON_BIN" ]]; then
  if command -v pkg >/dev/null 2>&1; then
    log "==> Python is required; installing the Termux python package..."
    pkg install -y python
    PYTHON_BIN="$(find_python || true)"
  fi
fi
[[ -n "$PYTHON_BIN" ]] || die "Python 3.9+ is required (in Termux run: pkg install python)"

TEMP_DIR=""
cleanup() {
  if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
    rm -rf -- "$TEMP_DIR"
  fi
}
trap cleanup EXIT HUP INT TERM

log "==> Copilot models helper v$HELPER_VERSION"

if [[ -n "$SCRIPT_DIR" \
  && -f "$SCRIPT_DIR/copilot-models.py" \
  && -f "$SCRIPT_DIR/copilot-models.catalog.json" \
  && -f "$SCRIPT_DIR/copilot-models-toolbox/package.json" \
  && -f "$SCRIPT_DIR/copilot-models-toolbox/extension.js" \
  && -f "$SCRIPT_DIR/copilot-models-toolbox/core.js" ]]; then
  HELPER="$SCRIPT_DIR/copilot-models.py"
  CATALOG="$SCRIPT_DIR/copilot-models.catalog.json"
  TOOLBOX_DIR="$SCRIPT_DIR/copilot-models-toolbox"
else
  command -v curl >/dev/null 2>&1 || die "curl is required"
  TMP_BASE="${TMPDIR:-}"
  if [[ -z "$TMP_BASE" ]]; then
    TMP_BASE="${PREFIX:+$PREFIX/tmp}"
  fi
  TMP_BASE="${TMP_BASE:-/tmp}"
  mkdir -p -- "$TMP_BASE"
  TEMP_DIR="$(mktemp -d "$TMP_BASE/copilot-models.XXXXXX" 2>/dev/null || mktemp -d)"
  HELPER="$TEMP_DIR/copilot-models.py"
  CATALOG="$TEMP_DIR/copilot-models.catalog.json"
  TOOLBOX_DIR="$TEMP_DIR/copilot-models-toolbox"
  mkdir -p -- "$TOOLBOX_DIR"
  log "==> Downloading the Copilot models helper and Chat toolbar..."
  curl -fsSL --retry 3 "$RAW_BASE/copilot-models.py" -o "$HELPER"
  curl -fsSL --retry 3 "$RAW_BASE/copilot-models.catalog.json" -o "$CATALOG"
  curl -fsSL --retry 3 "$RAW_BASE/copilot-models-toolbox/package.json" \
    -o "$TOOLBOX_DIR/package.json"
  curl -fsSL --retry 3 "$RAW_BASE/copilot-models-toolbox/extension.js" \
    -o "$TOOLBOX_DIR/extension.js"
  curl -fsSL --retry 3 "$RAW_BASE/copilot-models-toolbox/core.js" \
    -o "$TOOLBOX_DIR/core.js"
fi

set +e
"$PYTHON_BIN" "$HELPER" --catalog "$CATALOG" --toolbox-dir "$TOOLBOX_DIR" "$@"
status=$?
set -e
exit "$status"
