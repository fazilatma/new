<?php
/**
 * The full HTTP API. Port of agent-python/app/main.py (FastAPI) — route paths,
 * HTTP verbs and JSON response shapes are preserved byte-for-byte so the
 * existing single-page UI in public/index.html runs unmodified.
 */

declare(strict_types=1);

namespace Arena;

final class Routes
{
    public static function register(Router $r): void
    {
        self::meta($r);
        self::auth($r);
        self::projects($r);
        self::workspaces($r);
        self::files($r);
        self::changesets($r);
        self::terminal($r);
        self::git($r);
        self::github($r);
        self::browser($r);
        self::chat($r);
        self::conversations($r);
        self::jobs($r);
        self::providers($r);
        self::config($r);
        self::observability($r);
        self::localAi($r);
        self::staticUi($r);
    }

    /* ------------------------------------------------------------ */
    /* Helpers                                                       */
    /* ------------------------------------------------------------ */

    /** Mirror of the `if conversation_id: activate session workspace` prelude. */
    private static function wsFor(?string $conversationId): array
    {
        if ($conversationId !== null && trim($conversationId) !== '') {
            try {
                $ws = Workspaces::getOrCreateSessionWorkspace($conversationId);
                Workspaces::setActive((string) $ws['id']);
                return $ws;
            } catch (\Throwable) {
                // fall through to the active workspace
            }
        }
        $ws = Workspaces::active();
        Workspaces::ensureRoot($ws);
        return $ws;
    }

    private static function convOf(Request $req): ?string
    {
        $v = $req->str('conversation_id', '') ?: $req->str('session_id', '') ?: $req->str('conversationId', '');
        return $v !== '' ? $v : null;
    }

    private static function username(Request $req): string
    {
        return (string) ($req->user['username'] ?? 'user');
    }

    private static function q(Request $req, string $key, string $default = ''): string
    {
        $v = $req->query[$key] ?? $default;
        return is_scalar($v) ? (string) $v : $default;
    }

    /* ------------------------------------------------------------ */
    /* Meta                                                          */
    /* ------------------------------------------------------------ */

    private static function meta(Router $r): void
    {
        $r->get('/api/version', static fn(Request $req): array => [
            'name' => 'Arena Coding Agent',
            'version' => APP_VERSION,
            'apiVersion' => APP_API_VERSION,
            'status' => 'ok',
        ]);

        $r->get('/health', static fn(Request $req): array => ['status' => 'ok', 'version' => APP_VERSION]);

        // Self-diagnosis for deployment problems (routing prefix, writability,
        // upload limits). Deliberately unauthenticated-safe: it exposes no
        // secrets, only whether the plumbing works.
        $r->get('/api/__diag', static function (Request $req): array {
            $dataDir = Bootstrap::$dataDir;
            $storageDir = Bootstrap::$storageDir;
            $providersFile = ProviderStore::file();

            $writable = static function (string $path): array {
                $target = is_file($path) ? $path : dirname($path);
                return [
                    'path' => $path,
                    'exists' => file_exists($path),
                    'writable' => is_writable($target),
                ];
            };

            return [
                'status' => 'ok',
                'version' => APP_VERSION,
                'routing' => [
                    'seenPath' => $req->path,
                    'apiBase' => Request::$basePath,
                    'rewriteWorking' => !Request::$viaFrontControllerPath,
                    'requestUri' => (string) ($_SERVER['REQUEST_URI'] ?? ''),
                    'scriptName' => (string) ($_SERVER['SCRIPT_NAME'] ?? ''),
                    'pathInfo' => (string) ($_SERVER['PATH_INFO'] ?? ''),
                    'serverSoftware' => (string) ($_SERVER['SERVER_SOFTWARE'] ?? ''),
                ],
                'limits' => [
                    'post_max_size' => ini_get('post_max_size') ?: '',
                    'upload_max_filesize' => ini_get('upload_max_filesize') ?: '',
                    'memory_limit' => ini_get('memory_limit') ?: '',
                    'max_execution_time' => ini_get('max_execution_time') ?: '',
                ],
                'paths' => [
                    'data' => $writable($dataDir),
                    'storage' => $writable($storageDir),
                    'providers' => $writable($providersFile),
                    'database' => $writable($dataDir . '/agent.db'),
                ],
                'php' => [
                    'version' => PHP_VERSION,
                    'procOpen' => function_exists('proc_open'),
                    'curl' => extension_loaded('curl'),
                    'sqlite' => extension_loaded('pdo_sqlite'),
                    'zip' => extension_loaded('zip'),
                    'openssl' => extension_loaded('openssl'),
                ],
                'auth' => ['enabled' => Config::authEnabled()],
            ];
        });

        // PHP-edition extra: what the host can actually do.
        $r->get('/api/system/capabilities', static function (Request $req): array {
            Auth::requireViewer($req);
            return [
                'capabilities' => Bootstrap::capabilities(),
                'missing' => Bootstrap::missingRequirements(),
                'browserEngine' => Browser::engineName(),
                'gitAvailable' => Git::available(),
                'workerRunning' => Jobs::daemonRunning(),
            ];
        });
    }

    /* ------------------------------------------------------------ */
    /* Auth                                                          */
    /* ------------------------------------------------------------ */

    private static function auth(Router $r): void
    {
        $r->get('/api/auth/status', static fn(Request $req): array => Auth::status($req));

        $r->post('/api/auth/login', static fn(Request $req): array => Auth::login($req, $req->json()));

        $r->post('/api/auth/logout', static function (Request $req): array {
            Auth::logout($req);
            return ['ok' => true];
        });

        $r->post('/api/auth/logout-all', static function (Request $req): array {
            $user = Auth::requireViewer($req);
            Security::deleteAllUserSessions((string) $user['id']);
            Auth::logout($req);
            Security::logEvent(
                'LOGOUT_ALL_SESSIONS',
                'success',
                "User {$user['username']} logged out of all sessions",
                $req->clientIp(),
                (string) $user['id']
            );
            return ['ok' => true, 'message' => 'All sessions terminated'];
        });

        $r->post('/api/auth/renew', static function (Request $req): array {
            $token = Auth::sessionToken($req);
            if ($token === '' || !Security::renewSession($token)) {
                throw new HttpError(401, 'Session expired or invalid');
            }
            return ['ok' => true];
        });

        $r->post('/api/auth/change-password', static function (Request $req): array {
            Auth::requireViewer($req);
            $p = $req->json();
            Auth::changePassword($req, (string) ($p['oldPassword'] ?? ''), (string) ($p['newPassword'] ?? ''));
            return ['ok' => true, 'message' => 'Password updated successfully'];
        });

        $r->get('/api/auth/me', static function (Request $req): array {
            Auth::requireViewer($req);
            return ['user' => $req->user ?? Auth::ANONYMOUS_ADMIN];
        });

        // Alias used by the SPA login screen when no users exist yet.
        $r->post('/api/auth/register', static function (Request $req): array {
            $p = $req->json();
            $count = (int) Database::scalar('SELECT COUNT(*) FROM users');
            $isBootstrap = $count === 0;
            if (!$isBootstrap) {
                $user = $req->user;
                if ($user === null || ($user['role'] ?? '') !== Security::ROLE_ADMIN) {
                    throw new HttpError(403, 'Only an administrator can register new users.');
                }
            }
            $created = Auth::createUser(
                (string) ($p['username'] ?? ''),
                (string) ($p['password'] ?? ''),
                (string) ($p['role'] ?? ($isBootstrap ? Security::ROLE_ADMIN : Security::ROLE_DEVELOPER)),
                (string) ($p['fullName'] ?? '')
            );
            return ['ok' => true] + $created;
        });

        $r->get('/api/users', static function (Request $req): array {
            Auth::requireAdmin($req);
            return ['users' => Auth::users()];
        });

        $r->post('/api/users', static function (Request $req): array {
            $acting = Auth::requireAdmin($req);
            $p = $req->json();
            $created = Auth::createUser(
                (string) ($p['username'] ?? ''),
                (string) ($p['password'] ?? ''),
                (string) ($p['role'] ?? Security::ROLE_DEVELOPER),
                (string) ($p['fullName'] ?? '')
            );
            Security::logEvent(
                'USER_CREATED',
                'success',
                "User {$created['username']} created with role {$created['role']}",
                $req->clientIp(),
                (string) ($acting['id'] ?? '')
            );
            return ['ok' => true] + $created;
        });

        $r->put('/api/users/{userId}/role', static function (Request $req): array {
            Auth::requireAdmin($req);
            Auth::updateUserRole($req->param('userId'), (string) ($req->json()['role'] ?? ''));
            return ['ok' => true];
        });

        $r->delete('/api/users/{userId}', static function (Request $req): array {
            $acting = Auth::requireAdmin($req);
            Auth::deleteUser($req->param('userId'), (string) ($acting['id'] ?? ''));
            return ['ok' => true];
        });

        $r->get('/api/security/logs', static function (Request $req): array {
            Auth::requireAdmin($req);
            $limit = min((int) (self::q($req, 'limit', '100') ?: 100), 1000);
            return [
                'logs' => Database::all(
                    'SELECT id, timestamp, ip, user_id, event, status, details
                     FROM security_logs ORDER BY id DESC LIMIT ?',
                    [$limit]
                ),
            ];
        });
    }

