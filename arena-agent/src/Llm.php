<?php

/**
 * Provider protocol adapters.
 *
 * Four wire formats are supported behind one interface. Each adapter knows
 * how to build a request, how to pull text out of a complete response, and
 * how to pull text out of one streamed chunk.
 */

declare(strict_types=1);

namespace Arena;

final class Llm
{
    /**
     * Replaces the HTTP call in tests. Signature:
     * fn(string $url, array $headers, string $body, int $timeout): array{0:int,1:string}
     *
     * @var null|callable(string,array<int,string>,string,int):array{0:int,1:string}
     */
    public static $transport = null;

    /** Default endpoints used when a provider does not carry its own. */
    private const DEFAULT_URL = [
        'openai' => 'https://api.openai.com/v1',
        'anthropic' => 'https://api.anthropic.com/v1',
        'gemini' => 'https://generativelanguage.googleapis.com/v1beta',
        'ollama' => 'http://127.0.0.1:11434',
        'mistral' => 'https://api.mistral.ai/v1',
        'azure' => '',
    ];

    /**
     * Build one request.
     *
     * Messages are in this project's neutral shape:
     *   ['role' => 'system'|'user'|'assistant', 'content' => string]
     *   ['role' => 'assistant', 'content' => string, 'toolCalls' => [['id','name','args']]]
     *   ['role' => 'tool', 'toolCallId' => string, 'name' => string, 'content' => string]
     * Each adapter below converts that into whatever its provider expects.
     *
     * @param array<string,mixed> $provider
     * @param array<int,array<string,mixed>> $messages
     * @param array<int,array<string,mixed>> $tools neutral declarations from Tools
     * @return array{url:string,headers:array<int,string>,body:string}
     */
    public static function build(
        array $provider,
        string $model,
        array $messages,
        bool $stream,
        float $temperature = 0.7,
        array $tools = []
    ): array {
        $protocol = (string) $provider['protocol'];
        $base = rtrim((string) ($provider['baseUrl'] ?: self::DEFAULT_URL[$protocol] ?? ''), '/');
        $key = (string) ($provider['apiKey'] ?? '');
        if ($base === '') {
            throw new HttpError(400, "Provider '{$provider['name']}' has no base URL.");
        }

        switch ($protocol) {
            case 'anthropic':
                $system = '';
                $turns = [];
                foreach ($messages as $m) {
                    $role = (string) $m['role'];
                    if ($role === 'system') {
                        $system .= ($system === '' ? '' : "\n\n") . $m['content'];
                        continue;
                    }
                    if ($role === 'tool') {
                        // Anthropic returns tool output as a user turn holding
                        // a tool_result block, not as a role of its own.
                        $turns[] = ['role' => 'user', 'content' => [[
                            'type' => 'tool_result',
                            'tool_use_id' => (string) $m['toolCallId'],
                            'content' => (string) $m['content'],
                        ]]];
                        continue;
                    }
                    if ($role === 'assistant' && !empty($m['toolCalls'])) {
                        $blocks = [];
                        if (trim((string) $m['content']) !== '') {
                            $blocks[] = ['type' => 'text', 'text' => (string) $m['content']];
                        }
                        foreach ($m['toolCalls'] as $call) {
                            $blocks[] = [
                                'type' => 'tool_use',
                                'id' => (string) $call['id'],
                                'name' => (string) $call['name'],
                                'input' => (object) $call['args'],
                            ];
                        }
                        $turns[] = ['role' => 'assistant', 'content' => $blocks];
                        continue;
                    }
                    $turns[] = ['role' => $role === 'assistant' ? 'assistant' : 'user',
                                'content' => (string) $m['content']];
                }
                $payload = ['model' => $model, 'max_tokens' => 4096, 'messages' => $turns,
                            'stream' => $stream, 'temperature' => $temperature];
                if ($system !== '') {
                    $payload['system'] = $system;
                }
                if ($tools !== []) {
                    $payload['tools'] = array_map(static fn(array $t): array => [
                        'name' => $t['name'],
                        'description' => $t['description'],
                        'input_schema' => $t['parameters'],
                    ], $tools);
                }
                return [
                    'url' => $base . '/messages',
                    'headers' => ['content-type: application/json', 'x-api-key: ' . $key,
                                  'anthropic-version: 2023-06-01'],
                    'body' => (string) json_encode($payload),
                ];

            case 'gemini':
                $contents = [];
                $systemText = '';
                foreach ($messages as $m) {
                    $role = (string) $m['role'];
                    if ($role === 'system') {
                        $systemText .= ($systemText === '' ? '' : "\n\n") . $m['content'];
                        continue;
                    }
                    if ($role === 'tool') {
                        $contents[] = ['role' => 'user', 'parts' => [[
                            'functionResponse' => [
                                'name' => (string) $m['name'],
                                'response' => ['result' => (string) $m['content']],
                            ],
                        ]]];
                        continue;
                    }
                    if ($role === 'assistant' && !empty($m['toolCalls'])) {
                        $parts = [];
                        if (trim((string) $m['content']) !== '') {
                            $parts[] = ['text' => (string) $m['content']];
                        }
                        foreach ($m['toolCalls'] as $call) {
                            $parts[] = ['functionCall' => [
                                'name' => (string) $call['name'],
                                'args' => (object) $call['args'],
                            ]];
                        }
                        $contents[] = ['role' => 'model', 'parts' => $parts];
                        continue;
                    }
                    $contents[] = ['role' => $role === 'assistant' ? 'model' : 'user',
                                   'parts' => [['text' => (string) $m['content']]]];
                }
                $payload = ['contents' => $contents,
                            'generationConfig' => ['temperature' => $temperature]];
                if ($systemText !== '') {
                    $payload['systemInstruction'] = ['parts' => [['text' => $systemText]]];
                }
                if ($tools !== []) {
                    $payload['tools'] = [['functionDeclarations' => array_map(
                        static fn(array $t): array => [
                            'name' => $t['name'],
                            'description' => $t['description'],
                            'parameters' => $t['parameters'],
                        ],
                        $tools
                    )]];
                }
                $verb = $stream ? 'streamGenerateContent?alt=sse&key=' : 'generateContent?key=';
                return [
                    'url' => $base . '/models/' . rawurlencode($model) . ':' . $verb . rawurlencode($key),
                    'headers' => ['content-type: application/json'],
                    'body' => (string) json_encode($payload),
                ];

            case 'ollama':
                $payload = [
                    'model' => $model,
                    'messages' => self::openAiMessages($messages, true),
                    'stream' => $stream,
                    'options' => ['temperature' => $temperature],
                ];
                if ($tools !== []) {
                    $payload['tools'] = self::openAiTools($tools);
                    // Ollama does not stream tool calls; asking for both gets
                    // you neither, so the caller gets a complete response.
                    $payload['stream'] = false;
                }
                return [
                    'url' => $base . '/api/chat',
                    'headers' => ['content-type: application/json'],
                    'body' => (string) json_encode($payload),
                ];

            default:   // openai, mistral, azure and every compatible gateway
                $headers = ['content-type: application/json'];
                if ($key !== '') {
                    $headers[] = $protocol === 'azure' ? 'api-key: ' . $key : 'authorization: Bearer ' . $key;
                }
                $url = str_contains($base, '/chat/completions') ? $base : $base . '/chat/completions';
                $payload = [
                    'model' => $model,
                    'messages' => self::openAiMessages($messages, false),
                    'stream' => $stream,
                    'temperature' => $temperature,
                ];
                if ($tools !== []) {
                    $payload['tools'] = self::openAiTools($tools);
                    $payload['tool_choice'] = 'auto';
                }
                return [
                    'url' => $url,
                    'headers' => $headers,
                    'body' => (string) json_encode($payload),
                ];
        }
    }

