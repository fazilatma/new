<?php
/**
 * Tiny regex router with {param} placeholders and {path:...} greedy captures.
 */

declare(strict_types=1);

namespace Arena;

final class Router
{
    /** @var array<string, array<int, array{regex:string, keys:string[], handler:callable}>> */
    private array $routes = [];
    /** @var callable|null */
    private $fallback = null;

    public function add(string $method, string $pattern, callable $handler): void
    {
        $keys = [];
        $regex = preg_replace_callback(
            '#\{([a-zA-Z_][a-zA-Z0-9_]*)(\*)?\}#',
            static function (array $m) use (&$keys): string {
                $keys[] = $m[1];
                return isset($m[2]) && $m[2] === '*' ? '(.+)' : '([^/]+)';
            },
            $pattern
        );
        $this->routes[strtoupper($method)][] = [
            'regex' => '#^' . $regex . '$#',
            'keys' => $keys,
            'handler' => $handler,
        ];
    }

    public function get(string $p, callable $h): void
    {
        $this->add('GET', $p, $h);
    }

    public function post(string $p, callable $h): void
    {
        $this->add('POST', $p, $h);
    }

    public function put(string $p, callable $h): void
    {
        $this->add('PUT', $p, $h);
    }

    public function patch(string $p, callable $h): void
    {
        $this->add('PATCH', $p, $h);
    }

    public function delete(string $p, callable $h): void
    {
        $this->add('DELETE', $p, $h);
    }

    /** Register the same handler for several verbs. */
    public function map(array $methods, string $p, callable $h): void
    {
        foreach ($methods as $m) {
            $this->add($m, $p, $h);
        }
    }

    public function setFallback(callable $h): void
    {
        $this->fallback = $h;
    }

    /** @return array{0:callable,1:array<string,string>}|null */
    public function match(string $method, string $path): ?array
    {
        foreach ($this->routes[strtoupper($method)] ?? [] as $route) {
            if (preg_match($route['regex'], $path, $m)) {
                $params = [];
                foreach ($route['keys'] as $i => $key) {
                    $params[$key] = rawurldecode($m[$i + 1] ?? '');
                }
                return [$route['handler'], $params];
            }
        }
        return null;
    }

    public function allowedMethods(string $path): array
    {
        $allowed = [];
        foreach ($this->routes as $method => $routes) {
            foreach ($routes as $route) {
                if (preg_match($route['regex'], $path)) {
                    $allowed[] = $method;
                    break;
                }
            }
        }
        return $allowed;
    }

    public function dispatch(Request $req): void
    {
        $hit = $this->match($req->method, $req->path);
        if ($hit === null) {
            if ($req->method === 'OPTIONS') {
                Response::sendHeaders(204, [
                    'Allow' => implode(', ', $this->allowedMethods($req->path) ?: ['GET']),
                ]);
                return;
            }
            $allowed = $this->allowedMethods($req->path);
            if ($allowed) {
                Response::json(['detail' => 'Method Not Allowed'], 405, ['Allow' => implode(', ', $allowed)]);
                return;
            }
            if ($this->fallback !== null) {
                ($this->fallback)($req);
                return;
            }
            Response::json(['detail' => 'Not Found'], 404);
            return;
        }
        [$handler, $params] = $hit;
        $req->params = $params;
        $result = $handler($req);
        // Handlers may either write the response themselves (SSE, files) or
        // return an array/scalar that we JSON-encode, like FastAPI does.
        if ($result !== null && !Response::$headersSent) {
            if ($result instanceof \Generator) {
                foreach ($result as $_) {
                    // drained by the handler itself
                }
                return;
            }
            Response::json($result);
        }
    }

    public function routeCount(): int
    {
        return array_sum(array_map('count', $this->routes));
    }

    public function listRoutes(): array
    {
        $out = [];
        foreach ($this->routes as $method => $routes) {
            foreach ($routes as $r) {
                $out[] = ['method' => $method, 'pattern' => $r['regex']];
            }
        }
        return $out;
    }
}
