<?php

/**
 * Proposed file changes, and the approval gate in front of them.
 *
 * When the agent wants to touch a file it records the intent here instead of
 * writing. Nothing reaches disk until somebody approves it, and because the
 * prior contents are kept, an applied change can still be undone.
 *
 * In automatic mode the write happens immediately, but the record is still
 * written — so the history and the undo work the same either way.
 */

declare(strict_types=1);

namespace Arena;

final class Changes
{
    public const PENDING = 'pending';
    public const APPLIED = 'applied';
    public const REJECTED = 'rejected';
    public const REVERTED = 'reverted';

    /** Approval mode: ask for each change, or apply as the agent goes. */
    public static function mode(): string
    {
        return Db::setting('agent_approval', 'ask') === 'auto' ? 'auto' : 'ask';
    }

    public static function setMode(string $mode): void
    {
        Db::setSetting('agent_approval', $mode === 'auto' ? 'auto' : 'ask');
    }

    /**
     * Record an intended change and, in automatic mode, carry it out.
     *
     * @param 'write'|'delete' $action
     * @return array<string,mixed> the stored record, with its diff
     */
    public static function propose(
        string $action,
        string $path,
        string $after = '',
        string $conversationId = '',
        string $note = ''
    ): array {
        $path = trim($path, '/');
        $full = Workspace::resolve($path);
        $existed = is_file($full);
        $before = $existed ? (string) @file_get_contents($full) : '';

        if ($action === 'delete') {
            if (!$existed) {
                throw new HttpError(404, 'No such file: ' . $path);
            }
            $after = '';
        }

        if ($action === 'write' && $existed && $before === $after) {
            // Proposing a no-op wastes a review. Say so instead.
            return [
                'id' => '',
                'action' => $action,
                'path' => $path,
                'status' => 'unchanged',
                'diff' => '',
                'added' => 0,
                'removed' => 0,
                'note' => 'The file already has exactly these contents.',
            ];
        }

        $id = Db::uid('chg');
        $auto = self::mode() === 'auto';
        $status = $auto ? self::APPLIED : self::PENDING;

        Db::run(
            'INSERT INTO changes (id, conversation_id, action, path, before_text, after_text,
                                  existed, status, note, created_at, decided_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)',
            [$id, $conversationId, $action, $path, $before, $after, $existed ? 1 : 0,
             $status, $note, Db::now(), $auto ? Db::now() : null]
        );

        if ($auto) {
            self::apply($action, $path, $after);
            Db::audit(Auth::currentName(), 'change.auto', "$action $path");
        }

