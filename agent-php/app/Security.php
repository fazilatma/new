<?php
/**
 * Sessions, rate limiting, audit logging, token masking, RBAC helpers.
 * Port of agent-python/app/security.py.
 */

declare(strict_types=1);

namespace Arena;

final class Security
{
    public const ROLE_ADMIN = 'Admin';
    public const ROLE_DEVELOPER = 'Developer';
    public const ROLE_VIEWER = 'Viewer';
    public const SESSION_TTL_HOURS = 24;
    public const SESSION_COOKIE = 'arena_session';

    private const SENSITIVE_PATTERNS = [
        '/(Bearer\s+)([A-Za-z0-9_\-\.]{8,})/i',
        '/((?:key|token|password|secret|authorization)["\']?\s*[:=]\s*["\']?)([A-Za-z0-9_\-\.]{8,})(["\']?)/i',
        '/(sk-[A-Za-z0-9_\-]{10,})/i',
        '/(ghp_[A-Za-z0-9]{20,})/i',
    ];

    // ------------------------------------------------------------- sessions

    public static function createSession(string $userId, string $ip = '', string $userAgent = ''): string
    {
        $token = Crypto::token(32);
        $expiresAt = microtime(true) + (self::SESSION_TTL_HOURS * 3600);
        $sessionId = Crypto::hex(16);

        if (!Database::exists('SELECT id FROM users WHERE id = ?', [$userId])) {
            Database::run(
                "INSERT OR IGNORE INTO users (id, username, password_hash, salt, role, full_name)
                 VALUES (?,?,'env','env','Admin',?)",
                [$userId, $userId, $userId]
            );
        }
        Database::run(
            'INSERT INTO sessions (id, user_id, token, expires_at, ip_address, user_agent) VALUES (?,?,?,?,?,?)',
            [$sessionId, $userId, $token, $expiresAt, $ip, $userAgent]
        );
        return $token;
    }

    public static function validateSession(string $token): ?array
    {
        if ($token === '') {
            return null;
        }
        $envToken = Config::raw('AGENT_AUTH_TOKEN', '');
        if ($envToken !== '' && hash_equals($envToken, $token)) {
            return [
                'id' => 'env-admin',
                'username' => 'env-admin',
                'role' => self::ROLE_ADMIN,
                'full_name' => 'Environment Admin',
            ];
        }
        $row = Database::one(
            'SELECT u.id, u.username, u.role, u.full_name, s.id AS session_id, s.expires_at
             FROM sessions s JOIN users u ON s.user_id = u.id
             WHERE s.token = ? AND s.expires_at > ?',
            [$token, microtime(true)]
        );
        if ($row === null) {
            return null;
        }
        Database::run("UPDATE sessions SET last_active = datetime('now') WHERE id = ?", [$row['session_id']]);
        return [
            'id' => $row['id'],
            'username' => $row['username'],
            'role' => $row['role'],
            'full_name' => $row['full_name'],
            'session_id' => $row['session_id'],
        ];
    }

    public static function renewSession(string $token): bool
    {
        $now = microtime(true);
        $stmt = Database::run(
            'UPDATE sessions SET expires_at = ? WHERE token = ? AND expires_at > ?',
            [$now + (self::SESSION_TTL_HOURS * 3600), $token, $now]
        );
        return $stmt->rowCount() > 0;
    }

    public static function deleteSession(string $token): bool
    {
        return Database::run('DELETE FROM sessions WHERE token = ?', [$token])->rowCount() > 0;
    }

    public static function deleteAllUserSessions(string $userId): int
    {
        return Database::run('DELETE FROM sessions WHERE user_id = ?', [$userId])->rowCount();
    }

    public static function purgeExpiredSessions(): int
    {
        return Database::run('DELETE FROM sessions WHERE expires_at < ?', [microtime(true)])->rowCount();
    }

    // ---------------------------------------------------------- rate limits

    /**
     * Sliding-ish window counter backed by SQLite (the Workers port could only
     * do this per-isolate; here every PHP process shares the same table).
     */
    public static function checkRateLimit(string $key, int $limit = 120, int $windowSeconds = 60): bool
    {
        $window = (int) (time() / max(1, $windowSeconds));
        try {
            Database::run(
                'INSERT INTO rate_limits (bucket, window_start, hits) VALUES (?,?,1)
                 ON CONFLICT(bucket, window_start) DO UPDATE SET hits = hits + 1',
                [$key, $window]
            );
            $hits = (int) Database::scalar(
                'SELECT hits FROM rate_limits WHERE bucket = ? AND window_start = ?',
                [$key, $window]
            );
            if (random_int(1, 200) === 1) {
                Database::run('DELETE FROM rate_limits WHERE window_start < ?', [$window - 5]);
            }
            return $hits <= $limit;
        } catch (\Throwable) {
            return true; // never lock the user out because of a storage hiccup
        }
    }

    // --------------------------------------------------------------- audit

    public static function logEvent(
        string $event,
        string $status,
        string $details = '',
        string $ip = '',
        string $userId = ''
    ): void {
        try {
            Database::run(
                'INSERT INTO security_logs (ip, user_id, event, status, details) VALUES (?,?,?,?,?)',
                [$ip, $userId, $event, $status, self::maskLogTokens($details)]
            );
        } catch (\Throwable) {
            // auditing must never break a request
        }
    }

    public static function maskLogTokens(?string $text): string
    {
        if ($text === null || $text === '') {
            return '';
        }
        $result = $text;
        foreach (self::SENSITIVE_PATTERNS as $i => $pattern) {
            $replacement = $i === 1 ? '$1••••••••$3' : '$1••••••••';
            if ($i >= 2) {
                $replacement = '••••••••';
            }
            $result = (string) preg_replace($pattern, $replacement, $result);
        }
        return $result;
    }

    // ---------------------------------------------------------------- RBAC

    public static function roleRank(string $role): int
    {
        return match ($role) {
            self::ROLE_ADMIN => 3,
            self::ROLE_DEVELOPER => 2,
            self::ROLE_VIEWER => 1,
            default => 0,
        };
    }

    public static function requireRole(?array $user, string $minimumRole): void
    {
        if (!Config::authEnabled()) {
            return;
        }
        $role = (string) ($user['role'] ?? '');
        if (self::roleRank($role) < self::roleRank($minimumRole)) {
            throw new HttpError(403, "Insufficient permissions. {$minimumRole} role required.");
        }
    }

    /** Blocks path traversal attempts before they reach the filesystem layer. */
    public static function assertSafeRelativePath(string $path): void
    {
        $normalised = str_replace('\\', '/', $path);
        if (str_contains($normalised, '../') || str_starts_with($normalised, '/') || preg_match('/^[A-Za-z]:/', $normalised)) {
            throw new HttpError(400, 'Invalid path: traversal outside the workspace is not allowed');
        }
    }

    // ----------------------------------------------------------- CSRF (opt)

    public static function generateCsrfToken(string $sessionId): string
    {
        $token = Crypto::hex(16);
        Database::setState('csrf:' . $sessionId . ':' . $token, (string) (time() + 86400));
        return $token;
    }

    public static function validateCsrfToken(string $sessionId, string $token): bool
    {
        $exp = Database::state('csrf:' . $sessionId . ':' . $token);
        return $exp !== null && (int) $exp > time();
    }
}
