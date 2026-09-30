#!/usr/bin/env bash
# =============================================================================
#  bootstrap.sh — تأمینِ باینری‌های مرورگر بدون Node/Python/Java و بدون apt
#
#  ترتیب:
#   ۱) کرومیومِ سیستمی پیدا شود → همان.
#   ۲) دانلود chrome-headless-shell (نسخهٔ سبکِ سر‌بی‌سر — به کتابخانه‌های GTK
#      و سطلِ سیستمی نیاز ندارد؛ برای هاست‌های بدون apt عالی‌ترین انتخاب).
#   ۳) در صورت دسترس‌بودن، chromedriver هم دانلود می‌شود (موتور Selenium).
#
#  بازکردن zip: ابتدا unzip، بعد python3 -m zipfile، بعد python -m zipfile،
#  و در نهایت PHP خودش (اگر افزونهٔ zip را داشته باشد). خروجی در ./bin
# =============================================================================
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$HERE/bin"
mkdir -p "$BIN"

have() { command -v "$1" >/dev/null 2>&1; }

fail() { echo "✗ $*"; exit 1; }

download() {  # url → file
  local url="$1" out="$2"
  if have curl; then curl -fL --progress-bar -o "$out" "$url" && return 0; fi
  if have wget; then wget -q -O "$out" "$url" && return 0; fi
  if have python3; then
    python3 - "$url" "$out" <<'PY' && return 0
import sys, urllib.request
urllib.request.urlretrieve(sys.argv[1], sys.argv[2])
PY
  fi
  return 1
}

unzip_file() {  # zip → dir
  local zip="$1" dest="$2"
  if have unzip; then unzip -q -o "$zip" -d "$dest" && return 0; fi
  if have python3; then python3 -m zipfile -e "$zip" "$dest" && return 0; fi
  if have python;  then python  -m zipfile -e "$zip" "$dest" && return 0; fi
  if have php; then
    php -r '$z=new ZipArchive;return $z->open($argv[1])===true&&$z->extractTo($argv[2])&&$z->close()?0:1;' "$zip" "$dest" 2>/dev/null && return 0
  fi
  return 1
}

find_sys_chrome() {
  for n in google-chrome google-chrome-stable chromium chromium-browser chrome microsoft-edge msedge; do
    have "$n" && { command -v "$n"; return 0; }
  done
  return 1
}

echo "── scraper4 render bootstrap (pure binaries, no apt) ──"

if compgen -G "$BIN/*/chrome" >/dev/null 2>&1 || compgen -G "$BIN/*/chrome-headless-shell" >/dev/null 2>&1; then
  echo "✓ باینریِ مرورگر از قبل هست — دانلود رد شد"
elif SYS="$(find_sys_chrome)"; then
  echo "✓ مرورگرِ سیستمی پیدا شد: $SYS  (دانلود لازم نیست)"
else
  if have curl; then
    META="$(curl -fsSL 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json' 2>/dev/null || true)"
  elif have wget; then
    META="$(wget -qO- 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json' 2>/dev/null || true)"
  elif have python3; then
    META="$(python3 -c "import urllib.request;print(urllib.request.urlopen('https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json',timeout=15).read().decode())" 2>/dev/null || true)"
  fi
  [ -n "${META:-}" ] || fail "متادیتای Chrome-for-Testing خوانده نشد — به اینترنت دسترسی هست؟"

  HEADLESS_URL="$(printf '%s' "$META" | grep -o 'https://[^"]*/chrome-headless-shell-linux64\.zip' | head -n1 || true)"
  DRIVER_URL="$(printf '%s' "$META" | grep -o 'https://[^"]*/chromedriver-linux64\.zip' | head -n1 || true)"
  FULL_URL="$(printf '%s' "$META" | grep -o 'https://[^"]*/chrome-linux64\.zip' | head -n1 || true)"

  if [ -n "$HEADLESS_URL" ]; then
    echo "… دانلود chrome-headless-shell (نیازِ کتابخانه‌ایِ کم)"
    download "$HEADLESS_URL" "$BIN/headless.zip" || fail "دانلود ناموفق بود"
    unzip_file "$BIN/headless.zip" "$BIN/" || fail "بازکردن zip ناموفق — unzip ندارید و fallbackٔ python/php هم کار نکرد"
    rm -f "$BIN/headless.zip"
  elif [ -n "$FULL_URL" ]; then
    echo "… headless-shell در متادیتا نیست؛ دانلود chrome کامل: $FULL_URL"
    download "$FULL_URL" "$BIN/chrome.zip" || fail "دانلود ناموفق بود"
    unzip_file "$BIN/chrome.zip" "$BIN/" || fail "بازکردن zip ناموفق"
    rm -f "$BIN/chrome.zip"
  else
    fail "هیچ نشانیِ دانلودی در متادیتا پیدا نشد"
  fi

  if [ -n "$DRIVER_URL" ]; then
    echo "… دانلود chromedriver (موتور Selenium)"
    if download "$DRIVER_URL" "$BIN/driver.zip" && unzip_file "$BIN/driver.zip" "$BIN/"; then
      rm -f "$BIN/driver.zip"
    else
      echo "⚠ دانلود chromedriver ناموفق — موتور CDP کفایت می‌کند"
    fi
  fi
fi

# گزارشِ نهایی + آزمون اجرایی
CHROME_PATH="$(ls -1 "$BIN"/*/chrome-headless-shell "$BIN"/*/chrome 2>/dev/null | head -n1 || true)"
if [ -n "$CHROME_PATH" ]; then
  echo "✓ chrome: $CHROME_PATH"
  if "$CHROME_PATH" --version >/dev/null 2>&1; then
    "$CHROME_PATH" --version || true
  else
    echo "⚠ کروم اجرا نمی‌شود — معمولاً یک کتابخانهٔ سیستمی ناقص است."
    echo "  چون این محیط apt/sudo ندارد، این چگونگی‌ها باقی می‌ماند:"
    echo "   ۱) کنسول hostconsole را با نصبِ کامل (گزینهٔ full-stack) بالا بیاورید تا libs بیاید؛"
    echo "   ۲) اسکریپتِ releaseٔ کنسول که render را آماده می‌کند اجرا شود؛"
    echo "   ۳) از دستور ldd روی همین باینری استفاده کنید تا نام کتابخانهٔ گمشده را ببینید:"
    echo "      ldd \"$CHROME_PATH\" | grep 'not found'"
  fi
else
  echo "ℹ باینریِ دانلودشده در bin/ پیدا نشد — اگر مرورگر سیستمی هست لازم نیست."
fi

CHROMEDRIVER_PATH="$(ls -1 "$BIN"/*/chromedriver 2>/dev/null | head -n1 || true)"
[ -n "$CHROMEDRIVER_PATH" ] && echo "✓ chromedriver: $CHROMEDRIVER_PATH" || echo "ℹ chromedriver جدا نیست (اختیاری — موتور Selenium)"

echo "── done — سرویس را با start.sh بالا بیاورید ──"
