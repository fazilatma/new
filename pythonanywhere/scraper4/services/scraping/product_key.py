"""پورتِ productKey() — کلیدِ یکتای محصول برای حذفِ تکراری.

اولویت با لینکِ پاک‌شده (بدونِ query/fragment) است؛ در نبودِ لینک،
عنوانِ نرمال + قیمت.
"""
from __future__ import annotations

import hashlib
import re


def product_key(product: dict) -> str:
    link = str(product.get("link") or "")
    if link:
        url = re.sub(r"[?#].*$", "", link, flags=re.DOTALL).rstrip("/")
        return hashlib.md5(("url:" + url).encode("utf-8")).hexdigest()

    title = str(product.get("title") or "").strip().lower()
    title = re.sub(r"\s+", " ", title)
    price = str(product.get("price") or "")
    return hashlib.md5(("title:" + title + "|" + price).encode("utf-8")).hexdigest()


ProductKey = product_key
