<?php
/**
 * Local AI installer & manager (Ollama runtime).
 *
 * This module has no equivalent in the Python or the Workers edition: it only
 * becomes possible on a host with a real shell, spare RAM and disk, which is
 * exactly the target of the PHP port.
 *
 * Pipeline:
 *   hostScan()   → what the machine actually has (RAM/CPU/GPU/disk/runtime)
 *   recommend()  → score every catalog variant against the user's profile
 *                  (RAM budget, task, context, language, speed↔quality)
 *   install()    → background job: install runtime → pull → tune → benchmark
 *                  → register as a provider/model in the agent's ProviderStore
 *
 * Everything runs without root: the Ollama runtime is unpacked into
 * storage/localai/ and served from 127.0.0.1 by a detached process.
 */

declare(strict_types=1);

namespace Arena;

final class LocalAI
{
    public const DEFAULT_HOST = 'http://127.0.0.1:11434';
    public const REGISTRY = 'https://registry.ollama.ai';
    public const HF_API = 'https://huggingface.co/api/models';

    /** Bytes-per-weight of the quantisation schemes we ship in the catalog. */
    public const BPW = [
        'Q2_K' => 2.6, 'Q3_K_M' => 3.9, 'Q4_0' => 4.5, 'Q4_K_M' => 4.85,
        'Q5_K_M' => 5.7, 'Q6_K' => 6.6, 'Q8_0' => 8.5, 'F16' => 16.0,
    ];

    /** Runtime overhead of a loaded model (graph, buffers, server itself). */
    public const RUNTIME_OVERHEAD_GB = 0.6;
    /** Weights need a little more RAM than they take on disk. */
    public const WEIGHT_RAM_FACTOR = 1.08;

    /** Preferred default quantisation when a Hugging Face repo ships several. */
    public const QUANT_PRIORITY = [
        'Q4_K_M', 'Q4_K_S', 'Q4_0', 'Q4_1', 'Q5_K_M', 'Q5_K_S', 'Q5_0', 'Q5_1',
        'Q6_K', 'Q8_0', 'Q3_K_M', 'Q3_K_S', 'Q3_K_L', 'Q2_K',
        'IQ4_XS', 'IQ4_NL', 'IQ3_XS', 'IQ3_M', 'IQ2_M', 'F16', 'BF16', 'F32',
    ];

    /** File extensions the drive scanner and the importer both recognise. */
    public const SCAN_EXTENSIONS = ['gguf', 'ggml', 'safetensors', 'bin'];

    /* ================================================================== */
    /* Paths & configuration                                              */
    /* ================================================================== */

    /**
     * Relative values (as written by the host console into .env) are resolved
     * against the application root, never against the CWD — php-fpm and the
     * CLI worker do not share one.
     */
    private static function absPath(string $v): string
    {
        $v = rtrim(trim($v), '/');
        if ($v === '') {
            return '';
        }
        return str_starts_with($v, '/') ? $v : Bootstrap::$root . '/' . $v;
    }

    public static function rootDir(): string
    {
        $v = self::absPath((string) (getenv('AGENT_LOCALAI_DIR') ?: ''));
        return $v !== '' ? $v : Bootstrap::$storageDir . '/localai';
    }

    public static function modelsDir(): string
    {
        $v = self::absPath((string) (getenv('OLLAMA_MODELS') ?: ''));
        return $v !== '' ? $v : self::rootDir() . '/models';
    }

    public static function binDir(): string
    {
        return self::rootDir() . '/bin';
    }

    /** Resolved engine executable: explicit env → database state → private install → standard paths → PATH. */
    public static function binary(?string $engine = null): ?string
    {
        $engine ??= (string) (Database::state('localai:engine', 'ollama') ?? 'ollama');

        if ($engine === 'llamacpp') {
            $explicit = (string) (getenv('AGENT_LLAMACPP_BIN') ?: '');
            if ($explicit !== '' && is_file($explicit)) {
                return $explicit;
            }
            $saved = (string) (Database::state('localai:llamacpp_bin', '') ?? '');
            if ($saved !== '' && is_file($saved) && is_executable($saved)) {
                return $saved;
            }
            $candidates = [
                self::binDir() . '/llama-server',
                self::binDir() . '/llama-cli',
                self::rootDir() . '/llama-server',
                '/usr/local/bin/llama-server',
                '/usr/bin/llama-server',
            ];
            foreach ($candidates as $c) {
                if (is_file($c) && is_executable($c)) {
                    return $c;
                }
            }
            if (function_exists('proc_open')) {
                $out = Terminal::rawCapture(['sh', '-lc', 'command -v llama-server 2>/dev/null || command -v llama-cli 2>/dev/null'], null, 5);
                $path = trim((string) ($out['stdout'] ?? ''));
                if ($path !== '') {
                    $first = explode("\n", $path)[0];
                    if (is_file($first) && is_executable($first)) {
                        return $first;
                    }
                }
            }
            return null;
        }

        // Default: ollama
        $explicit = (string) (getenv('AGENT_OLLAMA_BIN') ?: '');
        if ($explicit !== '' && is_file($explicit)) {
            return $explicit;
        }
        $saved = (string) (Database::state('localai:custom_bin', '') ?? '');
        if ($saved !== '' && is_file($saved) && is_executable($saved)) {
            return $saved;
        }
        $local = self::binDir() . '/ollama';
        if (is_file($local) && is_executable($local)) {
            return $local;
        }
        $candRoot = self::rootDir() . '/ollama';
        if (is_file($candRoot) && is_executable($candRoot)) {
            return $candRoot;
        }
        $candRootBin = self::rootDir() . '/bin/ollama';
        if (is_file($candRootBin) && is_executable($candRootBin)) {
            return $candRootBin;
        }
        $standard = ['/usr/local/bin/ollama', '/usr/bin/ollama', '/opt/ollama/bin/ollama'];
        $home = getenv('HOME') ?: '';
        if ($home !== '') {
            $standard[] = rtrim($home, '/') . '/.local/bin/ollama';
        }
        foreach ($standard as $p) {
            if (is_file($p) && is_executable($p)) {
                return $p;
            }
        }
        if (function_exists('proc_open')) {
            $out = Terminal::rawCapture(['sh', '-lc', 'command -v ollama 2>/dev/null'], null, 5);
            $path = trim((string) ($out['stdout'] ?? ''));
            if ($path !== '') {
                $first = explode("\n", $path)[0];
                if (is_file($first) && is_executable($first)) {
                    return $first;
                }
            }
        }
        return null;
    }

    /** Base URL of the Ollama HTTP API. */
    public static function host(): string
    {
        foreach (['AGENT_LOCALAI_HOST', 'OLLAMA_HOST'] as $key) {
            $v = trim((string) (getenv($key) ?: ''));
            if ($v !== '') {
                return self::normalizeHost($v);
            }
        }
        $saved = (string) (Database::state('localai:custom_host', '') ?? '');
        if ($saved !== '') {
            return self::normalizeHost($saved);
        }
        $cfg = trim(Config::raw('OLLAMA_BASE_URL', ''));
        return $cfg !== '' ? self::normalizeHost($cfg) : self::DEFAULT_HOST;
    }

    private static function normalizeHost(string $v): string
    {
        $v = rtrim(trim($v), '/');
        if ($v === '') {
            return self::DEFAULT_HOST;
        }
        if (!preg_match('#^https?://#i', $v)) {
            $v = 'http://' . $v;
        }
        return $v;
    }

    /** Tunables that are written into the server environment. */
    public static function serverEnv(array $overrides = []): array
    {
        $parsed = parse_url(self::host());
        $bind = ($parsed['host'] ?? '127.0.0.1') . ':' . ($parsed['port'] ?? 11434);

        $env = [
            'OLLAMA_HOST' => $bind,
            'OLLAMA_MODELS' => self::modelsDir(),
            'HOME' => self::rootDir(),
            'OLLAMA_KEEP_ALIVE' => (string) (getenv('OLLAMA_KEEP_ALIVE') ?: '10m'),
            'OLLAMA_MAX_LOADED_MODELS' => (string) (getenv('OLLAMA_MAX_LOADED_MODELS') ?: '1'),
            'OLLAMA_NUM_PARALLEL' => (string) (getenv('OLLAMA_NUM_PARALLEL') ?: '1'),
            'OLLAMA_FLASH_ATTENTION' => (string) (getenv('OLLAMA_FLASH_ATTENTION') ?: '1'),
            // q8_0 KV cache halves context memory with no measurable quality loss.
            'OLLAMA_KV_CACHE_TYPE' => (string) (getenv('OLLAMA_KV_CACHE_TYPE') ?: 'q8_0'),
        ];
        foreach ($overrides as $k => $v) {
            if ($v !== null && $v !== '') {
                $env[(string) $k] = (string) $v;
            }
        }
        return $env;
    }

    /* ================================================================== */
    /* Host capability scan                                               */
    /* ================================================================== */

    public static function hostScan(bool $refresh = false): array
    {
        static $cache = null;
        if ($cache !== null && !$refresh) {
            return $cache;
        }

        $mem = self::readMemory();
        $cpu = self::readCpu();
        $gpu = self::readGpu();
        $disk = self::diskInfo(self::modelsDir());

        // Memory bandwidth drives token throughput far more than raw FLOPs.
        $cpuBandwidth = (float) (getenv('AGENT_LOCALAI_CPU_BANDWIDTH') ?: 0);
        if ($cpuBandwidth <= 0) {
            $cpuBandwidth = $cpu['arch'] === 'arm64' && PHP_OS_FAMILY === 'Darwin' ? 100.0 : 28.0;
        }

        // Leave the OS, PHP-FPM and the agent itself some air.
        $reserve = max(1.0, min(4.0, $mem['totalGb'] * 0.15));
        $suggested = max(0.0, round(($mem['availableGb'] > 0 ? $mem['availableGb'] : $mem['totalGb']) - $reserve, 1));

        $cache = [
            'os' => PHP_OS_FAMILY,
            'uname' => php_uname('a'),
            'memory' => $mem,
            'cpu' => $cpu,
            'gpu' => $gpu,
            'disk' => $disk,
            'bandwidthGBs' => ['cpu' => $cpuBandwidth, 'gpu' => $gpu['bandwidthGBs'] ?? 0.0],
            'suggestedRamBudgetGb' => $suggested,
            'reservedForSystemGb' => round($reserve, 1),
            'runtime' => self::runtimeStatus(),
            'scannedAt' => gmdate('c'),
        ];
        return $cache;
    }

    private static function readMemory(): array
    {
        $totalKb = 0;
        $availKb = 0;
        $swapKb = 0;
        if (is_readable('/proc/meminfo')) {
            foreach (file('/proc/meminfo') ?: [] as $line) {
                if (preg_match('/^MemTotal:\s+(\d+)/', $line, $m)) {
                    $totalKb = (int) $m[1];
                } elseif (preg_match('/^MemAvailable:\s+(\d+)/', $line, $m)) {
                    $availKb = (int) $m[1];
                } elseif (preg_match('/^SwapTotal:\s+(\d+)/', $line, $m)) {
                    $swapKb = (int) $m[1];
                }
            }
        } elseif (PHP_OS_FAMILY === 'Darwin' && function_exists('proc_open')) {
            $out = Terminal::rawCapture(['sh', '-lc', 'sysctl -n hw.memsize'], null, 5);
            $totalKb = (int) (((float) trim((string) $out['stdout'])) / 1024);
        }

        // Respect a cgroup/container limit when it is lower than the host total.
        foreach (['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes'] as $f) {
            if (is_readable($f)) {
                $raw = trim((string) @file_get_contents($f));
                if ($raw !== '' && $raw !== 'max' && ctype_digit($raw)) {
                    $limitKb = (int) ((int) $raw / 1024);
                    if ($limitKb > 0 && ($totalKb === 0 || $limitKb < $totalKb)) {
                        $totalKb = $limitKb;
                        $availKb = min($availKb ?: $limitKb, $limitKb);
                    }
                }
            }
        }

        return [
            'totalGb' => round($totalKb / 1048576, 2),
            'availableGb' => round(($availKb ?: $totalKb) / 1048576, 2),
            'swapGb' => round($swapKb / 1048576, 2),
        ];
    }

    private static function readCpu(): array
    {
        $model = '';
        $cores = 0;
        $flags = [];
        if (is_readable('/proc/cpuinfo')) {
            foreach (file('/proc/cpuinfo') ?: [] as $line) {
                if ($model === '' && preg_match('/^model name\s*:\s*(.+)$/', $line, $m)) {
                    $model = trim($m[1]);
                }
                if (preg_match('/^processor\s*:/', $line)) {
                    $cores++;
                }
                if (!$flags && preg_match('/^(flags|Features)\s*:\s*(.+)$/', $line, $m)) {
                    $flags = preg_split('/\s+/', trim($m[2])) ?: [];
                }
            }
        }
        if ($cores === 0 && function_exists('proc_open')) {
            $out = Terminal::rawCapture(['sh', '-lc', 'nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null'], null, 5);
            $cores = (int) trim((string) $out['stdout']);
        }
        $arch = strtolower(php_uname('m'));
        if (in_array($arch, ['x86_64', 'amd64'], true)) {
            $arch = 'amd64';
        } elseif (in_array($arch, ['aarch64', 'arm64'], true)) {
            $arch = 'arm64';
        }
        return [
            'model' => $model ?: php_uname('p'),
            'cores' => max(1, $cores),
            'arch' => $arch,
            'avx2' => in_array('avx2', $flags, true),
            'avx512' => (bool) preg_grep('/^avx512/', $flags),
            'neon' => in_array('asimd', $flags, true) || in_array('neon', $flags, true),
        ];
    }

    private static function readGpu(): array
    {
        $none = ['present' => false, 'vendor' => '', 'name' => '', 'vramGb' => 0.0, 'freeVramGb' => 0.0, 'bandwidthGBs' => 0.0, 'driver' => ''];
        if (!function_exists('proc_open')) {
            return $none;
        }

        $nv = Terminal::rawCapture(
            ['sh', '-lc', 'nvidia-smi --query-gpu=name,memory.total,memory.free,driver_version --format=csv,noheader,nounits 2>/dev/null'],
            null,
            8
        );
        $line = trim(explode("\n", trim((string) $nv['stdout']))[0] ?? '');
        if ($line !== '' && str_contains($line, ',')) {
            $parts = array_map('trim', explode(',', $line));
            $vram = round(((float) ($parts[1] ?? 0)) / 1024, 2);
            return [
                'present' => true,
                'vendor' => 'nvidia',
                'name' => $parts[0] ?? 'NVIDIA GPU',
                'vramGb' => $vram,
                'freeVramGb' => round(((float) ($parts[2] ?? 0)) / 1024, 2),
                'bandwidthGBs' => self::guessGpuBandwidth((string) ($parts[0] ?? ''), $vram),
                'driver' => $parts[3] ?? '',
            ];
        }

        $rocm = Terminal::rawCapture(['sh', '-lc', 'rocm-smi --showmeminfo vram --csv 2>/dev/null | head -5'], null, 8);
        if (preg_match('/(\d{6,})/', (string) $rocm['stdout'], $m)) {
            $vram = round(((float) $m[1]) / 1073741824, 2);
            return ['present' => true, 'vendor' => 'amd', 'name' => 'AMD GPU (ROCm)', 'vramGb' => $vram,
                    'freeVramGb' => $vram, 'bandwidthGBs' => 400.0, 'driver' => ''];
        }

        if (PHP_OS_FAMILY === 'Darwin' && str_contains(strtolower(php_uname('m')), 'arm')) {
            $mem = self::readMemory();
            return ['present' => true, 'vendor' => 'apple', 'name' => 'Apple Silicon (unified memory)',
                    'vramGb' => $mem['totalGb'], 'freeVramGb' => $mem['availableGb'],
                    'bandwidthGBs' => 150.0, 'driver' => 'metal'];
        }

        return $none;
    }

