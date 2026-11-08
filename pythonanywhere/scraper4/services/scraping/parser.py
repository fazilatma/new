"""پورتِ وفادارِ موتورِ پارسِ scraper4.php:
   load_dom / queryInside (v9.86, v9.87) / parse_with_selectors
   (بازشناسیِ مجددِ ظرفِ یکتا) / extractSmartLink / fallbackهای JSON-LD و og:image

خروجی: دیکشنری‌ای از ردیف‌های محصول به‌کلیدِ productKey، مثل نسخهٔ قدیمی.
"""
from __future__ import annotations

import json
import re
from typing import Iterable, Optional

import lxml.html
from lxml import etree

from .css_to_xpath import class_cond, css_to_xpath
from .product_key import product_key
from ..support.persian import normalize_text, price
from ..support.url import absolute, is_image

HTML_PARSER = lxml.html.HTMLParser(encoding="utf-8", recover=True)

_UNION_RE = re.compile(r"\s*\|\s*")
_PREFIX_RE = re.compile(r"^([^\s>+~]+)[\s>]+(.+)$", re.UNICODE)
_OG_IMAGE_RES = (
    re.compile(r"""<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']""", re.I),
    re.compile(r"""<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']""", re.I),
    re.compile(r"""<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']""", re.I),
)
_IMG_TAG_RE = re.compile(r"<img[^>]+>", re.I)
_ATTR_RE = {
    name: re.compile(rf"""{name}=["']([^"']+)["']""", re.I)
    for name in ("src", "class", "id", "width", "height", "alt")
}
_ANY_IMG_SRC_RE = re.compile(r"""<img[^>]+src=["']([^"']+)["'][^>]*>""", re.I)


def load_dom(html: str):
    """DOM + ریشه برای پرس‌وجو (نسخهٔ lxml از load_dom)."""
    if not html:
        html = "<html><body></body></html>"
    try:
        root = lxml.html.document_fromstring(html, parser=HTML_PARSER)
    except (etree.ParserError, ValueError):
        root = lxml.html.document_fromstring("<html><body></body></html>", parser=HTML_PARSER)
    return root


def _is_element(node) -> bool:
    return isinstance(node.tag, str)


def _relativize(xpath: str) -> str:
    parts = []
    for part in _UNION_RE.split(xpath):
        part = part.strip()
        if not part:
            continue
        if part.startswith("//"):
            part = "." + part
        elif not part.startswith("./") and part.startswith("/"):
            part = "." + part
        parts.append(part)
    return " | ".join(parts)


def _safe_xpath(node, expr: str) -> list:
    try:
        result = node.xpath(expr)
    except (etree.XPathError, etree.LxmlError, ValueError):
        return []
    return result if isinstance(result, list) else []


def query_inside(container, css: str) -> Optional[list]:
    """جست‌وجوی یک سلکتورِ CSS داخلِ یک ظرف.

    • خروجیِ css_to_xpathِ مطلق (…//a) به نسبی (….//a) تبدیل می‌شود — برای
      *تک‌تکِ* شاخه‌های union (اصلاحِ «۲۰ پیدا ولی ۱ استخراج»).
    • اگر گامِ اولِ سلکتور به خودِ ظرف اشاره کند (مثل «div.card span» وقتی
      container=div.card)، آن گامِ اضافی برداشته می‌شود (اصلاحِ v9.87).
    """
    for strict in (True, False):
        xpath = css_to_xpath(css, strict)
        if not xpath:
            continue
        nodes = _safe_xpath(container, _relativize(xpath))
        nodes = [n for n in nodes if _is_element(n)]
        if nodes:
            return nodes

        # حالتِ «پیشوندِ ظرف» (v9.87)
        if not _is_element(container):
            continue
        trimmed = (css or "").strip()
        m = _PREFIX_RE.match(trimmed)
        if not m:
            continue
        head, tail = m.group(1).strip(), m.group(2).strip()
        if not head or not tail or tail[0] in "+~":
            continue
        head_xpath = css_to_xpath(head, strict)
        if not head_xpath:
            continue
        is_self = False
        for sp in _UNION_RE.split(head_xpath):
            sp = re.sub(r"^/*", "", sp.strip())
            if not sp:
                continue
            if _safe_xpath(container, "self::" + sp):
                is_self = True
                break
        if not is_self:
            continue
        tail_xpath = css_to_xpath(tail, strict)
        if not tail_xpath:
            continue
        nodes = [n for n in _safe_xpath(container, _relativize(tail_xpath)) if _is_element(n)]
        if nodes:
            return nodes
    return None


