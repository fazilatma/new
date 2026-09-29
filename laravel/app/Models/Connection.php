<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * تنظیماتِ اتصال‌ها — جای connections.json
 * name یکی از: basalam / woocommerce / ai / notify / src_net / app
 * config رمزنگاری‌شده در دیتابیس نوشته می‌شود (کلیدها را در no-SQL نگه دارید).
 */
class Connection extends Model
{
    protected $table = 'connections';

    public $timestamps = true;

    protected $fillable = ['name', 'config'];

    protected function casts(): array
    {
        return [
            'config' => 'encrypted:array',
        ];
    }

    public static function getConfig(string $name, array $default = []): array
    {
        $row = static::query()->where('name', $name)->first();
        return $row ? array_merge($default, (array) $row->config) : $default;
    }

    public static function putConfig(string $name, array $config): void
    {
        static::query()->updateOrCreate(['name' => $name], ['config' => $config]);
    }
}
