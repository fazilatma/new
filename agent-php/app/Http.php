<?php
/**
 * HTTP layer: request wrapper, JSON responses, SSE streaming, error type.
 * Replaces FastAPI's Request/JSONResponse/StreamingResponse.
 */

declare(strict_types=1);

namespace Arena;

class HttpError extends \RuntimeException
{
    public array $payload;

    public function __construct(int $status, string $detail, array $extra = [])
    {
        parent::__construct($detail, $status);
        $this->payload = array_merge(['detail' => $detail], $extra);
    }
}

final class Request
{
    public string $method;
    public string $path;
    /** @var array<string,string> */
    public array $query = [];
    /** @var array<string,string> */
    public array $headers = [];
    /** @var array<string,string> */
    public array $cookies = [];
    /** @var array<string,mixed> */
    public array $params = [];
    public ?string $rawBody = null;
    private ?array $jsonCache = null;
    public ?array $user = null;

    /**
     * URL prefix the browser must prepend to every API path.
     *
     * '' when the app owns the domain root and mod_rewrite works,
     * '/agent' for a subdirectory install,
     * '/agent/index.php' when there is no URL rewriting at all.
     */
    public static string $basePath = '';

    /** True when this request arrived as /index.php/api/... (no rewrite engine). */
    public static bool $viaFrontControllerPath = false;

    public static function capture(): self
    {
        $r = new self();
        $r->method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        $uri = (string) ($_SERVER['REQUEST_URI'] ?? '/');
        $path = rawurldecode((string) (parse_url($uri, PHP_URL_PATH) ?: '/'));

        // ------------------------------------------------ install prefix
        // Shared hosts serve the app from a subdirectory, and plenty of them
        // ship without mod_rewrite. Both cases are detected here instead of
        // forcing the operator to hand-edit paths.
        $script = (string) ($_SERVER['SCRIPT_NAME'] ?? '');
        $frontFile = basename((string) ($_SERVER['SCRIPT_FILENAME'] ?? 'index.php'));
        // Guard against the PHP built-in server, which reports the *requested*
        // path in SCRIPT_NAME when a router script is used.
        $scriptIsFrontController = $script !== ''
            && str_ends_with($script, '.php')
            && basename($script) === $frontFile;

        $dir = $scriptIsFrontController ? rtrim(str_replace('\\', '/', dirname($script)), '/') : '';
        if ($dir === '/' || $dir === '.') {
            $dir = '';
        }

        $pathInfo = (string) ($_SERVER['PATH_INFO'] ?? '');
        if ($pathInfo !== '') {
            // /agent/index.php/api/health  →  PATH_INFO = /api/health
            $path = $pathInfo;
            self::$viaFrontControllerPath = true;
            self::$basePath = $script;
        } elseif ($scriptIsFrontController && str_starts_with($path, $script)) {
            // Same shape, but the SAPI did not populate PATH_INFO.
            $path = substr($path, strlen($script));
            self::$viaFrontControllerPath = true;
            self::$basePath = $script;
        } elseif ($dir !== '' && ($path === $dir || str_starts_with($path, $dir . '/'))) {
            $path = substr($path, strlen($dir));
            self::$basePath = $dir;
        } else {
            self::$basePath = '';
        }

        // Last-ditch escape hatch for hosts with neither rewriting nor
        // PATH_INFO: /index.php?__path=/api/health
        $queryPath = $_GET['__path'] ?? null;
        if (is_string($queryPath) && $queryPath !== '') {
            $path = $queryPath;
            self::$viaFrontControllerPath = true;
            if (self::$basePath === '') {
                self::$basePath = $script;
            }
            unset($_GET['__path']);
        }

        if ($path === '' || $path[0] !== '/') {
            $path = '/' . $path;
        }
        $r->path = $path;
        if (strlen($r->path) > 1) {
            $r->path = rtrim($r->path, '/');
            if ($r->path === '') {
                $r->path = '/';
            }
        }
        $r->query = $_GET;
        $r->cookies = $_COOKIE;
        foreach ($_SERVER as $k => $v) {
            if (str_starts_with($k, 'HTTP_')) {
                $r->headers[strtolower(str_replace('_', '-', substr($k, 5)))] = (string) $v;
            }
        }
        if (isset($_SERVER['CONTENT_TYPE'])) {
            $r->headers['content-type'] = (string) $_SERVER['CONTENT_TYPE'];
        }
        if (isset($_SERVER['CONTENT_LENGTH'])) {
            $r->headers['content-length'] = (string) $_SERVER['CONTENT_LENGTH'];
        }
        return $r;
    }

