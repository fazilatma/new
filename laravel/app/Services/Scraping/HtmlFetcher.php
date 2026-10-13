<?php

namespace App\Services\Scraping;

/**
 * پورتِ fetch_html + srcNet از scraper4.php — واکش HTML با:
 *  • فاصلهٔ ادب (pace) بین درخواست‌های پشت‌سرهم به یک دامنه
 *  • زنجیرهٔ روش‌های اتصال: direct و در صورت نیاز proxy / dns / doh / worker
 *  • توقفِ زنجیره روی خطای منطقی (غیر از 403/429)
 *
 * خروجی همان قراردادِ قدیمی است:
 *   ['ok'=>bool,'code'=>int,'error'=>string,'url'=>effectiveUrl,'html'=>string,'mode'=>string]
 *
 * مستقل از Http facade روی ext-curl پیاده شده تا رفتارها (CURLOPT_RESOLVE،
 * پروکسی‌های socks، هدر کارگر) عیناً قابل انتقال باشند.
 */
class HtmlFetcher
{
    /** آخرین زمانِ درخواست به هر هاست (برای pace) */
    private static array $lastHit = [];

    /**
     * @param array $net  پیکربندی راه‌عبور، مثل نسخهٔ قدیمی:
     *   ['mode'=>'direct'|'proxy'|'dns'|'doh'|'worker', 'fallback'=>bool,
     *    'hosts'=>'example.com,...', 'gap_ms'=>int, 'proxy'=>..., 'proxy_type'=>...,
     *    'proxy_auth'=>..., 'resolve_ip'=>..., 'doh_url'=>..., 'worker_url'=>..., 'ipv4'=>bool]
     * @return array{ok:bool,code:int,error:string,url:string,html:string,mode:string}
     */
    public static function get(string $url, int $timeout = 25, array $net = []): array
    {
        $cfg = array_merge([
            'mode' => 'direct', 'fallback' => false, 'hosts' => '', 'gap_ms' => 0,
            'proxy' => '', 'proxy_type' => 'http', 'proxy_auth' => '',
            'resolve_ip' => '', 'doh_url' => '', 'worker_url' => '', 'ipv4' => false,
        ], $net);

        $host = strtolower((string) (parse_url($url, PHP_URL_HOST) ?? ''));
        self::pace($host, (int) $cfg['gap_ms']);

        $modes = [];
        if (self::applies($cfg, $host)) {
            $modes[] = (string) $cfg['mode'];
        }
        if (!empty($cfg['fallback'])) {
            foreach (['doh', 'dns', 'proxy', 'worker'] as $m) {
                if (in_array($m, $modes, true)) continue;
                if ($m === 'dns'    && trim((string) $cfg['resolve_ip']) === '') continue;
                if ($m === 'doh'    && trim((string) $cfg['doh_url']) === '') continue;
                if ($m === 'proxy'  && trim((string) $cfg['proxy']) === '') continue;
                if ($m === 'worker' && trim((string) $cfg['worker_url']) === '') continue;
                $modes[] = $m;
            }
        }
        if (!$modes) {
            $modes = ['direct'];
        }

        $last = null;
        foreach ($modes as $m) {
            $last = self::attempt($url, $timeout, $cfg, $m);
            if (!empty($last['ok'])) {
                return $last;
            }
            // خطای قطعیِ منطقی؟ روشِ دیگر فایده ندارد
            if ($last['code'] > 0 && !in_array($last['code'], [403, 429], true)) {
                break;
            }
        }
        return $last ?? ['ok' => false, 'code' => 0, 'error' => 'Empty', 'url' => $url, 'html' => '', 'mode' => ''];
    }

    /** فاصلهٔ ادب بین دو درخواستِ پشت‌سرهم به یک هاست */
    private static function pace(string $host, int $gapMs): void
    {
        if ($gapMs <= 0 || $host === '') {
            return;
        }
        $now = microtime(true);
        $last = self::$lastHit[$host] ?? 0;
        $wait = $last + ($gapMs / 1000) - $now;
        if ($wait > 0) {
            usleep((int) ($wait * 1_000_000));
        }
        self::$lastHit[$host] = microtime(true);
    }

    /** آیا راه‌عبور روی این هاست اعمال می‌شود؟ (فیلترِ دامنه) */
    private static function applies(array $cfg, string $host): bool
    {
        $list = trim((string) $cfg['hosts']);
        if ($list === '') {
            return true;
        }
        foreach (preg_split('~[\s,]+~u', strtolower($list), -1, PREG_SPLIT_NO_EMPTY) ?: [] as $h) {
            if ($h !== '' && str_contains($host, $h)) {
                return true;
            }
        }
        return false;
    }

