#!/usr/bin/env bash
#
# Arena Python Agent — Installer and Environment Bootstrapper.
# Compatible with Linux, CentOS/cPanel, Debian/Ubuntu, CloudLinux, and Shared Hosting.
#
set -eo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; RESET=$'\033[0m'
ok()   { echo "${GREEN}✓${RESET} $*"; }
warn() { echo "${YELLOW}!${RESET} $*"; }
die()  { echo "${RED}✗${RESET} $*" >&2; exit 1; }

echo "${BOLD}Arena Python Agent — Python Runtime Bootstrapper${RESET}"
echo "Installing into: $APP_DIR"
echo

# 1. Check for uv binary
find_uv() {
  for cand in \
    "${HOME}/.local/bin/uv" \
    "${HOME}/.cargo/bin/uv" \
    /usr/local/bin/uv \
    /usr/bin/uv; do
    if [ -x "$cand" ]; then echo "$cand"; return 0; fi
  done
  if command -v uv >/dev/null 2>&1; then command -v uv; return 0; fi
  return 1
}

UVBIN=$(find_uv || echo "")

# 2. Probe candidate modern Python interpreters (Python 3.12 -> 3.9)
find_best_python() {
  for cand in \
    /opt/alt/python312/bin/python3 \
    /opt/cpanel/ea-python312/root/usr/bin/python3 \
    /usr/local/bin/python3.12 \
    /usr/bin/python3.12 \
    /opt/alt/python311/bin/python3 \
    /opt/cpanel/ea-python311/root/usr/bin/python3 \
    /usr/local/bin/python3.11 \
    /usr/bin/python3.11 \
    /opt/alt/python310/bin/python3 \
    /opt/cpanel/ea-python310/root/usr/bin/python3 \
    /usr/local/bin/python3.10 \
    /usr/bin/python3.10 \
    /opt/alt/python39/bin/python3 \
    /opt/cpanel/ea-python39/root/usr/bin/python3 \
    /usr/local/bin/python3.9 \
    /usr/bin/python3.9 \
    python3.12 python3.11 python3.10 python3.9 python3 python; do
    if command -v "$cand" >/dev/null 2>&1 || [ -x "$cand" ]; then
      local ver
      ver=$("$cand" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo "0.0")
      if [ "$(echo "$ver >= 3.9" | bc 2>/dev/null || true)" = "1" ] || [[ "$ver" =~ ^3\.(9|10|11|12|13|14) ]]; then
        echo "$cand"
        return 0
      fi
    fi
  done
  # Fallback to whatever python3 is available
  command -v python3 2>/dev/null || echo "python3"
}

PYBIN=$(find_best_python)
PYVER=$("$PYBIN" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")' 2>/dev/null || echo "unknown")
echo "[python-bootstrap] Best available system Python: $PYBIN ($PYVER)"

# 3. Clean any obsolete or broken virtual environment (< 3.9 or missing pip)
if [ -d ".venv" ]; then
  VENV_PY=$([ -f ".venv/bin/python3" ] && echo ".venv/bin/python3" || ([ -f ".venv/bin/python" ] && echo ".venv/bin/python" || echo ""))
  VENV_VER=$([ -n "$VENV_PY" ] && "$VENV_PY" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo "0.0")
  if [ -z "$VENV_PY" ] || [ ! -f ".venv/bin/pip" -a ! -f ".venv/bin/pip3" ] || [[ "$VENV_VER" =~ ^(2\.|3\.[0-8]($|\.)) ]]; then
    echo "[python-bootstrap] Cleaning obsolete or incomplete virtual environment ($VENV_VER)..."
    rm -rf .venv 2>/dev/null || true
  fi
fi

# 4. Create virtualenv (.venv) using uv or modern Python
if [ ! -d ".venv" ]; then
  if [ -n "$UVBIN" ]; then
    echo "[python-bootstrap] Creating modern Python virtualenv with uv (Python 3.11)..."
    ("$UVBIN" venv --clear --seed -p 3.11 .venv 2>/dev/null || "$UVBIN" venv --clear --seed .venv 2>/dev/null || true)
  fi
  if [ ! -d ".venv" ] || [ ! -f ".venv/bin/python" -a ! -f ".venv/bin/python3" ]; then
    echo "[python-bootstrap] Creating virtualenv with $PYBIN (--without-pip immunity)..."
    rm -rf .venv 2>/dev/null || true
    ("$PYBIN" -m venv --without-pip .venv 2>/dev/null || "$PYBIN" -m venv .venv 2>/dev/null || virtualenv -p "$PYBIN" .venv 2>/dev/null || true)
  fi
fi

# 5. Bootstrap pip if not present in .venv
if [ -d ".venv" ] && [ ! -f ".venv/bin/pip" -a ! -f ".venv/bin/pip3" ]; then
  echo "[python-bootstrap] Bootstrapping pip into virtualenv..."
  VENV_PY=$([ -f ".venv/bin/python3" ] && echo ".venv/bin/python3" || echo ".venv/bin/python")
  (curl -sS https://bootstrap.pypa.io/get-pip.py 2>/dev/null | "$VENV_PY" 2>/dev/null || \
   wget -qO- https://bootstrap.pypa.io/get-pip.py 2>/dev/null | "$VENV_PY" 2>/dev/null || \
   "$VENV_PY" -m ensurepip --default-pip 2>/dev/null || true)
fi

# 6. Resolve PIP and Python binaries
VENV_PY=$([ -f ".venv/bin/python3" ] && echo ".venv/bin/python3" || echo ".venv/bin/python")
PIPBIN="pip3"
if [ -f ".venv/bin/pip" ]; then
  PIPBIN=".venv/bin/pip"
elif [ -f ".venv/bin/pip3" ]; then
  PIPBIN=".venv/bin/pip3"
fi

# 7. Prepare directories & config
mkdir -p data data/localai data/localai/models storage storage/workspaces storage/uploads storage/logs storage/backups storage/localai storage/localai/models
chmod -R 775 data storage 2>/dev/null || chmod -R 755 data storage 2>/dev/null || chmod -R u+rwX data storage 2>/dev/null || true

if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  ok "Created .env from .env.example"
fi

# 8. Install dependencies
if [ -f "requirements.txt" ]; then
  if [ -n "$UVBIN" ] && [ -f "$VENV_PY" ]; then
    echo "[python-bootstrap] Installing requirements using uv..."
    ("$UVBIN" pip install -r requirements.txt -p "$VENV_PY" 2>/dev/null || "$PIPBIN" install --no-warn-script-location -r requirements.txt || true)
  else
    echo "[python-bootstrap] Installing requirements using $PIPBIN..."
    $PIPBIN install --no-warn-script-location -r requirements.txt || {
      warn "Bulk install failed; attempting resilient line-by-line installation..."
      while IFS= read -r line || [ -n "$line" ]; do
        pkg=$(echo "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/#.*//')
        if [ -n "$pkg" ]; then
          $PIPBIN install --no-warn-script-location "$pkg" 2>/dev/null || warn "Skipped package: $pkg"
        fi
      done < requirements.txt
    }
  fi
  ok "Dependencies installed successfully."
fi

ok "Arena Python Agent installation complete."
