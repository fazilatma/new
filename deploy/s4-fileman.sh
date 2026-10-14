#!/data/data/com.termux/files/usr/bin/bash
# =====================================================================
#  s4-fileman.sh — launcher for the mobile file manager / code editor
#                  (deploy/s4-fileman.php)
#
#  آنچه می‌سازد:
#     ~/.s4-fileman/www/s4-fileman.php    برنامه (از گیت‌هاب دانلود می‌شود)
#     ~/.s4-fileman/fileman.key           کلیدِ دسترسی (۰۶۰۰)
#     ~/.s4-fileman/backups/              پشتیبانِ هر فایلِ پیش از نوشتن
#     ~/.s4-fileman/fileman.log           گزارشِ هر نوشتن/حذف/دستور
#
#  چرا در حافظهٔ داخلی و نه در codes/؟
#     روی /storage/emulated/0 (حافظهٔ مشترک) قفلِ POSIX، chmod و rename
#     کار نمی‌کنند ⇒ خودِ php -S هم بالا نمی‌آید. بنابراین برنامه در
#     ~/.s4-fileman/www اجرا می‌شود، اما پوشهٔ codes را کامل نشان می‌دهد
#     و همان‌جا ویرایش می‌کند. با --install-to یک کپی هم در codes گذاشته
#     می‌شود تا از فایل‌اکسپلرِ اندروید هم دیده شود.
#
#  کاربرد:
#     bash s4-fileman.sh                 # نصب، کلید، اجرا در پیش‌زمینه
#     bash s4-fileman.sh --bg            # در پس‌زمینه (nohup) و چاپِ نشانی
#     bash s4-fileman.sh --key           # فقط چاپِ کلید و نشانی
#     bash s4-fileman.sh --status        # چه چیزی گوش می‌دهد؟
#     bash s4-fileman.sh --stop          # توقف
#     bash s4-fileman.sh --port 8090     # پورتِ دیگر
#     bash s4-fileman.sh --allow-remote  # ⚠️ دسترسی از شبکه (پرخطر)
#     bash s4-fileman.sh --deny-remote
#     bash s4-fileman.sh --install-to ~/storage/shared/codes
#     bash s4-fileman.sh --local /path/to/s4-fileman.php   # بدونِ دانلود
# =====================================================================
set -u

VERSION="1.0.0"
REPO="fazilatma/new"
SRC_BRANCH="arena/f5a628bb-new"
RAWBASE="https://raw.githubusercontent.com/$REPO/$SRC_BRANCH"
API="https://api.github.com"

APP="s4-fileman.php"
BASE="$HOME/.s4-fileman"
WWW="$BASE/www"
PORT="${PORT:-8082}"
HOST="127.0.0.1"
BG=0; STOP=0; STATUS=0; SHOWKEY=0; ALLOW_REMOTE=0; DENY_REMOTE=0
LOCAL_SRC=""; INSTALL_TO=""; NO_DOWNLOAD=0

say() { printf '%s\n' "$*"; }
die() { printf '❌ %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --bg)            BG=1; shift ;;
    --stop)          STOP=1; shift ;;
    --status)        STATUS=1; shift ;;
    --key)           SHOWKEY=1; shift ;;
    --port)          PORT="${2:-8082}"; shift 2 ;;
    --port=*)        PORT="${1#*=}"; shift ;;
    --host)          HOST="${2:-127.0.0.1}"; shift 2 ;;
    --allow-remote)  ALLOW_REMOTE=1; shift ;;
    --deny-remote)   DENY_REMOTE=1; shift ;;
    --local)         LOCAL_SRC="${2:-}"; shift 2 ;;
    --local=*)       LOCAL_SRC="${1#*=}"; shift ;;
    --install-to)    INSTALL_TO="${2:-}"; shift 2 ;;
    --install-to=*)  INSTALL_TO="${1#*=}"; shift ;;
    --no-download)   NO_DOWNLOAD=1; shift ;;
    --base)          BASE="${2:-$BASE}"; WWW="$BASE/www"; shift 2 ;;
    -h|--help)       sed -n '2,35p' "$0"; exit 0 ;;
    *)               die "flag ناشناخته: $1 (--help)" ;;
  esac
done

command -v php >/dev/null 2>&1 || die "php نصب نیست:  pkg install php"

