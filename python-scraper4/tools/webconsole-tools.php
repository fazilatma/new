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
