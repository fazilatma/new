<?php

namespace Tests\Unit;

use App\Services\Scraping\CssToXpath;
use PHPUnit\Framework\TestCase;

/** قراردادِ خروجی باید عیناً با cssToXpath قدیمی یکی باشد */
class CssToXpathTest extends TestCase
{
    /**
     * @dataProvider selectors
     */
    public function test_conversion(string $css, bool $strict, string $expected): void
    {
        $this->assertSame($expected, CssToXpath::convert($css, $strict));
    }

    public static function selectors(): array
    {
        return [
            // هر ردیف: [css, strictClass, xpath منتظر]
            ['.product', false, "//*[contains(@class,'product')]"],
            ['.product', true, "//*[contains(concat(' ',normalize-space(@class),' '),' product ')]"],
            ['div.product', false, "//div[contains(@class,'product')]"],
            ['div.item > a[href]', false, "//div[contains(@class,'item')]/a[@href]"],
            ['#main', false, "//*[@id='main']"],
            ['article.product-card h2.title, .price', false,
                "//article[contains(@class,'product-card')]//h2[contains(@class,'title')] | //*[contains(@class,'price')]"],
            ['li:nth-child(2)', false, "//li[count(preceding-sibling::*)=1]"],
            ['a:first-child', false, "//a[count(preceding-sibling::*)=0]"],
            ['ul li:last-child a', false, "//ul//li[count(following-sibling::*)=0]//a"],
            ['a[title*="xyz"]', false, "//a[contains(@title,'xyz')]"],
            ['a[href^="/p/"]', false, "//a[starts-with(@href,'/p/')]"],
            ['a[title$=".jpg"]', false, "//a[substring(@title,string-length(@title)-3)='.jpg']"],
            ['div#main.item[data-x="1"]', false, "//div[@id='main' and contains(@class,'item') and @data-x='1']"],
            ['div p span', false, "//div//p//span"],
            ['*', false, '//*'],

            // ترکیب‌گرهای + و ~ پشتیبانی نمی‌شوند ⇒ رشتهٔ خالی
            ['div + span', false, ''],
            ['a ~ b', false, ''],

            // ورودی خراب ⇒ خالی
            ['', false, ''],
            ['div[', false, ''],
        ];
    }
}
