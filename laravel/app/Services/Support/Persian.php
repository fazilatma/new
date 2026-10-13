<?php

namespace App\Services\Support;

/**
 * پورتِ وفادارِ توابع متنیِ scraper4.php:
 *   persianToEnglish() / normalize_text() / normalize_html()
 *   extractPrice() / extractPriceNum()
 *
 * هر متد عیناً همان رفتارِ نسخهٔ v10.172 را دارد تا خروجیِ parser در هر دو
 * پیاده‌سازی یکسان باشد (شرطِ مهاجرتِ امن).
 */
class Persian
{
    /** اعداد فارسی/عربی → انگلیسی */
    public static function faDigitsToEn(string $str): string
    {
        $persian = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
        $arabic  = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
        $english = ['0','1','2','3','4','5','6','7','8','9'];
        return str_replace($arabic, $english, str_replace($persian, $english, $str));
    }

    /** normalize_text: decode + فشرده‌سازی فاصله‌ها */
    public static function normalizeText(string $text): string
    {
        $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = preg_replace('/\s+/u', ' ', $text);
        return trim((string) $text);
    }

    /** normalize_html: حذف script/style سپس normalize_text */
    public static function normalizeHtml(string $html): string
    {
        $html = preg_replace('~<script[^>]*>.*?</script>~is', '', $html) ?? $html;
        $html = preg_replace('~<style[^>]*>.*?</style>~is', '', $html) ?? $html;
        $html = html_entity_decode($html, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $html = preg_replace('/\s+/u', ' ', $html) ?? $html;
        return trim($html);
    }

    /**
     * extractPrice — بلندترین عددِ دارای واحد (تومان/ریال)، وگرنه عددِ
     * جداکننده‌دار، وگرنه بلندترین عددِ ۴+ رقمی. خروجی رشته (مثل نسخهٔ قدیمی).
     */
    public static function price(string $text): string
    {
        $text = self::normalizeText($text);
        if ($text === '') {
            return '';
        }
        $sep = '[,،٬\s]';

        if (preg_match_all('~([\d۰-۹٠-٩](?:[\d۰-۹٠-٩]|' . $sep . ')*[\d۰-۹٠-٩])\s*(تومان|تومن|ریال|ر\.ی)~u', $text, $matches, PREG_SET_ORDER)) {
            $best = null;
            $bestLen = 0;
            foreach ($matches as $m) {
                $clean = preg_replace('~[^\d۰-۹٠-٩]~u', '', $m[1]) ?? '';
                $len = mb_strlen($clean);
                if ($len > $bestLen) {
                    $bestLen = $len;
                    $best = $m;
                }
            }
            if ($best !== null) {
                return trim($best[1]);
            }
        }

        if (preg_match('~([\d۰-۹٠-٩]{1,3}(?:[,،٬][\d۰-۹٠-٩]{3})+)~u', $text, $m)) {
            return trim($m[1]);
        }

        if (preg_match_all('~[\d۰-۹٠-٩]+(?:[,،٬][\d۰-۹٠-٩]{3})+~u', $text, $all) && !empty($all[0])) {
            usort($all[0], fn ($a, $b) => strlen(preg_replace('~[^\d۰-۹٠-٩]~u', '', $b) ?? '')
                                        <=> strlen(preg_replace('~[^\d۰-۹٠-٩]~u', '', $a) ?? ''));
            return $all[0][0];
        }

        if (preg_match_all('~[\d۰-۹٠-٩]{4,}~u', $text, $plain) && !empty($plain[0])) {
            usort($plain[0], fn ($a, $b) => strlen((string) $b) <=> strlen((string) $a));
            return $plain[0][0];
        }

        return '';
    }

    /** extractPriceNum — عددِ خالصِ قیمت (بدون جداکننده، رقم‌های انگلیسی) */
    public static function priceNum($price): int
    {
        $s = self::faDigitsToEn((string) $price);
        $s = preg_replace('~[^\d]~', '', $s) ?? '';
        return $s === '' ? 0 : (int) $s;
    }
}
