<?php
/**
 * Projects. Port of agent-python/app/projects.py.
 * The active project id lives in the `app_state` table.
 */

declare(strict_types=1);

namespace Arena;

final class Projects
{
    public const ACTIVE_STATE_KEY = 'active_project_id';
    public const DEFAULT_ID = 'proj-default';

    private static function format(array $r): array
    {
        $r['env_vars'] = json_decode((string) ($r['env_vars'] ?? '{}'), true) ?: [];
        $r['custom_commands'] = json_decode((string) ($r['custom_commands'] ?? '[]'), true) ?: [];
        $r['is_default'] = (int) ($r['is_default'] ?? 0);
        return $r;
    }

    public static function active(): array
    {
        $pid = Database::state(self::ACTIVE_STATE_KEY, self::DEFAULT_ID);
        $row = Database::one('SELECT * FROM projects WHERE id = ?', [$pid])
            ?? Database::one('SELECT * FROM projects WHERE is_default = 1')
            ?? Database::one('SELECT * FROM projects ORDER BY created_at ASC LIMIT 1');

        if ($row !== null) {
            return self::format($row);
        }
        return [
            'id' => self::DEFAULT_ID,
            'name' => 'Primary Project',
            'description' => 'Primary coding workspace',
            'path' => Bootstrap::$workspacesDir . '/default',
            'git_url' => '',
            'default_branch' => 'main',
            'default_provider' => 'openrouter',
            'default_model' => '',
            'instructions' => '',
            'agent_rules' => '',
            'env_vars' => [],
            'custom_commands' => [],
            'is_default' => 1,
        ];
    }

    public static function setActive(string $projectId): array
    {
        $row = Database::one('SELECT * FROM projects WHERE id = ?', [$projectId]);
        if ($row === null) {
            throw new HttpError(404, 'Project not found');
        }
        Database::transaction(static function () use ($projectId): void {
            Database::run('UPDATE projects SET is_default = 0');
            Database::run("UPDATE projects SET is_default = 1, updated_at = datetime('now') WHERE id = ?", [$projectId]);
        });
        Database::setState(self::ACTIVE_STATE_KEY, $projectId);
        return self::format($row);
    }

    public static function all(): array
    {
        return array_map(
            [self::class, 'format'],
            Database::all('SELECT * FROM projects ORDER BY is_default DESC, created_at DESC')
        );
    }

    public static function find(string $projectId): ?array
    {
        $row = Database::one('SELECT * FROM projects WHERE id = ?', [$projectId]);
        return $row === null ? null : self::format($row);
    }

    public static function create(array $data): array
    {
        $projId = 'proj-' . time() . '-' . Crypto::hex(3);
        $path = (string) ($data['path'] ?? '');
        if ($path === '') {
            $path = Bootstrap::$workspacesDir . '/' . $projId;
        }
        Files::ensureDir($path);

        Database::run(
            'INSERT INTO projects (
                id, name, description, path, git_url, default_branch, default_provider,
                default_model, instructions, agent_rules, env_vars, custom_commands, is_default
             ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)',
            [
                $projId,
                trim((string) ($data['name'] ?? 'New Project')),
                (string) ($data['description'] ?? ''),
                $path,
                (string) ($data['gitUrl'] ?? $data['git_url'] ?? ''),
                (string) ($data['defaultBranch'] ?? $data['default_branch'] ?? 'main'),
                (string) ($data['defaultProvider'] ?? $data['default_provider'] ?? 'openrouter'),
                (string) ($data['defaultModel'] ?? $data['default_model'] ?? ''),
                (string) ($data['instructions'] ?? ''),
                (string) ($data['agentRules'] ?? $data['agent_rules'] ?? ''),
                json_encode($data['envVars'] ?? $data['env_vars'] ?? [], JSON_UNESCAPED_UNICODE),
                json_encode($data['customCommands'] ?? $data['custom_commands'] ?? [], JSON_UNESCAPED_UNICODE),
            ]
        );

        // Projects get a matching workspace so the agent can work in them directly.
        Database::run(
            "INSERT OR IGNORE INTO workspaces (id, name, path, instructions, agent_rules, is_default)
             VALUES (?,?,?,?,?,0)",
            [
                $projId,
                trim((string) ($data['name'] ?? 'New Project')),
                $path,
                (string) ($data['instructions'] ?? ''),
                (string) ($data['agentRules'] ?? $data['agent_rules'] ?? ''),
            ]
        );

        Observability::log('INFO', 'PROJECT', "Created project {$projId}");
        return self::find($projId) ?? [];
    }

    public static function update(string $projectId, array $data): array
    {
        $current = self::find($projectId);
        if ($current === null) {
            throw new HttpError(404, 'Project not found');
        }
        $pick = static fn(mixed $incoming, mixed $fallback): mixed => $incoming ?? $fallback;

        Database::run(
            "UPDATE projects SET
                name = ?, description = ?, path = ?, git_url = ?, default_branch = ?,
                default_provider = ?, default_model = ?, instructions = ?, agent_rules = ?,
                env_vars = ?, custom_commands = ?, updated_at = datetime('now')
             WHERE id = ?",
            [
                $pick($data['name'] ?? null, $current['name']),
                $pick($data['description'] ?? null, $current['description']),
                $pick($data['path'] ?? null, $current['path']),
                $pick($data['gitUrl'] ?? $data['git_url'] ?? null, $current['git_url']),
                $pick($data['defaultBranch'] ?? $data['default_branch'] ?? null, $current['default_branch']),
                $pick($data['defaultProvider'] ?? $data['default_provider'] ?? null, $current['default_provider']),
                $pick($data['defaultModel'] ?? $data['default_model'] ?? null, $current['default_model']),
                $pick($data['instructions'] ?? null, $current['instructions']),
                $pick($data['agentRules'] ?? $data['agent_rules'] ?? null, $current['agent_rules']),
                json_encode($pick($data['envVars'] ?? $data['env_vars'] ?? null, $current['env_vars']), JSON_UNESCAPED_UNICODE),
                json_encode($pick($data['customCommands'] ?? $data['custom_commands'] ?? null, $current['custom_commands']), JSON_UNESCAPED_UNICODE),
                $projectId,
            ]
        );
        return self::find($projectId) ?? [];
    }

    public static function delete(string $projectId): bool
    {
        $activeId = Database::state(self::ACTIVE_STATE_KEY, self::DEFAULT_ID);
        if ($projectId === $activeId) {
            throw new HttpError(400, 'Cannot delete the currently active project. Switch to another project first.');
        }
        return Database::run('DELETE FROM projects WHERE id = ?', [$projectId])->rowCount() > 0;
    }

    /** Resolve the workspace backing a project (its directory). */
    public static function workspaceFor(array $project): array
    {
        $ws = Workspaces::find((string) $project['id']);
        if ($ws !== null) {
            return $ws;
        }
        return [
            'id' => (string) $project['id'],
            'name' => (string) $project['name'],
            'path' => (string) $project['path'],
            'instructions' => (string) ($project['instructions'] ?? ''),
            'agent_rules' => (string) ($project['agent_rules'] ?? ''),
            'is_default' => 0,
        ];
    }
}
