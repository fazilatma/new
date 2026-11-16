<?php

namespace App\Services\WooCommerce;

use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

/**
 * کلاینتِ REST ووکامرس — پورتِ wooReq از scraper4.php
 * (basic-auth با consumer key/secret روی /wp-json/wc/v3/)
 *
 * همهٔ متدها خروجیِ یک‌دست برمی‌گردانند:
 *   ['ok'=>bool,'code'=>int,'error'=>string,'body'=>?array,'raw'=>string]
 */
class WooClient
{
    protected string $base;

    public function __construct(
        string $storeUrl,
        protected string $consumerKey,
        protected string $consumerSecret,
        protected int $timeout = 60
    ) {
        $this->base = rtrim($storeUrl, '/') . '/wp-json/wc/v3/';
    }

    public static function fromConnection(array $cfg): self
    {
        return new self(
            (string) ($cfg['store_url'] ?? ''),
            (string) ($cfg['consumer_key'] ?? ''),
            (string) ($cfg['consumer_secret'] ?? '')
        );
    }

    /** معادلِ wooReq */
    public function request(string $method, string $endpoint, mixed $data = null): array
    {
        $url = $this->base . ltrim($endpoint, '/');
        try {
            $req = Http::acceptJson()
                ->asJson()
                ->withBasicAuth($this->consumerKey, $this->consumerSecret)
                ->connectTimeout(8)
                ->timeout($this->timeout)
                ->withoutVerifying();
            $response = $req->send(strtoupper($method), $url, $data === null ? [] : ['json' => $data]);
        } catch (\Throwable $e) {
            return ['ok' => false, 'code' => 0, 'error' => $e->getMessage(), 'body' => null, 'raw' => ''];
        }
        return $this->shape($response);
    }

    /** @return array{ok:bool,code:int,error:string,body:?array,raw:string} */
    protected function shape(Response $r): array
    {
        return [
            'ok' => $r->successful(),
            'code' => $r->status(),
            'error' => $r->successful() ? '' : mb_substr($r->body(), 0, 300),
            'body' => $r->json() ?: null,
            'raw' => $r->body(),
        ];
    }

    // ------------------------------------------------------------------ API

    /** تست اتصال — محصول + وضعیت محیط برای نمایشِ نسخهٔ WC (مثل «تست ووکامرس») */
    public function testConnection(): array
    {
        $r = $this->request('GET', 'products?per_page=1');
        if (!$r['ok']) {
            return $r;
        }
        $version = '?';
        $env = $this->request('GET', 'system_status');
        if ($env['ok'] && isset($env['body']['environment']['version'])) {
            $version = (string) $env['body']['environment']['version'];
        }
        $r['body'] = array_merge((array) $r['body'], ['woocommerce_version' => $version]);
        return $r;
    }

    public function listProducts(int $page = 1, int $perPage = 20, array $query = []): array
    {
        $q = array_merge(['page' => $page, 'per_page' => $perPage], $query);
        return $this->request('GET', 'products?' . http_build_query($q));
    }

    public function getProduct(int|string $id): array
    {
        return $this->request('GET', 'products/' . $id);
    }

    public function createProduct(array $payload): array
    {
        return $this->request('POST', 'products', $payload);
    }

    public function updateProduct(int|string $id, array $fields): array
    {
        return $this->request('PUT', 'products/' . $id, $fields);
    }

    /** حذفِ همیشگی (همان ?force=true که «اقدامِ بازنشستگیِ» ووکامرس استفاده می‌کند) */
    public function deleteProduct(int|string $id, bool $force = true): array
    {
        return $this->request('DELETE', 'products/' . $id . ($force ? '?force=true' : ''));
    }

    /** ارسالِ دسته‌ای — POST products/batch (تا ۱۰۰ رکورد در هر درخواست) */
    public function batchProducts(array $create = [], array $update = [], array $delete = []): array
    {
        $payload = [];
        if ($create) $payload['create'] = $create;
        if ($update) $payload['update'] = $update;
        if ($delete) $payload['delete'] = $delete;
        return $this->request('POST', 'products/batch', $payload);
    }

    public function categories(int $perPage = 100): array
    {
        return $this->request('GET', 'products/categories?per_page=' . $perPage);
    }
}
