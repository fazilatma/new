#!/usr/bin/env python3
"""Offline regression for the emalls session contract + browser bootstrap (10.235).

History this pins:
  * 10.228-10.231 (user-confirmed): emalls pages 2+ are REAL when the page-1
    ASP.NET session cookie rides along with every engine; a browser rescue
    then keeps the session trusted. 10.234's cookie-less gate regressed that
    (fresh sessions got page-1 copies again) — 10.235 reverts the gate.
  * Kept from 10.234: the Node 1.183 header baseline (Chrome/131 + exact
    Accept) and the reject-all requests-session jar policy so the flat store
    stays the single cookie source of truth.
  * configured_browser_path() must never return the doubled
    .wconsole_data/.wconsole_data/... path (10.235 bug fix).
  * run_scraper4.sh must bootstrap Playwright + Chromium on a fresh server.

Local mock server only; no external network. Exit 0 = all good.

    python3 tools/test_emalls_session_and_browser.py
"""
from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

spec = importlib.util.spec_from_file_location("scraper4", os.path.join(ROOT, "scraper4.py"))
core = importlib.util.module_from_spec(spec)
sys.modules["scraper4"] = core
spec.loader.exec_module(core)

# Allow the local mock (the SSRF guard otherwise refuses loopback hosts).
core.public_http_url = lambda u: (u or "").strip()
_tmpdir = tempfile.mkdtemp(prefix="scraper4-n235-")
core.DATA_FILE = os.path.join(_tmpdir, "data.json")

NODE_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
           "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
NODE_ACCEPT = ("text/html,application/xhtml+xml,application/json;q=0.9,"
               "application/xml;q=0.8,*/*;q=0.5")

PASS = 0
FAIL = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok  {name}")
    else:
        FAIL += 1
        print(f" FAIL {name} :: {detail[:220]}")


SEEN: dict[str, list[dict[str, str]]] = {}


class MockSite(BaseHTTPRequestHandler):
    def log_message(self, *args):  # silence
        pass

    def _record(self):
        SEEN.setdefault(self.path, []).append({
            "cookie": self.headers.get("Cookie") or "",
            "ua": self.headers.get("User-Agent") or "",
            "accept": self.headers.get("Accept") or "",
        })

    def _send(self, body: bytes, set_cookie: str = ""):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        if set_cookie:
            self.send_header("Set-Cookie", set_cookie)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._record()
        if self.path == "/p1":
            self._send(b"<html><body>page one</body></html>", "sid=S1; Path=/")
        elif self.path == "/p2":
            self._send(b"<html><body>page two</body></html>", "fresh=1; Path=/")
        else:
            self._send(b"<html><body>other</body></html>")


