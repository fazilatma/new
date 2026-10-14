<?php
/* =====================================================================
 *  deploy-doctor.php — «چرا پنل استقرار وارد نمی‌شود؟»
 *
 *  یک فایل تشخیصیِ بدونِ وابستگی است؛ همان‌جا کنار deploy.php بگذارید و
 *  اجرا کنید. هم در خطِ فرمانِ ترموکس کار می‌کند هم در مرورگر:
 *
 *     php deploy-doctor.php                 # بررسی deploy.php کنارِ خودش
 *     php deploy-doctor.php path/to/x.php   # بررسی یک فایلِ دیگر
 *     php deploy-doctor.php --fix           # ساختِ نسخهٔ تعمیرشده (deploy.fixed.php)
 *
 *  در مرورگر:  http://127.0.0.1:8080/deploy-doctor.php?file=deploy.php
 *
 *  چه چیزی را چک می‌کند (به ترتیبِ اهمیت برای ترموکس):
 *    ۱) آلودگیِ فایل به entity‌های HTML (=&gt; و &lt; و &amp;) — شایع‌ترین
 *       علتِ «صفحهٔ خالی/۵۰۰» وقتی فایل از یک صفحهٔ وب یا چت کپی شده باشد.
 *    ۲) خطای نحویِ واقعی با token_get_all(TOKEN_PARSE) + چاپِ همان خط.
 *    ۳) BOM یا فاصله پیش از <?php (خراب‌کنندهٔ JSON و header).
 *    ۴) قابل نوشتن بودنِ پوشه: نوشتن، chmod و جایگزینیِ اتمیک با rename —
 *       دقیقاً همان سه کاری که do_deploy() و cfg_save() نیاز دارند.
 *    ۵) قرار داشتن روی حافظهٔ مشترکِ اندروید (/sdcard یا /storage/...) که
 *       در ترموکس chmod/rename درست کار نمی‌کند.
 *    ۶) .htaccessِ مسدودکننده (Require all denied بدونِ FilesMatch) که زیرِ
 *       Apache همه‌چیز را ۴۰۳ می‌کند — «وارد نمی‌شود» واقعی.
 *    ۷) افزونه‌ها/توابعِ لازم: curl، openssl، hash_pbkdf2، random_bytes…
 *    ۸) وضعیتِ .deploy-config.json (تعیین می‌کند پنل روی «راه‌اندازی اولیه»
 *       بماند یا وارد تب‌ها شود).
 * ===================================================================== */

declare(strict_types=1);
error_reporting(E_ALL);
ini_set('display_errors', '1');

$isCli = PHP_SAPI === 'cli';
$root  = __DIR__;
$argvv = $isCli ? array_slice($argv ?? [], 1) : [];

$doFix = false;
$target = '';
foreach ($argvv as $a) {
    if ($a === '--fix' || $a === '-f') { $doFix = true; continue; }
    if ($a !== '' && $a[0] !== '-') $target = $a;
}
if ($target === '') $target = (string)($_GET['file'] ?? 'deploy.php');
if (!preg_match('~^([A-Za-z]:)?[~/]~', $target)) $target = rtrim($root, '/') . '/' . ltrim($target, '/');
if (isset($_GET['fix'])) $doFix = true;

$lines = [];
$fails = 0; $warns = 0;
$ok  = function (string $t, string $n = '') use (&$lines) { $lines[] = "✅  $t" . ($n !== '' ? " — $n" : ''); };
$wn  = function (string $t, string $n = '') use (&$lines, &$warns) { $warns++; $lines[] = "⚠️  $t" . ($n !== '' ? " — $n" : ''); };
$bad = function (string $t, string $n = '') use (&$lines, &$fails) { $fails++; $lines[] = "❌  $t" . ($n !== '' ? " — $n" : ''); };
$inf = function (string $t) use (&$lines) { $lines[] = "•   $t"; };
$hdr = function (string $t) use (&$lines) { $lines[] = ''; $lines[] = "── $t " . str_repeat('─', max(0, 56 - mb_strlen($t))); };

$lines[] = '🩺 deploy-doctor  ·  PHP ' . PHP_VERSION . ' (' . PHP_SAPI . ')  ·  ' . date('Y-m-d H:i:s');
$lines[] = '   پوشهٔ اسکریپت: ' . $root;
$lines[] = '   فایلِ هدف:     ' . $target;

/* ---------------------------------------------------------- محیط */
$hdr('محیطِ اجرا');
$inf('سیستم: ' . PHP_OS . ' · ' . (function_exists('php_uname') ? php_uname('m') : '?'));
$disabled = array_values(array_filter(array_map('trim', explode(',', (string)ini_get('disable_functions')))));
$inf('توابعِ غیرفعال: ' . ($disabled ? implode(', ', $disabled) : 'هیچ'));
if (version_compare(PHP_VERSION, '7.4.0', '>=')) $ok('نسخهٔ PHP', PHP_VERSION);
else $bad('نسخهٔ PHP خیلی قدیمی است', PHP_VERSION . ' — پنل به ۷٫۴ به بالا نیاز دارد (fn() و null-coalescing)');

