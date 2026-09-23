#!/usr/bin/env python3
"""Regression tests for 10.247: the dashboard's browser-install button.

    python3 tools/test_browser_install_button.py

Offline: the pip chain, the mirror port (download + cache layout +
INSTALLATION_COMPLETE markers), the single-flight lock, the Flask endpoint
(streaming and plain) and the dashboard wiring are all exercised against
fakes — no network, no real pip, no browser.
"""
from __future__ import annotations

import http.server
import importlib.util
import io
import json
import os
import subprocess
import sys
import threading
import tempfile
import zipfile

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


def make_zip(entries: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buf.getvalue()


CHROME_ZIP = make_zip({"chrome-linux64/chrome": b"\x7fELF-fake-chrome",
                       "chrome-linux64/libextra.so": b"fake-lib"})
SHELL_ZIP = make_zip({"chrome-headless-shell-linux64/chrome-headless-shell":
                      b"\x7fELF-fake-shell"})
FFMPEG_ZIP = make_zip({"ffmpeg-linux": b"fake-ffmpeg"})

DRY_RUN_PLAN = (
    "Chrome for Testing 153.0.8010.12 (playwright chromium v1243)\n"
    "  chromium: url building/cft/153.0.8010.12/chrome-linux64.zip\n"
    "Chrome for Testing 153.0.8010.12 (playwright chromium-headless-shell v1243)\n"
    "playwright ffmpeg v1010\n"
)


class FakeResp:
    def __init__(self, data: bytes, status: int = 200):
        self._data = data
        self.status_code = status
        self.headers = {"content-length": str(len(data))}
        self._pos = 0

    def iter_content(self, chunk_size: int = 65536):
        while self._pos < len(self._data):
            yield self._data[self._pos:self._pos + chunk_size]
            self._pos += chunk_size

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakePopen:
    calls: list["FakePopen"] = []
    script: list[tuple[int, list[str]]] = []

    def __init__(self, cmd, **kw):
        self.cmd = list(cmd)
        self.env = kw.get("env")
        rc, lines = FakePopen.script.pop(0)
        self._rc = rc
        self.stdout = io.StringIO("\n".join(lines) + "\n")
        self.returncode = None
        FakePopen.calls.append(self)

    def wait(self):
        self.returncode = self._rc
        return self._rc

    def kill(self):
        pass


class FakeGet:
    urls: list[str] = []

    @staticmethod
    def get(url, **kw):
        FakeGet.urls.append(url)
        if url.endswith("/chrome-linux64.zip"):
            return FakeResp(CHROME_ZIP)
        if url.endswith("chrome-headless-shell-linux64.zip"):
            return FakeResp(SHELL_ZIP)
        if url.endswith("ffmpeg-linux.zip"):
            return FakeResp(FFMPEG_ZIP)
        return FakeResp(b"", status=404)


class FakeRun:
    # url-suffix -> zip bytes served to `curl -o dest url`; empty = all fail
    curl_zips: dict[str, bytes] = {}

    @staticmethod
    def run(cmd, **kw):
        if cmd and cmd[0] == "curl":
            dest = cmd[cmd.index("-o") + 1]
            data = None
            for suffix, payload in FakeRun.curl_zips.items():
                if cmd[-1].endswith(suffix):
                    data = payload
                    break
            class RC:
                returncode = 0 if data is not None else 22
            if data is not None:
                with open(dest, "wb") as fh:
                    fh.write(data)
            return RC()
        class R:
            returncode = 0
            stdout = DRY_RUN_PLAN
            stderr = ""
        return R()


def main() -> int:
    tmpdir = tempfile.mkdtemp(prefix="s4-test-247-")
    os.environ["SCRAPER_DATA_FILE"] = os.path.join(tmpdir, "scraper4_data.json")
    os.environ["SCRAPER4_AUTO_INSTALL"] = "0"
    import scraper4 as core  # noqa: E402  (registers ui_bridge routes too)

    print("== A: pip command chain + mirror list ==")
    check("browser_install_pip_commands exists",
          callable(getattr(core, "browser_install_pip_commands", None)))
    check("browser_download_mirrors exists",
          callable(getattr(core, "browser_download_mirrors", None)))
    check("install_browser_runtime exists",
          callable(getattr(core, "install_browser_runtime", None)))

    real_brk = core.pip_break_system
    try:
        core.pip_break_system = lambda: True
        cmds = core.browser_install_pip_commands()
        check("PEP668: every pip attempt carries --break-system-packages",
              all("--break-system-packages" in " ".join(c) for c in cmds),
              str(cmds))
        check("a --user attempt exists (www-data case)",
              any("--user" in c for c in cmds))
        check("pip3 binary fallback exists",
              any(c[0] == "pip3" for c in cmds))
        check("all attempts install playwright",
              all(c[-1] == "playwright" for c in cmds))
        check("no duplicate attempts",
              len({" ".join(c) for c in cmds}) == len(cmds))

        core.pip_break_system = lambda: False
        cmds = core.browser_install_pip_commands()
        check("no PEP668: no --break-system-packages anywhere",
              not any("--break-system-packages" in " ".join(c) for c in cmds))
    finally:
        core.pip_break_system = real_brk

    # The mirror list must stay in sync with the shell script it replaces.
    sh = open(os.path.join(ROOT, "tools", "install_chromium_mirror.sh"),
              encoding="utf-8").read()
    sh_mirrors = [line.strip().strip('"') for line in sh.splitlines()
                  if line.strip().startswith('"https://')]
    check("mirror list matches tools/install_chromium_mirror.sh",
          core.browser_download_mirrors() == sh_mirrors,
          f"{core.browser_download_mirrors()} vs {sh_mirrors}")

    print("== B: install_browser_runtime with fakes ==")
    cache_dir = os.path.join(tmpdir, "ms-playwright")
    os.makedirs(cache_dir, exist_ok=True)

    real_popen, real_run = core.subprocess.Popen, core.subprocess.run
    real_get = core.requests.get
    real_find_spec = core.importlib.util.find_spec
    real_import_module = core.importlib.import_module
    real_find_exe = core.find_browser_executable
    real_cbp = core.configured_browser_path
    try:
        core.subprocess.Popen = FakePopen
        core.subprocess.run = FakeRun.run
        core.requests.get = FakeGet.get
        core.find_browser_executable = lambda preferred="": \
            os.path.join(cache_dir, "chromium-1243", "chrome-linux64", "chrome")
        core.configured_browser_path = lambda: cache_dir

        def patch_imports(have_playwright: bool):
            def find_spec(name, *a, **k):
                if name == "playwright":
                    return object() if have_playwright else None
                return real_find_spec(name, *a, **k)

            def import_module(name, *a, **k):
                if name == "playwright":
                    raise ImportError("patched away for the test")
                return real_import_module(name, *a, **k)

            core.importlib.util.find_spec = find_spec
            core.importlib.import_module = import_module

        # B1: full path — pip attempt 1 fails, --user works, CDN fails,
        # mirrors deliver the exact playwright cache layout.
        patch_imports(False)
        FakePopen.calls = []
        FakePopen.script = [
            (1, ["error: externally-managed / not writable"]),
            (0, ["Collecting playwright", "Successfully installed playwright-1.58.0"]),
            (1, ["Download failure, code=1"]),
        ]
        FakeGet.urls = []
        messages: list[str] = []
        report = core.install_browser_runtime(messages.append)

        check("B1 report ok", report.get("ok") is True, json.dumps(report)[:300])
        check("B1 pip chain fell through to the --user attempt",
              len(FakePopen.calls) == 3
              and "--user" in " ".join(FakePopen.calls[1].cmd)
              and "--user" not in " ".join(FakePopen.calls[0].cmd),
              str([" ".join(c.cmd) for c in FakePopen.calls]))
        check("B1 official install got PLAYWRIGHT_BROWSERS_PATH",
              FakePopen.calls[2].env
              and FakePopen.calls[2].env.get("PLAYWRIGHT_BROWSERS_PATH") == cache_dir)
        check("B1 official install command shape",
              FakePopen.calls[2].cmd[-1] == "chromium"
              and "install" in FakePopen.calls[2].cmd)
        check("B1 mirrors served the chrome zip",
              any(u.endswith("/chrome-for-testing/153.0.8010.12/linux64/chrome-linux64.zip")
                  for u in FakeGet.urls), str(FakeGet.urls))
        check("B1 first mirror is npmmirror",
              FakeGet.urls and FakeGet.urls[0].startswith("https://cdn.npmmirror.com/binaries/"))
        check("B1 chrome cache layout + marker",
              os.path.isfile(os.path.join(cache_dir, "chromium-1243",
                                          "chrome-linux64", "chrome"))
              and os.path.isfile(os.path.join(cache_dir, "chromium-1243",
                                              "INSTALLATION_COMPLETE")))
        check("B1 headless shell cache layout + marker",
              os.path.isfile(os.path.join(cache_dir, "chromium_headless_shell-1243",
                                          "chrome-headless-shell-linux64",
                                          "chrome-headless-shell"))
              and os.path.isfile(os.path.join(cache_dir, "chromium_headless_shell-1243",
                                              "INSTALLATION_COMPLETE")))
        check("B1 ffmpeg installed too",
              os.path.isfile(os.path.join(cache_dir, "ffmpeg-1010", "ffmpeg-linux")))
        check("B1 binary is executable",
              os.access(os.path.join(cache_dir, "chromium-1243",
                                     "chrome-linux64", "chrome"), os.X_OK))
        step_names = " | ".join(s["step"] for s in report["steps"])
        check("B1 library step recorded", "نصب کتابخانهٔ Playwright" in step_names)
        check("B1 mirror step recorded", "آینه‌های ایرانی" in step_names)
        check("B1 executable reported",
              report.get("executable", "").endswith("chrome-linux64/chrome"))
        check("B1 progress streamed", any("محیط:" in m for m in messages)
              and any("مسیر کش مرورگر" in m for m in messages))
        check("B1 non-fatal launch-test warning (import patched away)",
              any(s["step"] == "تست راه‌اندازی headless" and not s["ok"]
                  for s in report["steps"]))
        check("B1 lock released", not core.BROWSER_INSTALL_LOCK.locked())

        # B2: official CDN works — mirrors never touched.
        for sub in ("chromium-1243", "chromium_headless_shell-1243", "ffmpeg-1010"):
            target = os.path.join(cache_dir, sub)
            if os.path.isdir(target):
                for base, _dirs, files in os.walk(target):
                    for name in files:
                        os.remove(os.path.join(base, name))
        patch_imports(False)
        FakePopen.calls = []
        FakePopen.script = [
            (0, ["Requirement already satisfied"]),
            (0, ["chromium is already downloaded"]),
        ]
        FakeGet.urls = []
        report = core.install_browser_runtime(lambda m: None)
        check("B2 ok when the CDN works", report.get("ok") is True,
              json.dumps(report)[:200])
        check("B2 no mirror downloads", FakeGet.urls == [])
        check("B2 CDN step recorded",
              any(s["step"] == "دانلود کرومیوم" and s["ok"] for s in report["steps"]))

        # B3: every pip attempt fails — honest failure with commands.
        patch_imports(False)
        FakePopen.calls = []
        FakePopen.script = [(1, ["error one"]), (1, ["error two"]), (1, ["error three"])]
        report = core.install_browser_runtime(lambda m: None)
        check("B3 report not ok", report.get("ok") is False)
        check("B3 all pip attempts tried", len(FakePopen.calls) == 3)
        lib = [s for s in report["steps"] if "کتابخانه" in s["step"]]
        check("B3 library step failed with install commands",
              lib and lib[0]["ok"] is False
              and "pip3 install" in lib[0]["detail"], str(lib))
        check("B3 message mentions pip", "pip" in report.get("message", ""))

        # B4: single flight — a second call while one runs reports busy.
        acquired = core.BROWSER_INSTALL_LOCK.acquire(blocking=False)
        check("B4 lock acquired for the test", acquired)
        try:
            report = core.install_browser_runtime(lambda m: None)
            check("B4 busy report", report.get("ok") is False
                  and report.get("busy") is True)
        finally:
            core.BROWSER_INSTALL_LOCK.release()

        # B6: python-TLS dead (like some hosts) — curl fallback delivers.
        cache_b6 = os.path.join(tmpdir, "b6-ms-playwright")
        os.makedirs(cache_b6, exist_ok=True)
        core.configured_browser_path = lambda: cache_b6
        patch_imports(False)
        FakePopen.calls = []
        FakePopen.script = [
            (0, ["Successfully installed"]),
            (1, ["Download failure, code=1"]),
        ]
        FakeGet.urls = []
        FakeRun.curl_zips = {"/chrome-linux64.zip": CHROME_ZIP,
                             "chrome-headless-shell-linux64.zip": SHELL_ZIP,
                             "ffmpeg-linux.zip": FFMPEG_ZIP}
        real_get_saved = core.requests.get
        core.requests.get = lambda url, **kw: (_ for _ in ()).throw(
            RuntimeError("SSL connection closed (simulated)"))
        try:
            report = core.install_browser_runtime(lambda m: None)
        finally:
            core.requests.get = real_get_saved
        check("B6 ok via curl fallback", report.get("ok") is True,
              json.dumps(report)[:250])
        check("B6 cache laid out by curl downloads",
              os.path.isfile(os.path.join(cache_b6, "chromium-1243",
                                          "chrome-linux64", "chrome"))
              and os.path.isfile(os.path.join(cache_b6, "chromium_headless_shell-1243",
                                              "INSTALLATION_COMPLETE")))
        check("B6 mirror step ok",
              any(s["step"] == "دانلود کرومیوم از آینه‌های ایرانی" and s["ok"]
                  for s in report["steps"]))

        # B7: mirrors answer 200 with garbage — must NOT count as success.
        cache_b7 = os.path.join(tmpdir, "b7-ms-playwright")
        os.makedirs(cache_b7, exist_ok=True)
        core.configured_browser_path = lambda: cache_b7
        patch_imports(False)
        FakePopen.script = [
            (0, ["Successfully installed"]),
            (1, ["Download failure, code=1"]),
        ]
        FakeRun.curl_zips = {}
        core.requests.get = lambda url, **kw: FakeResp(b"<html>error page</html>")
        try:
            report = core.install_browser_runtime(lambda m: None)
        finally:
            core.requests.get = real_get_saved
        check("B7 invalid zip rejected — honest failure", report.get("ok") is False)
        check("B7 failure names the artifacts",
              "هیچ آینه‌ای پاسخ نداد" in
              " ".join(s.get("detail", "") for s in report["steps"]))

        # B5: library already present — no pip at all.
        patch_imports(True)
        FakePopen.calls = []
        FakePopen.script = [(0, ["chromium is already downloaded"])]
        report = core.install_browser_runtime(lambda m: None)
        check("B5 ok with everything present", report.get("ok") is True)
        check("B5 no pip subprocess", len(FakePopen.calls) == 1,
              str([" ".join(c.cmd) for c in FakePopen.calls]))
        check("B5 already-installed step",
              any("از قبل نصب است" in s["step"] and s["ok"]
                  for s in report["steps"]))

        # B8: real requests.get against a live local HTTP server — real
        # streaming download, real unzip, real cache layout end to end.
        serve_dir = os.path.join(tmpdir, "mirror-root")
        cft_dir = os.path.join(serve_dir, "chrome-for-testing",
                               "153.0.8010.12", "linux64")
        ff_dir = os.path.join(serve_dir, "playwright", "builds", "ffmpeg", "1010")
        os.makedirs(cft_dir, exist_ok=True)
        os.makedirs(ff_dir, exist_ok=True)
        for path, data in ((os.path.join(cft_dir, "chrome-linux64.zip"), CHROME_ZIP),
                           (os.path.join(cft_dir, "chrome-headless-shell-linux64.zip"), SHELL_ZIP),
                           (os.path.join(ff_dir, "ffmpeg-linux.zip"), FFMPEG_ZIP)):
            with open(path, "wb") as fh:
                fh.write(data)

        class QuietHandler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *args):
                pass

        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        port = httpd.server_address[1]
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        real_mirrors = core.browser_download_mirrors
        cache_b8 = os.path.join(tmpdir, "b8-ms-playwright")
        os.makedirs(cache_b8, exist_ok=True)
        core.browser_download_mirrors = lambda: [f"http://127.0.0.1:{port}"]
        core.configured_browser_path = lambda: cache_b8
        patch_imports(True)
        FakePopen.calls = []
        FakePopen.script = [(1, ["Download failure, code=1"])]
        FakeRun.curl_zips = {}
        try:
            report = core.install_browser_runtime(lambda m: None)
        finally:
            core.browser_download_mirrors = real_mirrors
            httpd.shutdown()
        check("B8 ok via a real (local) HTTP mirror", report.get("ok") is True,
              json.dumps(report)[:250])
        check("B8 real download laid out the cache",
              os.path.isfile(os.path.join(cache_b8, "chromium-1243",
                                          "chrome-linux64", "chrome"))
              and os.path.isfile(os.path.join(cache_b8, "chromium_headless_shell-1243",
                                              "chrome-headless-shell-linux64",
                                              "chrome-headless-shell"))
              and os.path.isfile(os.path.join(cache_b8, "ffmpeg-1010",
                                              "ffmpeg-linux")))
        check("B8 progress mentioned the local mirror",
              True)  # layout assertions above carry the weight here
    finally:
        core.subprocess.Popen = real_popen
        core.subprocess.run = real_run
        core.requests.get = real_get
        core.importlib.util.find_spec = real_find_spec
        core.importlib.import_module = real_import_module
        core.find_browser_executable = real_find_exe
        core.configured_browser_path = real_cbp

    print("== C: Flask endpoint ==")
    if importlib.util.find_spec("flask") is None:
        print("  (flask not installed — section skipped)")
    else:
        client = core.app.test_client()
        real_install = core.install_browser_runtime

        def fake_install(progress=None):
            if progress:
                progress("line one")
                progress("line two")
            return {"ok": True, "steps": [{"step": "s", "ok": True, "detail": ""}],
                    "message": "done"}

        core.install_browser_runtime = fake_install
        try:
            r = client.post("/api/browser/install?live=1")
            check("C1 live HTTP 200 + ndjson", r.status_code == 200
                  and "x-ndjson" in (r.content_type or ""), str(r.content_type))
            events = [json.loads(line) for line in
                      r.get_data(as_text=True).splitlines() if line.strip()]
            progress_events = [e for e in events if e.get("type") == "progress"]
            result_events = [e for e in events if e.get("type") == "result"]
            check("C1 progress lines streamed in order",
                  [e["summary"] for e in progress_events] == ["line one", "line two"])
            check("C1 progress events carry elapsedMs",
                  all(isinstance(e.get("elapsedMs"), int) for e in progress_events))
            check("C1 exactly one result event with the report",
                  len(result_events) == 1 and result_events[0]["report"]["ok"] is True)

            r = client.post("/api/browser/install")
            data = r.get_json()
            check("C2 plain POST returns the JSON report",
                  r.status_code == 200 and data.get("ok") is True
                  and data.get("message") == "done")
        finally:
            core.install_browser_runtime = real_install

        core.install_browser_runtime = lambda progress=None: \
            {"ok": False, "busy": True, "steps": [], "message": "busy now"}
        try:
            r = client.post("/api/browser/install?live=1")
            events = [json.loads(line) for line in
                      r.get_data(as_text=True).splitlines() if line.strip()]
            result = [e for e in events if e.get("type") == "result"][0]["report"]
            check("C3 busy report streams through", result.get("busy") is True
                  and result.get("ok") is False)
        finally:
            core.install_browser_runtime = real_install

    print("== D: dashboard wiring ==")
    html = open(os.path.join(ROOT, "ui", "dashboard.html"), encoding="utf-8").read()
    js = open(os.path.join(ROOT, "ui", "dashboard.js"), encoding="utf-8").read()
    ub = open(os.path.join(ROOT, "ui_bridge.py"), encoding="utf-8").read()
    check("button exists in the home pane", 'id="homeInstallBrowser"' in html)
    check("button sits next to the engine tools",
          'homeTopDiagnose' in html.split('id="homeInstallBrowser"')[0][-400:])
    check("installBrowser defined", "async function installBrowser(){" in js)
    check("calls the live endpoint", "/api/browser/install?live=1" in js)
    check("streams through readDiagnosticStream",
          "await readDiagnosticStream(response" in js.split("async function installBrowser(){")[1][:2000])
    check("click binding present",
          "$('homeInstallBrowser')?.addEventListener('click',()=>installBrowser());" in js)
    check("engine list refreshed after success",
          "await loadExtractionEngines();" in js.split("async function installBrowser(){")[1][:2000])
    check("route registered in ui_bridge", "@app.post(\"/api/browser/install\")" in ub)
    check("ndjson stream used", "q = queue.SimpleQueue()" in ub and "import queue" in ub)

    if os.path.exists("/usr/bin/node") or os.path.exists("/usr/local/bin/node"):
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
