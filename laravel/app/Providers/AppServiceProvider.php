<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        // JSON خروجیِ API همیشه یونیکدِ فارسی
        \Illuminate\Support\Facades\App::setLocale('fa');
    }
}
