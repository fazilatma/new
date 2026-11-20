#!/usr/bin/env bash
set -euo pipefail

# Staging installer for the v10.599 migration dashboard.
# It does NOT deploy full scraper functionality: / shows only the initial UI.
PA_USER="${PA_USER:-fazilatma}"
# Hostname spelling as supplied by the user (DNS/HTTP hostnames are case-insensitive).
LIVE_HOST="${LIVE_HOST:-Fazilatma.pythonanywhere.com}"
REPO_DIR="${REPO_DIR:-$HOME/new}"
BRANCH="arena/e868e86a-new"
APP_DIR="$REPO_DIR/pythonanywhere"
VENV_DIR="${VENV_DIR:-$HOME/.virtualenvs/scraper4-pa}"
WSGI_FILE="${WSGI_FILE:-/var/www/${PA_USER}_pythonanywhere_com_wsgi.py}"
LIVE_URL="${LIVE_URL:-https://${LIVE_HOST}}"

usage() {
  cat <<'EOF'
Usage:
  bash install_and_smoke_test.sh --install-staging
  # Then click Web -> Reload for Fazilatma.pythonanywhere.com, and run:
  bash install_and_smoke_test.sh --test-live

Optional overrides: PA_USER, REPO_DIR, VENV_DIR, WSGI_FILE, LIVE_HOST, LIVE_URL.
The install step refuses dirty git worktrees and backs up an existing WSGI file.
EOF
}

install_staging() {
  if [[ "${PA_ALLOW_INCOMPLETE_STAGING:-}" != "1" ]]; then
    echo "Refusing deployment: the Python port has only an initial staging UI and is not feature-complete." >&2
    echo "For an explicit staging install only, rerun with PA_ALLOW_INCOMPLETE_STAGING=1." >&2
    exit 2
  fi

  if [[ ! -d "$REPO_DIR/.git" ]]; then
    if [[ -e "$REPO_DIR" ]]; then
      echo "REPO_DIR exists but is not a git checkout: $REPO_DIR" >&2
      exit 2
    fi
    git clone --branch "$BRANCH" --single-branch https://github.com/Fazilatma/new.git "$REPO_DIR"
  fi
  if [[ -n "$(git -C "$REPO_DIR" status --porcelain)" ]]; then
    echo "Refusing to update a dirty checkout; preserve/commit its files first: $REPO_DIR" >&2
    exit 2
  fi
  git -C "$REPO_DIR" fetch origin "$BRANCH"
  git -C "$REPO_DIR" checkout "$BRANCH"
  git -C "$REPO_DIR" pull --ff-only origin "$BRANCH"

  test -f "$APP_DIR/application.py"
  test -f "$APP_DIR/requirements.txt"
  python3 -m venv "$VENV_DIR"
  "$VENV_DIR/bin/python" -m pip install --no-cache-dir --upgrade pip
  "$VENV_DIR/bin/python" -m pip install --no-cache-dir -r "$APP_DIR/requirements.txt"
  py_minor="$("$VENV_DIR/bin/python" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"

  test -d "$(dirname "$WSGI_FILE")" || {
    echo "PythonAnywhere WSGI directory not found: $(dirname "$WSGI_FILE")" >&2
    echo "Create/select the web app in PythonAnywhere first, then rerun." >&2
    exit 2
  }
  if [[ -f "$WSGI_FILE" ]]; then
    cp -p "$WSGI_FILE" "$WSGI_FILE.backup.$(date +%Y%m%d-%H%M%S)"
  fi
  tmp="$(mktemp)"
  cat > "$tmp" <<EOF
import sys
import site
site.addsitedir("$VENV_DIR/lib/python$py_minor/site-packages")
sys.path.insert(0, "$APP_DIR")
from application import app as application
EOF
  install -m 0644 "$tmp" "$WSGI_FILE"
  rm -f "$tmp"

  cat <<EOF
Staging WSGI file installed at: $WSGI_FILE
Next: PythonAnywhere Dashboard -> Web -> fazilatma.pythonanywhere.com -> Reload.
Then run: bash $APP_DIR/install_and_smoke_test.sh --test-live
Expected for this incomplete staging UI: /api/port-status and / are HTTP 200; deployable remains false.
EOF
}

test_live() {
  command -v curl >/dev/null || { echo "curl is required" >&2; exit 2; }
  status_json="$(mktemp)"
  root_body="$(mktemp)"
  trap 'rm -f "$status_json" "$root_body"' EXIT

  status_code="$(curl --silent --show-error --max-time 30 -o "$status_json" -w '%{http_code}' "$LIVE_URL/api/port-status")"
  if [[ "$status_code" != "200" ]]; then
    echo "Port-status request failed: HTTP $status_code ($LIVE_URL/api/port-status)" >&2
    cat "$status_json" >&2 || true
    exit 1
  fi
  python3 - "$status_json" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    d = json.load(f)
assert d.get("source", {}).get("version") == "10.599", d
assert d.get("source", {}).get("branch") == "arena/01a0ebf7-new", d
assert d.get("deployable") is False, d
print("Status OK:", d["source"]["branch"], "v" + d["source"]["version"], "(migration still gated)")
PY

  root_code="$(curl --silent --show-error --max-time 30 -o "$root_body" -w '%{http_code}' "$LIVE_URL/")"
  if [[ "$root_code" != "200" ]]; then
    echo "Expected the initial staging dashboard to return HTTP 200, got HTTP $root_code" >&2
    cat "$root_body" >&2 || true
    exit 1
  fi
  if ! grep -q 'Scraper |' "$root_body"; then
    echo "Root responded but the staging dashboard title was not found." >&2
    exit 1
  fi
  echo "Initial dashboard OK: root is HTTP 200; full scraper parity remains incomplete."
}

case "${1:-}" in
  --install-staging) install_staging ;;
  --test-live) test_live ;;
  *) usage; exit 2 ;;
esac
