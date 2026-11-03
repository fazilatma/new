"""Stable product identity function corresponding to scraper4.php productKey()."""
from __future__ import annotations

import hashlib
import re


def _php_empty(value: object) -> bool:
    return value is None or value is False or value == 0 or value == 0.0 or value == "" or value == "0" or value == [] or value == {}


def product_key(product: dict) -> str:
    link_value = product.get("link", "")
    if not _php_empty(link_value):
        url = re.sub(r"[?#].*$", "", str(link_value)).rstrip("/")
        source = "url:" + url
    else:
        title_value = product.get("title", "")
        price_value = product.get("price", "")
        title = "" if title_value is None else str(title_value)
        price = "" if price_value is None else str(price_value)
        title = re.sub(r"\s+", " ", title.strip().lower())
        source = "title:" + title + "|" + price
    return hashlib.md5(source.encode("utf-8")).hexdigest()
