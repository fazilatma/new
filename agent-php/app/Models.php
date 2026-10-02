<?php
/**
 * Provider/model health tests and the proxy probe.
 * Port of the `/api/providers/{pid}/models/{mid}/test`, `/api/providers/test-all`
 * and `/api/config/test-proxy` engines from agent-python/app/main.py.
 *
 * The full diagnostic payload shape is preserved verbatim because the SPA
 * renders every field of it. Unlike the Workers build, a real forward proxy is
 * actually used when one is configured, and `localhost` providers (Ollama,
 * LM Studio, vLLM…) are reachable.
 */

declare(strict_types=1);

namespace Arena;

final class Models
{
    public const TEST_PROMPT = 'Reply with the single word: OK';

    public static function maskHeaders(array $headers): array
    {
        $out = [];
        foreach ($headers as $k => $v) {
            $lk = strtolower((string) $k);
            if (in_array($lk, ['authorization', 'x-api-key', 'api-key'], true)) {
                $raw = (string) preg_replace('/^Bearer\s+/i', '', (string) $v);
                $out[$k] = strlen($raw) <= 8
                    ? '••••••••'
                    : ($lk === 'authorization' ? 'Bearer ' : '') . substr($raw, 0, 3) . '••••••••' . substr($raw, -4);
            } else {
                $out[$k] = $v;
            }
        }
        return $out;
    }

    public static function nowIso(): string
    {
        return gmdate('Y-m-d\TH:i:s.000\Z');
    }

    /** @return array{url:string, headers:array, body:array} */
    public static function buildTestRequest(array $provider, array $model, string $apiKey): array
    {
        $base = rtrim((string) $provider['url'], '/');
        $headers = ['Content-Type' => 'application/json'];

        if ($provider['protocol'] === 'anthropic') {
            $headers['x-api-key'] = $apiKey;
            $headers['anthropic-version'] = '2023-06-01';
            return [
                'url' => str_ends_with($base, '/messages') ? $base : $base . '/v1/messages',
                'headers' => $headers,
                'body' => [
                    'model' => $model['id'],
                    'max_tokens' => 16,
                    'messages' => [['role' => 'user', 'content' => self::TEST_PROMPT]],
                ],
            ];
        }

        if ($provider['protocol'] === 'ollama') {
            return [
                'url' => str_ends_with($base, '/chat') ? $base : $base . '/api/chat',
                'headers' => $headers,
                'body' => [
                    'model' => $model['id'],
                    'messages' => [['role' => 'user', 'content' => self::TEST_PROMPT]],
                    'stream' => false,
                ],
            ];
        }

        if ($provider['protocol'] === 'gemini') {
            return [
                'url' => ($base !== '' ? $base : 'https://generativelanguage.googleapis.com/v1beta')
                    . '/models/' . $model['id'] . ':generateContent?key=' . rawurlencode($apiKey),
                'headers' => $headers,
                'body' => [
                    'contents' => [['role' => 'user', 'parts' => [['text' => self::TEST_PROMPT]]]],
                    'generationConfig' => ['maxOutputTokens' => 16],
                ],
            ];
        }

        if ($provider['protocol'] === 'cloudflare' || $provider['protocol'] === 'workers-ai') {
            if ($apiKey !== '') {
                $headers['Authorization'] = 'Bearer ' . $apiKey;
            }
            // Native REST API: model is a path segment, never a body field.
            // Strip any `/ai/run/...` or `/ai/v1...` suffix already present
            // on the configured base URL so the account root is recombined
            // with the model actually under test, instead of silently
            // reusing whatever model happened to be baked into the URL.
            $accountRoot = rtrim((string) preg_replace('#/ai/(run|v1)(/.*)?$#', '', $base), '/');
            $url = ($accountRoot !== '' ? $accountRoot : 'https://api.cloudflare.com/client/v4') . '/ai/run/' . $model['id'];
            return [
                'url' => $url,
                'headers' => $headers,
                'body' => ['messages' => [['role' => 'user', 'content' => self::TEST_PROMPT]]],
            ];
        }

        if ($provider['protocol'] === 'azure') {
            $headers['api-key'] = $apiKey;
        } elseif ($apiKey !== '') {
            $headers['Authorization'] = 'Bearer ' . $apiKey;
        }

        return [
            'url' => str_ends_with($base, '/chat/completions') ? $base : $base . '/chat/completions',
            'headers' => $headers,
            'body' => [
                'model' => $model['id'],
                'messages' => [['role' => 'user', 'content' => self::TEST_PROMPT]],
                'max_tokens' => 16,
                'temperature' => 0,
            ],
        ];
    }

