<?php
/**
 * Browser automation. Port of agent-python/app/browser_automation.py.
 *
 * Tiers, in order:
 *   1. REAL Playwright, driven through scripts/browser_agent.py (python3).
 *   2. Headless Chrome/Chromium CLI (--dump-dom / --screenshot).
 *   3. cURL + DOMDocument extraction (title / text / links).
 *   4. Synthetic offline document.
 *
 * Tier 1 and 2 were impossible on Cloudflare Workers; on a host with a real
 * terminal they are the default again.
 */

declare(strict_types=1);

namespace Arena;

final class Browser
{
    private const SESSION_PREFIX = 'browser:session:';

    public static function validateUrl(string $url): string
    {
        $u = trim($url);
        if ($u === '') {
            throw new HttpError(400, 'A URL is required');
        }
        if (!preg_match('#^https?://#i', $u)) {
            $u = 'https://' . $u;
        }
        $parts = parse_url($u);
        if ($parts === false || empty($parts['host'])) {
            throw new HttpError(400, "Invalid URL: {$url}");
        }
        return $u;
    }

    // ------------------------------------------------------------ sessions

    private static function emptySession(string $sessionId): array
    {
        return [
            'sessionId' => $sessionId,
            'url' => 'about:blank',
            'status' => 200,
            'title' => 'Empty Page',
            'content' => '',
            'rawHtml' => '<html><body></body></html>',
            'links' => [],
            'consoleLogs' => [],
            'networkLogs' => [],
            'engine' => self::engineName(),
            'updatedAt' => time(),
        ];
    }

    public static function loadSession(string $sessionId = 'default'): array
    {
        $raw = Database::stateJson(self::SESSION_PREFIX . $sessionId, null);
        return is_array($raw) ? $raw : self::emptySession($sessionId);
    }

    private static function saveSession(array $session): void
    {
        $session['updatedAt'] = time();
        Database::setStateJson(self::SESSION_PREFIX . $session['sessionId'], $session);
    }

    public static function createSession(string $sessionId = 'default'): array
    {
        $session = self::emptySession($sessionId);
        self::saveSession($session);
        return ['ok' => true, 'sessionId' => $sessionId, 'engine' => $session['engine']];
    }

    public static function closeSession(string $sessionId = 'default'): array
    {
        Database::run('DELETE FROM app_state WHERE key = ?', [self::SESSION_PREFIX . $sessionId]);
        return ['ok' => true, 'closed' => $sessionId];
    }

    // ------------------------------------------------------------- engines

    public static function playwrightAvailable(): bool
    {
        $cached = Database::state('browser:playwright');
        if ($cached !== null && $cached !== '') {
            $decoded = json_decode($cached, true);
            if (is_array($decoded) && (time() - (int) ($decoded['at'] ?? 0)) < 3600) {
                return (bool) $decoded['ok'];
            }
        }
        $ok = false;
        $python = Bootstrap::capabilities()['python'];
        if ($python !== null && function_exists('proc_open')) {
            $r = Terminal::rawCapture(
                [$python, Bootstrap::$scriptsDir . '/browser_agent.py', '{"action":"probe"}'],
                Bootstrap::$root,
                60
            );
            $data = json_decode(trim($r['stdout']), true);
            $ok = is_array($data) && ($data['ok'] ?? false) === true;
        }
        Database::setStateJson('browser:playwright', ['ok' => $ok, 'at' => time()]);
        return $ok;
    }

    public static function chromeBinary(): ?string
    {
        foreach (['google-chrome', 'chromium', 'chromium-browser', 'chrome'] as $bin) {
            $r = Terminal::rawCapture(['sh', '-c', 'command -v ' . escapeshellarg($bin)], null, 5);
            $path = trim($r['stdout']);
            if ($path !== '') {
                return explode("\n", $path)[0];
            }
        }
        $env = Config::raw('CHROME_BIN', '');
        return ($env !== '' && is_executable($env)) ? $env : null;
    }

    public static function engineName(): string
    {
        if (self::playwrightAvailable()) {
            return 'playwright-chromium';
        }
        if (self::chromeBinary() !== null) {
            return 'headless-chrome-cli';
        }
        return 'curl-dom';
    }

    private static function callBridge(array $payload, int $timeout = 90): ?array
    {
        $python = Bootstrap::capabilities()['python'];
        if ($python === null || !function_exists('proc_open')) {
            return null;
        }
        $r = Terminal::rawCapture(
            [$python, Bootstrap::$scriptsDir . '/browser_agent.py', (string) json_encode($payload)],
            Bootstrap::$root,
            $timeout
        );
        $data = json_decode(trim($r['stdout']), true);
        if (!is_array($data)) {
            return null;
        }
        return $data;
    }

    // ------------------------------------------------------------ actions

