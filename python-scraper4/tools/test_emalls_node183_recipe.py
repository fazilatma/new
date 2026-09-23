#!/usr/bin/env python3
"""Offline regression for the ported Node 1.183 emalls recipe (10.234).

Evidence being pinned: commit 386a9ce ("1.183.0") of branch
arena/01a0aa17-new extracted every emalls page WITHOUT a browser. Its secret
is generic, not an emalls hack:

  * Chrome/131.0.0.0 user-agent + the exact Node scrape Accept header;
  * NO cookie jar at all — every page request is stateless;
  * manual redirect loop, one bounded 429 retry.

This suite pins the port: the header baseline is Node-identical, the five
HTTP engines all go cookie-less on emalls until a real browser blesses the
run, and non-emalls hosts keep the unchanged 10.229 cookie behaviour.

Runs a local mock server; no external network. Exit 0 = all good.

    python3 tools/test_emalls_node183_recipe.py
"""
from __future__ import annotations

import importlib.util
import os
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
_tmpdir = tempfile.mkdtemp(prefix="scraper4-n183-")
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

print("== A: the Node 1.183 header baseline ==")
check("USER_AGENT is Node's Chrome/131", core.USER_AGENT == NODE_UA, core.USER_AGENT)
check("STATELESS_COOKIE_HOSTS targets emalls.ir", core.STATELESS_COOKIE_HOSTS == ("emalls.ir",),
      str(core.STATELESS_COOKIE_HOSTS))
check("session Accept equals the Node 1.183 value",
      core.Fetcher({"timeout": 5}).session.headers.get("Accept") == NODE_ACCEPT,
      str(core.Fetcher({"timeout": 5}).session.headers.get("Accept")))

print("== B: cookie-gate unit logic ==")
g = core.Fetcher({"timeout": 5})
check("empty store never sends cookies", g._send_cookie_store("emalls.ir") is False)
g._cookies = {"sid": "S1"}
check("non-emalls host keeps the store (10.229 unchanged)", g._send_cookie_store("example.com") is True)
check("emalls subdomains are gated too", g._send_cookie_store("www.emalls.ir") is False)
check("emalls unblessed -> cookie-less (Node recipe)", g._send_cookie_store("emalls.ir") is False)
g._browser_blessed = True
check("emalls after browser blessing -> store rides", g._send_cookie_store("emalls.ir") is True)

print("== C: live fetches — all five HTTP engines go cookie-less on emalls ==")
core.STATELESS_COOKIE_HOSTS = ("emalls.ir", "127.0.0.1")  # the mock lives on 127.0.0.1
for engine in ("requests", "httpx", "cloudscraper", "curl_cffi", "aiohttp"):
    if not core.fetch_engine_installed(engine):
        check(f"{engine}: installed", False, "library missing in test env")
        continue
    fetcher = core.Fetcher({"timeout": 15, "gap_ms": 0})
    fetcher._cookies = {"sid": "S1"}
    fetcher._browser_blessed = False
    result = fetcher.get(BASE + "/p2", engine=engine)
    rec = SEEN["/p2"][-1]
    check(f"{engine}: page fetched", result.status == 200 and "page two" in result.text, str(result.status))
    check(f"{engine}: request went out cookie-less", rec["cookie"] == "", rec["cookie"][:80])
    if engine != "curl_cffi":
        # curl_cffi speaks with its own full Chrome impersonation set (10.230).
        check(f"{engine}: carries the Node Chrome/131 UA", rec["ua"] == NODE_UA, rec["ua"])
        check(f"{engine}: carries the Node Accept", rec["accept"] == NODE_ACCEPT, rec["accept"])

print("== D: Set-Cookie is still absorbed while cookie-less ==")
fetcher = core.Fetcher({"timeout": 15, "gap_ms": 0})
fetcher.get(BASE + "/p1", engine="requests")
check("page-1 Set-Cookie absorbed", fetcher._cookies.get("sid") == "S1", str(fetcher._cookies))
fetcher.get(BASE + "/p2", engine="requests")
check("still cookie-less with an unblessed store", SEEN["/p2"][-1]["cookie"] == "")
check("response cookies keep being absorbed", fetcher._cookies.get("fresh") == "1", str(fetcher._cookies))

print("== E: after browser blessing the trusted session rides again ==")
fetcher._browser_blessed = True
fetcher.get(BASE + "/p2", engine="requests")
check("blessed run sends the session cookie", SEEN["/p2"][-1]["cookie"] == "sid=S1; fresh=1",
      SEEN["/p2"][-1]["cookie"])

print("== F: non-emalls hosts keep the unchanged 10.229 behaviour ==")
core.STATELESS_COOKIE_HOSTS = ("emalls.ir",)  # mock host is no longer gated
fetcher = core.Fetcher({"timeout": 15, "gap_ms": 0})
fetcher._cookies = {"sid": "S1"}
fetcher.get(BASE + "/p2", engine="requests")
check("non-gated host sends the store immediately", SEEN["/p2"][-1]["cookie"] == "sid=S1",
      SEEN["/p2"][-1]["cookie"])

print()
if FAIL:
    print(f"{FAIL} FAILED / {PASS} passed")
    sys.exit(1)
print(f"all {PASS} checks passed")
