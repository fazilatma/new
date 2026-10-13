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
LIB="$HERE/lib"
LOCK="$HERE/.bootstrap.lock"
mkdir -p "$BIN" "$LIB"
render_lib_path() { printf '%s:%s:%s' "$LIB/usr/lib/x86_64-linux-gnu" "$LIB/lib/x86_64-linux-gnu" "$LIB"; }
export LD_LIBRARY_PATH="$(render_lib_path):${LD_LIBRARY_PATH:-}"

acquire_bootstrap_lock() {
  local i oldpid
  if mkdir "$LOCK" 2>/dev/null; then
    echo "$$" > "$LOCK/pid" 2>/dev/null || true
    trap 'rm -rf "$LOCK"' EXIT INT TERM
    return 0
  fi
  oldpid="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [ -n "$oldpid" ] && ! kill -0 "$oldpid" 2>/dev/null; then
    rm -rf "$LOCK" 2>/dev/null || true
    if mkdir "$LOCK" 2>/dev/null; then
      echo "$$" > "$LOCK/pid" 2>/dev/null || true
      trap 'rm -rf "$LOCK"' EXIT INT TERM
      return 0
    fi
  fi
  echo "… bootstrap دیگری در حال اجراست؛ انتظار کوتاه برای جلوگیری از دانلود همزمان"
  i=0
  while [ -d "$LOCK" ] && [ "$i" -lt 45 ]; do sleep 2; i=$((i+1)); done
  if mkdir "$LOCK" 2>/dev/null; then
    echo "$$" > "$LOCK/pid" 2>/dev/null || true
    trap 'rm -rf "$LOCK"' EXIT INT TERM
    return 0
  fi
  echo "⚠ bootstrap هنوز قفل است؛ ادامه نمی‌دهم تا فایل‌های مرورگر نصفه جایگزین نشوند"
  exit 0
}

