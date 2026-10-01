<?php

/**
 * Git, run for real.
 *
 * Every call goes through proc_open with an *argument array*, never a shell
 * string. That is the whole security model: a branch called
 * `; rm -rf /` is one argument to git, not two commands, and no amount of
 * quoting cleverness is required. It also means this works when the general
 * terminal is switched off — running `git status` is not the same risk as
 * running arbitrary shell, so it has its own gate.
 */

declare(strict_types=1);

namespace Arena;

final class Git
{
    /** Subcommands that reach the network and therefore need a longer leash. */
    private const NETWORK = ['clone', 'fetch', 'pull', 'push', 'ls-remote'];

    private static ?bool $installed = null;

    public static function enabled(): bool
    {
        return Bootstrap::envBool('ARENA_GIT', true) && self::installed();
    }

    public static function installed(): bool
    {
        if (self::$installed !== null) {
            return self::$installed;
        }
        if (!Shell::available()) {
            return self::$installed = false;
        }
        $r = self::raw(['git', '--version'], Bootstrap::$storageDir, 10);
        return self::$installed = $r['exitCode'] === 0;
    }

    public static function version(): string
    {
        $r = self::raw(['git', '--version'], Bootstrap::$storageDir, 10);
        return $r['exitCode'] === 0 ? trim($r['stdout']) : '';
    }

    /** Is the workspace a git repository? */
    public static function isRepo(): bool
    {
        return is_dir(Workspace::root() . '/.git');
    }

    // ------------------------------------------------------------- reading

    /**
     * Branch, upstream position and the working tree, in one call.
     *
     * @return array<string,mixed>
     */
    public static function status(): array
    {
        self::assertRepo();

        // -b gives the branch header, -z avoids every quoting problem that
        // filenames with spaces or non-ASCII would otherwise cause.
        $r = self::run(['status', '--porcelain=v1', '-b', '-z', '--untracked-files=all']);
        $records = array_values(array_filter(explode("\0", $r['stdout']), static fn(string $s): bool => $s !== ''));

        $branch = '';
        $upstream = '';
        $ahead = 0;
        $behind = 0;
        $files = [];

        for ($i = 0; $i < count($records); $i++) {
            $line = $records[$i];

            if (str_starts_with($line, '## ')) {
                $head = substr($line, 3);
                // Before the first commit git says "No commits yet on main"
                // rather than naming the branch directly.
                if (str_starts_with($head, 'No commits yet on ')) {
                    $head = substr($head, 18);
                }
                if (str_contains($head, '...')) {
                    [$branch, $rest] = explode('...', $head, 2);
                    $upstream = trim(explode(' ', $rest, 2)[0]);
                    if (preg_match('/ahead (\d+)/', $rest, $m)) {
                        $ahead = (int) $m[1];
                    }
                    if (preg_match('/behind (\d+)/', $rest, $m)) {
                        $behind = (int) $m[1];
                    }
                } else {
                    $branch = trim(explode(' ', $head, 2)[0]);
                }
                continue;
            }

            $x = $line[0] ?? ' ';
            $y = $line[1] ?? ' ';
            $path = substr($line, 3);

            // A rename spends two records: the new name then the old one.
            $from = null;
            if ($x === 'R' || $y === 'R') {
                $from = $records[++$i] ?? null;
            }

            $files[] = [
                'path' => $path,
                'from' => $from,
                'index' => $x,
                'worktree' => $y,
                'staged' => $x !== ' ' && $x !== '?',
                'unstaged' => $y !== ' ',
                'untracked' => $x === '?',
                'label' => self::describe($x, $y),
            ];
        }

        usort($files, static fn(array $a, array $b): int => strcmp($a['path'], $b['path']));

        return [
            'repo' => true,
            'branch' => $branch === 'HEAD (no branch)' ? 'detached HEAD' : $branch,
            'upstream' => $upstream,
            'ahead' => $ahead,
            'behind' => $behind,
            'files' => $files,
            'staged' => count(array_filter($files, static fn(array $f): bool => $f['staged'])),
            'unstaged' => count(array_filter($files, static fn(array $f): bool => $f['unstaged'] || $f['untracked'])),
            'clean' => $files === [],
        ];
    }

