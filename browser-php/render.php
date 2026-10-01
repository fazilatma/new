<?php
/**
 * render.php — سرویس رندرِ جاوااسکریپتِ خالص‌PHP برای scraper4
 * =====================================================================
 * معادلِ browser/server.js ولی بدون Node/Python/Java:
 *
 *   موتور CDP («پلی‌رایت»):
 *     کرومیوم را با --remote-debugging-port اجرا می‌کنیم و خودمان با
 *     پروتکل WebSocket/CDP حرف می‌زنیم (cdp.php). این دقیقاً همان کاری
 *     است که Playwright پشت صحنه انجام می‌دهد.
 *
 *   موتور Selenium (جایگزین):
 *     باینریِ مستقلِ chromedriver (یک فایلِ بومی، بدون جاوا) را اجرا
 *     می‌کنیم و با پروتکل استاندارد W3C WebDriver روی HTTP کار می‌کنیم.
 *
 * اجرا:
 *   bash start.sh                    (wrapper که env را ست می‌کند)
 *   PHP_CLI_SERVER_WORKERS=3 php -S 127.0.0.1:3100 render.php
 *
 * API (سازگار با نسخهٔ Node — همان قراردادی که scraper4.php مصرف می‌کند):
 *   POST /render   {url, waitUntil, selector, timeout, scroll, blockResources}
 *                  Authorization: Bearer <RENDER_TOKEN>
 *   GET  /health   {ok, driver, available, active, max_concurrency, uptime_s}
 *
 * پیکربندی با env (نمونه: env.sample)
 * ==================================================================== */

error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('max_execution_time', '0');
ini_set('ignore_user_abort', '1');

require __DIR__ . '/cdp.php';

date_default_timezone_set(getenv('TZ') ?: 'Asia/Tehran');

/* ---------------------------------------------------------------- پیکربندی */
function rcfg(): array {
    static $c = null;
    if ($c !== null) return $c;
    $u = getenv('RENDER_USER_AGENT');
    $c = [
        'token'        => (string)(getenv('RENDER_TOKEN') ?: ''),
        'driver'       => strtolower((string)(getenv('RENDER_DRIVER') ?: 'auto')),
        'max_conc'     => max(1, min(8, (int)(getenv('RENDER_MAX_CONCURRENCY') ?: 3))),
        'nav_timeout'  => max(5000, min(120000, (int)(getenv('RENDER_NAV_TIMEOUT') ?: 45000))),
        'queue_wait'   => max(0, min(60000, (int)(getenv('RENDER_QUEUE_WAIT_MS') ?: 10000))),
        'headless'     => (getenv('RENDER_HEADLESS') ?: 'true') !== 'false',
        'selenium_url' => rtrim((string)(getenv('SELENIUM_URL') ?: ''), '/'),
        'chrome_bin'   => (string)(getenv('CHROME_BIN') ?: ''),
        'driver_bin'   => (string)(getenv('CHROMEDRIVER_BIN') ?: ''),
        'user_agent'   => $u !== false ? (string)$u : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    ];
    if (in_array($c['driver'], ['playwright', 'chrome', 'cdp'])) $c['driver'] = 'auto';
    return $c;
}

$__UPTIME = time();

/* ------------------------------------------------------------ ابزارها */
function jout($data, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=UTF-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR);
    exit;
}

function req_body(): array {
    $raw = file_get_contents('php://input');
    $j = json_decode((string)$raw, true);
    if (!is_array($j)) jout(['ok' => false, 'error' => 'invalid-json'], 400);
    return $j;
}

function check_auth(): void {
    $tok = rcfg()['token'];
    if ($tok === '') return;                    // بدون توکن — فقط لوک (راهنما هشدار می‌دهد)
    $hdr = (string)($_SERVER['HTTP_AUTHORIZATION'] ?? '');
    if (!preg_match('~^Bearer\s+(.+)$~i', $hdr, $m) || !hash_equals($tok, trim($m[1]))) {
        jout(['ok' => false, 'error' => 'unauthorized'], 401);
    }
}

function clamp_timeout_ms($ms): int {
    $ms = (int)$ms;
    if ($ms < 5000) $ms = 5000;
    if ($ms > 120000) $ms = 120000;
    return $ms;
}

