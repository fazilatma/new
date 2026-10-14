#!/data/data/com.termux/files/usr/bin/bash
# =====================================================================
#  s4-remote.sh v1.1 — دسترسی به فایل‌هایِ ترموکس + code-serverِ موبایل‌پسند
#
#  ۲) SFTP با sshd رویِ پورتِ ۸۰۲۲
#     → هر فایل‌منیجری که SFTP دارد (Solid Explorer, MiXplorer, X-plore,
#       Cx, Material Files) کلِ /data/data/com.termux/files/home را می‌بیند.
#
#  ۳) code-serverِ **اجباراً زوم‌شدنی** و موبایل‌پسند
#     تنظیماتِ window.zoomLevel در مرورگر اثر ندارند (ویژگیِ Electron است) و
#     خودِ صفحه viewport را قفل می‌کند، پس زومِ دو‌انگشتی کار نمی‌کند.
#     راهِ حل: یک پروکسیِ سبکِ Node (deploy/s4-csproxy.js) جلوی code-server
#     می‌نشیند و داخلِ هر پاسخِ HTML:
#        • meta viewport را با user-scalable=yes / maximum-scale=10 جایگزین می‌کند
#        • CSSِ زومِ اجباری (body{zoom:var(--s4-zoom)}) و کنترل‌های لمسی را
#          تزریق می‌کند
#        • نوارِ شناورِ A− / A+ / ⟳ / ⛶ / ✕ را اضافه می‌کند (زوم با لمس،
#          بدونِ کیبورد) + زومِ دو‌انگشتی + ?z=1.8 در نشانی
#        • اتصال‌های WebSocket (ترمینال، extension host) را تونلِ خام می‌زند
#     و هیچ فایلی از نصبِ code-server را دستکاری نمی‌کند ⇒ با آپگرید نمی‌شکند.
#
#     code-server رویِ 127.0.0.1:18081 و پروکسی رویِ 127.0.0.1:8081.
#
#  کاربرد:
#     bash s4-remote.sh                  # هر دو (ssh + code-serverِ موبایل)
#     bash s4-remote.sh --code           # فقط code-server
#     bash s4-remote.sh --code --zoom 1.8
#     bash s4-remote.sh --code --open    # در مرورگر هم بازش کن
#     bash s4-remote.sh --code --no-proxy# مثلِ قبل، بدونِ پروکسی
#     bash s4-remote.sh --code --css my.css   # CSSِ دلخواهِ خودت
#     bash s4-remote.sh --ssh --set-password
#     bash s4-remote.sh --status
#     bash s4-remote.sh --stop
#
#  نکتهٔ امنیتی: همه‌چیز فقط به 127.0.0.1 بسته می‌شود مگر --bind-lan.
# =====================================================================
set -u

VERSION="1.1.0"
SSH_PORT="${SSH_PORT:-8022}"
CODE_PORT="${CODE_PORT:-8081}"       # what you open in the browser
CS_UPSTREAM="${CS_UPSTREAM:-18081}"  # code-server itself (loopback)
CODE_HOST="127.0.0.1"
BASE="$HOME/.s4-remote"
REPO="fazilatma/new"
SRC_BRANCH="arena/f5a628bb-new"
RAWBASE="https://raw.githubusercontent.com/$REPO/$SRC_BRANCH"
API="https://api.github.com"
PROXY_JS="s4-csproxy.js"

ZOOM="$(cat "$BASE/zoom" 2>/dev/null || echo 1.4)"
USE_PROXY=1; OPEN_BROWSER=0; CUSTOM_CSS=""
DO_SSH=0; DO_CODE=0; STOP=0; STATUS=0; SET_PW=0; BIND_LAN=0; NO_SETTINGS=0