    private static function guessGpuBandwidth(string $name, float $vramGb): float
    {
        $n = strtolower($name);
        $table = [
            'h100' => 3350.0, 'a100' => 1935.0, 'l40' => 864.0, 'a6000' => 768.0,
            '4090' => 1008.0, '4080' => 717.0, '4070' => 504.0, '4060' => 272.0,
            '3090' => 936.0, '3080' => 760.0, '3070' => 448.0, '3060' => 360.0,
            '2080' => 448.0, '2060' => 336.0, 't4' => 320.0, 'v100' => 900.0,
            'p100' => 732.0, 'p40' => 346.0, 'a10' => 600.0,
        ];
        foreach ($table as $key => $bw) {
            if (str_contains($n, $key)) {
                return $bw;
            }
        }
        return $vramGb >= 24 ? 700.0 : 320.0;
    }

    private static function diskInfo(string $path): array
    {
        $probe = $path;
        while ($probe !== '/' && $probe !== '' && !is_dir($probe)) {
            $probe = dirname($probe);
        }
        $free = @disk_free_space($probe ?: '/');
        $total = @disk_total_space($probe ?: '/');
        return [
            'path' => $path,
            'freeGb' => $free === false ? 0.0 : round(((float) $free) / 1073741824, 2),
            'totalGb' => $total === false ? 0.0 : round(((float) $total) / 1073741824, 2),
        ];
    }

    /* ================================================================== */
    /* Runtime (Ollama & llama.cpp) lifecycle                             */
    /* ================================================================== */

    public static function runtimeStatus(): array
    {
        $engine = (string) (Database::state('localai:engine', 'ollama') ?? 'ollama');
        $bin = self::binary($engine) ?? self::binary();
        $version = '';
        if ($bin !== null && function_exists('proc_open')) {
            $out = Terminal::rawCapture([$bin, '--version'], null, 8, self::serverEnv());
            if (preg_match('/([0-9]+\.[0-9]+(\.[0-9]+)?)/', (string) $out['stdout'] . (string) $out['stderr'], $m)) {
                $version = $m[1];
            }
        }
        $up = self::serverUp();
        $ollamaBin = self::binary('ollama');
        $llamaBin = self::binary('llamacpp');

        return [
            'engine' => $engine,
            'engines' => [
                'ollama' => [
                    'name' => 'Ollama',
                    'installed' => $ollamaBin !== null,
                    'binary' => $ollamaBin ?? '',
                ],
                'llamacpp' => [
                    'name' => 'llama.cpp (llama-server)',
                    'installed' => $llamaBin !== null,
                    'binary' => $llamaBin ?? '',
                ],
            ],
            'installed' => $bin !== null,
            'binary' => $bin ?? '',
            'managed' => $bin !== null && str_starts_with($bin, self::binDir()),
            'version' => $version,
            'running' => $up['ok'],
            'host' => self::host(),
            'modelsDir' => self::modelsDir(),
            'modelsDirWritable' => self::dirWritable(self::modelsDir()),
            'error' => $up['ok'] ? '' : (string) ($up['error'] ?? ''),
            'env' => self::serverEnv(),
        ];
    }

    public static function dirWritable(string $dir): bool
    {
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        $probe = $dir;
        while ($probe !== '/' && $probe !== '' && !is_dir($probe)) {
            $probe = dirname($probe);
        }
        if ($probe === '') {
            return false;
        }
        if (!is_writable($probe)) {
            @chmod($probe, 0775);
        }
        $test = rtrim($probe, '/') . '/.probe_' . getmypid() . '_' . time();
        $ok = @file_put_contents($test, '1') !== false;
        if ($ok) {
            @unlink($test);
            return true;
        }
        return is_writable($probe);
    }

    public static function fixPermissions(): array
    {
        $md = self::modelsDir();
        $rd = self::rootDir();
        $dirs = [DATA_DIR, STORAGE_DIR, $rd, $md, self::binDir()];
        $errors = [];
        foreach ($dirs as $d) {
            if (!is_dir($d)) {
                @mkdir($d, 0775, true);
            }
            if (!@chmod($d, 0775)) {
                if (!@chmod($d, 0755)) {
                    $errors[] = "chmod failed for $d";
                }
            }
        }
        $writable = self::dirWritable($md);
        return [
            'ok' => $writable,
            'modelsDir' => $md,
            'modelsDirWritable' => $writable,
            'errors' => $writable ? [] : $errors,
        ];
    }

    /** @return array{ok:bool, error?:string, version?:string} */
    public static function serverUp(?string $engine = null): array
    {
        $engine ??= (string) (Database::state('localai:engine', 'ollama') ?? 'ollama');
        if ($engine === 'llamacpp') {
            // llama-server exposes /health on recent builds; fall back to the
            // OpenAI-compatible /v1/models route for older ones.
            $r = HttpClient::request('GET', self::host() . '/health', [], null, 4);
            if ($r['ok']) {
                return ['ok' => true, 'version' => ''];
            }
            $r2 = HttpClient::request('GET', self::host() . '/v1/models', [], null, 4);
            if ($r2['ok']) {
                return ['ok' => true, 'version' => ''];
            }
            return ['ok' => false, 'error' => $r['error'] ?? ('HTTP ' . $r['status'])];
        }

        $r = HttpClient::request('GET', self::host() . '/api/version', [], null, 4);
        if (!$r['ok']) {
            return ['ok' => false, 'error' => $r['error'] ?? ('HTTP ' . $r['status'])];
        }
        $j = json_decode($r['body'], true);
        return ['ok' => true, 'version' => (string) ($j['version'] ?? '')];
    }

    /**
     * Install the runtime (Ollama or llama.cpp) without root into storage/localai/.
     * @param string|array|callable|null $opts
     */
    public static function installRuntime(mixed $opts = null, ?callable $log = null): array
    {
        $engine = 'ollama';
        if (is_callable($opts)) {
            $log = $opts;
        } elseif (is_string($opts) && $opts !== '') {
            $engine = $opts;
        } elseif (is_array($opts) && !empty($opts['engine'])) {
            $engine = (string) $opts['engine'];
        }
        $log ??= static function (string $m): void {
        };

        if (!function_exists('proc_open')) {
            throw new HttpError(501, 'proc_open() is disabled — the local AI runtime cannot be installed');
        }

        $existing = self::binary($engine);
        if ($existing !== null) {
            Database::setState('localai:engine', $engine);
            $log(ucfirst($engine) . ' is already installed at ' . $existing);
            return ['installed' => true, 'engine' => $engine, 'binary' => $existing, 'skipped' => true];
        }

        $cpu = self::readCpu();
        if (PHP_OS_FAMILY !== 'Linux') {
            throw new HttpError(400, 'Automatic runtime install is supported on Linux. Install manually and set AGENT_OLLAMA_BIN or AGENT_LLAMACPP_BIN.');
        }
        $archTag = $cpu['arch'] === 'arm64' ? 'arm64' : 'amd64';

        $root = self::rootDir();
        $binDir = self::binDir();
        $modelsDir = self::modelsDir();
        Files::ensureDir($root);
        Files::ensureDir($binDir);
        Files::ensureDir($modelsDir);

        $candidates = [];

        if ($engine === 'llamacpp') {
            $log('Discovering llama.cpp / llama-server release assets …');
            try {
                $gh = HttpClient::request('GET', 'https://api.github.com/repos/ggml-org/llama.cpp/releases/latest', ['User-Agent: ArenaAgent/3.0'], null, 8);
                if (!empty($gh['ok'])) {
                    $j = json_decode((string) ($gh['body'] ?? ''), true);
                    if (is_array($j) && !empty($j['assets']) && is_array($j['assets'])) {
                        foreach ($j['assets'] as $asset) {
                            $name = (string) ($asset['name'] ?? '');
                            $durl = (string) ($asset['browser_download_url'] ?? '');
                            if (str_contains($name, 'ubuntu') && str_contains($name, $archTag === 'arm64' ? 'arm64' : 'x64') && str_ends_with($name, '.zip')) {
                                $candidates[] = $durl;
                            }
                        }
                    }
                }
            } catch (\Throwable $e) {
                $log('llama.cpp GitHub API probe skipped (' . $e->getMessage() . ')');
            }
            $archZip = $archTag === 'arm64' ? 'arm64' : 'x64';
            $candidates[] = "https://github.com/ggml-org/llama.cpp/releases/download/b4800/llama-b4800-bin-ubuntu-{$archZip}.zip";
            $candidates[] = "https://github.com/ggml-org/llama.cpp/releases/download/b4000/llama-b4000-bin-ubuntu-{$archZip}.zip";
            $candidates[] = "https://github.com/ggml-org/llama.cpp/releases/download/b3900/llama-b3900-bin-ubuntu-{$archZip}.zip";
            $candidates[] = "https://mirror.ghproxy.com/https://github.com/ggml-org/llama.cpp/releases/download/b4800/llama-b4800-bin-ubuntu-{$archZip}.zip";
            $candidates[] = "https://ghproxy.net/https://github.com/ggml-org/llama.cpp/releases/download/b4800/llama-b4800-bin-ubuntu-{$archZip}.zip";
        } else {
            // Ollama
            $log('Discovering Ollama release assets …');
            try {
                $gh = HttpClient::request('GET', 'https://api.github.com/repos/ollama/ollama/releases/latest', ['User-Agent: ArenaAgent/3.0'], null, 8);
                if (!empty($gh['ok'])) {
                    $j = json_decode((string) ($gh['body'] ?? ''), true);
                    if (is_array($j) && !empty($j['assets']) && is_array($j['assets'])) {
                        foreach ($j['assets'] as $asset) {
                            $name = (string) ($asset['name'] ?? '');
                            $durl = (string) ($asset['browser_download_url'] ?? '');
                            if (str_contains($name, "linux-{$archTag}.tar.zst") || str_contains($name, "linux-{$archTag}.tgz") || str_contains($name, "linux-{$archTag}.tar.gz")) {
                                $candidates[] = $durl;
                            }
                        }
                    }
                }
            } catch (\Throwable $e) {
                $log('GitHub API probe skipped (' . $e->getMessage() . '), trying direct endpoints …');
            }

            $candidates[] = "https://github.com/ollama/ollama/releases/latest/download/ollama-linux-{$archTag}.tar.zst";
            $candidates[] = "https://github.com/ollama/ollama/releases/latest/download/ollama-linux-{$archTag}.tgz";
            $candidates[] = "https://github.com/ollama/ollama/releases/download/v0.5.12/ollama-linux-{$archTag}.tar.zst";
            $candidates[] = "https://github.com/ollama/ollama/releases/download/v0.5.12/ollama-linux-{$archTag}.tgz";
            $candidates[] = "https://github.com/ollama/ollama/releases/download/v0.3.14/ollama-linux-{$archTag}.tgz";
            $candidates[] = "https://ollama.com/download/ollama-linux-{$archTag}.tar.zst";
            $candidates[] = "https://ollama.com/download/ollama-linux-{$archTag}.tgz";
            $candidates[] = "https://mirror.ghproxy.com/https://github.com/ollama/ollama/releases/download/v0.5.12/ollama-linux-{$archTag}.tar.zst";
            $candidates[] = "https://ghproxy.net/https://github.com/ollama/ollama/releases/download/v0.5.12/ollama-linux-{$archTag}.tar.zst";
        }

        $unique = array_values(array_unique(array_filter($candidates)));
        $downloadedFile = null;
        $lastError = 'No download sources available';

        foreach ($unique as $url) {
            $log('Attempting download from: ' . $url);
            $parsed = parse_url($url, PHP_URL_PATH);
            $fname = $parsed ? basename($parsed) : ($engine === 'llamacpp' ? "llama-bin.zip" : "ollama-linux-{$archTag}.tar.zst");
            $dest = $root . '/' . $fname;

            // 1. Try curl CLI if available
            $dlOk = false;
            $res = Terminal::rawCapture(['curl', '-fSL', '--connect-timeout', '15', '-m', '300', '-A', 'Mozilla/5.0 (ArenaAgent/3.0)', '-o', $dest, $url], $root, 310);
            if ((int) ($res['exitCode'] ?? -1) === 0 && file_exists($dest) && filesize($dest) > 1000) {
                $dlOk = true;
            }

            // 2. Try wget CLI
            if (!$dlOk) {
                $res2 = Terminal::rawCapture(['wget', '-q', '-T', '15', '-t', '2', '-U', 'Mozilla/5.0 (ArenaAgent/3.0)', '-O', $dest, $url], $root, 310);
                if ((int) ($res2['exitCode'] ?? -1) === 0 && file_exists($dest) && filesize($dest) > 1000) {
                    $dlOk = true;
                }
            }

            // 3. Try HttpClient with proxy
            if (!$dlOk) {
                $proxy = Config::proxyConfig($url);
                $dl = HttpClient::download($proxy['effectiveUrl'], $dest, 1800, $proxy['proxyClient']);
                if (!empty($dl['ok']) && file_exists($dest) && filesize($dest) > 1000) {
                    $dlOk = true;
                } else {
                    $lastError = (string) ($dl['error'] ?? 'HTTP download failed');
                }
            }

            if ($dlOk) {
                $log('Downloaded ' . basename($dest) . ' (' . Files::humanSize((int) filesize($dest)) . '), extracting …');
                $downloadedFile = $dest;
                break;
            } else {
                $log('Candidate failed, trying next mirror …');
                @unlink($dest);
            }
        }

        if ($downloadedFile === null || !file_exists($downloadedFile)) {
            throw new HttpError(502, "Could not download {$engine} runtime: {$lastError}");
        }

        // Extract archive
        if (str_ends_with(strtolower($downloadedFile), '.zip')) {
            $extracted = false;
            if (function_exists('proc_open')) {
                $unz = Terminal::rawCapture(['unzip', '-o', $downloadedFile, '-d', $root], $root, 300);
                if ((int) ($unz['exitCode'] ?? -1) === 0) {
                    $extracted = true;
                }
            }
            if (!$extracted && class_exists('\ZipArchive')) {
                $za = new \ZipArchive();
                if ($za->open($downloadedFile) === true) {
                    $za->extractTo($root);
                    $za->close();
                    $extracted = true;
                }
            }
        } else {
            Terminal::rawCapture(['tar', '-xf', $downloadedFile, '-C', $root], $root, 900);
        }
        @unlink($downloadedFile);

        // Find extracted binary
        $targetBin = null;
        if ($engine === 'llamacpp') {
            $candidatesBin = [
                $binDir . '/llama-server',
                $root . '/llama-server',
                $root . '/build/bin/llama-server',
            ];
            foreach ($candidatesBin as $cb) {
                if (file_exists($cb)) {
                    $targetBin = $binDir . '/llama-server';
                    if ($cb !== $targetBin) {
                        @rename($cb, $targetBin);
                    }
                    break;
                }
            }
            if ($targetBin === null) {
                $found = glob($root . '/**/llama-server');
                if (!empty($found) && is_file($found[0])) {
                    $targetBin = $binDir . '/llama-server';
                    @rename($found[0], $targetBin);
                }
            }
        } else {
            $candidatesBin = [
                $binDir . '/ollama',
                $root . '/ollama',
                $root . '/bin/ollama',
            ];
            foreach ($candidatesBin as $cb) {
                if (file_exists($cb)) {
                    $targetBin = $binDir . '/ollama';
                    if ($cb !== $targetBin) {
                        @rename($cb, $targetBin);
                    }
                    break;
                }
            }
            if ($targetBin === null) {
                $found = glob($root . '/**/ollama');
                if (!empty($found) && is_file($found[0])) {
                    $targetBin = $binDir . '/ollama';
                    @rename($found[0], $targetBin);
                }
            }
        }

        if ($targetBin === null || !file_exists($targetBin)) {
            throw new HttpError(500, "Extraction completed but binary for {$engine} not found in {$root}");
        }

        @chmod($targetBin, 0755);
        Database::setState('localai:engine', $engine);
        $bin = self::binary($engine) ?? $targetBin;
        $log("Runtime {$engine} installed successfully at {$bin}");
        return ['installed' => true, 'engine' => $engine, 'binary' => $bin, 'skipped' => false];
    }

