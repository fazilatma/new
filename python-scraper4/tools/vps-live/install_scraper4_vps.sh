#!/usr/bin/env bash
# Install Scraper4 VPS edition on this server.
# Apache keeps PHP on / ; Python UI is http://SERVER/put/
# Run ON THE VPS as root:
#   bash tools/vps-live/install_scraper4_vps.sh
set -euo pipefail

APP_DIR="${SCRAPER_DIR:-/opt/scraper4}"
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="${REPO_DIR}/scraper4.py"
PY="${PYTHON:-python3}"
VENV="$APP_DIR/venv"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root on the VPS." >&2
  exit 1
fi
if [[ ! -f "$SRC" ]]; then
  echo "Missing $SRC" >&2
  exit 1
fi

LOG="/var/log/scraper4-install.log"

# ── survive the SSH session dying ────────────────────────────────────────
# Two things used to kill this install half-way through:
#
#  1. needrestart. With NEEDRESTART_MODE=a it automatically restarts every
#     service whose libraries changed — including ssh. Restarting ssh drops
#     the connection, the shell gets SIGHUP, and apt/pip die mid-transaction.
#  2. Even without that, any network blip hangs up the terminal and takes the
#     script with it, often while dpkg holds its lock.
#
# So: re-exec ourselves under setsid+nohup, detached from the terminal, with
# output teed to $LOG. The install then runs to completion regardless of what
# happens to the SSH session, and can be followed with `tail -f`.
if [[ "${SCRAPER_INSTALL_DETACHED:-0}" != "1" && -t 1 ]]; then
  export SCRAPER_INSTALL_DETACHED=1
  echo "Running the installer detached so an SSH drop cannot interrupt it."
  echo "Log: $LOG"
  echo
  setsid nohup bash "$0" "$@" >>"$LOG" 2>&1 < /dev/null &
  CHILD=$!
  echo "PID $CHILD — following the log (Ctrl-C only stops the log, not the install):"
  echo
  sleep 1
  tail -f --pid="$CHILD" "$LOG" 2>/dev/null || tail -f "$LOG"
  wait "$CHILD" 2>/dev/null || true
  echo
  echo "Installer finished. Full log: $LOG"
  exit 0
fi
# When we re-exec'd ourselves above, stdout is already the log file, so piping
# through tee as well would write every line twice. Only tee when the caller
# ran us directly (no tty, e.g. from cron or the deployer).
if [[ "${SCRAPER_INSTALL_DETACHED:-0}" != "1" ]]; then
  exec > >(tee -a "$LOG") 2>&1
fi
echo "=== scraper4 install started $(date -Is) ==="

export DEBIAN_FRONTEND=noninteractive
# Do NOT use NEEDRESTART_MODE=a here: it restarts ssh and cuts the session.
# 'l' only lists what would be restarted. We then restart the services we
# actually care about ourselves, deliberately leaving ssh alone.
export NEEDRESTART_MODE=l
export NEEDRESTART_SUSPEND=1
# Belt and braces: tell needrestart never to touch ssh, even if some other
# tool invokes it during this install.
if [[ -d /etc/needrestart/conf.d ]]; then
  cat > /etc/needrestart/conf.d/90-scraper4-keep-ssh.conf <<'NR'
# Installed by scraper4: restarting ssh mid-install drops the admin's session
# and leaves a half-finished install behind.
$nrconf{override_rc}{qr(^ssh(d)?\.service$)} = 0;
$nrconf{restart} = 'l';
NR
fi

# dpkg may still be locked by cloud-init or unattended-upgrades on a fresh
# VPS. Waiting is much friendlier than dying on "could not get lock".
for i in $(seq 1 60); do
  if fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 \
     || fuser /var/lib/apt/lists/lock >/dev/null 2>&1; then
    echo "Waiting for another apt/dpkg process to finish ($i/60)…"
    sleep 5
  else
    break
  fi
done

apt-get update -y
apt-get install -y python3 python3-pip python3-venv python3-dev \
  libxml2-dev libxslt1-dev zlib1g-dev gcc \
  apache2 curl ca-certificates unzip snapd

mkdir -p "$APP_DIR"
cp -a "$SRC" "$APP_DIR/scraper4.py"
chmod 755 "$APP_DIR/scraper4.py"
if [[ -f "${REPO_DIR}/deployer4.py" ]]; then
  cp -a "${REPO_DIR}/deployer4.py" "$APP_DIR/deployer4.py"
fi

