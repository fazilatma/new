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

    public static function normalizeModel(array|string $raw): array
    {
        if (is_string($raw)) {
            $raw = ['id' => $raw];
        }
        return [
            'id' => (string) ($raw['id'] ?? ''),
            'name' => (string) ($raw['name'] ?? $raw['id'] ?? ''),
            'toolCalling' => (bool) ($raw['toolCalling'] ?? false),
            'vision' => (bool) ($raw['vision'] ?? false),
            'free' => (bool) ($raw['free'] ?? false),
            'maxInputTokens' => (int) ($raw['maxInputTokens'] ?? 128000),
            'maxOutputTokens' => (int) ($raw['maxOutputTokens'] ?? 8192),
            'enabled' => !array_key_exists('enabled', $raw) || (bool) $raw['enabled'],
            'inputCostPer1M' => (float) ($raw['inputCostPer1M'] ?? 0),
            'outputCostPer1M' => (float) ($raw['outputCostPer1M'] ?? 0),
            'extra' => (array) ($raw['extra'] ?? []),
        ];
    }

    public static function normalizeProvider(array $raw, string $fallbackId = ''): array
    {
        $id = (string) ($raw['id'] ?? $fallbackId);
        if ($id === '') {
            throw new \InvalidArgumentException('Provider is missing an "id"');
        }
        $models = [];
        foreach ((array) ($raw['models'] ?? []) as $m) {
            if (is_array($m) || is_string($m)) {
                $models[] = self::normalizeModel($m);
            }
        }
        return [
            'id' => $id,
            'name' => (string) ($raw['name'] ?? $id),
            'vendor' => (string) ($raw['vendor'] ?? 'custom'),
            'url' => (string) ($raw['url'] ?? ''),
            'protocol' => (string) ($raw['protocol'] ?? 'openai-compatible'),
            'enabled' => (bool) ($raw['enabled'] ?? false),
            'apiKey' => (string) ($raw['apiKey'] ?? ''),
            'apiKeys' => array_values(array_map('strval', (array) ($raw['apiKeys'] ?? []))),
            'apiKeyEnv' => (string) ($raw['apiKeyEnv'] ?? ''),
            'proxyUrl' => (string) ($raw['proxyUrl'] ?? ''),
            'priority' => (int) ($raw['priority'] ?? 1),
            'timeoutSec' => (int) ($raw['timeoutSec'] ?? 120),
            'models' => $models,
            'extra' => (array) ($raw['extra'] ?? []),
        ];
    }

    // -------------------------------------------------------------- store

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
        file_put_contents($file . '.tmp', json_encode($dump, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
        @chmod($file . '.tmp', 0600);
        rename($file . '.tmp', $file);
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

    public function importJson(string $text, bool $replace = false): void
    {
        $incoming = json_decode($text, true);
        if (!is_array($incoming)) {
            throw new HttpError(400, 'Import JSON must be an array of providers or an object mapping.');
        }
        $parsed = [];
        if (array_is_list($incoming)) {
            foreach ($incoming as $item) {
                if (is_array($item)) {
                    $p = self::normalizeProvider($item);
                    $parsed[$p['id']] = $p;
                }
            }
        } else {
            foreach ($incoming as $k => $v) {
                if (is_array($v)) {
                    $p = self::normalizeProvider($v, (string) $k);
                    $parsed[$p['id']] = $p;
                }
            }
        }
        $this->data = $replace ? $parsed : array_merge($this->data, $parsed);
        $this->save();
    }
}
