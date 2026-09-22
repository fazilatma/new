#!/usr/bin/env python3
"""Offline regression for the 10.233 engine-library integration.

The user's library list had leftovers that were documented but never wired
into the extraction engines. This suite pins the new contracts:

  * aiohttp      — a real HTTP fetch engine (flat-cookie + redirect guard),
                   reachable from Fetcher, the auto chain and the menus.
  * undetected   — undetected-chromedriver as a first-class browser engine
                   with the same dispatch/chain/picker paths as selenium.
  * psutil       — orphaned chromium/chromedriver processes of a crashed
                   session are reaped via the unique profile-dir tag.
  * python-dotenv— optional .env next to the project, real env wins.
  * bs4 on lxml  — every BeautifulSoup sample call picks lxml when present.
  * fastapi/uvicorn are deliberately NOT engines (web frameworks, not
    fetch/parse tools) — the suite pins the exclusion too.

Runs a local mock server; no external network. Plain asserts; exit 0 = good.

    python3 tools/test_extraction_engines_matrix.py
"""
from __future__ import annotations

import importlib.util
import inspect
import io
import os
import sys
import tempfile
import threading
import types
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.dirname(ROOT))

spec = importlib.util.spec_from_file_location("scraper4", os.path.join(ROOT, "scraper4.py"))
core = importlib.util.module_from_spec(spec)
sys.modules["scraper4"] = core
spec.loader.exec_module(core)

# Allow the local mock (the SSRF guard otherwise refuses loopback hosts).
core.public_http_url = lambda u: (u or "").strip()

_tmpdir = tempfile.mkdtemp(prefix="scraper4-engines-")
core.DATA_FILE = os.path.join(_tmpdir, "data.json")

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


# ── local mock server ────────────────────────────────────────────────────────
class MockSite(BaseHTTPRequestHandler):
    def log_message(self, *args):  # silence
        pass

    def _send(self, code: int, body: bytes, headers: list[tuple[str, str]]):
        self.send_response(code)
        for key, value in headers:
            self.send_header(key, value)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/start":
            self._send(200, b"<html><title>start</title><body>shop page</body></html>",
                       [("Set-Cookie", "sid=abc123; Path=/"),
                        ("Set-Cookie", "layer=two; Path=/")])
        elif self.path == "/hop":
            self.send_response(302)
            self.send_header("Location", "/final")
            self.send_header("Set-Cookie", "hop=1; Path=/")
            self.end_headers()
        elif self.path == "/final":
            self._send(200, b"<html><title>final</title><body>final page</body></html>",
                       [("Set-Cookie", "fin=yes; Path=/")])
        elif self.path in ("/loop1", "/loop2"):
            nxt = "/loop2" if self.path == "/loop1" else "/loop1"
            self.send_response(302)
            self.send_header("Location", nxt)
            self.end_headers()
        elif self.path == "/blocked":
            self._send(200, b"<html><body>Access Denied</body></html>", [])
        else:
            self._send(404, b"nope", [])