    private static function describe(string $x, string $y): string
    {
        if ($x === '?') {
            return 'untracked';
        }
        $words = ['M' => 'modified', 'A' => 'added', 'D' => 'deleted',
                  'R' => 'renamed', 'C' => 'copied', 'U' => 'conflicted'];
        $code = $x !== ' ' ? $x : $y;
        return $words[$code] ?? 'changed';
    }

    /** Unified diff of the working tree, the index, or one file. */
    public static function diff(string $path = '', bool $staged = false): string
    {
        self::assertRepo();
        $args = ['diff', '--no-color'];
        if ($staged) {
            $args[] = '--cached';
        }
        if ($path !== '') {
            $args[] = '--';
            $args[] = $path;
        }
        $r = self::run($args);

        // An untracked file has nothing to diff against, so show it as an
        // addition rather than returning a confusing blank.
        if (trim($r['stdout']) === '' && $path !== '' && !$staged) {
            $full = Workspace::resolve($path);
            if (is_file($full) && self::isUntracked($path)) {
                return Diff::unified('', (string) @file_get_contents($full), $path);
            }
        }
        return $r['stdout'];
    }

    private static function isUntracked(string $path): bool
    {
        $r = self::run(['ls-files', '--error-unmatch', '--', $path]);
        return $r['exitCode'] !== 0;
    }

    /** @return array<int,array<string,mixed>> */
    public static function log(int $limit = 30, string $path = ''): array
    {
        self::assertRepo();
        // A record separator no commit message will contain.
        $sep = "\x1f";
        $end = "\x1e";
        $args = ['log', '--max-count=' . max(1, min(500, $limit)), '--no-color',
                 '--pretty=format:%H' . $sep . '%h' . $sep . '%an' . $sep . '%ae' . $sep
                 . '%aI' . $sep . '%s' . $sep . '%D' . $end];
        if ($path !== '') {
            $args[] = '--';
            $args[] = $path;
        }
        $r = self::run($args);
        if ($r['exitCode'] !== 0) {
            // A repository with no commits yet is not an error worth throwing.
            return [];
        }

        $out = [];
        foreach (explode($end, $r['stdout']) as $chunk) {
            $chunk = trim($chunk, "\n");
            if ($chunk === '') {
                continue;
            }
            $f = explode($sep, $chunk);
            if (count($f) < 6) {
                continue;
            }
            $out[] = [
                'hash' => $f[0], 'short' => $f[1], 'author' => $f[2], 'email' => $f[3],
                'date' => $f[4], 'subject' => $f[5],
                'refs' => array_values(array_filter(array_map('trim', explode(',', $f[6] ?? '')))),
            ];
        }
        return $out;
    }

    /** @return array<string,mixed> */
    public static function branches(): array
    {
        self::assertRepo();
        $r = self::run(['branch', '--all', '--format=%(refname:short)%09%(HEAD)']);
        $local = [];
        $remote = [];
        $current = '';
        foreach (explode("\n", $r['stdout']) as $line) {
            if (trim($line) === '') {
                continue;
            }
            [$name, $flag] = array_pad(explode("\t", $line, 2), 2, '');
            if (trim($flag) === '*') {
                $current = $name;
            }
            str_starts_with($name, 'remotes/') ? $remote[] = substr($name, 8) : $local[] = $name;
        }
        return ['current' => $current, 'local' => $local, 'remote' => $remote];
    }

    /** @return array<int,array{name:string,url:string}> */
    public static function remotes(): array
    {
        self::assertRepo();
        $r = self::run(['remote', '-v']);
        $seen = [];
        foreach (explode("\n", $r['stdout']) as $line) {
            if (!preg_match('/^(\S+)\s+(\S+)\s+\(fetch\)/', $line, $m)) {
                continue;
            }
            $seen[$m[1]] = ['name' => $m[1], 'url' => self::scrub($m[2])];
        }
        return array_values($seen);
    }

