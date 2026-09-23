#!/usr/bin/env python3
"""Regression tests for 10.245: Playwright self-heal in Codespaces/devcontainers.

Run with the project dependencies installed:

    python3 tools/test_codespace_autofix.py

Offline checks: environment detection, gate behavior (no subprocess without
the right environment), one-shot caching, and static wiring of the
self-heal into the render/picker paths.
"""
from __future__ import annotations

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


class _Forbidden:
    """subprocess.run stand-in that fails the test if called."""

    def __init__(self, store: list) -> None:
        self.store = store

    def __call__(self, *args, **kwargs):  # noqa: ANN002, ANN003
        self.store.append(args)
        raise AssertionError("subprocess.run must not be called in this scenario")


class _AlwaysOk:
    def __init__(self, store: list) -> None:
        self.store = store

    def __call__(self, cmd, *args, **kwargs):  # noqa: ANN002, ANN003
        self.store.append(tuple(cmd))

        class R:
            returncode = 0
            stdout = ""
            stderr = ""

        return R()


def main() -> int:
    tmpdir = tempfile.mkdtemp(prefix="s4-test-245-")
    os.environ["SCRAPER_DATA_FILE"] = os.path.join(tmpdir, "scraper4_data.json")
    import scraper4 as core  # noqa: E402

    saved_env = {k: os.environ.get(k) for k in
                 ("CODESPACES", "CODESPACE_NAME", "REMOTE_CONTAINERS", "DEVCONTAINER", "SCRAPER4_AUTO_INSTALL")}
    real_run = core.subprocess.run

    def restore_env() -> None:
        for key, value in saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    try:
        print("== A: environment detection ==")
        for key in ("CODESPACES", "REMOTE_CONTAINERS", "DEVCONTAINER"):
            os.environ.pop(key, None)
            os.environ.pop("CODESPACE_NAME", None)
            os.environ[key] = "true"
            check(f"{key}=true detected", core.codespace_env())
            os.environ.pop(key, None)
        os.environ["CODESPACE_NAME"] = "fluffy-space-abc"
        check("CODESPACE_NAME detected", core.codespace_env())
        os.environ.pop("CODESPACE_NAME", None)
        check("plain environment not detected", not core.codespace_env())

        print("== B: gates — no install without the right environment ==")
        core._PLAYWRIGHT_AUTOFIX_STATE.update(done=False, ok=False)
        calls: list = []
        core.subprocess.run = _Forbidden(calls)
        os.environ["SCRAPER4_AUTO_INSTALL"] = "0"
        os.environ["CODESPACES"] = "true"
        check("SCRAPER4_AUTO_INSTALL=0 forbids even in Codespaces", core.ensure_playwright_runtime() is False)
        check("no subprocess was spawned", not calls)
        core._PLAYWRIGHT_AUTOFIX_STATE.update(done=False, ok=False)
        os.environ["SCRAPER4_AUTO_INSTALL"] = ""
        os.environ["CODESPACES"] = ""
        check("no codespace marker -> no install", core.ensure_playwright_runtime() is False)
        check("still no subprocess", not calls)
        core.subprocess.run = real_run

        print("== C: one-shot cache + forced install path ==")
        core._PLAYWRIGHT_AUTOFIX_STATE.update(done=True, ok=False)
        core.subprocess.run = _Forbidden(calls)
        check("done-state cached (False)", core.ensure_playwright_runtime() is False)
        core._PLAYWRIGHT_AUTOFIX_STATE.update(done=True, ok=True)
        check("done-state cached (True)", core.ensure_playwright_runtime() is True)
        check("cache answers without subprocess", not calls)
        core._PLAYWRIGHT_AUTOFIX_STATE.update(done=False, ok=False)
        calls2: list = []
        core.subprocess.run = _AlwaysOk(calls2)
        os.environ["SCRAPER4_AUTO_INSTALL"] = "1"
        check("SCRAPER4_AUTO_INSTALL=1 forces the install chain", core.ensure_playwright_runtime() is True)
        joined = " ".join(" ".join(c) for c in calls2)
        check("pip install playwright attempted", "pip" in joined and "playwright" in joined)
        check("chromium download attempted", "playwright" in joined and "install" in joined and "chromium" in joined)
        check("with-deps used (sudo probe passed)", "--with-deps" in joined)
        core.subprocess.run = real_run
        core._PLAYWRIGHT_AUTOFIX_STATE.update(done=False, ok=False)

        print("== D: static wiring ==")
        src = open(os.path.join(ROOT, "scraper4.py"), encoding="utf-8").read()
        check("render_playwright self-heals then retries the import",
              src.count("ensure_playwright_runtime()") >= 2)
        check("error message carries the install commands",
              "python3 -m playwright install --with-deps chromium" in src
              and "pip3 install playwright" in src)
        check("picker path self-heals too",
              "if not fetch_engine_installed(\"playwright\"):\n        # 10.245: self-heal once" in src)
    finally:
        restore_env()
        core.subprocess.run = real_run

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILED: " + ", ".join(FAILURES))
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