foreach ([
    'curl' => 'curl_init', 'openssl' => 'openssl_encrypt', 'mbstring' => 'mb_substr',
    'json' => 'json_encode', 'hash' => 'hash_pbkdf2', 'zlib' => 'gzdecode',
] as $ext => $fn) {
    if (function_exists($fn)) $ok("افزونه/تابعِ $ext", $fn . '()');
    elseif ($ext === 'zlib' || $ext === 'mbstring') $wn("افزونهٔ $ext نیست", 'برخی بخش‌ها fallback دارند');
    else $bad("افزونهٔ $ext نیست", "بدونِ $fn() بخشی از پنل کار نمی‌کند");
}
foreach (['random_bytes', 'hash_equals', 'token_get_all', 'disk_free_space', 'rename', 'chmod'] as $fn) {
    if (!function_exists($fn)) $bad("تابعِ $fn موجود نیست");
}

/* ---------------------------------------------------------- فایلِ هدف */
$hdr('فایلِ پنل');
$code = null;
if (!is_file($target)) {
    $bad('فایل پیدا نشد', 'مسیر را با pwd بررسی کنید: php deploy-doctor.php /مسیر/دقیق/deploy.php');
} else {
    $code = (string)file_get_contents($target);
    $size = strlen($code);
    $inf('حجم: ' . number_format($size) . ' بایت  ·  md5: ' . md5($code) . '  ·  خط‌ها: ' . (substr_count($code, "\n") + 1));
    if ($size < 20000) $wn('حجم فایل کم است', 'پنلِ کامل معمولاً بیش از ۳۰ کیلوبایت است — احتمالاً فایل ناقص کپی شده');

    /* BOM / فاصلهٔ پیش از <?php */
    if (strncmp($code, "\xEF\xBB\xBF", 3) === 0) $bad('فایل با BOM شروع می‌شود', 'header و JSON خراب می‌شود؛ باید حذف شود');
    elseif (strncmp(ltrim($code), '<?php', 5) !== 0) $bad('فایل با <?php شروع نمی‌شود', 'اولین بایت‌ها: ' . substr($code, 0, 24));
    else $ok('با <?php شروع می‌شود');

    /* آلودگی به entity‌های HTML — مهم‌ترین تشخیص */
    $ents = ['=&gt;' => 0, '&lt;' => 0, '&amp;' => 0, '&quot;' => 0, '&#039;' => 0, '&apos;' => 0];
    foreach ($ents as $k => $_) $ents[$k] = substr_count($code, $k);
    $totEnt = array_sum($ents);
    if ($totEnt > 0) {
        $detail = [];
        foreach ($ents as $k => $v) if ($v > 0) $detail[] = "$k ×$v";
        $bad('فایل با entity‌های HTML آلوده است', implode(' · ', $detail));
        $lines[] = '     ↳ یعنی کد از یک صفحهٔ وب/چت کپی شده و به‌جایِ => و < و & متنِ رمزشده نشسته است.';
        $lines[] = '     ↳ این به‌تنهایی باعثِ خطای نحوی و صفحهٔ خالی/۵۰۰ می‌شود. با --fix نسخهٔ سالم ساخته می‌شود.';
    } else {
        $ok('آلودگیِ entity ندارد');
    }

    /* خطای نحوی */
    try {
        token_get_all($code, TOKEN_PARSE);
        $ok('بررسیِ نحوی (token_get_all TOKEN_PARSE)', 'بدونِ خطا');
    } catch (Throwable $e) {
        $bad('خطای نحوی در فایل', $e->getMessage() . ' — خط ' . $e->getLine());
        $ls = explode("\n", $code);
        for ($i = max(0, $e->getLine() - 3); $i < min(count($ls), $e->getLine() + 2); $i++) {
            $lines[] = '     ' . ($i + 1 === $e->getLine() ? '>> ' : '   ') . ($i + 1) . ': ' . mb_substr($ls[$i], 0, 200);
        }
    }

    /* نشانهٔ پایانِ فایل */
    $tail = trim(substr($code, -200));
    if ($tail === '') $wn('پایان فایل خالی است');
    elseif (strpos($tail, '</html>') === false && strpos($tail, '?>') === false && substr_count($code, '</html>') === 0) {
        $wn('پایانِ مورد انتظار دیده نمی‌شود', 'فایل احتمالاً وسطِ کار بریده شده (truncate)');
    } else $ok('فایل کامل به نظر می‌رسد');
}

