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

# This fork. The old amphp repo has no ui_bridge.py or ui/, so installing
# from it leaves the dashboard at /ui returning 404.
BRANCH="${BRANCH:-arena/01a0bd3f-new}"
REPO_URL="${REPO_URL:-https://github.com/fazilatma/new.git}"
# The app lives in a subdirectory of the repo.
SRC_SUBDIR="${SRC_SUBDIR:-python-scraper4}"
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
  SRC="${HOME_REAL}/scraper4-src"
  VENV="${HOME_REAL}/scraper4-venv"
  RUN="${HOME_REAL}/storage/shared/codes/scraper4"
elif is_vps; then
  ROLE="vps"; SRC="/opt/scraper4-src"; RUN="/opt/scraper4"; VENV="${RUN}/venv"
else
  ROLE="linux"; SRC="${HOME}/scraper4-src"; RUN="${HOME}/scraper4"; VENV="${RUN}/venv"
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
  SRC="${HOME_REAL}/scraper4-src"
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
    fail "repo is on shared storage ($SRC). Use Termux home: $HOME/scraper4-src"
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

# install_chromium_mirror_inline <cache-dir> — self-contained mirror fallback.
# cdn.playwright.dev is geo-blocked for Iranian IPs. This reads the exact
# versions `playwright install --dry-run` asks for and downloads the identical
# Chrome-for-Testing builds from mirrors that work from Iran, placing them in
# the cache with the layout Playwright expects. Nothing external is sourced:
# the whole logic lives in this installer on purpose.
install_chromium_mirror_inline() (
  set -uo pipefail
  CACHE="$1"
  PY="$2"
  MIRRORS=("https://cdn.npmmirror.com/binaries" "https://registry.npmmirror.com/-/binary" "https://mirrors.huaweicloud.com" "https://mirror.nju.edu.cn")
  if [ -n "${MIRROR:-}" ]; then MIRRORS=("$MIRROR"); fi
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  command -v unzip >/dev/null 2>&1 || { apt-get install -y unzip >/dev/null 2>&1 || true; }
  echo "Mirror fallback: mirrors = ${MIRRORS[*]}"
  PLAN="$("$PY" -m playwright install --dry-run chromium 2>/dev/null)"
  if [ -z "$PLAN" ]; then
    echo "  ERROR: 'playwright install --dry-run' produced no plan." >&2
    return 1
  fi
  CFT_VER="$(printf '%s' "$PLAN" | grep -oP 'Chrome for Testing \K[0-9.]+' | head -1)"
  CHROMIUM_BUILD="$(printf '%s' "$PLAN" | grep -oP 'playwright chromium v\K[0-9]+' | head -1)"
  SHELL_BUILD="$(printf '%s' "$PLAN" | grep -oP 'playwright chromium-headless-shell v\K[0-9]+' | head -1)"
  FFMPEG_BUILD="$(printf '%s' "$PLAN" | grep -oP 'playwright ffmpeg v\K[0-9]+' | head -1)"
  : "${SHELL_BUILD:=$CHROMIUM_BUILD}"
  if [ -z "$CFT_VER" ] || [ -z "$CHROMIUM_BUILD" ]; then
    echo "  ERROR: could not parse the required versions. Raw plan:" >&2
    printf '%s\n' "$PLAN" >&2
    return 1
  fi
  echo "  Required: Chrome for Testing $CFT_VER (build $CHROMIUM_BUILD)"
  fetch() { curl -fL --retry 3 --retry-delay 2 --connect-timeout 20 --max-time 900 -o "$2" "$1" 2>/dev/null; }
  install_zip() {
    url="$1"; dirname="$2"; inner="$3"; marker="$4"
    dest="$CACHE/$dirname"
    if [ -f "$dest/$inner/$marker" ]; then echo "  already present: $dirname"; return 0; fi
    echo "  downloading $dirname ..."
    zip="$TMP/$dirname.zip"; got=0
    for base in "${MIRRORS[@]}"; do
      if fetch "${base}/${url}" "$zip"; then got=1; break; fi
    done
    if [ "$got" -ne 1 ]; then echo "    FAILED on every mirror: $url" >&2; return 1; fi
    mkdir -p "$dest"
    unzip -q -o "$zip" -d "$dest" || { echo "    unzip failed" >&2; return 1; }
    rm -f "$zip"
    # Playwright marks a finished download with this marker file.
    : > "$dest/INSTALLATION_COMPLETE"
    chmod -R a+rX "$dest" 2>/dev/null || true
    [ -f "$dest/$inner/$marker" ] && chmod +x "$dest/$inner/$marker" 2>/dev/null || true
    if [ -f "$dest/$inner/$marker" ]; then echo "    ok -> $dest/$inner/$marker"; return 0; fi
    echo "    WARNING: expected $inner/$marker inside the archive" >&2
    return 1
  }
  FAILED=0
  install_zip "chrome-for-testing/$CFT_VER/linux64/chrome-linux64.zip" \
    "chromium-$CHROMIUM_BUILD" "chrome-linux64" "chrome" || FAILED=1
  install_zip "chrome-for-testing/$CFT_VER/linux64/chrome-headless-shell-linux64.zip" \
    "chromium_headless_shell-$SHELL_BUILD" "chrome-headless-shell-linux64" \
    "chrome-headless-shell" || FAILED=1
  if [ -n "$FFMPEG_BUILD" ]; then
    dest="$CACHE/ffmpeg-$FFMPEG_BUILD"
    if [ ! -e "$dest/ffmpeg-linux" ]; then
      echo "  downloading ffmpeg-$FFMPEG_BUILD (optional) ..."
      ffok=0
      for base in "${MIRRORS[@]}"; do
        fetch "$base/playwright/builds/ffmpeg/$FFMPEG_BUILD/ffmpeg-linux.zip" "$TMP/ff.zip" && { ffok=1; break; }
      done
      if [ "$ffok" -eq 1 ]; then
        mkdir -p "$dest" && unzip -q -o "$TMP/ff.zip" -d "$dest" && \
          : > "$dest/INSTALLATION_COMPLETE" && chmod +x "$dest/ffmpeg-linux" 2>/dev/null
      fi
    fi
  fi
  echo "  Installing OS libraries Chromium needs ..."
  apt-get update -qq >/dev/null 2>&1 || sudo -n apt-get update -qq >/dev/null 2>&1 || true
  "$PY" -m playwright install-deps chromium >/dev/null 2>&1 \
    || { apt-get install -y libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
           libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
           libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 >/dev/null 2>&1 \
         || sudo -n apt-get install -y libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 \
              libcups2t64 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
              libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64 >/dev/null 2>&1; } \
    || echo "  (could not install system libs automatically)"
  echo "  Verifying launch ..."
  "$PY" - <<'PYLAUNCH'
import sys
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("  playwright is not installed"); sys.exit(1)
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
        p = b.new_page(); p.set_content("<h1>ok</h1>")
        ok = p.inner_text("h1") == "ok"; b.close()
        print("  launch test:", "PASS" if ok else "unexpected")
        sys.exit(0 if ok else 3)
except Exception as exc:
    print("  launch test: FAILED -", str(exc)[:160]); sys.exit(3)
PYLAUNCH
  rc=$?
  [ "$rc" -eq 0 ] && [ "$FAILED" -eq 0 ] && return 0
  echo "  Mirrors did not produce a working browser - trying the system Chromium..."
  apt-get install -y chromium >/dev/null 2>&1 || apt-get install -y chromium-browser >/dev/null 2>&1 \
    || snap install chromium >/dev/null 2>&1 || true
  for cand in /usr/bin/chromium /usr/bin/chromium-browser /snap/bin/chromium \
              /usr/bin/google-chrome-stable /usr/bin/google-chrome; do
    [ -x "$cand" ] && { echo "  found system browser: $cand (the app picks it up automatically)"; return 0; }
  done
  return 1
)