/* ------------------------------------------------- سمافورِ اسلات (چندپروسه) */
function slot_acquire(int $max, int $queueWaitMs) {
    $dir = sys_get_temp_dir() . '/php-render-slots';
    if (!is_dir($dir)) @mkdir($dir, 0770, true);
    $deadline = microtime(true) + ($queueWaitMs / 1000);
    do {
        for ($i = 1; $i <= $max; $i++) {
            $f = fopen($dir . '/slot-' . $i . '.lock', 'c');
            if (!$f) continue;
            if (flock($f, LOCK_EX | LOCK_NB)) {
                return [$f, $i];
            }
            fclose($f);
        }
        if ($queueWaitMs <= 0) break;
        usleep(250000);
    } while (microtime(true) < $deadline);
    return null;
}

function slot_count(int $max): int {
    $dir = sys_get_temp_dir() . '/php-render-slots';
    $n = 0;
    for ($i = 1; $i <= $max; $i++) {
        $path = $dir . '/slot-' . $i . '.lock';
        $f = @fopen($path, 'c');
        if (!$f) continue;
        if (!flock($f, LOCK_EX | LOCK_NB)) $n++; else { flock($f, LOCK_UN); }
        fclose($f);
    }
    return $n;
}

/* ------------------------------------------------------- اجرای پروسه */
function proc_spawn(array $argv, string $logFile = '') {
    if (!function_exists('proc_open')) throw new Exception('proc_open disabled on this PHP');
    $cmd = implode(' ', array_map(function ($a) { return escapeshellarg($a); }, $argv));
    $des = [0 => ['file', '/dev/null', 'r'],
            1 => ['file', $logFile !== '' ? $logFile : '/dev/null', 'a'],
            2 => ['file', $logFile !== '' ? $logFile : '/dev/null', 'a']];
    $p = @proc_open($cmd, $des, $pipes);
    if (!is_resource($p)) throw new Exception('spawn failed: ' . $cmd);
    $st = proc_get_status($p);
    return [$p, (int)$st['pid']];
}

function proc_kill(int $pid, $proc): void {
    if ($pid > 0) {
        @exec('kill -TERM ' . $pid . ' 2>/dev/null');
        @exec('pkill -TERM -P ' . $pid . ' 2>/dev/null');
        usleep(300000);
        @exec('kill -KILL ' . $pid . ' 2>/dev/null');
        @exec('pkill -KILL -P ' . $pid . ' 2>/dev/null');
    }
    if (is_resource($proc)) @proc_close($proc);
}

function http_get(string $url, int $timeoutSec = 3) {
    if (!function_exists('curl_init')) return null;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => $timeoutSec,
        CURLOPT_TIMEOUT => $timeoutSec,
    ]);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($body === false || $code < 200 || $code >= 300) return null;
    return $body;
}

/* --------------------------------------------------- یافتن فایل‌ها */
function find_chrome_bin(): string {
    $env = rcfg()['chrome_bin'];
    if ($env !== '' && is_file($env)) return $env;
    $cands = [];
    foreach (glob(__DIR__ . '/bin/*/chrome') ?: [] as $p) $cands[] = $p;
    foreach (glob(__DIR__ . '/bin/*/chrome-headless-shell') ?: [] as $p) $cands[] = $p;
    foreach (['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome', 'msedge'] as $n) {
        $p = trim((string)@shell_exec('command -v ' . escapeshellarg($n) . ' 2>/dev/null'));
        if ($p !== '' && is_file($p)) $cands[] = $p;
    }
    foreach ($cands as $c) {
        if (is_file($c) && is_executable($c)) return $c;
    }
    return '';
}

function find_chromedriver_bin(): string {
    $env = rcfg()['driver_bin'];
    if ($env !== '' && is_file($env)) return $env;
    foreach (glob(__DIR__ . '/bin/*/chromedriver') ?: [] as $p) {
        if (is_file($p) && is_executable($p)) return $p;
    }
    $p = trim((string)@shell_exec('command -v chromedriver 2>/dev/null'));
    if ($p !== '' && is_file($p)) return $p;
    return '';
}

