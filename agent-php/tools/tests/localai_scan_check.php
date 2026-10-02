<?php
declare(strict_types=1);

namespace Arena;

/**
 * Exercises LocalAI's drive scanner directly against its two backends.
 *
 *   node tools/phprun.mjs --spawn tools/tests/localai_scan_check.php
 *
 * `--spawn` is required: scanDirFind() shells out to the real `find`/`timeout`
 * binaries on the host, which only exist outside the php-wasm sandbox. Because
 * a spawned process sees the *real* host filesystem while PHP's own is_dir()/
 * RecursiveDirectoryIterator see the wasm guest's virtual one (only /app is
 * mounted), the two backends are verified against two different fixtures:
 * scanDirFind() against a real host path, scanDirPhp() against a /app path.
 */

putenv('AUTH_ENABLED=false');
putenv('AGENT_DATA_DIR=/tmp/agentdata_localai_scan');
putenv('AGENT_STORAGE_DIR=/tmp/agentstorage_localai_scan');

require_once '/app/app/Bootstrap.php';

Bootstrap::init();

function assertTrue($cond, string $label): void {
    echo ($cond ? "OK" : "FAIL") . " [$label]\n";
}

$ref = new \ReflectionClass(LocalAI::class);

/* ---- backend 1: find/timeout against a real host path ---------------
 * Built by the *host* shell before this script ran (see the task runner),
 * not by PHP itself — anything PHP writes under /tmp lands in the wasm
 * guest's own virtual filesystem, which the spawned `find` cannot see. */
$hostFixture = '/tmp/localai_scan_host_fixture';
// Note: is_dir() here would report false — PHP's own filesystem inside the
// php-wasm sandbox cannot see the real host /tmp, only the spawned `find`
// process (below) can. That split is exactly why this file tests the two
// scan backends separately instead of calling scanDrive() end-to-end.

$findMethod = $ref->getMethod('scanDirFind');
$findMethod->setAccessible(true);
$results = [];
$findMethod->invokeArgs(null, [$hostFixture, ['gguf'], 15, &$results, 50]);
$paths = array_column($results, 'path');
echo "scanDirFind found " . count($results) . " files\n";
assertTrue(in_array($hostFixture . '/model-q4_k_m.gguf', $paths, true), 'find: top-level gguf');
assertTrue(in_array($hostFixture . '/sub1/model2-q8_0.gguf', $paths, true), 'find: nested gguf');
assertTrue(!in_array($hostFixture . '/node_modules/should-be-excluded.gguf', $paths, true), 'find: node_modules excluded');
assertTrue(count($results) === 2, 'find: exactly 2 results');
foreach ($results as $r) {
    assertTrue($r['quant'] !== null, 'find: quant parsed for ' . $r['name']);
}

/* ---- backend 2: PHP RecursiveDirectoryIterator against /app ---------- */
$guestFixture = '/app/tools/tests/fixtures/scan_fixture';
$phpMethod = $ref->getMethod('scanDirPhp');
$phpMethod->setAccessible(true);
$results2 = [];
$started = microtime(true);
$phpMethod->invokeArgs(null, [$guestFixture, ['gguf'], &$results2, 50, $started, 15]);
$paths2 = array_column($results2, 'path');
echo "scanDirPhp found " . count($results2) . " files\n";
assertTrue(in_array($guestFixture . '/model-q4_k_m.gguf', $paths2, true), 'php-iter: top-level gguf');
assertTrue(in_array($guestFixture . '/sub1/model2-q8_0.gguf', $paths2, true), 'php-iter: nested gguf');
assertTrue(!in_array($guestFixture . '/node_modules/should-be-excluded.gguf', $paths2, true), 'php-iter: node_modules excluded');
assertTrue(count($results2) === 2, 'php-iter: exactly 2 results');

/* ---- end-to-end scanDrive() wrapper (root/budget/sort/slice logic) --- */
$scan = LocalAI::scanDrive(['roots' => ['/definitely/does/not/exist'], 'extensions' => ['gguf']]);
assertTrue($scan['count'] === 0, 'scanDrive: missing root is skipped, not fatal');
assertTrue(is_array($scan['results']), 'scanDrive: always returns a results array');

echo "DONE\n";
