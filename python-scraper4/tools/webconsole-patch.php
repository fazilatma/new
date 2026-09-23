<?php
/**
 * WebConsole Pro patcher: 1.6.4 / 1.6.5 / 1.6.6 -> 1.6.7
 * (browser bootstrap + swap management + console self-update + GitHub tools page)
 * ======================================
 *  1. Every Python deploy gains a non-fatal "browser" step (pip playwright,
 *     official CDN, Iran mirrors, system Chromium) — the deploy button fully
 *     equips the scraper. [1.6.5]
 *  2. Install components swap_2g / swap_4g / swap_8g / swap_16g: idempotent
 *     sudo-aware swapfile setup, persisted via /etc/fstab. [1.6.6]
 *  3. Install components selfupdate_check / selfupdate_apply: the console
 *     updates itself from the repo/branch configured in
 *     .wconsole_data/selfupdate.conf (php -l gate + backup). [1.6.7]
 *  4. The companion page webconsole-tools.php is installed next to
 *     webconsole.php: console self-update with repo/branch pickers and a
 *     GitHub file explorer/editor (save into the console file space or push
 *     back with a token). Access key is printed after patching. [1.6.7]
 *
 * Usage (on the server, in the folder containing webconsole.php):
 *   cp webconsole.php webconsole.php.mybackup      # your own safety copy
 *   php webconsole-patch.php webconsole.php
 *   php webconsole-patch.php --check webconsole.php   # read-only report
 *   php webconsole-patch.php --tools webconsole.php   # (re)install the
 *        companion page only, console untouched; prints the access key
 *   php webconsole-patch.php --swap-apply 4096        # swap right now
 *
 * Safety: every anchor must match exactly once before anything is written,
 * a timestamped backup is created, the result is verified with php -l and
 * rolled back automatically on lint failure. Re-runs are no-ops.
 */

if (PHP_SAPI !== 'cli') { http_response_code(403); exit("CLI only\n"); }

$checkOnly = false;
$toolsOnly = false;
$swapApplyMb = 0;
$target = 'webconsole.php';
foreach (array_slice($argv, 1) as $arg) {
    if ($arg === '--check' || $arg === '-c') { $checkOnly = true; }
    elseif ($arg === '--tools') { $toolsOnly = true; }
    elseif ($arg === '--swap-apply') { $swapApplyMb = -1; }
    elseif ($swapApplyMb === -1 && ctype_digit($arg)) { $swapApplyMb = (int)$arg; }
    else { $target = $arg; }
}
if ($swapApplyMb === -1) { fwrite(STDERR, "--swap-apply needs a size in MB, e.g. --swap-apply 4096\n"); exit(1); }
if ($swapApplyMb > 0) {
    // Configure the swapfile right now (root or passwordless sudo).
    $f = tempnam(sys_get_temp_dir(), 'wcp-swap-');
    file_put_contents($f, wcp_swap_setup_cmd($swapApplyMb));
    passthru('bash ' . escapeshellarg($f));
    exit(0);
}

$dir = dirname($target);
if ($dir === '' || $dir === '.') { $dir = '.'; }
if ($toolsOnly) {
    if (!is_dir($dir)) { fwrite(STDERR, "ERROR: directory not found: {$dir}\n"); exit(1); }
    $keyFile = $dir . '/webconsole-tools.key';
    $key = is_file($keyFile) ? trim((string)file_get_contents($keyFile)) : '';
    if ($key === '') { $key = bin2hex(random_bytes(16)); @file_put_contents($keyFile, $key); @chmod($keyFile, 0600); }
    echo wcp_write_tools_file($dir, $key)
        ? "Companion installed: {$dir}/webconsole-tools.php\nAccess key: {$key}\nOpen: https://YOUR-HOST/webconsole-tools.php?key={$key}\n"
        : "Companion install FAILED — nothing else was touched.\n";
    exit(0);
}

if (!is_file($target)) { fwrite(STDERR, "ERROR: file not found: {$target}\n"); exit(1); }
$src = file_get_contents($target);
if ($src === false) { fwrite(STDERR, "ERROR: cannot read {$target}\n"); exit(1); }

$ver = '';
if (strpos($src, "define('WCP_VERSION', '1.6.4')") !== false) { $ver = '1.6.4'; }
elseif (strpos($src, "define('WCP_VERSION', '1.6.5')") !== false) { $ver = '1.6.5'; }
elseif (strpos($src, "define('WCP_VERSION', '1.6.6')") !== false) { $ver = '1.6.6'; }
elseif (strpos($src, "define('WCP_VERSION', '1.6.7')") !== false) { $ver = '1.6.7'; }
if ($ver === '1.6.7') {
    echo "Already patched (WebConsole Pro 1.6.7: browser + swap + self-update). Nothing to do.\n";
    $keyFile = $dir . '/webconsole-tools.key';
    $key = is_file($keyFile) ? trim((string)file_get_contents($keyFile)) : '';
    if ($key === '') { $key = bin2hex(random_bytes(16)); @file_put_contents($keyFile, $key); @chmod($keyFile, 0600); }
    if (wcp_write_tools_file($dir, $key)) {
        echo "Companion ensured: {$dir}/webconsole-tools.php (key: {$key})\n";
    }
    exit(0);
}
if (!$checkOnly && $ver === '') {
    fwrite(STDERR, "ERROR: this patcher targets WebConsole Pro 1.6.4/1.6.5/1.6.6; your file reports another version. Patch aborted, nothing written.\n");
    fwrite(STDERR, "Run: php " . basename(__FILE__) . " --check " . escapeshellarg($target) . "  — then send that output so the patcher can be re-targeted.\n");
    exit(1);
}
$is164 = ($ver === '1.6.4');

$payloadFunc = <<<'WCPPATCHFUNC'
/**
 * 1.6.5 — Self-contained shell block giving Python scrapers a real Chromium.
 * Appended as a non-fatal "browser" step of every Python deploy and to the
 * browser/scraper install components. Order: pip playwright (if missing) ->
 * official CDN -> inline Iran mirrors (versions read from
 * `playwright install --dry-run`, INSTALLATION_COMPLETE markers, OS libs,
 * headless launch test) -> last-resort system Chromium via apt. Idempotent
 * and non-fatal: a deploy must never break because of the browser step.
 */
