<?php
/**
 * Git integration — the REAL `git` CLI.
 * Direct port of agent-python/app/git_manager.py.
 *
 * The Cloudflare build had to emulate this through the GitHub REST API and
 * could not support stash / cherry-pick / revert / merge / conflict
 * resolution at all. Here every subcommand is the genuine article.
 */

declare(strict_types=1);

namespace Arena;

final class Git
{
    public static function available(): bool
    {
        return Bootstrap::capabilities()['git'] !== null && function_exists('proc_open');
    }

    /** @return array{ok:bool, exitCode:int, stdout:string, stderr:string, cmd:string} */
    public static function run(array $args, ?string $cwd = null, int $timeout = 60): array
    {
        $root = $cwd ?? Workspaces::ensureRoot(Workspaces::active());
        $cmd = array_merge(['git'], $args);
        if (!self::available()) {
            return [
                'ok' => false,
                'exitCode' => -1,
                'stdout' => '',
                'stderr' => 'git is not installed on this host (or proc_open is disabled).',
                'cmd' => implode(' ', $cmd),
            ];
        }
        $env = Terminal::cleanEnv([
            'GIT_TERMINAL_PROMPT' => '0',
            'GIT_ASKPASS' => 'echo',
            'GCM_INTERACTIVE' => 'never',
        ]);
        $r = Terminal::rawCapture($cmd, $root, $timeout, $env);
        return [
            'ok' => $r['exitCode'] === 0,
            'exitCode' => $r['exitCode'],
            'stdout' => $r['stdout'],
            'stderr' => Security::maskLogTokens($r['stderr']),
            'cmd' => implode(' ', $cmd),
        ];
    }

    public static function isRepo(?string $cwd = null): bool
    {
        return self::run(['rev-parse', '--is-inside-work-tree'], $cwd, 15)['ok'];
    }

    public static function init(?string $cwd = null, string $branch = 'main'): array
    {
        $r = self::run(['init', '-b', $branch], $cwd);
        if (!$r['ok']) {
            $r = self::run(['init'], $cwd);
        }
        return $r;
    }

    public static function status(?string $cwd = null): array
    {
        $r = self::run(['status', '--porcelain', '-b'], $cwd);
        if (!$r['ok']) {
            return ['isRepo' => false, 'branch' => '', 'files' => [], 'raw' => $r['stderr']];
        }
        $lines = preg_split('/\r?\n/', rtrim($r['stdout'], "\n")) ?: [];
        $branchLine = $lines[0] ?? '';
        $branchName = 'unknown';
        $ahead = 0;
        $behind = 0;

        if (str_starts_with($branchLine, '## ')) {
            $info = substr($branchLine, 3);
            if (str_contains($info, '...')) {
                $parts = explode('...', $info, 2);
                $branchName = $parts[0];
                if (str_contains($parts[1], '[')) {
                    $meta = rtrim(explode('[', $parts[1], 2)[1], ']');
                    foreach (explode(',', $meta) as $m) {
                        $m = trim($m);
                        if (str_starts_with($m, 'ahead ')) {
                            $ahead = (int) explode(' ', $m)[1];
                        } elseif (str_starts_with($m, 'behind ')) {
                            $behind = (int) explode(' ', $m)[1];
                        }
                    }
                }
            } else {
                $branchName = explode(' ', trim($info))[0];
            }
        }

        $files = [];
        foreach (array_slice($lines, 1) as $l) {
            if (strlen($l) >= 4) {
                $files[] = [
                    'path' => trim(substr($l, 3)),
                    'staged' => !in_array($l[0], [' ', '?'], true),
                    'status' => trim(substr($l, 0, 2)),
                ];
            }
        }

        return [
            'isRepo' => true,
            'branch' => $branchName,
            'ahead' => $ahead,
            'behind' => $behind,
            'files' => $files,
            'raw' => $r['stdout'],
        ];
    }

    public static function diff(bool $stagedOnly = false, ?string $filePath = null, ?string $cwd = null): array
    {
        $args = ['diff'];
        if ($stagedOnly) {
            $args[] = '--staged';
        }
        if ($filePath !== null && $filePath !== '') {
            $args[] = '--';
            $args[] = $filePath;
        }
        $res = self::run($args, $cwd);
        $statArgs = array_merge(['diff', '--stat'], $stagedOnly ? ['--staged'] : []);
        $stat = self::run($statArgs, $cwd);
        return ['diff' => $res['stdout'], 'stat' => $stat['stdout'], 'ok' => $res['ok']];
    }

