#!/data/data/com.termux/files/usr/bin/bash
# =====================================================================
#  s4-remote.sh — دسترسی به فایل‌هایِ خصوصیِ ترموکس از بیرونِ ترموکس
#
#  دو راه را با هم راه می‌اندازد:
#
#   ۲) SFTP با sshd روی پورتِ ۸۰۲۲
#      → هر فایل‌منیجری که SFTP دارد (Solid Explorer, MiXplorer, X-plore,
#        Cx, Material Files) می‌تواند کلِ /data/data/com.termux/files/home
#        را با حق‌هایِ درست ببیند و ویرایش کند.
#        در خودِ فایل‌منیجر: host=127.0.0.1  port=8022  user=$(whoami)
#
#   ۳) code-server با تنظیماتِ درشت برایِ موبایل
#      → مشکلِ «محیطِ code-server روی موبایل ریز است» با window.zoomLevel
#        و اندازهٔ فونتِ بزرگ حل می‌شود؛ تنظیمات در
#        ~/.local/share/code-server/User/settings.json نوشته/ادغام می‌شود.
#
#  کاربرد:
#     bash s4-remote.sh                 # هر دو
#     bash s4-remote.sh --ssh           # فقط SFTP
#     bash s4-remote.sh --code          # فقط code-server
#     bash s4-remote.sh --set-password  # گذاشتنِ رمزِ ssh (لازم است)
#     bash s4-remote.sh --status
#     bash s4-remote.sh --stop
#     bash s4-remote.sh --code-port 8081 --ssh-port 8022
#     bash s4-remote.sh --zoom 2.0      # بزرگ‌نماییِ code-server
#
#  نکتهٔ امنیتی: sshd و code-server فقط به 127.0.0.1 بسته می‌شوند.
#  اگر می‌خواهید از کامپیوترِ دیگری رویِ همان وای‌فای وصل شوید، نشانیِ LAN
#  چاپ می‌شود ولی باید خودتان با --bind-lan صریح اجازه بدهید.
# =====================================================================
set -u

VERSION="1.0.0"
SSH_PORT="${SSH_PORT:-8022}"
CODE_PORT="${CODE_PORT:-8081}"
CODE_HOST="127.0.0.1"
BASE="$HOME/.s4-remote"
ZOOM="1.6"
DO_SSH=0; DO_CODE=0; STOP=0; STATUS=0; SET_PW=0; BIND_LAN=0; NO_SETTINGS=0

say() { printf '%s\n' "$*"; }
die() { printf '❌ %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --ssh)          DO_SSH=1; shift ;;
    --code)         DO_CODE=1; shift ;;
    --both)         DO_SSH=1; DO_CODE=1; shift ;;
    --stop)         STOP=1; shift ;;
    --status)       STATUS=1; shift ;;
    --set-password) SET_PW=1; shift ;;
    --ssh-port)     SSH_PORT="${2:-8022}"; shift 2 ;;
    --code-port)    CODE_PORT="${2:-8081}"; shift 2 ;;
    --zoom)         ZOOM="${2:-1.6}"; shift 2 ;;
    --zoom=*)       ZOOM="${1#*=}"; shift ;;
    --bind-lan)     BIND_LAN=1; CODE_HOST="0.0.0.0"; shift ;;
    --no-settings)  NO_SETTINGS=1; shift ;;
    -h|--help)      sed -n '2,33p' "$0"; exit 0 ;;
    *)              die "flag ناشناخته: $1 (--help)" ;;
  esac
done
[ "$DO_SSH" = 0 ] && [ "$DO_CODE" = 0 ] && { DO_SSH=1; DO_CODE=1; }

mkdir -p "$BASE" 2>/dev/null || true

