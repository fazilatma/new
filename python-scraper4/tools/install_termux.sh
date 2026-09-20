#!/data/data/com.termux/files/usr/bin/bash
# Scraper 4 — installer for Termux (Android).
#
# One command, from a fresh Termux:
#   pkg install -y curl && \
#   curl -fsSL https://raw.githubusercontent.com/fazilatma/new/arena/01a0b7db-new/python-scraper4/tools/install_termux.sh | bash
#
# Afterwards:
#   scraper4 start     # run it
#   scraper4 stop
#   scraper4 status
#   scraper4 update    # pull the newest version
#
# Opens on http://127.0.0.1:8000/ui in the phone's browser.
#
# Notes for Android:
#  * No root, no systemd. The app runs as a normal background process and is
#    kept alive by Termux itself, so acquire a wakelock for long extractions.
#  * Playwright/Selenium need a desktop Chromium and are NOT installed here;
#    the HTTP engines (requests, httpx, curl_cffi, cloudscraper) are what work
#    on a phone, and the app already falls back to them.
#  * lxml and curl_cffi need compilers; we install the Termux packages that
#    provide prebuilt wheels where possible and continue if one fails.
set -u

REPO_URL="${REPO_URL:-https://github.com/fazilatma/new.git}"
BRANCH="${BRANCH:-arena/01a0b7db-new}"
SUBDIR="python-scraper4"

HOME_DIR="${HOME:-/data/data/com.termux/files/home}"
SRC="${HOME_DIR}/scraper4-src"
RUN="${HOME_DIR}/scraper4"
VENV="${RUN}/venv"
PY="${VENV}/bin/python"
BIN="${PREFIX:-/data/data/com.termux/files/usr}/bin"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m    %s\033[0m\n' "$*" >&2; }
die()  { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

case "$(uname -o 2>/dev/null || true)" in
  *Android*) ;;
  *) [ -d /data/data/com.termux/files/usr ] || \
       die "این اسکریپت برای Termux روی اندروید است." ;;
esac

say "۱/۶ نصب بسته‌های پایه"
# python-lxml and libxml2 save a long compile; without them pip builds from
# source and usually fails on a phone.
pkg update -y >/dev/null 2>&1 || warn "pkg update ناموفق بود؛ ادامه می‌دهیم"
pkg install -y python git libxml2 libxslt libjpeg-turbo zlib clang \
  binutils openssl libffi python-lxml >/dev/null 2>&1 \
  || pkg install -y python git >/dev/null 2>&1 \
  || die "نصب بسته‌های پایه ناموفق بود"
command -v python3 >/dev/null 2>&1 || die "python3 نصب نشد"
command -v git >/dev/null 2>&1 || die "git نصب نشد"

say "۲/۶ دریافت کد از ${BRANCH}"
if [ -d "${SRC}/.git" ]; then
  git -C "$SRC" remote set-url origin "$REPO_URL" 2>/dev/null || true
  if git -C "$SRC" fetch --depth 1 origin "$BRANCH" 2>/dev/null; then
    git -C "$SRC" reset --hard FETCH_HEAD >/dev/null 2>&1
  else
    warn "دریافت به‌روزرسانی ناموفق بود؛ از نسخهٔ موجود استفاده می‌شود"
  fi
else
  rm -rf "${SRC}.tmp"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "${SRC}.tmp" \
    || die "git clone ناموفق بود (اتصال اینترنت را بررسی کنید)"
  rm -rf "$SRC"; mv "${SRC}.tmp" "$SRC"
fi
APP="${SRC}/${SUBDIR}"
[ -f "${APP}/scraper4.py" ] || APP="$SRC"
[ -f "${APP}/scraper4.py" ] || die "scraper4.py در مخزن پیدا نشد"

say "۳/۶ ساخت محیط پایتون"
mkdir -p "$RUN"
[ -x "$PY" ] || python3 -m venv --system-site-packages "$VENV" \
  || die "ساخت venv ناموفق بود"
"$PY" -m pip install --quiet --upgrade pip >/dev/null 2>&1 || true

say "۴/۶ نصب کتابخانه‌های لازم"
"$PY" -m pip install --quiet flask gunicorn requests beautifulsoup4 \
  || die "نصب کتابخانه‌های اصلی ناموفق بود"
# lxml usually comes from the Termux package via --system-site-packages.
"$PY" -c "import lxml" 2>/dev/null || "$PY" -m pip install --quiet lxml \
  || warn "lxml نصب نشد؛ برنامه با پارسر داخلی کار می‌کند"
# Optional engines, one by one so a single failure does not stop the rest.
for spec in "httpx[http2]" cloudscraper curl_cffi selectolax basalam-sdk; do
  name="${spec%%[*}"
  if "$PY" -m pip install --quiet "$spec" >/dev/null 2>&1; then
    printf '    نصب شد: %s\n' "$name"
  else
    warn "نصب نشد (اختیاری): $name"
  fi
done

say "۵/۶ نصب فایل‌های برنامه"
cp -a "${APP}/"*.py "$RUN/"
if [ -f "${APP}/ui_bridge.py" ] && [ -d "${APP}/ui" ]; then
  cp -a "${APP}/ui_bridge.py" "$RUN/"
  rm -rf "${RUN}/ui"; cp -a "${APP}/ui" "${RUN}/ui"
