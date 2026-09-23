#!/usr/bin/env python3
"""Regression tests for 10.246: honest extraction-diagnostic reports, the
plain-HTTP fallback when a pinned browser engine is missing, and PEP 668
aware install commands.

    python3 tools/test_diag_fallback_hint.py

Offline: fixtures + the Flask test client against in-process fakes
(core.Fetcher.get is monkeypatched; no network, no browser needed).
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile

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


HTML = """<html><head><title>فهرست کفش</title></head><body>
<div class="item"><a class="t" href="/p1">کفش آلفا</a><span class="p">1,200,000 تومان</span><img src="/i1.jpg"></div>
<div class="item"><a class="t" href="/p2">کفش بتا</a><span class="p">890,000 تومان</span><img src="/i2.jpg"></div>
<div class="item"><a class="t" href="/p3">کتونی گاما</a><span class="p">2,450,000 تومان</span><img src="/i3.jpg"></div>
</body></html>"""

# The exact 10.245-era error text the user's WebConsole server produced —
# the diagnostic must recognise it as "browser engine missing".
PLAYWRIGHT_MISSING = (
    "Playwright نصب نیست. دستورهای نصب:\n"
    "  pip3 install playwright\n"
    "  python3 -m playwright install --with-deps chromium\n"
    "یا یک‌خطی کامل:\n"
    "  pip3 install -r requirements.txt && python3 -m playwright install --with-deps chromium"
)


def main() -> int:
    tmpdir = tempfile.mkdtemp(prefix="s4-test-246-")
    os.environ["SCRAPER_DATA_FILE"] = os.path.join(tmpdir, "scraper4_data.json")
    os.environ["SCRAPER4_AUTO_INSTALL"] = "0"
    import scraper4 as core  # noqa: E402  (registers ui_bridge routes too)

    print("== A: PEP 668 / root aware install hint (scraper4 core) ==")
    check("pip_break_system() exists and returns bool",
          callable(getattr(core, "pip_break_system", None))
          and isinstance(core.pip_break_system(), bool))
    check("playwright_install_hint() exists",
          callable(getattr(core, "playwright_install_hint", None)))

    real_brk, real_geteuid = core.pip_break_system, os.geteuid
    try:
        def scenario(brk: bool, euid: int) -> str:
            core.pip_break_system = lambda: brk
            os.geteuid = lambda: euid
            return core.playwright_install_hint()

        h = scenario(True, 33)  # the user's server: PEP 668 + www-data
        check("PEP668+www-data: --break-system-packages present",
              "--break-system-packages" in h)
        check("PEP668+www-data: --user present (patcher bootstrap style)",
              "pip3 install --break-system-packages --user playwright" in h)
        check("PEP668+www-data: browser command has no --with-deps",
              "\n  python3 -m playwright install chromium\n" in h)
        check("PEP668+www-data: root command noted",
              "sudo python3 -m playwright install --with-deps" in h)
        check("PEP668+www-data: one-liner carries the flag",
              "pip3 install --break-system-packages --user -r requirements.txt" in h)

        h = scenario(True, 0)
        check("PEP668+root: flag, no --user",
              "pip3 install --break-system-packages playwright" in h
              and "--user" not in h)
        check("PEP668+root: --with-deps kept",
              "python3 -m playwright install --with-deps chromium" in h)

        h = scenario(False, 33)
        check("no-PEP668+non-root: plain --user, no flag",
              "pip3 install --user playwright" in h
              and "--break-system-packages" not in h)

        h = scenario(False, 0)
        check("no-PEP668+root: classic commands",
              "pip3 install playwright" in h and "--user" not in h
              and "--break-system-packages" not in h)

        core.pip_break_system = lambda: True
        os.geteuid = lambda: 33
        check("requirements path is honoured",
              "python-scraper4/requirements.txt"
              in core.playwright_install_hint("python-scraper4/requirements.txt"))
    finally:
        core.pip_break_system = real_brk
        os.geteuid = real_geteuid

    src = open(os.path.join(ROOT, "scraper4.py"), encoding="utf-8").read()
    check("render_playwright ImportError uses the env-aware hint",
          '"Playwright نصب نیست" + where + ". " + playwright_install_hint()' in src)
    check("browser-binary hint uses the env-aware hint",
          'playwright_install_hint("python-scraper4/requirements.txt")' in src)
    check("scrape() logs the HTTP fallback for a missing browser LIBRARY too",
          'or "نصب نیست" in _last_err' in src)

    if importlib.util.find_spec("playwright") is None:
        core.pip_break_system = lambda: True
        os.geteuid = lambda: 33
        try:
            core.render_playwright("https://example.com/x", 5)
            check("render_playwright raises FetchError with env commands", False)
        except core.FetchError as exc:
            check("render_playwright raises FetchError with env commands",
                  "--break-system-packages" in str(exc)
                  and "دستورهای نصب" in str(exc), str(exc)[:120])
        finally:
            core.pip_break_system = real_brk
            os.geteuid = real_geteuid
    else:
        print("  (playwright installed here — raise-path covered by source check)")

    print("== B: honest diagnostic + HTTP fallback (flask test client) ==")
    if importlib.util.find_spec("flask") is None:
        print("  (flask not installed — section skipped)")
    else:
        client = core.app.test_client()

        def fake_get(self, url, *, referer="", accept_json=False, engine="requests", **kwargs):
            if engine == "playwright":
                raise core.FetchError(PLAYWRIGHT_MISSING)
            if getattr(fake_get, "fail_all", False):
                raise core.FetchError(f"HTTP 403 برای {url}")
            return core.FetchResult(url=url, text=HTML,
                                    content_type="text/html", status=200)

        original_get = core.Fetcher.get
        core.Fetcher.get = fake_get
        try:
            def make_profile(pid: str, **over):
                data = core.load_data()
                cfg = {
                    "name": pid, "url": "https://example.com/list",
                    "fetch_engine": "playwright",
                    "selectors": {"container": "div.item", "title": "a.t",
                                  "price": "span.p", "link": "a.t", "image": "img"},
                    "detail_selectors": {}, "pagination": "none",
                }
                cfg.update(over)
                data["profiles"][pid] = cfg
                core.save_data(data)

            # B1: pinned playwright missing → plain-HTTP fallback kicks in
            make_profile("p1")
            fake_get.fail_all = False
            r = client.post("/api/profiles/p1/extraction-diagnostic")
            data = r.get_json()
            check("B1 HTTP 200", r.status_code == 200, str(r.status_code))
            net = next(s for s in data["stages"] if s["name"] == "network")
            check("B1 network stage ok despite missing playwright",
                  net["ok"] is True, net.get("summary", "")[:120])
            check("B1 stage names the engine that actually served the page",
                  bool(net.get("engine")) and net["engine"] != "playwright",
                  str(net.get("engine")))
            check("B1 fallbackFrom records the pinned engine",
                  net.get("fallbackFrom") == "playwright")
            check("B1 summary mentions the substitute",
                  "به‌جای playwright" in net.get("summary", ""))
            check("B1 report usedEngine set (dashboard copy format reads it)",
                  bool(data.get("usedEngine")) and data["usedEngine"] != "playwright")
            check("B1 ok mirrors stage health",
                  data["ok"] == all(s["ok"] for s in data["stages"]))
            lists = [s for s in data["stages"] if s["name"] == "list-extraction"]
            check("B1 productCount matches the list stage",
                  bool(lists) and data.get("productCount") == lists[0].get("count"),
                  f"{data.get('productCount')} vs {[s.get('count') for s in lists]}")
            check("B1 productCount > 0", int(data.get("productCount") or 0) > 0)
            check("B1 durationMs present",
                  isinstance(data.get("durationMs"), int) and data["durationMs"] >= 0)
            check("B1 url echoed at top level",
                  data.get("url") == "https://example.com/list")
            check("B1 finalUrl present", bool(data.get("finalUrl")))
            check("B1 recommendation carries install commands",
                  any("pip3 install" in x for x in data.get("recommendations") or []))

            # B2: every engine fails → honest FAIL with attempts + advice
            make_profile("p2")
            fake_get.fail_all = True
            r = client.post("/api/profiles/p2/extraction-diagnostic")
            data = r.get_json()
            net = next(s for s in data["stages"] if s["name"] == "network")
            check("B2 network stage fails", net["ok"] is False)
            check("B2 report ok is False (was hardcoded True before)",
                  data["ok"] is False)
            check("B2 productCount 0", data.get("productCount") == 0)
            check("B2 every engine attempt listed",
                  len(net.get("attempts") or []) >= 2,
                  str(net.get("attempts")))
            check("B2 install commands kept in the stage summary",
                  "دستورهای نصب" in net.get("summary", ""))
            check("B2 recommendation present",
                  any("pip3 install" in x for x in data.get("recommendations") or []))
            check("B2 summary stays bounded", len(net.get("summary", "")) <= 600)

            # B3: auto engine — no fallback involved, behaviour unchanged
            fake_get.fail_all = False
            make_profile("p3", fetch_engine="auto")
            r = client.post("/api/profiles/p3/extraction-diagnostic")
            data = r.get_json()
            net = next(s for s in data["stages"] if s["name"] == "network")
            check("B3 auto profile: engine recorded",
                  net.get("engine") == "requests", str(net.get("engine")))
            check("B3 no fallbackFrom on auto", net.get("fallbackFrom") == "")

            # B4: live stream path emits elapsedMs + one result event
            fake_get.fail_all = False
            make_profile("p4")
            r = client.post("/api/profiles/p4/extraction-diagnostic?live=1")
            check("B4 live content-type is ndjson",
                  "x-ndjson" in (r.content_type or ""), str(r.content_type))
            events = [json.loads(line) for line in
                      r.get_data(as_text=True).splitlines() if line.strip()]
            progress = [e for e in events if e.get("type") == "progress"]
            check("B4 progress events carry elapsedMs",
                  bool(progress)
                  and all(isinstance(e.get("elapsedMs"), int) for e in progress))
            final = [e for e in events if e.get("type") == "result"]
            check("B4 exactly one result event closing the stream",
                  len(final) == 1
                  and final[0]["report"]["ok"]
                  == all(s["ok"] for s in final[0]["report"]["stages"]))

            # B5: /api/install-commands is PEP 668 aware
            r = client.get("/api/install-commands")
            data = r.get_json()
            flag = "--break-system-packages" if core.pip_break_system() else ""
            check("B5 pip_flags matches the environment",
                  data.get("pip_flags") == flag, str(data.get("pip_flags")))
            if flag:
                check("B5 full command carries the flag",
                      flag in data["commands"]["full"])
                check("B5 one-liner carries the flag",
                      flag in data["commands"]["all_one_liner"])
            else:
                check("B5 commands unchanged without PEP 668",
                      data["commands"]["full"].startswith("pip install -r"))
        finally:
            core.Fetcher.get = original_get

    print("== C: source wiring ==")
    ub = open(os.path.join(ROOT, "ui_bridge.py"), encoding="utf-8").read()
    check("finish() derives ok from health",
          '"ok": bool(payload.get("healthy", True))' in ub)
    check("finish() always reports durationMs",
          '"durationMs": int((time.monotonic() - t0) * 1000)' in ub)
    check("stage events carry elapsedMs",
          '"elapsedMs": int((time.monotonic() - t0) * 1000)' in ub)
    check("diagnostic HTTP fallback implemented",
          "def _fetch_with_http_fallback" in ub and "_missing_markers" in ub)
    check("detail fetch uses the fallback too",
          "_fetch_with_http_fallback(link," in ub)
    check("install-commands builds flag-aware pip commands",
          '_brk = "--break-system-packages" if core.pip_break_system() else ""' in ub)

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): " + ", ".join(FAILURES))
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
