<?php

namespace App\Services\Scraping;

use App\Services\Support\Persian;
use App\Services\Support\Url;
use DOMDocument;
use DOMElement;
use DOMNode;
use DOMNodeList;
use DOMXPath;

/**
 * پورتِ وفادارِ موتورِ پارسِ scraper4.php:
 *   load_dom / queryInside (v9.86, v9.87) / parse_with_selectors
 *   (بازشناسیِ مجددِ ظرفِ یکتا) / extractSmartLink / fallbackهای JSON-LD و og:image
 *
 * خروجی: آرایه‌ای از ردیف‌های محصول به‌کلید productKey، مثل نسخهٔ قدیمی.
 */
class ProductParser
{
    /** @return array{0: DOMDocument, 1: DOMXPath} */
    public static function loadDom(string $html): array
    {
        libxml_use_internal_errors(true);
        $dom = new DOMDocument('1.0', 'UTF-8');
        @$dom->loadHTML('<?xml encoding="UTF-8"><meta charset="UTF-8">' . $html, LIBXML_NOERROR);
        libxml_clear_errors();
        return [$dom, new DOMXPath($dom)];
    }

    /**
     * جست‌وجوی یک سلکتور CSS داخلِ یک ظرف.
     *  • خروجیِ cssToXpath مطلق (…//a) به نسبی (… .//a) تبدیل می‌شود — برای
     *    *تک‌تکِ* شاخه‌های union (اصلاحِ «۲۰ پیدا ولی ۱ استخراج»).
     *  • اگر گامِ اولِ سلکتور به خودِ ظرف اشاره کند (مثل «div.card span» وقتی
     *    container=div.card)، آن گامِ اضافی برداشته می‌شود (اصلاحِ v9.87).
     */
    public static function queryInside(DOMXPath $xp, DOMNode $container, string $css): ?DOMNodeList
    {
        foreach ([true, false] as $strict) {
            $xpath = CssToXpath::convert($css, $strict);
            if ($xpath === '') {
                continue;
            }
            $parts = preg_split('~\s*\|\s*~', $xpath, -1, PREG_SPLIT_NO_EMPTY) ?: [];
            foreach ($parts as $i => $part) {
                $part = trim($part);
                if (strpos($part, '//') === 0) {
                    $part = '.' . $part;
                } elseif (strpos($part, './') !== 0 && strpos($part, '/') === 0) {
                    $part = '.' . $part;
                }
                $parts[$i] = $part;
            }
            $nodes = @$xp->query(implode(' | ', $parts), $container);
            if ($nodes && $nodes->length) {
                return $nodes;
            }

            // حالتِ «پیشوندِ ظرف» (v9.87)
            if ($container instanceof DOMElement) {
                $trimmed = trim($css);
                if (preg_match('~^([^\s>+\x7e]+)[\s>]+(.+)$~u', $trimmed, $m)) {
                    $head = trim($m[1]);
                    $tail = trim($m[2]);
                    if ($head !== '' && $tail !== '' && $tail[0] !== '+' && $tail[0] !== '~') {
                        $headXp = CssToXpath::convert($head, $strict);
                        $isSelf = false;
                        if ($headXp !== '') {
                            foreach (preg_split('~\s*\|\s*~', $headXp, -1, PREG_SPLIT_NO_EMPTY) ?: [] as $sp) {
                                $sp = trim((string) preg_replace('~^/*~', '', trim($sp)));
                                if ($sp === '') {
                                    continue;
                                }
                                $probe = @$xp->query('self::' . $sp, $container);
                                if ($probe && $probe->length) {
                                    $isSelf = true;
                                    break;
                                }
                            }
                        }
                        if ($isSelf) {
                            $tailXp = CssToXpath::convert($tail, $strict);
                            if ($tailXp !== '') {
                                $tp = preg_split('~\s*\|\s*~', $tailXp, -1, PREG_SPLIT_NO_EMPTY) ?: [];
                                foreach ($tp as $i2 => $part2) {
                                    $part2 = trim($part2);
                                    if (strpos($part2, '//') === 0) {
                                        $part2 = '.' . $part2;
                                    } elseif (strpos($part2, './') !== 0 && strpos($part2, '/') === 0) {
                                        $part2 = '.' . $part2;
                                    }
                                    $tp[$i2] = $part2;
                                }
                                $nodes = @$xp->query(implode(' | ', $tp), $container);
                                if ($nodes && $nodes->length) {
                                    return $nodes;
                                }
                            }
                        }
                    }
                }
            }
        }
        return null;
    }

