<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Scraping\PaginationUrlBuilder;
use Illuminate\Http\Request;

/**
 * ابزارِ پیش‌نمایشِ صفحه‌بندی — همان چیزی که در تبِ اسکرپرِ قدیمی سخت می‌شد
 * با چشم دید: برای هر پروفایل می‌بینی سایت فلانی با الگوی X به چه URLهایی
 * می‌رسد. روی همهٔ قالب‌ها (از جمله ~page~{page}ِ v10.172) کار می‌کند.
 *
 * GET /api/pagination/preview?url=...&type=path_pattern&val=~page~{page}&pages=3
 */
class PaginationPreviewController extends Controller
{
    public function __invoke(Request $request)
    {
        $data = $request->validate([
            'url' => ['required', 'url', 'max:2048'],
            'type' => ['required', 'in:query_page,query_custom,path_pattern,full_pattern'],
            'val' => ['nullable', 'string', 'max:1024'],
            'pages' => ['nullable', 'integer', 'min:1', 'max:10'],
        ]);

        $pages = (int) ($data['pages'] ?? 3);
        $urls = [];
        for ($p = 1; $p <= $pages; $p++) {
            $urls[] = $p === 1
                ? $data['url']
                : PaginationUrlBuilder::build($data['url'], $data['url'], $p, $data['type'], (string) ($data['val'] ?? ''));
        }

        return response()->json([
            'ok' => true,
            'type' => $data['type'],
            'val' => (string) ($data['val'] ?? ''),
            'urls' => $urls,
        ], 200, [], JSON_UNESCAPED_UNICODE);
    }
}
