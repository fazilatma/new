<?php
/**
 * Provider catalog, API key rotation and the circuit breaker.
 * Port of agent-python/app/providers.py.
 *
 * The catalog lives in `data/providers.json` again (the Workers build had to
 * keep it in KV). The circuit-breaker state is persisted in `app_state` so it
 * survives across PHP processes — on Workers it was only per-isolate.
 */

declare(strict_types=1);

namespace Arena;

final class CircuitBreaker
{
    public function __construct(
        public int $failureThreshold = 5,
        public int $recoveryTimeout = 60
    ) {
    }

    private function load(): array
    {
        $state = Database::stateJson('circuit_breaker', []);
        return is_array($state) ? $state : [];
    }

    private function store(array $state): void
    {
        Database::setStateJson('circuit_breaker', $state);
    }

    public function isTripped(string $providerId): bool
    {
        $state = $this->load();
        $entry = $state[$providerId] ?? null;
        if (!$entry) {
            return false;
        }
        $failures = (int) ($entry['failures'] ?? 0);
        $last = (float) ($entry['last'] ?? 0);
        if ($failures >= $this->failureThreshold) {
            return (microtime(true) - $last) <= $this->recoveryTimeout;
        }
        return false;
    }

    public function recordSuccess(string $providerId): void
    {
        $state = $this->load();
        $state[$providerId] = ['failures' => 0, 'last' => microtime(true)];
        $this->store($state);
    }

    public function recordFailure(string $providerId): void
    {
        $state = $this->load();
        $failures = (int) ($state[$providerId]['failures'] ?? 0) + 1;
        $state[$providerId] = ['failures' => $failures, 'last' => microtime(true)];
        $this->store($state);
    }

    public function reset(string $providerId = ''): void
    {
        if ($providerId === '') {
            $this->store([]);
            return;
        }
        $state = $this->load();
        unset($state[$providerId]);
        $this->store($state);
    }
}

final class ProviderStore
{
    /** @var array<string, array> */
    public array $data = [];
    private static ?self $instance = null;
    private static ?CircuitBreaker $breaker = null;

    public static function breaker(): CircuitBreaker
    {
        return self::$breaker ??= new CircuitBreaker();
    }

    public static function file(): string
    {
        $custom = Config::raw('PROVIDERS_FILE', '');
        if ($custom !== '' && is_file($custom)) {
            return $custom;
        }
        return Bootstrap::$dataDir . '/providers.json';
    }

    public static function load(): self
    {
        if (self::$instance !== null) {
            return self::$instance;
        }
        $store = new self();
        $raw = [];
        $file = self::file();
        if (is_file($file)) {
            $decoded = json_decode((string) file_get_contents($file), true);
            if (is_array($decoded)) {
                $raw = $decoded;
            }
        }
        foreach ($raw as $key => $value) {
            if (!is_array($value)) {
                continue;
            }
            try {
                $p = self::normalizeProvider($value, (string) $key);
                $store->data[$p['id']] = $p;
            } catch (\Throwable) {
                // skip malformed entries (same as a pydantic validation failure)
            }
        }
        self::$instance = $store;
        return $store;
    }

    public static function reload(): self
    {
        self::$instance = null;
        return self::load();
    }

    // -------------------------------------------------------- normalising

    /** Keys the agent understands on a model record; everything else is kept in `extra`. */
    private const MODEL_KEYS = [
        'id', 'name', 'toolCalling', 'vision', 'free', 'maxInputTokens', 'maxOutputTokens',
        'enabled', 'inputCostPer1M', 'outputCostPer1M', 'extra',
    ];