    /* ------------------------------------------------------------ */
    /* Projects                                                      */
    /* ------------------------------------------------------------ */

    private static function projects(Router $r): void
    {
        $r->get('/api/projects', static function (Request $req): array {
            Auth::requireViewer($req);
            return ['projects' => Projects::all(), 'active' => Projects::active()];
        });

        $r->get('/api/projects/{projId}', static function (Request $req): array {
            Auth::requireViewer($req);
            $proj = Projects::find($req->param('projId'));
            if ($proj === null) {
                throw new HttpError(404, 'Project not found');
            }
            return $proj;
        });

        $r->post('/api/projects', static function (Request $req): array {
            Auth::requireDeveloper($req);
            return Projects::create($req->json());
        });

        $r->put('/api/projects/{projId}', static function (Request $req): array {
            Auth::requireDeveloper($req);
            return Projects::update($req->param('projId'), $req->json());
        });

        $r->delete('/api/projects/{projId}', static function (Request $req): array {
            Auth::requireDeveloper($req);
            if (!Projects::delete($req->param('projId'))) {
                throw new HttpError(404, 'Project not found');
            }
            return ['ok' => true];
        });

        $r->post('/api/projects/{projId}/activate', static function (Request $req): array {
            Auth::requireDeveloper($req);
            return Projects::setActive($req->param('projId'));
        });
    }

    /* ------------------------------------------------------------ */
    /* Workspaces                                                    */
    /* ------------------------------------------------------------ */

    private static function workspaces(Router $r): void
    {
        $r->get('/api/workspaces', static function (Request $req): array {
            Auth::requireViewer($req);
            return ['workspaces' => Workspaces::all(), 'active' => Workspaces::active()];
        });

        $r->get('/api/workspace/session/{sessionId}', static function (Request $req): array {
            Auth::requireViewer($req);
            return Workspaces::getOrCreateSessionWorkspace($req->param('sessionId'));
        });

        $r->post('/api/workspace/session/{sessionId}/activate', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $ws = Workspaces::getOrCreateSessionWorkspace($req->param('sessionId'));
            Workspaces::setActive((string) $ws['id']);
            return $ws;
        });

        $r->post('/api/workspace/session/{sessionId}/reset', static function (Request $req): array {
            Auth::requireDeveloper($req);
            return Workspaces::resetSessionWorkspace($req->param('sessionId'));
        });

