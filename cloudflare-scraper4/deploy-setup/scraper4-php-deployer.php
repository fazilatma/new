<?php
/*
 * Scraper4 PHP deployer (command runner + Node installer)
 * ======================================================
 * Version: 1.0.0
 *
 * WHAT THIS DOES
 * --------------
 * This single PHP file runs on shared hosting (where PHP can execute shell
 * commands as your cPanel user) and gives you a small web control panel:
 *
 *   1. Environment report: PHP/node/npm versions, disabled functions,
 *      app folder state, package version, node_modules state, disk space.
 *   2. NPM install runner: starts `npm install` inside your Node virtualenv
 *      as a BACKGROUND job (survives page close), with live log polling.
 *   3. Passenger restart: touches tmp/restart.txt.
 *   4. Health check: server-side GET of your app /health URL.
 *   5. Terminal: runs a shell command you type (working dir locked to your
 *      home/app folders), with timeout, output capture, and audit logging.
 *   6. Log viewer: tails the npm install log and the command audit log.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It does NOT transfer files: uploading the Passenger ZIP into `scraper4`
 * is the job of scraper4-passenger-install.php (use that first, then use
 * this deployer for npm install / restart / verify). It does NOT create the
 * cPanel Node.js app or set its environment variables either.
 *
 * HOW TO USE
 * ----------
 * 1. Deploy files first with scraper4-passenger-install.php.
 * 2. Edit DEPLOYER TOKEN below to a long random value.
 * 3. Check the three path constants below (app folder, nodevenv activate
 *    script, app URL). They are prefilled for this host; fix if yours differ.
 * 4. Upload ONLY this PHP file to public_html under an unpredictable name,
 *    for example: public_html/scraper4-ops-7h2k9q.php
 * 5. Open it over HTTPS, enter the token, press: Environment, then
 *    Start NPM install, poll status until done, Restart app, Health check.
 * 6. DELETE this file immediately after you finish.
 *
 * SECURITY
 * --------
 * - Refuses to run until DEPLOYER TOKEN is changed (min 24 chars).
 * - Token login + session + CSRF + login rate limiting.
 * - Terminal working directory is locked to home/app folders only.
 * - Catastrophic command patterns are blocked (root rm, fork bombs, mkfs,
 *   dd to devices, shutdown/reboot).
 * - Every terminal command is audit-logged OUTSIDE public_html.
 * - Timeouts and output caps on every executed command.
 * - This file is a loaded tool: delete it right after use.
 */

declare(strict_types=1);

if (PHP_SAPI === 'cli') {
    fwrite(STDERR, "This deployer is web-only. Open it in a browser over HTTPS.\n");
    exit(2);
}

/* ------------------------------- configuration ------------------------------- */

const S4D_VERSION = '1.0.0';
const S4D_APP_DIRNAME = 'scraper4';

/* REQUIRED: change this before uploading. The deployer refuses to run otherwise. */
const S4D_TOKEN = 'CHANGE-THIS-TO-A-LONG-RANDOM-TOKEN';

/* Prefilled for this host. Empty string = auto-detect. */
const S4D_APP_ROOT_OVERRIDE = '/home/sabashop/scraper4';
const S4D_NODEVENV_OVERRIDE = '/home/sabashop/nodevenv/scraper4/22/bin/activate';
const S4D_APP_URL = 'https://sabashopping.ir/scraper';

const S4D_FG_TIMEOUT = 90; /* seconds for foreground terminal commands */
const S4D_PROBE_TIMEOUT = 20; /* seconds for quick probes (node -v etc.) */
const S4D_MAX_OUTPUT = 262144; /* 256 KB output cap per command */
const S4D_MAX_CMD_LEN = 2000;
const S4D_LOG_TAIL_LINES = 80;

/* --------------------------------- utilities --------------------------------- */

function s4d_h($value)
{
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
}

function s4d_starts_with($haystack, $needle)
{
    $haystack = (string) $haystack;
    $needle = (string) $needle;
    return $needle !== '' && strncmp($haystack, $needle, strlen($needle)) === 0;
}

function s4d_format_bytes($bytes)
{
    $bytes = (float) $bytes;
    if ($bytes < 1024) {
        return (string) ((int) $bytes) . ' B';
    }
    $units = array('KB', 'MB', 'GB', 'TB');
    $value = $bytes / 1024;
    foreach ($units as $unit) {
        if ($value < 1024 || $unit === 'TB') {
            return number_format($value, 1) . ' ' . $unit;
        }
        $value = $value / 1024;
    }
    return (string) ((int) $bytes) . ' B';
}

function s4d_token_configured()
{
    $token = (string) S4D_TOKEN;
    return $token !== '' && $token !== 'CHANGE-THIS-TO-A-LONG-RANDOM-TOKEN' && strlen($token) >= 24;
}

function s4d_auth_ok($provided)
{
    if (!s4d_token_configured()) {
        return false;
    }
    $provided = (string) $provided;
    if ($provided === '') {
        return false;
    }
    return hash_equals((string) S4D_TOKEN, $provided);
}

function s4d_join_path($base, $rel)
{
    return rtrim((string) $base, '/') . '/' . ltrim((string) $rel, '/');
}

/* ------------------------------- path resolving ------------------------------ */

