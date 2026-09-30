<?php

/**
 * Local AI installer — Ollama runtime under storage/localai/.
 *
 * No root required. Binary is downloaded into a private directory and the
 * server is started as a detached process bound to 127.0.0.1. Models live
 * next to it so a deploy that rsyncs storage keeps them.
 *
 * Independent of ARENA_SHELL: installing a local model is not the same risk
 * as opening a free-form terminal, so it has its own process helpers.
 */

declare(strict_types=1);

namespace Arena;

final class LocalAI
{
    public const DEFAULT_HOST = 'http://127.0.0.1:11434';

    /** Curated starting catalogue — enough to pick a sensible first model. */
    private const CATALOG = [
        ['id' => 'llama3.2:3b',   'name' => 'Llama 3.2 3B',   'paramsB' => 3.2,  'sizeGb' => 2.0,  'ramGb' => 4,  'tasks' => ['chat', 'code'], 'langs' => ['en']],
        ['id' => 'llama3.2:1b',   'name' => 'Llama 3.2 1B',   'paramsB' => 1.2,  'sizeGb' => 1.3,  'ramGb' => 2,  'tasks' => ['chat'],         'langs' => ['en']],
        ['id' => 'qwen2.5:3b',    'name' => 'Qwen 2.5 3B',    'paramsB' => 3.0,  'sizeGb' => 1.9,  'ramGb' => 4,  'tasks' => ['chat', 'code'], 'langs' => ['en', 'fa', 'zh']],
        ['id' => 'qwen2.5:7b',    'name' => 'Qwen 2.5 7B',    'paramsB' => 7.6,  'sizeGb' => 4.7,  'ramGb' => 8,  'tasks' => ['chat', 'code'], 'langs' => ['en', 'fa', 'zh']],
        ['id' => 'qwen2.5-coder:7b', 'name' => 'Qwen 2.5 Coder 7B', 'paramsB' => 7.6, 'sizeGb' => 4.7, 'ramGb' => 8, 'tasks' => ['code'], 'langs' => ['en']],
        ['id' => 'mistral:7b',    'name' => 'Mistral 7B',     'paramsB' => 7.2,  'sizeGb' => 4.1,  'ramGb' => 8,  'tasks' => ['chat'],         'langs' => ['en', 'fr']],
        ['id' => 'gemma2:2b',     'name' => 'Gemma 2 2B',     'paramsB' => 2.6,  'sizeGb' => 1.6,  'ramGb' => 4,  'tasks' => ['chat'],         'langs' => ['en']],
        ['id' => 'gemma2:9b',     'name' => 'Gemma 2 9B',     'paramsB' => 9.2,  'sizeGb' => 5.4,  'ramGb' => 10, 'tasks' => ['chat'],         'langs' => ['en']],
        ['id' => 'phi3:mini',     'name' => 'Phi-3 Mini',     'paramsB' => 3.8,  'sizeGb' => 2.3,  'ramGb' => 5,  'tasks' => ['chat', 'code'], 'langs' => ['en']],
        ['id' => 'deepseek-coder:6.7b', 'name' => 'DeepSeek Coder 6.7B', 'paramsB' => 6.7, 'sizeGb' => 3.8, 'ramGb' => 8, 'tasks' => ['code'], 'langs' => ['en']],
    ];

    /* ------------------------------------------------------------------ paths */

    public static function rootDir(): string
    {
        $v = trim((string) (getenv('AGENT_LOCALAI_DIR') ?: ''));
        if ($v !== '') {
            return str_starts_with($v, '/') ? rtrim($v, '/') : Bootstrap::$root . '/' . rtrim($v, '/');
        }
        return Bootstrap::$storageDir . '/localai';
    }

    public static function binDir(): string
    {
        return self::rootDir() . '/bin';
    }

    public static function modelsDir(): string
    {
        $v = trim((string) (getenv('OLLAMA_MODELS') ?: ''));
        if ($v !== '') {
            return str_starts_with($v, '/') ? rtrim($v, '/') : Bootstrap::$root . '/' . rtrim($v, '/');
        }
        return self::rootDir() . '/models';
    }

    public static function host(): string
    {
        $v = trim((string) (getenv('OLLAMA_HOST') ?: getenv('AGENT_OLLAMA_URL') ?: ''));
        return $v !== '' ? rtrim($v, '/') : self::DEFAULT_HOST;
    }

