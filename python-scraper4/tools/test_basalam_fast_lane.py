#!/usr/bin/env python3
"""Regression tests for 10.251: the fast Basalam read lane.

A real local threaded HTTP server plays the Basalam OpenAPI and proves:
keep-alive (one client port reused across calls), the parallel page window,
429 retry, adaptive window reduction, page-1 failure, unknown-metadata
probing, partial results, the end-to-end destination_remote_rows path, the
SDK client cache and REST-first reads in auto mode.

    python3 tools/test_basalam_fast_lane.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import sys
import tempfile
import threading
import time
import types
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

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


# ── fake Basalam OpenAPI server ────────────────────────────────────────────
STATE: dict = {
    "lock": threading.Lock(), "active": 0, "max_active": 0,
    "ports": set(), "requests": 0, "pages": [], "hits": {},
    "fail_first": {}, "fail_always": set(), "no_meta": False,
    "delay": 0.12, "total": 350, "token": "test-token",
}


def reset_state(**over) -> None:
    with STATE["lock"]:
        STATE["active"] = 0
        STATE["max_active"] = 0
        STATE["ports"] = set()
        STATE["requests"] = 0
        STATE["pages"] = []
        STATE["hits"] = {}
        STATE["fail_first"] = {}
        STATE["fail_always"] = set()
        STATE["no_meta"] = False
        STATE["total"] = 350
    STATE.update(over)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"  # keep-alive

    def log_message(self, *args):
        pass

    def _send(self, code: int, payload: dict) -> None:
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):  # noqa: N802 - BaseHTTPRequestHandler API
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        page = int((query.get("page") or ["1"])[0])
        per_page = int((query.get("per_page") or ["100"])[0])
        key = (parsed.path, page)
        with STATE["lock"]:
            STATE["active"] += 1
            STATE["max_active"] = max(STATE["max_active"], STATE["active"])
            STATE["ports"].add(self.client_address[1])
            STATE["requests"] += 1
            STATE["pages"].append((parsed.path, page))
            STATE["hits"][key] = STATE["hits"].get(key, 0) + 1
            hit_no = STATE["hits"][key]
            fail_always = key in STATE["fail_always"]
            fail_first = STATE["fail_first"].get(key, 0)
        try:
            time.sleep(STATE["delay"])
            if parsed.path == "/v1/healthz":
                self._send(200, {"ok": True})
                return
            match = re.fullmatch(r"/v1/vendors/(\d+)/products", parsed.path)
            if not match:
                self._send(404, {"error": "not found"})
                return
            if (self.headers.get("Authorization") or "") != "Bearer " + STATE["token"]:
                self._send(401, {"error": "unauthorized"})
                return
            if fail_always:
                self._send(500, {"error": "internal error"})
                return
            if hit_no <= fail_first:
                self._send(429, {"error": "Too Many Requests"})
                return
            total = int(STATE["total"])
            start = (page - 1) * per_page
            rows = [{"id": i, "name": f"کفش {i}", "primary_price": 1000000 + i,
                     "status": "2976"} for i in range(start, min(start + per_page, total))]
            body: dict = {"data": rows}
            if not STATE["no_meta"]:
                body["meta"] = {"total_count": total,
                                "total_page": (total + per_page - 1) // per_page}
            self._send(200, body)
        finally:
            with STATE["lock"]:
                STATE["active"] -= 1


def main() -> int:
    tmpdir = tempfile.mkdtemp(prefix="s4-fast-251-")
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
    core.BASELAM_PAGE_GAP = 0.05
    # SSRF guard: allow the loopback test server.
    real_public = core.public_http_url
    core.public_http_url = lambda url: str(url)

    def write_data(**basalam):
        cfg = {"token": "test-token", "vendor_id": 7,
               "api_base_url": f"http://127.0.0.1:{port}"}
        cfg.update(basalam)
        with open(core.DATA_FILE, "w", encoding="utf-8") as fh:
            json.dump({"basalam": cfg, "network": {}}, fh)

    write_data()
    products_path = "/v1/vendors/7/products"

    try:
        print("== A: outbound keep-alive pool ==")
        for _ in range(5):
            response = core.outbound_request("GET", f"http://127.0.0.1:{port}/v1/healthz")
            assert response.ok, response.status_code
        check("A1 five calls reused one warm connection", len(STATE["ports"]) <= 2,
              f"distinct client ports={len(STATE['ports'])}")
        check("A2 shared session object exists",
              hasattr(core, "_OUTBOUND_SESSION")
              and isinstance(core._OUTBOUND_SESSION, core.requests.Session))
        check("A3 outbound_request uses the pool",
              "_OUTBOUND_SESSION.request(" in open(os.path.join(ROOT, "scraper4.py"),
                                                   encoding="utf-8").read())

        print("== B: REST-first reads in auto mode ==")
        def sdk_must_not_run(*args, **kwargs):
            raise AssertionError("SDK transport used in auto mode")
        real_sdk_request = core.basalam_sdk_request
        core.basalam_sdk_request = sdk_must_not_run
        try:
            payload = core.basalam_read_get(products_path, {"page": 1, "per_page": 100})
            rows = core.basalam_api_rows(payload)
            check("B1 auto mode reads REST without the SDK", len(rows) == 100,
                  str(len(rows)))
        finally:
            core.basalam_sdk_request = real_sdk_request

        print("== C: explicit sdk mode still uses the SDK ==")
        write_data(client_mode="sdk")
        calls: list[str] = []
        real_request = core.basalam_request
        core.basalam_request = lambda method, path, **kw: calls.append(method + " " + path) or {"via": "sdk"}
        try:
            out = core.basalam_read_get(products_path, {"page": 1, "per_page": 100})
            check("C1 sdk mode routes through basalam_request",
                  out == {"via": "sdk"} and calls == ["GET " + products_path])
        finally:
            core.basalam_request = real_request
        write_data()

        print("== D: parallel vendor listing (known meta) ==")
        reset_state()
        t0 = time.time()
        rows, info = core.basalam_vendor_products(7)
        elapsed = time.time() - t0
        check("D1 all 350 rows returned in page order",
              len(rows) == 350 and [r["id"] for r in rows] == list(range(350)),
              f"rows={len(rows)}")
        check("D2 complete info", info.get("complete") is True
              and info.get("totalPages") == 4 and info.get("pagesFetched") == 4,
              str(info))
        check("D3 pages really fetched in parallel", STATE["max_active"] >= 2,
              f"max_active={STATE['max_active']}")
        check("D4 window cap respected", STATE["max_active"] <= 3,
              f"max_active={STATE['max_active']}")
        check("D5 warm connection reused", len(STATE["ports"]) <= 3,
              f"ports={len(STATE['ports'])}")
        check("D6 far faster than the old sequential+gap loop", elapsed < 0.9,
              f"{elapsed:.2f}s")
        check("D7 every page fetched exactly once",
              sorted(STATE["pages"]) == [(products_path, p) for p in (1, 2, 3, 4)],
              str(STATE["pages"]))

        print("== E: 429 retried per page ==")
        with STATE["lock"]:
            STATE["fail_first"][(products_path, 2)] = 2
        reset_state(fail_first={(products_path, 2): 2})
        rows, info = core.basalam_vendor_products(7)
        check("E1 survived two 429s on page 2", info.get("complete") is True
              and len(rows) == 350, str(info))
        check("E2 page 2 attempted three times",
              STATE["hits"].get((products_path, 2)) == 3,
              str(STATE["hits"].get((products_path, 2))))

        print("== F: page-1 failure stays loud ==")
        reset_state(fail_always={(products_path, 1)})
        try:
            core.basalam_vendor_products(7)
            check("F1 page-1 failure raises", False, "no exception")
        except core.FetchError as exc:
            check("F1 page-1 failure raises", "صفحهٔ ۱" in str(exc), str(exc)[:120])
        except Exception as exc:  # noqa: BLE001
            check("F1 page-1 failure raises", False, repr(exc))

        print("== G: unknown metadata → sequential probing ==")
        reset_state(no_meta=True, total=250)
        rows, info = core.basalam_vendor_products(7)
        check("G1 probed all pages and stopped at the short one",
              len(rows) == 250 and info.get("complete") is True, str(info))
        check("G2 probing stayed sequential",
              STATE["pages"] == [(products_path, 1), (products_path, 2), (products_path, 3)],
              str(STATE["pages"]))

        print("== H: permanently failing page keeps a partial catalogue ==")
        reset_state(total=300, fail_always={(products_path, 3)})
        rows, info = core.basalam_vendor_products(7)
        check("H1 partial rows kept", len(rows) == 200
              and [r["id"] for r in rows] == list(range(200)), str(len(rows)))
        check("H2 marked incomplete with the failed page",
              info.get("complete") is False and info.get("failedPages") == [3], str(info))
        check("H3 window reduced after the failure",
              info.get("windowReducedTo") in (1, 2), str(info.get("windowReducedTo")))

        print("== I: destination_remote_rows end-to-end ==")
        reset_state()
        rows = core.destination_remote_rows("basalam")
        check("I1 full catalogue through the destination path",
              len(rows) == 350 and rows[0]["id"] == 0 and rows[-1]["id"] == 349,
              str(len(rows)))
        check("I2 parallel there too", STATE["max_active"] >= 2,
              f"max_active={STATE['max_active']}")

        print("== J: SDK client cache ==")
        fake = types.ModuleType("basalam_sdk")
        fake.config = types.ModuleType("basalam_sdk.config")

        class FakeConfig:
            def __init__(self, timeout=45, user_agent=""):
                self.timeout, self.user_agent = timeout, user_agent

        class FakePersonalToken:
            def __init__(self, token="", refresh_token="", config=None):
                self.token, self.refresh_token, self.config = token, refresh_token, config

        class FakeClient:
            def __init__(self, auth=None, config=None):
                self.auth, self.config = auth, config

        fake.BasalamClient, fake.PersonalToken = FakeClient, FakePersonalToken
        fake.config.BasalamConfig = FakeConfig
        real_modules = {name: sys.modules.get(name)
                        for name in ("basalam_sdk", "basalam_sdk.config")}
        real_ensure = core.ensure_basalam_sdk
        sys.modules["basalam_sdk"] = fake
        sys.modules["basalam_sdk.config"] = fake.config
        core.ensure_basalam_sdk = lambda progress=None: False
        try:
            c1 = core.basalam_client()
            c2 = core.basalam_client()
            check("J1 same token reuses the cached client", c1 is c2)
            write_data(token="another-token-2")
            c3 = core.basalam_client()
            check("J2 new token builds a fresh client", c3 is not c1)
            write_data()
            core.basalam_client()  # repopulate the cache for the real token
        finally:
            core.ensure_basalam_sdk = real_ensure
            for name, module in real_modules.items():
                if module is None:
                    sys.modules.pop(name, None)
                else:
                    sys.modules[name] = module

        print("== K: catalog meta parser ==")
        meta = core._basalam_catalog_meta({"meta": {"total_count": 350, "total_page": 4}}, [], 1, 100)
        check("K1 flat meta", meta == {"total": 350, "totalPages": 4, "known": True}, str(meta))
        meta = core._basalam_catalog_meta({"data": {"meta": {"total": 250}}}, [], 1, 100)
        check("K2 nested meta computes pages", meta["total"] == 250
              and meta["totalPages"] == 3 and meta["known"] is True, str(meta))
        meta = core._basalam_catalog_meta({"data": [{}] * 100}, [{}] * 100, 1, 100)
        check("K3 unknown meta flagged", meta["known"] is False, str(meta))

        print("== L: dashboard multi-shop path wired to the fast lane ==")
        ub_src = open(os.path.join(ROOT, "ui_bridge.py"), encoding="utf-8").read()
        check("L1 multi-shop rows use the parallel vendor listing",
              "core.basalam_vendor_products(" in ub_src)
        check("L2 interactive pages use the fast read",
              "core.basalam_read_get(" in ub_src)
        check("L3 old page-by-page loop removed",
              "core._basalam_catalog_page(" not in ub_src)
    finally:
        core.public_http_url = real_public
        server.shutdown()

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): " + ", ".join(FAILURES))
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
