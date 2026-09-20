#!/usr/bin/env bash
# Install Playwright's Chromium from mirrors that work from Iran.
#
# Why this exists
# ---------------
#   venv/bin/python -m playwright install chromium
#
# downloads from cdn.playwright.dev, which is geo-blocked for Iranian IPs, so
# the command fails with "Download failure, code=1" and the browser engines
# stay unusable.
#
# Playwright >= 1.58 fetches Chromium from a `builds/cft/<version>/...` path
# that the usual npmmirror Playwright mirror does NOT carry, so simply setting
# PLAYWRIGHT_DOWNLOAD_HOST is not enough for Chromium (it still works for
# ffmpeg). npmmirror does host the identical Chrome-for-Testing binaries under
# a different prefix, so this script downloads the exact artifacts Playwright
# asked for and places them in the cache with the layout it expects.
#
# Nothing is hardcoded: the required versions are read from
# `playwright install --dry-run`, so this keeps working after an upgrade.
#
# Usage (as root on the VPS):
#   bash python-scraper4/tools/install_chromium_mirror.sh
#
# Optional:
#   VENV=/opt/scraper4/venv     python env that has playwright installed
#   MIRROR=https://...          override the base mirror
set -uo pipefail

VENV="${VENV:-/opt/scraper4/venv}"
PY="$VENV/bin/python"
[ -x "$PY" ] || PY="$(command -v python3)"
MIRROR="${MIRROR:-https://cdn.npmmirror.com/binaries}"
CACHE="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

command -v unzip >/dev/null || { apt-get install -y unzip >/dev/null 2>&1 || true; }

echo "Playwright Chromium installer (mirror mode)"
echo "  python : $PY"
echo "  cache  : $CACHE"
echo "  mirror : $MIRROR"
echo

PLAN="$("$PY" -m playwright install --dry-run chromium 2>/dev/null)"
if [ -z "$PLAN" ]; then
  echo "ERROR: could not run 'playwright install --dry-run'." >&2
  echo "       Is playwright installed in $VENV ?" >&2
  exit 1
fi

# "Chrome for Testing 153.0.8010.12 (playwright chromium v1243)"
CFT_VER="$(printf '%s' "$PLAN" | grep -oP 'Chrome for Testing \K[0-9.]+' | head -1)"
CHROMIUM_BUILD="$(printf '%s' "$PLAN" | grep -oP 'playwright chromium v\K[0-9]+' | head -1)"
SHELL_BUILD="$(printf '%s' "$PLAN" | grep -oP 'playwright chromium-headless-shell v\K[0-9]+' | head -1)"
FFMPEG_BUILD="$(printf '%s' "$PLAN" | grep -oP 'playwright ffmpeg v\K[0-9]+' | head -1)"
: "${SHELL_BUILD:=$CHROMIUM_BUILD}"

if [ -z "$CFT_VER" ] || [ -z "$CHROMIUM_BUILD" ]; then
  echo "ERROR: could not parse the required versions. Raw plan:" >&2
  printf '%s\n' "$PLAN" >&2
  exit 1
fi

echo "Required: Chrome for Testing $CFT_VER (build $CHROMIUM_BUILD)"
echo

fetch() {  # fetch <url> <dest> ; tries a few times, quietly fails
  curl -fL --retry 3 --retry-delay 2 --connect-timeout 20 --max-time 900 \
       -o "$2" "$1" 2>/dev/null
}

# install_zip <url> <cache-dir-name> <expected-inner-dir> <marker-file>
install_zip() {
  local url="$1" dirname="$2" inner="$3" marker="$4"
  local dest="$CACHE/$dirname"
  if [ -f "$dest/$inner/$marker" ]; then
    echo "  already present: $dirname"
    return 0
  fi
  echo "  downloading $dirname …"
  local zip="$TMP/$dirname.zip"
  if ! fetch "$url" "$zip"; then
    echo "    FAILED: $url" >&2
    return 1
  fi
  mkdir -p "$dest"
  unzip -q -o "$zip" -d "$dest" || { echo "    unzip failed" >&2; return 1; }
  rm -f "$zip"
  # Playwright marks a browser as complete with this file; without it the
  # installer considers the download unfinished and tries the CDN again.
  : > "$dest/INSTALLATION_COMPLETE"
  chmod -R a+rX "$dest" 2>/dev/null || true
  [ -f "$dest/$inner/$marker" ] && chmod +x "$dest/$inner/$marker" 2>/dev/null || true
  if [ -f "$dest/$inner/$marker" ]; then
    echo "    ok -> $dest/$inner/$marker"
    return 0
  fi
  echo "    WARNING: expected $inner/$marker inside the archive" >&2
  find "$dest" -maxdepth 2 -type f -name 'chrome*' | head -3 >&2
  return 1
}