ensure_browser() {
  # A fresh server used to stay browser-less: without a real Chromium the
  # extraction could never fall back to a browser render, so anti-bot pages
  # and emalls' duplicate-page shell stayed unrescued. Fully self-contained:
  # official CDN first, inline mirror fallback, system Chromium last.
  "$PY" -c "import playwright" 2>/dev/null || { echo "playwright (pip) missing - cannot install Chromium"; return 0; }
  local BP="${PLAYWRIGHT_BROWSERS_PATH:-}"
  if [ -z "$BP" ]; then
    if [ -d /var/www/html/.wconsole_data/cache ]; then
      BP=/var/www/html/.wconsole_data/cache/ms-playwright   # WebConsole persistent cache
    else
      BP="${HOME}/.cache/ms-playwright"                     # default the app also scans on VPS
    fi
  fi
  export PLAYWRIGHT_BROWSERS_PATH="$BP"
  if [ -n "$(find "$BP" -mindepth 2 -maxdepth 4 -type f \( -name chrome -o -name chrome-headless-shell \) 2>/dev/null | head -n1)" ]; then
    echo "Chromium already installed at ${BP}"
    return 0
  fi
  echo "Installing Playwright Chromium into ${BP} (one-time download)..."
  PLAYWRIGHT_BROWSERS_PATH="$BP" "$PY" -m playwright install chromium \
    || echo "Official download failed (cdn.playwright.dev is blocked in Iran) - switching to mirrors..."
  if [ -z "$(find "$BP" -mindepth 2 -maxdepth 4 -type f \( -name chrome -o -name chrome-headless-shell \) 2>/dev/null | head -n1)" ]; then
    install_chromium_mirror_inline "$BP" "$PY" || true
  fi
  if [ -n "$(find "$BP" -mindepth 2 -maxdepth 4 -type f \( -name chrome -o -name chrome-headless-shell \) 2>/dev/null | head -n1)" ]; then
    echo "Chromium OK at ${BP}"
  else
    echo "WARNING: no Chromium binary found - browser rendering stays unavailable."
    echo "  Last resort: sudo apt install -y chromium-browser  (the app also accepts a system Chrome)"
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
  echo "pip optional engines/helpers (aiohttp, dotenv, psutil, selectolax, basalam-sdk)"
  for spec in aiohttp python-dotenv psutil selectolax basalam-sdk; do
    case "$spec" in
      python-dotenv) mod=dotenv ;;
      basalam-sdk) mod=basalam_sdk ;;
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
  # Browser rendering stack (VPS / shared server only): Playwright/Selenium/UC
  # need a desktop Chromium, which Termux cannot run.
  if ! is_termux; then
    echo "pip browser engines (playwright, selenium, undetected-chromedriver)"
    for spec in playwright playwright-stealth selenium undetected-chromedriver; do
      case "$spec" in
        undetected-chromedriver) mod=undetected_chromedriver ;;
        playwright-stealth) mod=playwright_stealth ;;
        *) mod="$spec" ;;
      esac
      if "$PY" -c "import ${mod}" 2>/dev/null; then
        echo "  ${mod}: already installed"
        continue
      fi
      echo "  pip install ${spec}"
      "$PY" -m pip install "$spec" || echo "  ${spec}: skipped (no wheel/build on this device)"
    done
    ensure_browser
  else
    echo "Termux: browser engines skipped (no desktop Chromium on Android)"
  fi
  if ! "$PY" -c "import pywebpush,cryptography" 2>/dev/null; then
    echo "pip optional Web Push (pywebpush, cryptography)"
    "$PY" -m pip install pywebpush cryptography \
      || echo "  Web Push skipped (other API/PWA features remain available)"
  fi
  "$PY" -c "import importlib
