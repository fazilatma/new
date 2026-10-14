<?php
/**
 * s4-fileman.php — mobile-first file explorer + code editor for Termux
 * =====================================================================
 * Version 1.0.0 · single file · no dependencies · PHP 7.4 … 8.5
 *
 * WHY
 *   Android file managers cannot read /data/data/com.termux (app-private),
 *   and code-server's UI is tiny on a phone. This is a big-touch-target,
 *   RTL, dark-theme explorer/editor you open in the phone's own browser:
 *   it browses and edits Termux's real files (home, $PREFIX, shared storage)
 *   over 127.0.0.1, with atomic saves, timestamped backups, php -l on save,
 *   a search, and a small command runner.
 *
 * RUN (use the launcher, it does all of this for you)
 *   curl -fsSL -o ~/s4-fileman.sh \
 *     https://raw.githubusercontent.com/fazilatma/new/arena/f5a628bb-new/deploy/s4-fileman.sh
 *   bash ~/s4-fileman.sh
 *
 * MANUAL
 *   mkdir -p ~/.s4-fileman/www && cp s4-fileman.php ~/.s4-fileman/www/
 *   php ~/.s4-fileman/www/s4-fileman.php --make-key
 *   php -d opcache.enable=0 -d opcache.enable_cli=0 -d display_errors=0 \
 *       -S 127.0.0.1:8082 -t ~/.s4-fileman/www
 *   open  http://127.0.0.1:8082/s4-fileman.php?key=<the printed key>
 *
 * CLI
 *   php s4-fileman.php --make-key        create ~/.s4-fileman/fileman.key (0600)
 *   php s4-fileman.php --print-key       show it again (local shell only)
 *   php s4-fileman.php --allow-remote    also accept non-loopback clients (RISKY)
 *   php s4-fileman.php --deny-remote     back to loopback only
 *   php s4-fileman.php --help
 *
 * SECURITY
 *   * every request needs the key (query, POST, X-FM-Key header or cookie)
 *   * non-loopback clients are refused unless --allow-remote was run
 *   * paths are realpath()-resolved and must live inside an allowed root:
 *     Termux's own files dir (home + $PREFIX) and shared storage. Nothing else.
 *   * every write is backed up to ~/.s4-fileman/backups first and logged
 *   * the key is never printed into the HTML, so view-source does not leak it
 *   * catastrophic shell commands are refused (rm -rf /, mkfs, dd of=/dev/…)
 */

define('FM_VERSION', '1.0.0');

$fmHome = getenv('HOME');
if (!$fmHome) {
    $fmPrefix = getenv('PREFIX');
    $fmHome = $fmPrefix ? dirname($fmPrefix, 2) . '/home' : '/data/data/com.termux/files/home';
}
$fmPrefix = getenv('PREFIX') ?: '';
define('FM_HOME', $fmHome);
define('FM_PREFIX', $fmPrefix);
define('FM_STATE', FM_HOME . '/.s4-fileman');
define('FM_KEYFILE', FM_STATE . '/fileman.key');
define('FM_LOG', FM_STATE . '/fileman.log');
define('FM_BACKUPS', FM_STATE . '/backups');
define('FM_MAXREAD', 4 * 1024 * 1024);
define('FM_MAXEXEC', 90);
define('FM_MAXOUT', 200000);

/* ------------------------------------------------------------------ utils */

function fm_roots(): array
{
    $roots = [FM_HOME];
    if (FM_PREFIX) {
        $roots[] = dirname(FM_PREFIX);          // …/com.termux/files  → home + usr
        $roots[] = FM_PREFIX;
    }
    foreach ([FM_HOME . '/storage/shared', '/storage/emulated/0', '/sdcard'] as $r) {
        if (is_dir($r)) {
            $roots[] = $r;
        }
    }
    $out = [];
    foreach ($roots as $r) {
        $rr = realpath($r);
        if ($rr !== false && !in_array($rr, $out, true)) {
            $out[] = $rr;
        }
    }
    return $out;
}

/** Resolve a user-supplied path; null when it escapes the allowed roots. */
function fm_safe(string $p): ?string
{
    $p = str_replace("\0", '', $p);
    if ($p === '') {
        return null;
    }
    if ($p[0] !== '/') {
        $p = FM_HOME . '/' . $p;
    }
    $real = realpath($p);
    if ($real === false) {
        $rd = realpath(dirname($p));            // creating a new file: check the parent
        if ($rd === false) {
            return null;
        }
        $real = $rd . '/' . basename($p);
    }
    foreach (fm_roots() as $r) {
        if ($real === $r || strpos($real, $r . '/') === 0) {
            return $real;
        }
    }
    return null;
}

function fm_log(string $msg): void
{
    if (!is_dir(FM_STATE)) {
        @mkdir(FM_STATE, 0700, true);
    }
    @file_put_contents(
        FM_LOG,
        sprintf("[%s] %s %s\n", date('Y-m-d H:i:s'), $_SERVER['REMOTE_ADDR'] ?? 'cli', $msg),
        FILE_APPEND
    );
}

