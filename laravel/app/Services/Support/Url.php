<?php

namespace App\Services\Support;

/**
 * پورتِ وفادارِ make_absolute_url() / url_is_image() / profileKey() از scraper4.php
 */
class Url
{
    /** آدرس نسبی را نسبت به base مطلق می‌کند (رفتارِ عینِ نسخهٔ قدیمی) */
    public static function absolute(string $url, string $base): string
    {
        $url = trim($url);
        $url = html_entity_decode($url, ENT_QUOTES | ENT_HTML5, 'UTF-8');

        if ($url === '' || preg_match('~^(data:|javascript:|#)~i', $url)) {
            return '';
        }
        if (preg_match('~^https?://~i', $url)) {
            return $url;
        }
        if (strpos($url, '//') === 0) {
            return (parse_url($base, PHP_URL_SCHEME) ?: 'https') . ':' . $url;
        }
        $bp = parse_url($base);
        if (!$bp || empty($bp['host'])) {
            return $url;
        }
        $root = ($bp['scheme'] ?? 'https') . '://' . $bp['host']
              . (isset($bp['port']) ? ':' . $bp['port'] : '');
        if (isset($url[0]) && $url[0] === '/') {
            return $root . $url;
        }
        $dir = preg_replace('~/[^/]*$~', '/', $bp['path'] ?? '/');
        return $root . $dir . $url;
    }

    /** آیا URL به‌درد تصویرِ محصول می‌خورد؟ (پلیس‌هولدرها رد می‌شوند) */
    public static function isImage(string $url): bool
    {
        $u = trim($url);
        if ($u === '' || preg_match('~^(data:|blob:|javascript:|#)~i', $u)) {
            return false;
        }
        if (preg_match('~(placeholder|spacer|transparent|loading|no-?image|blank\.|1x1)~i', $u)) {
            return false;
        }
        return true;
    }

    /** کلید پایدارِ پروفایل از روی URL (همان profileKey نسخهٔ قدیمی) */
    public static function profileKey(string $url): string
    {
        $parts = parse_url($url);
        if (!$parts || empty($parts['host'])) {
            return md5($url);
        }
        $host = strtolower($parts['host']);
        $path = trim($parts['path'] ?? '/', '/');
        $path = preg_replace('~/page/\d+/?$~i', '', $path) ?? $path;
        $path = preg_replace('~\.(html|htm|php)$~i', '', $path) ?? $path;
        return $host . ($path ? '_' . preg_replace('~[^a-z0-9]+~i', '_', $path) : '');
    }
}
