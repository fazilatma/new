<?php
/**
 * cURL based HTTP client — replacement for Python's httpx / the Workers fetch().
 *
 * Two things the Workers build could not do and this one can:
 *   - real forward proxies (CURLOPT_PROXY, incl. socks5) instead of only
 *     "?url=" gateway proxies;
 *   - reaching `localhost` services such as a local Ollama install.
 */

declare(strict_types=1);

namespace Arena;

final class HttpClient
{
    public const DEFAULT_TIMEOUT = 120;

    /**
     * @param array<string,string> $headers
     * @return array{ok:bool, status:int, headers:array<string,string>, body:string, error:?string, latencyMs:float, effectiveUrl:string}
     */
    public static function request(
        string $method,
        string $url,
        array $headers = [],
        ?string $body = null,
        int $timeout = self::DEFAULT_TIMEOUT,
        ?string $proxy = null
    ): array {
        $started = microtime(true);
        if (!function_exists('curl_init')) {
            return self::failure($url, 'The cURL extension is not enabled on this host', $started);
        }

        $ch = curl_init();
        $responseHeaders = [];
        curl_setopt_array($ch, [
            CURLOPT_URL => $url,
            CURLOPT_CUSTOMREQUEST => strtoupper($method),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 5,
            CURLOPT_CONNECTTIMEOUT => min(30, $timeout),
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_HTTPHEADER => self::flattenHeaders($headers),
            CURLOPT_ENCODING => '',
            CURLOPT_SSL_VERIFYPEER => !Config::rawBool('AGENT_INSECURE_TLS', false),
            CURLOPT_SSL_VERIFYHOST => Config::rawBool('AGENT_INSECURE_TLS', false) ? 0 : 2,
            CURLOPT_USERAGENT => 'ArenaCodingAgent-PHP/' . APP_VERSION,
            CURLOPT_HEADERFUNCTION => static function ($_ch, string $line) use (&$responseHeaders): int {
                $len = strlen($line);
                $parts = explode(':', $line, 2);
                if (count($parts) === 2) {
                    $responseHeaders[strtolower(trim($parts[0]))] = trim($parts[1]);
                }
                return $len;
            },
        ]);
        if ($body !== null && $body !== '') {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
        if ($proxy !== null && $proxy !== '') {
            curl_setopt($ch, CURLOPT_PROXY, $proxy);
            if (str_starts_with(strtolower($proxy), 'socks5h://')) {
                curl_setopt($ch, CURLOPT_PROXYTYPE, CURLPROXY_SOCKS5_HOSTNAME);
            } elseif (str_starts_with(strtolower($proxy), 'socks5://')) {
                curl_setopt($ch, CURLOPT_PROXYTYPE, CURLPROXY_SOCKS5);
            } elseif (str_starts_with(strtolower($proxy), 'socks4')) {
                curl_setopt($ch, CURLOPT_PROXYTYPE, CURLPROXY_SOCKS4);
            }
        }

        $responseBody = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $effective = (string) (curl_getinfo($ch, CURLINFO_EFFECTIVE_URL) ?: $url);
        $error = curl_errno($ch) !== 0 ? curl_error($ch) : null;
        curl_close($ch);

        return [
            'ok' => $error === null && $status >= 200 && $status < 300,
            'status' => $status,
            'headers' => $responseHeaders,
            'body' => is_string($responseBody) ? $responseBody : '',
            'error' => $error,
            'latencyMs' => round((microtime(true) - $started) * 1000, 1),
            'effectiveUrl' => $effective,
        ];
    }

    public static function getJson(string $url, array $headers = [], int $timeout = 30, ?string $proxy = null): array
    {
        $r = self::request('GET', $url, $headers, null, $timeout, $proxy);
        $r['json'] = json_decode($r['body'], true);
        return $r;
    }

    public static function postJson(string $url, array $payload, array $headers = [], int $timeout = self::DEFAULT_TIMEOUT, ?string $proxy = null): array
    {
        $headers['Content-Type'] = 'application/json';
        $r = self::request('POST', $url, $headers, (string) json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $timeout, $proxy);
        $r['json'] = json_decode($r['body'], true);
        return $r;
    }

    /**
     * Streaming POST. `$onChunk(string $chunk): bool` — return false to abort.
     * Used for SSE token streaming from the LLM providers.
     *
     * @return array{ok:bool, status:int, error:?string, latencyMs:float, aborted:bool}
     */
    public static function stream(
        string $url,
        array $headers,
        string $body,
        callable $onChunk,
        int $timeout = 600,
        ?string $proxy = null,
        string $method = 'POST'
    ): array {
        $started = microtime(true);
        if (!function_exists('curl_init')) {
            return ['ok' => false, 'status' => 0, 'error' => 'The cURL extension is not enabled on this host', 'latencyMs' => 0.0, 'aborted' => false];
        }
        $aborted = false;
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => $url,
            CURLOPT_CUSTOMREQUEST => strtoupper($method),
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 30,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_HTTPHEADER => self::flattenHeaders(array_merge(['Content-Type' => 'application/json', 'Accept' => 'text/event-stream'], $headers)),
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_SSL_VERIFYPEER => !Config::rawBool('AGENT_INSECURE_TLS', false),
            CURLOPT_SSL_VERIFYHOST => Config::rawBool('AGENT_INSECURE_TLS', false) ? 0 : 2,
            CURLOPT_USERAGENT => 'ArenaCodingAgent-PHP/' . APP_VERSION,
            CURLOPT_WRITEFUNCTION => static function ($_ch, string $chunk) use ($onChunk, &$aborted): int {
                $len = strlen($chunk);
                if ($aborted) {
                    return 0;
                }
                $keepGoing = $onChunk($chunk);
                if ($keepGoing === false) {
                    $aborted = true;
                    return 0; // makes cURL abort the transfer
                }
                return $len;
            },
        ]);
        if ($proxy !== null && $proxy !== '') {
            curl_setopt($ch, CURLOPT_PROXY, $proxy);
        }

        curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $errno = curl_errno($ch);
        $error = ($errno !== 0 && !($aborted && $errno === CURLE_WRITE_ERROR)) ? curl_error($ch) : null;
        curl_close($ch);

        return [
            'ok' => $error === null && $status >= 200 && $status < 300,
            'status' => $status,
            'error' => $error,
            'latencyMs' => round((microtime(true) - $started) * 1000, 1),
            'aborted' => $aborted,
        ];
    }

    /** Download to disk (used by the workspace importer). */
    public static function download(string $url, string $destination, int $timeout = 300, ?string $proxy = null): array
    {
        Files::ensureDir(dirname($destination));
        $fh = fopen($destination, 'wb');
        if (!$fh) {
            throw new HttpError(500, 'Unable to open destination file');
        }
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => $url,
            CURLOPT_FILE => $fh,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        if ($proxy) {
            curl_setopt($ch, CURLOPT_PROXY, $proxy);
        }
        curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = curl_errno($ch) !== 0 ? curl_error($ch) : null;
        curl_close($ch);
        fclose($fh);
        return ['ok' => $error === null && $status < 400, 'status' => $status, 'error' => $error, 'path' => $destination];
    }

    private static function flattenHeaders(array $headers): array
    {
        $out = [];
        foreach ($headers as $k => $v) {
            if (is_int($k)) {
                $out[] = (string) $v;
            } else {
                $out[] = $k . ': ' . $v;
            }
        }
        return $out;
    }

    /** Parse an SSE buffer into complete `event/data` records. */
    public static function parseSseBuffer(string &$buffer): array
    {
        $events = [];
        while (($pos = strpos($buffer, "\n\n")) !== false || ($pos = strpos($buffer, "\r\n\r\n")) !== false) {
            $sep = substr($buffer, $pos, 2) === "\n\n" ? 2 : 4;
            $raw = substr($buffer, 0, $pos);
            $buffer = substr($buffer, $pos + $sep);
            $event = ['event' => 'message', 'data' => ''];
            foreach (preg_split('/\r?\n/', $raw) ?: [] as $line) {
                if (str_starts_with($line, 'data:')) {
                    $event['data'] .= ltrim(substr($line, 5));
                } elseif (str_starts_with($line, 'event:')) {
                    $event['event'] = trim(substr($line, 6));
                }
            }
            if ($event['data'] !== '') {
                $events[] = $event;
            }
        }
        return $events;
    }
}
