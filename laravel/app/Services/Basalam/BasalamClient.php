<?php

namespace App\Services\Basalam;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

/**
 * کلاینتِ لاراولیِ باسلام — پورتِ bslReq/bslReqRead/bslCurlOpts از scraper4.php
 *
 *  • همان اندپوینت‌های تأییدشدهٔ نسخهٔ قدیمی (openapi.basalam.com/v1)
 *  • همان معنای تلاشِ دوباره (فقط خطای شبکه) و زنجیرهٔ روش‌ها (اینجا: پروکسی)
 *  • «سیگنالِ توقف» در دنیای لاراول = فلگِ Cache با TTL (معادلِ فایلِ ایمن
 *    bsl_stop_signal.json + BSL_STOP_HOLD_SEC)؛ بسته شدنِ نسخهٔ قدیمی دست‌نخورده می‌ماند
 *  • خواندنی‌ها (read) سیگنالِ توقف را — دقیقاً مثل bslReqRead — نادیده می‌گیرند
 *
 * همهٔ متدها خروجیِ یک‌دست برمی‌گردانند:
 *   ['ok'=>bool,'code'=>int,'error'=>string,'body'=>?array,'raw'=>string]
 */
class BasalamClient
{
    /** ثانیه — اعتبار سیگنالِ توقف (معادل BSL_STOP_HOLD_SEC) */
    public const STOP_HOLD_SEC = 900;

    protected string $apiBase;
    protected int $timeout;
    protected ?string $proxy;

    public function __construct(
        protected string $token,
        array $options = []
    ) {
        $base = trim((string) ($options['api_base'] ?? config('scraper.basalam.api_base')));
        if ($base === '' || !preg_match('~^https?://~i', $base)) {
            $base = 'https://openapi.basalam.com/v1/';
        }
        $this->apiBase = rtrim($base, '/') . '/';
        $this->timeout = (int) ($options['timeout'] ?? 30);
        $proxy = trim((string) ($options['proxy'] ?? ''));
        $this->proxy = $proxy !== '' ? $proxy : null;
    }

    /** ساخت از روی رکوردِ اتصال‌ها (همان ساختار connections.json قدیمی) */
    public static function fromConnection(array $basalamConfig): self
    {
        return new self(
            (string) ($basalamConfig['token'] ?? ''),
            [
                'api_base' => $basalamConfig['api_base'] ?? null,
                'proxy' => ($basalamConfig['net_indirect'] ?? false) ? ($basalamConfig['proxy'] ?? '') : '',
            ]
        );
    }

    // ------------------------------------------------------------------ قفل

    public static function stopSignalSet(): void
    {
        Cache::put('basalam:stop', time(), self::STOP_HOLD_SEC);
    }

    public static function stopSignalClear(): void
    {
        Cache::forget('basalam:stop');
    }

    protected static function stopped(): bool
    {
        return Cache::has('basalam:stop');
    }

    // ------------------------------------------------------------------ هسته

    protected function http(): PendingRequest
    {
        $req = Http::acceptJson()
            ->withToken($this->token)
            ->connectTimeout(10)
            ->timeout($this->timeout)
            ->withoutVerifying();
        if ($this->proxy !== null) {
            $req = $req->withOptions(['proxy' => $this->proxy]);
        }
        return $req;
    }

    /**
     * معادلِ bslReq — فقط خطای شبکه دوباره تلاش می‌شود (تا maxAttempts بار)،
     * و قبل از شروع، سیگنالِ توقف «تازه» دیده می‌شود (قدیمی پاک و نادیده گرفته می‌شود).
     *
     * @param array|string|null $data  بدنه (mp=true: بدنهٔ خام multipart)
     * @return array{ok:bool,code:int,error:string,body:?array,raw:string}
     */
    public function request(string $method, string $endpoint, array|string|null $data = null, bool $multipart = false, int $maxAttempts = 3, bool $skipStop = false): array
    {
        if (!$skipStop && self::stopped()) {
            return ['ok' => false, 'code' => 0, 'error' => 'stopped', 'body' => null, 'raw' => ''];
        }

        $url = $this->apiBase . ltrim($endpoint, '/');
        $method = strtoupper($method);
        $last = ['ok' => false, 'code' => 0, 'error' => 'هیچ روشی اجرا نشد', 'body' => null, 'raw' => ''];

        for ($attempt = 1; $attempt <= max(1, $maxAttempts); $attempt++) {
            try {
                $req = $this->http();
                if ($multipart) {
                    // $data: ['file' => path|CURLFile, 'file_type' => 'product.photo']
                    $fields = [];
                    foreach ((array) $data as $k => $v) {
                        if ($v instanceof \CURLFile) {
                            $fields[$k] = fopen($v->getFilename(), 'r');
                        } else {
                            $fields[$k] = $v;
                        }
                    }
                    $response = $req->asMultipart();
                    foreach ($fields as $k => $v) {
                        // گذرِ فیلدها یکی‌یکی تا فایل و متن قاطی نشود
                        $response = is_resource($v)
                            ? $response->attach($k, $v, basename(stream_get_meta_data($v)['uri'] ?? 'upload'))
                            : $response->attach($k, (string) $v);
                    }
                    $response = $response->send($method, $url);
                } else {
                    $response = $req->asJson()->send($method, $url, $data === null ? [] : ['json' => $data]);
                }
            } catch (\Throwable $e) {
                $last = ['ok' => false, 'code' => 0, 'error' => $e->getMessage(), 'body' => null, 'raw' => ''];
                if ($attempt < $maxAttempts) {
                    sleep(3);   // فقط خطای شبکه → تلاشِ دوباره (مثل نسخهٔ قدیمی)
                }
                continue;
            }

            $last = $this->shape($response);
            if ($last['code'] > 0) {
                break;  // پاسخ گرفته شد (موفق یا خطای منطقی) — دوباره نمی‌زنیم
            }
        }

        return $last;
    }