    public static function normalizeModel(array|string $raw): array
    {
        if (is_string($raw)) {
            $raw = ['id' => $raw];
        }

        // Foreign catalogs carry per-model bookkeeping (tested / available /
        // testDetails / nonChat / rateLimited / …). Dropping it would silently
        // destroy the user's data on the first save, so it is parked in
        // `extra` and re-exported verbatim.
        $extra = (array) ($raw['extra'] ?? []);
        foreach ($raw as $k => $v) {
            if (!in_array((string) $k, self::MODEL_KEYS, true)) {
                $extra[(string) $k] = $v;
            }
        }

        $id = trim((string) ($raw['id'] ?? $raw['model'] ?? $raw['model_id'] ?? $raw['modelId'] ?? $raw['slug'] ?? $raw['name'] ?? ''));
        $name = trim((string) ($raw['name'] ?? $raw['title'] ?? $raw['label'] ?? $raw['display_name'] ?? $raw['displayName'] ?? $id));
        if ($name === '') {
            $name = $id;
        }
        if ($id === '' && $name !== '') {
            $id = $name;
        }
        $enabled = !array_key_exists('enabled', $raw) || (bool) $raw['enabled'];
        // A model the source catalog marked as "not a chat model" must not end
        // up in the chat picker.
        if (!empty($raw['nonChat'])) {
            $enabled = false;
        }

        return [
            'id' => $id,
            'name' => $name,
            'toolCalling' => (bool) ($raw['toolCalling'] ?? $raw['tool_calling'] ?? $raw['function_calling'] ?? $raw['tools'] ?? false),
            'vision' => (bool) ($raw['vision'] ?? $raw['multimodal'] ?? false),
            'free' => (bool) ($raw['free'] ?? false),
            'maxInputTokens' => (int) ($raw['maxInputTokens'] ?? $raw['max_input_tokens'] ?? $raw['contextLength'] ?? $raw['context_length'] ?? 128000),
            'maxOutputTokens' => (int) ($raw['maxOutputTokens'] ?? $raw['max_output_tokens'] ?? $raw['max_tokens'] ?? 8192),
            'enabled' => $enabled,
            'inputCostPer1M' => (float) ($raw['inputCostPer1M'] ?? $raw['input_cost_per_1m'] ?? 0),
            'outputCostPer1M' => (float) ($raw['outputCostPer1M'] ?? $raw['output_cost_per_1m'] ?? 0),
            'extra' => $extra,
        ];
    }

    /** Best-effort protocol sniffing for catalogs that omit the field. */
    private static function guessProtocol(string $id, string $vendor, string $url): string
    {
        $hay = strtolower($id . ' ' . $vendor . ' ' . $url);
        foreach ([
            'ollama' => 'ollama',
            'anthropic' => 'anthropic',
            'claude' => 'anthropic',
            'generativelanguage' => 'gemini',
            'gemini' => 'gemini',
            'mistral' => 'mistral',
            'azure' => 'azure',
            'cloudflare' => 'cloudflare',
            'workers-ai' => 'cloudflare',
        ] as $needle => $protocol) {
            if (str_contains($hay, $needle)) {
                return $protocol;
            }
        }
        return 'openai-compatible';
    }

    public static function normalizeProvider(array $raw, string $fallbackId = ''): array
    {
        $id = trim((string) ($raw['id'] ?? $raw['slug'] ?? $fallbackId));
        if ($id === '') {
            $id = trim((string) ($raw['name'] ?? ''));
        }
        $id = strtolower((string) preg_replace('/[^A-Za-z0-9._-]+/', '-', $id));
        $id = trim($id, '-');
        if ($id === '') {
            throw new \InvalidArgumentException('Provider is missing an "id" (and no usable name to derive one from)');
        }
        $models = [];
        foreach ((array) ($raw['models'] ?? []) as $m) {
            if (!is_array($m) && !is_string($m)) {
                continue;
            }
            $model = self::normalizeModel($m);
            if ($model['id'] !== '') {
                $models[] = $model;
            }
        }
        $vendor = (string) ($raw['vendor'] ?? 'custom');
        $url = (string) ($raw['url'] ?? $raw['baseUrl'] ?? $raw['base_url'] ?? $raw['endpoint'] ?? '');

        $rawApiKeys = $raw['apiKeys'] ?? $raw['api_keys'] ?? [];
        $apiKeys = [];
        if (is_array($rawApiKeys)) {
            foreach ($rawApiKeys as $k => $v) {
                if (is_string($v) && trim($v) !== '') {
                    $apiKeys[] = trim($v);
                } elseif (is_array($v)) {
                    $candidate = (string) ($v['key'] ?? $v['apiKey'] ?? $v['api_key'] ?? $v['value'] ?? '');
                    if (trim($candidate) !== '') {
                        $apiKeys[] = trim($candidate);
                    }
                }
            }
        } elseif (is_string($rawApiKeys) && trim($rawApiKeys) !== '') {
            $apiKeys = array_values(array_filter(array_map('trim', preg_split('/[\r\n,]+/', $rawApiKeys))));
        }

        $singleKey = (string) ($raw['apiKey'] ?? $raw['api_key'] ?? '');
        if ($singleKey !== '' && !in_array($singleKey, $apiKeys, true)) {
            array_unshift($apiKeys, $singleKey);
        }

        return [
            'id' => $id,
            'name' => (string) ($raw['name'] ?? $id),
            'vendor' => $vendor,
            'url' => $url,
            'protocol' => (string) ($raw['protocol'] ?? self::guessProtocol($id, $vendor, $url)),
            'enabled' => (bool) ($raw['enabled'] ?? false),
            'apiKey' => $singleKey ?: ($apiKeys[0] ?? ''),
            'apiKeys' => array_values(array_unique($apiKeys)),
            'apiKeyEnv' => (string) ($raw['apiKeyEnv'] ?? ''),
            'proxyUrl' => (string) ($raw['proxyUrl'] ?? ''),
            'priority' => (int) ($raw['priority'] ?? 1),
            'timeoutSec' => (int) ($raw['timeoutSec'] ?? 120),
            'models' => $models,
            'extra' => (array) ($raw['extra'] ?? []),
        ];
    }

