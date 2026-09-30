<?php

/**
 * End-to-end smoke test: boot the app and drive real requests through the
 * real router, in every URL shape a host might present.
 *
 *   cd ../agent-php && node tools/phprun.mjs --root=../arena-agent \
 *       ../arena-agent/tools/tests/smoke.php
 */

declare(strict_types=1);

namespace Arena;

putenv('ARENA_DATA_DIR=/tmp/arena-smoke/data');
putenv('ARENA_STORAGE_DIR=/tmp/arena-smoke/storage');
putenv('ARENA_AUTH=true');
putenv('ARENA_ADMIN_USER=admin');
putenv('ARENA_ADMIN_PASS=secret123');

// Start from a clean slate so counts are deterministic.
foreach (['/tmp/arena-smoke/data/arena.sqlite', '/tmp/arena-smoke/data/arena.sqlite-wal',
          '/tmp/arena-smoke/data/arena.sqlite-shm'] as $f) {
    if (is_file($f)) {
        unlink($f);
    }
}

require_once '/app/src/Bootstrap.php';
Bootstrap::init();

// Hold every byte of this script's own output in a buffer. Response::send()
// correctly refuses to set a status once headers are on the wire, so without
// this the first printf() would freeze http_response_code at 200 for the rest
// of the run and every status assertion below would be meaningless.
ob_start();

$fail = 0;
$router = new Router();
Routes::register($router);
$reqClass = new \ReflectionClass(Request::class);

/**
 * Issue one request exactly as the front controller would.
 *
 * @param array<string,mixed> $server
 * @param array<string,mixed> $get
 * @return array{status:int,body:string,json:mixed}
 */
function hit(
    Router $router,
    \ReflectionClass $reqClass,
    string $method,
    array $server,
    array $get = [],
    ?string $body = null,
    ?string $token = null
): array {
    $_SERVER = array_merge([
        'REQUEST_METHOD' => $method,
        'SCRIPT_NAME' => '/index.php',
        'SCRIPT_FILENAME' => '/app/public/index.php',
        'CONTENT_TYPE' => 'application/json',
    ], $server);
    if ($token !== null) {
        $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $token;
    }
    $_GET = $get;
    $_POST = [];
    $reqClass->setStaticPropertyValue('dir', '');
    $reqClass->setStaticPropertyValue('entry', '/index.php');

    // A real process serves one request; this one serves many.
    Response::$started = false;
    http_response_code(200);

    $req = Request::capture();
    $req->rawBody = $body ?? '';
    Auth::resolve($req);

    ob_start();
    try {
        $router->dispatch($req);
    } catch (HttpError $e) {
        if (!Response::$started) {
            Response::json(['error' => $e->getMessage()], $e->status);
        }
    } catch (\Throwable $e) {
        if (!Response::$started) {
            Response::json(['error' => $e::class . ': ' . $e->getMessage()], 500);
        }
    }
    $out = (string) ob_get_clean();
    return ['status' => http_response_code(), 'body' => $out, 'json' => json_decode($out, true)];
}

function check(string $label, bool $ok, string $detail = ''): void
{
    global $fail;
    printf("%s %-46s %s\n", $ok ? 'OK ' : 'BAD', $label, $detail);
    if (!$ok) {
        $fail++;
    }
}

/* ---------------------------------------------------------------- */
echo "=== 1. URL shapes all reach the same route ===\n";

$shapes = [
    'canonical ?p=' => [['REQUEST_URI' => '/index.php?p=/api/health'], ['p' => '/api/health']],
    'rewritten path' => [['REQUEST_URI' => '/api/health'], []],
    'PATH_INFO' => [['REQUEST_URI' => '/index.php/api/health', 'PATH_INFO' => '/api/health'], []],
    'subdir ?p=' => [['REQUEST_URI' => '/agent/index.php?p=/api/health',
                      'SCRIPT_NAME' => '/agent/index.php'], ['p' => '/api/health']],
    'subdir rewritten' => [['REQUEST_URI' => '/agent/api/health',
                            'SCRIPT_NAME' => '/agent/index.php'], []],
    'legacy ?__path=' => [['REQUEST_URI' => '/index.php?__path=/api/health'], ['__path' => '/api/health']],
];
foreach ($shapes as $label => [$server, $get]) {
    $r = hit($router, $reqClass, 'GET', $server, $get);
    check($label, ($r['json']['status'] ?? '') === 'ok', 'HTTP ' . $r['status']);
}

/* ---------------------------------------------------------------- */
echo "\n=== 2. authentication ===\n";

$r = hit($router, $reqClass, 'GET', ['REQUEST_URI' => '/index.php'], ['p' => '/api/providers']);
check('providers rejected when signed out', $r['status'] === 401, (string) ($r['json']['error'] ?? ''));

$r = hit($router, $reqClass, 'POST', ['REQUEST_URI' => '/index.php'], ['p' => '/api/auth/login'],
    (string) json_encode(['username' => 'admin', 'password' => 'wrong']));