/* --------------------------------------------------------- موتور CDP */
function render_with_cdp(string $url, array $opts, int $timeoutMs): array {
    $c = rcfg();
    $chrome = find_chrome_bin();
    if ($chrome === '') throw new Exception('chromium binary not found (run bash browser-php/bootstrap.sh or set CHROME_BIN)');

    $dir = sys_get_temp_dir() . '/php-render-' . getmypid() . '-' . mt_rand(1000, 99999);
    @mkdir($dir, 0700, true);
    $log = $dir . '/chrome.log';
    $args = [$chrome,
        '--remote-debugging-port=0',
        '--user-data-dir=' . $dir,
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--disable-gpu', '--disable-extensions', '--disable-background-networking',
        '--no-first-run', '--no-default-browser-check', '--disable-sync',
        '--hide-scrollbars', '--mute-audio', '--window-size=1366,900',
        '--lang=fa-IR',
    ];
    if ($c['headless']) $args[] = '--headless=new';
    $args[] = '--user-agent=' . $c['user_agent'];
    $args[] = 'about:blank';

    [$proc, $pid] = proc_spawn($args, $log);
    try {
        // پورتِ CDP از فایل DevToolsActivePort خوانده می‌شود (بدون تداخل پورت)
        $port = 0;
        $wait = microtime(true) + 15;
        while (microtime(true) < $wait) {
            $f = $dir . '/DevToolsActivePort';
            if (is_file($f)) {
                $line = trim((string)file_get_contents($f));
                if (preg_match('/^\d+/', $line, $m)) { $port = (int)$m[0]; break; }
            }
            usleep(100000);
        }
        if ($port <= 0) throw new Exception('CDP port file never appeared (chromium failed to start — missing system libraries?)');

        $ver = http_get('http://127.0.0.1:' . $port . '/json/version', 5);
        if ($ver === null) throw new Exception('CDP endpoint not reachable on 127.0.0.1:' . $port);

        $targets = http_get('http://127.0.0.1:' . $port . '/json/list', 5);
        $list = $targets !== null ? json_decode($targets, true) : [];
        $page = null;
        if (is_array($list)) {
            foreach ($list as $t) {
                if (($t['type'] ?? '') === 'page' && !empty($t['webSocketDebuggerUrl'])) { $page = $t; break; }
            }
        }
        if ($page === null) throw new Exception('no debuggable page target found');

        $wsUrl = $page['webSocketDebuggerUrl'];
        if (!preg_match('~^ws://([^:/]+):(\d+)(/.*)$~', $wsUrl, $m)) throw new Exception('bad ws url: ' . $wsUrl);
        $ws = new CdpWs($m[1], (int)$m[2], $m[3], 15);
        try {
            $cdp = new CdpPage($ws);
            $cdp->cmd('Page.enable', [], 15);
            if (!empty($opts['blockResources'])) {
                $cdp->cmd('Network.enable', [], 15);
                $cdp->cmd('Network.setBlockedURLs', ['urls' => [
                    '*://*/*.png', '*://*/*.jpg', '*://*/*.jpeg', '*://*/*.gif',
                    '*://*/*.webp', '*://*/*.svg', '*://*/*.mp4', '*://*/*.webm',
                    '*://*/*.mp3', '*://*/*.css', '*://*/*.woff', '*://*/*.woff2', '*://*/*.ttf',
                ]], 15);
            }
            $waitUntil = (string)($opts['waitUntil'] ?? 'domcontentloaded');
            $timeoutSec = (int)ceil($timeoutMs / 1000);

            if ($waitUntil === 'networkidle') { try { $cdp->cmd('Network.enable', [], 15); } catch (Exception $e) {} }
            $cdp->cmd('Page.navigate', ['url' => $url], 20);

            if ($waitUntil === 'networkidle') {
                // پایانِ بار اصلی + گوش‌دادن به شبکه
                $cdp->waitReadyState('complete', $timeoutSec);
                $cdp->waitNetworkIdle(min(15, $timeoutSec), 600);
            } else {
                $cdp->waitReadyState($waitUntil === 'load' ? 'complete' : 'interactive', $timeoutSec);
            }

            if (!empty($opts['selector'])) {
                $sel = json_encode((string)$opts['selector']);
                $deadline = microtime(true) + min(10, $timeoutSec);
                $okSel = false;
                while (microtime(true) < $deadline) {
                    try { if ($cdp->eval('!!document.querySelector(' . $sel . ')', 10)) { $okSel = true; break; } } catch (Exception $e) {}
                    usleep(300000);
                }
            }
            if (!empty($opts['scroll'])) {
                for ($i = 0; $i < 8; $i++) {
                    try { $cdp->eval('window.scrollBy(0, window.innerHeight)', 10); } catch (Exception $e) {}
                    usleep(400000);
                }
                try { $cdp->eval('window.scrollTo(0, 0)', 10); } catch (Exception $e) {}
            }

            $html   = (string)($cdp->eval('document.documentElement.outerHTML', 30) ?? '');
            $furl   = (string)($cdp->eval('location.href', 10) ?? $url);
            $title  = (string)($cdp->eval('document.title', 10) ?? '');
            return ['url' => $furl !== '' ? $furl : $url, 'title' => $title, 'html' => $html, 'driver' => 'playwright(CDP-pure-PHP)'];
        } finally {
            $ws->close();
        }
    } finally {
        proc_kill($pid, $proc);
        @exec('rm -rf ' . escapeshellarg($dir) . ' 2>/dev/null');
    }
}

