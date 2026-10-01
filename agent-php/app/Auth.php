<?php
/**
 * Session auth, RBAC, the auth middleware and user management.
 * Port of agent-python/app/auth.py.
 */

declare(strict_types=1);

namespace Arena;

final class Auth
{
    public const SESSION_COOKIE = Security::SESSION_COOKIE;

    public const ANONYMOUS_ADMIN = [
        'id' => 'anonymous-admin',
        'username' => 'admin',
        'role' => Security::ROLE_ADMIN,
        'full_name' => 'Anonymous Superuser',
    ];

    /** Port of `public_paths` in auth_middleware. */
    public const PUBLIC_PATHS = [
        '/health',
        '/api/version',
        '/api/auth/status',
        '/api/auth/login',
        '/docs',
        '/openapi.json',
        '/redoc',
    ];

    public const VALID_ROLES = [Security::ROLE_ADMIN, Security::ROLE_DEVELOPER, Security::ROLE_VIEWER];

    public static function sessionToken(Request $req): string
    {
        $cookie = $req->cookies[self::SESSION_COOKIE] ?? '';
        if ($cookie !== '') {
            return (string) $cookie;
        }
        $authHeader = (string) $req->header('authorization', '');
        if (str_starts_with($authHeader, 'Bearer ')) {
            return trim(substr($authHeader, 7));
        }
        return (string) $req->header('x-auth-token', '');
    }

    public static function currentUserOptional(Request $req): ?array
    {
        $token = self::sessionToken($req);
        return $token === '' ? null : Security::validateSession($token);
    }

    /**
     * Rate limiting on /api/*, then session enforcement outside the public
     * path list. Returns true when the request may continue; when it returns
     * false the response has already been written.
     */
    public static function middleware(Request $req): bool
    {
        $path = $req->path;
        $ip = $req->clientIp();

        if (str_starts_with($path, '/api/')) {
            $configured = Config::rateLimitPerMinute();
            $limit = str_contains($path, 'login') ? 30 : $configured;
            if (!Security::checkRateLimit("rate:{$ip}:{$path}", $limit, 60)) {
                Security::logEvent('RATE_LIMIT_EXCEEDED', 'blocked', "Rate limit exceeded on {$path}", $ip);
                Response::json(['detail' => 'Rate limit exceeded. Please try again later.'], 429);
                return false;
            }
        }

        if (!Config::authEnabled()) {
            $req->user = self::ANONYMOUS_ADMIN;
            return true;
        }

        $user = self::currentUserOptional($req);
        if ($user !== null) {
            $req->user = $user;
        }

        if (in_array($path, self::PUBLIC_PATHS, true)) {
            return true;
        }

        if ($user === null && str_starts_with($path, '/api/')) {
            Security::logEvent('UNAUTHORIZED_API_ACCESS', 'failed', "Unauthorized access to {$path}", $ip);
            Response::json(['detail' => 'Authentication required'], 401);
            return false;
        }

        return true;
    }

    /** Port of `get_current_user` — 401 when auth is on and no session exists. */
    public static function requireUser(Request $req): array
    {
        if ($req->user !== null) {
            return $req->user;
        }
        if (!Config::authEnabled()) {
            return self::ANONYMOUS_ADMIN;
        }
        throw new HttpError(401, 'Authentication required');
    }

    /** Port of `require_role([...])`. */
    public static function requireRole(Request $req, array $allowedRoles): array
    {
        if (!Config::authEnabled()) {
            return $req->user ?? self::ANONYMOUS_ADMIN;
        }
        $user = $req->user;
        if ($user === null) {
            throw new HttpError(401, 'Authentication required');
        }
        if (!in_array($user['role'] ?? '', $allowedRoles, true)) {
            Security::logEvent(
                'PERMISSION_DENIED',
                'failed',
                "{$req->method} {$req->path} requires " . implode(', ', $allowedRoles),
                $req->clientIp(),
                (string) ($user['id'] ?? '')
            );
            throw new HttpError(403, 'Permission denied. Required role: ' . implode(', ', $allowedRoles));
        }
        return $user;
    }

    public static function requireAdmin(Request $req): array
    {
        return self::requireRole($req, [Security::ROLE_ADMIN]);
    }

    public static function requireDeveloper(Request $req): array
    {
        return self::requireRole($req, [Security::ROLE_ADMIN, Security::ROLE_DEVELOPER]);
    }

    public static function requireViewer(Request $req): array
    {
        return self::requireRole($req, [Security::ROLE_ADMIN, Security::ROLE_DEVELOPER, Security::ROLE_VIEWER]);
    }

    /* -------------------------------------------------------------- */
    /* Login / logout                                                  */
    /* -------------------------------------------------------------- */

    private static function setSessionCookie(string $token): void
    {
        Response::setCookie(self::SESSION_COOKIE, $token, Security::SESSION_TTL_HOURS * 3600);
    }

    public static function status(Request $req): array
    {
        if (!Config::authEnabled()) {
            return [
                'enabled' => false,
                'authenticated' => true,
                'user' => self::ANONYMOUS_ADMIN,
            ];
        }
        $user = self::currentUserOptional($req);
        return [
            'enabled' => true,
            'authenticated' => $user !== null,
            'user' => $user,
        ];
    }