    /** @return array{text:string, reasoning:string} */
    public static function renderText(string $protocol, mixed $data): array
    {
        if (!is_array($data)) {
            return ['text' => '', 'reasoning' => ''];
        }
        if ($protocol === 'anthropic') {
            $text = '';
            $reasoning = '';
            foreach ((array) ($data['content'] ?? []) as $b) {
                if (($b['type'] ?? '') === 'text') {
                    $text .= (string) ($b['text'] ?? '');
                } elseif (($b['type'] ?? '') === 'thinking') {
                    $reasoning .= (string) ($b['thinking'] ?? '');
                }
            }
            return ['text' => $text, 'reasoning' => $reasoning];
        }
        if ($protocol === 'ollama') {
            return ['text' => (string) ($data['message']['content'] ?? ''), 'reasoning' => ''];
        }
        if ($protocol === 'cloudflare' || $protocol === 'workers-ai') {
            $result = $data['result'] ?? null;
            $text = is_string($result) ? $result : (string) ($result['response'] ?? '');
            return ['text' => $text, 'reasoning' => ''];
        }
        if ($protocol === 'gemini') {
            $text = '';
            foreach ((array) ($data['candidates'][0]['content']['parts'] ?? []) as $part) {
                $text .= (string) ($part['text'] ?? '');
            }
            return ['text' => $text, 'reasoning' => ''];
        }
        $msg = $data['choices'][0]['message'] ?? [];
        return [
            'text' => (string) ($msg['content'] ?? ''),
            'reasoning' => (string) ($msg['reasoning_content'] ?? $msg['reasoning'] ?? $msg['thought'] ?? ''),
        ];
    }

    public static function testProviderModel(ProviderStore $store, array $provider, array $model, float $readTimeoutSec = 15.0): array
    {
        $apiKey = $store->apiKey($provider);
        ['url' => $directEndpoint, 'headers' => $headers, 'body' => $body] =
            self::buildTestRequest($provider, $model, $apiKey);

        $isLocal = $provider['protocol'] === 'ollama'
            || str_contains($directEndpoint, '127.0.0.1')
            || str_contains($directEndpoint, 'localhost');

        $proxy = $isLocal
            ? ['effectiveUrl' => $directEndpoint, 'proxyClient' => null]
            : Config::proxyConfig($directEndpoint, $provider['proxyUrl'] ?: null);

        $proxyMode = $isLocal
            ? 'Direct (Local / Ollama)'
            : ($proxy['proxyClient']
                ? "Forward proxy '{$proxy['proxyClient']}' (cURL CURLOPT_PROXY)"
                : ($proxy['effectiveUrl'] !== $directEndpoint ? 'Gateway Proxy (URL rewrite)' : 'Direct'));

        $base = [
            'provider' => $provider['id'],
            'providerName' => $provider['name'],
            'model' => $model['id'],
            'modelName' => $model['name'],
            'protocol' => $provider['protocol'],
            'request' => [
                'method' => 'POST',
                'directEndpoint' => $directEndpoint,
                'effectiveEndpoint' => $proxy['effectiveUrl'],
                'proxyClient' => $proxy['proxyClient'],
                'isProxyActive' => $proxy['effectiveUrl'] !== $directEndpoint || (bool) $proxy['proxyClient'],
                'proxyMode' => $proxyMode,
                'headers' => self::maskHeaders($headers),
                'body' => $body,
            ],
            'timestamp' => self::nowIso(),
        ];

        if ($apiKey === '' && !in_array($provider['protocol'], ['ollama', 'workers-ai'], true)) {
            $envName = $provider['apiKeyEnv'] ?: strtoupper((string) $provider['id']) . '_API_KEY';
            return array_merge($base, [
                'ok' => false,
                'latencyMs' => 0,
                'error' => "No API key configured for provider '{$provider['name']}'.",
                'message' => 'Missing API key',
                'response' => [
                    'statusCode' => 401,
                    'renderedText' => '',
                    'reasoningContent' => '',
                    'rawJson' => null,
                    'rawError' => "Set it in Settings, or add {$envName}=… to the .env file.",
                ],
            ]);
        }

        $started = microtime(true);
        $attempts = [$proxy['effectiveUrl']];
        if ($proxy['effectiveUrl'] !== $directEndpoint) {
            $attempts[] = $directEndpoint;
        }

        $lastError = '';
        $lastStatus = 0;

        foreach ($attempts as $url) {
            $resp = HttpClient::postJson($url, $body, $headers, (int) ceil($readTimeoutSec), $proxy['proxyClient']);
            $latencyMs = (int) round((microtime(true) - $started) * 1000);
            $lastStatus = $resp['status'];
            $data = $resp['json'];

            if ($resp['ok']) {
                ['text' => $rendered, 'reasoning' => $reasoning] = self::renderText((string) $provider['protocol'], $data);
                $store->recordMetric((string) $provider['id'], (string) $model['id'], (float) $latencyMs, false);
                return array_merge($base, [
                    'ok' => true,
                    'latencyMs' => $latencyMs,
                    'message' => $rendered !== '' ? substr(trim($rendered), 0, 200) : 'Empty response body',
                    'response' => [
                        'statusCode' => $resp['status'],
                        'renderedText' => $rendered,
                        'reasoningContent' => $reasoning,
                        'rawJson' => $data,
                        'rawError' => null,
                    ],
                ]);
            }

            if (is_array($data)) {
                $err = $data['error']['message'] ?? $data['error'] ?? $data['message'] ?? null;
                $lastError = is_string($err) ? $err : substr((string) json_encode($err ?? $data), 0, 800);
            } else {
                $lastError = $resp['error'] ?? substr($resp['body'], 0, 800);
            }
        }

        $latencyMs = (int) round((microtime(true) - $started) * 1000);
        $store->recordMetric((string) $provider['id'], (string) $model['id'], (float) $latencyMs, true);
        return array_merge($base, [
            'ok' => false,
            'latencyMs' => $latencyMs,
            'error' => $lastError !== '' ? $lastError : 'Request failed',
            'message' => $lastError !== '' ? substr($lastError, 0, 200) : 'Request failed',
            'response' => [
                'statusCode' => $lastStatus,
                'renderedText' => '',
                'reasoningContent' => '',
                'rawJson' => null,
                'rawError' => $lastError,
            ],
        ]);
    }

