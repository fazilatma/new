<?php
/**
 * The OpenAI tool-calling surface exposed to the model, plus its execution
 * engine. Port of agent-python/app/agent_tools.py.
 *
 * `run_command` is a REAL shell here, so the tool descriptions no longer warn
 * the model away from python/node/pytest — it can actually run them.
 */

declare(strict_types=1);

namespace Arena;

final class ToolContext
{
    public function __construct(
        public array $workspace,
        public ?string $conversationId = null,
        public string $userId = 'agent'
    ) {
    }
}

final class AgentTools
{
    public static function definitions(): array
    {
        $caps = Bootstrap::capabilities();
        $runtimes = array_values(array_filter([
            $caps['python'] ? 'python3' : null,
            $caps['node'] ? 'node' : null,
            'php',
            $caps['bash'] ? 'bash' : null,
            $caps['git'] ? 'git' : null,
            $caps['npm'] ? 'npm' : null,
        ]));

        return [
            [
                'type' => 'function',
                'function' => [
                    'name' => 'list_files',
                    'description' => 'List files and directories in the active project workspace.',
                    'parameters' => [
                        'type' => 'object',
                        'properties' => [
                            'path' => ['type' => 'string', 'description' => "Subdirectory to list (defaults to workspace root '.')."],
                        ],
                        'required' => [],
                    ],
                ],
            ],
            [
                'type' => 'function',
                'function' => [
                    'name' => 'read_file',
                    'description' => 'Read text content of a workspace file.',
                    'parameters' => [
                        'type' => 'object',
                        'properties' => [
                            'path' => ['type' => 'string', 'description' => 'Relative file path inside the workspace.'],
                        ],
                        'required' => ['path'],
                    ],
                ],
            ],
            [
                'type' => 'function',
                'function' => [
                    'name' => 'write_file',
                    'description' => 'Write or update a file in the workspace. Staged for diff approval if approval is enabled.',
                    'parameters' => [
                        'type' => 'object',
                        'properties' => [
                            'path' => ['type' => 'string', 'description' => 'Relative file path inside the workspace.'],
                            'content' => ['type' => 'string', 'description' => 'Complete file content to write.'],
                        ],
                        'required' => ['path', 'content'],
                    ],
                ],
            ],
            [
                'type' => 'function',
                'function' => [
                    'name' => 'run_command',
                    'description' => 'Run a real shell command inside the workspace. Available runtimes on this host: '
                        . (implode(', ', $runtimes) ?: 'shell built-ins only')
                        . '. Use it to install dependencies, run tests, start builds and verify your own code.',
                    'parameters' => [
                        'type' => 'object',
                        'properties' => [
                            'command' => ['type' => 'string', 'description' => 'Command to run.'],
                            'cwd' => ['type' => 'string', 'description' => "Working directory relative to workspace root (defaults to '.')."],
                            'timeout' => ['type' => 'integer', 'description' => 'Timeout in seconds (max 300).'],
                        ],
                        'required' => ['command'],
                    ],
                ],
            ],
            [
                'type' => 'function',
                'function' => [
                    'name' => 'browser_navigate',
                    'description' => 'Load a web page and retrieve its title, text content and links (Playwright when installed, otherwise HTTP + DOM extraction).',
                    'parameters' => [
                        'type' => 'object',
                        'properties' => ['url' => ['type' => 'string', 'description' => 'HTTP or HTTPS URL to load.']],
                        'required' => ['url'],
                    ],
                ],
            ],
            [
                'type' => 'function',
                'function' => [
                    'name' => 'http_request',
                    'description' => 'Perform a raw HTTP(S) GET against any URL and return the response body.',
                    'parameters' => [
                        'type' => 'object',
                        'properties' => ['url' => ['type' => 'string', 'description' => 'HTTP or HTTPS URL to request.']],
                        'required' => ['url'],
                    ],
                ],
            ],
            [
                'type' => 'function',
                'function' => [
                    'name' => 'git_status',
                    'description' => 'Get the git status of the active workspace (real `git status`).',
                    'parameters' => ['type' => 'object', 'properties' => new \stdClass(), 'required' => []],
                ],
            ],
            [
                'type' => 'function',
                'function' => [
                    'name' => 'git_diff',
                    'description' => 'Get the git diff of the active workspace (real `git diff`).',
                    'parameters' => [
                        'type' => 'object',
                        'properties' => [
                            'staged_only' => ['type' => 'boolean', 'description' => 'Only show staged changes.'],
                        ],
                        'required' => [],
                    ],
                ],
            ],
            [
                'type' => 'function',
                'function' => [
                    'name' => 'list_referenced_files',
                    'description' => 'List files from another referenced chat session or project workspace.',
                    'parameters' => [
                        'type' => 'object',
                        'properties' => [
                            'target_type' => ['type' => 'string', 'enum' => ['chat', 'project']],
                            'target_id' => ['type' => 'string', 'description' => 'Chat session ID/title or Project ID/name.'],
                            'path' => ['type' => 'string', 'description' => "Subdirectory to list (defaults to root '.')."],
                        ],
                        'required' => ['target_type', 'target_id'],
                    ],
                ],
            ],
            [
                'type' => 'function',
                'function' => [
                    'name' => 'read_referenced_file',
                    'description' => 'Read the complete text content of a file from a referenced chat session or project workspace.',
                    'parameters' => [
                        'type' => 'object',
                        'properties' => [
                            'target_type' => ['type' => 'string', 'enum' => ['chat', 'project']],
                            'target_id' => ['type' => 'string'],
                            'path' => ['type' => 'string', 'description' => 'Relative path in that referenced workspace.'],
                        ],
                        'required' => ['target_type', 'target_id', 'path'],
                    ],
                ],
            ],
            [
                'type' => 'function',
                'function' => [
                    'name' => 'copy_referenced_file',
                    'description' => 'Copy a file or directory from a referenced chat session or project workspace into the active workspace.',
                    'parameters' => [
                        'type' => 'object',
                        'properties' => [
                            'target_type' => ['type' => 'string', 'enum' => ['chat', 'project']],
                            'target_id' => ['type' => 'string'],
                            'source_path' => ['type' => 'string'],
                            'dest_path' => ['type' => 'string', 'description' => 'Optional destination in the active workspace.'],
                        ],
                        'required' => ['target_type', 'target_id', 'source_path'],
                    ],
                ],
            ],
        ];
    }