/* ---------------------------------------------------------- پوشه و دسترسی */
$hdr('پوشه و دسترسیِ نوشتن');
$shared = (bool)preg_match('~^/(sdcard|storage|mnt/(sdcard|shared|media))~i', $root)
    || strpos($root, '/storage/emulated/') !== false
    || strpos($root, 'storage/shared') !== false;
if ($shared) {
    $bad('پوشه روی حافظهٔ مشترکِ اندروید است', $root);
    $lines[] = '     ↳ در /sdcard نه chmod درست کار می‌کند نه rename اتمیک؛ پنل نمی‌تواند .deploy-config.json را بنویسد.';
    $lines[] = '     ↳ راه‌حل: mkdir -p ~/deploy && cp deploy.php ~/deploy/ && cd ~/deploy';
} else $ok('پوشه داخلِ فضای خصوصیِ ترموکس است', $root);

if (is_writable($root)) $ok('پوشه قابل نوشتن است');
else $bad('پوشه قابل نوشتن نیست', 'is_writable=false — بدونِ آن، راه‌اندازیِ پنل هرگز تمام نمی‌شود');

$probe = $root . '/.doctor-probe-' . bin2hex(random_bytes(3));
$w = @file_put_contents($probe, 'x');
if ($w === false) $bad('نوشتنِ فایلِ آزمایشی ناموفق بود');
else {
    $ok('نوشتنِ فایل موفق بود');
    if (@chmod($probe, 0600)) $ok('chmod موفق بود'); else $wn('chmod کار نمی‌کند', 'روی حافظهٔ مشترک طبیعی است');
    if (@rename($probe, $probe . '.2')) { $ok('جایگزینیِ اتمیک (rename) موفق بود'); @unlink($probe . '.2'); }
    else { $bad('rename ناموفق بود', 'do_deploy() برای نصبِ اتمیک به آن نیاز دارد'); @unlink($probe); }
}

/* ---------------------------------------------------------- .htaccess */
$hdr('.htaccess');
$ht = $root . '/.htaccess';
if (!is_file($ht)) $ok('.htaccess وجود ندارد', 'برای سرورِ داخلیِ PHP لازم هم نیست');
else {
    $c = (string)file_get_contents($ht);
    $inf('.htaccess: ' . str_replace("\n", ' | ', trim($c)));
    $denies = (bool)preg_match('~(Require all denied|Deny from all)~i', $c);
    $scoped = (bool)preg_match('~<(FilesMatch|Files|IfModule)~i', $c);
    if ($denies && !$scoped) {
        $bad('.htaccess همه‌چیز را مسدود می‌کند', 'Require all denied بدونِ <FilesMatch>');
        $lines[] = '     ↳ زیرِ Apache تمامِ صفحه‌ها ۴۰۳ می‌شوند — یعنی دقیقاً «وارد نمی‌شود».';
        $lines[] = '     ↳ راه‌حل: mv .htaccess .htaccess.bak  (سرورِ داخلیِ PHP اصلاً آن را نمی‌خواند)';
    } elseif ($denies) $ok('.htaccess فقط فایل‌های حساس را مسدود می‌کند');
    else $ok('.htaccess بی‌خطر است');
}

/* ---------------------------------------------------------- وضعیتِ پنل */
$hdr('وضعیتِ تنظیماتِ پنل');
$cfgF = $root . '/.deploy-config.json';
if (!is_file($cfgF)) {
    $wn('.deploy-config.json ساخته نشده', 'پس پنل روی «راه‌اندازی اولیه» می‌ماند؛ اگر با زدنِ راه‌اندازی ساخته نشد، علتش نوشتنِ ناموفق است');
} else {
    $d = json_decode((string)file_get_contents($cfgF), true);
    if (!is_array($d)) $bad('.deploy-config.json خراب است', 'JSON نامعتبر — حذفش کنید تا راه‌اندازی دوباره اجرا شود');
    else {
        $ok('.deploy-config.json خوانا است', 'api_token: ' . (empty($d['api_token']) ? 'خالی ⇒ هنوز راه‌اندازی نشده' : 'ست شده ⇒ پنل باید باز شود'));
        $inf('repo: ' . (string)($d['repo'] ?? '-') . ' · branch: ' . (string)($d['branch'] ?? '-') . ' · jobs: ' . count((array)($d['jobs'] ?? [])));
        if (!empty($d['api_token']) && !is_writable($cfgF)) $wn('فایلِ تنظیمات قابل نوشتن نیست', 'ذخیرهٔ تغییرات شکست می‌خورد');
    }
}
if (is_file($root . '/.deploy-log.json')) $inf('لاگ: ' . number_format((int)filesize($root . '/.deploy-log.json')) . ' بایت');
$bkdir = $root . '/_backups';
$inf('پوشهٔ بکاپ: ' . (is_dir($bkdir) ? 'هست (' . count(glob($bkdir . '/*.bak') ?: []) . ' نسخه)' : 'نیست'));