    /**
     * Port of `/api/providers/test-all`. PHP has no event loop, so parallelism
     * comes from curl_multi: every enabled model is probed concurrently.
     */
    public static function testAllModels(ProviderStore $store, int $concurrency = 15, float $timeoutSec = 8.0): array
    {
        $tasks = [];
        foreach ($store->data as $p) {
            if (!$p['enabled']) {
                continue;
            }
            foreach ($p['models'] as $m) {
                $tasks[] = ['provider' => $p, 'model' => $m];
            }
        }
        if (!$tasks) {
            return [];
        }
        if (!function_exists('curl_multi_init')) {
            return array_map(
                fn(array $t): array => self::testProviderModel($store, $t['provider'], $t['model'], $timeoutSec),
                $tasks
            );
        }

        $results = [];
        foreach (array_chunk($tasks, max(1, $concurrency), true) as $chunk) {
            $multi = curl_multi_init();
            $handles = [];
            $meta = [];

            foreach ($chunk as $i => $task) {
                $provider = $task['provider'];
                $model = $task['model'];
                $apiKey = $store->apiKey($provider);
                ['url' => $direct, 'headers' => $headers, 'body' => $body] = self::buildTestRequest($provider, $model, $apiKey);

                $isLocal = $provider['protocol'] === 'ollama'
                    || str_contains($direct, '127.0.0.1') || str_contains($direct, 'localhost');
                $proxy = $isLocal
                    ? ['effectiveUrl' => $direct, 'proxyClient' => null]
                    : Config::proxyConfig($direct, $provider['proxyUrl'] ?: null);

                $meta[$i] = compact('provider', 'model', 'apiKey', 'direct', 'headers', 'body', 'proxy', 'isLocal');
                $meta[$i]['started'] = microtime(true);

                if ($apiKey === '' && !in_array($provider['protocol'], ['ollama', 'workers-ai'], true)) {
                    $results[$i] = self::testProviderModel($store, $provider, $model, $timeoutSec);
                    continue;
                }

                $ch = curl_init();
                curl_setopt_array($ch, [
                    CURLOPT_URL => $proxy['effectiveUrl'],
                    CURLOPT_POST => true,
                    CURLOPT_POSTFIELDS => json_encode($body, JSON_UNESCAPED_UNICODE),
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_HTTPHEADER => array_map(
                        static fn($k, $v): string => "$k: $v",
                        array_keys($headers),
                        array_values($headers)
                    ),
                    CURLOPT_TIMEOUT => (int) ceil($timeoutSec),
                    CURLOPT_CONNECTTIMEOUT => (int) ceil(min(5, $timeoutSec)),
                    CURLOPT_FOLLOWLOCATION => true,
                ]);
                if ($proxy['proxyClient']) {
                    curl_setopt($ch, CURLOPT_PROXY, $proxy['proxyClient']);
                }
                $handles[$i] = $ch;
                curl_multi_add_handle($multi, $ch);
            }

            $running = null;
            do {
                curl_multi_exec($multi, $running);
                if ($running > 0) {
                    curl_multi_select($multi, 0.2);
                }
            } while ($running > 0);

            foreach ($handles as $i => $ch) {
                $m = $meta[$i];
                $bodyText = (string) curl_multi_getcontent($ch);
                $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
                $errno = curl_errno($ch);
                $error = $errno !== 0 ? curl_error($ch) : null;
                $latencyMs = (int) round((microtime(true) - $m['started']) * 1000);
                curl_multi_remove_handle($multi, $ch);
                curl_close($ch);

                $data = json_decode($bodyText, true);
                $proxyMode = $m['isLocal']
                    ? 'Direct (Local / Ollama)'
                    : ($m['proxy']['proxyClient']
                        ? "Forward proxy '{$m['proxy']['proxyClient']}' (cURL CURLOPT_PROXY)"
                        : ($m['proxy']['effectiveUrl'] !== $m['direct'] ? 'Gateway Proxy (URL rewrite)' : 'Direct'));

                $base = [
                    'provider' => $m['provider']['id'],
                    'providerName' => $m['provider']['name'],
                    'model' => $m['model']['id'],
                    'modelName' => $m['model']['name'],
                    'protocol' => $m['provider']['protocol'],
                    'request' => [
                        'method' => 'POST',
                        'directEndpoint' => $m['direct'],
                        'effectiveEndpoint' => $m['proxy']['effectiveUrl'],
                        'proxyClient' => $m['proxy']['proxyClient'],
                        'isProxyActive' => $m['proxy']['effectiveUrl'] !== $m['direct'] || (bool) $m['proxy']['proxyClient'],
                        'proxyMode' => $proxyMode,
                        'headers' => self::maskHeaders($m['headers']),
                        'body' => $m['body'],
                    ],
                    'timestamp' => self::nowIso(),
                    'latencyMs' => $latencyMs,
                ];

                $ok = $error === null && $status >= 200 && $status < 300;
                $store->recordMetric((string) $m['provider']['id'], (string) $m['model']['id'], (float) $latencyMs, !$ok);

                if ($ok) {
                    ['text' => $rendered, 'reasoning' => $reasoning] = self::renderText((string) $m['provider']['protocol'], $data);
                    $results[$i] = array_merge($base, [
                        'ok' => true,
                        'message' => $rendered !== '' ? substr(trim($rendered), 0, 200) : 'Empty response body',
                        'response' => [
                            'statusCode' => $status,
                            'renderedText' => $rendered,
                            'reasoningContent' => $reasoning,
                            'rawJson' => $data,
                            'rawError' => null,
                        ],
                    ]);
                } else {
                    $errText = $error;
                    if ($errText === null && is_array($data)) {
                        $e = $data['error']['message'] ?? $data['error'] ?? $data['message'] ?? null;
                        $errText = is_string($e) ? $e : substr((string) json_encode($e ?? $data), 0, 800);
                    }
                    $errText ??= substr($bodyText, 0, 800);
                    $results[$i] = array_merge($base, [
                        'ok' => false,
                        'error' => $errText !== '' ? $errText : 'Request failed',
                        'message' => $errText !== '' ? substr($errText, 0, 200) : 'Request failed',
                        'response' => [
                            'statusCode' => $status,
                            'renderedText' => '',
                            'reasoningContent' => '',
                            'rawJson' => null,
                            'rawError' => $errText,
                        ],
                    ]);
                }
            }
            curl_multi_close($multi);
        }

        ksort($results);
        return array_values($results);
    }