    /** @return array{ok:bool,code:int,error:string,url:string,html:string,mode:string} */
    private static function attempt(string $url, int $timeout, array $cfg, string $mode): array
    {
        $host = strtolower((string) (parse_url($url, PHP_URL_HOST) ?? ''));
        $ua = (string) config('scraper.fetch.user_agent');
        $connectTimeout = (int) config('scraper.fetch.connect_timeout', 10);

        $opt = [
            CURLOPT_URL => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 5,
            CURLOPT_CONNECTTIMEOUT => $connectTimeout,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => false,
            CURLOPT_ENCODING => '',
            CURLOPT_USERAGENT => $ua,
            CURLOPT_HTTPHEADER => ['Accept: text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'],
        ];

        if ($mode === 'worker' && trim((string) $cfg['worker_url']) !== '') {
            $w = rtrim((string) $cfg['worker_url'], '/');
            $opt[CURLOPT_URL] = str_contains($w, '{url}')
                ? str_replace('{url}', rawurlencode($url), $w)
                : $w . '/' . ltrim($url, '/');
            $opt[CURLOPT_HTTPHEADER][] = 'X-Target-URL: ' . $url;
        } elseif (($mode === 'dns' || $mode === 'doh')) {
            $ip = '';
            if ($mode === 'dns') {
                $ip = (string) $cfg['resolve_ip'];
            } elseif (trim((string) $cfg['doh_url']) !== '') {
                $ip = self::dohResolve((string) parse_url($url, PHP_URL_HOST), (string) $cfg['doh_url'], 10);
            }
            if ($ip !== '') {
                $port = ((parse_url($url, PHP_URL_SCHEME) ?: 'https') === 'https') ? 443 : 80;
                $opt[CURLOPT_RESOLVE] = [$host . ':' . $port . ':' . $ip];
            } else {
                return ['ok' => false, 'code' => 0, 'error' => 'resolve failed', 'url' => $url, 'html' => '', 'mode' => $mode];
            }
        } elseif ($mode === 'proxy' && trim((string) $cfg['proxy']) !== '') {
            $opt[CURLOPT_PROXY] = (string) $cfg['proxy'];
            $map = [
                'http' => CURLPROXY_HTTP,
                'socks5' => defined('CURLPROXY_SOCKS5_HOSTNAME') ? CURLPROXY_SOCKS5_HOSTNAME : CURLPROXY_SOCKS5,
                'socks4' => defined('CURLPROXY_SOCKS4') ? CURLPROXY_SOCKS4 : CURLPROXY_HTTP,
            ];
            $opt[CURLOPT_PROXYTYPE] = $map[(string) $cfg['proxy_type']] ?? CURLPROXY_HTTP;
            if (trim((string) $cfg['proxy_auth']) !== '') {
                $opt[CURLOPT_PROXYUSERPWD] = (string) $cfg['proxy_auth'];
            }
        }
        if ($mode !== 'direct' && !empty($cfg['ipv4']) && defined('CURL_IPRESOLVE_V4')) {
            $opt[CURLOPT_IPRESOLVE] = CURL_IPRESOLVE_V4;
        }

        $ch = curl_init();
        curl_setopt_array($ch, $opt);
        $body = curl_exec($ch);
        $error = (string) curl_error($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $effective = (string) curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
        curl_close($ch);

        return [
            'ok' => $code >= 200 && $code < 300 && $body !== false && $body !== '',
            'code' => $code,
            'error' => $error,
            'url' => $effective !== '' ? $effective : $url,
            'html' => $body === false ? '' : (string) $body,
            'mode' => $mode,
        ];
    }

    /** حلِ DNS روی DoH (شکلِ سبک — معادل aiDohResolve) */
    private static function dohResolve(string $host, string $dohUrl, int $timeout): string
    {
        $u = (str_contains($dohUrl, '?') ? $dohUrl . '&' : $dohUrl . '?')
           . 'name=' . rawurlencode($host) . '&type=A';
        $ch = curl_init($u);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_HTTPHEADER => ['Accept: application/dns-json'],
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => false,
        ]);
        $b = curl_exec($ch);
        curl_close($ch);
        $j = json_decode((string) $b, true);
        foreach ((array) ($j['Answer'] ?? []) as $a) {
            if ((int) ($a['type'] ?? 0) === 1 && filter_var($a['data'] ?? '', FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
                return (string) $a['data'];
            }
        }
        return '';
    }
}