    public function header(string $name, ?string $default = null): ?string
    {
        return $this->headers[strtolower($name)] ?? $default;
    }

    public function isMultipart(): bool
    {
        return str_contains((string) $this->header('content-type', ''), 'multipart/form-data');
    }

    public function body(): string
    {
        if ($this->rawBody === null) {
            $this->rawBody = (string) file_get_contents('php://input');
        }
        return $this->rawBody;
    }

    /** Parsed JSON body (empty array when absent/invalid) merged with form fields. */
    public function json(): array
    {
        if ($this->jsonCache !== null) {
            return $this->jsonCache;
        }
        $ct = (string) $this->header('content-type', '');
        if (str_contains($ct, 'multipart/form-data') || str_contains($ct, 'x-www-form-urlencoded')) {
            $this->jsonCache = $_POST;
            return $this->jsonCache;
        }
        $raw = $this->body();
        if ($raw === '') {
            $this->jsonCache = [];
            return $this->jsonCache;
        }
        $decoded = json_decode($raw, true);
        $this->jsonCache = is_array($decoded) ? $decoded : [];
        return $this->jsonCache;
    }

    /** Value from JSON body, then form, then query string. */
    public function input(string $key, mixed $default = null): mixed
    {
        $body = $this->json();
        if (array_key_exists($key, $body)) {
            return $body[$key];
        }
        if (array_key_exists($key, $_POST)) {
            return $_POST[$key];
        }
        if (array_key_exists($key, $this->query)) {
            return $this->query[$key];
        }
        return $default;
    }

    public function str(string $key, string $default = ''): string
    {
        $v = $this->input($key, $default);
        return is_scalar($v) ? (string) $v : $default;
    }

    public function int(string $key, int $default = 0): int
    {
        $v = $this->input($key, $default);
        return is_numeric($v) ? (int) $v : $default;
    }

    public function bool(string $key, bool $default = false): bool
    {
        $v = $this->input($key, $default);
        if (is_bool($v)) {
            return $v;
        }
        if (is_string($v)) {
            return in_array(strtolower($v), ['1', 'true', 'yes', 'on'], true);
        }
        return (bool) $v;
    }

    public function arr(string $key, array $default = []): array
    {
        $v = $this->input($key, $default);
        return is_array($v) ? $v : $default;
    }

    public function param(string $key, string $default = ''): string
    {
        return isset($this->params[$key]) ? (string) $this->params[$key] : $default;
    }

    public function clientIp(): string
    {
        foreach (['http-x-forwarded-for', 'x-forwarded-for', 'cf-connecting-ip', 'x-real-ip'] as $h) {
            $v = $this->header($h);
            if ($v) {
                return trim(explode(',', $v)[0]);
            }
        }
        return (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    }

    public function userAgent(): string
    {
        return (string) $this->header('user-agent', 'unknown');
    }
}

final class Response
{
    public static bool $headersSent = false;

    public static function json(mixed $data, int $status = 200, array $headers = []): void
    {
        self::sendHeaders($status, array_merge(['Content-Type' => 'application/json; charset=utf-8'], $headers));
        echo json_encode(
            $data,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR
        );
    }

