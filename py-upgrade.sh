#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
#  py-upgrade.sh — نصب/ارتقای پایتون روی هاست اشتراکی، بدون root و بدون کامپایلر
#  بخشی از WebConsole Pro  ·  https://github.com/fazilatma/new
#
#  اجرا مستقیم از گیت‌هاب:
#    curl -fsSL https://raw.githubusercontent.com/fazilatma/new/hostconsole-nvm-node20/py-upgrade.sh | bash
#
#  با آرگومان (حتماً «-s --» بعد از bash):
#    curl -fsSL .../py-upgrade.sh | bash -s -- 3.14
#    curl -fsSL .../py-upgrade.sh | bash -s -- 3.14 ~/apps/scraper
#
#  یا دانلود و اجرای محلی:
#    curl -fsSLO https://raw.githubusercontent.com/fazilatma/new/hostconsole-nvm-node20/py-upgrade.sh
#    bash py-upgrade.sh 3.14 ~/apps/scraper
#
#  چرا uv و نه کامپایل از سورس؟ چون روی هاست اشتراکی کامپایل معمولاً به‌خاطر
#  نبودن هدرهای openssl/zlib/libffi شکست می‌خورد یا با محدودیت CPU/RAM کشته
#  می‌شود. uv بیلد آمادهٔ CPython را در چند ثانیه می‌گیرد.
#
#  مهم: با «bash» اجرا کن نه «sh» — این اسکریپت از قابلیت‌های bash استفاده می‌کند.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

PYUP_VERSION="1.0.1"
RAW_BASE="https://raw.githubusercontent.com/fazilatma/new/hostconsole-nvm-node20"

# ── رنگ فقط وقتی خروجی ترمینال است ────────────────────────────────────────────
if [ -t 1 ]; then
    C_HEAD=$'\033[1;36m'; C_OK=$'\033[1;32m'; C_WARN=$'\033[1;33m'
    C_ERR=$'\033[1;31m';  C_DIM=$'\033[2m';   C_OFF=$'\033[0m'
else
    C_HEAD=''; C_OK=''; C_WARN=''; C_ERR=''; C_DIM=''; C_OFF=''
fi
say()  { printf '\n%s▶ %s%s\n'   "$C_HEAD" "$*" "$C_OFF"; }
ok()   { printf '%s  ✔ %s%s\n'   "$C_OK"   "$*" "$C_OFF"; }
warn() { printf '%s  ! %s%s\n'   "$C_WARN" "$*" "$C_OFF"; }
die()  { printf '\n%s✘ %s%s\n\n' "$C_ERR"  "$*" "$C_OFF" >&2; exit 1; }

usage() {
    cat <<EOF
py-upgrade.sh v$PYUP_VERSION

  bash py-upgrade.sh [نسخه] [مسیر پروژه]

  نسخه        پیش‌فرض 3.14 . مثلاً 3.13 یا 3.15
  مسیر پروژه  اگر بدهی، برایش venv می‌سازد و requirements.txt را نصب می‌کند

نمونه‌ها
  bash py-upgrade.sh
  bash py-upgrade.sh 3.14
  bash py-upgrade.sh 3.14 ~/apps/scraper
  curl -fsSL $RAW_BASE/py-upgrade.sh | bash -s -- 3.14 ~/apps/scraper
EOF
    exit 0
}

case "${1:-}" in -h|--help|help) usage ;; esac
case "${1:-}" in -V|--version) echo "py-upgrade.sh v$PYUP_VERSION"; exit 0 ;; esac

VER="${1:-${PYVER:-3.14}}"
PROJ="${2:-${PROJECT:-}}"

[[ "$VER" =~ ^3\.[0-9]+(\.[0-9]+)?$ ]] || die "نسخهٔ نامعتبر: «$VER» . مثل 3.14 بنویس."