/* --------------------------------------------------- موتور Selenium */
function wd_http(string $method, string $url, array $body = null, int $timeoutSec = 30) {
    if (!function_exists('curl_init')) throw new Exception('php-curl not available');
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT => $timeoutSec,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json; charset=utf-8'],
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_SLASHES));
    $r = curl_exec($ch);
    $err = curl_error($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($r === false) throw new Exception('webdriver request failed: ' . $err);
    $j = json_decode($r, true);
    if (!is_array($j)) throw new Exception('webdriver bad response (HTTP ' . $code . ')');
    return $j;
}

function render_with_selenium(string $url, array $opts, int $timeoutMs): array {
    $c = rcfg();
    $base = $c['selenium_url'];
    $proc = null; $pid = 0;
    if ($base === '') {
        $dbin = find_chromedriver_bin();
        if ($dbin === '') throw new Exception('chromedriver not found (run bash browser-php/bootstrap.sh or set CHROMEDRIVER_BIN/SELENIUM_URL)');
        $port = 9515 + (getmypid() % 500);
        $log = sys_get_temp_dir() . '/php-render-wd-' . $port . '.log';
        for ($try = 0; $try < 20; $try++) {
            $port = 9515 + mt_rand(0, 800);
            [$proc, $pid] = proc_spawn([$dbin, '--port=' . $port], $log);
            usleep(400000);
            $st = proc_get_status($proc);
            if ($st['running']) break;
            proc_close($proc); $proc = null; $pid = 0;
        }
        if (!$proc) throw new Exception('could not start chromedriver on a free port');
        $base = 'http://127.0.0.1:' . $port;
    }
    try {
        $chrome = find_chrome_bin();
        $drvArgs = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1366,900'];
        if ($c['headless']) array_unshift($drvArgs, '--headless=new');
        $drvArgs[] = '--lang=fa-IR';
        $caps = ['browserName' => 'chrome', 'goog:chromeOptions' => ['args' => $drvArgs]];
        if ($chrome !== '') $caps['goog:chromeOptions']['binary'] = $chrome;
        $r = wd_http('POST', $base . '/session', ['capabilities' => ['alwaysMatch' => $caps]], 45);
        $sid = (string)($r['value']['sessionId'] ?? '');
        if ($sid === '') throw new Exception('webdriver session failed: ' . json_encode($r));
        try {
            wd_http('POST', "$base/session/$sid/url", ['url' => $url], (int)ceil($timeoutMs / 1000) + 10);
            $timeoutSec = (int)ceil($timeoutMs / 1000);
            $waitUntil = (string)($opts['waitUntil'] ?? 'domcontentloaded');
            $deadline = microtime(true) + $timeoutSec;
            while (true) {
                $st = (string)($wd = wd_http('POST', "$base/session/$sid/execute/sync", ['script' => 'return document.readyState', 'args' => []])['value'] ?? 'loading');
                $want = $waitUntil === 'load' || $waitUntil === 'networkidle' ? 'complete' : 'interactive';
                if ($st === 'complete' || ($want === 'interactive' && $st !== 'loading')) break;
                if (microtime(true) > $deadline) break;
                usleep(200000);
            }
            if ($waitUntil === 'networkidle') usleep(1500000);  // W3C شبکه‌ای دیق ندارد — آرام‌سازی تقریبی
            if (!empty($opts['selector'])) {
                $sel = json_encode((string)$opts['selector']);
                $d2 = microtime(true) + min(10, $timeoutSec);
                while (microtime(true) < $d2) {
                    $r2 = wd_http('POST', "$base/session/$sid/execute/sync", ['script' => 'return !!document.querySelector(' . $sel . ')', 'args' => []]);
                    if (!empty($r2['value'])) break;
                    usleep(300000);
                }
            }
            if (!empty($opts['scroll'])) {
                for ($i = 0; $i < 8; $i++) {
                    wd_http('POST', "$base/session/$sid/execute/sync", ['script' => 'window.scrollBy(0, window.innerHeight)', 'args' => []]);
                    usleep(400000);
                }
            }
            $html  = (string)(wd_http('POST', "$base/session/$sid/execute/sync", ['script' => 'return document.documentElement.outerHTML', 'args' => []], 45)['value'] ?? '');
            $furl  = (string)(wd_http('GET',  "$base/session/$sid/url",   null, 10)['value'] ?? $url);
            $title = (string)(wd_http('GET',  "$base/session/$sid/title", null, 10)['value'] ?? '');
            return ['url' => $furl !== '' ? $furl : $url, 'title' => $title, 'html' => $html, 'driver' => 'chromedriver(W3C-pure-PHP)'];
        } finally {
            try { wd_http('DELETE', "$base/session/$sid"); } catch (Exception $e) {}
        }
    } finally {
        if ($pid > 0 || $proc) proc_kill($pid, $proc);
        @unlink($log ?? '');
    }
}