    public static function binary(): ?string
    {
        $env = trim((string) (getenv('AGENT_OLLAMA_BIN') ?: ''));
        if ($env !== '' && is_executable($env)) {
            return $env;
        }
        $local = self::binDir() . '/ollama';
        if (is_executable($local)) {
            return $local;
        }
        // System install.
        foreach (['/usr/local/bin/ollama', '/usr/bin/ollama', '/opt/homebrew/bin/ollama'] as $p) {
            if (is_executable($p)) {
                return $p;
            }
        }
        return null;
    }

    /* ------------------------------------------------------------------ host scan */

    /** @return array<string,mixed> */
    public static function hostScan(): array
    {
        $mem = self::readMemory();
        $cpu = self::readCpu();
        $disk = self::diskInfo(self::rootDir());
        $gpu = self::readGpu();
        $bin = self::binary();
        $rt = self::runtimeStatus();

        return [
            'os' => PHP_OS_FAMILY,
            'php' => PHP_VERSION,
            'memory' => $mem,
            'cpu' => $cpu,
            'disk' => $disk,
            'gpu' => $gpu,
            'procOpen' => Shell::available(),
            'binary' => $bin,
            'runtime' => $rt,
            'paths' => [
                'root' => self::rootDir(),
                'bin' => self::binDir(),
                'models' => self::modelsDir(),
                'host' => self::host(),
            ],
            'recommendation' => self::quickRecommend($mem, $gpu),
        ];
    }

    /** @return array{totalGb:float,availableGb:float} */
    private static function readMemory(): array
    {
        if (is_readable('/proc/meminfo')) {
            $raw = (string) file_get_contents('/proc/meminfo');
            $total = 0.0;
            $avail = 0.0;
            if (preg_match('/MemTotal:\s+(\d+)/', $raw, $m)) {
                $total = ((float) $m[1]) / 1048576;
            }
            if (preg_match('/MemAvailable:\s+(\d+)/', $raw, $m)) {
                $avail = ((float) $m[1]) / 1048576;
            } elseif (preg_match('/MemFree:\s+(\d+)/', $raw, $m)) {
                $avail = ((float) $m[1]) / 1048576;
            }
            return ['totalGb' => round($total, 2), 'availableGb' => round($avail, 2)];
        }
        if (PHP_OS_FAMILY === 'Darwin') {
            $r = self::exec(['sysctl', '-n', 'hw.memsize'], null, 5);
            $total = $r['exitCode'] === 0 ? ((float) trim($r['stdout'])) / 1073741824 : 0.0;
            return ['totalGb' => round($total, 2), 'availableGb' => round($total * 0.6, 2)];
        }
        return ['totalGb' => 0.0, 'availableGb' => 0.0];
    }

    /** @return array{cores:int,arch:string} */
    private static function readCpu(): array
    {
        $arch = strtolower(php_uname('m'));
        if (str_contains($arch, 'aarch') || str_contains($arch, 'arm')) {
            $arch = 'arm64';
        } elseif (str_contains($arch, 'x86_64') || str_contains($arch, 'amd64')) {
            $arch = 'amd64';
        }
        $cores = (int) (getenv('NUMBER_OF_PROCESSORS') ?: 0);
        if ($cores < 1 && is_readable('/proc/cpuinfo')) {
            $cores = substr_count((string) file_get_contents('/proc/cpuinfo'), 'processor');
        }
        if ($cores < 1) {
            $cores = 1;
        }
        return ['cores' => $cores, 'arch' => $arch];
    }

