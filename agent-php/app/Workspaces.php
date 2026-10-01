<?php
/**
 * Workspace registry and file operations. Port of agent-python/app/workspaces.py.
 *
 * Unlike the Workers build (R2 object keys), a workspace here is a real
 * directory on disk, so `git`, `python`, `node` and the terminal all operate on
 * exactly the same bytes the UI edits.
 */

declare(strict_types=1);

namespace Arena;

final class Workspaces
{
    public const ACTIVE_STATE_KEY = 'active_workspace_id';
    public const DEFAULT_ID = 'default';

    public const TEMPLATES = [
        'fastapi' => 'FastAPI service',
        'python-cli' => 'Python CLI tool',
        'node-vite' => 'Node + Vite frontend',
        'worker' => 'Cloudflare Worker',
    ];

    // ------------------------------------------------------------ registry

    public static function fallback(): array
    {
        return [
            'id' => self::DEFAULT_ID,
            'name' => 'Main Project',
            'path' => Bootstrap::$workspacesDir . '/default',
            'instructions' => '',
            'agent_rules' => '',
            'is_default' => 1,
        ];
    }

    public static function find(string $id): ?array
    {
        return Database::one(
            'SELECT id, name, path, instructions, agent_rules, is_default, created_at FROM workspaces WHERE id = ?',
            [$id]
        );
    }

    public static function active(): array
    {
        $id = Database::state(self::ACTIVE_STATE_KEY, self::DEFAULT_ID);
        $row = self::find((string) $id);
        if ($row === null) {
            $row = Database::one(
                'SELECT id, name, path, instructions, agent_rules, is_default, created_at FROM workspaces WHERE is_default = 1'
            );
        }
        return $row ?? self::fallback();
    }

    public static function setActive(string $workspaceId): array
    {
        $row = self::find($workspaceId);
        if ($row === null) {
            throw new HttpError(404, 'Workspace not found');
        }
        Database::setState(self::ACTIVE_STATE_KEY, $workspaceId);
        self::ensureRoot($row);
        return $row;
    }

    public static function all(): array
    {
        return Database::all(
            'SELECT id, name, path, instructions, agent_rules, is_default, created_at FROM workspaces ORDER BY is_default DESC, created_at ASC'
        );
    }

    public static function create(string $name, string $template = '', string $instructions = '', string $agentRules = ''): array
    {
        $name = trim($name);
        if ($name === '') {
            throw new HttpError(400, 'Workspace name is required');
        }
        $slug = strtolower((string) preg_replace('/[^a-zA-Z0-9\-_]+/', '-', $name));
        $slug = trim($slug, '-') ?: 'workspace';
        $id = $slug . '-' . Crypto::hex(3);
        $path = Bootstrap::$workspacesDir . '/' . $id;
        Files::ensureDir($path);

        Database::run(
            'INSERT INTO workspaces (id, name, path, instructions, agent_rules, is_default) VALUES (?,?,?,?,?,0)',
            [$id, $name, $path, $instructions, $agentRules]
        );
        if ($template !== '') {
            self::applyTemplate($path, $template, $name);
        }
        Observability::log('INFO', 'WORKSPACE', "Created workspace {$id}", ['template' => $template]);
        return self::find($id) ?? self::fallback();
    }

    public static function delete(string $id): void
    {
        if ($id === self::DEFAULT_ID) {
            throw new HttpError(400, 'The default workspace cannot be deleted');
        }
        $ws = self::find($id);
        if ($ws === null) {
            throw new HttpError(404, 'Workspace not found');
        }
        Files::deleteTree(self::root($ws));
        Database::run('DELETE FROM workspaces WHERE id = ?', [$id]);
        Database::run('DELETE FROM file_versions WHERE workspace_id = ?', [$id]);
        Database::run('DELETE FROM changesets WHERE workspace_id = ?', [$id]);
        if (Database::state(self::ACTIVE_STATE_KEY) === $id) {
            Database::setState(self::ACTIVE_STATE_KEY, self::DEFAULT_ID);
        }
    }

    public static function sessionWorkspaceId(string $sessionId): string
    {
        $clean = (string) preg_replace('/[^a-zA-Z0-9\-_]/', '', $sessionId);
        return 'session_' . ($clean !== '' ? $clean : 'conv_' . time());
    }