    /**
     * @param array $envOverrides        extra OLLAMA_* env vars (ignored by llama.cpp)
     * @param string|null $modelPath     required for the llama.cpp engine: absolute path of the .gguf to load
     * @param int|null $ctxSize          llama.cpp context window (ignored by Ollama, which takes it per-request)
     */
    public static function startServer(
        array $envOverrides = [],
        ?callable $log = null,
        ?string $modelPath = null,
        ?int $ctxSize = null
    ): array {
        $log ??= static function (string $m): void {
        };
        $engine = (string) (Database::state('localai:engine', 'ollama') ?? 'ollama');
        $modelPath ??= $engine === 'llamacpp' ? (string) (Database::state('localai:llamacpp:active_path', '') ?? '') : null;

        $up = self::serverUp($engine);
        if ($up['ok']) {
            if ($engine !== 'llamacpp' || $modelPath === '' || $modelPath === (string) (Database::state('localai:llamacpp:loaded_path', '') ?? '')) {
                $log('Local AI server already running at ' . self::host());
                return ['running' => true, 'started' => false, 'host' => self::host(), 'engine' => $engine];
            }
            // llama.cpp can only ever serve the one model it was started with —
            // switching models means restarting it against the new file.
            $log('Switching the loaded model: restarting llama-server…');
            self::stopServer();
        }

        $bin = self::binary($engine) ?? self::binary();
        if ($bin === null) {
            throw new HttpError(409, 'Local AI engine (' . $engine . ') is not installed yet. Please click "Install Engine" first.');
        }
        if ($engine === 'llamacpp' && ($modelPath === null || $modelPath === '' || !is_file($modelPath))) {
            throw new HttpError(409, 'No .gguf model is selected for llama.cpp yet. Install or activate one first.');
        }
        Files::ensureDir(self::modelsDir());
        Files::ensureDir(self::rootDir() . '/logs');

        $env = self::serverEnv($envOverrides);
        $exports = '';
        foreach ($env as $k => $v) {
            $exports .= 'export ' . $k . '=' . escapeshellarg((string) $v) . '; ';
        }
        $logPath = self::rootDir() . '/logs/localai-server.log';
        $parsedHost = parse_url(self::host());
        $bindHost = (string) ($parsedHost['host'] ?? '127.0.0.1');
        $bindPort = (int) ($parsedHost['port'] ?? 11434);

        if ($engine === 'llamacpp') {
            $ctx = $ctxSize ?? 8192;
            $cmd = $exports . escapeshellarg($bin)
                . ' --host ' . escapeshellarg($bindHost)
                . ' --port ' . $bindPort
                . ' --model ' . escapeshellarg($modelPath)
                . ' --ctx-size ' . (int) $ctx
                . ' --no-webui';
        } else {
            $cmd = $exports . escapeshellarg($bin) . ' serve';
        }
        $proc = Terminal::startDetached($cmd, self::rootDir(), 'localai', $logPath);
        Database::setState('localai:server:pid', (string) ($proc['pid'] ?? 0));

        for ($i = 0; $i < 40; $i++) {
            usleep(500000);
            if (self::serverUp($engine)['ok']) {
                $log('Local AI server is up (pid ' . ($proc['pid'] ?? 0) . ')');
                if ($engine === 'llamacpp' && $modelPath !== null) {
                    Database::setState('localai:llamacpp:loaded_path', $modelPath);
                }
                return ['running' => true, 'started' => true, 'pid' => $proc['pid'] ?? 0, 'host' => self::host(), 'logPath' => $logPath, 'engine' => $engine];
            }
        }
        $tail = Terminal::readLog($logPath, 4000);
        throw new HttpError(500, 'Local AI server did not become ready within 20s. Log: ' . mb_substr($tail, -600));
    }

    public static function stopServer(): array
    {
        $pid = (int) Database::state('localai:server:pid', '0');
        $killed = false;
        if ($pid > 0) {
            $killed = Terminal::killTree($pid);
            Database::setState('localai:server:pid', '0');
        }
        Database::setState('localai:llamacpp:loaded_path', '');
        return ['stopped' => $killed, 'pid' => $pid, 'running' => self::serverUp()['ok']];
    }

    /* ================================================================== */
    /* Catalog & search                                                   */
    /* ================================================================== */

    public static function catalogFile(): string
    {
        $v = (string) (getenv('AGENT_MODEL_CATALOG') ?: '');
        return $v !== '' ? $v : Bootstrap::$dataDir . '/model_catalog.json';
    }

    public static function catalog(bool $refresh = false): array
    {
        static $cache = null;
        if ($cache !== null && !$refresh) {
            return $cache;
        }
        $file = self::catalogFile();
        if (!is_file($file)) {
            $cache = ['schemaVersion' => 1, 'models' => [], 'taskLabels' => []];
            return $cache;
        }
        $data = json_decode(Files::read($file), true);
        $cache = is_array($data) ? $data : ['schemaVersion' => 1, 'models' => [], 'taskLabels' => []];
        return $cache;
    }

    /** Flatten the catalog into one row per (model, variant). */
    public static function variants(): array
    {
        $rows = [];
        foreach (self::catalog()['models'] ?? [] as $model) {
            foreach ($model['variants'] ?? [] as $v) {
                $row = $v;
                $row['modelId'] = (string) $model['id'];
                $row['ref'] = (string) $model['id'] . ':' . (string) $v['tag'];
                $row['name'] = (string) $model['name'] . ' ' . strtoupper((string) $v['tag']);
                $row['model'] = $model;
                $rows[] = $row;
            }
        }
        return $rows;
    }

    /** Real tag list straight from the Ollama registry (no auth required). */
    public static function registryTags(string $name): array
    {
        $name = trim($name);
        if ($name === '') {
            return [];
        }
        $repo = str_contains($name, '/') ? $name : 'library/' . $name;
        $url = self::REGISTRY . '/v2/' . $repo . '/tags/list';
        $proxy = Config::proxyConfig($url);
        $r = HttpClient::getJson($proxy['effectiveUrl'], [], 20, $proxy['proxyClient']);
        $tags = $r['json']['tags'] ?? [];
        return is_array($tags) ? array_values(array_map('strval', $tags)) : [];
    }

    /** Exact download size of a tag, from the registry manifest. */
    public static function registrySize(string $name, string $tag = 'latest'): ?float
    {
        $repo = str_contains($name, '/') ? $name : 'library/' . $name;
        $url = self::REGISTRY . '/v2/' . $repo . '/manifests/' . rawurlencode($tag);
        $proxy = Config::proxyConfig($url);
        $r = HttpClient::getJson(
            $proxy['effectiveUrl'],
            ['Accept' => 'application/vnd.docker.distribution.manifest.v2+json'],
            20,
            $proxy['proxyClient']
        );
        $layers = $r['json']['layers'] ?? null;
        if (!is_array($layers)) {
            return null;
        }
        $bytes = 0;
        foreach ($layers as $l) {
            $bytes += (int) ($l['size'] ?? 0);
        }
        return $bytes > 0 ? round($bytes / 1073741824, 2) : null;
    }

    /** Approximate bits-per-weight for a quant code, used to size files we have no exact byte count for. */
    private static function quantBits(string $quant): float
    {
        $q = strtoupper(trim($quant));
        if (isset(self::BPW[$q])) {
            return self::BPW[$q];
        }
        if (str_starts_with($q, 'BF16') || $q === 'F16') {
            return 16.0;
        }
        if ($q === 'F32') {
            return 32.0;
        }
        if (preg_match('/^I?Q(\d)/', $q, $m)) {
            return match ((int) $m[1]) {
                2 => 2.6, 3 => 3.9, 4 => 4.85, 5 => 5.7, 6 => 6.6, 8 => 8.5,
                default => 4.85,
            };
        }
        return 4.85;
    }

    /** Pull the quantisation code (Q4_K_M, IQ3_XS, F16, …) out of a `.gguf` file name. */
    private static function extractGgufQuant(string $filename): ?string
    {
        $base = (string) preg_replace('/\.gguf$/i', '', trim($filename));
        $base = (string) preg_replace('/-\d{5}-of-\d{5}$/i', '', $base); // drop multi-part suffix
        if (preg_match('/(?:^|[._-])(i?q[0-9](?:_[a-z0-9]+)*|bf16|fp?16|fp?32)$/i', $base, $m)) {
            $tag = strtoupper($m[1]);
            return match ($tag) {
                'FP16' => 'F16',
                'FP32' => 'F32',
                default => $tag,
            };
        }
        return null;
    }

    /** Multi-part GGUF releases ship as `name-00001-of-00004.gguf`; those need every shard pulled together. */
    private static function isSplitGgufFilename(string $filename): bool
    {
        return (bool) preg_match('/-\d{5}-of-\d{5}\.gguf$/i', $filename);
    }

    /** Safe, filesystem-friendly directory name for a Hugging Face `owner/repo` id. */
    private static function safeRepoDirName(string $repo): string
    {
        $safe = (string) preg_replace('/[^A-Za-z0-9._-]+/', '_', trim($repo, '/'));
        return $safe !== '' ? $safe : 'model';
    }

    /**
     * Fetch the live file list of a Hugging Face repo (cached per request) so
     * we only ever offer quantisations that actually exist — this is what
     * stops the installer from pulling a reference that 404s.
     *
     * @return array<int,string> raw file names (siblings)
     */
    private static function hfRepoFiles(string $repo): array
    {
        static $cache = [];
        if (isset($cache[$repo])) {
            return $cache[$repo];
        }
        $url = self::HF_API . '/' . $repo;
        $proxy = Config::proxyConfig($url);
        $r = HttpClient::getJson($proxy['effectiveUrl'] . '?' . http_build_query(['expand[]' => 'siblings']), ['Accept' => 'application/json'], 15, $proxy['proxyClient']);
        $files = [];
        foreach ((array) ($r['json']['siblings'] ?? []) as $sib) {
            $name = (string) ($sib['rfilename'] ?? '');
            if ($name !== '') {
                $files[] = $name;
            }
        }
        $cache[$repo] = $files;
        return $files;
    }

    /**
     * Build the quant → file map for a Hugging Face repo, preferring the
     * single consolidated file over split shards when both exist.
     *
     * @param array<int,string> $files
     * @return array<string,array{filename:string,split:bool}>
     */
    private static function quantMapFromFiles(array $files): array
    {
        $map = [];
        foreach ($files as $fname) {
            if (!str_ends_with(strtolower($fname), '.gguf')) {
                continue;
            }
            $quant = self::extractGgufQuant($fname);
            if ($quant === null) {
                continue;
            }
            $split = self::isSplitGgufFilename($fname);
            if (!isset($map[$quant]) || ($map[$quant]['split'] && !$split)) {
                $map[$quant] = ['filename' => $fname, 'split' => $split];
            }
        }
        return $map;
    }

    /** Pick the best default quant out of what a repo actually ships. */
    private static function defaultQuant(array $quantMap): ?string
    {
        if (!$quantMap) {
            return null;
        }
        foreach (self::QUANT_PRIORITY as $cand) {
            if (isset($quantMap[$cand])) {
                return $cand;
            }
        }
        return array_key_first($quantMap);
    }

    /**
     * Resolve a "download request" for the llama.cpp engine into an exact,
     * verified `{repo, filename, quant, url}` — llama.cpp has no `/api/pull`,
     * so unlike Ollama it only ever gets a concrete file to fetch, never an
     * ambiguous repo reference.
     *
     * Accepted `$ref` shapes:
     *   - "hf.co/{owner}/{repo}:{QUANT}"  (as produced by search())
     *   - "hf.co/{owner}/{repo}"          (no quant → pick the best default)
     *   - "{owner}/{repo}"                (bare HF id)
     *   - a direct "https://…/*.gguf" URL (downloaded verbatim)
     */
    public static function resolveGgufDownload(string $ref, ?string $explicitFile = null): array
    {
        $ref = trim($ref);
        if ($ref === '') {
            throw new HttpError(400, 'A model reference is required');
        }

        if (preg_match('#^https?://#i', $ref)) {
            if (!str_ends_with(strtolower($ref), '.gguf')) {
                throw new HttpError(400, 'Direct URLs must point at a .gguf file');
            }
            $filename = basename(parse_url($ref, PHP_URL_PATH) ?: 'model.gguf');
            return ['repo' => '', 'filename' => $filename, 'quant' => self::extractGgufQuant($filename) ?? 'CUSTOM', 'url' => $ref];
        }

        $repo = preg_replace('#^hf\.co/#i', '', $ref);
        $quant = null;
        if (str_contains($repo, ':')) {
            [$repo, $quant] = explode(':', $repo, 2);
            $quant = strtoupper(trim($quant));
        }
        $repo = trim($repo, '/');
        if (!str_contains($repo, '/')) {
            throw new HttpError(400, "Could not understand model reference \"{$ref}\" — expected \"owner/repo\" or \"hf.co/owner/repo:QUANT\"");
        }

        $filename = $explicitFile;
        if ($filename === null) {
            $files = self::hfRepoFiles($repo);
            $map = self::quantMapFromFiles($files);
            if (!$map) {
                throw new HttpError(404, "No .gguf files were found in Hugging Face repo \"{$repo}\" (it may be a non-GGUF or private repo).");
            }
            $quant ??= self::defaultQuant($map);
            if (!isset($map[$quant])) {
                $available = implode(', ', array_keys($map));
                throw new HttpError(404, "Quantisation \"{$quant}\" does not exist in \"{$repo}\". Available: {$available}");
            }
            $filename = $map[$quant]['filename'];
        }
        $quant ??= self::extractGgufQuant($filename) ?? 'CUSTOM';

        $url = 'https://huggingface.co/' . $repo . '/resolve/main/' . rawurlencode($filename);
        // rawurlencode also escapes '/', which some repos use in sub-paths.
        $url = 'https://huggingface.co/' . $repo . '/resolve/main/' . implode('/', array_map('rawurlencode', explode('/', $filename)));

        return ['repo' => $repo, 'filename' => $filename, 'quant' => $quant, 'url' => $url];
    }

