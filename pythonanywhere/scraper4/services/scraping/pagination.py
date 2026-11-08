"""پورتِ build_page_url_custom() — شاملِ اصلاحِ v10.172:
قالب‌های صفحه‌بندیِ «~page~{page}» و مشابه (~p~{page}، -page-{page}،
پسوندهایی مثل .html) هم پوشش داده می‌شوند.

انواعِ پشتیبانی‌شده (همان pagType رابطِ قدیمی):
  query_page    → ?page=N روی URL فعلی
  query_custom  → ?<param>=N روی URL فعلی (پیش‌فرض param=paged)
  path_pattern  → الگوی مسیر مثل /page/{page}/ یا ~page~{page}
  full_pattern  → الگوی کاملِ URL (هرجایش {page})
  next_selector → توسط مصرف‌کننده/استریم مدیریت می‌شود (اینجا پاس می‌شود)
"""
from __future__ import annotations

import re
from urllib.parse import parse_qs, urlencode, urlsplit

QUERY_PAGE = "query_page"
QUERY_CUSTOM = "query_custom"
PATH_PATTERN = "path_pattern"
FULL_PATTERN = "full_pattern"
NEXT_SELECTOR = "next_selector"

TYPES = (QUERY_PAGE, QUERY_CUSTOM, PATH_PATTERN, FULL_PATTERN, NEXT_SELECTOR)

_LEGACY_PAGE_RE = re.compile(r"/page/\d+/?$", re.IGNORECASE)


def _query_base(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme or 'https'}://{parts.netloc.split('@')[-1] or ''}{parts.path or '/'}"


def build(current_url: str, base_url: str, page: int, pag_type: str = QUERY_PAGE,
          val: str = "") -> str:
    page = int(page)

    if pag_type == QUERY_CUSTOM:
        param = val or "paged"
        parts = urlsplit(current_url)
        if not parts.netloc and not parts.path:
            return current_url
        base = f"{parts.scheme or 'https'}://{parts.hostname or ''}{parts.path or '/'}"
        if parts.port:
            base = f"{parts.scheme or 'https'}://{parts.hostname}:{parts.port}{parts.path or '/'}"
        query = {k: v[0] for k, v in parse_qs(parts.query, keep_blank_values=True).items()}
        query[param] = str(page)
        return base + "?" + urlencode(query)

    if pag_type == PATH_PATTERN:
        pattern = val or "/page/{page}/"
        replacement = pattern.replace("{page}", str(page))
        parts = urlsplit(base_url)
        root = f"{parts.scheme or 'https'}://{parts.hostname or ''}"
        base_path = (parts.path or "/").rstrip("/")

        # v10.172: نشانهٔ صفحهٔ فعلی بر اساسِ خودِ الگو پاک می‌شود، نه فقط
        # شکلِ کلاسیکِ /page/N. متنِ ثابتِ قبل و بعدِ {page} به‌عنوانِ
        # پیشوند/پسوندِ الگو برداشته می‌شود و اگر انتهای مسیرِ پایه
        # «پیشوند + عدد (+ پسوند)» باشد حذف می‌شود؛ پس قالب‌هایی مثل
        # ~page~{page} هم کار می‌کنند و نشانه‌ها روی هم انباشته نمی‌شوند.
        token_pos = pattern.find("{page}")
        if token_pos != -1:
            prefix_raw = pattern[:token_pos]
            suffix_raw = pattern[token_pos + len("{page}"):]
            if prefix_raw:
                suffix_trim = suffix_raw.rstrip("/")
                suffix_part = (re.escape(suffix_trim) if suffix_trim else "") + (
                    "/?" if (suffix_raw == "" or suffix_raw.endswith("/")) else ""
                )
                base_path = re.sub(
                    re.escape(prefix_raw) + r"\d+" + suffix_part + r"$",
                    "", base_path, flags=re.IGNORECASE,
                )

        base_path = _LEGACY_PAGE_RE.sub("", base_path)
        base_path = base_path.rstrip("/")
        # ریشهٔ دامنه + الگوی بدونِ اسلشِ آغازین (مثل ~page~{page})
        if base_path == "" and replacement and not replacement.startswith("/"):
            base_path = "/"
        return root + base_path + replacement

    if pag_type == FULL_PATTERN:
        return pattern_replace(val, page)

    # query_page (پیش‌فرض)
    parts = urlsplit(current_url)
    if not parts.netloc and not parts.path:
        return current_url
    base = f"{parts.scheme or 'https'}://{parts.hostname or ''}{parts.path or '/'}"
    if parts.port:
        base = f"{parts.scheme or 'https'}://{parts.hostname}:{parts.port}{parts.path or '/'}"
    query = {k: v[0] for k, v in parse_qs(parts.query, keep_blank_values=True).items()}
    query["page"] = str(page)
    return base + "?" + urlencode(query)


def pattern_replace(pattern: str, page: int) -> str:
    return (pattern or "").replace("{page}", str(page))


def build_urls(url: str, pag_type: str, val: str, pages: int) -> list[str]:
    """فهرستِ URLها برای پیش‌نمایش/استخراج؛ صفحهٔ اول همیشه خودِ URL است."""
    urls = []
    for p in range(1, max(1, int(pages)) + 1):
        urls.append(url if p == 1 else build(url, url, p, pag_type, val))
    return urls


PaginationUrlBuilder = build
