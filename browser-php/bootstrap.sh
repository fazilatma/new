#!/usr/bin/env bash
# =============================================================================
#  bootstrap.sh — تأمینِ باینری‌های مرورگر بدون Node/Python/Java
#
#  اگر کروم/کرومیومی روی سیستم نباشد، نسخهٔ قابل‌حملِ «Chrome for Testing»
#  (آرشیو zip خام از گوگل — بدون محیط اجرای اضافه) را کنار خود پوشه دانلود
#  می‌کند:
#     bin/chrome-linux64/chrome            ← موتور CDP (پلی‌رایتِ خالص‌PHP)
#     bin/chromedriver-linux64/chromedriver ← موتور Selenium (W3C WebDriver)
#
#  پیش‌نیازها: curl و unzip  (وابستگی زبانی ندارد؛ فقط ابزار سیستم)
#     Debian/Ubuntu:  apt install -y curl unzip
# =============================================================================
set -eu
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$HERE/bin"
mkdir -p "$BIN"

have() { command -v "$1" >/dev/null 2>&1; }

find_linux_sys_chrome() {
  for n in google-chrome google-chrome-stable chromium chromium-browser chrome; do
    have "$n" && { echo "$(command -v "$n")"; return 0; }
  done
  return 1
}

echo "── scraper4 render bootstrap (pure binaries) ──"

NEED_CHROME=1
if compgen -G "$BIN/*/chrome" >/dev/null; then NEED_CHROME=0; fi
if [ "$NEED_CHROME" = "1" ]; then
  if SYS="$(find_linux_sys_chrome)"; then
    echo "✓ مرورگرِ سیستمی پیدا شد: $SYS  (دانلود لازم نیست)"
    NEED_CHROME=0
  fi
fi

if [ "$NEED_CHROME" = "1" ]; then
  have curl || { echo "✗ curl نیست — ابتدا نصب کنید: apt install -y curl"; exit 1; }
  have unzip || { echo "✗ unzip نیست — ابتدا نصب کنید: apt install -y unzip"; exit 1; }

  echo "… خواندن نسخهٔ Stable از متادیتای Chrome-for-Testing"
  META="$(curl -fsSL 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json')"
  CHROME_URL="$(printf '%s' "$META" | grep -o 'https://[^"]*/chrome-linux64\.zip' | head -n1)"
  DRIVER_URL="$(printf '%s' "$META" | grep -o 'https://[^"]*/chromedriver-linux64\.zip' | head -n1)"
  [ -n "$CHROME_URL" ] || { echo "✗ نشانی دانلود کرومیوم پیدا نشد"; exit 1; }

  echo "… دانلود کرومیوم: $CHROME_URL"
  curl -fL --progress-bar -o "$BIN/chrome-linux64.zip" "$CHROME_URL"
  unzip -q -o "$BIN/chrome-linux64.zip" -d "$BIN/"
  rm -f "$BIN/chrome-linux64.zip"

  if [ -n "$DRIVER_URL" ]; then
    echo "… دانلود chromedriver: $DRIVER_URL"
    curl -fL --progress-bar -o "$BIN/chromedriver-linux64.zip" "$DRIVER_URL"
    unzip -q -o "$BIN/chromedriver-linux64.zip" -d "$BIN/"
    rm -f "$BIN/chromedriver-linux64.zip"
  else
    echo "⚠ chromedriver در متادیتا پیدا نشد؛ موتور Selenium از chromedriver سیستمی استفاده می‌کند"
  fi
fi

# اگر chromedriverِ خودمان نیست ولی سیستم دارد، فقط اطلاع بده
if ! compgen -G "$BIN/*/chromedriver" >/dev/null; then
  if have chromedriver; then echo "✓ chromedriver سیستمی: $(command -v chromedriver)"; else
    echo "ℹ chromedriver نیست — موتور CDP کفایت می‌کند؛ برای Selenium این اسکریپت را وقتی اینترنت دارید دوباره بزنید"
  fi
fi

# بررسی وابستگی‌های لینکری کروم (bookworm و قدیمی‌تر ممکن است بخواهند)
if compgen -G "$BIN/*/chrome" >/dev/null; then
  CHR="$(ls -1 "$BIN"/*/chrome | head -n1)"
  echo "✓ chrome: $CHR"
  if ! "$CHR" --version >/dev/null 2>&1; then
    echo "⚠ کروم اجرا نمی‌شود — احتمالاً کتابخانه‌های سیستمی ناقص است."
    echo "  Debian/Ubuntu (به‌عنوان root):"
    echo "  apt install -y libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpangocairo-1.0-0 libpango-1.0-0 libcairo2 libx11-xcb1 libxcursor1 libxi6 libxtst6 libxss1 libglib2.0-0"
  else
    "$CHR" --version || true
  fi
fi

echo "── done — سرویس را با start.sh بالا بیاورید ──"