# ------------------------------------------------------------------ status
if [ "$STATUS" = 1 ]; then
  say "📡 s4-remote $VERSION"
  say "   sshd:       $(command -v sshd >/dev/null 2>&1 && echo "نصب ($(command -v sshd))" || echo 'نصب نیست')"
  say "   code-server:$(command -v code-server >/dev/null 2>&1 && echo " نصب ($(code-server --version 2>/dev/null | head -1))" || echo ' نصب نیست')"
  if command -v ss >/dev/null 2>&1; then say "   گوش‌دهنده‌ها:"; ss -ltn 2>/dev/null | sed 's/^/      /'; fi
  say "   کاربرِ ssh: $(whoami)  ·  پورت: $SSH_PORT"
  say "   پسوندهایِ code-server: ${HOME}/.local/share/code-server"
  exit 0
fi

if [ "$STOP" = 1 ]; then
  pkill -f "sshd" 2>/dev/null && say "✅ sshd متوقف شد" || say "⚠️ sshd در حالِ اجرا نبود"
  pkill -f "code-server" 2>/dev/null && say "✅ code-server متوقف شد" || say "⚠️ code-server در حالِ اجرا نبود"
  rm -f "$BASE/sshd.pid" "$BASE/code.pid" 2>/dev/null
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
    if command -v pkg >/dev/null 2>&1; then
      yes | pkg install -y openssh 2>&1 | tail -8 | sed 's/^/   /'
    else
      die "pkg پیدا نشد؛ openssh را دستی نصب کنید"
    fi
  fi
  command -v sshd >/dev/null 2>&1 || die "sshd نصب نشد"

  # host keys
  if ! ls "$PREFIX/etc/ssh"/ssh_host_* >/dev/null 2>&1; then
    say "🔐 ساختِ کلیدهایِ میزبان …"
    ssh-keygen -A 2>&1 | tail -6 | sed 's/^/   /'
  fi

  LAN_IP="$( { ip -4 addr show wlan0 2>/dev/null || ifconfig wlan0 2>/dev/null; } | grep -o 'inet [0-9.]*' | head -1 | cut -d' ' -f2 )"

  if ! pgrep -f sshd >/dev/null 2>&1; then
    sshd -p "$SSH_PORT" 2>"$BASE/sshd.err" && say "✅ sshd رویِ پورتِ $SSH_PORT بالا آمد" \
      || { say "❌ sshd بالا نیامد:"; sed 's/^/      /' "$BASE/sshd.err"; }
  else
    say "ℹ️ sshd از قبل در حالِ اجراست"
  fi
  sleep 1
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -q ":$SSH_PORT " && say "   گوش می‌دهد ✅" || say "   ⚠️ رویِ پورتِ $SSH_PORT چیزی گوش نمی‌دهد"
  fi

  say ""
  say "   در فایل‌منیجرِ اندروید یک اتصالِ SFTP/Remote بسازید:"
  say "      host:     127.0.0.1"
  say "      port:     $SSH_PORT"
  if [ -t 1 ]; then
    say "      username: $(whoami)"
    say "      password: همان رمزی که با passwd گذاشتید (اگر نگذاشته‌اید: bash $0 --set-password)"
  else
    say "      username: (خروجیِ whoami)"
    say "      password: (با --set-password تعیین شود؛ اینجا چاپ نمی‌شود)"
  fi
  say "      path:     ~   (یعنی $HOME)"
  [ -n "${LAN_IP:-}" ] && say "   از کامپیوترِ رویِ همان وای‌فای: $LAN_IP:$SSH_PORT"
  say "   توقف: pkill sshd   ·   شروعِ خودکار: pkg install termux-services && sv-enable sshd"
fi

# ==================================================== route 3: code-server
if [ "$DO_CODE" = 1 ]; then
  say ""
  say "══════════ ۳) code-server (با رابطِ درشت برایِ موبایل) ══════════"
  command -v code-server >/dev/null 2>&1 || { say "⚠️ code-server نصب نیست: pkg install code-server"; DO_CODE=0; }
fi
if [ "$DO_CODE" = 1 ]; then
  SETTINGS_DIR="$HOME/.local/share/code-server/User"
  SETTINGS="$SETTINGS_DIR/settings.json"
  if [ "$NO_SETTINGS" = 0 ]; then
    mkdir -p "$SETTINGS_DIR" 2>/dev/null
    if command -v python3 >/dev/null 2>&1; then
      [ -f "$SETTINGS" ] && cp -p "$SETTINGS" "$SETTINGS.bak.$(date +%s)" 2>/dev/null
      ZOOM="$ZOOM" SETTINGS="$SETTINGS" python3 - <<'PY' 2>&1 | sed 's/^/   /'