    /** لینکِ هوشمند: خود گره <a>، نزدیک‌ترین جدِ <a> تا مرز، وگرنه نخستین <a href> داخل گره */
    public static function extractSmartLink(?DOMNode $node, DOMXPath $xp, string $baseUrl, ?DOMNode $boundary = null): string
    {
        if (!$node instanceof DOMElement) {
            return '';
        }

        $fromAnchor = function (DOMElement $a) use ($baseUrl): string {
            $h = $a->getAttribute('href') ?: $a->getAttribute('data-href') ?: $a->getAttribute('data-url') ?: '';
            if ($h !== '' && $h !== '#' && !preg_match('~^(javascript:|data:)~i', $h)) {
                return Url::absolute($h, $baseUrl);
            }
            return '';
        };

        if ($node->tagName === 'a') {
            $l = $fromAnchor($node);
            if ($l !== '') {
                return $l;
            }
        }

        // اجدادِ <a> تا مرزِ ظرف
        for ($p = $node->parentNode; $p instanceof DOMElement && $p !== $boundary; $p = $p->parentNode) {
            if ($p->tagName === 'a') {
                $l = $fromAnchor($p);
                if ($l !== '') {
                    return $l;
                }
            }
        }

        // نخستین <a href> معتبرِ داخلِ گره
        $q = @$xp->query('.//a[@href]', $node);
        if ($q && $q->length) {
            foreach ($q as $a) {
                if ($a instanceof DOMElement) {
                    $l = $fromAnchor($a);
                    if ($l !== '') {
                        return $l;
                    }
                }
            }
        }
        return '';
    }