    public static function navigate(string $url, string $sessionId = 'default'): array
    {
        $target = self::validateUrl($url);

        if (self::playwrightAvailable()) {
            $res = self::callBridge(['action' => 'navigate', 'url' => $target]);
            if ($res !== null && ($res['ok'] ?? false)) {
                $session = [
                    'sessionId' => $sessionId,
                    'url' => (string) ($res['url'] ?? $target),
                    'status' => (int) ($res['status'] ?? 200),
                    'title' => (string) ($res['title'] ?? ''),
                    'content' => (string) ($res['content'] ?? ''),
                    'rawHtml' => (string) ($res['rawHtml'] ?? ''),
                    'links' => (array) ($res['links'] ?? []),
                    'consoleLogs' => (array) ($res['consoleLogs'] ?? []),
                    'networkLogs' => (array) ($res['networkLogs'] ?? []),
                    'engine' => (string) ($res['engine'] ?? 'playwright-chromium'),
                    'updatedAt' => time(),
                ];
                self::saveSession($session);
                return self::publicSession($session);
            }
        }

        $chrome = self::chromeBinary();
        if ($chrome !== null) {
            $r = Terminal::rawCapture(
                [$chrome, '--headless=new', '--disable-gpu', '--no-sandbox', '--dump-dom', $target],
                null,
                60
            );
            if (trim($r['stdout']) !== '') {
                $extracted = self::extractFromHtml($r['stdout'], $target);
                $session = array_merge($extracted, [
                    'sessionId' => $sessionId,
                    'url' => $target,
                    'status' => 200,
                    'engine' => 'headless-chrome-cli',
                    'consoleLogs' => [],
                    'networkLogs' => [],
                    'updatedAt' => time(),
                ]);
                self::saveSession($session);
                return self::publicSession($session);
            }
        }

        // Tier 3: plain HTTP + DOM extraction.
        $proxy = Config::proxyConfig($target);
        $resp = HttpClient::request('GET', $proxy['effectiveUrl'], [
            'User-Agent' => 'Mozilla/5.0 (compatible; ArenaAgent-PHP/1.0)',
            'Accept' => 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ], null, 45, $proxy['proxyClient']);

        if ($resp['body'] === '' && $resp['error'] !== null) {
            $session = array_merge(self::emptySession($sessionId), [
                'url' => $target,
                'status' => 0,
                'title' => 'Navigation failed',
                'content' => 'Unable to load the page: ' . $resp['error'],
                'engine' => 'offline',
            ]);
            self::saveSession($session);
            $out = self::publicSession($session);
            $out['ok'] = false;
            $out['error'] = $resp['error'];
            return $out;
        }

        $extracted = self::extractFromHtml($resp['body'], $target);
        $session = array_merge($extracted, [
            'sessionId' => $sessionId,
            'url' => $resp['effectiveUrl'] ?: $target,
            'status' => $resp['status'],
            'engine' => 'curl-dom',
            'consoleLogs' => [],
            'networkLogs' => [['url' => $target, 'status' => $resp['status']]],
            'updatedAt' => time(),
        ]);
        self::saveSession($session);
        return self::publicSession($session);
    }

    public static function screenshot(string $sessionId = 'default', bool $fullPage = false): array
    {
        $session = self::loadSession($sessionId);
        $url = (string) ($session['url'] ?? 'about:blank');

        if ($url !== 'about:blank' && self::playwrightAvailable()) {
            $res = self::callBridge(['action' => 'screenshot', 'url' => $url, 'fullPage' => $fullPage], 120);
            if ($res !== null && ($res['ok'] ?? false) && !empty($res['screenshotBase64'])) {
                return [
                    'ok' => true,
                    'engine' => 'playwright-chromium',
                    'mimeType' => 'image/png',
                    'imageBase64' => $res['screenshotBase64'],
                    'url' => $url,
                    'fullPage' => $fullPage,
                ];
            }
        }

        $chrome = self::chromeBinary();
        if ($url !== 'about:blank' && $chrome !== null) {
            $tmp = Bootstrap::$storageDir . '/shot-' . Crypto::hex(4) . '.png';
            $args = [$chrome, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
                '--window-size=1280,800', '--screenshot=' . $tmp, $url];
            Terminal::rawCapture($args, null, 90);
            if (is_file($tmp)) {
                $data = base64_encode(Files::read($tmp));
                @unlink($tmp);
                return [
                    'ok' => true,
                    'engine' => 'headless-chrome-cli',
                    'mimeType' => 'image/png',
                    'imageBase64' => $data,
                    'url' => $url,
                    'fullPage' => $fullPage,
                ];
            }
        }

        // Synthetic wireframe (same fallback the Python version used).
        $svg = self::renderWireframe($session);
        return [
            'ok' => true,
            'engine' => 'synthetic-wireframe',
            'mimeType' => 'image/svg+xml',
            'imageBase64' => base64_encode($svg),
            'url' => $url,
            'fullPage' => $fullPage,
            'note' => 'No browser engine available; rendered a synthetic wireframe. '
                . 'Install Playwright (pip install playwright && playwright install chromium) for real screenshots.',
        ];
    }

