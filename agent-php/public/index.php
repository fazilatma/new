<?php
/**
 * Front controller. Equivalent of `uvicorn app.main:app` in the Python
 * edition and of `export default { fetch }` in the Workers edition.
 *
 * Every request enters here (see public/.htaccess for Apache, or the nginx
 * try_files rule in DEPLOYMENT.md).
 */

declare(strict_types=1);

namespace Arena;

require_once dirname(__DIR__) . '/app/Bootstrap.php';

Bootstrap::init();

$req = Request::capture();

/* ----------------------------------------------------------------- CORS */

$origins = Config::corsOrigins();
$requestOrigin = (string) $req->header('origin', '');
$allowAll = in_array('*', $origins, true);
$allowOrigin = $allowAll ? '*' : (in_array($requestOrigin, $origins, true) ? $requestOrigin : '');

if ($allowOrigin !== '') {
    header('Access-Control-Allow-Origin: ' . $allowOrigin);
    header('Vary: Origin');
    if (!$allowAll) {
        header('Access-Control-Allow-Credentials: true');
    }
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Auth-Token');
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, PATCH, OPTIONS');
}

if ($req->method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

/* ------------------------------------------------------- Boot & dispatch */

try {
    Database::init();
    Observability::boot();

    if (!Auth::middleware($req)) {
        exit; // response already written (401 / 429)
    }

    $router = new Router();
    Routes::register($router);
    $router->dispatch($req);
} catch (HttpError $e) {
    if (!Response::$headersSent) {
        Response::json($e->payload, $e->getCode() ?: 400);
    }
} catch (\Throwable $e) {
    $message = $e->getMessage();
    try {
        Observability::log('ERROR', 'API', $message, [
            'path' => $req->path,
            'method' => $req->method,
            'file' => $e->getFile() . ':' . $e->getLine(),
        ]);
    } catch (\Throwable) {
        // never let logging failures mask the original error
    }
    if (!Response::$headersSent) {
        Response::json(['detail' => $message], 400);
    }
}
