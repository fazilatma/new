<?php
/**
 * ChangeSets, approvals, file version history, locks and rollbacks.
 * Port of agent-python/app/changesets.py. Files live on the real filesystem,
 * metadata in SQLite.
 */

declare(strict_types=1);

namespace Arena;

final class ChangeSets
{
    // ------------------------------------------------------------- locks

    public static function acquireLock(string $relPath, string $userId, int $ttlSeconds = 300): bool
    {
        $now = microtime(true);
        $expires = $now + $ttlSeconds;
        $row = Database::one('SELECT locked_by, expires_at FROM file_locks WHERE path = ?', [$relPath]);
        if ($row !== null) {
            if ((float) $row['expires_at'] > $now && $row['locked_by'] !== $userId) {
                return false;
            }
            Database::run(
                'UPDATE file_locks SET locked_by = ?, locked_at = ?, expires_at = ? WHERE path = ?',
                [$userId, $now, $expires, $relPath]
            );
            return true;
        }
        Database::run(
            'INSERT INTO file_locks (path, locked_by, locked_at, expires_at) VALUES (?,?,?,?)',
            [$relPath, $userId, $now, $expires]
        );
        return true;
    }

    public static function releaseLock(string $relPath, string $userId): bool
    {
        Database::run(
            'DELETE FROM file_locks WHERE path = ? AND (locked_by = ? OR expires_at < ?)',
            [$relPath, $userId, microtime(true)]
        );
        return true;
    }

    public static function locks(): array
    {
        return Database::all('SELECT path, locked_by, locked_at, expires_at FROM file_locks ORDER BY locked_at DESC');
    }

    // ---------------------------------------------------------- versions

    public static function saveVersion(
        array $ws,
        string $relPath,
        string $content,
        string $createdBy = '',
        ?string $changesetId = null
    ): string {
        return Workspaces::snapshotVersion($ws, Files::normalizeRel($relPath), $content, $createdBy, $changesetId);
    }

    public static function compareVersions(string $relPath, string $v1Id, string $v2Id): array
    {
        $r1 = Database::one('SELECT content, version_num FROM file_versions WHERE id = ?', [$v1Id]);
        $r2 = Database::one('SELECT content, version_num FROM file_versions WHERE id = ?', [$v2Id]);
        if ($r1 === null || $r2 === null) {
            throw new HttpError(404, 'One or both version records not found');
        }
        return [
            'path' => $relPath,
            'v1' => ['id' => $v1Id, 'version_num' => (int) $r1['version_num']],
            'v2' => ['id' => $v2Id, 'version_num' => (int) $r2['version_num']],
            'diff' => Diff::compute(
                (string) $r1['content'],
                (string) $r2['content'],
                sprintf('%s (v%d -> v%d)', $relPath, (int) $r1['version_num'], (int) $r2['version_num'])
            ),
        ];
    }

    // -------------------------------------------------------- changesets

    public static function create(array $ws, string $title, array $files, string $createdBy = 'agent'): array
    {
        $csId = 'cs-' . time() . '-' . Crypto::hex(3);
        Database::run(
            "INSERT INTO changesets (id, workspace_id, title, status, created_by) VALUES (?,?,?,'pending',?)",
            [$csId, $ws['id'], $title, $createdBy]
        );

        $createdFiles = [];
        foreach ($files as $f) {
            $relPath = ltrim(trim((string) ($f['path'] ?? '')), '/');
            if ($relPath === '') {
                continue;
            }
            $newContent = (string) ($f['new_content'] ?? $f['content'] ?? '');
            $abs = Workspaces::safePath($ws, $relPath);
            $exists = is_file($abs);
            $oldContent = $exists ? Files::read($abs) : '';

            $changeType = (string) ($f['change_type'] ?? '');
            if ($changeType === '') {
                if (!$exists) {
                    $changeType = 'added';
                } elseif ($newContent === '' && $oldContent !== '') {
                    $changeType = 'deleted';
                } else {
                    $changeType = 'modified';
                }
            }

            $diff = Diff::compute($oldContent, $newContent, $relPath);
            $fileId = 'cf-' . Crypto::hex(4);
            Database::run(
                "INSERT INTO changeset_files (id, changeset_id, path, old_content, new_content, diff, change_type, status)
                 VALUES (?,?,?,?,?,?,?,'pending')",
                [$fileId, $csId, $relPath, $oldContent, $newContent, $diff, $changeType]
            );
            $createdFiles[] = [
                'id' => $fileId,
                'path' => $relPath,
                'change_type' => $changeType,
                'diff' => $diff,
                'old_size' => strlen($oldContent),
                'new_size' => strlen($newContent),
            ];
        }

        return [
            'id' => $csId,
            'title' => $title,
            'status' => 'pending',
            'created_by' => $createdBy,
            'files' => $createdFiles,
            'created_at' => Database::now(),
        ];
    }