    /** Port of workspaces.get_or_create_session_workspace. */
    public static function getOrCreateSessionWorkspace(string $sessionId, string $title = ''): array
    {
        $wsId = self::sessionWorkspaceId($sessionId);
        $row = self::find($wsId);
        if ($row === null) {
            $label = $title !== '' ? $title : substr(str_replace('session_', '', $wsId), 0, 8);
            $path = Bootstrap::$workspacesDir . '/' . $wsId;
            Files::ensureDir($path);
            Database::run(
                "INSERT OR IGNORE INTO workspaces (id, name, path, instructions, agent_rules, is_default)
                 VALUES (?,?,?,'','',0)",
                [$wsId, "Session Workspace ({$label})", $path]
            );
            $row = self::find($wsId);
        }
        Database::setState(self::ACTIVE_STATE_KEY, $wsId);
        $row ??= self::fallback();
        self::ensureRoot($row);
        return $row;
    }

    /** Port of workspaces.reset_session_workspace — wipe the directory, keep the row. */
    public static function resetSessionWorkspace(string $sessionId): array
    {
        $ws = self::getOrCreateSessionWorkspace($sessionId);
        $root = self::ensureRoot($ws);
        $removed = 0;
        foreach (scandir($root) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }
            $removed += Files::deleteTree($root . '/' . $entry);
        }
        Database::run('DELETE FROM file_versions WHERE workspace_id = ?', [$ws['id']]);
        Database::run('DELETE FROM changesets WHERE workspace_id = ?', [$ws['id']]);
        Observability::log('INFO', 'WORKSPACE', "Reset session workspace {$ws['id']} ({$removed} entries)");
        return ['ok' => true, 'workspace' => $ws, 'removed' => $removed] + $ws;
    }

    /**
     * Resolve which workspace a request targets: explicit id > conversation
     * scoped workspace > active workspace.
     */
    public static function resolve(?string $workspaceId = null, ?string $conversationId = null): array
    {
        if ($workspaceId !== null && $workspaceId !== '') {
            $row = self::find($workspaceId);
            if ($row !== null) {
                self::ensureRoot($row);
                return $row;
            }
        }
        if ($conversationId !== null && $conversationId !== '') {
            $wsId = self::sessionWorkspaceId($conversationId);
            $row = self::find($wsId);
            if ($row !== null) {
                self::ensureRoot($row);
                return $row;
            }
        }
        $active = self::active();
        self::ensureRoot($active);
        return $active;
    }

    /** Same resolution, from a Request's usual query/body parameters. */
    public static function forRequest(Request $req): array
    {
        $wsId = $req->str('workspace_id', '') ?: $req->str('workspaceId', '');
        $conv = $req->str('conversation_id', '') ?: $req->str('session_id', '');
        return self::resolve($wsId !== '' ? $wsId : null, $conv !== '' ? $conv : null);
    }

    // ------------------------------------------------------------- paths

    public static function root(array $ws): string
    {
        $path = (string) ($ws['path'] ?? '');
        // Legacy rows created by the Cloudflare build used `r2://ws/<id>`.
        if ($path === '' || str_starts_with($path, 'r2://')) {
            $path = Bootstrap::$workspacesDir . '/' . ($ws['id'] ?? self::DEFAULT_ID);
        }
        return rtrim($path, '/');
    }

    public static function ensureRoot(array $ws): string
    {
        $root = self::root($ws);
        Files::ensureDir($root);
        return $root;
    }

    /** Port of workspaces.safe_path: absolute path guaranteed inside the root. */
    public static function safePath(array $ws, ?string $rel): string
    {
        $root = self::ensureRoot($ws);
        $norm = Files::normalizeRel($rel);
        $abs = $norm === '' ? $root : $root . '/' . $norm;
        $realRoot = realpath($root) ?: $root;
        $probe = $abs;
        while (!file_exists($probe) && strlen($probe) > strlen($realRoot)) {
            $probe = dirname($probe);
        }
        $realProbe = realpath($probe) ?: $probe;
        if ($realProbe !== $realRoot && !str_starts_with($realProbe, $realRoot . DIRECTORY_SEPARATOR)) {
            throw new HttpError(400, "Path traversal detected: '{$rel}' is outside the workspace root");
        }
        return $abs;
    }

    // ------------------------------------------------------- file actions

    public static function readFile(array $ws, string $rel): array
    {
        $abs = self::safePath($ws, $rel);
        if (!is_file($abs)) {
            throw new HttpError(404, 'File not found');
        }
        $content = Files::read($abs);
        return [
            'path' => Files::normalizeRel($rel),
            'content' => $content,
            'size' => strlen($content),
        ];
    }

    public static function writeFile(array $ws, string $rel, string $content, string $author = 'agent'): array
    {
        $norm = Files::normalizeRel($rel);
        if ($norm === '') {
            throw new HttpError(400, 'Cannot write to the workspace root');
        }
        $abs = self::safePath($ws, $norm);
        $existed = is_file($abs);
        if ($existed) {
            self::snapshotVersion($ws, $norm, Files::read($abs), $author);
        }
        $size = Files::write($abs, $content);
        return ['ok' => true, 'path' => $norm, 'size' => $size, 'created' => !$existed];
    }

    public static function createEntry(array $ws, string $rel, bool $isDir, string $content = ''): array
    {
        $norm = Files::normalizeRel($rel);
        if ($norm === '') {
            throw new HttpError(400, 'A path is required');
        }
        $abs = self::safePath($ws, $norm);
        if (file_exists($abs)) {
            throw new HttpError(400, 'Path already exists');
        }
        if ($isDir) {
            Files::ensureDir($abs);
            $size = 0;
        } else {
            $size = Files::write($abs, $content);
        }
        return [
            'ok' => true,
            'path' => $norm,
            'type' => $isDir ? 'dir' : 'file',
            'isDir' => $isDir,
            'created' => true,
            'size' => $size,
        ];
    }

    public static function rename(array $ws, string $from, string $to): array
    {
        $fromNorm = Files::normalizeRel($from);
        $toNorm = Files::normalizeRel($to);
        if ($fromNorm === '' || $toNorm === '') {
            throw new HttpError(400, 'Both old_path and new_path are required');
        }
        $fromAbs = self::safePath($ws, $fromNorm);
        $toAbs = self::safePath($ws, $toNorm);
        if (!file_exists($fromAbs)) {
            throw new HttpError(404, 'Source path not found');
        }
        if (file_exists($toAbs)) {
            throw new HttpError(400, 'Target path already exists');
        }
        Files::ensureDir(dirname($toAbs));
        if (!@rename($fromAbs, $toAbs)) {
            throw new HttpError(500, 'Rename failed');
        }
        Database::run(
            'UPDATE file_versions SET path = ? WHERE workspace_id = ? AND path = ?',
            [$toNorm, $ws['id'], $fromNorm]
        );
        return [
            'ok' => true,
            'old_path' => $fromNorm,
            'new_path' => $toNorm,
            'type' => is_dir($toAbs) ? 'dir' : 'file',
            'isDir' => is_dir($toAbs),
        ];
    }

    public static function deletePath(array $ws, string $rel): array
    {
        $norm = Files::normalizeRel($rel);
        if ($norm === '') {
            throw new HttpError(400, 'Refusing to delete the workspace root');
        }
        $abs = self::safePath($ws, $norm);
        if (!file_exists($abs)) {
            throw new HttpError(404, 'Path not found');
        }
        $isDir = is_dir($abs);
        $removed = Files::deleteTree($abs);
        return ['ok' => true, 'path' => $norm, 'type' => $isDir ? 'dir' : 'file', 'removed' => $removed];
    }

    // ---------------------------------------------------------- versions

    public static function snapshotVersion(array $ws, string $rel, string $content, string $author = 'agent', ?string $changesetId = null): string
    {
        $next = (int) Database::scalar(
            'SELECT COALESCE(MAX(version_num), 0) + 1 FROM file_versions WHERE workspace_id = ? AND path = ?',
            [$ws['id'], $rel]
        );
        $id = Database::id('fv');
        Database::run(
            'INSERT INTO file_versions (id, workspace_id, path, version_num, content, created_by, changeset_id)
             VALUES (?,?,?,?,?,?,?)',
            [$id, $ws['id'], $rel, $next, $content, $author, $changesetId]
        );
        // Keep history bounded like the Python version did (50 newest per file).
        Database::run(
            'DELETE FROM file_versions WHERE workspace_id = ? AND path = ? AND id NOT IN (
                SELECT id FROM file_versions WHERE workspace_id = ? AND path = ?
                ORDER BY version_num DESC LIMIT 50)',
            [$ws['id'], $rel, $ws['id'], $rel]
        );
        return $id;
    }

    public static function versions(array $ws, string $rel): array
    {
        return Database::all(
            'SELECT id, path, version_num, created_by, changeset_id, created_at, LENGTH(content) AS size
             FROM file_versions WHERE workspace_id = ? AND path = ? ORDER BY version_num DESC',
            [$ws['id'], Files::normalizeRel($rel)]
        );
    }

    public static function version(string $id): ?array
    {
        return Database::one('SELECT * FROM file_versions WHERE id = ?', [$id]);
    }

    public static function rollback(array $ws, string $versionId, string $author = 'agent'): array
    {
        $v = self::version($versionId);
        if ($v === null || $v['workspace_id'] !== $ws['id']) {
            throw new HttpError(404, 'Version not found');
        }
        $abs = self::safePath($ws, $v['path']);
        if (is_file($abs)) {
            self::snapshotVersion($ws, $v['path'], Files::read($abs), $author);
        }
        Files::write($abs, (string) $v['content']);
        return ['ok' => true, 'path' => $v['path'], 'restored_version' => (int) $v['version_num']];
    }

    // --------------------------------------------------------- templates

    private static function applyTemplate(string $root, string $template, string $name): void
    {
        $files = match ($template) {
            'fastapi' => [
                'main.py' => "from fastapi import FastAPI\n\napp = FastAPI(title=\"{$name}\")\n\n\n@app.get(\"/\")\ndef read_root():\n    return {\"status\": \"ok\"}\n",
                'requirements.txt' => "fastapi\nuvicorn[standard]\n",
                'README.md' => "# {$name}\n\nRun with:\n\n```bash\nuvicorn main:app --reload\n```\n",
            ],
            'python-cli' => [
                'main.py' => "import argparse\n\n\ndef main() -> None:\n    parser = argparse.ArgumentParser(description=\"{$name}\")\n    parser.add_argument(\"--name\", default=\"world\")\n    args = parser.parse_args()\n    print(f\"Hello, {args.name}!\")\n\n\nif __name__ == \"__main__\":\n    main()\n",
                'README.md' => "# {$name}\n\n```bash\npython main.py --name you\n```\n",
            ],
            'node-vite' => [
                'package.json' => json_encode([
                    'name' => strtolower((string) preg_replace('/[^a-z0-9\-]+/i', '-', $name)),
                    'private' => true,
                    'version' => '0.1.0',
                    'type' => 'module',
                    'scripts' => ['dev' => 'vite', 'build' => 'vite build', 'preview' => 'vite preview'],
                    'devDependencies' => ['vite' => '^5.0.0'],
                ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n",
                'index.html' => "<!doctype html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"utf-8\" />\n    <title>{$name}</title>\n  </head>\n  <body>\n    <div id=\"app\"></div>\n    <script type=\"module\" src=\"/src/main.js\"></script>\n  </body>\n</html>\n",
                'src/main.js' => "document.querySelector('#app').textContent = 'Hello from {$name}';\n",
            ],
            'worker' => [
                'src/index.js' => "export default {\n  async fetch(request, env, ctx) {\n    return new Response('Hello from {$name}');\n  },\n};\n",
                'wrangler.toml' => "name = \"" . strtolower((string) preg_replace('/[^a-z0-9\-]+/i', '-', $name)) . "\"\nmain = \"src/index.js\"\ncompatibility_date = \"2024-01-01\"\n",
            ],
            default => [],
        };
        foreach ($files as $rel => $content) {
            Files::write($root . '/' . $rel, $content);
        }
    }

    // ------------------------------------------------------------- stats

    public static function stats(array $ws): array
    {
        $root = self::ensureRoot($ws);
        $size = Files::dirSize($root);
        $total = @disk_total_space($root) ?: 0;
        $free = @disk_free_space($root) ?: 0;
        return [
            'workspaceId' => $ws['id'],
            'root' => $root,
            'files' => $size['files'],
            'directories' => $size['dirs'],
            'bytes' => $size['bytes'],
            'humanSize' => Files::humanSize($size['bytes']),
            'diskTotalBytes' => (int) $total,
            'diskFreeBytes' => (int) $free,
            'diskUsedBytes' => (int) ($total - $free),
        ];
    }
}