function wcp_browser_bootstrap_cmd(): string {
    return <<<'WCPBROWSERCMD'
echo "[browser] Ensuring Playwright + Chromium (idempotent, ~150MB one-time)..."
if ! python3 -m pip --version >/dev/null 2>&1; then
  echo "[browser] pip is missing for python3 — trying ensurepip / python3-pip..."
  python3 -m ensurepip --upgrade >/dev/null 2>&1 || sudo -n python3 -m ensurepip --upgrade >/dev/null 2>&1 || true
  if ! python3 -m pip --version >/dev/null 2>&1; then
    apt-get install -y python3-pip >/dev/null 2>&1 || sudo -n apt-get install -y python3-pip >/dev/null 2>&1 || true
  fi
fi
if python3 -c "import playwright" >/dev/null 2>&1; then
  echo "[browser] playwright (pip) already installed."
else
  echo "[browser] pip-installing playwright..."
  python3 -m pip install --break-system-packages --ignore-installed --no-warn-script-location playwright >/dev/null 2>&1 \
    || python3 -m pip install --user --break-system-packages --ignore-installed --no-warn-script-location playwright >/dev/null 2>&1 \
    || pip3 install --break-system-packages --ignore-installed --no-warn-script-location playwright >/dev/null 2>&1 \
    || echo "[browser WARNING] could not pip-install playwright."
fi
BP="${PLAYWRIGHT_BROWSERS_PATH:-}"
if [ -z "$BP" ]; then
  if mkdir -p /var/www/html/.wconsole_data/cache >/dev/null 2>&1 && [ -w /var/www/html/.wconsole_data/cache ]; then
    BP=/var/www/html/.wconsole_data/cache/ms-playwright
  else
    BP="${XDG_CACHE_HOME:-${HOME:-/tmp}/.cache}/ms-playwright"
  fi
fi
export PLAYWRIGHT_BROWSERS_PATH="$BP"
mkdir -p "$BP" >/dev/null 2>&1 || true
BROWSER_OK=0
if [ -n "$(find "$BP" -mindepth 2 -maxdepth 4 -type f \( -name chrome -o -name chrome-headless-shell \) 2>/dev/null | head -n1)" ]; then
  echo "[browser] Chromium already present at $BP — skipping download."
  BROWSER_OK=1
else
  echo "[browser] Downloading Chromium into $BP ..."
  if python3 -m playwright install chromium >/dev/null 2>&1 || python3 -m playwright install chromium; then
    echo "[browser] Chromium installed from the official CDN."
    BROWSER_OK=1
  else
    echo "[browser WARNING] official CDN unreachable (Iran geo-block) — trying mirrors..."
    PLAN="$(python3 -m playwright install --dry-run chromium 2>/dev/null)" || PLAN=""
    CFT_VER="$(printf '%s' "$PLAN" | grep -oP 'Chrome for Testing \K[0-9.]+' | head -n1 || true)"
    CH_BUILD="$(printf '%s' "$PLAN" | grep -oP 'playwright chromium v\K[0-9]+' | head -n1 || true)"
    SH_BUILD="$(printf '%s' "$PLAN" | grep -oP 'playwright chromium-headless-shell v\K[0-9]+' | head -n1 || true)"
    if [ -z "$SH_BUILD" ]; then SH_BUILD="$CH_BUILD"; fi
    if [ -n "$CFT_VER" ] && [ -n "$CH_BUILD" ]; then
      MIRROR_TMP="$(mktemp -d 2>/dev/null || echo /tmp/wcp-mirror-$$)"
      mkdir -p "$MIRROR_TMP"
      command -v unzip >/dev/null 2>&1 || { wcp_apt_update; wcp_apt unzip || true; }
      wcp_fetch() { curl -fL --retry 3 --retry-delay 2 --connect-timeout 20 --max-time 600 -o "$2" "$1" >/dev/null 2>&1; }
      wcp_grab() {
        GRAB_DEST="$BP/$2"
        if [ -f "$GRAB_DEST/$3/$4" ]; then echo "[mirror] already present: $2"; return 0; fi
        GOT=0
        for M in https://cdn.npmmirror.com/binaries https://registry.npmmirror.com/-/binary https://mirrors.huaweicloud.com https://mirror.nju.edu.cn; do
          if wcp_fetch "$M/$1" "$MIRROR_TMP/$2.zip"; then GOT=1; break; fi
        done
        if [ "$GOT" != 1 ]; then echo "[mirror] FAILED on every mirror: $1"; return 1; fi
        mkdir -p "$GRAB_DEST"
        unzip -q -o "$MIRROR_TMP/$2.zip" -d "$GRAB_DEST" || return 1
        rm -f "$MIRROR_TMP/$2.zip"
        : > "$GRAB_DEST/INSTALLATION_COMPLETE"
        chmod -R a+rX "$GRAB_DEST" >/dev/null 2>&1 || true
        [ -f "$GRAB_DEST/$3/$4" ] && chmod +x "$GRAB_DEST/$3/$4" >/dev/null 2>&1 || true
        if [ -f "$GRAB_DEST/$3/$4" ]; then echo "[mirror] ok: $2"; return 0; fi
        echo "[mirror] unexpected archive layout: $2"
        return 1
      }
      if wcp_grab "chrome-for-testing/$CFT_VER/linux64/chrome-linux64.zip" "chromium-$CH_BUILD" chrome-linux64 chrome \
         && wcp_grab "chrome-for-testing/$CFT_VER/linux64/chrome-headless-shell-linux64.zip" "chromium_headless_shell-$SH_BUILD" chrome-headless-shell-linux64 chrome-headless-shell; then
        echo "[mirror] Chromium installed from mirrors."
        python3 -m playwright install-deps chromium >/dev/null 2>&1 \
          || sudo -n apt-get install -y libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 >/dev/null 2>&1 \
          || true
        BROWSER_OK=1
      else
        echo "[browser WARNING] mirrors did not produce Chromium."
      fi
      rm -rf "$MIRROR_TMP"
    else
      echo "[browser WARNING] could not read the required Chromium version from playwright."
    fi
  fi
fi
LAUNCH_OK=0
python3 - <<'WCPYLAUNCH' && LAUNCH_OK=1 || LAUNCH_OK=0
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
        b.close()
    print("[browser] launch test: PASS")
except Exception as exc:
    print("[browser] launch test failed:", str(exc)[:160])
    raise SystemExit(1)
WCPYLAUNCH
if [ "$LAUNCH_OK" != 1 ]; then
  for CAND in /usr/bin/chromium /usr/bin/chromium-browser /snap/bin/chromium /usr/bin/google-chrome /usr/bin/google-chrome-stable; do
    if [ -x "$CAND" ]; then
      echo "[browser] system browser found: $CAND (the scraper picks it up automatically)."
      LAUNCH_OK=1
      break
    fi
  done
fi
if [ "$LAUNCH_OK" != 1 ]; then
  echo "[browser] Last resort: installing a system Chromium via apt..."
  apt-get install -y chromium >/dev/null 2>&1 || sudo -n apt-get install -y chromium >/dev/null 2>&1 \
    || apt-get install -y chromium-browser >/dev/null 2>&1 || sudo -n apt-get install -y chromium-browser >/dev/null 2>&1 \
    || snap install chromium >/dev/null 2>&1 || true
  for CAND in /usr/bin/chromium /usr/bin/chromium-browser /snap/bin/chromium; do
    if [ -x "$CAND" ]; then echo "[browser] system browser installed: $CAND"; LAUNCH_OK=1; break; fi
  done
fi
if [ "$LAUNCH_OK" = 1 ]; then
  echo "[browser] SUCCESS — Chromium is ready (PLAYWRIGHT_BROWSERS_PATH=$BP)."
else
  echo "[browser WARNING] no usable Chromium yet; HTTP extraction engines still work. Manual fix:"
  echo "  PLAYWRIGHT_BROWSERS_PATH=$BP python3 -m playwright install chromium"
fi
WCPBROWSERCMD;
}

WCPPATCHFUNC;