    public static function get(string $csId): ?array
    {
        $cs = Database::one(
            'SELECT id, workspace_id, title, status, created_by, approved_by, created_at, updated_at
             FROM changesets WHERE id = ?',
            [$csId]
        );
        if ($cs === null) {
            return null;
        }
        $cs['files'] = Database::all(
            'SELECT id, changeset_id, path, old_content, new_content, diff, change_type, status, applied_at
             FROM changeset_files WHERE changeset_id = ?',
            [$csId]
        );
        return $cs;
    }

    public static function listFor(string $workspaceId, int $limit = 50): array
    {
        return Database::all(
            'SELECT c.id, c.workspace_id, c.title, c.status, c.created_by, c.approved_by,
                    c.created_at, c.updated_at,
                    (SELECT COUNT(*) FROM changeset_files f WHERE f.changeset_id = c.id) AS file_count
             FROM changesets c WHERE c.workspace_id = ? ORDER BY c.created_at DESC LIMIT ?',
            [$workspaceId, $limit]
        );
    }

    public static function approveFile(array $ws, string $csId, string $fileId, string $approvedBy = 'user'): array
    {
        $f = Database::one(
            'SELECT id, changeset_id, path, old_content, new_content, change_type, status
             FROM changeset_files WHERE id = ? AND changeset_id = ?',
            [$fileId, $csId]
        );
        if ($f === null) {
            throw new HttpError(404, 'File change not found');
        }

        $relPath = (string) $f['path'];
        $abs = Workspaces::safePath($ws, $relPath);
        if (is_file($abs)) {
            self::saveVersion($ws, $relPath, (string) $f['old_content'], "before-{$csId}", $csId);
        }

        if ($f['change_type'] === 'deleted') {
            if (file_exists($abs)) {
                Files::deleteTree($abs);
            }
        } else {
            Files::write($abs, (string) $f['new_content']);
        }

        self::saveVersion($ws, $relPath, (string) $f['new_content'], $approvedBy, $csId);
        Database::run(
            "UPDATE changeset_files SET status = 'approved', applied_at = datetime('now') WHERE id = ?",
            [$fileId]
        );

        $statuses = array_column(
            Database::all('SELECT status FROM changeset_files WHERE changeset_id = ?', [$csId]),
            'status'
        );
        $newStatus = 'pending';
        if ($statuses && count(array_filter($statuses, static fn($s): bool => $s === 'approved')) === count($statuses)) {
            $newStatus = 'approved';
        } elseif (in_array('approved', $statuses, true)) {
            $newStatus = 'partially_approved';
        }
        Database::run(
            "UPDATE changesets SET status = ?, approved_by = ?, updated_at = datetime('now') WHERE id = ?",
            [$newStatus, $approvedBy, $csId]
        );

        return ['ok' => true, 'file_id' => $fileId, 'path' => $relPath, 'status' => 'approved'];
    }

