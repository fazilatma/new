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
     * @param array<string,mixed> $provider
     * @param array<int,array{role:string,content:string}> $messages
     * @return array{url:string,headers:array<int,string>,body:string}
     */
    public static function build(array $provider, string $model, array $messages, bool $stream, float $temperature = 0.7): array
    {
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
                    if ($m['role'] === 'system') {
                        $system .= ($system === '' ? '' : "\n\n") . $m['content'];
                    } else {
                        $turns[] = ['role' => $m['role'] === 'assistant' ? 'assistant' : 'user',
                                    'content' => $m['content']];
                    }
                }
                $payload = ['model' => $model, 'max_tokens' => 4096, 'messages' => $turns,
                            'stream' => $stream, 'temperature' => $temperature];
                if ($system !== '') {
                    $payload['system'] = $system;
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
                    if ($m['role'] === 'system') {
                        $systemText .= ($systemText === '' ? '' : "\n\n") . $m['content'];
                        continue;
                    }
                    $contents[] = ['role' => $m['role'] === 'assistant' ? 'model' : 'user',
                                   'parts' => [['text' => $m['content']]]];
                }
                $payload = ['contents' => $contents,
                            'generationConfig' => ['temperature' => $temperature]];
                if ($systemText !== '') {
                    $payload['systemInstruction'] = ['parts' => [['text' => $systemText]]];
                }
                $verb = $stream ? 'streamGenerateContent?alt=sse&key=' : 'generateContent?key=';
                return [
                    'url' => $base . '/models/' . rawurlencode($model) . ':' . $verb . rawurlencode($key),
                    'headers' => ['content-type: application/json'],
                    'body' => (string) json_encode($payload),
                ];

            case 'ollama':
                return [
                    'url' => $base . '/api/chat',
                    'headers' => ['content-type: application/json'],
                    'body' => (string) json_encode([
                        'model' => $model, 'messages' => $messages, 'stream' => $stream,
                        'options' => ['temperature' => $temperature],
                    ]),
                ];

            default:   // openai, mistral, azure and every compatible gateway
                $headers = ['content-type: application/json'];
                if ($key !== '') {
                    $headers[] = $protocol === 'azure' ? 'api-key: ' . $key : 'authorization: Bearer ' . $key;
                }
                $url = str_contains($base, '/chat/completions') ? $base : $base . '/chat/completions';
                return [
                    'url' => $url,
                    'headers' => $headers,
                    'body' => (string) json_encode([
                        'model' => $model, 'messages' => $messages,
                        'stream' => $stream, 'temperature' => $temperature,
                    ]),
                ];
        }
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