/* -------------------------------------------------------------- روتر */
$path = parse_url((string)($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
$method = (string)($_SERVER['REQUEST_METHOD'] ?? 'GET');

if ($path === '/health' && $method === 'GET') {
    $driverAvail = ['cdp' => find_chrome_bin() !== '', 'selenium' => find_chromedriver_bin() !== '' || rcfg()['selenium_url'] !== ''];
    $driverName = 'unavailable';
    if (rcfg()['driver'] === 'selenium') $driverName = $driverAvail['selenium'] ? 'selenium' : 'unavailable';
    elseif ($driverAvail['cdp']) $driverName = 'playwright(CDP)';
    elseif ($driverAvail['selenium']) $driverName = 'selenium';
    jout([
        'ok' => true,
        'driver' => $driverName,
        'available' => $driverAvail,
        'active' => slot_count(rcfg()['max_conc']),
        'queued' => 0,
        'max_concurrency' => rcfg()['max_conc'],
        'uptime_s' => time() - $__UPTIME,
        'engine' => 'pure-php (no node/python/java)',
    ]);
}

if ($path === '/render' && $method === 'POST') {
    $t0 = microtime(true);
    check_auth();
    $b = req_body();
    $url = (string)($b['url'] ?? '');
    if (!preg_match('~^https?://~i', $url)) jout(['ok' => false, 'error' => 'invalid-url'], 400);

    $timeoutMs = clamp_timeout_ms($b['timeout'] ?? rcfg()['nav_timeout']);
    $opts = [
        'waitUntil' => (string)($b['waitUntil'] ?? 'domcontentloaded'),
        'selector'  => (string)($b['selector'] ?? ''),
        'scroll'    => !empty($b['scroll']),
        'blockResources' => !empty($b['blockResources']),
        'driver'    => in_array(strtolower((string)($b['driver'] ?? '')), ['playwright','selenium'], true)
            ? strtolower((string)$b['driver']) : '',
    ];
    if (!in_array($opts['waitUntil'], ['load', 'domcontentloaded', 'networkidle'], true)) $opts['waitUntil'] = 'domcontentloaded';

    $slot = slot_acquire(rcfg()['max_conc'], rcfg()['queue_wait']);
    if ($slot === null) {
        header('Retry-After: 3');
        jout(['ok' => false, 'error' => 'busy: all render slots occupied; retry shortly'], 503);
    }
    [$lock, $slotId] = $slot;
    try {
        set_time_limit((int)ceil($timeoutMs / 1000) + 60);

        $drivers = [];
        if ($opts['driver'] === 'selenium') $drivers = ['selenium'];
        elseif ($opts['driver'] === 'playwright') $drivers = ['cdp', 'selenium'];
        elseif (rcfg()['driver'] === 'selenium') $drivers = ['selenium'];
        else $drivers = rcfg()['driver'] === 'auto' ? ['cdp', 'selenium'] : ['cdp'];

        $lastErr = '';
        $result = null;
        foreach ($drivers as $d) {
            try {
                $result = $d === 'cdp' ? render_with_cdp($url, $opts, $timeoutMs)
                                       : render_with_selenium($url, $opts, $timeoutMs);
                break;
            } catch (Exception $e) {
                $lastErr = $d . ': ' . $e->getMessage();
            }
        }
        if ($result === null) {
            jout(['ok' => false, 'error' => 'render-error: ' . $lastErr], 502);
        }
        jout([
            'ok' => true,
            'code' => 200,
            'url' => $result['url'],
            'title' => $result['title'],
            'html' => $result['html'],
            'driver' => $result['driver'],
            'took_ms' => (int)round((microtime(true) - $t0) * 1000),
        ]);
    } catch (Throwable $e) {
        jout(['ok' => false, 'error' => 'render-error: ' . $e->getMessage()], 502);
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

jout(['ok' => false, 'error' => 'not-found', 'endpoints' => ['GET /health', 'POST /render']], 404);
