<?php
/**
 * Arena AI Coding Agent — PHP edition.
 * Bootstrap: paths, autoloading, error handling, runtime capability probe.
 *
 * Port of agent-python/app/{runtime,config}.py plumbing.
 */

declare(strict_types=1);

namespace Arena;

/**
 * Single source of truth for the application version.
 *
 * Reported by /health, /api/version and /api/__diag, and sent as the
 * outbound User-Agent. See CHANGELOG.md. Semantic versioning: bump the minor
 * for new capability, the patch for fixes.
 *
 * APP_API_VERSION is the HTTP contract version and is intentionally pinned:
 * the bundled single-page UI depends on those response shapes.
 */
const APP_VERSION = '1.4.1';
const APP_API_VERSION = 'v1';
const PORTED_FROM_VERSION = '0.16.3';

final class Bootstrap
{
    public static string $root = '';
    public static string $dataDir = '';
    public static string $storageDir = '';
    public static string $workspacesDir = '';
    public static string $uploadsDir = '';
    public static string $jobOutputsDir = '';
    public static string $backupsDir = '';
    public static string $publicDir = '';
    public static string $binDir = '';
    public static string $scriptsDir = '';
    private static bool $booted = false;

    public static function init(): void
    {
        if (self::$booted) {
            return;
        }
        self::$booted = true;

        self::$root = dirname(__DIR__);
        self::$dataDir = self::envPath('AGENT_DATA_DIR', self::$root . '/data');
        self::$storageDir = self::envPath('AGENT_STORAGE_DIR', self::$root . '/storage');
        self::$workspacesDir = self::envPath('AGENT_WORKSPACES_DIR', self::$storageDir . '/workspaces');
        self::$uploadsDir = self::$storageDir . '/uploads';
        self::$jobOutputsDir = self::$storageDir . '/job_outputs';
        self::$backupsDir = self::$storageDir . '/backups';
        self::$publicDir = self::$root . '/public';
        self::$binDir = self::$root . '/bin';
        self::$scriptsDir = self::$root . '/scripts';

        foreach ([
            self::$dataDir,
            self::$storageDir,
            self::$workspacesDir,
            self::$uploadsDir,
            self::$jobOutputsDir,
            self::$backupsDir,
            self::$workspacesDir . '/default',
        ] as $dir) {
            if (!is_dir($dir)) {
                @mkdir($dir, 0775, true);
            }
        }

        // Files that declare more than one class need an explicit map.
        $classMap = [
            'HttpError' => 'Http',
            'Request' => 'Http',
            'Response' => 'Http',
            'Sse' => 'Http',
            'CircuitBreaker' => 'Providers',
            'ProviderStore' => 'Providers',
            'ToolContext' => 'AgentTools',
        ];

        spl_autoload_register(static function (string $class) use ($classMap): void {
            if (!str_starts_with($class, 'Arena\\')) {
                return;
            }
            $rel = str_replace('\\', '/', substr($class, strlen('Arena\\')));
            $file = __DIR__ . '/' . ($classMap[$rel] ?? $rel) . '.php';
            if (is_file($file)) {
                require_once $file;
            }
        });

        self::loadDotEnv(self::$root . '/.env');

        mb_internal_encoding('UTF-8');
        date_default_timezone_set(getenv('AGENT_TZ') ?: 'UTC');

        // Long agent loops and streaming responses must not be cut short.
        @set_time_limit(0);
        @ini_set('max_execution_time', '0');
        @ini_set('memory_limit', getenv('AGENT_MEMORY_LIMIT') ?: '512M');
        @ini_set('display_errors', '0');
        @ini_set('log_errors', '1');
        @ini_set('error_log', self::$storageDir . '/php-error.log');
        error_reporting(E_ALL);

        set_error_handler(static function (int $no, string $str, string $file = '', int $line = 0): bool {
            if (!(error_reporting() & $no)) {
                return false;
            }
            throw new \ErrorException($str, 0, $no, $file, $line);
        });
    }

    private static function envPath(string $key, string $fallback): string
    {
        $v = getenv($key);
        return ($v !== false && $v !== '') ? rtrim($v, '/') : $fallback;
    }

    /** Minimal .env loader (KEY=VALUE, # comments, optional quotes). */
    public static function loadDotEnv(string $path): void
    {
        if (!is_file($path) || !is_readable($path)) {
            return;
        }
        foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }
            $pos = strpos($line, '=');
            if ($pos === false) {
                continue;
            }
            $key = trim(substr($line, 0, $pos));
            $val = trim(substr($line, $pos + 1));
            if (strlen($val) >= 2
                && (($val[0] === '"' && str_ends_with($val, '"')) || ($val[0] === "'" && str_ends_with($val, "'")))) {
                $val = substr($val, 1, -1);
            }
            if ($key !== '' && getenv($key) === false) {
                putenv("$key=$val");
                $_ENV[$key] = $val;
            }
        }
    }

    /**
     * Probe what the host actually offers. The whole point of the PHP edition
     * is that these are normally all `true`.
     */
    public static function capabilities(): array
    {
        static $cache = null;
        if ($cache !== null) {
            return $cache;
        }

        $disabled = array_map('trim', explode(',', (string) ini_get('disable_functions')));
        $can = static fn(string $fn): bool => function_exists($fn) && !in_array($fn, $disabled, true);

        $exec = $can('proc_open');
        $which = static function (string $bin) use ($exec): ?string {
            if (!$exec) {
                return null;
            }
            $out = Terminal::rawCapture(['sh', '-lc', 'command -v ' . escapeshellarg($bin) . ' 2>/dev/null'], null, 5);
            $path = trim($out['stdout'] ?? '');
            return $path !== '' ? explode("\n", $path)[0] : null;
        };

        $cache = [
            'procOpen'      => $exec,
            'shellExec'     => $can('shell_exec'),
            'popen'         => $can('popen'),
            'pcntl'         => $can('pcntl_fork'),
            'posix'         => $can('posix_kill'),
            'curl'          => function_exists('curl_init'),
            'pdoSqlite'     => class_exists('PDO') && in_array('sqlite', \PDO::getAvailableDrivers(), true),
            'zip'           => class_exists('ZipArchive'),
            'dom'           => class_exists('DOMDocument'),
            'php'           => PHP_BINARY,
            'phpVersion'    => PHP_VERSION,
            'python'        => $which('python3') ?? $which('python'),
            'node'          => $which('node'),
            'npm'           => $which('npm'),
            'git'           => $which('git'),
            'bash'          => $which('bash'),
            'docker'        => $which('docker'),
            'composer'      => $which('composer'),
            'os'            => PHP_OS_FAMILY,
            'uname'         => php_uname('a'),
        ];
        return $cache;
    }

    public static function missingRequirements(): array
    {
        $c = self::capabilities();
        $missing = [];
        if (!$c['pdoSqlite']) {
            $missing[] = 'pdo_sqlite extension (required: the agent database)';
        }
        if (!$c['curl']) {
            $missing[] = 'curl extension (required: LLM provider calls and streaming)';
        }
        if (!$c['procOpen']) {
            $missing[] = 'proc_open() (required: terminal, code execution, git). '
                . 'Remove it from disable_functions in php.ini.';
        }
        return $missing;
    }
}