/* ---------------------------------------------------------- حالتِ وب */
if (!$isCli) {
    $hdr('دسترسیِ وب');
    $inf('REQUEST_URI: ' . (string)($_SERVER['REQUEST_URI'] ?? '-'));
    $inf('METHOD: ' . (string)($_SERVER['REQUEST_METHOD'] ?? '-'));
    $port = (int)($_SERVER['SERVER_PORT'] ?? 8080);
    $inf('سرورِ پیشنهادی: php -S 127.0.0.1:' . $port . ' -t ' . escapeshellarg($root));
    if (strpos((string)($_SERVER['REQUEST_URI'] ?? ''), 'deploy-doctor') !== false) {
        $ok('همین فایل در مرورگر اجرا شد', 'یعنی PHP درست کار می‌کند؛ مشکل از خودِ deploy.php یا دسترسیِ نوشتن است');
    }
}

/* ---------------------------------------------------------- تعمیر */
if ($doFix && $code !== null) {
    $hdr('تعمیر');
    $fixedCode = $code;
    if (strncmp($fixedCode, "\xEF\xBB\xBF", 3) === 0) $fixedCode = substr($fixedCode, 3);
    $fixedCode = preg_replace('~^(\s+)~', '', $fixedCode, 1);
    if (strpos($fixedCode, '<?php') !== 0) $fixedCode = "<?php\n" . $fixedCode;
    $n1 = substr_count($fixedCode, '&gt;') + substr_count($fixedCode, '&lt;') + substr_count($fixedCode, '&amp;');
    if ($n1 > 0) {
        /* فقط وقتی entity‌ها واقعاً کد را خورده‌اند رمزشایی کنیم؛ &amp; داخلِ
           متنِ فارسی/HTMLِ رابط باید درست باز شود، پس ترتیب مهم است. */
        $fixedCode = str_replace(['&lt;', '&gt;', '&quot;', '&#039;', '&apos;'], ['<', '>', '"', "'", "'"], $fixedCode);
        $fixedCode = str_replace('&amp;', '&', $fixedCode);
        $lines[] = '•   ' . $n1 . ' entity باز شد';
    }
    $out = dirname($target) . '/' . preg_replace('~\.php\d?$~i', '', basename($target)) . '.fixed.php';
    if (@file_put_contents($out, $fixedCode, LOCK_EX) === false) {
        $bad('نوشتنِ فایلِ تعمیرشده ناموفق بود', $out);
    } else {
        $ok('فایلِ تعمیرشده نوشته شد', $out . ' (' . number_format(strlen($fixedCode)) . ' بایت)');
        try { token_get_all($fixedCode, TOKEN_PARSE); $ok('فایلِ تعمیرشده خطای نحوی ندارد'); }
        catch (Throwable $e) { $bad('فایلِ تعمیرشده هنوز خطای نحوی دارد', $e->getMessage() . ' — خط ' . $e->getLine()); }
        $lines[] = '     ↳ اگر سالم بود: cp ' . basename($out) . ' ' . basename($target);
    }
}

/* ---------------------------------------------------------- جمع‌بندی */
$lines[] = '';
$lines[] = str_repeat('═', 64);
if ($fails === 0 && $warns === 0) $lines[] = '🟢 نتیجه: هیچ مشکلِ بازدارنده‌ای پیدا نشد.';
elseif ($fails === 0) $lines[] = '🟡 نتیجه: مشکلِ بحرانی نیست، ' . $warns . ' هشدار را ببینید.';
else $lines[] = '🔴 نتیجه: ' . $fails . ' مشکلِ بازدارنده پیدا شد (بالا را ببینید).';
$lines[] = 'دستورِ اجرای درست در ترموکس:';
$lines[] = '   cd ' . ($shared ? '~/deploy   # اول فایل را از /sdcard بیرون بیاورید' : $root);
$lines[] = '   php -S 127.0.0.1:8080 -t .';
$lines[] = '   # سپس در مرورگرِ همان گوشی: http://127.0.0.1:8080/deploy.php';

$text = implode("\n", $lines) . "\n";
if ($isCli) { echo $text; exit($fails > 0 ? 1 : 0); }
header('Content-Type: text/html; charset=UTF-8');
header('X-Content-Type-Options: nosniff');
echo '<!doctype html><meta charset="utf-8"><title>deploy-doctor</title>'
   . '<body style="background:#0b1220;color:#e2e8f0;font:13px/1.9 monospace;padding:18px;direction:rtl">'
   . '<pre style="white-space:pre-wrap;direction:ltr;text-align:left">' . htmlspecialchars($text, ENT_QUOTES, 'UTF-8') . '</pre></body>';
