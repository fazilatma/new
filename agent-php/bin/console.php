#!/usr/bin/env php
<?php
/**
 * Maintenance CLI for the PHP edition.
 *
 *   php bin/console.php doctor              # runtime capability report
 *   php bin/console.php migrate             # create/update the SQLite schema
 *   php bin/console.php serve [port]        # PHP built-in dev server
 *   php bin/console.php user:add <u> <p> [role]
 *   php bin/console.php user:passwd <u> <p>
 *   php bin/console.php user:list
 *   php bin/console.php config:get [KEY]
 *   php bin/console.php config:set KEY VALUE
 *   php bin/console.php provider:list
 *   php bin/console.php provider:test <providerId>
 *   php bin/console.php jobs:drain
 *   php bin/console.php jobs:list
 *   php bin/console.php logs [limit]
 *   php bin/console.php routes
 */

declare(strict_types=1);

namespace Arena;

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("bin/console.php must be run from the command line.\n");
}

require_once dirname(__DIR__) . '/app/Bootstrap.php';

Bootstrap::init();

$argv = $argv ?? [];
$cmd = $argv[1] ?? 'help';
$out = static fn(string $s = '') => fwrite(STDOUT, $s . PHP_EOL);
$json = static fn(mixed $v) => fwrite(STDOUT, json_encode($v, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL);

switch ($cmd) {
    case 'doctor':
        $caps = Bootstrap::capabilities();
        $out('Arena Coding Agent ' . APP_VERSION . ' (ported from Python ' . PORTED_FROM_VERSION . ')');
        $out(str_repeat('-', 60));
        foreach ($caps as $k => $v) {
            $shown = is_bool($v) ? ($v ? 'yes' : 'NO') : (string) ($v ?? '— not found');
            $out(str_pad((string) $k, 16) . ': ' . $shown);
        }
        $out(str_repeat('-', 60));
        $missing = Bootstrap::missingRequirements();
        if ($missing) {
            $out('Missing requirements:');
            foreach ($missing as $m) {
                $out('  ! ' . $m);
            }
        } else {
            $out('All requirements satisfied.');
        }
        $out('Browser engine  : ' . Browser::engineName());
        $out('Git available   : ' . (Git::available() ? 'yes' : 'no'));
        $out('Database        : ' . Database::path());
        $scan = LocalAI::hostScan(true);
        $out('RAM             : ' . $scan['memory']['totalGb'] . ' GB total / '
            . $scan['memory']['availableGb'] . ' GB available (budget suggestion: '
            . $scan['suggestedRamBudgetGb'] . ' GB)');
        $out('CPU             : ' . $scan['cpu']['cores'] . ' cores, ' . $scan['cpu']['arch']
            . ($scan['cpu']['avx2'] ? ', avx2' : ''));
        $out('GPU             : ' . ($scan['gpu']['present']
            ? $scan['gpu']['name'] . ' (' . $scan['gpu']['vramGb'] . ' GB VRAM)'
            : 'none detected'));
        $out('Model disk      : ' . $scan['disk']['freeGb'] . ' GB free at ' . $scan['disk']['path']);
        $out('Local AI engine : ' . ($scan['runtime']['installed']
            ? 'ollama ' . ($scan['runtime']['version'] ?: '?') . ($scan['runtime']['running'] ? ' (running)' : ' (stopped)')
            : 'not installed — run `php bin/console.php ai:install <model>`'));
        break;

    case 'migrate':
        Database::init();
        $out('Schema is up to date at ' . Database::path());
        break;

    case 'serve':
        $port = (int) ($argv[2] ?? 8080);
        $host = (string) ($argv[3] ?? '0.0.0.0');
        Database::init();
        $out("Starting PHP development server on http://{$host}:{$port} ...");
        $docroot = Bootstrap::$publicDir;
        passthru(escapeshellarg(PHP_BINARY) . ' -S ' . escapeshellarg("{$host}:{$port}") . ' -t ' . escapeshellarg($docroot) . ' ' . escapeshellarg($docroot . '/index.php'));
        break;

    case 'user:add':
        Database::init();
        $u = (string) ($argv[2] ?? '');
        $p = (string) ($argv[3] ?? '');
        $role = (string) ($argv[4] ?? Security::ROLE_DEVELOPER);
        if ($u === '' || $p === '') {
            $out('Usage: php bin/console.php user:add <username> <password> [Admin|Developer|Viewer]');
            exit(1);
        }
        $json(Auth::createUser($u, $p, $role));
        break;

    case 'user:passwd':
        Database::init();
        $u = (string) ($argv[2] ?? '');
        $p = (string) ($argv[3] ?? '');
        if ($u === '' || $p === '') {
            $out('Usage: php bin/console.php user:passwd <username> <newpassword>');
            exit(1);
        }
        [$hash, $salt] = Crypto::hashPassword($p);
        $n = Database::run(
            "UPDATE users SET password_hash = ?, salt = ?, updated_at = datetime('now') WHERE username = ?",
            [$hash, $salt, $u]
        )->rowCount();
        $out($n > 0 ? "Password updated for {$u}." : "User {$u} not found.");
        break;

    case 'user:list':
        Database::init();
        $json(Auth::users());
        break;

    case 'config:get':
        Database::init();
        $key = (string) ($argv[2] ?? '');
        $json($key === '' ? Config::readEnvironment() : [$key => Config::raw($key)]);
        break;

    case 'config:set':
        Database::init();
        $key = (string) ($argv[2] ?? '');
        $val = (string) ($argv[3] ?? '');
        if ($key === '') {
            $out('Usage: php bin/console.php config:set KEY VALUE');
            exit(1);
        }
        Config::writeEnvironment([$key => $val]);
        $out("Saved {$key} to " . Config::envFile());
        break;

    case 'provider:list':
        Database::init();
        $json(ProviderStore::load()->allPublic());
        break;

    case 'provider:test':
        Database::init();
        $pid = (string) ($argv[2] ?? '');
        $store = ProviderStore::load();
        $provider = $store->get($pid);
        if ($provider === null) {
            $out("Provider '{$pid}' not found.");
            exit(1);
        }
        $model = $provider['models'][0] ?? null;
        if ($model === null) {
            $out("Provider '{$pid}' has no models.");
            exit(1);
        }
        $json(Models::testProviderModel($store, $provider, $model));
        break;

    case 'provider:import':
        Database::init();
        $path = (string) ($argv[2] ?? '');
        if ($path === '' || !is_file($path)) {
            $out('Usage: php bin/console.php provider:import <providers.json> [--replace]');
            exit(1);
        }
        $replace = in_array('--replace', array_slice($argv, 3), true);
        $store = ProviderStore::load();
        $report = $store->importJson((string) file_get_contents($path), $replace);
        $out(sprintf(
            'Imported %d provider(s), %d model(s) — created: %s | updated: %s',
            $report['providers'],
            $report['models'],
            implode(', ', $report['created']) ?: '-',
            implode(', ', $report['updated']) ?: '-'
        ));
        foreach ($report['skipped'] as $skip) {
            $out('  skipped ' . $skip['key'] . ': ' . $skip['reason']);
        }
        break;

    case 'provider:export':
        Database::init();
        $dest = (string) ($argv[2] ?? '');
        $body = ProviderStore::load()->exportJson();
        if ($dest === '') {
            $out($body);
        } else {
            file_put_contents($dest, $body);
            $out('Wrote ' . $dest . ' (' . strlen($body) . ' bytes)');
        }
        break;

    case 'jobs:drain':
        Database::init();
        $json(Jobs::drain());
        break;

    case 'jobs:list':
        Database::init();
        $json(Jobs::all(['limit' => (int) ($argv[2] ?? 20)]));
        break;

    case 'logs':
        Database::init();
        $json(Observability::logs(null, null, (int) ($argv[2] ?? 50)));
        break;

    /* -------------------------------------------------- local AI ---- */

    case 'ai:host':
        $json(LocalAI::hostScan(true));
        break;

    case 'ai:runtime':
        $json(LocalAI::runtimeStatus());
        break;

    case 'ai:serve':
        Database::init();
        $json(LocalAI::startServer([], $out));
        break;

    case 'ai:stop':
        Database::init();
        $json(LocalAI::stopServer());
        break;

    case 'ai:recommend':
        Database::init();
        $profileArg = (string) ($argv[2] ?? '');
        $profile = $profileArg !== '' ? (json_decode($profileArg, true) ?: []) : [];
        if (!is_array($profile)) {
            $out('Usage: php bin/console.php ai:recommend \'{"tasks":["code"],"ramBudgetGb":8,"languages":["fa","en"]}\'');
            exit(1);
        }
        $rec = LocalAI::recommend($profile);
        $out('Host: ' . $rec['host']['memory']['totalGb'] . ' GB RAM, '
            . $rec['host']['cpu']['cores'] . ' cores, GPU: '
            . ($rec['host']['gpu']['present'] ? $rec['host']['gpu']['name'] . ' (' . $rec['host']['gpu']['vramGb'] . ' GB)' : 'none'));
        $out('Budget: ' . $rec['profile']['ramBudgetGb'] . ' GB RAM / ' . $rec['profile']['diskBudgetGb'] . ' GB disk');
        $out('');
        foreach ($rec['recommendations'] as $i => $m) {
            $out(sprintf(
                '%2d. %-34s %3d%%  ram %5.1fGB  disk %5.1fGB  ~%5.1f tok/s  %s',
                $i + 1,
                $m['ref'],
                $m['scorePct'],
                $m['estimate']['ramGb'],
                $m['estimate']['diskGb'],
                $m['estimate']['tokensPerSec'],
                $m['license']
            ));
        }
        break;

    case 'ai:install':
        Database::init();
        $ref = (string) ($argv[2] ?? '');
        if ($ref === '') {
            $out('Usage: php bin/console.php ai:install <model:tag> [profileJson]');
            exit(1);
        }
        $prof = isset($argv[3]) ? (json_decode((string) $argv[3], true) ?: []) : [];
        $res = LocalAI::enqueueInstall(['ref' => $ref, 'profile' => $prof, 'force' => true]);
        $jobId = (string) ($res['job']['id'] ?? '');
        $out('Queued install job ' . $jobId . ' for ' . $ref);
        foreach ($res['plan'] as $stepPlan) {
            $out('  • ' . $stepPlan['title'] . ' — ' . $stepPlan['detail']);
        }
        $out('Running it inline (Ctrl-C is safe, the job is resumable):');
        Jobs::execute($jobId);
        $done = Jobs::details($jobId) ?? [];
        $out('Status: ' . (string) ($done['status'] ?? '?') . ' — ' . (string) ($done['summary'] ?? $done['error'] ?? ''));
        break;

    case 'ai:models':
        Database::init();
        $json(LocalAI::installed());
        break;

    case 'ai:rm':
        Database::init();
        $json(LocalAI::remove((string) ($argv[2] ?? '')));
        break;

    case 'ai:test':
        Database::init();
        $json(LocalAI::benchmark((string) ($argv[2] ?? ''), (string) ($argv[3] ?? 'Say OK.')));
        break;

    case 'routes':
        $router = new Router();
        Routes::register($router);
        $out('Registered routes: ' . $router->routeCount());
        foreach ($router->listRoutes() as $route) {
            $out(str_pad((string) $route['method'], 7) . ' ' . $route['pattern']);
        }
        break;

    case 'help':
    default:
        $out(<<<TXT
Arena Coding Agent — PHP edition console

  doctor                        Runtime capability report
  migrate                       Create/update the SQLite schema
  serve [port] [host]           PHP built-in development server
  user:add <u> <p> [role]       Create a user
  user:passwd <u> <p>           Reset a password
  user:list                     List users
  config:get [KEY]              Show configuration
  config:set KEY VALUE          Write configuration to .env
  provider:list                 List providers (keys masked)
  provider:test <providerId>    Health-test the first model of a provider
  provider:import <file> [--replace]
                                Import a providers catalog of any shape (no upload size limit)
  provider:export [file]        Export the catalog (API keys stripped)
  jobs:drain                    Run one queue drain tick
  jobs:list [limit]             List jobs
  logs [limit]                  Show application logs
  routes                        Dump the route table

 Local AI (Ollama runtime, no root required)
  ai:host                       Scan RAM / CPU / GPU / disk / runtime
  ai:runtime                    Local engine status
  ai:serve | ai:stop            Start / stop the local model server
  ai:recommend '<profileJson>'  Rank models for a RAM budget + task
  ai:install <model:tag> [prof] Install, tune, benchmark and register a model
  ai:models                     List installed local models
  ai:rm <model>                 Delete a local model
  ai:test <model> [prompt]      Benchmark a local model

TXT);
        break;
}