    public static function login(Request $req, array $payload): array
    {
        $ip = $req->clientIp();
        $ua = $req->userAgent();

        // 1. Direct environment token login.
        $token = trim((string) ($payload['token'] ?? ''));
        if ($token !== '') {
            $envToken = Config::raw('AGENT_AUTH_TOKEN', '');
            if ($envToken !== '' && hash_equals($envToken, $token)) {
                $sessionToken = Security::createSession('env-admin', $ip, $ua);
                self::setSessionCookie($sessionToken);
                Security::logEvent('LOGIN_SUCCESS_TOKEN', 'success', 'Admin logged in via token', $ip, 'env-admin');
                return [
                    'ok' => true,
                    'token' => $sessionToken,
                    'user' => ['id' => 'env-admin', 'username' => 'admin', 'role' => Security::ROLE_ADMIN, 'full_name' => 'Environment Admin'],
                ];
            }
        }

        // 2. Username / password login.
        $username = trim((string) ($payload['username'] ?? ''));
        $password = (string) ($payload['password'] ?? '');
        if ($username !== '' && $password !== '') {
            $row = Database::one(
                'SELECT id, username, password_hash, salt, role, full_name FROM users WHERE username = ?',
                [$username]
            );
            if ($row !== null && Crypto::verifyPassword($password, (string) $row['password_hash'], (string) $row['salt'])) {
                $sessionToken = Security::createSession((string) $row['id'], $ip, $ua);
                self::setSessionCookie($sessionToken);
                Security::logEvent('LOGIN_SUCCESS', 'success', "User {$row['username']} logged in", $ip, (string) $row['id']);
                return [
                    'ok' => true,
                    'token' => $sessionToken,
                    'user' => [
                        'id' => $row['id'],
                        'username' => $row['username'],
                        'role' => $row['role'],
                        'full_name' => $row['full_name'],
                    ],
                ];
            }
        }

        Security::logEvent('LOGIN_FAILED', 'failed', "Failed login attempt for username: {$username}", $ip);
        throw new HttpError(401, 'Invalid username or password');
    }

    public static function logout(Request $req): void
    {
        $token = self::sessionToken($req);
        if ($token !== '') {
            Security::deleteSession($token);
        }
        Response::clearCookie(self::SESSION_COOKIE);
    }

    public static function changePassword(Request $req, string $oldPassword, string $newPassword): void
    {
        $user = self::requireUser($req);
        $uid = (string) ($user['id'] ?? '');
        if ($uid === 'env-admin' || $uid === 'anonymous-admin') {
            throw new HttpError(400, 'Cannot change password for environment admin. Update AGENT_AUTH_TOKEN in configuration.');
        }
        if (strlen($newPassword) < 6) {
            throw new HttpError(400, 'New password must be at least 6 characters long');
        }
        $row = Database::one('SELECT password_hash, salt FROM users WHERE id = ?', [$uid]);
        if ($row === null || !Crypto::verifyPassword($oldPassword, (string) $row['password_hash'], (string) $row['salt'])) {
            throw new HttpError(400, 'Incorrect current password');
        }
        [$hash, $salt] = Crypto::hashPassword($newPassword);
        Database::run(
            "UPDATE users SET password_hash = ?, salt = ?, updated_at = datetime('now') WHERE id = ?",
            [$hash, $salt, $uid]
        );
        Security::logEvent('PASSWORD_CHANGED', 'success', "User {$user['username']} changed password", $req->clientIp(), $uid);
    }

    /* -------------------------------------------------------------- */
    /* User management                                                 */
    /* -------------------------------------------------------------- */

    public static function users(): array
    {
        return Database::all(
            'SELECT id, username, role, full_name, is_active, created_at, last_login
             FROM users ORDER BY created_at ASC'
        );
    }

    public static function createUser(string $username, string $password, string $role = Security::ROLE_DEVELOPER, string $fullName = ''): array
    {
        if (!in_array($role, self::VALID_ROLES, true)) {
            throw new HttpError(400, 'Invalid role');
        }
        $name = trim($username);
        if ($name === '' || $password === '') {
            throw new HttpError(400, 'Username and password are required');
        }
        [$hash, $salt] = Crypto::hashPassword($password);
        $id = 'user-' . Crypto::hex(3);
        try {
            Database::run(
                'INSERT INTO users (id, username, password_hash, salt, role, full_name) VALUES (?,?,?,?,?,?)',
                [$id, $name, $hash, $salt, $role, $fullName]
            );
        } catch (\Throwable $e) {
            throw new HttpError(400, 'Could not create user: ' . $e->getMessage());
        }
        Security::logEvent('USER_CREATED', 'success', "Created user {$name} ({$role})");
        return ['id' => $id, 'username' => $name, 'role' => $role];
    }

    public static function updateUserRole(string $userId, string $role): void
    {
        if (!in_array($role, self::VALID_ROLES, true)) {
            throw new HttpError(400, 'Invalid role');
        }
        Database::run("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?", [$role, $userId]);
    }

    public static function deleteUser(string $userId, string $actingUserId): void
    {
        if ($userId === $actingUserId) {
            throw new HttpError(400, 'Cannot delete your own active account');
        }
        Database::run('DELETE FROM sessions WHERE user_id = ?', [$userId]);
        Database::run('DELETE FROM users WHERE id = ?', [$userId]);
        Security::logEvent('USER_DELETED', 'success', "Deleted user {$userId}");
    }
}
