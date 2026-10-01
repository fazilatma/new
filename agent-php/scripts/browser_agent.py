#!/usr/bin/env python3
"""
Playwright bridge for the PHP edition of the Arena Coding Agent.

The PHP process shells out to this script (``python3 browser_agent.py <json>``)
and reads a single JSON document from stdout. This restores the real browser
automation that agent-python/app/browser_automation.py had and that the
Cloudflare Workers port could not provide.

Usage:
    python3 browser_agent.py '{"action":"navigate","url":"https://example.com"}'
    python3 browser_agent.py '{"action":"screenshot","url":"...","fullPage":true}'
    python3 browser_agent.py '{"action":"evaluate","url":"...","expression":"1+1"}'
    python3 browser_agent.py '{"action":"click","url":"...","selector":"#id"}'
    python3 browser_agent.py '{"action":"fill","url":"...","selector":"#q","text":"hi"}'
    python3 browser_agent.py '{"action":"probe"}'

Every response is a JSON object with at least {"ok": bool, "engine": str}.
"""

from __future__ import annotations

import base64
import json
import sys
from typing import Any, Dict


def fail(message: str, engine: str = "playwright") -> None:
    print(json.dumps({"ok": False, "engine": engine, "error": message}))
    sys.exit(0)


def probe() -> None:
    try:
        import playwright  # noqa: F401
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            browsers = []
            for name in ("chromium", "firefox", "webkit"):
                try:
                    browser = getattr(p, name).launch(headless=True)
                    browser.close()
                    browsers.append(name)
                except Exception:
                    pass
        print(json.dumps({"ok": bool(browsers), "engine": "playwright", "browsers": browsers}))
    except Exception as exc:  # pragma: no cover - environment dependent
        print(json.dumps({"ok": False, "engine": "playwright", "error": str(exc)}))


def run(payload: Dict[str, Any]) -> None:
    action = payload.get("action", "navigate")
    if action == "probe":
        probe()
        return

    url = payload.get("url") or "about:blank"
    timeout_ms = int(payload.get("timeoutMs", 30000))
    wait_until = payload.get("waitUntil", "domcontentloaded")

    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:
        fail(f"playwright is not installed: {exc}")
        return

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
            )
            context = browser.new_context(
                viewport={"width": 1280, "height": 800},
                user_agent=payload.get(
                    "userAgent",
                    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36 ArenaAgent/1.0",
                ),
            )
            console_logs: list[str] = []
            network_logs: list[Dict[str, Any]] = []
            page = context.new_page()
            page.on("console", lambda m: console_logs.append(f"[{m.type}] {m.text}"))
            page.on(
                "response",
                lambda r: network_logs.append({"url": r.url, "status": r.status}),
            )

            response = page.goto(url, timeout=timeout_ms, wait_until=wait_until)
            status = response.status if response else 0

            if action == "click" and payload.get("selector"):
                page.click(payload["selector"], timeout=timeout_ms)
                page.wait_for_timeout(500)
            elif action == "fill" and payload.get("selector"):
                page.fill(payload["selector"], payload.get("text", ""), timeout=timeout_ms)

            result: Dict[str, Any] = {
                "ok": True,
                "engine": "playwright-chromium",
                "url": page.url,
                "status": status,
                "title": page.title(),
            }

            if action == "screenshot":
                data = page.screenshot(full_page=bool(payload.get("fullPage")))
                result["screenshotBase64"] = base64.b64encode(data).decode("ascii")
                result["mimeType"] = "image/png"
            elif action == "evaluate":
                result["result"] = page.evaluate(payload.get("expression", "1"))

            if action in ("navigate", "click", "fill"):
                result["content"] = page.evaluate("() => document.body ? document.body.innerText : ''")
                result["rawHtml"] = page.content()
                result["links"] = page.evaluate(
                    "() => Array.from(document.querySelectorAll('a[href]'))"
                    ".slice(0, 100).map(a => ({href: a.href, text: (a.innerText||'').trim()}))"
                )

            result["consoleLogs"] = console_logs[-100:]
            result["networkLogs"] = network_logs[-100:]

            context.close()
            browser.close()
            print(json.dumps(result))
    except Exception as exc:
        fail(str(exc))


def main() -> None:
    raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read()
    try:
        payload = json.loads(raw or "{}")
    except json.JSONDecodeError as exc:
        fail(f"invalid payload: {exc}", engine="bridge")
        return
    run(payload)


if __name__ == "__main__":
    main()
