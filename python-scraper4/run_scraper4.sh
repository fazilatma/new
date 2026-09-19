#!/usr/bin/env bash
# run_scraper4.sh — install AND update to latest, Termux (phone) or VPS.
# Detects the machine. One command does clone/fetch, copy, restart.
#
# Termux:  bash ~/amphp/run_scraper4.sh
# VPS:     bash /opt/amphp/run_scraper4.sh
#
# Phone files: ~/storage/shared/codes/scraper4
# Phone:   http://127.0.0.1:8000/   and  http://127.0.0.1:8001/
# VPS:     http://37.32.5.36/put/   and  http://37.32.5.36/deploy/
set -u
umask 077

BRANCH="${BRANCH:-arena/01a06ac3-amphp}"
REPO_URL="https://github.com/fazilatma/amphp.git"
CMD="${1:-update}"

is_termux() {
  [ -n "${TERMUX_VERSION:-}" ] || [ -d /data/data/com.termux/files/usr ] || [ "${PREFIX:-}" = "/data/data/com.termux/files/usr" ]
}
is_vps() {
  [ "$(id -u 2>/dev/null || echo 1)" = "0" ] && command -v systemctl >/dev/null 2>&1 && [ -d /opt ]
}
fail() { echo "ERROR: $*" >&2; exit 1; }

