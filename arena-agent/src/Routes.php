<?php

/**
 * The complete HTTP surface.
 *
 * Handlers return an array (serialised to JSON automatically) or write a
 * response themselves. Failures are raised as HttpError and turned into
 * {"error": "..."} by the front controller.
 */

declare(strict_types=1);

namespace Arena;

final class Routes
{
    public static function register(Router $r): void
    {
        self::meta($r);
        self::auth($r);
        self::providers($r);
        self::chat($r);
        self::workspace($r);
        self::shell($r);
        self::settings($r);
        self::ui($r);
    }

    /* ---------------------------------------------------------------- */

    private static function meta(Router $r): void
    {
        $r->get('/api/health', static fn(Request $q): array => [
            'status' => 'ok', 'version' => APP_VERSION, 'apiVersion' => APP_API_VERSION,
        ]);

        // Everything an operator needs to see why an install misbehaves.
        $r->get('/api/diag', static function (Request $q): array {
            $paths = [];
            foreach (['data' => Bootstrap::$dataDir, 'storage' => Bootstrap::$storageDir,
                      'workspaces' => Bootstrap::$storageDir . '/workspaces'] as $k => $p) {
                $paths[$k] = ['path' => $p, 'exists' => is_dir($p), 'writable' => is_writable($p)];
            }
            $db = ['driver' => in_array('sqlite', \PDO::getAvailableDrivers(), true)];
            try {
                Db::pdo();
                $db['connected'] = true;
                $db['file'] = Db::path();
                $db['sizeBytes'] = is_file(Db::path()) ? (int) filesize(Db::path()) : 0;
            } catch (\Throwable $e) {
                $db['connected'] = false;
                $db['error'] = $e->getMessage();
            }
            return [
                'status' => 'ok',
                'name' => APP_NAME,
                'version' => APP_VERSION,
                'apiVersion' => APP_API_VERSION,
                'routing' => [
                    'seenPath' => $q->path,
                    'entry' => Request::$entry,
                    'dir' => Request::$dir,
                    'apiUrlExample' => Request::url('/api/health'),
                    'requestUri' => (string) ($_SERVER['REQUEST_URI'] ?? ''),
                    'scriptName' => (string) ($_SERVER['SCRIPT_NAME'] ?? ''),
                    'pathInfo' => (string) ($_SERVER['PATH_INFO'] ?? ''),
                ],
                'php' => [
                    'version' => PHP_VERSION,
                    'sapi' => PHP_SAPI,
                    'postMaxSize' => ini_get('post_max_size'),
                    'uploadMaxFilesize' => ini_get('upload_max_filesize'),
                    'memoryLimit' => ini_get('memory_limit'),
                    'maxExecutionTime' => ini_get('max_execution_time'),
                    'extensions' => [
                        'pdo_sqlite' => extension_loaded('pdo_sqlite'),
                        'curl' => function_exists('curl_init'),
                        'openssl' => function_exists('openssl_encrypt'),
                        'mbstring' => function_exists('mb_strlen'),
                    ],
                    'disabledFunctions' => Shell::disabledFunctions(),
                ],
                'db' => $db,
                'paths' => $paths,
                'auth' => ['enabled' => Bootstrap::authEnabled(), 'signedIn' => $q->user !== null],
                'shell' => ['enabled' => Shell::enabled(), 'available' => Shell::available()],
                'encryption' => ['available' => Crypto::available()],
            ];
        });

        // Echo: proves a POST body survived the network, the web server and any
        // WAF in between. Costs nothing and settles most "it just fails" reports.
        $r->post('/api/echo', static function (Request $q): array {
            $body = $q->body();
            return [
                'ok' => true,
                'bytesReceived' => strlen($body),
                'contentLength' => (int) $q->header('content-length', '0'),
                'parsedKeys' => array_keys($q->json()),
            ];
        });
    }

