<?php

/**
 * Arena Agent — application bootstrap.
 *
 * Deliberately dependency-free: no Composer, no extensions beyond pdo_sqlite
 * and one of openssl/sodium. Everything below assumes the app may live in a
 * subdirectory of a shared host with no rewrite rules whatsoever.
 */

declare(strict_types=1);

namespace Arena;

const APP_NAME = 'Arena Agent';
const APP_VERSION = '2.2.0';
/** HTTP contract version. The bundled UI is written against this. */
const APP_API_VERSION = 'v1';

final class Bootstrap
{
    public static string $root = '';
    public static string $publicDir = '';
    public static string $dataDir = '';
    public static string $storageDir = '';
    private static bool $booted = false;

    public static function init(): void
    {
        if (self::$booted) {
            return;
        }
        self::$booted = true;

        self::$root = dirname(__DIR__);
        self::$publicDir = self::$root . '/public';
        self::$dataDir = self::envPath('ARENA_DATA_DIR', self::$root . '/data');
        self::$storageDir = self::envPath('ARENA_STORAGE_DIR', self::$root . '/storage');

        self::registerAutoloader();
        self::loadDotEnv(self::$root . '/.env');

        // Warnings stay warnings. The previous generation of this app promoted
        // every notice to an exception, which turned a harmless stat() on a
        // missing optional file into an opaque HTTP 400.
        error_reporting(E_ALL);
        ini_set('display_errors', '0');
        ini_set('log_errors', '1');

        date_default_timezone_set(self::env('ARENA_TZ', 'UTC'));

        foreach ([self::$dataDir, self::$storageDir, self::$storageDir . '/workspaces'] as $dir) {
            if (!is_dir($dir)) {
                @mkdir($dir, 0775, true);
            }
        }
    }

    private static function registerAutoloader(): void
    {
        // Most classes map 1:1 onto a file; the few that are grouped because
        // they are meaningless apart (a request has a response) are listed here.
        $grouped = [
            'HttpError' => 'Http',
            'Request' => 'Http',
            'Response' => 'Http',
            'Router' => 'Http',
        ];

        spl_autoload_register(static function (string $class) use ($grouped): void {
            if (!str_starts_with($class, 'Arena\\')) {
                return;
            }
            $short = substr($class, 6);
            $file = __DIR__ . '/' . str_replace('\\', '/', $grouped[$short] ?? $short) . '.php';
            if (is_file($file)) {
                require_once $file;
            }
        });
    }

    /** Minimal .env reader: KEY=value, # comments, optional quotes. */
    private static function loadDotEnv(string $path): void
    {
        if (!is_file($path) || !is_readable($path)) {
            return;
        }
        foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) {
                continue;
            }
            [$k, $v] = explode('=', $line, 2);
            $k = trim($k);
            $v = trim($v);
            if (strlen($v) > 1 && ($v[0] === '"' || $v[0] === "'") && $v[0] === substr($v, -1)) {
                $v = substr($v, 1, -1);
            }
            if ($k !== '' && getenv($k) === false) {
                putenv("$k=$v");
                $_ENV[$k] = $v;
            }
        }
    }

    public static function env(string $key, ?string $default = null): ?string
    {
        $v = getenv($key);
        if ($v === false || $v === '') {
            return $default;
        }
        return $v;
    }

    public static function envBool(string $key, bool $default): bool
    {
        $v = self::env($key);
        if ($v === null) {
            return $default;
        }
        return in_array(strtolower($v), ['1', 'true', 'yes', 'on'], true);
    }

    public static function envInt(string $key, int $default): int
    {
        $v = self::env($key);
        return $v === null ? $default : (int) $v;
    }

    private static function envPath(string $key, string $default): string
    {
        $v = getenv($key);
        return ($v === false || $v === '') ? $default : rtrim($v, '/');
    }

    /** True when auth is switched off for local development. */
    public static function authEnabled(): bool
    {
        return self::envBool('ARENA_AUTH', true);
    }
}
