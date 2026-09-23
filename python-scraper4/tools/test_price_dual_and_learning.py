#!/usr/bin/env python3
"""Regression tests for the 10.241 price/selector/picker work.

Run with the project dependencies installed:

    python3 tools/test_price_dual_and_learning.py

Covers the three promises of the release:

1. extract_price no longer merges the two prices of a discounted product
   (struck-through original + actual) into one huge integer or the old
   original price — the ACTUAL (last) price wins everywhere, engine-agnostic.
2. After a successful extraction with any engine, the profile's MANUAL list
   selectors are refreshed from that verified page (complete verified sets
   only; identical sets and partial guesses never overwrite).
3. render_playwright neutralises ad popups (context page guard), JS dialogs,
   window.open, and — for the visual picker — strips full-viewport ad
   overlays before the HTML snapshot.

No network is used: local fixtures only (the AGENTS.md rule).
"""
from __future__ import annotations

import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

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

EMPTY_PAGE = "<html><body><p>هیچ محصولی اینجا نیست</p></body></html>"

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ✓ {name}")
    else:
        FAILURES.append(name)
        print(f"  ✕ {name}" + (f" — {detail}" if detail else ""))


def main() -> int:
    tmpdir = tempfile.mkdtemp(prefix="s4-test-241-")
    os.environ["SCRAPER_DATA_FILE"] = os.path.join(tmpdir, "scraper4_data.json")
    import scraper4 as core  # noqa: E402 - env must be set before import

    print("== A: extract_price keeps the ACTUAL price of discounted products ==")
    ep = core.extract_price
    # The exact user-reported bug: original + actual in one element.
    check("two currency matches → last (actual)",
          ep("۱٬۵۰۰٬۰۰۰ تومان ۱٬۲۰۰٬۰۰۰ تومان") == "1٬200٬000 تومان",
          ep("۱٬۵۰۰٬۰۰۰ تومان ۱٬۲۰۰٬۰۰۰ تومان"))
    check("latin digits, two currency matches → last",
          ep("1,500,000 T 1,200,000 تومان") == "1,200,000 تومان",
          ep("1,500,000 T 1,200,000 تومان"))
    # One blob swallowing both numbers (the "huge number" case).
    got = ep("1,500,000 1,200,000 تومان")
    check("swallowed blob → actual price, not 15000001200000",
          got == "1,200,000 تومان", got)
    got = ep("۱٬۵۰۰٬۰۰۰ ۱٬۲۰۰٬۰۰۰ تومان")
    check("persian-digit swallowed blob → actual",
          got == "1٬200٬000 تومان", got)
    # No-currency fallback must not glue the two numbers either.
    got = ep("1,500,000 1,200,000")
    check("grouped fallback → actual price", got == "1,200,000 تومان", got)
    # Space-separated thousands stay ONE number.
    got = ep("1 500 000 تومان")
    check("space-thousands single price intact", got == "1 500 000 تومان", got)
    # Single prices and ranges behave exactly like before.
    check("single price unchanged", ep("۱٬۲۰۰٬۰۰۰ تومان") == "1٬200٬000 تومان",
          ep("۱٬۲۰۰٬۰۰۰ تومان"))
    check("single latin price unchanged", ep("990,000 تومان") == "990,000 تومان",
          ep("990,000 تومان"))
    check("price range still → max", ep("از 500,000 تا 900,000 تومان") == "900,000 تومان",
          ep("از 500,000 تا 900,000 تومان"))
    check("no price → empty", ep("بدون قیمت") == "")

    print("== B: manual selectors refresh after a successful extraction ==")
    data = core.load_data()
    data.setdefault("profiles", {})["shop-a"] = {
        "selectors": {"container": ".products li", "title": ".some-hand-tuned",
                      "price": ".price", "link": "a", "image": "img"},
    }
    data.setdefault("profiles", {})["shop-b"] = {"selectors": {}}
    core.save_data(data)

    res = core.refresh_manual_selectors_after_success(
        "shop-a", "https://example.com/list", WOO_LIST,
        core.load_data()["profiles"]["shop-a"]["selectors"])
    check("refresh discovered a verified set", bool(res.get("saved")), str(res)[:120])
    check("discovery is complete (container+title)",
          bool(res.get("selectors", {}).get("container")) and bool(res.get("selectors", {}).get("title")))
    stored_now = core.load_data()["profiles"]["shop-a"]["selectors"]
    check("profile manual selectors were overwritten",
          all(stored_now.get(k) == v for k, v in res.get("selectors", {}).items()),
          str({k: stored_now.get(k) for k in res.get("selectors", {})})[:160])
    check("autodiscovery timestamp set",
          bool(core.load_data()["profiles"]["shop-a"].get("selectors_autodiscovered_at")))

    res2 = core.refresh_manual_selectors_after_success(
        "shop-a", "https://example.com/list", WOO_LIST, stored_now)
    check("identical set → no write", res2 == {}, str(res2)[:120])

    res3 = core.refresh_manual_selectors_after_success(
        "shop-b", "https://example.com/list", WOO_LIST,
        core.load_data()["profiles"]["shop-b"]["selectors"])
    check("broken/empty set is repaired too", bool(res3.get("saved")), str(res3)[:120])

    res4 = core.refresh_manual_selectors_after_success(
        "shop-a", "https://example.com/list", EMPTY_PAGE, stored_now)
    check("product-less page → nothing learned", res4 == {}, str(res4)[:120])
    check("profile untouched after empty page",
          core.load_data()["profiles"]["shop-a"]["selectors"] == stored_now)

    print("== C: playwright popup/dialog/overlay guards ==")
    src = open(os.path.join(ROOT, "scraper4.py"), encoding="utf-8").read()
    check("context popup guard installed", 'page.context.on("page", _s4_popup_guard)' in src)
    check("dialogs dismissed", 'page.on("dialog", _s4_dialog_guard)' in src)
    check("window.open disarmed", 'window.open=function(){return null}' in src)
    check("strip_overlays parameter exists", "strip_overlays: bool = False" in src)
    check("picker passes strip_overlays=True (3 call sites)",
          src.count("render_playwright(url, timeout, scrolls, strip_overlays=True)") == 3,
          str(src.count("strip_overlays=True")))
    check("overlay strip runs before the snapshot",
          src.find("if strip_overlays:") < src.find("html = page.content();"))
    check("extraction path keeps overlays (default False)",
          "return render_playwright(url, timeout, scrolls)\n        except FetchError as exc:\n            msg" not in src)
    check("scrape() refresh hook present",
          "refresh_manual_selectors_after_success(profile_name,url,page_html,selectors)" in src)

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILED: " + ", ".join(FAILURES))
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
