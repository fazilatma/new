<?php

return [

    'name' => env('APP_NAME', 'scraper4'),

    'env' => env('APP_ENV', 'production'),

    'debug' => (bool) env('APP_DEBUG', false),

    'url' => env('APP_URL', 'http://localhost'),

    'timezone' => env('APP_TIMEZONE', 'Asia/Tehran'),

    'locale' => env('APP_LOCALE', 'fa'),

    'fallback_locale' => env('APP_FALLBACK_LOCALE', 'fa'),

    'faker_locale' => env('APP_FAKER_LOCALE', 'fa_IR'),

    'cipher' => 'AES-256-CBC',

    'key' => env('APP_KEY'),

    'previous_keys' => [
        ...array_filter(explode(',', env('APP_PREVIOUS_KEYS', ''))),
    ],

    'maintenance' => [
        'driver' => env('APP_MAINTENANCE_DRIVER', 'file'),
        'store' => env('APP_MAINTENANCE_STORE', 'database'),
    ],

    /* Laravel 12 loads application providers from bootstrap/providers.php.
       Requiring config/providers.php here is both redundant and invalid: that
       file does not exist in a standard Laravel 12 project and made Composer's
       package:discover fail during deployment. */
];