    /**
     * Search: curated catalog first (rich metadata), then Hugging Face GGUF
     * repositories as a long tail. Never throws — offline hosts get the
     * catalog only.
     */
    public static function search(string $query, int $limit = 25, bool $remote = true): array
    {
        $q = mb_strtolower(trim($query));
        $local = [];
        foreach (self::catalog()['models'] ?? [] as $m) {
            $hay = mb_strtolower(implode(' ', [
                (string) $m['id'], (string) $m['name'], (string) ($m['publisher'] ?? ''),
                (string) ($m['summary'] ?? ''), implode(' ', (array) ($m['tasks'] ?? [])),
            ]));
            if ($q === '' || str_contains($hay, $q)) {
                $local[] = [
                    'source' => 'catalog',
                    'id' => (string) $m['id'],
                    'name' => (string) $m['name'],
                    'publisher' => (string) ($m['publisher'] ?? ''),
                    'summary' => (string) ($m['summary'] ?? ''),
                    'description' => (string) ($m['summary'] ?? ''),
                    'license' => (string) ($m['license'] ?? 'Open'),
                    'tasks' => (array) ($m['tasks'] ?? []),
                    'toolCalling' => (bool) ($m['toolCalling'] ?? false),
                    'vision' => (bool) ($m['vision'] ?? false),
                    'reasoning' => (bool) ($m['reasoning'] ?? false),
                    'contextMax' => (int) ($m['contextMax'] ?? 8192),
                    'variants' => array_map(static fn(array $v): array => [
                        'tag' => (string) $v['tag'],
                        'ref' => (string) $m['id'] . ':' . (string) $v['tag'],
                        'diskGb' => (float) $v['diskGb'],
                        'ramGb' => round((float) $v['diskGb'] * self::WEIGHT_RAM_FACTOR + self::RUNTIME_OVERHEAD_GB + 0.8, 1),
                        'quant' => (string) $v['quant'],
                        'paramsB' => (float) ($v['paramsB'] ?? 0),
                        'quality' => (int) ($v['quality'] ?? 50),
                        'contextMax' => (int) ($m['contextMax'] ?? 8192),
                        'toolCalling' => (bool) ($m['toolCalling'] ?? false),
                        'vision' => (bool) ($m['vision'] ?? false),
                        'reasoning' => (bool) ($m['reasoning'] ?? false),
                    ], (array) ($m['variants'] ?? [])),
                ];
            }
        }

        $hf = [];
        if ($remote && $q !== '') {
            try {
                $url = self::HF_API . '?' . http_build_query([
                    'search' => $query,
                    'filter' => 'gguf',
                    'sort' => 'downloads',
                    'direction' => -1,
                    'limit' => max(1, min(50, $limit)),
                ]) . '&expand[]=siblings&expand[]=downloads&expand[]=likes';
                $proxy = Config::proxyConfig($url);
                $r = HttpClient::getJson($proxy['effectiveUrl'], ['Accept' => 'application/json'], 20, $proxy['proxyClient']);
                foreach ((array) ($r['json'] ?? []) as $item) {
                    if (!is_array($item)) {
                        continue;
                    }
                    $modelId = (string) ($item['modelId'] ?? $item['id'] ?? '');
                    if ($modelId === '') {
                        continue;
                    }
                    $mLow = strtolower($modelId);

                    $paramsB = 0.0;
                    if (preg_match('/(\d+(?:\.\d+)?)\s*b(?:\b|[-_])/i', $mLow, $pm)) {
                        $paramsB = (float) $pm[1];
                    }

                    // Only offer repos whose file list actually contains a usable .gguf —
                    // this is what guarantees the "Install" button can never 404.
                    $siblings = array_values(array_filter(array_map(
                        static fn($s) => (string) ($s['rfilename'] ?? ''),
                        (array) ($item['siblings'] ?? [])
                    )));
                    $quantMap = self::quantMapFromFiles($siblings);
                    if (!$quantMap) {
                        continue;
                    }

                    $quantOptions = [];
                    foreach ($quantMap as $quant => $info) {
                        $disk = $paramsB > 0
                            ? round($paramsB * 1e9 * self::quantBits($quant) / 8 / 1073741824, 2)
                            : 4.5;
                        $ram = round($disk * self::WEIGHT_RAM_FACTOR + self::RUNTIME_OVERHEAD_GB + 0.8, 1);
                        $quantOptions[] = [
                            'quant' => $quant,
                            'filename' => $info['filename'],
                            'split' => $info['split'],
                            'ref' => 'hf.co/' . $modelId . ':' . $quant,
                            'diskGb' => $disk,
                            'ramGb' => $ram,
                        ];
                    }
                    usort($quantOptions, static fn(array $a, array $b): int => $a['diskGb'] <=> $b['diskGb']);

                    $defaultQuant = self::defaultQuant($quantMap);
                    $default = null;
                    foreach ($quantOptions as $qo) {
                        if ($qo['quant'] === $defaultQuant) {
                            $default = $qo;
                            break;
                        }
                    }
                    $default ??= $quantOptions[0];

                    $hf[] = [
                        'source' => 'huggingface',
                        'id' => $modelId,
                        'name' => $modelId,
                        'publisher' => explode('/', $modelId)[0] ?? 'HuggingFace',
                        'downloads' => (int) ($item['downloads'] ?? 0),
                        'likes' => (int) ($item['likes'] ?? 0),
                        'tasks' => array_values(array_filter((array) ($item['tags'] ?? []), 'is_string')),
                        'pullRef' => $default['ref'],
                        'diskGb' => $default['diskGb'],
                        'ramGb' => $default['ramGb'],
                        'quant' => $default['quant'],
                        'quantOptions' => $quantOptions,
                        'paramsB' => $paramsB,
                        'toolCalling' => str_contains($mLow, 'tool') || str_contains($mLow, 'function'),
                        'vision' => str_contains($mLow, 'vision') || str_contains($mLow, 'vl'),
                        'reasoning' => str_contains($mLow, 'r1') || str_contains($mLow, 'reason') || str_contains($mLow, 'qwq'),
                        'summary' => sprintf(
                            'مخزن GGUF در Hugging Face — %d کوانت موجود، پیش‌فرض %s (%.1f گیگابایت).',
                            count($quantOptions),
                            $default['quant'],
                            $default['diskGb']
                        ),
                    ];
                }
            } catch (\Throwable $e) {
                Observability::log('WARNING', 'LOCALAI', 'Hugging Face search failed: ' . $e->getMessage());
            }
        }

        return ['query' => $query, 'catalog' => $local, 'huggingface' => array_slice($hf, 0, $limit)];
    }

    /* ================================================================== */
    /* Sizing & recommendation                                            */
    /* ================================================================== */

    /** @return array<string,mixed> a fully defaulted, validated wizard profile */
    public static function normalizeProfile(array $in): array
    {
        $host = self::hostScan();
        $tasks = array_values(array_filter(array_map(
            static fn($t): string => strtolower(trim((string) $t)),
            (array) ($in['tasks'] ?? ($in['task'] ?? []))
        )));
        if (!$tasks) {
            $tasks = ['chat'];
        }

        $budget = (float) ($in['ramBudgetGb'] ?? 0);
        if ($budget <= 0) {
            $budget = (float) $host['suggestedRamBudgetGb'];
        }
        $vram = array_key_exists('vramGb', $in) ? (float) $in['vramGb'] : (float) ($host['gpu']['vramGb'] ?? 0);
        $disk = (float) ($in['diskBudgetGb'] ?? 0);
        if ($disk <= 0) {
            $disk = max(1.0, (float) $host['disk']['freeGb'] - 2.0);
        }

        $priority = strtolower((string) ($in['priority'] ?? 'balanced'));
        if (!in_array($priority, ['speed', 'balanced', 'quality'], true)) {
            $priority = 'balanced';
        }

        return [
            'tasks' => $tasks,
            'ramBudgetGb' => round(max(0.5, $budget), 2),
            'vramGb' => round(max(0.0, $vram), 2),
            'diskBudgetGb' => round(max(0.5, $disk), 2),
            'contextTokens' => max(1024, min(1048576, (int) ($in['contextTokens'] ?? 8192))),
            'languages' => array_values(array_filter(array_map('strval', (array) ($in['languages'] ?? ['en'])))),
            'priority' => $priority,
            'concurrency' => max(1, min(16, (int) ($in['concurrency'] ?? 1))),
            'requireToolCalling' => (bool) ($in['requireToolCalling'] ?? in_array('agent', $tasks, true)),
            'requireVision' => (bool) ($in['requireVision'] ?? in_array('vision', $tasks, true)),
            'requireEmbedding' => (bool) ($in['requireEmbedding'] ?? in_array('embedding', $tasks, true)),
            'minTokensPerSec' => (float) ($in['minTokensPerSec'] ?? 0),
            'allowNonCommercial' => (bool) ($in['allowNonCommercial'] ?? true),
            'quantPreference' => (string) ($in['quantPreference'] ?? 'auto'),
        ];
    }

    /**
     * Memory / throughput model.
     *
     *   weights  = diskGb × 1.08                      dequantisation buffers
     *   active   = activeGb × 1.08                    MoE reads only the live experts
     *   kv       = kvGbPer1k × ctx/1024 × parallel    halved by an int8 KV cache
     *   ram      = weights + kv + 0.6 GB              0.6 GB = graph + server
     *   tok/s    ≈ bandwidth ÷ active × 0.72          local LLMs are bandwidth-bound
     *
     * `bandwidth` is the harmonic blend of GPU and CPU bandwidth weighted by the
     * fraction of the model that actually fits in VRAM — a partially offloaded
     * model runs at close to the speed of its slowest tier, not the average.
     */
    public static function estimate(array $variant, array $profile, ?array $host = null): array
    {
        $host ??= self::hostScan();
        $disk = (float) ($variant['diskGb'] ?? 0);
        $weights = $disk * self::WEIGHT_RAM_FACTOR;
        $active = ((float) ($variant['activeGb'] ?? $disk)) * self::WEIGHT_RAM_FACTOR;

        $kvScale = strtolower((string) (self::serverEnv()['OLLAMA_KV_CACHE_TYPE'] ?? 'f16')) === 'f16' ? 1.0 : 0.5;
        $ctxK = $profile['contextTokens'] / 1024;
        $kv = (float) ($variant['kvGbPer1k'] ?? 0.05) * $ctxK * $kvScale * max(1, (int) $profile['concurrency']);

        $ramGb = round($weights + $kv + self::RUNTIME_OVERHEAD_GB, 2);

        $vram = (float) $profile['vramGb'];
        $gpuBw = (float) ($host['bandwidthGBs']['gpu'] ?? 0);
        if ($gpuBw <= 0 && $vram > 0) {
            $gpuBw = 320.0; // user declared VRAM on a host we could not probe
        }
        $cpuBw = (float) ($host['bandwidthGBs']['cpu'] ?? 28.0);
        $offload = ($vram > 0 && $gpuBw > 0)
            ? max(0.0, min(1.0, ($vram - $kv - 0.5) / max(0.1, $weights)))
            : 0.0;
        $bandwidth = $offload >= 0.999
            ? $gpuBw
            : 1.0 / (($offload / max(1.0, $gpuBw)) + ((1 - $offload) / max(1.0, $cpuBw)));

        $tps = $active > 0 ? ($bandwidth / $active) * 0.72 : 0.0;
        // Tiny models become compute-bound rather than bandwidth-bound.
        $tps = min($tps, 20.0 * max(1, (int) ($host['cpu']['cores'] ?? 4)) * ($offload > 0.5 ? 6 : 1));

        return [
            'weightsGb' => round($weights, 2),
            'activeGb' => round($active, 2),
            'kvCacheGb' => round($kv, 2),
            'overheadGb' => self::RUNTIME_OVERHEAD_GB,
            'ramGb' => $ramGb,
            'diskGb' => round($disk, 2),
            'gpuOffloadRatio' => round($offload, 2),
            'effectiveBandwidthGBs' => round($bandwidth, 1),
            'tokensPerSec' => round($tps, 1),
            'fitsRam' => $ramGb <= (float) $profile['ramBudgetGb'],
            'fitsDisk' => $disk <= (float) $profile['diskBudgetGb'],
        ];
    }

    /**
     * Satisficing speed score: ~14 tok/s already reads faster than a human, so
     * more than that barely improves the experience, while anything under
     * 1.5 tok/s is genuinely painful and gets halved.
     */
    private static function speedScore(float $tps): float
    {
        $s = min(1.0, log(1 + $tps / 2.5) / log(1 + 14 / 2.5));
        return $tps < 1.5 ? $s * 0.5 : $s;
    }

    private static function taskMatch(array $model, array $tasks): float
    {
        $have = array_map('strval', (array) ($model['tasks'] ?? []));
        if (!$tasks) {
            return 0.5;
        }
        $hits = 0;
        foreach ($tasks as $t) {
            if (in_array($t, $have, true)) {
                $hits++;
            } elseif ($t === 'agent' && !empty($model['toolCalling'])) {
                $hits++;
            } elseif ($t === 'vision' && !empty($model['vision'])) {
                $hits++;
            } elseif ($t === 'reasoning' && !empty($model['reasoning'])) {
                $hits++;
            }
        }
        return $hits / count($tasks);
    }

    private static function languageScore(array $model, array $languages): float
    {
        if (!$languages) {
            return 0.7;
        }
        $have = array_map('strval', (array) ($model['languages'] ?? []));
        $total = 0.0;
        foreach ($languages as $lang) {
            $lang = strtolower($lang);
            if ($lang === 'fa') {
                $total += ((float) ($model['faScore'] ?? 0)) / 100;
            } elseif (in_array($lang, $have, true) || in_array('multi', $have, true)) {
                $total += 1.0;
            } else {
                $total += 0.25;
            }
        }
        return $total / count($languages);
    }

