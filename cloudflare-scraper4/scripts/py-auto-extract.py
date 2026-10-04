#!/usr/bin/env python3
"""py-auto-extract.py — standalone automatic-selector extraction.

Runs the PROVEN extraction pipeline against a shop page: explicit selectors
first, then automatic structural guesses, then the product-link climb
(link with an image, up to 5 parents until image AND price), then embedded
JSON catalogs. Never dies on a page: a bad selector stage just yields [] and
the next automatic stage still runs.

The extraction core below (clean_text .. parse_html) is lifted VERBATIM from
scraper4.py 10.149 (the Python lineage of this project); only the bs4 parser
name is parameterized (_PARSER: lxml when importable, html.parser otherwise).
The discovery emitter + CLI are new: they propose Node-compatible
container/title/price/link/image selectors so a Termux run doubles as
ground truth for the Node profiles and fixtures.

Dependencies (Termux):
    pkg install python
    pip install requests beautifulsoup4 lxml
(lxml is optional: without it the html.parser fallback is used and XPath
selectors are rejected with a clear message. requests is only needed for
live URLs; --html-file works fully offline.)

Usage:
    python3 scripts/py-auto-extract.py 'https://shop.example/category/1/'
    python3 scripts/py-auto-extract.py URL --pages 3 --json
    python3 scripts/py-auto-extract.py --html-file page.html --base https://shop.example/
    python3 scripts/py-auto-extract.py URL --selectors '{"container":"...","title":"..."}'
    python3 scripts/py-auto-extract.py URL --no-discover   # extraction only
"""
import argparse
import hashlib
import json
import re
import sys
import time
from typing import Any, Optional
from urllib.parse import urljoin

try:
    from bs4 import BeautifulSoup, Tag
except ImportError:
    sys.stderr.write("py-auto-extract: need beautifulsoup4 (pip install beautifulsoup4)\n")
    sys.exit(2)

try:
    import lxml  # noqa: F401
    _PARSER = "lxml"
    _PARSER_NOTE = "lxml"
except ImportError:
    _PARSER = "html.parser"
    _PARSER_NOTE = "html.parser (lxml missing)"

PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
MAX_PRODUCTS_HARD = 2000
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


# ---------------------------------------------------------------------------
# Lifted core (scraper4.py 10.149, verbatim except the _PARSER parameter).
# ---------------------------------------------------------------------------
def clean_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return ""
    return re.sub(r"\s+", " ", str(value).translate(PERSIAN_DIGITS)).strip()


def absolute_url(value: Any, base: str) -> str:
    value = clean_text(value)
    if not value or value.startswith(("data:", "javascript:", "#")):
        return ""
    return urljoin(base, value)


def image_value(value: Any, base: str) -> str:
    if isinstance(value, list):
        for item in value:
            found = image_value(item, base)
            if found:
                return found
        return ""
    if isinstance(value, dict):
        for key in ("url", "src", "webp_url", "image_url", "original", "800", "main"):
            if key in value:
                found = image_value(value[key], base)
                if found:
                    return found
        for item in value.values():
            found = image_value(item, base)
            if found:
                return found
        return ""
    return absolute_url(value, base)


def extract_price(value: Any) -> str:
    """Normalize visible price text using scraper4.php's currency-aware rules."""
    text = clean_text(value)
    if not text:
        return ""
    currency = r"تومان|تومن|ریال|ر\.ی|USD|EUR|GBP|AED|TRY|CAD|AUD|CHF|JPY|CNY|£|\$|€|¥|₽|₺|₹|﷼"
    number = r"\d(?:[\d,،٬.٫\s]*\d)?"
    matches = re.findall(rf"(?:({number})\s*({currency})|({currency})\s*({number}))", text, re.I)
    if matches:
        choices = []
        for left, right_cur, left_cur, right in matches:
            raw, cur = (left, right_cur) if left else (right, left_cur)
            digits = re.sub(r"\D", "", raw)
            if digits:
                choices.append((len(digits), clean_text(f"{cur} {raw}" if left_cur else f"{raw} {cur}")))
        if choices:
            return max(choices, key=lambda item: item[0])[1]
    grouped = re.findall(r"\d{1,3}(?:[,،٬\s]\d{3})+", text)
    if grouped:
        return max(grouped, key=lambda item: len(re.sub(r"\D", "", item))) + " تومان"
    nums = [x for x in re.findall(r"\d{4,}", text) if int(x) >= 1000]
    return (max(nums, key=int) + " تومان") if nums else ""


