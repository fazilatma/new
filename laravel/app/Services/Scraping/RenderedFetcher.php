<?php

namespace App\Services\Scraping;

use Illuminate\Support\Facades\Http;

/**
 * کلاینتِ سرویس رندرِ JS (پوشهٔ browser/ — Playwright یا Selenium)
 *
 * قراردادِ ورودی/خروجی با HtmlFetcher سازگار است:
 *   ['ok'=>bool,'code'=>int,'error'=>string,'url'=>effectiveUrl,'html'=>string,'mode'=>'render']
 *
 * چون از Http facade استفاده می‌کند، در تست با Http::fake کاملاً کنترل می‌شود.
 */
class RenderedFetcher
{
    /**
     * @param array $opts ['selector'=>?, 'scroll'=>bool, 'waitUntil'=>?, 'timeout_ms'=>?, 'blockResources'=>bool]
     * @return array{ok:bool,code:int,error:string,url:string,html:string,mode:string,driver?:string,took_ms?:int}
     */
    public static function get(string $url, array $opts = []): array
    {
        $base = rtrim((string) config('scraper.renderer.url'), '/');
        $token = (string) config('scraper.renderer.token', '');
        $timeoutMs = (int) ($opts['timeout_ms'] ?? config('scraper.renderer.timeout_ms', 60000));

        if ($base === '' || $base === 'http://' ) {
            return self::fail($url, 'renderer url not configured');
        }

        $payload = [
            'url' => $url,
            'waitUntil' => (string) ($opts['waitUntil'] ?? config('scraper.renderer.wait_until', 'domcontentloaded')),
            'timeout' => $timeoutMs,
            'scroll' => (bool) ($opts['scroll'] ?? config('scraper.renderer.scroll', false)),
        ];
        if (!empty($opts['selector'])) {
            $payload['selector'] = (string) $opts['selector'];
        }
        if (!empty($opts['blockResources'])) {
            $payload['blockResources'] = true;
        }

        try {
            $req = Http::acceptJson()
                ->connectTimeout(5)
                // کمی بیشتر از خودِ رندر — وگرنه سرویس دارد رندر می‌کند و ما قطع کردیم
                ->timeout((int) ceil($timeoutMs / 1000) + 10);
            if ($token !== '') {
                $req = $req->withToken($token);
            }
            $r = $req->post($base . '/render', $payload);
        } catch (\Throwable $e) {
            return self::fail($url, $e->getMessage());
        }

        $body = $r->json();
        if (!$r->ok() || !is_array($body) || empty($body['ok'])) {
            $err = is_array($body) ? (string) ($body['error'] ?? ('HTTP ' . $r->status())) : ('HTTP ' . $r->status());
            return ['ok' => false, 'code' => $r->status(), 'error' => $err,
                    'url' => $url, 'html' => '', 'mode' => 'render'];
        }

        return [
            'ok' => true,
            'code' => (int) ($body['code'] ?? 200),
            'error' => '',
            'url' => (string) ($body['url'] ?? $url) ?: $url,
            'html' => (string) ($body['html'] ?? ''),
            'mode' => 'render',
            'driver' => (string) ($body['driver'] ?? ''),
            'took_ms' => (int) ($body['took_ms'] ?? 0),
        ];
    }

    public static function healthy(): bool
    {
        $base = rtrim((string) config('scraper.renderer.url'), '/');
        if ($base === '') {
            return false;
        }
        try {
            return Http::connectTimeout(3)->timeout(5)->get($base . '/health')->ok();
        } catch (\Throwable) {
            return false;
        }
    }

    /** @return array{ok:bool,code:int,error:string,url:string,html:string,mode:string} */
    private static function fail(string $url, string $error): array
    {
        return ['ok' => false, 'code' => 0, 'error' => $error, 'url' => $url, 'html' => '', 'mode' => 'render'];
    }
}
