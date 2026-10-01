<?php

/**
 * Request, Response and a small router.
 *
 * Routing contract — the whole point of this rewrite:
 *
 *   The canonical URL is  <dir>/index.php?p=/api/things
 *
 * That form needs no mod_rewrite, no AcceptPathInfo, no .htaccess and no
 * knowledge of where the app is installed. Pretty URLs (/api/things) and
 * PATH_INFO (/index.php/api/things) are still understood when the host
 * happens to support them, but nothing in the app or the UI depends on it.
 */

declare(strict_types=1);

namespace Arena;

final class HttpError extends \RuntimeException
{
    /** @param array<string,mixed> $extra */
    public function __construct(
        public readonly int $status,
        string $message,
        public readonly array $extra = []
    ) {
        parent::__construct($message, $status);
    }
}

final class Request
{
    public string $method = 'GET';
    public string $path = '/';
    /** @var array<string,mixed> */
    public array $query = [];
    /** @var array<string,string> */
    public array $params = [];
    /** @var array<string,mixed>|null */
    public ?array $user = null;
    public ?string $rawBody = null;
    /** @var array<string,mixed>|null */
    private ?array $jsonCache = null;

    /** Directory the front controller lives in, e.g. '' or '/agent'. */
    public static string $dir = '';
    /** URL the browser should use for API calls, e.g. '/agent/index.php'. */
    public static string $entry = '/index.php';

    public static function capture(): self
    {
        $r = new self();
        $r->method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));

        $script = (string) ($_SERVER['SCRIPT_NAME'] ?? '/index.php');
        // The built-in server reports the *requested* path in SCRIPT_NAME when
        // a router script is in play; only trust it when it names a real file.
        $front = basename((string) ($_SERVER['SCRIPT_FILENAME'] ?? 'index.php'));
        if (basename($script) !== $front) {
            $script = rtrim(str_replace('\\', '/', dirname($script)), '/') . '/' . $front;
        }
        self::$entry = $script;
        $dir = rtrim(str_replace('\\', '/', dirname($script)), '/');
        self::$dir = ($dir === '/' || $dir === '.') ? '' : $dir;

        $uriPath = rawurldecode((string) (parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?: '/'));

        // 1. explicit ?p= — the canonical, always-available form
        $p = $_GET['p'] ?? $_GET['__path'] ?? null;
        if (is_string($p) && $p !== '') {
            $r->path = $p;
        } elseif (($pi = (string) ($_SERVER['PATH_INFO'] ?? '')) !== '') {
            // 2. /index.php/api/things
            $r->path = $pi;
        } elseif (str_starts_with($uriPath, $script) && strlen($uriPath) > strlen($script)) {
            // 3. same shape, PATH_INFO not populated by the SAPI
            $r->path = substr($uriPath, strlen($script));
        } elseif (self::$dir !== '' && str_starts_with($uriPath, self::$dir)) {
            // 4. rewritten pretty URL inside a subdirectory
            $r->path = substr($uriPath, strlen(self::$dir));
        } else {
            // 5. rewritten pretty URL at the document root
            $r->path = $uriPath;
        }

        if ($r->path === '' || $r->path[0] !== '/') {
            $r->path = '/' . $r->path;
        }
        // A request for the front controller itself is a request for the UI.
        if ($r->path === $script || $r->path === '/' . $front) {
            $r->path = '/';
        }
        if (strlen($r->path) > 1) {
            $r->path = rtrim($r->path, '/') ?: '/';
        }

        $q = $_GET;
        unset($q['p'], $q['__path']);
        $r->query = $q;
        return $r;
    }

    public function header(string $name, string $default = ''): string
    {
        $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
        if (isset($_SERVER[$key])) {
            return (string) $_SERVER[$key];
        }
        if ($name === 'content-type' && isset($_SERVER['CONTENT_TYPE'])) {
            return (string) $_SERVER['CONTENT_TYPE'];
        }
        if ($name === 'content-length' && isset($_SERVER['CONTENT_LENGTH'])) {
            return (string) $_SERVER['CONTENT_LENGTH'];
        }
        return $default;
    }

    public function body(): string
    {
        if ($this->rawBody === null) {
            $this->rawBody = (string) file_get_contents('php://input');
        }
        return $this->rawBody;
    }

    /** @return array<string,mixed> */
    public function json(): array
    {
        if ($this->jsonCache !== null) {
            return $this->jsonCache;
        }
        $body = $this->body();
        $data = [];
        if ($body !== '') {
            $decoded = json_decode($body, true);
            if (is_array($decoded)) {
                $data = $decoded;
            }
        }
        if ($data === [] && $_POST !== []) {
            $data = $_POST;
        }
        return $this->jsonCache = $data;
    }

    public function input(string $key, mixed $default = null): mixed
    {
        $j = $this->json();
        return $j[$key] ?? $this->query[$key] ?? $default;
    }

    public function param(string $key, string $default = ''): string
    {
        return $this->params[$key] ?? $default;
    }

    /** Absolute URL for an app path, honouring the install directory. */
    public static function url(string $path): string
    {
        return self::$entry . '?p=' . rawurlencode($path);
    }
}

