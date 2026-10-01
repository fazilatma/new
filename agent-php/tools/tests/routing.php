<?php
/**
 * Request::capture() must resolve the install prefix on every kind of host.
 *
 *   node tools/phprun.mjs tools/tests/routing.php
 */
declare(strict_types=1);

namespace Arena;

putenv('AUTH_ENABLED=false');
putenv('AGENT_DATA_DIR=/tmp/agentdata');
putenv('AGENT_STORAGE_DIR=/tmp/agentstorage');

require_once '/app/app/Bootstrap.php';
Bootstrap::init();

$cases = [
    ['php -S dev server', [
        'REQUEST_URI' => '/api/health', 'SCRIPT_NAME' => '/index.php',
        'SCRIPT_FILENAME' => '/app/public/index.php'], [], '/api/health', ''],
    ['php -S SCRIPT_NAME=path', [
        'REQUEST_URI' => '/api/health', 'SCRIPT_NAME' => '/api/health',
        'SCRIPT_FILENAME' => '/app/public/index.php'], [], '/api/health', ''],
    ['Apache root + rewrite', [
        'REQUEST_URI' => '/api/health', 'SCRIPT_NAME' => '/index.php',
        'SCRIPT_FILENAME' => '/var/www/public/index.php'], [], '/api/health', ''],
    ['subdir + rewrite', [
        'REQUEST_URI' => '/agent/api/health', 'SCRIPT_NAME' => '/agent/index.php',
        'SCRIPT_FILENAME' => '/var/www/agent/index.php'], [], '/api/health', '/agent'],
    ['NO rewrite, PATH_INFO', [
        'REQUEST_URI' => '/agent/index.php/api/health', 'PATH_INFO' => '/api/health',
        'SCRIPT_NAME' => '/agent/index.php',
        'SCRIPT_FILENAME' => '/var/www/agent/index.php'], [], '/api/health', '/agent/index.php'],
    ['NO rewrite, no PATH_INFO', [
        'REQUEST_URI' => '/agent/index.php/api/health', 'SCRIPT_NAME' => '/agent/index.php',
        'SCRIPT_FILENAME' => '/var/www/agent/index.php'], [], '/api/health', '/agent/index.php'],
    ['?__path escape hatch', [
        'REQUEST_URI' => '/agent/index.php?__path=/api/health', 'SCRIPT_NAME' => '/agent/index.php',
        'SCRIPT_FILENAME' => '/var/www/agent/index.php'], ['__path' => '/api/health'],
        '/api/health', '/agent/index.php'],
    ['root document', [
        'REQUEST_URI' => '/', 'SCRIPT_NAME' => '/index.php',
        'SCRIPT_FILENAME' => '/var/www/public/index.php'], [], '/', ''],
    ['subdir root document', [
        'REQUEST_URI' => '/agent/', 'SCRIPT_NAME' => '/agent/index.php',
        'SCRIPT_FILENAME' => '/var/www/agent/index.php'], [], '/', '/agent'],
    ['deep subdir', [
        'REQUEST_URI' => '/a/b/public/api/x', 'SCRIPT_NAME' => '/a/b/public/index.php',
        'SCRIPT_FILENAME' => '/srv/a/b/public/index.php'], [], '/api/x', '/a/b/public'],
    // Shapes the client now emits in 'query' mode (v1.3.2). __path must win
    // over the script path AND must not swallow the caller's own parameters.
    ['__path at root', [
        'REQUEST_URI' => '/index.php?__path=/api/providers/import-text',
        'SCRIPT_NAME' => '/index.php',
        'SCRIPT_FILENAME' => '/var/www/public/index.php'],
        ['__path' => '/api/providers/import-text'],
        '/api/providers/import-text', '/index.php'],
    ['__path + extra query', [
        'REQUEST_URI' => '/agent/index.php?__path=/api/observability/export&format=csv',
        'SCRIPT_NAME' => '/agent/index.php',
        'SCRIPT_FILENAME' => '/var/www/agent/index.php'],
        ['__path' => '/api/observability/export', 'format' => 'csv'],
        '/api/observability/export', '/agent/index.php'],
    ['static asset in subdir', [
        'REQUEST_URI' => '/agent/localai.html', 'SCRIPT_NAME' => '/agent/index.php',
        'SCRIPT_FILENAME' => '/var/www/agent/index.php'], [], '/localai.html', '/agent'],
];

$fail = 0;
echo "=== Request::capture() install-prefix resolution ===\n";
$rc = new \ReflectionClass(Request::class);
foreach ($cases as [$label, $srv, $get, $wantPath, $wantBase]) {
    $_SERVER = array_merge(['REQUEST_METHOD' => 'GET'], $srv);
    $_GET = $get;
    $rc->setStaticPropertyValue('basePath', '');
    $rc->setStaticPropertyValue('viaFrontControllerPath', false);

    $r = Request::capture();
    $ok = $r->path === $wantPath && Request::$basePath === $wantBase;
    if (!$ok) {
        $fail++;
    }
    printf(
        "%s %-26s path=%-16s base=%-20s%s\n",
        $ok ? 'OK ' : 'BAD',
        $label,
        $r->path,
        "'" . Request::$basePath . "'",
        $ok ? '' : "  WANT path={$wantPath} base='{$wantBase}'"
    );
}

echo $fail ? "\n{$fail} of " . count($cases) . " FAILED\n" : "\nall " . count($cases) . " shapes correct\n";

// --- the ?__path= hatch must leave the caller's own query intact ---------
echo "\n=== ?__path= query handling ===\n";
$_SERVER = ['REQUEST_METHOD' => 'GET',
    'REQUEST_URI' => '/agent/index.php?__path=/api/observability/export&format=csv',
    'SCRIPT_NAME' => '/agent/index.php',
    'SCRIPT_FILENAME' => '/var/www/agent/index.php'];
$_GET = ['__path' => '/api/observability/export', 'format' => 'csv'];
$rc->setStaticPropertyValue('basePath', '');
$rc->setStaticPropertyValue('viaFrontControllerPath', false);
$r = Request::capture();
$stripped = !isset($_GET['__path']);
$kept = (($r->query['format'] ?? null) === 'csv');
printf("%s __path removed from \$_GET\n", $stripped ? 'OK ' : 'BAD');
printf("%s caller's own ?format=csv survives (got %s)\n", $kept ? 'OK ' : 'BAD',
    var_export($r->query['format'] ?? null, true));
if (!$stripped || !$kept) { $fail++; }

echo $fail ? "\nROUTING TESTS FAILED\n" : "\nrouting OK\n";
