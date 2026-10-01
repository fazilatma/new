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

    /** Resolved `ollama` executable: explicit env → private install → PATH. */
    public static function binary(): ?string
    {
        $explicit = (string) (getenv('AGENT_OLLAMA_BIN') ?: '');
        if ($explicit !== '' && is_file($explicit)) {
            return $explicit;
        }
        $local = self::binDir() . '/ollama';
        if (is_file($local) && is_executable($local)) {
            return $local;
        }
        if (function_exists('proc_open')) {
            $out = Terminal::rawCapture(['sh', '-lc', 'command -v ollama 2>/dev/null'], null, 5);
            $path = trim((string) ($out['stdout'] ?? ''));
            if ($path !== '') {
                return explode("\n", $path)[0];
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
    /* Runtime (Ollama) lifecycle                                         */
    /* ================================================================== */

    public static function runtimeStatus(): array
    {
        $bin = self::binary();
        $version = '';
        if ($bin !== null && function_exists('proc_open')) {
            $out = Terminal::rawCapture([$bin, '--version'], null, 8, self::serverEnv());
            if (preg_match('/([0-9]+\.[0-9]+\.[0-9]+)/', (string) $out['stdout'] . (string) $out['stderr'], $m)) {
                $version = $m[1];
            }
        }
        $up = self::serverUp();
        return [
            'engine' => 'ollama',
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

    private static function dirWritable(string $dir): bool
    {
        $probe = $dir;
        while ($probe !== '/' && $probe !== '' && !is_dir($probe)) {
            $probe = dirname($probe);
        }
        return $probe !== '' && is_writable($probe);
    }

    /** @return array{ok:bool, error?:string, version?:string} */
    public static function serverUp(): array
    {
        $r = HttpClient::request('GET', self::host() . '/api/version', [], null, 4);
        if (!$r['ok']) {
            return ['ok' => false, 'error' => $r['error'] ?? ('HTTP ' . $r['status'])];
        }
        $j = json_decode($r['body'], true);
        return ['ok' => true, 'version' => (string) ($j['version'] ?? '')];
    }

    /**
     * Install the runtime without root: download the official static tarball
     * into storage/localai/. Falls back to the upstream shell installer only
     * when the process is actually root.
     */
    public static function installRuntime(?callable $log = null): array
    {
        $log ??= static function (string $m): void {
        };
        if (!function_exists('proc_open')) {
            throw new HttpError(501, 'proc_open() is disabled — the local AI runtime cannot be installed');
        }
        $existing = self::binary();
        if ($existing !== null) {
            $log('Ollama is already installed at ' . $existing);
            return ['installed' => true, 'binary' => $existing, 'skipped' => true];
        }

        $cpu = self::readCpu();
        if (PHP_OS_FAMILY !== 'Linux') {
            throw new HttpError(400, 'Automatic runtime install is only supported on Linux. Install Ollama manually and set AGENT_OLLAMA_BIN.');
        }
        $asset = $cpu['arch'] === 'arm64' ? 'ollama-linux-arm64.tgz' : 'ollama-linux-amd64.tgz';
        $url = 'https://ollama.com/download/' . $asset;

        $root = self::rootDir();
        Files::ensureDir($root);
        Files::ensureDir(self::binDir());
        Files::ensureDir(self::modelsDir());

        $tgz = $root . '/' . $asset;
        $log('Downloading ' . $url . ' …');
        $proxy = Config::proxyConfig($url);
        $dl = HttpClient::download($proxy['effectiveUrl'], $tgz, 1800, $proxy['proxyClient']);
        if (empty($dl['ok'])) {
            @unlink($tgz);
            throw new HttpError(502, 'Download failed: ' . (string) ($dl['error'] ?? 'unknown error'));
        }
        $log('Downloaded ' . Files::humanSize((int) (@filesize($tgz) ?: 0)) . ', extracting …');

        $res = Terminal::rawCapture(['tar', '-xzf', $tgz, '-C', $root], $root, 900);
        @unlink($tgz);
        if ((int) $res['exitCode'] !== 0) {
            throw new HttpError(500, 'Extraction failed: ' . trim((string) $res['stderr']));
        }
        @chmod(self::binDir() . '/ollama', 0755);

        $bin = self::binary();
        if ($bin === null) {
            throw new HttpError(500, 'Ollama binary not found after extraction');
        }
        $log('Runtime installed at ' . $bin);
        return ['installed' => true, 'binary' => $bin, 'skipped' => false];
    }

    public static function startServer(array $envOverrides = [], ?callable $log = null): array
    {
        $log ??= static function (string $m): void {
        };
        $up = self::serverUp();
        if ($up['ok']) {
            $log('Ollama server already running at ' . self::host());
            return ['running' => true, 'started' => false, 'host' => self::host()];
        }
        $bin = self::binary();
        if ($bin === null) {
            throw new HttpError(409, 'Ollama is not installed yet');
        }
        Files::ensureDir(self::modelsDir());
        Files::ensureDir(self::rootDir() . '/logs');

        $env = self::serverEnv($envOverrides);
        $exports = '';
        foreach ($env as $k => $v) {
            $exports .= 'export ' . $k . '=' . escapeshellarg((string) $v) . '; ';
        }
        $logPath = self::rootDir() . '/logs/ollama-server.log';
        $proc = Terminal::startDetached($exports . escapeshellarg($bin) . ' serve', self::rootDir(), 'localai', $logPath);
        Database::setState('localai:server:pid', (string) ($proc['pid'] ?? 0));

        for ($i = 0; $i < 40; $i++) {
            usleep(500000);
            if (self::serverUp()['ok']) {
                $log('Ollama server is up (pid ' . ($proc['pid'] ?? 0) . ')');
                return ['running' => true, 'started' => true, 'pid' => $proc['pid'] ?? 0, 'host' => self::host(), 'logPath' => $logPath];
            }
        }
        $tail = Terminal::readLog($logPath, 4000);
        throw new HttpError(500, 'Ollama server did not become ready within 20s. Log: ' . mb_substr($tail, -600));
    }

    public static function stopServer(): array
    {
        $pid = (int) Database::state('localai:server:pid', '0');
        $killed = false;
        if ($pid > 0) {
            $killed = Terminal::killTree($pid);
            Database::setState('localai:server:pid', '0');
        }
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
                    'tasks' => (array) ($m['tasks'] ?? []),
                    'variants' => array_map(static fn(array $v): array => [
                        'tag' => (string) $v['tag'],
                        'ref' => (string) $m['id'] . ':' . (string) $v['tag'],
                        'diskGb' => (float) $v['diskGb'],
                        'quant' => (string) $v['quant'],
                    ], (array) ($m['variants'] ?? [])),
                ];
            }
        }

        $hf = [];
        if ($remote && $q !== '') {
            try {
                $url = self::HF_API . '?search=' . rawurlencode($query)
                    . '&filter=gguf&sort=downloads&direction=-1&limit=' . max(1, min(50, $limit));
                $proxy = Config::proxyConfig($url);
                $r = HttpClient::getJson($proxy['effectiveUrl'], ['Accept' => 'application/json'], 15, $proxy['proxyClient']);
                foreach ((array) ($r['json'] ?? []) as $item) {
                    if (!is_array($item)) {
                        continue;
                    }
                    $hf[] = [
                        'source' => 'huggingface',
                        'id' => (string) ($item['modelId'] ?? $item['id'] ?? ''),
                        'name' => (string) ($item['modelId'] ?? $item['id'] ?? ''),
                        'publisher' => explode('/', (string) ($item['modelId'] ?? '/'))[0],
                        'downloads' => (int) ($item['downloads'] ?? 0),
                        'likes' => (int) ($item['likes'] ?? 0),
                        'tasks' => array_values(array_filter((array) ($item['tags'] ?? []), 'is_string')),
                        'pullRef' => 'hf.co/' . (string) ($item['modelId'] ?? ''),
                        'summary' => 'مخزن GGUF در Hugging Face — با «ollama pull hf.co/<repo>» نصب می‌شود.',
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
    /* Installed models                                                   */
    /* ================================================================== */

    public static function installed(): array
    {
        $up = self::serverUp();
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

    public static function remove(string $model): array
    {
        $model = trim($model);
        if ($model === '') {
            throw new HttpError(400, 'Model name is required');
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

    /* ================================================================== */
    /* Provider registration                                              */
    /* ================================================================== */

    /** Make the freshly pulled model selectable in the chat UI. */
    public static function registerProvider(string $modelRef, array $meta = []): array
    {
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

        $variant = null;
        foreach (self::variants() as $v) {
            if ($v['ref'] === $ref) {
                $variant = $v;
                break;
            }
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
}
