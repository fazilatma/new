#!/usr/bin/env python3
"""Regression tests for 10.252 — the Node.js lessons (arena/01a0aa17-new):

* detail extraction runs through a parallel window (Node mapLimit) with the
  browser engines kept sequential (withBrowserSlot),
* source fetches honour Retry-After on 429 (Node retryAfterMs),
* unchanged products are skipped on dispatch with ZERO HTTP (Node ledger
  'unchanged'), per Basalam stall, and force-update always sends.

    python3 tools/test_node_lessons.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

for var in ("GITHUB_TOKEN", "GH_TOKEN"):
    os.environ.pop(var, None)
os.environ["SCRAPER4_AUTO_INSTALL"] = "0"

FAILURES: list[str] = []


def check(name: str, cond, detail: str = "") -> None:
    if cond:
        print(f"  ✓ {name}")
    else:
        FAILURES.append(name)
        print(f"  ✕ {name}" + (f" — {detail}" if detail else ""))


STATE = {"lock": threading.Lock(), "detail_active": 0, "detail_max": 0,
         "rt_hits": 0, "rt2_hits": 0, "delay": 0.15}


def reset_state(**over):
    with STATE["lock"]:
        STATE["detail_active"] = 0
        STATE["detail_max"] = 0
        STATE["rt_hits"] = 0
        STATE["rt2_hits"] = 0
    STATE.update(over)


LIST_PAGE = """<html><body>{cards}</body></html>"""


def card(i: int) -> str:
    return (f'<div class="card"><a href="/p/{i}"><img class="img" src="/i/{i}.jpg">'
            f'<span class="title">کفش {i}</span></a>'
            f'<span class="price">{1000000 + i} تومان</span></div>')


def detail_page(i: int) -> str:
    return (f'<html><body><h1>کفش {i}</h1>'
            f'<div itemprop="description">توضیح کامل محصول {i} با جزئیات بالا</div>'
            f'<img src="/i/{i}.jpg"><img src="/i/{i}b.jpg"></body></html>')


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def _send(self, code: int, body: str, headers: dict | None = None) -> None:
        raw = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):  # noqa: N802
        path = urlparse(self.path).path
        if path == "/list":
            self._send(200, LIST_PAGE.format(cards="".join(card(i) for i in range(1, 6))))
            return
        if path.startswith("/p/"):
            with STATE["lock"]:
                STATE["detail_active"] += 1
                STATE["detail_max"] = max(STATE["detail_max"], STATE["detail_active"])
            try:
                time.sleep(STATE["delay"])
                self._send(200, detail_page(int(path.rsplit("/", 1)[1])))
            finally:
                with STATE["lock"]:
                    STATE["detail_active"] -= 1
            return
        if path == "/rt":
            with STATE["lock"]:
                STATE["rt_hits"] += 1
                hit = STATE["rt_hits"]
            if hit == 1:
                self._send(429, "slow down", {"Retry-After": "0"})
            else:
                self._send(200, "ok now")
            return
        if path == "/rt2":
            with STATE["lock"]:
                STATE["rt2_hits"] += 1
            self._send(429, "always throttled", {"Retry-After": "0"})
            return
        self._send(404, "not found")


class FakeWooResponse:
    ok = True
    status_code = 200
    text = "{}"

    def __init__(self, payload=None):
        self._payload = payload or {"id": 123, "name": "n"}

    def json(self):
        return self._payload


def wait_task(core, task_id: str, timeout: float = 40.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        task = core.live_task_read(task_id)
        if task and task.get("status") in {"completed", "failed", "cancelled", "interrupted"}:
            return task
        time.sleep(0.05)
    return core.live_task_read(task_id) or {}


def main() -> int:
    tmpdir = tempfile.mkdtemp(prefix="s4-node-252-")
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()

    os.environ["SCRAPER_DATA_FILE"] = os.path.join(tmpdir, "data.json")
    spec = importlib.util.spec_from_file_location("scraper4", os.path.join(ROOT, "scraper4.py"))
    core = importlib.util.module_from_spec(spec)
    sys.modules["scraper4"] = core
    spec.loader.exec_module(core)
    core.DATA_FILE = os.environ["SCRAPER_DATA_FILE"]
    core.ERROR_LOG_PATH = os.path.join(tmpdir, "errors.jsonl")
    core.LIVE_TASK_DIR = os.path.join(tmpdir, "tasks")
    os.makedirs(core.LIVE_TASK_DIR, exist_ok=True)
    real_public = core.public_http_url
    core.public_http_url = lambda url: str(url)

    def write_data(**over):
        data = {"network": {"gap_ms": 40}, "basalam": {
            "vendor_id": 7, "token": "tk", "category_id": 5,
            "update_existing": True}}
        data.update(over)
        with open(core.DATA_FILE, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False)

    write_data()
    base = f"http://127.0.0.1:{port}"

    try:
        print("== A: parallel detail extraction (Node mapLimit) ==")
        core.DETAIL_CONCURRENCY = 4
        reset_state(delay=0.15)
        config = {"url": base + "/list", "pages": 1,
                  "selectors": {"container": ".card", "title": ".title",
                                "price": ".price", "link": "a", "image": ".img"},
                  "detail_selectors": {}, "enrich": True, "render": "auto",
                  "fetch_engine": "auto"}
        t0 = time.time()
        report = core.scrape(config)
        elapsed = time.time() - t0
        details = (report.diagnostics or {}).get("details") or {}
        check("A1 five products listed", len(report.products) == 5,
              str(len(report.products)))
        check("A2 all five details enriched", details.get("completed") == 5
              and details.get("failed") == 0, str(details))
        check("A3 detail fetches really ran in parallel",
              STATE["detail_max"] >= 2, f"max_active={STATE['detail_max']}")
        check("A4 window cap respected", STATE["detail_max"] <= 4,
              f"max_active={STATE['detail_max']}")
        check("A5 much faster than sequential", elapsed < 5 * 0.15,
              f"{elapsed:.2f}s")
        enriched_rows = [p for p in report.products.values()
                         if p.get("long_desc") or p.get("short_desc")]
        check("A6 detail content actually extracted", len(enriched_rows) == 5,
              str(len(enriched_rows)))

        print("== B: sequential window at DETAIL_CONCURRENCY=1 ==")
        core.DETAIL_CONCURRENCY = 1
        reset_state(delay=0.05)
        report = core.scrape(config)
        details = (report.diagnostics or {}).get("details") or {}
        check("B1 still enriches everything", details.get("completed") == 5,
              str(details))
        check("B2 strictly sequential when concurrency=1",
              STATE["detail_max"] == 1, f"max_active={STATE['detail_max']}")
        core.DETAIL_CONCURRENCY = 4

        print("== C: Retry-After honoured on 429 ==")
        fetcher = core.Fetcher({"timeout": 10, "gap_ms": 0})
        reset_state()
        result = fetcher.get(base + "/rt", engine="requests")
        check("C1 one 429 then success", result.status == 200
              and STATE["rt_hits"] == 2, f"hits={STATE['rt_hits']}")
        t0 = time.time()
        try:
            fetcher.get(base + "/rt2", engine="requests")
            check("C2 permanent 429 fails after retries", False, "no error")
        except core.FetchError as exc:
            check("C2 permanent 429 fails after retries",
                  STATE["rt2_hits"] == 3 and "HTTP 429" in str(exc),
                  f"hits={STATE['rt2_hits']} err={str(exc)[:80]}")
        check("C3 retries waited the Retry-After window (≥0.5s each)",
              time.time() - t0 >= 1.0, f"{time.time() - t0:.2f}s")

        print("== D: WooCommerce unchanged skip (zero HTTP) ==")
        real_woo_request = core.woo_request
        calls: list[str] = []

        def fake_woo_request(method, endpoint, payload=None):
            calls.append(f"{method} {endpoint}")
            return FakeWooResponse()

        core.woo_request = fake_woo_request
        try:
            product = {"title": "کتونی آبی", "price": "2,000,000 تومان",
                       "sku": "SKU-1", "link": "https://example.com/p/1"}
            sig = core._destination_payload_signature(
                core.woo_product_payload(product, "draft"))
            product["_destination_id"] = 123
            product["_destination_sig"] = sig
            out = core.woo_send_one(product, "draft", True)
            check("D1 unchanged product skipped with zero HTTP",
                  out.get("action") == "unchanged" and out.get("id") == 123
                  and calls == [], f"calls={calls} out={out}")

            changed = dict(product)
            changed["price"] = "2,500,000 تومان"
            out = core.woo_send_one(changed, "draft", True)
            check("D2 changed product still sends",
                  out.get("action") == "updated" and len(calls) == 1
                  and calls[0].startswith("PUT products/123"),
                  f"calls={calls}")
            check("D3 result carries the new signature",
                  core._destination_payload_signature(
                      core.woo_product_payload(changed, "draft")) == out.get("sig"))

            forced = dict(product)
            forced["_force_destination_update"] = True
            out = core.woo_send_one(forced, "draft", True)
            check("D4 force-update always sends",
                  out.get("action") == "updated" and len(calls) == 2)
        finally:
            core.woo_request = real_woo_request

        print("== E: Basalam per-stall unchanged skip (zero HTTP) ==")
        real_sdk = core.basalam_send_one_sdk
        real_api = core.basalam_send_one_api

        def must_not_send(*args, **kwargs):
            raise AssertionError("sender was called for an unchanged product")

        core.basalam_send_one_sdk = must_not_send
        core.basalam_send_one_api = must_not_send
        try:
            product = {"title": "کتونی قرمز", "price": "3,000,000 تومان",
                       "sku": "BSL-1", "basalam_category_id": 5,
                       "stock": "2"}
            shop7 = {"vendor_id": 7, "shop_name": "غرفه ۷", "is_default": True,
                     "price_mode": "none"}
            item = core.bsl_apply_shop_price(product, shop7)
            cfg = {"vendor_id": 7, "token": "tk", "category_id": 5}
            sig7 = core._destination_payload_signature(
                core.basalam_rest_payload(item, cfg, 5, "BSL-1"))
            product["_bsl_shop_sigs"] = {"7": sig7}
            product["_bsl_shop_ids"] = {"7": 555}
            out = core.basalam_send_one(product, shop7)
            check("E1 unchanged stall skipped with zero HTTP",
                  out.get("action") == "unchanged" and out.get("id") == 555
                  and out.get("client") == "skip", str(out))

            shop8 = {"vendor_id": 8, "shop_name": "غرفه ۸",
                     "price_mode": "none"}
            cfg8 = {"vendor_id": 8, "token": "tk", "category_id": 5}
            sig8 = core._destination_payload_signature(
                core.basalam_rest_payload(item, cfg8, 5, "BSL-1"))
            product["_bsl_shop_sigs"] = {"7": sig7, "8": sig8}
            product["_bsl_shop_ids"] = {"7": 555, "8": 666}
            rows = core.basalam_send_to_shops(product, [shop7, shop8], "parallel")
            check("E2 fanout skips every unchanged stall",
                  len(rows) == 2 and all(r.get("ok") and r.get("action") == "unchanged"
                                         for r in rows), str(rows))

            stale = dict(product)
            stale["_bsl_shop_sigs"] = {"7": "old-signature"}
            core.basalam_send_one_sdk = lambda p: {"id": 777, "action": "updated"}
            out = core.basalam_send_one(stale, shop7)
            check("E3 stale signature sends again and returns a fresh one",
                  out.get("action") == "updated" and out.get("id") == 777
                  and out.get("sig") == sig7, str(out))
        finally:
            core.basalam_send_one_sdk = real_sdk
            core.basalam_send_one_api = real_api

        print("== F: dispatch round trip — first send, then skip ==")
        products = [{"title": f"محصول {i}", "price": f"{1000000 + i} تومان",
                     "link": f"https://example.com/x/{i}",
                     "source_key": f"k{i}", "sku": f"SK{i}"} for i in range(1, 3)]

        def make_profile(pid, rows):
            write_data()
            data = json.load(open(core.DATA_FILE, encoding="utf-8"))
            data["profiles"] = {pid: {"name": pid, "url": "https://example.com",
                                      "saved_products": rows}}
            json.dump(data, open(core.DATA_FILE, "w", encoding="utf-8"),
                      ensure_ascii=False)

        # -- Basalam: send once, then everything is unchanged
        make_profile("bsl-rt", [dict(p) for p in products])
        core.basalam_send_one_sdk = lambda p: {"id": 777, "action": "created"}
        task = core.start_profile_dispatch("bsl-rt", {"destinations": ["basalam"]})
        final = wait_task(core, task["id"])
        check("F1 first basalam dispatch completes",
              final.get("status") == "completed" and final.get("sent") == 2,
              json.dumps({k: final.get(k) for k in ("status", "sent", "failed")}))
        core.basalam_send_one_sdk = must_not_send
        core.basalam_send_one_api = must_not_send
        task = core.start_profile_dispatch("bsl-rt", {"destinations": ["basalam"]})
        final = wait_task(core, task["id"])
        log_events = [row.get("event") for row in (final.get("log") or [])]
        check("F2 second basalam dispatch skips everything",
              final.get("status") == "completed" and final.get("unchanged") == 2
              and final.get("sent") == 0,
              json.dumps({k: final.get(k) for k in ("status", "unchanged", "sent")}))
        check("F3 unchanged live events recorded",
              log_events.count("sync-unchanged") == 2, str(log_events))
        details_text = " | ".join(d.get("text", "") for d in (final.get("details") or []))
        check("F4 completion detail mentions the skips",
              "بدون تغییر" in details_text, details_text[-160:])
        ledger = core.load_data()["profiles"]["bsl-rt"]["remote_map"]["basalam"]
        check("F5 signatures stored per stall in the ledger",
              ledger and all("shop_sigs" in row and "shop_ids" in row
                             for row in ledger.values()), str(ledger)[:150])

        # -- WooCommerce: send once, then skip
        make_profile("woo-rt", [dict(p) for p in products])
        core.woo_request = fake_woo_request
        calls.clear()
        task = core.start_profile_dispatch("woo-rt", {"destinations": ["woocommerce"]})
        final = wait_task(core, task["id"])
        check("F6 first woo dispatch sends",
              final.get("status") == "completed" and final.get("sent") == 2
              and sum(1 for c in calls if c.startswith("POST")) == 2,
              f"calls={calls}")

        def woo_must_not_send(*args, **kwargs):
            raise AssertionError("woo_request was called for an unchanged product")

        core.woo_request = woo_must_not_send
        task = core.start_profile_dispatch("woo-rt", {"destinations": ["woocommerce"]})
        final = wait_task(core, task["id"])
        check("F7 second woo dispatch skips everything",
              final.get("status") == "completed" and final.get("unchanged") == 2
              and final.get("sent") == 0,
              json.dumps({k: final.get(k) for k in ("status", "unchanged", "sent")}))
        core.woo_request = real_woo_request
    finally:
        core.public_http_url = real_public
        server.shutdown()

    print("== G: wiring ==")
    s4 = open(os.path.join(ROOT, "scraper4.py"), encoding="utf-8").read()
    js = open(os.path.join(ROOT, "ui", "dashboard.js"), encoding="utf-8").read()
    check("G1 detail window implemented",
          "_detail_one" in s4 and 'thread_name_prefix="detail-live"' in s4
          and "SCRAPER4_DETAIL_CONCURRENCY" in s4)
    check("G2 browser engines share one slot",
          "_DETAIL_BROWSER_LOCK" in s4 and "_detail_stealth" in s4)
    check("G3 Retry-After parsing present", "Retry-After" in s4
          and "parsedate_to_datetime" in s4)
    check("G4 payload signature + ledger helpers",
          "_destination_payload_signature" in s4
          and "destination_identity_entry" in s4)
    check("G5 per-stall signatures recorded",
          'shop_sigs' in s4 and 'shop_ids' in s4)
    check("G6 unchanged counter + events",
          "sync-unchanged" in s4 and 'unchanged=0' in s4)
    check("G7 dashboard shows unchanged rows",
          "sync-unchanged" in js and "بدون تغییر" in js)

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): " + ", ".join(FAILURES))
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