    /** معادلِ bslReqRead — خواندنی‌ها سیگنالِ توقف را نمی‌بینند */
    public function read(string $endpoint, int $maxAttempts = 3): array
    {
        return $this->request('GET', $endpoint, null, false, $maxAttempts, true);
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

    /** تست اتصال + شناسایی غرفه‌ها — همان طرفیتِ «تست تنظیمات غرفه» */
    public function boothInfo(): array
    {
        return $this->read('vendors/me', 1);
    }

    /** فهرست محصولاتِ غرفه (صفحه‌بندیِ ۱۰۰تایی مثل نسخهٔ قدیمی) */
    public function vendorProducts(int|string $vendorId, int $page = 1, int $perPage = 100, array $statuses = []): array
    {
        $q = 'vendors/' . $vendorId . '/products?per_page=' . $perPage . '&page=' . $page;
        foreach ($statuses as $s) {
            $q .= '&statuses=' . (int) $s;
        }
        return $this->read($q);
    }

    /** یک محصولِ غرفه */
    public function vendorProduct(int|string $vendorId, int|string $productId): array
    {
        return $this->read('vendors/' . $vendorId . '/products/' . $productId);
    }

    /** جست‌وجوی محصول (همان products/search) */
    public function searchProducts(string $query = '', int $perPage = 20): array
    {
        return $this->request('POST', 'products/search', ['query' => $query, 'per_page' => $perPage]);
    }

    /** ساخت محصول در غرفه — POST vendors/{vid}/products */
    public function createProduct(int|string $vendorId, array $payload): array
    {
        return $this->request('POST', 'vendors/' . $vendorId . '/products', $payload);
    }

    /**
     * به‌روزرسانی محصول — PATCH products/{id} و در صورت 404،
     * PATCH vendors/{vid}/products/{id} (همان ترتیبِ نسخهٔ قدیمی)
     */
    public function updateProduct(int|string $productId, array $fields, int|string|null $vendorId = null): array
    {
        $r = $this->request('PATCH', 'products/' . $productId, $fields);
        if ($r['code'] === 404 && $vendorId !== null && $vendorId !== '') {
            $r = $this->request('PATCH', 'vendors/' . $vendorId . '/products/' . $productId, $fields);
        }
        return $r;
    }

    /** آپلود عکس — POST files (multipart، file_type=product.photo) */
    public function uploadPhoto(string $absolutePath): array
    {
        if (!is_file($absolutePath)) {
            return ['ok' => false, 'code' => 0, 'error' => 'file not found: ' . $absolutePath, 'body' => null, 'raw' => ''];
        }
        return $this->request('POST', 'files', [
            'file' => new \CURLFile($absolutePath),
            'file_type' => 'product.photo',
        ], true);
    }

    /** ارسال پیام به گفت‌وگو — POST chats/{id}/messages */
    public function sendChatMessage(int|string $chatId, array $body): array
    {
        return $this->request('POST', 'chats/' . $chatId . '/messages', $body);
    }

    /** درختِ دسته‌ها با کشِ TTL (همان bslCatsAll + BSL_CATS_TTL) */
    public function categoriesAll(int $ttlSeconds = 86400): array
    {
        return Cache::remember('basalam:categories', $ttlSeconds, function () {
            $r = $this->read('categories');
            return $r['ok'] && is_array($r['body']) ? $r['body'] : [];
        });
    }
}