def product_key(product: dict[str, Any]) -> str:
    link = re.sub(r"[?#].*$", "", clean_text(product.get("link"))).rstrip("/")
    if link:
        identity = "url:" + link
    elif clean_text(product.get("sku")):
        identity = "sku:" + clean_text(product.get("sku")).lower()
    else:
        # Price must not participate in identity, otherwise every price update looks like remove+add.
        identity = "title:" + clean_text(product.get("title")).lower()
    return hashlib.md5(identity.encode("utf-8", "ignore")).hexdigest()


def add_product(store: dict[str, dict[str, Any]], product: Optional[dict[str, Any]]) -> None:
    if not product:
        return
    key = product_key(product)
    if key in store:
        old = store[key]
        for field, value in product.items():
            if value not in ("", None, [], {}) and old.get(field) in ("", None, [], {}):
                old[field] = value
    elif len(store) < MAX_PRODUCTS_HARD:
        product["key"] = key
        store[key] = product


def is_xpath(selector: str) -> bool:
    sel = (selector or "").strip()
    if sel.startswith(("//", "(//", "/html", "/*", "./", ".//")):
        return True
    return sel.startswith("/") and ("@" in sel or "[" in sel)


def query_nodes(root: Any, selector: str) -> list[Any]:
    """CSS or XPath — Chrome copy-xpath starts with // and is invalid CSS."""
    sel = clean_text(selector)
    if not sel:
        return []
    if not is_xpath(sel):
        try:
            return list(root.select(sel))
        except Exception:
            if "/" not in sel:
                raise
    try:
        from lxml import etree, html as lhtml
    except ImportError as exc:
        raise ValueError(f"برای XPath به lxml نیاز است: {exc}") from exc
    html_s = str(root)
    try:
        tree = lhtml.fromstring(html_s)
    except Exception:
        tree = lhtml.fromstring(f"<div>{html_s}</div>")
    found = tree.xpath(sel)
    out: list[Any] = []
    for el in found:
        if isinstance(el, (str, bytes)):
            continue
        try:
            frag = etree.tostring(el, encoding="unicode", method="html")
        except Exception:
            continue
        parsed = BeautifulSoup(frag, _PARSER)
        node = parsed.find(True)
        if node:
            out.append(node)
    return out


def select_value(node: Tag, selector: str, kind: str, base: str) -> str:
    if not selector:
        return ""
    try:
        matches = query_nodes(node, selector)
    except Exception as exc:
        raise ValueError(f"سلکتور نامعتبر ({kind}): {exc}") from exc
    for match in matches:
        if kind == "link":
            value = match.get("href") or (match.find("a", href=True) or {}).get("href", "")
            value = absolute_url(value, base)
        elif kind == "image":
            value = ""
            for attr in ("data-zoom", "data-large", "data-src", "data-lazy-src", "src"):
                if match.get(attr):
                    value = absolute_url(match.get(attr), base)
                    break
            if not value:
                img = match.find("img")
                value = image_value(dict(img.attrs) if img else "", base)
        else:
            value = clean_text(match.get_text(" ", strip=True))
        if value:
            return value
    return ""


def parse_selectors(soup: BeautifulSoup, base: str, selectors: dict[str, str]) -> list[dict[str, Any]]:
    container = clean_text(selectors.get("container"))
    if not container:
        return []
    try:
        nodes = query_nodes(soup, container)
    except Exception as exc:
        raise ValueError(f"سلکتور ظرف نامعتبر است: {exc}") from exc
    out: list[dict[str, Any]] = []
    for node in nodes:
        title = select_value(node, selectors.get("title", ""), "title", base)
        if not title:
            candidate = node.select_one("h1,h2,h3,h4,[class*='title'],a[title]")
            title = clean_text(candidate.get("title") or candidate.get_text(" ", strip=True)) if candidate else ""
        price = extract_price(select_value(node, selectors.get("price", ""), "price", base))
        if not price:
            candidate = node.select_one("[class*='price'],[class*='amount'],ins")
            price = extract_price(candidate.get_text(" ", strip=True)) if candidate else ""
        link = select_value(node, selectors.get("link", ""), "link", base)
        if not link:
            candidate = node if node.name == "a" and node.get("href") else node.find("a", href=True)
            link = absolute_url(candidate.get("href"), base) if candidate else ""
        image = select_value(node, selectors.get("image", ""), "image", base)
        if not image:
            img = node.find("img")
            if img:
                image = next((absolute_url(img.get(a), base) for a in ("data-src", "data-lazy-src", "src") if img.get(a)), "")
        sku = select_value(node, selectors.get("sku", ""), "sku", base)
        if title or link:
            out.append({"title": title[:300], "price": price, "link": link, "image": image, "sku": sku})
    return out