# آیا از طریق لوله اجرا شده‌ایم؟ ($0 فایل واقعی نیست)
if [ -f "${BASH_SOURCE[0]:-$0}" ] 2>/dev/null; then
    SELF="bash ${BASH_SOURCE[0]:-$0}"
else
    SELF="curl -fsSL $RAW_BASE/py-upgrade.sh | bash -s --"
fi

printf '%s╭─ py-upgrade.sh v%s ─ پایتون %s%s\n' "$C_DIM" "$PYUP_VERSION" "$VER" "$C_OFF"

# ── HOME ────────────────────────────────────────────────────────────────────
# روی بعضی هاست‌های اشتراکی (jailshell / CageFS / cron) متغیر HOME خالی است یا
# export نشده، پس یک شل جدید آن را نمی‌بیند. نتیجه‌اش این است که "$HOME/.local/bin"
# به "/.local/bin" تبدیل می‌شود و همه چیز خراب می‌شود. اینجا خودمان پیدایش می‌کنیم.
if [ -z "${HOME:-}" ] || [ ! -d "${HOME:-/nonexistent}" ]; then
    _was="${HOME-<unset>}"
    _u="$(id -un 2>/dev/null || echo '')"
    _h=""
    if [ -n "$_u" ]; then
        command -v getent >/dev/null 2>&1 && _h="$(getent passwd "$_u" 2>/dev/null | cut -d: -f6 || true)"
        [ -n "$_h" ] || { [ -r /etc/passwd ] && _h="$(awk -F: -v u="$_u" '$1==u{print $6; exit}' /etc/passwd 2>/dev/null || true)"; }
        [ -n "$_h" ] || { [ -d "/home/$_u" ] && _h="/home/$_u"; }
    fi
    # bash خودش «~» را از passwd حل می‌کند حتی وقتی HOME خالی است
    [ -n "$_h" ] || _h="$(cd ~ 2>/dev/null && pwd || true)"
    [ -n "$_h" ] && [ -d "$_h" ] || die "HOME تعریف نشده و نتوانستم پیدایش کنم. دستی بده:  export HOME=/home/USERNAME"
    export HOME="$_h"
    warn "متغیر HOME قابل استفاده نبود (مقدارش: $_was) — خودم پیدایش کردم: $HOME"
    warn "به همین دلیل بود که «export PATH=\"\$HOME/.local/bin:...\"» قبلاً به /.local/bin تبدیل می‌شد."
    warn "برای همیشه:  echo 'export HOME=$_h' >> ~/.bashrc"
fi
export HOME
LB="$HOME/.local/bin"
export PATH="$LB:$PATH"
export UV_LINK_MODE=copy   # روی هاست اشتراکی، کش و پروژه معمولاً روی دو فایل‌سیستم‌اند

# ── ۱) uv ─────────────────────────────────────────────────────────────────────
UV=""
if [ -x "$LB/uv" ]; then
    UV="$LB/uv"
    ok "uv از قبل نصب بود: $("$UV" --version 2>/dev/null || echo '?')"
elif command -v uv >/dev/null 2>&1; then
    UV="$(command -v uv)"
    ok "uv پیدا شد: $UV"
else
    say "نصب uv — یک باینری استاتیک، بدون نیاز به پایتون یا کامپایلر"
    if command -v curl >/dev/null 2>&1; then
        curl -LsSf https://astral.sh/uv/install.sh | sh
    elif command -v wget >/dev/null 2>&1; then
        wget -qO- https://astral.sh/uv/install.sh | sh
    else
        die "نه curl داری نه wget؛ یکی‌شان لازم است."
    fi
    [ -x "$LB/uv" ] || die "uv نصب شد ولی در $LB پیدا نشد."
    UV="$LB/uv"
    ok "uv نصب شد: $("$UV" --version)"
fi

# ── ۲) پایتون ─────────────────────────────────────────────────────────────────
say "نصب پایتون $VER (بیلد آماده — کامپایل نمی‌شود)"
"$UV" python install "$VER"