    /**
     * Rank every catalog variant for this profile.
     *
     * @return array{profile:array, host:array, recommendations:array, rejected:array}
     */
    public static function recommend(array $rawProfile): array
    {
        $profile = self::normalizeProfile($rawProfile);
        $host = self::hostScan();

        $weights = match ($profile['priority']) {
            'speed' => ['quality' => 0.18, 'speed' => 0.42, 'task' => 0.20, 'lang' => 0.10, 'fit' => 0.10],
            'quality' => ['quality' => 0.48, 'speed' => 0.08, 'task' => 0.22, 'lang' => 0.10, 'fit' => 0.12],
            default => ['quality' => 0.34, 'speed' => 0.22, 'task' => 0.22, 'lang' => 0.10, 'fit' => 0.12],
        };

        $ranked = [];
        $rejected = [];

        foreach (self::variants() as $v) {
            $model = $v['model'];
            $est = self::estimate($v, $profile, $host);
            $reasons = [];
            $blockers = [];

            if (!$est['fitsRam']) {
                $blockers[] = sprintf('به %.1f گیگ رم نیاز دارد (بودجه: %.1f)', $est['ramGb'], $profile['ramBudgetGb']);
            }
            if (!$est['fitsDisk']) {
                $blockers[] = sprintf('به %.1f گیگ دیسک نیاز دارد (آزاد: %.1f)', $est['diskGb'], $profile['diskBudgetGb']);
            }
            if ($profile['contextTokens'] > (int) ($model['contextMax'] ?? 8192)) {
                $blockers[] = sprintf('حداکثر پنجرهٔ این مدل %d توکن است', (int) ($model['contextMax'] ?? 0));
            }
            if ($profile['requireToolCalling'] && empty($model['toolCalling'])) {
                $blockers[] = 'ابزارفراخوانی (tool calling) ندارد';
            }
            if ($profile['requireVision'] && empty($model['vision'])) {
                $blockers[] = 'قابلیت بینایی ندارد';
            }
            if ($profile['requireEmbedding'] !== (bool) ($model['embedding'] ?? false)) {
                $blockers[] = $profile['requireEmbedding'] ? 'مدل امبدینگ نیست' : 'فقط مدل امبدینگ است و برای چت به کار نمی‌آید';
            }
            if ($profile['minTokensPerSec'] > 0 && $est['tokensPerSec'] < $profile['minTokensPerSec']) {
                $blockers[] = sprintf('سرعت تخمینی %.1f توکن/ثانیه کمتر از حداقل درخواستی است', $est['tokensPerSec']);
            }
            if (!$profile['allowNonCommercial'] && str_contains(strtoupper((string) ($model['license'] ?? '')), 'NC')) {
                $blockers[] = 'لایسنس غیرتجاری است';
            }

            if ($blockers) {
                $rejected[] = ['ref' => $v['ref'], 'name' => $v['name'], 'reasons' => $blockers, 'estimate' => $est];
                continue;
            }

            $rawQuality = (float) ($v['quality'] ?? 50);
            // Exponent > 1: a weak model has to be a *lot* faster to win.
            $quality = ($rawQuality / 100) ** 1.6;
            $speed = self::speedScore((float) $est['tokensPerSec']);
            $task = self::taskMatch($model, $profile['tasks']);
            $lang = self::languageScore($model, $profile['languages']);
            $ratio = $est['ramGb'] / max(0.1, (float) $profile['ramBudgetGb']);
            $fit = $ratio <= 0.85 ? ($ratio / 0.85) : max(0.0, 1 - ($ratio - 0.85) * 4);

            $score = $weights['quality'] * $quality
                + $weights['speed'] * $speed
                + $weights['task'] * $task
                + $weights['lang'] * $lang
                + $weights['fit'] * $fit;

            if (!empty($model['toolCalling']) && in_array('agent', $profile['tasks'], true)) {
                $score += 0.04;
                $reasons[] = 'ابزارفراخوانی رسمی دارد و با حلقهٔ عامل این برنامه سازگار است';
            }
            if ($est['gpuOffloadRatio'] >= 0.99) {
                $score += 0.03;
                $reasons[] = 'کاملاً روی GPU جا می‌شود';
            } elseif ($est['gpuOffloadRatio'] > 0.1) {
                $reasons[] = sprintf('حدود %d%% روی GPU بارگذاری می‌شود', (int) round($est['gpuOffloadRatio'] * 100));
            }
            if ($task >= 0.99) {
                $reasons[] = 'دقیقاً برای کاری که انتخاب کردید ساخته شده است';
            }
            if (in_array('fa', array_map('strtolower', $profile['languages']), true)) {
                $reasons[] = sprintf('امتیاز فارسی: %d از ۱۰۰', (int) ($model['faScore'] ?? 0));
            }
            $reasons[] = sprintf('حدود %.1f گیگ رم و %.1f گیگ دیسک؛ تقریباً %.0f توکن بر ثانیه',
                $est['ramGb'], $est['diskGb'], $est['tokensPerSec']);
            if (!empty($model['notes'])) {
                $reasons[] = (string) $model['notes'];
            }

            $ranked[] = [
                'ref' => $v['ref'],
                'modelId' => $v['modelId'],
                'tag' => (string) $v['tag'],
                'name' => $v['name'],
                'publisher' => (string) ($model['publisher'] ?? ''),
                'license' => (string) ($model['license'] ?? ''),
                'summary' => (string) ($model['summary'] ?? ''),
                'tasks' => (array) ($model['tasks'] ?? []),
                'contextMax' => (int) ($model['contextMax'] ?? 8192),
                'toolCalling' => (bool) ($model['toolCalling'] ?? false),
                'vision' => (bool) ($model['vision'] ?? false),
                'embedding' => (bool) ($model['embedding'] ?? false),
                'reasoning' => (bool) ($model['reasoning'] ?? false),
                'quant' => (string) ($v['quant'] ?? ''),
                'paramsB' => (float) ($v['paramsB'] ?? 0),
                'moe' => (bool) ($v['moe'] ?? false),
                'rawQuality' => $rawQuality,
                'score' => round($score, 4),
                'scorePct' => (int) round(min(100, $score * 100)),
                'breakdown' => [
                    'quality' => round($quality, 2), 'speed' => round($speed, 2),
                    'task' => round($task, 2), 'language' => round($lang, 2), 'fit' => round($fit, 2),
                ],
                'estimate' => $est,
                'reasons' => $reasons,
                'url' => (string) ($model['url'] ?? ''),
            ];
        }

        // Soft matching fallback: if strict criteria filtered out everything, relax constraints so user always gets actionable recommendations
        if (empty($ranked)) {
            foreach (self::variants() as $v) {
                $model = $v['model'];
                $est = self::estimate($v, $profile, $host);
                $softReasons = [];
                $penalty = 1.0;

                if (!$est['fitsRam']) {
                    $softReasons[] = sprintf('نیازمند %.1f گیگابایت رم (بودجه فعلی: %.1f گیگ)', $est['ramGb'], $profile['ramBudgetGb']);
                    $penalty *= max(0.2, 1.0 - (($est['ramGb'] - $profile['ramBudgetGb']) / max(1.0, $profile['ramBudgetGb'])));
                }
                if ($profile['contextTokens'] > (int) ($model['contextMax'] ?? 8192)) {
                    $softReasons[] = sprintf('پنجره کانتکست مدل به %d توکن محدود می‌شود', (int) ($model['contextMax'] ?? 8192));
                    $penalty *= 0.9;
                }
                if ($profile['requireToolCalling'] && empty($model['toolCalling'])) {
                    $softReasons[] = 'فاقد ابزارفراخوانی رسمی (پاسخ متنی و کدنویسی مستقیم)';
                    $penalty *= 0.7;
                }
                if ($profile['requireVision'] && empty($model['vision'])) {
                    $softReasons[] = 'فاقد قابلیت بینایی';
                    $penalty *= 0.7;
                }
                if ($profile['requireEmbedding'] !== (bool) ($model['embedding'] ?? false)) {
                    $softReasons[] = $profile['requireEmbedding'] ? 'مدل امبدینگ نیست' : 'فقط مدل امبدینگ است و برای چت/کدنویسی مناسب نیست';
                    $penalty *= 0.3;
                }

                $rawQuality = (float) ($v['quality'] ?? 50);
                $quality = ($rawQuality / 100) ** 1.6;
                $speed = self::speedScore((float) $est['tokensPerSec']);
                $task = self::taskMatch($model, $profile['tasks']);
                $lang = self::languageScore($model, $profile['languages']);
                $fit = 0.5;

                $score = ($weights['quality'] * $quality
                    + $weights['speed'] * $speed
                    + $weights['task'] * $task
                    + $weights['lang'] * $lang
                    + $weights['fit'] * $fit) * $penalty;

                $softReasons[] = sprintf('تخمین: %.1f گیگ رم · %.1f گیگ دیسک · تقریباً %.0f توکن بر ثانیه',
                    $est['ramGb'], $est['diskGb'], $est['tokensPerSec']);

                $ranked[] = [
                    'ref' => $v['ref'],
                    'modelId' => $v['modelId'],
                    'tag' => (string) $v['tag'],
                    'name' => $v['name'],
                    'publisher' => (string) ($model['publisher'] ?? ''),
                    'license' => (string) ($model['license'] ?? ''),
                    'summary' => (string) ($model['summary'] ?? ''),
                    'tasks' => (array) ($model['tasks'] ?? []),
                    'contextMax' => (int) ($model['contextMax'] ?? 8192),
                    'toolCalling' => (bool) ($model['toolCalling'] ?? false),
                    'vision' => (bool) ($model['vision'] ?? false),
                    'embedding' => (bool) ($model['embedding'] ?? false),
                    'reasoning' => (bool) ($model['reasoning'] ?? false),
                    'quant' => (string) ($v['quant'] ?? ''),
                    'paramsB' => (float) ($v['paramsB'] ?? 0),
                    'moe' => (bool) ($v['moe'] ?? false),
                    'rawQuality' => $rawQuality,
                    'score' => round($score, 4),
                    'scorePct' => (int) round(min(100, $score * 100)),
                    'breakdown' => [
                        'quality' => round($quality, 2), 'speed' => round($speed, 2),
                        'task' => round($task, 2), 'language' => round($lang, 2), 'fit' => round($fit, 2),
                    ],
                    'estimate' => $est,
                    'reasons' => $softReasons,
                    'url' => (string) ($model['url'] ?? ''),
                ];
            }
        }

        // Relative-quality demotion: when a clearly stronger model also fits the
        // budget, a toy-sized one must not win on raw speed alone.
        $bestQuality = 0.0;
        foreach ($ranked as $r) {
            $bestQuality = max($bestQuality, (float) $r['rawQuality']);
        }
        if ($bestQuality > 0) {
            foreach ($ranked as &$r) {
                $factor = 0.6 + 0.4 * ((float) $r['rawQuality'] / $bestQuality);
                $r['score'] = round($r['score'] * $factor, 4);
                $r['scorePct'] = (int) round(min(100, $r['score'] * 100));
                if ($factor < 0.85) {
                    $r['reasons'][] = 'در همین بودجه مدل قوی‌تری هم جا می‌شود؛ این گزینه فقط سریع‌تر است';
                }
            }
            unset($r);
        }

        usort($ranked, static fn(array $a, array $b): int => $b['score'] <=> $a['score']);
        usort($rejected, static fn(array $a, array $b): int => $a['estimate']['ramGb'] <=> $b['estimate']['ramGb']);

        return [
            'profile' => $profile,
            'host' => $host,
            'recommendations' => array_slice($ranked, 0, 12),
            'best' => $ranked[0] ?? null,
            'rejected' => array_slice($rejected, 0, 12),
            'totalEvaluated' => count($ranked) + count($rejected),
        ];
    }

    /* ================================================================== */
    /* llama.cpp local file index — llama-server has no pull/tags/delete  */
    /* API at all, so Ollama's are mirrored here against a JSON index of  */
    /* files that live wherever the user put them (downloaded or scanned).*/
    /* ================================================================== */

    public static function llamaCppIndexFile(): string
    {
        return self::rootDir() . '/llamacpp-models.json';
    }

    /** @return array<string,array{name:string,path:string,quant:string,repo:string,addedAt:string}> */
    public static function llamaCppIndex(): array
    {
        $file = self::llamaCppIndexFile();
        if (!is_file($file)) {
            return [];
        }
        $data = json_decode(Files::read($file), true);
        return is_array($data) ? $data : [];
    }

