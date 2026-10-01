<?php
/**
 * End-to-end provider-catalog import, exercised against the real router.
 *
 *   node tools/phprun.mjs tools/tests/import.php
 *
 * Covers the shape users actually paste: an object keyed by provider id whose
 * models carry foreign bookkeeping (tested / available / testDetails /
 * nonChat) that must survive a save + reload round trip.
 */
declare(strict_types=1);

namespace Arena;

putenv('AUTH_ENABLED=false');
putenv('AGENT_DATA_DIR=/tmp/agentdata');
putenv('AGENT_STORAGE_DIR=/tmp/agentstorage');

require_once '/app/app/Bootstrap.php';

function line(string $s = ''): void { echo $s, "\n"; }

Bootstrap::init();
line('Bootstrap::init ......... ok   root=' . Bootstrap::$root . '  v' . APP_VERSION);
Database::init();
line('Database::init .......... ok   ' . Database::path());

$payload = json_encode([
    'ollama' => [
        'id' => 'ollama', 'name' => 'Ollama', 'vendor' => 'ollama-models',
        'url' => 'http://127.0.0.1:11434', 'apiKey' => '', 'enabled' => false, 'models' => [],
    ],
    'openrouter' => [
        'id' => 'openrouter', 'name' => 'OpenRouter', 'vendor' => 'openrouter',
        'url' => 'https://openrouter.ai/api/v1',
        'apiKey' => 'sk-or-v1-TESTKEY', 'enabled' => true,
        'models' => [
            [
                'id' => 'bytedance-seed/seed-2-1-turbo', 'name' => 'ByteDance Seed: Seed 2.1 Turbo',
                'toolCalling' => true, 'vision' => false, 'free' => false,
                'maxInputTokens' => 262144, 'maxOutputTokens' => 8192,
                'tested' => true, 'available' => false, 'rateLimited' => false,
                'testDetails' => [
                    'status' => 403, 'testMsg' => 'سلام', 'latencyMs' => 15407,
                    'via' => 'worker', 'kind' => 'proxy',
                    'note' => 'خطا از مسیرِ عبور (Worker/پروکسی/CDN) است نه از خودِ مدل',
                ],
            ],
            [
                'id' => 'nvidia/nemotron-3.5-lightning', 'name' => 'NVIDIA: Nemotron 3.5 Lightning',
                'toolCalling' => true, 'maxInputTokens' => 1048576, 'maxOutputTokens' => 8192,
                'tested' => true, 'available' => false,
                'testDetails' => ['status' => 403, 'via' => 'worker'],
                'nonChat' => true,
                'nonChatReason' => 'تولید تصویر — خروجی‌اش تصویر است نه متن',
            ],
        ],
    ],
], JSON_UNESCAPED_UNICODE);

line('payload ................. ' . strlen($payload) . ' bytes');
line();

line('=== 1. ProviderStore::importJson() directly ===');
try {
    $store = ProviderStore::load();
    $report = $store->importJson($payload, false);
    line('  providers=' . $report['providers'] . ' models=' . $report['models']
        . ' created=[' . implode(',', $report['created']) . ']'
        . ' updated=[' . implode(',', $report['updated']) . ']'
        . ' skipped=' . count($report['skipped']));
    foreach ($store->data as $id => $p) {
        line("  - {$id}: protocol={$p['protocol']} enabled=" . var_export($p['enabled'], true)
            . ' models=' . count($p['models']));
        foreach ($p['models'] as $m) {
            line('      * ' . $m['id'] . ' enabled=' . var_export($m['enabled'], true)
                . ' extraKeys=[' . implode(',', array_keys($m['extra'])) . ']');
        }
    }
} catch (\Throwable $e) {
    line('  FAILED ' . get_class($e) . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
}
line();

line('=== 2. POST /api/providers/import-text through the real router ===');
$_SERVER = [
    'REQUEST_METHOD' => 'POST',
    'REQUEST_URI' => '/api/providers/import-text',
    'SCRIPT_NAME' => '/index.php',
    'SCRIPT_FILENAME' => '/app/public/index.php',
    'CONTENT_TYPE' => 'application/json',
];
$_GET = [];

$req = Request::capture();
$req->rawBody = json_encode(['json' => $payload, 'replace' => false]);
line('  Request::capture -> path=' . $req->path . '  basePath=' . var_export(Request::$basePath, true));

try {
    if (!Auth::middleware($req)) {
        line('  Auth::middleware rejected the request');
    } else {
        line('  Auth ................. user=' . ($req->user['username'] ?? '?')
            . ' role=' . ($req->user['role'] ?? '?'));
        $router = new Router();
        Routes::register($router);
        ob_start();
        $router->dispatch($req);
        $body = ob_get_clean();
        line('  HTTP ' . http_response_code());
        line('  body: ' . substr($body, 0, 400));
    }
} catch (\Throwable $e) {
    line('  ' . get_class($e) . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
}
line();

line('=== 3. persisted catalog ===');
$f = ProviderStore::file();
line('  file=' . $f . ' exists=' . var_export(is_file($f), true));
if (is_file($f)) {
    $raw = json_decode((string) file_get_contents($f), true);
    foreach ($raw as $id => $p) {
        line('  - ' . $id . ' apiKey=' . substr((string) ($p['apiKey'] ?? ''), 0, 12) . '…'
            . ' models=' . count($p['models'] ?? []));
    }
    ProviderStore::reload();
    $again = ProviderStore::load();
    $m = $again->data['openrouter']['models'][0] ?? null;
    line('  round-trip extra keys: ' . ($m ? implode(',', array_keys($m['extra'])) : 'NO MODEL'));
}
