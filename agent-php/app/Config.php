<?php
/**
 * Mutable configuration. Port of agent-python/app/config.py.
 *
 * Back to the original design: `data/environment.json` for mutable settings and
 * `data/master.key` for the encryption key (the Workers port had to use KV and
 * a deployment secret). Secrets are stored encrypted and masked on read.
 */

declare(strict_types=1);

namespace Arena;

final class Config
{
    public const DEFAULT_PROXY_URL = 'https://proxy.fazilat-ma.workers.dev/?url={url}';

    public const KEYS = [
        'OPENROUTER_API_KEY',
        'GROQ_API_KEY',
        'TOGETHER_API_KEY',
        'MISTRAL_API_KEY',
        'GEMINI_API_KEY',
        'DEEPSEEK_API_KEY',
        'ANTHROPIC_API_KEY',
        'CLOUDFLARE_API_TOKEN',
        'CLOUDFLARE_ACCOUNT_ID',
        'GITHUB_TOKEN',
        'OLLAMA_BASE_URL',
        'PROVIDERS_FILE',
        'AGENT_PROXY_URL',
        'AGENT_PROXY_ENABLED',
        'AGENT_AUTH_TOKEN',
        'AUTH_ENABLED',
        'REQUIRE_FILE_APPROVAL',
        'MAX_CONCURRENT_JOBS',
        'RATE_LIMIT_PER_MINUTE',
        'CORS_ORIGINS',
    ];

    private static ?array $cache = null;

    public static function envFile(): string
    {
        return Bootstrap::$dataDir . '/environment.json';
    }

    public static function masterKeyFile(): string
    {
        return Bootstrap::$dataDir . '/master.key';
    }

    public static function isSecretKey(string $key): bool
    {
        if ($key === 'CLOUDFLARE_ACCOUNT_ID') {
            return false;
        }
        foreach (['KEY', 'TOKEN', 'SECRET', 'PASSWORD'] as $w) {
            if (str_contains($key, $w)) {
                return true;
            }
        }
        return false;
    }

    private static function store(): array
    {
        if (self::$cache !== null) {
            return self::$cache;
        }
        $file = self::envFile();
        $data = [];
        if (is_file($file)) {
            $decoded = json_decode((string) file_get_contents($file), true);
            if (is_array($decoded)) {
                $data = $decoded;
            }
        }
        self::$cache = $data;
        return $data;
    }