    /**
     * Neutral messages in the OpenAI chat shape, which Ollama also speaks.
     *
     * The one difference: OpenAI wants tool arguments as a JSON *string*,
     * Ollama wants them as an object. Getting this backwards produces a
     * confusing "invalid arguments" from one and silence from the other.
     *
     * @param array<int,array<string,mixed>> $messages
     * @return array<int,array<string,mixed>>
     */
    private static function openAiMessages(array $messages, bool $argsAsObject): array
    {
        $out = [];
        foreach ($messages as $m) {
            $role = (string) $m['role'];
            if ($role === 'tool') {
                $out[] = [
                    'role' => 'tool',
                    'tool_call_id' => (string) $m['toolCallId'],
                    'name' => (string) $m['name'],
                    'content' => (string) $m['content'],
                ];
                continue;
            }
            if ($role === 'assistant' && !empty($m['toolCalls'])) {
                $calls = [];
                foreach ($m['toolCalls'] as $call) {
                    $calls[] = [
                        'id' => (string) $call['id'],
                        'type' => 'function',
                        'function' => [
                            'name' => (string) $call['name'],
                            'arguments' => $argsAsObject
                                ? (object) $call['args']
                                : (string) json_encode((object) $call['args']),
                        ],
                    ];
                }
                $out[] = ['role' => 'assistant', 'content' => (string) $m['content'], 'tool_calls' => $calls];
                continue;
            }
            $out[] = ['role' => $role, 'content' => (string) $m['content']];
        }
        return $out;
    }

