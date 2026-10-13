<?php
/**
 * console/preflight.php — بررسی محیطِ PHP قبل از استقرار scraper4
 * ------------------------------------------------------------------
 * این فایل را کنسول به‌عنوان install_cmd اجرا می‌کند تا اگر محیط برای اجرای
 * اپ ناقص است، دیپلوی با پیامِ واضح شکست بخورد به‌جای «HTTP 500» دیرهنگام.
 * خروج با کد غیرصفر یعنی مشکل یافت شد.
 */
error_reporting(E_ALL);

$fails = [];
$warns = [];
$oks = [];

$phpv = PHP_VERSION;
if (version_compare($phpv, '7.4.0', '>=')) {
    $oks[] = "نسخهٔ PHP $phpv — همراستا (نیاز: 7.4+) و سرورِ داخلی چندکارگر را هم پشتیبانی می‌کند";
} elseif (version_compare($phpv, '7.2.0', '>=')) {
    $warns[] = "نسخهٔ PHP $phpv — اپ کار می‌کند ولی سرورِ داخلی تک‌کارگر است (PHP < 7.4)";
} else {
    $fails[] = "نسخهٔ PHP $phpv خیلی قدیمی است؛ حداقل 7.2 لازم است (توصیه: 8.1+)";
}

/* افزونه‌های الزامیِ خودِ اپ */
$required = [
    'curl'     => 'برای واکشیِ صفحات و هر اتصال HTTP',
    'json'     => 'برای connections.json و APIها',
    'mbstring' => 'برای متنِ فارسی/یونیکد',
    'openssl'  => 'برای https و امضای درخواست‌ها',
];
foreach ($required as $ext => $why) {
    if (extension_loaded($ext)) $oks[] = "افزونهٔ $ext — موجود ($why)";
    else $fails[] = "افزونهٔ $ext پیدا نشد — $why. جای درست‌کردن: نصب‌کنندهٔ full-stack خودِ کنسول / مدیر هاست (این محیط معمولاً apt ندارد)";
}

/* SQLite برای دفتر کارهای محلی (v10.170) — خودِ اپ بدون آن هم کار می‌کند */
if (extension_loaded('sqlite3') || extension_loaded('pdo_sqlite')) {
    $oks[] = 'افزونهٔ sqlite3/pdo_sqlite — موجود (دفتر کارهای محلی v10.170)';
} else {
    $warns[] = 'sqlite3/pdo_sqlite نیست — خودِ اپ با مسیرِ JSONِ اتمیک کار می‌کند (v10.170 گفته: «بدون هاردِ فیل»). فقط چند قابلیت لجر از دسترس می‌افتد — علت 500 نیست';
}

/* مفید ولی اختیاری */
foreach ([
    'zip'      => 'خروجی/بازگردانی فایل‌های فشرده',
    'dom'      => 'تحلیل HTML سمت سرور',
    'intl'     => 'عملیات چندزبانهٔ پیشرفته',
    'gd'       => 'پردازش تصویر',
] as $ext => $why) {
    if (extension_loaded($ext)) $oks[] = "اختیاری $ext — موجود ($why)";
    else $warns[] = "اختیاری $ext نیست — $why (دردسر نمی‌سازد ولی هشدار)";
}

/* نوشتنی‌بودنِ پوشهٔ نصب — connections.json و لاگ‌ها همین‌جا ساخته می‌شوند */
$dir = realpath(__DIR__ . '/..');
if ($dir && is_writable($dir)) {
    $oks[] = "پوشهٔ نصب نوشتنی‌است: $dir";
} else {
    $fails[] = "پوشهٔ نصب نوشتنی نیست: " . ($dir ?: __DIR__) . ' — معمولاً روی فایل‌پرمیشن فیلد پروژه با «استفاده از مسیر قابل‌نوشتن مدیریت‌شده» درست می‌شود';
}

/* چکِ کارکردِ curl — فقط موجودی افزونه کافی نیست */
if (function_exists('curl_init')) {
    $ch = @curl_init('https://www.google.com/generate_204');
    if ($ch) {
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER=>true, CURLOPT_CONNECTTIMEOUT=>5, CURLOPT_TIMEOUT=>8]);
        @curl_exec($ch);
        $code = (int)@curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if ($code > 0) $oks[] = "خروج HTTPS اینترنتی از PHP — موجود (HTTP $code)";
        else $warns[] = 'curl به اینترنت وصل نشد — اگر پشت پروکسی/فایروال هستید، تنظیمات عبورِ خودِ اپ (دکمه‌ی src_net در رابط) پوشش می‌دهد';
    }
}

$tz = ini_get('date.timezone');
if ($tz === '' || $tz === 'UTC') {
    $warns[] = "date.timezone خالی است؛ برای گزارش‌های شمسی/ساعت‌ها «TZ=Asia/Tehran» را در env کنسول بگذارید (همان جی‌سونی که دادید همین را ست کرده)";
}

echo "════════════════ scraper4 preflight ════════════════\n";
foreach ($oks as $m)   echo "✓ $m\n";
foreach ($warns as $m) echo "⚠ $m\n";
$lvl = 'OK';
if ($fails) {
    $lvl = 'FAIL';
    echo "─────────────────────────────────────────\n";
    foreach ($fails as $m) echo "✗ $m\n";
    echo "\nاین موارد صراحتاً باعث HTTP 500 هنگام بازکردن اپ می‌شوند.\n";
    echo "پیش از تلاش مجدد: افزونه‌ها را نصب و دیپلوی را دوباره بزنید.\n";
}
echo "══════════════════ status: $lvl ══════════════════\n";
exit($fails ? 1 : 0);