    public static function evaluate(string $expression, string $sessionId = 'default'): array
    {
        $session = self::loadSession($sessionId);
        $url = (string) ($session['url'] ?? 'about:blank');
        if ($url !== 'about:blank' && self::playwrightAvailable()) {
            $res = self::callBridge(['action' => 'evaluate', 'url' => $url, 'expression' => $expression], 90);
            if ($res !== null && ($res['ok'] ?? false)) {
                return ['ok' => true, 'engine' => 'playwright-chromium', 'result' => $res['result'] ?? null];
            }
        }
        return [
            'ok' => false,
            'engine' => self::engineName(),
            'result' => null,
            'error' => 'JavaScript evaluation requires Playwright. Install it with: pip install playwright && playwright install chromium',
        ];
    }

    public static function click(string $selector, string $sessionId = 'default'): array
    {
        $session = self::loadSession($sessionId);
        $url = (string) ($session['url'] ?? 'about:blank');
        if ($url !== 'about:blank' && self::playwrightAvailable()) {
            $res = self::callBridge(['action' => 'click', 'url' => $url, 'selector' => $selector], 90);
            if ($res !== null && ($res['ok'] ?? false)) {
                $session = array_merge($session, [
                    'url' => (string) ($res['url'] ?? $url),
                    'title' => (string) ($res['title'] ?? $session['title']),
                    'content' => (string) ($res['content'] ?? $session['content']),
                    'rawHtml' => (string) ($res['rawHtml'] ?? $session['rawHtml']),
                    'links' => (array) ($res['links'] ?? $session['links']),
                ]);
                self::saveSession($session);
                return array_merge(['ok' => true, 'clicked' => $selector], self::publicSession($session));
            }
        }
        // DOM-only fallback: follow the link the selector points at.
        foreach ((array) ($session['links'] ?? []) as $link) {
            if (str_contains((string) ($link['text'] ?? ''), trim($selector, '#.'))) {
                return self::navigate((string) $link['href'], $sessionId);
            }
        }
        return ['ok' => false, 'error' => 'Click requires a real browser engine (Playwright or headless Chrome).', 'selector' => $selector];
    }

    public static function fill(string $selector, string $text, string $sessionId = 'default'): array
    {
        $session = self::loadSession($sessionId);
        $url = (string) ($session['url'] ?? 'about:blank');
        if ($url !== 'about:blank' && self::playwrightAvailable()) {
            $res = self::callBridge(['action' => 'fill', 'url' => $url, 'selector' => $selector, 'text' => $text], 90);
            if ($res !== null && ($res['ok'] ?? false)) {
                return ['ok' => true, 'filled' => $selector, 'engine' => 'playwright-chromium'];
            }
        }
        return ['ok' => false, 'error' => 'Form filling requires Playwright.', 'selector' => $selector];
    }

    public static function logs(string $sessionId = 'default'): array
    {
        $session = self::loadSession($sessionId);
        return [
            'ok' => true,
            'sessionId' => $sessionId,
            'consoleLogs' => $session['consoleLogs'] ?? [],
            'networkLogs' => $session['networkLogs'] ?? [],
            'engine' => $session['engine'] ?? self::engineName(),
        ];
    }

    /** Raw HTTP GET used by the `http_request` agent tool. */
    public static function fetchUrl(string $url): array
    {
        $target = self::validateUrl($url);
        $proxy = Config::proxyConfig($target);
        $r = HttpClient::request('GET', $proxy['effectiveUrl'], [
            'User-Agent' => 'Mozilla/5.0 (compatible; ArenaAgent-PHP/1.0)',
        ], null, 45, $proxy['proxyClient']);
        $body = $r['body'];
        return [
            'ok' => $r['ok'],
            'url' => $target,
            'status' => $r['status'],
            'contentType' => $r['headers']['content-type'] ?? '',
            'length' => strlen($body),
            'body' => strlen($body) > 100000 ? substr($body, 0, 100000) . "\n… (truncated)" : $body,
            'error' => $r['error'],
        ];
    }

    // ------------------------------------------------------------ helpers

