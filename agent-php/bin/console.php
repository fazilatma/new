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
  jobs:drain                    Run one queue drain tick
  jobs:list [limit]             List jobs
  logs [limit]                  Show application logs
  routes                        Dump the route table

TXT);
        break;
}
