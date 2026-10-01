<?php

/**
 * Arena Agent — the only entry point.
 *
 * Copy this directory anywhere a PHP host will serve it. No rewrite rules, no
 * virtual host, no document-root change. If the host can run a .php file, the
 * app works, because every URL is of the form:
 *
 *     index.php?p=/api/whatever
 */

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/Bootstrap.php';

use Arena\Auth;
use Arena\Bootstrap;
use Arena\Db;
use Arena\HttpError;
use Arena\Request;
use Arena\Response;
use Arena\Router;
use Arena\Routes;

Bootstrap::init();

$req = Request::capture();

try {
    if (version_compare(PHP_VERSION, '8.1.0', '<')) {
        throw new HttpError(500, 'Arena Agent needs PHP 8.1 or newer; this host runs ' . PHP_VERSION . '.');
    }

    // Health and diag must answer even when the database is unreachable, so
    // the session lookup is allowed to fail quietly for them.
    try {
        Auth::resolve($req);
    } catch (\Throwable $e) {
        if (!in_array($req->path, ['/api/health', '/api/diag'], true)) {
            throw $e;
        }
    }

    $router = new Router();
    Routes::register($router);
    $router->dispatch($req);
} catch (HttpError $e) {
    if (!Response::$started) {
        Response::json(['error' => $e->getMessage()] + $e->extra, $e->status);
    }
} catch (\PDOException $e) {
    error_log('[arena] database: ' . $e->getMessage());
    if (!Response::$started) {
        Response::json([
            'error' => 'The database could not be opened. Check that ' . Bootstrap::$dataDir
                . ' is writable by the web server.',
            'detail' => $e->getMessage(),
        ], 500);
    }
} catch (\Throwable $e) {
    error_log('[arena] ' . $e::class . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    if (!Response::$started) {
        Response::json([
            'error' => $e->getMessage(),
            'type' => $e::class,
            'where' => basename($e->getFile()) . ':' . $e->getLine(),
        ], 500);
    }
}