say() { printf '%s\n' "$*"; }
die() { printf '❌ %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --ssh)           DO_SSH=1; shift ;;
    --code)          DO_CODE=1; shift ;;
    --both)          DO_SSH=1; DO_CODE=1; shift ;;
    --stop)          STOP=1; shift ;;
    --status)        STATUS=1; shift ;;
    --set-password)  SET_PW=1; shift ;;
    --ssh-port)      SSH_PORT="${2:-8022}"; shift 2 ;;
    --code-port)     CODE_PORT="${2:-8081}"; shift 2 ;;
    --upstream-port) CS_UPSTREAM="${2:-18081}"; shift 2 ;;
    --zoom)          ZOOM="${2:-1.4}"; shift 2 ;;
    --zoom=*)        ZOOM="${1#*=}"; shift ;;
    --no-proxy)      USE_PROXY=0; shift ;;
    --proxy)         USE_PROXY=1; shift ;;
    --open)          OPEN_BROWSER=1; shift ;;
    --css)           CUSTOM_CSS="${2:-}"; shift 2 ;;
    --css=*)         CUSTOM_CSS="${1#*=}"; shift ;;
    --bind-lan)      BIND_LAN=1; CODE_HOST="0.0.0.0"; shift ;;
    --no-settings)   NO_SETTINGS=1; shift ;;
    -h|--help)       sed -n '2,44p' "$0"; exit 0 ;;
    *)               die "flag ناشناخته: $1 (--help)" ;;
  esac
done
[ "$DO_SSH" = 0 ] && [ "$DO_CODE" = 0 ] && { DO_SSH=1; DO_CODE=1; }

mkdir -p "$BASE" 2>/dev/null || true
printf '%s' "$ZOOM" > "$BASE/zoom" 2>/dev/null || true

listening() { command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":$1 "; }

# ------------------------------------------------------------------ status
if [ "$STATUS" = 1 ]; then
  say "📡 s4-remote $VERSION"
  say "   sshd:        $(command -v sshd >/dev/null 2>&1 && echo "نصب ($(command -v sshd))" || echo 'نصب نیست')"
  say "   code-server: $(command -v code-server >/dev/null 2>&1 && code-server --version 2>/dev/null | head -1 || echo 'نصب نیست')"
  say "   node:        $(command -v node >/dev/null 2>&1 && node -v 2>/dev/null || echo 'نصب نیست')"
  say "   پروکسی:      $([ -f "$BASE/$PROXY_JS" ] && echo "موجود ($(wc -c < "$BASE/$PROXY_JS" | tr -d ' ') بایت)" || echo 'دریافت نشده')"
  say "   زومِ ذخیره‌شده: $ZOOM"
  say "   پورت‌ها:      مرورگر→$CODE_PORT  code-server→$CS_UPSTREAM  ssh→$SSH_PORT"
  for p in "$CODE_PORT" "$CS_UPSTREAM" "$SSH_PORT"; do
    listening "$p" && say "      :$p گوش می‌دهد ✅" || say "      :$p خاموش"
  done
  if listening "$CODE_PORT"; then
    M=$(curl -sS --max-time 20 "http://127.0.0.1:$CODE_PORT/" 2>/dev/null | grep -c 's4-cs-mobile-v1')
    say "   تزریقِ CSS/JSِ موبایل: $([ "${M:-0}" -gt 0 ] && echo 'فعال ✅' || echo 'یافت نشد ❌')"
  fi
  exit 0
fi

if [ "$STOP" = 1 ]; then
  for f in csproxy.pid code.pid sshd.pid; do
    if [ -f "$BASE/$f" ] && kill -0 "$(cat "$BASE/$f")" 2>/dev/null; then
      kill "$(cat "$BASE/$f")" 2>/dev/null && say "✅ $(cat "$BASE/$f") متوقف شد ($f)"
      rm -f "$BASE/$f"
    fi
  done
  pkill -f "$PROXY_JS" 2>/dev/null && say "✅ پروکسی کشته شد"
  pkill -f "code-server" 2>/dev/null && say "✅ code-server کشته شد"
  pkill -f "sshd" 2>/dev/null && say "✅ sshd کشته شد"
  exit 0
fi

# ------------------------------------------------------- ssh password
if [ "$SET_PW" = 1 ]; then
  command -v passwd >/dev/null 2>&1 || die "passwd پیدا نشد"
  say "🔑 گذاشتنِ رمزِ کاربرِ $(whoami) برایِ ssh (دو بار وارد کنید):"
  passwd || die "تغییرِ رمز ناموفق بود"
  say "✅ رمز تنظیم شد"
fi

