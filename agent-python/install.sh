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

# 1. Probe the best available Python binary (prioritize Python 3.12 -> 3.9 before system 3.6/3.8)
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
      echo "$cand"
      return 0
    fi
  done
  echo "python3"
}

PYBIN=$(find_best_python)
echo "[python-bootstrap] Selected Python binary: $PYBIN ($($PYBIN --version 2>&1 || echo 'unknown'))"

# 2. Prepare Virtual Environment (.venv) with ensurepip immunity
if [ ! -d ".venv" ] || [ ! -f ".venv/bin/python" -a ! -f ".venv/bin/python3" ]; then
  echo "[python-bootstrap] Initializing virtual environment..."
  rm -rf .venv 2>/dev/null || true
  # First try with --without-pip to avoid broken ensurepip wheels on cPanel/CentOS
  if ! "$PYBIN" -m venv --without-pip .venv 2>/dev/null; then
    "$PYBIN" -m venv .venv 2>/dev/null || virtualenv -p "$PYBIN" .venv 2>/dev/null || true
  fi
fi

# 3. Bootstrap pip if not present in .venv
if [ -d ".venv" ] && [ ! -f ".venv/bin/pip" -a ! -f ".venv/bin/pip3" ]; then
  echo "[python-bootstrap] Bootstrapping pip into virtualenv..."
  VENV_PY=$([ -f ".venv/bin/python3" ] && echo ".venv/bin/python3" || echo ".venv/bin/python")
  (curl -sS https://bootstrap.pypa.io/get-pip.py 2>/dev/null | "$VENV_PY" 2>/dev/null || \
   wget -qO- https://bootstrap.pypa.io/get-pip.py 2>/dev/null | "$VENV_PY" 2>/dev/null || \
   "$VENV_PY" -m ensurepip --default-pip 2>/dev/null || true)
fi

# 4. Resolve PIP binary inside venv
PIPBIN="pip3"
if [ -f ".venv/bin/pip" ]; then
  PIPBIN=".venv/bin/pip"
elif [ -f ".venv/bin/pip3" ]; then
  PIPBIN=".venv/bin/pip3"
fi

# 5. Prepare directories & config
mkdir -p data storage storage/workspaces storage/uploads storage/logs storage/backups
chmod -R u+rwX data storage 2>/dev/null || true

if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  ok "Created .env from .env.example"
fi

# 6. Install dependencies
if [ -f "requirements.txt" ]; then
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
  ok "Dependencies installed successfully."
fi

ok "Arena Python Agent installation complete."