PY="$("$UV" python find "$VER" 2>/dev/null || true)"
[ -n "$PY" ] && [ -x "$PY" ] || die "مفسر $VER بعد از نصب پیدا نشد."
PYV="$("$PY" -V 2>&1 | awk '{print $2}')"
ok "Python $PYV  →  $PY"

# ── ۳) تلهٔ PATH در هاست‌کنسول ────────────────────────────────────────────────
# هاست‌کنسول در هر اسکریپت اجرا این PATH را می‌نویسد و /usr/bin جلوتر از
# ~/.local/bin است، پس «python3» خالی همچنان مفسر قدیمی سیستم را می‌گیرد.
CONSOLE_PATH="/usr/local/bin:/usr/bin:/bin:/usr/local/games:/usr/games:/opt/conda/bin:$LB"
RES="$(PATH="$CONSOLE_PATH" command -v python3 2>/dev/null || echo '')"
RESV="$(PATH="$CONSOLE_PATH" python3 -V 2>&1 | awk '{print $2}' || echo '?')"

say "«python3» خالی به کدام مفسر می‌رسد؟"
if [ -z "$RES" ]; then
    warn "با PATH هاست‌کنسول، python3 اصلاً پیدا نمی‌شود."
else
    printf '  با PATH هاست‌کنسول:  python3 → %s  (%s)\n' "$RES" "$RESV"
    if [ "$RES" != "$PY" ]; then
        warn "این پایتون قدیمی است، نه $PYV ."
        warn "چون /usr/bin در PATH جلوتر از $LB است."
        warn "پس در تنظیمات پروژه باید مسیر کامل را بنویسی، نه python3 خالی."
    else
        ok "همان نسخهٔ جدید است."
    fi
fi

# ── ۴) venv پروژه ─────────────────────────────────────────────────────────────
if [ -n "$PROJ" ]; then
    PROJ="${PROJ/#\~/$HOME}"
    [ -d "$PROJ" ] || die "پوشهٔ پروژه پیدا نشد: $PROJ"
    PROJ="$(cd "$PROJ" && pwd)"

    say "ساخت venv در $PROJ/.venv"
    # ‑‑seed لازم است وگرنه pip داخل venv نیست و «python -m pip» شکست می‌خورد
    ( cd "$PROJ" && "$UV" venv --python "$VER" --seed .venv )

    VPY="$PROJ/.venv/bin/python"
    [ -x "$VPY" ] || die "venv ساخته نشد."

    if [ -f "$PROJ/requirements.txt" ]; then
        say "نصب requirements.txt"
        ( cd "$PROJ" && "$UV" pip install --python .venv/bin/python -r requirements.txt )
    else
        warn "requirements.txt نبود؛ venv خالی ساخته شد."
    fi
    ok "Python $("$VPY" -V 2>&1 | awk '{print $2}')  →  $VPY"

    ENTRY=""
    for c in main.py app.py scraper4.py bot.py server.py run.py deployer4.py manage.py; do
        [ -f "$PROJ/$c" ] && { ENTRY="$c"; break; }
    done
    [ -n "$ENTRY" ] || ENTRY="your_script.py"

    say "این دو را در تنظیمات پروژهٔ هاست‌کنسول بگذار"
    printf '  دستور نصب :  %s -m pip install -r requirements.txt\n' "$VPY"
    printf '  دستور اجرا :  %s %s\n' "$VPY" "$ENTRY"
else
    say "استفاده"
    printf '  اجرای مستقیم :  %s your_script.py\n' "$PY"
    printf '\n  %sبرای هر پروژه یک venv جدا بساز (توصیه‌شده):%s\n' "$C_DIM" "$C_OFF"
    printf '    %s %s ~/apps/scraper\n' "$SELF" "$VER"
fi

say "تمام"
printf '  برای اینکه uv و پایتون در SSH همیشه در دسترس باشند، یک بار این را بزن:\n'
printf "    echo 'source %s/env' >> %s/.bashrc\n" "$LB" "$HOME"