    private static function auth(Router $r): void
    {
        $r->get('/api/auth/status', static fn(Request $q): array => [
            'enabled' => Bootstrap::authEnabled(),
            'signedIn' => $q->user !== null,
            'user' => $q->user,
        ]);

        $r->post('/api/auth/login', static function (Request $q): array {
            $out = Auth::login(
                trim((string) $q->input('username', '')),
                (string) $q->input('password', '')
            );
            return ['ok' => true] + $out;
        });

        $r->post('/api/auth/logout', static function (Request $q): array {
            Auth::logout($q);
            return ['ok' => true];
        });

        $r->post('/api/auth/password', static function (Request $q): array {
            $user = Auth::require($q, 'viewer');
            $current = (string) $q->input('currentPassword', '');
            $next = (string) $q->input('newPassword', '');
            if (strlen($next) < 6) {
                throw new HttpError(400, 'The new password must be at least 6 characters.');
            }
            $row = Db::one('SELECT password FROM users WHERE id = ?', [$user['id']]);
            if ($row === null || !password_verify($current, (string) $row['password'])) {
                throw new HttpError(403, 'The current password is not correct.');
            }
            Db::run('UPDATE users SET password = ? WHERE id = ?',
                [password_hash($next, PASSWORD_DEFAULT), $user['id']]);
            Db::run('DELETE FROM sessions WHERE user_id = ?', [$user['id']]);
            Db::audit((string) $user['username'], 'password.changed');
            return ['ok' => true, 'message' => 'Password changed. Sign in again.'];
        });
    }