# ============================================================== route 2: ssh
if [ "$DO_SSH" = 1 ]; then
  say ""
  say "══════════ ۲) SFTP ══════════"
  if ! command -v sshd >/dev/null 2>&1; then
    say "📦 نصبِ openssh …"
    command -v pkg >/dev/null 2>&1 || die "pkg پیدا نشد"
    yes | pkg install -y openssh 2>&1 | tail -8 | sed 's/^/   /'
  fi
  command -v sshd >/dev/null 2>&1 || die "sshd نصب نشد"
  ls "$PREFIX/etc/ssh"/ssh_host_* >/dev/null 2>&1 || { say "🔐 ساختِ کلیدهایِ میزبان …"; ssh-keygen -A 2>&1 | tail -6 | sed 's/^/   /'; }
  LAN_IP="$( { ip -4 addr show wlan0 2>/dev/null || ifconfig wlan0 2>/dev/null; } | grep -o 'inet [0-9.]*' | head -1 | cut -d' ' -f2 )"
  if pgrep -f sshd >/dev/null 2>&1; then
    say "ℹ️ sshd از قبل در حالِ اجراست"
  else
    sshd -p "$SSH_PORT" 2>"$BASE/sshd.err" && say "✅ sshd رویِ پورتِ $SSH_PORT" \
      || { say "❌ sshd بالا نیامد:"; sed 's/^/      /' "$BASE/sshd.err"; }
  fi
  sleep 1
  listening "$SSH_PORT" && say "   گوش می‌دهد ✅" || say "   ⚠️ رویِ $SSH_PORT چیزی گوش نمی‌دهد"
  say ""
  say "   در فایل‌منیجر یک اتصالِ SFTP بسازید:"
  say "      host: 127.0.0.1   port: $SSH_PORT   path: ~"
  if [ -t 1 ]; then
    say "      username: $(whoami)"
    say "      password: رمزی که با passwd گذاشتید (نگذاشته‌اید؟ bash $0 --set-password)"
  else
    say "      username: (خروجیِ whoami)   password: (با --set-password؛ اینجا چاپ نمی‌شود)"
  fi
  [ -n "${LAN_IP:-}" ] && say "   از کامپیوترِ رویِ همان وای‌فای: $LAN_IP:$SSH_PORT"
  say "   شروعِ خودکار: pkg install termux-services && sv-enable sshd"
fi

# ==================================================== route 3: code-server
if [ "$DO_CODE" = 1 ]; then
  say ""
  say "══════════ ۳) code-serverِ موبایل‌پسند (زومِ اجباری) ══════════"
  command -v code-server >/dev/null 2>&1 || { say "⚠️ code-server نصب نیست: pkg install code-server"; DO_CODE=0; }
fi

if [ "$DO_CODE" = 1 ]; then
  SETTINGS_DIR="$HOME/.local/share/code-server/User"
  SETTINGS="$SETTINGS_DIR/settings.json"
  if [ "$NO_SETTINGS" = 0 ]; then
    mkdir -p "$SETTINGS_DIR" 2>/dev/null
    if command -v python3 >/dev/null 2>&1; then
      [ -f "$SETTINGS" ] && cp -p "$SETTINGS" "$SETTINGS.bak.$(date +%s)" 2>/dev/null
      SETTINGS="$SETTINGS" python3 - <<'PY' 2>&1 | sed 's/^/   /'
import json, os
p = os.environ["SETTINGS"]
try:
    cur = json.load(open(p, encoding="utf-8")) if os.path.isfile(p) else {}
    if not isinstance(cur, dict):
        cur = {}
except Exception:
    cur = {}