check('wrong password refused', $r['status'] === 401);

$r = hit($router, $reqClass, 'POST', ['REQUEST_URI' => '/index.php'], ['p' => '/api/auth/login'],
    (string) json_encode(['username' => 'admin', 'password' => 'secret123']));
$token = (string) ($r['json']['token'] ?? '');
check('login succeeds', $r['status'] === 200 && $token !== '',
    'role=' . ($r['json']['user']['role'] ?? '?'));

$r = hit($router, $reqClass, 'GET', ['REQUEST_URI' => '/index.php'], ['p' => '/api/providers'], null, $token);
check('bearer token accepted', $r['status'] === 200);

/* ---------------------------------------------------------------- */
echo "\n=== 3. provider import, every shape ===\n";

$catalog = [
    'openrouter' => [
        'name' => 'OpenRouter', 'protocol' => 'openai-compatible',
        'url' => 'https://openrouter.ai/api/v1', 'apiKey' => 'sk-or-test-123',
        'models' => [
            ['id' => 'qwen/qwen3-8b', 'name' => 'Qwen3 8B', 'toolCalling' => true, 'tested' => true],
            ['id' => 'embed-only', 'name' => 'Embeddings', 'nonChat' => true],
        ],
    ],
    'local' => [
        'name' => 'Ollama', 'url' => 'http://127.0.0.1:11434',
        'models' => ['llama3.2', 'qwen3:8b'],
    ],
];

$variants = [
    'object keyed by id' => $catalog,
    'wrapped in providers' => ['providers' => $catalog],
    'plain list' => array_values(array_map(
        static fn(string $k, array $v): array => $v + ['id' => $k],
        array_keys($catalog),
        $catalog
    )),
    'export envelope' => ['version' => '2.0.0', 'exportedAt' => 'now', 'providers' => array_values($catalog)],
];
foreach ($variants as $label => $payload) {
    $r = hit($router, $reqClass, 'POST', ['REQUEST_URI' => '/index.php'], ['p' => '/api/providers/import'],
        (string) json_encode(['json' => json_encode($payload), 'replace' => true]), $token);
    $j = $r['json'];
    check($label, ($j['ok'] ?? false) && ($j['providers'] ?? 0) === 2,
        'providers=' . ($j['providers'] ?? '?') . ' models=' . ($j['models'] ?? '?')
        . (isset($j['error']) ? ' err=' . $j['error'] : ''));
}

// base64 transport (the WAF work-around) and probe mode
$r = hit($router, $reqClass, 'POST', ['REQUEST_URI' => '/index.php'], ['p' => '/api/providers/import'],
    (string) json_encode(['jsonB64' => base64_encode((string) json_encode($catalog))]), $token);
check('base64 transport', ($r['json']['ok'] ?? false) && ($r['json']['providers'] ?? 0) === 2);

$r = hit($router, $reqClass, 'POST', ['REQUEST_URI' => '/index.php'], ['p' => '/api/providers/import'],
    (string) json_encode(['probe' => true, 'json' => json_encode($catalog)]), $token);
check('probe reports without saving', ($r['json']['probe'] ?? false) === true,
    ($r['json']['bytesReceived'] ?? '?') . ' bytes');

// malformed input must explain itself, not 500
$r = hit($router, $reqClass, 'POST', ['REQUEST_URI' => '/index.php'], ['p' => '/api/providers/import'],
    (string) json_encode(['json' => '{"broken": ']), $token);
check('malformed JSON -> 400 with a reason', $r['status'] === 400,
    substr((string) ($r['json']['error'] ?? ''), 0, 48));

// trailing commas are tolerated
$r = hit($router, $reqClass, 'POST', ['REQUEST_URI' => '/index.php'], ['p' => '/api/providers/import'],
    (string) json_encode(['json' => '{"demo": {"name": "Demo", "models": [{"id": "m1"},]},}']), $token);
check('trailing commas tolerated', ($r['json']['ok'] ?? false) === true);

/* ---------------------------------------------------------------- */
echo "\n=== 4. catalogue fidelity ===\n";

$r = hit($router, $reqClass, 'POST', ['REQUEST_URI' => '/index.php'], ['p' => '/api/providers/import'],
    (string) json_encode(['json' => json_encode($catalog), 'replace' => true]), $token);
$r = hit($router, $reqClass, 'GET', ['REQUEST_URI' => '/index.php'], ['p' => '/api/providers'], null, $token);
$byId = [];
foreach ($r['json']['providers'] ?? [] as $p) {
    $byId[$p['id']] = $p;
}
check('protocol inferred for OpenRouter', ($byId['openrouter']['protocol'] ?? '') === 'openai',
    $byId['openrouter']['protocol'] ?? '?');
check('protocol inferred from :11434 URL', ($byId['local']['protocol'] ?? '') === 'ollama',
    $byId['local']['protocol'] ?? '?');
