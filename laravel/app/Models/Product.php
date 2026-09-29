<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * محصولِ استخراج‌شده — معادلِ products داخل هر پروفایل در نسخهٔ قدیمی.
 * key همان productKey است (url-first سپس title+price).
 * extra هر فیلدِ جزئیاتِ اضافی (sku، برند، تنوع، گالری، توضیح…) را نگه می‌دارد.
 */
class Product extends Model
{
    use HasFactory;

    protected $fillable = [
        'profile_id', 'key', 'title', 'price', 'price_num',
        'link', 'image', 'sku', 'extra', 'basalam_id', 'woo_id',
        'last_seen_at',
    ];

    protected function casts(): array
    {
        return [
            'price_num' => 'integer',
            'extra' => 'array',
            'basalam_id' => 'integer',
            'woo_id' => 'integer',
            'last_seen_at' => 'datetime',
        ];
    }

    public function profile()
    {
        return $this->belongsTo(Profile::class);
    }
}
