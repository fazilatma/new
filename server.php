<?php
/**
 * روتر + نگهبانِ راه‌اندازیِ سرورِ داخلیِ PHP برای وب‌اپ scraper4
 * (فقط وقتی استفاده می‌شود که با «php -S» + server.sh / start_cmd اجرا شود)
 *
 *  v10.175 — نگهبانِ سکوت‌شکسته:
 *  هیچ خطای Fatal (E_ERROR / E_PARSE در هنگام include / استثنای گیرنیافتاده)
 *  دیگر «HTTP 500 بدون هیچ متنی در لاگ» نمی‌شود. هر خطا سه‌جا می‌رود:
 *    ۱) console-error.log کنارِ اپ (با سقفِ حجم — پرتگاه نمی‌شود)
 *    ۲) stderr سرور (همان کانالی که کنسول در «لاگ سرویس» نشان می‌دهد)
 *    ۳) بدنهٔ پاسخِ HTTP (تا بدونِ بازکردنِ لاگ هم ببینید چه اتفاقی افتاده)
 *  خاموش‌کردن خروجیِ بدنه: متغیرِ محیطی S4_BOOT_DEBUG=0
 *
 *  تریست: curl http://127.0.0.1:8000/?ping=1
 *    - پاسخ داد ولی «/» خطا داد → مشکل داخل اپ است و متنش همان‌جا چاپ می‌شود
 *    - پاسخ نداد → سرویس اصلاً بالا نیامده یا پروکسیِ کنسول قطع است (نه اپ)
 */

error_reporting(E_ALL);
@ini_set('display_errors', 'stderr');
@ini_set('display_startup_errors', '1');
@ini_set('log_errors', '1');

/* ---------- نگهبان: گزارشگرِ مرکزی ---------- */
$S4_BOOT = [
    'log'   => __DIR__ . '/console-error.log',
    'debug' => getenv('S4_BOOT_DEBUG') !== '0',
];

$s4_boot_report = function (string $title, string $detail): void {
    $line = '[' . date('Y-m-d H:i:s') . '] ' . $title . ': ' . $detail . "\n";

    /* ۲) stderr — کانال پیش‌فرضِ «لاگ سرویس» در کنسول‌ها */
    @error_log($line);

    /* ۱) فایلِ اختصاصی کنارِ اپ (اگر پوشه نوشتنی نبود → tmp) */
    $log = $GLOBALS['S4_BOOT']['log'];
    if (@is_file($log) && @filesize($log) > 262144) {
        @file_put_contents($log, $line, LOCK_EX);           /* حجمِ اضافه → ری‌استارتِ فایل */
    } elseif (@file_put_contents($log, $line, FILE_APPEND | LOCK_EX) === false) {
        @file_put_contents(sys_get_temp_dir() . '/scraper4-console-error.log', $line, FILE_APPEND | LOCK_EX);
    }

    /* ۳) بدنهٔ پاسخ */
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: text/plain; charset=UTF-8');
    }
    if (!empty($GLOBALS['S4_BOOT']['debug'])) {
        echo "── scraper4 boot/runtime error (v10.175) ───────────────────\n";
        echo $title . "\n" . $detail . "\n";
        echo "──────────────────────────────────────────────────────────────\n";
        echo "این متن عمداً چاپ می‌شود تا بدونِ دسترسی به لاگ، علت دیده شود.\n";
        echo "برای خاموش‌کردنِ آن بعد از رفع مشکل: S4_BOOT_DEBUG=0 در env سرویس.\n";
        echo "جزئیات هم در console-error.log کنارِ اپ و هم در لاگِ سرویسِ کنسول است.\n";
    } else {
        echo "خطای داخلی هنگام اجرای اپ — جزئیات در console-error.log و لاگِ سرویسِ کنسول\n";
    }
};

set_exception_handler(function ($ex) use ($s4_boot_report): void {
    $s4_boot_report(
        'Unhandled Throwable',
        get_class($ex) . ': ' . $ex->getMessage()
        . ' @ ' . $ex->getFile() . ':' . $ex->getLine()
    );
});

register_shutdown_function(function () use ($s4_boot_report): void {
    $e = error_get_last();
    if ($e && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true)) {
        $s4_boot_report(
            'Fatal',
            $e['message'] . ' @ ' . $e['file'] . ':' . $e['line']
            . ' (type=' . $e['type'] . ')'
        );
    }
});
/* ---------- پایان نگهبان ---------- */

$app = __DIR__ . '/scraper4.php';

/* فرمانِ تریست — بدونِ لوندنِ اپ: ثابت می‌کند PHP و روتر سالم‌اند */
if (isset($_GET['ping'])) {
    header('Content-Type: text/plain; charset=UTF-8');
    $ver = '?';
    $snap = @file_get_contents($app, false, null, 0, 20000);
    if (is_string($snap) && preg_match("/APP_VERSION\\s*=\\s*'([^']+)'/", $snap, $m)) {
        $ver = $m[1];
    }
    $wk = @json_decode((string)@file_get_contents(__DIR__ . '/worker_state.json'), true);
    $wkActive = is_array($wk) && !empty($wk['running']) && (time() - (int)($wk['heartbeat'] ?? 0) <= 45);
    echo 'boot-ok | scraper4 v' . $ver
       . ' | php ' . PHP_VERSION
       . ' | curl' . (extension_loaded('curl') ? '+' : '-')
       . ' mb' . (extension_loaded('mbstring') ? '+' : '-')
       . ' sqlite' . ((extension_loaded('sqlite3') || extension_loaded('pdo_sqlite')) ? '+' : '-')
       . ' | workers=' . (getenv('PHP_CLI_SERVER_WORKERS') ?: '1')
       . ' | op-worker=' . ($wkActive ? 'on' : 'off') . "\n";
    $log = $GLOBALS['S4_BOOT']['log'];
    if (is_file($log)) {
        $tail = @file_get_contents($log, false, null, max(0, (int)@filesize($log) - 2000));
        if (is_string($tail) && trim($tail) !== '') {
            echo "── console-error.log (آخرین بخش) ──\n" . trim($tail) . "\n";
        }
    }
    return true;
}

if (!is_file($app)) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=UTF-8');
    echo "scraper4.php پیدا نشد — کنارِ server.php قرارش دهید.";
    return true;
}

$uri  = (string)($_SERVER['REQUEST_URI'] ?? '/');
$path = parse_url($uri, PHP_URL_PATH);
$path = is_string($path) ? $path : '/';

if ($path !== '/' && $path !== '/index.php') {
    $real = realpath(__DIR__ . '/' . ltrim($path, '/'));
    /* فقط فایل‌های داخلِ همین پوشه سرو شوند (جلوگیری از path traversal) */
    if ($real !== false && is_file($real)
        && strpos($real, __DIR__ . DIRECTORY_SEPARATOR) === 0) {
        /* v10.175: فایل‌های حساس هرگز به‌صورت استاتیک دانلود نشوند */
        static $deny = ['console-error.log' => 1, 'connections.json' => 1, 'profiles.json' => 1];
        if (!isset($deny[basename($real)])) {
            return false;   /* سرو پیش‌فرضِ سرورِ داخلی: PHP اجرا، بقیه خام */
        }
    }
}

/* هر مسیرِ دیگری به اپ می‌رسد — نگهبانِ بالا همراه است */
require $app;
return true;
