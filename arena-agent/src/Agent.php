<?php

/**
 * The agent loop.
 *
 * A plain chat sends one message and streams one answer. An agent keeps
 * going: the model asks for a tool, the tool runs, the result goes back, and
 * round it goes until the model has an answer or the step budget runs out.
 *
 * One deliberate limitation, stated plainly because it is visible to users:
 * a step that may contain tool calls is *not* streamed. Tool calls only make
 * sense once complete — you cannot run half a function call — and no provider
 * streams them in a form worth reassembling across four wire formats. So the
 * text of each step arrives in one piece, and the progress you watch is the
 * tools running, which is the interesting part anyway.
 */

declare(strict_types=1);

namespace Arena;

final class Agent
{
    /** Hard ceiling on tool rounds, so a confused model cannot loop forever. */
    public const MAX_STEPS = 12;

    public static function systemPrompt(): string
    {
        $custom = (string) Db::setting('agent_prompt', '');
        if (trim($custom) !== '') {
            return $custom;
        }

        $shell = in_array('run_command', Tools::availableNames(), true);
        $mode = Changes::mode() === 'auto'
            ? 'Your file changes are applied immediately.'
            : 'Your file changes are queued for the user to approve, so the file on disk does '
              . 'not change until they accept it. Keep working as though it will be accepted.';

        return implode("\n", array_filter([
            'You are a coding agent working inside a sandboxed workspace folder.',
            '',
            'How to work:',
            '- Look before you leap. Use list_files and read_file to find out what is actually '
                . 'there instead of guessing at names or contents.',
            '- Prefer edit_file over write_file for a change to an existing file, so you do not '
                . 'accidentally discard parts you did not mean to touch.',
            $shell ? '- You can run commands. Run the tests or the script after changing it, and '
                . 'report what actually happened rather than what you expect.' : null,
            '- If a tool fails, read the error. It usually says exactly what to fix.',
            '- Stop when the job is done and say what you changed, briefly. Do not narrate every '
                . 'step you are about to take; just take it.',
            '',
            $mode,
        ], static fn(?string $l): bool => $l !== null));
    }

    /**
     * Run the loop for one user message, streaming progress as it goes.
     */
    public static function run(Request $req): void
    {
        $providerId = (string) $req->input('providerId', '');
        $modelId = (string) $req->input('modelId', '');
        $conversationId = (string) $req->input('conversationId', '');
        $text = trim((string) $req->input('message', ''));
        $temperature = (float) $req->input('temperature', 0.3);
        $maxSteps = max(1, min(self::MAX_STEPS, (int) $req->input('maxSteps', self::MAX_STEPS)));

        Sse::open();

        try {
            if ($text === '') {
                throw new HttpError(400, 'The message was empty.');
            }
            $provider = Providers::find($providerId, true);
            if ($provider === null) {
                throw new HttpError(404, 'That provider no longer exists. Pick another one.');
            }
            if (!$provider['enabled']) {
                throw new HttpError(400, "Provider '{$provider['name']}' is disabled.");
            }
            if ($modelId === '') {
                throw new HttpError(400, 'No model selected.');
            }

            $tools = Tools::available();
            if ($tools === []) {
                throw new HttpError(500, 'No tools are available on this host.');
            }

            if ($conversationId === '') {
                $conversationId = Chat::create();
            }
            Sse::send('start', [
                'conversationId' => $conversationId,
                'tools' => array_column($tools, 'name'),
                'approval' => Changes::mode(),
            ]);

            $history = self::history($conversationId, $text);
            Chat::addMessage($conversationId, 'user', $text);
            Chat::autoTitle($conversationId, $text);
            Db::run('UPDATE conversations SET provider_id = ?, model_id = ? WHERE id = ?',
                [$providerId, $modelId, $conversationId]);

            $protocol = (string) $provider['protocol'];
            $answer = '';
            $usedTools = 0;
            $step = 0;

            while ($step < $maxSteps) {
                $step++;
                Sse::send('step', ['step' => $step, 'of' => $maxSteps]);

                $built = Llm::build($provider, $modelId, $history, false, $temperature, $tools);
                [$status, $body] = Llm::send($built['url'], $built['headers'], $built['body'], 180);
                if ($status >= 400) {
                    throw new HttpError(502, self::providerError($status, $body));
                }

                $reply = Llm::parseReply($protocol, $body);

                // Any prose in this step is worth showing even when the model
                // carries on with more tools — it is the model thinking aloud.
                if (trim($reply['text']) !== '') {
                    Sse::send('token', ['text' => ($answer === '' ? '' : "\n\n") . $reply['text']]);
                    $answer .= ($answer === '' ? '' : "\n\n") . $reply['text'];
                }

                if ($reply['toolCalls'] === []) {
                    break;
                }

                $history[] = [
                    'role' => 'assistant',
                    'content' => $reply['text'],
                    'toolCalls' => $reply['toolCalls'],
                ];
                self::persist($conversationId, 'assistant', $reply['text'],
                    ['toolCalls' => $reply['toolCalls']]);

                foreach ($reply['toolCalls'] as $call) {
                    $usedTools++;
                    Sse::send('tool', [
                        'id' => $call['id'],
                        'name' => $call['name'],
                        'args' => $call['args'],
                    ]);

                    $result = Tools::run($call['name'], $call['args'], $conversationId);

                    Sse::send('tool_result', [
                        'id' => $call['id'],
                        'name' => $call['name'],
                        'ok' => $result['ok'],
                        'summary' => $result['summary'],
                        'output' => self::preview($result['result']),
                    ]);
                    if ($result['change'] !== null) {
                        Sse::send('change', $result['change']);
                    }

                    $history[] = [
                        'role' => 'tool',
                        'toolCallId' => $call['id'],
                        'name' => $call['name'],
                        'content' => $result['result'],
                    ];
                    self::persist($conversationId, 'tool', $result['result'], [
                        'toolCallId' => $call['id'],
                        'name' => $call['name'],
                        'ok' => $result['ok'],
                        'summary' => $result['summary'],
                    ]);
                }
            }

            $hitCeiling = $step >= $maxSteps && $answer === '';
            if ($hitCeiling) {
                $answer = "I stopped after $maxSteps steps without reaching an answer. "
                    . 'Tell me what to focus on and I will continue.';
                Sse::send('token', ['text' => $answer]);
            }
            if (trim($answer) !== '') {
                Chat::addMessage($conversationId, 'assistant', $answer);
            }

            Sse::send('done', [
                'conversationId' => $conversationId,
                'steps' => $step,
                'toolCalls' => $usedTools,
                'pending' => Changes::pendingCount(),
                'stoppedEarly' => $hitCeiling,
            ]);
        } catch (HttpError $e) {
            Sse::send('error', ['message' => $e->getMessage(), 'status' => $e->status]);
        } catch (\Throwable $e) {
            Sse::send('error', ['message' => $e->getMessage()]);
        }
        Sse::end();
    }