    /**
     * پارس با سلکتورهای کاربر (همان parse_with_selectors).
     *
     * @param array $sel ['container'=>css,'title'=>css,'price'=>css,'link'=>css,'image'=>css]
     * @return array<string, array{title:string,price:string,link:string,image:string,sku:string}>
     */
    public static function withSelectors(string $html, string $baseUrl, array $sel): array
    {
        [$dom, $xp] = self::loadDom($html);
        $products = [];

        // ظرف با تطبیقِ دقیقِ کلاس، وگرنه حالتِ contains
        $containerXpath = CssToXpath::convert($sel['container'] ?? '', true);
        if (!$containerXpath) {
            return [];
        }
        $containers = @$xp->query($containerXpath);
        if (!$containers || $containers->length === 0) {
            $containerXpath = CssToXpath::convert($sel['container'] ?? '', false);
            $containers = $containerXpath ? @$xp->query($containerXpath) : null;
        }
        if (!$containers || $containers->length === 0) {
            return self::jsonLdFallback($xp, $baseUrl, []);
        }

        /* بازشناسیِ مجدد: اگر ظرف یکتاست ولی داخلش چند آیتم هست، ظرفِ واقعی
           یک لایه پایین‌تر است (bookstoscrape / mantoopatris) */
        if ($containers->length === 1) {
            $probe = '';
            foreach (['title', 'price', 'link', 'image'] as $f) {
                if (!empty($sel[$f])) {
                    $probe = $sel[$f];
                    break;
                }
            }
            $inner = $probe !== '' ? self::queryInside($xp, $containers->item(0), $probe) : null;
            if (!$inner || $inner->length < 2) {
                foreach (['.//h2|.//h3|.//h4', './/a[@href][.//img]', './/img'] as $q) {
                    $t = @$xp->query($q, $containers->item(0));
                    if ($t && $t->length >= 2) {
                        $inner = $t;
                        break;
                    }
                }
            }
            if ($inner && $inner->length >= 2) {
                $want = $inner->length;
                $best = null;
                $node = $inner->item(0);
                $depth = 0;
                while ($node && $node->parentNode instanceof DOMElement && $depth < 8) {
                    $node = $node->parentNode;
                    if ($node === $containers->item(0)) {
                        break;
                    }
                    $name = $node->nodeName;
                    $cls = $node instanceof DOMElement ? trim($node->getAttribute('class')) : '';
                    if ($cls !== '') {
                        $first = (preg_split('~\s+~', $cls) ?: [''])[0];
                        $q = './/' . $name . '[' . CssToXpath::classCond($first, true) . ']';
                    } else {
                        $q = './/' . $name;
                    }
                    $sib = @$xp->query($q, $containers->item(0));
                    if ($sib && $sib->length === $want) {
                        $best = $sib;
                    } elseif ($sib && $sib->length > $want) {
                        break;
                    }
                    $depth++;
                }
                if ($best) {
                    $containers = $best;
                }
            }
        }

        foreach ($containers as $container) {
            $p = ['title' => '', 'price' => '', 'link' => '', 'image' => '', 'sku' => ''];

            // عنوان: سلکتورِ کاربر (اولین گرهِ دارای متن — v9.87)، وگرنه fallbackهای عمومی
            if (!empty($sel['title'])) {
                $nodes = self::queryInside($xp, $container, $sel['title']);
                if ($nodes && $nodes->length) {
                    foreach ($nodes as $_tn) {
                        $_tt = Persian::normalizeText($_tn->textContent);
                        if ($_tt !== '') {
                            $p['title'] = $_tt;
                            break;
                        }
                    }
                }
            }
            if ($p['title'] === '') {
                foreach (['.//h2', './/h3', './/h4', './/*[contains(@class,"title")]', './/a[@title]'] as $q) {
                    $nodes = @$xp->query($q, $container);
                    if ($nodes && $nodes->length) {
                        $text = Persian::normalizeText($nodes->item(0)->textContent);
                        if ($text !== '' && mb_strlen($text) > 2 && mb_strlen($text) < 200) {
                            $p['title'] = $text;
                            break;
                        }
                    }
                }
            }

            // قیمت: سلکتورِ کاربر (اولین گره‌ای که واقعاً قیمت دارد — v9.87)، وگرنه fallback
            if (!empty($sel['price'])) {
                $nodes = self::queryInside($xp, $container, $sel['price']);
                if ($nodes && $nodes->length) {
                    foreach ($nodes as $_pn) {
                        $_pp = Persian::price($_pn->textContent);
                        if ($_pp !== '') {
                            $p['price'] = $_pp;
                            break;
                        }
                    }
                }
            }
            if ($p['price'] === '') {
                foreach (['.//ins//*[contains(@class,"amount")]', './/*[contains(@class,"price")]', './/*[contains(@class,"amount")]'] as $q) {
                    $nodes = @$xp->query($q, $container);
                    if ($nodes && $nodes->length) {
                        $price = Persian::price($nodes->item(0)->textContent);
                        if ($price !== '') {
                            $p['price'] = $price;
                            break;
                        }
                    }
                }
            }

            // لینک
            if (!empty($sel['link'])) {
                $nodes = self::queryInside($xp, $container, $sel['link']);
                if ($nodes && $nodes->length && $nodes->item(0) instanceof DOMElement) {
                    $p['link'] = self::extractSmartLink($nodes->item(0), $xp, $baseUrl, $container);
                }
            }
            if ($p['link'] === '') {
                $p['link'] = self::extractSmartLink($container, $xp, $baseUrl, $container);
            }

            // تصویر: سلکتور، وگرنه نخستین imgِ سالم
            if (!empty($sel['image'])) {
                $nodes = self::queryInside($xp, $container, $sel['image']);
                if ($nodes && $nodes->length && $nodes->item(0) instanceof DOMElement) {
                    $p['image'] = self::imageFromNode($nodes->item(0), $baseUrl);
                }
            }
            if ($p['image'] === '') {
                $imgNodes = @$xp->query('.//img', $container);
                if ($imgNodes && $imgNodes->length) {
                    $p['image'] = self::imageFromNode($imgNodes->item(0), $baseUrl);
                }
            }

            if ($p['title'] === '' && $p['link'] === '') {
                continue;
            }
            $key = ProductKey::of($p);
            if (!isset($products[$key])) {
                $products[$key] = $p;
            }
        }

        // fallback آخر: محصولاتِ application/ld+json
        if (empty($products)) {
            $products = self::jsonLdFallback($xp, $baseUrl, $products);
        }

        return $products;
    }

