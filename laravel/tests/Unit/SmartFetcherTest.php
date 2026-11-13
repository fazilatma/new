<?php

namespace Tests\Unit;

use App\Services\Scraping\SmartFetcher;
use Tests\TestCase;

class SmartFetcherTest extends TestCase
{
    /**
     * @return array<string, array{0:string, 1:bool}>
     */
    public static function shellCases(): array
    {
        // صفحهٔ معمولی با متنِ کافی — هرگز Shell نیست
        $normal = '<!doctype html><html><head><title>فروشگاه</title></head><body>' .
            '<h1>محصولات</h1>' .
            str_repeat('<div class="p"><h2>گوشی موبایل مدل ایکس</h2><span class="price">۱۲٬۴۵۰٬۰۰۰ تومان</span></div>', 8) .
            '</body></html>';

        // متنِ کافی + اسکریپت‌های زیاد — هنوز Shell نیست (متن سلطه دارد)
        $textyWithScripts = '<html><body><div id="root">' . str_repeat('محتوای واقعی صفحه با متن کامل و طولانی. ', 30) . '</div>' .
            '<script src="/a.js"></script><script src="/b.js"></script><script>window.__NUXT__={};</script></body></html>';

        // پوستهٔ نکست: __next خالی + متن ناچیز (با حجمِ کافی تا از گاردِ «صفحهٔ کوچک» عبور کند)
        $nextShell = '<html><head>' . str_repeat('<!-- pad -->', 140) . '</head><body><div id="__next"></div>' .
            str_repeat('<script src="/_next/static/chunk.js"></script>', 5) .
            '</body></html>';

        // «جاوااسکریپت را فعال کنید»
        $enableJs = '<html><body><p>You need to enable JavaScript to run this app.</p>' . str_repeat(' ', 1600) . '</body></html>';

        // صفحهٔ کوتاه ولی معتبر — قضاوت قطعی نکن
        $tiny = '<html><body><div id="root"></div></body></html>';

        // صفحهٔ KV خالی به‌همراه حجم کافی — Shell
        $reactApp = '<html><body><div id="root"></div><script src="/app.js"></script><script src="/vendor.js"></script>' .
            str_repeat('<!-- pad -->', 120) . '</body></html>';

        return [
            'صفحهٔ معمولی' => [$normal, false],
            'متن زیاد + اسکریپت زیاد' => [$textyWithScripts, false],
            'پوستهٔ Next.js' => [$nextShell, true],
            'متنِ enable-javascript' => [$enableJs, true],
            'صفحهٔ خیلی کوتاه' => [$tiny, false],
            'ریشهٔ خالی ری‌اکت با حجم' => [$reactApp, true],
        ];
    }

    /**
     * @dataProvider shellCases
     */
    public function test_js_shell_heuristic(string $html, bool $expected): void
    {
        $this->assertSame($expected, SmartFetcher::looksLikeJsShell($html));
    }

    public function test_auto_mode_falls_back_to_render_on_shell(): void
    {
        $shell = '<html><body><div id="__next"></div><script src="/a.js"></script><script src="/b.js"></script>' . str_repeat('<!--x-->', 300) . '</body></html>';
        $rendered = '<html><body>' . str_repeat('<div>محصول واقعی با متن و قیمت</div>', 100) . '</body></html>';

        $staticHit = 0;
        $renderHit = 0;
        $staticFetcher = function () use ($shell, &$staticHit) {
            $staticHit++;
            return ['ok' => true, 'code' => 200, 'error' => '', 'url' => 'https://example.com/', 'html' => $shell, 'mode' => 'static'];
        };
        $renderFetcher = function () use ($rendered, &$renderHit) {
            $renderHit++;
            return ['ok' => true, 'code' => 200, 'error' => '', 'url' => 'https://example.com/', 'html' => $rendered, 'mode' => 'render', 'driver' => 'playwright'];
        };

        $r = SmartFetcher::get('https://example.com/', 25, [], 'auto', [], $staticFetcher, $renderFetcher);

        $this->assertSame(1, $staticHit, 'ابتدا واکشِ ایستا');
        $this->assertSame(1, $renderHit, 'پس از تشخیص پوسته، رندر');
        $this->assertTrue($r['ok']);
        $this->assertSame('render', $r['mode']);
        $this->assertTrue($r['js_shell_detected'] ?? false);
        $this->assertStringContainsString('محصول واقعی', $r['html']);
    }

