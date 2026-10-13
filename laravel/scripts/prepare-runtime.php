<?php

/**
 * Prepare writable Laravel runtime state before Composer invokes Artisan.
 * Safe to run on every deploy: persistent data and an existing APP_KEY are
 * never replaced.
 */

$base = dirname(__DIR__);

$directories = [
    $base.'/bootstrap/cache',
    $base.'/storage/framework/cache/data',
    $base.'/storage/framework/sessions',
    $base.'/storage/framework/testing',
    $base.'/storage/framework/views',
    $base.'/storage/logs',
    $base.'/database',
];

foreach ($directories as $directory) {
    if (!is_dir($directory) && !mkdir($directory, 0775, true) && !is_dir($directory)) {
        fwrite(STDERR, "Unable to create Laravel runtime directory: {$directory}\n");
        exit(1);
    }
}

$envFile = $base.'/.env';
if (!is_file($envFile)) {
    $example = $base.'/.env.example';
    $contents = is_file($example) ? (string) file_get_contents($example) : "APP_ENV=production\nAPP_DEBUG=false\n";
    if (file_put_contents($envFile, $contents, LOCK_EX) === false) {
        fwrite(STDERR, "Unable to create .env\n");
        exit(1);
    }
}

$env = (string) file_get_contents($envFile);
if (!preg_match('/^APP_KEY=base64:[A-Za-z0-9+\/=]+\s*$/m', $env)) {
    $key = 'base64:'.base64_encode(random_bytes(32));
    if (preg_match('/^APP_KEY=.*$/m', $env)) {
        $env = (string) preg_replace('/^APP_KEY=.*$/m', 'APP_KEY='.$key, $env, 1);
    } else {
        $env = rtrim($env)."\nAPP_KEY={$key}\n";
    }
    if (file_put_contents($envFile, $env, LOCK_EX) === false) {
        fwrite(STDERR, "Unable to persist APP_KEY in .env\n");
        exit(1);
    }
    fwrite(STDOUT, "[laravel-prepare] Generated the initial APP_KEY.\n");
} else {
    fwrite(STDOUT, "[laravel-prepare] Existing APP_KEY preserved.\n");
}

$sqlite = $base.'/database/database.sqlite';
if (!is_file($sqlite) && !touch($sqlite)) {
    fwrite(STDERR, "Unable to create SQLite database: {$sqlite}\n");
    exit(1);
}

@chmod($base.'/storage', 0775);
@chmod($base.'/bootstrap/cache', 0775);
@chmod($sqlite, 0664);

fwrite(STDOUT, "[laravel-prepare] Runtime directories and SQLite database are ready.\n");