    /** @return array<string,mixed> */
    private static function readGpu(): array
    {
        $none = ['present' => false, 'vendor' => '', 'name' => '', 'vramGb' => 0.0];
        $nv = self::exec(['nvidia-smi', '--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], null, 6);
        if ($nv['exitCode'] === 0 && trim($nv['stdout']) !== '') {
            $line = trim(explode("\n", trim($nv['stdout']))[0]);
            $parts = array_map('trim', explode(',', $line));
            $vram = isset($parts[1]) ? round(((float) $parts[1]) / 1024, 2) : 0.0;
            return ['present' => true, 'vendor' => 'nvidia', 'name' => $parts[0] ?? 'NVIDIA', 'vramGb' => $vram];
        }
        if (PHP_OS_FAMILY === 'Darwin' && str_contains(strtolower(php_uname('m')), 'arm')) {
            $mem = self::readMemory();
            return ['present' => true, 'vendor' => 'apple', 'name' => 'Apple Silicon', 'vramGb' => $mem['totalGb']];
        }
        return $none;
    }

    /** @return array{path:string,freeGb:float,totalGb:float} */
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

    /** @param array{totalGb:float,availableGb:float} $mem @param array<string,mixed> $gpu */
    private static function quickRecommend(array $mem, array $gpu): string
    {
        $budget = max($mem['availableGb'], $mem['totalGb'] * 0.5);
        if (!empty($gpu['present']) && (float) $gpu['vramGb'] >= 8) {
            $budget = max($budget, (float) $gpu['vramGb']);
        }
        foreach (array_reverse(self::CATALOG) as $m) {
            if ($m['ramGb'] <= $budget) {
                return $m['id'];
            }
        }
        return 'llama3.2:1b';
    }

    /* ------------------------------------------------------------------ runtime */

    /** @return array<string,mixed> */
    public static function runtimeStatus(): array
    {
        $bin = self::binary();
        $version = '';
        if ($bin !== null) {
            $r = self::exec([$bin, '--version'], null, 6, self::serverEnv());
            if ($r['exitCode'] === 0) {
                $version = trim($r['stdout'] . ' ' . $r['stderr']);
            }
        }
        $reachable = false;
        $apiVersion = '';
        try {
            $body = self::httpGet(self::host() . '/api/version', 4);
            $j = json_decode($body, true);
            if (is_array($j)) {
                $reachable = true;
                $apiVersion = (string) ($j['version'] ?? '');
            }
        } catch (\Throwable $e) {
            // not running
        }
        return [
            'binary' => $bin,
            'version' => $version,
            'reachable' => $reachable,
            'apiVersion' => $apiVersion,
            'host' => self::host(),
        ];
    }

    /** @return array<string,mixed> */
    public static function installRuntime(): array
    {
        if (!Shell::available()) {
            throw new HttpError(501, 'proc_open is disabled — the local AI runtime cannot be installed.');
        }
        $existing = self::binary();
        if ($existing !== null && str_starts_with($existing, self::rootDir())) {
            return ['installed' => true, 'binary' => $existing, 'skipped' => true];
        }
        if ($existing !== null) {
            return ['installed' => true, 'binary' => $existing, 'skipped' => true, 'note' => 'system binary'];
        }
        if (PHP_OS_FAMILY !== 'Linux') {
            throw new HttpError(400,
                'Automatic install is only supported on Linux. Install Ollama yourself and set AGENT_OLLAMA_BIN.');
        }

        $cpu = self::readCpu();
        if (!in_array($cpu['arch'], ['arm64', 'amd64'], true)) {
            throw new HttpError(400,
                "Automatic install is not available for CPU architecture '{$cpu['arch']}'. "
                . 'Install Ollama manually and set AGENT_OLLAMA_BIN.');
        }
        $asset = $cpu['arch'] === 'arm64' ? 'ollama-linux-arm64.tgz' : 'ollama-linux-amd64.tgz';
        $url = 'https://ollama.com/download/' . $asset;

        $root = self::rootDir();
        self::ensureDir($root);
        self::ensureDir(self::binDir());
        self::ensureDir(self::modelsDir());

        $tgz = $root . '/' . $asset;
        self::download($url, $tgz, 1800);

        $res = self::exec(['tar', '-xzf', $tgz, '-C', $root], $root, 900);
        @unlink($tgz);
        if ($res['exitCode'] !== 0) {
            throw new HttpError(500, 'Extraction failed: ' . trim($res['stderr']));
        }

        // Official tarball may unpack as bin/ollama or just ollama.
        $candidates = [
            self::binDir() . '/ollama',
            $root . '/bin/ollama',
            $root . '/ollama',
            $root . '/bin/ollama-linux-' . $cpu['arch'],
        ];
        $bin = null;
        foreach ($candidates as $c) {
            if (is_file($c)) {
                @chmod($c, 0755);
                // Normalise into binDir.
                $target = self::binDir() . '/ollama';
                if ($c !== $target) {
                    self::ensureDir(self::binDir());
                    @rename($c, $target) || @copy($c, $target);
                    @chmod($target, 0755);
                }
                $bin = $target;
                break;
            }
        }
        // Some tarballs put the binary inside a nested folder.
        if ($bin === null) {
            $it = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root));
            foreach ($it as $file) {
                if ($file->isFile() && $file->getFilename() === 'ollama') {
                    $target = self::binDir() . '/ollama';
                    self::ensureDir(self::binDir());
                    @copy($file->getPathname(), $target);
                    @chmod($target, 0755);
                    $bin = $target;
                    break;
                }
            }
        }
        if ($bin === null || !is_executable($bin)) {
            throw new HttpError(500, 'Ollama binary not found after extraction into ' . $root);
        }
        return ['installed' => true, 'binary' => $bin, 'skipped' => false];
    }