for n in ('httpx','cloudscraper','curl_cffi','pywebpush','cryptography'):
    try:
        importlib.import_module(n); print('fetch engine ready:', n)
    except ImportError:
        print('fetch engine missing:', n)
"
}

sync_code() {
  # Files live under python-scraper4/ in this repo; fall back to the repo root
  # so an older flat checkout still works.
  APP="${SRC}/${SRC_SUBDIR}"
  [ -f "${APP}/scraper4.py" ] || APP="$SRC"
  [ -f "${APP}/scraper4.py" ] || fail "scraper4 missing in ${SRC}"
  [ -f "${APP}/deployer4.py" ] || fail "deployer4 missing in ${SRC}"
  cp -a "${APP}/"*.py "$RUN/"
  # Keep the parity manifest and UI assets beside the Python extension modules.
  if [ -f "${APP}/ui_bridge.py" ] && [ -f "${APP}/parity_ext.py" ] && [ -d "${APP}/ui" ]; then
    cp -a "${APP}/ui_bridge.py" "${APP}/parity_ext.py" "$RUN/"
    [ -f "${APP}/parity-manifest.json" ] && cp -a "${APP}/parity-manifest.json" "$RUN/"
    rm -rf "${RUN}/ui"
    cp -a "${APP}/ui" "${RUN}/ui"
  else
    echo "WARNING: parity Python modules or ui/ missing — /ui and Node-compatible APIs will not be available." >&2
  fi
  [ -f "${APP}/ai_providers.json" ] && [ ! -f "${RUN}/ai_providers.json" ] \
    && cp -a "${APP}/ai_providers.json" "$RUN/" || true
  find "$RUN" -name '*.pyc' -delete 2>/dev/null || true
  find "$RUN" -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
  "$PY" -m py_compile "${RUN}/scraper4.py" "${RUN}/deployer4.py" \
    "${RUN}/ui_bridge.py" "${RUN}/parity_ext.py" || fail "py_compile failed"
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