# Node-parity dashboard: ui_bridge.py registers the Node REST surface and
# serves ui/dashboard.{html,js} at /put/ui. Without these files scraper4.py
# still boots but silently falls back to the classic UI only, so copy them
# alongside the app and fail loudly if they are missing from the checkout.
if [[ ! -f "${REPO_DIR}/ui_bridge.py" || ! -f "${REPO_DIR}/ui/dashboard.html" ]]; then
  echo "Missing ui_bridge.py or ui/dashboard.html in ${REPO_DIR}" >&2
  exit 1
fi
cp -a "${REPO_DIR}/ui_bridge.py" "$APP_DIR/ui_bridge.py"
rm -rf "$APP_DIR/ui"
cp -a "${REPO_DIR}/ui" "$APP_DIR/ui"
chmod 644 "$APP_DIR/ui_bridge.py" "$APP_DIR/ui/"*
if [[ -f "${REPO_DIR}/ai_providers.json" && ! -f "$APP_DIR/ai_providers.json" ]]; then
  cp -a "${REPO_DIR}/ai_providers.json" "$APP_DIR/ai_providers.json"
fi

# Isolated venv — never uninstall Debian pip/blinker RECORD-less packages.
"$PY" -m venv "$VENV"
"$VENV/bin/pip" install --upgrade pip
"$VENV/bin/pip" install flask requests beautifulsoup4 lxml gunicorn
# Official Basalam SDK: the app prefers it and falls back to REST only if
# it is missing, so install it with the core deps rather than the optional
# engine phase (which SKIP_ENGINES=1 skips).
"$VENV/bin/pip" install basalam-sdk || \
  echo "WARNING: basalam-sdk not installed; Basalam will use the REST fallback." >&2

install -m 644 "${REPO_DIR}/deploy/scraper4.service" /etc/systemd/system/scraper4.service
# Older installs predate SCRAPER_AUTO_UPDATE=0 and would let the service pull
# the upstream scraper4.py over this fork, silently removing /ui. The unit file
# above already carries the setting; assert it so a stale hand-edited copy or a
# drop-in override cannot bring the problem back.
if ! grep -q '^Environment=SCRAPER_AUTO_UPDATE=0' /etc/systemd/system/scraper4.service; then
  sed -i '/^Environment=PORT=8000/a Environment=SCRAPER_AUTO_UPDATE=0' \
    /etc/systemd/system/scraper4.service
fi
# The app runs from $APP_DIR, which is a plain copy — not a git repo. Record
# where the checkout actually is so the minute-by-minute git updater can find
# it instead of guessing. GIT_REPO_DIR is the checkout root (one level above
# python-scraper4/).
GIT_REPO_DIR="$(cd "${REPO_DIR}/.." && pwd)"
if [[ -d "${GIT_REPO_DIR}/.git" ]]; then
  sed -i '/^Environment=SCRAPER_REPO_DIR=/d' /etc/systemd/system/scraper4.service
  sed -i "/^Environment=SCRAPER_AUTO_UPDATE=0/a Environment=SCRAPER_REPO_DIR=${GIT_REPO_DIR}" \
    /etc/systemd/system/scraper4.service
  echo "Git auto-update will track: ${GIT_REPO_DIR}"
else
  echo "NOTE: ${GIT_REPO_DIR} is not a git checkout; minute-by-minute" \
       "auto-update will be inactive. Clone the repo with git to enable it."
fi
if [[ -f "${REPO_DIR}/deploy/deployer4.service" ]]; then
  install -m 644 "${REPO_DIR}/deploy/deployer4.service" /etc/systemd/system/deployer4.service
  # Same hazard as scraper4's own updater: older deployer4 units shipped
  # DEPLOYER_AUTO_UPDATE=1 and reinstall scraper4.py from upstream every few
  # minutes, erasing the dashboard. Force it off on pre-existing unit files.
  sed -i 's/^Environment=DEPLOYER_AUTO_UPDATE=1/Environment=DEPLOYER_AUTO_UPDATE=0/; s/^Environment=DEPLOYER_SEARCH_ALL=1/Environment=DEPLOYER_SEARCH_ALL=0/' \
    /etc/systemd/system/deployer4.service