    // ------------------------------------------------------------- writing

    /** @return array<string,mixed> */
    public static function init(): array
    {
        if (self::isRepo()) {
            throw new HttpError(409, 'The workspace is already a git repository.');
        }
        $r = self::run(['init', '-b', 'main'], true);
        self::ensureIdentity();
        Db::audit(Auth::currentName(), 'git.init', '');
        return ['ok' => true, 'output' => trim($r['stdout'] . $r['stderr'])];
    }

    /** @param array<int,string> $paths @return array<string,mixed> */
    public static function stage(array $paths): array
    {
        self::assertRepo();
        $args = ['add', '--'];
        foreach (self::checkPaths($paths) as $p) {
            $args[] = $p;
        }
        self::run($args, true);
        return ['ok' => true, 'status' => self::status()];
    }

    /** @param array<int,string> $paths @return array<string,mixed> */
    public static function unstage(array $paths): array
    {
        self::assertRepo();
        // `restore --staged` needs a commit to restore from. Before the first
        // one there is no HEAD, and dropping the entry from the index is the
        // equivalent operation.
        $args = self::hasCommits()
            ? ['restore', '--staged', '--']
            : ['rm', '--cached', '-r', '--'];
        foreach (self::checkPaths($paths) as $p) {
            $args[] = $p;
        }
        self::run($args, true);
        return ['ok' => true, 'status' => self::status()];
    }

    /** Does the repository have at least one commit? */
    public static function hasCommits(): bool
    {
        return self::run(['rev-parse', '--verify', '--quiet', 'HEAD'])['exitCode'] === 0;
    }

    /** Throw away uncommitted changes to specific paths. @param array<int,string> $paths */
    public static function discard(array $paths): array
    {
        self::assertRepo();
        $checked = self::checkPaths($paths);
        foreach ($checked as $p) {
            $r = self::run(['checkout', '--', $p]);
            if ($r['exitCode'] !== 0) {
                // Untracked: there is no version to go back to, so remove it.
                $full = Workspace::resolve($p);
                if (is_file($full)) {
                    @unlink($full);
                }
            }
        }
        Db::audit(Auth::currentName(), 'git.discard', implode(' ', $checked));
        return ['ok' => true, 'status' => self::status()];
    }

    /** @param array<int,string> $paths @return array<string,mixed> */
    public static function commit(string $message, array $paths = [], bool $all = false): array
    {
        self::assertRepo();
        $message = trim($message);
        if ($message === '') {
            throw new HttpError(400, 'A commit needs a message.');
        }
        self::ensureIdentity();

        if ($paths !== []) {
            self::stage($paths);
        }

        $args = ['commit', '-m', $message];
        if ($all) {
            $args[] = '--all';
        }
        $r = self::run($args);

        if ($r['exitCode'] !== 0) {
            $text = trim($r['stdout'] . "\n" . $r['stderr']);
            // git has several ways of saying the index is empty, depending
            // on whether untracked files are lying around.
            foreach (['nothing to commit', 'nothing added to commit', 'no changes added'] as $phrase) {
                if (str_contains($text, $phrase)) {
                    throw new HttpError(409, str_contains($text, 'untracked')
                        ? 'Nothing is staged. There are untracked files — name them to include them.'
                        : 'There is nothing staged to commit.');
                }
            }
            throw new HttpError(400, 'The commit failed: ' . self::firstLine($text));
        }

        $log = self::log(1);
        Db::audit(Auth::currentName(), 'git.commit', $message);
        return ['ok' => true, 'commit' => $log[0] ?? null, 'output' => trim($r['stdout'])];
    }

    /** @return array<string,mixed> */
    public static function checkout(string $branch, bool $create = false): array
    {
        self::assertRepo();
        if (trim($branch) === '') {
            throw new HttpError(400, 'Which branch?');
        }
        $args = $create ? ['checkout', '-b', $branch] : ['checkout', $branch];
        $r = self::run($args);
        if ($r['exitCode'] !== 0) {
            throw new HttpError(400, self::firstLine(trim($r['stderr'] . $r['stdout'])));
        }
        Db::audit(Auth::currentName(), 'git.checkout', $branch);
        return ['ok' => true, 'status' => self::status()];
    }