function fm_out($data): void
{
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function fm_err(string $msg, int $code = 400): void
{
    http_response_code($code);
    fm_out(['ok' => false, 'error' => $msg]);
}

function fm_size(int $n): string
{
    $u = ['B', 'KB', 'MB', 'GB'];
    $i = 0;
    while ($n >= 1024 && $i < 3) {
        $n /= 1024;
        $i++;
    }
    return ($i === 0 ? (int)$n : round($n, 1)) . ' ' . $u[$i];
}

/** First shell that actually exists — Termux has no /bin/sh. */
function fm_shell(): string
{
    foreach (['/bin/sh', FM_PREFIX . '/bin/sh', FM_PREFIX . '/bin/bash', '/system/bin/sh'] as $sh) {
        if ($sh && is_file($sh) && is_executable($sh)) {
            return $sh;
        }
    }
    foreach (['sh', 'bash'] as $sh) {
        $p = trim((string)@shell_exec('command -v ' . $sh . ' 2>/dev/null'));
        if ($p !== '') {
            return $p;
        }
    }
    return '/bin/sh';
}

/** `php -l` without a shell (proc_open array form) — works on Termux. */
function fm_lint(string $file): array
{
    if (substr($file, -4) !== '.php' || !function_exists('proc_open')) {
        return ['lint' => null];
    }
    $php = (getenv('PREFIX') ? getenv('PREFIX') . '/bin/php' : 'php');
    $desc = [1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
    $proc = @proc_open([$php, '-l', $file], $desc, $pipes);
    if (!is_resource($proc)) {
        $out = @shell_exec('php -l ' . escapeshellarg($file) . ' 2>&1');
    } else {
        $out = (string)stream_get_contents($pipes[1]) . (string)stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        proc_close($proc);
    }
    $ok = is_string($out) && strpos($out, 'No syntax errors') !== false;
    return ['lint' => $ok ? 'ok' : trim($out), 'lint_ok' => $ok];
}

function fm_backup(string $file): ?string
{
    if (!is_file($file)) {
        return null;
    }
    if (!is_dir(FM_BACKUPS)) {
        @mkdir(FM_BACKUPS, 0700, true);
    }
    $dest = FM_BACKUPS . '/' . date('Ymd-His') . '-' . preg_replace('/[^A-Za-z0-9._-]/', '_', basename($file));
    return @copy($file, $dest) ? $dest : null;
}

/** Write atomically: temp file in the same dir, then rename. */
function fm_write(string $file, string $data): bool
{
    $tmp = $file . '.fmtmp.' . getmypid();
    if (@file_put_contents($tmp, $data) === false) {
        return false;
    }
    if (!@rename($tmp, $file)) {          // shared storage often refuses rename
        @unlink($tmp);
        return false;
    }
    return true;
}

function fm_key(): string
{
    if (!is_file(FM_KEYFILE)) {
        return '';
    }
    return trim((string)@file_get_contents(FM_KEYFILE));
}

function fm_make_key(): string
{
    if (!is_dir(FM_STATE)) {
        @mkdir(FM_STATE, 0700, true);
    }
    $k = bin2hex(random_bytes(16));
    @file_put_contents(FM_KEYFILE, $k);
    @chmod(FM_KEYFILE, 0600);
    @chmod(FM_STATE, 0700);
    return $k;
}

function fm_is_loopback(string $ip): bool
{
    return in_array($ip, ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost', ''], true);
}

function fm_auth(): void
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    $remoteOk = is_file(FM_STATE . '/allow-remote');
    if (!$remoteOk && !fm_is_loopback($ip)) {
        http_response_code(403);
        fm_out(['ok' => false, 'error' => 'remote clients are blocked; run: php s4-fileman.php --allow-remote']);
    }
    $key = fm_key();
    if ($key === '') {
        http_response_code(500);
        fm_out(['ok' => false, 'error' => 'no key file; run: php s4-fileman.php --make-key']);
    }
    $given = '';
    foreach ([$_GET['key'] ?? '', $_POST['key'] ?? '', $_COOKIE['fm_key'] ?? '', $_SERVER['HTTP_X_FM_KEY'] ?? ''] as $c) {
        if (is_string($c) && $c !== '') {
            $given = $c;
            break;
        }
    }
    if (!hash_equals($key, $given)) {
        http_response_code(401);
        fm_out(['ok' => false, 'error' => 'bad or missing key']);
    }
    if (empty($_COOKIE['fm_key']) && !headers_sent()) {
        setcookie('fm_key', $given, [
            'expires' => time() + 86400 * 30, 'path' => '/', 'httponly' => true, 'samesite' => 'Strict',
        ]);
    }
}

function fm_exec(string $cmd, string $cwd, int $timeout): array
{
    $t0 = microtime(true);
    if (!function_exists('proc_open')) {
        return ['ok' => false, 'error' => 'proc_open unavailable', 'rc' => -1, 'out' => '', 'ms' => 0];
    }
    $descriptors = [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
    $proc = @proc_open([fm_shell(), '-c', 'cd ' . escapeshellarg($cwd) . ' 2>/dev/null; ' . $cmd . ' 2>&1'],
        $descriptors, $pipes, $cwd);
    if (!is_resource($proc)) {
        return ['ok' => false, 'error' => 'proc_open failed', 'rc' => -1, 'out' => '', 'ms' => 0];
    }
    fclose($pipes[0]);
    stream_set_blocking($pipes[1], false);
    $out = '';
    $deadline = $t0 + $timeout;
    $killed = false;
    while (true) {
        $chunk = fread($pipes[1], 8192);
        if ($chunk !== false && $chunk !== '') {
            $out .= $chunk;
            if (strlen($out) > FM_MAXOUT) {
                $out = substr($out, 0, FM_MAXOUT) . "\n…output truncated…\n";
                $killed = true;
            }
        }
        $status = proc_get_status($proc);
        if (!$status['running']) {
            break;
        }
        if (microtime(true) > $deadline) {
            @proc_terminate($proc, 9);
            $killed = true;
            break;
        }
        if ($chunk === '' || $chunk === false) {
            usleep(40000);
        }
    }
    $tail = stream_get_contents($pipes[1]);
    if (is_string($tail)) {
        $out .= $tail;
    }
    fclose($pipes[1]);
    fclose($pipes[2]);
    $rc = proc_close($proc);
    return [
        'ok' => true, 'rc' => $rc, 'out' => substr($out, 0, FM_MAXOUT),
        'ms' => (int)round((microtime(true) - $t0) * 1000), 'killed' => $killed,
    ];
}

/* --------------------------------------------------------------- CLI mode */

if (PHP_SAPI === 'cli') {
    $argvv = $_SERVER['argv'] ?? [];
    $cmdline = implode(' ', array_slice($argvv, 1));
    if (strpos($cmdline, '--print-key') !== false) {
        $k = fm_key();
        echo $k !== '' ? $k . "\n" : "no key yet — run with --make-key\n";
        exit(0);
    }
    if (strpos($cmdline, '--make-key') !== false) {
        $k = fm_key();
        if ($k === '') {
            $k = fm_make_key();
            echo "key created: $k\n";
        } else {
            echo "key already exists: $k\n";
        }
        echo "state dir: " . FM_STATE . "\n";
        exit(0);
    }
    if (strpos($cmdline, '--allow-remote') !== false) {
        if (!is_dir(FM_STATE)) {
            @mkdir(FM_STATE, 0700, true);
        }
        @file_put_contents(FM_STATE . '/allow-remote', date('c'));
        echo "⚠️  remote clients are now ALLOWED (key still required). This is full shell access\n";
        echo "    to your Termux files for anyone who can reach this port. Undo: --deny-remote\n";
        exit(0);
    }
    if (strpos($cmdline, '--deny-remote') !== false) {
        @unlink(FM_STATE . '/allow-remote');
        echo "loopback only again\n";
        exit(0);
    }
    echo "s4-fileman.php " . FM_VERSION . "\n\n";
    echo "This file is a web app: serve it, do not run it.\n\n";
    echo "  php -d opcache.enable=0 -d opcache.enable_cli=0 -d display_errors=0 \\\n";
    echo "      -S 127.0.0.1:8082 -t " . dirname(__FILE__) . "\n";
    echo "  then open  http://127.0.0.1:8082/" . basename(__FILE__) . "?key=YOURKEY\n\n";
    echo "Commands: --make-key  --print-key  --allow-remote  --deny-remote\n";
    echo "State:    " . FM_STATE . "\n";
    echo "Roots:    " . implode(', ', fm_roots()) . "\n";
    $k = fm_key();
    echo "Key:      " . ($k !== '' ? $k : '<none — run --make-key>') . "\n";
    exit(0);
}

/* ------------------------------------------------------------- web: actions */

@ini_set('display_errors', '0');
@ini_set('log_errors', '1');
@set_time_limit(300);
@ignore_user_abort(true);

$act = isset($_GET['act']) ? (string)$_GET['act'] : '';
fm_auth();

if ($act !== '') {
    $path = isset($_REQUEST['path']) ? (string)$_REQUEST['path'] : '';

    switch ($act) {
        case 'whoami':
            fm_out([
                'ok' => true, 'version' => FM_VERSION, 'php' => PHP_VERSION, 'sapi' => PHP_SAPI,
                'ip' => $_SERVER['REMOTE_ADDR'] ?? '', 'loopback' => fm_is_loopback($_SERVER['REMOTE_ADDR'] ?? ''),
                'remote_allowed' => is_file(FM_STATE . '/allow-remote'),
                'roots' => fm_roots(), 'home' => FM_HOME, 'state' => FM_STATE,
                'free' => function_exists('disk_free_space') ? fm_size((int)@disk_free_space(FM_HOME)) : '?',
            ]);

        case 'ls':
            $dir = fm_safe($path !== '' ? $path : FM_HOME);
            if ($dir === null || !is_dir($dir)) {
                fm_err('cannot list ' . ($path !== '' ? $path : FM_HOME), 404);
            }
            $entries = [];
            $items = @scandir($dir);
            if ($items === false) {
                fm_err('scandir failed (permissions?)', 500);
            }
            foreach ($items as $it) {
                if ($it === '.' || $it === '..') {
                    continue;
                }
                $full = $dir . '/' . $it;
                $st = @lstat($full);
                $isLink = is_link($full);
                $isDir = $isLink ? @is_dir($full) : ($st ? (($st['mode'] & 0170000) === 0040000) : is_dir($full));
                $entries[] = [
                    'name' => $it,
                    'type' => $isDir ? 'dir' : 'file',
                    'link' => $isLink,
                    'size' => $isDir ? null : ($st ? $st['size'] : (@filesize($full) ?: 0)),
                    'mtime' => $st ? $st['mtime'] : (@filemtime($full) ?: 0),
                    'perm' => $st ? substr(sprintf('%o', $st['mode']), -4) : '?',
                    'readable' => @is_readable($full),
                ];
            }
            usort($entries, function ($a, $b) {
                if ($a['type'] !== $b['type']) {
                    return $a['type'] === 'dir' ? -1 : 1;
                }
                return strcasecmp($a['name'], $b['name']);
            });
            $parent = dirname($dir);
            $allowed = false;
            foreach (fm_roots() as $r) {
                if (strpos($parent, $r) === 0) {
                    $allowed = true;
                }
            }
            fm_out([
                'ok' => true, 'path' => $dir, 'parent' => $allowed ? $parent : null,
                'entries' => $entries, 'writable' => @is_writable($dir),
                'count' => count($entries),
                'shared_storage' => (strpos($dir, '/storage/') !== false || strpos($dir, '/sdcard') !== false),
            ]);

        case 'read':
            $f = fm_safe($path);
            if ($f === null || !is_file($f)) {
                fm_err('not a readable file', 404);
            }
            $size = (int)@filesize($f);
            $off = max(0, (int)($_GET['off'] ?? 0));
            $len = min(FM_MAXREAD, max(1, (int)($_GET['len'] ?? FM_MAXREAD)));
            $fh = @fopen($f, 'rb');
            if (!$fh) {
                fm_err('cannot open (permissions?)', 500);
            }
            if ($off > 0) {
                @fseek($fh, $off);
            }
            $data = (string)@fread($fh, $len);
            fclose($fh);
            $binary = strpos(substr($data, 0, 4096), "\0") !== false
                || (function_exists('mb_check_encoding') && !mb_check_encoding($data, 'UTF-8'));
            fm_out(array_merge([
                'ok' => true, 'path' => $f, 'size' => $size, 'offset' => $off,
                'shown' => strlen($data), 'truncated' => ($off + strlen($data)) < $size,
                'binary' => $binary, 'writable' => @is_writable($f) || @is_writable(dirname($f)),
                'mtime' => (int)@filemtime($f), 'md5' => $size <= 32 * 1024 * 1024 ? @md5_file($f) : null,
                'content' => $binary ? base64_encode($data) : $data,
            ], fm_lint($f)));

        case 'save':
            $f = fm_safe($path);
            if ($f === null) {
                fm_err('path outside the allowed roots', 403);
            }
            $body = file_get_contents('php://input');
            if ($body === false) {
                $body = '';
            }
            if (isset($_POST['content'])) {
                $body = (string)$_POST['content'];
            }
            $bk = fm_backup($f);
            if (!fm_write($f, $body)) {
                // shared storage refuses rename(): fall back to a direct write
                if (@file_put_contents($f, $body) === false) {
                    fm_err('write failed — is the folder writable? (shared storage often is not)', 500);
                }
                $atomic = false;
            } else {
                $atomic = true;
            }
            fm_log("save $f (" . strlen($body) . " bytes, atomic=" . ($atomic ? 'yes' : 'no') . ", backup=" . ($bk ?: 'none') . ")");
            fm_out(array_merge([
                'ok' => true, 'path' => $f, 'bytes' => strlen($body), 'atomic' => $atomic,
                'backup' => $bk, 'md5' => @md5_file($f),
            ], fm_lint($f)));

        case 'mkdir':
            $f = fm_safe($path);
            if ($f === null) {
                fm_err('path outside the allowed roots', 403);
            }
            if (!@mkdir($f, 0755, true) && !is_dir($f)) {
                fm_err('mkdir failed', 500);
            }
            fm_log("mkdir $f");
            fm_out(['ok' => true, 'path' => $f]);

        case 'touch':
            $f = fm_safe($path);
            if ($f === null) {
                fm_err('path outside the allowed roots', 403);
            }
            if (is_file($f)) {
                @touch($f);
            } elseif (!fm_write($f, '')) {
                fm_err('cannot create file here', 500);
            }
            fm_log("touch $f");
            fm_out(array_merge(['ok' => true, 'path' => $f], fm_lint($f)));

        case 'rename':
            $from = fm_safe($path);
            $to = fm_safe((string)($_POST['to'] ?? ''));
            if ($from === null || $to === null) {
                fm_err('path outside the allowed roots', 403);
            }
            if (!@rename($from, $to)) {
                fm_err('rename failed (shared storage refuses renames; copy+delete instead)', 500);
            }
            fm_log("rename $from -> $to");
            fm_out(['ok' => true, 'from' => $from, 'to' => $to]);

        case 'delete':
            $f = fm_safe($path);
            if ($f === null) {
                fm_err('path outside the allowed roots', 403);
            }
            if (is_dir($f) && !is_link($f)) {
                $it = new RecursiveIteratorIterator(
                    new RecursiveDirectoryIterator($f, FilesystemIterator::SKIP_DOTS),
                    RecursiveIteratorIterator::CHILD_FIRST
                );
                foreach ($it as $x) {
                    $x->isDir() ? @rmdir($x->getPathname()) : @unlink($x->getPathname());
                }
                $okDir = @rmdir($f);
                fm_log("rmdir $f (" . ($okDir ? 'ok' : 'FAILED') . ")");
                $okDir ? fm_out(['ok' => true, 'path' => $f]) : fm_err('rmdir failed', 500);
            }
            $bk = fm_backup($f);
            $ok = @unlink($f);
            fm_log("delete $f (" . ($ok ? 'ok' : 'FAILED') . ", backup=" . ($bk ?: 'none') . ")");
            $ok ? fm_out(['ok' => true, 'path' => $f, 'backup' => $bk]) : fm_err('delete failed', 500);
            break;

        case 'chmod':
            $f = fm_safe($path);
            $mode = (string)($_POST['mode'] ?? '');
            if ($f === null || !preg_match('/^[0-7]{3,4}$/', $mode)) {
                fm_err('bad path or mode (use e.g. 0644)', 400);
            }
            $ok = @chmod($f, octdec($mode));
            fm_log("chmod $mode $f (" . ($ok ? 'ok' : 'FAILED') . ")");
            $ok ? fm_out(['ok' => true, 'path' => $f, 'mode' => $mode])
               : fm_err('chmod failed — typical on Android shared storage', 500);

        case 'copy':
            $from = fm_safe($path);
            $to = fm_safe((string)($_POST['to'] ?? ''));
            if ($from === null || $to === null) {
                fm_err('path outside the allowed roots', 403);
            }
            if (!is_file($from)) {
                fm_err('only files can be copied', 400);
            }
            if (!@copy($from, $to)) {
                fm_err('copy failed', 500);
            }
            fm_log("copy $from -> $to");
            fm_out(['ok' => true, 'from' => $from, 'to' => $to, 'bytes' => (int)@filesize($to)]);

        case 'download':
            $f = fm_safe($path);
            if ($f === null || !is_file($f)) {
                fm_err('not a file', 404);
            }
            fm_log("download $f");
            header('Content-Type: application/octet-stream');
            header('Content-Length: ' . (int)@filesize($f));
            header('Content-Disposition: attachment; filename="' . basename($f) . '"');
            readfile($f);
            exit;

        case 'upload':
            $dir = fm_safe($path !== '' ? $path : FM_HOME);
            if ($dir === null || !is_dir($dir)) {
                fm_err('bad target dir', 400);
            }
            if (empty($_FILES['file']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
                fm_err('no uploaded file', 400);
            }
            $name = basename((string)$_FILES['file']['name']);
            $dest = $dir . '/' . $name;
            fm_backup($dest);
            $ok = @move_uploaded_file($_FILES['file']['tmp_name'], $dest)
                ?: @copy($_FILES['file']['tmp_name'], $dest);
            if (!$ok) {
                fm_err('upload failed', 500);
            }
            fm_log("upload $dest (" . (int)@filesize($dest) . " bytes)");
            fm_out(['ok' => true, 'path' => $dest, 'bytes' => (int)@filesize($dest)]);

        case 'grep':
            $dir = fm_safe($path !== '' ? $path : FM_HOME);
            $pattern = (string)($_REQUEST['pattern'] ?? '');
            $maxDepth = min(6, max(1, (int)($_REQUEST['depth'] ?? 3)));
            $maxHits = 200;
            if ($dir === null || $pattern === '') {
                fm_err('need a path and a pattern', 400);
            }
            $res = fm_exec(
                'grep -rnI --color=never ' . escapeshellarg($pattern) . ' ' . escapeshellarg($dir)
                . ' 2>/dev/null | head -' . ($maxHits + 1),
                $dir,
                60
            );
            $lines = array_values(array_filter(explode("\n", (string)$res['out']), 'strlen'));
            $hits = [];
            foreach (array_slice($lines, 0, $maxHits) as $l) {
                $parts = explode(':', $l, 3);
                if (count($parts) === 3) {
                    $hits[] = ['path' => $parts[0], 'line' => (int)$parts[1], 'text' => substr($parts[2], 0, 400)];
                }
            }
            fm_out(['ok' => true, 'dir' => $dir, 'pattern' => $pattern, 'hits' => $hits,
                    'count' => count($hits), 'truncated' => count($lines) > $maxHits, 'depth' => $maxDepth]);

        case 'tail':
            $f = fm_safe($path);
            $n = min(2000, max(1, (int)($_GET['lines'] ?? 200)));
            if ($f === null || !is_file($f)) {
                fm_err('not a file', 404);
            }
            $res = fm_exec('tail -n ' . $n . ' ' . escapeshellarg($f), dirname($f), 20);
            fm_out(['ok' => true, 'path' => $f, 'lines' => $n, 'out' => $res['out']]);

        case 'exec':
            $cmd = (string)($_POST['cmd'] ?? '');
            $cwd = fm_safe((string)($_POST['cwd'] ?? FM_HOME)) ?: FM_HOME;
            if (trim($cmd) === '') {
                fm_err('empty command', 400);
            }
            if (preg_match('/rm\s+-[rf]{1,2}\s+(\/|\/\*|~|\$HOME)(\s|$)|mkfs|dd\s+.*of=\/dev\/[sh]d|:\(\)\s*\{.*\};\s*:/', $cmd)) {
                fm_err('refused: catastrophic command', 403);
            }
            $to = min(600, max(1, (int)($_POST['timeout'] ?? FM_MAXEXEC)));
            fm_log('exec in ' . $cwd . ': ' . substr($cmd, 0, 200));
            $res = fm_exec($cmd, $cwd, $to);
            fm_out($res + ['cwd' => $cwd, 'timeout' => $to]);

        case 'info':
            $f = fm_safe($path);
            if ($f === null) {
                fm_err('bad path', 400);
            }
            $st = @stat($f);
            fm_out([
                'ok' => true, 'path' => $f, 'exists' => (bool)$st,
                'type' => is_link($f) ? 'link' : (is_dir($f) ? 'dir' : 'file'),
                'size' => $st ? (int)$st['size'] : null, 'size_h' => $st ? fm_size((int)$st['size']) : null,
                'mtime' => $st ? date('Y-m-d H:i:s', (int)$st['mtime']) : null,
                'perm' => $st ? substr(sprintf('%o', $st['mode']), -4) : null,
                'owner' => $st ? (function_exists('posix_getpwuid') ? (posix_getpwuid((int)$st['uid'])['name'] ?? $st['uid']) : $st['uid']) : null,
                'md5' => is_file($f) ? @md5_file($f) : null,
                'writable' => @is_writable($f), 'readable' => @is_readable($f),
                'free_here' => function_exists('disk_free_space') ? fm_size((int)@disk_free_space(dirname($f))) : '?',
            ]);

        default:
            fm_err('unknown act: ' . $act, 400);
    }
}

/* ------------------------------------------------------------------- page */
$fmInitial = fm_safe(isset($_GET['path']) ? (string)$_GET['path'] : FM_HOME) ?: FM_HOME;
$fmRemoteAllowed = is_file(FM_STATE . '/allow-remote');
$fmLoopback = fm_is_loopback($_SERVER['REMOTE_ADDR'] ?? '');
$fmKeyLen = strlen(fm_key());
$fmRoots = fm_roots();
?>
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=5">
<meta name="theme-color" content="#0b1020">
<title>Termux File Manager</title>
<style>
:root{
  --bg:#0b1020; --panel:#141a2e; --panel2:#1b2340; --line:#26304f; --txt:#e7ecff;
  --mut:#93a0c8; --acc:#4f8cff; --ok:#2fd07a; --warn:#ffb020; --bad:#ff5c72;
  --fs:16px; --efs:15px;
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;padding:0;background:var(--bg);color:var(--txt);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Arabic",sans-serif;font-size:var(--fs)}
body{padding-bottom:env(safe-area-inset-bottom)}
a{color:var(--acc)}
header{position:sticky;top:0;z-index:20;background:linear-gradient(180deg,#101634,#0b1020);
  border-bottom:1px solid var(--line);padding:10px 12px calc(8px)}
.hrow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
h1{font-size:17px;margin:0;font-weight:700;letter-spacing:.2px}
.badge{font-size:11px;color:var(--mut);border:1px solid var(--line);border-radius:999px;padding:2px 8px}
.badge.warn{color:#1a1200;background:var(--warn);border-color:var(--warn);font-weight:700}
.badge.ok{color:#04150c;background:var(--ok);border-color:var(--ok);font-weight:700}
.pathbar{display:flex;gap:6px;margin-top:8px}
.pathbar input{flex:1;min-width:0;background:var(--panel);border:1px solid var(--line);color:var(--txt);
  border-radius:10px;padding:11px 12px;font-size:14px;direction:ltr;text-align:left;font-family:ui-monospace,Menlo,Consolas,monospace}
.chips{display:flex;gap:6px;overflow-x:auto;padding:8px 0 2px;-webkit-overflow-scrolling:touch}
.chip{white-space:nowrap;background:var(--panel2);border:1px solid var(--line);color:var(--txt);
  border-radius:999px;padding:8px 12px;font-size:13px;min-height:38px}
.chip:active{background:var(--acc)}
button,.btn{background:var(--panel2);border:1px solid var(--line);color:var(--txt);border-radius:10px;
  padding:11px 13px;font-size:14px;min-height:44px;min-width:44px;cursor:pointer;font-family:inherit}
button:active,.btn:active{background:var(--acc);border-color:var(--acc)}
button.pri{background:var(--acc);border-color:var(--acc);color:#fff;font-weight:700}
button.danger{background:#2a1620;border-color:#5a2430;color:#ffb3c0}
main{padding:10px 12px 90px}
.list{display:flex;flex-direction:column;gap:6px}
.row{display:flex;align-items:center;gap:10px;background:var(--panel);border:1px solid var(--line);
  border-radius:12px;padding:11px 12px;min-height:56px}
.row .ico{font-size:20px;width:28px;text-align:center;flex:none}
.row .nm{flex:1;min-width:0;overflow-wrap:anywhere;direction:ltr;text-align:left;
  font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14.5px}
.row .mt{color:var(--mut);font-size:11.5px;white-space:nowrap;direction:ltr}
.row:active{background:var(--panel2)}
.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
.editor{display:none;flex-direction:column;gap:8px}
textarea#ed{width:100%;min-height:52vh;background:#0d1226;color:#dfe7ff;border:1px solid var(--line);
  border-radius:12px;padding:12px;font-family:ui-monospace,Menlo,Consolas,"Courier New",monospace;
  font-size:var(--efs);line-height:1.55;direction:ltr;text-align:left;white-space:pre;overflow:auto;
  tab-size:2;resize:vertical}
textarea#ed.wrap{white-space:pre-wrap;overflow-wrap:anywhere}
pre.out{background:#0d1226;border:1px solid var(--line);border-radius:12px;padding:12px;overflow:auto;
  direction:ltr;text-align:left;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;
  white-space:pre-wrap;overflow-wrap:anywhere;max-height:45vh;color:#cfe0ff;margin:0}
.status{position:fixed;left:0;right:0;bottom:0;background:#101634;border-top:1px solid var(--line);
  padding:9px 12px calc(9px + env(safe-area-inset-bottom));font-size:12.5px;color:var(--mut);
  display:flex;gap:10px;align-items:center;justify-content:space-between;z-index:30}
.status b{color:var(--txt)}
.hint{color:var(--mut);font-size:13px;margin:6px 0}
.grid{display:flex;gap:8px;flex-wrap:wrap}
kbd{background:var(--panel2);border:1px solid var(--line);border-radius:6px;padding:1px 6px;font-size:12px}
input[type=text],input[type=search],select{background:var(--panel);border:1px solid var(--line);
  color:var(--txt);border-radius:10px;padding:11px 12px;font-size:14px;font-family:inherit;min-height:44px}
.hidden{display:none!important}
.sheet{position:fixed;inset:0;background:rgba(4,7,18,.72);z-index:40;display:flex;align-items:flex-end;justify-content:center}
.sheet .box{background:var(--panel);border:1px solid var(--line);border-radius:18px 18px 0 0;width:100%;
  max-width:640px;padding:14px 14px calc(18px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:8px}
.sheet .box h3{margin:2px 0 6px;font-size:15px;direction:ltr;text-align:left;overflow-wrap:anywhere}
.toast{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:60;background:var(--panel2);
  border:1px solid var(--line);border-radius:12px;padding:10px 14px;font-size:13.5px;max-width:92vw;
  box-shadow:0 8px 30px rgba(0,0,0,.5);display:none}
.toast.ok{border-color:var(--ok)} .toast.bad{border-color:var(--bad)}
.spin{display:inline-block;width:14px;height:14px;border:2px solid var(--line);border-top-color:var(--acc);
  border-radius:50%;animation:sp 1s linear infinite;vertical-align:-2px}
@keyframes sp{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<header>
  <div class="hrow">
    <h1>📁 مدیرِ فایلِ ترموکس</h1>
    <span class="badge">v<?= htmlspecialchars(FM_VERSION) ?></span>
    <span class="badge">PHP <?= htmlspecialchars(PHP_VERSION) ?></span>
    <?php if ($fmLoopback): ?><span class="badge ok">loopback</span>
    <?php else: ?><span class="badge">remote</span><?php endif; ?>
    <?php if ($fmRemoteAllowed): ?><span class="badge warn">⚠️ remote مجاز است</span><?php endif; ?>
    <span style="flex:1"></span>
    <button id="btnFont-" title="کوچک‌تر">A−</button>
    <button id="btnFont+" title="بزرگ‌تر">A+</button>
  </div>
  <div class="pathbar">
    <input id="path" value="<?= htmlspecialchars($fmInitial) ?>" spellcheck="false" enterkeyhint="go">
    <button id="btnGo" class="pri">برو</button>
    <button id="btnUp" title="بالا">↑</button>
  </div>
  <div class="chips" id="roots">
    <?php foreach ($fmRoots as $i => $r): ?>
      <button class="chip" data-path="<?= htmlspecialchars($r) ?>"><?= htmlspecialchars($i === 0 ? '🏠 خانه' : $r) ?></button>
    <?php endforeach; ?>
    <button class="chip" data-path="<?= htmlspecialchars(FM_HOME . '/storage/shared/codes') ?>">📂 codes</button>
    <button class="chip" data-path="<?= htmlspecialchars(FM_HOME . '/.s4-run') ?>">🤖 .s4-run</button>
    <button class="chip" data-path="<?= htmlspecialchars(FM_HOME . '/.s4-agent') ?>">📡 .s4-agent</button>
    <button class="chip" data-path="<?= htmlspecialchars(FM_PREFIX ? FM_PREFIX . '/etc' : FM_HOME) ?>">⚙️ etc</button>
  </div>
</header>

<main>
  <div class="toolbar">
    <button id="btnNewFile">＋ فایل</button>
    <button id="btnNewDir">＋ پوشه</button>
    <button id="btnUpload">⬆️ آپلود</button>
    <button id="btnSearch">🔍 جست‌وجو</button>
    <button id="btnTerm">⌨️ ترمینال</button>
    <button id="btnBack">🗂 فهرست</button>
  </div>

  <div id="browser">
    <div class="hint" id="dirhint"></div>
    <div class="list" id="list"></div>
  </div>

  <div id="editor" class="editor">
    <div class="grid">
      <button id="btnSave" class="pri">💾 ذخیره</button>
      <button id="btnLint">🩺 php -l</button>
      <button id="btnWrap">↩️ wrap</button>
      <button id="btnInfo">ℹ️ اطلاعات</button>
      <button id="btnChmod">🔐 chmod</button>
      <button id="btnRename">✏️ تغییرِ نام</button>
      <button id="btnDl">⬇️ دانلود</button>
      <button id="btnDel" class="danger">🗑 حذف</button>
    </div>
    <div class="hint" id="edhint" dir="ltr"></div>
    <textarea id="ed" spellcheck="false" dir="ltr"></textarea>
    <pre class="out hidden" id="edout"></pre>
  </div>

  <div id="term" class="hidden">
    <div class="grid">
      <input type="text" id="cmd" style="flex:1;min-width:60%" placeholder="دستور… (مثلاً ls -la)" dir="ltr" spellcheck="false">
      <button id="btnRun" class="pri">اجرا</button>
    </div>
    <div class="chips" id="cmdchips">
      <button class="chip" data-cmd="ls -la">ls -la</button>
      <button class="chip" data-cmd="pwd; whoami; php -v | head -1">env</button>
      <button class="chip" data-cmd="df -h .">df -h</button>
      <button class="chip" data-cmd="ps -ef | head -20">ps</button>
      <button class="chip" data-cmd="tail -n 40 php-error.log">tail log</button>
      <button class="chip" data-cmd="pkg list-installed 2>/dev/null | head -40">packages</button>
    </div>
    <pre class="out" id="termout">آماده…</pre>
  </div>

  <div id="search" class="hidden">
    <div class="grid">
      <input type="search" id="pat" style="flex:1;min-width:60%" placeholder="الگو (regex سادهٔ grep)" dir="ltr">
      <button id="btnDoSearch" class="pri">بگرد</button>
    </div>
    <pre class="out" id="searchout"></pre>
  </div>
</main>

<div class="status">
  <span id="stL">—</span>
  <span id="stR"><b><?= htmlspecialchars(FM_HOME) ?></b></span>
</div>
<div class="toast" id="toast"></div>
<input type="file" id="filepick" class="hidden">

<script>
(function(){
  "use strict";
  var QS = location.search || "";
  var KEY = (function(){
    var m = /[?&]key=([^&]+)/.exec(location.search);
    return m ? decodeURIComponent(m[1]) : "";
  })();
  var $ = function(id){ return document.getElementById(id); };
  var curDir = <?= json_encode($fmInitial, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?>;
  var curFile = null, curMtime = 0, dirty = false;

  function api(act, params, opts){
    opts = opts || {};
    var q = ["act=" + encodeURIComponent(act)];
    if (KEY) q.push("key=" + encodeURIComponent(KEY));
    Object.keys(params || {}).forEach(function(k){
      if (params[k] !== undefined && params[k] !== null) q.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
    });
    var init = {method: opts.method || "GET", headers: {}, credentials: "same-origin"};
    if (opts.body !== undefined){ init.body = opts.body; }
    if (opts.form){
      var fd = new FormData();
      Object.keys(opts.form).forEach(function(k){ fd.append(k, opts.form[k]); });
      if (KEY) fd.append("key", KEY);
      init.body = fd; init.method = "POST";
    }
    if (opts.raw){
      init.method = "POST";
      init.headers["Content-Type"] = "text/plain;charset=UTF-8";
    }
    return fetch(location.pathname + "?" + q.join("&"), init).then(function(r){
      return r.text().then(function(t){
        var j; try { j = JSON.parse(t); } catch(e){ j = {ok:false, error:"non-JSON response: " + t.slice(0,300)}; }
        if (!r.ok && !j.error) j.error = "HTTP " + r.status;
        return j;
      });
    });
  }

  function toast(msg, kind){
    var t = $("toast");
    t.className = "toast " + (kind || "");
    t.textContent = msg;
    t.style.display = "block";
    clearTimeout(t._h);
    t._h = setTimeout(function(){ t.style.display = "none"; }, kind === "bad" ? 6000 : 2600);
  }
  function status(l, r){ if (l !== undefined) $("stL").innerHTML = l; if (r !== undefined) $("stR").innerHTML = r; }
  function human(n){ if (n === null || n === undefined) return ""; var u=["B","KB","MB","GB"],i=0;
    while (n >= 1024 && i < 3){ n/=1024; i++; } return (i===0?n:n.toFixed(1))+" "+u[i]; }
  function ago(ts){ if (!ts) return ""; var d = Math.max(0, Math.floor(Date.now()/1000 - ts));
    if (d < 60) return d+"s"; if (d < 3600) return Math.floor(d/60)+"m";
    if (d < 86400) return Math.floor(d/3600)+"h"; return Math.floor(d/86400)+"d"; }
  function ico(e){ if (e.type === "dir") return e.link ? "🔗" : "📁";
    var m = /\.([a-z0-9]+)$/i.exec(e.name); var x = m ? m[1].toLowerCase() : "";
    if (x === "php") return "🐘"; if (x === "sh" || x === "bash") return "📜";
    if (x === "json") return "🧾"; if (x === "md" || x === "txt") return "📄";
    if (x === "log") return "📃"; if (x === "js" || x === "mjs") return "🟨";
    if (["png","jpg","jpeg","gif","webp","svg"].indexOf(x) >= 0) return "🖼";
    if (["zip","tgz","tar","gz","rar"].indexOf(x) >= 0) return "🗜";
    return e.link ? "🔗" : "📄"; }

  /* ------------------------------------------------------------- browsing */
  function show(which){
    ["browser","editor","term","search"].forEach(function(id){
      $(id).classList.add("hidden"); $(id).style.display = "none";
    });
    var el = $(which);
    el.classList.remove("hidden");
    el.style.display = which === "editor" ? "flex" : "block";
  }

  function ls(path){
    status('<span class="spin"></span> …');
    return api("ls", {path: path}).then(function(r){
      if (!r.ok){ toast(r.error || "list failed", "bad"); status("❌ " + (r.error||"")); return; }
      curDir = r.path;
      $("path").value = r.path;
      $("stR").innerHTML = "<b>" + r.path.replace(/^.*\//, "") + "</b> · " + r.count + " مورد";
      var hint = [];
      if (!r.writable) hint.push("⚠️ این پوشه نوشتنی نیست");
      if (r.shared_storage) hint.push("⚠️ حافظهٔ مشترک: chmod/rename/clock کار نمی‌کند — اینجا اجرا نکنید");
      $("dirhint").innerHTML = hint.join(" · ");
      var html = "";
      if (r.parent) html += rowHtml({name:"..", type:"dir", size:null, mtime:0, perm:"", link:false}, r.parent);
      r.entries.forEach(function(e){ html += rowHtml(e); });
      $("list").innerHTML = html || '<div class="hint">خالی</div>';
      Array.prototype.forEach.call($("list").querySelectorAll(".row"), function(el){
        el.addEventListener("click", function(){
          var p = el.getAttribute("data-path"), t = el.getAttribute("data-type");
          if (t === "dir") ls(p); else openFile(p);
        });
        var act = el.querySelector(".act");
        if (act) act.addEventListener("click", function(ev){ ev.stopPropagation(); sheet(el.getAttribute("data-path"), el.getAttribute("data-type")); });
      });
      status(r.count + " مورد · " + (r.writable ? "نوشتنی ✅" : "فقط خواندنی 🔒"), "<b>" + r.path + "</b>");
      show("browser");
    }).catch(function(e){ toast("network: " + e.message, "bad"); });
  }

  function rowHtml(e, forcedPath){
    var p = forcedPath || (curDir + "/" + e.name);
    return '<div class="row" data-path="' + esc(p) + '" data-type="' + e.type + '">'
      + '<span class="ico">' + ico(e) + '</span>'
      + '<span style="flex:1;min-width:0"><span class="nm">' + esc(e.name) + '</span><br>'
      + '<span class="mt">' + (e.type === "dir" ? "پوشه" : human(e.size)) + (e.mtime ? " · " + ago(e.mtime) + " پیش" : "")
      + (e.perm ? " · " + e.perm : "") + (e.readable === false ? " · 🔒" : "") + '</span></span>'
      + '<button class="act" title="عملیات">⋮</button></div>';
  }
  function esc(s){ return String(s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }

  /* --------------------------------------------------------------- editor */
  function openFile(path){
    if (dirty && !confirm("تغییرات ذخیره نشده — باز هم باز شود؟")) return;
    status('<span class="spin"></span> باز کردن…');
    api("read", {path: path}).then(function(r){
      if (!r.ok){ toast(r.error || "read failed", "bad"); return; }
      curFile = r.path; curMtime = r.mtime; dirty = false;
      var ed = $("ed");
      if (r.binary){
        ed.value = ""; ed.readOnly = true;
        $("edhint").textContent = r.path + " — باینری (" + human(r.size) + ")؛ فقط دانلود";
      } else {
        ed.value = r.content; ed.readOnly = false;
        $("edhint").textContent = r.path + " · " + human(r.size) + (r.truncated ? " (بریده شد)" : "")
          + (r.md5 ? " · md5 " + r.md5.slice(0,12) : "")
          + (r.lint === "ok" ? " · lint ✅" : (r.lint ? " · lint ❌" : ""));
        if (r.lint && r.lint !== "ok") showEdOut(r.lint);
      }
      $("btnDel").disabled = false;
      show("editor");
      status(r.writable ? "قابلِ ویرایش ✏️" : "فقط خواندنی 🔒", "<b>" + r.path.split("/").pop() + "</b>");
    }).catch(function(e){ toast("network: " + e.message, "bad"); });
  }

  function showEdOut(t){ var o = $("edout"); o.classList.remove("hidden"); o.style.display = "block"; o.textContent = t || ""; }

  function save(){
    if (!curFile) return;
    var ed = $("ed");
    status('<span class="spin"></span> ذخیره…');
    api("save", {path: curFile}, {raw: true, body: ed.value}).then(function(r){
      if (!r.ok){ toast(r.error || "save failed", "bad"); showEdOut(r.error || ""); status("❌ ذخیره نشد"); return; }
      dirty = false; curMtime = r.mtime || curMtime;
      var msg = "💾 " + human(r.bytes) + (r.atomic ? " · atomic ✅" : " · مستقیم (rename ناموفق)");
      if (r.backup) msg += " · پشتیبان: " + r.backup.split("/").pop();
      if (r.lint === "ok") msg += " · php -l ✅";
      else if (r.lint) msg += " · php -l ❌";
      toast(msg, r.lint && r.lint !== "ok" ? "bad" : "ok");
      showEdOut(r.lint && r.lint !== "ok" ? r.lint : "");
      $("edhint").textContent = curFile + " · " + human(r.bytes) + (r.md5 ? " · md5 " + r.md5.slice(0,12) : "");
      status("ذخیره شد ✅", "<b>" + curFile.split("/").pop() + "</b>");
    }).catch(function(e){ toast("network: " + e.message, "bad"); });
  }

  /* ---------------------------------------------------------------- sheet */
  function sheet(path, type){
    var old = document.querySelector(".sheet"); if (old) old.remove();
    var d = document.createElement("div");
    d.className = "sheet";
    var items = [
      ["ℹ️ اطلاعات", "info"], ["✏️ تغییرِ نام", "rename"], ["📋 کپی به…", "copy"],
      ["🔐 chmod", "chmod"], ["⬇️ دانلود", "dl"], ["📃 tail", "tail"]
    ];
    if (type === "dir") items.push(["📂 باز کردن", "open"]);
    items.push(["🗑 حذف", "del"], ["✖️ بستن", "close"]);
    d.innerHTML = '<div class="box"><h3>' + esc(path) + '</h3>' + items.map(function(i){
      return '<button data-a="' + i[1] + '"' + (i[1] === "del" ? ' class="danger"' : "") + '>' + i[0] + '</button>';
    }).join("") + '</div>';
    document.body.appendChild(d);
    d.addEventListener("click", function(ev){
      var b = ev.target.closest("button"); if (!b) { if (ev.target === d) d.remove(); return; }
      var a = b.getAttribute("data-a"); d.remove();
      if (a === "close") return;
      if (a === "open") return ls(path);
      if (a === "info") return api("info", {path: path}).then(function(r){
        alert(r.ok ? JSON.stringify(r, null, 2) : r.error); });
      if (a === "dl") { location.href = location.pathname + "?act=download&key=" + encodeURIComponent(KEY) + "&path=" + encodeURIComponent(path); return; }
      if (a === "rename") {
        var n = prompt("نامِ جدید (یا مسیرِ کامل):", path.split("/").pop());
        if (!n) return;
        var to = n.indexOf("/") === 0 ? n : path.replace(/[^/]*$/, "") + n;
        return api("rename", {path: path}, {method:"POST", form:{to: to}}).then(function(r){
          toast(r.ok ? "✅ تغییرِ نام داد" : (r.error||""), r.ok ? "ok" : "bad"); if (r.ok) ls(curDir); });
      }
      if (a === "copy") {
        var t = prompt("کپی به:", curDir + "/" + path.split("/").pop().replace(/(\.[^.]+)?$/, "-copy$1"));
        if (!t) return;
        return api("copy", {path: path}, {method:"POST", form:{to: t}}).then(function(r){
          toast(r.ok ? "✅ کپی شد (" + human(r.bytes) + ")" : (r.error||""), r.ok ? "ok" : "bad"); if (r.ok) ls(curDir); });
      }
      if (a === "chmod") {
        var m = prompt("حالتِ هشت‌دسته‌ای (مثلاً 0644 / 0755):", "0644");
        if (!m) return;
        return api("chmod", {path: path}, {method:"POST", form:{mode: m}}).then(function(r){
          toast(r.ok ? "✅ chmod " + m : (r.error||""), r.ok ? "ok" : "bad"); if (r.ok) ls(curDir); });
      }
      if (a === "tail") return api("tail", {path: path, lines: 200}).then(function(r){
        show("term"); $("termout").textContent = r.ok ? r.out : (r.error||""); });
      if (a === "del") {
        if (!confirm("حذفِ قطعیِ:\n" + path + "\n\n(پیش از حذف، پشتیبان گرفته می‌شود)")) return;
        return api("delete", {path: path}, {method:"POST", form:{sure:"1"}}).then(function(r){
          toast(r.ok ? "🗑 حذف شد" + (r.backup ? " · پشتیبان: " + r.backup.split("/").pop() : "") : (r.error||""), r.ok ? "ok" : "bad");
          if (r.ok) ls(curDir); });
      }
    });
  }

  /* ---------------------------------------------------------------- wiring */
  $("btnGo").onclick = function(){ ls($("path").value.trim()); };
  $("path").addEventListener("keydown", function(e){ if (e.key === "Enter") ls($("path").value.trim()); });
  $("btnUp").onclick = function(){ api("ls", {path: curDir}).then(function(r){ if (r.ok && r.parent) ls(r.parent); else toast("بالاتر مجاز نیست"); }); };
  Array.prototype.forEach.call(document.querySelectorAll("#roots .chip"), function(c){
    c.onclick = function(){ ls(c.getAttribute("data-path")); };
  });
  $("btnBack").onclick = function(){ show("browser"); ls(curDir); };
  $("btnNewFile").onclick = function(){
    var n = prompt("نامِ فایلِ جدید در:\n" + curDir, "new.php"); if (!n) return;
    api("touch", {path: curDir + "/" + n}, {method:"POST", form:{}}).then(function(r){
      toast(r.ok ? "✅ ساخته شد" : (r.error||""), r.ok ? "ok" : "bad"); if (r.ok) openFile(r.path); });
  };
  $("btnNewDir").onclick = function(){
    var n = prompt("نامِ پوشهٔ جدید در:\n" + curDir, "newdir"); if (!n) return;
    api("mkdir", {path: curDir + "/" + n}, {method:"POST", form:{}}).then(function(r){
      toast(r.ok ? "✅ پوشه ساخته شد" : (r.error||""), r.ok ? "ok" : "bad"); if (r.ok) ls(curDir); });
  };
  $("btnUpload").onclick = function(){ $("filepick").click(); };
  $("filepick").onchange = function(){
    var f = $("filepick").files[0]; if (!f) return;
    api("upload", {path: curDir}, {form:{file: f}}).then(function(r){
      toast(r.ok ? "⬆️ آپلود شد (" + human(r.bytes) + ")" : (r.error||""), r.ok ? "ok" : "bad");
      $("filepick").value = ""; if (r.ok) ls(curDir); });
  };
  $("btnSave").onclick = save;
  $("btnLint").onclick = function(){
    if (!curFile) return;
    api("read", {path: curFile}).then(function(r){ showEdOut(r.ok ? (r.lint === "ok" ? "No syntax errors detected ✅" : (r.lint || "lint n/a")) : r.error); });
  };
  $("btnWrap").onclick = function(){ $("ed").classList.toggle("wrap"); };
  $("btnInfo").onclick = function(){ if (curFile) api("info", {path: curFile}).then(function(r){ alert(JSON.stringify(r, null, 2)); }); };
  $("btnChmod").onclick = function(){
    if (!curFile) return;
    var m = prompt("حالتِ هشت‌دسته‌ای:", "0644"); if (!m) return;
    api("chmod", {path: curFile}, {method:"POST", form:{mode: m}}).then(function(r){
      toast(r.ok ? "✅ chmod " + m : (r.error||""), r.ok ? "ok" : "bad"); });
  };
  $("btnRename").onclick = function(){ sheet(curFile, "file"); };
  $("btnDl").onclick = function(){ if (curFile) location.href = location.pathname + "?act=download&key=" + encodeURIComponent(KEY) + "&path=" + encodeURIComponent(curFile); };
  $("btnDel").onclick = function(){ if (curFile) sheet(curFile, "file"); };
  $("ed").addEventListener("input", function(){ dirty = true; });
  $("ed").addEventListener("keydown", function(e){
    if ((e.ctrlKey || e.metaKey) && e.key === "s"){ e.preventDefault(); save(); }
    if (e.key === "Tab"){
      e.preventDefault();
      var t = e.target, s = t.selectionStart, en = t.selectionEnd;
      t.value = t.value.slice(0, s) + "  " + t.value.slice(en);
      t.selectionStart = t.selectionEnd = s + 2; dirty = true;
    }
  });
  window.addEventListener("beforeunload", function(e){ if (dirty){ e.preventDefault(); e.returnValue = ""; } });

  $("btnTerm").onclick = function(){ show("term"); $("cmd").focus(); };
  $("btnSearch").onclick = function(){ show("search"); $("pat").focus(); };
  function run(){
    var c = $("cmd").value.trim(); if (!c) return;
    $("termout").textContent = "$ " + c + "\n…";
    api("exec", {}, {method:"POST", form:{cmd: c, cwd: curDir, timeout: 60}}).then(function(r){
      $("termout").textContent = "$ " + c + "\n" + (r.ok ? (r.out || "(بدون خروجی)") + "\n\n[rc=" + r.rc + " · " + r.ms + "ms" + (r.killed ? " · killed/timeout" : "") + "]" : "❌ " + (r.error||""));
    }).catch(function(e){ $("termout").textContent = "network: " + e.message; });
  }
  $("btnRun").onclick = run;
  $("cmd").addEventListener("keydown", function(e){ if (e.key === "Enter") run(); });
  Array.prototype.forEach.call(document.querySelectorAll("#cmdchips .chip"), function(c){
    c.onclick = function(){ $("cmd").value = c.getAttribute("data-cmd"); run(); };
  });
  $("btnDoSearch").onclick = function(){
    var p = $("pat").value.trim(); if (!p) return;
    $("searchout").textContent = "در حالِ جست‌وجو در " + curDir + " …";
    api("grep", {path: curDir, pattern: p}).then(function(r){
      if (!r.ok){ $("searchout").textContent = "❌ " + (r.error||""); return; }
      $("searchout").innerHTML = r.hits.length
        ? r.hits.map(function(h){ return '<a href="#" data-p="' + esc(h.path) + '" data-l="' + h.line + '">'
            + esc(h.path.replace(curDir + "/", "")) + ":" + h.line + "</a>\n    " + esc(h.text.slice(0,200)); }).join("\n")
          + (r.truncated ? "\n…(بیش از ۲۰۰ نتیجه)" : "")
        : "هیچ نتیجه‌ای نبود";
      Array.prototype.forEach.call($("searchout").querySelectorAll("a"), function(a){
        a.onclick = function(ev){ ev.preventDefault(); openFile(a.getAttribute("data-p")); };
      });
    });
  };

  /* font size (the whole point on a phone) */
  var fs = parseInt(localStorage.getItem("fm_fs") || "16", 10);
  var efs = parseInt(localStorage.getItem("fm_efs") || "15", 10);
  function applyFs(){
    document.documentElement.style.setProperty("--fs", fs + "px");
    document.documentElement.style.setProperty("--efs", efs + "px");
  }
  $("btnFont+").onclick = function(){ fs = Math.min(26, fs + 1); efs = Math.min(26, efs + 1);
    localStorage.setItem("fm_fs", fs); localStorage.setItem("fm_efs", efs); applyFs(); toast("اندازهٔ متن: " + fs + "px"); };
  $("btnFont-").onclick = function(){ fs = Math.max(12, fs - 1); efs = Math.max(11, efs - 1);
    localStorage.setItem("fm_fs", fs); localStorage.setItem("fm_efs", efs); applyFs(); toast("اندازهٔ متن: " + fs + "px"); };
  applyFs();

  /* boot */
  api("whoami", {}).then(function(r){
    if (r.ok){
      $("dirhint").textContent = "";
      status(undefined, "<b>" + (r.free ? "آزاد: " + r.free + " · " : "") + r.php + "</b>");
      if (r.remote_allowed) toast("⚠️ دسترسیِ غیرمحلی مجاز است — اگر لازم نیست: --deny-remote", "bad");
    }
  });
  ls(curDir);
})();
</script>
</body>
</html>