chmod_render_bins() {
  local f
  for f in "$BIN"/*/chrome-headless-shell "$BIN"/*/chrome "$BIN"/*/chromedriver; do
    [ -e "$f" ] && chmod +x "$f" 2>/dev/null || true
  done
}
chmod_render_bins

have() { command -v "$1" >/dev/null 2>&1; }

fail() { echo "✗ $*"; exit 1; }

download_once() {  # url → file
  local url="$1" out="$2"
  if have curl; then curl -fL --connect-timeout 8 --max-time 45 --progress-bar -o "$out" "$url" && return 0; fi
  if have wget; then wget -q --timeout=15 --tries=1 -O "$out" "$url" && return 0; fi
  if have python3; then
    python3 - "$url" "$out" <<'PY' && return 0
import sys, urllib.request
urllib.request.urlretrieve(sys.argv[1], sys.argv[2])
PY
  fi
  return 1
}

download() {  # url → file  (v10.200: try mirror before Google storage on restricted hosts)
  local url="$1" out="$2" rel="" alt1="" alt2=""
  case "$url" in
    https://storage.googleapis.com/chrome-for-testing-public/*)
      rel="${url#https://storage.googleapis.com/chrome-for-testing-public/}"
      alt1="https://registry.npmmirror.com/-/binary/chrome-for-testing/$rel"
      alt2="https://cdn.npmmirror.com/binaries/chrome-for-testing/$rel"
      echo "… تلاش با mirror برای Chrome-for-Testing: registry.npmmirror.com"
      download_once "$alt1" "$out" && return 0
      echo "… mirror اول ناموفق بود؛ تلاش با cdn.npmmirror.com"
      download_once "$alt2" "$out" && return 0
      echo "… mirrorها ناموفق بودند؛ تلاش با مبدأ Google"
      ;;
  esac
  download_once "$url" "$out" && return 0
  return 1
}

deb_download() {  # debian pool path → file
  local rel="$1" out="$2" base
  for base in     "https://mirrors.aliyun.com/ubuntu"     "https://mirrors.tuna.tsinghua.edu.cn/ubuntu"     "https://archive.ubuntu.com/ubuntu"     "http://archive.ubuntu.com/ubuntu"     "https://mirrors.aliyun.com/debian"     "https://mirrors.tuna.tsinghua.edu.cn/debian"     "https://deb.debian.org/debian"     "http://deb.debian.org/debian"     "https://archive.debian.org/debian"     "http://archive.debian.org/debian"; do
    echo "… دریافت کتابخانه از ${base}/${rel}"
    download_once "${base}/${rel}" "$out" && return 0
  done
  return 1
}

extract_deb_to_lib() {  # deb → $LIB
  local deb="$1" tmp="$LIB/.debtmp.$$"
  rm -rf "$tmp"; mkdir -p "$tmp"
  if have ar; then
    (cd "$tmp" && ar x "$deb") || { rm -rf "$tmp"; return 1; }
  elif have python3; then
    python3 - "$deb" "$tmp" <<'PY' || { rm -rf "$tmp"; return 1; }
import sys, os
p=sys.argv[1]; out=sys.argv[2]
with open(p,'rb') as f:
    if f.read(8) != b'!<arch>\n': raise SystemExit(1)
    while True:
        hdr=f.read(60)
        if not hdr: break
        name=hdr[:16].decode('utf-8','ignore').strip().rstrip('/')
        size=int(hdr[48:58].decode('ascii','ignore').strip() or '0')
        data=f.read(size)
        if size % 2: f.read(1)
        if name.startswith('data.tar'):
            q=os.path.join(out,name.replace('/','_'))
            open(q,'wb').write(data)
PY
  else
    rm -rf "$tmp"; return 1
  fi
  local data
  data="$(ls -1 "$tmp"/data.tar.* 2>/dev/null | head -n1 || true)"
  [ -n "$data" ] || { rm -rf "$tmp"; return 1; }
  if ! tar -xf "$data" -C "$LIB" 2>/dev/null; then
    if have python3; then
      python3 - "$data" "$LIB" <<'PY' || { rm -rf "$tmp"; return 1; }
import sys, tarfile
with tarfile.open(sys.argv[1], 'r:*') as t:
    t.extractall(sys.argv[2])
PY
    else
      rm -rf "$tmp"; return 1
    fi
  fi
  rm -rf "$tmp"
  return 0
}

install_chrome_deb_libs() {
  mkdir -p "$LIB"
  local rel out ok=0
  for rel in     "pool/main/a/at-spi2-atk/libatk-bridge2.0-0_2.26.2-1_amd64.deb"     "pool/main/a/at-spi2-core/libatspi2.0-0_2.28.0-1_amd64.deb"     "pool/main/m/mesa/libgbm1_20.0.8-0ubuntu1~18.04.1_amd64.deb"     "pool/main/a/alsa-lib/libasound2_1.1.3-5ubuntu0.6_amd64.deb"     "pool/main/w/wayland/libwayland-server0_1.16.0-1ubuntu1.1~18.04.4_amd64.deb"; do
    out="$LIB/$(basename "$rel")"
    if [ ! -f "$out" ]; then deb_download "$rel" "$out" || { ok=1; continue; }; fi
    extract_deb_to_lib "$out" || ok=1
  done
  export LD_LIBRARY_PATH="$(render_lib_path):${LD_LIBRARY_PATH:-}"
  return $ok
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

# v10.213: latest Chrome-for-Testing may SIGTRAP on older shared hosts; keep a
# known older headless-shell fallback that still supports the modern CDP paths.
download_cft_version() {  # version → 0/1 (headless-shell)
  local ver="$1" base="https://storage.googleapis.com/chrome-for-testing-public/$1/linux64"
  rm -rf "$BIN/chrome-headless-shell-linux64" "$BIN/chrome-linux64" "$BIN/chromedriver-linux64"
  echo "… دانلود chrome-headless-shell سازگارتر: $ver"
  download "$base/chrome-headless-shell-linux64.zip" "$BIN/headless-$ver.zip" || return 1
  unzip_file "$BIN/headless-$ver.zip" "$BIN/" || return 1
  rm -f "$BIN/headless-$ver.zip"
  echo "… دانلود chromedriver سازگارتر: $ver"
  if download "$base/chromedriver-linux64.zip" "$BIN/driver-$ver.zip"; then
    unzip_file "$BIN/driver-$ver.zip" "$BIN/" || true
    rm -f "$BIN/driver-$ver.zip"
  fi
  echo "headless:$ver" > "$BIN/.cft-version" 2>/dev/null || true
  chmod_render_bins
  return 0
}

download_cft_full_chrome_version() {  # version → 0/1 (full chrome, older milestone)
  local ver="$1" base="https://storage.googleapis.com/chrome-for-testing-public/$1/linux64"
  echo "$ver" > "$BIN/.cft-full-attempted" 2>/dev/null || true
  rm -rf "$BIN/chrome-headless-shell-linux64" "$BIN/chrome-linux64" "$BIN/chromedriver-linux64"
  echo "… دانلود chrome کامل سازگارتر: $ver"
  download "$base/chrome-linux64.zip" "$BIN/chrome-$ver.zip" || { echo "⚠ دانلود chrome کامل ناموفق بود؛ تکرار خودکار نمی‌شود"; return 1; }
  unzip_file "$BIN/chrome-$ver.zip" "$BIN/" || return 1
  rm -f "$BIN/chrome-$ver.zip"
  echo "… دانلود chromedriver همان نسخه: $ver"
  if download "$base/chromedriver-linux64.zip" "$BIN/driver-$ver.zip"; then
    unzip_file "$BIN/driver-$ver.zip" "$BIN/" || true
    rm -f "$BIN/driver-$ver.zip"
  fi
  echo "chrome:$ver" > "$BIN/.cft-version" 2>/dev/null || true
  chmod_render_bins
  return 0
}

echo "── scraper4 render bootstrap (pure binaries, no apt) ──"
acquire_bootstrap_lock

if compgen -G "$BIN/*/chrome" >/dev/null 2>&1 || compgen -G "$BIN/*/chrome-headless-shell" >/dev/null 2>&1; then
  chmod_render_bins
  echo "✓ باینریِ مرورگر از قبل هست — دانلود رد شد"
elif SYS="$(find_sys_chrome)"; then
  echo "✓ مرورگرِ سیستمی پیدا شد: $SYS  (دانلود لازم نیست)"
else
  PINNED_CFT_VERSION="${SCRAPER_CFT_VERSION:-120.0.6099.109}"
  if download_cft_version "$PINNED_CFT_VERSION"; then
    echo "✓ Chrome-for-Testing سازگار نصب شد: $PINNED_CFT_VERSION"
  else
    echo "⚠ دانلود نسخهٔ سازگار ناموفق بود؛ تلاش با آخرین نسخهٔ رسمی"
    if have curl; then
      META="$(curl -fsSL --connect-timeout 8 --max-time 20 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json' 2>/dev/null || true)"
    elif have wget; then
      META="$(wget -q --timeout=15 --tries=1 -O- 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json' 2>/dev/null || true)"
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
fi

# گزارشِ نهایی + آزمون اجرایی
chmod_render_bins
CHROME_PATH="$(ls -1 "$BIN"/*/chrome-headless-shell "$BIN"/*/chrome 2>/dev/null | head -n1 || true)"
if [ -n "$CHROME_PATH" ]; then
  echo "✓ chrome: $CHROME_PATH"
  if "$CHROME_PATH" --version >/dev/null 2>&1; then
    "$CHROME_PATH" --version || true
  else
    echo "⚠ کروم اجرا نمی‌شود — تلاش برای نصب کتابخانه‌های runtime بدون apt"
    install_chrome_deb_libs || true
    if "$CHROME_PATH" --version >/dev/null 2>&1; then
      echo "✓ کروم پس از افزودن کتابخانه‌های محلی اجرا شد"
      "$CHROME_PATH" --version || true
    else
      echo "⚠ کروم هنوز اجرا نمی‌شود — تلاش با Chrome-for-Testing قدیمی‌تر"
      CFT_MARKER="$(cat "$BIN/.cft-version" 2>/dev/null || true)"
      if [ "$CFT_MARKER" != "headless:120.0.6099.109" ]; then
        if download_cft_version "120.0.6099.109"; then
          CHROME_PATH="$(ls -1 "$BIN"/*/chrome-headless-shell "$BIN"/*/chrome 2>/dev/null | head -n1 || true)"
        fi
      fi
      if [ -n "$CHROME_PATH" ] && "$CHROME_PATH" --version >/dev/null 2>&1; then
        echo "✓ کروم سازگارتر اجرا شد"
        "$CHROME_PATH" --version || true
      else
        CFT_MARKER="$(cat "$BIN/.cft-version" 2>/dev/null || true)"
        echo "⚠ headless-shell هم اجرا نشد — تلاش با chrome کامل قدیمی‌تر"
        FULL_ATTEMPTED="$(cat "$BIN/.cft-full-attempted" 2>/dev/null || true)"
        if [ "$CFT_MARKER" != "chrome:115.0.5790.170" ] && [ "$FULL_ATTEMPTED" != "115.0.5790.170" ]; then
          if download_cft_full_chrome_version "115.0.5790.170"; then
            CHROME_PATH="$(ls -1 "$BIN"/*/chrome-headless-shell "$BIN"/*/chrome 2>/dev/null | head -n1 || true)"
          fi
        else
          echo "ℹ تلاش با chrome کامل 115 قبلاً انجام شده؛ برای جلوگیری از دانلود تکراری رد شد"
        fi
        if [ -n "$CHROME_PATH" ] && "$CHROME_PATH" --version >/dev/null 2>&1; then
          echo "✓ chrome کامل سازگارتر اجرا شد"
          "$CHROME_PATH" --version || true
        else
          echo "⚠ کروم هنوز اجرا نمی‌شود — معمولاً یک کتابخانهٔ سیستمی ناقص یا محدودیت اجرای باینری هاست است."
          echo "  چون این محیط apt/sudo ندارد، این چگونگی‌ها باقی می‌ماند:"
          echo "   ۱) کنسول hostconsole را با نصبِ کامل (گزینهٔ full-stack) بالا بیاورید تا libs بیاید؛"
          echo "   ۲) اسکریپتِ releaseٔ کنسول که render را آماده می‌کند اجرا شود؛"
          echo "   ۳) خروجی زیر نام کتابخانه‌های گمشده را نشان می‌دهد:"
          if have ldd && [ -n "$CHROME_PATH" ]; then
            ldd "$CHROME_PATH" 2>/dev/null | grep 'not found' || true
          else
            echo "      ldd در این محیط موجود نیست"
          fi
        fi
      fi
    fi
  fi
else
  echo "ℹ باینریِ دانلودشده در bin/ پیدا نشد — اگر مرورگر سیستمی هست لازم نیست."
fi

CHROMEDRIVER_PATH="$(ls -1 "$BIN"/*/chromedriver 2>/dev/null | head -n1 || true)"
[ -n "$CHROMEDRIVER_PATH" ] && echo "✓ chromedriver: $CHROMEDRIVER_PATH" || echo "ℹ chromedriver جدا نیست (اختیاری — موتور Selenium)"

echo "── done — سرویس را با start.sh بالا بیاورید ──"