def _html_product(node: Tag, base: str, selectors: Optional[dict[str, str]] = None) -> Optional[dict[str, Any]]:
    """PHP-compatible DOM extraction: selectors first, then structural HTML guesses."""
    selectors = selectors or {}
    title = select_value(node, selectors.get("title", ""), "title", base)
    if not title:
        candidate = node.select_one("h1,h2,h3,h4,[class*='title'],[class*='name'],a[title]")
        title = clean_text((candidate.get("title") if candidate else "") or (candidate.get_text(" ", strip=True) if candidate else ""))
    if not title:
        image_title = node.find("img")
        title = clean_text((image_title.get("alt") or image_title.get("title")) if image_title else "")
    if not title:
        pieces = [clean_text(x) for x in node.stripped_strings]
        pieces = [x for x in pieces if len(x) > 3 and not re.fullmatch(r"[%0-9,،٬.٫ تومانریال]+", x)]
        title = max(pieces, key=len, default="")
    price = extract_price(select_value(node, selectors.get("price", ""), "price", base))
    if not price:
        candidate = node.select_one("[class*='price'],[class*='amount'],ins,[itemprop='price']")
        price = extract_price((candidate.get("content") or candidate.get_text(" ", strip=True)) if candidate else "")
    if not price:
        price = extract_price(node.get_text(" ", strip=True))
    link = select_value(node, selectors.get("link", ""), "link", base)
    if not link:
        candidate = node if node.name == "a" and node.get("href") else node.find("a", href=True)
        link = absolute_url(candidate.get("href"), base) if candidate else ""
    image = select_value(node, selectors.get("image", ""), "image", base)
    if not image:
        img = node.find("img")
        if img:
            image = next((absolute_url(img.get(a), base) for a in ("data-zoom-image","data-large_image","data-src","data-lazy-src","src") if img.get(a)), "")
    sku = select_value(node, selectors.get("sku", ""), "sku", base) or clean_text(node.get("data-product-id", ""))
    if not title and not link:
        return None
    return {"title": title[:300], "price": price, "link": link, "image": image, "sku": sku}


def _json_price(value: Any) -> str:
    if isinstance(value, dict):
        for key in ("final", "selling", "sale", "amount", "value", "min", "current", "discounted", "rrp", "price"):
            if key in value:
                got = _json_price(value[key])
                if got:
                    return got
        return ""
    if isinstance(value, (int, float)) and value > 0:
        number = int(value)
        if number >= 10**7:
            number = number // 10  # rial → toman-ish display; extract_price still runs
        return extract_price(f"{number} تومان") or str(number)
    return extract_price(value)


def _json_text(*values: Any) -> str:
    for value in values:
        text = clean_text(value)
        if text:
            return text
    return ""


def parse_embedded_catalog(text: str, base: str) -> list[dict[str, Any]]:
    """Products hidden in JSON-LD / Next / Nuxt — Snappshop category pages need this."""
    blobs: list[str] = []
    for pattern in (
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        r'<script[^>]+id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>',
        r'<script[^>]+id=["\']__NUXT_DATA__["\'][^>]*>(.*?)</script>',
        r'window\.__NUXT__\s*=\s*(\{.*?\})\s*;\s*</script>',
    ):
        blobs.extend(m.group(1) for m in re.finditer(pattern, text or "", re.I | re.S))
    found: list[dict[str, Any]] = []

    def consider(obj: Any) -> None:
        if not isinstance(obj, dict):
            return
        title = _json_text(obj.get("title"), obj.get("name"), obj.get("productTitle"), obj.get("fa_title"), obj.get("displayName"))
        if not title or len(title) < 3:
            return
        price = _json_price(obj.get("price") or obj.get("offers") or obj.get("finalPrice") or obj.get("sellingPrice") or obj.get("discountedPrice") or obj.get("minPrice"))
        href = _json_text(obj.get("url"), obj.get("link"), obj.get("href"), obj.get("slug"), obj.get("productUrl"))
        ident = _json_text(obj.get("sku"), obj.get("id"), obj.get("productId"), obj.get("code"))
        if href:
            if re.fullmatch(r"snp-\d+", href, re.I):
                href = "/product/" + href
            href = absolute_url(href, base)
        elif ident and re.fullmatch(r"snp-\d+", ident, re.I):
            href = absolute_url("/product/" + ident, base)
        image = obj.get("image") or obj.get("thumbnail") or obj.get("cover") or obj.get("mainImage")
        if isinstance(image, list) and image:
            image = image[0]
        if isinstance(image, dict):
            image = image.get("url") or image.get("src")
        image = absolute_url(clean_text(image), base) if image else ""
        if not href and not price:
            return
        found.append({"title": title[:300], "price": price, "link": href, "image": image, "sku": ident[:80]})

    def walk(obj: Any, depth: int = 0) -> None:
        if depth > 14:
            return
        if isinstance(obj, dict):
            consider(obj)
            items = obj.get("itemListElement")
            if isinstance(items, list):
                for item in items:
                    if isinstance(item, dict):
                        consider(item.get("item") if isinstance(item.get("item"), dict) else item)
            for value in obj.values():
                walk(value, depth + 1)
        elif isinstance(obj, list) and len(obj) < 4000:
            for item in obj:
                walk(item, depth + 1)

    for blob in blobs:
        raw = (blob or "").strip()
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except ValueError:
            continue
        walk(data)
    # de-dupe while walking via add_product later
    return found