function s4d_resolve_app_root()
{
    $override = trim((string) S4D_APP_ROOT_OVERRIDE);
    if ($override !== '') {
        return $override;
    }
    $home = trim((string) getenv('HOME'));
    if ($home !== '') {
        $candidate = rtrim($home, '/') . '/' . S4D_APP_DIRNAME;
        if (is_dir($candidate)) {
            return $candidate;
        }
    }
    $here = __DIR__;
    if (basename($here) === 'public_html') {
        return dirname($here) . '/' . S4D_APP_DIRNAME;
    }
    if ($home !== '') {
        return rtrim($home, '/') . '/' . S4D_APP_DIRNAME;
    }
    return $here . '/' . S4D_APP_DIRNAME;
}

function s4d_home_dir($appRoot)
{
    $home = trim((string) getenv('HOME'));
    if ($home !== '' && is_dir($home)) {
        return $home;
    }
    return dirname(rtrim((string) $appRoot, '/'));
}

function s4d_find_nodevenv($appRoot)
{
    $override = trim((string) S4D_NODEVENV_OVERRIDE);
    if ($override !== '' && is_file($override)) {
        return $override;
    }
    $home = s4d_home_dir($appRoot);
    $cands = glob(rtrim($home, '/') . '/nodevenv/' . S4D_APP_DIRNAME . '/*/bin/activate');
    if (is_array($cands) && count($cands) > 0) {
        sort($cands);
        return $cands[count($cands) - 1];
    }
    return '';
}

function s4d_ops_dir($appRoot)
{
    return s4d_join_path($appRoot, '_deployer');
}

function s4d_mkdir($path, $mode = 0755)
{
    if (is_dir($path)) {
        return true;
    }
    if (!mkdir($path, $mode, true) && !is_dir($path)) {
        return false;
    }
    @chmod($path, $mode);
    return true;
}

/* ------------------------------ shell execution ------------------------------ */

function s4d_disabled_functions()
{
    $raw = (string) ini_get('disable_functions');
    $list = array();
    foreach (explode(',', $raw) as $name) {
        $name = trim($name);
        if ($name !== '') {
            $list[] = $name;
        }
    }
    return $list;
}

function s4d_fn_usable($name)
{
    if (!function_exists($name)) {
        return false;
    }
    return !in_array($name, s4d_disabled_functions(), true);
}

function s4d_which($bin)
{
    if (!s4d_fn_usable('exec')) {
        return '';
    }
    $out = array();
    @exec('command -v ' . escapeshellarg($bin) . ' 2>/dev/null', $out);
    return isset($out[0]) ? trim((string) $out[0]) : '';
}

/* Run a command in the foreground with a hard timeout. Returns array with
 * ok, stdout, stderr, exit, timed_out, seconds, error. */
function s4d_run_foreground($script, $cwd, $timeoutSec)
{
    $result = array('ok' => false, 'stdout' => '', 'stderr' => '', 'exit' => -1, 'timed_out' => false, 'seconds' => 0.0, 'error' => '');
    $timeoutSec = max(5, min(300, (int) $timeoutSec));
    if (!is_dir($cwd)) {
        $result['error'] = 'Working directory does not exist: ' . $cwd;
        return $result;
    }
    if (!s4d_fn_usable('proc_open')) {
        if (s4d_fn_usable('exec') && s4d_which('timeout') !== '') {
            $cmd = 'cd ' . escapeshellarg($cwd) . ' && timeout ' . $timeoutSec . 's bash -c ' . escapeshellarg($script) . ' 2>&1';
            $lines = array();
            $code = 0;
            $start = microtime(true);
            @exec($cmd, $lines, $code);
            $joined = implode("\n", $lines);
            if (strlen($joined) > S4D_MAX_OUTPUT) {
                $joined = substr($joined, 0, S4D_MAX_OUTPUT);
            }
            $result['ok'] = true;
            $result['stdout'] = $joined;
            $result['exit'] = $code;
            $result['timed_out'] = ($code === 124);
            $result['seconds'] = round(microtime(true) - $start, 1);
            return $result;
        }
        $result['error'] = 'No process functions available (proc_open and exec are disabled). Ask the host to enable proc_open/exec, or use cPanel Terminal instead.';
        return $result;
    }
    $descriptors = array(
        0 => array('pipe', 'r'),
        1 => array('pipe', 'w'),
        2 => array('pipe', 'w'),
    );
    $start = microtime(true);
    $proc = @proc_open('bash -c ' . escapeshellarg($script), $descriptors, $pipes, $cwd, null);
    if (!is_resource($proc)) {
        $result['error'] = 'Could not start the process.';
        return $result;
    }
    fclose($pipes[0]);
    stream_set_blocking($pipes[1], false);
    stream_set_blocking($pipes[2], false);
    $out = '';
    $err = '';
    $exit = -1;
    $deadline = $start + $timeoutSec;
    while (true) {
        $status = proc_get_status($proc);
        if (!$status['running']) {
            $rest1 = stream_get_contents($pipes[1]);
            $rest2 = stream_get_contents($pipes[2]);
            if (is_string($rest1) && strlen($out) < S4D_MAX_OUTPUT) {
                $out .= substr($rest1, 0, S4D_MAX_OUTPUT - strlen($out));
            }
            if (is_string($rest2) && strlen($err) < S4D_MAX_OUTPUT) {
                $err .= substr($rest2, 0, S4D_MAX_OUTPUT - strlen($err));
            }
            $exit = (int) $status['exitcode'];
            break;
        }
        if (microtime(true) >= $deadline) {
            $result['timed_out'] = true;
            @proc_terminate($proc, 9);
            usleep(200000);
            $st2 = proc_get_status($proc);
            if ($st2['running'] && isset($st2['pid']) && s4d_fn_usable('exec')) {
                @exec('kill -9 ' . (int) $st2['pid'] . ' 2>/dev/null');
            }
            $rest1 = stream_get_contents($pipes[1]);
            $rest2 = stream_get_contents($pipes[2]);
            if (is_string($rest1) && strlen($out) < S4D_MAX_OUTPUT) {
                $out .= substr($rest1, 0, S4D_MAX_OUTPUT - strlen($out));
            }
            if (is_string($rest2) && strlen($err) < S4D_MAX_OUTPUT) {
                $err .= substr($rest2, 0, S4D_MAX_OUTPUT - strlen($err));
            }
            $exit = -1;
            break;
        }
        $read = array($pipes[1], $pipes[2]);
        $write = null;
        $except = null;
        $n = @stream_select($read, $write, $except, 1, 0);
        if ($n === false) {
            break;
        }
        foreach ($read as $r) {
            $chunk = fread($r, 8192);
            if (!is_string($chunk) || $chunk === '') {
                continue;
            }
            if ($r === $pipes[1]) {
                if (strlen($out) < S4D_MAX_OUTPUT) {
                    $out .= substr($chunk, 0, S4D_MAX_OUTPUT - strlen($out));
                }
            } else {
                if (strlen($err) < S4D_MAX_OUTPUT) {
                    $err .= substr($chunk, 0, S4D_MAX_OUTPUT - strlen($err));
                }
            }
        }
    }
    fclose($pipes[1]);
    fclose($pipes[2]);
    @proc_close($proc);
    $result['ok'] = true;
    $result['stdout'] = $out;
    $result['stderr'] = $err;
    $result['exit'] = $exit;
    $result['seconds'] = round(microtime(true) - $start, 1);
    return $result;
}