    // -------------------------------------------------------------- store

    /**
     * Fail with an actionable message *before* writing.
     *
     * Bootstrap turns every PHP warning into an ErrorException, so an
     * unwritable data directory used to surface as an opaque 400 in the UI.
     */
    private static function assertWritable(string $file): void
    {
        $dir = dirname($file);
        if (!is_dir($dir)) {
            throw new HttpError(500, 'The data directory ' . $dir . ' does not exist and could not be created.');
        }
        if (!is_writable($dir)) {
            throw new HttpError(500, 'The data directory ' . $dir . ' is not writable by the PHP user ('
                . (function_exists('posix_getpwuid') && function_exists('posix_geteuid')
                    ? (posix_getpwuid(posix_geteuid())['name'] ?? '?')
                    : (get_current_user() ?: '?'))
                . '). Fix it with: chmod -R 775 ' . $dir);
        }
        if (is_file($file) && !is_writable($file)) {
            throw new HttpError(500, 'The catalog file ' . $file . ' is not writable. Fix it with: chmod 664 ' . $file);
        }
    }

    public function save(): void
    {
        $dump = [];
        foreach ($this->data as $k => $v) {
            $d = $v;
            if (!empty($d['apiKey']) && !str_starts_with((string) $d['apiKey'], 'enc:')) {
                $d['apiKey'] = Crypto::encrypt((string) $d['apiKey']);
            }
            if (!empty($d['apiKeys'])) {
                $d['apiKeys'] = array_map(
                    static fn(string $key): string => str_starts_with($key, 'enc:') ? $key : Crypto::encrypt($key),
                    $d['apiKeys']
                );
            }
            $dump[$k] = $d;
        }
        $file = self::file();
        Files::ensureDir(dirname($file));
        self::assertWritable($file);

        $encoded = json_encode($dump, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($encoded === false) {
            throw new HttpError(500, 'The provider catalog could not be encoded as JSON: ' . json_last_error_msg()
                . ' (a model field probably contains invalid UTF-8).');
        }
        if (@file_put_contents($file . '.tmp', $encoded) === false) {
            throw new HttpError(500, 'Could not write ' . $file . '.tmp — check the permissions on '
                . dirname($file) . ' (the PHP user must own it).');
        }
        @chmod($file . '.tmp', 0600);
        if (!@rename($file . '.tmp', $file)) {
            @unlink($file . '.tmp');
            throw new HttpError(500, 'Could not replace ' . $file . ' — the file exists but is not writable '
                . 'by the PHP user. Fix it with: chmod 664 ' . $file);
        }
    }

    public function get(string $id): ?array
    {
        return $this->data[$id] ?? null;
    }

    public function require(string $id): array
    {
        $p = $this->get($id);
        if ($p === null) {
            throw new HttpError(404, "Provider '{$id}' not found");
        }
        return $p;
    }

    /** Port of ProviderStore.get_api_key, with round-robin rotation. */
    public function apiKey(array $p): string
    {
        $keys = $p['apiKeys'] ?? [];
        if ($keys) {
            $stateKey = 'keyidx:' . $p['id'];
            $idx = (int) (Database::state($stateKey, '0') ?? '0');
            $raw = (string) $keys[$idx % count($keys)];
            Database::setState($stateKey, (string) (($idx + 1) % max(1, count($keys))));
            return str_starts_with($raw, 'enc:') ? Crypto::decrypt($raw) : $raw;
        }
        if (!empty($p['apiKey'])) {
            $v = (string) $p['apiKey'];
            return str_starts_with($v, 'enc:') ? Crypto::decrypt($v) : $v;
        }
        if (!empty($p['apiKeyEnv'])) {
            $val = Config::raw((string) $p['apiKeyEnv'], '');
            if ($val !== '') {
                return $val;
            }
        }
        $guess = strtoupper((string) preg_replace('/[^A-Za-z0-9]/', '_', (string) $p['id'])) . '_API_KEY';
        return Config::raw($guess, '');
    }

    public function publicView(array $p): array
    {
        $key = $this->apiKey($p);
        $out = $p;
        $out['hasApiKey'] = $key !== '';
        $out['apiKey'] = !empty($p['apiKey']) ? Crypto::maskKey(
            str_starts_with((string) $p['apiKey'], 'enc:') ? Crypto::decrypt((string) $p['apiKey']) : (string) $p['apiKey']
        ) : '';
        $out['apiKeys'] = array_map(
            static fn(string $k): string => Crypto::maskKey(str_starts_with($k, 'enc:') ? Crypto::decrypt($k) : $k),
            (array) ($p['apiKeys'] ?? [])
        );
        $out['circuitBreakerTripped'] = self::breaker()->isTripped((string) $p['id']);
        return $out;
    }

    public function allPublic(): array
    {
        $list = array_values($this->data);
        usort($list, static fn(array $a, array $b): int => ($b['priority'] ?? 1) <=> ($a['priority'] ?? 1));
        return array_map(fn(array $p): array => $this->publicView($p), $list);
    }

    public function upsert(array $p): array
    {
        $p = self::normalizeProvider($p);
        $existing = $this->data[$p['id']] ?? null;
        if ($existing !== null) {
            if (empty($p['apiKey']) || str_contains((string) $p['apiKey'], '••••')) {
                $p['apiKey'] = $existing['apiKey'];
            }
            if (empty($p['apiKeys'])) {
                $p['apiKeys'] = $existing['apiKeys'];
            }
        }
        $this->data[$p['id']] = $p;
        $this->save();
        return $this->publicView($p);
    }

    public function delete(string $pid): void
    {
        unset($this->data[$pid]);
        $this->save();
    }

    public function addModel(string $pid, array $model): void
    {
        if (!isset($this->data[$pid])) {
            throw new HttpError(404, 'Provider not found');
        }
        $this->data[$pid]['models'][] = self::normalizeModel($model);
        $this->save();
    }

    public function updateModel(string $pid, string $mid, array $model): void
    {
        if (!isset($this->data[$pid])) {
            throw new HttpError(404, 'Provider not found');
        }
        $normalized = self::normalizeModel($model);
        $this->data[$pid]['models'] = array_map(
            static fn(array $m): array => $m['id'] === $mid ? $normalized : $m,
            $this->data[$pid]['models']
        );
        $this->save();
    }

    public function deleteModel(string $pid, string $mid): void
    {
        if (!isset($this->data[$pid])) {
            throw new HttpError(404, 'Provider not found');
        }
        $this->data[$pid]['models'] = array_values(array_filter(
            $this->data[$pid]['models'],
            static fn(array $m): bool => $m['id'] !== $mid
        ));
        $this->save();
    }

    public function findModel(array $provider, string $modelId): array
    {
        foreach ($provider['models'] as $m) {
            if ($m['id'] === $modelId) {
                return $m;
            }
        }
        return self::normalizeModel(['id' => $modelId, 'name' => $modelId, 'toolCalling' => true]);
    }

    /** Port of ProviderStore.record_metric. */
    public function recordMetric(string $providerId, string $modelId, float $latencyMs, bool $isError, int $tokens = 0): void
    {
        if ($isError) {
            self::breaker()->recordFailure($providerId);
        } else {
            self::breaker()->recordSuccess($providerId);
        }
        Observability::recordProviderCall($providerId, $modelId, !$isError, $latencyMs, $tokens);
        try {
            Database::run(
                'UPDATE provider_metrics SET circuit_breaker_tripped = ? WHERE provider_id = ? AND model_id = ?',
                [self::breaker()->isTripped($providerId) ? 1 : 0, $providerId, $modelId]
            );
        } catch (\Throwable) {
        }
    }

    /**
     * Port of ProviderStore.get_verified_fallback_candidates.
     * @return array<int, array{0:array,1:array}>
     */
    public function verifiedFallbackCandidates(
        ?string $excludeProviderId = null,
        ?string $excludeModelId = null,
        bool $preferDifferentProvider = false
    ): array {
        $out = [];
        $seen = [];
        try {
            $rows = Database::all(
                "SELECT provider_id, model_id, last_latency_ms FROM provider_metrics
                 WHERE last_status = 'ok' ORDER BY last_latency_ms ASC, updated_at DESC"
            );
        } catch (\Throwable) {
            $rows = [];
        }
        foreach ($rows as $row) {
            $pid = (string) $row['provider_id'];
            $mid = (string) $row['model_id'];
            if ($pid === $excludeProviderId && $mid === $excludeModelId) {
                continue;
            }
            $key = $pid . '::' . $mid;
            if (isset($seen[$key])) {
                continue;
            }
            $provider = $this->get($pid);
            if ($provider === null || !$provider['enabled'] || self::breaker()->isTripped($pid)) {
                continue;
            }
            $apiKey = $this->apiKey($provider);
            if ($apiKey === '' && !in_array($provider['protocol'], ['ollama', 'workers-ai'], true)) {
                continue;
            }
            $out[] = [$provider, $this->findModel($provider, $mid)];
            $seen[$key] = true;
        }

        // Providers that have never been measured yet are still valid fallbacks.
        foreach ($this->data as $provider) {
            if (!$provider['enabled'] || self::breaker()->isTripped((string) $provider['id'])) {
                continue;
            }
            $apiKey = $this->apiKey($provider);
            if ($apiKey === '' && !in_array($provider['protocol'], ['ollama', 'workers-ai'], true)) {
                continue;
            }
            foreach ($provider['models'] as $m) {
                if (!($m['enabled'] ?? true)) {
                    continue;
                }
                if ($provider['id'] === $excludeProviderId && $m['id'] === $excludeModelId) {
                    continue;
                }
                $key = $provider['id'] . '::' . $m['id'];
                if (isset($seen[$key])) {
                    continue;
                }
                $out[] = [$provider, $m];
                $seen[$key] = true;
            }
        }

        if ($preferDifferentProvider && $excludeProviderId !== null) {
            usort($out, static function (array $a, array $b) use ($excludeProviderId): int {
                return (($a[0]['id'] !== $excludeProviderId) ? 0 : 1) <=> (($b[0]['id'] !== $excludeProviderId) ? 0 : 1);
            });
        }
        return $out;
    }

    public function exportJson(): string
    {
        $dump = [];
        foreach ($this->data as $k => $v) {
            $dump[$k] = array_merge($v, ['apiKey' => '', 'apiKeys' => []]);
        }
        return (string) json_encode($dump, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }

    /**
     * Tolerant provider import.
     *
     * Real-world exports come in half a dozen shapes, so instead of demanding
     * one canonical layout we sniff the payload and accept all of these:
     *
     *   {"openrouter": {...}, "ollama": {...}}      object keyed by provider id
     *   [{"id": "openrouter", ...}, ...]            list of providers
     *   {"providers": <either of the above>}        wrapped (also data/result/config)
     *   {"id": "openrouter", "models": [...]}       one single provider
     *   {"version": 3, "providers": {...}}          export envelope with metadata
     *
     * Unknown per-model keys (`tested`, `available`, `testDetails`, `nonChat`,
     * …) are not thrown away: they are folded into `model.extra` so a catalog
     * exported from another tool survives the round trip untouched.
     *
     * @return array{providers:int,models:int,created:string[],updated:string[],skipped:array<int,array{key:string,reason:string}>}
     */
    public function importJson(string $text, bool $replace = false): array
    {
        $raw = self::decodeImport($text);
        $entries = self::collectProviderEntries($raw);

        if (!$entries) {
            // Check if payload was actually a list of models without provider envelope
            if (!empty($this->data)) {
                $targetPid = array_key_first($this->data);
                try {
                    $mRes = $this->importModelsForProvider($targetPid, $text, $replace);
                    return [
                        'providers' => count($this->data),
                        'models' => $mRes['modelsCount'],
                        'created' => [],
                        'updated' => [$targetPid],
                        'skipped' => [],
                    ];
                } catch (\Throwable) {}
            }
            throw new HttpError(400, self::importHint($raw));
        }

        $parsed = [];
        $skipped = [];
        $created = [];
        $updated = [];
        $modelCount = 0;

        foreach ($entries as [$key, $value]) {
            try {
                $p = self::normalizeProvider($value, $key);
            } catch (\Throwable $e) {
                $skipped[] = ['key' => $key, 'reason' => $e->getMessage()];
                continue;
            }
            $existing = $replace ? null : ($this->data[$p['id']] ?? null);
            $merged = $existing !== null ? self::mergeProvider($existing, $p, $value) : $p;
            $parsed[$p['id']] = $merged;
            $modelCount += count($merged['models']);
            if ($existing !== null) {
                $updated[] = $p['id'];
            } else {
                $created[] = $p['id'];
            }
        }

        if (!$parsed) {
            throw new HttpError(400, 'No importable provider was found. ' . ($skipped[0]['reason'] ?? ''));
        }

        $this->data = $replace ? $parsed : array_merge($this->data, $parsed);
        $this->save();

        return [
            'providers' => count($parsed),
            'models' => $modelCount,
            'created' => $created,
            'updated' => $updated,
            'skipped' => $skipped,
        ];
    }

    /** Import models into a specific provider (auto-creates provider if not already present). */
    public function importModelsForProvider(string $providerId, string $text, bool $replace = false): array
    {
        if (!isset($this->data[$providerId])) {
            $name = ucwords(str_replace(['-', '_'], ' ', $providerId));
            $url = $providerId === 'ollama' ? 'http://localhost:11434' : ($providerId === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1');
            $protocol = $providerId === 'ollama' ? 'ollama' : ($providerId === 'anthropic' ? 'anthropic' : 'openai-compatible');
            $this->data[$providerId] = [
                'id' => $providerId,
                'name' => $name,
                'url' => $url,
                'protocol' => $protocol,
                'enabled' => true,
                'models' => [],
                'apiKeys' => [],
                'extra' => [],
            ];
        }
        $raw = self::decodeImport($text);
        $models = [];
        $candidates = [];
        if (is_array($raw)) {
            // Check if specific provider key exists in raw
            if (isset($raw[$providerId]) && is_array($raw[$providerId]) && isset($raw[$providerId]['models']) && is_array($raw[$providerId]['models'])) {
                $candidates = $raw[$providerId]['models'];
            } elseif (isset($raw['data']) && is_array($raw['data'])) {
                $candidates = $raw['data'];
            } elseif (isset($raw['models']) && is_array($raw['models'])) {
                $candidates = $raw['models'];
            } elseif (isset($raw['items']) && is_array($raw['items'])) {
                $candidates = $raw['items'];
            } elseif (isset($raw['options']) && is_array($raw['options'])) {
                $candidates = $raw['options'];
            } elseif (isset($raw['results']) && is_array($raw['results'])) {
                $candidates = $raw['results'];
            } elseif (array_is_list($raw)) {
                $candidates = $raw;
            } else {
                // Check if any sub-key has models (e.g. user pasted full catalog to single provider importer)
                $foundSubModels = [];
                foreach ($raw as $k => $v) {
                    if (is_array($v) && isset($v['models']) && is_array($v['models'])) {
                        foreach ($v['models'] as $sm) {
                            $foundSubModels[] = $sm;
                        }
                    }
                }
                if (!empty($foundSubModels)) {
                    $candidates = $foundSubModels;
                } else {
                    // Check if dict mapping model_id -> spec
                    $isMap = true;
                    foreach ($raw as $k => $v) {
                        if (!is_array($v) && !is_string($v)) { $isMap = false; break; }
                    }
                    if ($isMap && !isset($raw['url']) && !isset($raw['baseUrl'])) {
                        $candidates = [];
                        foreach ($raw as $k => $v) {
                            $candidates[] = is_array($v) ? array_merge(['id' => (string) $k], $v) : ['id' => (string) $k, 'name' => (string) $v];
                        }
                    } else {
                        $candidates = [$raw];
                    }
                }
            }
        }
        foreach ($candidates as $m) {
            if (is_string($m) && trim($m) !== '') {
                $models[] = self::normalizeModel(['id' => trim($m), 'name' => trim($m)]);
            } elseif (is_array($m)) {
                $norm = self::normalizeModel($m);
                if ($norm['id'] !== '') {
                    $models[] = $norm;
                }
            }
        }
        if (empty($models)) {
            throw new HttpError(400, 'No valid models found in the import payload.');
        }

        $existing = $this->data[$providerId];
        $byId = [];
        if (!$replace) {
            foreach ((array) ($existing['models'] ?? []) as $em) {
                if (is_array($em) && ($em['id'] ?? '') !== '') {
                    $byId[(string) $em['id']] = $em;
                }
            }
        }
        $added = 0;
        $updated = 0;
        foreach ($models as $nm) {
            $mid = (string) $nm['id'];
            if (isset($byId[$mid])) {
                $byId[$mid] = array_merge($byId[$mid], $nm, [
                    'extra' => array_merge((array) ($byId[$mid]['extra'] ?? []), (array) ($nm['extra'] ?? [])),
                ]);
                $updated++;
            } else {
                $byId[$mid] = $nm;
                $added++;
            }
        }
        $this->data[$providerId]['models'] = array_values($byId);
        $this->save();

        return [
            'ok' => true,
            'provider' => $providerId,
            'modelsCount' => count($this->data[$providerId]['models']),
            'added' => $added,
            'updated' => $updated,
            'replace' => $replace,
        ];
    }

    /** json_decode with tolerant error recovery for truncated/unclosed pastes. */
    public static function decodeImport(string $text): mixed
    {
        $text = trim($text);
        if ($text === '') {
            throw new HttpError(
                400,
                'The import payload was empty. If you pasted a large catalog, the web server may have '
                . 'dropped the request body: raise post_max_size / upload_max_filesize, or import from the '
                . 'CLI with "php bin/console.php provider:import <file>".'
            );
        }

        // Tolerate a UTF-8 BOM, smart quotes, and markdown code block wrappers
        $text = preg_replace('/^\xEF\xBB\xBF/', '', $text) ?? $text;
        if (str_starts_with($text, '```')) {
            $lines = explode("\n", $text);
            if (!empty($lines) && str_starts_with(trim($lines[0]), '```')) {
                array_shift($lines);
            }
            if (!empty($lines) && str_starts_with(trim(end($lines)), '```')) {
                array_pop($lines);
            }
            $text = trim(implode("\n", $lines));
        }
        $text = str_replace(["\u{201C}", "\u{201D}", "\u{2018}", "\u{2019}", "«", "»", "„"], ['"', '"', "'", "'", '"', '"', '"'], $text);

        $decoded = json_decode($text, true);
        if (json_last_error() === JSON_ERROR_NONE && $decoded !== null) {
            return $decoded;
        }
        $relaxed = preg_replace('/,\s*([}\]])/', '$1', $text);
        if (is_string($relaxed)) {
            $decoded = json_decode($relaxed, true);
            if (json_last_error() === JSON_ERROR_NONE && $decoded !== null) {
                return $decoded;
            }
        }

        // Auto-repair truncated / cut-off JSON
        $repaired = self::repairTruncatedJson($text);
        if ($repaired !== null) {
            return $repaired;
        }

        // Plain line-by-line model list fallback (e.g. pasted model IDs, or plain text list)
        $lines = preg_split('/[\r\n]+/', $text);
        $plainModels = [];
        foreach ($lines as $line) {
            $line = trim($line, " \t\r\n,;\"'");
            if ($line === '' || str_starts_with($line, '#') || str_starts_with($line, '//')) {
                continue;
            }
            $plainModels[] = ['id' => $line, 'name' => $line];
        }
        if (!empty($plainModels)) {
            return ['models' => $plainModels];
        }

        $len = strlen($text);
        $tail = substr($text, -60);
        throw new HttpError(
            400,
            'The text could not be parsed as JSON or a list of models (' . json_last_error_msg() . '). Length ' . $len
            . ' bytes, ends with: ' . $tail
            . ' — a truncated paste is the usual cause; upload the file instead of pasting it.'
        );
    }

    public static function repairTruncatedJson(string $text): mixed
    {
        $t = trim($text);
        $len = strlen($t);
        if ($len < 2) return null;

        $inString = false;
        $escape = false;
        $stack = [];

        for ($i = 0; $i < $len; $i++) {
            $ch = $t[$i];
            if ($escape) {
                $escape = false;
                continue;
            }
            if ($ch === '\\') {
                $escape = true;
                continue;
            }
            if ($ch === '"') {
                $inString = !$inString;
                continue;
            }
            if (!$inString) {
                if ($ch === '{' || $ch === '[') {
                    $stack[] = $ch;
                } elseif ($ch === '}') {
                    if (!empty($stack) && end($stack) === '{') array_pop($stack);
                } elseif ($ch === ']') {
                    if (!empty($stack) && end($stack) === '[') array_pop($stack);
                }
            }
        }

        $repaired = $t;
        if ($inString) {
            $repaired .= '"';
        }

        $repaired = preg_replace('/,\s*$/', '', $repaired) ?? $repaired;
        $repaired = preg_replace('/:\s*$/', ': null', $repaired) ?? $repaired;
        $repaired = preg_replace('/,\s*([}\]])/', '$1', $repaired) ?? $repaired;

        while (!empty($stack)) {
            $open = array_pop($stack);
            $repaired = preg_replace('/,\s*$/', '', $repaired) ?? $repaired;
            if ($open === '{') {
                if (preg_match('/"[^"]+"\s*:\s*$/', $repaired)) {
                    $repaired .= 'null';
                }
                $repaired .= '}';
            } elseif ($open === '[') {
                $repaired .= ']';
            }
        }

        $decoded = json_decode($repaired, true);
        if (json_last_error() === JSON_ERROR_NONE && $decoded !== null) {
            return $decoded;
        }

        $lastComma = strrpos($t, ',');
        if ($lastComma !== false && $lastComma > 10) {
            return self::repairTruncatedJson(substr($t, 0, $lastComma));
        }

        return null;
    }

    /**
     * Reduce any accepted wrapper to a list of [key, providerArray] pairs.
     *
     * @return array<int, array{0:string,1:array}>
     */
    private static function collectProviderEntries(mixed $raw, int $depth = 0): array
    {
        if (!is_array($raw) || $depth > 3) {
            return [];
        }

        // A single provider object.
        if (self::looksLikeProvider($raw)) {
            return [[(string) ($raw['id'] ?? ''), $raw]];
        }

        // A list: either of providers, or of [key => provider] singletons.
        if (array_is_list($raw)) {
            $out = [];
            foreach ($raw as $item) {
                if (!is_array($item)) {
                    continue;
                }
                if (self::looksLikeProvider($item)) {
                    $out[] = [(string) ($item['id'] ?? ''), $item];
                    continue;
                }
                foreach (self::collectProviderEntries($item, $depth + 1) as $nested) {
                    $out[] = $nested;
                }
            }
            return $out;
        }

        // An object keyed by provider id.
        $out = [];
        $wrappers = [];
        foreach ($raw as $k => $v) {
            if (!is_array($v)) {
                continue; // metadata such as "version" / "exportedAt"
            }
            if (self::looksLikeProvider($v)) {
                $out[] = [(string) $k, $v];
            } elseif (in_array((string) $k, ['providers', 'data', 'result', 'config', 'catalog', 'items'], true)) {
                $wrappers[] = $v;
            }
        }
        if ($out) {
            return $out;
        }
        foreach ($wrappers as $w) {
            foreach (self::collectProviderEntries($w, $depth + 1) as $nested) {
                $out[] = $nested;
            }
        }
        return $out;
    }

    /** Heuristic: does this associative array describe a provider? */
    private static function looksLikeProvider(array $v): bool
    {
        if (array_is_list($v)) {
            return false;
        }
        foreach (['models', 'url', 'baseUrl', 'base_url', 'protocol', 'apiKey', 'api_key', 'vendor'] as $marker) {
            if (array_key_exists($marker, $v)) {
                return true;
            }
        }
        // If it contains model-specific fields, it is a model spec, not a provider
        foreach (['maxInputTokens', 'max_input_tokens', 'maxOutputTokens', 'max_output_tokens', 'toolCalling', 'tool_calling', 'vision', 'multimodal', 'contextLength', 'context_length'] as $marker) {
            if (array_key_exists($marker, $v)) {
                return false;
            }
        }
        return array_key_exists('id', $v) && array_key_exists('name', $v);
    }

    private static function importHint(mixed $raw): string
    {
        $type = get_debug_type($raw);
        if (is_array($raw)) {
            $keys = array_slice(array_map('strval', array_keys($raw)), 0, 8);
            return 'The JSON parsed correctly but contains no provider object. Top-level keys were: '
                . (count($keys) ? implode(', ', $keys) : '(empty)')
                . '. Expected {"openrouter": {"url": "...", "models": [...]}} , a list of providers, '
                . 'or {"providers": {...}}.';
        }
        return 'Expected a JSON object or array of providers, got ' . $type . '.';
    }

    /**
     * Merge an imported provider into an existing one without losing local
     * state: models are merged by id, and an empty incoming credential never
     * wipes a stored one.
     */
    private static function mergeProvider(array $existing, array $incoming, array $rawIncoming): array
    {
        $merged = array_merge($existing, $incoming);

        foreach (['apiKey', 'apiKeyEnv', 'proxyUrl', 'url'] as $k) {
            if (($incoming[$k] ?? '') === '' && ($existing[$k] ?? '') !== '') {
                $merged[$k] = $existing[$k];
            }
        }
        if (!($incoming['apiKeys'] ?? []) && ($existing['apiKeys'] ?? [])) {
            $merged['apiKeys'] = $existing['apiKeys'];
        }
        if (!array_key_exists('enabled', $rawIncoming)) {
            $merged['enabled'] = (bool) ($existing['enabled'] ?? false);
        }
        $merged['extra'] = array_merge((array) ($existing['extra'] ?? []), (array) ($incoming['extra'] ?? []));

        $byId = [];
        foreach ((array) ($existing['models'] ?? []) as $m) {
            if (is_array($m) && ($m['id'] ?? '') !== '') {
                $byId[(string) $m['id']] = $m;
            }
        }
        foreach ($incoming['models'] as $m) {
            $id = (string) ($m['id'] ?? '');
            if ($id === '') {
                continue;
            }
            $byId[$id] = isset($byId[$id])
                ? array_merge($byId[$id], $m, [
                    'extra' => array_merge((array) ($byId[$id]['extra'] ?? []), (array) ($m['extra'] ?? [])),
                ])
                : $m;
        }
        $merged['models'] = array_values($byId);

        return $merged;
    }
}