# ---------------------------------------------------------------- stop/status
if [ "$STOP" = 1 ]; then
  if [ -f "$BASE/server.pid" ] && kill -0 "$(cat "$BASE/server.pid")" 2>/dev/null; then
    kill "$(cat "$BASE/server.pid")" 2>/dev/null && say "✅ متوقف شد (pid $(cat "$BASE/server.pid"))"
    rm -f "$BASE/server.pid"
  else
    pkill -f "$APP" 2>/dev/null && say "✅ فرآیندهای $APP کشته شدند" || say "⚠️ چیزی در حالِ اجرا نبود"
    rm -f "$BASE/server.pid"
  fi
  exit 0
fi

if [ "$STATUS" = 1 ]; then
  say "📡 s4-fileman $VERSION"
  if [ -f "$BASE/server.pid" ] && kill -0 "$(cat "$BASE/server.pid")" 2>/dev/null; then
    say "   در حالِ اجرا: pid $(cat "$BASE/server.pid")"
  else
    say "   در حالِ اجرا: نه"
  fi
  say "   فایل:   $WWW/$APP $([ -f "$WWW/$APP" ] && echo "($(wc -c < "$WWW/$APP" | tr -d ' ') بایت)" || echo '(نیست)')"
  say "   کلید:   $([ -f "$BASE/fileman.key" ] && echo 'ساخته شده' || echo 'ساخته نشده')"
  say "   remote: $([ -f "$BASE/allow-remote" ] && echo '⚠️ مجاز' || echo 'فقط loopback ✅')"
  if command -v ss >/dev/null 2>&1; then
    say "   گوش‌دهنده‌ها:"; ss -ltn 2>/dev/null | sed 's/^/      /'
  fi
  exit 0
fi

# ------------------------------------------------------------------- install
mkdir -p "$WWW" "$BASE/backups" 2>/dev/null || die "ساختِ $BASE ناموفق بود"

if [ -n "$LOCAL_SRC" ]; then
  [ -f "$LOCAL_SRC" ] || die "فایلِ محلی پیدا نشد: $LOCAL_SRC"
  cp -f "$LOCAL_SRC" "$WWW/$APP" || die "کپی ناموفق بود"
  say "📦 برنامه از فایلِ محلی نصب شد: $LOCAL_SRC"
elif [ "$NO_DOWNLOAD" = 1 ]; then
  [ -f "$WWW/$APP" ] || die "--no-download ولی $WWW/$APP وجود ندارد"
else
  say "⬇️  دریافتِ $APP از $REPO@$SRC_BRANCH …"
  if curl -fsSL --connect-timeout 12 --max-time 60 -o "$WWW/$APP.tmp" \
       "$RAWBASE/deploy/$APP" 2>/dev/null && [ -s "$WWW/$APP.tmp" ]; then
    mv -f "$WWW/$APP.tmp" "$WWW/$APP"; say "   ✅ از raw.githubusercontent"
  elif curl -fsSL --connect-timeout 12 --max-time 60 -H 'Accept: application/vnd.github.raw' \
       -o "$WWW/$APP.tmp" "$API/repos/$REPO/contents/deploy/$APP?ref=$SRC_BRANCH" 2>/dev/null && [ -s "$WWW/$APP.tmp" ]; then
    mv -f "$WWW/$APP.tmp" "$WWW/$APP"; say "   ✅ از api.github.com"
  else
    rm -f "$WWW/$APP.tmp" 2>/dev/null
    [ -f "$WWW/$APP" ] && say "   ⚠️ دانلود ناموفق؛ نسخهٔ موجود نگه داشته شد" \
                       || die "دانلود ناموفق بود و نسخهٔ محلی هم نیست"
  fi
fi

# syntax check before serving anything
php -l "$WWW/$APP" >/dev/null 2>&1 || { php -l "$WWW/$APP" 2>&1 | sed 's/^/   /'; die "$APP خطایِ نحوی دارد"; }
say "🩺 php -l: سالم  ·  $(wc -c < "$WWW/$APP" | tr -d ' ') بایت  ·  md5 $(md5sum "$WWW/$APP" | cut -d' ' -f1)"

# ---------------------------------------------------------------------- key
KEY="$(php "$WWW/$APP" --print-key 2>/dev/null | head -1)"
if [ -z "$KEY" ] || [ "$KEY" = "no key yet — run with --make-key" ]; then
  KEY="$(php "$WWW/$APP" --make-key 2>/dev/null | head -1 | sed 's/^key created: //; s/^key already exists: //')"
  say "🔑 کلیدِ دسترسی ساخته شد"
