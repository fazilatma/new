<?php

/**
 * Provider and model catalogue.
 *
 * Import is deliberately permissive: catalogues in the wild come as an object
 * keyed by id, as a list, wrapped in any of a dozen envelope keys, or as a
 * single provider. Rejecting a file because its shape is unfamiliar is the
 * single most common way this feature disappoints, so the shape is sniffed
 * rather than demanded.
 */

declare(strict_types=1);

namespace Arena;

final class Providers
{
    public const PROTOCOLS = ['openai', 'anthropic', 'gemini', 'ollama', 'mistral', 'azure'];

    private const ENVELOPES = ['providers', 'data', 'result', 'config', 'catalog', 'items', 'list', 'entries'];

    /** @return array<int,array<string,mixed>> */
    public static function all(bool $withSecrets = false): array
    {
        $rows = Db::all('SELECT * FROM providers ORDER BY position, name');
        $out = [];
        foreach ($rows as $p) {
            $out[] = self::shape($p, $withSecrets);
        }
        return $out;
    }

    /** @return array<string,mixed>|null */
    public static function find(string $id, bool $withSecrets = false): ?array
    {
        $p = Db::one('SELECT * FROM providers WHERE id = ?', [$id]);
        return $p === null ? null : self::shape($p, $withSecrets);
    }

    /** @param array<string,mixed> $p @return array<string,mixed> */
    private static function shape(array $p, bool $withSecrets): array
    {
        $models = Db::all('SELECT * FROM models WHERE provider_id = ? ORDER BY model_id', [$p['id']]);
        return [
            'id' => (string) $p['id'],
            'name' => (string) $p['name'],
            'protocol' => (string) $p['protocol'],
            'baseUrl' => (string) $p['base_url'],
            'enabled' => (bool) $p['enabled'],
            'hasApiKey' => ((string) $p['api_key']) !== '',
            'apiKeyHint' => Crypto::hint((string) $p['api_key']),
            'apiKey' => $withSecrets ? Crypto::decrypt((string) $p['api_key']) : null,
            'extra' => json_decode((string) $p['extra'], true) ?: new \stdClass(),
            'models' => array_map(static fn(array $m): array => [
                'id' => (string) $m['model_id'],
                'name' => (string) ($m['name'] ?: $m['model_id']),
                'enabled' => (bool) $m['enabled'],
                'toolCalling' => (bool) $m['tools'],
                'vision' => (bool) $m['vision'],
                'maxInputTokens' => (int) $m['ctx_in'],
                'maxOutputTokens' => (int) $m['ctx_out'],
                'inputCostPer1M' => (float) $m['cost_in'],
                'outputCostPer1M' => (float) $m['cost_out'],
                'extra' => json_decode((string) $m['extra'], true) ?: new \stdClass(),
            ], $models),
        ];
    }

    /** @param array<string,mixed> $in */
    public static function save(array $in, ?string $id = null): string
    {
        $id = $id ?? self::slug((string) ($in['id'] ?? $in['name'] ?? 'provider'));
        $existing = Db::one('SELECT * FROM providers WHERE id = ?', [$id]);

        $apiKey = $in['apiKey'] ?? null;
        $storedKey = (string) ($existing['api_key'] ?? '');
        if (is_string($apiKey) && $apiKey !== '') {
            $storedKey = Crypto::encrypt($apiKey);
        }

        $protocolRaw = (string) ($in['protocol'] ?? $in['type'] ?? $in['provider']
            ?? $existing['protocol'] ?? '');
        $baseRaw = (string) ($in['baseUrl'] ?? $in['url'] ?? $in['endpoint']
            ?? $in['base_url'] ?? $existing['base_url'] ?? '');
        $row = [
            'name' => (string) ($in['name'] ?? $existing['name'] ?? $id),
            'protocol' => self::normalizeProtocol($protocolRaw, $baseRaw),
            'base_url' => rtrim($baseRaw, '/'),
            'api_key' => $storedKey,
            'enabled' => array_key_exists('enabled', $in) ? (int) (bool) $in['enabled'] : (int) ($existing['enabled'] ?? 1),
            'position' => (int) ($in['position'] ?? $existing['position'] ?? 0),
            'extra' => (string) json_encode($in['extra'] ?? json_decode((string) ($existing['extra'] ?? '{}'), true) ?: new \stdClass()),
        ];

        if ($existing === null) {
            Db::run(
                'INSERT INTO providers (id, name, protocol, base_url, api_key, enabled, position, extra, created_at)
                 VALUES (?,?,?,?,?,?,?,?,?)',
                [$id, $row['name'], $row['protocol'], $row['base_url'], $row['api_key'],
                 $row['enabled'], $row['position'], $row['extra'], Db::now()]
            );
        } else {
            Db::run(
                'UPDATE providers SET name=?, protocol=?, base_url=?, api_key=?, enabled=?, position=?, extra=? WHERE id=?',
                [$row['name'], $row['protocol'], $row['base_url'], $row['api_key'],
                 $row['enabled'], $row['position'], $row['extra'], $id]
            );
        }

        if (isset($in['models']) && is_array($in['models'])) {
            self::saveModels($id, $in['models']);
        }
        return $id;
    }

