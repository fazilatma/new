"""Bounded, non-persisting PHP test_selector/testDetailSel adaptation.

One static page only, direct fetch using existing TLS/redirect/private-network
checks. No saved credentials, remote renderer, automatic detail traversal or DB.
"""
from threading import BoundedSemaphore

from lxml import etree

from .scraping.css_to_xpath import css_to_xpath
from .scraping.detail import FIELDS, normalize_selectors, parse_detail, text_html, web_url
from .scraping.fetch import HtmlFetcher, validate_url
from .scraping.parser import (load_dom, query_inside, parse_products,
                              extract_smart_link, _image_from_node)
from .support.persian import normalize_text, price

LIST_FIELDS = ('container', 'title', 'price', 'link', 'image', 'sku')
MAX_PARSE_BYTES = 2 * 1024 * 1024
_GATE = BoundedSemaphore(1)  # per WSGI process, not a distributed rate limiter


def configuration(data):
    if not isinstance(data, dict) or set(data) - {'mode', 'url', 'selectors'}:
        raise ValueError('درخواست آزمایش سلکتور معتبر نیست.')
    mode = data.get('mode')
    if mode not in ('list', 'detail'):
        raise ValueError('نوع آزمایش باید فهرست یا جزئیات باشد.')
    url = data.get('url')
    if not isinstance(url, str) or len(url) > 2048 or any(ord(c) < 32 for c in url):
        raise ValueError('آدرس نمونه معتبر نیست؛ حداکثر ۲۰۴۸ نویسه.')
    url = validate_url(url.strip())
    selectors = data.get('selectors', {})
    allowed = LIST_FIELDS if mode == 'list' else FIELDS
    if not isinstance(selectors, dict) or set(selectors) - set(allowed):
        raise ValueError('نام فیلدهای سلکتور معتبر نیست.')
    if any(not isinstance(v, str) or len(v) > 1000 for v in selectors.values()):
        raise ValueError('هر سلکتور باید متن حداکثر ۱۰۰۰ نویسه باشد.')
    selectors = {k: v.strip() for k, v in selectors.items() if v.strip()}
    if mode == 'detail':
        selectors = normalize_selectors(selectors)
        if not selectors:
            raise ValueError('برای آزمایش جزئیات حداقل یک سلکتور وارد کنید.')
    for field, selector in selectors.items():
        expression = css_to_xpath(selector, True)
        try:
            if not expression:
                raise ValueError()
            etree.XPath(expression)
        except (ValueError, etree.XPathError):
            raise ValueError(f'سلکتور {field} پشتیبانی نمی‌شود؛ ترکیب‌گرهای + و ~ و شبه‌کلاس‌های پیشرفته هنوز منتقل نشده‌اند.') from None
    return mode, url, selectors


def checked_url(value, base):
    return web_url(value, base) if isinstance(value, str) and len(value) <= 2048 else ''


def render(source, base, mode, selectors):
    """Use the same parsers as extraction; return text/URLs, never source HTML."""
    root = load_dom(source)
    fresh = parse_detail(source, base, selectors) if mode == 'detail' else {}
    diagnostics = []
    for field, selector in selectors.items():
        nodes = query_inside(root, selector) or []
        value = ''
        if mode == 'detail':
            raw = fresh.get(field, '')
            value = '\n'.join(raw) if field == 'images' else text_html(raw) if field in ('shortDesc', 'longDesc', 'specs') else raw
        elif nodes:
            node = nodes[0]
            if field == 'image':
                value = web_url(_image_from_node(node, base), base)
            elif field == 'link':
                value = web_url(extract_smart_link(node, base), base)
            elif field == 'price':
                value = price(node.text_content())
            else:
                value = normalize_text(node.text_content())
        value = str(value or '')[:1500]
        diagnostics.append({'field': field, 'selector': selector, 'count': len(nodes),
                            'value': value, 'status': 'missing' if not nodes else 'matched' if value else 'empty'})
    products = []
    total = 0
    if mode == 'list':
        parsed = parse_products(source, base, selectors)
        total = len(parsed)
        for row in list(parsed.values())[:8]:
            products.append({**{key: str(row.get(key) or '')[:1500] for key in ('title', 'price', 'sku')},
                             'link': checked_url(row.get('link', ''), base), 'image': checked_url(row.get('image', ''), base)})
    warnings = []
    if mode == 'list' and 'sku' in selectors:
        warnings.append('SKU از سلکتور فهرست خوانده می‌شود؛ مرحلهٔ جزئیات فقط مقدار تازهٔ غیرخالی را تکمیل می‌کند.')
    return {'ok': True, 'mode': mode, 'url': base, 'fields': diagnostics, 'products': products,
            'total': total, 'sample_limit': 8, 'automatic': mode == 'list' and not selectors.get('container'),
            'persisted': False, 'render': 'static_direct',
            'warnings': warnings + ['تعداد تطبیق‌ها در کل سند است؛ نمونهٔ فهرست با همان موتور استخراج ساخته می‌شود و ممکن است از fallback استفاده کند.',
                         'فقط HTML ایستا و ارتباط مستقیم؛ کوکی ورود، پروکسی ذخیره‌شده و رندر JavaScript استفاده نمی‌شوند.']}


def preview(data, settings):
    mode, url, selectors = configuration(data)
    if not _GATE.acquire(blocking=False):
        return {'ok': False, 'error': 'یک آزمایش دیگر در این پردازش در حال اجراست؛ کمی بعد دوباره تلاش کنید.'}, 429
    try:
        fetched = HtmlFetcher.get(url, timeout=8, net={'mode': 'direct', '_deadline_seconds': 8}, settings=settings)
        if not fetched.get('ok'):
            # Do not echo proxy errors, raw upstream bodies, cookies or credentials.
            return {'ok': False, 'error': 'دریافت صفحه ناموفق بود؛ آدرس، دسترسی شبکه و نیاز سایت به JavaScript را بررسی کنید.',
                    'upstream_status': fetched.get('code', 0)}, 502
        source = fetched.get('html', '')
        if len(source.encode('utf-8')) > MAX_PARSE_BYTES:
            return {'ok': False, 'error': 'صفحه برای پیش‌نمایش بیش از حد بزرگ است؛ سقف پردازش ۲ مگابایت است.'}, 413
        base = validate_url(fetched.get('url') or url)
        if len(base) > 2048:
            return {'ok': False, 'error': 'آدرس نهایی صفحه بیش از حد طولانی است.'}, 422
        try:
            return render(source, base, mode, selectors), 200
        except (RecursionError, TypeError, AttributeError, ValueError, etree.LxmlError):
            return {'ok': False, 'error': 'ساختار HTML یا دادهٔ محصول این صفحه قابل پردازش نیست؛ یک صفحهٔ نمونهٔ دیگر را آزمایش کنید.'}, 422
    finally:
        _GATE.release()
