<?php

namespace Tests\Unit;

use App\Services\Scraping\PaginationUrlBuilder as B;
use PHPUnit\Framework\TestCase;

/**
 * قراردادِ رفتاریِ build_page_url_custom (v10.172) — این ۱۳ سناریو همان
 * خودآزمایی‌های فایلِ قدیمی + موارد لبه است و در هر دو پیاده‌سازی باید
 * دقیقاً همان خروجی را بدهد.
 */
class PaginationUrlBuilderTest extends TestCase
{
    public function test_tilde_pattern_appends_to_path(): void
    {
        $this->assertSame(
            'https://t.test/shop~page~2',
            B::build('https://t.test/shop', 'https://t.test/shop', 2, B::PATH_PATTERN, '~page~{page}')
        );
    }

    public function test_tilde_marker_is_replaced_not_stacked(): void
    {
        $this->assertSame(
            'https://t.test/shop~page~3',
            B::build('https://t.test/shop~page~2', 'https://t.test/shop~page~2', 3, B::PATH_PATTERN, '~page~{page}')
        );
    }

    public function test_similar_separators_are_covered(): void
    {
        $this->assertSame(
            'https://t.test/cat~p~5',
            B::build('https://t.test/cat~p~4', 'https://t.test/cat~p~4', 5, B::PATH_PATTERN, '~p~{page}')
        );
        $this->assertSame(
            'https://t.test/cat-page-5',
            B::build('https://t.test/cat-page-4', 'https://t.test/cat-page-4', 5, B::PATH_PATTERN, '-page-{page}')
        );
    }

    public function test_pattern_suffix_is_respected_when_cleaning(): void
    {
        $this->assertSame(
            'https://t.test/shop~page~4.html',
            B::build('https://t.test/shop~page~2.html', 'https://t.test/shop~page~2.html', 4, B::PATH_PATTERN, '~page~{page}.html')
        );
    }

    public function test_classic_slash_pattern_still_works(): void
    {
        $this->assertSame(
            'https://t.test/shop/page/3/',
            B::build('https://t.test/shop/page/2/', 'https://t.test/shop/page/2/', 3, B::PATH_PATTERN, '/page/{page}/')
        );
        $this->assertSame(
            'https://t.test/shop/page/2/',
            B::build('https://t.test/shop', 'https://t.test/shop', 2, B::PATH_PATTERN, '/page/{page}/')
        );
    }

    public function test_domain_root_gets_separating_slash(): void
    {
        $this->assertSame(
            'https://t.test/~page~2',
            B::build('https://t.test/', 'https://t.test/', 2, B::PATH_PATTERN, '~page~{page}')
        );
    }

    public function test_full_pattern_accepts_tilde_too(): void
    {
        $this->assertSame(
            'https://t.test/shop~page~7',
            B::build('https://t.test/shop', 'https://t.test/shop', 7, B::FULL_PATTERN, 'https://t.test/shop~page~{page}')
        );
    }

    public function test_case_insensitive_marker_cleanup(): void
    {
        $this->assertSame(
            'https://t.test/shop~page~9',
            B::build('https://t.test/shop~PAGE~8', 'https://t.test/shop~PAGE~8', 9, B::PATH_PATTERN, '~page~{page}')
        );
    }

    public function test_legacy_page_marker_is_always_cleaned(): void
    {
        $this->assertSame(
            'https://t.test/shop~page~13',
            B::build('https://t.test/shop/page/9', 'https://t.test/shop/page/9', 13, B::PATH_PATTERN, '~page~{page}')
        );
    }

    public function test_unrelated_similar_prefix_is_not_stripped(): void
    {
        $this->assertSame(
            'https://t.test/shop~pro~3~p~4',
            B::build('https://t.test/shop~pro~3', 'https://t.test/shop~pro~3', 4, B::PATH_PATTERN, '~p~{page}')
        );
    }

    public function test_query_variants(): void
    {
        $this->assertSame(
            'https://t.test/search/?page=3',
            B::build('https://t.test/search/?page=1', 'https://t.test/search/?page=1', 3, B::QUERY_CUSTOM, 'page')
        );
        $this->assertSame(
            'https://t.test/shop/?paged=4',
            B::build('https://t.test/shop/', 'https://t.test/shop/', 4, B::QUERY_CUSTOM, '')
        );
        $this->assertSame(
            'https://t.test/shop/?page=5',
            B::build('https://t.test/shop/', 'https://t.test/shop/', 5)
        );
    }
}