def _href_of(el) -> str:
    for attr in ("href", "data-href", "data-url"):
        value = (el.get(attr) or "").strip()
        if value and value != "#" and not re.match(r"^(javascript:|data:)", value, re.I):
            return value
    return ""


def extract_smart_link(node, base_url: str, boundary=None) -> str:
    """لینکِ هوشمند: خود گره <a>، نزدیک‌ترین جدِ <a> تا مرز، وگرنه نخستین
    <a href> داخلِ گره."""
    if node is None or not _is_element(node):
        return ""

    def from_anchor(el) -> str:
        href = _href_of(el)
        return absolute(href, base_url) if href else ""

    if node.tag.lower() == "a":
        link = from_anchor(node)
        if link:
            return link

    # اجدادِ <a> تا مرزِ ظرف
    for parent in node.iterancestors():
        if parent is boundary:
            break
        if _is_element(parent) and parent.tag.lower() == "a":
            link = from_anchor(parent)
            if link:
                return link

    # نخستین <a href> معتبرِ داخلِ گره
    for anchor in _safe_xpath(node, ".//a[@href]"):
        if _is_element(anchor):
            link = from_anchor(anchor)
            if link:
                return link
    return ""


def _image_from_node(node, base_url: str) -> str:
    if node is None or not _is_element(node):
        return ""
    for attr in ("data-src", "data-lazy-src", "data-original", "src"):
        value = (node.get(attr) or "").strip()
        if value and is_image(value):
            return absolute(value, base_url)
    if node.tag.lower() != "img":
        for img in node.iter("img"):
            found = _image_from_node(img, base_url)
            if found:
                return found
    return ""


def _walk_json_ld(data, out: list) -> None:
    if isinstance(data, dict):
        if "Product" in str(data.get("@type") or ""):
            out.append(data)
        for value in data.values():
            if isinstance(value, (dict, list)):
                _walk_json_ld(value, out)
    elif isinstance(data, list):
        for item in data:
            _walk_json_ld(item, out)


def json_ld_fallback(root, base_url: str, products: dict) -> dict:
    """محصولاتِ schema.org داخلِ application/ld+json."""
    for script in _safe_xpath(root, "//script[@type='application/ld+json']"):
        raw = script.text_content() if hasattr(script, "text_content") else (script.text or "")
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            continue
        items: list = []
        _walk_json_ld(data, items)
        for item in items:
            image = item.get("image")
            if isinstance(image, list):
                image = image[0] if image else ""
            offers = item.get("offers") or {}
            if isinstance(offers, list):
                offers = offers[0] if offers else {}
            row = {
                "title": str(item.get("name") or ""),
                "price": str((offers or {}).get("price") or "") + " تومان",
                "link": absolute(str(item.get("url") or ""), base_url),
                "image": absolute(str(image or ""), base_url),
                "sku": str(item.get("sku") or ""),
            }
            key = product_key(row)
            products.setdefault(key, row)
    return products


