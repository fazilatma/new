<?php

use Illuminate\Support\Facades\Schedule;

/*
|--------------------------------------------------------------------------
| زمان‌بند — جای کران‌جابِ سیستم
|--------------------------------------------------------------------------
| «php artisan schedule:run» هر دقیقه اجرا شود (در حالتِ سرور با
| server.sh و SCRAPER_CRON_TICK این همان تیکِ همیشه‌زنده است؛ مستقل از
| کرانِ سیستم هم می‌توانید schedule:work را تحتِ سوپروایزر اجرا کنید).
*/

// تیکِ اپ: تا زمانِ مهاجرتِ کامل، چرخهٔ کرانِ نسخهٔ قدیمی را صدا می‌زند
Schedule::command('scraper:tick')->everyMinute()->withoutOverlapping(5);

// نگهبان: کارهای قفل‌مانده را بیابد و برگرداند (فاز ۲ به‌صورت کامل می‌آید)
Schedule::command('queue:restart')->hourly()->when(fn () => config('queue.default') === 'database');
