<?php

/**
 * The tools the agent can call.
 *
 * Each tool is declared once here, in a neutral shape, and Llm translates
 * that declaration into whatever the provider's wire format wants. Execution
 * goes through the same Workspace and Shell guards the web interface uses, so
 * a tool cannot reach anywhere a person could not.
 */

declare(strict_types=1);

namespace Arena;

final class Tools
{
    /** Longest tool result handed back to the model, in bytes. */
    private const MAX_RESULT = 24000;

    /**
     * Neutral tool declarations. `parameters` is JSON Schema, which every
     * supported protocol accepts in some wrapper or other.
     *
     * @return array<int,array{name:string,description:string,parameters:array<string,mixed>,writes:bool,needsShell:bool}>
     */
    public static function declarations(): array
    {
        return [
            [
                'name' => 'list_files',
                'description' => 'List files and folders in the workspace. Start here when you '
                    . 'do not know the layout. Returns names, sizes and types.',
                'parameters' => self::schema([
                    'path' => ['string', 'Folder relative to the workspace root. Empty means the root.'],
                ], []),
                'writes' => false,
                'needsShell' => false,
                'needsGit' => false,
            ],
            [
                'name' => 'read_file',
                'description' => 'Read a text file from the workspace. Always read a file before '
                    . 'editing it, so the replacement is based on what is actually there.',
                'parameters' => self::schema([
                    'path' => ['string', 'File path relative to the workspace root.'],
                ], ['path']),
                'writes' => false,
                'needsGit' => false,
                'needsShell' => false,
            ],
            [
                'name' => 'search_files',
                'description' => 'Find which files contain a piece of text. Much cheaper than '
                    . 'reading everything. Returns matching lines with their file and line number.',
                'parameters' => self::schema([
                    'query' => ['string', 'Literal text to look for. Case-insensitive.'],
                    'path' => ['string', 'Folder to search under. Empty means the whole workspace.'],
                ], ['query']),
                'writes' => false,
                'needsGit' => false,
                'needsShell' => false,
            ],
            [
                'name' => 'write_file',
                'description' => 'Create a file or replace its entire contents. Provide the whole '
                    . 'final file, not a fragment. Missing folders are created.',
                'parameters' => self::schema([
                    'path' => ['string', 'File path relative to the workspace root.'],
                    'content' => ['string', 'The complete new contents of the file.'],
                ], ['path', 'content']),
                'writes' => true,
                'needsGit' => false,
                'needsShell' => false,
            ],
            [
                'name' => 'edit_file',
                'description' => 'Replace one exact piece of text in an existing file. Prefer this '
                    . 'over write_file for a small change. The search text must appear exactly '
                    . 'once; if it does not, nothing is changed and you are told why.',
                'parameters' => self::schema([
                    'path' => ['string', 'File path relative to the workspace root.'],
                    'find' => ['string', 'Exact text to replace, including indentation.'],
                    'replace' => ['string', 'Text to put in its place.'],
                ], ['path', 'find', 'replace']),
                'writes' => true,
                'needsGit' => false,
                'needsShell' => false,
            ],
            [
                'name' => 'delete_file',
                'description' => 'Delete a file from the workspace.',
                'parameters' => self::schema([
                    'path' => ['string', 'File path relative to the workspace root.'],
                ], ['path']),
                'writes' => true,
                'needsGit' => false,
                'needsShell' => false,
            ],
            [
                'name' => 'git_status',
                'description' => 'Show the current branch and which files have changed. Use this '
                    . 'before committing so you know what you are about to include.',
                'parameters' => self::schema([], []),
                'writes' => false,
                'needsShell' => false,
                'needsGit' => true,
            ],
            [
                'name' => 'git_diff',
                'description' => 'Show what actually changed, as a unified diff. Read this before '
                    . 'writing a commit message so the message describes the real change.',
                'parameters' => self::schema([
                    'path' => ['string', 'Limit the diff to one file. Empty means everything.'],
                    'staged' => ['boolean', 'Show what is staged rather than the working tree.'],
                ], []),
                'writes' => false,
                'needsShell' => false,
                'needsGit' => true,
            ],
            [
                'name' => 'git_log',
                'description' => 'List recent commits, newest first, to see how the project has '
                    . 'been changing and how its commit messages are usually written.',
                'parameters' => self::schema([
                    'limit' => ['integer', 'How many commits. Default 10.'],
                    'path' => ['string', 'Only commits touching this file.'],
                ], []),
                'writes' => false,
                'needsShell' => false,
                'needsGit' => true,
            ],
            [
                'name' => 'git_commit',
                'description' => 'Stage the given files and commit them. Write a message that says '
                    . 'why the change was made, not just what changed. Only commit work you have '
                    . 'verified; never commit to hide a failure.',
                'parameters' => self::schema([
                    'message' => ['string', 'The commit message. A short subject line, then a blank '
                        . 'line, then the reasoning if it needs one.'],
                    'paths' => ['array', 'Files to include. Omit to commit everything already staged.'],
                ], ['message']),
                'writes' => true,
                'needsShell' => false,
                'needsGit' => true,
            ],
            [
                'name' => 'run_command',
                'description' => 'Run a shell command in the workspace and return its output and '
                    . 'exit code. Use it to run tests, install packages, or inspect the system. '
                    . 'Python and Node are available.',
                'parameters' => self::schema([
                    'command' => ['string', 'The command line to run.'],
                    'cwd' => ['string', 'Folder to run it in, relative to the workspace root.'],
                    'timeout' => ['integer', 'Seconds to allow before giving up. Default 60.'],
                ], ['command']),
                'writes' => false,
                'needsGit' => false,
                'needsShell' => true,
            ],
        ];
    }