        return self::get($id);
    }

    /** @return array<string,mixed> */
    public static function get(string $id): array
    {
        $row = Db::one('SELECT * FROM changes WHERE id = ?', [$id]);
        if ($row === null) {
            throw new HttpError(404, 'No such change: ' . $id);
        }
        return self::shape($row, true);
    }

    /**
     * @param 'pending'|'all'|string $status
     * @return array<int,array<string,mixed>>
     */
    public static function list(string $status = 'pending', string $conversationId = '', int $limit = 100): array
    {
        $sql = 'SELECT * FROM changes';
        $where = [];
        $args = [];
        if ($status !== 'all') {
            $where[] = 'status = ?';
            $args[] = $status;
        }
        if ($conversationId !== '') {
            $where[] = 'conversation_id = ?';
            $args[] = $conversationId;
        }
        if ($where !== []) {
            $sql .= ' WHERE ' . implode(' AND ', $where);
        }
        $sql .= ' ORDER BY created_at DESC, rowid DESC LIMIT ' . max(1, min(500, $limit));

        return array_map(
            static fn(array $r): array => self::shape($r, false),
            Db::all($sql, $args)
        );
    }

    public static function pendingCount(): int
    {
        $row = Db::one('SELECT COUNT(*) AS n FROM changes WHERE status = ?', [self::PENDING]);
        return (int) ($row['n'] ?? 0);
    }

    /** Approve one pending change and write it to disk. @return array<string,mixed> */
    public static function approve(string $id): array
    {
        $row = Db::one('SELECT * FROM changes WHERE id = ?', [$id]);
        if ($row === null) {
            throw new HttpError(404, 'No such change: ' . $id);
        }
        if ($row['status'] !== self::PENDING) {
            throw new HttpError(409, "That change is already {$row['status']}.");
        }
        self::apply((string) $row['action'], (string) $row['path'], (string) $row['after_text']);
        Db::run('UPDATE changes SET status = ?, decided_at = ? WHERE id = ?',
            [self::APPLIED, Db::now(), $id]);
        Db::audit(Auth::currentName(), 'change.approve', $row['action'] . ' ' . $row['path']);
        return self::get($id);
    }

    /** @return array<string,mixed> */
    public static function reject(string $id): array
    {
        $row = Db::one('SELECT * FROM changes WHERE id = ?', [$id]);
        if ($row === null) {
            throw new HttpError(404, 'No such change: ' . $id);
        }
        if ($row['status'] !== self::PENDING) {
            throw new HttpError(409, "That change is already {$row['status']}.");
        }
        Db::run('UPDATE changes SET status = ?, decided_at = ? WHERE id = ?',
            [self::REJECTED, Db::now(), $id]);
        Db::audit(Auth::currentName(), 'change.reject', $row['action'] . ' ' . $row['path']);
        return self::get($id);
    }

    /**
     * Put a file back the way it was before an applied change.
     *
     * @return array<string,mixed>
     */
    public static function revert(string $id): array
    {
        $row = Db::one('SELECT * FROM changes WHERE id = ?', [$id]);
        if ($row === null) {
            throw new HttpError(404, 'No such change: ' . $id);
        }
        if ($row['status'] !== self::APPLIED) {
            throw new HttpError(409, 'Only an applied change can be undone.');
        }
        if ((int) $row['existed'] === 1) {
            Workspace::write((string) $row['path'], (string) $row['before_text']);
        } else {
            // The change created the file, so undoing it means removing it.
            $full = Workspace::resolve((string) $row['path']);
            if (is_file($full)) {
                @unlink($full);
            }
        }
        Db::run('UPDATE changes SET status = ?, decided_at = ? WHERE id = ?',
            [self::REVERTED, Db::now(), $id]);
        Db::audit(Auth::currentName(), 'change.revert', $row['action'] . ' ' . $row['path']);
        return self::get($id);
    }

    /** Approve or reject everything still pending. @return array{approved:int,rejected:int} */
    public static function decideAll(string $decision, string $conversationId = ''): array
    {
        $done = ['approved' => 0, 'rejected' => 0];
        foreach (self::list(self::PENDING, $conversationId, 500) as $c) {
            try {
                if ($decision === 'approve') {
                    self::approve((string) $c['id']);
                    $done['approved']++;
                } else {
                    self::reject((string) $c['id']);
                    $done['rejected']++;
                }
            } catch (HttpError) {
                // A file that vanished under us should not stop the rest.
            }
        }
        return $done;
    }

    private static function apply(string $action, string $path, string $after): void
    {
        if ($action === 'delete') {
            $full = Workspace::resolve($path);
            if (is_file($full) && !@unlink($full)) {
                throw new HttpError(500, 'Could not delete: ' . $path);
            }
            return;
        }
        Workspace::write($path, $after);
    }

    /**
     * @param array<string,mixed> $r
     * @return array<string,mixed>
     */
    private static function shape(array $r, bool $withBodies): array
    {
        $before = (string) $r['before_text'];
        $after = (string) $r['after_text'];
        $stat = Diff::stat($before, $after);

        $out = [
            'id' => (string) $r['id'],
            'conversationId' => (string) $r['conversation_id'],
            'action' => (string) $r['action'],
            'path' => (string) $r['path'],
            'status' => (string) $r['status'],
            'existed' => (int) $r['existed'] === 1,
            'note' => (string) $r['note'],
            'added' => $stat['added'],
            'removed' => $stat['removed'],
            'createdAt' => (string) $r['created_at'],
            'decidedAt' => $r['decided_at'] === null ? null : (string) $r['decided_at'],
            'diff' => Diff::unified($before, $after, (string) $r['path']),
        ];
        if ($withBodies) {
            $out['before'] = $before;
            $out['after'] = $after;
        }
        return $out;
    }
}