    /** Port of `/api/config/test-proxy`. */
    public static function testProxy(?string $proxyUrl = null, string $targetUrl = 'https://httpbin.org/get'): array
    {
        $target = $targetUrl !== '' ? $targetUrl : 'https://httpbin.org/get';
        $cfg = ($proxyUrl !== null && $proxyUrl !== '')
            ? Config::parseProxySetting($proxyUrl, $target)
            : Config::proxyConfig($target);

        $r = HttpClient::request('GET', $cfg['effectiveUrl'], ['User-Agent' => 'Arena-Agent-PHP/1.0'], null, 15, $cfg['proxyClient']);
        $latency = (int) round($r['latencyMs']);

        $out = [
            'ok' => $r['ok'],
            'status_code' => $r['status'],
            'latency_ms' => $latency,
            'proxy_url' => $proxyUrl ?? Config::raw('AGENT_PROXY_URL', ''),
            'effective_url' => $cfg['effectiveUrl'],
            'proxy_client' => $cfg['proxyClient'],
            'message' => $r['ok']
                ? "Proxy reachable (HTTP {$r['status']}) in {$latency}ms"
                : ($r['error'] !== null ? 'Proxy connectivity test failed' : "Proxy responded with HTTP {$r['status']}"),
        ];
        if ($r['error'] !== null) {
            $out['error'] = $r['error'];
        }
        return $out;
    }
}
