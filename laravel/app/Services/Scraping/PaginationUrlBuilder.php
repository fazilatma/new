<?php

namespace App\Services\Scraping;

/**
 * پورتِ build_page_url_custom() — شامل اصلاحِ v10.172:
 * قالب‌های صفحه‌بندیِ «~page~{page}» و مشابه (‏~p~{page}، ‏-page-{page}،
 * پسوندها مثل .html) هم پوشش داده می‌شوند.
 *
 * انواعِ پشتیبانی‌شده (همان pagType رابطِ قدیمی):
 *   query_page    → ?page=N روی URL فعلی
 *   query_custom  → ?<param>=N روی URL فعلی (پیش‌فرض param=paged)
 *   path_pattern  → الگوی مسیر مثل /page/{page}/ یا ~page~{page}
 *   full_pattern  → الگوی کاملِ URL (هرجایش {page})
 *   next_selector → توسط مصرف‌کننده مدیریت می‌شود (اینجا فقط پاس می‌شود)
 */
class PaginationUrlBuilder
{
    public const QUERY_PAGE = 'query_page';
    public const QUERY_CUSTOM = 'query_custom';
    public const PATH_PATTERN = 'path_pattern';
    public const FULL_PATTERN = 'full_pattern';
    public const NEXT_SELECTOR = 'next_selector';

    public static function build(
        string $currentUrl,
        string $baseUrl,
        int $page,
        string $type = self::QUERY_PAGE,
        string $val = ''
    ): string {
        if ($type === self::QUERY_CUSTOM) {
            $param = $val !== '' ? $val : 'paged';
            $parts = parse_url($currentUrl);
            if (!$parts) {
                return $currentUrl;
            }
            $base = ($parts['scheme'] ?? 'https') . '://' . ($parts['host'] ?? '') . ($parts['path'] ?? '/');
            parse_str($parts['query'] ?? '', $q);
            $q[$param] = $page;
            return $base . '?' . http_build_query($q);
        }

        if ($type === self::PATH_PATTERN) {
            $pattern = $val !== '' ? $val : '/page/{page}/';
            $replacement = str_replace('{page}', (string) $page, $pattern);
            $parts = parse_url($baseUrl);
            $root = ($parts['scheme'] ?? 'https') . '://' . ($parts['host'] ?? '');
            $basePath = rtrim($parts['path'] ?? '/', '/');

            /* v10.172: نشانهٔ صفحهٔ فعلی بر اساس خودِ الگو پاک می‌شود، نه فقط
               شکلِ کلاسیکِ /page/N. متنِ ثابتِ قبل و بعدِ {page} به‌عنوان
               پیشوند/پسوندِ الگو برداشته می‌شود و اگر انتهای مسیرِ پایه
               «پیشوند + عدد (+ پسوند)» باشد حذف می‌شود؛ پس قالب‌هایی مثل
               ~page~{page} هم کار می‌کنند و نشانه‌ها روی هم انباشته نمی‌شوند
               (/shop~page~2 با الگوی ~page~{page} ⇒ /shop~page~3). */
            $tokPos = strpos($pattern, '{page}');
            if ($tokPos !== false) {
                $pfxRaw = substr($pattern, 0, $tokPos);
                $sfxRaw = substr($pattern, $tokPos + 6);
                if ($pfxRaw !== '') {
                    $sfxTrim = rtrim($sfxRaw, '/');
                    $sfxPart = ($sfxTrim !== '' ? preg_quote($sfxTrim, '~') : '')
                        . (($sfxRaw === '' || substr($sfxRaw, -1) === '/') ? '/?' : '');
                    $cleaned = preg_replace('~' . preg_quote($pfxRaw, '~') . '\d+' . $sfxPart . '$~i', '', $basePath);
                    $basePath = $cleaned ?? $basePath;
                }
            }
            $basePath = preg_replace('~/page/\d+/?$~i', '', $basePath) ?? $basePath;
            $basePath = rtrim($basePath, '/');
            /* ریشهٔ دامنه + الگوی بدونِ اسلشِ آغازین (مثل ~page~{page}) */
            if ($basePath === '' && $replacement !== '' && $replacement[0] !== '/') {
                $basePath = '/';
            }
            return $root . $basePath . $replacement;
        }

        if ($type === self::FULL_PATTERN) {
            return str_replace('{page}', (string) $page, $val);
        }

        // query_page (پیش‌فرض)
        $parts = parse_url($currentUrl);
        if (!$parts) {
            return $currentUrl;
        }
        $base = ($parts['scheme'] ?? 'https') . '://' . ($parts['host'] ?? '') . ($parts['path'] ?? '/');
        parse_str($parts['query'] ?? '', $q);
        $q['page'] = $page;
        return $base . '?' . http_build_query($q);
    }
}