mobile = {
    "editor.fontSize": 18,
    "editor.lineHeight": 30,
    "editor.wordWrap": "on",
    "editor.minimap.enabled": False,
    "editor.scrollbar.verticalScrollbarSize": 18,
    "editor.scrollbar.horizontalScrollbarSize": 18,
    "editor.renderLineHighlight": "all",
    "editor.stickyScroll.enabled": False,
    "editor.glyphMargin": False,
    "terminal.integrated.fontSize": 16,
    "terminal.integrated.lineHeight": 1.3,
    "workbench.tree.indent": 22,
    "workbench.list.smoothScrolling": True,
    "breadcrumbs.enabled": False,
    "window.menuBarVisibility": "compact",
    "explorer.compactFolders": False,
    "files.simpleDialog.enable": True,
    "telemetry.telemetryLevel": "off",
    "workbench.editor.limit.enabled": True,
    "workbench.editor.limit.value": 6,
}
changed = {k: v for k, v in mobile.items() if cur.get(k) != v}
cur.update(mobile)
json.dump(cur, open(p, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print("settings:", p)
print("changed:", ", ".join(sorted(changed)) or "none")
PY
    else
      say "   ⚠️ python3 نیست ⇒ تنظیمات ادغام نشد (زوم را همان پروکسی اجبار می‌کند)"
    fi
  fi

  # ---------------------------------------------------- the mobile proxy
  if [ "$USE_PROXY" = 1 ]; then
    if ! command -v node >/dev/null 2>&1; then
      say "⚠️ node نیست ⇒ پروکسی ممکن نیست (pkg install node). بدونِ پروکسی ادامه می‌دهم."
      USE_PROXY=0
    fi
  fi
  if [ "$USE_PROXY" = 1 ]; then
    SRC_LOCAL="$(cd "$(dirname "$0")" 2>/dev/null && pwd)/$PROXY_JS"
    if [ -f "$SRC_LOCAL" ]; then
      cp -f "$SRC_LOCAL" "$BASE/$PROXY_JS" && say "📦 پروکسی از فایلِ محلی: $SRC_LOCAL"
    else
      say "⬇️  دریافتِ $PROXY_JS از $REPO@$SRC_BRANCH …"
      if curl -fsSL --connect-timeout 12 --max-time 60 -o "$BASE/$PROXY_JS.tmp" "$RAWBASE/deploy/$PROXY_JS" 2>/dev/null \
         && [ -s "$BASE/$PROXY_JS.tmp" ]; then
        mv -f "$BASE/$PROXY_JS.tmp" "$BASE/$PROXY_JS"; say "   ✅ از raw.githubusercontent"
      elif curl -fsSL --connect-timeout 12 --max-time 60 -H 'Accept: application/vnd.github.raw' \
           -o "$BASE/$PROXY_JS.tmp" "$API/repos/$REPO/contents/deploy/$PROXY_JS?ref=$SRC_BRANCH" 2>/dev/null \
           && [ -s "$BASE/$PROXY_JS.tmp" ]; then
        mv -f "$BASE/$PROXY_JS.tmp" "$BASE/$PROXY_JS"; say "   ✅ از api.github.com"
      else
        rm -f "$BASE/$PROXY_JS.tmp" 2>/dev/null
        [ -f "$BASE/$PROXY_JS" ] && say "   ⚠️ دانلود ناموفق؛ نسخهٔ موجود نگه داشته شد" \
          || { say "   ⚠️ پروکسی در دسترس نیست؛ بدونِ آن ادامه می‌دهم"; USE_PROXY=0; }
      fi
    fi
    if [ "$USE_PROXY" = 1 ]; then
      node --check "$BASE/$PROXY_JS" 2>&1 | sed 's/^/   /' || { say "❌ پروکسی خطایِ نحوی دارد؛ بدونِ آن ادامه می‌دهم"; USE_PROXY=0; }
    fi
    if [ "$USE_PROXY" = 1 ] && [ -n "$CUSTOM_CSS" ]; then
      if [ -f "$CUSTOM_CSS" ]; then
        cp -f "$CUSTOM_CSS" "$BASE/mobile.css" && say "🎨 CSSِ دلخواه: $CUSTOM_CSS → $BASE/mobile.css"
      else
        say "⚠️ فایلِ CSS پیدا نشد: $CUSTOM_CSS"
      fi
    fi
  fi

  # ------------------------------------------------ start code-server
  SERVE_PORT="$CODE_PORT"
  [ "$USE_PROXY" = 1 ] && SERVE_PORT="$CS_UPSTREAM"
  # code-server itself always stays on loopback; with --bind-lan it is the
  # proxy that listens on all interfaces (and still needs the login password).

  if pgrep -f "code-server.*$SERVE_PORT" >/dev/null 2>&1; then
    say "ℹ️ code-server از قبل رویِ $SERVE_PORT در حالِ اجراست"
  else
    say "🚀 code-server رویِ 127.0.0.1:$SERVE_PORT …"
    ( cd "$HOME" && nohup code-server \
        --bind-addr "127.0.0.1:$SERVE_PORT" \
        --auth password --disable-telemetry --disable-update-check \
        "$HOME" > "$BASE/code-server.log" 2>&1 &
      echo $! > "$BASE/code.pid" ) 2>/dev/null
    for i in $(seq 1 30); do
      listening "$SERVE_PORT" && break
      sleep 1
    done
    if listening "$SERVE_PORT"; then
      say "✅ code-server بالا آمد (pid $(cat "$BASE/code.pid" 2>/dev/null))"
    else
      say "❌ code-server بالا نیامد؛ گزارش:"; tail -20 "$BASE/code-server.log" 2>/dev/null | sed 's/^/      /'
    fi
  fi

  # ------------------------------------------------------- start proxy
  if [ "$USE_PROXY" = 1 ]; then
    if pgrep -f "$PROXY_JS" >/dev/null 2>&1; then
      say "ℹ️ پروکسی از قبل در حالِ اجراست (برایِ زومِ جدید: bash $0 --stop و دوباره اجرا)"
    else
      ( cd "$BASE" && S4_CS_HOST="$CODE_HOST" S4_CS_PORT="$CODE_PORT" S4_CS_UPSTREAM="$CS_UPSTREAM" \
          S4_CS_ZOOM="$ZOOM" S4_CS_CSS="$BASE/mobile.css" \
          nohup node "$BASE/$PROXY_JS" > "$BASE/csproxy.log" 2>&1 &
        echo $! > "$BASE/csproxy.pid" ) 2>/dev/null
      sleep 2
      if kill -0 "$(cat "$BASE/csproxy.pid" 2>/dev/null)" 2>/dev/null; then
        say "✅ پروکسیِ موبایل بالا آمد (pid $(cat "$BASE/csproxy.pid")) · زومِ پیش‌فرض $ZOOM"
      else
        say "❌ پروکسی بالا نیامد؛ گزارش:"; tail -15 "$BASE/csproxy.log" 2>/dev/null | sed 's/^/      /'
      fi
    fi
    # verify the injection actually reaches the browser
    sleep 1
    BODY="$BASE/probe.html"
    CODE=$(curl -sS -o "$BODY" -w '%{http_code}' --max-time 25 "http://127.0.0.1:$CODE_PORT/" 2>/dev/null)
    MARKS=$(grep -c 's4-cs-mobile-v1' "$BODY" 2>/dev/null || echo 0)
    ZOOMCSS=$(grep -c -- '--s4-zoom' "$BODY" 2>/dev/null || echo 0)
    PINCH=$(grep -c 'user-scalable=yes' "$BODY" 2>/dev/null || echo 0)
    say "   بررسیِ صفحه: http=$CODE · marker=$MARKS · forced-zoom-css=$ZOOMCSS · pinch-zoom=$PINCH"
    if [ "${MARKS:-0}" -gt 0 ] && [ "${ZOOMCSS:-0}" -gt 0 ] && [ "${PINCH:-0}" -gt 0 ]; then
      say "   ✅ زومِ اجباری و pinch-zoom فعال است"
    else
      say "   ❌ تزریق دیده نشد؛ گزارشِ پروکسی:"; tail -15 "$BASE/csproxy.log" 2>/dev/null | sed 's/^/      /'
    fi
    rm -f "$BODY" 2>/dev/null
  fi

  CFG="$HOME/.config/code-server/config.yaml"
  say ""
  if [ "$USE_PROXY" = 1 ]; then
    say "   🌐 باز کنید:  http://$CODE_HOST:$CODE_PORT/"
    say "      زومِ لحظه‌ای: دکمه‌هایِ شناورِ A− / A+ / ⟳ / ⛶ پایینِ صفحه،"
    say "                  یا زومِ دو‌انگشتی، یا  http://$CODE_HOST:$CODE_PORT/?z=1.8"
    say "      زومِ ثابت:  bash $0 --code --zoom 1.8   (در $BASE/zoom ذخیره می‌شود)"
    say "      CSSِ خودت:  bash $0 --code --css ~/mobile.css"
  else
    say "   🌐 باز کنید:  http://$CODE_HOST:$CODE_PORT/"
  fi
  if [ -t 1 ] && [ -f "$CFG" ]; then
    say "   🔑 رمزِ ورود: $(grep -m1 'password:' "$CFG" | cut -d' ' -f2-)"
  else
    say "   🔑 رمزِ ورود: در $CFG"
  fi
  if [ "$OPEN_BROWSER" = 1 ] && command -v termux-open-url >/dev/null 2>&1; then
    termux-open-url "http://127.0.0.1:$CODE_PORT/" 2>/dev/null && say "   📱 در مرورگر باز شد"
  fi
fi

say ""
say "──────────────────────────────────────────────────────────"
say "✅ تمام. وضعیت: bash $0 --status   ·   توقف: bash $0 --stop"
say "   مرورگرِ پیشنهادی: Chrome / Samsung Internet / Edge (زومِ CSS را رعایت می‌کنند)"
say "──────────────────────────────────────────────────────────"