    /**
     * وقتی سلکتوری انتخاب نشده (حالت «خودکار»).
     *
     * ⚠ فاز ۱: fallbackهای ساخت‌یافته — JSON-LD (Product) و آیتم‌های
     * itemscope/schema.org. تشخیص خودکارِ ظرفِ تکرارشوندهٔ parse_products
     * (آنالیز آماریِ DOM) در فاز ۲ پورت می‌شود؛ تا آن‌جا یا سلکتور بدهید یا
     * روی سایت‌های استاندارد schema.org تکیه کنید.
     *
     * @return array<string, array{title:string,price:string,link:string,image:string,sku:string}>
     */
    public static function auto(string $html, string $baseUrl): array
    {
        [$dom, $xp] = self::loadDom($html);
        $products = self::jsonLdFallback($xp, $baseUrl, []);

        /* itemscope محصولات (microdata) */
        if (!$products) {
            $scopes = @$xp->query('//*[@itemscope][@itemtype]');
            if ($scopes) {
                foreach ($scopes as $scope) {
                    if (!$scope instanceof DOMElement
                        || stripos($scope->getAttribute('itemtype'), 'Product') === false) {
                        continue;
                    }
                    $get = function (string $prop) use ($xp, $scope): string {
                        $n = @$xp->query('.//*[@itemprop="' . $prop . '"]', $scope);
                        if (!$n || !$n->length) {
                            return '';
                        }
                        $el = $n->item(0);
                        if ($el instanceof DOMElement) {
                            foreach (['content', 'href', 'src'] as $a) {
                                $v = $el->getAttribute($a);
                                if ($v !== '') {
                                    return $v;
                                }
                            }
                        }
                        return Persian::normalizeText($el->textContent);
                    };
                    $p = [
                        'title' => Persian::normalizeText($get('name')),
                        'price' => Persian::price($get('price')),
                        'link' => Url::absolute($get('url'), $baseUrl),
                        'image' => Url::absolute($get('image'), $baseUrl),
                        'sku' => Persian::normalizeText($get('sku')),
                    ];
                    if ($p['title'] === '' && $p['link'] === '') {
                        continue;
                    }
                    $key = ProductKey::of($p);
                    if (!isset($products[$key])) {
                        $products[$key] = $p;
                    }
                }
            }
        }

        return $products;
    }

    /** og:image / امتیازدهیِ imgها — وقتی محصولی مستقیم نیست (برای صفحهٔ تکی) */
    public static function imageFromPage(string $html, string $pageUrl): string
    {
        if ($html === '') {
            return '';
        }
        $parsed = parse_url($pageUrl);
        $base = ($parsed['scheme'] ?? 'https') . '://' . ($parsed['host'] ?? '');

        if (preg_match('/<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']/i', $html, $m)) {
            return self::resolveUrl($m[1], $base, $pageUrl);
        }
        if (preg_match('/<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']/i', $html, $m)) {
            return self::resolveUrl($m[1], $base, $pageUrl);
        }
        if (preg_match('/<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)["\']/i', $html, $m)) {
            return self::resolveUrl($m[1], $base, $pageUrl);
        }

        if (preg_match_all('/<img[^>]+>/i', $html, $imgs)) {
            $bestUrl = '';
            $bestScore = 0;
            foreach ($imgs[0] as $img) {
                $src = $class = $id = $alt = '';
                $w = $h = 0;
                if (preg_match('/src=["\']([^"\']+)["\']/i', $img, $sm)) $src = $sm[1];
                if (preg_match('/class=["\']([^"\']+)["\']/i', $img, $cm)) $class = $cm[1];
                if (preg_match('/id=["\']([^"\']+)["\']/i', $img, $im)) $id = $im[1];
                if (preg_match('/width=["\'](\d+)["\']/i', $img, $wm)) $w = (int) $wm[1];
                if (preg_match('/height=["\'](\d+)["\']/i', $img, $hm)) $h = (int) $hm[1];
                if (preg_match('/alt=["\']([^"\']+)["\']/i', $img, $am)) $alt = $am[1];
                if ($src === '' || preg_match('/^(data:|javascript:|#)/i', $src)) {
                    continue;
                }
                $score = ($w > 200 && $h > 200 ? 10 : 0) + ($w * $h > 50000 ? 5 : 0);
                $kw = 'product|main|big|large|gallery|featured|hero|primary|item|detail';
                if (preg_match('/' . $kw . '/i', $class . $id)) $score += 8;
                if (preg_match('/' . $kw . '/i', $alt)) $score += 3;
                if (preg_match('/logo|icon|badge|thumb|avatar|sprite|social|banner|slider/i', $class . $id)) $score -= 10;
                if ($score > $bestScore) {
                    $bestScore = $score;
                    $bestUrl = $src;
                }
            }
            if ($bestUrl !== '' && $bestScore >= 3) {
                return self::resolveUrl($bestUrl, $base, $pageUrl);
            }
        }

        if (preg_match('/<img[^>]+src=["\']([^"\']+)["\'][^>]*>/i', $html, $m)) {
            $u = $m[1];
            if (!preg_match('/^(data:|javascript:|#|[\w]+-icon)/i', $u) && strlen($u) > 10) {
                return self::resolveUrl($u, $base, $pageUrl);
            }
        }
        return '';
    }

