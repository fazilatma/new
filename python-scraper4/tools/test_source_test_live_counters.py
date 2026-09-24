#!/usr/bin/env python3
"""Regression tests for 10.249: the comprehensive source-access test, live
clickable dispatch counters, and the automatic post-sync reconcile toggle.

    python3 tools/test_source_test_live_counters.py

Offline: a real local HTTP server plays the source (and the relay), the
destination senders and the reconcile worker are faked, and the SSRF guard is
relaxed for 127.0.0.1 only inside this process — no external network.
"""
from __future__ import annotations

import http.server
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


PAGE = """<html><head><title>فهرست کفش زنانه</title>
<script type="application/ld+json">{"@type":"ItemList"}</script></head><body>
<div class="item"><a href="/p1">کفش آلفا</a><img src="/i1.jpg"></div>
<div class="item"><a href="/p2">کفش بتا</a><img src="/i2.jpg"></div>
<div class="item"><a href="/p3">کتونی گاما</a><img src="/i3.jpg"></div>
</body></html>"""

BLOCKED_PAGE = "<html><head><title>captcha</title></head><body>Access Denied — please solve the captcha</body></html>"


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        body = (BLOCKED_PAGE if self.path.startswith("/blocked") else PAGE).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Test-Header", "s4")
        self.end_headers()
        self.wfile.write(body)


PRODUCTS = [{"title": f"کفش {i}", "price": f"{1000000 + i} تومان",
             "link": f"https://example.com/p/{i}", "source_key": f"p{i}"}
            for i in range(1, 6)]