    /**
     * @param array<int,array<string,mixed>> $tools
     * @return array<int,array<string,mixed>>
     */
    private static function openAiTools(array $tools): array
    {
        return array_map(static fn(array $t): array => [
            'type' => 'function',
            'function' => [
                'name' => $t['name'],
                'description' => $t['description'],
                'parameters' => $t['parameters'],
            ],
        ], $tools);
    }

    /**
     * Pull both the text and any tool calls out of a complete response.
     *
     * @return array{text:string,toolCalls:array<int,array{id:string,name:string,args:array<string,mixed>}>,finish:string}
     */
    public static function parseReply(string $protocol, string $body): array
    {
        $j = json_decode($body, true);
        if (!is_array($j)) {
            throw new HttpError(502, 'The provider sent a reply that is not JSON.');
        }
        if (isset($j['error'])) {
            $msg = is_array($j['error']) ? ($j['error']['message'] ?? json_encode($j['error'])) : $j['error'];
            throw new HttpError(502, 'Provider error: ' . (string) $msg);
        }

        $text = '';
        $calls = [];
        $finish = '';

        switch ($protocol) {
            case 'anthropic':
                $finish = (string) ($j['stop_reason'] ?? '');
                foreach ($j['content'] ?? [] as $block) {
                    if (($block['type'] ?? '') === 'text') {
                        $text .= (string) $block['text'];
                    } elseif (($block['type'] ?? '') === 'tool_use') {
                        $calls[] = [
                            'id' => (string) ($block['id'] ?? Db::uid('call')),
                            'name' => (string) ($block['name'] ?? ''),
                            'args' => is_array($block['input'] ?? null) ? $block['input'] : [],
                        ];
                    }
                }
                break;

            case 'gemini':
                $candidate = $j['candidates'][0] ?? [];
                $finish = (string) ($candidate['finishReason'] ?? '');
                foreach ($candidate['content']['parts'] ?? [] as $part) {
                    if (isset($part['text'])) {
                        $text .= (string) $part['text'];
                    }
                    if (isset($part['functionCall'])) {
                        $calls[] = [
                            // Gemini does not issue call ids, so make one that
                            // is stable for the length of this exchange.
                            'id' => 'call_' . count($calls) . '_' . (string) ($part['functionCall']['name'] ?? ''),
                            'name' => (string) ($part['functionCall']['name'] ?? ''),
                            'args' => is_array($part['functionCall']['args'] ?? null)
                                ? $part['functionCall']['args'] : [],
                        ];
                    }
                }
                break;

            case 'ollama':
                $message = $j['message'] ?? [];
                $finish = (string) ($j['done_reason'] ?? '');
                $text = (string) ($message['content'] ?? '');
                foreach ($message['tool_calls'] ?? [] as $i => $call) {
                    $args = $call['function']['arguments'] ?? [];
                    $calls[] = [
                        'id' => (string) ($call['id'] ?? 'call_' . $i),
                        'name' => (string) ($call['function']['name'] ?? ''),
                        'args' => self::decodeArgs($args),
                    ];
                }
                break;

            default:
                $choice = $j['choices'][0] ?? [];
                $finish = (string) ($choice['finish_reason'] ?? '');
                $text = (string) ($choice['message']['content'] ?? '');
                foreach ($choice['message']['tool_calls'] ?? [] as $i => $call) {
                    $calls[] = [
                        'id' => (string) ($call['id'] ?? 'call_' . $i),
                        'name' => (string) ($call['function']['name'] ?? ''),
                        'args' => self::decodeArgs($call['function']['arguments'] ?? []),
                    ];
                }
        }

        return ['text' => $text, 'toolCalls' => $calls, 'finish' => $finish];
    }