/* Start a detached background job; returns array(ok, pid|error). */
function s4d_start_background($script, $logFile, $pidFile)
{
    if (!s4d_fn_usable('exec')) {
        return array(false, 'exec() is disabled, so background jobs cannot start. Use cPanel Terminal instead.');
    }
    if (!s4d_mkdir(dirname($logFile), 0755)) {
        return array(false, 'Could not create the ops folder.');
    }
    @unlink($pidFile);
    $cmd = 'nohup bash -c ' . escapeshellarg($script) . ' > ' . escapeshellarg($logFile) . ' 2>&1 & echo $!';
    $out = array();
    @exec($cmd, $out);
    $pid = 0;
    if (count($out) > 0) {
        $pid = (int) trim((string) $out[count($out) - 1]);
    }
    if ($pid <= 0) {
        return array(false, 'Could not start the background job.');
    }
    file_put_contents($pidFile, (string) $pid);
    @chmod($pidFile, 0644);
    @chmod($logFile, 0644);
    return array(true, $pid);
}

function s4d_pid_alive($pid)
{
    $pid = (int) $pid;
    if ($pid <= 0) {
        return false;
    }
    if (function_exists('posix_kill')) {
        $alive = @posix_kill($pid, 0);
        if ($alive) {
            return true;
        }
        /* posix_kill returns false both for dead processes and on permission
         * errors; fall through to /proc and ps checks. */
    }
    if (is_file('/proc/' . $pid)) {
        return true;
    }
    if (s4d_fn_usable('exec')) {
        $o = array();
        @exec('ps -p ' . $pid . ' -o pid= 2>/dev/null', $o);
        foreach ($o as $line) {
            if ((int) trim((string) $line) === $pid) {
                return true;
            }
        }
    }
    return false;
}

function s4d_tail($file, $maxLines, $maxBytes = 131072)
{
    if (!is_file($file)) {
        return '';
    }
    $size = filesize($file);
    if ($size === false || $size <= 0) {
        return '';
    }
    $fh = fopen($file, 'rb');
    if ($fh === false) {
        return '';
    }
    $len = min($size, $maxBytes);
    fseek($fh, $size - $len);
    $data = stream_get_contents($fh);
    fclose($fh);
    $lines = explode("\n", (string) $data);
    if (count($lines) > $maxLines) {
        $lines = array_slice($lines, -$maxLines);
    }
    return implode("\n", $lines);
}

function s4d_append_cmdlog($appRoot, $line)
{
    $dir = s4d_ops_dir($appRoot);
    if (!s4d_mkdir($dir, 0755)) {
        return;
    }
    @file_put_contents($dir . '/commands.log', '[' . date('Y-m-d H:i:s') . '] ' . $line . "\n", FILE_APPEND);
}

/* --------------------------- terminal safety rules --------------------------- */