def parse_html(text: str, base: str, selectors: Optional[dict[str, str]] = None) -> tuple[list[dict[str, Any]], BeautifulSoup, dict[str, int]]:
    """Parse only the downloaded/rendered DOM, matching scraper4.php (never APIs/hydration)."""
    soup = BeautifulSoup(text, _PARSER)
    store: dict[str, dict[str, Any]] = {}
    selectors = selectors or {}
    selector_rows: list[dict[str, Any]] = []
    if selectors.get("container"):
        try:
            selector_rows = parse_selectors(soup, base, selectors)
        except Exception:
            selector_rows = []
    for row in selector_rows:
        add_product(store, row)
    if not store:
        candidates = soup.select("li.product,article[class*='product'],div.product-card,div.product-item,div[class*='product-card'],div[class*='product-item'],[data-product-id],[itemtype*='Product']")
        # Like PHP's outer-container repair: if one wrapper was selected, descend to repeated cards.
        if len(candidates) == 1:
            nested = candidates[0].select("li,article,div[class*='product'],[data-product-id]")
            if len(nested) > 1:
                candidates = nested
        for node in candidates:
            add_product(store, _html_product(node, base, selectors))
    if not store:
        # PHP-style last fallback: product links with images are reliable even
        # when a shop uses unknown generated class names (e.g. barfbox.ir).
        for link in soup.select("a[href*='/product/'],a[href*='/products/'],a[href*='/shop/'],a[href*='/snp-']"):
            if not link.find("img") and not link.select_one("[class*='price']"): continue
            node: Tag = link
            for _ in range(5):
                parent=node.parent
                if not isinstance(parent,Tag): break
                node=parent
                if node.find("img") and extract_price(node.get_text(" ",strip=True)): break
            add_product(store,_html_product(node,base,selectors))
    for row in parse_embedded_catalog(text, base):
        add_product(store, row)
    return list(store.values()), soup, {"selector_matches": len(selector_rows), "dom_products": len(store), "html_bytes": len(text.encode("utf-8", "ignore"))}

# ---------------------------------------------------------------------------
# Discovery emitter (new): Node-compatible auto selectors from the same climb.
# ---------------------------------------------------------------------------

_VOLATILE_CLASS_RE = re.compile(r"^(active|selected|current|open|opened|hover|focus|disabled|loading|ng-|v-|is-|has-|js-)", re.I)
_HASH_CLASS_RE = re.compile(r"^[a-f0-9]{6,}$", re.I)
_CLIMB_LINK_RE = re.compile(r"/product/|/products/|/shop/|/snp-", re.I)


def _css_escape(name: str) -> str:
    out = re.sub(r"[^a-zA-Z0-9_-]", lambda m: "\\" + m.group(0), name)
    return re.sub(r"^(\d)", r"\\3\1 ", out)


def _stable_classes(el: Tag) -> list:
    classes = el.get("class", []) or []
    if isinstance(classes, str):
        classes = classes.split()
    stable = [c for c in classes if len(c) <= 40 and not _VOLATILE_CLASS_RE.match(c) and not _HASH_CLASS_RE.match(c)]
    stable = sorted(dict.fromkeys(stable), key=lambda n: ((100 if re.search(r"[^a-zA-Z0-9_-]", n) else 0) + len(n)))
    return stable