    // ------------------------------------------------------------ network

    /** @return array<string,mixed> */
    public static function push(string $remote = 'origin', string $branch = '', bool $setUpstream = false): array
    {
        return self::network('push', $remote, $branch, $setUpstream);
    }

    /** @return array<string,mixed> */
    public static function pull(string $remote = 'origin', string $branch = ''): array
    {
        return self::network('pull', $remote, $branch, false);
    }

    /** @return array<string,mixed> */
    private static function network(string $verb, string $remote, string $branch, bool $setUpstream): array
    {
        self::assertRepo();
        if ($branch === '') {
            $branch = (string) self::status()['branch'];
        }
        if ($branch === '' || $branch === 'detached HEAD') {
            throw new HttpError(400, 'You are not on a branch.');
        }

        $url = self::remoteUrl($remote);
        if ($url === '') {
            throw new HttpError(400, "There is no remote called '{$remote}'. Add one first.");
        }

        // The token is injected into the URL for this one command and never
        // written to .git/config, so it cannot leak into the repository.
        $authed = self::withToken($url);
        $args = [$verb, $authed === $url ? $remote : $authed, $branch];
        if ($verb === 'push' && $setUpstream) {
            array_splice($args, 1, 0, '--set-upstream');
        }

        $r = self::run($args);
        $text = self::scrub(trim($r['stdout'] . "\n" . $r['stderr']));

        if ($r['exitCode'] !== 0) {
            throw new HttpError(400, self::explainNetworkFailure($verb, $text));
        }
        if ($verb === 'push' && $setUpstream && $authed !== $url) {
            // Record the upstream without the credential in it.
            self::run(['branch', '--set-upstream-to=' . $remote . '/' . $branch, $branch]);
        }

        Db::audit(Auth::currentName(), 'git.' . $verb, $remote . ' ' . $branch);
        return ['ok' => true, 'output' => $text, 'status' => self::status()];
    }

    private static function explainNetworkFailure(string $verb, string $text): string
    {
        $lower = strtolower($text);
        if (str_contains($lower, 'authentication failed') || str_contains($lower, 'could not read username')
            || str_contains($lower, 'permission denied') || str_contains($lower, '403')) {
            return 'The remote refused the credentials. Put a personal access token in Settings, '
                . 'or use an SSH remote with a key the server can read. (' . self::firstLine($text) . ')';
        }
        if (str_contains($lower, 'non-fast-forward') || str_contains($lower, 'rejected')) {
            return 'The remote has commits you do not. Pull first, then push again.';
        }
        if (str_contains($lower, 'could not resolve host') || str_contains($lower, 'network')) {
            return 'The server could not reach the remote. Check the host has outbound network access.';
        }
        if (str_contains($lower, 'conflict')) {
            return 'The pull produced conflicts. Resolve them in the file editor, then commit.';
        }
        return ucfirst($verb) . ' failed: ' . self::firstLine($text);
    }

    public static function setRemote(string $name, string $url): array
    {
        self::assertRepo();
        if (!preg_match('/^[\w.-]+$/', $name)) {
            throw new HttpError(400, 'A remote name may only contain letters, digits, dot, dash and underscore.');
        }
        if (!preg_match('#^(https?://|git@|ssh://|file://)#', $url)) {
            // A plain path is a legitimate remote — a bare repository on the
            // same machine, or a mounted drive — but only if it is really
            // there, so a typo is caught now rather than at the first push.
            $candidate = str_starts_with($url, '/') ? $url : Workspace::root() . '/' . $url;
            if ($url === '' || !is_dir($candidate)) {
                throw new HttpError(400,
                    'A remote must be an https://, ssh:// or git@ URL, or the path of a '
                    . 'repository that exists on this machine.');
            }
        }
        // Never persist a credential that was pasted into the URL.
        $clean = preg_replace('#^(https?://)[^@/]+@#', '$1', $url) ?? $url;
        $exists = self::remoteUrl($name) !== '';
        self::run([$exists ? 'remote' : 'remote', $exists ? 'set-url' : 'add', $name, $clean], true);
        Db::audit(Auth::currentName(), 'git.remote', $name . ' ' . self::scrub($clean));
        return ['ok' => true, 'remotes' => self::remotes()];
    }

