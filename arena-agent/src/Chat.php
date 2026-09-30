<?php

/**
 * Conversations and the streaming endpoint.
 */

declare(strict_types=1);

namespace Arena;

final class Chat
{
    /** @return array<int,array<string,mixed>> */
    public static function conversations(): array
    {
        return array_map(static fn(array $c): array => [
            'id' => (string) $c['id'],
            'title' => (string) $c['title'],
            'providerId' => (string) $c['provider_id'],
            'modelId' => (string) $c['model_id'],
            'updatedAt' => (string) $c['updated_at'],
        ], Db::all('SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 200'));
    }

    public static function create(string $title = 'New chat'): string
    {
        $id = Db::uid('c');
        Db::run(
            'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?,?,?,?)',
            [$id, $title, Db::now(), Db::now()]
        );
        return $id;
    }

    /** @return array<int,array<string,mixed>> */
    public static function messages(string $conversationId): array
    {
        return array_map(static fn(array $m): array => [
            'id' => (int) $m['id'],
            'role' => (string) $m['role'],
            'content' => (string) $m['content'],
            'createdAt' => (string) $m['created_at'],
        ], Db::all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id', [$conversationId]));
    }

    public static function addMessage(string $conversationId, string $role, string $content): void
    {
        Db::run(
            'INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?,?,?,?)',
            [$conversationId, $role, $content, Db::now()]
        );
        Db::run('UPDATE conversations SET updated_at = ? WHERE id = ?', [Db::now(), $conversationId]);
    }

    public static function delete(string $id): void
    {
        Db::run('DELETE FROM conversations WHERE id = ?', [$id]);
    }

    /** Give an untitled conversation a name from its first user message. */
    public static function autoTitle(string $conversationId, string $firstMessage): void
    {
        $row = Db::one('SELECT title FROM conversations WHERE id = ?', [$conversationId]);
        if ($row === null || ((string) $row['title']) !== 'New chat') {
            return;
        }
        $title = trim(preg_replace('/\s+/', ' ', $firstMessage) ?? $firstMessage);
        if (mb_strlen($title) > 48) {
            $title = mb_substr($title, 0, 48) . '…';
        }
        Db::run('UPDATE conversations SET title = ? WHERE id = ?', [$title ?: 'New chat', $conversationId]);
    }

    /**
     * Server-sent events for one exchange.
     *
     * Event order is fixed so the UI can rely on it:
     *   start → token* → done   (or  error  at any point)
     */
    public static function streamReply(Request $req): void
    {
        $providerId = (string) $req->input('providerId', '');
        $modelId = (string) $req->input('modelId', '');
        $conversationId = (string) $req->input('conversationId', '');
        $text = trim((string) $req->input('message', ''));
        $systemPrompt = (string) $req->input('system', (string) Db::setting('system_prompt', ''));
        $temperature = (float) $req->input('temperature', 0.7);

        self::openStream();

        try {
            if ($text === '') {
                throw new HttpError(400, 'The message was empty.');
            }
            $provider = Providers::find($providerId, true);
            if ($provider === null) {
                throw new HttpError(404, 'That provider no longer exists. Pick another in the header.');
            }
            if (!$provider['enabled']) {
                throw new HttpError(400, "Provider '{$provider['name']}' is disabled.");
            }
            if ($modelId === '') {
                throw new HttpError(400, 'No model selected.');
            }

            if ($conversationId === '') {
                $conversationId = self::create();
            }
            self::send('start', ['conversationId' => $conversationId]);

            $history = [];
            if ($systemPrompt !== '') {
                $history[] = ['role' => 'system', 'content' => $systemPrompt];
            }
            foreach (self::messages($conversationId) as $m) {
                if (in_array($m['role'], ['user', 'assistant'], true)) {
                    $history[] = ['role' => $m['role'], 'content' => $m['content']];
                }
            }
            $history[] = ['role' => 'user', 'content' => $text];

            self::addMessage($conversationId, 'user', $text);
            self::autoTitle($conversationId, $text);
            Db::run('UPDATE conversations SET provider_id = ?, model_id = ? WHERE id = ?',
                [$providerId, $modelId, $conversationId]);

            $built = Llm::build($provider, $modelId, $history, true, $temperature);
            $full = '';
            Llm::stream(
                (string) $provider['protocol'],
                $built['url'],
                $built['headers'],
                $built['body'],
                static function (string $piece) use (&$full): void {
                    $full .= $piece;
                    self::send('token', ['text' => $piece]);
                }
            );

            if ($full === '') {
                throw new HttpError(502, 'The provider returned an empty response.');
            }
            self::addMessage($conversationId, 'assistant', $full);
            self::send('done', ['conversationId' => $conversationId, 'length' => strlen($full)]);
        } catch (HttpError $e) {
            self::send('error', ['message' => $e->getMessage(), 'status' => $e->status]);
        } catch (\Throwable $e) {
            self::send('error', ['message' => $e->getMessage()]);
        }
        self::endStream();
    }

    private static function openStream(): void
    {
        if (!Response::$started && !headers_sent()) {
            http_response_code(200);
            header('Content-Type: text/event-stream; charset=utf-8');
            header('Cache-Control: no-cache, no-transform');
            header('Connection: keep-alive');
            header('X-Accel-Buffering: no');   // nginx would otherwise hold it all back
        }
        Response::$started = true;
        while (ob_get_level() > 0) {
            ob_end_flush();
        }
        // Some hosts buffer until a few KB have accumulated; this nudges them.
        echo ': ' . str_repeat(' ', 2048) . "\n\n";
        @ob_flush();
        flush();
    }

    /** @param array<string,mixed> $data */
    private static function send(string $event, array $data): void
    {
        echo 'event: ' . $event . "\n";
        echo 'data: ' . json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n\n";
        @ob_flush();
        flush();
    }

    private static function endStream(): void
    {
        echo "event: end\ndata: {}\n\n";
        @ob_flush();
        flush();
    }
}
