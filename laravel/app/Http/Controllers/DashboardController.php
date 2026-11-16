<?php

namespace App\Http\Controllers;

use App\Models\Product;
use App\Models\Profile;
use App\Models\QueueEntry;

class DashboardController extends Controller
{
    public function __invoke()
    {
        return view('dashboard', [
            'profiles' => Profile::query()->withCount('products')->latest()->get(),
            'productsTotal' => Product::query()->count(),
            'queueAlive' => QueueEntry::query()->alive()->count(),
            'legacyPath' => config('scraper.legacy_path'),
        ]);
    }
}