def wait_task(core, task_id: str, timeout: float = 30.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        task = core.live_task_read(task_id)
        if task and task.get("status") in {"completed", "failed", "cancelled", "interrupted"}:
            return task
        time.sleep(0.1)
    return core.live_task_read(task_id) or {}


def main() -> int:
    tmpdir = tempfile.mkdtemp(prefix="s4-test-249-")
    os.environ["SCRAPER_DATA_FILE"] = os.path.join(tmpdir, "scraper4_data.json")
    os.environ["SCRAPER4_AUTO_INSTALL"] = "0"
    import scraper4 as core  # noqa: E402  (registers ui_bridge + parity routes)

    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}/"

    # The SSRF guard forbids loopback by design; relax it for this process
    # only (the endpoint under test still exercises the full pipeline).
    real_public = core.public_http_url
    core.public_http_url = lambda url, *a, **k: str(url)
    client = core.app.test_client()

    try:
        print("== A: comprehensive source-access test (direct) ==")
        r = client.post("/api/source-test", json={"url": base})
        d = r.get_json()
        check("A1 HTTP 200", r.status_code == 200, str(r.status_code))
        check("A1 ok and status 200", d.get("ok") is True and d.get("status") == 200,
              json.dumps(d)[:300])
        check("A1 bytes and duration reported",
              int(d.get("bytes") or 0) > 0 and isinstance(d.get("durationMs"), int))
        check("A1 gateway mode reported", (d.get("gateway") or {}).get("mode") in
              ("direct", "auto", "http"), str((d.get("gateway") or {}).get("mode")))
        probe = d.get("probe") or {}
        check("A1 DNS resolved to loopback",
              "127.0.0.1" in ((probe.get("dns") or {}).get("ips") or []))
        check("A1 TCP connect measured with ip",
              (probe.get("tcp") or {}).get("ip") == "127.0.0.1"
              and isinstance((probe.get("tcp") or {}).get("ms"), int))
        check("A1 no TLS probe on plain http", "tls" not in probe)
        timing = d.get("timing") or {}
        check("A1 timing breakdown present",
              all(isinstance(timing.get(k), int) for k in ("dnsMs", "connectMs", "ttfbMs", "totalMs")),
              json.dumps(timing))
        check("A1 TTFB <= total", (timing.get("ttfbMs") or 0) <= (timing.get("totalMs") or 0) + 5)
        headers = d.get("headers") or {}
        check("A1 key headers captured",
              "content-type" in headers and headers.get("content-type").startswith("text/html"),
              json.dumps(headers))
        content = d.get("content") or {}
        check("A1 page title read", content.get("title") == "فهرست کفش زنانه",
              str(content.get("title")))
        check("A1 content signals", int(content.get("images") or 0) >= 3
              and int(content.get("links") or 0) >= 3 and content.get("jsonLd") is True)
        check("A1 not blocked", content.get("blocked") is False)
        check("A1 engines listed", "requests" in (d.get("engines") or []))
        check("A1 no alt path without relay", d.get("altPath") is None)

        r = client.post("/api/source-test", json={"url": base + "blocked"})
        d = r.get_json()
        check("A2 anti-bot page detected and reported not-ok",
              d.get("ok") is False and (d.get("content") or {}).get("blocked") is True,
              json.dumps(d)[:200])

        print("== B: source test in relay mode + alternative path ==")
        data = core.load_data()
        data["network"] = {"proxy": base + "?url=", "proxy_mode": "relay",
                           "verify_tls": True, "worker_key": "k1"}
        core.save_data(data)
        r = client.post("/api/source-test", json={"url": base})
        d = r.get_json()
        check("B1 relay mode detected", (d.get("gateway") or {}).get("mode") == "relay")
        check("B1 worker key reported as set (never leaked)",
              (d.get("gateway") or {}).get("workerKey") is True
              and "k1" not in json.dumps(d))
        check("B1 probe targets the relay host",
              (d.get("probe") or {}).get("host") == "127.0.0.1"
              and bool((d.get("gateway") or {}).get("probedHost")))
        check("B1 main fetch went through the relay", d.get("ok") is True
              and d.get("status") == 200)
        alt = d.get("altPath") or {}
        check("B1 alternative direct path attempted and ok",
              alt.get("path") == "direct" and alt.get("ok") is True
              and isinstance(alt.get("totalMs"), int), json.dumps(alt)[:200])

        data = core.load_data()
        data["network"] = {"proxy": "", "proxy_mode": "direct"}
        core.save_data(data)

        print("== C: live dispatch counters (structured events) ==")
        calls = {"n": 0}

        def fake_woo(product, status, update_existing):
            calls["n"] += 1
            if product.get("title") == "کفش 3":
                raise RuntimeError("خطای آزمایشی مقصد")
            return {"action": "updated" if calls["n"] % 2 == 0 else "created", "id": calls["n"]}

        real_woo = core.woo_send_one
        core.woo_send_one = fake_woo
        try:
            data = core.load_data()
            data["profiles"]["dispatch1"] = {
                "name": "dispatch1", "url": "https://example.com/list",
                "saved_products": [dict(p) for p in PRODUCTS], "selectors": {}}
            core.save_data(data)
            task = core.start_profile_dispatch("dispatch1",
                                               {"destinations": ["woocommerce"]})
            final = wait_task(core, task["id"])
            check("C1 dispatch completed", final.get("status") == "completed",
                  json.dumps({k: final.get(k) for k in ("status", "step")}))
            check("C1 counters", final.get("sent") == 4 and final.get("failed") == 1
                  and final.get("done") == 5,
                  f"{final.get('sent')}/{final.get('failed')}/{final.get('done')}")
            log = final.get("log") or []
            check("C1 live log recorded per product", len(log) == 5, str(len(log)))
            events = {row.get("event") for row in log}
            check("C1 event names", events == {"sync-created", "sync-updated", "failed"},
                  str(events))
            failed_rows = [row for row in log if row.get("event") == "failed"]
            check("C1 failed event carries title + error",
                  failed_rows and failed_rows[0]["item"]["title"] == "کفش 3"
                  and "خطای آزمایشی" in failed_rows[0]["item"].get("error", ""))
            ok_rows = [row for row in log if row.get("event") != "failed"]
            check("C1 sent events carry target + action",
                  all(row["item"].get("target") == "ووکامرس"
                      and row["item"].get("action") in ("created", "updated")
                      for row in ok_rows))
            check("C1 no auto reconcile without the toggle",
                  not any(t.get("kind") == "destination_reconcile"
                          for t in list(core.LIVE_TASKS.values())))

            r = client.get("/api/jobs")
            jobs = (r.get_json() or {}).get("jobs") or []
            job = next((j for j in jobs if j.get("id") == task["id"]), None)
            check("C2 job log exposed live", job is not None
                  and len(job.get("log") or []) == 5, str(job and len(job.get("log") or [])))
            if job:
                successful = [row for row in job["log"]
                              if row.get("event") in ("sync-created", "sync-updated")]
                check("C2 successful rows = sent counter", len(successful) == 4)
                check("C2 job counters still live", job.get("added") == 4
                      and job.get("failed") == 1)
        finally:
            core.woo_send_one = real_woo

        print("== D: automatic reconcile after dispatch ==")
        reconcile_tasks: list[dict] = []

        def fake_reconcile_worker(task_id, profile_name, destination):
            reconcile_tasks.append({"profile": profile_name, "destination": destination})
            core.live_task_update(task_id, 100, "مغایرت‌گیری آزمایشی کامل شد", "completed",
                                  "stub", profile=profile_name, destination=destination)

        real_rw = core.destination_reconcile_worker
        core.destination_reconcile_worker = fake_reconcile_worker
        try:
            data = core.load_data()
            data["profiles"]["dispatch2"] = {
                "name": "dispatch2", "url": "https://example.com/list",
                "saved_products": [dict(p) for p in PRODUCTS[:3]],
                "selectors": {}, "reconcile": True}
            core.save_data(data)
            task = core.start_profile_dispatch("dispatch2",
                                               {"destinations": ["basalam"]})
            final = wait_task(core, task["id"])
            check("D1 dispatch completed", final.get("status") == "completed")
            deadline = time.time() + 5
            while time.time() < deadline and not reconcile_tasks:
                time.sleep(0.05)
            check("D2 reconcile queued for the sent destination",
                  reconcile_tasks == [{"profile": "dispatch2", "destination": "basalam"}],
                  str(reconcile_tasks))
            check("D2 completion detail mentions reconcile",
                  "مغایرت‌گیری خودکار" in (final.get("details") or [""])[-1].get("text", "")
                  or any("مغایرت‌گیری خودکار" in d.get("text", "")
                         for d in (final.get("details") or [])))
        finally:
            core.destination_reconcile_worker = real_rw

        print("== E: reconcile profile-field round trip ==")
        r = client.post("/api/profiles", json={
            "id": "rec-map", "name": "rec-map", "url": "https://example.com/r",
            "reconcile": True, "enabled": True})
        check("E1 profile saved", r.status_code == 200)
        prof = core.load_data()["profiles"].get("rec-map")
        check("E2 reconcile stored on the profile", prof.get("reconcile") is True)
        r = client.get("/api/profiles")
        rows = (r.get_json() or {}).get("profiles") or []
        mapped = next((p for p in rows if p.get("id") == "rec-map"), None)
        check("E3 reconcile exposed to the dashboard",
              mapped is not None and mapped.get("reconcile") is True)
        r = client.post("/api/profiles", json={
            "id": "rec-map", "name": "rec-map", "url": "https://example.com/r",
            "reconcile": False, "enabled": True})
        prof = core.load_data()["profiles"].get("rec-map")
        check("E4 reconcile can be turned off", prof.get("reconcile") is False)
    finally:
        core.public_http_url = real_public
        httpd.shutdown()

    print("== F: dashboard wiring ==")
    html = open(os.path.join(ROOT, "ui", "dashboard.html"), encoding="utf-8").read()
    js = open(os.path.join(ROOT, "ui", "dashboard.js"), encoding="utf-8").read()
    check("reconcile toggle present", 'id="reconcile"' in html
          and "مغایرت‌گیری خودکار پس از همگام‌سازی" in html)
    check("reconcile rides the profile field set",
          "'detailExtract','githubBranch','reconcile'" in js)
    check("reconcile wired in form read/write",
          "p.reconcile===true" in js and "reconcile:$('reconcile')?.checked===true" in js)
    check("source-test modal exists", "function openSourceTestModal(d){" in js)
    check("source-test action uses the rich modal", "openSourceTestModal(d);" in js)
    check("metric buttons carry the live marker", "data-job-metric-live=" in js)
    check("live metric polling implemented", "jobMetricTimer" in js
          and "/api/jobs/'+encodeURIComponent(id)" in js)
    check("sync events map to added/updated counters",
          "metric==='added'?['added','sync-created']" in js
          and "metric==='updated'?['updated','sync-updated']" in js)
    check("running-empty state explains live refresh",
          "خودکار به‌روز می‌شود" in js)
    s4src = open(os.path.join(ROOT, "scraper4.py"), encoding="utf-8").read()
    check("dispatch worker records live events",
          'live_task_event(task_id,_ev,' in s4src
          and 'live_task_event(task_id,"failed"' in s4src)
    check("auto reconcile after dispatch",
          "start_destination_reconcile_task(profile_name,x)" in
          open(os.path.join(ROOT, "scraper4.py"), encoding="utf-8").read())

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
