<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * پروفایلِ سایت مبدأ — معادلِ رکوردهای profiles.json
 *  selectors:  ['container','title','price','link','image', ...فیلدهای جزئیات]
 *  pagination: ['type'=>pagType, 'val'=>pagVal]
 *  gallery/detail/settings: تنظیماتِ استخراجِ تکمیلی
 */
class Profile extends Model
{
    use HasFactory;

    protected $fillable = [
        'key', 'name', 'url',
        'selectors', 'pagination', 'settings',
        'products_count', 'last_scraped_at', 'enabled',
    ];

    protected function casts(): array
    {
        return [
            'selectors' => 'array',
            'pagination' => 'array',
            'settings' => 'array',
            'enabled' => 'boolean',
            'last_scraped_at' => 'datetime',
            'products_count' => 'integer',
        ];
    }

    public function products()
    {
        return $this->hasMany(Product::class);
    }

    /** پارامترهای صفحه‌بندی با پیش‌فرضِ امن */
    public function paginationType(): string
    {
        return (string) ($this->pagination['type'] ?? 'query_page');
    }

    public function paginationVal(): string
    {
        return (string) ($this->pagination['val'] ?? '');
    }
}
