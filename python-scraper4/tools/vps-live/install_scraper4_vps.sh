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

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
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

# Isolated venv — never uninstall Debian pip/blinker RECORD-less packages.
"$PY" -m venv "$VENV"
"$VENV/bin/pip" install --upgrade pip
"$VENV/bin/pip" install flask requests beautifulsoup4 lxml gunicorn

install -m 644 "${REPO_DIR}/deploy/scraper4.service" /etc/systemd/system/scraper4.service
if [[ -f "${REPO_DIR}/deploy/deployer4.service" ]]; then
  install -m 644 "${REPO_DIR}/deploy/deployer4.service" /etc/systemd/system/deployer4.service
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
echo "Installing optional scrape engines (httpx, selenium, playwright, …)…"
"$VENV/bin/pip" install \
  playwright cloudscraper curl_cffi httpx selenium playwright-stealth basalam-sdk || true
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
