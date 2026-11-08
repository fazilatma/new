"""کلاینتِ سرویسِ رندرِ JS (پوشهٔ browser/ روی Node — Playwright یا Selenium).

قراردادِ ورودی/خروجی با HtmlFetcher سازگار است:
  {'ok': bool, 'code': int, 'error': str, 'url': effective_url,
   'html': str, 'mode': 'render', 'driver': str, 'took_ms': int}

روی PythonAnywhere سرویسِ رندر را نمی‌توان در همان حساب بالا آورد (پورتِ آزاد
ندارد)؛ پس SCRAPER_RENDER_URL را به یک سرویسِ بیرونی (VPS/Render/Fly) بدهید.
"""
from __future__ import annotations

import math
from typing import Any

import requests

from ...config import RenderSettings, Settings, get_settings


def _fail(url: str, error: str) -> dict:
    return {"ok": False, "code": 0, "error": error, "url": url, "html": "",
            "mode": "render"}


class RenderedFetcher:
    @staticmethod
    def get(url: str, opts: dict | None = None,
            settings: Settings | None = None) -> dict:
        settings = settings or get_settings()
        render: RenderSettings = settings.render
        opts = opts or {}
        base = (render.url or "").rstrip("/")
        if base in ("", "http://", "https://"):
            return _fail(url, "renderer url not configured")

        timeout_ms = int(opts.get("timeout_ms") or render.timeout_ms or 60000)
        payload: dict[str, Any] = {
            "url": url,
            "waitUntil": str(opts.get("waitUntil") or render.wait_until or "domcontentloaded"),
            "timeout": timeout_ms,
            "scroll": bool(opts.get("scroll", render.scroll)),
        }
        if opts.get("selector"):
            payload["selector"] = str(opts["selector"])
        if opts.get("blockResources"):
            payload["blockResources"] = True

        headers = {"Accept": "application/json"}
        if render.token:
            headers["Authorization"] = f"Bearer {render.token}"

        try:
            response = requests.post(
                base + "/render",
                json=payload,
                headers=headers,
                timeout=(5, int(math.ceil(timeout_ms / 1000)) + 10),
                verify=True,
            )
        except requests.RequestException as exc:
            return _fail(url, str(exc))

        try:
            body = response.json()
        except ValueError:
            body = None

        if response.status_code >= 400 or not isinstance(body, dict) or not body.get("ok"):
            error = (str(body.get("error")) if isinstance(body, dict) and body.get("error")
                     else f"HTTP {response.status_code}")
            return {"ok": False, "code": response.status_code, "error": error,
                    "url": url, "html": "", "mode": "render"}

        return {
            "ok": True,
            "code": int(body.get("code") or 200),
            "error": "",
            "url": str(body.get("url") or url) or url,
            "html": str(body.get("html") or ""),
            "mode": "render",
            "driver": str(body.get("driver") or ""),
            "took_ms": int(body.get("took_ms") or 0),
        }

    @staticmethod
    def healthy(settings: Settings | None = None) -> bool:
        settings = settings or get_settings()
        base = (settings.render.url or "").rstrip("/")
        if not base:
            return False
        try:
            return requests.get(f"{base}/health", timeout=(3, 5), verify=True).ok
        except requests.RequestException:
            return False


def render(url: str, opts: dict | None = None, settings: Settings | None = None) -> dict:
    return RenderedFetcher.get(url, opts, settings)
