<?php
/**
 * Conversations, messages and resumable checkpoints.
 * Port of the conversation helpers in agent-python/app/{main,chat}.py.
 */

declare(strict_types=1);

namespace Arena;

final class Conversations
{
    public static function ensure(string $id, string $title = '', string $providerId = '', string $modelId = ''): void
    {
        if ($id === '') {
            return;
        }
        Database::run(
            'INSERT OR IGNORE INTO conversations (id, title, provider_id, model_id) VALUES (?,?,?,?)',
            [$id, $title !== '' ? $title : "Chat {$id}", $providerId, $modelId]
        );
    }

    public static function all(int $limit = 200): array
    {
        return Database::all(
            'SELECT c.id, c.workspace_id, c.user_id, c.title, c.provider_id, c.model_id, c.created_at, c.updated_at,
                    (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
             FROM conversations c ORDER BY c.updated_at DESC LIMIT ?',
            [$limit]
        );
    }

    public static function find(string $id): ?array
    {
        return Database::one('SELECT * FROM conversations WHERE id = ?', [$id]);
    }

    public static function create(array $data): array
    {
        $id = (string) ($data['id'] ?? Database::id('conv'));
        Database::run(
            'INSERT OR REPLACE INTO conversations (id, workspace_id, user_id, title, provider_id, model_id, updated_at)
             VALUES (?,?,?,?,?,?,datetime(\'now\'))',
            [
                $id,
                (string) ($data['workspace_id'] ?? ''),
                (string) ($data['user_id'] ?? ''),
                (string) ($data['title'] ?? "Chat {$id}"),
                (string) ($data['provider_id'] ?? ''),
                (string) ($data['model_id'] ?? ''),
            ]
        );
        return self::find($id) ?? ['id' => $id];
    }

    public static function update(string $id, array $data): array
    {
        $fields = [];
        $params = [];
        foreach (['title', 'provider_id', 'model_id', 'workspace_id'] as $col) {
            if (array_key_exists($col, $data)) {
                $fields[] = "{$col} = ?";
                $params[] = (string) $data[$col];
            }
        }
        if ($fields) {
            $params[] = $id;
            Database::run(
                'UPDATE conversations SET ' . implode(', ', $fields) . ", updated_at = datetime('now') WHERE id = ?",
                $params
            );
        }
        return self::find($id) ?? ['id' => $id];
    }

    public static function delete(string $id): array
    {
        Database::run('DELETE FROM messages WHERE conversation_id = ?', [$id]);
        Database::run('DELETE FROM conversation_references WHERE conversation_id = ?', [$id]);
        Database::run('DELETE FROM conversation_checkpoints WHERE conversation_id = ?', [$id]);
        Database::run('DELETE FROM conversations WHERE id = ?', [$id]);
        return ['ok' => true, 'deleted' => $id];
    }

    // ---------------------------------------------------------- messages

    public static function messages(string $conversationId, int $limit = 500): array
    {
        return Database::all(
            'SELECT id, conversation_id, role, content, tool_calls, tool_call_id, created_at
             FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC LIMIT ?',
            [$conversationId, $limit]
        );
    }

    public static function addMessage(string $conversationId, array $message): string
    {
        self::ensure($conversationId);
        $id = Database::id('msg');
        Database::run(
            'INSERT INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id) VALUES (?,?,?,?,?,?)',
            [
                $id,
                $conversationId,
                (string) ($message['role'] ?? 'user'),
                (string) ($message['content'] ?? ''),
                isset($message['tool_calls']) ? json_encode($message['tool_calls'], JSON_UNESCAPED_UNICODE) : null,
                $message['tool_call_id'] ?? null,
            ]
        );
        Database::run("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?", [$conversationId]);
        return $id;
    }

    // ------------------------------------------------------- checkpoints

    public static function saveCheckpoint(array $input): string
    {
        $conversationId = (string) ($input['conversationId'] ?? '');
        if ($conversationId === '') {
            return '';
        }
        $cpId = 'cp-' . time() . '-' . Crypto::hex(3);
        try {
            self::ensure($conversationId, 'Conversation', (string) ($input['providerId'] ?? ''), (string) ($input['modelId'] ?? ''));
            Database::run(
                "INSERT INTO conversation_checkpoints (
                    id, conversation_id, step_index, provider_id, model_id,
                    accumulated_content, accumulated_reasoning,
                    chat_history_json, saved_files_json, execution_results_json,
                    status, error_message, updated_at
                 ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))",
                [
                    $cpId,
                    $conversationId,
                    (int) ($input['stepIndex'] ?? 0),
                    (string) ($input['providerId'] ?? ''),
                    (string) ($input['modelId'] ?? ''),
                    (string) ($input['accumulatedContent'] ?? ''),
                    (string) ($input['accumulatedReasoning'] ?? ''),
                    json_encode($input['chatHistory'] ?? [], JSON_UNESCAPED_UNICODE),
                    json_encode($input['savedFiles'] ?? [], JSON_UNESCAPED_UNICODE),
                    json_encode($input['executionResults'] ?? [], JSON_UNESCAPED_UNICODE),
                    (string) ($input['status'] ?? 'in_progress'),
                    (string) ($input['errorMessage'] ?? ''),
                ]
            );
            return $cpId;
        } catch (\Throwable) {
            return '';
        }
    }

    private static function mapCheckpoint(array $r): array
    {
        $parse = static function (?string $s, mixed $default): mixed {
            $decoded = json_decode((string) $s, true);
            return $decoded === null ? $default : $decoded;
        };
        return [
            'id' => $r['id'],
            'conversationId' => $r['conversation_id'],
            'stepIndex' => (int) $r['step_index'],
            'providerId' => $r['provider_id'],
            'modelId' => $r['model_id'],
            'accumulatedContent' => $r['accumulated_content'],
            'accumulatedReasoning' => $r['accumulated_reasoning'],
            'chatHistory' => $parse($r['chat_history_json'] ?? null, []),
            'savedFiles' => $parse($r['saved_files_json'] ?? null, []),
            'executionResults' => $parse($r['execution_results_json'] ?? null, []),
            'status' => $r['status'],
            'errorMessage' => $r['error_message'],
            'updatedAt' => $r['updated_at'],
        ];
    }

    public static function latestCheckpoint(string $conversationId): ?array
    {
        if ($conversationId === '') {
            return null;
        }
        $row = Database::one(
            'SELECT * FROM conversation_checkpoints WHERE conversation_id = ?
             ORDER BY step_index DESC, updated_at DESC, id DESC LIMIT 1',
            [$conversationId]
        );
        return $row === null ? null : self::mapCheckpoint($row);
    }

    public static function checkpoints(string $conversationId, int $limit = 20): array
    {
        if ($conversationId === '') {
            return [];
        }
        $rows = Database::all(
            'SELECT * FROM conversation_checkpoints WHERE conversation_id = ?
             ORDER BY step_index DESC, updated_at DESC, id DESC LIMIT ?',
            [$conversationId, $limit]
        );
        return array_map([self::class, 'mapCheckpoint'], $rows);
    }

    public static function clearCheckpoints(string $conversationId): void
    {
        if ($conversationId === '') {
            return;
        }
        try {
            Database::run('DELETE FROM conversation_checkpoints WHERE conversation_id = ?', [$conversationId]);
        } catch (\Throwable) {
        }
    }
}
