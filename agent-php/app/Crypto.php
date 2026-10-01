<?php
/**
 * Hashing, token generation and at-rest encryption for provider API keys.
 * Port of agent-python/app/security.py (hashlib/secrets) — here with
 * hash_pbkdf2() and openssl_encrypt(), byte-compatible with the Python version
 * so an existing SQLite file keeps working.
 */

declare(strict_types=1);

namespace Arena;

final class Crypto
{
    public const PBKDF2_ITERATIONS = 100000;

    /** @return array{0:string,1:string} [hash, salt] — hex encoded, same as Python. */
    public static function hashPassword(string $password, ?string $salt = null): array
    {
        $salt = $salt ?: bin2hex(random_bytes(16));
        $hash = hash_pbkdf2('sha256', $password, $salt, self::PBKDF2_ITERATIONS, 0, false);
        return [$hash, $salt];
    }

    public static function verifyPassword(string $password, string $hash, string $salt): bool
    {
        [$computed] = self::hashPassword($password, $salt);
        return hash_equals($hash, $computed);
    }

    /** URL-safe token, equivalent to Python's secrets.token_urlsafe(32). */
    public static function token(int $bytes = 32): string
    {
        return rtrim(strtr(base64_encode(random_bytes($bytes)), '+/', '-_'), '=');
    }

    public static function hex(int $bytes = 16): string
    {
        return bin2hex(random_bytes($bytes));
    }

    private static function secretKey(): string
    {
        $secret = getenv('AGENT_SECRET_KEY') ?: '';
        if ($secret === '') {
            // Derive a stable per-install key and persist it so restarts can
            // still decrypt stored provider keys.
            $stored = Database::state('__secret_key');
            if ($stored === null || $stored === '') {
                $stored = self::hex(32);
                Database::setState('__secret_key', $stored);
            }
            $secret = $stored;
        }
        return hash('sha256', $secret, true);
    }

    /** AES-256-GCM, output "enc:v1:<base64(iv|tag|ciphertext)>". */
    public static function encrypt(string $plain): string
    {
        if ($plain === '' || !function_exists('openssl_encrypt')) {
            return $plain;
        }
        $iv = random_bytes(12);
        $tag = '';
        $cipher = openssl_encrypt($plain, 'aes-256-gcm', self::secretKey(), OPENSSL_RAW_DATA, $iv, $tag);
        if ($cipher === false) {
            return $plain;
        }
        return 'enc:v1:' . base64_encode($iv . $tag . $cipher);
    }

    public static function decrypt(string $value): string
    {
        if (!str_starts_with($value, 'enc:v1:') || !function_exists('openssl_decrypt')) {
            return $value;
        }
        $raw = base64_decode(substr($value, 7), true);
        if ($raw === false || strlen($raw) < 29) {
            return '';
        }
        $iv = substr($raw, 0, 12);
        $tag = substr($raw, 12, 16);
        $cipher = substr($raw, 28);
        $plain = openssl_decrypt($cipher, 'aes-256-gcm', self::secretKey(), OPENSSL_RAW_DATA, $iv, $tag);
        return $plain === false ? '' : $plain;
    }

    /** "tes••••••••7890" — identical masking to the Python/Workers versions. */
    public static function maskKey(string $key): string
    {
        $len = strlen($key);
        if ($len === 0) {
            return '';
        }
        if ($len <= 8) {
            return str_repeat('•', $len);
        }
        return substr($key, 0, 3) . '••••••••' . substr($key, -4);
    }

    public static function sha256(string $data): string
    {
        return hash('sha256', $data);
    }
}
