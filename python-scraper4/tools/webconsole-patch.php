<?php
/**
 * WebConsole Pro patcher: 1.6.4 / 1.6.5 -> 1.6.6
 * (browser bootstrap + swap management + full pip fallback list)
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
 *   php webconsole-patch.php webconsole.php
 *   php webconsole-patch.php --check webconsole.php   # read-only: reports
 *        the console version, every anchor match count and pip-smart markers
 *        without touching anything — send this output if patching is refused.
 *   php webconsole-patch.php --swap-apply 4096        # configure a 4 GB
 *        swapfile right now (root or passwordless sudo), no patching involved.
 *
 * Swap (1.6.6): the console's install components gain swap_2g / swap_4g /
 * swap_8g / swap_16g entries backed by wcp_swap_setup_cmd(): an idempotent,
 * sudo-aware swapfile setup that resizes in place, persists via /etc/fstab,
 * sets vm.swappiness=20 and degrades gracefully inside containers.
 *
 * Safety: the patcher refuses to write unless every anchor matches exactly
 * once, creates a timestamped .bak-1.6.4 backup, verifies the result with
 * `php -l` and rolls back automatically if the lint fails. Running it twice
 * is a no-op (it detects 1.6.5 and exits).
 */

if (PHP_SAPI !== 'cli') { http_response_code(403); exit("CLI only\n"); }

$checkOnly = false;
$swapApplyMb = 0;
$target = 'webconsole.php';
foreach (array_slice($argv, 1) as $arg) {
    if ($arg === '--check' || $arg === '-c') { $checkOnly = true; }
    elseif ($arg === '--swap-apply') { $swapApplyMb = -1; }
    elseif ($swapApplyMb === -1 && ctype_digit($arg)) { $swapApplyMb = (int)$arg; }
    else { $target = $arg; }
}
if ($swapApplyMb === -1) { fwrite(STDERR, "--swap-apply needs a size in MB, e.g. --swap-apply 4096\n"); exit(1); }
if ($swapApplyMb > 0) {
    // 1.6.6: configure the swapfile right now (root or passwordless sudo).
    $f = tempnam(sys_get_temp_dir(), 'wcp-swap-');
    file_put_contents($f, wcp_swap_setup_cmd($swapApplyMb));
    passthru('bash ' . escapeshellarg($f));
    exit(0);
}
if (!is_file($target)) { fwrite(STDERR, "ERROR: file not found: {$target}\n"); exit(1); }
$src = file_get_contents($target);
if ($src === false) { fwrite(STDERR, "ERROR: cannot read {$target}\n"); exit(1); }

$ver = '';
if (strpos($src, "define('WCP_VERSION', '1.6.4')") !== false) { $ver = '1.6.4'; }
elseif (strpos($src, "define('WCP_VERSION', '1.6.5')") !== false) { $ver = '1.6.5'; }
elseif (strpos($src, "define('WCP_VERSION', '1.6.6')") !== false) { $ver = '1.6.6'; }
if ($ver === '1.6.6') {
    echo "Already patched (WebConsole Pro 1.6.6: browser bootstrap + swap). Nothing to do.\n";
    exit(0);
}
if (!$checkOnly && $ver === '') {
    fwrite(STDERR, "ERROR: this patcher targets WebConsole Pro 1.6.4/1.6.5; your file reports another version. Patch aborted, nothing written.\n");
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
    ['version bump 1.6.4 -> 1.6.6',
     "define('WCP_VERSION', '1.6.4');",
     "define('WCP_VERSION', '1.6.6');"],
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

// ---- 1.6.6: swap management (idempotent swapfile, sudo-aware) ----
$swapBranch = <<<'WCPPATCHSWAPB'
    if ($name === 'swap_2g' || $name === 'swap_4g' || $name === 'swap_8g' || $name === 'swap_16g') {
        $mb = ((int)substr($name, 5)) * 1024;
        cli_log("[Swap] Configuring {$mb} MB swapfile (idempotent)...");
        cli_checked(wcp_swap_setup_cmd($mb));
        cli_log("✓ Swap configured ({$mb} MB).");
        return;
    }
WCPPATCHSWAPB;
$swapPatches = [
    ['cli_install_component understands the swap_2g/4g/8g/16g components',
     "    if (\$name === 'python_scrapers') {",
     $swapBranch . "    if (\$name === 'python_scrapers') {"],
    ['insert wcp_swap_setup_cmd() helper',
     'function default_install_cmd(string $type): string {',
     $payloadSwap . 'function default_install_cmd(string $type): string {'],
];
if ($ver === '1.6.5') {
    // Browser bootstrap (1.6.5) is already on the file — only add swap + bump.
    $patches = [
        ['version bump 1.6.5 -> 1.6.6', "define('WCP_VERSION', '1.6.5');", "define('WCP_VERSION', '1.6.6');"],
    ];
    foreach ($swapPatches as $sp) { $patches[] = $sp; }
} else {
    foreach ($swapPatches as $sp) { $patches[] = $sp; }
}

if ($checkOnly) {
    echo "CHECK MODE (read-only, nothing written) — {$target}\n";
    echo "  WCP_VERSION: " . ($ver !== '' ? $ver : 'NOT FOUND') . ($ver !== '' ? "" : "  (unrecognized — patcher must be re-targeted)") . "\n";
    if ($ver === '1.6.5') { echo "  browser bootstrap (1.6.5): already applied — the swap set will be added\n"; }
    if ($ver === '1.6.6') { echo "  already 1.6.6 — nothing to do\n"; exit(0); }
    $ready = ($ver !== '');
    foreach ($patches as $i => $patch) {
        $count = substr_count($src, $patch[1]);
        if ($count !== 1) { $ready = false; $mark = 'PROBLEM'; } else { $mark = 'OK'; }
        printf("  anchor #%d: %-7s found %d time(s) — %s\n", $i + 1, $mark, $count, $patch[0]);
    }
    $smart = substr_count($src, 'pip-smart');
    echo "  'pip-smart' references in the console: {$smart}" . ($smart ? "  (a smart-installer is wired in; it hid the real pip errors in your deploy log)" : "") . "\n";
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
echo "WebConsole Pro is now 1.6.6 — the deploy button installs the full Python stack\n";
echo "and swap_2g/4g/8g/16g components are available (idempotent swapfile setup).\n";
echo "plus Playwright + Chromium automatically (official CDN, Iran mirrors, system\n";
echo "browser fallback). No service restart is needed for the console itself.\n";
