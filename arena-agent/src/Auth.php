<?php

/**
 * Sessions, roles and rate limiting.
 *
 * Tokens are opaque random strings stored hashed-by-value in `sessions`. They
 * travel in an HttpOnly cookie by default and may also be supplied as a
 * bearer token so the same API is usable from a script.
 */

declare(strict_types=1);

namespace Arena;

final class Auth
{
    public const ROLES = ['viewer' => 1, 'developer' => 2, 'admin' => 3];
    private const COOKIE = 'arena_session';

    /**
     * The caller of the current request. The request object is the real home
     * for this, but audit records are written from deep inside code that has
     * no reason to be handed a Request, so it is mirrored here.
     */
    private static ?array $current = null;
    private const TTL = 86400 * 14;

    /** Resolve the caller and attach them to the request. Never throws. */
    public static function resolve(Request $req): void
    {
        if (!Bootstrap::authEnabled()) {
            $req->user = ['id' => 'dev', 'username' => 'dev', 'role' => 'admin', 'authDisabled' => true];
            self::$current = $req->user;
            return;
        }
        $token = self::tokenFrom($req);
        if ($token === '') {
            return;
        }
        $row = Db::one(
            'SELECT u.id, u.username, u.role, s.expires_at
               FROM sessions s JOIN users u ON u.id = s.user_id
              WHERE s.token = ?',
            [$token]
        );
        if ($row === null) {
            return;
        }
        if ((int) $row['expires_at'] < time()) {
            Db::run('DELETE FROM sessions WHERE token = ?', [$token]);
            return;
        }
        unset($row['expires_at']);
        $req->user = $row;
        self::$current = $row;
    }

    private static function tokenFrom(Request $req): string
    {
        $auth = $req->header('authorization');
        if (stripos($auth, 'bearer ') === 0) {
            return trim(substr($auth, 7));
        }
        return (string) ($_COOKIE[self::COOKIE] ?? '');
    }

    /** @return array{token:string,user:array<string,mixed>} */
    public static function login(string $username, string $password): array
    {
        self::throttle('login:' . $username, 10, 300);
        $user = Db::one('SELECT * FROM users WHERE username = ?', [$username]);
        if ($user === null || !password_verify($password, (string) $user['password'])) {
            Db::audit($username, 'login.failed');
            throw new HttpError(401, 'Incorrect username or password');
        }
        $token = bin2hex(random_bytes(32));
        Db::run('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?,?,?,?)', [
            $token, $user['id'], time() + self::TTL, Db::now(),
        ]);
        self::setCookie($token, time() + self::TTL);
        Db::audit($username, 'login.ok');
        return ['token' => $token, 'user' => [
            'id' => $user['id'], 'username' => $user['username'], 'role' => $user['role'],
        ]];
    }

    public static function logout(Request $req): void
    {
        $token = self::tokenFrom($req);
        if ($token !== '') {
            Db::run('DELETE FROM sessions WHERE token = ?', [$token]);
        }
        self::setCookie('', time() - 3600);
    }

    private static function setCookie(string $value, int $expires): void
    {
        if (headers_sent()) {
            return;
        }
        $secure = (($_SERVER['HTTPS'] ?? '') !== '' && ($_SERVER['HTTPS'] ?? '') !== 'off')
            || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
        setcookie(self::COOKIE, $value, [
            'expires' => $expires,
            'path' => Request::$dir === '' ? '/' : Request::$dir . '/',
            'httponly' => true,
            'samesite' => 'Lax',
            'secure' => $secure,
        ]);
    }

    /** Username of whoever is making this request, for the audit log. */
    public static function currentName(): string
    {
        return (string) (self::$current['username'] ?? 'system');
    }

    public static function require(Request $req, string $role = 'viewer'): array
    {
        if ($req->user === null) {
            throw new HttpError(401, 'Sign in to continue');
        }
        $have = self::ROLES[(string) ($req->user['role'] ?? 'viewer')] ?? 0;
        $need = self::ROLES[$role] ?? 99;
        if ($have < $need) {
            throw new HttpError(403, "This action requires the {$role} role");
        }
        return $req->user;
    }

    /** Fixed-window limiter kept in SQLite; good enough for a single host. */
    public static function throttle(string $bucket, int $limit, int $window): void
    {
        $key = 'rl:' . $bucket;
        $now = time();
        $raw = Db::setting($key);
        $state = $raw === null ? null : json_decode($raw, true);
        if (!is_array($state) || (int) ($state['start'] ?? 0) + $window < $now) {
            $state = ['start' => $now, 'count' => 0];
        }
        $state['count'] = (int) $state['count'] + 1;
        Db::setSetting($key, (string) json_encode($state));
        if ($state['count'] > $limit) {
            $retry = max(1, (int) $state['start'] + $window - $now);
            throw new HttpError(429, "Too many attempts. Try again in {$retry}s.");
        }
    }
}
