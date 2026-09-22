#!/usr/bin/env python3
"""Pagination parity regression tests (10.225).

Guards the contract: the 3-page speed test, the extraction diagnostic and the
REAL scrape() must agree about pagination. Before 10.225 a profile saved with
the Node vocabulary ``next_selector`` (or ``pages=0`` = automatic) passed the
3-page tests while a real extraction silently stopped after page 1.

Runs a local mock shop and drives the real scraper4.scrape() plus the real
Flask endpoints. Plain asserts; exit code 0 = all good.

    python3 tools/test_pagination_parity.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

spec = importlib.util.spec_from_file_location("scraper4", os.path.join(ROOT, "scraper4.py"))
core = importlib.util.module_from_spec(spec)
sys.modules["scraper4"] = core
spec.loader.exec_module(core)

# Allow the local mock (the SSRF guard otherwise refuses loopback hosts).
core.public_http_url = lambda u: (u or "").strip()

# Isolated data file so the test never touches a real profile bank.
_tmpdir = tempfile.mkdtemp(prefix="scraper4-parity-")
core.DATA_FILE = os.path.join(_tmpdir, "data.json")

PORT = 8977
PER_PAGE = 12
TOTAL_PAGES = 5
SELECTORS = {"container": "li.product", "title": "h2", "price": ".price",
             "link": "a[href]", "image": "img"}


def products_html(page: int) -> str:
    if page > TOTAL_PAGES:
        return ""
    return "".join(
        f'<li class="product"><h2>محصول {i}</h2><span class="price">{1000 + i}</span>'
        f'<a href="/p/{i}">link</a><img src="/img/{i}.jpg"/></li>'
        for i in range((page - 1) * PER_PAGE, page * PER_PAGE))


class MockShop(BaseHTTPRequestHandler):
    """emalls-style shop: /shop~Category~31424[~page~N].

    mode "honest": ~page~N really serves page N; every page except the last
                   carries <a class="next"> to the following page.
    mode "dup":    the site IGNORES the ~page~ suffix and always serves page 1.
    mode "single": one page, no pagination markup at all.
    """
    mode = "honest"

    def log_message(self, *a):  # silence
        pass

    def do_GET(self):  # noqa: N802
        path = unquote(self.path)
        if MockShop.mode == "single":
            rows = products_html(1)
            body = (f'<!doctype html><html><head><meta charset="utf-8"></head><body>'
                    f'<ul class="products">{rows}</ul></body></html>').encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        m = re.search(r"~page~(\d+)", path)
        page = int(m.group(1)) if m else 1
        effective = 1 if (MockShop.mode == "dup" and page > 1) else page
        rows = products_html(effective)
        next_link = ""
        if MockShop.mode == "honest" and effective < TOTAL_PAGES and effective >= 1:
            next_link = f'<a class="next" href="/shop~Category~31424~page~{effective + 1}">بعدی</a>'
        nav = "".join(f'<a class="page-link" href="/shop~Category~31424~page~{n}">{n}</a>'
                      for n in range(1, TOTAL_PAGES + 1))
        body = (f'<!doctype html><html><head><meta charset="utf-8"></head><body>'
                f'<ul class="products">{rows}</ul>'
                f'<nav class="pagination">{nav}{next_link}</nav></body></html>').encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


_server = None


def start_shop(mode: str) -> None:
    global _server
    MockShop.mode = mode
    if _server is None:
        _server = ThreadingHTTPServer(("127.0.0.1", PORT), MockShop)
        threading.Thread(target=_server.serve_forever, daemon=True).start()


def scrape_cfg(pagination: str, page_value: str, pages, url: str | None = None) -> dict:
    return {
        "url": url or f"http://127.0.0.1:{PORT}/shop~Category~31424",
        "pages": pages,
        "pagination": pagination,
        "page_value": page_value,
        "render": "auto",
        "fetch_engine": "requests",
        "selectors": dict(SELECTORS),
        "enrich": False,
        "scrolls": 0,
    }


def run_scrape(label: str, **kw) -> core.ScrapeReport:
    rep = core.scrape(scrape_cfg(**kw))
    print(f"  [scrape] {label}: pages={rep.pages} products={len(rep.products)}")
    return rep


def save_profile(pid: str, pagination: str, page_value: str, pages, mode: str) -> None:
    """Store a profile the way the Node dashboard would (Node vocabulary)."""
    client = core.app.test_client()
    body = {
        "id": pid, "name": pid, "url": f"http://127.0.0.1:{PORT}/shop~Category~31424",
        "enabled": True, "pages": pages, "pagination": pagination,
        "paginationValue": page_value, "extractionEngine": "requests",
        "selectors": dict(SELECTORS),
    }
    resp = client.post("/api/profiles", data=json.dumps(body), content_type="application/json")
    assert resp.status_code == 200, f"save profile failed: {resp.status_code} {resp.get_data(as_text=True)[:200]}"
    stored = core.load_data()["profiles"][pid]
    assert stored["pagination"] == pagination, f"stored pagination = {stored['pagination']}"
    print(f"  [profile] {pid}: stored pages={stored['pages']} pagination={stored['pagination']} page_value={stored['page_value']}")


def benchmark_report(pid: str) -> dict:
    client = core.app.test_client()
    resp = client.post(f"/api/profiles/{pid}/benchmark-engines", data="{}", content_type="application/json")
    assert resp.status_code == 200, f"benchmark failed: {resp.status_code}"
    return resp.get_json()


def diagnostic_report(pid: str) -> dict:
    client = core.app.test_client()
    resp = client.post(f"/api/profiles/{pid}/extraction-diagnostic", data="{}", content_type="application/json")
    assert resp.status_code == 200, f"diagnostic failed: {resp.status_code}"
    return resp.get_json()


PASS = 0


def check(label: str, condition: bool, detail: str = "") -> None:
    global PASS
    if not condition:
        raise AssertionError(f"FAIL: {label} {detail}")
    PASS += 1
    print(f"  ✓ {label}")


def main() -> int:
    print("== A: tilde-path pagination, honest site ==")
    start_shop("honest")
    rep = run_scrape("path pages=3", pagination="path", page_value="~page~{page}", pages=3)
    check("3 configured pages are really scraped", len(rep.products) == 3 * PER_PAGE and rep.pages >= 3)
    rep = run_scrape("path pages=10", pagination="path", page_value="~page~{page}", pages=10)
    check("pages=10 walks the whole catalogue (5 real pages)", len(rep.products) == TOTAL_PAGES * PER_PAGE,
          f"got {len(rep.products)}")
    rep = run_scrape("auto pages=0", pagination="path", page_value="~page~{page}", pages=0)
    check("pages=0 (automatic) walks the whole catalogue", len(rep.products) == TOTAL_PAGES * PER_PAGE,
          f"got {len(rep.products)}")
    check("automatic mode is announced in the log", any("اتوماتیک" in x for x in rep.logs))

    print("== B: site replays page 1 (ignores the pattern) ==")
    start_shop("dup")
    rep = run_scrape("dup site pages=10", pagination="path", page_value="~page~{page}", pages=10)
    check("extraction keeps only the 1 real page", len(rep.products) == PER_PAGE, f"got {len(rep.products)}")
    stop = rep.diagnostics.get("pagination_stopped") or {}
    check("stop reason is recorded (no-new-products)", stop.get("reason") == "no-new-products", str(stop))
    check("stop diagnostics carry the page URL", bool(stop.get("url")))

    print("== C: next_selector (Node vocabulary) must follow real next links ==")
    start_shop("honest")
    rep = run_scrape("next_selector pages=10", pagination="next_selector", page_value="a.next", pages=10)
    check("next_selector walks all 5 pages", len(rep.products) == TOTAL_PAGES * PER_PAGE, f"got {len(rep.products)}")
    rep = run_scrape("next pages=10 (python vocab)", pagination="next", page_value="a.next", pages=10)
    check("next walks all 5 pages too", len(rep.products) == TOTAL_PAGES * PER_PAGE, f"got {len(rep.products)}")
    rep = run_scrape("next with custom selector missing → default fallback",
                     pagination="next_selector", page_value="a.does-not-exist", pages=10)
    check("default next selectors are probed after the custom one",
          len(rep.products) == TOTAL_PAGES * PER_PAGE, f"got {len(rep.products)}")

    print("== D: none / scroll are single-page (like the tests) ==")
    start_shop("honest")
    for kind in ("none", "scroll"):
        rep = run_scrape(f"{kind} pages=10", pagination=kind, page_value="page", pages=10)
        check(f"{kind} stops after page 1", len(rep.products) == PER_PAGE, f"got {len(rep.products)}")
        stop = rep.diagnostics.get("pagination_stopped") or {}
        check(f"{kind} records single-page-mode", stop.get("reason") == "single-page-mode", str(stop))

    print("== D2: auto-detection ==")
    start_shop("honest")
    rep = run_scrape("auto detects tilde-path", pagination="auto", page_value="page", pages=10)
    check("auto mode walks all 5 pages after detecting ~page~",
          len(rep.products) == TOTAL_PAGES * PER_PAGE, f"got {len(rep.products)}")
    check("auto detection was logged", any("تشخیص داده شد" in x for x in rep.logs))
    start_shop("single")
    rep = run_scrape("auto on a single-page site", pagination="auto", page_value="page", pages=10)
    check("auto stops after page 1 when nothing is detected",
          len(rep.products) == PER_PAGE, f"got {len(rep.products)}")
    stop = rep.diagnostics.get("pagination_stopped") or {}
    check("single-page stop is recorded", stop.get("reason") == "single-page-mode", str(stop))

    print("== E: dashboard parity — pages=0 must survive the round-trip ==")
    start_shop("dup")
    save_profile("dup-site", "path_pattern", "~page~{page}", 0, "dup")
    stored = core.load_data()["profiles"]["dup-site"]
    check("pages=0 stored as 0 (automatic), not clamped to 1", stored.get("pages") == 0, str(stored.get("pages")))
    node_view = core.app.test_client().get("/api/profiles").get_json()
    dup_node = next(p for p in node_view["profiles"] if p["id"] == "dup-site")
    check("dashboard sees pages=0 back", dup_node.get("pages") == 0, str(dup_node.get("pages")))

    print("== F: 3-page benchmark and diagnostic must now FAIL on the dup site ==")
    bench = benchmark_report("dup-site")
    rows = bench.get("results") or []
    good = [r for r in rows if r.get("engine") == "requests"]
    check("benchmark ran the requests engine", bool(good), str([r.get('engine') for r in rows]))
    row = good[0]
    check("benchmark flags the replaying site (no new products)",
          (not row.get("ok")) and "تازه" in (row.get("paginationError") or row.get("error") or ""),
          str(row.get("error"))[:160])
    diag = diagnostic_report("dup-site")
    pag_stage = next((s for s in diag.get("stages", []) if s.get("name") == "pagination"), {})
    check("diagnostic pagination stage fails on the dup site", pag_stage.get("ok") is False,
          str(pag_stage.get("summary"))[:160])
    check("diagnostic explains the replay in plain words",
          "تازه" in str(pag_stage.get("summary") or "") or any("تازه" in str(d) for d in pag_stage.get("details", [])),
          str(pag_stage.get("details"))[:200])

    print("== G: benchmark stays GREEN on the honest site (with per-page new counts) ==")
    start_shop("honest")
    save_profile("honest-site", "path_pattern", "~page~{page}", 0, "honest")
    bench = benchmark_report("honest-site")
    row = next(r for r in (bench.get("results") or []) if r.get("engine") == "requests")
    check("benchmark passes on the honest site", row.get("ok") is True, str(row.get("error"))[:160])
    details = row.get("pageDetails") or []
    check("per-page NEW product counts are reported",
          len(details) == 3 and all(d.get("new") == PER_PAGE for d in details), str(details))
    stored = core.load_data()["profiles"]["honest-site"]
    check("benchmark saved the winning engine as master", stored.get("fetch_engine_master") == "requests",
          str(stored.get("fetch_engine_master")))
    check("benchmark saved the profile host next to the master (10.226)",
          stored.get("fetch_engine_host") == "127.0.0.1", str(stored.get("fetch_engine_host")))

    print("== H: anti-bot reorder must respect the proven master (emalls, 10.226) ==")
    plain = ["requests", "httpx", "curl_cffi", "cloudscraper"]
    reordered = core._prefer_anti_bot_order("https://emalls.ir/لیست~Category~30268", list(plain))
    check("proven master (requests) keeps the lead on emalls", reordered[0] == "requests", str(reordered))
    check("anti-bot engines follow right after the master",
          reordered[1:3] == ["curl_cffi", "cloudscraper"], str(reordered))
    check("non-anti-bot hosts keep the untouched chain",
          core._prefer_anti_bot_order("https://example.com/shop", list(plain)) == plain)
    lead_cffi = core._prefer_anti_bot_order("https://emalls.ir/x", ["curl_cffi", "cloudscraper", "requests"])
    check("a curl_cffi master stays first too", lead_cffi[0] == "curl_cffi", str(lead_cffi))
    rep = run_scrape("chain visible in logs", pagination="path", page_value="~page~{page}", pages=2)
    check("engine chain is logged at the start of a real run",
          any("زنجیرهٔ موتورهای دریافت" in x for x in rep.logs))

    print(f"\nALL {PASS} CHECKS PASSED")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
