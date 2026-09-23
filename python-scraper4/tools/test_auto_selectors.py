#!/usr/bin/env python3
"""Regression tests for the 10.178 selector auto-discovery.

Run with the project dependencies installed:

    python3 tools/test_auto_selectors.py

Covers the promise of the release: a profile whose manual selectors are
empty or incomplete no longer dies with «هیچ محصولی استخراج نشد» — the
selectors are discovered from the real page, verified on it, adopted for the
run and written back into the profile's manual selectors. No network is
used: Fetcher.get is monkeypatched with local fixtures (the AGENTS.md rule
"fixtures, not live sites" applies to the Python twin as well).
"""
from __future__ import annotations

import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
WOO_LIST = """<html><body>
<ul class="products">
  <li class="product">
    <a class="woocommerce-LoopProduct-link" href="/product/one">
      <img class="wp-post-image" src="/one.jpg" alt="one">
      <h2 class="woocommerce-loop-product__title">محصول شماره یک</h2>
      <span class="price">۱۰۰٬۰۰۰ تومان</span>
    </a>
  </li>
  <li class="product">
    <a class="woocommerce-LoopProduct-link" href="/product/two">
      <img class="wp-post-image" src="/two.jpg" alt="two">
      <h2 class="woocommerce-loop-product__title">محصول شماره دو</h2>
      <span class="price">۲۰۰٬۰۰۰ تومان</span>
    </a>
  </li>
  <li class="product">
    <a class="woocommerce-LoopProduct-link" href="/product/three">
      <img class="wp-post-image" src="/three.jpg" alt="three">
      <h2 class="woocommerce-loop-product__title">محصول شماره سه</h2>
      <span class="price">۳۰۰٬۰۰۰ تومان</span>
    </a>
  </li>
</ul>
</body></html>"""

# A shop with none of the curated patterns: discovery must fall back to the
# structural pass and still return verified, reusable selectors.
STRUCTURAL_LIST = """<html><body>
<div class="grid">
  <div class="bx-card">
    <a href="/item/1"><img src="/i1.jpg" alt="1"></a>
    <span class="ttl">محصول آزمایشی شمارهٔ یک</span>
    <span class="cost">۱۲۰٬۰۰۰ تومان</span>
  </div>
  <div class="bx-card">
    <a href="/item/2"><img src="/i2.jpg" alt="2"></a>
    <span class="ttl">محصول آزمایشی شمارهٔ دو</span>
    <span class="cost">۲۲۰٬۰۰۰ تومان</span>
  </div>
  <div class="bx-card">
    <a href="/item/3"><img src="/i3.jpg" alt="3"></a>
    <span class="ttl">محصول آزمایشی شمارهٔ سه</span>
    <span class="cost">۳۲۰٬۰۰۰ تومان</span>
  </div>
  <div class="bx-card">
    <a href="/item/4"><img src="/i4.jpg" alt="4"></a>
    <span class="ttl">محصول آزمایشی شمارهٔ چهار</span>
    <span class="cost">۴۲۰٬۰۰۰ تومان</span>
  </div>
</div>
</body></html>"""

DETAIL_PAGE = """<html><body>
<div class="product">
  <h1 class="product_title">نام محصول جزئیات</h1>
  <div class="woocommerce-product-gallery">
    <div class="woocommerce-product-gallery__image"><img src="/main.jpg"></div>
    <img src="/g2.jpg"><img src="/g3.jpg">
  </div>
  <p class="price"><span class="amount">۲۵۰٬۰۰۰ تومان</span></p>
  <div class="woocommerce-product-details__short-description">توضیح کوتاه محصول</div>
  <div id="tab-description">توضیح بلند محصول برای آزمایش</div>
  <span class="sku">SKU-42</span>
  <span class="brand">برند نمونه</span>
  <p class="stock in-stock">موجود</p>
  <span class="weight">۵۰۰ گرم</span>
  <span class="posted_in"><a href="/cat/x">دستهٔ نمونه</a></span>
  <span class="tagged_as"><a rel="tag" href="/tag/y">برچسب نمونه</a></span>
  <table class="variations"><tr><td>
    <select name="pa_color"><option>قرمز</option><option>آبی</option></select>
  </td></tr></table>
</div>
</body></html>"""

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ✓ {name}")
    else:
        FAILURES.append(name)
        print(f"  ✕ {name}" + (f" — {detail}" if detail else ""))


