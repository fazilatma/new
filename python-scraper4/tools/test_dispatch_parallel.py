#!/usr/bin/env python3
"""Regression tests for 10.250: parallel product dispatch with automatic and
manual concurrency.

    python3 tools/test_dispatch_parallel.py

Offline: the destination senders are faked (with real sleeps and concurrency
tracking), no network, no real destinations.
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ✓ {name}")
    else:
        FAILURES.append(name)
        print(f"  ✕ {name}" + (f" — {detail}" if detail else ""))


PRODUCTS = [{"title": f"کفش موازی {i}", "price": f"{1000000 + i} تومان",
             "link": f"https://example.com/p/{i}", "source_key": f"pp{i}"}
            for i in range(1, 9)]


class Tracker:
    """Fake destination sender that records real concurrency."""

    def __init__(self, sleep_s: float = 0.12, fail_titles: tuple = (),
                 rate_limit_first: int = 0):
        self.lock = threading.Lock()
        self.sleep_s = sleep_s
        self.fail_titles = set(fail_titles)
        self.rate_limit_first = rate_limit_first
        self.calls = 0
        self.active = 0
        self.max_active = 0
        self.succeeded = 0

    def __call__(self, product, status, update_existing):
        with self.lock:
            self.calls += 1
            call_no = self.calls
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            time.sleep(self.sleep_s)
            if call_no <= self.rate_limit_first:
                raise RuntimeError("HTTP 429: Too Many Requests — rate limit exceeded")
            if product.get("title") in self.fail_titles:
                raise RuntimeError("خطای آزمایشی مقصد")
            with self.lock:
                self.succeeded += 1
            return {"action": "created" if call_no % 2 else "updated",
                    "id": 5000 + call_no}
        finally:
            with self.lock:
                self.active -= 1


def wait_task(core, task_id: str, timeout: float = 40.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        task = core.live_task_read(task_id)
        if task and task.get("status") in {"completed", "failed", "cancelled",
                                           "interrupted"}:
            return task
        time.sleep(0.05)
    return core.live_task_read(task_id) or {}


def make_profile(core, pid: str, products, **over):
    data = core.load_data()
    cfg = {"name": pid, "url": "https://example.com/list", "selectors": {},
           "saved_products": [dict(p) for p in products]}
    cfg.update(over)
    data["profiles"][pid] = cfg
    core.save_data(data)


def main() -> int:
    tmpdir = tempfile.mkdtemp(prefix="s4-test-250-")
    os.environ["SCRAPER_DATA_FILE"] = os.path.join(tmpdir, "scraper4_data.json")
    os.environ["SCRAPER4_AUTO_INSTALL"] = "0"
    os.environ.pop("SCRAPER4_DISPATCH_CONCURRENCY", None)
    import scraper4 as core  # noqa: E402

    real_woo = core.woo_send_one
    client = core.app.test_client()

    try:
        print("== A: concurrency resolution ==")
        check("A1 auto woo = 4", core.resolve_dispatch_concurrency({}, "woocommerce") == (4, "auto"))
        check("A2 auto basalam = 2", core.resolve_dispatch_concurrency({}, "basalam") == (2, "auto"))
        check("A3 manual wins", core.resolve_dispatch_concurrency(
            {"dispatch_concurrency": 6}, "basalam") == (6, "manual"))
        check("A4 manual 1 = sequential", core.resolve_dispatch_concurrency(
            {"dispatch_concurrency": 1}, "woocommerce") == (1, "manual"))
        check("A5 invalid falls back to auto", core.resolve_dispatch_concurrency(
            {"dispatch_concurrency": 99}, "woocommerce") == (4, "auto"))
        check("A6 non-numeric falls back to auto", core.resolve_dispatch_concurrency(
            {"dispatch_concurrency": ""}, "basalam") == (2, "auto"))
        os.environ["SCRAPER4_DISPATCH_CONCURRENCY"] = "3"
        check("A7 env override", core.resolve_dispatch_concurrency({}, "woocommerce") == (3, "env"))
        check("A8 manual beats env", core.resolve_dispatch_concurrency(
            {"dispatch_concurrency": 8}, "woocommerce") == (8, "manual"))
        os.environ.pop("SCRAPER4_DISPATCH_CONCURRENCY", None)

        print("== B: real parallel execution (auto → woo 4) ==")
        tracker = Tracker(sleep_s=0.12)
        core.woo_send_one = tracker
        make_profile(core, "par1", PRODUCTS)
        t0 = time.time()
        task = core.start_profile_dispatch("par1", {"destinations": ["woocommerce"]})
        final = wait_task(core, task["id"])
        elapsed = time.time() - t0
        check("B1 completed", final.get("status") == "completed",
              json.dumps({k: final.get(k) for k in ("status", "step")}))
        check("B1 all sent", final.get("sent") == 8 and final.get("failed") == 0
              and final.get("done") == 8,
              f"{final.get('sent')}/{final.get('failed')}/{final.get('done')}")
        check("B1 really ran in parallel", tracker.max_active >= 2,
              f"max_active={tracker.max_active}")
        check("B1 respected the cap", tracker.max_active <= 4,
              f"max_active={tracker.max_active}")
        check("B1 meaningfully faster than sequential",
              elapsed < len(PRODUCTS) * 0.12, f"{elapsed:.2f}s")
        check("B1 concurrency recorded on the task", final.get("concurrency") == 4,
              str(final.get("concurrency")))
        log = final.get("log") or []
        check("B1 live events for every product", len(log) == 8, str(len(log)))
        events = {row.get("event") for row in log}
        check("B1 event names", events == {"sync-created", "sync-updated"}, str(events))
        prof = core.load_data()["profiles"]["par1"]
        check("B1 identities recorded for all products",
              len((prof.get("remote_map") or {}).get("woocommerce") or {}) == 8)

        print("== C: mixed failures in parallel mode ==")
        tracker = Tracker(sleep_s=0.05, fail_titles=("کفش موازی 2",))
        core.woo_send_one = tracker
        make_profile(core, "par2", PRODUCTS)
        task = core.start_profile_dispatch("par2", {"destinations": ["woocommerce"]})
        final = wait_task(core, task["id"])
        check("C1 completed", final.get("status") == "completed")
        check("C1 counts", final.get("sent") == 7 and final.get("failed") == 1,
              f"{final.get('sent')}/{final.get('failed')}")
        log = final.get("log") or []
        failed_rows = [row for row in log if row.get("event") == "failed"]
        check("C1 failed event with error text",
              len(failed_rows) == 1 and "خطای آزمایشی" in failed_rows[0]["item"].get("error", ""))

        print("== D: adaptive reduction on 429 ==")
        tracker = Tracker(sleep_s=0.05, rate_limit_first=2)
        core.woo_send_one = tracker
        make_profile(core, "par3", PRODUCTS)
        task = core.start_profile_dispatch("par3", {"destinations": ["woocommerce"]})
        final = wait_task(core, task["id"])
        check("D1 completed despite 429s", final.get("status") == "completed",
              json.dumps({k: final.get(k) for k in ("status", "step")}))
        check("D1 failures counted", final.get("failed") == 2,
              str(final.get("failed")))
        # Each 429 completion halves the limit once (4 -> 2 -> 1 with two
        # simultaneous 429s, 4 -> 2 when they land in separate batches).
        check("D1 concurrency reduced on the task",
              final.get("concurrency") in (1, 2), str(final.get("concurrency")))
        details = " | ".join(d.get("text", "") for d in (final.get("details") or []))
        check("D1 reduction announced in details",
              "محدودیت نرخ" in details and "کاهش یافت" in details,
              details[-200:])

        print("== E: manual sequential (concurrency = 1) ==")
        tracker = Tracker(sleep_s=0.03)
        core.woo_send_one = tracker
        make_profile(core, "par4", PRODUCTS[:5], dispatch_concurrency=1)
        task = core.start_profile_dispatch("par4", {"destinations": ["woocommerce"]})
        final = wait_task(core, task["id"])
        check("E1 completed", final.get("status") == "completed")
        check("E1 strictly sequential", tracker.max_active == 1,
              f"max_active={tracker.max_active}")
        check("E1 counts right", final.get("sent") == 5 and final.get("failed") == 0)

        print("== F: manual parallel = 6 ==")
        tracker = Tracker(sleep_s=0.08)
        core.woo_send_one = tracker
        make_profile(core, "par5", PRODUCTS, dispatch_concurrency=6)
        task = core.start_profile_dispatch("par5", {"destinations": ["woocommerce"]})
        final = wait_task(core, task["id"])
        check("F1 completed", final.get("status") == "completed")
        check("F1 used the manual limit", 2 <= tracker.max_active <= 6
              and final.get("concurrency") == 6,
              f"max_active={tracker.max_active} task={final.get('concurrency')}")

        print("== G: cancellation mid-parallel-run ==")
        many = [{"title": f"محصول {i}", "price": "100 تومان",
                 "link": f"https://example.com/x/{i}", "source_key": f"x{i}"}
                for i in range(1, 41)]
        tracker = Tracker(sleep_s=0.05)
        core.woo_send_one = tracker
        make_profile(core, "par6", many, dispatch_concurrency=8)
        task = core.start_profile_dispatch("par6", {"destinations": ["woocommerce"]})
        # Cancel as soon as at least one product has been processed.
        deadline = time.time() + 10
        while time.time() < deadline:
            snap = core.live_task_read(task["id"])
            if (snap.get("done") or 0) >= 1:
                with core.LIVE_TASK_LOCK:
                    t = core.LIVE_TASKS.get(task["id"])
                    if t:
                        t["cancel_requested"] = True
                break
            time.sleep(0.01)
        final = wait_task(core, task["id"])
        check("G1 cancelled status", final.get("status") == "cancelled",
              str(final.get("status")))
        check("G1 stopped before finishing everything",
              1 <= (final.get("done") or 0) < len(many),
              f"done={final.get('done')}")

        print("== H: profile field round trip ==")
        r = client.post("/api/profiles", json={
            "id": "conc-map", "name": "conc-map", "url": "https://example.com/c",
            "dispatchConcurrency": "6", "enabled": True})
        check("H1 profile saved", r.status_code == 200,
              r.get_data(as_text=True)[:150])
        prof = core.load_data()["profiles"].get("conc-map")
        check("H2 manual value stored", prof.get("dispatch_concurrency") == 6,
              str(prof.get("dispatch_concurrency")))
        r = client.get("/api/profiles")
        rows = (r.get_json() or {}).get("profiles") or []
        mapped = next((p for p in rows if p.get("id") == "conc-map"), None)
        check("H3 exposed back to the dashboard",
              mapped and mapped.get("dispatchConcurrency") == "6")
        r = client.post("/api/profiles", json={
            "id": "conc-map", "name": "conc-map", "url": "https://example.com/c",
            "dispatchConcurrency": "auto", "enabled": True})
        prof = core.load_data()["profiles"].get("conc-map")
        check("H4 auto clears the override", prof.get("dispatch_concurrency") in ("", None))
        r = client.post("/api/profiles", json={
            "id": "conc-map", "name": "conc-map", "url": "https://example.com/c",
            "dispatchConcurrency": "99", "enabled": True})
        prof = core.load_data()["profiles"].get("conc-map")
        check("H5 out-of-range value rejected to auto",
              prof.get("dispatch_concurrency") in ("", None))
    finally:
        core.woo_send_one = real_woo
        os.environ.pop("SCRAPER4_DISPATCH_CONCURRENCY", None)

    print("== I: dashboard wiring ==")
    html = open(os.path.join(ROOT, "ui", "dashboard.html"), encoding="utf-8").read()
    js = open(os.path.join(ROOT, "ui", "dashboard.js"), encoding="utf-8").read()
    s4 = open(os.path.join(ROOT, "scraper4.py"), encoding="utf-8").read()
    check("concurrency select present", 'id="dispatchConcurrency"' in html
          and "خودکار (پیشنهادی)" in html and "۱۶" in html)
    check("hint explains auto values + 429 backoff",
          "ووکامرس ۴ و باسلام ۲" in html and "429" in html)
    check("field rides the profile set",
          "'reconcile','dispatchConcurrency','galMode'" in js)
    check("form read/write wired", "dispatchConcurrency:$('dispatchConcurrency')?.value||'auto'}" in js
          and "$('dispatchConcurrency').value='auto';" in js)
    check("worker has the parallel window",
          "ThreadPoolExecutor(max_workers=concurrency" in s4
          and "return_when=FIRST_COMPLETED" in s4)
    check("adaptive 429 reduction implemented",
          "_DISPATCH_RATE_LIMIT_RE" in s4 and "کاهش همزمانی" in s4)
    check("auto defaults", 'DISPATCH_AUTO_CONCURRENCY = {"woocommerce": 4, "basalam": 2}' in s4)
    check("cancel support in parallel mode", "for fut in pending:fut.cancel()" in s4)
    check("env override supported", "SCRAPER4_DISPATCH_CONCURRENCY" in s4)

    if os.path.exists("/usr/bin/node") or os.path.exists("/usr/local/bin/node"):
        import subprocess
        proc = subprocess.run(["node", "--check", os.path.join(ROOT, "ui", "dashboard.js")],
                              capture_output=True, text=True, timeout=60)
        check("dashboard.js passes node --check", proc.returncode == 0,
              proc.stderr[:200])
    else:
        print("  (node not available — syntax check skipped)")

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): " + ", ".join(FAILURES))
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