    /** Declarations filtered to what this host can offer. @return array<int,array<string,mixed>> */
    public static function available(): array
    {
        $shell = Shell::enabled() && Shell::available();
        $git = Git::enabled() && Git::isRepo();
        return array_values(array_filter(
            self::declarations(),
            static fn(array $d): bool => (!$d['needsShell'] || $shell) && (!$d['needsGit'] || $git)
        ));
    }

    /** Names of the tools this host can actually offer right now. @return array<int,string> */
    public static function availableNames(): array
    {
        return array_column(self::available(), 'name');
    }

    /**
     * Run one tool call.
     *
     * Failures are returned, not thrown: a model that asked for a file that
     * does not exist should be told so and given the chance to try again,
     * which is exactly what a person would do.
     *
     * @param array<string,mixed> $args
     * @return array{ok:bool,summary:string,result:string,change:?array<string,mixed>}
     */
    public static function run(string $name, array $args, string $conversationId = ''): array
    {
        try {
            return match ($name) {
                'list_files' => self::listFiles($args),
                'read_file' => self::readFile($args),
                'search_files' => self::searchFiles($args),
                'write_file' => self::writeFile($args, $conversationId),
                'edit_file' => self::editFile($args, $conversationId),
                'delete_file' => self::deleteFile($args, $conversationId),
                'run_command' => self::runCommand($args),
                'git_status' => self::gitStatus(),
                'git_diff' => self::gitDiff($args),
                'git_log' => self::gitLog($args),
                'git_commit' => self::gitCommit($args),
                default => self::fail("There is no tool called '{$name}'. Available tools: "
                    . implode(', ', self::availableNames())),
            };
        } catch (HttpError $e) {
            return self::fail($e->getMessage());
        } catch (\Throwable $e) {
            return self::fail('The tool failed: ' . $e->getMessage());
        }
    }

    // ---------------------------------------------------------------- tools

    /** @param array<string,mixed> $args @return array<string,mixed> */
    private static function listFiles(array $args): array
    {
        $path = trim((string) ($args['path'] ?? ''), '/');
        $listing = Workspace::list($path);
        $items = $listing['items'] ?? [];
        if ($items === []) {
            return self::ok('empty folder', ($path === '' ? 'The workspace' : $path) . ' is empty.');
        }
        $lines = [];
        foreach ($items as $e) {
            $lines[] = $e['isDir']
                ? '  ' . $e['name'] . '/'
                : sprintf('  %-40s %s', $e['name'], Workspace::humanSize((int) $e['size']));
        }
        return self::ok(
            count($items) . ' item' . (count($items) === 1 ? '' : 's'),
            ($path === '' ? '/' : $path) . "\n" . implode("\n", $lines)
        );
    }

    /** @param array<string,mixed> $args @return array<string,mixed> */
    private static function readFile(array $args): array
    {
        $path = trim((string) ($args['path'] ?? ''), '/');
        if ($path === '') {
            return self::fail('read_file needs a path.');
        }
        $file = Workspace::read($path);
        if ($file['binary']) {
            return self::fail("$path is a binary file, so there is no text to read.");
        }
        $content = (string) $file['content'];
        $lines = $content === '' ? 0 : substr_count($content, "\n") + 1;
        return self::ok("$lines lines", $content === '' ? '(the file is empty)' : $content);
    }