    /** @param array<mixed> $models */
    public static function saveModels(string $providerId, array $models, bool $replace = false): int
    {
        return (int) Db::transaction(static function () use ($providerId, $models, $replace): int {
            if (Db::one('SELECT id FROM providers WHERE id = ?', [$providerId]) === null) {
                throw new HttpError(404, 'No such provider.');
            }
            if ($replace) Db::run('DELETE FROM models WHERE provider_id = ?', [$providerId]);
            $st = Db::pdo()->prepare(
                'INSERT INTO models (provider_id, model_id, name, enabled, tools, vision, ctx_in, ctx_out, cost_in, cost_out, extra)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?)
                 ON CONFLICT(provider_id, model_id) DO UPDATE SET name=excluded.name, enabled=excluded.enabled,
                 tools=excluded.tools, vision=excluded.vision, ctx_in=excluded.ctx_in, ctx_out=excluded.ctx_out,
                 cost_in=excluded.cost_in, cost_out=excluded.cost_out, extra=excluded.extra'
            );
            $n = 0;
            foreach (self::normalizeModelList($models) as $m) {
                $modelId = trim((string) ($m['id'] ?? ''));
                if ($modelId === '') continue;
                $known = ['id','name','enabled','toolCalling','vision','maxInputTokens','maxOutputTokens','inputCostPer1M','outputCostPer1M','extra'];
                $extra = is_array($m['extra'] ?? null) ? $m['extra'] : [];
                foreach ($m as $k => $v) if (!in_array($k, $known, true)) $extra[$k] = $v;
                $enabled = array_key_exists('enabled', $m) ? (bool) $m['enabled'] : true;
                if (!empty($m['nonChat'])) $enabled = false;
                $st->execute([
                    $providerId, $modelId, (string) ($m['name'] ?? $modelId), (int) $enabled,
                    (int) (bool) ($m['toolCalling'] ?? false), (int) (bool) ($m['vision'] ?? false),
                    (int) ($m['maxInputTokens'] ?? 0), (int) ($m['maxOutputTokens'] ?? 0),
                    (float) ($m['inputCostPer1M'] ?? 0), (float) ($m['outputCostPer1M'] ?? 0),
                    (string) json_encode($extra ?: new \stdClass(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                ]);
                $n++;
            }
            return $n;
        });
    }

    /** Import only a model catalogue into an existing provider. */
    public static function importModels(string $json, string $providerId, bool $replace = false): array
    {
        if (self::find($providerId) === null) throw new HttpError(404, 'No such provider.');
        $data = self::decodeCatalogue($json);
        $models = self::sniffModels($data);
        if ($models === []) throw new HttpError(400, 'No models found in this catalogue.');
        return ['ok' => true, 'provider' => $providerId, 'models' => self::saveModels($providerId, $models, $replace), 'replace' => $replace];
    }

    public static function delete(string $id): void
    {
        Db::run('DELETE FROM providers WHERE id = ?', [$id]);
    }

    /** Decode common hand-edited JSON catalogue variants. */
    private static function decodeCatalogue(string $json): array
    {
        $json = trim($json);
        if ($json === '') throw new HttpError(400, 'Nothing to import: the text was empty.');
        $json = preg_replace('/^\\xEF\\xBB\\xBF/', '', $json) ?? $json;
        $data = json_decode($json, true);
        if (!is_array($data)) {
            $cleaned = preg_replace('/,\\s*([}\\]])/', '$1', $json) ?? $json;
            $data = json_decode($cleaned, true);
        }
        if (!is_array($data)) throw new HttpError(400, 'That is not valid JSON: ' . json_last_error_msg());
        return $data;
    }

    /** @param array<mixed> $data @return array<int,array<string,mixed>> */
    private static function sniffModels(array $data, int $depth = 0): array
    {
        if ($depth > 4) return [];
        if (array_is_list($data)) {
            $out = [];
            foreach ($data as $item) {
                if (is_string($item) && trim($item) !== '') $out[] = ['id' => trim($item)];
                elseif (is_array($item) && self::looksLikeModel($item)) $out[] = self::normalizeImportedModel($item);
            }
            return $out;
        }
        foreach (['data','models','items','results','list','entries'] as $key) {
            if (isset($data[$key]) && is_array($data[$key])) {
                $inner = self::sniffModels($data[$key], $depth + 1);
                if ($inner !== []) return $inner;
            }
        }
        $out = [];
        foreach ($data as $key => $item) if (is_array($item) && self::looksLikeModel($item)) {
            $item['id'] ??= is_string($key) ? $key : '';
            $out[] = self::normalizeImportedModel($item);
        }
        return $out;
    }

    /** @param array<mixed> $a */
    private static function looksLikeModel(array $a): bool
    {
        return isset($a['id']) || isset($a['name']) || isset($a['model']) || isset($a['model_id']) || isset($a['owned_by']) || isset($a['capabilities']);
    }

    /** @param array<string,mixed> $m @return array<string,mixed> */
    private static function normalizeImportedModel(array $m): array
    {
        $id = trim((string) ($m['id'] ?? $m['model'] ?? $m['model_id'] ?? $m['name'] ?? ''));
        $caps = $m['capabilities'] ?? [];
        if (is_string($caps)) $caps = preg_split('/[,\\s]+/', strtolower($caps), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $tools = (bool) ($m['toolCalling'] ?? $m['tool_calling'] ?? $m['supports_tools'] ?? false);
        $vision = (bool) ($m['vision'] ?? $m['supports_vision'] ?? false);
        if (is_array($caps)) {
            $caps = array_map(static fn($v): string => strtolower((string) $v), $caps);
            $tools = $tools || (bool) array_intersect($caps, ['tools','tool_use','function_calling']);
            $vision = $vision || (bool) array_intersect($caps, ['vision','image']);
        }
        return [
            'id' => $id,
            'name' => (string) ($m['name'] ?? $m['display_name'] ?? $m['title'] ?? $id),
            'enabled' => array_key_exists('enabled', $m) ? (bool) $m['enabled'] : true,
            'toolCalling' => $tools, 'vision' => $vision,
            'maxInputTokens' => (int) ($m['maxInputTokens'] ?? $m['context_length'] ?? $m['context_window'] ?? $m['inputTokenLimit'] ?? 0),
            'maxOutputTokens' => (int) ($m['maxOutputTokens'] ?? $m['output_token_limit'] ?? 0),
            'inputCostPer1M' => (float) ($m['inputCostPer1M'] ?? $m['input_cost'] ?? 0),
            'outputCostPer1M' => (float) ($m['outputCostPer1M'] ?? $m['output_cost'] ?? 0),
            'extra' => $m,
        ];
    }

    /**
     * Import a catalogue from arbitrary JSON text.
     *
     * @return array<string,mixed>
     */
    public static function import(string $json, bool $replace = false): array
    {
        $data = self::decodeCatalogue($json);

        $list = self::sniff($data);
        if ($list === []) {
            throw new HttpError(400,
                'No providers found in that file. Expected an object keyed by provider id, a list of '
                . 'providers, or any of those wrapped in a "providers" key.');
        }

        if ($replace) {
            Db::run('DELETE FROM providers');
        }

        $created = [];
        $updated = [];
        $skipped = [];
        $models = 0;
        foreach ($list as $entry) {
            $id = self::slug((string) ($entry['id'] ?? $entry['name'] ?? ''));
            if ($id === '') {
                $skipped[] = ['key' => '(unnamed)', 'reason' => 'no id or name'];
                continue;
            }
            $existed = Db::one('SELECT id FROM providers WHERE id = ?', [$id]) !== null;
            // A merge must never blank a working credential with an absent one.
            if ($existed && (($entry['apiKey'] ?? '') === '')) {
                unset($entry['apiKey']);
            }
            // save() also persists models when present; count them once here
            // after stripping so the report is not double the real number.
            $entryModels = null;
            if (isset($entry['models']) && is_array($entry['models'])) {
                $entryModels = $entry['models'];
                unset($entry['models']);
            }
            // Accept common aliases used by third-party catalogues.
            if (!isset($entry['protocol']) && isset($entry['type'])) {
                $entry['protocol'] = $entry['type'];
            }
            if (!isset($entry['protocol']) && isset($entry['provider'])) {
                $entry['protocol'] = $entry['provider'];
            }
            if (!isset($entry['baseUrl']) && isset($entry['endpoint'])) {
                $entry['baseUrl'] = $entry['endpoint'];
            }
            if (!isset($entry['apiKey'])) {
                foreach (['api_key', 'key', 'token', 'secret'] as $k) {
                    if (!empty($entry[$k]) && is_string($entry[$k])) {
                        $entry['apiKey'] = $entry[$k];
                        break;
                    }
                }
            }
            self::save($entry, $id);
            if ($entryModels !== null) {
                $models += self::saveModels($id, $entryModels);
            }
            $existed ? $updated[] = $id : $created[] = $id;
        }

        return [
            'ok' => true,
            'providers' => count($created) + count($updated),
            'models' => $models,
            'created' => $created,
            'updated' => $updated,
            'skipped' => $skipped,
        ];
    }

    /**
     * Work out where the providers are inside an arbitrary structure.
     *
     * @param array<mixed> $data
     * @return array<int,array<string,mixed>>
     */
    private static function sniff(array $data, int $depth = 0): array
    {
        if ($depth > 3) {
            return [];
        }
        // A bare list of provider objects.
        if (array_is_list($data)) {
            $out = [];
            foreach ($data as $item) {
                if (is_array($item) && self::looksLikeProvider($item)) {
                    $out[] = $item;
                }
            }
            return $out;
        }
        // A single provider.
        if (self::looksLikeProvider($data) && !isset($data['providers'])) {
            return [$data];
        }
        // An envelope.
        foreach (self::ENVELOPES as $key) {
            if (isset($data[$key]) && is_array($data[$key])) {
                $inner = self::sniff($data[$key], $depth + 1);
                if ($inner !== []) {
                    return $inner;
                }
            }
        }
        // An object keyed by provider id.
        $out = [];
        foreach ($data as $key => $item) {
            if (is_array($item) && self::looksLikeProvider($item)) {
                $item['id'] ??= (string) $key;
                $out[] = $item;
            }
        }
        return $out;
    }

    /** @param array<mixed> $a */
    private static function looksLikeProvider(array $a): bool
    {
        foreach (['name', 'protocol', 'type', 'provider', 'baseUrl', 'url', 'base_url',
                  'endpoint', 'models', 'apiKey', 'api_key', 'key', 'token'] as $k) {
            if (array_key_exists($k, $a)) {
                return true;
            }
        }
        return false;
    }

    /** @return array<string,mixed> */
    public static function export(bool $includeKeys = false): array
    {
        $out = [];
        foreach (self::all($includeKeys) as $p) {
            $entry = [
                'id' => $p['id'], 'name' => $p['name'], 'protocol' => $p['protocol'],
                'baseUrl' => $p['baseUrl'], 'enabled' => $p['enabled'],
                'models' => $p['models'],
            ];
            if ($includeKeys && $p['apiKey']) {
                $entry['apiKey'] = $p['apiKey'];
            }
            $out[] = $entry;
        }
        return ['version' => APP_VERSION, 'exportedAt' => Db::now(), 'providers' => $out];
    }

    /** Guess the wire protocol from the endpoint when the file does not say. */
    public static function normalizeProtocol(string $protocol, string $url = ''): string
    {
        $p = strtolower(trim($protocol));
        $alias = [
            'openai-compatible' => 'openai', 'openai_compatible' => 'openai', 'oai' => 'openai',
            'openrouter' => 'openai', 'together' => 'openai', 'groq' => 'openai',
            'deepseek' => 'openai', 'fireworks' => 'openai', 'perplexity' => 'openai',
            'claude' => 'anthropic', 'generativelanguage' => 'gemini', 'google' => 'gemini',
            'workers-ai' => 'openai', 'cloudflare' => 'openai', 'cf' => 'openai',
            'local' => 'ollama', 'localai' => 'ollama', 'lmstudio' => 'openai',
        ];
        $p = $alias[$p] ?? $p;
        if (in_array($p, self::PROTOCOLS, true)) {
            return $p;
        }
        $u = strtolower($url);
        return match (true) {
            str_contains($u, 'anthropic') => 'anthropic',
            str_contains($u, 'generativelanguage'), str_contains($u, 'gemini') => 'gemini',
            str_contains($u, '11434'), str_contains($u, 'ollama') => 'ollama',
            str_contains($u, 'mistral') => 'mistral',
            str_contains($u, 'azure') => 'azure',
            default => 'openai',
        };
    }

    public static function slug(string $s): string
    {
        $s = strtolower(trim($s));
        $s = preg_replace('/[^a-z0-9._-]+/', '-', $s) ?? $s;
        return trim($s, '-');
    }
}