    // -------------------------------------------------------- credentials

    /** The stored token, decrypted. Never returned to the browser. */
    private static function token(): string
    {
        $stored = (string) Db::setting('git_token', '');
        if ($stored === '') {
            return (string) (Bootstrap::env('ARENA_GIT_TOKEN', '') ?? '');
        }
        return Crypto::decrypt($stored);
    }

    public static function setToken(string $token): void
    {
        $token = trim($token);
        if ($token === '') {
            Db::setSetting('git_token', '');
        } else {
            Db::setSetting('git_token', Crypto::encrypt($token));
        }
        Db::audit(Auth::currentName(), 'git.token', $token === '' ? 'cleared' : 'set');
    }

    public static function hasToken(): bool
    {
        return self::token() !== '';
    }

    /** @return array{name:string,email:string} */
    public static function identity(): array
    {
        return [
            'name' => (string) Db::setting('git_name', 'Arena Agent'),
            'email' => (string) Db::setting('git_email', 'agent@localhost'),
        ];
    }

    public static function setIdentity(string $name, string $email): void
    {
        Db::setSetting('git_name', trim($name) !== '' ? trim($name) : 'Arena Agent');
        Db::setSetting('git_email', trim($email) !== '' ? trim($email) : 'agent@localhost');
        if (self::isRepo()) {
            self::ensureIdentity();
        }
    }

    /** Write the identity into the repository, so commits are attributable. */
    private static function ensureIdentity(): void
    {
        $who = self::identity();
        self::run(['config', 'user.name', $who['name']]);
        self::run(['config', 'user.email', $who['email']]);
    }

    /** Put the token into an https URL for one command. */
    private static function withToken(string $url): string
    {
        $token = self::token();
        if ($token === '' || !str_starts_with($url, 'https://')) {
            return $url;
        }
        if (preg_match('#^https://[^@/]+@#', $url)) {
            return $url;   // the URL already carries a credential
        }
        return 'https://' . rawurlencode($token) . '@' . substr($url, 8);
    }

    private static function remoteUrl(string $name): string
    {
        foreach (self::remotes() as $r) {
            if ($r['name'] === $name) {
                return $r['url'];
            }
        }
        return '';
    }

    /** Remove anything that looks like a credential from text shown to a human. */
    public static function scrub(string $text): string
    {
        $text = (string) preg_replace('#(https?://)[^@\s/]+@#', '$1', $text);
        $token = self::token();
        if ($token !== '' && strlen($token) > 6) {
            $text = str_replace([$token, rawurlencode($token)], '***', $text);
        }
        return $text;
    }

    // ---------------------------------------------------------- machinery

    /**
     * @param array<int,string> $args git subcommand and arguments
     * @return array{exitCode:int,stdout:string,stderr:string}
     */
    private static function run(array $args, bool $throwOnFailure = false): array
    {
        if (!self::enabled()) {
            throw new HttpError(
                self::installed() ? 403 : 501,
                self::installed()
                    ? 'Git support is switched off. Remove ARENA_GIT=false from .env.'
                    : 'Git is not installed on this host, or PHP cannot start processes.'
            );
        }
        $timeout = in_array($args[0] ?? '', self::NETWORK, true) ? 180 : 30;
        $result = self::raw(array_merge(['git'], $args), Workspace::root(), $timeout);

        if ($throwOnFailure && $result['exitCode'] !== 0) {
            throw new HttpError(400, 'git ' . ($args[0] ?? '') . ' failed: '
                . self::firstLine(self::scrub(trim($result['stderr'] . $result['stdout']))));
        }
        return $result;
    }