    /**
     * Rebuild the conversation in the neutral message shape, including the
     * tool calls and results from earlier turns so the model keeps its
     * bearings across page reloads.
     *
     * @return array<int,array<string,mixed>>
     */
    private static function history(string $conversationId, string $newMessage): array
    {
        $out = [['role' => 'system', 'content' => self::systemPrompt()]];
        $userPrompt = (string) Db::setting('system_prompt', '');
        if (trim($userPrompt) !== '') {
            $out[] = ['role' => 'system', 'content' => $userPrompt];
        }

        foreach (Db::all(
            'SELECT role, content, meta FROM messages WHERE conversation_id = ? ORDER BY id',
            [$conversationId]
        ) as $row) {
            $meta = json_decode((string) ($row['meta'] ?? '{}'), true);
            $meta = is_array($meta) ? $meta : [];
            $role = (string) $row['role'];

            if ($role === 'tool') {
                $out[] = [
                    'role' => 'tool',
                    'toolCallId' => (string) ($meta['toolCallId'] ?? ''),
                    'name' => (string) ($meta['name'] ?? ''),
                    'content' => (string) $row['content'],
                ];
            } elseif ($role === 'assistant' && !empty($meta['toolCalls'])) {
                $out[] = [
                    'role' => 'assistant',
                    'content' => (string) $row['content'],
                    'toolCalls' => $meta['toolCalls'],
                ];
            } elseif (in_array($role, ['user', 'assistant'], true)) {
                $out[] = ['role' => $role, 'content' => (string) $row['content']];
            }
        }

        $out[] = ['role' => 'user', 'content' => $newMessage];
        return $out;
    }

    /** @param array<string,mixed> $meta */
    private static function persist(string $conversationId, string $role, string $content, array $meta): void
    {
        Db::run(
            'INSERT INTO messages (conversation_id, role, content, meta, created_at) VALUES (?,?,?,?,?)',
            [$conversationId, $role, $content,
             (string) json_encode($meta, JSON_UNESCAPED_UNICODE), Db::now()]
        );
        Db::run('UPDATE conversations SET updated_at = ? WHERE id = ?', [Db::now(), $conversationId]);
    }

    /** Tool output shown in the transcript; the model still gets the whole thing. */
    private static function preview(string $s, int $max = 2000): string
    {
        return strlen($s) <= $max ? $s : substr($s, 0, $max) . "\n… truncated for display";
    }

    private static function providerError(int $status, string $body): string
    {
        $j = json_decode($body, true);
        $message = is_array($j)
            ? (string) ($j['error']['message'] ?? $j['error'] ?? $j['message'] ?? '')
            : '';
        if ($message === '') {
            $message = trim(substr($body, 0, 300));
        }
        return "The provider answered $status: " . ($message === '' ? '(no detail)' : $message);
    }
}