def _sig_for(el: Tag) -> str:
    tag = (el.name or "div").lower() if re.match(r"^[a-z][a-z0-9]*$", (el.name or "").lower()) else "div"
    classes = _stable_classes(el)
    if len(classes) >= 2:
        return f"{tag}.{_css_escape(classes[0])}.{_css_escape(classes[1])}"
    if len(classes) == 1:
        return f"{tag}.{_css_escape(classes[0])}"
    return tag


def _looks_price(text: str) -> bool:
    value = clean_text(text)
    return bool(value) and len(value) <= 80 and bool(extract_price(value))


def _vote_title(nodes: list) -> str:
    votes: dict = {}
    for node in nodes:
        sig = ""
        for head in node.select("h1,h2,h3,h4,[itemprop=\"name\"]"):
            text = clean_text(head.get_text(" ", strip=True))
            if 8 <= len(text) <= 200 and not _looks_price(text):
                sig = _sig_for(head)
                break
        if not sig:
            best_len, best_idx = 0, -1
            cands = node.select("span,div,p,a,li,td,strong,b")[:120]
            for idx, el in enumerate(cands):
                text = clean_text(el.get_text(" ", strip=True))
                if 15 <= len(text) <= 160 and not _looks_price(text) and (len(text) > best_len or (len(text) == best_len and idx > best_idx)):
                    best_len, best_idx = len(text), idx
                    sig = _sig_for(el)
        if sig:
            vote = votes.get(sig, {"count": 0, "bonus": 2 if re.match(r"^h[1-4]\.", sig) else 0})
            vote["count"] += 1
            votes[sig] = vote
    if not votes:
        return ""
    return sorted(votes.items(), key=lambda kv: (kv[1]["count"] * 10 + kv[1]["bonus"]), reverse=True)[0][0]


def _vote_price(nodes: list) -> str:
    votes: dict = {}
    for node in nodes:
        cands = []
        for idx, el in enumerate(node.find_all(True)[:150]):
            text = el.get_text(" ", strip=True)
            if text and len(text) <= 80 and _looks_price(text):
                cands.append({"sig": _sig_for(el), "length": len(clean_text(text)), "index": idx})
        cands.sort(key=lambda c: (c["length"], -c["index"]))
        if cands:
            winner = cands[0]["sig"]
            vote = votes.get(winner, {"count": 0, "length": cands[0]["length"]})
            vote["count"] += 1
            votes[winner] = vote
    if not votes:
        return ""
    return sorted(votes.items(), key=lambda kv: (-kv[1]["count"], kv[1]["length"]))[0][0]


def discover_selectors(text: str, base: str) -> dict:
    """Climb product links exactly like parse_html, then emit selectors."""
    soup = BeautifulSoup(text, _PARSER)
    climbed: list = []
    for link in soup.select("a[href]")[:800]:
        href = clean_text(link.get("href"))
        if not href or href == "#" or href.lower().startswith("javascript:"):
            continue
        if not _CLIMB_LINK_RE.search(href) and not _CLIMB_LINK_RE.search(clean_text(link.get("href"))):
            continue
        if not link.find("img") and not link.select_one("[class*='price']"):
            continue
        node: Any = link
        for _ in range(5):
            parent = node.parent
            if not isinstance(parent, Tag):
                break
            node = parent
            if node.find("img") and extract_price(node.get_text(" ", strip=True)):
                break
        climbed.append(node)
    if len(climbed) < 2:
        return {"selectors": {}, "method": "none", "containerCount": 0, "ok": False}
    groups: dict = {}
    for node in climbed:
        groups.setdefault(_sig_for(node), []).append(node)
    ranked = sorted(groups.items(), key=lambda kv: (-len(kv[1]), len(kv[0])))[:5]
    for sig, members in ranked:
        if len(members) < 2:
            continue
        sample = members[:8]
        title = _vote_title(sample)
        if not title:
            continue
        price = _vote_price(sample)
        links = sum(1 for n in sample if n.name == "a" and n.get("href"))
        link_sel = sig if links * 2 >= len(sample) else "a[href]"
        try:
            cards = soup.select(sig)[:12]
        except Exception:
            continue
        title_hits = sum(1 for c in sample if c.select_one(title) and clean_text(c.select_one(title).get_text(" ", strip=True)))
        needed = max(1, (min(len(cards), 12) + 1) // 2)
        if len(cards) >= 2 and title_hits >= needed:
            return {"selectors": {"container": sig, "title": title, **({"price": price} if price else {}), "link": link_sel, "image": "img"},
                    "method": "structural", "containerCount": len(cards), "ok": True}
    return {"selectors": {}, "method": "none", "containerCount": 0, "ok": False}


# ---------------------------------------------------------------------------
# Fetch + CLI.
# ---------------------------------------------------------------------------


def fetch_page(url: str, timeout: int = 30) -> tuple:
    try:
        import requests
    except ImportError:
        return "", url, "need requests for live URLs (pip install requests) or use --html-file"
    try:
        res = requests.get(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
                                          "Accept-Language": "fa-IR,fa;q=0.9,en;q=0.7", "Cache-Control": "no-cache"},
                           timeout=timeout, allow_redirects=True)
        return (res.text or ""), str(res.url or url), ("" if res.status_code < 400 else f"HTTP {res.status_code}")
    except Exception as exc:
        return "", url, f"fetch failed: {exc}"