function s4d_denied_reason($cmd)
{
    if (strpos($cmd, "\0") !== false) {
        return 'Null bytes are not allowed.';
    }
    $lower = strtolower($cmd);
    $bad = array(
        ':(){' => 'fork bomb pattern',
        'mkfs' => 'filesystem formatting',
        'shutdown' => 'shutdown command',
        'reboot' => 'reboot command',
        'poweroff' => 'poweroff command',
        'halt' => 'halt command',
        'init 0' => 'runlevel change',
        'init 6' => 'runlevel change',
        'dd of=/dev' => 'raw disk write',
        'dd if=/dev/zero of=/dev' => 'raw disk wipe',
        'chmod -r 777 /' => 'recursive root chmod',
        'chown -r ' => 'recursive chown (too broad for this tool)',
    );
    foreach ($bad as $needle => $why) {
        if (strpos($lower, $needle) !== false) {
            return 'Blocked (' . $why . '): ' . $needle;
        }
    }
    if (preg_match('/\brm\s+[^;|&]*\s\/(\s|$|;)/', $cmd)) {
        return 'Refusing rm against the filesystem root.';
    }
    if (preg_match('/\/dev\/[sh]d[a-z]/', $cmd)) {
        return 'Refusing direct disk device access.';
    }
    return '';
}

/* --------------------------------- http probe -------------------------------- */

function s4d_http_get($url)
{
    $result = array('ok' => false, 'code' => 0, 'body' => '', 'error' => '');
    $url = trim((string) $url);
    if ($url === '' || filter_var($url, FILTER_VALIDATE_URL) === false) {
        $result['error'] = 'Health URL is invalid.';
        return $result;
    }
    $parts = parse_url($url);
    if (!is_array($parts)) {
        $result['error'] = 'Health URL is invalid.';
        return $result;
    }
    $scheme = isset($parts['scheme']) ? strtolower($parts['scheme']) : '';
    if ($scheme !== 'http' && $scheme !== 'https') {
        $result['error'] = 'Only http:// and https:// URLs are allowed.';
        return $result;
    }
    if (isset($parts['user']) || isset($parts['pass'])) {
        $result['error'] = 'URLs with embedded credentials are not allowed.';
        return $result;
    }
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        if ($ch === false) {
            $result['error'] = 'Could not start the request.';
            return $result;
        }
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_MAXREDIRS, 3);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
        curl_setopt($ch, CURLOPT_TIMEOUT, 20);
        curl_setopt($ch, CURLOPT_USERAGENT, 'scraper4-php-deployer/' . S4D_VERSION);
        $body = curl_exec($ch);
        $err = curl_error($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if ($body === false) {
            $result['error'] = 'Request failed: ' . ($err !== '' ? $err : 'HTTP ' . $code);
            return $result;
        }
        $result['ok'] = true;
        $result['code'] = $code;
        $result['body'] = (string) $body;
        return $result;
    }
    if ((bool) ini_get('allow_url_fopen')) {
        $ctx = stream_context_create(array('http' => array('timeout' => 20, 'max_redirects' => 3)));
        $body = @file_get_contents($url, false, $ctx);
        if ($body === false) {
            $result['error'] = 'Request failed.';
            return $result;
        }
        $result['ok'] = true;
        $result['code'] = 0;
        $result['body'] = (string) $body;
        return $result;
    }
    $result['error'] = 'No HTTP transport available (need cURL or allow_url_fopen).';
    return $result;
}

/* ------------------------------ web authentication --------------------------- */

function s4d_boot()
{
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    if (session_status() !== PHP_SESSION_ACTIVE) {
        $secure = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== '' && $_SERVER['HTTPS'] !== 'off';
        session_set_cookie_params(array(
            'lifetime' => 0,
            'path' => '/',
            'secure' => $secure,
            'httponly' => true,
            'samesite' => 'Lax',
        ));
        session_start();
    }
}

function s4d_csrf_token()
{
    if (!isset($_SESSION['s4d_csrf']) || strlen((string) $_SESSION['s4d_csrf']) < 32) {
        $_SESSION['s4d_csrf'] = bin2hex(random_bytes(32));
    }
    return (string) $_SESSION['s4d_csrf'];
}

function s4d_csrf_ok()
{
    return isset($_POST['csrf'], $_SESSION['s4d_csrf']) && hash_equals((string) $_SESSION['s4d_csrf'], (string) $_POST['csrf']);
}

function s4d_is_authed()
{
    return isset($_SESSION['s4d_auth']) && $_SESSION['s4d_auth'] === true;
}

function s4d_login_blocked()
{
    if (!isset($_SESSION['s4d_attempts']) || !is_array($_SESSION['s4d_attempts'])) {
        $_SESSION['s4d_attempts'] = array('count' => 0, 'until' => 0);
    }
    return $_SESSION['s4d_attempts']['until'] > time();
}

function s4d_note_login_failure()
{
    if (!isset($_SESSION['s4d_attempts']) || !is_array($_SESSION['s4d_attempts'])) {
        $_SESSION['s4d_attempts'] = array('count' => 0, 'until' => 0);
    }
    $_SESSION['s4d_attempts']['count'] = (int) $_SESSION['s4d_attempts']['count'] + 1;
    if ($_SESSION['s4d_attempts']['count'] >= 10) {
        $_SESSION['s4d_attempts']['until'] = time() + 300;
        $_SESSION['s4d_attempts']['count'] = 0;
    }
}

/* --------------------------------- web pages --------------------------------- */