    public static function text(string $body, int $status = 200, array $headers = []): void
    {
        self::sendHeaders($status, array_merge(['Content-Type' => 'text/plain; charset=utf-8'], $headers));
        echo $body;
    }

    public static function html(string $body, int $status = 200, array $headers = []): void
    {
        self::sendHeaders($status, array_merge(['Content-Type' => 'text/html; charset=utf-8'], $headers));
        echo $body;
    }

    public static function raw(string $body, string $contentType, int $status = 200, array $headers = []): void
    {
        self::sendHeaders($status, array_merge(['Content-Type' => $contentType], $headers));
        echo $body;
    }

    public static function file(string $absPath, ?string $contentType = null, ?string $downloadName = null): void
    {
        if (!is_file($absPath)) {
            throw new HttpError(404, 'File not found');
        }
        $headers = [
            'Content-Type' => $contentType ?? Files::mimeType($absPath),
            'Content-Length' => (string) filesize($absPath),
            'Cache-Control' => 'no-cache',
        ];
        if ($downloadName !== null) {
            $headers['Content-Disposition'] = 'attachment; filename="' . addslashes($downloadName) . '"';
        }
        self::sendHeaders(200, $headers);
        $fh = fopen($absPath, 'rb');
        if ($fh) {
            fpassthru($fh);
            fclose($fh);
        }
    }

    public static function noContent(int $status = 204): void
    {
        self::sendHeaders($status, []);
    }

    public static function redirect(string $location, int $status = 302): void
    {
        self::sendHeaders($status, ['Location' => $location]);
    }

    public static function sendHeaders(int $status, array $headers): void
    {
        if (self::$headersSent || headers_sent()) {
            self::$headersSent = true;
            return;
        }
        http_response_code($status);
        foreach ($headers as $k => $v) {
            header("$k: $v");
        }
        self::$headersSent = true;
    }

    public static function setCookie(string $name, string $value, int $maxAge, bool $httpOnly = true): void
    {
        $secure = (($_SERVER['HTTPS'] ?? '') !== '')
            || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
        setcookie($name, $value, [
            'expires' => $maxAge > 0 ? time() + $maxAge : 0,
            'path' => '/',
            'httponly' => $httpOnly,
            'samesite' => 'Lax',
            'secure' => $secure,
        ]);
    }

    public static function clearCookie(string $name): void
    {
        setcookie($name, '', ['expires' => time() - 3600, 'path' => '/']);
    }
}

/**
 * Server-Sent Events writer. Mirrors the Python `event: <type>\ndata: <json>\n\n`
 * wire format exactly so the existing SPA parser keeps working.
 */
final class Sse
{
    private bool $started = false;
    public bool $aborted = false;

    public function start(): void
    {
        if ($this->started) {
            return;
        }
        $this->started = true;
        @ini_set('zlib.output_compression', '0');
        @ini_set('output_buffering', '0');
        @ini_set('implicit_flush', '1');
        while (ob_get_level() > 0) {
            @ob_end_flush();
        }
        ob_implicit_flush(true);
        ignore_user_abort(false);
        Response::sendHeaders(200, [
            'Content-Type' => 'text/event-stream; charset=utf-8',
            'Cache-Control' => 'no-cache, no-transform',
            'Connection' => 'keep-alive',
            'X-Accel-Buffering' => 'no',
        ]);
        // Nudge proxies to start forwarding immediately.
        echo ": stream-open\n\n";
        @flush();
    }

    public function send(string $event, mixed $data): void
    {
        $this->start();
        $payload = is_string($data)
            ? $data
            : json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
        echo "event: {$event}\n";
        echo 'data: ' . $payload . "\n\n";
        @flush();
        if (connection_aborted()) {
            $this->aborted = true;
        }
    }

    public function comment(string $text): void
    {
        $this->start();
        echo ': ' . $text . "\n\n";
        @flush();
    }
}