    public static function extractFromHtml(string $html, string $baseUrl): array
    {
        $title = '';
        if (preg_match('#<title[^>]*>(.*?)</title>#is', $html, $m)) {
            $title = trim(html_entity_decode(strip_tags($m[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        }

        $links = [];
        $content = '';

        if (class_exists('DOMDocument') && trim($html) !== '') {
            $doc = new \DOMDocument();
            $prev = libxml_use_internal_errors(true);
            $doc->loadHTML('<?xml encoding="UTF-8">' . $html);
            libxml_clear_errors();
            libxml_use_internal_errors($prev);

            foreach ($doc->getElementsByTagName('script') as $node) {
                $node->textContent = '';
            }
            foreach ($doc->getElementsByTagName('style') as $node) {
                $node->textContent = '';
            }
            $body = $doc->getElementsByTagName('body')->item(0);
            $content = trim((string) preg_replace('/\n{3,}/', "\n\n", (string) ($body?->textContent ?? '')));

            foreach ($doc->getElementsByTagName('a') as $a) {
                $href = $a->getAttribute('href');
                if ($href === '' || str_starts_with($href, 'javascript:')) {
                    continue;
                }
                $links[] = [
                    'href' => self::absoluteUrl($href, $baseUrl),
                    'text' => trim(preg_replace('/\s+/', ' ', $a->textContent) ?? ''),
                ];
                if (count($links) >= 100) {
                    break;
                }
            }
        } else {
            $content = trim(html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        }

        return [
            'title' => $title !== '' ? $title : $baseUrl,
            'content' => strlen($content) > 200000 ? substr($content, 0, 200000) : $content,
            'rawHtml' => strlen($html) > 500000 ? substr($html, 0, 500000) : $html,
            'links' => $links,
        ];
    }

    private static function absoluteUrl(string $href, string $base): string
    {
        if (preg_match('#^[a-z][a-z0-9+.\-]*://#i', $href) || str_starts_with($href, 'mailto:')) {
            return $href;
        }
        $b = parse_url($base);
        if ($b === false || empty($b['scheme']) || empty($b['host'])) {
            return $href;
        }
        $origin = $b['scheme'] . '://' . $b['host'] . (isset($b['port']) ? ':' . $b['port'] : '');
        if (str_starts_with($href, '//')) {
            return $b['scheme'] . ':' . $href;
        }
        if (str_starts_with($href, '/')) {
            return $origin . $href;
        }
        $path = $b['path'] ?? '/';
        $dir = str_ends_with($path, '/') ? $path : dirname($path) . '/';
        return $origin . $dir . $href;
    }

    private static function publicSession(array $session): array
    {
        $content = (string) ($session['content'] ?? '');
        return [
            'ok' => true,
            'sessionId' => $session['sessionId'],
            'url' => $session['url'],
            'status' => $session['status'],
            'title' => $session['title'],
            'content' => strlen($content) > 50000 ? substr($content, 0, 50000) . "\n… (truncated)" : $content,
            'links' => array_slice((array) ($session['links'] ?? []), 0, 100),
            'linkCount' => count((array) ($session['links'] ?? [])),
            'engine' => $session['engine'],
            'consoleLogs' => $session['consoleLogs'] ?? [],
            'networkLogs' => $session['networkLogs'] ?? [],
        ];
    }

    private static function renderWireframe(array $session): string
    {
        $esc = static fn(string $s): string => htmlspecialchars($s, ENT_QUOTES | ENT_XML1, 'UTF-8');
        $title = $esc(substr((string) ($session['title'] ?? 'Untitled'), 0, 80));
        $url = $esc(substr((string) ($session['url'] ?? ''), 0, 90));
        $lines = array_slice(array_values(array_filter(
            preg_split('/\r?\n/', (string) ($session['content'] ?? '')) ?: [],
            static fn(string $l): bool => trim($l) !== ''
        )), 0, 18);

        $body = '';
        $y = 150;
        foreach ($lines as $line) {
            $body .= '<text x="40" y="' . $y . '" font-family="monospace" font-size="14" fill="#c9d1d9">'
                . $esc(substr(trim($line), 0, 96)) . '</text>';
            $y += 24;
        }

        return '<?xml version="1.0" encoding="UTF-8"?>'
            . '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">'
            . '<rect width="1280" height="800" fill="#0d1117"/>'
            . '<rect x="0" y="0" width="1280" height="90" fill="#161b22"/>'
            . '<circle cx="30" cy="30" r="8" fill="#ff5f56"/><circle cx="56" cy="30" r="8" fill="#ffbd2e"/>'
            . '<circle cx="82" cy="30" r="8" fill="#27c93f"/>'
            . '<rect x="110" y="16" width="1140" height="28" rx="14" fill="#0d1117"/>'
            . '<text x="126" y="35" font-family="monospace" font-size="14" fill="#58a6ff">' . $url . '</text>'
            . '<text x="40" y="78" font-family="sans-serif" font-size="20" fill="#f0f6fc">' . $title . '</text>'
            . $body
            . '<text x="40" y="780" font-family="sans-serif" font-size="12" fill="#8b949e">'
            . 'Synthetic wireframe — install Playwright for real screenshots</text>'
            . '</svg>';
    }
}
