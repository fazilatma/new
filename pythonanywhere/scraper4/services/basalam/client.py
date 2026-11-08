"""کلاینتِ باسلام — پورتِ bslReq/bslReqRead/bslCurlOpts از scraper4.php

  • همان اندپوینت‌های تأییدشدهٔ نسخهٔ قدیمی (openapi.basalam.com/v1)
  • همان معنای تلاشِ دوباره (فقط خطای شبکه) و زنجیرهٔ روش‌ها (پروکسی اختیاری)
  • «سیگنالِ توقف» با یک hook قابلِ تزریق (در اپ به ردیفِ دیتابیس وصل است)
  • خواندنی‌ها (read) سیگنالِ توقف را — دقیقاً مثل bslReqRead — نادیده می‌گیرند

همهٔ متدها خروجیِ یک‌دست برمی‌گردانند:
  {'ok': bool, 'code': int, 'error': str, 'body': any, 'raw': str}
"""
from __future__ import annotations

import os
import time
from typing import Any, Callable

import requests
import urllib3



STOP_HOLD_SEC = 900

Empty = {"ok": False, "code": 0, "error": "", "body": None, "raw": ""}


class BasalamClient:
    #: تابعِ بررسیِ سیگنالِ توقف (توسطِ موتورِ اپ ست می‌شود)
    stop_hook: Callable[[], bool] | None = None

    def __init__(self, token: str, api_base: str = "", timeout: int = 30,
                 proxy: str = "", verify: bool = True):
        base = (api_base or "").strip()
        if not base or not base.lower().startswith(("http://", "https://")):
            base = "https://openapi.basalam.com/v1/"
        self.api_base = base.rstrip("/") + "/"
        self.token = token or ""
        self.timeout = timeout
        self.proxy = proxy or ""
        self.verify = verify
        self._cats_cache: tuple[float, list] | None = None

    @classmethod
    def from_connection(cls, cfg: dict, api_base: str = "") -> "BasalamClient":
        proxy = ""
        if cfg.get("net_indirect"):
            proxy = str(cfg.get("proxy") or "")
        return cls(
            str(cfg.get("token") or ""),
            api_base=api_base or str(cfg.get("api_base") or ""),
            proxy=proxy,
        )

    # ------------------------------------------------------------------ قفل

    def stopped(self) -> bool:
        return bool(self.stop_hook and self.stop_hook())

    # ------------------------------------------------------------------ هسته

    def _headers(self, extra: dict | None = None) -> dict:
        headers = {"Accept": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        headers.update(extra or {})
        return headers

    def request(self, method: str, endpoint: str, data: Any = None,
                multipart: bool = False, max_attempts: int = 3,
                skip_stop: bool = False) -> dict:
        if not skip_stop and self.stopped():
            return {"ok": False, "code": 0, "error": "stopped", "body": None, "raw": ""}

        url = self.api_base + endpoint.lstrip("/")
        method = method.upper()
        last = dict(Empty, error="هیچ روشی اجرا نشد")
        proxies = {"http": self.proxy, "https": self.proxy} if self.proxy else None

        for attempt in range(1, max(1, max_attempts) + 1):
            try:
                if multipart:
                    files, fields = {}, {}
                    for key, value in (data or {}).items():
                        if isinstance(value, str) and os.path.isfile(value):
                            files[key] = (os.path.basename(value), open(value, "rb"))
                        else:
                            fields[key] = str(value)
                    try:
                        response = requests.request(
                            method, url, headers=self._headers(), data=fields,
                            files=files or None, timeout=(10, self.timeout),
                            verify=self.verify, proxies=proxies,
                        )
                    finally:
                        for _, handle in files.values():
                            handle.close()
                else:
                    response = requests.request(
                        method, url,
                        headers=self._headers({"Content-Type": "application/json"}),
                        json=data if data is not None else None,
                        timeout=(10, self.timeout), verify=self.verify, proxies=proxies,
                    )
            except requests.RequestException as exc:
                last = {"ok": False, "code": 0, "error": str(exc), "body": None, "raw": ""}
                if attempt < max_attempts:
                    time.sleep(3)   # فقط خطای شبکه → تلاشِ دوباره
                continue

            last = self._shape(response)
            if last["code"] > 0:
                break           # پاسخ گرفتیم (موفق یا خطای منطقی) — دوباره نمی‌زنیم
        return last

    def read(self, endpoint: str, max_attempts: int = 3) -> dict:
        return self.request("GET", endpoint, None, False, max_attempts, skip_stop=True)

    @staticmethod
    def _shape(response: requests.Response) -> dict:
        raw = response.text or ""
        try:
            body = response.json()
        except ValueError:
            body = None
        ok = 200 <= response.status_code < 300
        return {
            "ok": ok,
            "code": response.status_code,
            "error": "" if ok else raw[:300],
            "body": body,
            "raw": raw,
        }

    # ------------------------------------------------------------------ API

    def booth_info(self) -> dict:
        return self.read("vendors/me", 1)

    def vendor_products(self, vendor_id, page: int = 1, per_page: int = 100,
                        statuses: list[int] | None = None) -> dict:
        query = f"vendors/{vendor_id}/products?per_page={per_page}&page={page}"
        for status in statuses or []:
            query += "&statuses=" + str(int(status))
        return self.read(query)

    def vendor_product(self, vendor_id, product_id) -> dict:
        return self.read(f"vendors/{vendor_id}/products/{product_id}")

    def search_products(self, query: str = "", per_page: int = 20) -> dict:
        return self.request("POST", "products/search",
                            {"query": query, "per_page": per_page})

    def create_product(self, vendor_id, payload: dict) -> dict:
        return self.request("POST", f"vendors/{vendor_id}/products", payload)

    def update_product(self, product_id, fields: dict, vendor_id=None) -> dict:
        result = self.request("PATCH", f"products/{product_id}", fields)
        if result["code"] == 404 and vendor_id not in (None, ""):
            result = self.request("PATCH", f"vendors/{vendor_id}/products/{product_id}", fields)
        return result

    def upload_photo(self, absolute_path: str) -> dict:
        if not os.path.isfile(absolute_path):
            return {"ok": False, "code": 0, "error": f"file not found: {absolute_path}",
                    "body": None, "raw": ""}
        return self.request("POST", "files",
                            {"file": absolute_path, "file_type": "product.photo"}, True)

    def send_chat_message(self, chat_id, body: dict) -> dict:
        return self.request("POST", f"chats/{chat_id}/messages", body)

    def categories_all(self, ttl_seconds: int = 86400) -> list:
        """درختِ دسته‌ها با کشِ TTL (همان bslCatsAll + BSL_CATS_TTL)."""
        now = time.time()
        if self._cats_cache and now - self._cats_cache[0] < ttl_seconds:
            return self._cats_cache[1]
        result = self.read("categories")
        body = result["body"] if result["ok"] and isinstance(result["body"], (list, dict)) else []
        data = body if isinstance(body, list) else (body.get("data") or [])
        self._cats_cache = (now, data)
        return data
