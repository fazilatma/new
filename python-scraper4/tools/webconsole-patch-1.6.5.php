<?php
/**
 * WebConsole Pro patcher: 1.6.4 -> 1.6.5
 * ======================================
 * Makes the "نصب / به‌روزرسانی" (deploy) button install the full Python
 * scraping stack AND a real Chromium automatically:
 *
 *   1. Every Python deploy gains a third, non-fatal "browser" step after
 *      install/build (proj_perform_deploy). A project counts as Python when
 *      its type is python or it contains scraper4.py / deployer4.py /
 *      app.py / requirements.txt.
 *   2. default_install_cmd('python') no-requirements fallback now ships the
 *      full engine list (gunicorn, curl_cffi, cloudscraper, httpx, aiohttp,
 *      undetected-chromedriver, playwright, selenium, ...).
 *   3. The dashboard install components (browser_deps / python_scrapers /
 *      all) also download Playwright + Chromium, not just OS libraries.
 *
 * The browser bootstrap itself (wcp_browser_bootstrap_cmd) is a
 * self-contained shell block: pip playwright -> official CDN download ->
 * inline Iran mirror fallback (npmmirror/huaweicloud/nju, exact versions
 * from `playwright install --dry-run`, INSTALLATION_COMPLETE markers,
 * OS libs, headless launch test) -> last-resort system Chromium via apt.
 * Idempotent (skips when Chromium is already in the persistent cache the
 * scraper scans) and non-fatal (a deploy never fails because of it).
 *
 * Usage (on the server, in the folder containing webconsole.php):
 *   cp webconsole.php webconsole.php.mybackup      # your own safety copy
 *   php patch_webconsole_1.6.5.php webconsole.php
 *
 * Safety: the patcher refuses to write unless every anchor matches exactly
 * once, creates a timestamped .bak-1.6.4 backup, verifies the result with
 * `php -l` and rolls back automatically if the lint fails. Running it twice
 * is a no-op (it detects 1.6.5 and exits).
 */

if (PHP_SAPI !== 'cli') { http_response_code(403); exit("CLI only\n"); }

$target = isset($argv[1]) ? $argv[1] : 'webconsole.php';
if (!is_file($target)) { fwrite(STDERR, "ERROR: file not found: {$target}\n"); exit(1); }
$src = file_get_contents($target);
if ($src === false) { fwrite(STDERR, "ERROR: cannot read {$target}\n"); exit(1); }

if (strpos($src, "define('WCP_VERSION', '1.6.5')") !== false) {
    echo "Already patched (WebConsole Pro 1.6.5). Nothing to do.\n";
    exit(0);
}
if (strpos($src, "define('WCP_VERSION', '1.6.4')") === false) {
    fwrite(STDERR, "ERROR: this patcher targets WebConsole Pro 1.6.4; your file reports another version. Patch aborted, nothing written.\n");
    exit(1);
}

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
      command -v unzip >/dev/null 2>&1 || { apt-get install -y unzip >/dev/null 2>&1 || sudo -n apt-get install -y unzip >/dev/null 2>&1 || true; }
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

$patches = [
    ['version bump 1.6.4 -> 1.6.5',
     "define('WCP_VERSION', '1.6.4');",
     "define('WCP_VERSION', '1.6.5');"],
    ['insert wcp_browser_bootstrap_cmd() before default_install_cmd()',
     'function default_install_cmd(string $type): string {',
     $payloadFunc . 'function default_install_cmd(string $type): string {'],
    ['deploy loop gains the non-fatal browser step',
     $oldD, $newD],
    ['install component browser_deps downloads the browsers',
     $oldE1, $newE1],
    ['install component python_scrapers downloads the browsers',
     $oldE2, $newE2],
    ['default_install_cmd python fallback ships the full engine list',
     $oldC, $newC],
];

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
echo "WebConsole Pro is now 1.6.5 — the deploy button installs the full Python stack\n";
echo "plus Playwright + Chromium automatically (official CDN, Iran mirrors, system\n";
echo "browser fallback). No service restart is needed for the console itself.\n";