import json, os
p = os.environ["SETTINGS"]
try:
    cur = json.load(open(p, encoding="utf-8")) if os.path.isfile(p) else {}
    if not isinstance(cur, dict):
        cur = {}
except Exception:
    cur = {}
mobile = {
    "window.zoomLevel": float(os.environ.get("ZOOM", "1.6")),
    "editor.fontSize": 18,
    "editor.lineHeight": 30,
    "editor.wordWrap": "on",
    "editor.minimap.enabled": False,
    "editor.scrollbar.verticalScrollbarSize": 18,
    "editor.scrollbar.horizontalScrollbarSize": 18,
    "editor.renderLineHighlight": "all",
    "terminal.integrated.fontSize": 16,
    "terminal.integrated.lineHeight": 1.3,
    "workbench.tree.indent": 22,
    "workbench.list.smoothScrolling": True,
    "breadcrumbs.enabled": False,
    "window.menuBarVisibility": "compact",
    "explorer.compactFolders": False,
    "files.simpleDialog.enable": True,
    "editor.stickyScroll.enabled": False,
    "telemetry.telemetryLevel": "off",
}
added = {k: v for k, v in mobile.items() if cur.get(k) != v}
cur.update(mobile)
json.dump(cur, open(p, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print("settings written:", p)
print("changed keys:", ", ".join(sorted(added)) or "none")
PY
    else
      say "   ⚠️ python3 نیست؛ تنظیمات ادغام نشد. اینها را دستی در $SETTINGS بگذارید:"
      say '      {"window.zoomLevel": '"$ZOOM"', "editor.fontSize": 18, "editor.wordWrap": "on", "editor.minimap.enabled": false, "workbench.tree.indent": 22}'
    fi
  fi

  if pgrep -f code-server >/dev/null 2>&1; then
    say "ℹ️ code-server از قبل در حالِ اجراست (برایِ اعمالِ تنظیمات: bash $0 --stop و دوباره اجرا کنید)"
  else
    say "🚀 شروعِ code-server رویِ $CODE_HOST:$CODE_PORT …"
    ( cd "$HOME" && nohup code-server \
        --bind-addr "$CODE_HOST:$CODE_PORT" \
        --auth password --disable-telemetry --disable-update-check \
        "$HOME" > "$BASE/code-server.log" 2>&1 &
      echo $! > "$BASE/code.pid" ) 2>/dev/null
    sleep 6
    if kill -0 "$(cat "$BASE/code.pid" 2>/dev/null)" 2>/dev/null; then
      say "✅ در حالِ اجرا (pid $(cat "$BASE/code.pid"))"
    else
      say "❌ بالا نیامد؛ گزارش:"; tail -20 "$BASE/code-server.log" 2>/dev/null | sed 's/^/      /'
    fi
  fi
  CFG="$HOME/.config/code-server/config.yaml"
  say ""
  say "   🌐 http://$CODE_HOST:$CODE_PORT/"
  if [ -t 1 ] && [ -f "$CFG" ]; then
    say "   🔑 رمز: $(grep -m1 'password:' "$CFG" | cut -d' ' -f2-)"
  else
    say "   🔑 رمز: در $CFG"
  fi
  say "   📏 اگر هنوز ریز است: داخلِ VS Code بزنید Ctrl/Cmd + = یا --zoom 2.4 را دوباره اجرا کنید"
  [ "$CODE_HOST" = "0.0.0.0" ] && say "   ⚠️ رویِ همهٔ رابط‌ها گوش می‌دهد (LAN) — رمز لازم است"
fi

say ""
say "──────────────────────────────────────────────────────────"
say "✅ تمام. وضعیت: bash $0 --status   ·   توقف: bash $0 --stop"
say "──────────────────────────────────────────────────────────"