else
  warn "فایل‌های داشبورد پیدا نشد؛ /ui در دسترس نخواهد بود"
fi
[ -f "${APP}/ai_providers.json" ] && [ ! -f "${RUN}/ai_providers.json" ] \
  && cp -a "${APP}/ai_providers.json" "$RUN/" || true
find "$RUN" -name '*.pyc' -delete 2>/dev/null || true
find "$RUN" -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
"$PY" -m py_compile "${RUN}/scraper4.py" || die "scraper4.py معتبر نیست"

say "۶/۶ ساخت دستور scraper4"
mkdir -p "$BIN"
cat > "${BIN}/scraper4" <<TERMUXEOF
#!/data/data/com.termux/files/usr/bin/bash
# Scraper 4 launcher (Termux)
set -u
RUN="${RUN}"
PY="${PY}"
SRC="${SRC}"
PORT="\${SCRAPER_PORT:-8000}"
# Local-only by default. SCRAPER_BIND=0.0.0.0 exposes it to the LAN.
BIND="\${SCRAPER_BIND:-127.0.0.1}"

export PYTHONUNBUFFERED=1
export SCRAPER_RUNTIME=termux
# No reverse proxy on a phone: serve straight from the root so /ui works at
# http://127.0.0.1:8000/ui (the /put prefix is only for the Apache setup).
export SCRAPER_URL_PREFIX=""
export SCRAPER_AUTO_UPDATE=0
export SCRAPER_GIT_AUTO_UPDATE=0
export SCRAPER_REPO_DIR="\$SRC"
export SCRAPER_DATA_FILE="\${RUN}/scraper4_data.json"
export SCRAPER_LIVE_DIR="\${RUN}/scraper4-live"
export SCRAPER_ERROR_LOG="\${RUN}/scraper4-errors.jsonl"

running() { pgrep -f "gunicorn.*scraper4:application" >/dev/null 2>&1; }

case "\${1:-start}" in
  start)
    running && { echo "از قبل در حال اجراست: http://127.0.0.1:\${PORT}/ui"; exit 0; }
    # One worker: task state lives in this process. timeout 0: never kill a
    # long extraction.
    cd "\$RUN" || exit 1
    nohup "\$PY" -m gunicorn --bind "\${BIND}:\${PORT}" --workers 1 --threads 4 \\
      --timeout 0 --graceful-timeout 30 scraper4:application \\
      >"\${RUN}/scraper4.log" 2>&1 &
    sleep 3
    if running; then
      command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock || true
      echo "اجرا شد → http://127.0.0.1:\${PORT}/ui"
    else
      echo "اجرا نشد. آخرین خطاها:"; tail -n 20 "\${RUN}/scraper4.log"; exit 1
    fi
    ;;
  stop)
    pkill -f "gunicorn.*scraper4:application" 2>/dev/null || true
    command -v termux-wake-unlock >/dev/null 2>&1 && termux-wake-unlock || true
    echo "متوقف شد."
    ;;
  status)
    if running; then
      echo "در حال اجرا → http://127.0.0.1:\${PORT}/ui"
      curl -s "http://127.0.0.1:\${PORT}/health" 2>/dev/null | head -c 300; echo
    else
      echo "متوقف است."
    fi
    ;;
  log)   tail -n "\${2:-40}" "\${RUN}/scraper4.log" ;;
  update)
    git -C "\$SRC" fetch --depth 1 origin "${BRANCH}" && \\
      git -C "\$SRC" reset --hard FETCH_HEAD || { echo "به‌روزرسانی ناموفق"; exit 1; }
    APP="\${SRC}/${SUBDIR}"; [ -f "\${APP}/scraper4.py" ] || APP="\$SRC"
    cp -a "\${APP}/"*.py "\$RUN/"
    [ -f "\${APP}/ui_bridge.py" ] && cp -a "\${APP}/ui_bridge.py" "\$RUN/"
    [ -d "\${APP}/ui" ] && { rm -rf "\${RUN}/ui"; cp -a "\${APP}/ui" "\${RUN}/ui"; }
    find "\$RUN" -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
    echo "به‌روزرسانی شد. برای اعمال:  scraper4 stop && scraper4 start"
    ;;
  *) echo "usage: scraper4 {start|stop|status|log|update}"; exit 1 ;;
esac
TERMUXEOF
chmod +x "${BIN}/scraper4"

VER="$(grep -m1 '^APP_VERSION' "${RUN}/scraper4.py" | cut -d'"' -f2)"
say "نصب کامل شد — نسخهٔ ${VER:-?}"
cat <<INFO

  اجرا     :  scraper4 start
  توقف     :  scraper4 stop
  وضعیت    :  scraper4 status
  گزارش    :  scraper4 log
  به‌روزرسانی:  scraper4 update

  آدرس داشبورد:  http://127.0.0.1:8000/ui

  نکته‌ها:
   • برای استخراج‌های طولانی، Termux را باز نگه دارید یا
     termux-wake-lock را اجرا کنید (اسکریپت خودکار این کار را می‌کند).
   • موتورهای مرورگری (Playwright/Selenium) روی گوشی نصب نمی‌شوند؛
     موتورهای HTTP کار می‌کنند و برنامه خودکار سراغشان می‌رود.
   • فایل داده‌ها: ${RUN}/scraper4_data.json

INFO