final class Response
{
    public static bool $started = false;

    /** @param array<string,string> $headers */
    public static function send(int $status, array $headers, string $body): void
    {
        if (!self::$started && !headers_sent()) {
            http_response_code($status);
            foreach ($headers as $k => $v) {
                header("$k: $v");
            }
        }
        self::$started = true;
        echo $body;
    }

    public static function json(mixed $data, int $status = 200): void
    {
        self::send($status, ['Content-Type' => 'application/json; charset=utf-8'], (string) json_encode(
            $data,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR
        ));
    }

    public static function html(string $body, int $status = 200): void
    {
        self::send($status, ['Content-Type' => 'text/html; charset=utf-8'], $body);
    }

    public static function text(string $body, int $status = 200): void
    {
        self::send($status, ['Content-Type' => 'text/plain; charset=utf-8'], $body);
    }

    public static function noContent(): void
    {
        self::send(204, [], '');
    }
}

final class Router
{
    /** @var array<string, array<int, array{0:string,1:callable}>> */
    private array $routes = [];
    /** @var callable|null */
    private $fallback = null;

    public function add(string $method, string $path, callable $handler): void
    {
        $this->routes[strtoupper($method)][] = [$path, $handler];
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

    public function fallback(callable $h): void
    {
        $this->fallback = $h;
    }

    /**
     * Patterns support {name} for one segment and {name*} for the rest.
     *
     * @return array<string,string>|null
     */
    private function match(string $pattern, string $path): ?array
    {
        if ($pattern === $path) {
            return [];
        }
        if (!str_contains($pattern, '{')) {
            return null;
        }
        // Build the expression by alternating quoted literals and capture
        // groups. Escaping the whole pattern first would mangle the {braces};
        // using '/' as the delimiter would be terminated by the '/' in [^/].
        $regex = '';
        foreach (preg_split('/(\{\w+\*?\})/', $pattern, -1, PREG_SPLIT_DELIM_CAPTURE) ?: [] as $part) {
            if (preg_match('/^\{(\w+)(\*?)\}$/', $part, $m) === 1) {
                $regex .= $m[2] === '*'
                    ? '(?P<' . $m[1] . '>.+)'
                    : '(?P<' . $m[1] . '>[^/]+)';
            } else {
                $regex .= preg_quote($part, '#');
            }
        }
        if (preg_match('#^' . $regex . '$#', $path, $found) !== 1) {
            return null;
        }
        $out = [];
        foreach ($found as $k => $v) {
            if (is_string($k)) {
                $out[$k] = rawurldecode((string) $v);
            }
        }
        return $out;
    }

    public function dispatch(Request $req): void
    {
        $allowed = [];
        foreach ($this->routes as $method => $entries) {
            foreach ($entries as [$pattern, $handler]) {
                $params = $this->match($pattern, $req->path);
                if ($params === null) {
                    continue;
                }
                if ($method !== $req->method) {
                    $allowed[$method] = true;
                    continue;
                }
                $req->params = $params;
                $result = $handler($req);
                if ($result !== null && !Response::$started) {
                    Response::json($result);
                }
                return;
            }
        }
        if ($allowed !== []) {
            Response::send(405, ['Allow' => implode(', ', array_keys($allowed))], (string) json_encode(
                ['error' => 'Method Not Allowed', 'allow' => array_keys($allowed)]
            ));
            return;
        }
        if ($this->fallback !== null) {
            ($this->fallback)($req);
            return;
        }
        Response::json(['error' => 'Not Found', 'path' => $req->path], 404);
    }
}