    private static function llamaCppIndexSave(array $index): void
    {
        Files::ensureDir(self::rootDir());
        Files::write(self::llamaCppIndexFile(), (string) json_encode($index, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    }

    public static function llamaCppIndexAdd(string $name, array $entry): void
    {
        $index = self::llamaCppIndex();
        $index[$name] = array_merge(['name' => $name], $entry);
        self::llamaCppIndexSave($index);
    }

    public static function llamaCppIndexRemove(string $name): void
    {
        $index = self::llamaCppIndex();
        unset($index[$name]);
        self::llamaCppIndexSave($index);
    }

    /**
     * Point llama-server at a specific `.gguf` on disk, (re)starting it if a
     * different model is currently loaded. This is the only way to "install"
     * a second model with this engine without losing the first — llama.cpp
     * serves exactly one model per process.
     */
    public static function activateLlamaCppModel(string $path, ?int $ctxSize = null, ?callable $log = null): array
    {
        if (!is_file($path)) {
            throw new HttpError(404, 'Model file not found on disk: ' . $path);
        }
        Database::setState('localai:llamacpp:active_path', $path);
        return self::startServer([], $log, $path, $ctxSize);
    }

    /* ================================================================== */
    /* Installed models                                                   */
    /* ================================================================== */

    public static function installed(): array
    {
        $engine = (string) (Database::state('localai:engine', 'ollama') ?? 'ollama');
        if ($engine === 'llamacpp') {
            return self::installedLlamaCpp();
        }

        $up = self::serverUp('ollama');
        if (!$up['ok']) {
            return ['running' => false, 'models' => [], 'loaded' => [], 'error' => (string) ($up['error'] ?? '')];
        }
        $tags = HttpClient::getJson(self::host() . '/api/tags', [], 20);
        $ps = HttpClient::getJson(self::host() . '/api/ps', [], 10);
        $models = [];
        foreach ((array) ($tags['json']['models'] ?? []) as $m) {
            $models[] = [
                'name' => (string) ($m['name'] ?? ''),
                'sizeGb' => round(((float) ($m['size'] ?? 0)) / 1073741824, 2),
                'modifiedAt' => (string) ($m['modified_at'] ?? ''),
                'family' => (string) ($m['details']['family'] ?? ''),
                'parameterSize' => (string) ($m['details']['parameter_size'] ?? ''),
                'quantization' => (string) ($m['details']['quantization_level'] ?? ''),
                'digest' => substr((string) ($m['digest'] ?? ''), 0, 12),
            ];
        }
        $loaded = [];
        foreach ((array) ($ps['json']['models'] ?? []) as $m) {
            $loaded[] = [
                'name' => (string) ($m['name'] ?? ''),
                'sizeGb' => round(((float) ($m['size'] ?? 0)) / 1073741824, 2),
                'sizeVramGb' => round(((float) ($m['size_vram'] ?? 0)) / 1073741824, 2),
                'expiresAt' => (string) ($m['expires_at'] ?? ''),
            ];
        }
        return ['running' => true, 'version' => (string) ($up['version'] ?? ''), 'models' => $models, 'loaded' => $loaded, 'error' => ''];
    }

    /** Same shape as the Ollama branch of installed(), backed by the local file index instead of an API. */
    public static function installedLlamaCpp(): array
    {
        $up = self::serverUp('llamacpp');
        $activePath = (string) (Database::state('localai:llamacpp:active_path', '') ?? '');
        $index = self::llamaCppIndex();
        $models = [];
        $loaded = [];
        foreach ($index as $name => $entry) {
            $path = (string) ($entry['path'] ?? '');
            $exists = $path !== '' && is_file($path);
            $sizeGb = $exists ? round(filesize($path) / 1073741824, 2) : (float) ($entry['sizeGb'] ?? 0);
            $models[] = [
                'name' => (string) $name,
                'sizeGb' => $sizeGb,
                'modifiedAt' => (string) ($entry['addedAt'] ?? ''),
                'family' => '',
                'parameterSize' => '',
                'quantization' => (string) ($entry['quant'] ?? ''),
                'digest' => '',
                'path' => $path,
                'missing' => !$exists,
            ];
            if ($up['ok'] && $path === $activePath && $activePath !== '') {
                $loaded[] = ['name' => (string) $name, 'sizeGb' => $sizeGb, 'sizeVramGb' => 0.0, 'expiresAt' => ''];
            }
        }
        return [
            'running' => $up['ok'],
            'version' => (string) ($up['version'] ?? ''),
            'models' => $models,
            'loaded' => $loaded,
            'error' => $up['ok'] ? '' : (string) ($up['error'] ?? ''),
        ];
    }

    public static function remove(string $model): array
    {
        $model = trim($model);
        if ($model === '') {
            throw new HttpError(400, 'Model name is required');
        }
        $engine = (string) (Database::state('localai:engine', 'ollama') ?? 'ollama');
        if ($engine === 'llamacpp') {
            $index = self::llamaCppIndex();
            $entry = $index[$model] ?? null;
            if ($entry === null) {
                throw new HttpError(404, 'Unknown local model: ' . $model);
            }
            $path = (string) ($entry['path'] ?? '');
            $activePath = (string) (Database::state('localai:llamacpp:active_path', '') ?? '');
            if ($path !== '' && $path === $activePath) {
                self::stopServer();
                Database::setState('localai:llamacpp:active_path', '');
            }
            if (!empty($entry['owned']) && $path !== '' && is_file($path)) {
                @unlink($path);
            }
            self::llamaCppIndexRemove($model);
            Observability::log('INFO', 'LOCALAI', 'Removed local llama.cpp model ' . $model);
            return ['ok' => true, 'removed' => $model];
        }

        $r = HttpClient::request(
            'DELETE',
            self::host() . '/api/delete',
            ['Content-Type' => 'application/json'],
            (string) json_encode(['name' => $model]),
            60
        );
        if (!$r['ok']) {
            throw new HttpError(502, 'Delete failed: ' . ($r['error'] ?? ('HTTP ' . $r['status'])));
        }
        Observability::log('INFO', 'LOCALAI', 'Removed local model ' . $model);
        return ['ok' => true, 'removed' => $model];
    }

    /** Streamed `ollama pull` with NDJSON progress. */
    public static function pull(string $model, ?callable $onProgress = null, int $timeout = 7200): array
    {
        $buffer = '';
        $lastPct = -1.0;
        $status = '';
        $error = '';

        $res = HttpClient::stream(
            self::host() . '/api/pull',
            ['Accept' => 'application/x-ndjson'],
            (string) json_encode(['name' => $model, 'stream' => true]),
            static function (string $chunk) use (&$buffer, &$lastPct, &$status, &$error, $onProgress): bool {
                $buffer .= $chunk;
                while (($nl = strpos($buffer, "\n")) !== false) {
                    $line = trim(substr($buffer, 0, $nl));
                    $buffer = substr($buffer, $nl + 1);
                    if ($line === '') {
                        continue;
                    }
                    $j = json_decode($line, true);
                    if (!is_array($j)) {
                        continue;
                    }
                    if (!empty($j['error'])) {
                        $error = (string) $j['error'];
                        return false;
                    }
                    $status = (string) ($j['status'] ?? $status);
                    $total = (float) ($j['total'] ?? 0);
                    $done = (float) ($j['completed'] ?? 0);
                    $pct = $total > 0 ? round($done / $total * 100, 1) : $lastPct;
                    if ($onProgress !== null && ($pct !== $lastPct || $status !== '')) {
                        $onProgress($status, $pct < 0 ? 0.0 : $pct, $done, $total);
                    }
                    $lastPct = $pct;
                }
                return true;
            },
            $timeout
        );

        if ($error !== '') {
            throw new HttpError(502, 'Pull failed: ' . $error);
        }
        if (!$res['ok'] && !$res['aborted']) {
            throw new HttpError(502, 'Pull failed: ' . ($res['error'] ?? ('HTTP ' . $res['status'])));
        }
        return ['ok' => true, 'model' => $model, 'status' => $status ?: 'success', 'latencyMs' => $res['latencyMs']];
    }

    /**
     * llama.cpp equivalent of pull(): there is no registry protocol, so this
     * downloads one concrete, already-verified GGUF file straight from
     * Hugging Face into storage/localai/models/llamacpp/.
     *
     * @param callable(string,float,float,float):void|null $onProgress (status, pct, downloadedBytes, totalBytes)
     */
    public static function pullGguf(string $ref, ?string $explicitFile, ?callable $onProgress = null, int $timeout = 7200): array
    {
        $resolved = self::resolveGgufDownload($ref, $explicitFile);
        $dir = self::modelsDir() . '/llamacpp/' . ($resolved['repo'] !== '' ? self::safeRepoDirName($resolved['repo']) : 'custom');
        $dest = $dir . '/' . basename($resolved['filename']);
        Files::ensureDir($dir);

        $lastPct = -1.0;
        $proxy = Config::proxyConfig($resolved['url']);
        $dl = HttpClient::downloadProgress(
            $proxy['effectiveUrl'],
            $dest,
            $timeout,
            $proxy['proxyClient'],
            $onProgress === null ? null : static function (float $downloaded, float $total) use ($onProgress, &$lastPct): void {
                $pct = $total > 0 ? round($downloaded / $total * 100, 1) : -1.0;
                if ($pct !== $lastPct) {
                    $onProgress('downloading', $pct < 0 ? 0.0 : $pct, $downloaded, $total);
                    $lastPct = $pct;
                }
            }
        );
        if (!$dl['ok']) {
            throw new HttpError(502, 'Download failed for ' . $resolved['url'] . ': ' . ($dl['error'] ?? ('HTTP ' . $dl['status'])));
        }
        return [
            'ok' => true,
            'repo' => $resolved['repo'],
            'filename' => $resolved['filename'],
            'quant' => $resolved['quant'],
            'path' => $dest,
            'sizeGb' => round((float) filesize($dest) / 1073741824, 2),
        ];
    }

    /**
     * Derive a tuned copy of a model with the context window and sampling the
     * wizard asked for, so the agent never has to pass them per request.
     */
    public static function tune(string $base, string $target, array $params): array
    {
        $body = ['model' => $target, 'from' => $base, 'parameters' => array_filter([
            'num_ctx' => (int) ($params['num_ctx'] ?? 0) ?: null,
            'temperature' => array_key_exists('temperature', $params) ? (float) $params['temperature'] : null,
            'top_p' => array_key_exists('top_p', $params) ? (float) $params['top_p'] : null,
            'repeat_penalty' => array_key_exists('repeat_penalty', $params) ? (float) $params['repeat_penalty'] : null,
        ], static fn($v): bool => $v !== null), 'stream' => false];
        if (!empty($params['system'])) {
            $body['system'] = (string) $params['system'];
        }
        $r = HttpClient::postJson(self::host() . '/api/create', $body, [], 900);
        if (!$r['ok']) {
            throw new HttpError(502, 'Tuning failed: ' . ($r['error'] ?? ('HTTP ' . $r['status'] . ' ' . mb_substr($r['body'], 0, 200))));
        }
        return ['ok' => true, 'model' => $target, 'from' => $base, 'parameters' => $body['parameters']];
    }

    /** Short generation used both as a smoke test and as a throughput measurement. */
    public static function benchmark(string $model, string $prompt = 'Say OK.', int $numPredict = 48): array
    {
        $engine = (string) (Database::state('localai:engine', 'ollama') ?? 'ollama');
        if ($engine === 'llamacpp') {
            return self::benchmarkLlamaCpp($model, $prompt, $numPredict);
        }

        $started = microtime(true);
        $r = HttpClient::postJson(self::host() . '/api/generate', [
            'model' => $model,
            'prompt' => $prompt,
            'stream' => false,
            'options' => ['num_predict' => $numPredict],
        ], [], 600);
        $wall = round((microtime(true) - $started) * 1000, 1);
        if (!$r['ok']) {
            return ['ok' => false, 'model' => $model, 'error' => $r['error'] ?? ('HTTP ' . $r['status']), 'latencyMs' => $wall];
        }
        $j = (array) ($r['json'] ?? []);
        $evalCount = (int) ($j['eval_count'] ?? 0);
        $evalNs = (float) ($j['eval_duration'] ?? 0);
        return [
            'ok' => true,
            'model' => $model,
            'response' => mb_substr((string) ($j['response'] ?? ''), 0, 400),
            'tokens' => $evalCount,
            'tokensPerSec' => $evalNs > 0 ? round($evalCount / ($evalNs / 1e9), 1) : 0.0,
            'firstTokenMs' => round(((float) ($j['prompt_eval_duration'] ?? 0)) / 1e6, 1),
            'latencyMs' => $wall,
        ];
    }

    /** llama-server's native `/completion` reports its own timings — no manual math needed. */
    public static function benchmarkLlamaCpp(string $model, string $prompt = 'Say OK.', int $numPredict = 48): array
    {
        $index = self::llamaCppIndex();
        $path = (string) ($index[$model]['path'] ?? '');
        if ($path !== '' && $path !== (string) (Database::state('localai:llamacpp:active_path', '') ?? '')) {
            self::activateLlamaCppModel($path);
        } elseif (!self::serverUp('llamacpp')['ok']) {
            self::startServer();
        }

        $started = microtime(true);
        $r = HttpClient::postJson(self::host() . '/completion', [
            'prompt' => $prompt,
            'n_predict' => $numPredict,
            'stream' => false,
        ], [], 600);
        $wall = round((microtime(true) - $started) * 1000, 1);
        if (!$r['ok']) {
            return ['ok' => false, 'model' => $model, 'error' => $r['error'] ?? ('HTTP ' . $r['status']), 'latencyMs' => $wall];
        }
        $j = (array) ($r['json'] ?? []);
        $timings = (array) ($j['timings'] ?? []);
        $tps = (float) ($timings['predicted_per_second'] ?? 0);
        $tokens = (int) ($timings['predicted_n'] ?? 0);
        if ($tps <= 0 && $tokens > 0 && !empty($timings['predicted_ms'])) {
            $tps = round($tokens / ((float) $timings['predicted_ms'] / 1000), 1);
        }
        return [
            'ok' => true,
            'model' => $model,
            'response' => mb_substr((string) ($j['content'] ?? ''), 0, 400),
            'tokens' => $tokens,
            'tokensPerSec' => round($tps, 1),
            'firstTokenMs' => round((float) ($timings['prompt_ms'] ?? 0), 1),
            'latencyMs' => $wall,
        ];
    }

    /* ================================================================== */
    /* Provider registration                                              */
    /* ================================================================== */

    /** Make the freshly pulled model selectable in the chat UI. */
    public static function registerProvider(string $modelRef, array $meta = []): array
    {
        $engine = (string) ($meta['engine'] ?? (Database::state('localai:engine', 'ollama') ?? 'ollama'));
        if ($engine === 'llamacpp') {
            return self::registerLlamaCppProvider($modelRef, $meta);
        }

        $store = ProviderStore::reload();
        $provider = $store->get('ollama') ?? ProviderStore::normalizeProvider([
            'id' => 'ollama',
            'name' => 'Ollama (local)',
            'vendor' => 'ollama-models',
            'protocol' => 'ollama',
        ]);
        $provider['url'] = self::host();
        $provider['enabled'] = true;
        $provider['timeoutSec'] = max(300, (int) ($provider['timeoutSec'] ?? 120));

        $model = ProviderStore::normalizeModel([
            'id' => $modelRef,
            'name' => (string) ($meta['name'] ?? $modelRef),
            'toolCalling' => (bool) ($meta['toolCalling'] ?? false),
            'vision' => (bool) ($meta['vision'] ?? false),
            'free' => true,
            'maxInputTokens' => (int) ($meta['contextTokens'] ?? 8192),
            'maxOutputTokens' => (int) ($meta['maxOutputTokens'] ?? 4096),
            'enabled' => true,
            'extra' => ['local' => true, 'runtime' => 'ollama', 'installedAt' => gmdate('c')],
        ]);

        $models = [];
        $replaced = false;
        foreach ((array) ($provider['models'] ?? []) as $m) {
            if ((string) ($m['id'] ?? '') === $modelRef) {
                $models[] = $model;
                $replaced = true;
            } else {
                $models[] = $m;
            }
        }
        if (!$replaced) {
            $models[] = $model;
        }
        $provider['models'] = $models;

        $store->upsert($provider);
        Config::invalidate();
        Observability::log('INFO', 'LOCALAI', 'Registered local model as provider entry', ['model' => $modelRef]);
        return ['provider' => 'ollama', 'model' => $modelRef, 'url' => self::host()];
    }

    /**
     * llama-server only ever has one model loaded, so (unlike Ollama) the
     * provider's model list always contains exactly that one entry — picking
     * an older llama.cpp model in the chat UI after switching would otherwise
     * silently talk to whatever is actually in memory.
     */
    public static function registerLlamaCppProvider(string $modelRef, array $meta = []): array
    {
        $store = ProviderStore::reload();
        $provider = $store->get('llamacpp-local') ?? ProviderStore::normalizeProvider([
            'id' => 'llamacpp-local',
            'name' => 'llama.cpp (local)',
            'vendor' => 'llamacpp',
        ]);
        $provider['url'] = rtrim(self::host(), '/') . '/v1';
        $provider['enabled'] = true;
        $provider['apiKey'] = 'local-llamacpp';
        $provider['timeoutSec'] = max(300, (int) ($provider['timeoutSec'] ?? 120));

        $model = ProviderStore::normalizeModel([
            'id' => $modelRef,
            'name' => (string) ($meta['name'] ?? $modelRef),
            'toolCalling' => (bool) ($meta['toolCalling'] ?? false),
            'vision' => (bool) ($meta['vision'] ?? false),
            'free' => true,
            'maxInputTokens' => (int) ($meta['contextTokens'] ?? 8192),
            'maxOutputTokens' => (int) ($meta['maxOutputTokens'] ?? 4096),
            'enabled' => true,
            'extra' => ['local' => true, 'runtime' => 'llamacpp', 'installedAt' => gmdate('c'), 'modelPath' => (string) ($meta['path'] ?? '')],
        ]);
        // Only one process-resident model → replace the whole list, don't append.
        $provider['models'] = [$model];

        $store->upsert($provider);
        Config::invalidate();
        Observability::log('INFO', 'LOCALAI', 'Registered local llama.cpp model as provider entry', ['model' => $modelRef]);
        return ['provider' => 'llamacpp-local', 'model' => $modelRef, 'url' => $provider['url']];
    }

    /* ================================================================== */
    /* Install pipeline (background job)                                  */
    /* ================================================================== */

    /** Validate a request and enqueue the job the worker will run. */
    public static function enqueueInstall(array $req, string $userId = 'user'): array
    {
        $ref = trim((string) ($req['ref'] ?? $req['model'] ?? ''));
        if ($ref === '') {
            throw new HttpError(400, 'A model reference (e.g. "qwen2.5-coder:7b") is required');
        }
        $profile = self::normalizeProfile((array) ($req['profile'] ?? []));
        $engine = (string) (Database::state('localai:engine', 'ollama') ?? 'ollama');

        $variant = null;
        foreach (self::variants() as $v) {
            if ($v['ref'] === $ref) {
                $variant = $v;
                break;
            }
        }

        if ($engine === 'llamacpp') {
            if ($variant !== null) {
                throw new HttpError(400, 'مدل‌های کاتالوگ Ollama با موتور llama.cpp قابل نصب نیستند — موتور را به Ollama تغییر دهید یا از نتایج Hugging Face / اسکن درایو استفاده کنید.');
            }
            $payload = [
                'kind' => 'localai_install',
                'engine' => 'llamacpp',
                'ref' => $ref,
                'hfFile' => (string) ($req['file'] ?? '') ?: null,
                'profile' => $profile,
                'estimate' => [
                    'ramGb' => (float) ($req['estimateRamGb'] ?? 0),
                    'diskGb' => (float) ($req['estimateDiskGb'] ?? 0),
                ],
                'register' => (bool) ($req['register'] ?? true),
                'setDefault' => (bool) ($req['setDefault'] ?? false),
                'benchmark' => (bool) ($req['benchmark'] ?? true),
                'toolCalling' => (bool) ($req['toolCalling'] ?? false),
                'vision' => (bool) ($req['vision'] ?? false),
                'displayName' => (string) ($req['displayName'] ?? $ref),
            ];
            $job = Jobs::create([
                'title' => 'نصب مدل محلی (llama.cpp): ' . $ref,
                'userId' => $userId,
                'providerId' => 'llamacpp-local',
                'modelId' => $ref,
                'maxSteps' => 4,
                'maxTimeoutSec' => (int) ($req['timeoutSec'] ?? 7200),
                'payload' => $payload,
            ]);
            return ['job' => $job, 'plan' => self::plan($payload), 'estimate' => $payload['estimate'], 'profile' => $profile];
        }

        $estimate = $variant !== null ? self::estimate($variant, $profile) : null;
        if ($estimate !== null && !$estimate['fitsRam'] && empty($req['force'])) {
            throw new HttpError(409, sprintf(
                'This model needs about %.1f GB of RAM but the budget is %.1f GB. Re-send with "force": true to override.',
                $estimate['ramGb'],
                $profile['ramBudgetGb']
            ));
        }

        $payload = [
            'kind' => 'localai_install',
            'engine' => 'ollama',
            'ref' => $ref,
            'profile' => $profile,
            'estimate' => $estimate,
            'tune' => (bool) ($req['tune'] ?? true),
            'register' => (bool) ($req['register'] ?? true),
            'setDefault' => (bool) ($req['setDefault'] ?? false),
            'benchmark' => (bool) ($req['benchmark'] ?? true),
            'toolCalling' => (bool) ($variant['model']['toolCalling'] ?? ($req['toolCalling'] ?? false)),
            'vision' => (bool) ($variant['model']['vision'] ?? ($req['vision'] ?? false)),
            'displayName' => (string) ($variant['name'] ?? $ref),
        ];

        $job = Jobs::create([
            'title' => 'نصب مدل محلی: ' . $ref,
            'userId' => $userId,
            'providerId' => 'ollama',
            'modelId' => $ref,
            'maxSteps' => 6,
            'maxTimeoutSec' => (int) ($req['timeoutSec'] ?? 7200),
            'payload' => $payload,
        ]);

        return ['job' => $job, 'plan' => self::plan($payload), 'estimate' => $estimate, 'profile' => $profile];
    }

    /** Human-readable step list, shown in the UI before the user confirms. */
    public static function plan(array $payload): array
    {
        $engine = (string) ($payload['engine'] ?? 'ollama');
        if ($engine === 'llamacpp') {
            $rt = self::runtimeStatus();
            $steps = [];
            $steps[] = ['id' => 'runtime', 'title' => 'آماده‌سازی موتور llama.cpp',
                        'detail' => ($rt['engines']['llamacpp']['installed'] ?? false) ? 'نصب است' : 'دانلود و نصب بدون نیاز به root در ' . self::binDir()];
            $steps[] = ['id' => 'pull', 'title' => 'دانلود فایل GGUF برای ' . (string) $payload['ref'],
                        'detail' => sprintf('حدود %.1f گیگابایت — دانلود مستقیم از Hugging Face', (float) ($payload['estimate']['diskGb'] ?? 0))];
            $steps[] = ['id' => 'server', 'title' => 'بارگذاری مدل در llama-server', 'detail' => self::host()];
            if (!empty($payload['benchmark'])) {
                $steps[] = ['id' => 'benchmark', 'title' => 'تست سلامت و سنجش سرعت', 'detail' => 'یک تولید کوتاه برای اندازه‌گیری توکن بر ثانیه'];
            }
            if (!empty($payload['register'])) {
                $steps[] = ['id' => 'register', 'title' => 'ثبت به‌عنوان ارائه‌دهنده', 'detail' => 'اضافه شدن به فهرست مدل‌های چت'];
            }
            return $steps;
        }

        $rt = self::runtimeStatus();
        $steps = [];
        $steps[] = ['id' => 'runtime', 'title' => 'آماده‌سازی موتور Ollama',
                    'detail' => $rt['installed'] ? 'نصب است (' . ($rt['version'] ?: 'نسخهٔ نامشخص') . ')' : 'دانلود و نصب بدون نیاز به root در ' . self::binDir()];
        $steps[] = ['id' => 'server', 'title' => 'اجرای سرویس محلی', 'detail' => self::host() . ' با مدل‌های ' . self::modelsDir()];
        $steps[] = ['id' => 'pull', 'title' => 'دانلود مدل ' . (string) $payload['ref'],
                    'detail' => sprintf('حدود %.1f گیگابایت', (float) ($payload['estimate']['diskGb'] ?? 0))];
        if (!empty($payload['tune'])) {
            $steps[] = ['id' => 'tune', 'title' => 'ساخت نسخهٔ تنظیم‌شده',
                        'detail' => 'پنجرهٔ ' . (int) ($payload['profile']['contextTokens'] ?? 8192) . ' توکن'];
        }
        if (!empty($payload['benchmark'])) {
            $steps[] = ['id' => 'benchmark', 'title' => 'تست سلامت و سنجش سرعت', 'detail' => 'یک تولید کوتاه برای اندازه‌گیری توکن بر ثانیه'];
        }
        if (!empty($payload['register'])) {
            $steps[] = ['id' => 'register', 'title' => 'ثبت به‌عنوان ارائه‌دهنده', 'detail' => 'اضافه شدن به فهرست مدل‌های چت'];
        }
        return $steps;
    }

    /**
     * Executed by bin/worker.php (via Jobs::execute) — never in a web request.
     */
    public static function runInstallJob(string $jobId, array $payload): void
    {
        $engine = (string) ($payload['engine'] ?? Database::state('localai:engine', 'ollama') ?? 'ollama');
        if ($engine === 'llamacpp') {
            self::runInstallJobLlamaCpp($jobId, $payload);
            return;
        }

        $ref = (string) ($payload['ref'] ?? '');
        $profile = (array) ($payload['profile'] ?? []);
        $log = static function (string $msg, string $level = 'INFO') use ($jobId): void {
            Jobs::log($jobId, $level, $msg);
        };
        $progress = static function (float $pct, string $summary = '') use ($jobId): void {
            Database::run(
                "UPDATE jobs SET progress = ?, summary = CASE WHEN ? = '' THEN summary ELSE ? END, updated_at = datetime('now') WHERE id = ?",
                [round($pct, 1), $summary, $summary, $jobId]
            );
        };
        $step = 0;
        $result = ['ref' => $ref, 'steps' => []];
        $started = microtime(true);

        try {
            /* 1 ─ runtime */
            $t = microtime(true);
            $log('Checking the local AI runtime…');
            $rt = self::installRuntime($log);
            Jobs::recordStep($jobId, $step++, 'localai.runtime', ['engine' => 'ollama'], $rt, 'success', (microtime(true) - $t) * 1000);
            $result['steps']['runtime'] = $rt;
            $progress(10, 'موتور محلی آماده شد');

            /* 2 ─ server */
            $t = microtime(true);
            $srv = self::startServer([
                'OLLAMA_NUM_PARALLEL' => (string) max(1, (int) ($profile['concurrency'] ?? 1)),
                'OLLAMA_CONTEXT_LENGTH' => (string) (int) ($profile['contextTokens'] ?? 8192),
            ], $log);
            Jobs::recordStep($jobId, $step++, 'localai.server', [], $srv, 'success', (microtime(true) - $t) * 1000);
            $result['steps']['server'] = $srv;
            $progress(15, 'سرویس محلی در حال اجراست');

            /* 3 ─ pull */
            $t = microtime(true);
            $log('Pulling ' . $ref . ' …');
            $lastLogged = 0.0;
            $pull = self::pull($ref, static function (string $status, float $pct, float $done, float $total) use ($progress, $log, &$lastLogged): void {
                $overall = 15 + ($pct * 0.65);
                $progress($overall, sprintf('دانلود مدل: %.0f%%', $pct));
                if ($pct - $lastLogged >= 10 || ($pct >= 100 && $lastLogged < 100)) {
                    $lastLogged = $pct;
                    $log(sprintf('%s — %.0f%% (%s / %s)', $status, $pct, Files::humanSize((int) $done), Files::humanSize((int) $total)));
                }
            });
            Jobs::recordStep($jobId, $step++, 'localai.pull', ['model' => $ref], $pull, 'success', (microtime(true) - $t) * 1000);
            $result['steps']['pull'] = $pull;
            $progress(80, 'مدل دانلود شد');

            /* 4 ─ tune */
            $finalRef = $ref;
            if (!empty($payload['tune'])) {
                $t = microtime(true);
                $target = preg_replace('/[^a-z0-9._-]+/i', '-', str_replace(':', '-', $ref)) . '-agent';
                try {
                    $tuned = self::tune($ref, $target, [
                        'num_ctx' => (int) ($profile['contextTokens'] ?? 8192),
                        'temperature' => 0.2,
                        'top_p' => 0.9,
                    ]);
                    $finalRef = $target;
                    $log('Tuned variant created: ' . $target);
                    Jobs::recordStep($jobId, $step++, 'localai.tune', ['from' => $ref], $tuned, 'success', (microtime(true) - $t) * 1000);
                    $result['steps']['tune'] = $tuned;
                } catch (\Throwable $e) {
                    $log('Tuning skipped: ' . $e->getMessage(), 'WARNING');
                    Jobs::recordStep($jobId, $step++, 'localai.tune', ['from' => $ref], ['error' => $e->getMessage()], 'error', (microtime(true) - $t) * 1000);
                }
            }
            $progress(86, 'نسخهٔ تنظیم‌شده آماده شد');

            /* 5 ─ benchmark */
            if (!empty($payload['benchmark'])) {
                $t = microtime(true);
                $bench = self::benchmark($finalRef, 'In one short sentence, say that the local model is ready.');
                $log($bench['ok']
                    ? sprintf('Benchmark: %.1f tok/s (%d tokens)', (float) ($bench['tokensPerSec'] ?? 0), (int) ($bench['tokens'] ?? 0))
                    : 'Benchmark failed: ' . (string) ($bench['error'] ?? ''), $bench['ok'] ? 'INFO' : 'WARNING');
                Jobs::recordStep($jobId, $step++, 'localai.benchmark', ['model' => $finalRef], $bench, $bench['ok'] ? 'success' : 'error', (microtime(true) - $t) * 1000);
                $result['steps']['benchmark'] = $bench;
            }
            $progress(93, 'تست سلامت انجام شد');

            /* 6 ─ register */
            if (!empty($payload['register'])) {
                $t = microtime(true);
                $reg = self::registerProvider($finalRef, [
                    'name' => (string) ($payload['displayName'] ?? $finalRef),
                    'toolCalling' => (bool) ($payload['toolCalling'] ?? false),
                    'vision' => (bool) ($payload['vision'] ?? false),
                    'contextTokens' => (int) ($profile['contextTokens'] ?? 8192),
                ]);
                if (!empty($payload['setDefault'])) {
                    Database::setState('localai:default', $finalRef);
                    Config::writeEnvironment(['OLLAMA_BASE_URL' => self::host()]);
                }
                Jobs::recordStep($jobId, $step++, 'localai.register', ['model' => $finalRef], $reg, 'success', (microtime(true) - $t) * 1000);
                $result['steps']['register'] = $reg;
            }

            $result['model'] = $finalRef;
            $result['durationSec'] = round(microtime(true) - $started, 1);
            $ref2 = Jobs::saveArtifact($jobId, $result);
            Database::run(
                "UPDATE jobs SET status='done', progress=100.0, step_count=?, result_ref=?, summary=?,
                 finished_at=datetime('now'), updated_at=datetime('now') WHERE id = ?",
                [$step, $ref2, 'مدل ' . $finalRef . ' با موفقیت نصب و فعال شد', $jobId]
            );
            $log('Local model install finished in ' . $result['durationSec'] . 's');
            Observability::log('INFO', 'LOCALAI', 'Local model installed', ['model' => $finalRef, 'job' => $jobId]);
        } catch (\Throwable $e) {
            $msg = $e->getMessage();
            Database::run(
                "UPDATE jobs SET status='failed', error=?, finished_at=datetime('now'), updated_at=datetime('now') WHERE id = ?",
                [$msg, $jobId]
            );
            $log('Install failed: ' . $msg, 'ERROR');
            Observability::log('ERROR', 'LOCALAI', 'Local model install failed', ['model' => $ref, 'error' => $msg]);
        }
    }

    /** llama.cpp has no pull/tune API: download one verified file, point llama-server at it, done. */
    public static function runInstallJobLlamaCpp(string $jobId, array $payload): void
    {
        $ref = (string) ($payload['ref'] ?? '');
        $profile = (array) ($payload['profile'] ?? []);
        $log = static function (string $msg, string $level = 'INFO') use ($jobId): void {
            Jobs::log($jobId, $level, $msg);
        };
        $progress = static function (float $pct, string $summary = '') use ($jobId): void {
            Database::run(
                "UPDATE jobs SET progress = ?, summary = CASE WHEN ? = '' THEN summary ELSE ? END, updated_at = datetime('now') WHERE id = ?",
                [round($pct, 1), $summary, $summary, $jobId]
            );
        };
        $step = 0;
        $result = ['ref' => $ref, 'steps' => []];
        $started = microtime(true);

        try {
            /* 1 ─ runtime */
            $t = microtime(true);
            $log('Checking the llama.cpp runtime…');
            $rt = self::installRuntime('llamacpp', $log);
            Jobs::recordStep($jobId, $step++, 'localai.runtime', ['engine' => 'llamacpp'], $rt, 'success', (microtime(true) - $t) * 1000);
            $result['steps']['runtime'] = $rt;
            $progress(10, 'موتور llama.cpp آماده شد');

            /* 2 ─ download the exact gguf file (never an ambiguous repo ref) */
            $t = microtime(true);
            $log('Resolving and downloading ' . $ref . ' …');
            $lastLogged = 0.0;
            $pull = self::pullGguf($ref, (string) ($payload['hfFile'] ?? '') ?: null, static function (string $status, float $pct, float $done, float $total) use ($progress, $log, &$lastLogged): void {
                $overall = 10 + ($pct * 0.7);
                $progress($overall, sprintf('دانلود فایل: %.0f%%', $pct));
                if ($pct - $lastLogged >= 10 || ($pct >= 100 && $lastLogged < 100)) {
                    $lastLogged = $pct;
                    $log(sprintf('%s — %.0f%% (%s / %s)', $status, $pct, Files::humanSize((int) $done), Files::humanSize((int) $total)));
                }
            });
            Jobs::recordStep($jobId, $step++, 'localai.pull', ['model' => $ref], $pull, 'success', (microtime(true) - $t) * 1000);
            $result['steps']['pull'] = $pull;
            $progress(80, 'فایل مدل دانلود شد');

            $modelName = (string) ($payload['displayName'] ?? ($pull['repo'] !== '' ? $pull['repo'] . ':' . $pull['quant'] : basename($pull['filename'])));
            self::llamaCppIndexAdd($modelName, [
                'path' => $pull['path'],
                'quant' => $pull['quant'],
                'repo' => $pull['repo'],
                'sizeGb' => $pull['sizeGb'],
                'owned' => true,
                'addedAt' => gmdate('c'),
            ]);

            /* 3 ─ activate: llama-server can only serve one model, so load this one now */
            $t = microtime(true);
            $srv = self::activateLlamaCppModel($pull['path'], (int) ($profile['contextTokens'] ?? 8192), $log);
            Jobs::recordStep($jobId, $step++, 'localai.server', [], $srv, 'success', (microtime(true) - $t) * 1000);
            $result['steps']['server'] = $srv;
            $progress(88, 'مدل در llama-server بارگذاری شد');

            /* 4 ─ benchmark */
            if (!empty($payload['benchmark'])) {
                $t = microtime(true);
                $bench = self::benchmarkLlamaCpp($modelName, 'In one short sentence, say that the local model is ready.');
                $log($bench['ok']
                    ? sprintf('Benchmark: %.1f tok/s (%d tokens)', (float) ($bench['tokensPerSec'] ?? 0), (int) ($bench['tokens'] ?? 0))
                    : 'Benchmark failed: ' . (string) ($bench['error'] ?? ''), $bench['ok'] ? 'INFO' : 'WARNING');
                Jobs::recordStep($jobId, $step++, 'localai.benchmark', ['model' => $modelName], $bench, $bench['ok'] ? 'success' : 'error', (microtime(true) - $t) * 1000);
                $result['steps']['benchmark'] = $bench;
            }
            $progress(94, 'تست سلامت انجام شد');

            /* 5 ─ register */
            if (!empty($payload['register'])) {
                $t = microtime(true);
                $reg = self::registerLlamaCppProvider($modelName, [
                    'name' => (string) ($payload['displayName'] ?? $modelName),
                    'toolCalling' => (bool) ($payload['toolCalling'] ?? false),
                    'vision' => (bool) ($payload['vision'] ?? false),
                    'contextTokens' => (int) ($profile['contextTokens'] ?? 8192),
                    'path' => $pull['path'],
                ]);
                if (!empty($payload['setDefault'])) {
                    Database::setState('localai:default', $modelName);
                }
                Jobs::recordStep($jobId, $step++, 'localai.register', ['model' => $modelName], $reg, 'success', (microtime(true) - $t) * 1000);
                $result['steps']['register'] = $reg;
            }

            $result['model'] = $modelName;
            $result['durationSec'] = round(microtime(true) - $started, 1);
            $ref2 = Jobs::saveArtifact($jobId, $result);
            Database::run(
                "UPDATE jobs SET status='done', progress=100.0, step_count=?, result_ref=?, summary=?,
                 finished_at=datetime('now'), updated_at=datetime('now') WHERE id = ?",
                [$step, $ref2, 'مدل ' . $modelName . ' با موفقیت نصب و فعال شد', $jobId]
            );
            $log('Local model install finished in ' . $result['durationSec'] . 's');
            Observability::log('INFO', 'LOCALAI', 'Local llama.cpp model installed', ['model' => $modelName, 'job' => $jobId]);
        } catch (\Throwable $e) {
            $msg = $e->getMessage();
            Database::run(
                "UPDATE jobs SET status='failed', error=?, finished_at=datetime('now'), updated_at=datetime('now') WHERE id = ?",
                [$msg, $jobId]
            );
            $log('Install failed: ' . $msg, 'ERROR');
            Observability::log('ERROR', 'LOCALAI', 'Local llama.cpp model install failed', ['model' => $ref, 'error' => $msg]);
        }
    }

    /* ================================================================== */
    /* Saved wizard profiles                                              */
    /* ================================================================== */

    public static function saveProfile(string $name, array $profile): array
    {
        $all = (array) (Database::stateJson('localai:profiles', []) ?? []);
        $all[$name] = ['name' => $name, 'profile' => self::normalizeProfile($profile), 'savedAt' => gmdate('c')];
        Database::setStateJson('localai:profiles', $all);
        return ['profiles' => array_values($all)];
    }

    public static function profiles(): array
    {
        $all = (array) (Database::stateJson('localai:profiles', []) ?? []);
        return ['profiles' => array_values($all), 'default' => (string) Database::state('localai:default', '')];
    }

    public static function deleteProfile(string $name): array
    {
        $all = (array) (Database::stateJson('localai:profiles', []) ?? []);
        unset($all[$name]);
        Database::setStateJson('localai:profiles', $all);
        return ['profiles' => array_values($all)];
    }

    /* ================================================================== */
    /* Drive scan & local import — find model files the user already has  */
    /* on disk (downloaded by hand, by another tool, or in another app's  */
    /* model cache) and use them without re-downloading anything.         */
    /* ================================================================== */

    /** Directories that are almost never worth descending into. */
    private const SCAN_EXCLUDE_NAMES = [
        'proc', 'sys', 'dev', 'run', 'node_modules', '.git', '.cache', '__pycache__',
        '.venv', 'venv', '.npm', '.cargo', '.rustup', '.next', '.nuxt', 'dist', 'build',
        '.Trash', '$RECYCLE.BIN',
    ];

    public static function defaultScanRoots(): array
    {
        $roots = [];
        $home = (string) (getenv('HOME') ?: '');
        if ($home !== '') {
            $roots[] = rtrim($home, '/');
        }
        foreach (['/root', '/home', '/opt', '/srv', '/data', '/mnt', '/media', '/var/www', '/workspace'] as $p) {
            if (is_dir($p)) {
                $roots[] = $p;
            }
        }
        $roots[] = self::rootDir();
        $roots[] = Bootstrap::$root;
        return array_values(array_unique(array_filter(array_map(static fn($p) => rtrim((string) $p, '/'), $roots), 'is_dir')));
    }

    /**
     * Walk the filesystem looking for model files (`.gguf`, `.ggml`,
     * `.safetensors`, …). Uses `find` when a real shell is available (fast,
     * handles millions of files) and falls back to a budgeted PHP iterator
     * otherwise. Always bounded by a result cap and a wall-clock budget so a
     * "scan the whole drive" request can never hang the request indefinitely.
     *
     * @return array{roots:array,full:bool,count:int,truncated:bool,tookSec:float,results:array}
     */
    public static function scanDrive(array $opts = []): array
    {
        $full = (bool) ($opts['full'] ?? false);
        $roots = array_values(array_filter(array_map('strval', (array) ($opts['roots'] ?? []))));
        if (!$roots) {
            $roots = $full ? ['/'] : self::defaultScanRoots();
        }
        $maxResults = max(1, min(2000, (int) ($opts['maxResults'] ?? 300)));
        $timeBudget = max(5, min(120, (int) ($opts['timeBudgetSec'] ?? 25)));
        $exts = array_values(array_filter(array_map('strtolower', (array) ($opts['extensions'] ?? self::SCAN_EXTENSIONS)))) ?: self::SCAN_EXTENSIONS;

        $started = microtime(true);
        $results = [];
        $hasShell = function_exists('proc_open');

        foreach ($roots as $root) {
            $elapsed = microtime(true) - $started;
            if ($elapsed > $timeBudget || count($results) >= $maxResults) {
                break;
            }
            if (!is_dir($root) || !is_readable($root)) {
                continue;
            }
            $remaining = (int) max(3, min(60, $timeBudget - $elapsed));
            if ($hasShell) {
                self::scanDirFind($root, $exts, $remaining, $results, $maxResults);
            } else {
                self::scanDirPhp($root, $exts, $results, $maxResults, $started, $timeBudget);
            }
        }

        usort($results, static fn(array $a, array $b): int => $b['sizeGb'] <=> $a['sizeGb']);
        $truncated = count($results) > $maxResults;
        $results = array_slice($results, 0, $maxResults);

        return [
            'roots' => $roots,
            'full' => $full,
            'count' => count($results),
            'truncated' => $truncated,
            'tookSec' => round(microtime(true) - $started, 2),
            'results' => $results,
        ];
    }

    /** Fast path: shell out to `find`, pruning noisy directories as it walks. */
    private static function scanDirFind(string $root, array $exts, int $timeoutSec, array &$results, int $maxResults): void
    {
        $nameExpr = [];
        foreach ($exts as $i => $e) {
            if ($i > 0) {
                $nameExpr[] = '-o';
            }
            $nameExpr[] = '-iname';
            $nameExpr[] = '*.' . $e;
        }
        $pruneExpr = [];
        foreach (self::SCAN_EXCLUDE_NAMES as $name) {
            $pruneExpr[] = '-name';
            $pruneExpr[] = $name;
            $pruneExpr[] = '-prune';
            $pruneExpr[] = '-o';
        }
        $cmd = array_merge(
            ['timeout', (string) $timeoutSec, 'find', $root, '-xdev'],
            $pruneExpr,
            ['('], $nameExpr, [')'],
            ['-type', 'f', '-printf', '%s|%T@|%p\n']
        );
        $out = Terminal::rawCapture($cmd, null, $timeoutSec + 5);
        foreach (explode("\n", (string) ($out['stdout'] ?? '')) as $line) {
            $line = trim($line);
            if ($line === '') {
                continue;
            }
            $parts = explode('|', $line, 3);
            if (count($parts) < 3) {
                continue;
            }
            [$sizeStr, $mtimeStr, $path] = $parts;
            $results[] = [
                'path' => $path,
                'sizeGb' => round(((float) $sizeStr) / 1073741824, 3),
                'ext' => strtolower((string) pathinfo($path, PATHINFO_EXTENSION)),
                'mtime' => (int) (float) $mtimeStr,
                'name' => basename($path),
                'quant' => self::extractGgufQuant(basename($path)),
            ];
            if (count($results) >= $maxResults) {
                return;
            }
        }
    }

    /** Fallback for hosts without proc_open(): a depth-first iterator with a hard time/size budget. */
    private static function scanDirPhp(string $root, array $exts, array &$results, int $maxResults, float $started, int $timeBudget): void
    {
        try {
            $dirIter = new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS);
            // A RecursiveCallbackFilterIterator decides *before* descending,
            // so excluded directories are never walked at all (unlike calling
            // getChildren() reactively, which only affects traversal order).
            $filtered = new \RecursiveCallbackFilterIterator($dirIter, static function ($current) {
                if ($current->isDir()) {
                    return !in_array($current->getFilename(), self::SCAN_EXCLUDE_NAMES, true);
                }
                return true;
            });
            $it = new \RecursiveIteratorIterator($filtered, \RecursiveIteratorIterator::LEAVES_ONLY);
        } catch (\Throwable) {
            return;
        }
        foreach ($it as $path => $info) {
            if (microtime(true) - $started > $timeBudget || count($results) >= $maxResults) {
                return;
            }
            try {
                if (!$info->isFile()) {
                    continue;
                }
                $ext = strtolower($info->getExtension());
                if (!in_array($ext, $exts, true)) {
                    continue;
                }
                $results[] = [
                    'path' => $path,
                    'sizeGb' => round($info->getSize() / 1073741824, 3),
                    'ext' => $ext,
                    'mtime' => $info->getMTime(),
                    'name' => $info->getFilename(),
                    'quant' => self::extractGgufQuant($info->getFilename()),
                ];
            } catch (\Throwable) {
                continue; // permission denied, broken symlink, etc.
            }
        }
    }

    /** Best-effort display name derived from a scanned/imported file path. */
    private static function suggestNameFromFile(string $path): string
    {
        $base = (string) preg_replace('/\.(gguf|ggml|bin|safetensors)$/i', '', basename($path));
        $base = trim((string) preg_replace('/-\d{5}-of-\d{5}$/i', '', $base));
        return $base !== '' ? $base : basename($path);
    }

    /**
     * Point the agent at a model file that is already on disk — no network
     * involved. Works for both engines:
     *   - Ollama: `ollama create <name> -f Modelfile` (Modelfile: `FROM <path>`)
     *   - llama.cpp: the file is referenced in place and loaded directly
     */
    public static function enqueueImport(array $req, string $userId = 'user'): array
    {
        $path = trim((string) ($req['path'] ?? ''));
        if ($path === '' || !is_file($path)) {
            throw new HttpError(400, 'فایل انتخاب‌شده روی دیسک پیدا نشد: ' . $path);
        }
        $ext = strtolower((string) pathinfo($path, PATHINFO_EXTENSION));
        if (!in_array($ext, ['gguf', 'ggml'], true)) {
            throw new HttpError(400, 'فقط فایل‌های gguf/ggml قابل درون‌ریزی مستقیم هستند؛ safetensors ابتدا باید به gguf تبدیل شود.');
        }
        $engine = (string) ($req['engine'] ?? Database::state('localai:engine', 'ollama') ?? 'ollama');
        $name = trim((string) ($req['name'] ?? '')) ?: self::suggestNameFromFile($path);

        $payload = [
            'kind' => 'localai_import',
            'engine' => $engine,
            'path' => $path,
            'name' => $name,
            'register' => (bool) ($req['register'] ?? true),
            'benchmark' => (bool) ($req['benchmark'] ?? true),
            'setDefault' => (bool) ($req['setDefault'] ?? false),
            'contextTokens' => (int) ($req['contextTokens'] ?? 8192),
        ];
        $job = Jobs::create([
            'title' => 'درون‌ریزی مدل محلی: ' . $name,
            'userId' => $userId,
            'providerId' => $engine === 'ollama' ? 'ollama' : 'llamacpp-local',
            'modelId' => $name,
            'maxSteps' => 4,
            'maxTimeoutSec' => (int) ($req['timeoutSec'] ?? 3600),
            'payload' => $payload,
        ]);
        return ['job' => $job];
    }

    /** Executed by bin/worker.php (via Jobs::execute) — never in a web request. */
    public static function runImportJob(string $jobId, array $payload): void
    {
        $engine = (string) ($payload['engine'] ?? 'ollama');
        $path = (string) ($payload['path'] ?? '');
        $name = (string) ($payload['name'] ?? '');
        $log = static function (string $msg, string $level = 'INFO') use ($jobId): void {
            Jobs::log($jobId, $level, $msg);
        };
        $progress = static function (float $pct, string $summary = '') use ($jobId): void {
            Database::run(
                "UPDATE jobs SET progress = ?, summary = CASE WHEN ? = '' THEN summary ELSE ? END, updated_at = datetime('now') WHERE id = ?",
                [round($pct, 1), $summary, $summary, $jobId]
            );
        };
        $step = 0;
        $started = microtime(true);
        $result = ['path' => $path, 'name' => $name, 'steps' => []];

        try {
            if (!is_file($path)) {
                throw new HttpError(404, 'File no longer exists: ' . $path);
            }

            if ($engine === 'llamacpp') {
                $t = microtime(true);
                $rt = self::installRuntime('llamacpp', $log);
                Jobs::recordStep($jobId, $step++, 'localai.runtime', ['engine' => 'llamacpp'], $rt, 'success', (microtime(true) - $t) * 1000);
                $progress(15, 'موتور llama.cpp آماده شد');

                self::llamaCppIndexAdd($name, [
                    'path' => $path,
                    'quant' => self::extractGgufQuant(basename($path)) ?? '',
                    'repo' => '',
                    'sizeGb' => round((float) filesize($path) / 1073741824, 2),
                    'owned' => false, // the file lives wherever the user put it — never delete it on removal
                    'addedAt' => gmdate('c'),
                ]);
                $progress(40, 'فایل به فهرست اضافه شد');

                $t = microtime(true);
                $srv = self::activateLlamaCppModel($path, (int) ($payload['contextTokens'] ?? 8192), $log);
                Jobs::recordStep($jobId, $step++, 'localai.server', [], $srv, 'success', (microtime(true) - $t) * 1000);
                $progress(70, 'مدل در llama-server بارگذاری شد');

                if (!empty($payload['benchmark'])) {
                    $bench = self::benchmarkLlamaCpp($name, 'In one short sentence, say that the local model is ready.');
                    $log($bench['ok'] ? sprintf('Benchmark: %.1f tok/s', (float) ($bench['tokensPerSec'] ?? 0)) : 'Benchmark failed: ' . (string) ($bench['error'] ?? ''));
                }
                $progress(85, 'تست سلامت انجام شد');

                if (!empty($payload['register'])) {
                    self::registerLlamaCppProvider($name, [
                        'name' => $name,
                        'contextTokens' => (int) ($payload['contextTokens'] ?? 8192),
                        'path' => $path,
                    ]);
                    if (!empty($payload['setDefault'])) {
                        Database::setState('localai:default', $name);
                    }
                }
            } else {
                // Ollama: a one-line Modelfile pointing at the existing weights.
                $t = microtime(true);
                $rt = self::installRuntime('ollama', $log);
                Jobs::recordStep($jobId, $step++, 'localai.runtime', ['engine' => 'ollama'], $rt, 'success', (microtime(true) - $t) * 1000);
                $progress(15, 'موتور Ollama آماده شد');

                self::startServer([], $log);
                $progress(25, 'سرویس محلی در حال اجراست');

                $safeName = strtolower((string) preg_replace('/[^a-z0-9._-]+/i', '-', trim($name, '-')));
                $safeName = trim($safeName, '-') ?: 'imported-model';
                $modelfile = self::rootDir() . '/Modelfile-' . $safeName . '-' . substr(md5($path), 0, 8);
                Files::write($modelfile, 'FROM ' . $path . "\n");

                $bin = self::binary('ollama');
                if ($bin === null) {
                    throw new HttpError(409, 'Ollama binary not found after install');
                }
                $log('Importing with `ollama create ' . $safeName . '` (this copies/converts the weights into Ollama\'s own store) …');
                $out = Terminal::rawCapture([$bin, 'create', $safeName, '-f', $modelfile], self::rootDir(), 1800, self::serverEnv());
                @unlink($modelfile);
                if ((int) ($out['exitCode'] ?? 1) !== 0) {
                    throw new HttpError(500, 'ollama create failed: ' . mb_substr((string) ($out['stderr'] ?: $out['stdout']), 0, 600));
                }
                $progress(70, 'مدل درون‌ریزی شد');
                $name = $safeName;

                if (!empty($payload['benchmark'])) {
                    $bench = self::benchmark($name, 'In one short sentence, say that the local model is ready.');
                    $log($bench['ok'] ? sprintf('Benchmark: %.1f tok/s', (float) ($bench['tokensPerSec'] ?? 0)) : 'Benchmark failed: ' . (string) ($bench['error'] ?? ''));
                }
                $progress(85, 'تست سلامت انجام شد');

                if (!empty($payload['register'])) {
                    self::registerProvider($name, [
                        'name' => $name,
                        'contextTokens' => (int) ($payload['contextTokens'] ?? 8192),
                        'engine' => 'ollama',
                    ]);
                    if (!empty($payload['setDefault'])) {
                        Database::setState('localai:default', $name);
                    }
                }
            }

            $result['model'] = $name;
            $result['durationSec'] = round(microtime(true) - $started, 1);
            $ref2 = Jobs::saveArtifact($jobId, $result);
            Database::run(
                "UPDATE jobs SET status='done', progress=100.0, step_count=?, result_ref=?, summary=?,
                 finished_at=datetime('now'), updated_at=datetime('now') WHERE id = ?",
                [$step, $ref2, 'مدل ' . $name . ' با موفقیت درون‌ریزی و فعال شد', $jobId]
            );
            $log('Import finished in ' . $result['durationSec'] . 's');
            Observability::log('INFO', 'LOCALAI', 'Local model imported', ['model' => $name, 'job' => $jobId]);
        } catch (\Throwable $e) {
            $msg = $e->getMessage();
            Database::run(
                "UPDATE jobs SET status='failed', error=?, finished_at=datetime('now'), updated_at=datetime('now') WHERE id = ?",
                [$msg, $jobId]
            );
            $log('Import failed: ' . $msg, 'ERROR');
            Observability::log('ERROR', 'LOCALAI', 'Local model import failed', ['path' => $path, 'error' => $msg]);
        }
    }
}
