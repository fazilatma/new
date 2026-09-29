<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Scraping\CssToXpath;
use App\Services\Scraping\HtmlFetcher;
use App\Services\Scraping\PaginationUrlBuilder;
use App\Services\Scraping\ProductParser;
use App\Services\Support\Url;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * اسکریپِ زنده با SSE — پورتِ بخشِ «?stream=1» از scraper4.php
 *
 * رویدادها (کاملاً سازگار با رابطِ قدیمی):
 *   page {page,url,ok} · product {…fields,key} · page_done {page,new,total}
 *   error {message} · done {}
 *
 * پارامترها: url, pages(۱..۱۰۰), pagType, pagVal, selectors(JSON)
 */
class ScrapeStreamController extends Controller
{
    public function __invoke(Request $request): StreamedResponse
    {
        $data = $request->validate([
            'url' => ['required', 'url', 'max:2048'],
            'pages' => ['nullable', 'integer', 'min:1', 'max:100'],
            'pagType' => ['nullable', 'in:query_page,query_custom,path_pattern,full_pattern,next_selector'],
            'pagVal' => ['nullable', 'string', 'max:1024'],
            'selectors' => ['nullable', 'string', 'max:8192'],
        ]);

        $url = trim($data['url']);
        $maxPages = max(1, min(100, (int) ($data['pages'] ?? 20)));
        $selectors = isset($data['selectors']) ? json_decode((string) $data['selectors'], true) : null;
        $pagType = $data['pagType'] ?? PaginationUrlBuilder::QUERY_PAGE;
        $pagVal = trim((string) ($data['pagVal'] ?? ''));

        return response()->stream(function () use ($url, $maxPages, $selectors, $pagType, $pagVal): void {
            while (ob_get_level() > 0) {
                @ob_end_clean();
            }

            $all = [];
            $seen = [];
            $nextUrl = null;

            for ($page = 1; $page <= $maxPages; $page++) {
                if ($page === 1) {
                    $pageUrl = $url;
                } elseif ($pagType === PaginationUrlBuilder::NEXT_SELECTOR && $nextUrl) {
                    $pageUrl = $nextUrl;
                } elseif ($pagType === PaginationUrlBuilder::NEXT_SELECTOR && !$nextUrl) {
                    $this->sse('page', ['page' => $page, 'url' => '', 'ok' => false]);
                    break;
                } else {
                    $pageUrl = PaginationUrlBuilder::build($url, $url, $page, $pagType, $pagVal);
                }

                $res = $this->fetch($pageUrl);
                $this->sse('page', ['page' => $page, 'url' => $res['url'], 'ok' => $res['ok']]);

                if (!$res['ok']) {
                    if ($page === 1) {
                        $this->sse('error', ['message' => 'Failed: ' . $res['error']]);
                    }
                    break;
                }

                $pageProducts = ($selectors && !empty($selectors['container']))
                    ? ProductParser::withSelectors($res['html'], $res['url'], $selectors)
                    : ProductParser::auto($res['html'], $res['url']);

                $newCount = 0;
                foreach ($pageProducts as $key => $p) {
                    if (isset($seen[$key])) {
                        continue;
                    }
                    $seen[$key] = 1;
                    $all[$key] = $p;
                    $newCount++;
                    $this->sse('product', array_merge($p, ['key' => $key]));
                }

                $this->sse('page_done', ['page' => $page, 'new' => $newCount, 'total' => count($all)]);

                // next_selector: دکمهٔ «بعد» را از روی صفحه پیدا کن
                if ($pagType === PaginationUrlBuilder::NEXT_SELECTOR && $pagVal !== '') {
                    [$dom, $xp] = ProductParser::loadDom($res['html']);
                    $xpath = CssToXpath::convert($pagVal);
                    $nodes = $xpath !== '' ? @$xp->query($xpath) : null;
                    $nextUrl = null;
                    if ($nodes && $nodes->length && $nodes->item(0) instanceof \DOMElement) {
                        $href = $nodes->item(0)->getAttribute('href');
                        if ($href !== '' && $href !== '#' && !preg_match('~^(javascript:|data:)~i', $href)) {
                            $nextUrl = Url::absolute($href, $res['url']);
                        }
                    }
                }

                if ($page > 1 && $newCount === 0) {
                    break;
                }
                usleep(300000);
            }

            $this->sse('done', []);
        }, 200, [
            'Content-Type' => 'text/event-stream',
            'Cache-Control' => 'no-cache',
            'X-Accel-Buffering' => 'no',
        ]);
    }

    private function fetch(string $url): array
    {
        $net = (array) config('scraper.fetch.net', []);
        return HtmlFetcher::get($url, (int) config('scraper.fetch.timeout', 25), $net);
    }

    private function sse(string $event, array $payload): void
    {
        echo "event: {$event}\n";
        echo 'data: ' . json_encode($payload, JSON_UNESCAPED_UNICODE) . "\n\n";
        @ob_flush();
        @flush();
    }
}