fi
# Drop-in overrides and saved deployer state can re-enable auto-update behind
# the unit file's back; clear both so a reinstall is actually a clean slate.
rm -f /etc/systemd/system/scraper4.service.d/*auto*.conf \
      /etc/systemd/system/deployer4.service.d/*auto*.conf 2>/dev/null || true
if [[ -f /opt/scraper4/deployer4_state.json ]]; then
  "$PY" - <<'PY' || true
import json, pathlib
p = pathlib.Path("/opt/scraper4/deployer4_state.json")
try:
    state = json.loads(p.read_text(encoding="utf-8"))
except Exception:
    raise SystemExit(0)
if isinstance(state, dict) and state.get("auto_update"):
    state["auto_update"] = False
    p.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Disabled auto_update in saved deployer4 state.")
PY
fi
systemctl daemon-reload
systemctl enable scraper4.service
systemctl restart scraper4.service
if [[ -f /etc/systemd/system/deployer4.service ]]; then
  systemctl enable deployer4.service
  systemctl restart deployer4.service
fi

a2enmod proxy proxy_http headers rewrite >/dev/null

# Undo any previous deploy that stole Apache /
a2dissite scraper4 >/dev/null 2>&1 || true
rm -f /etc/apache2/sites-enabled/scraper4.conf
a2ensite 000-default >/dev/null 2>&1 || true

install -m 644 "${REPO_DIR}/deploy/scraper4.apache.conf" /etc/apache2/conf-available/scraper4-put.conf
# Do not a2enconf: ProxyPass must live inside the PHP vhost, not twice.
"$PY" - <<'PY'
from pathlib import Path
snippet = Path("/etc/apache2/conf-available/scraper4-put.conf").read_text(encoding="utf-8")
vhost = Path("/etc/apache2/sites-available/000-default.conf")
if not vhost.exists():
    vhost.write_text(
        "<VirtualHost *:80>\n"
        "    ServerAdmin webmaster@localhost\n"
        "    DocumentRoot /var/www/html\n"
        "    ErrorLog ${APACHE_LOG_DIR}/error.log\n"
        "    CustomLog ${APACHE_LOG_DIR}/access.log combined\n"
        "</VirtualHost>\n",
        encoding="utf-8",
    )
text = vhost.read_text(encoding="utf-8")
begin, end = "# scraper4-put BEGIN", "# scraper4-put END"
if begin in text:
    pre, rest = text.split(begin, 1)
    rest = rest.split(end, 1)[-1]
    text = pre.rstrip() + "\n" + snippet + rest.lstrip("\n")
elif "</VirtualHost>" in text:
    text = text.replace("</VirtualHost>", snippet + "\n</VirtualHost>", 1)
else:
    text += "\n" + snippet + "\n"
vhost.write_text(text, encoding="utf-8")
print("Apache /put/ injected into 000-default (PHP root kept).")
PY

apache2ctl configtest
systemctl reload apache2

echo
if ! systemctl is-active --quiet scraper4; then
  echo "scraper4.service failed:" >&2
  journalctl -u scraper4 -n 50 --no-pager >&2 || true
  exit 1
fi
echo "===== /put is up (Chromium installs next, optional) ====="
echo "  health:  curl -sS http://127.0.0.1:8000/health"
echo "  public:  http://$(hostname -I | awk '{print $1}')/put/"
curl -sS http://127.0.0.1:8000/health || true
echo
curl -sSI http://127.0.0.1/put/ | head -n 15 || true
systemctl --no-pager --full status scraper4 | head -20

echo
# The dashboard is already live at this point; everything below is optional
# and slow (browser downloads). SKIP_ENGINES=1 stops here so a reinstall that
# only needs the app itself finishes in seconds.
if [[ "${SKIP_ENGINES:-0}" = "1" ]]; then
  echo "SKIP_ENGINES=1 — skipping optional engines."
  echo "=== scraper4 install finished $(date -Is) ==="
  exit 0
fi

echo "Installing optional scrape engines (httpx, selenium, playwright, …)…"
# Prefer requirements.txt so the engine list stays in one place; fall back to
# the explicit list if the file is missing from this checkout.
if [[ -f "${REPO_DIR}/requirements.txt" ]]; then
  "$VENV/bin/pip" install -r "${REPO_DIR}/requirements.txt" || true
else
  "$VENV/bin/pip" install \
    playwright cloudscraper curl_cffi httpx selectolax selenium \
    playwright-stealth basalam-sdk || true
fi
# cdn.playwright.dev is geo-blocked in Iran (403). Prefer Ubuntu Chromium.
apt-get install -y chromium-browser || apt-get install -y chromium || true
snap install chromium || true
if ! "$VENV/bin/python" -m playwright install --with-deps chromium; then
  echo "Playwright CDN blocked; trying npmmirror Chrome for Testing…"
  CFT_VER="${PLAYWRIGHT_CFT_VERSION:-151.0.7922.34}"
  ZIP=/tmp/chrome-linux64.zip
  if curl -fL --retry 3 --max-time 180 -o "$ZIP" \
      "https://cdn.npmmirror.com/binaries/chrome-for-testing/${CFT_VER}/linux64/chrome-linux64.zip"; then
    unzip -o "$ZIP" -d "$APP_DIR"
    chmod +x "$APP_DIR/chrome-linux64/chrome" || true
    rm -f "$ZIP"
  else
    echo "npmmirror also failed; system Chromium will be used if present."
  fi
fi
echo "Optional engines done."
which chromium chromium-browser 2>/dev/null || true
ls -l /snap/bin/chromium /usr/bin/chromium /usr/bin/chromium-browser "$APP_DIR/chrome-linux64/chrome" 2>/dev/null || true

# Confirm the browser engines are genuinely usable. Installing the pip package
# without a Chromium binary leaves an engine that imports fine and then fails
# on every page, which reads as "extraction is stuck" rather than a setup gap.
echo
echo "Engine check:"
"$VENV/bin/python" - <<'ENGPY' || true
import sys
sys.path.insert(0, "/opt/scraper4")
try:
    import scraper4
except Exception as exc:  # noqa: BLE001
    print("  could not import scraper4:", exc)
    raise SystemExit(0)
ready, missing = [], []
for name in scraper4.KNOWN_ENGINES:
    (ready if scraper4.fetch_engine_installed(name) else missing).append(name)
print("  usable :", ", ".join(ready) or "-")
if missing:
    print("  missing:", ", ".join(missing))
    print("  Browser engines also need Chromium. To enable them:")
    print("    /opt/scraper4/venv/bin/python -m playwright install chromium")
ENGPY

# ── verify the Node-parity dashboard actually came up ────────────────────
# scraper4.py imports ui_bridge defensively, so a broken bridge degrades to the
# classic UI instead of crashing. That is good for uptime but bad for installs:
# it would look "successful" while /put/ui is dead. Check it explicitly.
echo
echo "Verifying dashboard…"
for n in $(seq 1 10); do
  UI_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:8000/ui || true)"
  [ "$UI_CODE" = 200 ] && break
  sleep 2
done
API_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:8000/api/profiles || true)"
# Verify the RUNNING version matches the repo we just installed from. Without
# this the installer reports success even when the service is still serving an
# older file (stale copy, browser cache, a second checkout, a process that was
# never restarted) — which looks exactly like "the fix did not work".
REPO_VER="$(grep -m1 '^APP_VERSION' "${REPO_DIR}/scraper4.py" | cut -d'"' -f2)"
LIVE_VER="$(curl -sS --max-time 10 http://127.0.0.1:8000/health 2>/dev/null \
  | tr ',' '\n' | grep -o '"version"[^,]*' | cut -d'"' -f4)"
echo
echo "Version check: repo=${REPO_VER:-?} running=${LIVE_VER:-?}"
if [ -n "$REPO_VER" ] && [ -n "$LIVE_VER" ] && [ "$REPO_VER" != "$LIVE_VER" ]; then
  echo "WARNING: the service is NOT running the version you just installed." >&2
  echo "  repo    : $REPO_VER" >&2
  echo "  running : $LIVE_VER" >&2
  echo "  Fix: systemctl restart scraper4 && curl -s localhost:8000/health" >&2
  echo "  If it still differs, another copy is being served:" >&2
  echo "    systemctl cat scraper4 | grep -E 'WorkingDirectory|ExecStart'" >&2
  echo "    ls -l $APP_DIR/scraper4.py" >&2
elif [ -n "$LIVE_VER" ]; then
  echo "OK: running version matches the repo."
  echo "NOTE: browsers cache the dashboard. If the UI still looks old, reload"
  echo "      with Ctrl-Shift-R (or Cmd-Shift-R) once."
fi

if [ "$UI_CODE" = 200 ] && [ "$API_CODE" = 200 ]; then
  echo "OK: dashboard is live — open http://SERVER/put/ui"
else
  echo "WARNING: dashboard check failed (/ui=$UI_CODE /api/profiles=$API_CODE)." >&2
  echo "The classic UI at http://SERVER/put/ should still work." >&2
  echo >&2
  echo "Reason reported by the app:" >&2
  curl -sS --max-time 10 http://127.0.0.1:8000/health 2>/dev/null \
    | tr ',' '\n' | grep -i 'ui_bridge' >&2 || true
  echo >&2
  echo "Most common cause: self-update replaced $APP_DIR/scraper4.py with the" >&2
  echo "upstream copy, which has no dashboard. Check that the service sets" >&2
  echo "SCRAPER_AUTO_UPDATE=0, then reinstall:" >&2
  echo "  grep SCRAPER_AUTO_UPDATE /etc/systemd/system/scraper4.service" >&2
  echo "  ls -l $APP_DIR/scraper4.py.bak   # a .bak means an update overwrote it" >&2
  echo >&2
  echo "Full log: journalctl -u scraper4 -n 50 --no-pager" >&2
fi
