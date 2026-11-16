<?php

namespace App\Services\Scraping;

/**
 * پورتِ productKey() — کلیدِ یکتای محصول برای حذفِ تکراری.
 * اولویت با لینکِ پاک‌شده (بدون query/fragment) است؛ در نبودِ لینک،
 * عنوانِ نرمال + قیمت.
 */
class ProductKey
{
    /** @param array{link?:string,title?:string,price?:string} $p */
    public static function of(array $p): string
    {
        if (!empty($p['link'])) {
            $url = preg_replace('~[?#].*$~', '', (string) $p['link']) ?? (string) $p['link'];
            $url = rtrim($url, '/');
            return md5('url:' . $url);
        }
        $title = mb_strtolower(trim((string) ($p['title'] ?? '')));
        $title = preg_replace('~\s+~u', ' ', $title) ?? $title;
        return md5('title:' . $title . '|' . ($p['price'] ?? ''));
    }
}
