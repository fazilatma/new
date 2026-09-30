<?php

/**
 * Symmetric encryption for provider API keys.
 *
 * Keys are stored encrypted so a leaked database file is not a leaked wallet.
 * The master key lives in a separate file outside version control; if it is
 * lost the stored keys are unrecoverable, which is the intended trade.
 */

declare(strict_types=1);

namespace Arena;

final class Crypto
{
    private const PREFIX = 'enc:v1:';

    private static ?string $key = null;

    private static function key(): string
    {
        if (self::$key !== null) {
            return self::$key;
        }
        $fromEnv = Bootstrap::env('ARENA_MASTER_KEY');
        if ($fromEnv !== null && strlen($fromEnv) >= 32) {
            return self::$key = substr(hash('sha256', $fromEnv, true), 0, 32);
        }
        $path = Bootstrap::$dataDir . '/master.key';
        if (is_file($path)) {
            $raw = (string) file_get_contents($path);
            if (strlen($raw) >= 32) {
                return self::$key = substr($raw, 0, 32);
            }
        }
        $raw = random_bytes(32);
        if (@file_put_contents($path, $raw, LOCK_EX) !== false) {
            @chmod($path, 0600);
        }
        return self::$key = $raw;
    }

    public static function available(): bool
    {
        return function_exists('openssl_encrypt') || function_exists('sodium_crypto_secretbox');
    }

    public static function encrypt(string $plain): string
    {
        if ($plain === '') {
            return '';
        }
        if (self::isEncrypted($plain)) {
            return $plain;
        }
        if (function_exists('openssl_encrypt')) {
            $iv = random_bytes(12);
            $tag = '';
            $cipher = openssl_encrypt($plain, 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, $iv, $tag);
            if ($cipher === false) {
                return $plain;
            }
            return self::PREFIX . base64_encode($iv . $tag . $cipher);
        }
        if (function_exists('sodium_crypto_secretbox')) {
            $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
            $cipher = sodium_crypto_secretbox($plain, $nonce, self::key());
            return self::PREFIX . base64_encode($nonce . $cipher);
        }
        return $plain;   // stored as-is; /api/diag reports this
    }

    public static function decrypt(string $value): string
    {
        if (!self::isEncrypted($value)) {
            return $value;
        }
        $raw = base64_decode(substr($value, strlen(self::PREFIX)), true);
        if ($raw === false || $raw === '') {
            return '';
        }
        if (function_exists('openssl_encrypt')) {
            $iv = substr($raw, 0, 12);
            $tag = substr($raw, 12, 16);
            $cipher = substr($raw, 28);
            $plain = openssl_decrypt($cipher, 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, $iv, $tag);
            if (is_string($plain)) {
                return $plain;
            }
        }
        if (function_exists('sodium_crypto_secretbox_open')) {
            $nonce = substr($raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
            $cipher = substr($raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
            $plain = sodium_crypto_secretbox_open($cipher, $nonce, self::key());
            if (is_string($plain)) {
                return $plain;
            }
        }
        return '';
    }

    public static function isEncrypted(string $v): bool
    {
        return str_starts_with($v, self::PREFIX);
    }

    /** Last four characters, for showing that a key is present without leaking it. */
    public static function hint(string $stored): string
    {
        $plain = self::decrypt($stored);
        if ($plain === '') {
            return '';
        }
        return strlen($plain) <= 8 ? '••••' : '••••' . substr($plain, -4);
    }
}
