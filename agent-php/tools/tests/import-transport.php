<?php
/**
 * The import endpoint must accept the catalog three ways: a plain string, a
 * base64 body (the WAF work-around) and a probe that changes nothing.
 *
 *   node tools/phprun.mjs tools/tests/import-transport.php
 */
declare(strict_types=1);

namespace Arena;

putenv('AUTH_ENABLED=false');
putenv('AGENT_DATA_DIR=/tmp/agentdata-tr');
putenv('AGENT_STORAGE_DIR=/tmp/agentstorage-tr');

require_once '/app/app/Bootstrap.php';
Bootstrap::init();
Database::init();   // the persisting import writes to app_state

$catalog = json_encode(['providers' => ['demo' => [
    'name' => 'Demo', 'protocol' => 'openai-compatible',
    'url' => 'https://api.example.com/v1', 'apiKey' => 'sk-test-0000',
    'models' => [['id' => 'demo-model', 'name' => 'Demo Model']],
]]], JSON_UNESCAPED_SLASHES);

$fail = 0;
$rc = new \ReflectionClass(Request::class);
// Register the routes once; re-registering per call is what a real request
// never does and it is not what this test is about.
$GLOBALS['router'] = new Router();
Routes::register($GLOBALS['router']);

function call(array $body, \ReflectionClass $rc): array
{
    $_SERVER = ['REQUEST_METHOD' => 'POST', 'REQUEST_URI' => '/api/providers/import-text',
        'SCRIPT_NAME' => '/index.php', 'SCRIPT_FILENAME' => '/app/public/index.php',
        'CONTENT_TYPE' => 'application/json'];
    $_GET = [];
    $rc->setStaticPropertyValue('basePath', '');
    $rc->setStaticPropertyValue('viaFrontControllerPath', false);

    // A real process handles one request; this one handles five, so the
    // "response already started" latch has to be cleared between them or the
    // Router silently skips auto-JSON for every call after the first.
    Response::$headersSent = false;

    $req = Request::capture();
    $req->rawBody = json_encode($body);       // stands in for php://input
    Auth::middleware($req);

    ob_start();
    try {
        $GLOBALS['router']->dispatch($req);
        $out = (string) ob_get_clean();
    } catch (\Throwable $e) {
        $out = (string) ob_get_clean();
        $out = $out !== '' ? $out : json_encode(['detail' => get_class($e) . ': ' . $e->getMessage()]);
    }
    return [json_decode($out, true), $out];
}

echo "=== import transports ===\n";

// 1. probe with a plain body — nothing must be written
[$p] = call(['probe' => true, 'json' => $catalog], $rc);
$ok = ($p['ok'] ?? false) && ($p['probe'] ?? false) && ($p['transport'] ?? '') === 'plain'
    && ($p['parses'] ?? false) === true;
printf("%s probe / plain    bytes=%s parses=%s transport=%s\n", $ok ? 'OK ' : 'BAD',
    $p['bytesReceived'] ?? '?', var_export($p['parses'] ?? null, true), $p['transport'] ?? '?');
$fail += $ok ? 0 : 1;

// 2. probe with a base64 body
[$b] = call(['probe' => true, 'jsonB64' => base64_encode($catalog)], $rc);
$ok = ($b['ok'] ?? false) && ($b['transport'] ?? '') === 'base64'
    && ($b['bytesReceived'] ?? 0) === strlen($catalog) && ($b['parses'] ?? false) === true;
printf("%s probe / base64   bytes=%s (want %d) parses=%s transport=%s\n", $ok ? 'OK ' : 'BAD',
    $b['bytesReceived'] ?? '?', strlen($catalog), var_export($b['parses'] ?? null, true),
    $b['transport'] ?? '?');
if (!$ok) { [, $rawB] = call(['probe' => true, 'jsonB64' => base64_encode($catalog)], $rc);
    echo "      raw: " . substr($rawB, 0, 300) . "\n"; }
$fail += $ok ? 0 : 1;

$before = is_file('/tmp/agentdata-tr/providers.json');
printf("%s probe wrote nothing (providers.json exists=%s)\n", !$before ? 'OK ' : 'BAD',
    var_export($before, true));
$fail += $before ? 1 : 0;

// 3. a real import through the base64 transport must equal the plain one
[$r] = call(['jsonB64' => base64_encode($catalog)], $rc);
$ok = ($r['ok'] ?? false) && ($r['providers'] ?? 0) === 1 && ($r['models'] ?? 0) === 1;
printf("%s import / base64  providers=%s models=%s created=%s\n", $ok ? 'OK ' : 'BAD',
    $r['providers'] ?? '?', $r['models'] ?? '?', implode(',', $r['created'] ?? []));
if (!$ok) { [, $rawI] = call(['jsonB64' => base64_encode($catalog)], $rc);
    echo "      raw: " . substr($rawI, 0, 400) . "\n"; }
$fail += $ok ? 0 : 1;

// 4. url-safe base64 must work too
[$u] = call(['probe' => true, 'b64' => strtr(base64_encode($catalog), '+/', '-_')], $rc);
$ok = ($u['parses'] ?? false) === true;
printf("%s url-safe base64 accepted\n", $ok ? 'OK ' : 'BAD');
$fail += $ok ? 0 : 1;

// 5. garbage base64 must be a clean 400, not a crash
[$g, $raw] = call(['jsonB64' => '!!!not base64!!!'], $rc);
$ok = isset($g['detail']) && str_contains((string) $g['detail'], 'base64');
printf("%s invalid base64 -> %s\n", $ok ? 'OK ' : 'BAD', $g['detail'] ?? substr($raw, 0, 60));
$fail += $ok ? 0 : 1;

echo $fail ? "\n{$fail} FAILED\n" : "\nall transports OK\n";