    /** @param array<string,mixed> $args @return array<string,mixed> */
    private static function searchFiles(array $args): array
    {
        $query = (string) ($args['query'] ?? '');
        if ($query === '') {
            return self::fail('search_files needs something to look for.');
        }
        $root = Workspace::resolve(trim((string) ($args['path'] ?? ''), '/'));
        if (!is_dir($root)) {
            return self::fail('That folder does not exist.');
        }

        $hits = [];
        $filesSeen = 0;
        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::LEAVES_ONLY
        );
        foreach ($iterator as $file) {
            if (count($hits) >= 100 || $filesSeen > 4000) {
                break;
            }
            /** @var \SplFileInfo $file */
            if (!$file->isFile() || $file->getSize() > 1_000_000) {
                continue;
            }
            $rel = ltrim(str_replace(Workspace::root(), '', $file->getPathname()), '/');
            if (preg_match('#(^|/)(\.git|node_modules|vendor|__pycache__)(/|$)#', $rel)) {
                continue;
            }
            $filesSeen++;
            $body = (string) @file_get_contents($file->getPathname());
            if ($body === '' || stripos($body, $query) === false) {
                continue;
            }
            foreach (explode("\n", $body) as $n => $line) {
                if (stripos($line, $query) !== false) {
                    $hits[] = sprintf('%s:%d: %s', $rel, $n + 1, trim($line));
                    if (count($hits) >= 100) {
                        break;
                    }
                }
            }
        }