def _guess_container(root, container, probe: str):
    """بازشناسیِ مجدد: اگر ظرف یکتاست ولی داخلش چند آیتم هست، ظرفِ واقعی
    یک لایه پایین‌تر است (bookstoscrape / mantoopatris)."""
    inner = query_inside(container, probe) if probe else None
    if not inner or len(inner) < 2:
        for query in (".//h2|.//h3|.//h4", ".//a[@href][.//img]", ".//img"):
            found = [n for n in _safe_xpath(container, query) if _is_element(n)]
            if len(found) >= 2:
                inner = found
                break
    if not inner or len(inner) < 2:
        return None

    want = len(inner)
    best = None
    node = inner[0]
    depth = 0
    while node is not None and depth < 8:
        parent = node.getparent()
        if parent is None or not _is_element(parent):
            break
        node = parent
        if node is container:
            break
        name = node.tag
        cls = (node.get("class") or "").strip()
        if cls:
            first = re.split(r"\s+", cls)[0]
            query = ".//" + name + "[" + class_cond(first, True) + "]"
        else:
            query = ".//" + name
        sibs = [n for n in _safe_xpath(container, query) if _is_element(n)]
        if len(sibs) == want:
            best = sibs
        elif len(sibs) > want:
            break
        depth += 1
    return best


def with_selectors(html: str, base_url: str, selectors: dict) -> dict:
    """پارس با سلکتورهای کاربر (همان parse_with_selectors)."""
    root = load_dom(html)
    products: dict = {}

    container_css = (selectors or {}).get("container") or ""
    container_xpath = css_to_xpath(container_css, True)
    if not container_xpath:
        return {}
    containers = [n for n in _safe_xpath(root, container_xpath) if _is_element(n)]
    if not containers:
        container_xpath = css_to_xpath(container_css, False)
        containers = ([n for n in _safe_xpath(root, container_xpath) if _is_element(n)]
                      if container_xpath else [])
    if not containers:
        return json_ld_fallback(root, base_url, {})

    # بازشناسیِ ظرفِ واقعی وقتی سلکتور یک لایه بالاتر را گرفته است
    if len(containers) == 1:
        probe = ""
        for field in ("title", "price", "link", "image"):
            if selectors.get(field):
                probe = selectors[field]
                break
        narrowed = _guess_container(root, containers[0], probe)
        if narrowed:
            containers = narrowed

    for container in containers:
        row = {"title": "", "price": "", "link": "", "image": "", "sku": ""}

        # عنوان
        if selectors.get("title"):
            nodes = query_inside(container, selectors["title"])
            if nodes:
                for node in nodes:
                    text = normalize_text(node.text_content())
                    if text:
                        row["title"] = text
                        break
        if row["title"] == "":
            for query in (".//h2", ".//h3", ".//h4",
                          './/*[contains(@class,"title")]', ".//a[@title]"):
                nodes = [n for n in _safe_xpath(container, query) if _is_element(n)]
                if nodes:
                    text = normalize_text(nodes[0].text_content())
                    if text and 2 < len(text) < 200:
                        row["title"] = text
                        break

        # قیمت
        if selectors.get("price"):
            nodes = query_inside(container, selectors["price"])
            if nodes:
                for node in nodes:
                    value = price(node.text_content())
                    if value:
                        row["price"] = value
                        break
        if row["price"] == "":
            for query in ('.//ins//*[contains(@class,"amount")]',
                          './/*[contains(@class,"price")]',
                          './/*[contains(@class,"amount")]'):
                nodes = [n for n in _safe_xpath(container, query) if _is_element(n)]
                if nodes:
                    value = price(nodes[0].text_content())
                    if value:
                        row["price"] = value
                        break

        # لینک
        if selectors.get("link"):
            nodes = query_inside(container, selectors["link"])
            if nodes:
                row["link"] = extract_smart_link(nodes[0], base_url, container)
        if row["link"] == "":
            row["link"] = extract_smart_link(container, base_url, container)

        # تصویر
        if selectors.get("image"):
            nodes = query_inside(container, selectors["image"])
            if nodes:
                row["image"] = _image_from_node(nodes[0], base_url)
        if row["image"] == "":
            imgs = [n for n in _safe_xpath(container, ".//img") if _is_element(n)]
            if imgs:
                row["image"] = _image_from_node(imgs[0], base_url)

        if row["title"] == "" and row["link"] == "":
            continue
        products.setdefault(product_key(row), row)

    # fallback آخر: محصولاتِ application/ld+json
    if not products:
        products = json_ld_fallback(root, base_url, products)
    return products