    public static function branches(?string $cwd = null): array
    {
        $r = self::run(['branch', '-a'], $cwd);
        if (!$r['ok']) {
            return ['branches' => [], 'current' => ''];
        }
        $branches = [];
        $current = '';
        foreach (preg_split('/\r?\n/', $r['stdout']) ?: [] as $line) {
            $line = trim($line);
            if ($line === '') {
                continue;
            }
            $isCurrent = str_starts_with($line, '*');
            $name = trim(ltrim($line, '* '));
            if (str_contains($name, ' -> ')) {
                $name = explode(' -> ', $name)[0];
            }
            $branches[] = ['name' => $name, 'current' => $isCurrent, 'remote' => str_starts_with($name, 'remotes/')];
            if ($isCurrent) {
                $current = $name;
            }
        }
        return ['branches' => $branches, 'current' => $current];
    }

    public static function createBranch(string $name, bool $checkout = true, ?string $cwd = null): array
    {
        return self::run($checkout ? ['checkout', '-b', $name] : ['branch', $name], $cwd);
    }

    public static function switchBranch(string $name, ?string $cwd = null): array
    {
        return self::run(['checkout', str_replace('remotes/origin/', '', $name)], $cwd);
    }

    public static function renameBranch(string $old, string $new, ?string $cwd = null): array
    {
        return self::run(['branch', '-m', $old, $new], $cwd);
    }

    public static function deleteBranch(string $name, bool $force = false, ?string $cwd = null): array
    {
        return self::run(['branch', $force ? '-D' : '-d', $name], $cwd);
    }

    public static function fetch(string $remote = 'origin', ?string $cwd = null): array
    {
        return self::run(['fetch', $remote], $cwd, 180);
    }

    public static function pull(string $remote = 'origin', string $branch = '', ?string $cwd = null): array
    {
        $args = ['pull', $remote];
        if ($branch !== '') {
            $args[] = $branch;
        }
        return self::run($args, $cwd, 300);
    }

    public static function push(string $remote = 'origin', string $branch = '', bool $force = false, bool $approved = false, ?string $cwd = null): array
    {
        if (!$approved) {
            throw new HttpError(400, 'Git push operations require explicit approval.');
        }
        $args = ['push', $remote];
        if ($branch !== '') {
            $args[] = $branch;
        }
        if ($force) {
            $args[] = '--force';
        }
        return self::run($args, $cwd, 300);
    }

    public static function commit(string $message, bool $approved = false, ?string $cwd = null): array
    {
        if (!$approved) {
            throw new HttpError(400, 'Commit operations require explicit approval.');
        }
        if (trim($message) === '') {
            throw new HttpError(400, 'Commit message cannot be empty.');
        }
        self::ensureIdentity($cwd);
        self::run(['add', '-A'], $cwd);
        return self::run(['commit', '-m', $message], $cwd);
    }

    private static function ensureIdentity(?string $cwd = null): void
    {
        $name = self::run(['config', 'user.name'], $cwd, 10);
        if (trim($name['stdout']) === '') {
            self::run(['config', 'user.name', Config::raw('GIT_AUTHOR_NAME', 'Arena Agent')], $cwd, 10);
        }
        $email = self::run(['config', 'user.email'], $cwd, 10);
        if (trim($email['stdout']) === '') {
            self::run(['config', 'user.email', Config::raw('GIT_AUTHOR_EMAIL', 'agent@arena.local')], $cwd, 10);
        }
    }

    public static function history(int $limit = 50, ?string $cwd = null): array
    {
        $fmt = '%H|%h|%an|%ae|%at|%s';
        $r = self::run(['log', '-n' . $limit, '--pretty=format:' . $fmt], $cwd);
        if (!$r['ok']) {
            return [];
        }
        $commits = [];
        foreach (preg_split('/\r?\n/', $r['stdout']) ?: [] as $line) {
            $parts = explode('|', $line);
            if (count($parts) >= 6) {
                $ts = (int) $parts[4];
                $commits[] = [
                    'hash' => $parts[0],
                    'shortHash' => $parts[1],
                    'author' => $parts[2],
                    'email' => $parts[3],
                    'timestamp' => $ts,
                    'date' => gmdate('Y-m-d H:i:s', $ts),
                    'message' => implode('|', array_slice($parts, 5)),
                ];
            }
        }
        return $commits;
    }

    public static function commitDetails(string $hash, ?string $cwd = null): array
    {
        $show = self::run(['show', '--stat', '--patch', $hash], $cwd);
        $files = self::run(['diff-tree', '--no-commit-id', '--name-only', '-r', $hash], $cwd);
        return [
            'hash' => $hash,
            'details' => $show['stdout'],
            'files' => array_values(array_filter(preg_split('/\r?\n/', $files['stdout']) ?: [], 'strlen')),
        ];
    }