    private static function providers(Router $r): void
    {
        $r->get('/api/providers', static function (Request $q): array {
            Auth::require($q);
            return ['providers' => Providers::all()];
        });

        $r->post('/api/providers', static function (Request $q): array {
            Auth::require($q, 'admin');
            $id = Providers::save($q->json());
            Db::audit($q->user['username'] ?? null, 'provider.save', $id);
            return ['ok' => true, 'provider' => Providers::find($id)];
        });

        $r->get('/api/providers/{id}', static function (Request $q): array {
            Auth::require($q);
            $p = Providers::find($q->param('id'));
            if ($p === null) {
                throw new HttpError(404, 'No such provider.');
            }
            return ['provider' => $p];
        });

        $r->put('/api/providers/{id}', static function (Request $q): array {
            Auth::require($q, 'admin');
            $id = $q->param('id');
            if (Providers::find($id) === null) {
                throw new HttpError(404, 'No such provider.');
            }
            Providers::save($q->json(), $id);
            return ['ok' => true, 'provider' => Providers::find($id)];
        });

        $r->delete('/api/providers/{id}', static function (Request $q): array {
            Auth::require($q, 'admin');
            Providers::delete($q->param('id'));
            Db::audit($q->user['username'] ?? null, 'provider.delete', $q->param('id'));
            return ['ok' => true];
        });

        // Import accepts pasted text, an uploaded file, or base64 — whichever
        // survives the host. `probe` reports what arrived without saving.
        $r->post('/api/providers/import', static function (Request $q): array {
            Auth::require($q, 'admin');
            $body = $q->json();
            $text = '';

            if (isset($_FILES['file']) && is_array($_FILES['file'])) {
                $f = $_FILES['file'];
                $code = (int) ($f['error'] ?? UPLOAD_ERR_NO_FILE);
                if (in_array($code, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) {
                    throw new HttpError(413, 'That file is larger than upload_max_filesize ('
                        . (ini_get('upload_max_filesize') ?: '?') . ').');
                }
                if ($code === UPLOAD_ERR_OK && is_uploaded_file((string) $f['tmp_name'])) {
                    $text = (string) file_get_contents((string) $f['tmp_name']);
                }
            }
            if ($text === '') {
                $raw = $body['json'] ?? $body['text'] ?? $body['providers'] ?? '';
                $text = is_array($raw) ? (string) json_encode($raw) : (string) $raw;
            }
            if ($text === '') {
                $b64 = (string) ($body['jsonB64'] ?? $body['b64'] ?? '');
                if ($b64 !== '') {
                    $decoded = base64_decode(strtr($b64, '-_', '+/'), true);
                    if ($decoded === false) {
                        throw new HttpError(400, 'The base64 payload could not be decoded.');
                    }
                    $text = $decoded;
                }
            }
            if ($text === '') {
                $declared = (int) $q->header('content-length', '0');
                if ($declared > 0 && $q->body() === '') {
                    throw new HttpError(413, sprintf(
                        'PHP dropped the %s request body before the app saw it. Raise post_max_size (now %s).',
                        Workspace::humanSize($declared), ini_get('post_max_size') ?: '?'
                    ));
                }
                throw new HttpError(400, 'Nothing to import.');
            }

            if (!empty($body['probe'])) {
                return ['ok' => true, 'probe' => true, 'bytesReceived' => strlen($text),
                        'parses' => json_decode($text) !== null];
            }

            $report = Providers::import($text, !empty($body['replace']));
            Db::audit($q->user['username'] ?? null, 'provider.import',
                $report['providers'] . ' providers, ' . $report['models'] . ' models');
            return $report;
        });

        $r->get('/api/providers/{id}/discover', static function (Request $q): array {
            Auth::require($q, 'admin');
            $p = Providers::find($q->param('id'), true);
            if ($p === null) {
                throw new HttpError(404, 'No such provider.');
            }
            return ['models' => Llm::discover($p)];
        });

        $r->post('/api/providers/{id}/models', static function (Request $q): array {
            Auth::require($q, 'admin');
            $id = $q->param('id');
            if (Providers::find($id) === null) {
                throw new HttpError(404, 'No such provider.');
            }
            $models = $q->input('models', []);
            $n = Providers::saveModels($id, is_array($models) ? $models : [], (bool) $q->input('replace', false));
            return ['ok' => true, 'saved' => $n, 'provider' => Providers::find($id)];
        });

        $r->delete('/api/providers/{id}/models/{model*}', static function (Request $q): array {
            Auth::require($q, 'admin');
            Db::run('DELETE FROM models WHERE provider_id = ? AND model_id = ?',
                [$q->param('id'), $q->param('model')]);
            return ['ok' => true];
        });

        $r->post('/api/providers/{id}/test', static function (Request $q): array {
            Auth::require($q, 'admin');
            $p = Providers::find($q->param('id'), true);
            if ($p === null) {
                throw new HttpError(404, 'No such provider.');
            }
            $model = (string) $q->input('model', $p['models'][0]['id'] ?? '');
            if ($model === '') {
                throw new HttpError(400, 'This provider has no models to test with.');
            }
            $built = Llm::build($p, $model, [['role' => 'user', 'content' => 'Reply with the word: ok']], false, 0.0);
            $started = microtime(true);
            [$status, $raw] = Llm::send($built['url'], $built['headers'], $built['body'], 45);
            $ms = (int) round((microtime(true) - $started) * 1000);
            if ($status >= 400) {
                $j = json_decode($raw, true);
                $detail = is_array($j) ? (string) ($j['error']['message'] ?? $j['error'] ?? $raw) : $raw;
                return ['ok' => false, 'status' => $status, 'latencyMs' => $ms,
                        'error' => substr((string) $detail, 0, 400)];
            }
            return ['ok' => true, 'status' => $status, 'latencyMs' => $ms,
                    'reply' => mb_substr(Llm::replyText((string) $p['protocol'], $raw), 0, 200)];
        });

        $r->get('/api/providers-export', static function (Request $q): void {
            Auth::require($q, 'admin');
            $withKeys = ($q->query['keys'] ?? '') === '1';
            Response::send(200, [
                'Content-Type' => 'application/json; charset=utf-8',
                'Content-Disposition' => 'attachment; filename="providers.json"',
            ], (string) json_encode(Providers::export($withKeys), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        });
    }

    private static function chat(Router $r): void
    {
        $r->get('/api/conversations', static function (Request $q): array {
            Auth::require($q);
            return ['conversations' => Chat::conversations()];
        });

        $r->post('/api/conversations', static function (Request $q): array {
            Auth::require($q, 'developer');
            $id = Chat::create((string) $q->input('title', 'New chat'));
            return ['ok' => true, 'id' => $id];
        });

        $r->get('/api/conversations/{id}', static function (Request $q): array {
            Auth::require($q);
            return ['id' => $q->param('id'), 'messages' => Chat::messages($q->param('id'))];
        });

        $r->delete('/api/conversations/{id}', static function (Request $q): array {
            Auth::require($q, 'developer');
            Chat::delete($q->param('id'));
            return ['ok' => true];
        });

        $r->post('/api/chat/stream', static function (Request $q): void {
            Auth::require($q, 'developer');
            Chat::streamReply($q);
        });

        // ------------------------------------------------------------ agent

        $r->get('/api/agent/tools', static function (Request $q): array {
            Auth::require($q);
            return [
                'tools' => array_map(static fn(array $t): array => [
                    'name' => $t['name'],
                    'description' => $t['description'],
                    'writes' => $t['writes'],
                    'parameters' => array_keys($t['parameters']['properties'] ?? []),
                ], Tools::available()),
                'unavailable' => array_values(array_diff(
                    array_column(Tools::declarations(), 'name'),
                    Tools::availableNames()
                )),
                'shell' => ['enabled' => Shell::enabled(), 'available' => Shell::available()],
                'approval' => Changes::mode(),
                'maxSteps' => Agent::MAX_STEPS,
            ];
        });

        $r->post('/api/agent/stream', static function (Request $q): void {
            Auth::require($q, 'developer');
            Agent::run($q);
        });

        // ---------------------------------------------------------- changes

        $r->get('/api/changes', static function (Request $q): array {
            Auth::require($q);
            return [
                'changes' => Changes::list(
                    (string) ($q->query['status'] ?? 'pending'),
                    (string) ($q->query['conversationId'] ?? ''),
                    (int) ($q->query['limit'] ?? 100)
                ),
                'pending' => Changes::pendingCount(),
                'approval' => Changes::mode(),
            ];
        });

        $r->get('/api/changes/{id}', static function (Request $q): array {
            Auth::require($q);
            return Changes::get($q->param('id'));
        });

        $r->post('/api/changes/{id}/approve', static function (Request $q): array {
            Auth::require($q, 'developer');
            return Changes::approve($q->param('id'));
        });

        $r->post('/api/changes/{id}/reject', static function (Request $q): array {
            Auth::require($q, 'developer');
            return Changes::reject($q->param('id'));
        });

        $r->post('/api/changes/{id}/revert', static function (Request $q): array {
            Auth::require($q, 'developer');
            return Changes::revert($q->param('id'));
        });

        $r->post('/api/changes/decide-all', static function (Request $q): array {
            Auth::require($q, 'developer');
            $decision = (string) $q->input('decision', 'approve');
            if (!in_array($decision, ['approve', 'reject'], true)) {
                throw new HttpError(400, "decision must be 'approve' or 'reject'.");
            }
            $done = Changes::decideAll($decision, (string) $q->input('conversationId', ''));
            return ['ok' => true] + $done + ['pending' => Changes::pendingCount()];
        });

        $r->put('/api/changes/mode', static function (Request $q): array {
            Auth::require($q, 'developer');
            $mode = (string) $q->input('mode', 'ask');
            if (!in_array($mode, ['ask', 'auto'], true)) {
                throw new HttpError(400, "mode must be 'ask' or 'auto'.");
            }
            Changes::setMode($mode);
            Db::audit(Auth::currentName(), 'changes.mode', $mode);
            return ['ok' => true, 'approval' => Changes::mode()];
        });

        // -------------------------------------------------------------- git

        $r->get('/api/git', static function (Request $q): array {
            Auth::require($q);
            return Git::overview();
        });

        $r->post('/api/git/init', static function (Request $q): array {
            Auth::require($q, 'developer');
            return Git::init();
        });

        $r->get('/api/git/status', static function (Request $q): array {
            Auth::require($q);
            return Git::status();
        });

        $r->get('/api/git/diff', static function (Request $q): array {
            Auth::require($q);
            return [
                'path' => (string) ($q->query['path'] ?? ''),
                'staged' => ($q->query['staged'] ?? '') === '1',
                'diff' => Git::diff(
                    (string) ($q->query['path'] ?? ''),
                    ($q->query['staged'] ?? '') === '1'
                ),
            ];
        });

        $r->get('/api/git/log', static function (Request $q): array {
            Auth::require($q);
            return ['commits' => Git::log(
                (int) ($q->query['limit'] ?? 30),
                (string) ($q->query['path'] ?? '')
            )];
        });

        $r->post('/api/git/stage', static function (Request $q): array {
            Auth::require($q, 'developer');
            return Git::stage(self::paths($q));
        });

        $r->post('/api/git/unstage', static function (Request $q): array {
            Auth::require($q, 'developer');
            return Git::unstage(self::paths($q));
        });

        $r->post('/api/git/discard', static function (Request $q): array {
            Auth::require($q, 'developer');
            return Git::discard(self::paths($q));
        });

        $r->post('/api/git/commit', static function (Request $q): array {
            Auth::require($q, 'developer');
            $paths = $q->input('paths', []);
            return Git::commit(
                (string) $q->input('message', ''),
                is_array($paths) ? $paths : [],
                (bool) $q->input('all', false)
            );
        });

        $r->get('/api/git/branches', static function (Request $q): array {
            Auth::require($q);
            return Git::branches();
        });

        $r->post('/api/git/checkout', static function (Request $q): array {
            Auth::require($q, 'developer');
            return Git::checkout((string) $q->input('branch', ''), (bool) $q->input('create', false));
        });

        $r->post('/api/git/push', static function (Request $q): array {
            Auth::require($q, 'developer');
            return Git::push(
                (string) $q->input('remote', 'origin'),
                (string) $q->input('branch', ''),
                (bool) $q->input('setUpstream', false)
            );
        });

        $r->post('/api/git/pull', static function (Request $q): array {
            Auth::require($q, 'developer');
            return Git::pull((string) $q->input('remote', 'origin'), (string) $q->input('branch', ''));
        });

        $r->post('/api/git/remote', static function (Request $q): array {
            Auth::require($q, 'admin');
            return Git::setRemote((string) $q->input('name', 'origin'), (string) $q->input('url', ''));
        });

        $r->put('/api/git/config', static function (Request $q): array {
            Auth::require($q, 'admin');
            Git::setIdentity((string) $q->input('name', ''), (string) $q->input('email', ''));
            if ($q->input('token') !== null) {
                Git::setToken((string) $q->input('token', ''));
            }
            return ['ok' => true, 'identity' => Git::identity(), 'hasToken' => Git::hasToken()];
        });
    }

    /**
     * Accept either one path or a list, because both spellings are natural.
     *
     * @return array<int,string>
     */
    private static function paths(Request $q): array
    {
        $paths = $q->input('paths', null);
        if ($paths === null) {
            $one = (string) $q->input('path', '');
            return $one === '' ? [] : [$one];
        }
        return is_array($paths) ? array_map('strval', $paths) : [(string) $paths];
    }

    private static function workspace(Router $r): void
    {
        $r->get('/api/files', static function (Request $q): array {
            Auth::require($q);
            return Workspace::list((string) ($q->query['path'] ?? ''));
        });

        $r->get('/api/file', static function (Request $q): array {
            Auth::require($q);
            return Workspace::read((string) ($q->query['path'] ?? ''));
        });

        $r->put('/api/file', static function (Request $q): array {
            Auth::require($q, 'developer');
            return Workspace::write(
                (string) $q->input('path', ''),
                (string) $q->input('content', '')
            );
        });

        $r->post('/api/files/mkdir', static function (Request $q): array {
            Auth::require($q, 'developer');
            return Workspace::mkdir((string) $q->input('path', ''));
        });

        $r->delete('/api/file', static function (Request $q): array {
            Auth::require($q, 'developer');
            return Workspace::delete((string) ($q->query['path'] ?? $q->input('path', '')));
        });
    }

    private static function shell(Router $r): void
    {
        $r->get('/api/shell', static function (Request $q): array {
            Auth::require($q);
            return [
                'enabled' => Shell::enabled(),
                'available' => Shell::available(),
                'runtimes' => Shell::enabled() ? Shell::runtimes() : new \stdClass(),
            ];
        });

        $r->post('/api/shell/exec', static function (Request $q): array {
            Auth::require($q, 'developer');
            Auth::throttle('shell:' . ($q->user['id'] ?? 'anon'), 60, 60);
            $out = Shell::run(
                (string) $q->input('command', ''),
                (string) $q->input('cwd', ''),
                min(300, max(1, (int) $q->input('timeout', 60)))
            );
            Db::audit($q->user['username'] ?? null, 'shell.exec', (string) $q->input('command', ''));
            return $out;
        });
    }

    private static function settings(Router $r): void
    {
        $r->get('/api/settings', static function (Request $q): array {
            Auth::require($q);
            return ['settings' => [
                'systemPrompt' => Db::setting('system_prompt', ''),
                'defaultProvider' => Db::setting('default_provider', ''),
                'defaultModel' => Db::setting('default_model', ''),
                'theme' => Db::setting('theme', 'dark'),
            ]];
        });

        $r->put('/api/settings', static function (Request $q): array {
            Auth::require($q, 'admin');
            $map = ['systemPrompt' => 'system_prompt', 'defaultProvider' => 'default_provider',
                    'defaultModel' => 'default_model', 'theme' => 'theme'];
            foreach ($q->json() as $k => $v) {
                if (isset($map[$k]) && (is_string($v) || is_numeric($v))) {
                    Db::setSetting($map[$k], (string) $v);
                }
            }
            return ['ok' => true];
        });

        $r->get('/api/audit', static function (Request $q): array {
            Auth::require($q, 'admin');
            return ['entries' => Db::all('SELECT * FROM audit ORDER BY id DESC LIMIT 200')];
        });
    }

    private static function ui(Router $r): void
    {
        $serve = static function (string $file, string $type): void {
            $path = Bootstrap::$publicDir . '/' . $file;
            if (!is_file($path)) {
                Response::json(['error' => $file . ' is missing from public/'], 404);
                return;
            }
            $body = (string) file_get_contents($path);
            if ($type === 'text/html') {
                // The UI must know where to send API calls. Everything else is
                // relative, so this single line is the entire contract.
                $inject = '<script>window.ARENA_API=' .
                    json_encode(Request::$entry, JSON_UNESCAPED_SLASHES) . ';</script>';
                $body = preg_replace('/<head([^>]*)>/i', '<head$1>' . $inject, $body, 1) ?? $body;
            }
            Response::send(200, ['Content-Type' => $type . '; charset=utf-8'], $body);
        };

        $r->get('/', static fn(Request $q) => $serve('app.html', 'text/html'));
        $r->get('/app.html', static fn(Request $q) => $serve('app.html', 'text/html'));
        $r->get('/assets/app.css', static fn(Request $q) => $serve('assets/app.css', 'text/css'));
        $r->get('/assets/app.js', static fn(Request $q) => $serve('assets/app.js', 'text/javascript'));

        $r->fallback(static function (Request $q): void {
            if (str_starts_with($q->path, '/api/')) {
                Response::json(['error' => 'No such endpoint: ' . $q->path], 404);
                return;
            }
            Response::json(['error' => 'Not found: ' . $q->path,
                            'hint' => 'The app lives at ' . Request::$entry], 404);
        });
    }
}