    /**
     * The actual process. An argument array means no shell is involved, so
     * nothing in a filename or a branch name can be interpreted as syntax.
     *
     * @param array<int,string> $command
     * @return array{exitCode:int,stdout:string,stderr:string}
     */
    private static function raw(array $command, string $cwd, int $timeout): array
    {
        if (!Shell::available()) {
            return ['exitCode' => 127, 'stdout' => '', 'stderr' => 'proc_open is unavailable.'];
        }
        if (!is_dir($cwd)) {
            $cwd = sys_get_temp_dir();
        }

        $env = [
            'PATH' => getenv('PATH') ?: '/usr/local/bin:/usr/bin:/bin',
            'HOME' => Bootstrap::$storageDir,
            'GIT_TERMINAL_PROMPT' => '0',       // fail instead of hanging on a password prompt
            'GIT_ASKPASS' => '',
            'GCM_INTERACTIVE' => 'never',
            'LC_ALL' => 'C',                    // stable, parseable output
        ];

        $pipes = [];
        $proc = @proc_open(
            $command,
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes,
            $cwd,
            $env
        );
        if (!is_resource($proc)) {
            return ['exitCode' => 127, 'stdout' => '', 'stderr' => 'Could not start git.'];
        }

        fclose($pipes[0]);
        stream_set_blocking($pipes[1], false);
        stream_set_blocking($pipes[2], false);

        $stdout = '';
        $stderr = '';
        $exit = null;
        $deadline = microtime(true) + $timeout;
        while (true) {
            $status = proc_get_status($proc);
            $stdout .= (string) stream_get_contents($pipes[1]);
            $stderr .= (string) stream_get_contents($pipes[2]);
            if (!$status['running']) {
                // This is the *only* moment the exit code is readable: the
                // first poll after the process ends reaps it, and both later
                // polls and proc_close() then report -1 (or worse, 0). Read
                // it here or lose it.
                $exit = (int) $status['exitcode'];
                break;
            }
            if (microtime(true) > $deadline) {
                proc_terminate($proc, 9);
                $stderr .= "\ngit timed out after {$timeout}s.";
                $exit = 124;
                break;
            }
            usleep(20000);
        }
        $stdout .= (string) stream_get_contents($pipes[1]);
        $stderr .= (string) stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        $closed = proc_close($proc);

        return [
            'exitCode' => $exit ?? ($closed < 0 ? 1 : $closed),
            'stdout' => $stdout,
            'stderr' => $stderr,
        ];
    }

    /**
     * Paths must be inside the workspace. Workspace::resolve does the real
     * checking and throws if they are not.
     *
     * @param array<int,string> $paths
     * @return array<int,string>
     */
    private static function checkPaths(array $paths): array
    {
        $out = [];
        foreach ($paths as $p) {
            $p = trim((string) $p, '/');
            if ($p === '' || $p === '.') {
                $out[] = '.';
                continue;
            }
            Workspace::resolve($p);
            $out[] = $p;
        }
        if ($out === []) {
            throw new HttpError(400, 'No paths given.');
        }
        return $out;
    }

    private static function assertRepo(): void
    {
        if (!self::enabled()) {
            self::run(['--version']);   // throws with the right explanation
        }
        if (!self::isRepo()) {
            throw new HttpError(
                409,
                'The workspace is not a git repository yet. Initialise one, or clone into it.'
            );
        }
    }

    private static function firstLine(string $text): string
    {
        foreach (explode("\n", $text) as $line) {
            if (trim($line) !== '') {
                return trim($line);
            }
        }
        return 'no detail';
    }

    /** Everything the Git view needs, in one request. @return array<string,mixed> */
    public static function overview(): array
    {
        $out = [
            'installed' => self::installed(),
            'enabled' => self::enabled(),
            'version' => self::installed() ? self::version() : '',
            'repo' => self::isRepo(),
            'identity' => self::identity(),
            'hasToken' => self::hasToken(),
        ];
        if (!$out['enabled'] || !$out['repo']) {
            return $out;
        }
        return $out + [
            'status' => self::status(),
            'branches' => self::branches(),
            'remotes' => self::remotes(),
            'log' => self::log(20),
        ];
    }
}
