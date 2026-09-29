"""Playwright Browser Automation, Multi-tab Session Manager, DOM Extraction, and SSRF Protection."""
import os
import re
import ipaddress
import urllib.parse
import base64
import time
import httpx
from typing import Dict, Any, List, Optional

# SSRF Protection
PRIVATE_IP_RANGES = [
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]

def validate_url_security(url: str):
    if not url.startswith(("http://", "https://")):
        raise ValueError("Only http:// and https:// URLs are allowed.")

    parsed = urllib.parse.urlparse(url)
    hostname = parsed.hostname or ""

    if hostname.lower() in ("localhost", "0.0.0.0", "127.0.0.1"):
        # Block access to local host services
        raise ValueError("Access to localhost is restricted for security.")

    try:
        ip = ipaddress.ip_address(hostname)
        for private_net in PRIVATE_IP_RANGES:
            if ip in private_net:
                raise ValueError(f"Access to private network address {hostname} is blocked.")
    except ValueError as e:
        if "does not appear to be an IPv4 or IPv6 address" not in str(e):
            raise

class BrowserManager:
    def __init__(self):
        self._playwright = None
        self._browser = None
        self._contexts: Dict[str, Any] = {}
        self._pages: Dict[str, Any] = {}
        self._console_logs: Dict[str, List[str]] = {}
        self._network_logs: Dict[str, List[Dict[str, Any]]] = {}

    async def _init_browser(self):
        if self._browser is None:
            try:
                from playwright.async_api import async_playwright
                self._playwright = await async_playwright().start()
                self._browser = await self._playwright.chromium.launch(
                    headless=True,
                    args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
                )
            except Exception as e:
                # Playwright browser binary might not be installed, will use httpx fallback
                self._playwright = None
                self._browser = None

    async def create_session(self, session_id: str = "default") -> Dict[str, Any]:
        await self._init_browser()
        if self._browser:
            context = await self._browser.new_context(
                user_agent="Arena-Agent-Browser/1.0 (X11; Linux x86_64)",
                viewport={"width": 1280, "height": 800}
            )
            page = await context.new_page()
            self._contexts[session_id] = context
            self._pages[session_id] = page
            self._console_logs[session_id] = []
            self._network_logs[session_id] = []

            page.on("console", lambda msg: self._console_logs[session_id].append(f"[{msg.type}] {msg.text}"))
            page.on("response", lambda res: self._network_logs[session_id].append({
                "url": res.url,
                "status": res.status,
                "contentType": res.headers.get("content-type", "")
            }))
            return {"sessionId": session_id, "engine": "playwright", "status": "active"}

        return {"sessionId": session_id, "engine": "http_fetch", "status": "active"}

    async def navigate(self, url: str, session_id: str = "default") -> Dict[str, Any]:
        validate_url_security(url)
        await self._init_browser()

        if session_id not in self._pages and self._browser:
            await self.create_session(session_id)

        if self._browser and session_id in self._pages:
            page = self._pages[session_id]
            resp = await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            title = await page.title()
            text_content = await page.evaluate("() => document.body.innerText")
            return {
                "url": page.url,
                "status": resp.status if resp else 200,
                "title": title,
                "content": text_content[:50000],
                "engine": "playwright"
            }

        # Fallback to HTTP Fetch
        async with httpx.AsyncClient(timeout=30, follow_redirects=True, headers={"User-Agent": "Arena-Agent/1.0"}) as client:
            r = await client.get(url)
            return {
                "url": str(r.url),
                "status": r.status_code,
                "title": url,
                "content": r.text[:50000],
                "engine": "http_fetch"
            }

    async def screenshot(self, session_id: str = "default", full_page: bool = False) -> Dict[str, Any]:
        if session_id in self._pages:
            page = self._pages[session_id]
            data = await page.screenshot(full_page=full_page)
            b64 = base64.b64encode(data).decode("utf-8")
            return {"image_base64": b64, "mime": "image/png"}
        raise ValueError("Active Playwright session required for screenshots.")

    async def click(self, selector: str, session_id: str = "default") -> Dict[str, Any]:
        if session_id in self._pages:
            page = self._pages[session_id]
            await page.click(selector, timeout=10000)
            return {"ok": True, "clicked": selector}
        raise ValueError("Playwright session required.")

    async def fill(self, selector: str, text: str, session_id: str = "default") -> Dict[str, Any]:
        if session_id in self._pages:
            page = self._pages[session_id]
            await page.fill(selector, text, timeout=10000)
            return {"ok": True, "filled": selector}
        raise ValueError("Playwright session required.")

    async def evaluate_js(self, expression: str, session_id: str = "default") -> Any:
        if session_id in self._pages:
            page = self._pages[session_id]
            res = await page.evaluate(expression)
            return {"result": res}
        raise ValueError("Playwright session required.")

    async def get_logs(self, session_id: str = "default") -> Dict[str, Any]:
        return {
            "console": self._console_logs.get(session_id, []),
            "network": self._network_logs.get(session_id, [])[-50:]
        }

    async def close_session(self, session_id: str = "default"):
        if session_id in self._contexts:
            ctx = self._contexts.pop(session_id)
            await ctx.close()
        self._pages.pop(session_id, None)
        self._console_logs.pop(session_id, None)
        self._network_logs.pop(session_id, None)

BROWSER_MANAGER = BrowserManager()