def auto(html: str, base_url: str) -> dict:
    """وقتی سلکتوری انتخاب نشده (حالتِ «خودکار»).

    fallbackهای ساخت‌یافته: JSON-LD (Product) و آیتم‌های itemscope/schema.org.
    تشخیصِ خودکارِ ظرفِ تکرارشونده (آنالیزِ آماریِ DOM نسخهٔ قدیمی) در فازِ ۲
    پورت می‌شود؛ تا آن‌جا یا سلکتور بدهید یا روی سایت‌های schema.org تکیه کنید.
    """
    root = load_dom(html)
    products = json_ld_fallback(root, base_url, {})

    if not products:
        for scope in _safe_xpath(root, "//*[@itemscope][@itemtype]"):
            if not _is_element(scope):
                continue
            if "product" not in (scope.get("itemtype") or "").lower():
                continue

            def get(prop: str) -> str:
                nodes = [n for n in _safe_xpath(scope, f'.//*[@itemprop="{prop}"]')
                         if _is_element(n)]
                if not nodes:
                    return ""
                el = nodes[0]
                for attr in ("content", "href", "src"):
                    value = el.get(attr)
                    if value:
                        return value
                return normalize_text(el.text_content())

            row = {
                "title": normalize_text(get("name")),
                "price": price(get("price")),
                "link": absolute(get("url"), base_url),
                "image": absolute(get("image"), base_url),
                "sku": normalize_text(get("sku")),
            }
            if row["title"] == "" and row["link"] == "":
                continue
            products.setdefault(product_key(row), row)
    return products


def _resolve_url(url: str, base: str, page_url: str) -> str:
    if re.match(r"^https?://", url, re.I):
        return url
    if url.startswith("//"):
        return "https:" + url
    if url.startswith("/"):
        return base + url
    return page_url.rstrip("/") + "/" + url.lstrip("/")


def image_from_page(html: str, page_url: str) -> str:
    """og:image / امتیازدهیِ imgها — وقتی محصولی مستقیم نیست (صفحهٔ تکی)."""
    if not html:
        return ""
    from urllib.parse import urlsplit

    parts = urlsplit(page_url)
    base = f"{parts.scheme or 'https'}://{parts.hostname or ''}"

    for pattern in _OG_IMAGE_RES:
        m = pattern.search(html)
        if m:
            return _resolve_url(m.group(1), base, page_url)

    def attr(tag: str, name: str) -> str:
        m = _ATTR_RE[name].search(tag)
        return m.group(1) if m else ""

    best_url, best_score = "", 0
    for tag in _IMG_TAG_RE.findall(html):
        src = attr(tag, "src")
        if not src or re.match(r"^(data:|javascript:|#)", src, re.I):
            continue
        cls = attr(tag, "class")
        el_id = attr(tag, "id")
        alt = attr(tag, "alt")
        try:
            w = int(attr(tag, "width") or 0)
            h = int(attr(tag, "height") or 0)
        except ValueError:
            w = h = 0

        score = 10 if (w > 200 and h > 200) else 0
        score += 5 if w * h > 50000 else 0
        keywords = r"product|main|big|large|gallery|featured|hero|primary|item|detail"
        if re.search(keywords, cls + el_id, re.I):
            score += 8
        if re.search(keywords, alt, re.I):
            score += 3
        if re.search(r"logo|icon|badge|thumb|avatar|sprite|social|banner|slider", cls + el_id, re.I):
            score -= 10
        if score > best_score:
            best_score, best_url = score, src

    if best_url and best_score >= 3:
        return _resolve_url(best_url, base, page_url)

    m = _ANY_IMG_SRC_RE.search(html)
    if m:
        u = m.group(1)
        if not re.match(r"^(data:|javascript:|#|\w+-icon)", u, re.I) and len(u) > 10:
            return _resolve_url(u, base, page_url)
    return ""


def parse_products(html: str, base_url: str, selectors: dict | None = None) -> dict:
    """رابطِ یکسانِ موتور: با سلکتور یا خودکار."""
    if selectors and selectors.get("container"):
        return with_selectors(html, base_url, selectors)
    return auto(html, base_url)


ProductParser = parse_products
