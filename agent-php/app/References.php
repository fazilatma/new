<?php
/**
 * Cross-chat / cross-project file references.
 * Port of the reference helpers in agent-python/app/workspaces.py.
 */

declare(strict_types=1);

namespace Arena;

final class References
{
    /** Port of workspaces.resolve_reference_root — returns the backing workspace record. */
    public static function resolveWorkspace(string $targetType, string $targetId): array
    {
        $t = strtolower(trim($targetType));
        $id = trim($targetId);

        if (in_array($t, ['chat', 'session', 'conversation'], true)) {
            $clean = (string) preg_replace('/^session_/', '', $id);
            $wsId = 'session_' . $clean;
            $ws = Workspaces::find($wsId);
            if ($ws !== null) {
                return $ws;
            }
            $conv = Database::one('SELECT id FROM conversations WHERE id = ? OR title = ?', [$id, $id]);
            if ($conv !== null) {
                $wsId = 'session_' . preg_replace('/^session_/', '', (string) $conv['id']);
                $ws = Workspaces::find($wsId);
                if ($ws !== null) {
                    return $ws;
                }
            }
            return Workspaces::getOrCreateSessionWorkspace($clean);
        }

        if (in_array($t, ['project', 'proj'], true)) {
            if ($id === '' || $id === 'default' || $id === 'proj-default') {
                return Workspaces::find(Workspaces::DEFAULT_ID) ?? Workspaces::fallback();
            }
            $proj = Database::one('SELECT id, path FROM projects WHERE id = ? OR name = ?', [$id, $id]);
            if ($proj !== null) {
                $ws = Workspaces::find((string) $proj['id']);
                if ($ws !== null) {
                    return $ws;
                }
                // Projects carry their own directory; expose it as an ad-hoc workspace record.
                $path = (string) $proj['path'];
                if ($path !== '' && !str_starts_with($path, 'r2://')) {
                    return [
                        'id' => 'proj_' . $proj['id'],
                        'name' => 'Project ' . $proj['id'],
                        'path' => $path,
                        'instructions' => '',
                        'agent_rules' => '',
                        'is_default' => 0,
                    ];
                }
            }
            $ws = Workspaces::find($id);
            if ($ws !== null) {
                return $ws;
            }
            return Workspaces::find(Workspaces::DEFAULT_ID) ?? Workspaces::fallback();
        }

        if (str_starts_with($id, 'session_') || str_starts_with($id, 'conv-')) {
            return Workspaces::getOrCreateSessionWorkspace((string) preg_replace('/^session_/', '', $id));
        }
        return Workspaces::find(Workspaces::DEFAULT_ID) ?? Workspaces::fallback();
    }

    public static function listFiles(string $targetType, string $targetId, string $subpath = '.'): array
    {
        $ws = self::resolveWorkspace($targetType, $targetId);
        $root = Workspaces::ensureRoot($ws);
        return Files::listRecursive($root, Files::normalizeRel($subpath));
    }

    public static function readFile(string $targetType, string $targetId, string $filePath): string
    {
        $ws = self::resolveWorkspace($targetType, $targetId);
        $abs = Workspaces::safePath($ws, $filePath);
        if (!is_file($abs)) {
            throw new HttpError(404, "Referenced file not found: {$filePath} in {$targetType}:{$targetId}");
        }
        return Files::read($abs);
    }

    public static function copyFile(
        string $targetType,
        string $targetId,
        string $sourcePath,
        ?string $destPath,
        array $activeWorkspace
    ): array {
        $srcWs = self::resolveWorkspace($targetType, $targetId);
        $srcAbs = Workspaces::safePath($srcWs, $sourcePath);
        if (!file_exists($srcAbs)) {
            throw new HttpError(404, "Referenced path not found: {$sourcePath}");
        }
        $dest = $destPath !== null && $destPath !== ''
            ? Files::normalizeRel($destPath)
            : Files::basename(Files::normalizeRel($sourcePath));
        $destAbs = Workspaces::safePath($activeWorkspace, $dest);
        $isDir = is_dir($srcAbs);
        $copied = Files::copyTree($srcAbs, $destAbs);

        return [
            'ok' => true,
            'copied' => true,
            'type' => $isDir ? 'directory' : 'file',
            'source' => $sourcePath,
            'dest' => $dest,
            'bytes' => $isDir ? Files::dirSize($destAbs)['bytes'] : (int) (@filesize($destAbs) ?: 0),
            'files' => $copied,
            'targetType' => $targetType,
            'targetId' => $targetId,
        ];
    }