_server = ThreadingHTTPServer(("127.0.0.1", 0), MockSite)
PORT = _server.server_address[1]
threading.Thread(target=_server.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{PORT}"


def fresh_fetcher() -> "core.Fetcher":
    return core.Fetcher({"timeout": 10, "gap_ms": 0})


print("== A: engine registry composition ==")
check("aiohttp closes the HTTP_ENGINE_ORDER chain",
      core.HTTP_ENGINE_ORDER == ("requests", "httpx", "curl_cffi", "cloudscraper", "aiohttp"),
      str(core.HTTP_ENGINE_ORDER))
check("undetected is a known engine", "undetected" in core.KNOWN_ENGINES and core.KNOWN_ENGINES[-1] == "undetected",
      str(core.KNOWN_ENGINES))
check("BROWSER_ENGINES = playwright+selenium+undetected",
      set(core.BROWSER_ENGINES) == {"playwright", "selenium", "undetected"}, str(core.BROWSER_ENGINES))
check("fastapi/uvicorn are NOT engines (web frameworks, not fetchers)",
      "fastapi" not in core.KNOWN_ENGINES and "uvicorn" not in core.KNOWN_ENGINES and
      not any("fastapi" in e or "uvicorn" in e for e in core.KNOWN_ENGINES), str(core.KNOWN_ENGINES))

print("== B: availability probe ==")
check("aiohttp installed -> engine available", core.fetch_engine_installed("aiohttp") is True)
_real = sys.modules.get("aiohttp")
try:
    sys.modules["aiohttp"] = None  # forces "import of aiohttp halted"
    check("aiohttp missing -> engine unavailable", core.fetch_engine_installed("aiohttp") is False)
finally:
    if _real is None:
        sys.modules.pop("aiohttp", None)
    else:
        sys.modules["aiohttp"] = _real
check("undetected module name is undetected_chromedriver",
      core.fetch_engine_installed.__code__ and
      'undetected_chromedriver' in inspect.getsource(core.fetch_engine_installed))

print("== C: dashboard catalogue (ui_bridge) ==")
import ui_bridge  # noqa: E402  (does not import scraper4 at import time)

fetch_ids = {row[0]: row[3] for row in ui_bridge.ENGINE_CATALOGUE if row[2] == "fetch"}
check("catalogue offers aiohttp (module aiohttp)", fetch_ids.get("aiohttp") == "aiohttp", str(fetch_ids))
check("catalogue offers undetected (module undetected_chromedriver)",
      fetch_ids.get("undetected") == "undetected_chromedriver", str(fetch_ids))
check("FETCH_ENGINES accepts the new ids", "aiohttp" in ui_bridge.FETCH_ENGINES and "undetected" in ui_bridge.FETCH_ENGINES)

print("== D: real aiohttp fetch via Fetcher ==")
fetcher = fresh_fetcher()
result = fetcher.get(BASE + "/start", engine="aiohttp")
check("aiohttp returns the page", result.status == 200 and "shop page" in result.text, f"{result.status}")
check("Set-Cookie absorbed into the flat store (both headers)",
      fetcher._cookies.get("sid") == "abc123" and fetcher._cookies.get("layer") == "two",
      str(fetcher._cookies))

fetcher2 = fresh_fetcher()
fetcher2._cookies["pre"] = "1"  # rides along via the Cookie header
result2 = fetcher2.get(BASE + "/hop", engine="aiohttp")
check("aiohttp follows the manual redirect loop",
      result2.status == 200 and result2.url.endswith("/final") and "final page" in result2.text,
      f"{result2.status} {result2.url}")
check("cookies from both redirect hops absorbed",
      fetcher2._cookies.get("hop") == "1" and fetcher2._cookies.get("fin") == "yes" and fetcher2._cookies.get("pre") == "1",
      str(fetcher2._cookies))

fetcher3 = fresh_fetcher()
try:
    fetcher3.get(BASE + "/loop1", engine="aiohttp")
    check("redirect loop stops at the cap", False, "no error raised")
except core.FetchError as exc:
    check("redirect loop stops at the cap", "بیش از حد" in str(exc), str(exc)[:120])

fetcher4 = fresh_fetcher()
try:
    fetcher4.get(BASE + "/blocked", engine="aiohttp")
    check("anti-bot page still detected on aiohttp path", False, "no error raised")
except core.FetchError as exc:
    check("anti-bot page still detected on aiohttp path", "ضدبات" in str(exc) and "aiohttp" in str(exc), str(exc)[:140])

print("== E: undetected dispatch and chain placement ==")
_sentinel = core.FetchResult(BASE + "/uc", "<html>uc</html>", "text/html", 200, "undetected")
_orig_render_uc = core.render_undetected
seen: list[str] = []
core.render_undetected = lambda url, timeout, scrolls=4, task_id="": (seen.append(url), _sentinel)[1]
try:
    got = fresh_fetcher()._get_blocking(BASE + "/uc", engine="undetected")
    check("Fetcher routes engine=undetected to render_undetected",
          got.mode == "undetected" and seen == [BASE + "/uc"], f"{got.mode} {seen}")
finally:
    core.render_undetected = _orig_render_uc

_orig_installed = core.fetch_engine_installed
try:
    core.fetch_engine_installed = lambda e: True
    chain = core.engine_try_order(master="", requested="", mode="auto")
    check("auto chain: every HTTP engine in order, playwright only browser",
          chain == ["requests", "httpx", "curl_cffi", "cloudscraper", "aiohttp", "playwright"], str(chain))
    chain_uc = core.engine_try_order(master="", requested="undetected", mode="auto")
    check("pinned undetected leads the chain", chain_uc[0] == "undetected" and "selenium" not in chain_uc, str(chain_uc))
    chain_auto2 = core.engine_try_order(master="selenium", requested="", mode="auto")
    check("master selenium joins browsers without undetected",
          chain_auto2[-2:] == ["selenium", "playwright"] or ("selenium" in chain_auto2 and "undetected" not in chain_auto2),
          str(chain_auto2))
finally:
    core.fetch_engine_installed = _orig_installed
chain_real = core.engine_try_order(master="", requested="", mode="auto")
check("without a browser binary, auto chain is HTTP-only",
      all(e not in core.BROWSER_ENGINES for e in chain_real) and "aiohttp" in chain_real, str(chain_real))

print("== F: psutil orphan reaper ==")
killed: list[int] = []
class _FakeProc:
    def __init__(self, info):
        self.info = info
    def terminate(self):
        killed.append(self.info["pid"])

fake_psutil = types.ModuleType("psutil")
fake_psutil.process_iter = lambda attrs=None: [
    _FakeProc({"pid": 111, "name": "chrome", "cmdline": ["/usr/bin/chrome", f"--user-data-dir={_tmpdir}/scraper4-sel-xyz"]}),
    _FakeProc({"pid": 112, "name": "python3", "cmdline": ["python3", "scraper4-sel-xyz"]}),
    _FakeProc({"pid": 113, "name": "chromedriver", "cmdline": ["/usr/bin/chromedriver", "--port=1"]}),
]
_real_psutil = sys.modules.get("psutil")
sys.modules["psutil"] = fake_psutil
try:
    n = core.reap_browser_orphans(f"{_tmpdir}/scraper4-sel-xyz")
    check("only the tagged chrome process is terminated", n == 1 and killed == [111], f"n={n} killed={killed}")
    check("no tag -> reaper does nothing", core.reap_browser_orphans("") == 0 and killed == [111])
finally:
    if _real_psutil is None:
        sys.modules.pop("psutil", None)
    else:
        sys.modules["psutil"] = _real_psutil

sel_src = inspect.getsource(core.render_selenium)
uc_src = inspect.getsource(core.render_undetected)
check("selenium session carries a unique profile dir + reaper call",
      "--user-data-dir={profile_dir}" in sel_src and "reap_browser_orphans(profile_dir)" in sel_src)
check("undetected session carries the uc tag + reaper call",
      "scraper4-uc-" in uc_src and "reap_browser_orphans" in uc_src and "uc.Chrome(options=opts, headless=True" in uc_src)

print("== G: python-dotenv (optional .env, real env wins) ==")
env_dir = tempfile.mkdtemp(prefix="scraper4-env-")
with io.open(os.path.join(env_dir, ".env"), "w", encoding="utf-8") as fh:
    fh.write("S4_DOTENV_PROBE=from-file\nS4_DOTENV_SECOND=also-file\n")
_real_base = core.BASE_DIR
os.environ.pop("S4_DOTENV_PROBE", None)
os.environ.pop("S4_DOTENV_SECOND", None)
try:
    core.BASE_DIR = env_dir
    core._load_dotenv_file()
    check(".env values loaded", os.environ.get("S4_DOTENV_PROBE") == "from-file", os.environ.get("S4_DOTENV_PROBE", ""))
    os.environ["S4_DOTENV_PROBE"] = "from-real-env"
    core._load_dotenv_file()
    check("real environment keeps precedence (override=False)",
          os.environ.get("S4_DOTENV_PROBE") == "from-real-env", os.environ.get("S4_DOTENV_PROBE", ""))
    check("second key also read", os.environ.get("S4_DOTENV_SECOND") == "also-file")
finally:
    core.BASE_DIR = _real_base
    os.environ.pop("S4_DOTENV_PROBE", None)
    os.environ.pop("S4_DOTENV_SECOND", None)

print("== H: beautifulsoup4 rides the lxml parser ==")
check("_bs4_parser picks lxml when installed", core._bs4_parser() == "lxml", core._bs4_parser())
_lxml_real = sys.modules.get("lxml")
try:
    sys.modules["lxml"] = None
    check("_bs4_parser falls back to html.parser", core._bs4_parser() == "html.parser", core._bs4_parser())
finally:
    if _lxml_real is None:
        sys.modules.pop("lxml", None)
    else:
        sys.modules["lxml"] = _lxml_real
check("sample/anti-bot call sites use the helper (no bare html.parser left)",
      '"html.parser")' not in inspect.getsource(core.Fetcher._get_blocking) and
      'BeautifulSoup(html[:200000], _bs4_parser())' in sel_src)

print("== I: menus, picker and installer wiring ==")
main_src = inspect.getsource(sys.modules["scraper4"])
check("classic UI menu offers aiohttp + undetected",
      'value="aiohtml" placeholder' not in main_src and '<option value="aiohttp">aiohttp</option>' in main_src
      and '<option value="undetected">Undetected-Chromedriver</option>' in main_src)
check("visual picker routes undetected", 'engine="undetected"' in main_src and 'render_undetected(url, timeout, scrolls)' in main_src)
check("dependency installer ships the new libraries",
      '"undetected-chromedriver", "playwright-stealth", "psutil", "python-dotenv"' in main_src
      and '"aiohttp", "psutil", "python-dotenv"' in main_src)
check("rescue lambdas know the third browser",
      main_src.count('if bengine=="undetected"') == 1 and main_src.count('if _bengine=="undetected"') == 1)

print()
if FAIL:
    print(f"{FAIL} FAILED / {PASS} passed")
    sys.exit(1)
print(f"all {PASS} checks passed")