    /**
     * Tool arguments arrive as an object from some providers and as a JSON
     * string from others — and occasionally as a string of "{}" or "".
     *
     * @return array<string,mixed>
     */
    private static function decodeArgs(mixed $args): array
    {
        if (is_array($args)) {
            return $args;
        }
        if (is_string($args) && trim($args) !== '') {
            $decoded = json_decode($args, true);
            if (is_array($decoded)) {
                return $decoded;
            }
        }
        return [];
    }

    /** Extract the assistant text from one streamed data line. */
    public static function chunkText(string $protocol, string $data): string
    {
        $j = json_decode($data, true);
        if (!is_array($j)) {
            return '';
        }
        return match ($protocol) {
            'anthropic' => (string) ($j['delta']['text'] ?? ''),
            'gemini' => (string) ($j['candidates'][0]['content']['parts'][0]['text'] ?? ''),
            'ollama' => (string) ($j['message']['content'] ?? ''),
            default => (string) ($j['choices'][0]['delta']['content'] ?? ''),
        };
    }

    /** Extract the assistant text from a complete, non-streamed response. */
    public static function replyText(string $protocol, string $body): string
    {
        $j = json_decode($body, true);
        if (!is_array($j)) {
            return '';
        }
        if (isset($j['error'])) {
            $msg = is_array($j['error']) ? ($j['error']['message'] ?? json_encode($j['error'])) : $j['error'];
            throw new HttpError(502, 'Provider error: ' . (string) $msg);
        }
        return match ($protocol) {
            'anthropic' => (string) ($j['content'][0]['text'] ?? ''),
            'gemini' => (string) ($j['candidates'][0]['content']['parts'][0]['text'] ?? ''),
            'ollama' => (string) ($j['message']['content'] ?? ''),
            default => (string) ($j['choices'][0]['message']['content'] ?? ''),
        };
    }