def main() -> int:
    tmpdir = tempfile.mkdtemp(prefix="s4-test-")
    os.environ["SCRAPER_DATA_FILE"] = os.path.join(tmpdir, "scraper4_data.json")
    import scraper4 as core  # noqa: E402 - env must be set before import

    # Use an actually resolvable public host: production URL validation is
    # intentionally DNS-aware and rejects reserved .example hostnames.
    base = "https://example.com/list"

    print("list_selectors_status")
    check("empty", core.list_selectors_status({}) == "empty")
    check("partial", core.list_selectors_status(
        {"container": "li.product", "title": "h2"}) == "partial")
    check("custom", core.list_selectors_status(
        {k: "x" for k in core.LIST_SELECTOR_KEYS}) == "custom")

    print("discover_list_selectors — curated pass (WooCommerce fixture)")
    found = core.discover_list_selectors(WOO_LIST, base)
    check("method is curated/mixed", found["method"] in ("curated", "mixed"),
          found["method"])
    check("container", found["selectors"].get("container") == "li.product",
          str(found["selectors"]))
    check("title", found["selectors"].get("title")
          == ".woocommerce-loop-product__title")
    check("price found", bool(found["selectors"].get("price")))
    check("link found", bool(found["selectors"].get("link")))
    check("image found", bool(found["selectors"].get("image")))
    check("containerCount", found["containerCount"] == 3,
          str(found["containerCount"]))

    print("discover_list_selectors — structural pass (unknown shop fixture)")
    found = core.discover_list_selectors(STRUCTURAL_LIST, base)
    check("method is structural", found["method"] == "structural", found["method"])
    check("container", found["selectors"].get("container") == "div.bx-card",
          str(found["selectors"]))
    check("title", found["selectors"].get("title") == "span.ttl",
          str(found["selectors"]))
    check("price", found["selectors"].get("price") == "span.cost",
          str(found["selectors"]))
    check("containerCount", found["containerCount"] == 4,
          str(found["containerCount"]))
    rows, _soup, _stats = core.parse_html(
        STRUCTURAL_LIST, base, found["selectors"], "auto")
    check("discovered selectors really extract", len(rows) == 4, str(len(rows)))
    check("extracted titles", all(r.get("title") for r in rows))
    check("extracted prices", all(r.get("price") for r in rows))
    check("extracted links", all(r.get("link") for r in rows))

    print("ensure_list_selectors")
    ensured = core.ensure_list_selectors(WOO_LIST, base, {})
    check("empty selectors are repaired", bool(ensured.get("discovered")),
          str(ensured))
    check("repaired set verifies",
          core.verify_list_selectors(WOO_LIST, base, ensured["selectors"])["ok"])
    # A form being completely filled does not make it valid: stale selectors
    # that match zero nodes must be repaired from the live sample.
    broken_custom = {k: "x" for k in core.LIST_SELECTOR_KEYS}
    ensured = core.ensure_list_selectors(WOO_LIST, base, broken_custom)
    check("stale custom selectors are repaired",
          ensured["selectors"] != broken_custom and bool(ensured.get("discovered"))
          and core.verify_list_selectors(WOO_LIST, base, ensured["selectors"])["ok"],
          str(ensured))
    valid_custom = core.discover_list_selectors(WOO_LIST, base)["selectors"]
    ensured = core.ensure_list_selectors(WOO_LIST, base, valid_custom)
    check("working custom selectors stay untouched",
          ensured["selectors"] == valid_custom and "discovered" not in ensured)
    partial = {"container": "li.product", "title": ".woocommerce-loop-product__title"}
    ensured = core.ensure_list_selectors(WOO_LIST, base, partial)
    discovered = ensured.get("discovered") or {}
    check("working partial set only fills gaps",
          bool(discovered) and all(k not in partial for k in discovered),
          str(discovered))
    check("gap fill keeps the user's fields",
          ensured["selectors"]["container"] == "li.product"
          and ensured["selectors"]["title"] == partial["title"])

    print("detail selectors")
    suggested = core.suggest_detail_selectors(DETAIL_PAGE, "https://shop.example/p/1")
    for field in ("short_desc", "long_desc", "sku", "brand", "stock", "weight",
                  "category", "tags", "price", "image", "gallery", "variations"):
        check(f"detail {field}", bool(suggested["selectors"].get(field)),
              str(suggested["selectors"]))
    ensured_detail = core.ensure_detail_selectors(
        DETAIL_PAGE, "https://shop.example/p/1", {"sku": ".my-own-sku"})
    check("stale hand-set detail field is repaired",
          ensured_detail["selectors"]["sku"] != ".my-own-sku"
          and bool(ensured_detail["discovered"].get("sku")),
          str(ensured_detail))
    valid_sku = suggested["selectors"]["sku"]
    valid_detail = core.ensure_detail_selectors(
        DETAIL_PAGE, "https://shop.example/p/1", {"sku": valid_sku})
    check("working hand-set detail field stays untouched",
          valid_detail["selectors"]["sku"] == valid_sku
          and "sku" not in valid_detail["discovered"])
    check("empty detail fields filled",
          bool(ensured_detail["discovered"].get("long_desc")))

    print("persist_profile_auto_selectors")
    data = core.load_data()
    data["profiles"]["test"] = {"url": base, "selectors": {}, "detail_selectors": {}}
    core.save_data(data)
    saved = core.persist_profile_auto_selectors(
        "test", {"container": "div.bx-card", "title": "span.ttl"},
        {"long_desc": "#tab-description"})
    check("reports what it saved", bool(saved.get("list")) and bool(saved.get("detail")))
    prof = core.load_data()["profiles"]["test"]
    check("list selectors stored in the profile",
          prof["selectors"].get("container") == "div.bx-card"
          and prof["selectors"].get("title") == "span.ttl", str(prof["selectors"]))
    check("detail selectors stored in the profile",
          prof["detail_selectors"].get("long_desc") == "#tab-description")
    check("discovery timestamp recorded", bool(prof.get("selectors_autodiscovered_at")))

    print("scrape() end-to-end — empty profile selectors (monkeypatched fetch)")
    fixture_by_url = {base: STRUCTURAL_LIST,
                      "https://example.com/p/1": DETAIL_PAGE,
                      "https://shop.example/p/1": DETAIL_PAGE,
                      "https://shop.example/": STRUCTURAL_LIST}

    def fake_get(self, url, *, referer="", accept_json=False, engine="requests"):
        # Longest registered prefix wins, like a real route would.
        for known in sorted(fixture_by_url, key=len, reverse=True):
            if url.startswith(known):
                return core.FetchResult(url=url, text=fixture_by_url[known],
                                        content_type="text/html", status=200)
        raise core.FetchError(f"fixture missing for {url}")

    original_get = core.Fetcher.get
    core.Fetcher.get = fake_get
    try:
        data = core.load_data()
        data["profiles"]["e2e"] = {"url": base, "pages": 1, "selectors": {},
                                   "detail_selectors": {}}
        data["active_profile"] = "e2e"
        core.save_data(data)
        report = core.scrape({"url": base, "pages": 1, "selectors": {},
                              "_profile_name": "e2e"})
        check("products extracted", len(report.products) == 4,
              str(len(report.products)))
        check("discovery logged",
              any("خودکار" in line for line in report.logs), str(report.logs))
        check("discovery diagnostic",
              bool(report.diagnostics.get("selector_discovery", {}).get("selectors")))
        prof = core.load_data()["profiles"]["e2e"]
        check("selectors saved to the profile's manual fields",
              prof["selectors"].get("container") == "div.bx-card"
              and prof["selectors"].get("title") == "span.ttl"
              and prof["selectors"].get("price") == "span.cost",
              json.dumps(prof["selectors"], ensure_ascii=False))
        check("second run treats them as custom",
              core.list_selectors_status(prof["selectors"]) == "custom")
        report2 = core.scrape({"url": base, "pages": 1,
                               "selectors": dict(prof["selectors"]),
                               "_profile_name": "e2e"})
        check("second run still extracts", len(report2.products) == 4)
        check("second run does not re-discover",
              "selector_discovery" not in report2.diagnostics)
    finally:
        core.Fetcher.get = original_get

    print("POST /api/suggest-selectors (ui_bridge endpoint)")
    core.Fetcher.get = fake_get
    try:
        client = core.app.test_client()
        resp = client.post("/api/suggest-selectors",
                           json={"url": base, "mode": "list"})
        payload = resp.get_json() or {}
        check("endpoint responds ok", resp.status_code == 200 and payload.get("ok"),
              f"{resp.status_code} {payload}")
        selectors = payload.get("selectors") or {}
        check("suggests container", selectors.get("container") == "div.bx-card",
              json.dumps(selectors, ensure_ascii=False))
        check("suggests title", selectors.get("title") == "span.ttl")
        check("evidence reports method",
              (payload.get("evidence") or {}).get("discoveryMethod") == "structural")
        resp = client.post("/api/suggest-selectors",
                           json={"url": "https://example.com/p/1", "mode": "detail"})
        payload = resp.get_json() or {}
        selectors = payload.get("selectors") or {}
        check("detail mode uses Node field ids",
              selectors.get("detailImage") == ".woocommerce-product-gallery__image img"
              and selectors.get("longDesc") == "#tab-description"
              and selectors.get("shortDesc"),
              json.dumps(selectors, ensure_ascii=False))
    finally:
        core.Fetcher.get = original_get

    print("POST /api/profiles/<id>/extraction-diagnostic (discovery + auto-save)")
    core.Fetcher.get = fake_get
    try:
        data = core.load_data()
        data["profiles"]["diag"] = {"url": base, "pages": 1, "selectors": {},
                                    "detail_selectors": {}}
        core.save_data(data)
        client = core.app.test_client()
        resp = client.post("/api/profiles/diag/extraction-diagnostic", json={})
        payload = resp.get_json() or {}
        stages = {s["name"]: s for s in payload.get("stages") or []}
        # 10.246: ok mirrors the pipeline's health (a failing pagination stage
        # on this fixture used to be masked by a hardcoded ok=true).
        check("diagnostic responds (ok mirrors stage health since 10.246)",
              resp.status_code == 200 and bool(payload.get("stages"))
              and payload.get("ok") == all(s.get("ok") for s in payload["stages"]),
              f"{resp.status_code} {str(payload)[:200]}")
        check("diagnostic report carries the copy-format fields",
              isinstance(payload.get("productCount"), int)
              and payload.get("productCount", 0) > 0
              and isinstance(payload.get("durationMs"), int)
              and payload.get("url") == base
              and isinstance(payload.get("usedEngine"), str),
              f"{payload.get('productCount')} {payload.get('durationMs')} "
              f"{payload.get('url')} {payload.get('usedEngine')}")
        check("selector-discovery stage", stages.get("selector-discovery", {}).get("ok"),
              json.dumps(stages.get("selector-discovery"), ensure_ascii=False))
        check("selectors-auto-saved stage",
              stages.get("selectors-auto-saved", {}).get("ok"),
              json.dumps(stages.get("selectors-auto-saved"), ensure_ascii=False))
        prof = core.load_data()["profiles"]["diag"]
        check("diagnostic saved selectors into the profile",
              prof["selectors"].get("container") == "div.bx-card",
              json.dumps(prof["selectors"], ensure_ascii=False))
    finally:
        core.Fetcher.get = original_get

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): " + ", ".join(FAILURES))
        return 1
    print("OK: all auto-selector discovery checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
