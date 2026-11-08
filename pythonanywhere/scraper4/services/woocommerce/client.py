"""کلاینتِ REST ووکامرس — پورتِ wooReq از scraper4.php
(basic-auth با consumer key/secret روی /wp-json/wc/v3/)

همهٔ متدها خروجیِ یک‌دست برمی‌گردانند:
  {'ok': bool, 'code': int, 'error': str, 'body': any, 'raw': str}
"""
from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

import requests
import urllib3




class WooClient:
    def __init__(self, store_url: str, consumer_key: str, consumer_secret: str,
                 timeout: int = 60, verify: bool = True):
        self.base = (store_url or "").rstrip("/") + "/wp-json/wc/v3/"
        self.consumer_key = consumer_key or ""
        self.consumer_secret = consumer_secret or ""
        self.timeout = timeout
        self.verify = verify

    @classmethod
    def from_connection(cls, cfg: dict, verify: bool = True) -> "WooClient":
        return cls(
            str(cfg.get("store_url") or ""),
            str(cfg.get("consumer_key") or ""),
            str(cfg.get("consumer_secret") or ""),
            verify=verify,
        )

    # ------------------------------------------------------------------ هسته

    def request(self, method: str, endpoint: str, data: Any = None,
                params: dict | None = None) -> dict:
        url = self.base + endpoint.lstrip("/")
        try:
            response = requests.request(
                method.upper(), url,
                auth=(self.consumer_key, self.consumer_secret),
                json=data,
                params=params,
                headers={"Accept": "application/json"},
                timeout=(8, self.timeout),
                verify=self.verify,
            )
        except requests.RequestException as exc:
            return {"ok": False, "code": 0, "error": str(exc), "body": None, "raw": ""}

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

    def test_connection(self) -> dict:
        """تستِ اتصال + نسخهٔ ووکامرس (مثل «تست ووکامرس» نسخهٔ قدیمی)."""
        result = self.request("GET", "products", params={"per_page": 1})
        if not result["ok"]:
            return result
        version = "?"
        env = self.request("GET", "system_status")
        if env["ok"] and isinstance(env["body"], dict):
            version = str((env["body"].get("environment") or {}).get("version") or "?")
        body = result["body"] if isinstance(result["body"], list) else []
        return dict(result, body=body, woocommerce_version=version)

    def list_products(self, page: int = 1, per_page: int = 20,
                      query: dict | None = None) -> dict:
        params = {"page": page, "per_page": per_page}
        params.update(query or {})
        return self.request("GET", "products", params=params)

    def get_product(self, product_id) -> dict:
        return self.request("GET", f"products/{product_id}")

    def create_product(self, payload: dict) -> dict:
        return self.request("POST", "products", payload)

    def update_product(self, product_id, fields: dict) -> dict:
        return self.request("PUT", f"products/{product_id}", fields)

    def delete_product(self, product_id, force: bool = True) -> dict:
        endpoint = f"products/{product_id}" + ("?force=true" if force else "")
        return self.request("DELETE", endpoint)

    def batch_products(self, create: list | None = None, update: list | None = None,
                       delete: list | None = None) -> dict:
        """ارسالِ دسته‌ای — POST products/batch (تا ۱۰۰ رکورد در هر درخواست)."""
        payload: dict = {}
        if create:
            payload["create"] = create
        if update:
            payload["update"] = update
        if delete:
            payload["delete"] = delete
        return self.request("POST", "products/batch", payload)

    def categories(self, per_page: int = 100) -> dict:
        return self.request("GET", "products/categories", params={"per_page": per_page})


def query_string(params: dict) -> str:
    return urlencode({k: v for k, v in params.items() if v is not None})