    private static function writeStore(array $data): void
    {
        self::$cache = $data;
        $file = self::envFile();
        $tmp = $file . '.tmp';
        file_put_contents($tmp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
        @chmod($tmp, 0600);
        rename($tmp, $file);
    }

    public static function invalidate(): void
    {
        self::$cache = null;
    }

    /** Port of config.get_raw_config: stored value wins, then env, then default. */
    public static function raw(string $key, string $fallback = ''): string
    {
        if ($key === 'AGENT_PROXY_URL' && $fallback === '') {
            $fallback = self::DEFAULT_PROXY_URL;
        }
        $store = self::store();
        if (isset($store[$key]) && trim((string) $store[$key]) !== '') {
            $val = (string) $store[$key];
            return str_starts_with($val, 'enc:') ? Crypto::decrypt($val) : $val;
        }
        $fromEnv = getenv($key);
        if ($fromEnv !== false && trim($fromEnv) !== '') {
            return $fromEnv;
        }
        return $fallback;
    }

    public static function rawInt(string $key, int $fallback): int
    {
        $v = self::raw($key, (string) $fallback);
        return is_numeric($v) ? (int) $v : $fallback;
    }

    public static function rawBool(string $key, bool $fallback = false): bool
    {
        $v = strtolower(trim(self::raw($key, $fallback ? 'true' : 'false')));
        return in_array($v, ['1', 'true', 'yes', 'on'], true);
    }

    /** Masked view for the settings UI (port of config.read_environment). */
    public static function readEnvironment(): array
    {
        $store = self::store();
        $out = [];
        foreach (self::KEYS as $k) {
            $val = $store[$k] ?? '';
            if (trim((string) $val) === '') {
                $fromEnv = getenv($k);
                $val = $fromEnv === false ? '' : $fromEnv;
            }
            if ($k === 'AGENT_PROXY_URL' && $val === '') {
                $val = self::DEFAULT_PROXY_URL;
            }
            if (self::isSecretKey($k)) {
                $plain = str_starts_with((string) $val, 'enc:') ? Crypto::decrypt((string) $val) : (string) $val;
                $out[$k] = $plain !== '' ? Crypto::maskKey($plain) : '';
            } else {
                $out[$k] = (string) $val;
            }
        }
        return $out;
    }

    /** Port of config.write_environment. */
    public static function writeEnvironment(array $incoming): array
    {
        $current = self::store();
        foreach ($incoming as $k => $raw) {
            if (!in_array($k, self::KEYS, true)) {
                continue;
            }
            $val = trim((string) ($raw ?? ''));
            if (self::isSecretKey($k)) {
                // Only overwrite a secret when the user typed a real value.
                if ($val !== '' && !str_contains($val, '••••')) {
                    $current[$k] = Crypto::encrypt($val);
                }
            } else {
                $current[$k] = $val;
            }
        }
        self::writeStore($current);
        return self::readEnvironment();
    }

    public static function authEnabled(): bool
    {
        $val = strtolower(self::raw('AUTH_ENABLED', ''));
        $token = self::raw('AGENT_AUTH_TOKEN', '');
        return in_array($val, ['1', 'true', 'yes', 'on'], true) || $token !== '';
    }

    public static function fileApprovalRequired(): bool
    {
        return self::rawBool('REQUIRE_FILE_APPROVAL', true);
    }

    public static function rateLimitPerMinute(): int
    {
        return self::rawInt('RATE_LIMIT_PER_MINUTE', 200);
    }

    public static function maxConcurrentJobs(): int
    {
        return max(1, self::rawInt('MAX_CONCURRENT_JOBS', 3));
    }

    public static function corsOrigins(): array
    {
        $raw = trim(self::raw('CORS_ORIGINS', '*'));
        if ($raw === '' || $raw === '*') {
            return ['*'];
        }
        return array_values(array_filter(array_map('trim', explode(',', $raw))));
    }

    /**
     * Port of config.parse_proxy_setting.
     *
     * Unlike the Workers build, PHP/cURL CAN use a real forward proxy, so a
     * `http://host:port` or `socks5://…` value is returned as `proxyClient`
     * and actually applied by Http client (CURLOPT_PROXY).
     *
     * @return array{effectiveUrl:string, proxyClient:?string}
     */
    public static function parseProxySetting(string $proxyVal, string $targetUrl): array
    {
        $v = trim($proxyVal);
        if ($v === '') {
            return ['effectiveUrl' => $targetUrl, 'proxyClient' => null];
        }
        foreach (['{url}', '{URL}', '{target}', '{TARGET}'] as $ph) {
            if (str_contains($v, $ph)) {
                return [
                    'effectiveUrl' => str_replace($ph, rawurlencode($targetUrl), $v),
                    'proxyClient' => null,
                ];
            }
        }
        if (str_contains($v, 'workers.dev') || str_contains($v, '?') || str_ends_with($v, '=')) {
            if (str_ends_with($v, '=') || str_ends_with($v, '?')) {
                return ['effectiveUrl' => $v . rawurlencode($targetUrl), 'proxyClient' => null];
            }
            if (str_contains($v, '?')) {
                return ['effectiveUrl' => $v . '&url=' . rawurlencode($targetUrl), 'proxyClient' => null];
            }
            return ['effectiveUrl' => rtrim($v, '/') . '/?url=' . rawurlencode($targetUrl), 'proxyClient' => null];
        }
        if (preg_match('#^(https?|socks5h?|socks4a?)://#i', $v)) {
            return ['effectiveUrl' => $targetUrl, 'proxyClient' => $v];
        }
        return ['effectiveUrl' => $targetUrl, 'proxyClient' => null];
    }

    /** @return array{effectiveUrl:string, proxyClient:?string} */
    public static function proxyConfig(string $targetUrl, ?string $customProxyUrl = null): array
    {
        if ($customProxyUrl !== null && trim($customProxyUrl) !== '') {
            return self::parseProxySetting($customProxyUrl, $targetUrl);
        }
        if (!self::rawBool('AGENT_PROXY_ENABLED', false)) {
            return ['effectiveUrl' => $targetUrl, 'proxyClient' => null];
        }
        return self::parseProxySetting(self::raw('AGENT_PROXY_URL', self::DEFAULT_PROXY_URL), $targetUrl);
    }
}