        if ($hits === []) {
            return self::ok('no matches', "Nothing in the workspace contains \"$query\".");
        }
        return self::ok(count($hits) . ' match' . (count($hits) === 1 ? '' : 'es'), implode("\n", $hits));
    }

    /** @param array<string,mixed> $args @return array<string,mixed> */
    private static function writeFile(array $args, string $conversationId): array
    {
        $path = trim((string) ($args['path'] ?? ''), '/');
        if ($path === '') {
            return self::fail('write_file needs a path.');
        }
        if (!array_key_exists('content', $args)) {
            return self::fail('write_file needs the complete contents of the file.');
        }
        $change = Changes::propose('write', $path, (string) $args['content'], $conversationId);
        return self::fromChange($change, $path);
    }

    /** @param array<string,mixed> $args @return array<string,mixed> */
    private static function editFile(array $args, string $conversationId): array
    {
        $path = trim((string) ($args['path'] ?? ''), '/');
        $find = (string) ($args['find'] ?? '');
        $replace = (string) ($args['replace'] ?? '');
        if ($path === '' || $find === '') {
            return self::fail('edit_file needs a path and the exact text to replace.');
        }

        $file = Workspace::read($path);
        if ($file['binary']) {
            return self::fail("$path is binary and cannot be edited as text.");
        }
        $before = (string) $file['content'];

        $count = substr_count($before, $find);
        if ($count === 0) {
            return self::fail(
                "That text does not appear in $path, so nothing was changed. "
                . 'Read the file again and copy the exact text, including indentation.'
            );
        }
        if ($count > 1) {
            return self::fail(
                "That text appears $count times in $path, so it is ambiguous and nothing was "
                . 'changed. Include more surrounding lines to make it unique.'
            );
        }

        $after = str_replace($find, $replace, $before);
        $change = Changes::propose('write', $path, $after, $conversationId);
        return self::fromChange($change, $path);
    }

    /** @param array<string,mixed> $args @return array<string,mixed> */
    private static function deleteFile(array $args, string $conversationId): array
    {
        $path = trim((string) ($args['path'] ?? ''), '/');
        if ($path === '') {
            return self::fail('delete_file needs a path.');
        }
        $change = Changes::propose('delete', $path, '', $conversationId);
        return self::fromChange($change, $path);
    }

    /** @param array<string,mixed> $args @return array<string,mixed> */
    private static function runCommand(array $args): array
    {
        $command = trim((string) ($args['command'] ?? ''));
        if ($command === '') {
            return self::fail('run_command needs a command.');
        }
        $result = Shell::run(
            $command,
            trim((string) ($args['cwd'] ?? ''), '/'),
            max(1, min(300, (int) ($args['timeout'] ?? 60)))
        );

        $text = '$ ' . $result['command'] . "\n";
        if ($result['stdout'] !== '') {
            $text .= $result['stdout'];
        }
        if ($result['stderr'] !== '') {
            $text .= (str_ends_with($text, "\n") ? '' : "\n") . "[stderr]\n" . $result['stderr'];
        }
        $text .= sprintf("\n[exit %d in %d ms]", $result['exitCode'], $result['durationMs']);
        if ($result['timedOut']) {
            $text .= "\n[the command was still running and was stopped]";
        }

        return [
            'ok' => $result['exitCode'] === 0,
            'summary' => 'exit ' . $result['exitCode'],
            'result' => self::clip($text),
            'change' => null,
        ];
    }

    // ------------------------------------------------------------------ git

    /** @return array<string,mixed> */
    private static function gitStatus(): array
    {
        $st = Git::status();
        if ($st['clean']) {
            return self::ok('clean', "On branch {$st['branch']}. Nothing has changed.");
        }
        $lines = ["On branch {$st['branch']}."];
        if ($st['ahead'] || $st['behind']) {
            $lines[] = "Ahead {$st['ahead']}, behind {$st['behind']} of {$st['upstream']}.";
        }
        foreach ($st['files'] as $f) {
            $lines[] = sprintf('  %-12s %s%s', $f['label'], $f['path'],
                $f['staged'] ? ' (staged)' : '');
        }
        return self::ok(
            $st['staged'] . ' staged, ' . $st['unstaged'] . ' unstaged',
            implode("\n", $lines)
        );
    }

    /** @param array<string,mixed> $args @return array<string,mixed> */
    private static function gitDiff(array $args): array
    {
        $diff = Git::diff(trim((string) ($args['path'] ?? ''), '/'), (bool) ($args['staged'] ?? false));
        if (trim($diff) === '') {
            return self::ok('no differences', 'There are no differences to show.');
        }
        return self::ok(substr_count($diff, "\n") . ' lines of diff', $diff);
    }

    /** @param array<string,mixed> $args @return array<string,mixed> */
    private static function gitLog(array $args): array
    {
        $commits = Git::log(max(1, min(100, (int) ($args['limit'] ?? 10))),
            trim((string) ($args['path'] ?? ''), '/'));
        if ($commits === []) {
            return self::ok('no commits', 'This repository has no commits yet.');
        }
        $lines = [];
        foreach ($commits as $c) {
            $lines[] = sprintf('%s  %s  %s  %s', $c['short'], substr($c['date'], 0, 10),
                $c['author'], $c['subject']);
        }
        return self::ok(count($commits) . ' commits', implode("\n", $lines));
    }

    /** @param array<string,mixed> $args @return array<string,mixed> */
    private static function gitCommit(array $args): array
    {
        $message = trim((string) ($args['message'] ?? ''));
        if ($message === '') {
            return self::fail('git_commit needs a message.');
        }
        $paths = $args['paths'] ?? [];
        if (is_string($paths)) {
            $paths = [$paths];
        }
        $result = Git::commit($message, is_array($paths) ? $paths : []);
        $commit = $result['commit'] ?? null;
        return self::ok(
            $commit ? (string) $commit['short'] : 'committed',
            'Committed ' . ($commit ? $commit['short'] . ' ' . $commit['subject'] : $message)
        );
    }

    // --------------------------------------------------------------- shared

    /**
     * @param array<string,mixed> $change
     * @return array<string,mixed>
     */
    private static function fromChange(array $change, string $path): array
    {
        if (($change['status'] ?? '') === 'unchanged') {
            return self::ok('no change', (string) $change['note']);
        }
        $stat = sprintf('+%d −%d', (int) $change['added'], (int) $change['removed']);
        $applied = $change['status'] === Changes::APPLIED;
        $text = $applied
            ? "Done: $path ($stat)."
            : "Proposed: $path ($stat). It is waiting for the user to approve it, so the file on "
              . 'disk has not changed yet. Carry on as though it will be accepted.';

        return [
            'ok' => true,
            'summary' => $applied ? "written $stat" : "proposed $stat",
            'result' => $text,
            'change' => $change,
        ];
    }

    /** @return array<string,mixed> */
    private static function ok(string $summary, string $result): array
    {
        return ['ok' => true, 'summary' => $summary, 'result' => self::clip($result), 'change' => null];
    }

    /** @return array<string,mixed> */
    private static function fail(string $why): array
    {
        return ['ok' => false, 'summary' => 'failed', 'result' => 'Error: ' . $why, 'change' => null];
    }

    private static function clip(string $s): string
    {
        if (strlen($s) <= self::MAX_RESULT) {
            return $s;
        }
        // Keep both ends: the start says what it is, the end usually says how
        // it went. The middle is what you can afford to lose.
        $head = substr($s, 0, (int) (self::MAX_RESULT * 0.7));
        $tail = substr($s, -(int) (self::MAX_RESULT * 0.25));
        return $head . "\n\n… " . Workspace::humanSize(strlen($s) - strlen($head) - strlen($tail))
            . " of output omitted …\n\n" . $tail;
    }

    /**
     * @param array<string,array{0:string,1:string}> $props
     * @param array<int,string> $required
     * @return array<string,mixed>
     */
    private static function schema(array $props, array $required): array
    {
        $properties = [];
        foreach ($props as $name => [$type, $description]) {
            $properties[$name] = ['type' => $type, 'description' => $description];
        }
        return [
            'type' => 'object',
            'properties' => $properties,
            'required' => $required,
        ];
    }
}