    /** srcset/data-src و بقیهٔ صفت‌های رایج از یک گره */
    protected static function imageFromNode(DOMElement $node, string $baseUrl): string
    {
        foreach (['data-src', 'data-lazy-src', 'data-original', 'src'] as $attr) {
            $v = $node->getAttribute($attr);
            if ($v !== '' && Url::isImage($v)) {
                return Url::absolute($v, $baseUrl);
            }
        }
        // اگر گره خودِ img نیست، درونش بگرد
        if ($node->tagName !== 'img') {
            $imgs = $node->getElementsByTagName('img');
            if ($imgs->length && $imgs->item(0) instanceof DOMElement) {
                return self::imageFromNode($imgs->item(0), $baseUrl);
            }
        }
        return '';
    }

    /** محصولاتِ schema.org داخل application/ld+json */
    protected static function jsonLdFallback(DOMXPath $xp, string $baseUrl, array $products): array
    {
        $scripts = @$xp->query("//script[@type='application/ld+json']");
        if (!$scripts) {
            return $products;
        }
        foreach ($scripts as $script) {
            $data = json_decode((string) $script->textContent, true);
            if (!is_array($data)) {
                continue;
            }
            $items = [];
            $walk = function ($d) use (&$walk, &$items): void {
                if (!is_array($d)) {
                    return;
                }
                if (stripos((string) ($d['@type'] ?? ''), 'Product') !== false) {
                    $items[] = $d;
                }
                foreach ($d as $v) {
                    if (is_array($v)) {
                        $walk($v);
                    }
                }
            };
            $walk($data);
            foreach ($items as $item) {
                $img = is_array($item['image'] ?? null) ? ($item['image'][0] ?? '') : ($item['image'] ?? '');
                $p = [
                    'title' => (string) ($item['name'] ?? ''),
                    'price' => ($item['offers']['price'] ?? '') . ' تومان',
                    'link' => Url::absolute((string) ($item['url'] ?? ''), $baseUrl),
                    'image' => Url::absolute((string) $img, $baseUrl),
                    'sku' => (string) ($item['sku'] ?? ''),
                ];
                $key = ProductKey::of($p);
                if (!isset($products[$key])) {
                    $products[$key] = $p;
                }
            }
        }
        return $products;
    }

    /** همان resolveUrl قدیمی */
    protected static function resolveUrl(string $url, string $base, string $pageUrl): string
    {
        if (preg_match('/^https?:\/\//i', $url)) {
            return $url;
        }
        if (strpos($url, '//') === 0) {
            return 'https:' . $url;
        }
        if (strpos($url, '/') === 0) {
            return $base . $url;
        }
        return rtrim($pageUrl, '/') . '/' . ltrim($url, '/');
    }
}
