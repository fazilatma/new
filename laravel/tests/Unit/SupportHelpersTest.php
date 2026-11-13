<?php

namespace Tests\Unit;

use App\Services\Scraping\ProductKey;
use App\Services\Support\Persian;
use App\Services\Support\Url;
use PHPUnit\Framework\TestCase;

/** قراردادِ توابع کمکی — همان رفتارِ توابع global قدیمی */
class SupportHelpersTest extends TestCase
{
    public function test_fa_digits(): void
    {
        $this->assertSame('12345678900123456789', Persian::faDigitsToEn('۱۲۳۴۵۶۷۸۹۰٠١٢٣٤٥٦٧٨٩'));
    }

    public function test_price_with_unit_prefers_longest(): void
    {
        $this->assertSame('۱۲,۵۰۰', Persian::price('قیمت: ۱۲,۵۰۰ تومان تخفیف: ۱۰۰۰ تومان'));
        $this->assertSame('1,200,000', Persian::price('1,200,000 ریال'));
    }

    public function test_price_fallbacks(): void
    {
        $this->assertSame('۵۰۰,۰۰۰', Persian::price('فقط ۵۰۰,۰۰۰'));
        $this->assertSame('1250000', Persian::price('1250000'));
        $this->assertSame('', Persian::price('بدون عدد'));
    }

    public function test_price_num(): void
    {
        $this->assertSame(12500, Persian::priceNum('۱۲,۵۰۰ تومان'));
        $this->assertSame(0, Persian::priceNum('ناموجود'));
    }

    public function test_absolute_url(): void
    {
        $this->assertSame('https://a.ir/x/y', Url::absolute('/x/y', 'https://a.ir/shop'));
        $this->assertSame('https://a.ir/shop/x', Url::absolute('x', 'https://a.ir/shop/list.html'));
        $this->assertSame('https://cdn.ir/i.png', Url::absolute('//cdn.ir/i.png', 'http://a.ir/'));
        $this->assertSame('', Url::absolute('#fragment', 'https://a.ir/'));
        $this->assertSame('https://a.ir/p?x=1', Url::absolute('https://a.ir/p?x=1', 'https://a.ir/'));
    }

    public function test_is_image(): void
    {
        $this->assertTrue(Url::isImage('https://a.ir/i.jpg'));
        $this->assertFalse(Url::isImage('https://a.ir/placeholder.png'));
        $this->assertFalse(Url::isImage('data:image/png;base64,x'));
    }

    public function test_profile_key_strips_page_and_ext(): void
    {
        $this->assertSame('shop.ir_category_shoes', Url::profileKey('https://shop.ir/category/shoes/page/3/'));
        $this->assertSame('shop.ir_list', Url::profileKey('https://shop.ir/list.html'));
    }

    public function test_product_key(): void
    {
        $a = ProductKey::of(['link' => 'https://a.ir/p/1?utm=x#y']);
        $b = ProductKey::of(['link' => 'https://a.ir/p/1/']);
        $this->assertSame($a, $b, 'کوئری/اسلش نباید کلید را عوض کند');

        $c = ProductKey::of(['title' => 'کفش  ورزشی', 'price' => '۱۰۰']);
        $d = ProductKey::of(['title' => 'کفش ورزشی', 'price' => '۱۰۰']);
        $this->assertSame($c, $d, 'فاصله‌های اضافی یکسان شمرده می‌شوند');
    }
}