check('api key stored encrypted', ($byId['openrouter']['hasApiKey'] ?? false)
    && ($byId['openrouter']['apiKey'] ?? null) === null,
    'hint=' . ($byId['openrouter']['apiKeyHint'] ?? ''));
$models = [];
foreach ($byId['openrouter']['models'] ?? [] as $m) {
    $models[$m['id']] = $m;
}
check('nonChat model parked, not dropped',
    isset($models['embed-only']) && $models['embed-only']['enabled'] === false);
check('unknown model keys preserved in extra',
    ($models['qwen/qwen3-8b']['extra']['tested'] ?? null) === true);
check('string model list expanded', count($byId['local']['models'] ?? []) === 2);

$raw = Db::one('SELECT api_key FROM providers WHERE id = ?', ['openrouter']);
check('ciphertext on disk, not plaintext',
    str_starts_with((string) ($raw['api_key'] ?? ''), 'enc:v1:'),
    substr((string) ($raw['api_key'] ?? ''), 0, 18) . '…');

/* ---------------------------------------------------------------- */
echo "\n=== 5. workspace ===\n";

$r = hit($router, $reqClass, 'PUT', ['REQUEST_URI' => '/index.php'], ['p' => '/api/file'],
    (string) json_encode(['path' => 'notes/hello.txt', 'content' => "سلام\nworld"]), $token);
check('write creates nested folders', ($r['json']['ok'] ?? false) === true);

$r = hit($router, $reqClass, 'GET', ['REQUEST_URI' => '/index.php'],
    ['p' => '/api/file', 'path' => 'notes/hello.txt'], null, $token);
check('read returns the same bytes', ($r['json']['content'] ?? '') === "سلام\nworld");

$r = hit($router, $reqClass, 'GET', ['REQUEST_URI' => '/index.php'],
    ['p' => '/api/file', 'path' => '../../../etc/passwd'], null, $token);
check('traversal refused', $r['status'] >= 400, (string) ($r['json']['error'] ?? ''));

$r = hit($router, $reqClass, 'GET', ['REQUEST_URI' => '/index.php'],
    ['p' => '/api/files', 'path' => 'notes'], null, $token);
check('listing works', count($r['json']['items'] ?? []) === 1);

/* ---------------------------------------------------------------- */
echo "\n=== 6. chat plumbing ===\n";

$r = hit($router, $reqClass, 'POST', ['REQUEST_URI' => '/index.php'], ['p' => '/api/conversations'],
    (string) json_encode(['title' => 'New chat']), $token);
$cid = (string) ($r['json']['id'] ?? '');
check('conversation created', $cid !== '');

Chat::addMessage($cid, 'user', 'first question about routing');
Chat::autoTitle($cid, 'first question about routing');
$r = hit($router, $reqClass, 'GET', ['REQUEST_URI' => '/index.php'], ['p' => '/api/conversations'], null, $token);
$titles = array_column($r['json']['conversations'] ?? [], 'title');
check('conversation auto-titled', in_array('first question about routing', $titles, true),
    implode(' | ', $titles));

$r = hit($router, $reqClass, 'GET', ['REQUEST_URI' => '/index.php'],
    ['p' => '/api/conversations/' . $cid], null, $token);
check('messages round-trip', count($r['json']['messages'] ?? []) === 1);

/* ---------------------------------------------------------------- */
echo "\n=== 7. errors and diagnostics ===\n";

$r = hit($router, $reqClass, 'GET', ['REQUEST_URI' => '/index.php'], ['p' => '/api/nope'], null, $token);
check('unknown API path -> JSON 404', $r['status'] === 404
    && str_contains((string) ($r['json']['error'] ?? ''), 'No such endpoint'));

$r = hit($router, $reqClass, 'DELETE', ['REQUEST_URI' => '/index.php'], ['p' => '/api/health'], null, $token);
check('wrong verb -> 405 with Allow', $r['status'] === 405);

$r = hit($router, $reqClass, 'POST', ['REQUEST_URI' => '/index.php'], ['p' => '/api/echo'],
    str_repeat('x', 5000), $token);
check('echo confirms body arrival', ($r['json']['bytesReceived'] ?? 0) === 5000);

$r = hit($router, $reqClass, 'GET', ['REQUEST_URI' => '/index.php'], ['p' => '/api/diag'], null, $token);
$d = $r['json'];
check('diag reports db + paths', ($d['db']['connected'] ?? false) === true
    && ($d['paths']['data']['writable'] ?? false) === true,
    'php ' . ($d['php']['version'] ?? '?'));

$r = hit($router, $reqClass, 'GET', ['REQUEST_URI' => '/index.php'], ['p' => '/'], null, $token);
check('UI served with API base injected',
    str_contains($r['body'], 'window.ARENA_API') && str_contains($r['body'], '<title>Arena Agent'));

echo $fail ? "\n{$fail} CHECK(S) FAILED\n" : "\nall checks passed\n";

while (ob_get_level() > 0) {
    ob_end_flush();
}