fi
[ -n "$KEY" ] || die "ساختِ کلید ناموفق بود"

if [ "$ALLOW_REMOTE" = 1 ]; then php "$WWW/$APP" --allow-remote; fi
if [ "$DENY_REMOTE" = 1 ];  then php "$WWW/$APP" --deny-remote;  fi

if [ -n "$INSTALL_TO" ]; then
  case "$INSTALL_TO" in ~*) INSTALL_TO="${INSTALL/#\~/$HOME}";; esac
  if mkdir -p "$INSTALL_TO" 2>/dev/null && cp -f "$WWW/$APP" "$INSTALL_TO/$APP" 2>/dev/null; then
    say "📂 یک کپی هم اینجا گذاشته شد (برایِ دیدن از فایل‌اکسپلرِ اندروید): $INSTALL_TO/$APP"
    say "   ⚠️ آن کپی فقط برایِ مشاهده/ویرایش است؛ اجرا همیشه از $WWW انجام می‌شود."
  else
    say "⚠️ کپی در $INSTALL_TO ناموفق بود"
  fi
fi

URL="http://$HOST:$PORT/$APP?key=$KEY"

if [ "$SHOWKEY" = 1 ]; then
  say ""; say "🔑 کلید: $KEY"; say "🌐 نشانی: $URL"; exit 0
fi

# ------------------------------------------------------------------- serve
PHP_OPTS=(-d opcache.enable=0 -d opcache.enable_cli=0
          -d display_errors=0 -d display_startup_errors=0
          -d log_errors=1 -d error_log="$BASE/php-error.log"
          -d memory_limit=512M -d upload_max_filesize=256M -d post_max_size=256M
          -d max_execution_time=0)

if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":$PORT "; then
  say "⚠️ پورتِ $PORT اشغال است؛ شاید همین برنامه از قبل اجرا می‌شود:"
  ss -ltnp 2>/dev/null | grep ":$PORT " | sed 's/^/      /'
  say "   با پورتِ دیگر:  bash $0 --port 8090"
fi

say ""
say "──────────────────────────────────────────────────────────"
if [ -t 1 ]; then
  say "🌐  $URL"
else
  say "🌐  http://$HOST:$PORT/$APP?key=<کلید در ~/.s4-fileman/fileman.key>"
fi
say "    (در مرورگرِ همان گوشی باز کنید. A− / A+ اندازهٔ متن را عوض می‌کند.)"
say "    کلید: $BASE/fileman.key"
say "    گزارشِ عملیات: $BASE/fileman.log"
say "    خطاهایِ PHP:   $BASE/php-error.log"
say "──────────────────────────────────────────────────────────"
say ""

if [ "$BG" = 1 ]; then
  ( cd "$WWW" && nohup php "${PHP_OPTS[@]}" -S "$HOST:$PORT" -t "$WWW" > "$BASE/server.log" 2>&1 &
    echo $! > "$BASE/server.pid" ) 2>/dev/null
  sleep 2
  if [ -f "$BASE/server.pid" ] && kill -0 "$(cat "$BASE/server.pid")" 2>/dev/null; then
    say "✅ در پس‌زمینه اجرا شد (pid $(cat "$BASE/server.pid"))"
    CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$URL" 2>/dev/null)"
    say "   پاسخِ صفحه: http=$CODE"
    [ "$CODE" = 200 ] || { say "   ⚠️ پاسخ ۲۰۰ نبود؛ گزارش:"; tail -15 "$BASE/server.log" 2>/dev/null | sed 's/^/      /'; }
    command -v termux-open-url >/dev/null 2>&1 && termux-open-url "$URL" 2>/dev/null && say "   📱 در مرورگر باز شد"
    exit 0
  fi
  say "❌ سرور بالا نیامد؛ گزارش:"; tail -20 "$BASE/server.log" 2>/dev/null | sed 's/^/      /'
  exit 1
fi

command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock 2>/dev/null
say "   توقف: Ctrl+C"
cd "$WWW" || die "cd به $WWW ناموفق بود"
exec php "${PHP_OPTS[@]}" -S "$HOST:$PORT" -t "$WWW"
