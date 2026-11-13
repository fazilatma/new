<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>scraper4 — نسخهٔ لاراول</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: Tahoma, sans-serif; }
        body { background: #0f172a; color: #e2e8f0; min-height: 100vh; padding: 24px; }
        h1 { font-size: 20px; margin-bottom: 4px; }
        .sub { color: #94a3b8; font-size: 12px; margin-bottom: 20px; }
        .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 28px; }
        .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 16px; }
        .card b { display: block; font-size: 26px; color: #38bdf8; }
        .card span { font-size: 12px; color: #94a3b8; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th, td { padding: 8px 10px; border-bottom: 1px solid #334155; text-align: right; }
        th { color: #94a3b8; font-weight: normal; }
        .badge { background: #14532d; color: #86efac; padding: 2px 8px; border-radius: 999px; font-size: 11px; }
        .badge.off { background: #7f1d1d; color: #fca5a5; }
        code { background: #0b1220; padding: 2px 6px; border-radius: 6px; direction: ltr; display: inline-block; }
        .note { margin-top: 24px; font-size: 12px; color: #94a3b8; line-height: 1.9; }
    </style>
</head>
<body>
    <h1>🛰 scraper4 — داشبورد لاراول (فاز ۱ مهاجرت)</h1>
    <div class="sub">برش‌های کامل از اینجا سرو می‌شوند؛ بقیهٔ ویژگی‌ها فعلاً از اپلیکیشنِ قدیمی می‌آیند:
        <code>{{ $legacyPath }}</code></div>

    <div class="cards">
        <div class="card"><b>{{ number_format($profiles->count()) }}</b><span>پروفایلِ سایت مبدأ</span></div>
        <div class="card"><b>{{ number_format($productsTotal) }}</b><span>محصولِ ذخیره‌شده</span></div>
        <div class="card"><b>{{ number_format($queueAlive) }}</b><span>ردیفِ صفِ فعال</span></div>
    </div>

    <table>
        <thead>
            <tr><th>نام</th><th>آدرس</th><th>صفحه‌بندی</th><th>محصولات</th><th>وضعیت</th></tr>
        </thead>
        <tbody>
        @forelse($profiles as $p)
            <tr>
                <td>{{ $p->name !== '' ? $p->name : '—' }}</td>
                <td style="direction:ltr;text-align:left">{{ $p->url }}</td>
                <td><code>{{ $p->paginationType() }}{{ $p->paginationVal() !== '' ? ' · '.$p->paginationVal() : '' }}</code></td>
                <td>{{ number_format($p->products_count) }}</td>
                <td>{!! $p->enabled ? '<span class="badge">فعال</span>' : '<span class="badge off">خاموش</span>' !!}</td>
            </tr>
        @empty
            <tr><td colspan="5">هنوز پروفایلی نیست — با <code>php artisan scraper:import-legacy</code> وضعیتِ قدیمی را وارد کنید.</td></tr>
        @endforelse
        </tbody>
    </table>

    <div class="note">
        • اسکریپِ زنده: <code>GET /api/scrape/stream?url=…&pages=5&pagType=path_pattern&pagVal=~page~{page}</code><br>
        • پیش‌نمایشِ صفحه‌بندی: <code>GET /api/pagination/preview?url=…&type=path_pattern&val=~page~{page}&pages=3</code><br>
        • سلامت: <code>GET /api/ping</code> — راهنمای کامل: <code>laravel/README.md</code>
    </div>
</body>
</html>
