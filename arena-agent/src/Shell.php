<?php

/**
 * Command execution.
 *
 * The host this targets has a real terminal with Python and Node available,
 * so commands genuinely run. Execution is off unless explicitly enabled, and
 * a deny-list catches the handful of commands that destroy a machine by
 * accident rather than by intent.
 */

declare(strict_types=1);

namespace Arena;

final class Shell
{
    private const DENY = [
        '/\brm\s+(-[a-z]*\s+)*-[a-z]*[rf]/i',
        '/\bmkfs(\.|\s)/i',
        '/\bdd\s+if=.*\bof=\/dev\//i',
        '/>\s*\/dev\/(sd|nvme|hd)/i',
        '/\bshutdown\b|\breboot\b|\bhalt\b/i',
        '/:\(\)\s*\{.*\};\s*:/',        // fork bomb
        '/\bchmod\s+-R\s+777\s+\//i',
    ];

    public static function enabled(): bool
    {
        return Bootstrap::envBool('ARENA_SHELL', false);
    }

    public static function available(): bool
    {
        return function_exists('proc_open') && !in_array('proc_open', self::disabledFunctions(), true);
    }

    /** @return array<int,string> */
    public static function disabledFunctions(): array
    {
        $raw = (string) ini_get('disable_functions');
        return array_filter(array_map('trim', explode(',', $raw)));
    }

    /** @return array<string,mixed> */
    public static function run(string $command, string $cwd = '', int $timeout = 60): array
    {
        $command = trim($command);
        if ($command === '') {
            throw new HttpError(400, 'No command given.');
        }
        if (!self::enabled()) {
            throw new HttpError(403,
                'Command execution is disabled. Set ARENA_SHELL=true in .env to turn it on.');
        }
        if (!self::available()) {
            throw new HttpError(501,
                'This PHP build cannot start processes (proc_open is disabled by the host).');
        }
        foreach (self::DENY as $pattern) {
            if (preg_match($pattern, $command)) {
                throw new HttpError(403, 'That command is blocked by the safety list.');
            }
        }

        $dir = $cwd === '' ? Workspace::root() : Workspace::resolve($cwd);
        if (!is_dir($dir)) {
            $dir = Workspace::root();
        }

        $descriptors = [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
        $started = microtime(true);
        $proc = @proc_open($command, $descriptors, $pipes, $dir, null);
        if (!is_resource($proc)) {
            throw new HttpError(500, 'The process could not be started.');
        }
        fclose($pipes[0]);
        stream_set_blocking($pipes[1], false);
        stream_set_blocking($pipes[2], false);

        $stdout = '';
        $stderr = '';
        $timedOut = false;
        $exit = null;
        $deadline = $started + $timeout;
        while (true) {
            $status = proc_get_status($proc);
            $stdout .= (string) stream_get_contents($pipes[1]);
            $stderr .= (string) stream_get_contents($pipes[2]);
            if (!$status['running']) {
                // The first poll after the process ends is the only one that
                // reports the exit code; afterwards, and from proc_close(),
                // it is gone.
                $exit = (int) $status['exitcode'];
                break;
            }
            if (microtime(true) > $deadline) {
                $timedOut = true;
                proc_terminate($proc, 9);
                break;
            }
            usleep(40000);
        }
        $stdout .= (string) stream_get_contents($pipes[1]);
        $stderr .= (string) stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        $closed = proc_close($proc);
        $exit ??= ($closed < 0 ? 1 : $closed);

        return [
            'command' => $command,
            'cwd' => trim(str_replace(Workspace::root(), '', $dir), '/'),
            'exitCode' => $timedOut ? 124 : $exit,
            'stdout' => self::clip($stdout),
            'stderr' => self::clip($stderr),
            'timedOut' => $timedOut,
            'durationMs' => (int) round((microtime(true) - $started) * 1000),
        ];
    }

    private static function clip(string $s, int $max = 200000): string
    {
        return strlen($s) > $max
            ? substr($s, 0, $max) . "\n… output truncated at " . Workspace::humanSize($max)
            : $s;
    }

    /** Report which runtimes the host actually has. @return array<string,mixed> */
    public static function runtimes(): array
    {
        $out = [];
        foreach (['php' => 'php -v', 'python' => 'python3 --version', 'node' => 'node --version',
                  'git' => 'git --version'] as $name => $cmd) {
            $out[$name] = self::probe($cmd);
        }
        return $out;
    }

    private static function probe(string $cmd): ?string
    {
        if (!self::available()) {
            return null;
        }
        $descriptors = [1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
        $proc = @proc_open($cmd, $descriptors, $pipes);
        if (!is_resource($proc)) {
            return null;
        }
        $out = (string) stream_get_contents($pipes[1]) . (string) stream_get_contents($pipes[2]);
        foreach ($pipes as $p) {
            if (is_resource($p)) {
                fclose($p);
            }
        }
        proc_close($proc);
        $line = trim(strtok($out, "\n") ?: '');
        return $line === '' ? null : $line;
    }
}
