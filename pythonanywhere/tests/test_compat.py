import unittest

from scraper4_port.compat.pagination import (
    FULL_PATTERN,
    PATH_PATTERN,
    QUERY_CUSTOM,
    build_page_url_custom,
)
from scraper4_port.compat.product_key import product_key
from scraper4_port.compat.text import (
    extract_price,
    extract_price_num,
    normalize_html,
    normalize_text,
    persian_to_english,
)
from scraper4_port.compat.urls import make_absolute_url, profile_key, url_is_image


class PaginationParityTests(unittest.TestCase):
    def test_tilde_pattern_appends_to_path(self):
        self.assertEqual(
            "https://t.test/shop~page~2",
            build_page_url_custom("https://t.test/shop", "https://t.test/shop", 2, PATH_PATTERN, "~page~{page}"),
        )

    def test_marker_is_replaced_not_stacked(self):
        self.assertEqual(
            "https://t.test/shop~page~3",
            build_page_url_custom("https://t.test/shop~page~2", "https://t.test/shop~page~2", 3, PATH_PATTERN, "~page~{page}"),
        )

    def test_separators_and_suffixes(self):
        self.assertEqual("https://t.test/cat~p~5", build_page_url_custom("", "https://t.test/cat~p~4", 5, PATH_PATTERN, "~p~{page}"))
        self.assertEqual("https://t.test/cat-page-5", build_page_url_custom("", "https://t.test/cat-page-4", 5, PATH_PATTERN, "-page-{page}"))
        self.assertEqual("https://t.test/shop~page~4.html", build_page_url_custom("", "https://t.test/shop~page~2.html", 4, PATH_PATTERN, "~page~{page}.html"))

    def test_classic_and_root_patterns(self):
        self.assertEqual("https://t.test/shop/page/3/", build_page_url_custom("", "https://t.test/shop/page/2/", 3, PATH_PATTERN, "/page/{page}/"))
        self.assertEqual("https://t.test/shop/page/2/", build_page_url_custom("", "https://t.test/shop", 2, PATH_PATTERN, "/page/{page}/"))
        self.assertEqual("https://t.test/~page~2", build_page_url_custom("", "https://t.test/", 2, PATH_PATTERN, "~page~{page}"))

    def test_full_pattern_and_marker_cleanup(self):
        self.assertEqual("https://t.test/shop~page~7", build_page_url_custom("", "", 7, FULL_PATTERN, "https://t.test/shop~page~{page}"))
        self.assertEqual("https://t.test/shop~page~9", build_page_url_custom("", "https://t.test/shop~PAGE~8", 9, PATH_PATTERN, "~page~{page}"))
        self.assertEqual("https://t.test/shop~page~13", build_page_url_custom("", "https://t.test/shop/page/9", 13, PATH_PATTERN, "~page~{page}"))
        self.assertEqual("https://t.test/shop~pro~3~p~4", build_page_url_custom("", "https://t.test/shop~pro~3", 4, PATH_PATTERN, "~p~{page}"))

    def test_query_variants(self):
        self.assertEqual("https://t.test/search/?page=3", build_page_url_custom("https://t.test/search/?page=1", "", 3, QUERY_CUSTOM, "page"))
        self.assertEqual("https://t.test/shop/?paged=4", build_page_url_custom("https://t.test/shop/", "", 4, QUERY_CUSTOM, ""))
        self.assertEqual("https://t.test/shop/?page=5", build_page_url_custom("https://t.test/shop/", "", 5))


class TextParityTests(unittest.TestCase):
    def test_digits_and_normalizers(self):
        self.assertEqual("0123456789", persian_to_english("۰۱۲۳۴۵۶۷۸۹"))
        self.assertEqual("0123456789", persian_to_english("٠١٢٣٤٥٦٧٨٩"))
        self.assertEqual("A & B", normalize_text("  A&nbsp; &amp;  B  "))
        self.assertEqual("x y", normalize_html("x<script>bad()</script><style>bad</style> y"))

    def test_iranian_and_foreign_prices(self):
        self.assertEqual("۱۲۳٬۴۵۶ تومان", extract_price("قیمت: ۱۲۳٬۴۵۶ تومان"))
        self.assertEqual("۱۲۳,۴۵۶ تومان", extract_price("قیمت ۱۲۳,۴۵۶"))
        self.assertEqual("€9,99", extract_price("Sale €9,99"))
        self.assertEqual("1,299 USD", extract_price("1,299 USD"))
        self.assertEqual("", extract_price("بدون قیمت"))
        self.assertEqual(123456, extract_price_num("۱۲۳٬۴۵۶ تومان"))


class IdentityParityTests(unittest.TestCase):
    def test_url_helpers(self):
        self.assertEqual("https://shop.test/a/image.png", make_absolute_url("/a/image.png", "https://shop.test/list/1"))
        self.assertEqual("https://shop.test/list/image.png", make_absolute_url("image.png", "https://shop.test/list/1"))
        self.assertEqual("", make_absolute_url("javascript:alert(1)", "https://shop.test/"))
        self.assertFalse(url_is_image("https://cdn.test/no-image.png"))
        self.assertTrue(url_is_image("https://cdn.test/p/123.png"))

    def test_profile_and_product_keys(self):
        self.assertEqual("shop.test_category", profile_key("https://shop.test/category.html"))
        self.assertEqual(product_key({"link": "https://shop.test/p/1?x=1"}), product_key({"link": "https://shop.test/p/1#part"}))
        self.assertEqual(product_key({"title": "  Red   Shoe ", "price": "100"}), product_key({"title": "red shoe", "price": "100"}))


if __name__ == "__main__":
    unittest.main()
