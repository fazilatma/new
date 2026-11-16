<?php

namespace App\Services\Scraping;

/**
 * واکشِ هوشمند: ایستا یا رندرِ JS — با heuristicای که تصمیم می‌گیرد صفحه
 * «پوستهٔ JS» است یا محتوای واقعی دارد.
 *
 *  mode = static : فقط واکشِ معمولی (رفتارِ فاز ۱)
 *  mode = js     : رندرِ همیشگی (وقتی می‌دانیم سایت SPA است) — اگر رندر ناموفق
 *                  بود به واکشِ ایستا برمی‌گردیم و mode را گزارش می‌دهیم
 *  mode = auto   : اول ایستا؛ اگر خروجی «پوستهٔ JS» تشخیص داده شد، یک بار رندر
 */
class SmartFetcher
{
    /**
     * @param array $net همان پیکربندی راه‌عبورِ HtmlFetcher
     * @param array $renderOpts گزینه‌های RenderedFetcher (مثل scroll/selector)
     * @param callable|null $staticFetcher فقط برای تست — پیش‌فرض HtmlFetcher (شبکهٔ واقعی)
     * @param callable|null $renderFetcher فقط برای تست — پیش‌فرض RenderedFetcher
     */
    public static function get(
        string $url,
        int $timeout = 25,
        array $net = [],
        string $mode = 'auto',
        array $renderOpts = [],
        ?callable $staticFetcher = null,
        ?callable $renderFetcher = null
    ): array {
        $staticFetcher ??= static fn (string $u, int $t, array $n): array => HtmlFetcher::get($u, $t, $n);
        $renderFetcher ??= static fn (string $u, array $o): array => RenderedFetcher::get($u, $o);

        $mode = $mode === '' ? (string) config('scraper.renderer.default_mode', 'auto') : $mode;

        if ($mode === 'js' || $mode === 'render') {
            $r = $renderFetcher($url, $renderOpts);
            if (!empty($r['ok'])) {
                return $r;
            }
            // رندر ناموفق بود — ایستا را هم امتحان کن تا چیزی گم نشود
            $s = $staticFetcher($url, $timeout, $net);
            $s['render_error'] = (string) ($r['error'] ?? '');
            return $s;
        }

        if ($mode === 'static') {
            return $staticFetcher($url, $timeout, $net);
        }

        // auto
        $s = $staticFetcher($url, $timeout, $net);
        if (!empty($s['ok']) && self::looksLikeJsShell((string) $s['html'])) {
            $htmlWas = strlen((string) $s['html']);
            $r = $renderFetcher($url, $renderOpts);
            if (!empty($r['ok']) && strlen((string) $r['html']) > $htmlWas) {
                $r['js_shell_detected'] = true;
                return $r;
            }
            $s['js_shell_detected'] = true;               // تشخیص دادیم ولی رندر نشد
            $s['render_error'] = (string) ($r['error'] ?? '');
        }
        return $s;
    }

    /**
     * تشخیصِ «پوستهٔ JS»: صفحه‌ای که فقط اسکلتِ اپ را دارد و محتوایش با
     * جاوااسکریپت ساخته می‌شود. محافظ‌کار است تا رندرهای اضافی (۱۵-۶۰ثانیه‌ای)
     */
    public static function looksLikeJsShell(string $html): bool
    {
        if ($html === '') {
            return false;
        }
        // صفحهٔ واقعاً کوچک: قضاوت قطعی نکن (می‌تواند صفحهٔ سادهٔ واقعی باشد)
        if (strlen($html) < 1500) {
            return false;
        }

        $visible = preg_replace('~<(script|style|noscript|template)[^>]*>.*?</\1>~is', ' ', $html) ?? $html;
        $visible = trim((string) strip_tags($visible));
        $visibleLen = mb_strlen(preg_replace('~\s+~u', ' ', $visible) ?? $visible);

        if ($visibleLen >= 400) {
            return false;
        }

        // نشانهٔ ۱: متنِ راهنمای «جاوااسکریپت را روشن کنید»
        if (preg_match('~(you need to enable javascript|javascript is required|please enable javascript|جاوااسکریپت را (فعال|روشن)|لطفاً? جاوااسکریپت)~iu', $html)) {
            return true;
        }

        // نشانهٔ ۲: ظرفِ خالیِ رایجِ SPA + متنِ خیلی کم
        if (preg_match('~<(div|main|section)[^>]+(?:id|class)=["\'][^"\']*(?:__next|__nuxt|app-root|ng-|id="root"|id="app"|\broot\b|\bapp\b)[^"\']*["\'][^>]*>\s*(?:<[^a/][^>]*>\s*){0,3}</(div|main|section)>~i', $html)) {
            return true;
        }

        // نشانهٔ ۳: نسبتِ اسکریپت به متن — تودهٔ JS با متنِ تقریباً صفر
        if ($visibleLen < 120 && preg_match_all('~<script[^>]+src=~i', $html, $m) && count($m[0]) >= 2) {
            if (preg_match('~(data-reactroot|window\.__NUXT__|ng-version|__NEXT_DATA__)~i', $html)) {
                return true;
            }
        }

        return false;
    }
}