    public static function rejectFile(string $csId, string $fileId): array
    {
        Database::run(
            "UPDATE changeset_files SET status = 'rejected' WHERE id = ? AND changeset_id = ?",
            [$fileId, $csId]
        );
        $statuses = array_column(
            Database::all('SELECT status FROM changeset_files WHERE changeset_id = ?', [$csId]),
            'status'
        );
        if ($statuses && count(array_filter($statuses, static fn($s): bool => $s === 'rejected')) === count($statuses)) {
            Database::run("UPDATE changesets SET status = 'rejected', updated_at = datetime('now') WHERE id = ?", [$csId]);
        }
        return ['ok' => true, 'file_id' => $fileId, 'status' => 'rejected'];
    }

    public static function approve(array $ws, string $csId, string $approvedBy = 'user'): array
    {
        $cs = self::get($csId);
        if ($cs === null) {
            throw new HttpError(404, 'ChangeSet not found');
        }
        $applied = [];
        foreach ($cs['files'] as $f) {
            if ($f['status'] !== 'rejected') {
                $res = self::approveFile($ws, $csId, (string) $f['id'], $approvedBy);
                $applied[] = $res['path'];
            }
        }
        Database::run(
            "UPDATE changesets SET status = 'approved', approved_by = ?, updated_at = datetime('now') WHERE id = ?",
            [$approvedBy, $csId]
        );
        return ['ok' => true, 'changeset_id' => $csId, 'status' => 'approved', 'applied_files' => $applied];
    }

    public static function reject(string $csId, string $feedback = ''): array
    {
        Database::run("UPDATE changeset_files SET status = 'rejected' WHERE changeset_id = ?", [$csId]);
        Database::run("UPDATE changesets SET status = 'rejected', updated_at = datetime('now') WHERE id = ?", [$csId]);
        $out = ['ok' => true, 'changeset_id' => $csId, 'status' => 'rejected'];
        if ($feedback !== '') {
            $out['feedback'] = $feedback;
        }
        return $out;
    }

    public static function rollback(array $ws, string $csId): array
    {
        $cs = self::get($csId);
        if ($cs === null) {
            throw new HttpError(404, 'ChangeSet not found');
        }
        $reverted = [];
        foreach ($cs['files'] as $f) {
            if ($f['status'] !== 'approved') {
                continue;
            }
            $abs = Workspaces::safePath($ws, (string) $f['path']);
            if ($f['change_type'] === 'added') {
                if (file_exists($abs)) {
                    Files::deleteTree($abs);
                }
            } else {
                Files::write($abs, (string) $f['old_content']);
            }
            self::saveVersion($ws, (string) $f['path'], (string) $f['old_content'], "rollback-{$csId}");
            $reverted[] = $f['path'];
        }
        Database::run("UPDATE changesets SET status = 'rolled_back', updated_at = datetime('now') WHERE id = ?", [$csId]);
        return ['ok' => true, 'changeset_id' => $csId, 'status' => 'rolled_back', 'reverted_files' => $reverted];
    }

    public static function exportPatch(string $csId): string
    {
        $cs = self::get($csId);
        if ($cs === null) {
            throw new HttpError(404, 'ChangeSet not found');
        }
        $parts = [];
        foreach ($cs['files'] as $f) {
            $parts[] = $f['diff'] !== ''
                ? $f['diff']
                : Diff::compute((string) $f['old_content'], (string) $f['new_content'], (string) $f['path']);
        }
        return implode("\n", $parts);
    }

    /** Port of workflow.preview. */
    public static function previewFileChange(array $ws, string $path, string $content): array
    {
        $abs = Workspaces::safePath($ws, $path);
        $exists = is_file($abs);
        $oldContent = $exists ? Files::read($abs) : '';
        $diff = Diff::compute($oldContent, $content, $path);
        return [
            'path' => $path,
            'exists' => $exists,
            'changed' => $oldContent !== $content,
            'diff' => $diff,
            'hunks' => Diff::parseHunks($diff),
        ];
    }

    /** Port of workflow.backup. */
    public static function backupFile(array $ws, string $path): string
    {
        $abs = Workspaces::safePath($ws, $path);
        if (!is_file($abs)) {
            return '';
        }
        return self::saveVersion($ws, $path, Files::read($abs), 'backup');
    }
}
