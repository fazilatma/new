<?php

use App\Http\Controllers\Api\PaginationPreviewController;
use App\Http\Controllers\Api\ScrapeStreamController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API — فاز ۱ مهاجرت
|--------------------------------------------------------------------------
| این‌ها برش‌های «کامل و تست‌شده» هستند؛ بقیهٔ ویژگی‌ها فعلاً از اپلیکیشنِ
| قدیمی (scraper4.php روی پورت ۸۰۰۰ با server.sh) می‌آیند تا نوبتشان برسد.
*/

// اسکریپِ زنده با SSE (پورتِ ?stream=1)
Route::get('/scrape/stream', ScrapeStreamController::class)->name('api.scrape.stream');

// پیش‌نمایشِ URLهای صفحه‌بندی برای هر الگو (از جمله ~page~{page})
Route::get('/pagination/preview', PaginationPreviewController::class)->name('api.pagination.preview');

// سلامت
Route::get('/ping', fn () => response()->json(['ok' => true, 'app' => 'scraper4-laravel', 'ts' => now()->toIso8601String()]));