function s4d_page_head($title)
{
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<title>' . s4d_h($title) . '</title>'
        . '<style>'
        . 'body{margin:0;background:#0b1220;color:#e5e7eb;font:15px/1.6 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}'
        . 'main{max-width:920px;margin:24px auto;padding:0 16px 48px}'
        . '.card{background:#111c33;border:1px solid #274067;border-radius:14px;padding:18px;margin:14px 0}'
        . 'h1{font-size:22px;margin:0 0 6px}h2{font-size:17px;margin:0 0 8px}'
        . 'label{display:block;margin:10px 0 4px;color:#bfdbfe}'
        . 'input[type=text],input[type=password],select,textarea{width:100%;box-sizing:border-box;background:#020617;color:#e5e7eb;border:1px solid #334155;border-radius:10px;padding:10px;font:14px/1.5 ui-monospace,Consolas,monospace}'
        . 'textarea{min-height:70px}'
        . '.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}'
        . 'button{background:#15803d;color:#fff;border:0;border-radius:10px;padding:11px 14px;font-size:15px;margin:10px 8px 0 0;cursor:pointer}'
        . 'button.secondary{background:#334155}button.danger{background:#b91c1c}button.warnbtn{background:#b45309}'
        . 'pre{background:#020617;border:1px solid #1e293b;border-radius:10px;padding:12px;white-space:pre-wrap;word-break:break-word;font-size:13px}'
        . '.ok{color:#86efac}.bad{color:#fca5a5}.warn{color:#fde68a}.muted{color:#94a3b8}'
        . 'table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #243349;padding:8px;text-align:left;vertical-align:top}'
        . 'a{color:#93c5fd}'
        . '.checkline{margin:2px 0}'
        . '</style></head><body><main>';
}

function s4d_page_foot()
{
    echo '</main></body></html>';
}

function s4d_env_probes($appRoot, $nodevenv)
{
    $rows = array();
    $rows[] = array('App folder', is_dir($appRoot) ? 'OK' : 'MISSING', $appRoot, is_dir($appRoot));
    $rows[] = array('Node virtualenv', $nodevenv !== '' ? 'OK' : 'MISSING', $nodevenv !== '' ? $nodevenv : 'activate script not found', $nodevenv !== '');
    $canProc = s4d_fn_usable('proc_open');
    $canExec = s4d_fn_usable('exec');
    $rows[] = array('Shell execution', ($canProc || $canExec) ? 'OK' : 'BLOCKED', 'proc_open=' . ($canProc ? 'yes' : 'no') . ' exec=' . ($canExec ? 'yes' : 'no'), ($canProc || $canExec));
    if ($nodevenv !== '' && ($canProc || $canExec) && is_dir($appRoot)) {
        $probe = s4d_run_foreground('source ' . escapeshellarg($nodevenv) . ' && node -v && npm -v', $appRoot, S4D_PROBE_TIMEOUT);
        if ($probe['ok'] && $probe['exit'] === 0) {
            $rows[] = array('node / npm', 'OK', trim(str_replace("\n", ' / ', trim($probe['stdout']))), true);
        } else {
            $rows[] = array('node / npm', 'FAIL', $probe['error'] !== '' ? $probe['error'] : trim($probe['stderr'] . "\n" . $probe['stdout']), false);
        }
    } else {
        $rows[] = array('node / npm', 'SKIPPED', 'Needs nodevenv + shell execution.', false);
    }
    $pkgVer = 'unknown';
    $pkgRaw = @file_get_contents(s4d_join_path($appRoot, 'package.json'));
    if (is_string($pkgRaw)) {
        $pkg = json_decode($pkgRaw, true);
        if (is_array($pkg) && isset($pkg['version'])) {
            $pkgVer = (string) $pkg['version'];
        }
    }
    $rows[] = array('package.json', $pkgVer !== 'unknown' ? 'OK' : 'MISSING', 'version ' . $pkgVer, $pkgVer !== 'unknown');
    $need = array('app.js', 'render-dist/server.js', 'render-dist/cron.js', 'scripts/basalam-sdk-bridge.py');
    $missing = array();
    foreach ($need as $rel) {
        if (!is_file(s4d_join_path($appRoot, $rel))) {
            $missing[] = $rel;
        }
    }
    $rows[] = array('Deploy files', count($missing) === 0 ? 'OK' : 'MISSING', count($missing) === 0 ? 'app.js + render-dist + bridge present' : ('missing: ' . implode(', ', $missing)), count($missing) === 0);
    $rows[] = array('node_modules', is_dir(s4d_join_path($appRoot, 'node_modules')) ? 'OK' : 'EMPTY', is_dir(s4d_join_path($appRoot, 'node_modules')) ? 'Dependencies installed.' : 'Not installed yet: run Start NPM install.', is_dir(s4d_join_path($appRoot, 'node_modules')));
    $dataDir = s4d_join_path($appRoot, 'data');
    $rows[] = array('data/', (is_dir($dataDir) && is_writable($dataDir)) ? 'OK' : 'CHECK', $dataDir, (is_dir($dataDir) && is_writable($dataDir)));
    $free = is_dir($appRoot) ? @disk_free_space($appRoot) : @disk_free_space(__DIR__);
    $rows[] = array('Disk free', 'INFO', $free === false ? 'unknown' : s4d_format_bytes($free), true);
    $pidFile = s4d_ops_dir($appRoot) . '/npm-install.pid';
    $npmPid = is_file($pidFile) ? (int) trim((string) file_get_contents($pidFile)) : 0;
    $running = $npmPid > 0 && s4d_pid_alive($npmPid);
    $rows[] = array('NPM job', $running ? 'RUNNING' : 'IDLE', $running ? ('PID ' . $npmPid) : 'no background install running', true);
    return $rows;
}