def run_extraction(text: str, base: str, selectors: Optional[dict], want_discover: bool) -> dict:
    t0 = time.monotonic()
    rows, _soup, diag = parse_html(text, base, selectors or {})
    discovered: dict = {"selectors": {}, "method": "none", "containerCount": 0, "ok": False}
    if want_discover:
        try:
            discovered = discover_selectors(text, base)
        except Exception as exc:
            discovered = {"selectors": {}, "method": "none", "containerCount": 0, "ok": False, "error": str(exc)[:200]}
    diag = {**diag, "parser": _PARSER_NOTE, "elapsedMs": int((time.monotonic() - t0) * 1000)}
    return {"products": rows, "diag": diag, "discovered": discovered}


def main(argv: Optional[list] = None) -> int:
    ap = argparse.ArgumentParser(description="Automatic-selector extraction (scraper4.py pipeline).")
    ap.add_argument("url", nargs="?", default="", help="List page URL (live fetch needs requests).")
    ap.add_argument("--html-file", default="", help="Offline mode: read HTML from a file instead of fetching.")
    ap.add_argument("--base", default="", help="Base URL for resolving relative links (defaults to URL or file hint).")
    ap.add_argument("--selectors", default="", help="JSON explicit selectors, e.g. '{\"container\":\"...\",\"title\":\"...\"}'.")
    ap.add_argument("--no-discover", action="store_true", help="Skip the discovery emitter (extraction only).")
    ap.add_argument("--json", action="store_true", help="Print the full JSON result.")
    ap.add_argument("--limit", type=int, default=8, help="How many products to print in human mode.")
    args = ap.parse_args(argv)
    selectors: dict = {}
    if args.selectors:
        try:
            selectors = json.loads(args.selectors)
            if not isinstance(selectors, dict):
                raise ValueError("not an object")
        except Exception as exc:
            sys.stderr.write(f"py-auto-extract: --selectors must be JSON: {exc}\n")
            return 2
    if args.html_file:
        try:
            with open(args.html_file, encoding="utf-8") as fh:
                text = fh.read()
        except OSError as exc:
            sys.stderr.write(f"py-auto-extract: cannot read {args.html_file}: {exc}\n")
            return 2
        base = args.base or "https://shop.example/"
        source = args.html_file
    else:
        if not args.url:
            sys.stderr.write("py-auto-extract: give a URL or --html-file\n")
            return 2
        text, final_url, fetch_error = fetch_page(args.url)
        if fetch_error or not text:
            sys.stderr.write(f"py-auto-extract: {fetch_error or 'empty page'}\n")
            return 1
        base = args.base or final_url
        source = args.url
    out = run_extraction(text, base, selectors, not args.no_discover)
    out["source"] = source
    if args.json:
        print(json.dumps(out, ensure_ascii=False))
        return 0
    rows = out["products"]
    print(f"py-auto-extract: {source} ({len(text)} bytes, base {base}, parser {out['diag']['parser']})")
    print(f"products: {len(rows)} (selector_matches={out['diag'].get('selector_matches', 0)} dom_products={out['diag'].get('dom_products', 0)} {out['diag']['elapsedMs']}ms)")
    for i, p in enumerate(rows[: max(0, args.limit)]):
        print(f"  #{i} [{p.get('price', '')}] {(p.get('title') or '')[:44]} | {(p.get('link') or '')[:60]} | img:{'yes' if p.get('image') else 'NO'}")
    d = out["discovered"]
    print(f"discovered: {d.get('method', 'none')} ok={d.get('ok', False)} containers={d.get('containerCount', 0)} {json.dumps(d.get('selectors', {}), ensure_ascii=False)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
