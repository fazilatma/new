<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Symfony\Component\Process\Process;

/**
 * تیکِ دوره‌ای — پلِ Strangler به اپلیکیشنِ قدیمی.
 *
 * تا وقتی همهٔ قابلیت‌ها به لاراول پورت نشده‌اند، چرخهٔ کران همان
 * «php scraper4.php cron_run» است (استخراج دوره‌ای، پمپِ صف، نگهبانِ
 * ادامهٔ کارهای نیمه‌کاره — همه با همان منطقِ اثبات‌شده). بعد از پورتِ
 * هر فاز، اینجا به‌تدریج با dispatch جاب‌های لاراولی جایگزین می‌شود.
 *
 * خاموش‌کردنِ پل: فایلِ قدیمی را جابه‌جا کنید یا SCRAPER_LEGACY_PATH را
 * بیرون بدهید؛ آن‌وقت این فرمان فقط پیام می‌دهد و چیزی اجرا نمی‌کند.
 */
class ScraperTickCommand extends Command
{
    protected $signature = 'scraper:tick {--once : فقط یک تیک (پیش‌فرضِ artisan call هم همین است)}';
    protected $description = 'تیکِ دوره‌ایِ scraper4 (پل به کرانِ قدیمی تا پایانِ مهاجرت)';

    public function handle(): int
    {
        $legacy = (string) config('scraper.legacy_path');
        $workingDir = (string) config('scraper.legacy_dir');

        if (!is_file($legacy)) {
            $this->warn("نسخهٔ قدیمی پیدا نشد ({$legacy}) — تیک رد شد. جاب‌های لاراولی خودشان با زمان‌بند اجرا می‌شوند.");
            return self::SUCCESS;
        }

        $process = new Process(
            [PHP_BINARY, $legacy, 'cron_run'],
            cwd: is_dir($workingDir) ? $workingDir : null,
            timeout: 0     // کارِ کران هرقدر لازم باشد طول می‌کشد — مثل نسخهٔ قدیمی
        );
        $process->run(function ($type, $buffer) {
            $this->output->write($buffer);
        });

        $code = $process->getExitCode() ?? 0;
        if ($code !== 0) {
            $this->error("cronِ قدیمی با کد {$code} خارج شد");
            return self::FAILURE;
        }

        $this->info('تیک انجام شد.');
        return self::SUCCESS;
    }
}