    public function test_auto_mode_keeps_static_when_content_is_real(): void
    {
        $real = '<html><body>' . str_repeat('<div>محتوای واقعیِ کافی</div>', 60) . '</body></html>';
        $renderHit = 0;
        $staticFetcher = fn () => ['ok' => true, 'code' => 200, 'error' => '', 'url' => 'u', 'html' => $real, 'mode' => 'static'];
        $renderFetcher = function () use (&$renderHit) {
            $renderHit++;
            return ['ok' => true, 'code' => 200, 'error' => '', 'url' => 'u', 'html' => 'x', 'mode' => 'render'];
        };

        $r = SmartFetcher::get('https://example.com/', 25, [], 'auto', [], $staticFetcher, $renderFetcher);

        $this->assertSame(0, $renderHit, 'صفحهٔ معمولی نباید رندر شود');
        $this->assertSame('static', $r['mode']);
    }

    public function test_auto_mode_keeps_static_when_render_fails(): void
    {
        $shell = '<html><body><div id="__next"></div><script src="/a.js"></script><script src="/b.js"></script>' . str_repeat('<!--x-->', 300) . '</body></html>';

        $staticFetcher = fn () => ['ok' => true, 'code' => 200, 'error' => '', 'url' => 'u', 'html' => $shell, 'mode' => 'static'];
        $renderFetcher = fn () => ['ok' => false, 'code' => 0, 'error' => 'renderer down', 'url' => 'u', 'html' => '', 'mode' => 'render'];

        $r = SmartFetcher::get('https://example.com/', 25, [], 'auto', [], $staticFetcher, $renderFetcher);

        $this->assertSame('static', $r['mode'], 'درصورت شکستِ رندر، همان نتیجهٔ ایستا برگردد');
        $this->assertTrue($r['js_shell_detected'] ?? false);
        $this->assertSame('renderer down', $r['render_error'] ?? '');
    }

    public function test_static_mode_never_calls_renderer(): void
    {
        $renderHit = 0;
        $staticFetcher = fn () => ['ok' => true, 'code' => 200, 'error' => '', 'url' => 'u', 'html' => '<html><body>ok</body></html>', 'mode' => 'static'];
        $renderFetcher = function () use (&$renderHit) {
            $renderHit++;
            return ['ok' => true, 'code' => 200, 'error' => '', 'url' => 'u', 'html' => 'x', 'mode' => 'render'];
        };

        $r = SmartFetcher::get('https://example.com/', 25, [], 'static', [], $staticFetcher, $renderFetcher);

        $this->assertSame(0, $renderHit);
        $this->assertSame('static', $r['mode']);
    }

    public function test_js_mode_renders_first_and_falls_back_on_failure(): void
    {
        $renderHit = 0;
        $staticFetcher = fn () => ['ok' => true, 'code' => 200, 'error' => '', 'url' => 'u', 'html' => '<html>fallback</html>', 'mode' => 'static'];
        $renderFetcher = function () use (&$renderHit) {
            $renderHit++;
            return ['ok' => false, 'code' => 503, 'error' => 'busy', 'url' => 'u', 'html' => '', 'mode' => 'render'];
        };

        $r = SmartFetcher::get('https://example.com/', 25, [], 'js', [], $staticFetcher, $renderFetcher);

        $this->assertSame(1, $renderHit, 'در حالت js اول رندر تلاش شود');
        $this->assertSame('static', $r['mode'], 'شکستِ رندر ← ایستا');
        $this->assertSame('busy', $r['render_error'] ?? '');
    }
}