    // ------------------------------------------------------------- tools

    public static function listFiles(ToolContext $ctx, string $path = '.'): array
    {
        $ref = References::parsePrefixed($path);
        if ($ref !== null) {
            return References::listFiles($ref['targetType'], $ref['targetId'], $ref['subpath']);
        }
        return Files::listDir(Workspaces::ensureRoot($ctx->workspace), Files::normalizeRel($path));
    }

    public static function readFile(ToolContext $ctx, string $path): string
    {
        $ref = References::parsePrefixed($path);
        if ($ref !== null) {
            return References::readFile($ref['targetType'], $ref['targetId'], $ref['subpath']);
        }
        $abs = Workspaces::safePath($ctx->workspace, $path);
        if (!is_file($abs)) {
            throw new HttpError(404, "File not found: {$path}");
        }
        return Files::read($abs);
    }

    public static function writeFile(ToolContext $ctx, string $path, string $content, ?bool $requireApproval = null): array
    {
        $relPath = Files::normalizeRel($path);
        if ($relPath === '') {
            throw new HttpError(400, 'A file path is required');
        }
        $approvalNeeded = $requireApproval ?? Config::fileApprovalRequired();
        $abs = Workspaces::safePath($ctx->workspace, $relPath);
        $exists = is_file($abs);

        if ($approvalNeeded) {
            $cs = ChangeSets::create(
                $ctx->workspace,
                "Agent edit: {$relPath}",
                [['path' => $relPath, 'new_content' => $content, 'change_type' => $exists ? 'modified' : 'added']],
                'agent'
            );
            return [
                'status' => 'pending_approval',
                'requiresApproval' => true,
                'changesetId' => $cs['id'],
                'path' => $relPath,
                'diff' => $cs['files'][0]['diff'] ?? '',
                'message' => "Change to '{$relPath}' is staged in ChangeSet {$cs['id']} and requires user approval before applying.",
            ];
        }

        if ($exists) {
            ChangeSets::saveVersion($ctx->workspace, $relPath, Files::read($abs), 'before-direct-write');
        }
        $bytes = Files::write($abs, $content);
        ChangeSets::saveVersion($ctx->workspace, $relPath, $content, 'agent-direct');

        return [
            'status' => 'applied',
            'path' => $relPath,
            'bytes' => $bytes,
            'message' => "File '{$relPath}' saved successfully.",
        ];
    }

    public static function runCommand(ToolContext $ctx, string $command, string $cwd = '.', int $timeout = 60, bool $confirmed = false): array
    {
        $root = Workspaces::ensureRoot($ctx->workspace);
        $target = $cwd === '' || $cwd === '.' ? $root : Workspaces::safePath($ctx->workspace, $cwd);
        return Terminal::execute($command, $target, $timeout, $confirmed, $ctx->userId);
    }

    // -------------------------------------------------------- dispatcher

    public static function execute(ToolContext $ctx, string $name, array $args): mixed
    {
        return match ($name) {
            'list_files' => self::listFiles($ctx, (string) ($args['path'] ?? '.')),
            'read_file' => self::readFile($ctx, (string) ($args['path'] ?? '')),
            'write_file' => self::writeFile($ctx, (string) ($args['path'] ?? ''), (string) ($args['content'] ?? '')),
            'list_referenced_files' => References::listFiles(
                (string) ($args['target_type'] ?? 'chat'),
                (string) ($args['target_id'] ?? ''),
                (string) ($args['path'] ?? '.')
            ),
            'read_referenced_file' => References::readFile(
                (string) ($args['target_type'] ?? 'chat'),
                (string) ($args['target_id'] ?? ''),
                (string) ($args['path'] ?? '')
            ),
            'copy_referenced_file' => References::copyFile(
                (string) ($args['target_type'] ?? 'chat'),
                (string) ($args['target_id'] ?? ''),
                (string) ($args['source_path'] ?? ''),
                isset($args['dest_path']) ? (string) $args['dest_path'] : null,
                $ctx->workspace
            ),
            'run_command' => self::runCommand(
                $ctx,
                (string) ($args['command'] ?? ''),
                (string) ($args['cwd'] ?? '.'),
                (int) ($args['timeout'] ?? 60),
                (bool) ($args['confirmed'] ?? false)
            ),
            'browser_navigate' => Browser::navigate((string) ($args['url'] ?? '')),
            'http_request' => Browser::fetchUrl((string) ($args['url'] ?? '')),
            'git_status' => Git::status(Workspaces::ensureRoot($ctx->workspace)),
            'git_diff' => Git::diff((bool) ($args['staged_only'] ?? false), null, Workspaces::ensureRoot($ctx->workspace)),
            default => throw new HttpError(400, "Unknown agent tool: {$name}"),
        };
    }
}