$oldD = <<<'WCPPATCHD'
    foreach (['install' => ($p['install_cmd'] ?: default_install_cmd($p['type'])), 'build' => $p['build_cmd']] as $label => $cmd) {
        if (trim($cmd) === '') continue;
WCPPATCHD;

$newD = <<<'WCPPATCHDN'
    $deploySteps = ['install' => ($p['install_cmd'] ?: default_install_cmd($p['type'])), 'build' => $p['build_cmd']];
    // 1.6.5 — the "نصب / به‌روزرسانی" deploy button must leave a scraper fully
    // runnable: after the regular install/build steps, Python projects get
    // Playwright + a real Chromium (official CDN, Iran mirrors, then a system
    // browser). The step is non-fatal and idempotent.
    $browserStep = (($p['type'] ?? '') === 'python')
        || is_file($dest . '/scraper4.py') || is_file($dest . '/deployer4.py')
        || is_file($dest . '/app.py') || is_file($dest . '/requirements.txt');
    if ($browserStep) {
        $deploySteps['browser'] = wcp_browser_bootstrap_cmd();
    }
    foreach ($deploySteps as $label => $cmd) {
        if (trim($cmd) === '') continue;
WCPPATCHDN;

$oldE1 = <<<'WCPPATCHE1'
        cli_log("✓ Headless browser dependencies installed.");
WCPPATCHE1;

$newE1 = <<<'WCPPATCHE1N'
        cli_log("✓ Headless browser dependencies installed.");
        cli_log("[Browser Drivers] Downloading Playwright + Chromium (official CDN, then Iran mirrors)...");
        $runCmd(wcp_browser_bootstrap_cmd());
        cli_log("✓ Playwright + Chromium bootstrap finished.");
WCPPATCHE1N;

$oldE2 = <<<'WCPPATCHE2'
        cli_log("✓ Python scraping packages installed successfully.");
WCPPATCHE2;

$newE2 = <<<'WCPPATCHE2N'
        cli_log("✓ Python scraping packages installed successfully.");
        cli_log("[Python] Downloading the Chromium browser for Playwright/Selenium/UC...");
        $runCmd(wcp_browser_bootstrap_cmd());
WCPPATCHE2N;

$oldC = <<<'WCPPATCHC'
(pip3 install --break-system-packages --ignore-installed flask requests beautifulsoup4 lxml python-dotenv basalam-sdk selectolax html5lib psutil --no-warn-script-location 2>/dev/null || true); fi';
WCPPATCHC;

$newC = <<<'WCPPATCHCN'
(pip3 install --break-system-packages --ignore-installed flask requests beautifulsoup4 lxml python-dotenv basalam-sdk selectolax html5lib psutil gunicorn curl_cffi cloudscraper httpx aiohttp undetected-chromedriver playwright selenium --no-warn-script-location 2>/dev/null || true); fi';
WCPPATCHCN;

$payloadSwap = <<<'WCPPATCHSWAP'
/**
 * 1.6.6 — Idempotent swapfile setup bash for the execution account.
 * Root is required; falls back to passwordless sudo (www-data). Safe to
 * re-run: enough swap already present is a no-op, a smaller /swapfile is
 * resized in place. Persists via /etc/fstab, tunes vm.swappiness and
 * degrades gracefully inside containers that forbid swap.
 */
function wcp_swap_setup_cmd(int $mb): string {
    $mb = max(256, min(65536, $mb));
    return str_replace('__MB__', (string)$mb, <<<'WCPSWAPCMD'
TARGET_MB=__MB__
SWAP_FILE=/swapfile
if [ "$(id -u)" = "0" ]; then SUDO=""; else SUDO="sudo -n"; fi
CUR_MB=$(free -m 2>/dev/null | awk '/^Swap:/{print $2}' | head -n1)
echo "[swap] current swap: ${CUR_MB:-0} MB, target: ${TARGET_MB} MB"
if [ "${CUR_MB:-0}" -ge "$TARGET_MB" ] 2>/dev/null; then
  echo "[swap] already satisfied — nothing to do."; exit 0
fi
if [ -f /proc/user_beancounters ]; then
  echo "[swap WARNING] OpenVZ-style container: swap cannot be managed from inside."; exit 0
fi
if [ -f "$SWAP_FILE" ]; then $SUDO swapoff "$SWAP_FILE" >/dev/null 2>&1 || true; fi
$SUDO rm -f "$SWAP_FILE" >/dev/null 2>&1 || true
if command -v fallocate >/dev/null 2>&1 && $SUDO fallocate -l "${TARGET_MB}M" "$SWAP_FILE" >/dev/null 2>&1; then
  echo "[swap] allocated ${TARGET_MB} MB via fallocate"
else
  $SUDO dd if=/dev/zero of="$SWAP_FILE" bs=1M count="$TARGET_MB" status=none >/dev/null 2>&1 || { echo "[swap ERROR] allocation failed (need root or passwordless sudo)"; exit 0; }
fi
$SUDO chmod 600 "$SWAP_FILE" >/dev/null 2>&1 || true
$SUDO mkswap -f "$SWAP_FILE" >/dev/null 2>&1 || { echo "[swap ERROR] mkswap failed"; exit 0; }
$SUDO swapon "$SWAP_FILE" >/dev/null 2>&1 || { echo "[swap WARNING] swapon refused (container without swap privileges?)"; exit 0; }
grep -q '^/swapfile ' /etc/fstab 2>/dev/null || echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null 2>&1 || true
if [ -d /etc/sysctl.d ] && ! grep -qs 'vm.swappiness' /etc/sysctl.conf /etc/sysctl.d/*.conf 2>/dev/null; then
  echo 'vm.swappiness=20' | $SUDO tee /etc/sysctl.d/99-s4-swap.conf >/dev/null 2>&1 && $SUDO sysctl -q -p /etc/sysctl.d/99-s4-swap.conf >/dev/null 2>&1 || true
fi
echo "[swap] active: $(free -m 2>/dev/null | awk '/^Swap:/{print $2}' | head -n1) MB — survives reboot via /etc/fstab"
WCPSWAPCMD);
}

WCPPATCHSWAP;

$payloadSelf = <<<'WCPPATCHSELF'
/**
 * 1.6.7 — Console self-update bash (used by the selfupdate_check /
 * selfupdate_apply components). Reads REPO / BRANCH / WFILE from
 * .wconsole_data/selfupdate.conf (writable from webconsole-tools.php),
 * downloads webconsole.php from the chosen repo/branch, compares versions
 * and — in apply mode — gates on php -l, backs up and atomically replaces
 * the console file.
 */
function wcp_selfupdate_cmd(): string {
    return <<<'WCPSELFCMD'
CONF=/var/www/html/.wconsole_data/selfupdate.conf
SELF=/var/www/html/webconsole.php
REPO=fazilatma/new
BRANCH=arena/01a0c9ea-new
WFILE=webconsole.php
if [ -f "$CONF" ]; then . "$CONF"; fi
TMP=$(mktemp 2>/dev/null || echo /tmp/wc-selfupdate-$$)
curl -fsSL --max-time 90 "https://raw.githubusercontent.com/$REPO/$BRANCH/$WFILE" -o "$TMP" || { echo "[selfupdate] download failed: $REPO@$BRANCH/$WFILE"; exit 0; }
REMOTE_VER=$(grep -oP "define\('WCP_VERSION',\s*'\K[^']+" "$TMP" | head -n1)
LOCAL_VER=$(grep -oP "define\('WCP_VERSION',\s*'\K[^']+" "$SELF" 2>/dev/null | head -n1)
echo "[selfupdate] local: ${LOCAL_VER:-?} — remote $REPO@$BRANCH: ${REMOTE_VER:-?}"
if [ -z "$REMOTE_VER" ]; then echo "[selfupdate] remote file has no WCP_VERSION — refusing."; exit 0; fi
if [ "${APPLY:-0}" != "1" ]; then
  if [ "$REMOTE_VER" = "$LOCAL_VER" ]; then echo "[selfupdate] already up to date."; else echo "[selfupdate] update available — run the selfupdate_apply component."; fi
  exit 0
fi
if [ "$REMOTE_VER" = "$LOCAL_VER" ]; then echo "[selfupdate] already up to date — nothing to do."; exit 0; fi
php -l "$TMP" >/dev/null 2>&1 || { echo "[selfupdate] php -l rejected the new file — refusing."; exit 0; }
BAK="$SELF.bak-${LOCAL_VER:-old}-$(date +%Y%m%d-%H%M%S)"
cp -a "$SELF" "$BAK" 2>/dev/null || { echo "[selfupdate] backup failed — refusing."; exit 0; }
cat "$TMP" > "$SELF" || { echo "[selfupdate] write failed (check write permission on $SELF)"; exit 0; }
rm -f "$TMP"
echo "[selfupdate] updated ${LOCAL_VER:-?} -> ${REMOTE_VER} — backup: $BAK"
WCPSELFCMD;
}

WCPPATCHSELF;


$payloadTools = <<<'WCPTOOLSFILE'
<?php
/**
 * webconsole-tools.php — companion for WebConsole Pro.
 *
 * Two tools next to webconsole.php:
 *   1. Console self-update from any GitHub repo/branch (check + apply,
 *      php -l gate, timestamped backup, atomic replace, defaults saved to
 *      .wconsole_data/selfupdate.conf which the console's selfupdate_check /
 *      selfupdate_apply components read too).
 *   2. GitHub file explorer/editor: browse a repo/branch, view and edit any
 *      file, save a copy into the console's file space
 *      (.wconsole_data/github-files/<repo>/<branch>/...) and optionally push
 *      the edit straight back to GitHub with a personal access token.
 *
 * Installed by tools/webconsole-patch.php (which also prints the access key),
 * or copy this file manually. The access key lives in webconsole-tools.key
 * (0600) next to this file.
 *   CLI:  php webconsole-tools.php --key     (creates and prints key + URL)
 *   Web:  https://YOUR-HOST/webconsole-tools.php?key=...
 */
if (PHP_SAPI === 'cli') {
    $keyFile = __DIR__ . '/webconsole-tools.key';
    $key = is_file($keyFile) ? trim((string)file_get_contents($keyFile)) : '';
    if ($key === '') {
        $key = bin2hex(random_bytes(16));
        file_put_contents($keyFile, $key);
        chmod($keyFile, 0600);
    }
    echo "access key: {$key}\n";
    echo "open: https://YOUR-HOST/webconsole-tools.php?key={$key}\n";
    exit(0);
}
error_reporting(0);
header('Content-Type: text/html; charset=utf-8');

$KEYFILE = __DIR__ . '/webconsole-tools.key';
$CONSOLE = __DIR__ . '/webconsole.php';
$DATA = '/var/www/html/.wconsole_data';
if (!is_dir($DATA)) { $DATA = __DIR__ . '/.wconsole_data'; }
$CONF = $DATA . '/selfupdate.conf';

$KEY = is_file($KEYFILE) ? trim((string)@file_get_contents($KEYFILE)) : '';
$FRESH = false;
if ($KEY === '') {
    $KEY = bin2hex(random_bytes(16));
    @file_put_contents($KEYFILE, $KEY);
    @chmod($KEYFILE, 0600);
    $FRESH = true;
}

function esc($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
function clean_repo($v) { $v = trim((string)$v); return preg_match('#^[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+$#', $v) ? $v : ''; }
function clean_branch($v) { $v = trim((string)$v); return ($v !== '' && strpos($v, '..') === false && $v[0] !== '/' && preg_match('#^[A-Za-z0-9._/\-]+$#', $v)) ? $v : ''; }
function clean_path($v) { $v = ltrim(trim((string)$v), '/'); if ($v === '' || strpos($v, '..') !== false || strpos($v, "\x00") !== false) return ''; return $v; }

function http_get($url, $token = '', $timeout = 30) {
    $ch = curl_init($url);
    $hdr = array('User-Agent: wconsole-tools/1.0', 'Accept: application/vnd.github+json');
    if ($token !== '') { $hdr[] = 'Authorization: token ' . $token; }
    curl_setopt_array($ch, array(
        CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 4,
        CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 15, CURLOPT_HTTPHEADER => $hdr,
    ));
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    return array($code, (string)$body, $err);
}
function http_put_json($url, $token, $payload) {
    $ch = curl_init($url);
    curl_setopt_array($ch, array(
        CURLOPT_RETURNTRANSFER => true, CURLOPT_CUSTOMREQUEST => 'PUT', CURLOPT_TIMEOUT => 60,
        CURLOPT_HTTPHEADER => array('User-Agent: wconsole-tools/1.0', 'Accept: application/vnd.github+json',
            'Authorization: token ' . $token, 'Content-Type: application/json'),
        CURLOPT_POSTFIELDS => json_encode($payload),
    ));
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    return array($code, (string)$body);
}
function console_version($f) {
    if (!is_file($f)) return '(missing)';
    $s = (string)@file_get_contents($f);
    if (preg_match("/define\('WCP_VERSION',\s*'([^']+)'\)/", $s, $m)) return $m[1];
    return '(unknown)';
}

$SELF = basename(__FILE__);
function url($page, $extra = array()) {
    global $KEY, $SELF;
    $q = array_merge(array('key' => $KEY, 'page' => $page), $extra);
    return $SELF . '?' . http_build_query($q);
}

$gk = isset($_REQUEST['key']) && is_string($_REQUEST['key']) ? $_REQUEST['key'] : '';
$ok = $gk !== '' && hash_equals($KEY, $gk);
$page = isset($_GET['page']) ? preg_replace('/[^a-z]/', '', (string)$_GET['page']) : 'home';

$defRepo = 'fazilatma/new'; $defBranch = 'arena/01a0c9ea-new'; $defFile = 'webconsole.php';
if (is_file($CONF)) {
    $cf = @parse_ini_file($CONF);
    if (is_array($cf)) {
        if (!empty($cf['REPO'])) $defRepo = (string)$cf['REPO'];
        if (!empty($cf['BRANCH'])) $defBranch = (string)$cf['BRANCH'];
        if (!empty($cf['WFILE'])) $defFile = (string)$cf['WFILE'];
    }
}
$msg = ''; $err = '';
$cver = console_version($CONSOLE);

if ($ok && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $a = isset($_POST['a']) ? preg_replace('/[^a-z_]/', '', (string)$_POST['a']) : '';
    $repo = clean_repo(isset($_POST['repo']) ? $_POST['repo'] : $defRepo);
    $branch = clean_branch(isset($_POST['branch']) ? $_POST['branch'] : $defBranch);
    $file = clean_path(isset($_POST['file']) ? $_POST['file'] : $defFile);

    if ($a === 'save_defaults') {
        if ($repo === '' || $branch === '' || $file === '') { $err = 'repo/branch/file نامعتبر است'; }
        else {
            $dir = dirname($CONF);
            if (!is_dir($dir)) { @mkdir($dir, 0755, true); }
            $okw = @file_put_contents($CONF, "REPO={$repo}\nBRANCH={$branch}\nWFILE={$file}\n");
            if ($okw) { $msg = 'پیش‌فرض‌های خودآپدیت ذخیره شد (مؤلفه‌های selfupdate_check/selfupdate_apply هم از همین می‌خوانند).'; }
            else { $err = 'نوشتن selfupdate.conf ناموفق بود'; }
        }
    }

    if ($a === 'update_check' || $a === 'update_apply') {
        if ($repo === '' || $branch === '' || $file === '') { $err = 'repo/branch/file نامعتبر است'; }
        else {
            $parts = array_map('rawurlencode', explode('/', $file));
            list($code, $body, $e) = http_get('https://raw.githubusercontent.com/' . $repo . '/' . rawurlencode($branch) . '/' . implode('/', $parts), '', 60);
            if ($code !== 200 || $body === '') { $err = 'دانلود ناموفق (HTTP ' . $code . ') ' . esc($e); }
            elseif (strpos($body, 'WCP_VERSION') === false) { $err = 'فایل دریافتی یک webconsole.php معتبر نیست (WCP_VERSION ندارد)'; }
            else {
                preg_match("/define\('WCP_VERSION',\s*'([^']+)'\)/", $body, $m);
                $rv = isset($m[1]) ? $m[1] : '?';
                $lv = console_version($CONSOLE);
                if ($a === 'update_check') {
                    $msg = 'نسخهٔ محلی: ' . esc($lv) . ' — نسخهٔ ' . esc($repo) . '@' . esc($branch) . ': ' . esc($rv);
                } elseif ($rv === $lv) {
                    $msg = 'همین نسخه روی سرور است — نیازی به نصب نیست.';
                } else {
                    $tmp = tempnam(sys_get_temp_dir(), 'wct-');
                    file_put_contents($tmp, $body);
                    $lint = @exec('php -l ' . escapeshellarg($tmp) . ' 2>&1');
                    if (strpos((string)$lint, 'No syntax errors') === false) {
                        $err = 'php -l فایل جدید را رد کرد — نصب انجام نشد. ' . esc((string)$lint);
                        @unlink($tmp);
                    } elseif (!is_writable($CONSOLE) && !@is_writable(dirname($CONSOLE))) {
                        $err = 'اجازهٔ نوشتن webconsole.php را ندارید (مالک فایل را بررسی کنید)';
                        @unlink($tmp);
                    } else {
                        $bak = $CONSOLE . '.bak-' . preg_replace('/[^0-9a-z.\-]/i', '', $lv) . '-' . date('Ymd-His');
                        @copy($CONSOLE, $bak);
                        if (@rename($tmp, $CONSOLE)) {
                            $msg = 'کنسول از ' . esc($lv) . ' به ' . esc($rv) . ' به‌روزرسانی شد. بکاپ: ' . esc(basename($bak));
                        } else {
                            @unlink($tmp);
                            $err = 'جایگزینی فایل ناموفق بود';
                        }
                    }
                }
            }
        }
    }

    if ($a === 'gh_save_local' || $a === 'gh_push') {
        $path = clean_path(isset($_POST['path']) ? $_POST['path'] : '');
        $content = isset($_POST['content']) && is_string($_POST['content']) ? $_POST['content'] : '';
        if ($repo === '' || $branch === '' || $path === '') { $err = 'repo/branch/path نامعتبر است'; }
        elseif ($a === 'gh_save_local') {
            $dest = $DATA . '/github-files/' . $repo . '/' . $branch . '/' . $path;
            $d = dirname($dest);
            if (!is_dir($d)) { @mkdir($d, 0755, true); }
            if (@file_put_contents($dest, $content) !== false) {
                $msg = 'در فضای فایل کنسول ذخیره شد: ' . esc(str_replace('/var/www/html/', '', $dest)) . ' (از فایل اکسپلورر کنسول هم قابل ویرایش است)';
            } else { $err = 'ذخیرهٔ محلی ناموفق بود'; }
        } else {
            $token = trim((string)($_POST['token'] ?? ''));
            $message = trim((string)($_POST['message'] ?? ''));
            if ($token === '' || $message === '') { $err = 'برای ثبت در گیت‌هاب، توکن و پیام کامیت لازم است'; }
            else {
                list($sc, $sb) = http_get('https://api.github.com/repos/' . $repo . '/contents/' . implode('/', array_map('rawurlencode', explode('/', $path))) . '?ref=' . rawurlencode($branch), $token);
                $sj = json_decode($sb, true);
                $sha = is_array($sj) && isset($sj['sha']) ? (string)$sj['sha'] : '';
                if ($sc !== 200 || $sha === '') { $err = 'دریافت sha فایل ناموفق بود (HTTP ' . $sc . ') — توکن/مسیر را بررسی کنید'; }
                else {
                    list($pc, $pb) = http_put_json('https://api.github.com/repos/' . $repo . '/contents/' . implode('/', array_map('rawurlencode', explode('/', $path))), $token,
                        array('message' => $message, 'content' => base64_encode($content), 'branch' => $branch, 'sha' => $sha));
                    if ($pc >= 200 && $pc < 300) { $msg = 'تغییرات در گیت‌هاب ثبت شد (' . esc($repo) . '@' . esc($branch) . ' → ' . esc($path) . ')'; }
                    else { $err = 'ثبت در گیت‌هاب ناموفق بود (HTTP ' . $pc . '): ' . esc(substr($pb, 0, 200)); }
                }
            }
        }
    }
}

function shell_top($KEY, $SELF, $title) {
    echo '<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><title>' . esc($title) . '</title></head>';
    echo '<body style="font-family:Tahoma,Arial,sans-serif;background:#0b1220;color:#e2e8f0;margin:0;padding:18px;max-width:1100px;margin:0 auto">';
    echo '<div style="display:flex;gap:14px;margin-bottom:14px"><b style="color:#67e8f9">وب‌کنسول ابزارها</b>';
    echo '<a href="' . esc(url('home')) . '" style="color:#94a3b8">خانه</a>';
    echo '<a href="' . esc(url('update')) . '" style="color:#94a3b8">به‌روزرسانی کنسول</a>';
    echo '<a href="' . esc(url('github')) . '" style="color:#94a3b8">فایل‌های گیت‌هاب</a></div>';
}
function shell_end() { echo '</body></html>'; }

if (!$ok) {
    shell_top($KEY, $SELF, 'webconsole-tools');
    if ($FRESH) {
        echo '<p>این ابزار تازه نصب شده است. کلید دسترسی (فقط همین یک بار نمایش داده می‌شود):</p>';
        echo '<p><code style="font-size:18px;color:#fbbf24;direction:ltr;display:inline-block">' . esc($KEY) . '</code></p>';
        echo '<p>همین صفحه را با <code>?key=…</code> باز کنید. برای دیدن دوبارهٔ کلید در سرور: <code>php webconsole-tools.php --key</code></p>';
    } else {
        echo '<p>دسترسی رد شد. نشانی باید <code>?key=…</code> داشته باشد. کلید در سرور: <code>php webconsole-tools.php --key</code></p>';
    }
    shell_end();
    exit;
}

shell_top($KEY, $SELF, 'webconsole-tools');
if ($msg !== '') { echo '<p style="background:#064e3b;border:1px solid #10b981;border-radius:8px;padding:10px">' . $msg . '</p>'; }
if ($err !== '') { echo '<p style="background:#7f1d1d;border:1px solid #ef4444;border-radius:8px;padding:10px">' . $err . '</p>'; }

if ($page === 'update') {
    echo '<h3>به‌روزرسانی خود کنسول از گیت‌هاب</h3>';
    echo '<p>نسخهٔ فعلی کنسول: <b style="color:#67e8f9">' . esc($cver) . '</b> — فایل: <code>' . esc($CONSOLE) . '</code></p>';
    echo '<form method="post" action="' . esc($SELF) . '">';
    echo '<input type="hidden" name="key" value="' . esc($KEY) . '">';
    echo '<p>مخزن <input name="repo" value="' . esc($defRepo) . '" style="width:260px;direction:ltr"> برنچ <input name="branch" value="' . esc($defBranch) . '" style="width:260px;direction:ltr"> مسیر فایل <input name="file" value="' . esc($defFile) . '" style="width:220px;direction:ltr"></p>';
    echo '<p><button name="a" value="update_check">بررسی نسخهٔ ریموت</button> <button name="a" value="update_apply">نصب نسخهٔ جدید (با بکاپ)</button> <button name="a" value="save_defaults">ذخیره به‌عنوان پیش‌فرض</button></p>';
    echo '</form>';
    echo '<p style="color:#94a3b8;font-size:13px">نصب فقط وقتی انجام می‌شود که php -l فایل جدید را قبول کند؛ همیشه اول بکاپ زمان‌دار گرفته می‌شود. پیش‌فرض‌ها در ' . esc($CONF) . ' ذخیره می‌شوند و مؤلفه‌های selfupdate_check / selfupdate_apply داخل خود کنسول هم همان را می‌خوانند.</p>';
} elseif ($page === 'github') {
    $repo = clean_repo(isset($_GET['repo']) ? $_GET['repo'] : $defRepo);
    $branch = clean_branch(isset($_GET['branch']) ? $_GET['branch'] : $defBranch);
    $dir = isset($_GET['dir']) ? rtrim(clean_path($_GET['dir']), '/') : '';
    $view = isset($_GET['view']) ? clean_path($_GET['view']) : '';
    echo '<h3>فایل‌های گیت‌هاب</h3>';
    echo '<form method="get" action="' . esc($SELF) . '"><input type="hidden" name="key" value="' . esc($KEY) . '"><input type="hidden" name="page" value="github">';
    echo 'مخزن <input name="repo" value="' . esc($repo !== '' ? $repo : $defRepo) . '" style="width:240px;direction:ltr"> برنچ <input name="branch" value="' . esc($branch !== '' ? $branch : $defBranch) . '" style="width:240px;direction:ltr"> <button>نمایش</button></form>';
    if ($repo !== '' && $branch !== '') {
        echo '<p style="direction:ltr;text-align:left">' . esc($repo) . ' @ ' . esc($branch) . ' / ' . esc($dir) . '</p>';
        if ($view !== '') {
            list($code, $body, $e) = http_get('https://raw.githubusercontent.com/' . $repo . '/' . rawurlencode($branch) . '/' . implode('/', array_map('rawurlencode', explode('/', $view))), '', 60);
            if ($code !== 200) {
                echo '<p>خواندن فایل ناموفق بود (HTTP ' . (int)$code . ')</p>';
            } else {
                echo '<form method="post" action="' . esc($SELF) . '">';
                echo '<input type="hidden" name="key" value="' . esc($KEY) . '"><input type="hidden" name="a" value="gh_save_local">';
                echo '<input type="hidden" name="repo" value="' . esc($repo) . '"><input type="hidden" name="branch" value="' . esc($branch) . '"><input type="hidden" name="path" value="' . esc($view) . '">';
                echo '<textarea name="content" rows="22" style="width:100%;direction:ltr;font-family:monospace;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:8px;padding:10px">' . esc($body) . '</textarea>';
                echo '<p><button>ذخیرهٔ نسخه در فضای فایل کنسول</button></p></form>';
                echo '<details><summary style="cursor:pointer">ثبت همین تغییر مستقیم در گیت‌هاب (توکن لازم دارد)</summary>';
                echo '<form method="post" action="' . esc($SELF) . '">';
                echo '<input type="hidden" name="key" value="' . esc($KEY) . '"><input type="hidden" name="a" value="gh_push">';
                echo '<input type="hidden" name="repo" value="' . esc($repo) . '"><input type="hidden" name="branch" value="' . esc($branch) . '"><input type="hidden" name="path" value="' . esc($view) . '">';
                echo '<input type="hidden" name="content" value="' . esc($body) . '">';
                echo '<p>توکن دسترسی <input name="token" type="password" style="width:340px;direction:ltr" placeholder="ghp_..."> پیام کامیت <input name="message" style="width:340px"></p>';
                echo '<p><button>Commit به گیت‌هاب</button></p></form></details>';
            }
            echo '<p><a href="' . esc(url('github', array('repo' => $repo, 'branch' => $branch, 'dir' => $dir))) . '" style="color:#67e8f9">← بازگشت به فهرست</a></p>';
        } else {
            list($code, $body, $e) = http_get('https://api.github.com/repos/' . $repo . '/git/trees/' . rawurlencode($branch) . '?recursive=1', '', 45);
            $json = json_decode($body, true);
            $items = is_array($json) && isset($json['tree']) && is_array($json['tree']) ? $json['tree'] : array();
            if ($code !== 200 || !$items) {
                echo '<p>فهرست مخزن خوانده نشد (HTTP ' . (int)$code . '). مخزن/برنچ را بررسی کنید؛ مخزن خصوصی به توکن نیاز دارد.</p>';
            } else {
                if (!empty($json['truncated'])) { echo '<p style="color:#fbbf24">مخزن بسیار بزرگ است — بخشی از فهرست ممکن است نمایش داده نشود.</p>'; }
                $prefix = $dir !== '' ? $dir . '/' : '';
                $dirs = array(); $files = array();
                foreach ($items as $it) {
                    $p = isset($it['path']) ? (string)$it['path'] : '';
                    if ($p === '' || ($prefix !== '' && strpos($p, $prefix) !== 0)) continue;
                    $rest = $prefix !== '' ? substr($p, strlen($prefix)) : $p;
                    if ($rest === '') continue;
                    $slash = strpos($rest, '/');
                    if ($slash !== false) {
                        $name = substr($rest, 0, $slash);
                        $dirs[$name] = ($prefix !== '' ? $prefix : '') . $name;
                    } elseif ((isset($it['type']) ? $it['type'] : '') === 'tree') {
                        $dirs[$rest] = ($prefix !== '' ? $prefix : '') . $rest;
                    } else {
                        $files[$rest] = isset($it['size']) ? (int)$it['size'] : 0;
                    }
                }
                ksort($dirs); ksort($files);
                if ($dir !== '') {
                    $up = $dir === '' ? '' : preg_replace('/\/[^\/]*$/', '', $dir);
                    echo '<p><a href="' . esc(url('github', array('repo' => $repo, 'branch' => $branch, 'dir' => $up))) . '" style="color:#67e8f9">↩ پوشهٔ بالاتر</a></p>';
                }
                echo '<table style="border-collapse:collapse;width:100%">';
                foreach ($dirs as $name => $full) {
                    echo '<tr><td style="padding:4px 8px">📁 <a href="' . esc(url('github', array('repo' => $repo, 'branch' => $branch, 'dir' => $full))) . '" style="color:#93c5fd">' . esc($name) . '/</a></td><td></td></tr>';
                }
                foreach ($files as $name => $size) {
                    $full = $prefix . $name;
                    $fd = $dir;
                    echo '<tr><td style="padding:4px 8px">📄 <a href="' . esc(url('github', array('repo' => $repo, 'branch' => $branch, 'dir' => $fd, 'view' => $full))) . '" style="color:#e2e8f0">' . esc($name) . '</a></td><td style="color:#64748b;text-align:left;direction:ltr">' . number_format($size) . ' B</td></tr>';
                }
                echo '</table>';
            }
        }
    }
} else {
    echo '<h3>ابزارهای همراه کنسول</h3>';
    echo '<p>نسخهٔ کنسول: <b style="color:#67e8f9">' . esc($cver) . '</b></p>';
    echo '<p>📎 <a href="' . esc(url('update')) . '" style="color:#67e8f9">به‌روزرسانی خود کنسول با انتخاب مخزن و برنچ</a> — دانلود webconsole.php از گیت‌هاب، بررسی با php -l، بکاپ و جایگزینی اتمی؛ پیش‌فرض‌ها همان چیزی هستند که مؤلفه‌های selfupdate داخل کنسول می‌خوانند.</p>';
    echo '<p>🗂 <a href="' . esc(url('github')) . '" style="color:#67e8f9">مشاهده و ویرایش فایل‌های گیت‌هاب</a> — پیمایش مخزن، ویرایش فایل، ذخیره در فضای فایل کنسول یا ثبت مستقیم در گیت‌هاب با توکن.</p>';
    echo '<p style="color:#94a3b8;font-size:13px">این صفحه یک ابزار مستقل است (webconsole-tools.php)؛ حذفش روی خود کنسول اثری ندارد. کلید در webconsole-tools.key نگه داشته می‌شود.</p>';
}
shell_end();
yle="color:#94a3b8;font-size:13px">این صفحه یک ابزار مستقل است (webconsole-tools.php)؛ حذفش روی خود کنسول اثری ندارد. کلید در webconsole-tools.key نگه داشته می‌شود.</p>';
}
shell_end();
WCPTOOLSFILE;

/**
 * 1.6.7 — Installs/refreshes the companion page (webconsole-tools.php) next
 * to webconsole.php and verifies it with php -l. The patch survives a
 * companion failure; only the message changes.
 */
function wcp_write_tools_file(string $dir, string $key): bool {
    $content = <<<'WCPTOOLSFILE'
<?php
/**
 * webconsole-tools.php — companion for WebConsole Pro.
 *
 * Two tools next to webconsole.php:
 *   1. Console self-update from any GitHub repo/branch (check + apply,
 *      php -l gate, timestamped backup, atomic replace, defaults saved to
 *      .wconsole_data/selfupdate.conf which the console's selfupdate_check /
 *      selfupdate_apply components read too).
 *   2. GitHub file explorer/editor: browse a repo/branch, view and edit any
 *      file, save a copy into the console's file space
 *      (.wconsole_data/github-files/<repo>/<branch>/...) and optionally push
 *      the edit straight back to GitHub with a personal access token.
 *
 * Installed by tools/webconsole-patch.php (which also prints the access key),
 * or copy this file manually. The access key lives in webconsole-tools.key
 * (0600) next to this file.
 *   CLI:  php webconsole-tools.php --key     (creates and prints key + URL)
 *   Web:  https://YOUR-HOST/webconsole-tools.php?key=...
 */
if (PHP_SAPI === 'cli') {
    $keyFile = __DIR__ . '/webconsole-tools.key';
    $key = is_file($keyFile) ? trim((string)file_get_contents($keyFile)) : '';
    if ($key === '') {
        $key = bin2hex(random_bytes(16));
        file_put_contents($keyFile, $key);
        chmod($keyFile, 0600);
    }
    echo "access key: {$key}\n";
    echo "open: https://YOUR-HOST/webconsole-tools.php?key={$key}\n";
    exit(0);
}
error_reporting(0);
header('Content-Type: text/html; charset=utf-8');

$KEYFILE = __DIR__ . '/webconsole-tools.key';
$CONSOLE = __DIR__ . '/webconsole.php';
$DATA = '/var/www/html/.wconsole_data';
if (!is_dir($DATA)) { $DATA = __DIR__ . '/.wconsole_data'; }
$CONF = $DATA . '/selfupdate.conf';

$KEY = is_file($KEYFILE) ? trim((string)@file_get_contents($KEYFILE)) : '';
$FRESH = false;
if ($KEY === '') {
    $KEY = bin2hex(random_bytes(16));
    @file_put_contents($KEYFILE, $KEY);
    @chmod($KEYFILE, 0600);
    $FRESH = true;
}

function esc($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
function clean_repo($v) { $v = trim((string)$v); return preg_match('#^[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+$#', $v) ? $v : ''; }
function clean_branch($v) { $v = trim((string)$v); return ($v !== '' && strpos($v, '..') === false && $v[0] !== '/' && preg_match('#^[A-Za-z0-9._/\-]+$#', $v)) ? $v : ''; }
function clean_path($v) { $v = ltrim(trim((string)$v), '/'); if ($v === '' || strpos($v, '..') !== false || strpos($v, "\x00") !== false) return ''; return $v; }

function http_get($url, $token = '', $timeout = 30) {
    $ch = curl_init($url);
    $hdr = array('User-Agent: wconsole-tools/1.0', 'Accept: application/vnd.github+json');
    if ($token !== '') { $hdr[] = 'Authorization: token ' . $token; }
    curl_setopt_array($ch, array(
        CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 4,
        CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 15, CURLOPT_HTTPHEADER => $hdr,
    ));
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    return array($code, (string)$body, $err);
}
function http_put_json($url, $token, $payload) {
    $ch = curl_init($url);
    curl_setopt_array($ch, array(
        CURLOPT_RETURNTRANSFER => true, CURLOPT_CUSTOMREQUEST => 'PUT', CURLOPT_TIMEOUT => 60,
        CURLOPT_HTTPHEADER => array('User-Agent: wconsole-tools/1.0', 'Accept: application/vnd.github+json',
            'Authorization: token ' . $token, 'Content-Type: application/json'),
        CURLOPT_POSTFIELDS => json_encode($payload),
    ));
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    return array($code, (string)$body);
}
function console_version($f) {
    if (!is_file($f)) return '(missing)';
    $s = (string)@file_get_contents($f);
    if (preg_match("/define\('WCP_VERSION',\s*'([^']+)'\)/", $s, $m)) return $m[1];
    return '(unknown)';
}

$SELF = basename(__FILE__);
function url($page, $extra = array()) {
    global $KEY, $SELF;
    $q = array_merge(array('key' => $KEY, 'page' => $page), $extra);
    return $SELF . '?' . http_build_query($q);
}

$gk = isset($_REQUEST['key']) && is_string($_REQUEST['key']) ? $_REQUEST['key'] : '';
$ok = $gk !== '' && hash_equals($KEY, $gk);
$page = isset($_GET['page']) ? preg_replace('/[^a-z]/', '', (string)$_GET['page']) : 'home';

$defRepo = 'fazilatma/new'; $defBranch = 'arena/01a0c9ea-new'; $defFile = 'webconsole.php';
if (is_file($CONF)) {
    $cf = @parse_ini_file($CONF);
    if (is_array($cf)) {
        if (!empty($cf['REPO'])) $defRepo = (string)$cf['REPO'];
        if (!empty($cf['BRANCH'])) $defBranch = (string)$cf['BRANCH'];
        if (!empty($cf['WFILE'])) $defFile = (string)$cf['WFILE'];
    }
}
$msg = ''; $err = '';
$cver = console_version($CONSOLE);

if ($ok && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $a = isset($_POST['a']) ? preg_replace('/[^a-z_]/', '', (string)$_POST['a']) : '';
    $repo = clean_repo(isset($_POST['repo']) ? $_POST['repo'] : $defRepo);
    $branch = clean_branch(isset($_POST['branch']) ? $_POST['branch'] : $defBranch);
    $file = clean_path(isset($_POST['file']) ? $_POST['file'] : $defFile);

    if ($a === 'save_defaults') {
        if ($repo === '' || $branch === '' || $file === '') { $err = 'repo/branch/file نامعتبر است'; }
        else {
            $dir = dirname($CONF);
            if (!is_dir($dir)) { @mkdir($dir, 0755, true); }
            $okw = @file_put_contents($CONF, "REPO={$repo}\nBRANCH={$branch}\nWFILE={$file}\n");
            if ($okw) { $msg = 'پیش‌فرض‌های خودآپدیت ذخیره شد (مؤلفه‌های selfupdate_check/selfupdate_apply هم از همین می‌خوانند).'; }
            else { $err = 'نوشتن selfupdate.conf ناموفق بود'; }
        }
    }

    if ($a === 'update_check' || $a === 'update_apply') {
        if ($repo === '' || $branch === '' || $file === '') { $err = 'repo/branch/file نامعتبر است'; }
        else {
            $parts = array_map('rawurlencode', explode('/', $file));
            list($code, $body, $e) = http_get('https://raw.githubusercontent.com/' . $repo . '/' . rawurlencode($branch) . '/' . implode('/', $parts), '', 60);
            if ($code !== 200 || $body === '') { $err = 'دانلود ناموفق (HTTP ' . $code . ') ' . esc($e); }
            elseif (strpos($body, 'WCP_VERSION') === false) { $err = 'فایل دریافتی یک webconsole.php معتبر نیست (WCP_VERSION ندارد)'; }
            else {
                preg_match("/define\('WCP_VERSION',\s*'([^']+)'\)/", $body, $m);
                $rv = isset($m[1]) ? $m[1] : '?';
                $lv = console_version($CONSOLE);
                if ($a === 'update_check') {
                    $msg = 'نسخهٔ محلی: ' . esc($lv) . ' — نسخهٔ ' . esc($repo) . '@' . esc($branch) . ': ' . esc($rv);
                } elseif ($rv === $lv) {
                    $msg = 'همین نسخه روی سرور است — نیازی به نصب نیست.';
                } else {
                    $tmp = tempnam(sys_get_temp_dir(), 'wct-');
                    file_put_contents($tmp, $body);
                    $lint = @exec('php -l ' . escapeshellarg($tmp) . ' 2>&1');
                    if (strpos((string)$lint, 'No syntax errors') === false) {
                        $err = 'php -l فایل جدید را رد کرد — نصب انجام نشد. ' . esc((string)$lint);
                        @unlink($tmp);
                    } elseif (!is_writable($CONSOLE) && !@is_writable(dirname($CONSOLE))) {
                        $err = 'اجازهٔ نوشتن webconsole.php را ندارید (مالک فایل را بررسی کنید)';
                        @unlink($tmp);
                    } else {
                        $bak = $CONSOLE . '.bak-' . preg_replace('/[^0-9a-z.\-]/i', '', $lv) . '-' . date('Ymd-His');
                        @copy($CONSOLE, $bak);
                        if (@rename($tmp, $CONSOLE)) {
                            $msg = 'کنسول از ' . esc($lv) . ' به ' . esc($rv) . ' به‌روزرسانی شد. بکاپ: ' . esc(basename($bak));
                        } else {
                            @unlink($tmp);
                            $err = 'جایگزینی فایل ناموفق بود';
                        }
                    }
                }
            }
        }
    }

    if ($a === 'gh_save_local' || $a === 'gh_push') {
        $path = clean_path(isset($_POST['path']) ? $_POST['path'] : '');
        $content = isset($_POST['content']) && is_string($_POST['content']) ? $_POST['content'] : '';
        if ($repo === '' || $branch === '' || $path === '') { $err = 'repo/branch/path نامعتبر است'; }
        elseif ($a === 'gh_save_local') {
            $dest = $DATA . '/github-files/' . $repo . '/' . $branch . '/' . $path;
            $d = dirname($dest);
            if (!is_dir($d)) { @mkdir($d, 0755, true); }
            if (@file_put_contents($dest, $content) !== false) {
                $msg = 'در فضای فایل کنسول ذخیره شد: ' . esc(str_replace('/var/www/html/', '', $dest)) . ' (از فایل اکسپلورر کنسول هم قابل ویرایش است)';
            } else { $err = 'ذخیرهٔ محلی ناموفق بود'; }
        } else {
            $token = trim((string)($_POST['token'] ?? ''));
            $message = trim((string)($_POST['message'] ?? ''));
            if ($token === '' || $message === '') { $err = 'برای ثبت در گیت‌هاب، توکن و پیام کامیت لازم است'; }
            else {
                list($sc, $sb) = http_get('https://api.github.com/repos/' . $repo . '/contents/' . implode('/', array_map('rawurlencode', explode('/', $path))) . '?ref=' . rawurlencode($branch), $token);
                $sj = json_decode($sb, true);
                $sha = is_array($sj) && isset($sj['sha']) ? (string)$sj['sha'] : '';
                if ($sc !== 200 || $sha === '') { $err = 'دریافت sha فایل ناموفق بود (HTTP ' . $sc . ') — توکن/مسیر را بررسی کنید'; }
                else {
                    list($pc, $pb) = http_put_json('https://api.github.com/repos/' . $repo . '/contents/' . implode('/', array_map('rawurlencode', explode('/', $path))), $token,
                        array('message' => $message, 'content' => base64_encode($content), 'branch' => $branch, 'sha' => $sha));
                    if ($pc >= 200 && $pc < 300) { $msg = 'تغییرات در گیت‌هاب ثبت شد (' . esc($repo) . '@' . esc($branch) . ' → ' . esc($path) . ')'; }
                    else { $err = 'ثبت در گیت‌هاب ناموفق بود (HTTP ' . $pc . '): ' . esc(substr($pb, 0, 200)); }
                }
            }
        }
    }
}

function shell_top($KEY, $SELF, $title) {
    echo '<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><title>' . esc($title) . '</title></head>';
    echo '<body style="font-family:Tahoma,Arial,sans-serif;background:#0b1220;color:#e2e8f0;margin:0;padding:18px;max-width:1100px;margin:0 auto">';
    echo '<div style="display:flex;gap:14px;margin-bottom:14px"><b style="color:#67e8f9">وب‌کنسول ابزارها</b>';
    echo '<a href="' . esc(url('home')) . '" style="color:#94a3b8">خانه</a>';
    echo '<a href="' . esc(url('update')) . '" style="color:#94a3b8">به‌روزرسانی کنسول</a>';
    echo '<a href="' . esc(url('github')) . '" style="color:#94a3b8">فایل‌های گیت‌هاب</a></div>';
}
function shell_end() { echo '</body></html>'; }

if (!$ok) {
    shell_top($KEY, $SELF, 'webconsole-tools');
    if ($FRESH) {
        echo '<p>این ابزار تازه نصب شده است. کلید دسترسی (فقط همین یک بار نمایش داده می‌شود):</p>';
        echo '<p><code style="font-size:18px;color:#fbbf24;direction:ltr;display:inline-block">' . esc($KEY) . '</code></p>';
        echo '<p>همین صفحه را با <code>?key=…</code> باز کنید. برای دیدن دوبارهٔ کلید در سرور: <code>php webconsole-tools.php --key</code></p>';
    } else {
        echo '<p>دسترسی رد شد. نشانی باید <code>?key=…</code> داشته باشد. کلید در سرور: <code>php webconsole-tools.php --key</code></p>';
    }
    shell_end();
    exit;
}

shell_top($KEY, $SELF, 'webconsole-tools');
if ($msg !== '') { echo '<p style="background:#064e3b;border:1px solid #10b981;border-radius:8px;padding:10px">' . $msg . '</p>'; }
if ($err !== '') { echo '<p style="background:#7f1d1d;border:1px solid #ef4444;border-radius:8px;padding:10px">' . $err . '</p>'; }

if ($page === 'update') {
    echo '<h3>به‌روزرسانی خود کنسول از گیت‌هاب</h3>';
    echo '<p>نسخهٔ فعلی کنسول: <b style="color:#67e8f9">' . esc($cver) . '</b> — فایل: <code>' . esc($CONSOLE) . '</code></p>';
    echo '<form method="post" action="' . esc($SELF) . '">';
    echo '<input type="hidden" name="key" value="' . esc($KEY) . '">';
    echo '<p>مخزن <input name="repo" value="' . esc($defRepo) . '" style="width:260px;direction:ltr"> برنچ <input name="branch" value="' . esc($defBranch) . '" style="width:260px;direction:ltr"> مسیر فایل <input name="file" value="' . esc($defFile) . '" style="width:220px;direction:ltr"></p>';
    echo '<p><button name="a" value="update_check">بررسی نسخهٔ ریموت</button> <button name="a" value="update_apply">نصب نسخهٔ جدید (با بکاپ)</button> <button name="a" value="save_defaults">ذخیره به‌عنوان پیش‌فرض</button></p>';
    echo '</form>';
    echo '<p style="color:#94a3b8;font-size:13px">نصب فقط وقتی انجام می‌شود که php -l فایل جدید را قبول کند؛ همیشه اول بکاپ زمان‌دار گرفته می‌شود. پیش‌فرض‌ها در ' . esc($CONF) . ' ذخیره می‌شوند و مؤلفه‌های selfupdate_check / selfupdate_apply داخل خود کنسول هم همان را می‌خوانند.</p>';
} elseif ($page === 'github') {
    $repo = clean_repo(isset($_GET['repo']) ? $_GET['repo'] : $defRepo);
    $branch = clean_branch(isset($_GET['branch']) ? $_GET['branch'] : $defBranch);
    $dir = isset($_GET['dir']) ? rtrim(clean_path($_GET['dir']), '/') : '';
    $view = isset($_GET['view']) ? clean_path($_GET['view']) : '';
    echo '<h3>فایل‌های گیت‌هاب</h3>';
    echo '<form method="get" action="' . esc($SELF) . '"><input type="hidden" name="key" value="' . esc($KEY) . '"><input type="hidden" name="page" value="github">';
    echo 'مخزن <input name="repo" value="' . esc($repo !== '' ? $repo : $defRepo) . '" style="width:240px;direction:ltr"> برنچ <input name="branch" value="' . esc($branch !== '' ? $branch : $defBranch) . '" style="width:240px;direction:ltr"> <button>نمایش</button></form>';
    if ($repo !== '' && $branch !== '') {
        echo '<p style="direction:ltr;text-align:left">' . esc($repo) . ' @ ' . esc($branch) . ' / ' . esc($dir) . '</p>';
        if ($view !== '') {
            list($code, $body, $e) = http_get('https://raw.githubusercontent.com/' . $repo . '/' . rawurlencode($branch) . '/' . implode('/', array_map('rawurlencode', explode('/', $view))), '', 60);
            if ($code !== 200) {
                echo '<p>خواندن فایل ناموفق بود (HTTP ' . (int)$code . ')</p>';
            } else {
                echo '<form method="post" action="' . esc($SELF) . '">';
                echo '<input type="hidden" name="key" value="' . esc($KEY) . '"><input type="hidden" name="a" value="gh_save_local">';
                echo '<input type="hidden" name="repo" value="' . esc($repo) . '"><input type="hidden" name="branch" value="' . esc($branch) . '"><input type="hidden" name="path" value="' . esc($view) . '">';
                echo '<textarea name="content" rows="22" style="width:100%;direction:ltr;font-family:monospace;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:8px;padding:10px">' . esc($body) . '</textarea>';
                echo '<p><button>ذخیرهٔ نسخه در فضای فایل کنسول</button></p></form>';
                echo '<details><summary style="cursor:pointer">ثبت همین تغییر مستقیم در گیت‌هاب (توکن لازم دارد)</summary>';
                echo '<form method="post" action="' . esc($SELF) . '">';
                echo '<input type="hidden" name="key" value="' . esc($KEY) . '"><input type="hidden" name="a" value="gh_push">';
                echo '<input type="hidden" name="repo" value="' . esc($repo) . '"><input type="hidden" name="branch" value="' . esc($branch) . '"><input type="hidden" name="path" value="' . esc($view) . '">';
                echo '<input type="hidden" name="content" value="' . esc($body) . '">';
                echo '<p>توکن دسترسی <input name="token" type="password" style="width:340px;direction:ltr" placeholder="ghp_..."> پیام کامیت <input name="message" style="width:340px"></p>';
                echo '<p><button>Commit به گیت‌هاب</button></p></form></details>';
            }
            echo '<p><a href="' . esc(url('github', array('repo' => $repo, 'branch' => $branch, 'dir' => $dir))) . '" style="color:#67e8f9">← بازگشت به فهرست</a></p>';
        } else {
            list($code, $body, $e) = http_get('https://api.github.com/repos/' . $repo . '/git/trees/' . rawurlencode($branch) . '?recursive=1', '', 45);
            $json = json_decode($body, true);
            $items = is_array($json) && isset($json['tree']) && is_array($json['tree']) ? $json['tree'] : array();
            if ($code !== 200 || !$items) {
                echo '<p>فهرست مخزن خوانده نشد (HTTP ' . (int)$code . '). مخزن/برنچ را بررسی کنید؛ مخزن خصوصی به توکن نیاز دارد.</p>';
            } else {
                if (!empty($json['truncated'])) { echo '<p style="color:#fbbf24">مخزن بسیار بزرگ است — بخشی از فهرست ممکن است نمایش داده نشود.</p>'; }
                $prefix = $dir !== '' ? $dir . '/' : '';
                $dirs = array(); $files = array();
                foreach ($items as $it) {
                    $p = isset($it['path']) ? (string)$it['path'] : '';
                    if ($p === '' || ($prefix !== '' && strpos($p, $prefix) !== 0)) continue;
                    $rest = $prefix !== '' ? substr($p, strlen($prefix)) : $p;
                    if ($rest === '') continue;
                    $slash = strpos($rest, '/');
                    if ($slash !== false) {
                        $name = substr($rest, 0, $slash);
                        $dirs[$name] = ($prefix !== '' ? $prefix : '') . $name;
                    } elseif ((isset($it['type']) ? $it['type'] : '') === 'tree') {
                        $dirs[$rest] = ($prefix !== '' ? $prefix : '') . $rest;
                    } else {
                        $files[$rest] = isset($it['size']) ? (int)$it['size'] : 0;
                    }
                }
                ksort($dirs); ksort($files);
                if ($dir !== '') {
                    $up = $dir === '' ? '' : preg_replace('/\/[^\/]*$/', '', $dir);
                    echo '<p><a href="' . esc(url('github', array('repo' => $repo, 'branch' => $branch, 'dir' => $up))) . '" style="color:#67e8f9">↩ پوشهٔ بالاتر</a></p>';
                }
                echo '<table style="border-collapse:collapse;width:100%">';
                foreach ($dirs as $name => $full) {
                    echo '<tr><td style="padding:4px 8px">📁 <a href="' . esc(url('github', array('repo' => $repo, 'branch' => $branch, 'dir' => $full))) . '" style="color:#93c5fd">' . esc($name) . '/</a></td><td></td></tr>';
                }
                foreach ($files as $name => $size) {
                    $full = $prefix . $name;
                    $fd = $dir;
                    echo '<tr><td style="padding:4px 8px">📄 <a href="' . esc(url('github', array('repo' => $repo, 'branch' => $branch, 'dir' => $fd, 'view' => $full))) . '" style="color:#e2e8f0">' . esc($name) . '</a></td><td style="color:#64748b;text-align:left;direction:ltr">' . number_format($size) . ' B</td></tr>';
                }
                echo '</table>';
            }
        }
    }
} else {
    echo '<h3>ابزارهای همراه کنسول</h3>';
    echo '<p>نسخهٔ کنسول: <b style="color:#67e8f9">' . esc($cver) . '</b></p>';
    echo '<p>📎 <a href="' . esc(url('update')) . '" style="color:#67e8f9">به‌روزرسانی خود کنسول با انتخاب مخزن و برنچ</a> — دانلود webconsole.php از گیت‌هاب، بررسی با php -l، بکاپ و جایگزینی اتمی؛ پیش‌فرض‌ها همان چیزی هستند که مؤلفه‌های selfupdate داخل کنسول می‌خوانند.</p>';
    echo '<p>🗂 <a href="' . esc(url('github')) . '" style="color:#67e8f9">مشاهده و ویرایش فایل‌های گیت‌هاب</a> — پیمایش مخزن، ویرایش فایل، ذخیره در فضای فایل کنسول یا ثبت مستقیم در گیت‌هاب با توکن.</p>';
    echo '<p style="color:#94a3b8;font-size:13px">این صفحه یک ابزار مستقل است (webconsole-tools.php)؛ حذفش روی خود کنسول اثری ندارد. کلید در webconsole-tools.key نگه داشته می‌شود.</p>';
}
shell_end();
yle="color:#94a3b8;font-size:13px">این صفحه یک ابزار مستقل است (webconsole-tools.php)؛ حذفش روی خود کنسول اثری ندارد. کلید در webconsole-tools.key نگه داشته می‌شود.</p>';
}
shell_end();
WCPTOOLSFILE;
    $dest = rtrim($dir, '/') . '/webconsole-tools.php';
    if (@file_put_contents($dest, $content) === false) { return false; }
    @chmod($dest, 0644);
    if (function_exists('exec')) {
        $lint = @exec('php -l ' . escapeshellarg($dest) . ' 2>&1');
        if (strpos((string)$lint, 'No syntax errors') === false) {
            @unlink($dest);
            echo "WARNING: php -l rejected the companion file — it was removed. The patch itself is fine.\n";
            return false;
        }
    }
    return true;
}

$swapBranch = <<<'WCPPATCHSWAPB'
    if ($name === 'swap_2g' || $name === 'swap_4g' || $name === 'swap_8g' || $name === 'swap_16g') {
        $mb = ((int)substr($name, 5)) * 1024;
        cli_log("[Swap] Configuring {$mb} MB swapfile (idempotent)...");
        cli_checked(wcp_swap_setup_cmd($mb));
        cli_log("✓ Swap configured ({$mb} MB).");
        return;
    }
WCPPATCHSWAPB;

$selfBranch = <<<'WCPPATCHSELFB'
    if ($name === 'selfupdate_check' || $name === 'selfupdate_apply') {
        cli_log("[SelfUpdate] Console self-update against the configured repo/branch...");
        cli_checked(($name === 'selfupdate_apply' ? 'APPLY=1 ' : '') . wcp_selfupdate_cmd());
        cli_log("✓ Self-update step finished — see the log lines above.");
        return;
    }

WCPPATCHSELFB;

$baseSet = [
    ['deploy loop gains the non-fatal browser step',
     $oldD, $newD],
    ['install component browser_deps downloads the browsers',
     $oldE1, $newE1],
    ['install component python_scrapers downloads the browsers',
     $oldE2, $newE2],
    ['default_install_cmd python fallback ships the full engine list',
     $oldC, $newC],
];
$swapSet = [
    ['cli_install_component understands the swap_2g/4g/8g/16g components',
     "    if (\$name === 'python_scrapers') {",
     $swapBranch . "    if (\$name === 'python_scrapers') {"],
    ['insert wcp_swap_setup_cmd() helper',
     'function default_install_cmd(string $type): string {',
     $payloadSwap . 'function default_install_cmd(string $type): string {'],
];
$selfSet = [
    ['cli_install_component understands selfupdate_check / selfupdate_apply',
     "    if (\$name === 'python_scrapers') {",
     $selfBranch . "    if (\$name === 'python_scrapers') {"],
    ['insert wcp_selfupdate_cmd() helper',
     'function default_install_cmd(string $type): string {',
     $payloadSelf . 'function default_install_cmd(string $type): string {'],
];

$patches = [];
if ($ver !== '') {
    $patches[] = ['version bump {$ver} -> 1.6.7',
        "define('WCP_VERSION', '{$ver}');", "define('WCP_VERSION', '1.6.7');"];
}
if ($ver === '1.6.4') {
    // also insert the 1.6.5 browser payload function itself
    $patches[] = ['insert wcp_browser_bootstrap_cmd() before default_install_cmd()',
        'function default_install_cmd(string $type): string {',
        $payloadFunc . 'function default_install_cmd(string $type): string {'];
    foreach ($baseSet as $p) { $patches[] = $p; }
}
if ($ver === '1.6.4' || $ver === '1.6.5') {
    foreach ($swapSet as $p) { $patches[] = $p; }
}
if ($ver === '1.6.4' || $ver === '1.6.5' || $ver === '1.6.6') {
    foreach ($selfSet as $p) { $patches[] = $p; }
}
if ($ver === '') {
    // check-only on an unknown version: report everything, change nothing.
    $patches = array_merge($baseSet, $swapSet, $selfSet);
}

if ($checkOnly) {
    echo "CHECK MODE (read-only, nothing written) — {$target}\n";
    echo "  WCP_VERSION: " . ($ver !== '' ? $ver : 'NOT FOUND') . "\n";
    $sets = [];
    if ($ver === '1.6.4') { $sets = ['browser bootstrap (1.6.5)', 'swap (1.6.6)', 'self-update (1.6.7)']; }
    elseif ($ver === '1.6.5') { $sets = ['swap (1.6.6)', 'self-update (1.6.7)']; }
    elseif ($ver === '1.6.6') { $sets = ['self-update (1.6.7)']; }
    elseif ($ver === '1.6.7') { $sets = []; }
    else { $sets = ['(unknown version — informational only)']; }
    echo "  sets to apply: " . ($sets ? implode(', ', $sets) : 'none — already 1.6.7') . "\n";
    $ready = ($ver !== '');
    foreach ($patches as $i => $patch) {
        $count = substr_count($src, $patch[1]);
        if ($count !== 1) { $ready = false; $mark = 'PROBLEM'; } else { $mark = 'OK'; }
        printf("  anchor #%d: %-7s found %d time(s) — %s\n", $i + 1, $mark, $count, $patch[0]);
    }
    $smart = substr_count($src, 'pip-smart');
    echo "  'pip-smart' references in the console: {$smart}" . ($smart ? "  (a smart-installer is wired in; it hid the real pip errors in your deploy log)" : "") . "\n";
    echo "  companion key file: " . (is_file($dir . '/webconsole-tools.key') ? 'present' : 'missing (created on patch)') . "\n";
    echo $ready ? "VERDICT: READY — run the patcher without --check to apply.\n" : "VERDICT: NOT READY — send this output so a re-targeted patcher can be built.\n";
    exit($ready ? 0 : 1);
}

$applied = 0;
$failed = [];
foreach ($patches as $i => $patch) {
    $name = $patch[0];
    $count = substr_count($src, $patch[1]);
    if ($count !== 1) {
        $failed[] = sprintf('#%d %s — anchor found %d time(s), expected exactly 1', $i + 1, $name, $count);
        continue;
    }
    $src = str_replace($patch[1], $patch[2], $src);
    $applied++;
}
if ($failed) {
    fwrite(STDERR, "PATCH ABORTED — nothing was written. Anchor problems:\n  - " . implode("\n  - ", $failed) . "\n");
    exit(1);
}

$backup = $target . '.bak-1.6.4-' . date('Ymd-His');
if (!@copy($target, $backup)) {
    fwrite(STDERR, "ERROR: cannot create the backup file {$backup}. Nothing was changed.\n");
    exit(1);
}
$tmp = $target . '.tmp-' . getmypid();
if (@file_put_contents($tmp, $src) === false) {
    fwrite(STDERR, "ERROR: cannot write {$tmp}. Nothing was changed.\n");
    exit(1);
}
if (function_exists('exec')) {
    $lintOut = @exec('php -l ' . escapeshellarg($tmp) . ' 2>&1', $lintLines, $lintCode);
    if (strpos((string)$lintOut, 'No syntax errors') === false) {
        @unlink($tmp);
        fwrite(STDERR, "PATCH ROLLED BACK — php -l rejected the result:\n" . implode("\n", $lintLines) . "\nYour original webconsole.php is untouched (backup: {$backup}).\n");
        exit(1);
    }
} else {
    echo "WARNING: exec() is disabled — skipping the php -l self-check.\n";
}
if (!@rename($tmp, $target)) {
    @unlink($tmp);
    fwrite(STDERR, "ERROR: could not replace {$target} with the patched file. Original untouched.\n");
    exit(1);
}
echo "OK: {$applied} patch site(s) applied. Backup: {$backup}\n";
echo "WebConsole Pro is now 1.6.7 — deploy installs the full Python stack +\n";
echo "Chromium, swap_2g/4g/8g/16g and selfupdate_check/selfupdate_apply\n";
echo "components are available, and the companion tools page is installed:\n";
$keyFile = $dir . '/webconsole-tools.key';
$key = is_file($keyFile) ? trim((string)file_get_contents($keyFile)) : '';
if ($key === '') { $key = bin2hex(random_bytes(16)); @file_put_contents($keyFile, $key); @chmod($keyFile, 0600); }
if (wcp_write_tools_file($dir, $key)) {
    echo "  {$dir}/webconsole-tools.php\n  access key: {$key}\n  open: https://YOUR-HOST/webconsole-tools.php?key={$key}\n";
}
echo "Note: if the project's custom install command uses a pip-smart script that\n";
echo "skips packages, replace it with: pip3 install --break-system-packages -r requirements.txt\n";