    /** @param array<string,string> $envOverrides @return array<string,mixed> */
    public static function startServer(array $envOverrides = []): array
    {
        $bin = self::binary();
        if ($bin === null) {
            throw new HttpError(400, 'Runtime is not installed. Call install first.');
        }
        $status = self::runtimeStatus();
        if ($status['reachable']) {
            return ['started' => true, 'already' => true, 'host' => self::host()];
        }

        self::ensureDir(self::modelsDir());
        $log = self::rootDir() . '/server.log';
        $env = array_merge(self::serverEnv(), $envOverrides);

        // Detach: nohup + redirect, free of the request process.
        $cmd = sprintf(
            'nohup %s serve > %s 2>&1 & echo $!',
            escapeshellarg($bin),
            escapeshellarg($log)
        );
        $descriptors = [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
        $proc = @proc_open($cmd, $descriptors, $pipes, self::rootDir(), $env);
        if (!is_resource($proc)) {
            throw new HttpError(500, 'Could not start the Ollama server.');
        }
        fclose($pipes[0]);
        $pidOut = stream_get_contents($pipes[1]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        proc_close($proc);
        $pid = (int) trim((string) $pidOut);
        @file_put_contents(self::rootDir() . '/server.pid', (string) $pid);

        // Wait briefly for the API to come up.
        $ok = false;
        for ($i = 0; $i < 20; $i++) {
            usleep(250000);
            try {
                self::httpGet(self::host() . '/api/version', 2);
                $ok = true;
                break;
            } catch (\Throwable $e) {
                // keep waiting
            }
        }
        return [
            'started' => true,
            'already' => false,
            'pid' => $pid,
            'reachable' => $ok,
            'host' => self::host(),
            'log' => $log,
        ];
    }

    /** @return array<string,mixed> */
    public static function stopServer(): array
    {
        $pidFile = self::rootDir() . '/server.pid';
        $pid = is_file($pidFile) ? (int) trim((string) file_get_contents($pidFile)) : 0;
        if ($pid > 1) {
            if (function_exists('posix_kill')) {
                @posix_kill($pid, 15);
                usleep(300000);
                @posix_kill($pid, 9);
            } else {
                // posix_kill is often disabled on shared hosting. Fall back
                // to the OS utility using an argument array, never a shell
                // command assembled from user input.
                self::exec(['kill', '-TERM', (string) $pid], null, 5);
                usleep(300000);
                self::exec(['kill', '-KILL', (string) $pid], null, 5);
            }
            @unlink($pidFile);
        }
        // Also try pkill for system-started instances we own under our root.
        $bin = self::binary();
        if ($bin !== null && str_starts_with($bin, self::rootDir())) {
            self::exec(['pkill', '-f', $bin . ' serve'], null, 5);
        }
        return ['stopped' => true];
    }

    /* ------------------------------------------------------------------ models */

    /** @return array<string,mixed> */
    public static function catalog(): array
    {
        return ['models' => self::CATALOG, 'host' => self::hostScan()];
    }

    /** @return array<string,mixed> */
    public static function installed(): array
    {
        $models = [];
        try {
            $body = self::httpGet(self::host() . '/api/tags', 10);
            $j = json_decode($body, true);
            foreach (is_array($j['models'] ?? null) ? $j['models'] : [] as $m) {
                if (!is_array($m)) {
                    continue;
                }
                $models[] = [
                    'name' => (string) ($m['name'] ?? ''),
                    'size' => (int) ($m['size'] ?? 0),
                    'digest' => (string) ($m['digest'] ?? ''),
                    'modified' => (string) ($m['modified_at'] ?? ''),
                ];
            }
        } catch (\Throwable $e) {
            // server down — still return empty list
        }
        return ['models' => $models, 'runtime' => self::runtimeStatus()];
    }

    /** @return array<string,mixed> */
    public static function pull(string $model, int $timeout = 7200): array
    {
        $model = trim($model);
        if ($model === '') {
            throw new HttpError(400, 'Model name is required.');
        }
        $status = self::runtimeStatus();
        if (!$status['reachable']) {
            // Try to start if we have a binary.
            if ($status['binary']) {
                self::startServer();
            } else {
                throw new HttpError(400, 'Local AI runtime is not running. Install and start it first.');
            }
        }

        $url = self::host() . '/api/pull';
        $payload = json_encode(['name' => $model, 'stream' => false], JSON_UNESCAPED_UNICODE);
        $body = self::httpPost($url, (string) $payload, $timeout);
        $j = json_decode($body, true);
        if (!is_array($j)) {
            throw new HttpError(502, 'Pull returned a non-JSON response.');
        }
        if (!empty($j['error'])) {
            throw new HttpError(502, 'Pull failed: ' . (string) $j['error']);
        }
        return ['ok' => true, 'model' => $model, 'status' => (string) ($j['status'] ?? 'success')];
    }

    /** @return array<string,mixed> */
    public static function remove(string $model): array
    {
        $model = trim($model);
        if ($model === '') {
            throw new HttpError(400, 'Model name is required.');
        }
        $url = self::host() . '/api/delete';
        $payload = json_encode(['name' => $model], JSON_UNESCAPED_UNICODE);
        try {
            self::httpPost($url, (string) $payload, 60);
        } catch (\Throwable $e) {
            throw new HttpError(502, 'Delete failed: ' . $e->getMessage());
        }
        return ['ok' => true, 'model' => $model];
    }

    /** Register the local runtime as an ollama provider and attach models. */
    public static function registerProvider(?string $model = null): array
    {
        $id = 'local-ollama';
        Providers::save([
            'id' => $id,
            'name' => 'Local Ollama',
            'protocol' => 'ollama',
            'baseUrl' => self::host(),
            'enabled' => true,
        ], $id);

        $models = [];
        if ($model) {
            $models[] = ['id' => $model, 'name' => $model, 'toolCalling' => true];
        } else {
            $installed = self::installed();
            foreach ($installed['models'] as $m) {
                if ($m['name'] !== '') {
                    $models[] = ['id' => $m['name'], 'name' => $m['name'], 'toolCalling' => true];
                }
            }
        }
        $n = $models ? Providers::saveModels($id, $models) : 0;
        return ['providerId' => $id, 'models' => $n, 'host' => self::host()];
    }

    /** One-shot: install runtime → start → pull → register. */
    public static function install(string $model): array
    {
        $model = trim($model);
        if ($model === '') {
            throw new HttpError(400, 'Pick a model to install.');
        }
        $steps = [];
        $rt = self::installRuntime();
        $steps['runtime'] = $rt;
        $srv = self::startServer();
        $steps['server'] = $srv;
        $pull = self::pull($model);
        $steps['pull'] = $pull;
        $reg = self::registerProvider($model);
        $steps['register'] = $reg;
        return ['ok' => true, 'model' => $model, 'steps' => $steps];
    }

    /* ------------------------------------------------------------------ helpers */

    private static function ensureDir(string $dir): void
    {
        if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new HttpError(500, 'Cannot create directory: ' . $dir);
        }
    }

    /** @return array<string,string> */
    private static function serverEnv(): array
    {
        $env = $_ENV + $_SERVER;
        $out = [];
        foreach ($env as $k => $v) {
            if (is_string($k) && is_string($v)) {
                $out[$k] = $v;
            }
        }
        $out['OLLAMA_MODELS'] = self::modelsDir();
        $out['OLLAMA_HOST'] = str_replace(['http://', 'https://'], '', self::host());
        $out['HOME'] = self::rootDir();
        return $out;
    }

    /**
     * Argument-array process runner (no shell). Same exit-code discipline as Git.
     *
     * @param array<int,string> $args
     * @param array<string,string>|null $env
     * @return array{exitCode:int,stdout:string,stderr:string}
     */
    private static function exec(array $args, ?string $cwd = null, int $timeout = 60, ?array $env = null): array
    {
        if (!Shell::available()) {
            return ['exitCode' => 127, 'stdout' => '', 'stderr' => 'proc_open unavailable'];
        }
        $descriptors = [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
        $proc = @proc_open($args, $descriptors, $pipes, $cwd, $env);
        if (!is_resource($proc)) {
            return ['exitCode' => 127, 'stdout' => '', 'stderr' => 'proc_open failed'];
        }
        fclose($pipes[0]);
        stream_set_blocking($pipes[1], false);
        stream_set_blocking($pipes[2], false);
        $stdout = '';
        $stderr = '';
        $exit = 1;
        $deadline = microtime(true) + $timeout;
        while (true) {
            $status = proc_get_status($proc);
            $stdout .= (string) stream_get_contents($pipes[1]);
            $stderr .= (string) stream_get_contents($pipes[2]);
            if (!$status['running']) {
                $exit = (int) $status['exitcode'];
                break;
            }
            if (microtime(true) > $deadline) {
                proc_terminate($proc, 9);
                $exit = 124;
                break;
            }
            usleep(20000);
        }
        $stdout .= (string) stream_get_contents($pipes[1]);
        $stderr .= (string) stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        proc_close($proc);
        return ['exitCode' => $exit, 'stdout' => $stdout, 'stderr' => $stderr];
    }

    private static function download(string $url, string $dest, int $timeout): void
    {
        self::ensureDir(dirname($dest));
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            $fp = fopen($dest, 'w');
            if ($fp === false) {
                throw new HttpError(500, 'Cannot write to ' . $dest);
            }
            curl_setopt_array($ch, [
                CURLOPT_FILE => $fp,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_TIMEOUT => $timeout,
                CURLOPT_CONNECTTIMEOUT => 30,
                CURLOPT_USERAGENT => 'ArenaAgent-LocalAI/2.3',
            ]);
            $ok = curl_exec($ch);
            $err = curl_error($ch);
            $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            fclose($fp);
            if ($ok === false || $code >= 400) {
                @unlink($dest);
                throw new HttpError(502, 'Download failed (' . $code . '): ' . $err);
            }
            return;
        }
        $ctx = stream_context_create(['http' => ['timeout' => $timeout, 'follow_location' => 1, 'user_agent' => 'ArenaAgent-LocalAI/2.3']]);
        $data = @file_get_contents($url, false, $ctx);
        if ($data === false) {
            throw new HttpError(502, 'Download failed (no curl, file_get_contents returned false).');
        }
        if (@file_put_contents($dest, $data) === false) {
            throw new HttpError(500, 'Cannot write to ' . $dest);
        }
    }

    private static function httpGet(string $url, int $timeout = 30): string
    {
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => $timeout,
                CURLOPT_CONNECTTIMEOUT => min(10, $timeout),
                CURLOPT_FOLLOWLOCATION => true,
            ]);
            $out = curl_exec($ch);
            $err = curl_error($ch);
            $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            if ($out === false) {
                throw new HttpError(502, 'GET failed: ' . $err);
            }
            if ($code >= 400) {
                throw new HttpError(502, 'GET HTTP ' . $code . ': ' . substr((string) $out, 0, 200));
            }
            return (string) $out;
        }
        $ctx = stream_context_create(['http' => ['timeout' => $timeout, 'ignore_errors' => true]]);
        $out = @file_get_contents($url, false, $ctx);
        if ($out === false) {
            throw new HttpError(502, 'GET failed (no curl).');
        }
        return $out;
    }

    private static function httpPost(string $url, string $body, int $timeout = 60): string
    {
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => $body,
                CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => $timeout,
                CURLOPT_CONNECTTIMEOUT => 15,
            ]);
            $out = curl_exec($ch);
            $err = curl_error($ch);
            $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            if ($out === false) {
                throw new HttpError(502, 'POST failed: ' . $err);
            }
            if ($code >= 400) {
                throw new HttpError(502, 'POST HTTP ' . $code . ': ' . substr((string) $out, 0, 300));
            }
            return (string) $out;
        }
        $ctx = stream_context_create(['http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/json\r\n",
            'content' => $body,
            'timeout' => $timeout,
            'ignore_errors' => true,
        ]]);
        $out = @file_get_contents($url, false, $ctx);
        if ($out === false) {
            throw new HttpError(502, 'POST failed (no curl).');
        }
        return $out;
    }
}
