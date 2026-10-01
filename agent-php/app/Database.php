<?php
/**
 * SQLite storage via PDO. Port of agent-python/app/database.py.
 *
 * On Cloudflare this was D1; here we are back on a real local SQLite file with
 * WAL journaling, which also lets the CLI job worker share the database with
 * the web front controller.
 */

declare(strict_types=1);

namespace Arena;

final class Database
{
    private static ?\PDO $pdo = null;
    private static bool $initialised = false;

    public static function path(): string
    {
        $env = getenv('AGENT_DB_PATH');
        if ($env !== false && $env !== '') {
            return $env;
        }
        return Bootstrap::$storageDir . '/agent.db';
    }

    public static function pdo(): \PDO
    {
        if (self::$pdo instanceof \PDO) {
            return self::$pdo;
        }
        $path = self::path();
        $dir = dirname($path);
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        $pdo = new \PDO('sqlite:' . $path, null, null, [
            \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
            \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
            \PDO::ATTR_EMULATE_PREPARES => false,
            \PDO::ATTR_TIMEOUT => 15,
        ]);
        $pdo->exec('PRAGMA journal_mode = WAL');
        $pdo->exec('PRAGMA synchronous = NORMAL');
        $pdo->exec('PRAGMA foreign_keys = ON');
        $pdo->exec('PRAGMA busy_timeout = 15000');
        self::$pdo = $pdo;
        return $pdo;
    }

    public static function init(): void
    {
        if (self::$initialised) {
            return;
        }
        self::$initialised = true;
        $pdo = self::pdo();
        $sqlFile = Bootstrap::$root . '/migrations/0001_init.sql';
        if (is_file($sqlFile)) {
            $pdo->exec((string) file_get_contents($sqlFile));
        }
        self::seed();
    }

    /** Bootstrap default rows: admin user, default project/workspace. */
    private static function seed(): void
    {
        $pdo = self::pdo();

        $userCount = (int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
        if ($userCount === 0) {
            $password = getenv('AGENT_INITIAL_ADMIN_PASSWORD') ?: 'admin123';
            [$hash, $salt] = Crypto::hashPassword($password);
            self::run(
                'INSERT INTO users (id, username, password_hash, salt, role, full_name) VALUES (?,?,?,?,?,?)',
                ['user-admin', 'admin', $hash, $salt, 'Admin', 'Administrator']
            );
            Observability::log('INFO', 'AUTH', 'Bootstrapped default admin user "admin"');
        }

        $projCount = (int) $pdo->query("SELECT COUNT(*) FROM projects WHERE id = 'proj-default'")->fetchColumn();
        if ($projCount === 0) {
            self::run(
                'INSERT INTO projects (id, name, description, path, is_default) VALUES (?,?,?,?,1)',
                ['proj-default', 'Primary Project', 'Default project', Bootstrap::$workspacesDir . '/default']
            );
        }

        $wsCount = (int) $pdo->query("SELECT COUNT(*) FROM workspaces WHERE id = 'default'")->fetchColumn();
        if ($wsCount === 0) {
            self::run(
                'INSERT INTO workspaces (id, name, path, is_default) VALUES (?,?,?,1)',
                ['default', 'Main Project', Bootstrap::$workspacesDir . '/default']
            );
        }

        if (self::state('active_workspace_id') === null) {
            self::setState('active_workspace_id', 'default');
        }
        if (self::state('active_project_id') === null) {
            self::setState('active_project_id', 'proj-default');
        }
    }

    // ---------------------------------------------------------------- queries

    public static function run(string $sql, array $params = []): \PDOStatement
    {
        $stmt = self::pdo()->prepare($sql);
        $stmt->execute(self::normalise($params));
        return $stmt;
    }

    public static function all(string $sql, array $params = []): array
    {
        return self::run($sql, $params)->fetchAll();
    }

    public static function one(string $sql, array $params = []): ?array
    {
        $row = self::run($sql, $params)->fetch();
        return $row === false ? null : $row;
    }

    public static function scalar(string $sql, array $params = []): mixed
    {
        $v = self::run($sql, $params)->fetchColumn();
        return $v === false ? null : $v;
    }

    public static function exists(string $sql, array $params = []): bool
    {
        return self::one($sql, $params) !== null;
    }

    public static function transaction(callable $fn): mixed
    {
        $pdo = self::pdo();
        if ($pdo->inTransaction()) {
            return $fn($pdo);
        }
        $pdo->beginTransaction();
        try {
            $result = $fn($pdo);
            $pdo->commit();
            return $result;
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }

    private static function normalise(array $params): array
    {
        $out = [];
        foreach ($params as $k => $v) {
            if (is_bool($v)) {
                $v = $v ? 1 : 0;
            } elseif (is_array($v) || is_object($v)) {
                $v = json_encode($v, JSON_UNESCAPED_UNICODE);
            }
            $out[$k] = $v;
        }
        return $out;
    }

    // ------------------------------------------------------------- app_state

    public static function state(string $key, ?string $default = null): ?string
    {
        $v = self::scalar('SELECT value FROM app_state WHERE key = ?', [$key]);
        return $v === null ? $default : (string) $v;
    }

    public static function setState(string $key, string $value): void
    {
        self::run(
            "INSERT INTO app_state (key, value, updated_at) VALUES (?,?,datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
            [$key, $value]
        );
    }

    public static function stateJson(string $key, mixed $default = null): mixed
    {
        $raw = self::state($key);
        if ($raw === null || $raw === '') {
            return $default;
        }
        $decoded = json_decode($raw, true);
        return $decoded === null ? $default : $decoded;
    }

    public static function setStateJson(string $key, mixed $value): void
    {
        self::setState($key, (string) json_encode($value, JSON_UNESCAPED_UNICODE));
    }

    public static function now(): string
    {
        return gmdate('Y-m-d H:i:s');
    }

    /** Sortable, collision-resistant id, matching the Python `uuid4().hex[:12]` style. */
    public static function id(string $prefix = ''): string
    {
        $hex = bin2hex(random_bytes(6));
        return $prefix !== '' ? $prefix . '-' . $hex : $hex;
    }
}
