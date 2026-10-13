#!/data/data/com.termux/files/usr/bin/bash
# =====================================================================
#  termux-panel.sh — بالا آوردنِ «پنل استقرار» در ترموکس، بدونِ دامنه و هاست
#
#  چرا این اسکریپت: پنل یک فایلِ PHP است و در ترموکس باید با سرورِ داخلیِ
#  PHP سرو شود. دو اشتباهِ رایج باعثِ «وارد نمی‌شود» می‌شوند:
#    ۱) فایل روی /sdcard (حافظهٔ مشترک) است ⇒ نوشتنِ .deploy-config.json،
#       chmod و rename اتمیک کار نمی‌کنند ⇒ راه‌اندازی هرگز تمام نمی‌شود.
#    ۲) فایل مستقیم در مرورگر باز شده (file://...) ⇒ PHP اصلاً اجرا نشده.
#
#  استفاده:
#     bash termux-panel.sh                 # پوشهٔ جاری
#     bash termux-panel.sh ~/deploy        # پوشهٔ دلخواه
#     PORT=9000 bash termux-panel.sh       # پورتِ دیگر
#     bash termux-panel.sh --fix           # اجرای deploy-doctor با تعمیر
# =====================================================================
set -u

DIR="${1:-$PWD}"
FIX=0
case "${1:-}" in --fix|-f) FIX=1; DIR="${2:-$PWD}";; esac
PORT="${PORT:-8080}"
HOST="${HOST:-127.0.0.1}"

say() { printf '%s\n' "$*"; }
die() { printf '❌ %s\n' "$*" >&2; exit 1; }

command -v php >/dev/null 2>&1 || die "php نصب نیست:  pkg install php"
say "🐘 PHP: $(php -r 'echo PHP_VERSION;' 2>/dev/null)  ($(php -r 'echo PHP_SAPI;' 2>/dev/null))"

[ -d "$DIR" ] || die "پوشه پیدا نشد: $DIR"
DIR="$(cd "$DIR" && pwd)"
say "📁 پوشه: $DIR"

# ۱) حافظهٔ مشترکِ اندروید جایِ درستِ اجرای پنل نیست
case "$DIR" in
  /sdcard/*|/storage/*|*/storage/shared/*|/mnt/sdcard/*|/mnt/media/*|/mnt/shared/*)
    say "⚠️  پوشه روی حافظهٔ مشترکِ اندروید است؛ آنجا chmod/rename کار نمی‌کند."
    NEW="$HOME/deploy"
    printf '   انتقال به %s ؟ [Y/n] ' "$NEW"
    read -r ans
    case "${ans:-Y}" in n|N) say "   ادامه با همان پوشه (احتمالاً راه‌اندازی شکست می‌خورد)";;
      *) mkdir -p "$NEW" || die "ساختِ $NEW ناموفق بود"
         cp -a "$DIR"/. "$NEW"/ 2>/dev/null || die "کپی ناموفق بود"
         DIR="$NEW"; say "   ✅ منتقل شد: $DIR";;
    esac ;;
esac

PANEL=""
for c in deploy.php deploy-panel.php panel.php index.php; do
  [ -f "$DIR/$c" ] && PANEL="$c" && break
done
[ -n "$PANEL" ] || die "هیچ فایلِ پنلی (deploy.php / index.php) در $DIR پیدا نشد"
say "🚀 پنل: $DIR/$PANEL"

# ۲) تشخیصِ سریع، پیش از بالا آوردنِ سرور
if [ -f "$DIR/deploy-doctor.php" ]; then
  say "🩺 در حالِ اجرای deploy-doctor..."
  if [ "$FIX" = 1 ]; then php "$DIR/deploy-doctor.php" "$DIR/$PANEL" --fix; else php "$DIR/deploy-doctor.php" "$DIR/$PANEL"; fi
  say ""
fi

# ۳) بررسیِ نحویِ خودِ پنل (بدونِ exec هم شدنی است، ولی اینجا CLI داریم)
php -l "$DIR/$PANEL" >/dev/null 2>&1 || { php -l "$DIR/$PANEL"; die "خطای نحوی در $PANEL — اول آن را درست کنید"; }

# ۴) .htaccess مسدودکننده (برای سرورِ داخلیِ PHP بی‌اثر است، ولی اگر روزی
#    با Apache ترموکس سرو شود همه‌چیز ۴۰۳ می‌شود)
if [ -f "$DIR/.htaccess" ] && grep -Eq 'Require all denied|Deny from all' "$DIR/.htaccess" \
   && ! grep -Eq '<(FilesMatch|Files)' "$DIR/.htaccess"; then
  say "⚠️  .htaccess بدونِ <FilesMatch> همه‌چیز را مسدود می‌کند؛ کنار گذاشته شد:"
  mv "$DIR/.htaccess" "$DIR/.htaccess.disabled" && say "   → .htaccess.disabled"
fi

# ۵) پورتِ آزاد
if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":$PORT "; then
  say "⚠️  پورتِ $PORT اشغال است؛ پورتِ دیگری با PORT=9000 bash $0 انتخاب کنید."
fi

say ""
say "──────────────────────────────────────────────────────────"
say "🌐  http://$HOST:$PORT/$PANEL"
say "    (در مرورگرِ همان گوشی باز کنید؛ ترموکس را باز نگه دارید)"
say "    توقف: Ctrl+C"
say "    خطاها: $DIR/php-error.log   (با DEBUG=1 روی صفحه هم نمایش داده می‌شوند)"
say "──────────────────────────────────────────────────────────"

# ۶) تنظیماتِ حیاتیِ PHP برای اجرای پنل
#    • opcache.enable=0 → بدونِ آن، php -S روی ترموکس با
#      «Error Cannot create lock - Permission denied (13)» فوراً می‌میرد
#      (قفلِ fcntl روی حافظهٔ مشترک/اندروید ساخته نمی‌شود) ⇒ پنل «وارد نمی‌شود».
#    • display_errors پیش‌فرض خاموش: هر Deprecated/Notice قبل از JSON چاپ شود،
#      پاسخِ api() خراب می‌شود و دکمه‌های پنل بی‌اثر می‌مانند (PHP 8.5 پر از
#      Deprecated جدید است، مثل $http_response_header).
ERRLOG="$DIR/php-error.log"
PHPDBG="Off"; [ "${DEBUG:-0}" = 1 ] && PHPDBG="1"
exec php -d opcache.enable=0 -d opcache.enable_cli=0 \
     -d opcache.lockfile_path="${PREFIX:-/tmp}/tmp" \
     -d display_errors="$PHPDBG" -d display_startup_errors=0 \
     -d log_errors=1 -d error_log="$ERRLOG" \
     -d error_reporting="E_ALL & ~E_DEPRECATED & ~E_STRICT" \
     -d memory_limit=512M \
     -d upload_max_filesize=64M -d post_max_size=64M -d max_execution_time=0 \
     -S "$HOST:$PORT" -t "$DIR"