    public static function cherryPick(string $hash, ?string $cwd = null): array
    {
        return self::run(['cherry-pick', $hash], $cwd);
    }

    public static function revert(string $hash, ?string $cwd = null): array
    {
        return self::run(['revert', '--no-edit', $hash], $cwd);
    }

    public static function merge(string $branch, ?string $cwd = null): array
    {
        return self::run(['merge', $branch], $cwd);
    }

    public static function stashes(?string $cwd = null): array
    {
        $r = self::run(['stash', 'list'], $cwd);
        if (!$r['ok']) {
            return [];
        }
        $out = [];
        foreach (preg_split('/\r?\n/', $r['stdout']) ?: [] as $line) {
            if (str_contains($line, ':')) {
                $parts = explode(':', $line, 3);
                $out[] = [
                    'id' => trim($parts[0]),
                    'branch' => trim($parts[1] ?? ''),
                    'message' => trim($parts[2] ?? ''),
                ];
            }
        }
        return $out;
    }

    public static function stashSave(string $message = '', ?string $cwd = null): array
    {
        $args = ['stash', 'push'];
        if ($message !== '') {
            $args[] = '-m';
            $args[] = $message;
        }
        return self::run($args, $cwd);
    }

    public static function stashApply(string $stashId = 'stash@{0}', ?string $cwd = null): array
    {
        return self::run(['stash', 'apply', $stashId], $cwd);
    }

    public static function stashDrop(string $stashId = 'stash@{0}', ?string $cwd = null): array
    {
        return self::run(['stash', 'drop', $stashId], $cwd);
    }

    public static function remotes(?string $cwd = null): array
    {
        $r = self::run(['remote', '-v'], $cwd);
        if (!$r['ok']) {
            return [];
        }
        $remotes = [];
        foreach (preg_split('/\r?\n/', $r['stdout']) ?: [] as $line) {
            $parts = preg_split('/\s+/', trim($line)) ?: [];
            if (count($parts) >= 2) {
                $remotes[$parts[0]] = $parts[1];
            }
        }
        $out = [];
        foreach ($remotes as $name => $url) {
            $out[] = ['name' => $name, 'url' => Security::maskLogTokens($url)];
        }
        return $out;
    }

    public static function addRemote(string $name, string $url, ?string $cwd = null): array
    {
        $existing = self::run(['remote', 'get-url', $name], $cwd, 10);
        if ($existing['ok']) {
            return self::run(['remote', 'set-url', $name, $url], $cwd);
        }
        return self::run(['remote', 'add', $name, $url], $cwd);
    }

    public static function conflicts(?string $cwd = null): array
    {
        $ws = Workspaces::active();
        $status = self::status($cwd);
        $out = [];
        foreach ($status['files'] ?? [] as $f) {
            if (str_contains((string) $f['status'], 'U')) {
                $abs = Workspaces::safePath($ws, (string) $f['path']);
                if (is_file($abs)) {
                    $content = Files::read($abs);
                    $out[] = [
                        'path' => $f['path'],
                        'hasMarkers' => str_contains($content, '<<<<<<<'),
                        'content' => $content,
                    ];
                }
            }
        }
        return $out;
    }

    public static function resolveConflict(string $relPath, string $mode, ?string $customContent = null, ?string $cwd = null): array
    {
        $ws = Workspaces::active();
        $abs = Workspaces::safePath($ws, $relPath);
        if ($mode === 'ours' || $mode === 'theirs') {
            self::run(['checkout', '--' . $mode, $relPath], $cwd);
            self::run(['add', $relPath], $cwd);
        } elseif ($mode === 'custom' && $customContent !== null) {
            Files::write($abs, $customContent);
            self::run(['add', $relPath], $cwd);
        } else {
            throw new HttpError(400, 'Invalid resolution mode');
        }
        return ['ok' => true, 'path' => $relPath, 'mode' => $mode];
    }

    public static function clone(string $url, string $destination, string $branch = '', ?string $token = null): array
    {
        $authUrl = $url;
        if ($token !== null && $token !== '' && str_starts_with($url, 'https://')) {
            $authUrl = preg_replace('#^https://#', 'https://' . $token . '@', $url) ?? $url;
        }
        $args = ['clone'];
        if ($branch !== '') {
            $args[] = '--branch';
            $args[] = $branch;
        }
        $args[] = $authUrl;
        $args[] = $destination;
        $r = self::run($args, dirname($destination), 600);
        $r['cmd'] = Security::maskLogTokens($r['cmd']);
        return $r;
    }
}