    // ------------------------------------------------- conversation links

    public static function add(string $convId, string $targetType, string $targetId, string $title = ''): array
    {
        $t = strtolower(trim($targetType));
        $id = trim($targetId);
        $refTitle = $title;

        if ($refTitle === '') {
            if ($t === 'chat') {
                $r = Database::one('SELECT title FROM conversations WHERE id = ?', [preg_replace('/^session_/', '', $id)]);
                $refTitle = $r['title'] ?? "Chat {$id}";
            } elseif ($t === 'project') {
                $r = Database::one('SELECT name FROM projects WHERE id = ? OR name = ?', [$id, $id]);
                $refTitle = $r['name'] ?? "Project {$id}";
            } else {
                $refTitle = "{$t}:{$id}";
            }
        }

        Database::run('INSERT OR IGNORE INTO conversations (id, title) VALUES (?,?)', [$convId, "Chat {$convId}"]);

        $existing = Database::one(
            'SELECT id FROM conversation_references WHERE conversation_id = ? AND target_type = ? AND target_id = ?',
            [$convId, $t, $id]
        );
        if ($existing !== null) {
            return [
                'id' => $existing['id'],
                'conversation_id' => $convId,
                'target_type' => $t,
                'target_id' => $id,
                'title' => $refTitle,
                'already_linked' => true,
            ];
        }

        $refId = 'ref_' . Crypto::hex(6);
        Database::run(
            'INSERT INTO conversation_references (id, conversation_id, target_type, target_id, title) VALUES (?,?,?,?,?)',
            [$refId, $convId, $t, $id, $refTitle]
        );
        return [
            'id' => $refId,
            'conversation_id' => $convId,
            'target_type' => $t,
            'target_id' => $id,
            'title' => $refTitle,
        ];
    }

    public static function remove(string $convId, string $targetType, string $targetId): array
    {
        Database::run(
            'DELETE FROM conversation_references WHERE conversation_id = ? AND target_type = ? AND target_id = ?',
            [$convId, $targetType, $targetId]
        );
        return ['ok' => true, 'removed' => "{$targetType}:{$targetId}"];
    }

    public static function forConversation(string $convId, bool $withFiles = true): array
    {
        $rows = Database::all(
            'SELECT id, conversation_id, target_type, target_id, title, created_at
             FROM conversation_references WHERE conversation_id = ? ORDER BY created_at ASC',
            [$convId]
        );
        foreach ($rows as &$ref) {
            if (!$withFiles) {
                continue;
            }
            try {
                $files = self::listFiles((string) $ref['target_type'], (string) $ref['target_id']);
                $ref['file_count'] = count(array_filter($files, static fn(array $f): bool => $f['type'] === 'file'));
                $ref['files'] = $files;
            } catch (\Throwable) {
                $ref['file_count'] = 0;
                $ref['files'] = [];
            }
        }
        return $rows;
    }

    /** `@chat:<id>/path` / `@project:<id>/path` prefix parsing. */
    public static function parsePrefixed(string $path): ?array
    {
        $raw = trim($path);
        if (!preg_match('#^@(chat|project|session|conversation|proj):([^/]+)(?:/(.*))?$#', $raw, $m)) {
            return null;
        }
        return ['targetType' => $m[1], 'targetId' => $m[2], 'subpath' => $m[3] ?? '.'];
    }

    /** `/api/references/search` — LIKE search over chats and projects, limit 10. */
    public static function search(string $query): array
    {
        $q = '%' . strtolower(trim($query)) . '%';
        $chats = Database::all(
            'SELECT id, title, created_at FROM conversations WHERE lower(title) LIKE ? OR lower(id) LIKE ?
             ORDER BY updated_at DESC LIMIT 10',
            [$q, $q]
        );
        $projects = Database::all(
            'SELECT id, name, description FROM projects WHERE lower(name) LIKE ? OR lower(id) LIKE ?
             ORDER BY created_at DESC LIMIT 10',
            [$q, $q]
        );
        return ['chats' => $chats, 'projects' => $projects];
    }
}
