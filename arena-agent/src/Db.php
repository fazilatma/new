<?php

/**
 * SQLite storage and schema migrations.
 *
 * Everything lives in one file so a backup is a file copy, and the schema is
 * applied idempotently at boot — there is no separate migrate step to forget.
 */

declare(strict_types=1);

namespace Arena;

final class Db
{
    private static ?\PDO $pdo = null;

    public static function path(): string
    {
        return Bootstrap::$dataDir . '/arena.sqlite';
    }

    public static function pdo(): \PDO
    {
        if (self::$pdo instanceof \PDO) {
            return self::$pdo;
        }
        if (!in_array('sqlite', \PDO::getAvailableDrivers(), true)) {
            throw new HttpError(500, 'The pdo_sqlite extension is not enabled in this PHP build.');
        }
        $dir = dirname(self::path());
        if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new HttpError(500, "Data directory is not creatable: $dir");
        }
        if (!is_writable($dir)) {
            throw new HttpError(500, "Data directory is not writable: $dir");
        }
        $pdo = new \PDO('sqlite:' . self::path(), null, null, [
            \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
            \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
        ]);
        $pdo->exec('PRAGMA journal_mode = WAL');
        $pdo->exec('PRAGMA foreign_keys = ON');
        $pdo->exec('PRAGMA busy_timeout = 5000');
        self::$pdo = $pdo;
        self::migrate($pdo);
        return $pdo;
    }

    private static function migrate(\PDO $pdo): void
    {
        $pdo->exec(<<<'SQL'
            CREATE TABLE IF NOT EXISTS users (
                id          TEXT PRIMARY KEY,
                username    TEXT NOT NULL UNIQUE,
                password    TEXT NOT NULL,
                role        TEXT NOT NULL DEFAULT 'viewer',
                created_at  TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token       TEXT PRIMARY KEY,
                user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at  INTEGER NOT NULL,
                created_at  TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS providers (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                protocol    TEXT NOT NULL DEFAULT 'openai',
                base_url    TEXT NOT NULL DEFAULT '',
                api_key     TEXT NOT NULL DEFAULT '',
                enabled     INTEGER NOT NULL DEFAULT 1,
                position    INTEGER NOT NULL DEFAULT 0,
                extra       TEXT NOT NULL DEFAULT '{}',
                created_at  TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS models (
                pk           INTEGER PRIMARY KEY AUTOINCREMENT,
                provider_id  TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
                model_id     TEXT NOT NULL,
                name         TEXT NOT NULL DEFAULT '',
                enabled      INTEGER NOT NULL DEFAULT 1,
                tools        INTEGER NOT NULL DEFAULT 0,
                vision       INTEGER NOT NULL DEFAULT 0,
                ctx_in       INTEGER NOT NULL DEFAULT 0,
                ctx_out      INTEGER NOT NULL DEFAULT 0,
                cost_in      REAL NOT NULL DEFAULT 0,
                cost_out     REAL NOT NULL DEFAULT 0,
                extra        TEXT NOT NULL DEFAULT '{}',
                UNIQUE (provider_id, model_id)
            );
            CREATE TABLE IF NOT EXISTS conversations (
                id          TEXT PRIMARY KEY,
                title       TEXT NOT NULL DEFAULT 'New chat',
                provider_id TEXT NOT NULL DEFAULT '',
                model_id    TEXT NOT NULL DEFAULT '',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                role            TEXT NOT NULL,
                content         TEXT NOT NULL,
                created_at      TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS settings (
                key     TEXT PRIMARY KEY,
                value   TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS audit (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                ts      TEXT NOT NULL,
                actor   TEXT NOT NULL DEFAULT '',
                action  TEXT NOT NULL,
                detail  TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);
            CREATE INDEX IF NOT EXISTS idx_models_provider ON models(provider_id);
            SQL);

        // Seed the first administrator only when there are no users at all.
        $count = (int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
        if ($count === 0) {
            $pdo->prepare('INSERT INTO users (id, username, password, role, created_at) VALUES (?,?,?,?,?)')
                ->execute([
                    self::uid('usr'),
                    Bootstrap::env('ARENA_ADMIN_USER', 'admin'),
                    password_hash(Bootstrap::env('ARENA_ADMIN_PASS', 'admin') ?? 'admin', PASSWORD_DEFAULT),
                    'admin',
                    self::now(),
                ]);
        }
    }

    public static function now(): string
    {
        return gmdate('Y-m-d\TH:i:s\Z');
    }

    public static function uid(string $prefix = ''): string
    {
        $raw = bin2hex(random_bytes(8));
        return $prefix === '' ? $raw : $prefix . '_' . $raw;
    }

    /** @param array<int,mixed> $args @return array<int,array<string,mixed>> */
    public static function all(string $sql, array $args = []): array
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($args);
        return $st->fetchAll();
    }

    /** @param array<int,mixed> $args @return array<string,mixed>|null */
    public static function one(string $sql, array $args = []): ?array
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($args);
        $row = $st->fetch();
        return $row === false ? null : $row;
    }

    /** @param array<int,mixed> $args */
    public static function run(string $sql, array $args = []): void
    {
        self::pdo()->prepare($sql)->execute($args);
    }

    public static function setting(string $key, ?string $default = null): ?string
    {
        $row = self::one('SELECT value FROM settings WHERE key = ?', [$key]);
        return $row === null ? $default : (string) $row['value'];
    }

    public static function setSetting(string $key, string $value): void
    {
        self::run(
            'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
            [$key, $value]
        );
    }

    public static function audit(?string $actor, string $action, string $detail = ''): void
    {
        try {
            self::run('INSERT INTO audit (ts, actor, action, detail) VALUES (?,?,?,?)', [
                self::now(), (string) $actor, $action, $detail,
            ]);
        } catch (\Throwable) {
            // Auditing must never break the request it is recording.
        }
    }
}
