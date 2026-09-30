<?php

/**
 * Command line companion.
 *
 *   php bin/console.php help
 *
 * Everything the web interface can do to the catalogue, this can do too —
 * which matters when a host's firewall blocks the browser from doing it.
 */

declare(strict_types=1);

namespace Arena;

// Refuse to run if this was reached over HTTP. Testing the SAPI name is the
// usual idiom but it is wrong under alternative runtimes (php-wasm reports
// "wasm"); the presence of a request method is the fact we actually care about.
if (isset($_SERVER['REQUEST_METHOD'])) {
    http_response_code(404);
    exit("This script is for the command line.\n");
}

require_once dirname(__DIR__) . '/src/Bootstrap.php';
Bootstrap::init();

$argv = $_SERVER['argv'] ?? [];
$cmd = $argv[1] ?? 'help';
$out = static fn(string $s = '') => print($s . "\n");

try {
    switch ($cmd) {
        case 'serve':
            $port = (int) ($argv[2] ?? 8080);
            $out("Arena Agent on http://127.0.0.1:{$port}  (Ctrl+C to stop)");
            passthru(sprintf(
                '%s -S 127.0.0.1:%d -t %s %s',
                escapeshellarg(PHP_BINARY),
                $port,
                escapeshellarg(Bootstrap::$publicDir),
                escapeshellarg(Bootstrap::$publicDir . '/index.php')
            ));
            break;

        case 'init':
            Db::pdo();
            $out('Database ready at ' . Db::path());
            $out('Data     ' . Bootstrap::$dataDir);
            $out('Storage  ' . Bootstrap::$storageDir);
            break;

        case 'doctor':
            $checks = [
                'PHP >= 8.1' => version_compare(PHP_VERSION, '8.1.0', '>=') ? PHP_VERSION : false,
                'pdo_sqlite' => extension_loaded('pdo_sqlite'),
                'curl' => function_exists('curl_init'),
                'openssl' => function_exists('openssl_encrypt'),
                'mbstring' => function_exists('mb_strlen'),
                'data writable' => is_writable(Bootstrap::$dataDir),
                'storage writable' => is_writable(Bootstrap::$storageDir),
                'proc_open' => Shell::available(),
            ];
            $bad = 0;
            foreach ($checks as $label => $result) {
                $okay = $result !== false && $result !== null;
                if (!$okay) {
                    $bad++;
                }
                printf("%s %-20s %s\n", $okay ? ' ok ' : 'FAIL', $label,
                    is_string($result) ? $result : '');
            }
            $out($bad ? "\n{$bad} problem(s)." : "\nEverything needed is present.");
            exit($bad ? 1 : 0);

        case 'user:add':
            $name = $argv[2] ?? '';
            $pass = $argv[3] ?? '';
            $role = $argv[4] ?? 'admin';
            if ($name === '' || $pass === '') {
                exit("usage: user:add <username> <password> [viewer|developer|admin]\n");
            }
            if (!isset(Auth::ROLES[$role])) {
                exit("Unknown role: {$role}\n");
            }
            Db::run('INSERT INTO users (id, username, password, role, created_at) VALUES (?,?,?,?,?)', [
                Db::uid('usr'), $name, password_hash($pass, PASSWORD_DEFAULT), $role, Db::now(),
            ]);
            $out("Created {$name} ({$role}).");
            break;

        case 'user:password':
            $name = $argv[2] ?? '';
            $pass = $argv[3] ?? '';
            if ($name === '' || $pass === '') {
                exit("usage: user:password <username> <new-password>\n");
            }
            Db::run('UPDATE users SET password = ? WHERE username = ?',
                [password_hash($pass, PASSWORD_DEFAULT), $name]);
            Db::run('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)', [$name]);
            $out("Password changed for {$name}; existing sessions closed.");
            break;

        case 'user:list':
            foreach (Db::all('SELECT username, role, created_at FROM users ORDER BY username') as $u) {
                printf("  %-20s %-10s %s\n", $u['username'], $u['role'], $u['created_at']);
            }
            break;

        case 'provider:import':
            $file = $argv[2] ?? '';
            if ($file === '' || !is_file($file)) {
                exit("usage: provider:import <file.json> [--replace]\n");
            }
            $report = Providers::import(
                (string) file_get_contents($file),
                in_array('--replace', $argv, true)
            );
            $out("Imported {$report['providers']} provider(s), {$report['models']} model(s).");
            foreach (['created', 'updated'] as $k) {
                if ($report[$k]) {
                    $out(ucfirst($k) . ': ' . implode(', ', $report[$k]));
                }
            }
            break;

        case 'provider:export':
            $out((string) json_encode(
                Providers::export(in_array('--keys', $argv, true)),
                JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
            ));
            break;

        case 'provider:list':
            foreach (Providers::all() as $p) {
                printf("  %-20s %-10s %-3d models  %s\n", $p['id'], $p['protocol'],
                    count($p['models']), $p['hasApiKey'] ? 'key ' . $p['apiKeyHint'] : 'no key');
            }
            break;

        case 'version':
            $out(APP_NAME . ' ' . APP_VERSION . ' (API ' . APP_API_VERSION . ')');
            break;

        default:
            $out(APP_NAME . ' ' . APP_VERSION);
            $out('');
            $out('  serve [port]                     run the built-in web server');
            $out('  init                             create the database and folders');
            $out('  doctor                           check this host can run the app');
            $out('  user:add <name> <pass> [role]    add a user');
            $out('  user:password <name> <pass>      change a password');
            $out('  user:list                        list users');
            $out('  provider:import <file> [--replace]');
            $out('  provider:export [--keys]');
            $out('  provider:list');
            $out('  version');
    }
} catch (\Throwable $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}
