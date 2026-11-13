<?php

namespace App\Console\Commands;

use App\Models\Connection;
use App\Models\Product;
use App\Models\Profile;
use App\Services\Scraping\ProductKey;
use App\Services\Support\Persian;
use App\Services\Support\Url;
use Illuminate\Console\Command;

/**
 * ایمپورتِ یک‌بارهٔ وضعیت از فایل‌های JSONِ نسخهٔ قدیمی به دیتابیسِ لاراول.
 *
 *   php artisan scraper:import-legacy --dir=..
 *
 * خواندنی و ایمن است: فایل‌های قدیمی دست‌نخورده می‌مانند و رکوردها
 * updateOrCreate می‌شوند؛ پس چند بار هم بدون آسیب اجرا می‌شود.
 */
class ImportLegacyStateCommand extends Command
{
    protected $signature = 'scraper:import-legacy {--dir= : پوشهٔ فایل‌های قدیمی (پیش‌فرض legacy_dir)}';
    protected $description = 'واردکردن profiles.json و connections.json قدیمی به دیتابیس';

    public function handle(): int
    {
        $dir = rtrim((string) ($this->option('dir') ?: config('scraper.legacy_dir')), '/');
        $profilesFile = $dir . '/profiles.json';
        $connectionsFile = $dir . '/connections.json';

        $profilesCount = $productsCount = $connectionsCount = 0;

        if (is_file($profilesFile)) {
            $profiles = json_decode((string) file_get_contents($profilesFile), true);
            if (is_array($profiles)) {
                foreach ($profiles as $key => $row) {
                    if (!is_array($row)) {
                        continue;
                    }
                    $url = (string) ($row['url'] ?? '');
                    if ($url === '') {
                        continue;
                    }
                    $profile = Profile::query()->updateOrCreate(
                        ['key' => (string) $key ?: Url::profileKey($url)],
                        [
                            'name' => (string) ($row['name'] ?? ''),
                            'url' => $url,
                            'selectors' => $row['selectors'] ?? null,
                            'pagination' => [
                                'type' => (string) ($row['pagType'] ?? 'query_page'),
                                'val' => (string) ($row['pagVal'] ?? ''),
                            ],
                            'settings' => $row['settings'] ?? ($row['detail'] ?? null),
                            'enabled' => true,
                        ]
                    );
                    $profilesCount++;

                    $n = 0;
                    foreach ((array) ($row['products'] ?? []) as $pkey => $p) {
                        if (!is_array($p)) {
                            continue;
                        }
                        $pkey = is_string($pkey) && strlen($pkey) === 32 ? $pkey : ProductKey::of($p);
                        Product::query()->updateOrCreate(
                            ['profile_id' => $profile->id, 'key' => $pkey],
                            [
                                'title' => (string) ($p['title'] ?? ''),
                                'price' => (string) ($p['price'] ?? ''),
                                'price_num' => Persian::priceNum($p['price'] ?? ''),
                                'link' => (string) ($p['link'] ?? ''),
                                'image' => (string) ($p['image'] ?? ''),
                                'sku' => (string) ($p['sku'] ?? ''),
                                'extra' => array_diff_key($p, array_flip(['title','price','link','image','sku','key'])),
                                'last_seen_at' => now(),
                            ]
                        );
                        $n++;
                    }
                    $profile->update(['products_count' => $n]);
                    $productsCount += $n;
                }
            }
        } else {
            $this->warn("profiles.json پیدا نشد: {$profilesFile}");
        }

        if (is_file($connectionsFile)) {
            $connections = json_decode((string) file_get_contents($connectionsFile), true);
            if (is_array($connections)) {
                foreach ($connections as $name => $cfg) {
                    Connection::putConfig((string) $name, is_array($cfg) ? $cfg : ['value' => $cfg]);
                    $connectionsCount++;
                }
            }
        } else {
            $this->warn("connections.json پیدا نشد: {$connectionsFile}");
        }

        $this->info("✅ {$profilesCount} پروفایل، {$productsCount} محصول، {$connectionsCount} بخشِ اتصال وارد شد.");
        return self::SUCCESS;
    }
}
