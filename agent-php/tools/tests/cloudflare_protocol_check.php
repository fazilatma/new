<?php
declare(strict_types=1);

namespace Arena;

putenv('AUTH_ENABLED=false');
putenv('AGENT_DATA_DIR=/tmp/agentdata_cloudflare_check');
putenv('AGENT_STORAGE_DIR=/tmp/agentstorage_cloudflare_check');

require_once '/app/app/Bootstrap.php';

Bootstrap::init();

register_shutdown_function(static function (): void {
    $e = error_get_last();
    if ($e !== null && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        fwrite(STDOUT, "FATAL: {$e['message']} in {$e['file']}:{$e['line']}\n");
    }
});

function assertEq($got, $expected, string $label): void {
    if ($got !== $expected) {
        echo "FAIL [$label]: expected " . var_export($expected, true) . " got " . var_export($got, true) . "\n";
    } else {
        echo "OK [$label]\n";
    }
}

function assertTrue($got, string $label): void {
    if ($got !== true) {
        echo "FAIL [$label]: expected true, got " . var_export($got, true) . "\n";
    } else {
        echo "OK [$label]\n";
    }
}

// ---------------------------------------------------------------------
// 1. Catalog seed no longer uses the unrecognized "cloudflare-workers-ai"
//    protocol literal (it matched none of the dispatch branches, so every
//    request silently fell through to the generic openai-compatible
//    builder regardless of the model selected).
// ---------------------------------------------------------------------
$seed = json_decode((string) file_get_contents('/app/data/providers.json'), true);
assertEq($seed['cloudflare']['protocol'] ?? null, 'cloudflare', 'seed catalog protocol fixed');

// ---------------------------------------------------------------------
// 2. ProviderStore::normalizeProvider self-heals legacy/alias protocol values
//    (covers already-persisted user data, not just the bundled seed).
// ---------------------------------------------------------------------
$legacy = ProviderStore::normalizeProvider([
    'id' => 'cf-legacy',
    'name' => 'Cloudflare Legacy',
    'url' => 'https://api.cloudflare.com/client/v4/accounts/abc123/ai/run/@cf/meta/llama-3.1-8b-instruct',
    'protocol' => 'cloudflare-workers-ai',
]);
assertEq($legacy['protocol'], 'cloudflare', 'legacy protocol alias normalized');

// ---------------------------------------------------------------------
// 3. Chat::buildProviderRequest must build a URL that embeds the model
//    that was actually requested, not a hardcoded one, and must strip a
//    pre-baked /ai/run/<model> or /ai/v1 suffix from the base URL.
// ---------------------------------------------------------------------
$provider = [
    'id' => 'cloudflare',
    'protocol' => 'cloudflare',
    'url' => 'https://api.cloudflare.com/client/v4/accounts/abc123/ai/run/@cf/meta/llama-3.1-8b-instruct',
];

foreach ([
    '@cf/meta/llama-3.1-8b-instruct',
    '@cf/aura-1',
    '@cf/openai/gpt-oss-120b',
    '@cf/meta/llama-3.1-70b-instruct',
] as $modelId) {
    $built = Chat::buildProviderRequest($provider, ['id' => $modelId], [['role' => 'user', 'content' => 'hi']], 'tok_abc', false);
    assertEq(
        $built['url'],
        'https://api.cloudflare.com/client/v4/accounts/abc123/ai/run/' . $modelId,
        "cloudflare url embeds selected model ($modelId)"
    );
    assertTrue(!array_key_exists('model', $built['body']), "cloudflare body omits model field ($modelId)");
    assertEq($built['body']['messages'][0]['content'] ?? null, 'hi', "cloudflare body carries messages ($modelId)");
    assertEq($built['headers']['Authorization'] ?? null, 'Bearer tok_abc', "cloudflare bearer header ($modelId)");
}

// A base URL that is already just the account root (no baked-in model)
// must be left intact and simply combined with /ai/run/<model>.
$providerCleanBase = ['id' => 'cloudflare', 'protocol' => 'cloudflare', 'url' => 'https://api.cloudflare.com/client/v4/accounts/abc123'];
$builtClean = Chat::buildProviderRequest($providerCleanBase, ['id' => '@cf/aura-1'], [['role' => 'user', 'content' => 'hi']], '', false);
assertEq($builtClean['url'], 'https://api.cloudflare.com/client/v4/accounts/abc123/ai/run/@cf/aura-1', 'cloudflare url built from clean account root');

// An openai-compat style base (.../ai/v1) must also be stripped correctly.
$providerV1 = ['id' => 'cloudflare', 'protocol' => 'cloudflare', 'url' => 'https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1'];
$builtV1 = Chat::buildProviderRequest($providerV1, ['id' => '@cf/flux'], [['role' => 'user', 'content' => 'hi']], '', false);
assertEq($builtV1['url'], 'https://api.cloudflare.com/client/v4/accounts/abc123/ai/run/@cf/flux', 'cloudflare url strips /ai/v1 suffix too');

// ---------------------------------------------------------------------
// 4. Chat::normalizeResponse parses the native `{result:{response:...}}`
//    shape into the OpenAI-ish choices[0].message.content shape the rest
//    of the app expects.
// ---------------------------------------------------------------------
$normalized = Chat::normalizeResponse($provider, ['result' => ['response' => 'Hello there'], 'success' => true]);
assertEq($normalized['choices'][0]['message']['content'] ?? null, 'Hello there', 'cloudflare response normalized');

// ---------------------------------------------------------------------
// 5. Models::buildTestRequest (the "Test Model" / "Test All" diagnostic
//    harness) must mirror the exact same per-model URL behaviour.
// ---------------------------------------------------------------------
$testReq1 = Models::buildTestRequest($provider, ['id' => '@cf/aura-1'], 'tok_abc');
assertEq($testReq1['url'], 'https://api.cloudflare.com/client/v4/accounts/abc123/ai/run/@cf/aura-1', 'test harness url embeds model (aura-1)');
$testReq2 = Models::buildTestRequest($provider, ['id' => '@cf/gpt-oss-120b'], 'tok_abc');
assertEq($testReq2['url'], 'https://api.cloudflare.com/client/v4/accounts/abc123/ai/run/@cf/gpt-oss-120b', 'test harness url embeds model (gpt-oss-120b)');
assertTrue($testReq1['url'] !== $testReq2['url'], 'test harness no longer returns identical URL for different models');

$rendered = Models::renderText('cloudflare', ['result' => ['response' => 'OK']]);
assertEq($rendered['text'], 'OK', 'test harness renders cloudflare native response text');

echo "DONE\n";