function s4d_main()
{
    s4d_boot();
    $appRoot = s4d_resolve_app_root();
    $homeDir = s4d_home_dir($appRoot);
    $nodevenv = s4d_find_nodevenv($appRoot);
    $action = isset($_POST['action']) ? (string) $_POST['action'] : (isset($_GET['action']) ? (string) $_GET['action'] : 'status');

    if ($action === 'logout') {
        $_SESSION = array();
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_destroy();
        }
        header('Location: ' . $_SERVER['PHP_SELF']);
        exit(0);
    }

    s4d_page_head('Scraper4 PHP deployer');
    echo '<h1>Scraper4 PHP deployer</h1>';
    echo '<p class="muted">Deployer ' . s4d_h(S4D_VERSION) . ' | App: ' . s4d_h($appRoot) . '</p>';

    if (!s4d_token_configured()) {
        echo '<div class="card"><h2>Setup required</h2><p class="bad">The deployer token is still the placeholder. '
            . 'Edit S4D_TOKEN in this PHP file, re-upload it, and reload.</p></div>';
        s4d_page_foot();
        return;
    }

    if (!s4d_is_authed()) {
        $error = '';
        if ($action === 'login' && $_SERVER['REQUEST_METHOD'] === 'POST') {
            if (s4d_login_blocked()) {
                $error = 'Too many attempts. Wait five minutes and try again.';
            } elseif (s4d_auth_ok(isset($_POST['token']) ? $_POST['token'] : '')) {
                session_regenerate_id(true);
                $_SESSION['s4d_auth'] = true;
                $_SESSION['s4d_attempts'] = array('count' => 0, 'until' => 0);
                header('Location: ' . $_SERVER['PHP_SELF']);
                exit(0);
            } else {
                s4d_note_login_failure();
                $error = 'Wrong token.';
            }
        }
        echo '<div class="card"><h2>Login</h2>';
        if ($error !== '') {
            echo '<p class="bad">' . s4d_h($error) . '</p>';
        }
        echo '<form method="post" action="">'
            . '<input type="hidden" name="action" value="login">'
            . '<label>Deployer token</label>'
            . '<input type="password" name="token" autocomplete="off" required>'
            . '<div><button type="submit">Unlock deployer</button></div>'
            . '</form><p class="muted">Delete this deployer immediately after you finish.</p></div>';
        s4d_page_foot();
        return;
    }

    $notices = array(); /* each: array(ok, text) */
    $blocks = ''; /* extra HTML (pre blocks) appended after notices */
    $healthUrlDefault = (string) S4D_APP_URL;
    if ($healthUrlDefault === '' && isset($_SESSION['s4d_health_url'])) {
        $healthUrlDefault = (string) $_SESSION['s4d_health_url'];
    }
    if ($healthUrlDefault !== '' && substr($healthUrlDefault, -7) !== '/health') {
        $healthUrlDefault = rtrim($healthUrlDefault, '/') . '/health';
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST' && $action !== '') {
        if (!s4d_csrf_ok()) {
            $notices[] = array(false, 'Security token expired. Reload and try again.');
        } elseif ($action === 'npm_install') {
            $opsDir = s4d_ops_dir($appRoot);
            $pidFile = $opsDir . '/npm-install.pid';
            $logFile = $opsDir . '/npm-install.log';
            $oldPid = is_file($pidFile) ? (int) trim((string) file_get_contents($pidFile)) : 0;
            if ($oldPid > 0 && s4d_pid_alive($oldPid)) {
                $notices[] = array(false, 'An NPM install is already running (PID ' . $oldPid . '). Wait for it or check status below.');
            } elseif ($nodevenv === '') {
                $notices[] = array(false, 'Node virtualenv activate script not found. Fix S4D_NODEVENV_OVERRIDE.');
            } elseif (!is_dir($appRoot)) {
                $notices[] = array(false, 'App folder does not exist: ' . $appRoot);
            } else {
                $script = 'export HOME=' . escapeshellarg($homeDir)
                    . ' && export NPM_CONFIG_CACHE=' . escapeshellarg($homeDir . '/.npm')
                    . ' && source ' . escapeshellarg($nodevenv)
                    . ' && cd ' . escapeshellarg($appRoot)
                    . ' && npm install --omit=dev --no-audit --no-fund';
                list($started, $info) = s4d_start_background($script, $logFile, $pidFile);
                if ($started) {
                    s4d_append_cmdlog($appRoot, 'npm_install started pid=' . $info);
                    $notices[] = array(true, 'NPM install started in the background (PID ' . $info . '). It keeps running if you close this page. Press NPM status to poll.');
                } else {
                    $notices[] = array(false, $info);
                }
            }
        } elseif ($action === 'npm_status') {
            $opsDir = s4d_ops_dir($appRoot);
            $pidFile = $opsDir . '/npm-install.pid';
            $logFile = $opsDir . '/npm-install.log';
            $pid = is_file($pidFile) ? (int) trim((string) file_get_contents($pidFile)) : 0;
            $running = $pid > 0 && s4d_pid_alive($pid);
            if ($running) {
                $notices[] = array(true, 'NPM install is still running (PID ' . $pid . '). Refresh status again in a minute.');
            } elseif ($pid > 0) {
                $notices[] = array(true, 'NPM install process ended (was PID ' . $pid . '). Check the log tail below for success or errors.');
                @unlink($pidFile);
            } else {
                $notices[] = array(true, 'No NPM install is running.');
            }
            $tail = s4d_tail($logFile, S4D_LOG_TAIL_LINES);
            $blocks .= '<div class="card"><h2>NPM install log</h2><pre>' . s4d_h($tail !== '' ? $tail : '(empty or missing: ' . $logFile . ')') . '</pre></div>';
        } elseif ($action === 'restart') {
            $tmpDir = s4d_join_path($appRoot, 'tmp');
            if (!s4d_mkdir($tmpDir, 0755)) {
                $notices[] = array(false, 'Could not create tmp folder: ' . $tmpDir);
            } else {
                $marker = $tmpDir . '/restart.txt';
                if (@touch($marker)) {
                    s4d_append_cmdlog($appRoot, 'restart marker touched');
                    $notices[] = array(true, 'Passenger restart requested (touched tmp/restart.txt). Give it 30-60 seconds, then run the health check.');
                } else {
                    $notices[] = array(false, 'Could not touch tmp/restart.txt. Use the Restart button in Setup Node.js App.');
                }
            }
        } elseif ($action === 'health') {
            $url = isset($_POST['health_url']) ? trim((string) $_POST['health_url']) : '';
            if ($url === '') {
                $url = $healthUrlDefault;
            }
            $_SESSION['s4d_health_url'] = $url;
            $healthUrlDefault = $url;
            $res = s4d_http_get($url);
            if (!$res['ok']) {
                $notices[] = array(false, 'Health check failed: ' . $res['error']);
            } else {
                $body = $res['body'];
                if (strlen($body) > 2000) {
                    $body = substr($body, 0, 2000) . "\n...[truncated]...";
                }
                $ok = $res['code'] >= 200 && $res['code'] < 300;
                $notices[] = array($ok, 'Health check HTTP ' . $res['code'] . ' for ' . $url);
                $blocks .= '<div class="card"><h2>Health response</h2><pre>' . s4d_h($body) . '</pre></div>';
            }
        } elseif ($action === 'terminal') {
            $cmd = isset($_POST['cmd']) ? (string) $_POST['cmd'] : '';
            $cmd = trim(str_replace("\r", '', $cmd));
            $cwdChoice = isset($_POST['cwd']) ? (string) $_POST['cwd'] : 'app';
            $useVenv = isset($_POST['use_venv']) && ((string) $_POST['use_venv'] === '1' || (string) $_POST['use_venv'] === 'on');
            $cwd = ($cwdChoice === 'home') ? $homeDir : $appRoot;
            if ($cmd === '') {
                $notices[] = array(false, 'Command is empty.');
            } elseif (strlen($cmd) > S4D_MAX_CMD_LEN) {
                $notices[] = array(false, 'Command is too long (max ' . S4D_MAX_CMD_LEN . ' chars).');
            } elseif (($reason = s4d_denied_reason($cmd)) !== '') {
                s4d_append_cmdlog($appRoot, 'terminal BLOCKED: ' . substr($cmd, 0, 200));
                $notices[] = array(false, $reason);
            } elseif (!is_dir($cwd)) {
                $notices[] = array(false, 'Working directory does not exist: ' . $cwd);
            } else {
                $script = $cmd;
                if ($useVenv) {
                    if ($nodevenv === '') {
                        $notices[] = array(false, 'Node virtualenv not found; uncheck the virtualenv box or fix S4D_NODEVENV_OVERRIDE.');
                        $script = '';
                    } else {
                        $cwd = $appRoot;
                        $script = 'export HOME=' . escapeshellarg($homeDir) . ' && source ' . escapeshellarg($nodevenv) . ' && cd ' . escapeshellarg($appRoot) . ' && ' . $cmd;
                    }
                }
                if ($script !== '') {
                    $run = s4d_run_foreground($script, $cwd, S4D_FG_TIMEOUT);
                    if (!$run['ok']) {
                        $notices[] = array(false, $run['error']);
                    } else {
                        s4d_append_cmdlog($appRoot, 'terminal exit=' . $run['exit'] . ($run['timed_out'] ? ' TIMEOUT' : '') . ' cmd=' . substr(preg_replace('/\s+/', ' ', $cmd), 0, 300));
                        $label = $run['timed_out'] ? 'TIMED OUT after ' . S4D_FG_TIMEOUT . 's' : ('exit ' . $run['exit'] . ' in ' . $run['seconds'] . 's');
                        $notices[] = array($run['exit'] === 0 && !$run['timed_out'], 'Command finished: ' . $label);
                        $outText = $run['stdout'] !== '' ? $run['stdout'] : '(no stdout)';
                        if ($run['stderr'] !== '') {
                            $outText .= "\n--- stderr ---\n" . $run['stderr'];
                        }
                        $blocks .= '<div class="card"><h2>Terminal output</h2><pre>' . s4d_h($outText) . '</pre></div>';
                    }
                }
            }
        } elseif ($action === 'delete') {
            if (!isset($_POST['confirm']) || trim((string) $_POST['confirm']) !== 'DELETE') {
                $notices[] = array(false, 'Type DELETE to confirm deployer removal.');
            } else {
                if (@unlink(__FILE__)) {
                    echo '<div class="card"><h2>Deployer deleted</h2><p class="ok">The deployer file was removed.</p></div>';
                    s4d_page_foot();
                    return;
                }
                $notices[] = array(false, 'Could not delete this file. Remove it manually with FTP/File Manager.');
            }
        }
    }

    /* Environment table (always visible when logged in). */
    $rows = s4d_env_probes($appRoot, $nodevenv);
    echo '<div class="card"><h2>Environment</h2><table><tr><th>Item</th><th>Status</th><th>Detail</th></tr>';
    foreach ($rows as $row) {
        echo '<tr><td>' . s4d_h($row[0]) . '</td><td class="' . ($row[3] ? 'ok' : 'bad') . '">' . s4d_h($row[1]) . '</td><td>' . s4d_h($row[2]) . '</td></tr>';
    }
    echo '</table><p><a href="?action=logout">Lock deployer</a></p></div>';

    if (count($notices) > 0) {
        echo '<div class="card"><h2>Result</h2>';
        foreach ($notices as $n) {
            echo '<p class="checkline ' . ($n[0] ? 'ok' : 'bad') . '">' . s4d_h($n[1]) . '</p>';
        }
        echo '</div>';
    }
    echo $blocks;

    $csrf = s4d_csrf_token();
    echo '<div class="card"><h2>1. Install Node dependencies</h2>'
        . '<p class="muted">Starts npm install inside the Node virtualenv as a background job. Safe to close the page; poll status until it ends.</p>'
        . '<form method="post" action="">'
        . '<input type="hidden" name="csrf" value="' . s4d_h($csrf) . '">'
        . '<input type="hidden" name="action" value="npm_install">'
        . '<div><button type="submit">Start NPM install</button></div>'
        . '</form>'
        . '<form method="post" action="">'
        . '<input type="hidden" name="csrf" value="' . s4d_h($csrf) . '">'
        . '<input type="hidden" name="action" value="npm_status">'
        . '<div><button class="secondary" type="submit">NPM status + log</button></div>'
        . '</form></div>';

    echo '<div class="card"><h2>2. Restart the app</h2>'
        . '<form method="post" action="">'
        . '<input type="hidden" name="csrf" value="' . s4d_h($csrf) . '">'
        . '<input type="hidden" name="action" value="restart">'
        . '<div><button class="warnbtn" type="submit">Restart Passenger app</button></div>'
        . '</form></div>';

    echo '<div class="card"><h2>3. Health check</h2>'
        . '<form method="post" action="">'
        . '<input type="hidden" name="csrf" value="' . s4d_h($csrf) . '">'
        . '<input type="hidden" name="action" value="health">'
        . '<label>Health URL</label>'
        . '<input type="text" name="health_url" value="' . s4d_h($healthUrlDefault) . '">'
        . '<div><button class="secondary" type="submit">Check health</button></div>'
        . '</form></div>';

    echo '<div class="card"><h2>4. Terminal</h2>'
        . '<p class="muted">Runs one shell command (' . S4D_FG_TIMEOUT . 's limit). Working directory is locked to your home/app folders. Every command is audit-logged. Destructive patterns are blocked.</p>'
        . '<form method="post" action="">'
        . '<input type="hidden" name="csrf" value="' . s4d_h($csrf) . '">'
        . '<input type="hidden" name="action" value="terminal">'
        . '<label>Command</label>'
        . '<textarea name="cmd" placeholder="ls -la"></textarea>'
        . '<div class="row"><div><label>Working directory</label>'
        . '<select name="cwd"><option value="app">App folder</option><option value="home">Home folder</option></select></div>'
        . '<div><label>Node virtualenv</label>'
        . '<select name="use_venv"><option value="0">Off (plain shell)</option><option value="1">On (node + npm available)</option></select></div></div>'
        . '<div><button type="submit">Run command</button></div>'
        . '</form></div>';

    $cmdlog = s4d_tail(s4d_ops_dir($appRoot) . '/commands.log', 30);
    echo '<div class="card"><h2>5. Command audit log</h2><pre>' . s4d_h($cmdlog !== '' ? $cmdlog : '(no commands logged yet)') . '</pre></div>';

    echo '<div class="card"><h2>6. Remove the deployer</h2>'
        . '<form method="post" action="">'
        . '<input type="hidden" name="csrf" value="' . s4d_h($csrf) . '">'
        . '<input type="hidden" name="action" value="delete">'
        . '<label>Type DELETE to remove this PHP file</label>'
        . '<input type="text" name="confirm" autocomplete="off">'
        . '<div><button class="danger" type="submit">Delete deployer file</button></div>'
        . '</form></div>';

    s4d_page_foot();
}

/* ---------------------------------- dispatch --------------------------------- */

ini_set('display_errors', '0');
if (function_exists('set_time_limit')) {
    @set_time_limit(120);
}
s4d_main();