        $r->post('/api/workspaces', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $p = $req->json();
            $name = trim((string) ($p['name'] ?? ''));
            if ($name === '') {
                throw new HttpError(400, 'Workspace name is required');
            }
            return Workspaces::create(
                $name,
                (string) ($p['template'] ?? 'blank'),
                (string) ($p['instructions'] ?? ''),
                (string) ($p['agentRules'] ?? $p['agent_rules'] ?? '')
            );
        });

        $r->post('/api/workspaces/switch', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $p = $req->json();
            $id = trim((string) ($p['id'] ?? $p['workspaceId'] ?? ''));
            if ($id === '') {
                throw new HttpError(400, 'Workspace id is required');
            }
            return Workspaces::setActive($id);
        });

        $r->delete('/api/workspaces/{wsId}', static function (Request $req): array {
            Auth::requireDeveloper($req);
            Workspaces::delete($req->param('wsId'));
            return ['ok' => true];
        });

        $r->get('/api/workspaces/metrics', static function (Request $req): array {
            Auth::requireViewer($req);
            return Workspaces::stats(Workspaces::active());
        });
    }

    /* ------------------------------------------------------------ */
    /* Workspace files                                               */
    /* ------------------------------------------------------------ */

    private static function files(Router $r): void
    {
        $r->get('/api/workspace/files', static function (Request $req): array {
            Auth::requireViewer($req);
            $ws = self::wsFor(self::q($req, 'conversation_id') ?: null);
            return Files::listDir(Workspaces::ensureRoot($ws), Files::normalizeRel(self::q($req, 'path', '.')));
        });

        $r->get('/api/workspace/file', static function (Request $req): array {
            Auth::requireViewer($req);
            $path = self::q($req, 'path');
            if ($path === '') {
                throw new HttpError(400, 'path is required');
            }
            $ws = self::wsFor(self::q($req, 'conversation_id') ?: null);
            return Workspaces::readFile($ws, $path);
        });

        $r->get('/api/workspace/raw', static function (Request $req): void {
            Auth::requireViewer($req);
            $path = self::q($req, 'path');
            if ($path === '') {
                throw new HttpError(400, 'path is required');
            }
            $ws = self::wsFor(self::q($req, 'conversation_id') ?: null);
            $abs = Workspaces::safePath($ws, $path);
            if (!is_file($abs)) {
                throw new HttpError(404, 'File not found');
            }
            Response::file($abs, Files::mimeType($abs));
        });

        $r->get('/api/workspace/file-preview', static function (Request $req): array {
            Auth::requireViewer($req);
            $path = self::q($req, 'path');
            if ($path === '') {
                throw new HttpError(400, 'path is required');
            }
            $ws = self::wsFor(self::q($req, 'conversation_id') ?: null);
            return Files::buildPreview(Workspaces::ensureRoot($ws), $path, '/api/workspace/raw?path=');
        });

        $r->get('/api/workspace/reference-files', static function (Request $req): array {
            Auth::requireViewer($req);
            $targetType = self::q($req, 'target_type', 'chat');
            $targetId = self::q($req, 'target_id');
            return [
                'target_type' => $targetType,
                'target_id' => $targetId,
                'files' => References::listFiles($targetType, $targetId, self::q($req, 'path', '.')),
            ];
        });

        $r->get('/api/workspace/reference-raw', static function (Request $req): void {
            Auth::requireViewer($req);
            $path = self::q($req, 'path');
            if ($path === '') {
                throw new HttpError(400, 'path is required');
            }
            $ws = References::resolveWorkspace(self::q($req, 'target_type', 'chat'), self::q($req, 'target_id'));
            $abs = Workspaces::safePath($ws, $path);
            if (!is_file($abs)) {
                throw new HttpError(404, 'File not found in reference workspace');
            }
            Response::file($abs, Files::mimeType($abs));
        });

        $r->get('/api/workspace/reference-preview', static function (Request $req): array {
            Auth::requireViewer($req);
            $targetType = self::q($req, 'target_type', 'chat');
            $targetId = self::q($req, 'target_id');
            $path = self::q($req, 'path');
            if ($path === '') {
                throw new HttpError(400, 'path is required');
            }
            $ws = References::resolveWorkspace($targetType, $targetId);
            $rawBase = '/api/workspace/reference-raw?target_type=' . rawurlencode($targetType)
                . '&target_id=' . rawurlencode($targetId) . '&path=';
            $preview = Files::buildPreview(Workspaces::ensureRoot($ws), $path, $rawBase);
            return $preview + ['targetType' => $targetType, 'targetId' => $targetId, 'isReferenced' => true];
        });

        $r->post('/api/workspace/import-reference-file', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $p = $req->json();
            $targetId = trim((string) ($p['target_id'] ?? ''));
            $sourcePath = trim((string) ($p['source_path'] ?? ''));
            if ($targetId === '' || $sourcePath === '') {
                throw new HttpError(400, 'target_id and source_path are required');
            }
            $ws = self::wsFor(self::convOf($req));
            return References::copyFile(
                (string) ($p['target_type'] ?? 'chat'),
                $targetId,
                $sourcePath,
                isset($p['dest_path']) ? (string) $p['dest_path'] : null,
                $ws
            );
        });

        $r->post('/api/workspace/execute', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $p = $req->json();
            $path = trim((string) ($p['path'] ?? ''));
            if ($path === '') {
                throw new HttpError(400, 'File path is required');
            }
            $conversationId = self::convOf($req);
            $ws = self::wsFor($conversationId);

            // Reference-prefixed path: @chat:<id>/file or @project:<id>/file
            $ref = References::parsePrefixed($path);
            if ($ref !== null) {
                $refWs = References::resolveWorkspace($ref['targetType'], $ref['targetId']);
                return Terminal::executeFile($refWs, $ref['subpath'], $conversationId);
            }
            return Terminal::executeFile($ws, $path, $conversationId);
        });

        $r->post('/api/workspace/preview', static function (Request $req): array {
            Auth::requireViewer($req);
            $p = $req->json();
            $ws = self::wsFor(self::convOf($req));
            return ChangeSets::previewFileChange($ws, (string) ($p['path'] ?? ''), (string) ($p['content'] ?? ''));
        });

        $r->put('/api/workspace/file', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $p = $req->json();
            $ws = self::wsFor(self::convOf($req));
            $path = (string) ($p['path'] ?? '');
            $content = (string) ($p['content'] ?? '');
            if ($path === '') {
                throw new HttpError(400, 'path is required');
            }

            if (!empty($p['requireApproval'])) {
                $cs = ChangeSets::create(
                    $ws,
                    "Manual edit: {$path}",
                    [['path' => $path, 'new_content' => $content]],
                    self::username($req)
                );
                return ['requiresApproval' => true, 'changeset' => $cs];
            }

            ChangeSets::backupFile($ws, $path);
            $res = Workspaces::writeFile($ws, $path, $content, self::username($req));
            ChangeSets::saveVersion($ws, $path, $content, self::username($req));
            return ['ok' => true, 'path' => $path, 'size' => $res['size'] ?? strlen($content)];
        });

        $r->post('/api/workspace/create', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $p = $req->json();
            $ws = self::wsFor(self::convOf($req));
            $path = trim((string) ($p['path'] ?? ''));
            if ($path === '') {
                throw new HttpError(400, 'Path is required');
            }
            return Workspaces::createEntry($ws, $path, (bool) ($p['isDir'] ?? false), (string) ($p['content'] ?? ''));
        });

        $r->delete('/api/workspace/file', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $path = self::q($req, 'path');
            if ($path === '') {
                throw new HttpError(400, 'Path is required');
            }
            $ws = self::wsFor(self::q($req, 'conversation_id') ?: null);
            return ['ok' => true, 'path' => $path] + Workspaces::deletePath($ws, $path);
        });

        $r->post('/api/workspace/rename', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $p = $req->json();
            $ws = self::wsFor(self::convOf($req));
            $oldPath = trim((string) ($p['oldPath'] ?? ''));
            $newPath = trim((string) ($p['newPath'] ?? ''));
            if ($oldPath === '' || $newPath === '') {
                throw new HttpError(400, 'Both oldPath and newPath are required');
            }
            return ['ok' => true, 'old_path' => $oldPath, 'new_path' => $newPath]
                + Workspaces::rename($ws, $oldPath, $newPath);
        });

        $r->get('/api/workspace/export-zip', static function (Request $req): void {
            Auth::requireViewer($req);
            $ws = self::wsFor(self::q($req, 'conversation_id') ?: null);
            $zipPath = Bootstrap::$storageDir . '/export-' . Crypto::hex(4) . '.zip';
            Files::zipDirectory(Workspaces::ensureRoot($ws), $zipPath);
            try {
                Response::file($zipPath, 'application/zip', 'workspace.zip');
            } finally {
                @unlink($zipPath);
            }
        });

        // File locking (collaborative editing guard).
        $r->get('/api/workspace/locks', static function (Request $req): array {
            Auth::requireViewer($req);
            return ['locks' => ChangeSets::locks()];
        });

        $r->post('/api/workspace/lock', static function (Request $req): array {
            $user = Auth::requireDeveloper($req);
            $p = $req->json();
            $path = (string) ($p['path'] ?? '');
            $ok = ChangeSets::acquireLock($path, (string) ($user['id'] ?? 'user'), (int) ($p['ttl'] ?? 300));
            return ['ok' => $ok, 'path' => $path];
        });

        $r->post('/api/workspace/unlock', static function (Request $req): array {
            $user = Auth::requireDeveloper($req);
            $p = $req->json();
            $path = (string) ($p['path'] ?? '');
            return ['ok' => ChangeSets::releaseLock($path, (string) ($user['id'] ?? 'user')), 'path' => $path];
        });
    }

    /* ------------------------------------------------------------ */
    /* ChangeSets & versions                                         */
    /* ------------------------------------------------------------ */

    private static function changesets(Router $r): void
    {
        $r->get('/api/changesets', static function (Request $req): array {
            Auth::requireViewer($req);
            $ws = self::wsFor(self::q($req, 'conversation_id') ?: null);
            $limit = (int) (self::q($req, 'limit', '50') ?: 50);
            return ['changesets' => ChangeSets::listFor((string) $ws['id'], $limit)];
        });

        $r->get('/api/changesets/{csId}', static function (Request $req): array {
            Auth::requireViewer($req);
            $cs = ChangeSets::get($req->param('csId'));
            if ($cs === null) {
                throw new HttpError(404, 'ChangeSet not found');
            }
            return $cs;
        });

        $r->get('/api/changesets/{csId}/patch', static function (Request $req): void {
            Auth::requireViewer($req);
            $csId = $req->param('csId');
            Response::raw(
                ChangeSets::exportPatch($csId),
                'text/x-patch; charset=utf-8',
                200,
                ['Content-Disposition' => "attachment; filename={$csId}.patch"]
            );
        });

        $r->post('/api/changesets/{csId}/reject-with-feedback', static function (Request $req): array {
            Auth::requireDeveloper($req);
            return ChangeSets::reject($req->param('csId'), (string) ($req->json()['feedback'] ?? ''));
        });

        $r->post('/api/changesets/{csId}/approve', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $ws = self::wsFor(self::q($req, 'conversation_id') ?: null);
            return ChangeSets::approve($ws, $req->param('csId'), self::username($req));
        });

        $r->post('/api/changesets/{csId}/reject', static function (Request $req): array {
            Auth::requireDeveloper($req);
            return ChangeSets::reject($req->param('csId'));
        });

        $r->post('/api/changesets/{csId}/files/{fileId}/approve', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $ws = self::wsFor(self::q($req, 'conversation_id') ?: null);
            return ChangeSets::approveFile($ws, $req->param('csId'), $req->param('fileId'), self::username($req));
        });

        $r->post('/api/changesets/{csId}/files/{fileId}/reject', static function (Request $req): array {
            Auth::requireDeveloper($req);
            return ChangeSets::rejectFile($req->param('csId'), $req->param('fileId'));
        });

        $r->post('/api/changesets/{csId}/rollback', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $ws = self::wsFor(self::q($req, 'conversation_id') ?: null);
            return ChangeSets::rollback($ws, $req->param('csId'));
        });

        $r->get('/api/workspace/versions', static function (Request $req): array {
            Auth::requireViewer($req);
            $path = self::q($req, 'path');
            if ($path === '') {
                throw new HttpError(400, 'path is required');
            }
            $ws = self::wsFor(self::q($req, 'conversation_id') ?: null);
            return ['versions' => Workspaces::versions($ws, $path)];
        });

        $r->post('/api/workspace/versions/compare', static function (Request $req): array {
            Auth::requireViewer($req);
            $p = $req->json();
            return ChangeSets::compareVersions(
                (string) ($p['path'] ?? ''),
                (string) ($p['v1'] ?? $p['version1'] ?? ''),
                (string) ($p['v2'] ?? $p['version2'] ?? '')
            );
        });

        $r->post('/api/workspace/versions/rollback', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $p = $req->json();
            $ws = self::wsFor(self::convOf($req));
            return Workspaces::rollback($ws, (string) ($p['versionId'] ?? $p['id'] ?? ''), self::username($req));
        });
    }

    /* ------------------------------------------------------------ */
    /* Terminal                                                      */
    /* ------------------------------------------------------------ */

    private static function terminal(Router $r): void
    {
        $r->post('/api/terminal/exec', static function (Request $req): array {
            $user = Auth::requireDeveloper($req);
            $p = $req->json();
            $ws = self::wsFor(self::convOf($req));
            $cwd = (string) ($p['cwd'] ?? '.');
            $target = $cwd === '' || $cwd === '.' ? Workspaces::ensureRoot($ws) : Workspaces::safePath($ws, $cwd);
            return Terminal::execute(
                (string) ($p['command'] ?? ''),
                $target,
                (int) ($p['timeout'] ?? 60),
                (bool) ($p['confirmed'] ?? $p['confirmedDangerous'] ?? false),
                (string) ($user['id'] ?? 'user')
            );
        });

        $r->post('/api/terminal/exec-detached', static function (Request $req): array {
            $user = Auth::requireDeveloper($req);
            $p = $req->json();
            $ws = self::wsFor(self::convOf($req));
            $command = (string) ($p['command'] ?? '');
            if (Terminal::isDangerous($command) && empty($p['confirmed'])) {
                return [
                    'command' => $command,
                    'exitCode' => -1,
                    'stdout' => '',
                    'stderr' => 'BLOCKED: This command is classified as potentially dangerous and requires explicit user confirmation.',
                    'durationMs' => 0,
                    'requiresApproval' => true,
                ];
            }
            return Terminal::startDetached($command, Workspaces::ensureRoot($ws), (string) ($user['id'] ?? 'user'));
        });

        $r->get('/api/terminal/processes', static function (Request $req): array {
            Auth::requireViewer($req);
            return ['processes' => Terminal::listProcesses()];
        });

        $r->post('/api/terminal/processes/{pid}/kill', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $pid = (int) $req->param('pid');
            $ok = Terminal::kill($pid);
            return [
                'ok' => $ok,
                'pid' => $pid,
                'message' => $ok ? "Process {$pid} terminated." : "Process {$pid} is not running or could not be killed.",
            ];
        });

        $r->get('/api/terminal/processes/{pid}/log', static function (Request $req): array {
            Auth::requireViewer($req);
            $pid = (int) $req->param('pid');
            $row = Database::one('SELECT log_path FROM terminal_processes WHERE pid = ? ORDER BY id DESC LIMIT 1', [$pid]);
            return ['pid' => $pid, 'log' => $row ? Terminal::readLog((string) $row['log_path']) : ''];
        });
    }

    /* ------------------------------------------------------------ */
    /* Git (real CLI)                                                */
    /* ------------------------------------------------------------ */

    private static function git(Router $r): void
    {
        $root = static fn(Request $req): string => Workspaces::ensureRoot(self::wsFor(self::convOf($req)));

        $r->get('/api/git/status', static function (Request $req) use ($root): array {
            Auth::requireViewer($req);
            return Git::status($root($req));
        });

        $r->get('/api/git/diff', static function (Request $req) use ($root): array {
            Auth::requireViewer($req);
            return Git::diff(self::q($req, 'staged') === 'true', self::q($req, 'path') ?: null, $root($req));
        });

        $r->get('/api/git/branches', static function (Request $req) use ($root): array {
            Auth::requireViewer($req);
            return Git::branches($root($req));
        });

        $r->post('/api/git/branch/create', static function (Request $req) use ($root): array {
            Auth::requireDeveloper($req);
            return Git::createBranch((string) ($req->json()['name'] ?? ''), true, $root($req));
        });

        $r->post('/api/git/branch/switch', static function (Request $req) use ($root): array {
            Auth::requireDeveloper($req);
            return Git::switchBranch((string) ($req->json()['name'] ?? ''), $root($req));
        });

        $r->post('/api/git/branch/rename', static function (Request $req) use ($root): array {
            Auth::requireDeveloper($req);
            $p = $req->json();
            return Git::renameBranch((string) ($p['oldName'] ?? ''), (string) ($p['newName'] ?? ''), $root($req));
        });

        $r->post('/api/git/branch/delete', static function (Request $req) use ($root): array {
            Auth::requireDeveloper($req);
            $p = $req->json();
            return Git::deleteBranch((string) ($p['name'] ?? ''), (bool) ($p['force'] ?? false), $root($req));
        });

        $r->post('/api/git/commit', static function (Request $req) use ($root): array {
            Auth::requireDeveloper($req);
            $p = $req->json();
            $message = trim((string) ($p['message'] ?? ''));
            if ($message === '') {
                throw new HttpError(400, 'Commit message is required');
            }
            return Git::commit($message, (bool) ($p['approved'] ?? true), $root($req));
        });

        $r->get('/api/git/log', static function (Request $req) use ($root): array {
            Auth::requireViewer($req);
            return Git::history((int) (self::q($req, 'limit', '50') ?: 50), $root($req));
        });

        $r->get('/api/git/commit/{commitHash}', static function (Request $req) use ($root): array {
            Auth::requireViewer($req);
            return Git::commitDetails($req->param('commitHash'), $root($req));
        });

        $r->post('/api/git/pull', static function (Request $req) use ($root): array {
            Auth::requireDeveloper($req);
            $p = $req->json();
            return Git::pull((string) ($p['remote'] ?? 'origin'), (string) ($p['branch'] ?? ''), $root($req));
        });

        $r->post('/api/git/push', static function (Request $req) use ($root): array {
            Auth::requireDeveloper($req);
            $p = $req->json();
            return Git::push(
                (string) ($p['remote'] ?? 'origin'),
                (string) ($p['branch'] ?? ''),
                (bool) ($p['force'] ?? false),
                (bool) ($p['approved'] ?? true),
                $root($req)
            );
        });

        $r->post('/api/git/fetch', static function (Request $req) use ($root): array {
            Auth::requireDeveloper($req);
            return Git::fetch((string) ($req->json()['remote'] ?? 'origin'), $root($req));
        });

        $r->get('/api/git/stash', static function (Request $req) use ($root): array {
            Auth::requireViewer($req);
            return ['stashes' => Git::stashes($root($req))];
        });

        $r->post('/api/git/stash', static function (Request $req) use ($root): array {
            Auth::requireDeveloper($req);
            return Git::stashSave((string) ($req->json()['message'] ?? ''), $root($req));
        });

        $r->post('/api/git/stash/apply', static function (Request $req) use ($root): array {
            Auth::requireDeveloper($req);
            return Git::stashApply((string) ($req->json()['stashId'] ?? 'stash@{0}'), $root($req));
        });

        $r->post('/api/git/stash/drop', static function (Request $req) use ($root): array {
            Auth::requireDeveloper($req);
            return Git::stashDrop((string) ($req->json()['stashId'] ?? 'stash@{0}'), $root($req));
        });

        $r->get('/api/git/remotes', static function (Request $req) use ($root): array {
            Auth::requireViewer($req);
            return ['remotes' => Git::remotes($root($req))];
        });

        $r->post('/api/git/remotes', static function (Request $req) use ($root): array {
            Auth::requireDeveloper($req);
            $p = $req->json();
            return Git::addRemote((string) ($p['name'] ?? 'origin'), (string) ($p['url'] ?? ''), $root($req));
        });

        $r->get('/api/git/conflicts', static function (Request $req) use ($root): array {
            Auth::requireViewer($req);
            return ['conflicts' => Git::conflicts($root($req))];
        });

        $r->post('/api/git/resolve-conflict', static function (Request $req) use ($root): array {
            Auth::requireDeveloper($req);
            $p = $req->json();
            return Git::resolveConflict(
                (string) ($p['path'] ?? ''),
                (string) ($p['mode'] ?? 'ours'),
                isset($p['content']) ? (string) $p['content'] : null,
                $root($req)
            );
        });

        $r->post('/api/git/init', static function (Request $req) use ($root): array {
            Auth::requireDeveloper($req);
            return Git::init($root($req), (string) ($req->json()['branch'] ?? 'main'));
        });

        $r->post('/api/git/merge', static function (Request $req) use ($root): array {
            Auth::requireDeveloper($req);
            return Git::merge((string) ($req->json()['branch'] ?? ''), $root($req));
        });

        $r->post('/api/git/cherry-pick', static function (Request $req) use ($root): array {
            Auth::requireDeveloper($req);
            return Git::cherryPick((string) ($req->json()['hash'] ?? ''), $root($req));
        });

        $r->post('/api/git/revert', static function (Request $req) use ($root): array {
            Auth::requireDeveloper($req);
            return Git::revert((string) ($req->json()['hash'] ?? ''), $root($req));
        });

        $r->post('/api/git/clone', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $p = $req->json();
            $ws = self::wsFor(self::convOf($req));
            return GitHub::cloneIntoWorkspace((string) ($p['url'] ?? ''), $ws, (string) ($p['branch'] ?? ''));
        });
    }

    /* ------------------------------------------------------------ */
    /* GitHub                                                        */
    /* ------------------------------------------------------------ */

    private static function github(Router $r): void
    {
        $r->get('/api/github/user', static function (Request $req): mixed {
            Auth::requireViewer($req);
            return GitHub::user();
        });

        $r->get('/api/github/repos', static function (Request $req): mixed {
            Auth::requireViewer($req);
            return GitHub::repos();
        });

        $r->get('/api/github/repo/{owner}/{repo}/branches', static function (Request $req): mixed {
            Auth::requireViewer($req);
            return GitHub::branches($req->param('owner'), $req->param('repo'));
        });

        $r->get('/api/github/repo/{owner}/{repo}/tree', static function (Request $req): mixed {
            Auth::requireViewer($req);
            return GitHub::tree($req->param('owner'), $req->param('repo'), self::q($req, 'branch', 'main'));
        });

        $r->get('/api/github/repo/{owner}/{repo}/contents/{path*}', static function (Request $req): mixed {
            Auth::requireViewer($req);
            return GitHub::file(
                $req->param('owner'),
                $req->param('repo'),
                $req->param('path'),
                self::q($req, 'ref') ?: null
            );
        });

        $r->put('/api/github/repo/{owner}/{repo}/contents/{path*}', static function (Request $req): mixed {
            Auth::requireDeveloper($req);
            $p = $req->json();
            return GitHub::putFile(
                $req->param('owner'),
                $req->param('repo'),
                $req->param('path'),
                (string) ($p['content'] ?? ''),
                (string) ($p['message'] ?? ''),
                isset($p['branch']) ? (string) $p['branch'] : null,
                isset($p['sha']) ? (string) $p['sha'] : null
            );
        });

        $r->get('/api/github/repo/{owner}/{repo}/pulls', static function (Request $req): mixed {
            Auth::requireViewer($req);
            return GitHub::pulls($req->param('owner'), $req->param('repo'), self::q($req, 'state', 'open'));
        });

        $r->post('/api/github/pull-request', static function (Request $req): mixed {
            Auth::requireDeveloper($req);
            $p = $req->json();
            $owner = (string) ($p['owner'] ?? '');
            $repo = (string) ($p['repo'] ?? '');
            if ($owner === '' || $repo === '') {
                throw new HttpError(400, 'owner and repo are required');
            }
            return GitHub::createPull($owner, $repo, [
                'title' => (string) ($p['title'] ?? ''),
                'head' => (string) ($p['head'] ?? ''),
                'base' => (string) ($p['base'] ?? 'main'),
                'body' => (string) ($p['body'] ?? ''),
                'draft' => (bool) ($p['draft'] ?? false),
            ]);
        });

        $r->post('/api/github/repo/{owner}/{repo}/pulls/{pullNumber}/merge', static function (Request $req): mixed {
            Auth::requireDeveloper($req);
            return GitHub::mergePull($req->param('owner'), $req->param('repo'), (int) $req->param('pullNumber'), $req->json());
        });

        $r->post('/api/github/repo/{owner}/{repo}/pulls/{pullNumber}/review', static function (Request $req): mixed {
            Auth::requireDeveloper($req);
            return GitHub::reviewPull($req->param('owner'), $req->param('repo'), (int) $req->param('pullNumber'), $req->json());
        });

        $r->get('/api/github/repo/{owner}/{repo}/actions/runs', static function (Request $req): mixed {
            Auth::requireViewer($req);
            return GitHub::workflowRuns($req->param('owner'), $req->param('repo'));
        });

        $r->post('/api/github/repo/{owner}/{repo}/actions/runs/{runId}/rerun', static function (Request $req): mixed {
            Auth::requireDeveloper($req);
            return GitHub::rerunWorkflow($req->param('owner'), $req->param('repo'), (int) $req->param('runId'));
        });

        $r->get('/api/github/repo/{owner}/{repo}/issues', static function (Request $req): mixed {
            Auth::requireViewer($req);
            return GitHub::issues($req->param('owner'), $req->param('repo'), self::q($req, 'state', 'open'));
        });

        $r->post('/api/github/repo/{owner}/{repo}/issues', static function (Request $req): mixed {
            Auth::requireDeveloper($req);
            return GitHub::createIssue($req->param('owner'), $req->param('repo'), $req->json());
        });

        $r->post('/api/github/clone', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $p = $req->json();
            $ws = self::wsFor(self::convOf($req));
            return GitHub::cloneIntoWorkspace((string) ($p['url'] ?? $p['repoUrl'] ?? ''), $ws, (string) ($p['branch'] ?? ''));
        });
    }

    /* ------------------------------------------------------------ */
    /* Browser automation                                            */
    /* ------------------------------------------------------------ */

    private static function browser(Router $r): void
    {
        $r->post('/api/browser/session', static function (Request $req): array {
            Auth::requireDeveloper($req);
            return Browser::createSession((string) ($req->json()['sessionId'] ?? 'default'));
        });

        $r->post('/api/browser/navigate', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $p = $req->json();
            return Browser::navigate((string) ($p['url'] ?? ''), (string) ($p['sessionId'] ?? 'default'));
        });

        $r->post('/api/browser/screenshot', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $p = $req->json();
            return Browser::screenshot((string) ($p['sessionId'] ?? 'default'), (bool) ($p['fullPage'] ?? false));
        });

        $r->post('/api/browser/click', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $p = $req->json();
            return Browser::click((string) ($p['selector'] ?? ''), (string) ($p['sessionId'] ?? 'default'));
        });

        $r->post('/api/browser/fill', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $p = $req->json();
            return Browser::fill((string) ($p['selector'] ?? ''), (string) ($p['text'] ?? ''), (string) ($p['sessionId'] ?? 'default'));
        });

        $r->get('/api/browser/logs', static function (Request $req): array {
            Auth::requireViewer($req);
            return Browser::logs(self::q($req, 'sessionId', 'default'));
        });

        $r->post('/api/browser/eval', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $p = $req->json();
            return Browser::evaluate((string) ($p['expression'] ?? $p['script'] ?? ''), (string) ($p['sessionId'] ?? 'default'));
        });

        $r->post('/api/browser/fetch', static function (Request $req): array {
            Auth::requireDeveloper($req);
            return Browser::fetchUrl((string) ($req->json()['url'] ?? ''));
        });

        $r->post('/api/browser/close', static function (Request $req): array {
            Auth::requireDeveloper($req);
            return Browser::closeSession((string) ($req->json()['sessionId'] ?? 'default'));
        });
    }

    /* ------------------------------------------------------------ */
    /* Chat                                                          */
    /* ------------------------------------------------------------ */

    private static function chatArgs(array $p): array
    {
        $messages = $p['messages'] ?? [['role' => 'user', 'content' => (string) ($p['message'] ?? '')]];
        return [
            'messages' => is_array($messages) ? $messages : [],
            'providerId' => (string) ($p['provider'] ?? 'openrouter'),
            'modelId' => (string) ($p['model'] ?? ''),
            'maxSteps' => (int) ($p['maxSteps'] ?? 30) ?: 30,
            'conversationId' => ($p['conversationId'] ?? $p['conversation_id'] ?? null) ?: null,
            'references' => $p['references'] ?? null,
        ];
    }

    private static function chat(Router $r): void
    {
        $r->post('/api/chat', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $store = ProviderStore::load();
            $args = self::chatArgs($req->json());
            $args['userId'] = self::username($req);
            return Chat::completeChat($store, $args);
        });

        $r->post('/api/chat/stream', static function (Request $req): void {
            Auth::requireDeveloper($req);
            $args = self::chatArgs($req->json());
            $args['userId'] = self::username($req);

            $sse = new Sse();
            $sse->start();
            try {
                $store = ProviderStore::load();
                foreach (Chat::streamCompleteChat($store, $args) as $event) {
                    $sse->send((string) ($event['type'] ?? 'message'), $event);
                    if ($sse->aborted) {
                        break;
                    }
                }
            } catch (\Throwable $e) {
                $message = $e->getMessage();
                Observability::log('ERROR', 'CHAT', $message);
                $sse->send('error', [
                    'error' => $message,
                    'errorDetails' => [
                        'provider' => $args['providerId'],
                        'model' => $args['modelId'],
                        'error' => $message,
                        'timestamp' => gmdate('Y-m-d H:i:s') . ' UTC',
                        'remediation' => "1. Check provider API key and internet connectivity.\n"
                            . "2. In Providers & Models, test your model connection.\n"
                            . "3. Verify your proxy server settings.",
                    ],
                ]);
            }
        });

        $r->post('/api/chat/upload', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $file = $_FILES['file'] ?? null;
            if (!is_array($file) || !isset($file['tmp_name']) || !is_uploaded_file((string) $file['tmp_name'])) {
                throw new HttpError(400, 'A file upload is required');
            }

            $filename = (string) ($file['name'] ?? ('upload_' . time()));
            $safeFn = trim((string) preg_replace('/[^a-zA-Z0-9._-]/', '', $filename)) ?: 'upload';
            $dest = Bootstrap::$uploadsDir . '/' . time() . '_' . $safeFn;
            Files::ensureDir(dirname($dest));
            if (!@move_uploaded_file((string) $file['tmp_name'], $dest)) {
                throw new HttpError(500, 'Could not store the uploaded file');
            }

            $bytes = (int) (filesize($dest) ?: 0);
            $contentType = (string) ($file['type'] ?? '') ?: Files::mimeType($dest);
            $isImage = str_starts_with($contentType, 'image/');
            $imageBase64 = null;
            $textSnippet = null;
            if ($isImage) {
                $imageBase64 = base64_encode(Files::read($dest));
            } else {
                $raw = Files::read($dest);
                $textSnippet = mb_check_encoding($raw, 'UTF-8')
                    ? mb_substr($raw, 0, 4000)
                    : "[Binary file: {$filename}, size: {$bytes} bytes]";
            }

            return [
                'ok' => true,
                'filename' => $filename,
                'savedPath' => $dest,
                'contentType' => $contentType,
                'isImage' => $isImage,
                'sizeBytes' => $bytes,
                'imageBase64' => $imageBase64,
                'textSnippet' => $textSnippet,
            ];
        });
    }

    /* ------------------------------------------------------------ */
    /* Conversations                                                 */
    /* ------------------------------------------------------------ */

    private static function conversations(Router $r): void
    {
        $r->get('/api/conversations', static function (Request $req): array {
            Auth::requireViewer($req);
            return ['conversations' => Conversations::all()];
        });

        $r->post('/api/conversations', static function (Request $req): array {
            Auth::requireDeveloper($req);
            return Conversations::create($req->json());
        });

        $r->get('/api/conversations/{convId}/messages', static function (Request $req): array {
            Auth::requireViewer($req);
            return ['messages' => Conversations::messages($req->param('convId'))];
        });

        $r->post('/api/conversations/{convId}/messages', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $convId = $req->param('convId');
            $p = $req->json();
            $id = Conversations::addMessage($convId, $p);
            return ['id' => $id, 'role' => (string) ($p['role'] ?? 'user'), 'content' => (string) ($p['content'] ?? '')];
        });

        $r->put('/api/conversations/{convId}/messages/sync', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $convId = $req->param('convId');
            $msgs = $req->json()['messages'] ?? [];
            Conversations::ensure($convId);
            Database::run('DELETE FROM messages WHERE conversation_id = ?', [$convId]);
            foreach (array_values(is_array($msgs) ? $msgs : []) as $m) {
                Conversations::addMessage($convId, is_array($m) ? $m : []);
            }
            Database::run("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?", [$convId]);
            return ['ok' => true, 'count' => count(is_array($msgs) ? $msgs : [])];
        });

        $r->put('/api/conversations/{convId}', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $convId = $req->param('convId');
            Conversations::update($convId, $req->json());
            return ['ok' => true, 'id' => $convId];
        });

        $r->delete('/api/conversations/{convId}', static function (Request $req): array {
            Auth::requireDeveloper($req);
            Conversations::delete($req->param('convId'));
            return ['ok' => true];
        });

        $r->get('/api/conversations/{convId}/checkpoints', static function (Request $req): array {
            Auth::requireViewer($req);
            return ['checkpoints' => Conversations::checkpoints($req->param('convId'), (int) (self::q($req, 'limit', '10') ?: 10))];
        });

        $r->get('/api/conversations/{convId}/checkpoints/latest', static function (Request $req): array {
            Auth::requireViewer($req);
            $cp = Conversations::latestCheckpoint($req->param('convId'));
            if ($cp === null) {
                throw new HttpError(404, 'No checkpoint found for conversation');
            }
            return ['checkpoint' => $cp];
        });

        $r->delete('/api/conversations/{convId}/checkpoints', static function (Request $req): array {
            Auth::requireDeveloper($req);
            Conversations::clearCheckpoints($req->param('convId'));
            return ['ok' => true];
        });

        $r->get('/api/conversations/{convId}/references', static function (Request $req): array {
            Auth::requireViewer($req);
            $convId = $req->param('convId');
            return [
                'references' => References::forConversation($convId),
                'available_chats' => Database::all(
                    'SELECT id, title, created_at FROM conversations WHERE id != ? ORDER BY updated_at DESC',
                    [$convId]
                ),
                'available_projects' => Database::all('SELECT id, name, description FROM projects ORDER BY name ASC'),
            ];
        });

        $r->post('/api/conversations/{convId}/references', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $p = $req->json();
            $targetId = trim((string) ($p['target_id'] ?? ''));
            if ($targetId === '') {
                throw new HttpError(400, 'target_id is required');
            }
            return References::add(
                $req->param('convId'),
                trim((string) ($p['target_type'] ?? 'chat')),
                $targetId,
                trim((string) ($p['title'] ?? ''))
            );
        });

        $r->delete('/api/conversations/{convId}/references/{targetType}/{targetId}', static function (Request $req): array {
            Auth::requireDeveloper($req);
            return References::remove($req->param('convId'), $req->param('targetType'), $req->param('targetId'));
        });

        $r->get('/api/references/search', static function (Request $req): array {
            Auth::requireViewer($req);
            return References::search(self::q($req, 'q'));
        });
    }

    /* ------------------------------------------------------------ */
    /* Jobs                                                          */
    /* ------------------------------------------------------------ */

    private static function jobs(Router $r): void
    {
        $r->get('/api/jobs', static function (Request $req): array {
            Auth::requireViewer($req);
            return ['jobs' => Jobs::all([
                'status' => self::q($req, 'status') ?: null,
                'provider' => self::q($req, 'provider') ?: null,
                'model' => self::q($req, 'model') ?: null,
                'limit' => (int) (self::q($req, 'limit', '50') ?: 50),
            ])];
        });

        $r->get('/api/jobs/stats', static function (Request $req): array {
            Auth::requireViewer($req);
            return Jobs::stats();
        });

        $r->delete('/api/jobs/cleanup', static function (Request $req): array {
            Auth::requireAdmin($req);
            return ['ok' => true, 'deletedCount' => Jobs::deleteOld((int) (self::q($req, 'days', '7') ?: 7))];
        });

        $r->post('/api/jobs/chat', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $p = $req->json();
            $title = (string) ($p['title'] ?? mb_substr((string) ($p['message'] ?? 'Chat Task'), 0, 60));
            $ws = Workspaces::active();
            return Jobs::create([
                'title' => $title,
                'providerId' => (string) ($p['provider'] ?? 'openrouter'),
                'modelId' => (string) ($p['model'] ?? ''),
                'payload' => $p,
                'workspaceId' => (string) $ws['id'],
                'userId' => self::username($req),
                'conversationId' => (string) ($p['conversationId'] ?? $p['conversation_id'] ?? ''),
                'maxSteps' => (int) ($p['maxSteps'] ?? 8),
                'maxTimeoutSec' => (int) ($p['timeoutSec'] ?? 600),
            ]);
        });

        $r->get('/api/jobs/{jobId}', static function (Request $req): array {
            Auth::requireViewer($req);
            $job = Jobs::details($req->param('jobId'));
            if ($job === null) {
                throw new HttpError(404, 'Job not found');
            }
            return $job;
        });

        $r->post('/api/jobs/{jobId}/cancel', static function (Request $req): array {
            Auth::requireDeveloper($req);
            return ['ok' => Jobs::cancel($req->param('jobId'))];
        });

        $r->post('/api/jobs/{jobId}/pause', static function (Request $req): array {
            Auth::requireDeveloper($req);
            return ['ok' => Jobs::pause($req->param('jobId'))];
        });

        $r->post('/api/jobs/{jobId}/resume', static function (Request $req): array {
            Auth::requireDeveloper($req);
            return ['ok' => Jobs::resume($req->param('jobId'))];
        });

        $r->post('/api/jobs/{jobId}/retry', static function (Request $req): array {
            Auth::requireDeveloper($req);
            return ['ok' => Jobs::retry($req->param('jobId'))];
        });
    }

    /* ------------------------------------------------------------ */
    /* Providers & models                                            */
    /* ------------------------------------------------------------ */

    private static function providers(Router $r): void
    {
        $r->get('/api/providers', static function (Request $req): array {
            Auth::requireViewer($req);
            return ProviderStore::load()->allPublic();
        });

        $r->get('/api/providers/export', static function (Request $req): void {
            Auth::requireAdmin($req);
            Response::raw(
                ProviderStore::load()->exportJson(),
                'application/json',
                200,
                ['Content-Disposition' => 'attachment; filename=providers.json']
            );
        });

        $r->post('/api/providers/import-text', static function (Request $req): array {
            Auth::requireAdmin($req);
            $p = $req->json();
            $payload = $p['json'] ?? $p['text'] ?? $p['data'] ?? $p['providers'] ?? '';
            // Some clients POST the already-parsed object instead of a string.
            $text = is_array($payload) ? (string) json_encode($payload) : (string) $payload;

            // Shared hosts often run a WAF that inspects request bodies and
            // rejects anything containing API keys or URLs, answering with its
            // own HTML error page. The catalog is the only payload here that
            // trips those rules, so the client may re-send it base64-encoded.
            if ($text === '') {
                $b64 = $p['jsonB64'] ?? $p['b64'] ?? '';
                if (is_string($b64) && $b64 !== '') {
                    $decoded = base64_decode(strtr($b64, '-_', '+/'), true);
                    if ($decoded === false) {
                        throw new HttpError(400, 'jsonB64 is not valid base64');
                    }
                    $text = $decoded;
                }
            }

            // A probe proves the request survived the network, the web server
            // and any WAF, without changing stored data.
            if (!empty($p['probe'])) {
                return [
                    'ok' => true,
                    'probe' => true,
                    'bytesReceived' => strlen($text),
                    'parses' => $text !== '' && json_decode($text) !== null,
                    'transport' => isset($p['jsonB64']) || isset($p['b64']) ? 'base64' : 'plain',
                ];
            }
            if ($text === '') {
                // Either nothing was pasted, or PHP discarded an oversized body
                // (post_max_size) and handed us an empty $_POST/php://input.
                $declared = (int) $req->header('content-length', '0');
                if ($declared > 0 && $req->body() === '') {
                    throw new HttpError(413, sprintf(
                        'The request body (%s) was dropped by PHP before the app saw it. Raise post_max_size '
                        . '(currently %s) and upload_max_filesize (currently %s), or import the file from the '
                        . 'CLI: php bin/console.php provider:import providers.json',
                        Files::humanSize($declared),
                        ini_get('post_max_size') ?: '?',
                        ini_get('upload_max_filesize') ?: '?'
                    ));
                }
            }
            $store = ProviderStore::load();
            $report = $store->importJson($text, (bool) ($p['replace'] ?? false));
            return ['ok' => true, 'count' => count($store->data)] + $report;
        });

        $r->post('/api/providers/import', static function (Request $req): array {
            Auth::requireAdmin($req);
            $file = $_FILES['file'] ?? null;
            if (!is_array($file) || !isset($file['tmp_name']) || !is_uploaded_file((string) $file['tmp_name'])) {
                $code = is_array($file) ? (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) : UPLOAD_ERR_NO_FILE;
                if (in_array($code, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) {
                    throw new HttpError(413, 'The uploaded file is larger than upload_max_filesize ('
                        . (ini_get('upload_max_filesize') ?: '?') . '). Raise it, or run '
                        . '"php bin/console.php provider:import <file>" on the server.');
                }
                throw new HttpError(400, 'A providers.json upload is required');
            }
            $store = ProviderStore::load();
            $report = $store->importJson(
                (string) file_get_contents((string) $file['tmp_name']),
                self::q($req, 'replace') === 'true'
            );
            return ['ok' => true, 'count' => count($store->data)] + $report;
        });

        $r->post('/api/providers/{pid}/import-models', static function (Request $req): array {
            Auth::requireAdmin($req);
            $pid = $req->param('pid');
            $p = $req->json();
            $payload = $p['json'] ?? $p['text'] ?? $p['data'] ?? $p['models'] ?? '';
            $text = is_array($payload) ? (string) json_encode($payload) : (string) $payload;
            if ($text === '') {
                $b64 = $p['jsonB64'] ?? $p['b64'] ?? '';
                if (is_string($b64) && $b64 !== '') {
                    $decoded = base64_decode(strtr($b64, '-_', '+/'), true);
                    if ($decoded !== false) {
                        $text = $decoded;
                    }
                }
            }
            if ($text === '') {
                throw new HttpError(400, 'Model catalog payload is required');
            }
            $store = ProviderStore::load();
            return $store->importModelsForProvider($pid, $text, (bool) ($p['replace'] ?? false));
        });

        $r->post('/api/providers/test-all', static function (Request $req): array {
            Auth::requireDeveloper($req);
            return Models::testAllModels(ProviderStore::load());
        });

        $r->post('/api/providers', static function (Request $req): array {
            Auth::requireAdmin($req);
            $p = $req->json();
            $pid = (string) ($p['id'] ?? '');
            if ($pid === '') {
                throw new HttpError(400, 'Provider id is required');
            }
            return ProviderStore::load()->upsert(ProviderStore::normalizeProvider($p, $pid));
        });

        $r->put('/api/providers/{pid}', static function (Request $req): array {
            Auth::requireAdmin($req);
            $pid = $req->param('pid');
            $p = $req->json();
            if (!empty($p['id']) && $p['id'] !== $pid) {
                throw new HttpError(400, 'Provider ID mismatch');
            }
            $p['id'] = $pid;
            return ProviderStore::load()->upsert(ProviderStore::normalizeProvider($p, $pid));
        });

        $r->delete('/api/providers/{pid}', static function (Request $req): array {
            Auth::requireAdmin($req);
            ProviderStore::load()->delete($req->param('pid'));
            return ['ok' => true];
        });

        $r->post('/api/providers/{pid}/models', static function (Request $req): array {
            Auth::requireAdmin($req);
            $pid = $req->param('pid');
            $store = ProviderStore::load();
            if ($store->get($pid) === null) {
                throw new HttpError(404, 'Provider not found');
            }
            $model = ProviderStore::normalizeModel($req->json());
            $store->addModel($pid, $model);
            return $model;
        });

        // Model IDs contain slashes (e.g. "meta-llama/llama-3-8b"), hence the greedy capture.
        $r->post('/api/providers/{pid}/models/{rest*}', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $pid = $req->param('pid');
            $rest = $req->param('rest');
            if (!str_ends_with($rest, '/test')) {
                throw new HttpError(404, 'Not found');
            }
            $mid = rawurldecode(substr($rest, 0, -strlen('/test')));

            $store = ProviderStore::load();
            $provider = $store->get($pid);
            if ($provider === null) {
                throw new HttpError(404, 'Provider not found');
            }
            $model = $store->findModel($provider, $mid);
            return Models::testProviderModel($store, $provider, $model);
        });

        $r->put('/api/providers/{pid}/models/{mid*}', static function (Request $req): array {
            Auth::requireAdmin($req);
            $pid = $req->param('pid');
            $store = ProviderStore::load();
            if ($store->get($pid) === null) {
                throw new HttpError(404, 'Provider not found');
            }
            $model = ProviderStore::normalizeModel($req->json());
            $store->updateModel($pid, rawurldecode($req->param('mid')), $model);
            return $model;
        });

        $r->delete('/api/providers/{pid}/models/{mid*}', static function (Request $req): array {
            Auth::requireAdmin($req);
            $pid = $req->param('pid');
            $store = ProviderStore::load();
            if ($store->get($pid) === null) {
                throw new HttpError(404, 'Provider not found');
            }
            $store->deleteModel($pid, rawurldecode($req->param('mid')));
            return ['ok' => true];
        });

        $r->post('/api/providers/{pid}/test', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $pid = $req->param('pid');
            $store = ProviderStore::load();
            $provider = $store->get($pid);
            if ($provider === null) {
                throw new HttpError(404, 'Provider not found');
            }
            $model = $provider['models'][0] ?? null;
            if ($model === null) {
                throw new HttpError(400, "Provider '{$pid}' has no models configured.");
            }
            return Models::testProviderModel($store, $provider, $model);
        });

        $r->post('/api/providers/{pid}/reset-circuit', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $pid = $req->param('pid');
            ProviderStore::breaker()->reset($pid);
            return ['ok' => true, 'message' => "Circuit breaker for provider {$pid} reset."];
        });
    }

    /* ------------------------------------------------------------ */
    /* Config                                                        */
    /* ------------------------------------------------------------ */

    private static function config(Router $r): void
    {
        $r->get('/api/config/environment', static function (Request $req): array {
            Auth::requireAdmin($req);
            return Config::readEnvironment();
        });

        $r->put('/api/config/environment', static function (Request $req): array {
            Auth::requireAdmin($req);
            return Config::writeEnvironment($req->json());
        });

        $r->post('/api/config/test-proxy', static function (Request $req): array {
            Auth::requireAdmin($req);
            $p = $req->json();
            return Models::testProxy(
                isset($p['proxy_url']) ? (string) $p['proxy_url'] : null,
                (string) ($p['target_url'] ?? 'https://httpbin.org/get')
            );
        });
    }

    /* ------------------------------------------------------------ */
    /* Observability                                                 */
    /* ------------------------------------------------------------ */

    private static function observability(Router $r): void
    {
        $r->get('/api/observability/logs', static function (Request $req): array {
            Auth::requireViewer($req);
            return ['logs' => Observability::logs(
                self::q($req, 'level') ?: null,
                self::q($req, 'search') ?: null,
                (int) (self::q($req, 'limit', '100') ?: 100)
            )];
        });

        $r->get('/api/observability/metrics', static function (Request $req): array {
            Auth::requireViewer($req);
            return Observability::systemMetrics((string) Workspaces::active()['id']);
        });

        $r->get('/api/observability/providers', static function (Request $req): array {
            Auth::requireViewer($req);
            return ['metrics' => Observability::providerMetrics()];
        });

        $r->get('/api/observability/export', static function (Request $req): void {
            Auth::requireViewer($req);
            $logs = Observability::logs(null, null, 1000);
            if (self::q($req, 'format') === 'csv') {
                Response::raw(
                    Observability::exportCsv($logs),
                    'text/csv; charset=utf-8',
                    200,
                    ['Content-Disposition' => 'attachment; filename=audit-logs.csv']
                );
                return;
            }
            Response::raw(
                (string) json_encode($logs, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                'application/json',
                200,
                ['Content-Disposition' => 'attachment; filename=audit-logs.json']
            );
        });
    }

    /* ------------------------------------------------------------ */
    /* Local AI (Ollama) — install, tune and register local models   */
    /* ------------------------------------------------------------ */

    private static function localAi(Router $r): void
    {
        $r->get('/api/localai/host', static function (Request $req): array {
            Auth::requireViewer($req);
            return LocalAI::hostScan($req->bool('refresh', false));
        });

        $r->get('/api/localai/runtime', static function (Request $req): array {
            Auth::requireViewer($req);
            return LocalAI::runtimeStatus();
        });

        $r->post('/api/localai/runtime/install', static function (Request $req): array {
            Auth::requireAdmin($req);
            return LocalAI::installRuntime();
        });

        $r->post('/api/localai/runtime/start', static function (Request $req): array {
            Auth::requireAdmin($req);
            $body = $req->json();
            return LocalAI::startServer((array) ($body['env'] ?? []));
        });

        $r->post('/api/localai/runtime/stop', static function (Request $req): array {
            Auth::requireAdmin($req);
            return LocalAI::stopServer();
        });

        $r->get('/api/localai/catalog', static function (Request $req): array {
            Auth::requireViewer($req);
            return LocalAI::catalog($req->bool('refresh', false));
        });

        $r->post('/api/localai/search', static function (Request $req): array {
            Auth::requireViewer($req);
            $body = $req->json();
            return LocalAI::search(
                (string) ($body['query'] ?? ''),
                (int) ($body['limit'] ?? 25),
                (bool) ($body['remote'] ?? true)
            );
        });

        $r->get('/api/localai/tags/{name*}', static function (Request $req): array {
            Auth::requireViewer($req);
            $name = (string) ($req->params['name'] ?? '');
            return ['name' => $name, 'tags' => LocalAI::registryTags($name)];
        });

        $r->post('/api/localai/recommend', static function (Request $req): array {
            Auth::requireViewer($req);
            return LocalAI::recommend($req->json());
        });

        $r->post('/api/localai/install', static function (Request $req): array {
            $user = Auth::requireAdmin($req);
            return LocalAI::enqueueInstall($req->json(), (string) ($user['id'] ?? 'user'));
        });

        $r->get('/api/localai/models', static function (Request $req): array {
            Auth::requireViewer($req);
            return LocalAI::installed();
        });

        $r->delete('/api/localai/models/{name*}', static function (Request $req): array {
            Auth::requireAdmin($req);
            return LocalAI::remove((string) ($req->params['name'] ?? ''));
        });

        $r->post('/api/localai/test', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $body = $req->json();
            return LocalAI::benchmark(
                (string) ($body['model'] ?? ''),
                (string) ($body['prompt'] ?? 'Say OK.'),
                (int) ($body['numPredict'] ?? 48)
            );
        });

        $r->post('/api/localai/register', static function (Request $req): array {
            Auth::requireAdmin($req);
            $body = $req->json();
            return LocalAI::registerProvider((string) ($body['model'] ?? ''), (array) ($body['meta'] ?? []));
        });

        $r->get('/api/localai/profiles', static function (Request $req): array {
            Auth::requireViewer($req);
            return LocalAI::profiles();
        });

        $r->post('/api/localai/profiles', static function (Request $req): array {
            Auth::requireDeveloper($req);
            $body = $req->json();
            return LocalAI::saveProfile((string) ($body['name'] ?? 'default'), (array) ($body['profile'] ?? []));
        });

        $r->delete('/api/localai/profiles/{name}', static function (Request $req): array {
            Auth::requireDeveloper($req);
            return LocalAI::deleteProfile((string) ($req->params['name'] ?? ''));
        });
    }

    /* ------------------------------------------------------------ */
    /* Static UI                                                     */
    /* ------------------------------------------------------------ */

    private static function serveSpa(): void
    {
        $index = Bootstrap::$publicDir . '/index.html';
        if (!is_file($index)) {
            Response::html('<h1>Arena Coding Agent</h1><p>public/index.html is missing.</p>', 500);
            return;
        }
        Response::raw(self::withApiBase(Files::read($index)), 'text/html; charset=utf-8');
    }

    /**
     * Tell the page which URL prefix its API calls need.
     *
     * The front end ships with absolute `/api/...` paths, which only work when
     * the app owns the domain root *and* URL rewriting is available. Injecting
     * the detected prefix makes subdirectory installs and rewrite-less hosts
     * work without touching a single call site.
     */
    private static function withApiBase(string $html): string
    {
        $snippet = '<script>window.__API_BASE__=' . json_encode(Request::$basePath, JSON_UNESCAPED_SLASHES)
            . ';window.__NO_REWRITE__=' . (Request::$viaFrontControllerPath ? 'true' : 'false') . ';</script>';
        $pos = stripos($html, '<head>');
        if ($pos !== false) {
            return substr_replace($html, '<head>' . $snippet, $pos, strlen('<head>'));
        }
        return $snippet . $html;
    }

    private static function staticUi(Router $r): void
    {
        foreach (['/', '/chat', '/ui'] as $p) {
            $r->get($p, static function (Request $req): void {
                self::serveSpa();
            });
        }

        // Local-AI wizard: a separate page so the 347 KB SPA stays untouched.
        foreach (['/localai', '/local-ai'] as $p) {
            $r->get($p, static function (Request $req): void {
                $page = Bootstrap::$publicDir . '/localai.html';
                if (!is_file($page)) {
                    Response::json(['detail' => 'localai.html is missing'], 404);
                    return;
                }
                Response::raw(self::withApiBase(Files::read($page)), 'text/html; charset=utf-8');
            });
        }

        // Connectivity self-test. Deliberately unauthenticated and read-only:
        // it has to be reachable precisely when the rest of the app is not.
        foreach (['/diag', '/diagnostics'] as $p) {
            $r->get($p, static function (Request $req): void {
                $page = Bootstrap::$publicDir . '/diag.html';
                if (!is_file($page)) {
                    Response::json(['detail' => 'diag.html is missing'], 404);
                    return;
                }
                Response::raw(self::withApiBase(Files::read($page)), 'text/html; charset=utf-8');
            });
        }

        $r->setFallback(static function (Request $req): void {
            if (str_starts_with($req->path, '/api/')) {
                Response::json(['detail' => "No API route for {$req->path}"], 404);
                return;
            }
            if ($req->method !== 'GET' && $req->method !== 'HEAD') {
                Response::json(['detail' => 'Method not allowed'], 405);
                return;
            }
            // Static asset from public/, else the SPA (client-side routing).
            $rel = Files::normalizeRel($req->path);
            $abs = Bootstrap::$publicDir . '/' . $rel;
            $realPublic = realpath(Bootstrap::$publicDir) ?: Bootstrap::$publicDir;
            $realAbs = realpath($abs);
            if ($rel !== '' && $realAbs !== false && str_starts_with($realAbs, $realPublic) && is_file($realAbs)) {
                if (str_ends_with(strtolower($realAbs), '.html')) {
                    Response::raw(self::withApiBase(Files::read($realAbs)), 'text/html; charset=utf-8');
                    return;
                }
                Response::file($realAbs, Files::mimeType($realAbs));
                return;
            }
            self::serveSpa();
        });
    }
}
