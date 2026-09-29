<?php

return [

    /*
    |--------------------------------------------------------------------------
    | تنظیمات دامنهٔ scraper4
    |--------------------------------------------------------------------------
    | معادلِ پیکربندیِ پراکندهٔ اپلیکیشن قدیمی (ثابت‌های بالای scraper4.php
    | و رکوردهای connections.json) — حالا متمرکز و env‌پذیر.
    */

    // پل به اپلیکیشن قدیمی (مهاجرت فازبه‌فاز / Strangler)
    'legacy_path' => env('SCRAPER_LEGACY_PATH', base_path('../scraper4.php')),
    'legacy_dir'  => env('SCRAPER_LEGACY_DIR', base_path('..')),

    // دریافت HTML (معادل fetch_html + srcNet)
    'fetch' => [
        'timeout' => (int) env('SCRAPER_FETCH_TIMEOUT', 25),
        'connect_timeout' => (int) env('SCRAPER_CONNECT_TIMEOUT', 10),
        'max_bytes' => 3 * 1024 * 1024,
        'user_agent' => env('SCRAPER_USER_AGENT',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'),
        // فاصلهٔ ادب بین درخواست‌های پشت‌سرهم به یک دامنه (میلی‌ثانیه)
        'gap_ms' => (int) env('SCRAPER_GAP_MS', 0),
    ],

    // باسلام
    'basalam' => [
        'api_base' => env('BASALAM_API_BASE', 'https://openapi.basalam.com/v1/'),
        'categories_ttl' => (int) env('BASALAM_CATEGORIES_TTL', 24 * 3600),
        'concurrency' => (int) env('BASALAM_CONCURRENCY', 4),
    ],

    // پیش‌فرض صفحه‌بندی درصورت نبودِ انتخاب کاربر
    'pagination' => [
        'default_type' => 'query_page',
        'types' => ['query_page', 'query_custom', 'path_pattern', 'full_pattern', 'next_selector'],
    ],
];