_server = ThreadingHTTPServer(("127.0.0.1", 0), MockSite)
PORT = _server.server_address[1]
threading.Thread(target=_server.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{PORT}"

print("== A: the Node 1.183 header baseline (kept from 10.234) ==")
check("USER_AGENT is Node's Chrome/131", core.USER_AGENT == NODE_UA, core.USER_AGENT)
check("session Accept equals the Node 1.183 value",
      core.Fetcher({"timeout": 5}).session.headers.get("Accept") == NODE_ACCEPT,
      str(core.Fetcher({"timeout": 5}).session.headers.get("Accept")))
check("the 10.234 cookie-less gate is gone",
      not hasattr(core, "STATELESS_COOKIE_HOSTS") and not hasattr(core.Fetcher, "_send_cookie_store")
      and not hasattr(core.Fetcher({"timeout": 5}), "_browser_blessed"))

print("== B: emalls session contract (10.228 flow, restored) ==")
fetcher = core.Fetcher({"timeout": 15, "gap_ms": 0})
fetcher.get(BASE + "/p1", engine="requests")
check("page-1 Set-Cookie absorbed into the flat store", fetcher._cookies.get("sid") == "S1", str(fetcher._cookies))
check("session jar stays EMPTY (reject-all policy)",
      len(fetcher.session.cookies) == 0, str(list(fetcher.session.cookies)))
fetcher.get(BASE + "/p2", engine="requests")
rec = SEEN["/p2"][-1]
check("page 2 carries the page-1 session cookie (no gate)", "sid=S1" in rec["cookie"], rec["cookie"])
check("page-2 Set-Cookie also absorbed", fetcher._cookies.get("fresh") == "1", str(fetcher._cookies))

print("== C: every HTTP engine sends the shared store + Node headers ==")
for engine in ("requests", "httpx", "cloudscraper", "curl_cffi", "aiohttp"):
    if not core.fetch_engine_installed(engine):
        check(f"{engine}: installed", False, "library missing in test env")
        continue
    f2 = core.Fetcher({"timeout": 15, "gap_ms": 0})
    f2._cookies = {"sid": "S1"}
    result = f2.get(BASE + "/p2", engine=engine)
    rec = SEEN["/p2"][-1]
    check(f"{engine}: page fetched with the session cookie",
          result.status == 200 and "sid=S1" in rec["cookie"], f"{result.status} cookie={rec['cookie'][:60]}")
    if engine != "curl_cffi":
        # curl_cffi speaks with its own full Chrome impersonation set (10.230).
        check(f"{engine}: Node Chrome/131 UA", rec["ua"] == NODE_UA, rec["ua"])
        check(f"{engine}: Node Accept", rec["accept"] == NODE_ACCEPT, rec["accept"])

print("== D: browser cache path is never doubled (10.235 fix) ==")
fake_root = tempfile.mkdtemp(prefix="wc-root-")
proj_dir = os.path.join(fake_root, ".wconsole_data", "projects", "python-scraper4-test")
os.makedirs(proj_dir, exist_ok=True)
_real_base, _real_data = core.BASE_DIR, getattr(core, "DATA_DIR", "")
saved_env = os.environ.pop("PLAYWRIGHT_BROWSERS_PATH", None)
try:
    core.BASE_DIR = proj_dir
    core.DATA_DIR = ""  # force the _wc_fallback branch
    got = core.configured_browser_path()
    expected = os.path.abspath(os.path.join(fake_root, ".wconsole_data", "cache", "ms-playwright"))
    check("fallback resolves to the single .wconsole_data/cache path", got == expected, f"{got}")
    check("no doubled .wconsole_data/.wconsole_data segment", ".wconsole_data/.wconsole_data" not in got, got)
finally:
    core.BASE_DIR, core.DATA_DIR = _real_base, _real_data
    if saved_env is not None:
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = saved_env

print("== E: run_scraper4.sh bootstraps the browser stack ==")
run_sh = os.path.join(ROOT, "run_scraper4.sh")
check("run_scraper4.sh exists", os.path.isfile(run_sh), run_sh)
src_sh = open(run_sh, encoding="utf-8").read()
parsed = subprocess.run(["bash", "-n", run_sh], capture_output=True, text=True)
check("run_scraper4.sh parses", parsed.returncode == 0, parsed.stderr[:160])
for needle in ("-m playwright install chromium", "undetected-chromedriver",
               "aiohttp", "psutil", "python-dotenv"):
    check(f"run_scraper4.sh mentions {needle!r}", needle in src_sh)
check("mirror logic is INLINE in run_scraper4.sh (no separate file)",
      "cdn.npmmirror.com" in src_sh and "playwright install --dry-run" in src_sh
      and "INSTALLATION_COMPLETE" in src_sh)
check("run_scraper4.sh no longer calls the separate mirror script",
      "install_chromium_mirror.sh" not in src_sh)
check("system-Chromium last resort present", "apt install -y chromium-browser" in src_sh)
check("Termux stays browser-less by design", "is_termux; then" in src_sh and "no desktop Chromium on Android" in src_sh)
vps_sh = os.path.join(ROOT, "tools", "vps-live", "install_scraper4_vps.sh")
vps_src = open(vps_sh, encoding="utf-8").read()
check("vps-live installer ships the new libraries",
      all(x in vps_src for x in ("aiohttp", "undetected-chromedriver", "psutil", "python-dotenv")))
check("vps-live mirror logic is inline too",
      "cdn.npmmirror.com" in vps_src and "install_chromium_mirror.sh" not in vps_src)

print()
if FAIL:
    print(f"{FAIL} FAILED / {PASS} passed")
    sys.exit(1)
print(f"all {PASS} checks passed")