is_shared_fs() {
  case "$1" in
    /sdcard/*|/storage/*|/mnt/*|*/storage/shared/*|*/storage/emulated/*) return 0 ;;
  esac
  return 1
}

if is_termux; then
  ROLE="termux"
  if [ -d /data/data/com.termux/files/home ]; then
    HOME_REAL="/data/data/com.termux/files/home"
  else
    HOME_REAL="${HOME}"
  fi
  SRC="${HOME_REAL}/amphp"
  VENV="${HOME_REAL}/scraper4-venv"
  RUN="${HOME_REAL}/storage/shared/codes/scraper4"
elif is_vps; then
  ROLE="vps"; SRC="/opt/amphp"; RUN="/opt/scraper4"; VENV="${RUN}/venv"
else
  ROLE="linux"; SRC="${HOME}/amphp"; RUN="${HOME}/scraper4"; VENV="${RUN}/venv"
fi
PY="${VENV}/bin/python"

require_writable() {
  mkdir -p "$1" || fail "cannot create $1"
  if ! touch "$1/.s4-write" 2>/dev/null; then
    fail "read-only path: $1  (on Termux use $HOME not /sdcard)"
  fi
  rm -f "$1/.s4-write"
  chmod -R u+w "$1" 2>/dev/null || true
}

termux_prepare() {
  [ "$ROLE" = "termux" ] || return 0
  SHARED="${HOME_REAL}/storage/shared"
  if [ ! -d "$SHARED" ]; then
    mkdir -p "${HOME_REAL}/storage"
    if [ -d /sdcard ]; then
      ln -sfn /sdcard "$SHARED"
    elif [ -d /storage/emulated/0 ]; then
      ln -sfn /storage/emulated/0 "$SHARED"
    else
      echo "Run this once in Termux, then Allow:  termux-setup-storage"
    fi
  fi
  mkdir -p "${SHARED}/codes" || fail "cannot create storage/shared/codes — run: termux-setup-storage"
  RUN="${SHARED}/codes/scraper4"
  VENV="${HOME_REAL}/scraper4-venv"
  PY="${VENV}/bin/python"
  SRC="${HOME_REAL}/amphp"
  if [ -L "$SRC" ]; then
    echo "Removing symlink $SRC (git stays in Termux home)"
    rm -f "$SRC"
  fi
  require_writable "$HOME_REAL"
  require_writable "$SRC"
  require_writable "$VENV"
  require_writable "$RUN"
  echo "Git:  $SRC"
  echo "App:  $RUN"
  echo "Data: ${RUN}/scraper4_data.json"
  export SCRAPER_DATA_FILE="${RUN}/scraper4_data.json"
  export DEPLOYER_DATA_FILE="${RUN}/deployer4_data.json"
  export SCRAPER_ERROR_LOG="${RUN}/scraper4-errors.jsonl"
  for old in \
      "${HOME_REAL}/scraper4/scraper4_data.json" \
      "${SHARED}/scraper4/scraper4_data.json"
  do
    if [ -f "$old" ] && [ ! -f "${RUN}/scraper4_data.json" ]; then
      echo "Copying backup data from $old"
      cp -f "$old" "${RUN}/scraper4_data.json" || true
    fi
  done
}

fetch_latest() {
  command -v git >/dev/null 2>&1 || fail "git is missing"
  require_writable "$(dirname "$SRC")"
  require_writable "$SRC"
  if is_shared_fs "$SRC"; then
    fail "repo is on shared storage ($SRC). Use Termux home: $HOME/amphp"
  fi
  if [ ! -d "${SRC}/.git" ]; then
    echo "Install: clone ${BRANCH} -> ${SRC}"
    rm -rf "${SRC}.tmp"
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "${SRC}.tmp" || fail "git clone failed (need network)"
    rm -rf "$SRC"
    mv "${SRC}.tmp" "$SRC"
    return 0
  fi
  echo "Update: fetch origin ${BRANCH}"
  chmod -R u+w "$SRC" 2>/dev/null || true
  git -C "$SRC" config core.fileMode false 2>/dev/null || true
  if git -C "$SRC" fetch --depth 1 origin "$BRANCH"; then
    git -C "$SRC" reset --hard FETCH_HEAD || fail "git reset failed (path not writable: $SRC)"
    echo "Git now: $(git -C "$SRC" log -1 --oneline)"
  else
    echo "WARNING: fetch failed — using files already in ${SRC} (offline)."
  fi
}

ensure_venv() {
  mkdir -p "$RUN"
  command -v python3 >/dev/null 2>&1 || fail "python3 is missing"
  if [ ! -x "$PY" ]; then
    python3 -m venv "$VENV" || fail "venv create failed"
  fi
  if ! "$PY" -c "import flask,gunicorn,requests,bs4,lxml" 2>/dev/null; then
    echo "pip: flask gunicorn requests beautifulsoup4 lxml (network this once)"
    "$PY" -m pip install flask gunicorn requests beautifulsoup4 lxml || fail "pip install failed"
  fi
  # Selector/preview quality. Each package is separate so a failed wheel
  # (curl_cffi often has none on Termux) does not skip the rest.
  # Playwright/Selenium need desktop Chromium — not installed on the phone.
  echo "pip optional fetch engines (httpx, cloudscraper, curl_cffi)"
  for spec in "httpx[http2]" cloudscraper curl_cffi; do
    case "$spec" in
      httpx*) mod=httpx ;;
      *) mod="$spec" ;;
    esac
    if "$PY" -c "import ${mod}" 2>/dev/null; then
      echo "  ${mod}: already installed"
      continue
    fi
    echo "  pip install ${spec}"
    if "$PY" -m pip install "$spec"; then
      echo "  ${mod}: OK"
    else
      echo "  ${mod}: skipped (no wheel/build on this device)"
    fi
  done
  "$PY" -c "import importlib
for n in ('httpx','cloudscraper','curl_cffi'):
    try:
        importlib.import_module(n); print('fetch engine ready:', n)
    except ImportError:
        print('fetch engine missing:', n)
"
}

sync_code() {
  [ -f "${SRC}/scraper4.py" ] || fail "scraper4 missing in ${SRC}"
  [ -f "${SRC}/deployer4.py" ] || fail "deployer4 missing in ${SRC}"
  cp -a "${SRC}/"*.py "$RUN/"
  find "$RUN" -name '*.pyc' -delete 2>/dev/null || true
  find "$RUN" -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
  "$PY" -m py_compile "${RUN}/scraper4.py" "${RUN}/deployer4.py" || fail "py_compile failed"
  "$PY" - <<'PY'
import re, pathlib, os
run=os.environ.get("S4_RUN",".")
text=pathlib.Path(run,"scraper4.py").read_text(encoding="utf-8", errors="replace")
m=re.search(r'^APP_VERSION\s*=\s*["\']([^"\']+)', text, re.M)
d=re.search(r'^DEPLOYER_VERSION\s*=\s*["\']([^"\']+)', pathlib.Path(run,"deployer4.py").read_text(encoding="utf-8", errors="replace"), re.M)
print("Installed scraper", m.group(1) if m else "?", "deployer", d.group(1) if d else "?")
PY
}

termux_pkgs() {
  command -v python3 >/dev/null 2>&1 && command -v git >/dev/null 2>&1 && return 0
  command -v pkg >/dev/null 2>&1 || fail "Termux pkg not found"
  pkg update -y
  pkg install -y python git
}

pid_for() { pgrep -f "gunicorn.*${1}:application" 2>/dev/null | head -n1 || true; }

stop_local() {
  pkill -f "gunicorn.*scraper4:application" 2>/dev/null || true
  pkill -f "gunicorn.*deployer4:application" 2>/dev/null || true
  sleep 1
}

start_local() {
  stop_local
  export PYTHONUNBUFFERED=1
  export SCRAPER_RUNTIME=vps
  export SCRAPER_URL_PREFIX="${SCRAPER_URL_PREFIX:-}"
  export SCRAPER_AUTO_UPDATE=0
  export DEPLOYER_AUTO_UPDATE=0
  export DEPLOYER_AUTO_START=0
  export DEPLOYER_TARGET="${RUN}/scraper4.py"
  export DEPLOYER_GIT_DIR="$SRC"
  export SCRAPER_DATA_FILE="${RUN}/scraper4_data.json"
  export DEPLOYER_DATA_FILE="${RUN}/deployer4_data.json"
  export SCRAPER_ERROR_LOG="${RUN}/scraper4-errors.jsonl"
  cd "$RUN" || fail "cd ${RUN}"
  nohup "$PY" -m gunicorn --bind 0.0.0.0:8000 --workers 1 --threads 4 --timeout 0 --graceful-timeout 30 scraper4:application \
    >"${RUN}/scraper4.log" 2>&1 &
  nohup "$PY" -m gunicorn --bind 0.0.0.0:8001 --workers 1 --threads 2 --timeout 120 deployer4:application \
    >"${RUN}/deployer4.log" 2>&1 &
  sleep 2
  echo "Scraper  PID $(pid_for scraper4 || echo '?')  ${RUN}/scraper4.log"
  echo "Deployer PID $(pid_for deployer4 || echo '?')  ${RUN}/deployer4.log"
}

print_phone_urls() {
  echo "============================================================"
  echo "PHONE browser (same device):"
  echo "  Scraper  http://127.0.0.1:8000/"
  echo "  Deployer http://127.0.0.1:8001/"
  LAN="$(ip -4 -o addr show 2>/dev/null | awk '!/127.0.0.1/ {print $4}' | cut -d/ -f1 | head -n1 || true)"
  if [ -n "${LAN:-}" ]; then
    echo "Other device on same Wi-Fi:"
    echo "  Scraper  http://${LAN}:8000/"
    echo "  Deployer http://${LAN}:8001/"
  fi
  echo "============================================================"
}

install_or_update_vps() {
  if ! command -v git >/dev/null 2>&1 || ! command -v python3 >/dev/null 2>&1; then
    command -v apt-get >/dev/null 2>&1 && apt-get install -y git python3 python3-venv python3-pip apache2
  fi
  a2enmod proxy proxy_http headers >/dev/null 2>&1 || true
  mkdir -p /opt /opt/scraper4
  SRC=/opt/amphp; RUN=/opt/scraper4; VENV="${RUN}/venv"; PY="${VENV}/bin/python"
  fetch_latest
  if [ "${S4_REEXEC:-0}" != 1 ] && [ -f /opt/amphp/run_scraper4.sh ]; then
    echo "Re-run latest script from /opt/amphp"
    export S4_REEXEC=1
    exec bash /opt/amphp/run_scraper4.sh "$CMD"
  fi
  ensure_venv
  S4_RUN="$RUN" sync_code
  cp -a /opt/amphp/deploy/scraper4.service /etc/systemd/system/scraper4.service
  cp -a /opt/amphp/deploy/deployer4.service /etc/systemd/system/deployer4.service
  cp -a /opt/amphp/deploy/scraper4.apache.conf /etc/apache2/conf-available/scraper4-put.conf
  a2enconf scraper4-put >/dev/null 2>&1 || true
  systemctl daemon-reload
  systemctl enable scraper4 deployer4
  systemctl restart scraper4 deployer4
  systemctl reload apache2 || true
  echo "============================================================"
  echo "VPS:"
  echo "  Scraper  http://37.32.5.36/put/"
  echo "  Deployer http://37.32.5.36/deploy/"
  echo "  Apache / stays PHP"
  echo "============================================================"
  curl -sS http://127.0.0.1:8000/health || true; echo
  curl -sS http://127.0.0.1:8001/health || true; echo
}

do_update() {
  if [ "$ROLE" = "vps" ]; then
    install_or_update_vps
    return
  fi
  [ "$ROLE" = "termux" ] && termux_pkgs
  termux_prepare
  fetch_latest
  if [ "${S4_REEXEC:-0}" != 1 ] && [ -f "${SRC}/run_scraper4.sh" ]; then
    echo "Re-run latest script from ${SRC}"
    export S4_REEXEC=1
    exec bash "${SRC}/run_scraper4.sh" "$CMD"
  fi
  ensure_venv
  S4_RUN="$RUN" sync_code
  start_local
  print_phone_urls
}

status_local() {
  echo "role=${ROLE} src=${SRC} run=${RUN}"
  echo -n "scraper:  "; pid_for scraper4 || echo stopped
  echo -n "deployer: "; pid_for deployer4 || echo stopped
  if is_vps; then systemctl --no-pager --full status scraper4 deployer4 | sed -n '1,24p' || true; fi
}

case "$CMD" in
  stop)
    if is_vps; then systemctl stop scraper4 deployer4 || true; fi
    stop_local
    ;;
  status) status_local ;;
  start|install|update|"") do_update ;;
  *)
    echo "Usage: bash run_scraper4.sh [update|stop|status]"
    exit 1
    ;;
esac
