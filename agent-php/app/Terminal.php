<?php
/**
 * Real terminal execution. Port of agent-python/app/terminal_sandbox.py.
 *
 * This is the module the Cloudflare port could not have: `proc_open()` gives
 * back a genuine shell, so `python`, `node`, `git`, `npm`, package installs,
 * long running servers and the self-healing execute/repair loop all work
 * exactly like the original FastAPI app.
 */

declare(strict_types=1);

namespace Arena;

final class Terminal
{
    public const DANGEROUS_PATTERNS = [
        'rm -rf /',
        'rm -rf /*',
        'mkfs',
        'dd if=',
        ':(){ :|:& };:',
        '> /dev/sda',
        'chmod -R 777 /',
        'chown -R',
        'shutdown',
        'reboot',
        'poweroff',
        'init 0',
        'drop table',
        'truncate table',
        'git push --force',
        'git push -f',
        'git reset --hard origin',
    ];

    public const MAX_OUTPUT = 30000;
    public const MAX_TIMEOUT = 300;

    public static function isDangerous(string $command): bool
    {
        $lower = strtolower($command);
        foreach (self::DANGEROUS_PATTERNS as $p) {
            if (str_contains($lower, $p)) {
                return true;
            }
        }
        return false;
    }

    /** Child environment with server secrets stripped (port of get_clean_env). */
    public static function cleanEnv(array $extra = []): array
    {
        $env = getenv();
        $keep = ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'SHELL', 'TERM', 'GITHUB_TOKEN', 'TMPDIR'];
        foreach (array_keys($env) as $k) {
            foreach (['KEY', 'TOKEN', 'SECRET', 'AUTH', 'PASS'] as $secret) {
                if (str_contains($k, $secret) && !in_array($k, $keep, true)) {
                    unset($env[$k]);
                    break;
                }
            }
        }
        $env['PYTHONUNBUFFERED'] = '1';
        $env['PYTHONIOENCODING'] = 'utf-8';
        $env['CI'] = '1';
        $env['TERM'] = $env['TERM'] ?? 'xterm-256color';
        $env['NO_COLOR'] = '1';
        return array_merge($env, $extra);
    }

    /**
     * Low-level capture used by capability probing (never touches the DB).
     *
     * @param array|string $cmd argv array or shell string
     * @return array{stdout:string, stderr:string, exitCode:int, timedOut:bool, pid:int}
     */
    public static function rawCapture(array|string $cmd, ?string $cwd = null, int $timeout = 60, ?array $env = null, ?string $stdin = null): array
    {
        if (!function_exists('proc_open')) {
            return ['stdout' => '', 'stderr' => 'proc_open() is disabled on this host', 'exitCode' => 126, 'timedOut' => false, 'pid' => 0];
        }
        $descriptors = [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];
        $pipes = [];
        $proc = @proc_open($cmd, $descriptors, $pipes, $cwd, $env);
        if (!is_resource($proc)) {
            return ['stdout' => '', 'stderr' => 'Failed to spawn process', 'exitCode' => 127, 'timedOut' => false, 'pid' => 0];
        }
        $status = proc_get_status($proc);
        $pid = (int) ($status['pid'] ?? 0);

        if ($stdin !== null && $stdin !== '') {
            @fwrite($pipes[0], $stdin);
        }
        fclose($pipes[0]);
        stream_set_blocking($pipes[1], false);
        stream_set_blocking($pipes[2], false);

        $stdout = '';
        $stderr = '';
        $deadline = microtime(true) + max(1, $timeout);
        $timedOut = false;

        while (true) {
            $read = array_filter([$pipes[1], $pipes[2]], static fn($p) => is_resource($p) && !feof($p));
            if ($read) {
                $write = null;
                $except = null;
                $remaining = $deadline - microtime(true);
                if ($remaining <= 0) {
                    $timedOut = true;
                    break;
                }
                $sec = (int) floor(min($remaining, 1));
                $usec = (int) ((min($remaining, 1) - $sec) * 1000000);
                if (@stream_select($read, $write, $except, $sec, $usec) > 0) {
                    foreach ($read as $stream) {
                        $chunk = fread($stream, 65536);
                        if ($chunk === false || $chunk === '') {
                            continue;
                        }
                        if ($stream === $pipes[1]) {
                            $stdout .= $chunk;
                        } else {
                            $stderr .= $chunk;
                        }
                    }
                }
            }
            $status = proc_get_status($proc);
            if (!$status['running']) {
                // Drain whatever is still buffered.
                foreach ([1, 2] as $i) {
                    if (is_resource($pipes[$i])) {
                        $rest = stream_get_contents($pipes[$i]);
                        if ($rest !== false && $rest !== '') {
                            if ($i === 1) {
                                $stdout .= $rest;
                            } else {
                                $stderr .= $rest;
                            }
                        }
                    }
                }
                break;
            }
            if (microtime(true) > $deadline) {
                $timedOut = true;
                break;
            }
        }

        $exitCode = 0;
        if ($timedOut) {
            self::killTree($pid);
            $exitCode = 124;
            proc_terminate($proc, 9);
        } else {
            $status = proc_get_status($proc);
            $exitCode = (int) ($status['exitcode'] ?? -1);
        }
        foreach ([1, 2] as $i) {
            if (is_resource($pipes[$i])) {
                fclose($pipes[$i]);
            }
        }
        $closed = proc_close($proc);
        if (!$timedOut && $exitCode < 0) {
            $exitCode = $closed;
        }

        return [
            'stdout' => $stdout,
            'stderr' => $stderr,
            'exitCode' => $exitCode,
            'timedOut' => $timedOut,
            'pid' => $pid,
        ];
    }

    /** SIGTERM then SIGKILL, to the whole process group when possible. */
    public static function killTree(int $pid, int $graceMs = 500): bool
    {
        if ($pid <= 0) {
            return false;
        }
        $killed = false;
        if (function_exists('posix_kill') && function_exists('posix_getpgid')) {
            $pgid = @posix_getpgid($pid);
            if ($pgid && $pgid > 1) {
                $killed = @posix_kill(-$pgid, 15);
                usleep($graceMs * 1000);
                @posix_kill(-$pgid, 9);
            }
        }
        if (!$killed) {
            @self::rawCapture(['sh', '-c', 'kill -TERM -' . $pid . ' 2>/dev/null; kill -TERM ' . $pid . ' 2>/dev/null'], null, 5);
            usleep($graceMs * 1000);
            @self::rawCapture(['sh', '-c', 'kill -KILL -' . $pid . ' 2>/dev/null; kill -KILL ' . $pid . ' 2>/dev/null'], null, 5);
            $killed = true;
        }
        return $killed;
    }

    public static function probeVersion(string $binary, string $flag = '--version'): ?string
    {
        $r = self::rawCapture([$binary, $flag], null, 8);
        $text = trim($r['stdout'] !== '' ? $r['stdout'] : $r['stderr']);
        return $text === '' ? null : explode("\n", $text)[0];
    }

    /**
     * Port of terminal_sandbox.execute_sandboxed_command.
     *
     * @return array{command:string, exitCode:int, stdout:string, stderr:string, durationMs:int, mode?:string, requiresApproval?:bool}
     */
    public static function execute(
        string $command,
        ?string $cwd = null,
        int $timeout = 60,
        bool $confirmedDangerous = false,
        string $userId = 'agent',
        array $extraEnv = []
    ): array {
        if (self::isDangerous($command) && !$confirmedDangerous) {
            return [
                'command' => $command,
                'exitCode' => -1,
                'stdout' => '',
                'stderr' => 'BLOCKED: This command is classified as potentially dangerous and requires explicit user confirmation.',
                'durationMs' => 0,
                'requiresApproval' => true,
            ];
        }
        if (!function_exists('proc_open')) {
            return [
                'command' => $command,
                'exitCode' => 126,
                'stdout' => '',
                'stderr' => 'proc_open() is disabled on this host; remove it from disable_functions to enable the terminal.',
                'durationMs' => 0,
                'mode' => 'unsupported',
                'unsupported' => true,
            ];
        }

        $targetDir = self::resolveCwd($cwd);
        $timeout = max(1, min($timeout, self::MAX_TIMEOUT));
        $env = self::cleanEnv($extraEnv);
        $started = microtime(true);

        $useDocker = Config::rawBool('DOCKER_SANDBOX_ENABLED', false)
            && (Bootstrap::capabilities()['docker'] !== null);

        if ($useDocker) {
            $wsRoot = Workspaces::ensureRoot(Workspaces::active());
            $dockerCmd = 'docker run --rm -i --net bridge --memory 1024m --cpus 2.0 '
                . '-v ' . escapeshellarg($wsRoot) . ':/workspace -w /workspace '
                . 'python:3.11-slim bash -c ' . escapeshellarg($command);
            $r = self::rawCapture(['sh', '-c', $dockerCmd], $targetDir, $timeout, $env);
            return self::shape($command, $r, $started, 'docker');
        }

        $shell = Bootstrap::capabilities()['bash'] ?? '/bin/sh';
        $argv = self::hasSetsid()
            ? ['setsid', $shell, '-c', $command]
            : [$shell, '-c', $command];

        $r = self::registeredRun($argv, $targetDir, $timeout, $env, $command, $userId);
        return self::shape($command, $r, $started, 'host');
    }

    private static function shape(string $command, array $r, float $started, string $mode): array
    {
        $out = [
            'command' => $command,
            'exitCode' => $r['exitCode'],
            'stdout' => Security::maskLogTokens(self::tail($r['stdout'])),
            'stderr' => Security::maskLogTokens(self::tail($r['stderr'])),
            'durationMs' => (int) round((microtime(true) - $started) * 1000),
            'mode' => $mode,
        ];
        if ($r['timedOut']) {
            $out['stderr'] = trim($out['stderr'] . "\nExecution timed out.");
            $out['timedOut'] = true;
        }
        return $out;
    }

    private static function tail(string $s): string
    {
        return strlen($s) > self::MAX_OUTPUT ? substr($s, -self::MAX_OUTPUT) : $s;
    }

    private static function hasSetsid(): bool
    {
        static $has = null;
        if ($has === null) {
            $r = self::rawCapture(['sh', '-c', 'command -v setsid >/dev/null 2>&1 && echo yes'], null, 5);
            $has = trim($r['stdout']) === 'yes';
        }
        return $has;
    }

    public static function resolveCwd(?string $cwd): string
    {
        $cwd = trim((string) $cwd);
        if ($cwd !== '' && str_starts_with($cwd, '/') && is_dir($cwd)) {
            return $cwd;
        }
        $ws = Workspaces::active();
        try {
            $abs = Workspaces::safePath($ws, $cwd === '' ? '.' : $cwd);
            return is_dir($abs) ? $abs : Workspaces::ensureRoot($ws);
        } catch (\Throwable) {
            return Workspaces::ensureRoot($ws);
        }
    }

    // --------------------------------------------------- process registry

    /** Run while registering the PID so the UI can list/kill it mid-flight. */
    private static function registeredRun(array $argv, string $cwd, int $timeout, array $env, string $command, string $userId): array
    {
        $descriptors = [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
        $pipes = [];
        $proc = @proc_open($argv, $descriptors, $pipes, $cwd, $env);
        if (!is_resource($proc)) {
            return ['stdout' => '', 'stderr' => 'Failed to spawn process', 'exitCode' => 127, 'timedOut' => false, 'pid' => 0];
        }
        $pid = (int) (proc_get_status($proc)['pid'] ?? 0);
        self::register($pid, $command, $cwd, $userId);

        fclose($pipes[0]);
        stream_set_blocking($pipes[1], false);
        stream_set_blocking($pipes[2], false);

        $stdout = '';
        $stderr = '';
        $deadline = microtime(true) + $timeout;
        $timedOut = false;
        $lastControlCheck = 0.0;

        while (true) {
            $read = array_filter([$pipes[1], $pipes[2]], static fn($p) => is_resource($p) && !feof($p));
            if ($read) {
                $w = null;
                $e = null;
                if (@stream_select($read, $w, $e, 0, 200000) > 0) {
                    foreach ($read as $stream) {
                        $chunk = fread($stream, 65536);
                        if ($chunk === false || $chunk === '') {
                            continue;
                        }
                        if ($stream === $pipes[1]) {
                            $stdout .= $chunk;
                        } else {
                            $stderr .= $chunk;
                        }
                    }
                }
            }
            $status = proc_get_status($proc);
            if (!$status['running']) {
                foreach ([1, 2] as $i) {
                    if (is_resource($pipes[$i])) {
                        $rest = stream_get_contents($pipes[$i]);
                        if (is_string($rest) && $rest !== '') {
                            if ($i === 1) {
                                $stdout .= $rest;
                            } else {
                                $stderr .= $rest;
                            }
                        }
                    }
                }
                break;
            }
            if (microtime(true) > $deadline) {
                $timedOut = true;
                break;
            }
            // Honour a kill requested from another request.
            $now = microtime(true);
            if ($now - $lastControlCheck > 1.0) {
                $lastControlCheck = $now;
                if (self::killRequested($pid)) {
                    $timedOut = false;
                    self::killTree($pid);
                    $stderr .= "\nProcess terminated by user request.";
                    break;
                }
            }
        }

        $exitCode = 0;
        if ($timedOut) {
            self::killTree($pid);
            $exitCode = 124;
            $stderr = trim($stderr . "\nExecution timed out after {$timeout} seconds.");
            @proc_terminate($proc, 9);
        } else {
            $st = proc_get_status($proc);
            $exitCode = (int) ($st['exitcode'] ?? -1);
        }
        foreach ([1, 2] as $i) {
            if (is_resource($pipes[$i])) {
                fclose($pipes[$i]);
            }
        }
        $closed = @proc_close($proc);
        if (!$timedOut && $exitCode < 0) {
            $exitCode = $closed;
        }
        self::unregister($pid);

        return ['stdout' => $stdout, 'stderr' => $stderr, 'exitCode' => $exitCode, 'timedOut' => $timedOut, 'pid' => $pid];
    }

    public static function register(int $pid, string $command, string $cwd, string $userId, string $logPath = '', bool $detached = false): void
    {
        if ($pid <= 0) {
            return;
        }
        try {
            Database::run(
                'INSERT OR REPLACE INTO terminal_processes (pid, command, cwd, user_id, started_at, log_path, detached)
                 VALUES (?,?,?,?,?,?,?)',
                [$pid, $command, $cwd, $userId, microtime(true), $logPath, $detached ? 1 : 0]
            );
        } catch (\Throwable) {
        }
    }

    public static function unregister(int $pid): void
    {
        try {
            Database::run('DELETE FROM terminal_processes WHERE pid = ?', [$pid]);
            Database::run('DELETE FROM app_state WHERE key = ?', ['kill:' . $pid]);
        } catch (\Throwable) {
        }
    }

    public static function isAlive(int $pid): bool
    {
        if ($pid <= 0) {
            return false;
        }
        if (function_exists('posix_kill')) {
            return @posix_kill($pid, 0);
        }
        return is_dir('/proc/' . $pid);
    }

    /** Port of terminal_sandbox.list_active_processes. */
    public static function listProcesses(): array
    {
        $now = microtime(true);
        $rows = Database::all('SELECT * FROM terminal_processes ORDER BY started_at DESC');
        $out = [];
        foreach ($rows as $r) {
            $pid = (int) $r['pid'];
            if (!self::isAlive($pid)) {
                self::unregister($pid);
                continue;
            }
            $out[] = [
                'pid' => $pid,
                'command' => $r['command'],
                'cwd' => $r['cwd'],
                'started_at' => (float) $r['started_at'],
                'running_seconds' => round($now - (float) $r['started_at'], 1),
                'detached' => (int) $r['detached'] === 1,
                'logPath' => $r['log_path'] ?: null,
            ];
        }
        return $out;
    }

    /** Port of terminal_sandbox.kill_process. */
    public static function kill(int $pid): bool
    {
        $row = Database::one('SELECT pid FROM terminal_processes WHERE pid = ?', [$pid]);
        if ($row === null) {
            return false;
        }
        // Flag it so the owning request stops waiting, then signal the tree.
        Database::setState('kill:' . $pid, '1');
        $ok = self::killTree($pid);
        self::unregister($pid);
        return $ok;
    }

    private static function killRequested(int $pid): bool
    {
        return Database::state('kill:' . $pid) === '1';
    }

    /**
     * Fire-and-forget process (dev servers, the job worker daemon, long builds).
     * Output is tee'd into a log file the UI can poll.
     */
    public static function startDetached(string $command, ?string $cwd = null, string $userId = 'agent', ?string $logPath = null): array
    {
        if (!function_exists('proc_open')) {
            throw new HttpError(501, 'proc_open() is disabled on this host');
        }
        $targetDir = self::resolveCwd($cwd);
        $logPath ??= Bootstrap::$storageDir . '/proc-' . Crypto::hex(4) . '.log';
        Files::ensureDir(dirname($logPath));

        $shell = Bootstrap::capabilities()['bash'] ?? '/bin/sh';
        $wrapped = '{ ' . $command . ' ; } > ' . escapeshellarg($logPath) . ' 2>&1 & echo $!';
        $argv = self::hasSetsid() ? ['setsid', $shell, '-c', $wrapped] : [$shell, '-c', $wrapped];

        $pipes = [];
        $proc = @proc_open($argv, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, $targetDir, self::cleanEnv());
        if (!is_resource($proc)) {
            throw new HttpError(500, 'Unable to start background process');
        }
        fclose($pipes[0]);
        $pidText = trim((string) stream_get_contents($pipes[1]));
        fclose($pipes[1]);
        fclose($pipes[2]);
        proc_close($proc);

        $pid = (int) $pidText;
        if ($pid > 0) {
            self::register($pid, $command, $targetDir, $userId, $logPath, true);
        }
        return ['pid' => $pid, 'command' => $command, 'cwd' => $targetDir, 'logPath' => $logPath, 'detached' => true];
    }

    /**
     * Run a single workspace file with the right interpreter. Unlike the
     * Workers port this really executes python/node/bash/php, so the agent's
     * self-healing loop has genuine tracebacks to work with.
     */
    public static function executeFile(array $ws, string $path, ?string $conversationId = null, int $timeout = 60): array
    {
        $rel = Files::normalizeRel($path);
        $abs = Workspaces::safePath($ws, $rel);
        if (!is_file($abs)) {
            return ['ok' => false, 'success' => false, 'error' => "File not found: {$path}", 'exitCode' => 1, 'path' => $path];
        }
        // Files::extname() returns the dot-prefixed suffix; the API exposes it bare.
        $ext = ltrim(Files::extname($rel), '.');

        if ($ext === 'html' || $ext === 'htm') {
            $qs = ['path' => $rel];
            if ($conversationId !== null && $conversationId !== '') {
                $qs['conversation_id'] = $conversationId;
            }
            return [
                'ok' => true,
                'success' => true,
                'type' => 'html',
                'fileType' => 'html',
                'path' => $path,
                'previewUrl' => '/api/workspace/raw?' . http_build_query($qs),
                'exitCode' => 0,
                'stdout' => 'Live HTML preview ready.',
                'stderr' => '',
                'message' => 'HTML ready for live preview.',
            ];
        }

        $caps = Bootstrap::capabilities();
        $interpreter = match (true) {
            in_array($ext, ['py', 'pyw'], true) => $caps['python'] ?? 'python3',
            $ext === 'php' => $caps['php'] ?? 'php',
            in_array($ext, ['sh', 'bash'], true) => $caps['bash'] ?? '/bin/sh',
            in_array($ext, ['js', 'mjs', 'cjs'], true) => $caps['node'] ?? 'node',
            $ext === 'ts' => $caps['node'] !== null ? 'npx --yes tsx' : null,
            default => null,
        };

        if ($interpreter === null) {
            return [
                'ok' => true,
                'success' => true,
                'type' => 'text',
                'fileType' => $ext,
                'path' => $path,
                'exitCode' => 0,
                'stdout' => substr(Files::read($abs), 0, 30000),
                'stderr' => '',
                'message' => 'File created (no interpreter needed).',
            ];
        }

        $cmd = $interpreter . ' ' . escapeshellarg($rel);
        $res = self::execute($cmd, Workspaces::ensureRoot($ws), $timeout, true, 'agent');
        $exit = (int) ($res['exitCode'] ?? 1);

        return [
            'ok' => $exit === 0,
            'success' => $exit === 0,
            'command' => $res['command'] ?? $cmd,
            'path' => $path,
            'type' => 'script',
            'fileType' => $ext,
            'exitCode' => $exit,
            'stdout' => $res['stdout'] ?? '',
            'stderr' => $res['stderr'] ?? '',
            'durationMs' => $res['durationMs'] ?? 0,
            'mode' => $res['mode'] ?? 'host',
        ] + (isset($res['unsupported']) ? ['unsupported' => true] : []);
    }

    public static function readLog(string $logPath, int $maxBytes = 65536): string
    {
        if (!is_file($logPath)) {
            return '';
        }
        $size = filesize($logPath) ?: 0;
        $fh = fopen($logPath, 'rb');
        if (!$fh) {
            return '';
        }
        if ($size > $maxBytes) {
            fseek($fh, -$maxBytes, SEEK_END);
        }
        $data = (string) stream_get_contents($fh);
        fclose($fh);
        return $data;
    }
}