    /**
     * Blocking request. Returns [status, body].
     *
     * @param array<int,string> $headers
     * @return array{0:int,1:string}
     */
    public static function send(string $url, array $headers, string $body, int $timeout = 120): array
    {
        // A seam, not a feature: the test suite substitutes a transport so the
        // whole agent loop can be exercised without a provider or a network.
        // Nothing in the application ever sets this.
        if (self::$transport !== null) {
            return (self::$transport)($url, $headers, $body, $timeout);
        }

        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => $body,
                CURLOPT_HTTPHEADER => $headers,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => $timeout,
                CURLOPT_CONNECTTIMEOUT => 15,
                CURLOPT_FOLLOWLOCATION => true,
            ]);
            $out = curl_exec($ch);
            if ($out === false) {
                $err = curl_error($ch);
                curl_close($ch);
                throw new HttpError(502, 'Could not reach the provider: ' . $err);
            }
            $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            curl_close($ch);
            return [$status, (string) $out];
        }

        $ctx = stream_context_create(['http' => [
            'method' => 'POST', 'header' => implode("\r\n", $headers), 'content' => $body,
            'timeout' => $timeout, 'ignore_errors' => true,
        ]]);
        $out = @file_get_contents($url, false, $ctx);
        if ($out === false) {
            throw new HttpError(502, 'Could not reach the provider (allow_url_fopen and cURL are both unavailable).');
        }
        $status = 200;
        foreach ($http_response_header ?? [] as $h) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) {
                $status = (int) $m[1];
            }
        }
        return [$status, (string) $out];
    }

    /**
     * Streaming request. $onText receives decoded assistant text as it lands.
     *
     * @param array<int,string> $headers
     */
    public static function stream(string $protocol, string $url, array $headers, string $body, callable $onText): void
    {
        if (!function_exists('curl_init')) {
            // No cURL: fall back to one blocking call and emit it in one go.
            [$status, $out] = self::send($url, $headers, $body);
            if ($status >= 400) {
                throw new HttpError(502, 'Provider returned HTTP ' . $status . ': ' . substr($out, 0, 400));
            }
            $onText(self::replyText($protocol, $out));
            return;
        }

        $buffer = '';
        $errorBody = '';
        $status = 0;
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_TIMEOUT => 0,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_HEADERFUNCTION => static function ($_ch, string $line) use (&$status): int {
                if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m)) {
                    $status = (int) $m[1];
                }
                return strlen($line);
            },
            CURLOPT_WRITEFUNCTION => static function ($_ch, string $chunk) use (
                &$buffer, &$errorBody, &$status, $protocol, $onText
            ): int {
                if ($status >= 400) {
                    $errorBody .= $chunk;
                    return strlen($chunk);
                }
                $buffer .= $chunk;
                // Ollama streams bare JSON objects, one per line; the rest use SSE.
                $sep = $protocol === 'ollama' ? "\n" : "\n";
                while (($pos = strpos($buffer, $sep)) !== false) {
                    $line = rtrim(substr($buffer, 0, $pos), "\r");
                    $buffer = substr($buffer, $pos + 1);
                    if ($line === '') {
                        continue;
                    }
                    if ($protocol !== 'ollama') {
                        if (!str_starts_with($line, 'data:')) {
                            continue;
                        }
                        $line = trim(substr($line, 5));
                        if ($line === '' || $line === '[DONE]') {
                            continue;
                        }
                    }
                    $text = self::chunkText($protocol, $line);
                    if ($text !== '') {
                        $onText($text);
                    }
                }
                return strlen($chunk);
            },
        ]);
        $ok = curl_exec($ch);
        $err = curl_error($ch);
        curl_close($ch);

        if ($status >= 400) {
            $detail = trim($errorBody);
            $j = json_decode($detail, true);
            if (is_array($j)) {
                $detail = (string) ($j['error']['message'] ?? $j['error'] ?? $j['message'] ?? $detail);
            }
            throw new HttpError(502, "Provider returned HTTP {$status}: " . substr($detail, 0, 500));
        }
        if ($ok === false && $err !== '') {
            throw new HttpError(502, 'Stream interrupted: ' . $err);
        }
    }

    /** Ask a provider for its model list. @return array<int,array<string,mixed>> */
    public static function discover(array $provider): array
    {
        $protocol = (string) $provider['protocol'];
        $base = rtrim((string) ($provider['baseUrl'] ?: self::DEFAULT_URL[$protocol] ?? ''), '/');
        $key = (string) ($provider['apiKey'] ?? '');
        if ($base === '') {
            throw new HttpError(400, 'This provider has no base URL to query.');
        }

        [$url, $headers] = match ($protocol) {
            'anthropic' => [$base . '/models', ['x-api-key: ' . $key, 'anthropic-version: 2023-06-01']],
            'gemini' => [$base . '/models?key=' . rawurlencode($key), []],
            'ollama' => [$base . '/api/tags', []],
            default => [$base . '/models', $key === '' ? [] : ['authorization: Bearer ' . $key]],
        };

        $body = self::get($url, $headers);
        $j = json_decode($body, true);
        if (!is_array($j)) {
            throw new HttpError(502, 'The provider did not return a model list.');
        }
        $raw = $j['data'] ?? $j['models'] ?? $j['data']['models'] ?? [];
        $out = [];
        foreach (is_array($raw) ? $raw : [] as $m) {
            if (is_string($m)) {
                $out[] = ['id' => $m];
                continue;
            }
            if (!is_array($m)) {
                continue;
            }
            $id = (string) ($m['id'] ?? $m['name'] ?? $m['model'] ?? '');
            if ($id === '') {
                continue;
            }
            if ($protocol === 'gemini') {
                $id = preg_replace('#^models/#', '', $id) ?? $id;
            }
            $out[] = ['id' => $id, 'name' => (string) ($m['display_name'] ?? $m['name'] ?? $id)];
        }
        return $out;
    }

    /** @param array<int,string> $headers */
    private static function get(string $url, array $headers, int $timeout = 30): string
    {
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_HTTPHEADER => $headers,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => $timeout,
                CURLOPT_CONNECTTIMEOUT => 10,
                CURLOPT_FOLLOWLOCATION => true,
            ]);
            $out = curl_exec($ch);
            $err = curl_error($ch);
            curl_close($ch);
            if ($out === false) {
                throw new HttpError(502, 'Could not reach the provider: ' . $err);
            }
            return (string) $out;
        }
        $ctx = stream_context_create(['http' => [
            'method' => 'GET', 'header' => implode("\r\n", $headers),
            'timeout' => $timeout, 'ignore_errors' => true,
        ]]);
        $out = @file_get_contents($url, false, $ctx);
        if ($out === false) {
            throw new HttpError(502, 'Could not reach the provider.');
        }
        return (string) $out;
    }
}
