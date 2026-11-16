<?php

namespace Tests\Unit;

use App\Services\Scraping\RenderedFetcher;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class RenderedFetcherTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config()->set('scraper.renderer.url', 'http://render.test:3100');
        config()->set('scraper.renderer.token', 'secret-token');
        config()->set('scraper.renderer.timeout_ms', 60000);
        config()->set('scraper.renderer.wait_until', 'domcontentloaded');
        config()->set('scraper.renderer.scroll', false);
    }

    public function test_success_payload_is_mapped_to_contract(): void
    {
        Http::fake([
            'render.test:3100/render' => Http::response([
                'ok' => true, 'code' => 200,
                'url' => 'https://example.com/final',
                'html' => '<html><body>rendered</body></html>',
                'driver' => 'playwright', 'took_ms' => 1234,
            ], 200),
        ]);

        $r = RenderedFetcher::get('https://example.com/');

        $this->assertTrue($r['ok']);
        $this->assertSame(200, $r['code']);
        $this->assertSame('render', $r['mode']);
        $this->assertSame('playwright', $r['driver']);
        $this->assertSame(1234, $r['took_ms']);
        $this->assertSame('https://example.com/final', $r['url']);
        $this->assertStringContainsString('rendered', $r['html']);

        Http::assertSent(fn ($request) =>
            str_ends_with((string) $request->url(), '/render')
            && $request->hasHeader('Authorization', 'Bearer secret-token')
            && $request['url'] === 'https://example.com/'
            && $request['waitUntil'] === 'domcontentloaded'
        );
    }

    public function test_options_are_forwarded(): void
    {
        Http::fake(['*' => Http::response(['ok' => true, 'code' => 200, 'html' => 'x'], 200)]);

        RenderedFetcher::get('https://example.com/', [
            'selector' => '#products',
            'scroll' => true,
            'blockResources' => true,
        ]);

        Http::assertSent(fn ($request) =>
            $request['selector'] === '#products'
            && $request['scroll'] === true
            && $request['blockResources'] === true
        );
    }

    public function test_service_error_maps_to_failed_contract(): void
    {
        Http::fake([
            '*' => Http::response(['ok' => false, 'error' => 'navigation timeout'], 502),
        ]);

        $r = RenderedFetcher::get('https://example.com/');

        $this->assertFalse($r['ok']);
        $this->assertSame(502, $r['code']);
        $this->assertStringContainsString('timeout', $r['error']);
        $this->assertSame('render', $r['mode']);
    }

    public function test_unreachable_service_is_failed_contract_not_exception(): void
    {
        Http::fake(fn () => Http::response('', 503));

        $r = RenderedFetcher::get('https://example.com/');
        $this->assertFalse($r['ok']);
        $this->assertSame(503, $r['code']);
    }

    public function test_empty_renderer_url_fails_fast(): void
    {
        config()->set('scraper.renderer.url', '');
        $r = RenderedFetcher::get('https://example.com/');
        $this->assertFalse($r['ok']);
        $this->assertStringContainsString('not configured', $r['error']);
    }
}