FAILED=0
install_zip \
  "$MIRROR/chrome-for-testing/$CFT_VER/linux64/chrome-linux64.zip" \
  "chromium-$CHROMIUM_BUILD" "chrome-linux64" "chrome" || FAILED=1

install_zip \
  "$MIRROR/chrome-for-testing/$CFT_VER/linux64/chrome-headless-shell-linux64.zip" \
  "chromium_headless_shell-$SHELL_BUILD" "chrome-headless-shell-linux64" \
  "chrome-headless-shell" || FAILED=1

if [ -n "$FFMPEG_BUILD" ]; then
  # ffmpeg still lives under the classic playwright path, which npmmirror does
  # mirror. It is optional (only used for video capture), so never fatal.
  dest="$CACHE/ffmpeg-$FFMPEG_BUILD"
  if [ ! -e "$dest/ffmpeg-linux" ]; then
    echo "  downloading ffmpeg-$FFMPEG_BUILD …"
    if fetch "$MIRROR/playwright/builds/ffmpeg/$FFMPEG_BUILD/ffmpeg-linux.zip" "$TMP/ff.zip"; then
      mkdir -p "$dest" && unzip -q -o "$TMP/ff.zip" -d "$dest" && \
        : > "$dest/INSTALLATION_COMPLETE" && chmod +x "$dest/ffmpeg-linux" 2>/dev/null
      echo "    ok"
    else
      echo "    skipped (optional)"
    fi
  fi
fi

echo
echo "Installing OS libraries Chromium needs …"
"$PY" -m playwright install-deps chromium >/dev/null 2>&1 \
  || apt-get install -y libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
       libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
       libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 >/dev/null 2>&1 \
  || echo "  (could not install system libs automatically)"

echo
echo "Verifying …"
"$PY" - <<'PYEOF'
import os, sys
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("  playwright is not installed in this environment"); sys.exit(1)
try:
    with sync_playwright() as pw:
        path = pw.chromium.executable_path
        print("  expected binary:", path)
        print("  exists         :", os.path.isfile(path))
        if not os.path.isfile(path):
            sys.exit(2)
        b = pw.chromium.launch(headless=True, args=["--no-sandbox",
                                                    "--disable-dev-shm-usage"])
        p = b.new_page(); p.set_content("<h1>ok</h1>")
        title = p.inner_text("h1"); b.close()
        print("  launch test    :", "PASS" if title == "ok" else "unexpected")
except Exception as exc:  # noqa: BLE001
    print("  launch test    : FAILED —", str(exc)[:200]); sys.exit(3)
PYEOF
rc=$?

echo
if [ "$rc" -eq 0 ] && [ "$FAILED" -eq 0 ]; then
  echo "DONE — Chromium is installed and working."
  echo "Restart the service so the engine list refreshes:"
  echo "  systemctl restart scraper4"
else
  echo "Chromium is still not usable." >&2
  echo "Options:" >&2
  echo "  1) Use the system browser instead (often already installed):" >&2
  echo "       apt-get install -y chromium chromium-browser" >&2
  echo "       then set SCRAPER_BROWSER_PATH=/usr/bin/chromium in the service" >&2
  echo "  2) Try another mirror:" >&2
  echo "       MIRROR=https://registry.npmmirror.com/-/binary bash \$0" >&2
  echo "  3) Download the zips on any machine with access and copy them to" >&2
  echo "       $CACHE/chromium-$CHROMIUM_BUILD/" >&2
  exit 1
fi
