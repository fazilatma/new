<?php
/**
 * روترِ سرورِ داخلیِ PHP برای وب‌اپ scraper4
 * (فقط وقتی استفاده می‌شود که با «php -S» + server.sh اجرا شود)
 *
 *  - «/» و «/index.php»  → اپ
 *  - فایلِ واقعی داخل ریشه → خودِ سرور سرو می‌کند (PHP اجرا، استاتیک عبور)
 *  - هر مسیرِ دیگر        → اپ (تا آدرس‌های تمیز هم کار کنند)
 */

$app = __DIR__ . '/scraper4.php';

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
        return false;   /* سرو پیش‌فرضِ سرورِ داخلی: PHP اجرا، بقیه خام */
    }
}

/* هر مسیرِ دیگری به اپ می‌رسد */
require $app;
return true;
