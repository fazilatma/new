"""Node-dashboard compatibility layer for the Python Scraper 4 backend.

The Node.js project (``cloudflare-scraper4`` on branch ``arena/01a0aa17-new``)
ships a single-page dashboard built from two string constants inside
``worker-src/dashboard.ts``: ``DASHBOARD`` (the HTML shell, including all CSS)
and ``DASHBOARD_JS`` (the client script). Those payloads form the base of
``ui/dashboard.html`` and ``ui/dashboard.js``; small Python-only integrations
(such as the storefront-manager modal) are additive. The Python app therefore
keeps the same topbar, drawer, six-pane tab bar, theme tokens and Persian copy.

The dashboard talks to a Hono-style REST surface that does not exist in the
Flask app (the Python UI used ``/api/profile``, ``/api/scrape`` … instead).
This module registers that surface on the existing Flask ``app`` and maps every
call onto the Python backend's own data model, so the Node look *and* its
feature set work on top of the Python scraper.

Design rules:
  * Never import ``scraper4`` at module import time — ``scraper4`` imports us.
    Everything reaches back through the ``core`` module object passed to
    :func:`register`.
  * Mutate nothing in the Python schema. Profiles stay keyed by name in
    ``data['profiles']``; we translate to/from the Node ``Profile`` shape on
    the fly so both UIs keep working against one ``scraper4_data.json``.
  * Every route in the pinned Node parity manifest is registered explicitly.
    Unsupported operations fail explicitly; no catch-all success response may
    claim an operation completed when no backend work happened.
"""

from __future__ import annotations

import base64
import copy
import importlib.metadata
import importlib.util
import io
import json
import math
import os
import re
import secrets
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any, Optional
from urllib.parse import quote

from flask import (
    Response, jsonify, redirect, request, send_from_directory,
    stream_with_context, url_for,
)

UI_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ui")

# Mirror of DEFAULT_SELECTORS / Selectors in worker-src/types.ts.
NODE_SELECTOR_KEYS = (
    "container", "title", "price", "link", "image", "shortDesc", "longDesc",
    "sku", "brand", "stock", "weight", "category", "tags", "detailImage",
    "gallery", "variations", "specs",
)
PAGINATIONS = (
    "auto", "query_page", "query_custom", "path_page", "path_pattern",
    "full_pattern", "next_selector", "none", "scroll",
)
# Extraction engines offered to the dashboard.
#
# The Node original advertised its Cloudflare-Worker engines (HTMLRewriter,
# Cheerio, Puppeteer …) which simply do not exist in this runtime — picking one
# silently fell back to "auto". This catalogue lists what the Python backend can
# genuinely do, split into the two stages it actually models:
#
#   fetch  — how the HTML is retrieved (Fetcher.get(engine=…) in scraper4.py)
#   parse  — how products are read out of that HTML (parse_html / helpers)
#
# `module` is probed at runtime so the UI can grey out engines whose library is
# not installed on this server instead of offering a dead option. Ordering is
# fastest-first, matching HTTP_ENGINE_ORDER.
ENGINE_CATALOGUE = (
    # id, Persian label, stage, python module required ("" = always available)
    #
    # Two independent stages. A profile pins one of each:
    #   fetch  — how the HTML is retrieved   (Fetcher.get(engine=…))
    #   parse  — how products are read out   (parse_html(..., strategy=…))
    # Both are probed at runtime so an engine whose library is missing shows as
    # "نصب نیست" rather than silently doing nothing.
    ("auto", "خودکار (هوشمند - پیشنهادی)", "fetch", ""),
    ("requests", "Requests — سریع، برای سایت‌های ساده", "fetch", "requests"),
    ("httpx", "HTTPX — HTTP/2، سریع", "fetch", "httpx"),
    ("curl_cffi", "curl_cffi — دور زدن اثرانگشت TLS/JA3", "fetch", "curl_cffi"),
    ("cloudscraper", "Cloudscraper — چالش‌های کلودفلر", "fetch", "cloudscraper"),
    ("playwright", "Playwright — رندر کامل جاوااسکریپت", "fetch", "playwright"),
    ("selenium", "Selenium — مرورگر واقعی (کندتر)", "fetch", "selenium"),
    ("auto", "خودکار (همهٔ روش‌ها به ترتیب)", "parse", ""),
    ("lxml", "lxml — پایپ‌لاین کامل پیش‌فرض", "parse", "lxml"),
    ("selectolax", "selectolax — کارت محصول، پارس بسیار سریع", "parse", "selectolax"),
    ("jsonld", "JSON-LD — داده ساختاریافته Product", "parse", ""),
    ("next_data", "Next.js / Nuxt — __NEXT_DATA__", "parse", ""),
    ("script_json", "JSON داخل تگ script", "parse", ""),
    ("metadata", "OpenGraph / متادیتا", "parse", ""),
    ("heuristic", "کارت‌های محصول (تشخیص خودکار)", "parse", ""),
)
# Ids accepted when saving a profile, per stage.
FETCH_ENGINES = tuple(i[0] for i in ENGINE_CATALOGUE if i[2] == "fetch")
PARSE_ENGINE_IDS = tuple(i[0] for i in ENGINE_CATALOGUE if i[2] == "parse")
ENGINES = tuple(dict.fromkeys(i[0] for i in ENGINE_CATALOGUE))
# Python pagination vocabulary  <->  Node pagination vocabulary.
PAG_PY_TO_NODE = {
    "auto": "auto", "automatic": "auto", "detect": "auto",
    "query": "query_page", "query_page": "query_page", "query_custom": "query_custom", "param": "query_page",
    "path": "path_page", "path_page": "path_page", "path_pattern": "path_pattern",
    "full": "full_pattern", "pattern": "full_pattern", "full_pattern": "full_pattern", "custom": "query_custom",
    "next": "next_selector", "next_selector": "next_selector",
    "none": "none", "scroll": "scroll",
}
PAG_NODE_TO_PY = {
    "auto": "auto", "automatic": "auto", "detect": "auto",
    "query_page": "query_page", "query_custom": "query_custom", "param": "query_custom", "query": "query_page",
    "path_page": "path_page", "path_pattern": "path_pattern", "path": "path_page",
    "full_pattern": "full_pattern", "pattern": "full_pattern", "full": "full_pattern",
    "next_selector": "next_selector", "next": "next_selector",
    "none": "none", "scroll": "scroll",
    "custom": "query_custom",
}


def _s(value: Any) -> str:
    return "" if value is None else str(value)


def _num(value: Any, fallback: float = 0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _price_num(value: Any, fallback: float = 0) -> float:
    """Parse saved/display prices without turning ``12500.0`` into 125000."""
    if isinstance(value, bool):
        return fallback
    if isinstance(value, (int, float)):
        number = float(value)
        return number if math.isfinite(number) else fallback
    text = str(value or "").translate(str.maketrans(
        "۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789"
    )).replace(",", "").replace("٬", "").replace("٫", ".")
    match = re.search(r"[+-]?\d+(?:\.\d+)?", text)
    try:
        number = float(match.group()) if match else fallback
        return number if math.isfinite(number) else fallback
    except (TypeError, ValueError, OverflowError):
        return fallback


def _int(value: Any, fallback: int = 0) -> int:
    return int(_num(value, fallback))


def _truthy(value: Any) -> bool:
    return value in (True, 1, "1", "true", "on", "yes")


def _iso(epoch: Any = None) -> str:
    seconds = _num(epoch, 0) or time.time()
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(seconds)) + "Z"


def _body() -> dict[str, Any]:
    payload = request.get_json(silent=True)
    return payload if isinstance(payload, dict) else {}


def register(core: Any) -> None:  # noqa: C901 - one registrar, many small routes
    """Attach the Node-compatible dashboard + API to the Flask app in ``core``."""

    app = core.app

    # ── helpers bound to the live backend ────────────────────────────────
    def load() -> dict[str, Any]:
        return core.load_data()

    def save(data: dict[str, Any]) -> None:
        core.save_data(data)

    def profile_to_node(name: str, cfg: dict[str, Any]) -> dict[str, Any]:
        """Translate one Python profile entry into the Node ``Profile`` shape."""
        cfg = cfg if isinstance(cfg, dict) else {}
        raw_sel = cfg.get("selectors") if isinstance(cfg.get("selectors"), dict) else {}
        detail = cfg.get("detail_selectors") if isinstance(cfg.get("detail_selectors"), dict) else {}
        selectors = {key: "" for key in NODE_SELECTOR_KEYS}
        for key, value in raw_sel.items():
            if key in selectors:
                selectors[key] = _s(value)
        # Python keeps detail-page selectors in their own map; Node flattens
        # them into `selectors`, renaming `image` to `detailImage`.
        for key, value in detail.items():
            selectors["detailImage" if key == "image" else key] = _s(value)
        gallery = cfg.get("gallery") if isinstance(cfg.get("gallery"), dict) else {}
        if gallery.get("selectors"):
            selectors["gallery"] = _s(gallery.get("selectors"))
        rules = cfg.get("profile_rules") if isinstance(cfg.get("profile_rules"), dict) else {}
        raw_price_mode = _s(rules.get("price_mode") or rules.get("priceMode") or "none")
        node_price_mode = {"multiplier": "multiply", "fixed": "add"}.get(raw_price_mode, raw_price_mode)
        pag = PAG_PY_TO_NODE.get(_s(cfg.get("pagination")) or "query", "query_page")
        engine = _s(cfg.get("fetch_engine")) or "auto"
        products = cfg.get("saved_products")
        return {
            "id": name,
            "name": _s(cfg.get("display_name")) or name,
            "url": _s(cfg.get("url")),
            "enabled": cfg.get("enabled", True) is not False,
            "pages": _int(cfg.get("pages"), 1),
            "pagination": pag if pag in PAGINATIONS else "query_page",
            "extractionEngine": engine if engine in FETCH_ENGINES else "auto",
            "parseEngine": (_s(cfg.get("parse_engine")) or "auto"),
            "extractionEngineMaster": _s(cfg.get("fetch_engine_master")) or None,
            "extractionEngineHost": _s(cfg.get("fetch_engine_host")),
            "extractionEngineMs": _int(cfg.get("fetch_engine_ms")),
            "extractionEngineBenchmarks": cfg.get("engine_benchmarks") or [],
            "paginationValue": _s(cfg.get("page_value")) or "page",
            "selectors": selectors,
            "gallery": gallery or None,
            "titleSuffix": _s(rules.get("title_suffix")),
            "priceMode": node_price_mode or "none",
            "priceValue": _num(rules.get("price_value", rules.get("price_val", rules.get("priceValue", 0)))),
            "roundPrice": _num(rules.get("price_round", rules.get("round_price", rules.get("roundPrice", 0)))),
            "minPrice": _num(rules.get("min_price")),
            "wooCategoryId": _int(rules.get("woo_category_id")),
            "basalamCategoryId": _int(rules.get("bsl_category_id")),
            "basalamFallbackCategoryIds": rules.get("bsl_fallback_cat_ids") or [],
            "networkIndirect": _truthy(cfg.get("net_indirect")),
            "noExtract": _truthy(cfg.get("no_extract")),
            "syncWoo": _truthy(cfg.get("sync_woo")),
            "syncBasalam": _truthy(cfg.get("sync_basalam")),
            "aiDescriptions": cfg.get("ai_descriptions", True) is not False,
            "intervalMinutes": _int(cfg.get("interval_minutes")),
            "lastRunAt": cfg.get("last_run_at") or None,
            "createdAt": cfg.get("created_at") or _iso(),
            "updatedAt": cfg.get("updated_at") or _iso(),
            "productCount": len(products) if isinstance(products, list) else 0,
        }

    # Keys that only ever appear in one of the two profile schemas. Used to
    # tell an imported profile's origin apart so it can be converted rather
    # than written raw into storage.
    _NODE_ONLY = ("extractionEngine", "paginationValue", "titleSuffix",
                  "priceMode", "priceValue", "extractionEngineMaster")
    _PY_ONLY = ("display_name", "fetch_engine", "profile_rules", "page_value",
                "detail_selectors", "fetch_engine_master")

    def _is_node_profile(cfg: dict[str, Any]) -> bool:
        """True when this entry uses the Node dashboard's field names."""
        if any(k in cfg for k in _PY_ONLY):
            return False
        if any(k in cfg for k in _NODE_ONLY):
            return True
        # Ambiguous (e.g. only url/pages): "name" is Node-only, since the
        # Python schema calls it display_name.
        return "name" in cfg

    def node_to_profile(node: dict[str, Any], previous: dict[str, Any]) -> dict[str, Any]:
        """Merge an incoming Node ``Profile`` back into the Python schema."""
        cfg = dict(previous) if isinstance(previous, dict) else {}
        sel_in = node.get("selectors") if isinstance(node.get("selectors"), dict) else {}
        list_keys = ("container", "title", "price", "link", "image")
        selectors = {k: _s(v) for k, v in sel_in.items() if k in list_keys and _s(v)}
        detail = {}
        for key, value in sel_in.items():
            if key in list_keys or not _s(value):
                continue
            detail["image" if key == "detailImage" else key] = _s(value)
        rules = dict(cfg.get("profile_rules") or {})
        node_price_mode = _s(node.get("priceMode")) or "none"
        price_mode = {"multiply": "multiplier", "add": "fixed"}.get(node_price_mode, node_price_mode)
        price_value = _num(node.get("priceValue"))
        price_round = _num(node.get("roundPrice"))
        rules.update({
            "title_suffix": _s(node.get("titleSuffix")),
            "price_mode": price_mode,
            # Canonical Python fields are mirrored to the old bridge aliases so
            # profiles written by either dashboard remain lossless.
            "price_value": price_value,
            "price_val": price_value,
            "price_round": price_round,
            "round_price": price_round,
            "min_price": _num(node.get("minPrice")),
            "woo_category_id": _int(node.get("wooCategoryId")),
            "bsl_category_id": _int(node.get("basalamCategoryId")),
            "bsl_fallback_cat_ids": node.get("basalamFallbackCategoryIds") or [],
        })
        # 10.225: pages=0 is the dashboard's "اتوماتیک" (automatic: keep going
        # until the pagination ends, cap 100). It used to be clamped to 1 here,
        # which made a real extraction stop after page 1 while the 3-page
        # benchmark (which ignores `pages`) happily scanned 3 pages.
        if node.get("pages") is None:
            cfg_pages = max(0, _int(cfg.get("pages"), 0))
        else:
            cfg_pages = max(0, _int(node.get("pages"), 0))
        cfg.update({
            "display_name": _s(node.get("name")),
            "url": _s(node.get("url")),
            "enabled": node.get("enabled", True) is not False,
            "pages": cfg_pages,
            "pagination": PAG_NODE_TO_PY.get(_s(node.get("pagination")), "query"),
            "page_value": _s(node.get("paginationValue")) or "page",
            "fetch_engine": _s(node.get("extractionEngine")) or "auto",
            "parse_engine": _s(node.get("parseEngine")) or "auto",
            "selectors": selectors,
            "detail_selectors": detail,
            "enrich": bool(detail),
            "profile_rules": rules,
            "net_indirect": _truthy(node.get("networkIndirect")),
            "no_extract": _truthy(node.get("noExtract")),
            "sync_woo": _truthy(node.get("syncWoo")),
            "sync_basalam": _truthy(node.get("syncBasalam")),
            "ai_descriptions": node.get("aiDescriptions", True) is not False,
            "interval_minutes": _int(node.get("intervalMinutes")),
            "created_at": cfg.get("created_at") or _iso(),
            "updated_at": _iso(),
        })
        if isinstance(node.get("gallery"), dict):
            cfg["gallery"] = node["gallery"]
        return cfg

    def product_to_node(row: dict[str, Any], index: int = 0) -> dict[str, Any]:
        row = row if isinstance(row, dict) else {}
        image = _s(row.get("image"))
        images = [x for x in (row.get("images") or []) if isinstance(x, str)]
        if image and image not in images:
            images.insert(0, image)
        price = row.get("final_price", row.get("price"))
        raw_result_base = row.get("resultBase") if isinstance(row.get("resultBase"), dict) else row.get("result_base")
        result_base = dict(raw_result_base) if isinstance(raw_result_base, dict) else {}
        source_raw = row.get("source_price")
        if source_raw in (None, ""):
            source_raw = row.get("sourcePrice")
        if source_raw in (None, ""):
            source_raw = result_base.get("price")
        if source_raw in (None, ""):
            source_raw = row.get("price_before_adjust", row.get("original_price"))
        source_price = None if source_raw in (None, "") else _price_num(source_raw)
        if source_price is not None:
            result_base.update({
                "price": source_price,
                "priceText": _s(row.get("source_price_text") or row.get("sourcePriceText") or
                                result_base.get("priceText") or source_raw),
            })
        raw_result_applied = row.get("resultApplied") if isinstance(row.get("resultApplied"), dict) else row.get("result_applied")
        result_applied = dict(raw_result_applied) if isinstance(raw_result_applied, dict) else {}
        applied_mode = _s(result_applied.get("priceMode") or result_applied.get("price_mode"))
        if applied_mode:
            result_applied["priceMode"] = {"multiplier": "multiply", "fixed": "add"}.get(applied_mode, applied_mode)
        if "priceValue" not in result_applied and "price_value" in result_applied:
            result_applied["priceValue"] = _num(result_applied.get("price_value"))
        if "roundPrice" not in result_applied and "price_round" in result_applied:
            result_applied["roundPrice"] = _num(result_applied.get("price_round"))
        return {
            "sourceKey": _s(row.get("source_key") or row.get("sourceKey") or row.get("url") or index),
            "title": _s(row.get("title")),
            "price": _price_num(price),
            "priceText": _s(row.get("price_text") or row.get("priceText") or price),
            "sourcePrice": source_price,
            "resultBase": result_base or None,
            "resultApplied": result_applied or None,
            "url": _s(row.get("url") or row.get("link")),
            "image": image,
            "images": images,
            "shortDesc": _s(row.get("short_desc") or row.get("shortDesc")),
            "longDesc": _s(row.get("long_desc") or row.get("longDesc")),
            "sku": _s(row.get("sku")),
            "brand": _s(row.get("brand")),
            "stock": row.get("stock"),
            "weight": row.get("weight"),
            "category": _s(row.get("category")),
            "tags": _s(row.get("tags")),
            "variations": row.get("variations") or [],
            "variationGroups": row.get("variation_groups") or row.get("variationGroups") or [],
            "specs": row.get("specs") or [],
            "sourcePage": _s(row.get("source_page") or row.get("sourcePage")),
            "scrapedAt": _s(row.get("scraped_at") or row.get("scrapedAt")) or _iso(),
        }

    def product_with_profile_price(product: dict[str, Any], rules: dict[str, Any]) -> dict[str, Any]:
        """Present current profile pricing even for rows saved by older bridges."""
        source = product.get("sourcePrice")
        if source in (None, ""):
            return product
        raw_mode = _s(rules.get("price_mode") or rules.get("priceMode") or "none")
        mode = {"multiplier": "multiply", "fixed": "add"}.get(raw_mode, raw_mode)
        value = _num(rules.get("price_value", rules.get("price_val", rules.get("priceValue", 0))))
        rounding = max(0, _int(rules.get("price_round", rules.get("round_price", rules.get("roundPrice", 0)))))
        minimum = max(0, _num(rules.get("min_price", rules.get("minPrice", 0))))
        if mode == "none" and not rounding and not minimum:
            return product
        amount = _price_num(source)
        if amount <= 0:
            return product
        if mode == "percent":
            amount *= 1 + value / 100
        elif mode == "multiply" and value > 0:
            amount *= value
        elif mode == "add":
            amount += value
        if rounding:
            amount = round(amount / rounding) * rounding
        amount = max(minimum, round(amount))
        current_applied = dict(product.get("resultApplied")) if isinstance(product.get("resultApplied"), dict) else {}
        current_applied.update({
            "priceMode": mode, "priceValue": value,
            "roundPrice": rounding, "minPrice": minimum,
        })
        product["price"] = amount
        product["resultApplied"] = current_applied
        return product

    def profile_products(name: str, data: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
        data = data or load()
        cfg = data.get("profiles", {}).get(name) or {}
        rows = cfg.get("saved_products")
        if not isinstance(rows, list) or not rows:
            # Fall back to the shared "last_result" buffer when the active
            # profile has not been persisted with its own snapshot yet.
            if data.get("active_profile") == name:
                rows = data.get("last_result") or []
            else:
                rows = []
        return [r for r in rows if isinstance(r, dict)]

    def task_to_job(task: dict[str, Any]) -> dict[str, Any]:
        status_map = {
            "waiting": "queued", "running": "running", "completed": "done",
            "failed": "failed", "cancelled": "stopped", "interrupted": "failed",
        }
        counts = task.get("counts") if isinstance(task.get("counts"), dict) else {}
        kind = "scrape" if _s(task.get("kind")) in ("scrape", "detail_extract") else "sync"
        comparison = task.get("comparison") if isinstance(task.get("comparison"), dict) else {}
        result = task.get("result") if isinstance(task.get("result"), dict) else {}
        if not comparison and isinstance(result.get("comparison"), dict):
            comparison = result["comparison"]

        def pick(*keys: str, default: int = 0) -> int:
            """First key that is actually present, checking counts{} then flat.

            The workers write flat keys (done/total/sent/failed/extracted);
            only the reconcile worker writes a nested counts{}. Reading just
            counts{} made every scrape card fall back to `progress`, which is
            a percentage — that is why cards showed things like "100 از 1".
            """
            for key in keys:
                if key in counts and counts.get(key) is not None:
                    return _int(counts.get(key))
                if key in task and task.get(key) is not None:
                    return _int(task.get(key))
                if key in result and result.get(key) is not None:
                    return _int(result.get(key))
            return default

        if kind == "sync":
            # Dispatch counts products sent to the destinations.
            processed = pick("done")
            total = pick("total")
            added = pick("sent", "added")
            updated = pick("updated")
        else:
            # Extraction counts PRODUCTS, not pages. `extracted` is the real
            # product tally; done/total are page positions used for progress.
            processed = pick("extracted", "total_products", default=-1)
            if processed < 0:
                processed = _int(result.get("total")) or pick("done")
            total = _int(result.get("total")) or processed or pick("total")
            added = _int(comparison.get("added"))
            updated = _int(comparison.get("changed") or comparison.get("price_changed"))
        # Per-product rows for the metric drill-down. Clicking a counter used
        # to show the stage plan because job.log was never sent, so
        # jobEventRows() always filtered an empty array.
        log: list[dict[str, Any]] = []
        lists = comparison.get("lists") if isinstance(comparison.get("lists"), dict) else {}

        def as_item(row: Any) -> dict[str, Any]:
            row = row if isinstance(row, dict) else {}
            item = {
                "title": _s(row.get("title") or row.get("name")),
                "price": _s(row.get("price")),
                "link": _s(row.get("link") or row.get("url")),
                "image": _s(row.get("image")),
                "sku": _s(row.get("sku")),
            }
            old = row.get("previous_price")
            if old not in (None, "") and _s(old) != _s(row.get("price")):
                try:
                    old_v, new_v = int(_int(old)), int(_int(row.get("price")))
                    item.update(oldPrice=old_v, newPrice=new_v,
                                delta=new_v - old_v,
                                percent=round((new_v - old_v) * 100 / old_v, 1)
                                if old_v else 0)
                except (TypeError, ValueError):
                    pass
            return item

        for key, event in (("added", "added"), ("removed", "removed"),
                           ("changed", "updated"),
                           ("price_changed", "price-changed"),
                           ("unchanged", "unchanged")):
            rows = lists.get(key)
            if not isinstance(rows, list):
                continue
            for row in rows[:300]:
                item = as_item(row)
                if event == "price-changed":
                    event_name = ("price-increased"
                                  if _int(item.get("delta")) > 0
                                  else "price-decreased")
                else:
                    event_name = event
                log.append({"event": event_name, "item": item,
                            "message": item["title"]})
        for row in (task.get("failures") or [])[:300]:
            if isinstance(row, dict):
                log.append({"event": "failed", "item": as_item(row),
                            "message": _s(row.get("error"))})

        return {
            "id": _s(task.get("id")),
            "profileId": _s(task.get("profile")),
            "kind": kind,
            "log": log,
            "target": _s(task.get("target")) or "none",
            "status": status_map.get(_s(task.get("status")), "queued"),
            "phase": _s(task.get("step")),
            "total": total,
            "processed": processed,
            "added": added,
            "updated": updated,
            "failed": pick("failed"),
            "removed": _int(comparison.get("removed")),
            "unchanged": _int(comparison.get("unchanged")),
            "pages": pick("done"),
            "pagesTotal": pick("total"),
            "progress": _int(task.get("progress")),
            # Machine-readable stage keys for the UI's step plan. `phase` is
            # free Persian prose written for humans and can never be matched
            # against the plan; these can.
            "stage": _s(task.get("stage")),
            "stages": [x for x in (task.get("stages") or []) if _s(x)],
            "workflow": _s(task.get("workflow")),
            "error": _s(task.get("error")),
            "createdAt": _iso(task.get("created_at")),
            "updatedAt": _iso(task.get("updated_at")),
        }

    def live_tasks() -> list[dict[str, Any]]:
        rows: dict[str, dict[str, Any]] = {}
        try:
            for fname in os.listdir(core.LIVE_TASK_DIR):
                if re.fullmatch(r"task-[0-9a-f]{16}\.json", fname):
                    try:
                        with open(os.path.join(core.LIVE_TASK_DIR, fname), encoding="utf-8") as fh:
                            row = json.load(fh)
                        if isinstance(row, dict):
                            rows[_s(row.get("id"))] = row
                    except (OSError, ValueError):
                        pass
        except OSError:
            pass
        with core.LIVE_TASK_LOCK:
            rows.update({k: dict(v) for k, v in core.LIVE_TASKS.items()})
        return sorted(rows.values(), key=lambda x: _int(x.get("updated_at")), reverse=True)

    def _deep_merge(base: Any, patch: Any) -> Any:
        """Recursively merge JSON objects without dropping unknown Node keys."""
        if not isinstance(base, dict) or not isinstance(patch, dict):
            return copy.deepcopy(patch)
        out = copy.deepcopy(base)
        for key, value in patch.items():
            out[key] = _deep_merge(out.get(key), value) if key in out else copy.deepcopy(value)
        return out

    def _secret_placeholder(value: Any) -> bool:
        text = _s(value).strip()
        return bool(text) and (text == "***" or text.startswith("••••") or text.startswith("********"))

    def _merge_connection_input(base: Any, patch: Any) -> Any:
        """Merge a vault update while never replacing a real secret with a mask.

        The current dashboard returns clear values to its authenticated owner,
        just like Node's decrypted vault.  Older Python builds returned ``***``;
        accepting a save from one of those open tabs must not destroy keys.
        Provider arrays are matched by id (not array position), so reordering is
        safe as well.
        """
        if _secret_placeholder(patch):
            return copy.deepcopy(base)
        if isinstance(base, dict) and isinstance(patch, dict):
            out = copy.deepcopy(base)
            for key, value in patch.items():
                out[key] = _merge_connection_input(out.get(key), value)
            return out
        if isinstance(patch, list):
            old_by_id = {
                _s(item.get("id")): item for item in (base if isinstance(base, list) else [])
                if isinstance(item, dict) and _s(item.get("id"))
            }
            out = []
            for index, item in enumerate(patch):
                old = old_by_id.get(_s(item.get("id"))) if isinstance(item, dict) else None
                if old is None and isinstance(base, list) and index < len(base):
                    old = base[index]
                out.append(_merge_connection_input(old, item))
            return out
        return copy.deepcopy(patch)

    def _node_ai_providers(data: dict[str, Any]) -> list[dict[str, Any]]:
        try:
            providers = core.normalize_ai_providers(data.get("ai_providers") or {})
        except (ValueError, TypeError):
            providers = {}
        rows: list[dict[str, Any]] = []
        for provider in providers.values():
            models = [m for m in provider.get("models", []) if isinstance(m, dict)]
            reasoning = {
                _s(x) for x in provider.get("reasoningModels", [])
            } | {_s(m.get("id")) for m in models if m.get("reasoning")}
            non_chat = {
                _s(x) for x in provider.get("nonChatModels", [])
            } | {_s(m.get("id")) for m in models if m.get("nonChat") or m.get("chat") is False}
            keys: list[Any] = []
            for item in provider.get("apiKeys", []):
                if not isinstance(item, dict):
                    continue
                key = _s(item.get("key"))
                if not key:
                    continue
                account = _s(item.get("acct") or item.get("accountId"))
                keys.append({"accountId": account, "token": key} if account else key)
            if not keys and _s(provider.get("apiKey")):
                keys = [_s(provider.get("apiKey"))]
            model_ids = [_s(m.get("id")) for m in models if _s(m.get("id"))]
            row = {
                "id": _s(provider.get("id")),
                "name": _s(provider.get("name") or provider.get("id")),
                "baseUrl": _s(provider.get("url") or provider.get("endpoint")),
                "apiKey": (_s(keys[0].get("token")) if keys and isinstance(keys[0], dict)
                           else _s(keys[0]) if keys else ""),
                "apiKeys": keys,
                "models": model_ids,
                "reasoningModels": sorted(x for x in reasoning if x in model_ids),
                "nonChatModels": sorted(x for x in non_chat if x in model_ids),
                "enabled": provider.get("enabled", True) is not False,
            }
            if _s(provider.get("vendor")):
                row["vendor"] = _s(provider.get("vendor"))
            rows.append(row)
        ai = data.get("ai") or {}
        # A classic-Python installation may only have the legacy single model.
        # Surface it as one provider so the Node model picker remains usable.
        if not rows and (_s(ai.get("endpoint")) or _s(ai.get("api_key"))):
            model = _s(ai.get("model"))
            rows.append({
                "id": _s(ai.get("provider")) or "default",
                "name": _s(ai.get("provider")) or "Default",
                "baseUrl": _s(ai.get("endpoint")),
                "apiKey": _s(ai.get("api_key")),
                "apiKeys": [_s(ai.get("api_key"))] if _s(ai.get("api_key")) else [],
                "models": [model] if model else [],
                "reasoningModels": [], "nonChatModels": [], "enabled": True,
            })
        return rows

    def connections_payload(data: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        """Return Node's complete ``ConnectionVault`` shape.

        Secrets are intentionally returned to the authenticated dashboard: the
        Node runtime decrypts its vault for this same endpoint, and provider
        editing/export cannot work with placeholder values.  ``/api/status``
        exposes booleans only and never calls this payload directly.
        """
        data = data or load()
        woo = data.get("woocommerce") or {}
        bsl = data.get("basalam") or {}
        ai = data.get("ai") or {}
        stored = data.get("node_connections")
        if not isinstance(stored, dict):
            stored = {}
        empty = {
            "woo": {"url": "", "key": "", "secret": "", "categoryId": 0,
                    "pricePercent": 0, "network": {"mode": "auto", "workerUrl": ""}},
            "basalam": {"token": "", "vendorId": "", "api": "https://openapi.basalam.com/v1",
                        "clientMode": "auto", "pricePercent": 0, "preparationDays": 3, "weight": 500,
                        "packageWeight": 600, "stock": 10, "categoryId": 0,
                        "fallbackCategoryIds": [], "autoCategory": False,
                        "netIndirect": False, "shops": []},
            "ai": {"catalogVersion": 0, "baseUrl": "", "apiKey": "", "model": "",
                   "providers": [], "candidates": [], "master": "",
                   "network": {"mode": "direct", "proxyUrl": "", "workerUrl": "",
                               "dohUrl": "https://cloudflare-dns.com/dns-query", "resolveIp": ""}},
            "notifications": {"url": "", "token": "", "chatId": "", "baleToken": "",
                              "baleChatId": "", "rubikaToken": "", "rubikaChatId": ""},
        }
        result = _deep_merge(empty, stored)
        shops = []
        for row in bsl.get("vendors") or []:
            if not isinstance(row, dict):
                continue
            shops.append({
                "name": _s(row.get("shop_name") or row.get("name")),
                "token": _s(row.get("token")),
                "vendorId": _s(row.get("vendor_id")),
                "pricePercent": _num(row.get("price_val")) if _s(row.get("price_mode")) == "percent" else 0,
            })
        native = {
            "woo": {
                "url": _s(woo.get("url")), "key": _s(woo.get("consumer_key")),
                "secret": _s(woo.get("consumer_secret")),
                "categoryId": _int(woo.get("category_id")),
                "pricePercent": _num(woo.get("price_percent")),
                "network": {"mode": "worker" if _s(woo.get("api_mode")) == "relay" else "direct",
                            "workerUrl": _s(woo.get("relay_url"))},
            },
            "basalam": {
                "token": _s(bsl.get("token")), "vendorId": _s(bsl.get("vendor_id")),
                "api": _s(bsl.get("api_base_url")) or "https://openapi.basalam.com/v1",
                "clientMode": core.normalize_basalam_client_mode(bsl.get("client_mode")),
                "pricePercent": _num(bsl.get("price_val")) if _s(bsl.get("price_mode")) == "percent" else 0,
                "preparationDays": _int(bsl.get("preparation_days"), 3),
                "weight": _int(bsl.get("weight"), 500),
                "packageWeight": _int(bsl.get("package_weight"), 600),
                "stock": _int(bsl.get("stock"), 10), "categoryId": _int(bsl.get("category_id")),
                "fallbackCategoryIds": list(bsl.get("fallback_category_ids") or []),
                "autoCategory": bool(bsl.get("auto_category", False)),
                "netIndirect": bool(bsl.get("net_indirect", False)), "shops": shops,
            },
            "ai": {
                "baseUrl": _s(ai.get("endpoint")), "apiKey": _s(ai.get("api_key")),
                "model": _s(ai.get("model")), "providers": _node_ai_providers(data),
            },
        }
        result = _deep_merge(result, native)
        candidates = []
        for item in data.get("ai_candidates") or []:
            if isinstance(item, dict):
                key = _s(item.get("provider")) + "::" + _s(item.get("model"))
            else:
                key = _s(item).replace("/", "::", 1) if "::" not in _s(item) else _s(item)
            if key.strip(":"):
                candidates.append(key)
        if candidates:
            result["ai"]["candidates"] = list(dict.fromkeys(candidates))
        master = _s(data.get("ai_master"))
        if master:
            result["ai"]["master"] = master.replace("/", "::", 1) if "::" not in master else master
        return result

    def ok(**payload: Any):
        return jsonify(ok=True, **payload)

    # ── static dashboard shell ───────────────────────────────────────────
    @app.get("/ui")
    def node_dashboard():
        """Serve the Node-compatible dashboard with Python integrations."""
        return send_from_directory(UI_DIR, "dashboard.html")

    @app.get("/ui/")
    def node_dashboard_slash():
        """Canonicalise ``/ui/`` to ``/ui``.

        The dashboard script derives its API root from the page path
        (``APP_BASE = location.pathname.replace(/[^/]*$/,'')``). Served at
        ``/ui`` that yields ``/`` (or ``/put/`` behind the Apache prefix),
        which is correct. Served at ``/ui/`` it would yield ``/ui/`` and every
        request would hit ``/ui/api/*`` and 404 — a dashboard that renders but
        never loads data. Redirecting keeps that URL working.
        """
        return redirect(url_for("node_dashboard"), code=301)

    @app.get("/ui/dashboard.js")
    @app.get("/dashboard.js")
    def node_dashboard_js():
        response: Response = send_from_directory(UI_DIR, "dashboard.js")
        response.headers["content-type"] = "application/javascript; charset=utf-8"
        # Make the served build identifiable from the browser's network tab, so
        # "is my server actually running the new code?" is answerable without
        # shell access.
        response.headers["x-scraper-version"] = core.APP_VERSION
        return response

    @app.get("/api/build")
    def node_build():
        """Which files this process is really serving, and from where."""
        def stamp(path: str) -> dict[str, Any]:
            try:
                st = os.stat(path)
                return {"path": path, "bytes": st.st_size,
                        "mtime": time.strftime("%Y-%m-%d %H:%M:%S",
                                               time.localtime(st.st_mtime))}
            except OSError:
                return {"path": path, "missing": True}
        return ok(
            version=core.APP_VERSION,
            files={
                "scraper4.py": stamp(os.path.abspath(getattr(core, "__file__", ""))),
                "ui_bridge.py": stamp(os.path.abspath(__file__)),
                "dashboard.js": stamp(os.path.join(UI_DIR, "dashboard.js")),
                "dashboard.html": stamp(os.path.join(UI_DIR, "dashboard.html")),
            },
        )

    # ── web fonts ────────────────────────────────────────────────────────
    # The font picker writes --app-font and loads /assets/fonts/<name>.css.
    # Those files were never ported, so every choice 404'd and the page stayed
    # on Tahoma — the picker looked broken. Serve a real @font-face stylesheet:
    # from ui/fonts/ when the .woff2 has been vendored, otherwise pointing at
    # the upstream CDN so a server with internet still gets the font.
    FONT_DIR = os.path.join(UI_DIR, "fonts")
    FONT_SOURCES = {
        # key: (family name, CDN css, local woff2 basename)
        "vazir": ("Vazir",
                  "https://cdn.jsdelivr.net/gh/rastikerdar/vazir-font@v30.1.0/dist/font-face.css",
                  "vazir"),
        "yekan": ("Yekan",
                  "https://cdn.jsdelivr.net/gh/rastikerdar/yekan-bakh-font@v1.0.0/dist/font-face.css",
                  "yekan"),
        "shabnam": ("Shabnam",
                    "https://cdn.jsdelivr.net/gh/rastikerdar/shabnam-font@v5.0.1/dist/font-face.css",
                    "shabnam"),
        "sahel": ("Sahel",
                  "https://cdn.jsdelivr.net/gh/rastikerdar/sahel-font@v3.4.0/dist/font-face.css",
                  "sahel"),
        "samim": ("Samim",
                  "https://cdn.jsdelivr.net/gh/rastikerdar/samim-font@v4.0.5/dist/font-face.css",
                  "samim"),
    }

    @app.get("/assets/fonts/<name>.css")
    def node_font_css(name: str):
        key = _s(name).lower()
        entry = FONT_SOURCES.get(key)
        if not entry:
            return Response("/* unknown font */", mimetype="text/css"), 404
        family, cdn, base = entry
        local = os.path.join(FONT_DIR, base + ".woff2")
        if os.path.isfile(local):
            css = (
                "@font-face{font-family:'%s';src:url('%s') format('woff2');"
                "font-weight:100 900;font-display:swap;}" % (
                    family, url_for("node_font_file", filename=base + ".woff2"))
            )
        else:
            # No vendored copy: re-export the upstream stylesheet. If the
            # server has no internet the browser simply falls back to Tahoma,
            # which is the documented behaviour rather than a silent 404.
            css = "@import url('%s');" % cdn
        response = Response(css, mimetype="text/css")
        response.headers["cache-control"] = "public, max-age=86400"
        return response

    @app.get("/assets/fonts/<path:filename>")
    def node_font_file(filename: str):
        if not os.path.isdir(FONT_DIR):
            return Response("", status=404)
        return send_from_directory(FONT_DIR, filename)

    @app.get("/api/fonts")
    def node_fonts_status():
        """Which fonts are vendored locally vs served from the CDN."""
        rows = []
        for key, (family, cdn, base) in FONT_SOURCES.items():
            local = os.path.isfile(os.path.join(FONT_DIR, base + ".woff2"))
            rows.append({"id": key, "family": family, "local": local,
                         "source": "local" if local else "cdn"})
        return ok(fonts=rows, dir=FONT_DIR,
                  vendored=sum(1 for r in rows if r["local"]))

    # ── core status / version / settings ─────────────────────────────────
    @app.get("/api/status")
    def node_status():
        data = load()
        vault = connections_payload(data)
        providers = vault.get("ai", {}).get("providers") or []
        status = {
            "woo": bool(vault["woo"].get("url") and vault["woo"].get("key") and vault["woo"].get("secret")),
            "basalam": bool(vault["basalam"].get("token") and vault["basalam"].get("vendorId")),
            "ai": bool((vault["ai"].get("baseUrl") and vault["ai"].get("apiKey") and vault["ai"].get("model"))
                       or any(p.get("enabled", True) is not False and p.get("baseUrl")
                              and p.get("apiKey") and p.get("models") for p in providers)),
            "notifications": bool(any(vault.get("notifications", {}).get(k) for k in
                                      ("url", "baleToken", "rubikaToken"))),
        }
        return ok(
            profiles=len(data.get("profiles") or {}),
            jobs=[task_to_job(t) for t in live_tasks()[:10]],
            connections=status,
            queue=True,
            storage={"json": True, "atomic": True, "path": core.DATA_FILE},
        )

    @app.get("/api/version")
    def node_version():
        return ok(version=core.APP_VERSION, build=getattr(core, "BUILD_ID", core.APP_VERSION),
                  edition="python", runtime="flask")

    @app.get("/api/quota")
    def node_quota():
        return ok(quota={"used": 0, "limit": 0, "unlimited": True})

    @app.get("/api/debug")
    def node_debug():
        data = load()
        return ok(debug={
            "version": core.APP_VERSION,
            "dataFile": core.DATA_FILE,
            "profiles": len(data.get("profiles") or {}),
            "tasks": len(live_tasks()),
        })

    @app.get("/api/parity")
    def node_parity():
        """What this build actually is, for the version panel.

        This used to report a "php" field read from a PHP_PARITY constant that
        does not exist in this fork, so the button always showed an empty
        value. Report facts we can establish instead: version, changelog size,
        runtime, and which optional engines are really present.
        """
        log = getattr(core, "CHANGELOG", []) or []
        engines = [e for e in getattr(core, "KNOWN_ENGINES", ())
                   if core.fetch_engine_installed(e)]
        try:
            with open(os.path.join(os.path.dirname(__file__), "parity-manifest.json"),
                      encoding="utf-8") as handle:
                manifest = json.load(handle)
        except Exception:  # pragma: no cover - packaging damage is reported by checker
            manifest = {}
        source = manifest.get("source") if isinstance(manifest.get("source"), dict) else {}
        contracts = manifest.get("behavioralContracts") if isinstance(manifest.get("behavioralContracts"), list) else []
        return ok(parity={
            "python": core.APP_VERSION,
            "releases": len(log),
            "latest": (log[0].get("version") if log else core.APP_VERSION),
            "latestDate": (log[0].get("date") if log else ""),
            "runtime": f"python {sys.version.split()[0]} · flask",
            "dashboard": bool(globals().get("_BRIDGE_OK", True)),
            "engines": engines,
            "engineCount": len(engines),
            "nodeVersion": source.get("version"),
            "nodeCommit": source.get("commit"),
            "requiredRoutes": len(manifest.get("requiredRoutes") or []),
            "behavioralContracts": [row.get("id") for row in contracts if isinstance(row, dict)],
        })

    # Every dashboard key is persisted, including future groups unknown to this
    # Python release.  Earlier builds used an allow-list and silently discarded
    # source, digest, autoreply, branchPush, category, photo and scalar keys such
    # as githubBackupToken.
    def _settings_payload(data: dict[str, Any]) -> dict[str, Any]:
        stored = data.get("ui_settings")
        if not isinstance(stored, dict):
            stored = {}
        settings = copy.deepcopy(stored)
        settings.update({
            "network": _deep_merge(data.get("network") or {}, settings.get("network") or {}),
            "maxPages": getattr(core, "MAX_PAGES_HARD", 0),
            "maxProducts": core.MAX_PRODUCTS_HARD,
            "activeProfile": _s(data.get("active_profile")),
            "autoUpdate": bool(data.get("auto_update", True)),
        })
        return settings

    @app.get("/api/settings")
    def node_settings_get():
        data = load()
        return ok(settings=_settings_payload(data), network=data.get("network") or {},
                  ui_settings=data.get("ui_settings") or {}, deploy=data.get("deploy") or {})

    @app.route("/api/settings", methods=["POST", "PUT", "PATCH"])
    def node_settings_post():
        body = _body()
        data = load()
        incoming = body.get("settings") if isinstance(body.get("settings"), dict) else body
        if not isinstance(incoming, dict):
            return jsonify(ok=False, error="settings must be an object"), 400
        stored = data.get("ui_settings")
        if not isinstance(stored, dict):
            stored = {}
        # Runtime-derived values are accepted for compatibility but not copied
        # into the preference vault. All other nested/scalar values round-trip.
        persist = {k: v for k, v in incoming.items()
                   if k not in {"maxPages", "maxProducts", "activeProfile", "autoUpdate",
                                "network", "source", "deploy", "woocommerce"}}
        data["ui_settings"] = _deep_merge(stored, persist)
        if isinstance(incoming.get("network"), dict):
            data["network"] = _merge_connection_input(data.get("network") or {}, incoming["network"])
        # The classic Python console also saves its gateway/Woo/deployer forms
        # through /api/settings. Preserve that contract while the Node dashboard
        # uses /api/connections for the same vault.
        if isinstance(incoming.get("woocommerce"), dict):
            data["woocommerce"] = _merge_connection_input(
                data.get("woocommerce") or {}, incoming["woocommerce"])
        if isinstance(incoming.get("deploy"), dict):
            deploy_in = incoming["deploy"]
            deploy = _merge_connection_input(data.get("deploy") or {}, deploy_in)
            if "branches" in deploy_in or "branch" in deploy_in:
                branches = core.normalize_branches(
                    deploy_in.get("branches", deploy_in.get("branch", "")),
                    _s(deploy_in.get("branch")))
                if branches:
                    deploy["branches"], deploy["branch"] = branches, branches[0]
            if deploy_in.get("clear_token"):
                deploy["github_token"] = ""
            data["deploy"] = deploy
        if "activeProfile" in incoming:
            active = _s(incoming["activeProfile"])
            if not active or active in (data.get("profiles") or {}):
                data["active_profile"] = active
        source = incoming.get("source")
        if isinstance(source, dict):
            network = dict(data.get("network") or {})
            mode = _s(source.get("mode")).lower()
            proxy = _s(source.get("proxy"))
            worker = _s(source.get("worker"))
            if mode in {"worker", "relay"} and worker:
                network.update(proxy_mode="relay", proxy=worker)
            elif mode in {"proxy", "http", "httpproxy"} and proxy:
                network.update(proxy_mode="http", proxy=proxy)
            elif mode in {"direct", "none"}:
                network.update(proxy_mode="direct", proxy="")
            if source.get("gap") is not None:
                network["gap_ms"] = max(0, _int(source.get("gap")))
            data["network"] = network
        save(data)
        return ok(settings=_settings_payload(data), network=data.get("network") or {},
                  ui_settings=data.get("ui_settings") or {}, deploy=data.get("deploy") or {})

    @app.get("/api/connections")
    def node_connections_get():
        return ok(connections=connections_payload())

    @app.post("/api/connections")
    def node_connections_post():
        body = _body()
        incoming = body.get("connections") if isinstance(body.get("connections"), dict) else body
        if not isinstance(incoming, dict):
            return jsonify(ok=False, error="connections must be an object"), 400
        data = load()
        current = connections_payload(data)
        vault = _merge_connection_input(current, incoming)
        data["node_connections"] = copy.deepcopy(vault)

        woo_in = vault.get("woo") if isinstance(vault.get("woo"), dict) else {}
        woo = dict(data.get("woocommerce") or {})
        woo.update({
            "url": _s(woo_in.get("url")).rstrip("/"),
            "consumer_key": _s(woo_in.get("key")),
            "consumer_secret": _s(woo_in.get("secret")),
            "category_id": _int(woo_in.get("categoryId")),
            "price_percent": _num(woo_in.get("pricePercent")),
        })
        woo_network = woo_in.get("network") if isinstance(woo_in.get("network"), dict) else {}
        if _s(woo_network.get("mode")) == "worker":
            woo.update(api_mode="relay", relay_url=_s(woo_network.get("workerUrl")))
        elif _s(woo_network.get("mode")) in {"direct", "auto"}:
            woo["api_mode"] = "direct"
        data["woocommerce"] = woo

        bsl_in = vault.get("basalam") if isinstance(vault.get("basalam"), dict) else {}
        bsl = dict(data.get("basalam") or {})
        token = _s(bsl_in.get("token"))
        token = re.sub(r"^(?:authorization\s*:\s*)?(?:bearer|token)\s+", "", token,
                       flags=re.I).strip().strip("\"'")
        bsl.update({
            "token": token,
            "vendor_id": _int(bsl_in.get("vendorId")),
            "api_base_url": _s(bsl_in.get("api")) or "https://openapi.basalam.com",
            "client_mode": core.normalize_basalam_client_mode(bsl_in.get("clientMode")),
            "price_mode": "percent" if _num(bsl_in.get("pricePercent")) else "none",
            "price_val": _num(bsl_in.get("pricePercent")),
            "preparation_days": max(0, _int(bsl_in.get("preparationDays"), 3)),
            "weight": max(0, _int(bsl_in.get("weight"), 500)),
            "package_weight": max(0, _int(bsl_in.get("packageWeight"), 600)),
            "stock": max(0, _int(bsl_in.get("stock"), 10)),
            "category_id": max(0, _int(bsl_in.get("categoryId"))),
            "fallback_category_ids": [
                _int(x) for x in (bsl_in.get("fallbackCategoryIds") or []) if _int(x) > 0
            ],
            "auto_category": bool(bsl_in.get("autoCategory", False)),
            "net_indirect": bool(bsl_in.get("netIndirect", False)),
        })
        shops = []
        for row in bsl_in.get("shops") or []:
            if not isinstance(row, dict):
                continue
            shops.append({
                "shop_name": _s(row.get("name")), "name": _s(row.get("name")),
                "token": re.sub(r"^(?:bearer|token)\s+", "", _s(row.get("token")),
                                flags=re.I).strip(),
                "vendor_id": _int(row.get("vendorId")),
                "price_mode": "percent" if _num(row.get("pricePercent")) else "none",
                "price_val": _num(row.get("pricePercent")),
            })
        bsl["vendors"] = shops
        data["basalam"] = bsl

        ai_in = vault.get("ai") if isinstance(vault.get("ai"), dict) else {}
        native_providers: dict[str, dict[str, Any]] = {}
        for index, provider in enumerate(ai_in.get("providers") or []):
            if not isinstance(provider, dict):
                continue
            pid = re.sub(r"[^A-Za-z0-9_.-]+", "-", _s(provider.get("id"))).strip("-")
            if not pid:
                pid = f"provider-{index + 1}"
            model_ids = []
            for value in provider.get("models") or []:
                mid = _s(value.get("id") or value.get("name")) if isinstance(value, dict) else _s(value)
                if mid and mid not in model_ids:
                    model_ids.append(mid)
            reasoning = {_s(x) for x in provider.get("reasoningModels") or []}
            non_chat = {_s(x) for x in provider.get("nonChatModels") or []}
            models = [{"id": mid, "name": mid, "enabled": True,
                       "reasoning": mid in reasoning, "nonChat": mid in non_chat,
                       "chat": mid not in non_chat} for mid in model_ids]
            key_rows = []
            raw_keys = provider.get("apiKeys") if isinstance(provider.get("apiKeys"), list) else []
            if not raw_keys and _s(provider.get("apiKey")):
                raw_keys = [_s(provider.get("apiKey"))]
            for value in raw_keys:
                if isinstance(value, dict):
                    key = _s(value.get("token") or value.get("key"))
                    account = _s(value.get("accountId") or value.get("acct"))
                else:
                    key, account = _s(value), ""
                if key:
                    key_rows.append({"key": key, "acct": account, "enabled": True})
            native_providers[pid] = {
                "id": pid, "name": _s(provider.get("name")) or pid,
                "vendor": _s(provider.get("vendor")),
                "url": _s(provider.get("baseUrl")).rstrip("/"),
                "endpoint": _s(provider.get("baseUrl")).rstrip("/"),
                "enabled": provider.get("enabled", True) is not False,
                "apiKey": key_rows[0]["key"] if key_rows else _s(provider.get("apiKey")),
                "apiKeys": key_rows, "models": models,
                "reasoningModels": sorted(reasoning), "nonChatModels": sorted(non_chat),
            }
        data["ai_providers"] = native_providers
        candidates = []
        for key in ai_in.get("candidates") or []:
            text = _s(key)
            if "::" not in text:
                continue
            provider, model = text.split("::", 1)
            model = re.sub(r"::k\d+$", "", model)
            if provider in native_providers and model:
                candidates.append({"provider": provider, "model": model})
        data["ai_candidates"] = candidates
        master = _s(ai_in.get("master"))
        data["ai_master"] = master.replace("::", "/", 1) if "::" in master else master
        ai = dict(data.get("ai") or {})
        selected = _s(ai_in.get("model"))
        selected_provider = ""
        selected_model = selected
        if "::" in selected:
            selected_provider, selected_model = selected.split("::", 1)
            selected_model = re.sub(r"::k\d+$", "", selected_model)
        if selected_provider in native_providers:
            provider = native_providers[selected_provider]
            ai.update(provider=selected_provider, model=selected_model,
                      endpoint=provider.get("url", ""), api_key=provider.get("apiKey", ""))
        else:
            ai.update(endpoint=_s(ai_in.get("baseUrl")), api_key=_s(ai_in.get("apiKey")),
                      model=selected_model)
        data["ai"] = ai
        save(data)
        return ok(connections=connections_payload(data))

    # ── profiles ─────────────────────────────────────────────────────────
    @app.get("/api/profiles")
    def node_profiles_list():
        data = load()
        return ok(profiles=[profile_to_node(n, c) for n, c in (data.get("profiles") or {}).items()])

    @app.route("/api/profiles", methods=["POST", "PUT", "PATCH"])
    def node_profiles_save():
        body = _body()
        data = load()
        profiles = data.get("profiles") or {}
        patch = body.get("_autosavePatch")
        pid = _s(body.get("id"))
        if patch:
            if pid not in profiles:
                return jsonify(ok=False, error="Profile no longer exists"), 404
            merged = dict(profile_to_node(pid, profiles[pid]))
            merged.update(patch if isinstance(patch, dict) else {})
            if isinstance(patch, dict) and isinstance(patch.get("selectors"), dict):
                sel = dict(merged.get("selectors") or {})
                sel.update(patch["selectors"])
                merged["selectors"] = sel
            node = merged
        else:
            node = body
        name = _s(node.get("id")) or _s(node.get("name"))
        if not name:
            return jsonify(ok=False, error="شناسه پروفایل لازم است."), 400
        if not _s(node.get("url")) and not _truthy(node.get("noExtract")):
            return jsonify(ok=False, error="آدرس پروفایل لازم است."), 400
        try:
            if _s(node.get("url")):
                core.public_http_url(_s(node.get("url")))
        except ValueError as exc:
            return jsonify(ok=False, error=str(exc)), 400
        profiles[name] = node_to_profile(node, profiles.get(name) or {})
        data["profiles"] = profiles
        data["active_profile"] = name
        save(data)
        return ok(profile=profile_to_node(name, profiles[name]), priceSyncJob=None, priceSync="not-requested")

    @app.delete("/api/profiles/<path:pid>")
    def node_profile_delete(pid: str):
        data = load()
        existed = (data.get("profiles") or {}).pop(pid, None) is not None
        if data.get("active_profile") == pid:
            data["active_profile"] = ""
        save(data)
        return ok() if existed else jsonify(ok=False, error="پروفایل پیدا نشد."), (200 if existed else 404)

    @app.get("/api/profiles/<path:pid>/products")
    def node_profile_products(pid: str):
        limit = min(500, _int(request.args.get("limit"), 100) or 100)
        offset = max(0, _int(request.args.get("offset")))
        query = _s(request.args.get("q")).strip().lower()
        data = load()
        profile = data.get("profiles", {}).get(pid) or {}
        rules = profile.get("profile_rules") if isinstance(profile.get("profile_rules"), dict) else {}
        rows = profile_products(pid, data)
        if query:
            rows = [r for r in rows if query in _s(r.get("title")).lower()]
        total = len(rows)
        page = [
            product_with_profile_price(product_to_node(row, offset + index), rules)
            for index, row in enumerate(rows[offset:offset + limit])
        ]
        return ok(products=page, total=total, limit=limit, offset=offset)

    @app.delete("/api/profiles/<path:pid>/products")
    def node_profile_products_clear(pid: str):
        if request.args.get("confirm") != "DELETE":
            return jsonify(ok=False, error="برای حذف همهٔ نتایج، confirm=DELETE لازم است."), 400
        data = load()
        cfg = (data.get("profiles") or {}).get(pid)
        deleted = 0
        if isinstance(cfg, dict):
            deleted = len(cfg.get("saved_products") or [])
            cfg["saved_products"] = []
        if data.get("active_profile") == pid:
            data["last_result"] = []
        save(data)
        return ok(deleted=deleted)

    @app.delete("/api/profiles/<path:pid>/products/<path:source_key>")
    def node_profile_product_delete(pid: str, source_key: str):
        data = load()
        cfg = (data.get("profiles") or {}).get(pid)
        removed = False
        if isinstance(cfg, dict) and isinstance(cfg.get("saved_products"), list):
            before = len(cfg["saved_products"])
            cfg["saved_products"] = [
                r for r in cfg["saved_products"]
                if _s(r.get("source_key") or r.get("url")) != source_key
            ]
            removed = len(cfg["saved_products"]) != before
        save(data)
        return ok(ok=removed)

    @app.get("/api/profiles/<path:pid>/export.csv")
    def node_profile_export_csv(pid: str):
        fields = ["sourceKey", "title", "price", "url", "image", "sku", "brand",
                  "stock", "weight", "category", "shortDesc", "longDesc"]
        rows = [product_to_node(r, i) for i, r in enumerate(profile_products(pid))]

        def cell(value: Any) -> str:
            text = "" if value is None else str(value)
            return '"' + text.replace('"', '""') + '"' if re.search(r'[",\n]', text) else text

        csv = "\ufeff" + ",".join(fields) + "\n" + "\n".join(
            ",".join(cell(row.get(f)) for f in fields) for row in rows
        )
        safe = re.sub(r"[^A-Za-z0-9_.-]", "_", pid)
        return Response(csv, mimetype="text/csv; charset=utf-8",
                        headers={"content-disposition": f'attachment; filename="{safe}.csv"'})

    def _start_scrape(pid: str):
        data = load()
        cfg = (data.get("profiles") or {}).get(pid)
        if not isinstance(cfg, dict):
            return jsonify(ok=False, error="پروفایل پیدا نشد."), 404
        body = _body()
        # The start page has two buttons and they must do different things:
        #   list-only  ("استخراج بک‌اند")   fetch the listing and save it, stop
        #   full       ("همگام‌سازی دستی")  listing -> details -> … -> dispatch
        # Both used to run the identical job because workflow/target were
        # accepted by the UI and then dropped here.
        workflow = _s(body.get("workflow")) or "full"
        target = _s(body.get("target")) or "none"
        list_only = workflow == "list-only"
        config = dict(cfg)
        config["_profile_name"] = pid
        config["workflow"] = workflow
        if list_only:
            # No detail pass, no downstream dispatch.
            config["enrich"] = False
            config["_dispatch_after"] = ""
        else:
            config["enrich"] = True
            config["_dispatch_after"] = target if target != "none" else ""
        # Do not rewrite the global active-profile preference when a job starts.
        # The worker already owns an immutable config/profile snapshot; saving
        # the earlier `data` object here could overwrite results that a parallel
        # Playwright/HTTP worker committed between this route's load and save.
        title = ("استخراج فهرست · " if list_only else "همگام‌سازی کامل · ") + pid
        task = core.live_task_create("scrape", title, private=False)
        with core.LIVE_TASK_LOCK:
            task["profile"] = pid
            task["workflow"] = workflow
            task["target"] = target
            core.LIVE_TASKS[task["id"]] = task
        core.live_task_disk_write(task)
        core.threading.Thread(
            target=core.scrape_live_worker, args=(task["id"], config),
            name="scrape-live", daemon=True,
        ).start()
        return ok(job=task_to_job(task), task=task)

    for _suffix in ("scrape", "run", "extract"):
        app.add_url_rule(
            f"/api/profiles/<path:pid>/{_suffix}", f"node_profile_{_suffix}",
            _start_scrape, methods=["POST"],
        )
    app.add_url_rule("/api/extract/<path:pid>", "node_extract_profile",
                     _start_scrape, methods=["POST"])

    # ── start-page diagnostics ───────────────────────────────────────────
    # Two buttons on the home tab (تست موتورها / عیب‌یابی) posted to these
    # paths and got a 405 from the catch-all, so both silently did nothing.
    # The UI accepts a plain JSON body when the response is not NDJSON, so
    # these run synchronously and return the finished report.

    def _diag_fetch(config: dict[str, Any], url: str, engine: str,
                    probe_timeout: int = 0, fetcher: Any = None) -> Any:
        """One page fetch with a specific engine, via the real Fetcher.

        Mirrors what scrape() does: when a relay/proxy gateway is configured
        and fails, retry once directly. Without this the diagnostic and the
        speed test reported a dead gateway as a dead site, while a real
        extraction of the same profile succeeded on the direct retry.

        ``probe_timeout`` caps a single attempt. The speed test forces every
        engine in turn, and Fetcher.get() retries three times with backoff, so
        an unresponsive site cost 33s per engine — over two minutes before the
        first result appeared. A benchmark only needs to know whether an engine
        works, so it probes with a short budget instead of the full extraction
        patience.
        """
        network = dict(load().get("network") or {})
        if probe_timeout:
            network["timeout"] = probe_timeout
        # 10.228: pass fetcher= to reuse one session (cookies persist) across
        # the whole diagnostic — session-gated sites treat each fresh fetcher
        # as a brand-new visitor.
        if fetcher is None:
            fetcher = core.Fetcher(network)

        def attempt() -> Any:
            try:
                return fetcher.get(url, engine=engine)
            except Exception:
                if fetcher.proxy_mode not in {"relay", "http"}:
                    raise
                return core._fetcher_direct(network).get(url, engine=engine)

        if not probe_timeout:
            return attempt()
        # Fetcher.get() retries three times with backoff, so a short socket
        # timeout still adds up to ~3x per engine. A probe must be bounded as a
        # whole, so run it in a daemon thread and abandon it at the deadline.
        box: dict[str, Any] = {}

        def run() -> None:
            try:
                box["ok"] = attempt()
            except BaseException as exc:  # noqa: BLE001 - re-raised below
                box["err"] = exc

        worker = threading.Thread(target=run, name="probe-" + engine, daemon=True)
        worker.start()
        worker.join(probe_timeout + 2)
        if worker.is_alive():
            raise TimeoutError(
                f"پاسخی در {probe_timeout} ثانیه دریافت نشد")
        if "err" in box:
            raise box["err"]
        return box["ok"]

    @app.route("/api/profiles/<path:pid>/results/apply", methods=["GET", "POST", "PUT", "PATCH"])
    def node_profile_results_apply(pid: str):
        """
        Apply current profile price/title rules to already-saved products.
        Mirrors the Node dashboard's POST /api/profiles/:id/results/apply.
        Called automatically after priceMode/priceValue/roundPrice/titleSuffix changes
        via applySavedResults() in ui/dashboard.js. Pagination via `after` cursor.
        """
        body = _body()
        after = _s(body.get("after") or request.args.get("after") or "")
        previous_suffix = _s(body.get("previousSuffix") or body.get("previous_suffix") or request.args.get("previousSuffix") or "")
        data = load()
        profiles = data.get("profiles") or {}
        cfg = profiles.get(pid)
        if not isinstance(cfg, dict):
            return jsonify(ok=False, error="پروفایل پیدا نشد."), 404
        # Resolve current rules from profile
        rules = cfg.get("profile_rules") if isinstance(cfg.get("profile_rules"), dict) else {}
        new_suffix = _s(rules.get("title_suffix") or rules.get("titleSuffix") or "")
        raw_price_mode = _s(rules.get("price_mode") or rules.get("priceMode") or "none")
        price_mode = {"multiply": "multiplier", "add": "fixed"}.get(raw_price_mode, raw_price_mode)
        try:
            price_val = float(rules.get("price_value", rules.get("price_val", rules.get("priceValue", 0))) or 0)
        except (TypeError, ValueError):
            price_val = 0
        try:
            round_price = int(float(rules.get("price_round", rules.get("round_price", rules.get("roundPrice", 0))) or 0))
        except (TypeError, ValueError):
            round_price = 0
        try:
            minimum_price = max(0, float(rules.get("min_price", rules.get("minPrice", 0)) or 0))
        except (TypeError, ValueError):
            minimum_price = 0

        rows = cfg.get("saved_products")
        if not isinstance(rows, list):
            # fallback to last_result if profile snapshot empty and active
            if data.get("active_profile") == pid and isinstance(data.get("last_result"), list):
                rows = data["last_result"]
            else:
                rows = []
        # Only dict rows are valid products
        valid = [r for r in rows if isinstance(r, dict)]
        total = len(valid)
        # Parse pagination cursor: after is index string
        try:
            start = int(after) if after else 0
        except (TypeError, ValueError):
            start = 0
        batch = 200  # process in chunks to keep response small; dashboard loops with after/next
        end = min(start + batch, total)
        changed = 0
        conflicts = 0  # kept for API compatibility; Python has no concurrent edits
        for idx in range(start, end):
            r = valid[idx]
            row_changed = False
            orig_title = _s(r.get("title"))
            new_title = orig_title
            # Remove previous suffix if it was previously applied.
            if previous_suffix and new_title.endswith(previous_suffix):
                new_title = new_title[: -len(previous_suffix)].rstrip()
            if new_suffix and not new_title.endswith(new_suffix):
                new_title = (new_title + " " + new_suffix).strip() if new_title else new_suffix
            if new_title != orig_title:
                r["title"] = new_title
                row_changed = True

            # Price transform: always start from the immutable source amount.
            base_raw = r.get("source_price")
            if base_raw in (None, ""):
                base_raw = r.get("sourcePrice")
            if base_raw in (None, ""):
                raw_base = r.get("resultBase") if isinstance(r.get("resultBase"), dict) else r.get("result_base")
                base_raw = raw_base.get("price") if isinstance(raw_base, dict) else None
            if base_raw in (None, ""):
                base_raw = r.get("price_before_adjust", r.get("original_price"))
            if base_raw in (None, ""):
                base_raw = r.get("price")
            base = _price_num(base_raw)
            # Legacy/imported rows often had the base only in resultBase/current
            # price. Persist it now so later rule changes cannot compound.
            if base > 0 and r.get("source_price") in (None, ""):
                r["source_price"] = str(int(base)) if base.is_integer() else str(base)
                row_changed = True

            if base > 0:
                new_price = base
                if price_mode == "percent":
                    new_price = base * (1 + price_val / 100)
                elif price_mode == "multiplier" and price_val > 0:
                    new_price = base * price_val
                elif price_mode == "fixed":
                    new_price = base + price_val
                if round_price > 0:
                    new_price = round(new_price / round_price) * round_price
                new_price = max(minimum_price, round(new_price))
                current_price = _price_num(r.get("price"))
                if int(new_price) != int(current_price):
                    r["price"] = str(int(new_price))
                    row_changed = True
                applied = {
                    "priceMode": {"multiplier": "multiply", "fixed": "add"}.get(price_mode, price_mode),
                    "priceValue": price_val,
                    "roundPrice": round_price,
                    "minPrice": minimum_price,
                }
                current_applied = dict(r.get("resultApplied")) if isinstance(r.get("resultApplied"), dict) else {}
                if any(current_applied.get(key) != value for key, value in applied.items()):
                    current_applied.update(applied)
                    r["resultApplied"] = current_applied
                    row_changed = True
            if row_changed:
                changed += 1
        # Persist if any changes
        if changed:
            # Ensure we write back to the correct storage location
            if isinstance(cfg.get("saved_products"), list):
                # valid is a filtered view, but we mutated original dicts in place, so already reflected
                pass
            elif data.get("active_profile") == pid and isinstance(data.get("last_result"), list):
                # mutated last_result in place
                pass
            save(data)
        next_cursor = str(end) if end < total else ""
        return ok(changed=changed, conflicts=conflicts, next=next_cursor, total=total, processed=end)

    @app.route("/api/profiles/<path:pid>/ai-descriptions", methods=["GET", "POST", "PUT", "PATCH"])
    def node_profile_ai_descriptions(pid: str):
        # Stub for AI description generation - prevents 405 when dashboard calls it
        # Real AI is optional; return empty result so UI shows no error
        return ok(ok=True, filled=0, candidates=0, failed=0, model="", failures=[])

    @app.post("/api/profiles/<path:pid>/benchmark-engines")
    def node_benchmark_engines(pid: str):
        """Time every installed fetch engine against the profile's first 3 pages (pagination-aware).

        With ?live=1 the result is streamed as NDJSON so the live panel can
        show each engine as it finishes instead of appearing stuck on the
        first sub-step for the whole run.
        """
        data = load()
        cfg = (data.get("profiles") or {}).get(pid)
        if not isinstance(cfg, dict):
            return jsonify(ok=False, error="پروفایل پیدا نشد."), 404
        url = _s(cfg.get("url"))
        if not url:
            return jsonify(ok=False, error="آدرس پروفایل خالی است."), 400
        probe_budget = max(5, min(_int(_body().get("timeout"), 12) or 12, 30))

        def run() -> Any:
            """Yield progress events, then the final report."""
            engines = [e for e in core.KNOWN_ENGINES
                       if core.fetch_engine_installed(e)]
            results: list[dict[str, Any]] = []
            parse_results: list[dict[str, Any]] = []
            best, best_rate = "", -1.0
            best_text = best_url = ""
            consecutive_failures = 0
            total_steps = len(engines) + len(getattr(core, "PARSE_ENGINES", ()))
            step = 0
            yield {"type": "progress", "name": "شروع تست",
                   "summary": f"{len(engines)} موتور دریافت آزمایش می‌شود",
                   "done": 0, "total": total_steps}
            for engine in engines:
                step += 1
                yield {"type": "progress", "name": f"موتور {engine}",
                       "summary": f"در حال دریافت صفحه با {engine}…",
                       "done": step - 1, "total": total_steps}
                if consecutive_failures >= 2:
                    row = {"engine": engine, "ok": False, "pagesScanned": 0,
                           "products": 0, "elapsedMs": 0,
                           "productsPerMinute": 0, "skipped": True,
                           "error": "به‌دلیل در دسترس نبودن سایت، این موتور آزمایش نشد"}
                    results.append(row)
                    yield {"type": "progress", "name": f"موتور {engine}",
                           "summary": row["error"], "done": step,
                           "total": total_steps, "row": row}
                    continue
                row = {"engine": engine, "ok": False, "pagesScanned": 0,
                       "products": 0, "elapsedMs": 0, "productsPerMinute": 0,
                       "error": "", "paginationError": ""}
                started = time.time()
                try:
                    # 10.192: 3-page pagination-aware benchmark — mirrors real scrape()
                    pag_kind_raw = _s(cfg.get("pagination") or "query")
                    pag_value_raw = _s(cfg.get("page_value") or "page")
                    _is_auto = pag_kind_raw.lower() in ("auto", "automatic", "detect", "")
                    pages_to_try = 3
                    # For scroll/none only 1 page makes sense
                    if pag_kind_raw.lower() in ("none", "scroll"):
                        pages_to_try = 1
                    total_rows: list[Any] = []
                    pages_scanned = 0
                    pagination_error = ""
                    detected_kind = ""
                    detected_value = ""
                    next_url = ""
                    first_text = ""
                    first_url = ""
                    # 10.225: mirror the real scrape() exactly — it stops when a
                    # page adds no NEW product. Count keys per page so a page
                    # that only replays page 1 (site ignoring the pattern) can
                    # no longer turn the test green while the real run stops.
                    seen_keys: set[str] = set()
                    page_details: list[dict[str, Any]] = []
                    for pn in range(1, pages_to_try + 1):
                        # Determine effective pagination for this page
                        if pn == 1:
                            cur_url = url
                        else:
                            eff_kind = detected_kind if _is_auto and detected_kind else pag_kind_raw
                            eff_value = detected_value if _is_auto and detected_value else pag_value_raw
                            eff_kind_norm = (eff_kind or "query").strip().lower()
                            if eff_kind_norm in ("next", "next_selector", "link"):
                                if not next_url:
                                    pagination_error = f"صفحه‌بندی next: لینک صفحهٔ {pn} پیدا نشد (صفحهٔ قبل next نداشت)"
                                    break
                                cur_url = next_url
                                next_url = ""
                            elif eff_kind_norm in ("none", "scroll"):
                                pagination_error = f"صفحه‌بندی {eff_kind} فقط تک‌صفحه است؛ صفحهٔ {pn} قابل آزمون نیست"
                                break
                            else:
                                try:
                                    cur_url = core.page_url(url, pn, eff_kind, eff_value)
                                except Exception as e:
                                    pagination_error = f"خطای ساخت URL صفحهٔ {pn} با صفحه‌بندی {eff_kind}:{eff_value} — {e}"
                                    break
                                # Detect duplicate URL (pagination not advancing)
                                if cur_url == url and pn > 1:
                                    pagination_error = f"صفحه‌بندی {eff_kind}:{eff_value} URL صفحهٔ {pn} را تغییر نداد (تکراری)"
                                    break
                        # Fetch page
                        try:
                            res = _diag_fetch(cfg, cur_url, engine, probe_timeout=probe_budget)
                        except Exception as fe:
                            if pn == 1:
                                raise
                            pagination_error = f"خطای دریافت صفحهٔ {pn} ({cur_url[:120]}): {fe}"
                            break
                        # Parse
                        rows, _soup, _stats = core.parse_html(res.text, res.url, cfg.get("selectors") or {})
                        if pn == 1:
                            first_text, first_url = res.text, res.url
                            # Auto-detect pagination for next iterations
                            if _is_auto:
                                try:
                                    dk, dv = core.detect_pagination(_soup, url)
                                    if dk and dk not in ("none", "scroll"):
                                        detected_kind, detected_value = dk, dv
                                except Exception:
                                    pass
                            # Prepare next_url for next pagination
                            if (detected_kind if _is_auto and detected_kind else pag_kind_raw).lower() in ("next", "next_selector", "link"):
                                try:
                                    nxt = None
                                    # 10.225: the profile's own selector first —
                                    # same order as the real scrape().
                                    for sel in ([pag_value_raw.strip()] if pag_value_raw.strip() else []) + ['a[rel="next"]', 'a.next', '.pagination a.next', '.pagination .next a', '.pager a.next', 'a[aria-label*="next" i]', 'a[aria-label*="بعدی" i]']:
                                        try:
                                            nxt = _soup.select_one(sel)
                                            if nxt and nxt.get("href"):
                                                break
                                        except Exception:
                                            continue
                                    if nxt and nxt.get("href"):
                                        href = nxt.get("href")
                                        from urllib.parse import urljoin as _urljoin
                                        _candidate = _urljoin(res.url, href)
                                        # A self-link would replay the same page.
                                        next_url = "" if _candidate.rstrip("/") == res.url.rstrip("/") else _candidate
                                except Exception:
                                    next_url = ""
                        else:
                            # For next pagination, prepare next for following iteration
                            if (detected_kind if _is_auto and detected_kind else pag_kind_raw).lower() in ("next", "next_selector", "link"):
                                try:
                                    nxt = None
                                    # 10.225: profile selector first, then defaults.
                                    for sel in ([pag_value_raw.strip()] if pag_value_raw.strip() else []) + ['a[rel="next"]', 'a.next', '.pagination a.next']:
                                        try:
                                            nxt = _soup.select_one(sel)
                                            if nxt and nxt.get("href"):
                                                break
                                        except Exception:
                                            continue
                                    if nxt and nxt.get("href"):
                                        from urllib.parse import urljoin as _urljoin
                                        _candidate = _urljoin(res.url, nxt.get("href"))
                                        next_url = "" if _candidate.rstrip("/") == res.url.rstrip("/") else _candidate
                                    else:
                                        next_url = ""
                                except Exception:
                                    next_url = ""
                        # Accumulate
                        new_count = 0
                        for _row in rows or []:
                            try:
                                _key = core.product_key(_row)
                            except Exception:
                                _key = _s(_row.get("url") or _row.get("title"))
                            if _key and _key not in seen_keys:
                                seen_keys.add(_key)
                                new_count += 1
                        if rows:
                            total_rows.extend(rows)
                        page_details.append({"page": pn, "products": len(rows or []), "new": new_count, "url": cur_url[:200]})
                        pages_scanned += 1
                        # If pagination returned 0 products on page 2/3, treat as pagination failure
                        if pn > 1 and not rows:
                            pagination_error = f"صفحهٔ {pn} با صفحه‌بندی {(detected_kind if _is_auto and detected_kind else pag_kind_raw)}:{(detected_value if _is_auto and detected_value else pag_value_raw)} خالی برگشت — احتمالاً الگو نادرست است (URL: {cur_url[:100]})"
                        elif pn > 1 and new_count == 0:
                            # 10.225: same rule as the real run — a page that
                            # only replays earlier products is a broken pattern
                            # (site ignoring ?page=/~page~ suffix or next self-link).
                            pagination_error = f"صفحهٔ {pn} هیچ محصول تازه‌ای نداشت ({len(rows or [])} محصول، همه تکراری صفحات قبل) — سایت الگوی {(detected_kind if _is_auto and detected_kind else pag_kind_raw)}:{(detected_value if _is_auto and detected_value else pag_value_raw)} را نادیده می‌گیرد (URL: {cur_url[:100]})"
                    elapsed = max(1, int((time.time() - started) * 1000))
                    if pagination_error:
                        # Report pagination failure explicitly; don't mark as successful engine if no products at all
                        row.update(ok=False, pagesScanned=pages_scanned, products=len(total_rows), elapsedMs=elapsed, productsPerMinute=0, error=pagination_error, paginationError=pagination_error, pageDetails=page_details)
                        summary = pagination_error[:110]
                        # Don't count as network failure for consecutive skipping
                        consecutive_failures = 0
                    else:
                        rate = round(len(total_rows) / (elapsed / 60000.0), 1) if total_rows else 0
                        row.update(ok=True, pagesScanned=pages_scanned, products=len(total_rows), elapsedMs=elapsed, productsPerMinute=rate, pageDetails=page_details)
                        if rate > best_rate:
                            best, best_rate = engine, rate
                        if not best_text and first_text:
                            best_text, best_url = first_text, first_url
                        consecutive_failures = 0
                        summary = f"{len(total_rows)} محصول در {pages_scanned} صفحه · {elapsed} میلی‌ثانیه"
                except Exception as exc:  # noqa: BLE001 - per engine
                    msg = str(exc)
                    is_selector = "سلکتور نامعتبر" in msg or "Invalid expression" in msg
                    if not is_selector:
                        consecutive_failures += 1
                    else:
                        # Selector error is profile-specific, not network; don't skip remaining engines.
                        consecutive_failures = 0
                    row["elapsedMs"] = max(1, int((time.time() - started) * 1000))
                    row["error"] = msg[:240]
                    row["diagnosis"] = {"hint": _engine_hint(engine, msg)}
                    summary = row["error"][:110]
                results.append(row)
                yield {"type": "progress", "name": f"موتور {engine}",
                       "summary": summary, "done": step,
                       "total": total_steps, "row": row}
            if best_text:
                for strategy in getattr(core, "PARSE_ENGINES", ()):
                    step += 1
                    prow = {"engine": strategy, "stage": "parse", "ok": False,
                            "products": 0, "elapsedMs": 0, "error": ""}
                    t0 = time.time()
                    try:
                        rows, _s2, _d2 = core.parse_html(
                            best_text, best_url, cfg.get("selectors") or {},
                            strategy)
                        prow.update(ok=True, products=len(rows),
                                    elapsedMs=max(1, int((time.time() - t0) * 1000)))
                        summary = f"{len(rows)} محصول"
                    except Exception as exc:  # noqa: BLE001 - per strategy
                        prow["error"] = str(exc)[:200]
                        prow["elapsedMs"] = max(1, int((time.time() - t0) * 1000))
                        summary = prow["error"][:110]
                    parse_results.append(prow)
                    yield {"type": "progress", "name": f"خواندن {strategy}",
                           "summary": summary, "done": step,
                           "total": total_steps, "row": prow}
            if best:
                fresh = load()
                target = (fresh.get("profiles") or {}).get(pid)
                if isinstance(target, dict):
                    target["fetch_engine_master"] = best
                    # 10.226: the real run discards a learned master whose
                    # saved host no longer matches the profile URL — save the
                    # host here too so the proven engine actually survives.
                    from urllib.parse import urlparse as _urlparse
                    target["fetch_engine_host"] = (_urlparse(_s(target.get("url"))).hostname or "").lower()
                    target["fetch_engine_learned_at"] = int(time.time())
                    save(fresh)
            report = {
                "ok": True, "profile": pid, "best": best,
                "results": results + parse_results,
                "fetchResults": results, "parseResults": parse_results,
                "engines": [r["engine"] for r in results],
                "summary": (f"سریع‌ترین موتور: {best}" if best
                            else "هیچ موتوری موفق نشد."),
            }
            yield {"type": "result", "report": report}

        if _s(request.args.get("live")) in ("1", "true", "yes"):
            return _ndjson(run())
        final: dict[str, Any] = {}
        for event in run():
            if event.get("type") == "result":
                final = event.get("report") or {}
        return jsonify(**final) if final else jsonify(ok=False,
                                                      error="تست کامل نشد"), 200

    def _ndjson(events: Any) -> Response:
        """Wrap a generator of dicts as an NDJSON stream the dashboard reads."""
        def body() -> Any:
            for event in events:
                yield json.dumps(event, ensure_ascii=False) + "\n"
        response = Response(stream_with_context(body()),
                            mimetype="application/x-ndjson")
        # Without this a proxy may buffer the whole body and defeat streaming.
        response.headers["x-accel-buffering"] = "no"
        response.headers["cache-control"] = "no-cache"
        return response

    def _engine_hint(engine: str, error: str) -> str:
        low = error.lower()
        if "نصب نیست" in error or "not installed" in low:
            return f"کتابخانهٔ {engine} روی سرور نصب نیست."
        if "403" in error or "captcha" in low or "ضدبات" in error:
            return "سایت درخواست را رد کرد؛ curl_cffi یا playwright را امتحان کنید."
        if "timeout" in low or "timed out" in low:
            return "زمان پاسخ تمام شد؛ مهلت را بیشتر کنید یا پروکسی عوض کنید."
        if "ssl" in low or "certificate" in low:
            return "خطای گواهی TLS؛ verify_tls را بررسی کنید."
        return "جزئیات خطا را در ستون خطا ببینید."

    @app.post("/api/profiles/<path:pid>/extraction-diagnostic")
    def node_extraction_diagnostic(pid: str):
        """Step-by-step check of why a profile does or does not extract."""
        data = load()
        cfg = (data.get("profiles") or {}).get(pid)
        if not isinstance(cfg, dict):
            return jsonify(ok=False, error="پروفایل پیدا نشد."), 404
        stages: list[dict[str, Any]] = []
        # Collected so the ?live=1 path can emit one progress event per stage;
        # the dashboard's live panel is driven entirely by these.
        events: list[dict[str, Any]] = []

        # 10.228: ONE Fetcher for this diagnostic run — page 1's session
        # cookies must reach pages 2-3 exactly like the real extraction.
        run_fetcher = core.Fetcher(dict(load().get("network") or {}))

        def stage(name: str, good: bool, summary: str, **extra: Any) -> None:
            stages.append({"name": name, "ok": good, "summary": summary, **extra})
            events.append({"type": "progress", "name": name,
                           "summary": summary, "ok": good,
                           "done": len(stages)})

        def finish(**payload: Any) -> Any:
            """Return the report, streaming the stage events when ?live=1."""
            report = {"ok": True, **payload}
            if _s(request.args.get("live")) not in ("1", "true", "yes"):
                return jsonify(**report)
            def run() -> Any:
                for event in events:
                    yield event
                yield {"type": "result", "report": report}
            return _ndjson(run())

        url = _s(cfg.get("url"))
        selectors = cfg.get("selectors") or {}
        filled = {k: v for k, v in selectors.items() if _s(v).strip()}
        stage("configuration", bool(url),
              f"آدرس: {url or '—'} · سلکتورهای پرشده: {len(filled)}"
              + ("" if url else " · آدرس خالی است"),
              url=url, selectors=filled,
              pagination=_s(cfg.get("pagination")) or "none")
        if not url:
            return finish(profile=pid, stages=stages, healthy=False,
                      summary="آدرس پروفایل تنظیم نشده است.")

        engine = _s(cfg.get("fetch_engine")) or "auto"
        res = None
        try:
            res = _diag_fetch(cfg, url, engine if engine != "auto" else "requests", fetcher=run_fetcher)
            body = _s(getattr(res, "text", ""))
            stage("network", True,
                  f"HTTP {getattr(res, 'status', 200)} · {len(body):,} بایت "
                  f"· موتور {engine}", bytes=len(body),
                  finalUrl=_s(getattr(res, "url", url)))
        except Exception as exc:  # noqa: BLE001
            stage("network", False, f"دریافت صفحه ناموفق بود: {exc}"[:300])
            return finish(profile=pid, stages=stages, healthy=False,
                      summary="صفحه دریافت نشد؛ موتور یا پروکسی را بررسی کنید.")

        parse_engine = _s(cfg.get("parse_engine")) or "auto"
        try:
            rows, soup, stats = core.parse_html(res.text, res.url, selectors,
                                                parse_engine)
        except Exception as exc:  # noqa: BLE001
            stage("list-extraction", False, f"خطای تجزیهٔ صفحه: {exc}"[:300])
            return finish(profile=pid, stages=stages, healthy=False,
                      summary="صفحه تجزیه نشد.")
        stage("list-extraction", bool(rows),
              f"{len(rows)} محصول با موتور خواندن «{parse_engine}» استخراج شد"
              + ("" if rows else " · هیچ محصولی پیدا نشد"),
              count=len(rows), stats=stats,
              sample=[{"title": _s(r.get("title"))[:80],
                       "price": _s(r.get("price")),
                       "link": _s(r.get("link"))[:120]} for r in rows[:5]])

        # Which configured selector actually matched anything?
        evidence = {}
        for key, css in filled.items():
            try:
                evidence[key] = len(soup.select(css))
            except Exception:  # noqa: BLE001 - invalid CSS is the finding
                evidence[key] = -1
        dead = [k for k, v in evidence.items() if v <= 0]
        stage("selector-evidence", not dead,
              ("همهٔ سلکتورها مطابقت داشتند"
               if not dead else "سلکتورهای بی‌نتیجه: " + "، ".join(dead)),
              matches=evidence)

        # 10.178 — empty/incomplete selectors are repaired on the real page
        # and saved back to the profile's manual selectors (Node twin:
        # ensureListSelectors + the selectors-auto-saved stage of
        # diagnoseExtraction in worker-src/app.ts).
        discovery_reported = False
        try:
            ensured = core.ensure_list_selectors(res.text, _s(getattr(res, "url", url)), selectors)
        except Exception:  # noqa: BLE001 - discovery is best-effort
            ensured = {"selectors": selectors, "method": ""}
        discovered = {k: v for k, v in (ensured.get("discovered") or {}).items()
                      if _s(v).strip()}
        if discovered:
            discovery_reported = True
            method = _s(ensured.get("method")) or "auto"
            saved = core.persist_profile_auto_selectors(pid, discovered) or {}
            selectors = dict(ensured.get("selectors") or selectors)
            cfg["selectors"] = selectors
            filled = {k: v for k, v in selectors.items() if _s(v).strip()}
            stage("selector-discovery", True,
                  f"{len(discovered)} سلکتور با روش «{method}» روی صفحهٔ واقعی "
                  f"پیدا و راستی‌آزمایی شد"
                  + (f" · {int(ensured.get('containerCount') or 0)} کارت محصول"
                     if ensured.get("containerCount") else ""),
                  method=method, selectors=discovered,
                  evidence=ensured.get("evidence") or {},
                  containerCount=int(ensured.get("containerCount") or 0))
            stage("selectors-auto-saved", bool(saved),
                  ("سلکتورهای پیداشده به‌صورت خودکار در تب سلکتورها ذخیره شدند."
                   if saved else
                   "سلکتورها پیدا شدند ولی ذخیرهٔ پروفایل ناموفق بود."),
                  selectors=saved or discovered)
            # Re-read the page with the repaired selectors so this report
            # shows what the NEXT run will actually extract.
            try:
                rows, soup, stats = core.parse_html(res.text, res.url,
                                                    selectors, parse_engine)
                stage("list-extraction", bool(rows),
                      f"با سلکتورهای ترمیم‌شده {len(rows)} محصول استخراج شد",
                      count=len(rows), stats=stats, repaired=True,
                      sample=[{"title": _s(r.get("title"))[:80],
                               "price": _s(r.get("price")),
                               "link": _s(r.get("link"))[:120]} for r in rows[:5]])
            except Exception as exc:  # noqa: BLE001
                stage("list-extraction", False,
                      f"تجزیه با سلکتورهای ترمیم‌شده ناموفق بود: {exc}"[:300],
                      repaired=True)

        if not rows and not discovery_reported:
            # Nothing matched — try the built-in structured readers so the
            # user learns the data is there but the selectors are wrong.
            found = []
            try:
                if core.parse_embedded_catalog(res.text, res.url):
                    found.append("JSON داخل صفحه (JSON-LD / __NEXT_DATA__)")
            except Exception:  # noqa: BLE001
                pass
            try:
                if core.parse_json_ld_product(soup, res.url).get("title"):
                    found.append("JSON-LD Product")
            except Exception:  # noqa: BLE001
                pass
            stage("selector-discovery", bool(found),
                  ("داده در این قالب‌ها پیدا شد: " + "، ".join(found)
                   + " — موتور پارس مناسب را انتخاب کنید."
                   if found else
                   "هیچ دادهٔ ساختاریافته‌ای پیدا نشد؛ احتمالاً صفحه با "
                   "جاوااسکریپت ساخته می‌شود. موتور playwright را امتحان کنید."),
                  formats=found)

        # Detail page: read what the manual selectors give, and fill the
        # EMPTY detail fields from the same real sample (saved to the
        # profile like the list side).
        detail_sel = cfg.get("detail_selectors") or {}
        if rows:
            link = next((_s(r.get("link")) for r in rows if _s(r.get("link"))), "")
            if link:
                try:
                    dres = _diag_fetch(cfg, link, engine if engine != "auto" else "requests", fetcher=run_fetcher)
                    dsoup = core.BeautifulSoup(dres.text, "html.parser")
                    try:
                        ensured_detail = core.ensure_detail_selectors(
                            dsoup, dres.url, detail_sel)
                    except Exception:  # noqa: BLE001
                        ensured_detail = {"selectors": detail_sel, "discovered": {}}
                    discovered_detail = {k: v for k, v in
                                         (ensured_detail.get("discovered") or {}).items()
                                         if _s(v).strip()}
                    if discovered_detail:
                        saved_detail = core.persist_profile_auto_selectors(
                            pid, None, discovered_detail) or {}
                        detail_sel = dict(ensured_detail.get("selectors") or detail_sel)
                        cfg["detail_selectors"] = detail_sel
                        stage("selectors-auto-saved", bool(saved_detail),
                              (f"{len(discovered_detail)} سلکتور خالی صفحهٔ "
                               "جزئیات خودکار پیدا و ذخیره شد: "
                               + "، ".join(discovered_detail))
                              if saved_detail else
                              "سلکتورهای جزئیات پیدا شدند ولی ذخیره ناموفق بود.",
                              selectors=saved_detail or discovered_detail,
                              scope="detail")
                    fields = core.parse_detail_fields(dsoup, dres.url, detail_sel)
                    got = {k: v for k, v in fields.items() if _s(v).strip()}
                    stage("detail-extraction", bool(got),
                          f"{len(got)} فیلد از صفحهٔ جزئیات خوانده شد",
                          fields=list(got))
                except Exception as exc:  # noqa: BLE001
                    stage("detail-extraction", False,
                          f"صفحهٔ جزئیات خوانده نشد: {exc}"[:240])

        # 10.193: pagination diagnostic — try real next pages with configured pagination
        try:
            _pag_kind = _s(cfg.get("pagination") or "query")
            _pag_value = _s(cfg.get("page_value") or "page")
            _is_auto_pag = _pag_kind.lower() in ("auto", "automatic", "detect", "")
            # 10.225: pages=0 is the dashboard's "automatic" — the stage still
            # probes 3 real pages instead of collapsing to 2.
            try:
                _pages_cfg = int(cfg.get("pages") or 0)
            except (TypeError, ValueError):
                _pages_cfg = 0
            _diag_pages = 3 if _pages_cfg >= 3 or _pages_cfg <= 0 else 2
            if _pag_kind.lower() in ("none", "scroll"):
                stage("pagination", True, "صفحه‌بندی روی scroll/none است — تک‌صفحه‌ای و نیازی به صفحه بعد نیست", kind=_pag_kind, pages=1)
            elif not rows:
                stage("pagination", False, "چون صفحهٔ اول محصولی نداشت، صفحه‌بندی قابل آزمون نیست", kind=_pag_kind, value=_pag_value)
            else:
                _det_kind = ""
                _det_val = ""
                if _is_auto_pag:
                    try:
                        _dk, _dv = core.detect_pagination(soup, url)
                        if _dk and _dk not in ("none", "scroll"):
                            _det_kind, _det_val = _dk, _dv
                    except Exception:
                        pass
                eff_kind = _det_kind if _is_auto_pag and _det_kind else _pag_kind
                eff_value = _det_val if _is_auto_pag and _det_val else _pag_value
                eff_norm = (eff_kind or "query").strip().lower()
                pag_ok = True
                pag_details: list[str] = []
                pag_next_url = ""
                # 10.225: mirror the real run — a page that only replays
                # products of earlier pages must fail the stage.
                _pag_seen: set[str] = set()
                for _r in rows or []:
                    try:
                        _pag_seen.add(core.product_key(_r))
                    except Exception:
                        pass
                # Prepare next_url if pagination is next (from first page)
                if eff_norm in ("next", "next_selector", "link"):
                    try:
                        _nxt = None
                        # 10.225: profile selector first, then the defaults.
                        for _sel in ([eff_value.strip()] if eff_value.strip() else []) + ['a[rel="next"]', 'a.next', '.pagination a.next', '.pagination .next a', '.pager a.next', 'a[aria-label*="next" i]', 'a[aria-label*="بعدی" i]']:
                            try:
                                _nxt = soup.select_one(_sel)
                                if _nxt and _nxt.get("href"):
                                    break
                            except Exception:
                                continue
                        if _nxt and _nxt.get("href"):
                            from urllib.parse import urljoin as _urljoin
                            _candidate = _urljoin(getattr(res, "url", url), _nxt.get("href"))
                            pag_next_url = "" if _candidate.rstrip("/") == getattr(res, "url", url).rstrip("/") else _candidate
                    except Exception:
                        pag_next_url = ""
                # 10.227: fetch continuation pages exactly like the real run —
                # ONE shared Fetcher (session cookies persist) walking the same
                # engine chain (learned master first, anti-bot reorder applied).
                # Sites like emalls.ir serve a duplicate-page fallback to some
                # request fingerprints; the real run now retries the same page
                # with the other engines, so the test must too.
                _pag_fetcher = run_fetcher
                _pag_master = _s(cfg.get("fetch_engine_master") or "")
                _pag_req = _s(cfg.get("fetch_engine") or "auto")
                _pag_chain = core.engine_try_order(
                    _pag_master, _pag_req if _pag_req in core.KNOWN_ENGINES else "", "auto")
                try:
                    _pag_chain = core._prefer_anti_bot_order(url, _pag_chain)
                except Exception:
                    pass
                if engine in core.KNOWN_ENGINES:
                    _pag_chain = [engine] + [e for e in _pag_chain if e != engine]

                def _pag_fetch_new(target: str, seen: set) -> tuple:
                    """Fetch `target` through the real-run engine chain until one
                    engine returns at least one NEW product."""
                    attempts: list[str] = []
                    for _eng in _pag_chain:
                        if _eng in {"playwright", "selenium"}:
                            continue
                        if _eng != "requests" and not core.fetch_engine_installed(_eng):
                            continue
                        try:
                            _r = _pag_fetcher.get(target, engine=_eng)
                        except Exception as _exc:
                            attempts.append(f"{_eng}: {_exc}")
                            continue
                        try:
                            _rr, _rs, _st = core.parse_html(_r.text, _r.url, selectors, parse_engine)
                        except Exception as _exc:
                            attempts.append(f"{_eng}: تجزیه ناموفق {_exc}")
                            continue
                        _fresh = 0
                        for _row in _rr:
                            try:
                                if core.product_key(_row) not in seen:
                                    _fresh += 1
                            except Exception:
                                _fresh += 1
                        attempts.append(f"{_eng}: HTTP {_r.status} · {len(_rr)} محصول · {_fresh} تازه")
                        if _fresh > 0:
                            return _r, _rr, _rs, _eng, attempts
                    return None, [], None, "", attempts

                # Try pages 2..diag_pages
                for _pn in range(2, _diag_pages + 1):
                    if eff_norm in ("next", "next_selector", "link"):
                        if not pag_next_url:
                            pag_ok = False
                            pag_details.append(f"صفحهٔ {_pn}: next پیدا نشد")
                            break
                        _cur_url = pag_next_url
                        pag_next_url = ""
                    elif eff_norm in ("none", "scroll"):
                        pag_ok = False
                        pag_details.append(f"صفحهٔ {_pn}: صفحه‌بندی {eff_kind} تک‌صفحه است")
                        break
                    else:
                        try:
                            _cur_url = core.page_url(url, _pn, eff_kind, eff_value)
                        except Exception as _e:
                            pag_ok = False
                            pag_details.append(f"صفحهٔ {_pn}: خطای ساخت URL با {eff_kind}:{eff_value} — {_e}")
                            break
                        if _cur_url == url:
                            pag_ok = False
                            pag_details.append(f"صفحهٔ {_pn}: URL تکراری ({_cur_url[:80]}) — الگو نادرست")
                            break
                    # Fetch next page — engine chain with duplicate fallback
                    _pres, _prows, _psoup, _pag_engine, _pag_attempts = _pag_fetch_new(_cur_url, _pag_seen)
                    if _pres is None:
                        pag_ok = False
                        _why = "؛ ".join(_pag_attempts[:4]) if _pag_attempts else "دریافتی انجام نشد"
                        pag_details.append(f"صفحهٔ {_pn}: هیچ موتوری محصول تازه نیاورد — {_why}"[:400])
                        break
                    if len(_pag_attempts) > 1:
                        pag_details.append(f"صفحهٔ {_pn}: پاسخ تکراری با موتورهای اول؛ موتور {_pag_engine} محصول تازه آورد")
                    _page_new = 0
                    for _r in _prows:
                        try:
                            _k = core.product_key(_r)
                        except Exception:
                            _k = _s(_r.get("url") or _r.get("title"))
                        if _k and _k not in _pag_seen:
                            _pag_seen.add(_k)
                            _page_new += 1
                    if _page_new == 0:
                        # 10.225: same verdict as the real scrape — a page
                        # that only replays earlier products is broken paging.
                        pag_ok = False
                        pag_details.append(f"صفحهٔ {_pn} هیچ محصول تازه‌ای نداشت ({len(_prows)} محصول، همه تکراری) — سایت الگوی {eff_kind}:{eff_value} را نادیده می‌گیرد (URL: {_cur_url[:60]})")
                        break
                    pag_details.append(f"صفحهٔ {_pn}: {_page_new} محصول تازه (از {len(_prows)}) ✓")
                    # Prepare next for next iteration if next pagination
                    if eff_norm in ("next", "next_selector", "link"):
                        try:
                            _nxt2 = None
                            # 10.225: profile selector first, then defaults.
                            for _sel in ([eff_value.strip()] if eff_value.strip() else []) + ['a[rel="next"]', 'a.next', '.pagination a.next']:
                                try:
                                    _nxt2 = _psoup.select_one(_sel)
                                    if _nxt2 and _nxt2.get("href"):
                                        break
                                except Exception:
                                    continue
                            if _nxt2 and _nxt2.get("href"):
                                from urllib.parse import urljoin as _urljoin
                                _cand2 = _urljoin(_pres.url, _nxt2.get("href"))
                                pag_next_url = "" if _cand2.rstrip("/") == _pres.url.rstrip("/") else _cand2
                            else:
                                pag_next_url = ""
                        except Exception:
                            pag_next_url = ""
                stage("pagination", pag_ok,
                      ("صفحه‌بندی سالم: " + "، ".join(pag_details) if pag_ok else "خطای صفحه‌بندی: " + "؛ ".join(pag_details)),
                      kind=eff_kind, value=eff_value, pages=_diag_pages, details=pag_details, auto=_is_auto_pag)
        except Exception as _pag_exc:
            stage("pagination", False, f"خطای تست صفحه‌بندی: {_pag_exc}"[:300])

        healthy = all(s["ok"] for s in stages)
        return finish(profile=pid, stages=stages, healthy=healthy,
                  summary=("همه‌چیز سالم است."
                           if healthy else
                           "مشکل در: " + "، ".join(
                               s["name"] for s in stages if not s["ok"])))

    @app.route("/api/profiles/<path:pid>/sync", methods=["GET", "POST", "PUT", "PATCH"])
    def node_profile_sync(pid: str):
        body = _body()
        targets = []
        target = _s(body.get("target")) or "both"
        if target in ("woo", "both"):
            targets.append("woo")
        if target in ("basalam", "bsl", "both"):
            targets.append("basalam")
        try:
            result = core.start_profile_dispatch(pid, {
                "destinations": targets,
                "products": body.get("products") or [],
                "woo_status": _s(body.get("wooStatus")) or "draft",
            })
        except Exception as exc:  # noqa: BLE001 - surfaced to the UI
            return jsonify(ok=False, error=str(exc)), 400
        return ok(**(result if isinstance(result, dict) else {}))

    @app.get("/api/profile-stats")
    def node_profile_stats():
        data = load()
        stats: dict[str, Any] = {}
        items: list[dict[str, Any]] = []
        for name, cfg in (data.get("profiles") or {}).items():
            if not isinstance(cfg, dict):
                continue
            rows = [row for row in cfg.get("saved_products") or [] if isinstance(row, dict)]
            woo_mapped = sum(bool(row.get("remote_woo_id") or row.get("woo_id")) for row in rows)
            basalam_mapped = sum(bool(row.get("remote_basalam_id") or row.get("basalam_id")) for row in rows)
            last_product = max((_s(row.get("updated_at") or row.get("scraped_at")) for row in rows),
                               default="")
            item = {"id": name, "name": _s(cfg.get("name")) or name,
                    "products": len(rows), "woo_mapped": woo_mapped,
                    "basalam_mapped": basalam_mapped,
                    "last_product_at": last_product or None,
                    "lastRunAt": cfg.get("last_run_at")}
            items.append(item)
            stats[name] = {"products": len(rows), "wooMapped": woo_mapped,
                           "basalamMapped": basalam_mapped,
                           "lastRunAt": cfg.get("last_run_at")}
        return ok(items=items, stats=stats)

    # ── jobs / queue ─────────────────────────────────────────────────────
    @app.get("/api/jobs")
    def node_jobs():
        limit = min(200, _int(request.args.get("limit"), 50) or 50)
        return ok(jobs=[task_to_job(t) for t in live_tasks()[:limit]],
                  processor={"mode": "inline"})

    @app.get("/api/jobs/<job_id>")
    def node_job_get(job_id: str):
        for task in live_tasks():
            if _s(task.get("id")) == job_id:
                return ok(job=task_to_job(task))
        return jsonify(ok=False, error="Job not found"), 404

    @app.post("/api/jobs/<job_id>/stop")
    def node_job_stop(job_id: str):
        with core.LIVE_TASK_LOCK:
            task = core.LIVE_TASKS.get(job_id) or core.live_task_read(job_id)
            if not task:
                return jsonify(ok=False, error="Job not found"), 404
            task["cancel_requested"] = True
            task["updated_at"] = int(time.time())
            owner = task.get("pid")
            live_here = job_id in core.LIVE_TASKS and owner == os.getpid()
            other_alive = bool(owner) and owner != os.getpid() and \
                core._pid_alive(int(owner))
            forced = False
            if live_here or other_alive:
                task["step"] = "درخواست توقف ثبت شد"
            else:
                # Orphan from a previous process: no worker will ever read the
                # flag, so finish it here instead of leaving it "running".
                task["status"] = "cancelled"
                task["step"] = "وظیفهٔ رهاشده متوقف شد"
                task["error"] = task.get("error") or \
                    "این وظیفه پس از قطع سرویس رها شده بود"
                forced = True
            core.LIVE_TASKS[job_id] = task
            core.live_task_disk_write(task)
        return ok(job=task_to_job(task), forced=forced)

    @app.post("/api/jobs/priority")
    def node_jobs_priority():
        ids = _body().get("ids") or []
        return ok(count=len(ids), priorities=[_s(x) for x in ids])

    @app.post("/api/runs/priority")
    def node_runs_priority():
        kinds = _body().get("kinds") or []
        return ok(count=len(kinds), priorities=[_s(x) for x in kinds])

    @app.get("/api/activity")
    def node_activity():
        return ok(items=[{
            "id": _s(t.get("id")), "title": _s(t.get("title")),
            "status": _s(t.get("status")), "step": _s(t.get("step")),
            "progress": _int(t.get("progress")), "at": _iso(t.get("updated_at")),
        } for t in live_tasks()[:50]])

    @app.get("/api/queue-watchdog")
    def node_queue_watchdog():
        settings = load().get("ui_settings") or {}
        watchdog = settings.get("watchdog") if isinstance(settings.get("watchdog"), dict) else {}
        stall_after = max(60, _int(watchdog.get("stallAfter"), 300))
        now = time.time()
        running = [t for t in live_tasks() if _s(t.get("status")) in ("waiting", "running")]
        stalled = [task_to_job(t) for t in running if now - _num(t.get("updated_at")) > stall_after]
        return ok(watchdog={"running": len(running), "stalled": len(stalled),
                            "stallAfter": stall_after}, stalled=stalled)

    # ── selector tooling ─────────────────────────────────────────────────
    @app.post("/api/test-selector")
    def node_test_selector():
        body = _body()
        url, selector = _s(body.get("url")), _s(body.get("selector"))
        kind = _s(body.get("type")) or "text"
        if not url or not selector:
            return jsonify(ok=False, error="آدرس و سلکتور لازم است."), 400
        try:
            result = core.preview_selector(url, selector, kind)
        except AttributeError:
            try:
                html = core.fetch_html(url)
                matches = core.select_all(html, selector)
                result = {"count": len(matches), "samples": [_s(m)[:200] for m in matches[:10]]}
            except Exception as exc:  # noqa: BLE001
                return jsonify(ok=False, error=str(exc)), 400
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400
        return ok(**(result if isinstance(result, dict) else {"result": result}))

    @app.route("/api/suggest-selectors", methods=["GET", "POST", "PUT"])
    def node_suggest_selectors():
        body = _body()
        url = _s(body.get("url") or request.args.get("url"))
        if not url:
            return jsonify(ok=False, error="آدرس لازم است."), 400
        mode = _s(body.get("mode") or request.args.get("mode")).lower() or "all"
        try:
            result = core.auto_selectors(url, mode)
        except AttributeError:
            return ok(selectors={}, note="پیشنهاد خودکار در این نسخه در دسترس نیست.")
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400
        return ok(**(result if isinstance(result, dict) else {"selectors": result}))

    @app.post("/api/source-test")
    def node_source_test():
        body = _body()
        url = _s(body.get("url"))
        if not url:
            return jsonify(ok=False, error="آدرس لازم است."), 400
        started = time.time()
        try:
            core.public_http_url(url)
            html = core.fetch_html(url) if hasattr(core, "fetch_html") else ""
            return ok(status=200, bytes=len(html or ""), ms=int((time.time() - started) * 1000))
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400

    @app.post("/api/test-connection/<target>")
    def node_test_connection(target: str):
        """Perform the same lightweight authenticated probes as the Node UI."""
        started = time.monotonic()
        started_at = _iso()
        body = _body()
        data = load()
        vault = connections_payload(data)

        def elapsed() -> int:
            return int((time.monotonic() - started) * 1000)

        def config_error(message: str, recommendations: list[str]):
            return jsonify(ok=False, target=target, startedAt=started_at,
                           durationMs=elapsed(), phase="configuration", error=message,
                           recommendations=recommendations)

        def safe_json(response: Any) -> Any:
            try:
                value = response.json()
            except Exception:  # noqa: BLE001
                value = _s(getattr(response, "text", ""))[:100000]
            return value

        def redact(value: Any, hidden: list[str]) -> Any:
            if isinstance(value, str):
                for secret in hidden:
                    if secret:
                        value = value.replace(secret, "[پنهان]")
                return value
            if isinstance(value, list):
                return [redact(item, hidden) for item in value]
            if isinstance(value, dict):
                return {key: ("[پنهان]" if re.search(
                    r"authorization|api[_-]?key|token|secret|password|consumer", key, re.I)
                    else redact(item, hidden)) for key, item in value.items()}
            return value

        try:
            if target in {"woo", "woocommerce"}:
                cfg = vault.get("woo") or {}
                site, key, secret = _s(cfg.get("url")), _s(cfg.get("key")), _s(cfg.get("secret"))
                if not site or not key or not secret:
                    return config_error("آدرس فروشگاه، Consumer Key و Consumer Secret را کامل کنید.", [
                        "آدرس باید با https:// شروع شود.",
                        "کلید خواندن/نوشتن را از ووکامرس ← تنظیمات ← پیشرفته ← REST API بسازید."])
                endpoint = core.public_http_url(site).rstrip("/") + \
                    "/wp-json/wc/v3/products?per_page=1&status=any&_fields=id,name,status"
                response = core.outbound_request("GET", endpoint, auth=(key, secret),
                                                 headers={"Accept": "application/json",
                                                          "User-Agent": core.USER_AGENT}, timeout=60)
                raw = safe_json(response)
                sample = raw[0] if isinstance(raw, list) and raw and isinstance(raw[0], dict) else {}
                return jsonify(ok=bool(response.ok), target="woo", service="WooCommerce REST API",
                               startedAt=started_at, durationMs=elapsed(),
                               request={"method": "GET", "endpoint": endpoint,
                                        "authentication": "Basic Auth (کلید در گزارش نمایش داده نمی‌شود)"},
                               http={"status": response.status_code,
                                     "contentType": response.headers.get("content-type", ""),
                                     "finalUrl": getattr(response, "scraper4_final_url", endpoint),
                                     "networkMode": getattr(response, "scraper4_transport", "direct")},
                               summary={"siteUrl": site, "sampleProductId": sample.get("id"),
                                        "sampleProductName": sample.get("name"),
                                        "sampleProductStatus": sample.get("status")},
                               recommendations=(["اتصال معتبر است و فهرست سبک محصولات ووکامرس پاسخ داد."]
                                                if response.ok else
                                                [f"پاسخ HTTP {response.status_code} موفق نبود."]),
                               raw=redact(raw, [key, secret]))
            if target in {"basalam", "bsl"}:
                cfg = vault.get("basalam") or {}
                shops = cfg.get("shops") if isinstance(cfg.get("shops"), list) else []
                index = _int(body.get("shopIndex"), -1)
                selected = shops[index] if 0 <= index < len(shops) and isinstance(shops[index], dict) else cfg
                token = _s(selected.get("token") or cfg.get("token"))
                expected_vendor = _s(selected.get("vendorId") or cfg.get("vendorId"))
                if not token:
                    return config_error("توکن باسلام وارد نشده است.", [
                        "از پنل توسعه‌دهندگان باسلام یک توکن معتبر بسازید.",
                        "توکن را بدون Bearer و بدون فاصله وارد کنید."])
                api = _s(cfg.get("api") or (data.get("basalam") or {}).get("api_base_url")) \
                    or "https://openapi.basalam.com"
                client_mode = core.normalize_basalam_client_mode(cfg.get("clientMode"))
                endpoint = core.basalam_api_url("/v1/users/me", {"api_base_url": api})
                active_cfg = dict(data.get("basalam") or {})
                active_cfg.update(token=token, api_base_url=api, client_mode=client_mode)
                if expected_vendor:
                    active_cfg["vendor_id"] = _int(expected_vendor)
                with core.basalam_use_cfg(active_cfg):
                    raw, used_client = core.basalam_strategy(
                        lambda: core.basalam_client().get_current_user_sync(),
                        lambda: core.basalam_api_request("GET", "/v1/users/me"),
                    )
                if hasattr(raw, "model_dump"):
                    try:
                        raw = raw.model_dump(mode="json")
                    except TypeError:
                        raw = raw.model_dump()
                user = raw.get("data", raw) if isinstance(raw, dict) else {}
                user = user if isinstance(user, dict) else {}
                vendor = user.get("vendor") if isinstance(user.get("vendor"), dict) else {}
                vendor_id = _s(vendor.get("id") or user.get("vendor_id"))
                autofill: dict[str, Any] = {}
                if vendor_id:
                    autofill["vendorId"] = vendor_id
                if _s(vendor.get("title") or user.get("vendor_title")):
                    autofill["name"] = _s(vendor.get("title") or user.get("vendor_title"))
                prep = _int(vendor.get("preparation_days") or vendor.get("default_preparation_days"))
                if prep > 0:
                    autofill["preparationDays"] = prep
                labels = {"api": "REST API مستقیم", "sdk": "SDK رسمی"}
                return jsonify(ok=True, target="basalam",
                               service="Basalam " + labels.get(used_client, used_client),
                               clientMode=client_mode, client=used_client,
                               startedAt=started_at, durationMs=elapsed(),
                               request={"method": "GET", "endpoint": endpoint,
                                        "authentication": "Bearer Token (توکن در گزارش نمایش داده نمی‌شود)",
                                        "shopIndex": index if selected is not cfg else None},
                               http={"status": 200, "contentType": "application/json",
                                     "finalUrl": endpoint, "networkMode": used_client},
                               summary={"userId": user.get("id"),
                                        "userName": user.get("name") or user.get("username"),
                                        "vendorId": vendor_id or None,
                                        "vendorTitle": vendor.get("title") or user.get("vendor_title"),
                                        "configuredVendorId": expected_vendor or None,
                                        "vendorIdMatches": (None if not expected_vendor or not vendor_id else
                                                            expected_vendor == vendor_id),
                                        "autofill": autofill},
                               recommendations=["توکن با مسیر «" +
                                                labels.get(used_client, used_client) +
                                                "» معتبر پاسخ داد."],
                               raw=redact(raw, [token]))
            if target == "ai":
                provider, model = _s(body.get("provider")), _s(body.get("model"))
                prompt = _s(body.get("prompt")) or "Reply with exactly: SCRAPER4_OK"
                if body.get("baseUrl") and body.get("apiKey"):
                    endpoint = core.ai_endpoint(_s(body.get("baseUrl")))
                    model = model or _s(body.get("model"))
                    if not model:
                        return config_error("نام مدل هوش مصنوعی وارد نشده است.", ["نام دقیق مدل را وارد کنید."])
                    response = core.outbound_request("POST", endpoint,
                        headers={"Authorization": "Bearer " + _s(body.get("apiKey")),
                                 "Content-Type": "application/json", "User-Agent": core.USER_AGENT},
                        json={"model": model, "messages": [{"role": "user", "content": prompt}]},
                        timeout=90)
                    raw = safe_json(response)
                    text = core.ai_extract_text(raw)
                    if not response.ok or not text:
                        raise ValueError(f"AI HTTP {response.status_code}: {_s(raw)[:500]}")
                else:
                    if not model:
                        model = _s((data.get("ai") or {}).get("model"))
                    if not provider:
                        provider = _s((data.get("ai") or {}).get("provider"))
                    if not model:
                        return config_error("ارائه‌دهنده و مدل هوش مصنوعی تنظیم نشده است.", [
                            "یک ارائه‌دهنده و حداقل یک مدل را ذخیره کنید."])
                    text = core.ai_chat(prompt, provider, re.sub(r"::k\d+$", "", model))
                return ok(target="ai", service="AI Chat Completions", startedAt=started_at,
                          durationMs=elapsed(), provider=provider, model=model, prompt=prompt,
                          text=text, recommendations=["مدل پاسخ معتبر برگرداند."])
            return jsonify(ok=False, target=target, startedAt=started_at,
                           durationMs=elapsed(), error="نوع اتصال ناشناخته است.")
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, target=target, startedAt=started_at,
                           durationMs=elapsed(), phase="network", error=str(exc)[:1200],
                           recommendations=["دسترسی اینترنت و آدرس سرویس را بررسی کنید.",
                                            "مجوز کلید یا توکن را بررسی و دوباره آزمایش کنید."])

    @app.get("/api/categories/<target>")
    def node_categories(target: str):
        key = _s(target).lower()
        try:
            if key in {"woo", "woocommerce"}:
                rows: list[dict[str, Any]] = []
                for page in range(1, 101):
                    batch = core.woo_request(
                        "GET", f"products/categories?per_page=100&page={page}"
                    ).json()
                    if not isinstance(batch, list):
                        break
                    rows.extend(x for x in batch if isinstance(x, dict))
                    if len(batch) < 100:
                        break
                items = [{"id": row.get("id"), "name": _s(row.get("name")),
                          "parent": row.get("parent", 0), "count": row.get("count", 0)}
                         for row in rows]
                return ok(items=items, total=len(items), target="woo")
            if key in {"basalam", "bsl"}:
                rows = core.ai_load_category_rows()
                items = [{"id": row.get("id"), "name": _s(row.get("name")),
                          "path": _s(row.get("path") or row.get("name")),
                          "parentId": row.get("parentId"),
                          "leaf": row.get("leaf", True)}
                         for row in rows if isinstance(row, dict)]
                return ok(items=items, total=len(items), target="basalam")
            return jsonify(ok=False, error="مقصد دسته‌بندی نامعتبر است."), 400
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400

    # ── backup / settings transfer ───────────────────────────────────────
    # ── settings backup bundle ───────────────────────────────────────────
    # The dashboard speaks a "settings bundle": {files: {"<name>.json":
    # {size, b64}}}. It decodes each file, lets the user tick which sections
    # to restore, re-encodes only those, and posts the bundle back. The old
    # implementation exported the raw data dict and imported a handful of
    # flat keys, so the two never lined up: the file the UI downloaded was
    # not a bundle, and a real bundle posted back matched no key at all —
    # import reported success while writing nothing. Both sides now use the
    # bundle format, keyed by the file names in SETTINGS_SECTIONS.

    def _b64_file(value: Any) -> dict[str, Any]:
        raw = json.dumps(value, ensure_ascii=False).encode("utf-8")
        return {"size": len(raw), "b64": base64.b64encode(raw).decode("ascii")}

    def _read_file(meta: Any) -> Any:
        """Decode one bundle entry; None means unreadable (UI skips it)."""
        if not isinstance(meta, dict) or not meta.get("b64"):
            return None
        try:
            return json.loads(base64.b64decode(meta["b64"]).decode("utf-8"))
        except Exception:  # noqa: BLE001 - a corrupt entry must not abort
            return None

    def _bundle_files(data: dict[str, Any]) -> dict[str, Any]:
        """Split the data file into the per-file layout the UI expects."""
        profiles = data.get("profiles") or {}
        settings_only, products = {}, {}
        for name, cfg in profiles.items():
            if not isinstance(cfg, dict):
                continue
            rows = cfg.get("saved_products") or []
            settings_only[name] = {k: v for k, v in cfg.items()
                                   if k != "saved_products"}
            settings_only[name].setdefault("name", name)
            if rows:
                products[name] = rows
        ai = data.get("ai") or {}
        connections = {
            "woocommerce": data.get("woocommerce") or {},
            "basalam": data.get("basalam") or {},
            "ai": {
                "providers": data.get("ai_providers") or {},
                "candidates": data.get("ai_candidates") or [],
                "master": data.get("ai_master") or "",
                "settings": ai,
            },
            "notifications": data.get("notifications") or {},
            "network": data.get("network") or {},
        }
        files = {
            "profiles.json": settings_only,
            "profile_products.json": products,
            "connections.json": connections,
            "category_learning.json": data.get("category_learning") or [],
            "autoreply_rules.json": data.get("autoreply_rules") or [],
            "autoreply_log.json": data.get("autoreply_log") or [],
            "autoreply_state.json": data.get("autoreply_state") or {},
            "render_settings.json": data.get("render_settings") or {},
            "notification_settings.json": data.get("notification_settings") or {},
            "digest_state.json": data.get("digest_state") or {},
            "ai_votes.json": data.get("ai_votes") or {},
            "ai_providers.json": data.get("ai_providers") or {},
            "ai_candidates.json": data.get("ai_candidates") or [],
            "sync_state.json": data.get("sync_state") or {},
            "remote_map.json": data.get("remote_map") or {},
        }
        return {name: _b64_file(value) for name, value in files.items()}

    @app.get("/api/settings-export")
    def node_settings_export():
        data = load()
        files = _bundle_files(data)
        bundle = {
            "format": "settings-bundle",
            "app": "scraper4-python",
            "version": core.APP_VERSION,
            "exported_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "host": _s(request.host),
            "total_files": len(files),
            "files": files,
        }
        return Response(
            json.dumps(bundle, ensure_ascii=False, indent=2),
            mimetype="application/json",
            headers={"content-disposition":
                     'attachment; filename="scraper4-settings.json"'},
        )

    @app.post("/api/settings-import")
    def node_settings_import():
        body = _body()
        files = body.get("files") if isinstance(body.get("files"), dict) else None
        data = load()
        counts = {"profiles": 0, "products": 0, "states": 0, "categories": 0}
        applied: list[str] = []
        skipped: list[str] = []

        if files is None:
            # Accept a raw data dump too (older exports and hand-made files),
            # so a legitimate file is never silently rejected.
            payload = (body.get("settings")
                       if isinstance(body.get("settings"), dict) else body)
            if not isinstance(payload, dict) or not payload:
                return jsonify(ok=False, error="فایل تنظیمات نامعتبر است."), 400
            recognised = False
            # Profiles need the same shape handling as a bundle: a raw Node
            # export stores them as an array (or a dict) of Node-shaped
            # objects, which must be converted, not written verbatim.
            raw_profiles = payload.get("profiles")
            if isinstance(raw_profiles, list):
                raw_profiles = {
                    _s(p.get("id") or p.get("name")): p
                    for p in raw_profiles if isinstance(p, dict)
                }
            if isinstance(raw_profiles, dict) and raw_profiles:
                existing = data.get("profiles") or {}
                for name, cfg in raw_profiles.items():
                    if not isinstance(cfg, dict) or not _s(name):
                        continue
                    name = _s(name)
                    keep = (existing.get(name) or {}).get("saved_products") or []
                    if _is_node_profile(cfg):
                        merged = node_to_profile({**cfg, "id": name},
                                                 existing.get(name) or {})
                        merged.setdefault("saved_products", keep)
                    else:
                        merged = dict(cfg)
                        merged.setdefault("saved_products", keep)
                    existing[name] = merged
                    counts["profiles"] += 1
                data["profiles"] = existing
                recognised = True
                applied.append("profiles")
            for key in ("woocommerce", "basalam", "network", "ai",
                        "ai_providers", "ai_candidates", "category_learning",
                        "autoreply_rules", "ai_votes"):
                if key in payload and isinstance(
                        payload[key], type(data.get(key, payload[key]))):
                    data[key] = payload[key]
                    recognised = True
                    applied.append(key)
                    counts["states"] += 1
            if not recognised:
                return jsonify(
                    ok=False,
                    error="در این فایل هیچ بخش قابل‌شناسایی پیدا نشد؛ "
                          "فایل بکاپ این برنامه را انتخاب کنید."), 400
            save(data)
            return ok(imported=counts, applied=applied, format="raw")

        # ---- settings bundle -------------------------------------------
        decoded = {name: _read_file(meta) for name, meta in files.items()}
        unreadable = [n for n, v in decoded.items() if v is None]
        decoded = {n: v for n, v in decoded.items() if v is not None}
        if not decoded:
            return jsonify(
                ok=False,
                error="هیچ فایل قابل خواندنی در بسته نبود."), 400

        profiles = data.get("profiles") or {}
        incoming_profiles = decoded.get("profiles.json")
        # A bundle may carry either shape: this app's own storage schema
        # (display_name / fetch_engine / profile_rules) or the Node dashboard
        # schema (name / extractionEngine / titleSuffix / priceMode). Writing a
        # Node-shaped entry straight into storage is what made the dropdown
        # show the id instead of the name and silently dropped the engine,
        # title suffix and price rules — none of those keys exist in the
        # Python schema. Detect the shape per entry and convert when needed.
        if isinstance(incoming_profiles, list):
            # Node exports sometimes use an array keyed by an inner id.
            incoming_profiles = {
                _s(p.get("id") or p.get("name")): p
                for p in incoming_profiles if isinstance(p, dict)
            }
        if isinstance(incoming_profiles, dict):
            for name, cfg in incoming_profiles.items():
                if not isinstance(cfg, dict):
                    continue
                name = _s(name)
                if not name:
                    continue
                keep = (profiles.get(name) or {}).get("saved_products") or []
                if _is_node_profile(cfg):
                    merged = node_to_profile({**cfg, "id": name},
                                             profiles.get(name) or {})
                else:
                    merged = dict(cfg)
                merged["saved_products"] = keep
                profiles[name] = merged
                counts["profiles"] += 1
            applied.append("profiles.json")
        if isinstance(decoded.get("profile_products.json"), dict):
            for name, rows in decoded["profile_products.json"].items():
                if not isinstance(rows, list):
                    continue
                if name not in profiles:
                    # Products with no profile row would be invisible.
                    skipped.append(f"محصولات «{name}» بدون تنظیمات پروفایل")
                    continue
                profiles[name]["saved_products"] = rows
                counts["products"] += len(rows)
            applied.append("profile_products.json")
        data["profiles"] = profiles

        conn = decoded.get("connections.json")
        if isinstance(conn, dict):
            if isinstance(conn.get("woocommerce") or conn.get("woo"), dict):
                data["woocommerce"] = conn.get("woocommerce") or conn.get("woo")
                counts["states"] += 1
            if isinstance(conn.get("basalam"), dict):
                data["basalam"] = conn["basalam"]
                counts["states"] += 1
            if isinstance(conn.get("network"), dict):
                data["network"] = conn["network"]
                counts["states"] += 1
            ai_block = conn.get("ai")
            if isinstance(ai_block, dict):
                if isinstance(ai_block.get("providers"), (dict, list)):
                    data["ai_providers"] = ai_block["providers"]
                if isinstance(ai_block.get("candidates"), list):
                    data["ai_candidates"] = ai_block["candidates"]
                if _s(ai_block.get("master")):
                    data["ai_master"] = _s(ai_block["master"])
                if isinstance(ai_block.get("settings"), dict):
                    data["ai"] = ai_block["settings"]
                counts["states"] += 1
            if isinstance(conn.get("notifications"), dict):
                data["notifications"] = conn["notifications"]
                counts["states"] += 1
            applied.append("connections.json")

        if "category_learning.json" in decoded:
            rows = decoded["category_learning.json"]
            if isinstance(rows, (list, dict)):
                data["category_learning"] = rows
                counts["categories"] = len(rows)
                applied.append("category_learning.json")

        # Remaining files map 1:1 onto top-level keys.
        simple = {
            "autoreply_rules.json": "autoreply_rules",
            "autoreply_log.json": "autoreply_log",
            "autoreply_state.json": "autoreply_state",
            "render_settings.json": "render_settings",
            "notification_settings.json": "notification_settings",
            "digest_state.json": "digest_state",
            "ai_votes.json": "ai_votes",
            "ai_providers.json": "ai_providers",
            "ai_candidates.json": "ai_candidates",
            "sync_state.json": "sync_state",
            "remote_map.json": "remote_map",
        }
        for fname, key in simple.items():
            if fname in decoded and decoded[fname] not in (None, {}, []):
                data[key] = decoded[fname]
                counts["states"] += 1
                applied.append(fname)

        save(data)
        history = load()
        rows = history.get("import_history")
        if not isinstance(rows, list):
            rows = []
        rows.append({"at": int(time.time()), "kind": "settings-bundle",
                     "files": applied, "counts": counts})
        history["import_history"] = rows[-50:]
        save(history)
        return ok(imported=counts, applied=applied, skipped=skipped,
                  unreadable=unreadable, format="settings-bundle")

    @app.post("/api/import-php")
    def node_import_php():
        body = _body()
        source = body.get("profiles")
        if isinstance(source, str):
            try:
                source = json.loads(source)
            except ValueError:
                return jsonify(ok=False, error="JSON نامعتبر است."), 400
        if not isinstance(source, dict):
            return jsonify(ok=False, error="ساختار پروفایل‌ها نامعتبر است."), 400
        data = load()
        profiles = data.get("profiles") or {}
        for pid, raw in source.items():
            if isinstance(raw, dict):
                profiles[_s(pid)] = node_to_profile({**raw, "id": pid}, profiles.get(_s(pid)) or {})
        data["profiles"] = profiles
        save(data)
        return ok(imported=len(source),
                  profiles=[profile_to_node(n, c) for n, c in profiles.items()])

    @app.get("/api/import/history")
    def node_import_history():
        return ok(items=load().get("import_history") or [])

    @app.post("/api/import/history/clear")
    def node_import_history_clear():
        data = load()
        data["import_history"] = []
        save(data)
        return ok()

    # ── extraction engines (runtime capability probe) ────────────────────
    def engine_rows() -> list[dict[str, Any]]:
        """Report which engines this server can actually run right now."""
        rows = []
        for eid, label, stage, module in ENGINE_CATALOGUE:
            if not module:
                installed = True
            elif hasattr(core, "fetch_engine_installed") and stage == "fetch":
                installed = bool(core.fetch_engine_installed(eid))
            else:
                installed = importlib.util.find_spec(module) is not None
            # Distinguish "pip package missing" from "package present but the
            # browser binary was never downloaded" — the fix differs.
            pkg = (not module) or importlib.util.find_spec(module) is not None
            note = ""
            if not installed:
                note = ("مرورگر نصب نشده؛ اجرا کنید: playwright install chromium"
                        if pkg and eid in ("playwright", "selenium")
                        else "کتابخانه نصب نیست")
            rows.append({
                "id": eid, "label": label, "stage": stage,
                "module": module, "installed": installed,
                "package": pkg, "note": note,
                # Browser engines additionally need a downloaded browser binary.
                "needsBrowser": eid in ("playwright", "selenium"),
            })
        return rows

    @app.get("/api/diagnose/browser-help")
    def node_browser_help():
        host = "pythonanywhere" if "/var/www" in os.getcwd() or ".wconsole_data" in os.getcwd() else "vps"
        return ok(
            host=host,
            playbook="digikala" in request.args.get("url","").lower(),
            hint="دیجی‌کالا بدون مرورگر هم با curl_cffi/cloudscraper استخراج می‌شود؛ کافی است fetch_engine را روی auto بگذارید و curl_cffi نصب باشد."
        )

    @app.get("/api/install-commands")
    def node_install_commands():
        """Return all pip install commands for dependencies (also stored inside scraper4.py header)."""
        cmds = {
            "full": "pip install -r python-scraper4/requirements.txt",
            "core": "pip install flask>=3.0.0 gunicorn>=21.2.0 urllib3>=2.0.0 requests>=2.31.0",
            "fetch": "pip install httpx[http2]>=0.27.0 curl_cffi>=0.7.0 cloudscraper>=1.2.71",
            "browser": "pip install playwright>=1.40.0 playwright-stealth>=1.0.6 selenium>=4.20.0 undetected-chromedriver>=3.5.5 && python -m playwright install --with-deps chromium",
            "browser_mirror_ir": "bash python-scraper4/tools/install_chromium_mirror.sh  # از ایران - آینه npmmirror (cdn.playwright.dev مسدود است)",
            "browser_ir_vps": "bash python-scraper4/tools/install_chromium_mirror.sh && systemctl restart scraper4",
            "browser_ir_pythonanywhere": "pip install --user -U playwright && PLAYWRIGHT_BROWSERS_PATH=$HOME/.cache/ms-playwright python -m playwright install chromium",
            "browser_ir_pythonanywhere_headless": "PLAYWRIGHT_BROWSERS_PATH=$HOME/.cache/ms-playwright python -m playwright install chromium-headless-shell",
            "browser_ir_fallback": "sudo apt install -y chromium-browser && export SCRAPER_BROWSER_PATH=/usr/bin/chromium-browser",
            "parse": "pip install beautifulsoup4>=4.12.0 lxml>=5.0.0 html5lib>=1.1 selectolax>=0.3.21",
            "dest": "pip install basalam-sdk>=1.2.0",
            "all_one_liner": "pip install flask gunicorn urllib3 requests httpx[http2] curl_cffi cloudscraper playwright playwright-stealth selenium undetected-chromedriver beautifulsoup4 lxml html5lib selectolax basalam-sdk",
            "system": "sudo apt update && sudo apt install -y python3 python3-venv python3-pip git curl chromium-browser",
            "venv": "python3 -m venv .venv && source .venv/bin/activate && pip install --upgrade pip && pip install -r python-scraper4/requirements.txt",
        }
        return ok(commands=cmds, requirements="python-scraper4/requirements.txt")

    @app.get("/api/engines")
    def node_engines():
        rows = engine_rows()
        return ok(engines=rows,
                  installed=[r["id"] for r in rows if r["installed"]],
                  missing=[r["id"] for r in rows if not r["installed"]])

    # The dashboard's "runtime libraries" panel lists what is available.
    @app.get("/api/runtime/libraries")
    @app.get("/api/libraries")
    def node_runtime_libraries():
        items = []
        for eid, label, stage, module in ENGINE_CATALOGUE:
            if not module:
                continue
            spec = importlib.util.find_spec(module)
            version = ""
            if spec is not None:
                try:
                    version = importlib.metadata.version(module.replace("_", "-"))
                except Exception:  # noqa: BLE001 - version is cosmetic
                    version = "?"
            items.append({"name": module, "engine": eid, "stage": stage,
                          "label": label, "installed": spec is not None,
                          "version": version})
        # De-duplicate: several engines can share one module.
        seen, unique = set(), []
        for item in items:
            if item["name"] in seen:
                continue
            seen.add(item["name"])
            unique.append(item)
        return ok(items=unique)

    # ── destination panels (Woo / Basalam catalogues) ────────────────────
    DEST_ALIASES = {"woo": "woocommerce", "woocommerce": "woocommerce",
                    "basalam": "basalam", "bsl": "basalam"}

    def dest_key(target: str) -> str:
        key = DEST_ALIASES.get(_s(target).lower())
        if not key:
            raise ValueError("مقصد نامعتبر است")
        return key

    def _basalam_shop_configs() -> list[dict[str, Any]]:
        cfg = dict(load().get("basalam") or {})
        shops = [{
            "id": _s(cfg.get("vendor_id")), "name": _s(cfg.get("shop_name")) or "غرفهٔ پیش‌فرض",
            "token": _s(cfg.get("token")), "vendor_id": _int(cfg.get("vendor_id")),
            "primary": True, "cfg": cfg,
        }]
        for row in cfg.get("vendors") or []:
            if not isinstance(row, dict):
                continue
            vendor = _int(row.get("vendor_id"))
            merged = dict(cfg)
            merged.update({"vendor_id": vendor, "token": _s(row.get("token")),
                           "shop_name": _s(row.get("shop_name") or row.get("name"))})
            shops.append({
                "id": _s(vendor), "name": _s(row.get("shop_name") or row.get("name")) or f"غرفه {vendor}",
                "token": _s(row.get("token")), "vendor_id": vendor,
                "primary": False, "cfg": merged,
            })
        # Keep the configured list visible even when credentials are incomplete,
        # but never issue an API request without both values.
        seen, out = set(), []
        for shop in shops:
            if not shop["id"] or shop["id"] in seen:
                continue
            seen.add(shop["id"])
            out.append(shop)
        return out

    def _basalam_shop(shop_id: Any = "") -> Optional[dict[str, Any]]:
        wanted = _s(shop_id)
        shops = _basalam_shop_configs()
        if wanted and wanted not in {"all", "default"}:
            return next((shop for shop in shops if shop["id"] == wanted), None)
        return next((shop for shop in shops if shop.get("primary")), shops[0] if shops else None)

    def _selected_basalam_shops(shop_filter: str = "all") -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        shops = _basalam_shop_configs()
        selected = shops if shop_filter in {"", "all"} else [
            shop for shop in shops if shop["id"] == shop_filter
        ]
        if not selected:
            raise ValueError("غرفهٔ انتخاب‌شده پیدا نشد")
        runnable = [shop for shop in selected if shop.get("token") and shop.get("vendor_id")]
        if not runnable:
            raise ValueError("توکن و شناسهٔ غرفهٔ انتخاب‌شده کامل نیست")
        return runnable, shops

    def _plain_catalog_payload(payload: Any) -> dict[str, Any]:
        """Turn REST dictionaries or Pydantic SDK responses into one mapping."""
        if hasattr(payload, "model_dump"):
            try:
                payload = payload.model_dump(mode="json")
            except TypeError:
                payload = payload.model_dump()
        elif hasattr(payload, "dict"):
            payload = payload.dict()
        return payload if isinstance(payload, dict) else {}

    def _catalog_meta(payload: dict[str, Any], rows: list[dict[str, Any]],
                      page: int, per_page: int) -> dict[str, Any]:
        containers = [payload]
        for name in ("meta", "pagination", "paging"):
            value = payload.get(name)
            if isinstance(value, dict):
                containers.append(value)
        data = payload.get("data")
        if isinstance(data, dict):
            containers.append(data)
            for name in ("meta", "pagination", "paging"):
                value = data.get(name)
                if isinstance(value, dict):
                    containers.append(value)

        def number(*names: str) -> Optional[int]:
            for container in containers:
                for name in names:
                    value = container.get(name)
                    if value in (None, "") or isinstance(value, bool):
                        continue
                    try:
                        return max(0, int(float(value)))
                    except (TypeError, ValueError):
                        continue
            return None

        total = number("total_count", "total", "count", "records_total")
        total_pages = number("total_page", "total_pages", "last_page", "page_count")
        known = total is not None or total_pages is not None
        if total is None:
            # Keep «next» available when an older API response has no metadata.
            total = (page - 1) * per_page + len(rows)
            if len(rows) >= per_page:
                total += 1
        if total_pages is None:
            total_pages = max(1, (total + per_page - 1) // per_page)
        return {"total": total, "totalPages": max(1, total_pages), "known": known}

    def _basalam_status_values(status: str) -> list[str]:
        mapping = {
            "all": ["2976", "3790", "3567", "3568", "4184",
                    "2977", "2978", "3248", "4221"],
            "active": ["2976"], "inactive": ["3790"],
            "not_approved": ["3567"], "pending": ["3568"],
            "archived": ["4184"],
        }
        normalized = _s(status) or "all"
        if normalized in mapping:
            return mapping[normalized]
        return [normalized] if normalized in {"2976", "3790", "3567", "3568", "4184"} \
            else mapping["all"]

    def _basalam_page_for_shop(shop: dict[str, Any], page: int, per_page: int,
                                query: str = "", status: str = "all") -> dict[str, Any]:
        params: dict[str, Any] = {
            "page": page,
            "per_page": per_page,
            "statuses": _basalam_status_values(status),
        }
        if query:
            params["title"] = query
        with core.basalam_use_cfg(shop["cfg"]):
            payload = core.basalam_request(
                "GET", f"/v1/vendors/{shop['vendor_id']}/products", params=params)
        plain = _plain_catalog_payload(payload)
        raw_rows = core.basalam_api_rows(plain)
        rows: list[dict[str, Any]] = []
        for raw in raw_rows:
            if not isinstance(raw, dict):
                continue
            item = dict(raw)
            item["__s4_shop_id"] = shop["id"]
            item["__s4_shop_name"] = shop["name"]
            rows.append(item)
        return {"rows": rows, **_catalog_meta(plain, rows, page, per_page)}

    def _basalam_catalog_page(selected: list[dict[str, Any]], page: int,
                               per_page: int, query: str = "",
                               status: str = "all") -> dict[str, Any]:
        rows: list[dict[str, Any]] = []
        total, total_pages, known, errors = 0, 1, True, []
        for shop in selected:
            try:
                result = _basalam_page_for_shop(shop, page, per_page, query, status)
            except Exception as exc:  # Keep other configured shops usable.
                errors.append({"shopId": shop["id"], "shopName": shop["name"],
                               "error": str(exc)[:500]})
                if len(selected) == 1:
                    raise
                continue
            rows.extend(result["rows"])
            total += _int(result.get("total"))
            total_pages = max(total_pages, _int(result.get("totalPages"), 1))
            known = known and bool(result.get("known"))
        if not rows and errors and len(errors) == len(selected):
            raise ValueError("دریافت فهرست محصولات از هیچ غرفه‌ای موفق نبود")
        return {"rows": rows, "total": total, "totalPages": total_pages,
                "complete": known and not errors, "errors": errors}

    def _basalam_catalog_counts(selected: list[dict[str, Any]],
                                 current_status: str, current_total: int) -> dict[str, int]:
        statuses = ("all", "2976", "3790", "3567", "3568", "4184")
        counts: dict[str, int] = {}
        if current_status in statuses:
            counts[current_status] = current_total

        def fetch(status: str) -> tuple[str, int]:
            result = _basalam_catalog_page(selected, 1, 10, "", status)
            return status, _int(result.get("total"))

        pending = [status for status in statuses if status != current_status]
        with ThreadPoolExecutor(max_workers=min(5, len(pending))) as pool:
            futures = [pool.submit(fetch, status) for status in pending]
            for future in as_completed(futures):
                try:
                    status, total = future.result()
                    counts[status] = total
                except Exception:
                    # Product rows are more important than an optional pill count.
                    pass
        return counts

    def _basalam_catalog_all(selected: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        """Build one full snapshot, fetching known pages concurrently."""
        all_rows: list[dict[str, Any]] = []
        fetched_pages, expected_total, complete = 0, 0, True
        # The interactive all-at-once mode is explicit, so unlike background
        # maintenance it may read at least the same 100 pages as the Node app.
        page_limit = min(2000, max(100, _int(
            getattr(core, "REMOTE_CATALOG_PAGES", 200), 200)))
        for shop in selected:
            first = _basalam_page_for_shop(shop, 1, 100, "", "all")
            pages: dict[int, list[dict[str, Any]]] = {1: first["rows"]}
            fetched_pages += 1
            expected_total += _int(first.get("total"))
            if first.get("known"):
                reported_pages = max(1, _int(first.get("totalPages"), 1))
                last_page = min(page_limit, reported_pages)
                complete = complete and reported_pages <= page_limit
                if last_page > 1:
                    with ThreadPoolExecutor(max_workers=min(6, last_page - 1)) as pool:
                        futures = {
                            pool.submit(_basalam_page_for_shop, shop, page, 100, "", "all"): page
                            for page in range(2, last_page + 1)
                        }
                        for future in as_completed(futures):
                            page = futures[future]
                            pages[page] = future.result()["rows"]
                            fetched_pages += 1
            else:
                page, batch = 1, first["rows"]
                while len(batch) >= 100 and page < page_limit:
                    page += 1
                    result = _basalam_page_for_shop(shop, page, 100, "", "all")
                    batch = result["rows"]
                    pages[page] = batch
                    fetched_pages += 1
                if len(batch) >= 100:
                    complete = False
            shop_count = 0
            for page in sorted(pages):
                all_rows.extend(pages[page])
                shop_count += len(pages[page])
            if first.get("known") and shop_count < _int(first.get("total")):
                complete = False
        return all_rows, {"complete": complete, "pagesFetched": fetched_pages,
                          "remoteTotal": expected_total or len(all_rows)}

    destination_catalog_cache: dict[Any, dict[str, Any]] = {}
    destination_catalog_lock = threading.RLock()
    destination_catalog_ttl = 180

    def _destination_rows(key: str, shop_filter: str = "all") -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        if key == "woocommerce":
            return core.destination_remote_rows(key), []
        selected, shops = _selected_basalam_shops(shop_filter)
        rows: list[dict[str, Any]] = []
        # Preserve the backend's tested/default path for a single primary shop
        # (and make this helper straightforward to monkeypatch in contract tests).
        if len(selected) == 1 and selected[0].get("primary"):
            raw_rows = core.destination_remote_rows("basalam")
            for raw in raw_rows:
                if isinstance(raw, dict):
                    item = dict(raw)
                    item["__s4_shop_id"] = selected[0]["id"]
                    item["__s4_shop_name"] = selected[0]["name"]
                    rows.append(item)
            return rows, [{k: s[k] for k in ("id", "name", "primary")} for s in shops]
        for shop in selected:
            if not shop.get("token") or not shop.get("vendor_id"):
                continue
            with core.basalam_use_cfg(shop["cfg"]):
                for page in range(1, getattr(core, "REMOTE_CATALOG_PAGES", 20) + 1):
                    payload = core.basalam_request(
                        "GET", f"/v1/vendors/{shop['vendor_id']}/products",
                        params={"per_page": 100, "page": page},
                    )
                    batch = core.basalam_api_rows(payload)
                    for raw in batch:
                        if isinstance(raw, dict):
                            item = dict(raw)
                            item["__s4_shop_id"] = shop["id"]
                            item["__s4_shop_name"] = shop["name"]
                            rows.append(item)
                    if len(batch) < 100:
                        break
        return rows, [{k: s[k] for k in ("id", "name", "primary")} for s in shops]

    def _nested(row: dict[str, Any], *names: str) -> Any:
        sources = [row]
        for key in ("data", "revision", "product", "category"):
            value = row.get(key)
            if isinstance(value, dict):
                sources.append(value)
                if isinstance(value.get("data"), dict):
                    sources.append(value["data"])
        for source in sources:
            for name in names:
                if source.get(name) not in (None, ""):
                    return source.get(name)
        return None

    def _destination_view(raw: dict[str, Any], key: str) -> dict[str, Any]:
        row = raw if isinstance(raw, dict) else {}
        basic = core.remote_product_view(row, key)
        if key == "woocommerce":
            images = row.get("images") if isinstance(row.get("images"), list) else []
            image = next((_s(x.get("src")) for x in images if isinstance(x, dict) and x.get("src")), "")
            cats = row.get("categories") if isinstance(row.get("categories"), list) else []
            cat = next((x for x in cats if isinstance(x, dict)), {})
            return {
                **basic, "title": _s(row.get("name") or basic.get("title")),
                "image": image, "stock": row.get("stock_quantity"),
                "category": _s(cat.get("name")), "categoryId": _int(cat.get("id")),
                "shortDescription": _s(row.get("short_description")),
                "description": _s(row.get("description")), "raw": row,
                "shopId": "default", "shopName": "ووکامرس",
                "statusLabel": _s(row.get("status")),
            }
        photo = _nested(row, "photo", "image", "primary_photo")
        if isinstance(photo, dict):
            image = _s(photo.get("url") or photo.get("medium") or photo.get("src"))
        else:
            image = _s(photo)
        price = _nested(row, "primary_price", "price")
        if isinstance(price, dict):
            price = price.get("amount") or price.get("value") or price.get("price")
        status = _nested(row, "status", "status_id", "state")
        if isinstance(status, dict):
            status = status.get("id") or status.get("value")
        category = _nested(row, "category_title", "category_name")
        category_id = _nested(row, "category_id")
        category_obj = row.get("category")
        if isinstance(category_obj, dict):
            category = category or category_obj.get("title") or category_obj.get("name")
            category_id = category_id or category_obj.get("id")
        labels = {2976: "فعال", 3790: "غیرفعال", 3567: "تأیید نشده",
                  3568: "در انتظار تأیید", 4184: "بایگانی"}
        return {
            **basic, "title": _s(_nested(row, "title", "name") or basic.get("title")),
            "price": _int(core.woo_price(price) or 0), "image": image,
            "stock": _nested(row, "stock", "inventory", "quantity"),
            "category": _s(category), "categoryId": _int(category_id),
            "shortDescription": _s(_nested(row, "short_description", "short_desc")),
            "description": _s(_nested(row, "description", "long_description")),
            "rejectionReason": _s(_nested(row, "rejection_reason", "reject_reason")),
            "raw": row, "shopId": _s(row.get("__s4_shop_id")),
            "shopName": _s(row.get("__s4_shop_name")), "status": status,
            "statusLabel": labels.get(_int(status), _s(status)),
        }

    def _shop_context(shop_id: Any):
        shop = _basalam_shop(shop_id)
        if not shop:
            raise ValueError("غرفه پیدا نشد")
        return core.basalam_use_cfg(shop["cfg"]), shop

    @app.get("/api/destination/<target>/overview")
    def node_dest_overview(target: str):
        try:
            key = dest_key(target)
            rows, shops = _destination_rows(key, _s(request.args.get("shop")) or "all")
        except Exception as exc:  # noqa: BLE001 - shown in the panel
            return jsonify(ok=False, error=str(exc)), 400
        data = load()
        name = _s(request.args.get("profileId")) or _s(data.get("active_profile"))
        profile = (data.get("profiles") or {}).get(name) or {}
        report = core.build_destination_report(name, key, profile, rows)
        return ok(overview=report, counts=report.get("counts", {}), shops=shops,
                  remoteTotal=report.get("remote_total", 0),
                  localTotal=report.get("local_total", 0))

    @app.get("/api/destination/<target>/products")
    def node_dest_products(target: str):
        per_page = min(100, max(1, _int(request.args.get("per_page"),
                                        _int(request.args.get("limit"), 25) or 25)))
        page = max(1, _int(request.args.get("page"), 1))
        query = _s(request.args.get("q")).strip().lower()
        status = _s(request.args.get("status")) or "all"
        shop_filter = _s(request.args.get("shop")) or "all"
        requested_mode = _s(request.args.get("fetch_mode") or
                            request.args.get("catalog_mode")).lower()
        fetch_mode = "all" if requested_mode in {"all", "full", "once"} else "page"
        include_counts = _truthy(request.args.get("counts"))
        force_refresh = _truthy(request.args.get("refresh"))
        try:
            key = dest_key(target)
            # Preserve the existing Woo catalogue behavior in this focused
            # Basalam fix; Basalam now mirrors Node's remote page forwarding.
            if key != "basalam":
                rows, shops = _destination_rows(key, shop_filter)
                items = [_destination_view(row, key) for row in rows]
                if query:
                    items = [item for item in items if query in (
                        _s(item.get("title")) + " " + _s(item.get("sku")) +
                        " " + _s(item.get("id"))).lower()]
                counts: dict[str, int] = {"all": len(items)}
                for item in items:
                    code = _s(item.get("status"))
                    counts[code] = counts.get(code, 0) + 1
                if status != "all":
                    items = [item for item in items if _s(item.get("status")) == status]
                total = len(items)
                total_pages = max(1, (total + per_page - 1) // per_page)
                page = min(page, total_pages)
                offset = (page - 1) * per_page
                return ok(items=items[offset:offset + per_page], total=total, page=page,
                          perPage=per_page, totalPages=total_pages, counts=counts,
                          shops=shops, fetchMode="all", cached=False,
                          priceUnit="تومان", remotePriceUnit="تومان",
                          archiveInsteadOfDelete=False)

            selected, shops = _selected_basalam_shops(shop_filter)
            shop_list = [{field: shop[field] for field in ("id", "name", "primary")}
                         for shop in shops]
            if fetch_mode == "page":
                if query.isdigit():
                    items, lookup_errors = [], []
                    for shop in selected:
                        try:
                            items.append(_destination_get_one(key, query, shop["id"]))
                        except Exception as exc:
                            lookup_errors.append({"shopId": shop["id"],
                                                  "error": str(exc)[:500]})
                    catalog = {"total": len(items), "totalPages": 1,
                               "complete": not lookup_errors, "errors": lookup_errors}
                else:
                    catalog = _basalam_catalog_page(
                        selected, page, per_page, query, status)
                    items = [_destination_view(row, key) for row in catalog["rows"]]
                counts = None
                if include_counts:
                    counts = _basalam_catalog_counts(
                        selected, status if not query else "", _int(catalog.get("total")))
                payload: dict[str, Any] = {
                    "items": items,
                    "total": _int(catalog.get("total")),
                    "page": page,
                    "perPage": per_page,
                    "totalPages": max(1, _int(catalog.get("totalPages"), 1)),
                    "shops": shop_list,
                    "fetchMode": "page",
                    "cached": False,
                    "complete": bool(catalog.get("complete")),
                    "errors": catalog.get("errors") or [],
                    "priceUnit": "تومان",
                    "remotePriceUnit": "ریال",
                    "archiveInsteadOfDelete": True,
                }
                if counts is not None:
                    payload["counts"] = counts
                return ok(**payload)

            cache_key = ("basalam", tuple(
                (shop["id"], shop["token"], _s(shop["cfg"].get("api_base_url")),
                 core.normalize_basalam_client_mode(shop["cfg"].get("client_mode")))
                for shop in selected))
            now = time.time()
            with destination_catalog_lock:
                for old_key, old_entry in list(destination_catalog_cache.items()):
                    if now - _num(old_entry.get("createdAt")) > destination_catalog_ttl:
                        destination_catalog_cache.pop(old_key, None)
                entry = destination_catalog_cache.get(cache_key)
            cached = bool(entry and not force_refresh)
            if not cached:
                rows, meta = _basalam_catalog_all(selected)
                entry = {
                    "createdAt": time.time(),
                    "items": [_destination_view(row, key) for row in rows],
                    **meta,
                }
                with destination_catalog_lock:
                    destination_catalog_cache[cache_key] = entry
                    if len(destination_catalog_cache) > 8:
                        oldest = min(destination_catalog_cache,
                                     key=lambda item: _num(
                                         destination_catalog_cache[item].get("createdAt")))
                        destination_catalog_cache.pop(oldest, None)

            all_items = list(entry.get("items") or [])
            counts = {"all": len(all_items)}
            for item in all_items:
                code = _s(item.get("status"))
                counts[code] = counts.get(code, 0) + 1
            items = all_items
            if query:
                items = [item for item in items if query in (
                    _s(item.get("title")) + " " + _s(item.get("sku")) +
                    " " + _s(item.get("id"))).lower()]
            if status != "all":
                items = [item for item in items if _s(item.get("status")) == status]
            total = len(items)
            total_pages = max(1, (total + per_page - 1) // per_page)
            page = min(page, total_pages)
            offset = (page - 1) * per_page
            return ok(items=items[offset:offset + per_page], total=total, page=page,
                      perPage=per_page, totalPages=total_pages, counts=counts,
                      shops=shop_list, fetchMode="all", cached=cached,
                      complete=bool(entry.get("complete")),
                      pagesFetched=_int(entry.get("pagesFetched")),
                      snapshotAgeSeconds=max(0, int(now - _num(entry.get("createdAt")))),
                      priceUnit="تومان", remotePriceUnit="ریال",
                      archiveInsteadOfDelete=True)
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400

    def _destination_get_one(key: str, item_id: str, shop_id: str = "") -> dict[str, Any]:
        if key == "woocommerce":
            raw = core.woo_request("GET", f"products/{item_id}").json()
            return _destination_view(raw if isinstance(raw, dict) else {}, key)
        ctx, shop = _shop_context(shop_id)
        last: Optional[Exception] = None
        with ctx:
            for path in (f"/v1/products/{item_id}",
                         f"/v1/vendors/{shop['vendor_id']}/products/{item_id}"):
                try:
                    payload = core.basalam_request("GET", path)
                    raw = payload.get("data", payload) if isinstance(payload, dict) else {}
                    if isinstance(raw, dict):
                        raw = dict(raw)
                        raw["__s4_shop_id"] = shop["id"]
                        raw["__s4_shop_name"] = shop["name"]
                        return _destination_view(raw, key)
                except Exception as exc:  # noqa: BLE001 - try vendor endpoint too
                    last = exc
        raise last or ValueError("محصول باسلام پیدا نشد")

    @app.get("/api/destination/<target>/product/<path:item_id>")
    def node_dest_product(target: str, item_id: str):
        try:
            key = dest_key(target)
            return ok(product=_destination_get_one(key, item_id, _s(request.args.get("shop"))))
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400

    def _direct_destination_payload(key: str, body: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
        payload: dict[str, Any] = {}
        if "title" in body and _s(body.get("title")) != _s(current.get("title")):
            payload["name" if key == "woocommerce" else "title"] = _s(body.get("title"))
        if body.get("price") not in (None, "") and _int(body.get("price")) != _int(current.get("price")):
            payload["regular_price" if key == "woocommerce" else "price"] = (
                _s(_int(body.get("price"))) if key == "woocommerce" else _int(body.get("price")))
        if body.get("stock") not in (None, "") and _int(body.get("stock")) != _int(current.get("stock")):
            if key == "woocommerce":
                payload.update(manage_stock=True, stock_quantity=_int(body.get("stock")))
            else:
                payload["stock"] = _int(body.get("stock"))
        if "status" in body and _s(body.get("status")) != _s(current.get("status")):
            payload["status"] = _int(body.get("status")) if key == "basalam" else _s(body.get("status"))
        mappings = (("shortDescription", "short_description"), ("description", "description"))
        for source, destination in mappings:
            if source in body and _s(body.get(source)) != _s(current.get(source)):
                payload[destination] = _s(body.get(source))
        if key == "woocommerce" and "sku" in body and _s(body.get("sku")) != _s(current.get("sku")):
            payload["sku"] = _s(body.get("sku"))
        if body.get("categoryId") not in (None, "") and _int(body.get("categoryId")) != _int(current.get("categoryId")):
            if key == "woocommerce":
                payload["categories"] = [{"id": _int(body.get("categoryId"))}]
            else:
                payload["category_id"] = _int(body.get("categoryId"))
        for field in ("preparation_days", "weight", "package_weight"):
            if key == "basalam" and body.get(field) not in (None, ""):
                payload[field] = max(0, _int(body.get(field)))
        return payload

    @app.post("/api/destination/<target>/<path:item_id>/update")
    def node_dest_update(target: str, item_id: str):
        body = _body()
        apply_now = _s(body.get("confirm")) == "APPLY"
        try:
            key = dest_key(target)
            current = _destination_get_one(key, item_id, _s(body.get("shopId")))
            changes = _direct_destination_payload(key, body, current)
            if not changes:
                return ok(dryRun=not apply_now, id=item_id, shopId=current.get("shopId"),
                          changed=False, current=current, changes={})
            if not apply_now:
                return ok(dryRun=True, id=item_id, shopId=current.get("shopId"), changed=True,
                          current=current, changes=changes,
                          summary="پیش‌نمایش است؛ چیزی روی مقصد تغییر نکرد.")
            if key == "woocommerce":
                raw = core.woo_request("PUT", f"products/{item_id}", changes).json()
            else:
                ctx, _shop = _shop_context(body.get("shopId") or current.get("shopId"))
                with ctx:
                    raw = core.basalam_request("PATCH", f"/v1/products/{item_id}",
                                                   json_data=changes)
                raw = raw.get("data", raw) if isinstance(raw, dict) else {}
                if isinstance(raw, dict):
                    raw = dict(raw)
                    raw["__s4_shop_id"] = current.get("shopId")
                    raw["__s4_shop_name"] = current.get("shopName")
                if _int(changes.get("category_id")) > 0:
                    learning = load()
                    records = learning.get("category_learning")
                    if not isinstance(records, list):
                        records = []
                    records.append({"title": current.get("title"),
                                    "categoryId": _int(changes["category_id"]),
                                    "categoryName": _s(body.get("categoryName") or current.get("category")),
                                    "at": _iso()})
                    learning["category_learning"] = records[-5000:]
                    save(learning)
            return ok(dryRun=False, id=item_id, shopId=current.get("shopId"), changed=True,
                      product=_destination_view(raw if isinstance(raw, dict) else {}, key))
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400

    @app.post("/api/destination/<target>/<path:item_id>/status")
    def node_dest_status(target: str, item_id: str):
        body = _body()
        if _s(body.get("confirm")) != "APPLY":
            return jsonify(ok=False, error="برای اعمال تغییر، confirm=APPLY لازم است."), 400
        status = _s(body.get("status")) or "draft"
        try:
            key = dest_key(target)
            if key == "woocommerce":
                response = core.woo_request("PUT", f"products/{item_id}", {"status": status})
                item = response.json()
            else:
                ctx, shop = _shop_context(body.get("shopId"))
                with ctx:
                    item = core.basalam_request("PATCH", f"/v1/products/{item_id}",
                                                    json_data={"status": _int(status)})
                item = item.get("data", item) if isinstance(item, dict) else item
                if isinstance(item, dict):
                    item = {**item, "__s4_shop_id": shop["id"], "__s4_shop_name": shop["name"]}
            return ok(item=_destination_view(item, key) if isinstance(item, dict) else item,
                      status=_int(status) if key == "basalam" else status)
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400

    @app.delete("/api/destination/<target>/<path:item_id>")
    def node_dest_delete(target: str, item_id: str):
        if request.args.get("confirm") != "DELETE":
            return jsonify(ok=False, error="برای حذف، confirm=DELETE لازم است."), 400
        try:
            key = dest_key(target)
            if key == "woocommerce":
                force = _s(request.args.get("force")).lower() in {"1", "true", "yes"}
                core.woo_request("DELETE", f"products/{item_id}?force={'true' if force else 'false'}")
                return ok(deleted=item_id, force=force)
            ctx, shop = _shop_context(request.args.get("shop") or request.args.get("shopId"))
            with ctx:
                result = core.basalam_request("PATCH", f"/v1/products/{item_id}",
                                                  json_data={"status": 4184})
            return ok(deleted=item_id, archived=True, status=4184, shopId=shop["id"], raw=result)
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400

    DEDUP_RUNS: dict[str, dict[str, Any]] = {}
    DEDUP_LOCK = threading.RLock()

    def _dedup_get(key: str) -> Optional[dict[str, Any]]:
        with DEDUP_LOCK:
            if key in DEDUP_RUNS:
                return copy.deepcopy(DEDUP_RUNS[key])
            stored = load().get("dedup_runs")
            row = stored.get(key) if isinstance(stored, dict) else None
            if isinstance(row, dict):
                DEDUP_RUNS[key] = copy.deepcopy(row)
                return copy.deepcopy(row)
        return None

    def _dedup_save(key: str, run: dict[str, Any]) -> None:
        with DEDUP_LOCK:
            DEDUP_RUNS[key] = copy.deepcopy(run)
            data = load()
            rows = data.setdefault("dedup_runs", {})
            if not isinstance(rows, dict):
                rows = {}
                data["dedup_runs"] = rows
            rows[key] = copy.deepcopy(run)
            save(data)

    def _dedup_suffix_patterns(raw: Any) -> list[re.Pattern[str]]:
        formats = ([_s(value) for value in raw] if isinstance(raw, list) else
                   re.split(r"[,،|\n]+", _s(raw)))
        formats = [value.strip() for value in formats if value.strip() and re.search(r"x", value, re.I)][:8]
        if not formats:
            formats = ["(کد:x)", "#x"]
        patterns = []
        for value in formats:
            pieces = re.split(r"[xX]+", value)
            body = r"[\w\u0600-\u06ff]{1,20}".join(re.escape(piece).replace(r"\ ", r"\s*")
                                                         for piece in pieces)
            patterns.append(re.compile(r"(?:\s|[-–—_·.])*" + body + r"\s*$", re.I))
        patterns.append(re.compile(
            r"(?:\s|[-–—_·.])*[\[(]\s*(?:کد|كد|code|sku)\s*[:：#-]?\s*"
            r"[\w\u0600-\u06ff][\w\u0600-\u06ff\s._/-]{0,40}?\s*[\])]\s*$", re.I))
        return patterns

    def _dedup_base_title(title: Any, patterns: list[re.Pattern[str]]) -> str:
        text = core.clean_text(title).lower()
        for _ in range(5):
            old = text
            for pattern in patterns:
                text = pattern.sub("", text)
            if text == old:
                break
        text = re.sub(r"[^\w\s\u0600-\u06ff]", " ", text, flags=re.UNICODE)
        return re.sub(r"\s+", " ", text).strip()

    def _dedup_worker(key: str, run_id: str) -> None:
        run = _dedup_get(key)
        if not run or run.get("id") != run_id:
            return
        try:
            if not run.get("groups"):
                run.update(status="running", phase="listing", updatedAt=_iso())
                _dedup_save(key, run)
                raw_rows, _shops = _destination_rows(key, "all")
                views = [_destination_view(row, key) for row in raw_rows]
                run.update(scanned=len(views), page=1, totalPages=1, phase="grouping",
                           updatedAt=_iso())
                _dedup_save(key, run)
                patterns = _dedup_suffix_patterns(run.get("suffixFormats"))
                grouped: dict[str, list[dict[str, Any]]] = {}
                for view in views:
                    name = _s(view.get("title"))
                    base = _dedup_base_title(name, patterns)
                    if not base:
                        continue
                    shop_id = _s(view.get("shopId")) or "default"
                    raw = view.get("raw") if isinstance(view.get("raw"), dict) else {}
                    candidate = {"id": _int(view.get("id")), "shopId": shop_id,
                                 "name": name, "price": _int(view.get("price")),
                                 "date": _s(raw.get("date_created") or raw.get("created_at")),
                                 "status": _s(view.get("status")), "sku": _s(view.get("sku"))}
                    if candidate["id"]:
                        grouped.setdefault(shop_id + "::" + base, []).append(candidate)
                groups = []
                keep = run.get("keep")
                for group_key, candidates in grouped.items():
                    if len(candidates) < 2:
                        continue
                    def created(item: dict[str, Any]) -> float:
                        try:
                            return datetime.fromisoformat(item["date"].replace("Z", "+00:00")).timestamp()
                        except (ValueError, TypeError):
                            return float(item["id"])
                    if keep == "oldest":
                        ordered = sorted(candidates, key=lambda item: (created(item), item["id"]))
                    elif keep == "cheapest":
                        ordered = sorted(candidates, key=lambda item: (item["price"], -item["id"]))
                    elif keep == "expensive":
                        ordered = sorted(candidates, key=lambda item: (-item["price"], -item["id"]))
                    else:
                        ordered = sorted(candidates, key=lambda item: (-created(item), -item["id"]))
                    groups.append({"key": group_key, "title": ordered[0]["name"],
                                   "count": len(ordered), "keep": ordered[0],
                                   "remove": ordered[1:]})
                groups.sort(key=lambda group: (-len(group["remove"]), group["title"]))
                run.update(groups=groups[:500], groupsFound=len(groups),
                           duplicates=sum(len(group["remove"]) for group in groups),
                           phase="removing" if run.get("apply") else "finished",
                           status="running" if run.get("apply") else "done", updatedAt=_iso())
                _dedup_save(key, run)
            if not run.get("apply"):
                return
            actions = [(group, item) for group in run.get("groups") or []
                       for item in group.get("remove") or []]
            cursor = max(0, _int(run.get("cursor")))
            for index in range(cursor, len(actions)):
                latest = _dedup_get(key) or run
                if latest.get("stopRequested"):
                    run.update(status="paused", phase="paused", cursor=index,
                               stopRequested=False, updatedAt=_iso())
                    _dedup_save(key, run)
                    return
                group, item = actions[index]
                record = {"id": item["id"], "shopId": item.get("shopId"),
                          "name": item.get("name"), "action": "archive" if key == "basalam" else "trash"}
                try:
                    if key == "woocommerce":
                        core.woo_request("DELETE", f"products/{item['id']}?force=false")
                    else:
                        context, _shop = _shop_context(item.get("shopId"))
                        with context:
                            core.basalam_request("PATCH", f"/v1/products/{item['id']}",
                                                     json_data={"status": 4184})
                    record["ok"] = True
                    run["removed"] = _int(run.get("removed")) + 1
                except Exception as exc:  # noqa: BLE001
                    record.update(ok=False, error=str(exc)[:500])
                    run["failed"] = _int(run.get("failed")) + 1
                logs = run.get("items") if isinstance(run.get("items"), list) else []
                logs.append(record)
                run.update(items=logs[-500:], cursor=index + 1, updatedAt=_iso())
                _dedup_save(key, run)
            run.update(status="done", phase="finished", finishedAt=_iso(), updatedAt=_iso())
            _dedup_save(key, run)
        except Exception as exc:  # noqa: BLE001
            run = _dedup_get(key) or run
            run.update(status="failed", phase="failed", error=str(exc)[:1000],
                       finishedAt=_iso(), updatedAt=_iso())
            _dedup_save(key, run)

    def _launch_dedup(key: str, run: dict[str, Any]) -> None:
        threading.Thread(target=_dedup_worker, args=(key, _s(run.get("id"))),
                         name="destination-dedup", daemon=True).start()

    @app.post("/api/destination/<target>/dedup-runs")
    def node_dedup_start(target: str):
        try:
            key = dest_key(target)
        except ValueError as exc:
            return jsonify(ok=False, error=str(exc)), 400
        existing = _dedup_get(key)
        if existing and existing.get("status") in {"queued", "running"}:
            return ok(run=existing, existing=True)
        body = _body()
        keep = _s(body.get("keep")).lower()
        if keep not in {"newest", "oldest", "cheapest", "expensive"}:
            keep = "newest"
        formats = [_s(value).strip() for value in body.get("suffixFormats") or []] \
            if isinstance(body.get("suffixFormats"), list) else \
            [value.strip() for value in re.split(r"[,،|\n]+", _s(body.get("suffixFormats"))) if value.strip()]
        run = {"id": "dedup-" + secrets.token_hex(8),
               "target": "basalam" if key == "basalam" else "woo",
               "status": "queued", "phase": "waiting", "keep": keep,
               "suffixFormats": formats or ["(کد:x)", "#x"],
               "apply": bool(body.get("apply")), "scanned": 0, "page": 1,
               "totalPages": 1, "groups": [], "groupsFound": 0,
               "duplicates": 0, "removed": 0, "failed": 0, "cursor": 0,
               "items": [], "stopRequested": False, "error": "",
               "createdAt": _iso(), "updatedAt": _iso()}
        _dedup_save(key, run)
        _launch_dedup(key, run)
        return ok(run=run, existing=False), 202

    @app.get("/api/destination/<target>/dedup-runs/current")
    def node_dedup_current(target: str):
        try:
            key = dest_key(target)
        except ValueError as exc:
            return jsonify(ok=False, error=str(exc)), 400
        return ok(run=_dedup_get(key))

    @app.post("/api/destination/<target>/dedup-runs/control")
    @app.post("/api/destination/<target>/dedup-runs/reset")
    def node_dedup_control(target: str):
        try:
            key = dest_key(target)
        except ValueError as exc:
            return jsonify(ok=False, error=str(exc)), 400
        run = _dedup_get(key)
        if request.path.endswith("/reset"):
            if run and run.get("status") in {"queued", "running"}:
                return jsonify(ok=False, error="اجرای فعال را ابتدا متوقف کنید.", run=run), 409
            with DEDUP_LOCK:
                DEDUP_RUNS.pop(key, None)
                data = load()
                stored = data.get("dedup_runs")
                if isinstance(stored, dict):
                    stored.pop(key, None)
                save(data)
            return ok(run=None)
        action = _s(_body().get("action"))
        if run and action == "stop" and run.get("status") in {"queued", "running"}:
            run.update(stopRequested=True, phase="stopping", updatedAt=_iso())
            _dedup_save(key, run)
        elif run and action == "resume" and run.get("status") in {"paused", "failed"}:
            run.update(stopRequested=False, status="queued", phase="waiting", error="", updatedAt=_iso())
            _dedup_save(key, run)
            _launch_dedup(key, run)
        return ok(run=_dedup_get(key))

    @app.route("/api/destination/<target>/bulk", methods=["GET", "POST", "PUT", "PATCH"])
    def node_dest_bulk(target: str):
        """Bulk edit / delete on the destination.

        Always dry-run unless confirm=APPLY, and capped at 20 items per call
        to match the dashboard's own guard — these are real, irreversible
        writes against a live shop.
        """
        body = _body()
        try:
            key = dest_key(target)
        except ValueError as exc:
            return jsonify(ok=False, error=str(exc)), 400
        refs: list[dict[str, str]] = []
        for value in body.get("ids") or []:
            if isinstance(value, dict):
                item_id, shop_id = _s(value.get("id")), _s(value.get("shopId"))
            else:
                item_id, shop_id = _s(value), _s(body.get("shopId"))
            if item_id:
                refs.append({"id": item_id, "shopId": shop_id})
        ops = body.get("ops") if isinstance(body.get("ops"), dict) else {}
        if not refs:
            return jsonify(ok=False, error="هیچ محصولی انتخاب نشده است."), 400
        if len(refs) > 20:
            return jsonify(ok=False, error="حداکثر ۲۰ محصول در هر نوبت."), 400
        dry = _s(body.get("confirm")) != "APPLY"
        remove = bool(ops.get("delete"))
        assignments: dict[tuple[str, str], dict[str, Any]] = {}
        for row in ops.get("categoryAssignments") or []:
            if isinstance(row, dict) and _s(row.get("id")) and _int(row.get("categoryId")) > 0:
                assignments[(_s(row.get("shopId")), _s(row.get("id")))] = row

        def new_price(current: Any) -> Optional[int]:
            spec = ops.get("price")
            if not isinstance(spec, dict):
                return None
            try:
                val = float(_s(spec.get("val")).replace(",", "") or 0)
            except ValueError:
                return None
            base = float(_int(core.woo_price(current) or 0))
            op = _s(spec.get("op"))
            if op in ("inc_pct", "percent_up"):
                out = base * (1 + val / 100)
            elif op in ("dec_pct", "percent_down"):
                out = base * (1 - val / 100)
            elif op in ("inc", "plus"):
                out = base + val
            elif op in ("dec", "minus"):
                out = base - val
            elif op in ("set", "fixed"):
                out = val
            else:
                return None
            return max(0, int(round(out)))

        items, errors = [], []
        changed = deleted = skipped = 0
        learned: list[dict[str, Any]] = []
        for ref in refs:
            item_id, shop_id = ref["id"], ref["shopId"]
            entry: dict[str, Any] = {"id": item_id, "shopId": shop_id or "default"}
            try:
                view = _destination_get_one(key, item_id, shop_id)
                entry.update(title=view.get("title"), shopId=view.get("shopId") or entry["shopId"])
                context = None
                if key == "basalam":
                    context, _shop = _shop_context(entry["shopId"])
                if remove:
                    entry["action"] = ("بایگانی با وضعیت ۴۱۸۴" if key == "basalam" else "حذف")
                    deleted += 1
                    if not dry:
                        if key == "woocommerce":
                            core.woo_request("DELETE", f"products/{item_id}?force=false")
                        else:
                            with context:
                                core.basalam_request("PATCH", f"/v1/products/{item_id}",
                                                         json_data={"status": 4184})
                        entry["done"] = True
                else:
                    payload: dict[str, Any] = {}
                    price = new_price(view.get("price"))
                    if price is not None:
                        entry["oldPrice"], entry["newPrice"] = view.get("price"), price
                        payload["regular_price" if key == "woocommerce" else "price"] = (
                            str(price) if key == "woocommerce" else price)
                    if ops.get("stock") not in (None, ""):
                        payload["stock_quantity" if key == "woocommerce" else "stock"] = _int(ops.get("stock"))
                    if _s(ops.get("status")):
                        payload["status"] = (_int(ops.get("status")) if key == "basalam"
                                             else _s(ops.get("status")))
                    title = _s(view.get("title"))
                    if _s(ops.get("titlePrefix")) or _s(ops.get("titleSuffix")):
                        title = _s(ops.get("titlePrefix")) + title + _s(ops.get("titleSuffix"))
                        payload["name" if key == "woocommerce" else "title"] = title
                        entry["newTitle"] = title
                    if _s(ops.get("shortDescription")):
                        payload["short_description"] = _s(ops.get("shortDescription"))
                    if _s(ops.get("description")):
                        payload["description"] = _s(ops.get("description"))
                    assignment = (assignments.get((entry["shopId"], item_id))
                                  or assignments.get((shop_id, item_id))
                                  or assignments.get(("", item_id)))
                    if assignment and key == "basalam":
                        payload["category_id"] = _int(assignment.get("categoryId"))
                        entry.update(categoryName=_s(assignment.get("categoryName")),
                                     categorySource=_s(assignment.get("source")))
                    if not payload:
                        entry["skipped"] = "تغییری مشخص نشده است"
                        skipped += 1
                    else:
                        changed += 1
                        entry["changes"] = payload
                        if not dry:
                            if key == "woocommerce":
                                core.woo_request("PUT", f"products/{item_id}", payload)
                            else:
                                with context:
                                    core.basalam_request("PATCH", f"/v1/products/{item_id}",
                                                             json_data=payload)
                                if assignment:
                                    learned.append({
                                        "title": view.get("title"),
                                        "categoryId": _int(assignment.get("categoryId")),
                                        "categoryName": _s(assignment.get("categoryName")),
                                        "source": _s(assignment.get("source")), "at": _iso(),
                                    })
                            entry["done"] = True
            except Exception as exc:  # noqa: BLE001 - reported per item
                entry["error"] = str(exc)[:400]
                errors.append(entry["error"])
            items.append(entry)
        if learned:
            data = load()
            rows = data.get("category_learning")
            if not isinstance(rows, list):
                rows = []
            rows.extend(learned)
            data["category_learning"] = rows[-5000:]
            save(data)
        return ok(items=items, dryRun=dry, target=key, total=len(items), count=len(items),
                  changed=changed, deleted=deleted, skipped=skipped,
                  failed=len(errors), errors=errors, learningRecords=len(learned),
                  archiveInsteadOfDelete=key == "basalam",
                  message=("پیش‌نمایش؛ هیچ تغییری اعمال نشد."
                           if dry else f"{len(items)} محصول پردازش شد."))

    @app.post("/api/destination/basalam/category/suggest")
    def node_basalam_cat_suggest():
        body = _body()
        title = _s(body.get("title")).strip()
        if not title:
            return jsonify(ok=False, error="عنوان محصول لازم است."), 400
        if _s(body.get("mode")) == "learned":
            best, score = None, 0
            needle = title.lower()
            for row in load().get("category_learning") or []:
                if not isinstance(row, dict) or _int(row.get("categoryId")) <= 0:
                    continue
                phrase = _s(row.get("words") or row.get("phrase") or row.get("title")).lower()
                words = [w for w in re.split(r"[\s,،]+", phrase) if len(w) > 1]
                hits = sum(w in needle for w in words)
                if hits > score:
                    best, score = row, hits
            result = None
            if best:
                result = {"categoryId": _int(best.get("categoryId")),
                          "categoryName": _s(best.get("categoryName")),
                          "phrase": _s(best.get("phrase") or best.get("title")),
                          "hits": score}
            return ok(result=result, title=title)
        model_key = _s(body.get("modelKey"))
        provider, _, model = model_key.partition("::")
        model = re.sub(r"::k\d+$", "", model)
        try:
            categories = core.ai_load_category_rows()
            names = [_s(row.get("path") or row.get("name")) for row in categories[:250]
                     if isinstance(row, dict) and _s(row.get("path") or row.get("name"))]
            prompt = (
                "برای عنوان محصول زیر مناسب‌ترین دستهٔ باسلام را انتخاب کن. "
                "فقط JSON معتبر با کلید category برگردان و category باید دقیقاً یکی از نام‌های فهرست باشد.\n"
                "عنوان: " + title + "\nفهرست دسته‌ها: " + " | ".join(names)
            )
            answer = core.ai_chat(prompt, provider, model)
            name = _s(answer).strip()
            try:
                parsed = core.ai_parse_json_object(answer)
                name = _s(parsed.get("category") or parsed.get("categoryName") or name)
            except Exception:
                match = re.search(r'"(?:category|categoryName)"\s*:\s*"([^"]+)"', answer)
                if match:
                    name = match.group(1)
            found = core.ai_match_category(name, categories)
            if not found:
                return jsonify(ok=False, key=model_key, error="پاسخ مدل با هیچ دستهٔ معتبر باسلام منطبق نشد.",
                               suggestion=name), 400
            return ok(key=model_key, title=title, suggestion=name,
                      categoryId=_int(found.get("id")),
                      categoryName=_s(found.get("name") or name),
                      categoryPath=_s(found.get("path") or found.get("name") or name),
                      items=[found])
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, key=model_key, error=str(exc)), 400

    @app.get("/api/destination/<target>/report")
    def node_dest_report(target: str):
        data = load()
        name = _s(request.args.get("profileId")) or _s(data.get("active_profile"))
        profile = (data.get("profiles") or {}).get(name) or {}
        try:
            key = dest_key(target)
            rows = core.destination_remote_rows(key)
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400
        return ok(report=core.build_destination_report(name, key, profile, rows))

    # ── maintenance panels ───────────────────────────────────────────────
    _CODE_SUFFIX_RE = re.compile(
        r"\s*[\[(](?:(?:کد|code|sku)\s*[:：]?\s*)?[0-9۰-۹]+[\])]\s*$", re.I)

    def _recon_title(value: Any) -> str:
        text = core.clean_text(value).lower()
        text = _CODE_SUFFIX_RE.sub("", text)
        text = re.sub(r"[^\w\s\u0600-\u06ff]", " ", text, flags=re.UNICODE)
        return re.sub(r"\s+", " ", text).strip()

    def _has_code_suffix(value: Any) -> bool:
        return bool(_CODE_SUFFIX_RE.search(_s(value)))

    def _recon_local_rows(data: dict[str, Any], profile_id: str = "") -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for pid, profile in (data.get("profiles") or {}).items():
            if profile_id and pid != profile_id:
                continue
            if not isinstance(profile, dict):
                continue
            for product in profile.get("saved_products") or []:
                if not isinstance(product, dict):
                    continue
                source_key = _s(product.get("source_key") or product.get("sourceKey"))
                if not source_key:
                    source_key = core.product_identity_key(product)
                price = _int(core.woo_price(product.get("price")) or 0)
                rows.append({"profile_id": pid, "profile_name": _s(profile.get("name")) or pid,
                             "source_key": source_key, "title": _s(product.get("title") or product.get("name")),
                             "price": price, "active": product.get("active", True) is not False,
                             "sku": _s(product.get("sku")), "product": product, "profile": profile})
        return rows

    def _mapped_remote_id(local: dict[str, Any], target: str, account_key: str) -> int:
        product = local["product"]
        maps = product.get("destination_maps")
        if isinstance(maps, dict):
            row = maps.get(f"{target}:{account_key}")
            if isinstance(row, dict) and _int(row.get("id") or row.get("remote_id")) > 0:
                return _int(row.get("id") or row.get("remote_id"))
            if _int(row) > 0:
                return _int(row)
        profile_map = local["profile"].get("remote_map")
        map_target = "woocommerce" if target == "woo" else target
        if isinstance(profile_map, dict):
            row = (profile_map.get(map_target) or {}).get(local["source_key"]) \
                if isinstance(profile_map.get(map_target), dict) else None
            if isinstance(row, dict) and _int(row.get("id")) > 0:
                return _int(row.get("id"))
        legacy = (product.get("remote_woo_id") or product.get("woo_id") if target == "woo" else
                  product.get("remote_basalam_id") or product.get("basalam_id"))
        return _int(legacy)

    def _recon_account(local_all: list[dict[str, Any]], remote_raw: list[dict[str, Any]],
                       target: str, account_key: str, account_name: str,
                       price_percent: float = 0, to_rial: bool = False,
                       require_suffix: bool = False) -> list[dict[str, Any]]:
        local = [row for row in local_all if not require_suffix or _has_code_suffix(row["title"])]
        duplicate_counts: dict[str, int] = {}
        for row in local:
            key = _recon_title(row["title"])
            duplicate_counts[key] = duplicate_counts.get(key, 0) + 1
        by_title: dict[str, list[dict[str, Any]]] = {}
        by_sku: dict[str, dict[str, Any]] = {}
        by_remote: dict[int, dict[str, Any]] = {}
        for row in local:
            by_title.setdefault(_recon_title(row["title"]), []).append(row)
            sku = row["sku"] or f"s4-{row['profile_id']}-{row['source_key']}"[:100]
            if sku:
                by_sku.setdefault(sku, row)
            mapped = _mapped_remote_id(row, target, account_key)
            if mapped:
                by_remote.setdefault(mapped, row)
        consumed: set[tuple[str, str]] = set()
        out: list[dict[str, Any]] = []

        def expected(source_price: int) -> Optional[int]:
            if source_price <= 0:
                return None
            adjusted = round(source_price * (1 + float(price_percent or 0) / 100))
            return adjusted * 10 if to_rial else adjusted

        def base(source: Optional[dict[str, Any]]) -> dict[str, Any]:
            return {"target": target, "accountKey": account_key, "accountName": account_name,
                    "pricePercent": price_percent, "profileId": source["profile_id"] if source else "",
                    "profileName": source["profile_name"] if source else "",
                    "sourceKey": source["source_key"] if source else ""}

        for raw in remote_raw:
            view = _destination_view(raw, "woocommerce" if target == "woo" else "basalam")
            title = _s(view.get("title"))
            if require_suffix and not _has_code_suffix(title):
                continue
            remote_id = _int(view.get("id"))
            candidates = by_title.get(_recon_title(title)) or []
            source = next((row for row in candidates
                           if (row["profile_id"], row["source_key"]) not in consumed), None)
            matched_by = "title" if source else "none"
            sku = _s(view.get("sku"))
            if not source and sku and sku in by_sku:
                candidate = by_sku[sku]
                if (candidate["profile_id"], candidate["source_key"]) not in consumed:
                    source, matched_by = candidate, "sku"
            if not source and remote_id in by_remote:
                candidate = by_remote[remote_id]
                if (candidate["profile_id"], candidate["source_key"]) not in consumed:
                    source, matched_by = candidate, "id"
            remote_price = _int(view.get("price")) or None
            if not source:
                out.append({**base(None), "bucket": "extra", "title": title,
                            "remoteTitle": title, "remoteId": remote_id or None,
                            "sourcePrice": None, "expectedPrice": None,
                            "remotePrice": remote_price, "delta": None, "matchedBy": "none",
                            "status": _s(view.get("status")),
                            "why": "در مقصد هست ولی در هیچ پروفایلی نیست",
                            "duplicateCount": duplicate_counts.get(_recon_title(title), 0)})
                continue
            consumed.add((source["profile_id"], source["source_key"]))
            source_price = source["price"] or None
            wanted = expected(source["price"])
            common = {**base(source), "title": source["title"], "remoteTitle": title,
                      "remoteId": remote_id or None, "sourcePrice": source_price,
                      "expectedPrice": wanted, "remotePrice": remote_price,
                      "matchedBy": matched_by, "status": _s(view.get("status")),
                      "duplicateCount": duplicate_counts.get(_recon_title(source["title"]), 0)}
            if wanted is None:
                out.append({**common, "bucket": "noPrice", "delta": None,
                            "why": "قیمت مبدأ ثبت نشده — مقایسه نشد"})
            elif remote_price != wanted:
                out.append({**common, "bucket": "priceDiff",
                            "delta": (remote_price or 0) - wanted,
                            "why": "قیمت مقصد با قیمت تعدیل‌شده یکی نیست" if price_percent else
                                   "قیمت مقصد با مبدأ یکی نیست"})
            else:
                out.append({**common, "bucket": "matched", "delta": 0, "why": ""})
        for row in local:
            if (row["profile_id"], row["source_key"]) in consumed or not row["active"]:
                continue
            source_price = row["price"] or None
            out.append({**base(row), "bucket": "missing", "title": row["title"],
                        "remoteTitle": "", "remoteId": None, "sourcePrice": source_price,
                        "expectedPrice": expected(row["price"]), "remotePrice": None,
                        "delta": None, "matchedBy": "none", "status": "",
                        "why": "در مبدأ هست ولی در مقصد نیست",
                        "duplicateCount": duplicate_counts.get(_recon_title(row["title"]), 0)})
        return out

    def _recon_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
        counts = {bucket: sum(row.get("bucket") == bucket for row in rows)
                  for bucket in ("matched", "priceDiff", "extra", "missing", "noPrice", "unreachable")}
        return {**counts, "total": len(rows),
                "inSync": not any(counts[key] for key in ("priceDiff", "extra", "missing", "unreachable"))}

    @app.post("/api/maintenance/recon-table/<target>")
    @app.post("/api/maintenance/recon-unified/<target>")
    def node_recon_table(target: str):
        body = _body()
        data = load()
        name = _s(body.get("profileId")) or _s(data.get("active_profile"))
        try:
            key = dest_key(target)
            remote, _shops = _destination_rows(key, _s(body.get("shopId")) or "all")
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400
        normalized = "woo" if key == "woocommerce" else "basalam"
        rows = _recon_account(_recon_local_rows(data, name), remote, normalized,
                              _s(body.get("shopId")) or "default",
                              "ووکامرس" if normalized == "woo" else "باسلام",
                              to_rial=normalized == "basalam", require_suffix=False)
        summary = _recon_summary(rows)
        report = {"ok": True, "target": normalized, "at": _iso(), "profileId": name,
                  "local": len(_recon_local_rows(data, name)), "remote": len(remote),
                  **summary, "matchedByTitle": sum(row["matchedBy"] == "title" for row in rows),
                  "matchedBySku": sum(row["matchedBy"] == "sku" for row in rows),
                  "matchedById": sum(row["matchedBy"] == "id" for row in rows),
                  "rows": rows}
        return jsonify(report)

    @app.post("/api/maintenance/retire/<target>")
    def node_maintenance_retire(target: str):
        body = _body()
        apply_now = _s(body.get("confirm")) == "APPLY"
        data = load()
        name = _s(body.get("profileId")) or _s(data.get("active_profile"))
        profile = (data.get("profiles") or {}).get(name) or {}
        try:
            key = dest_key(target)
            rows = core.destination_remote_rows(key)
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400
        report = core.build_destination_report(name, key, profile, rows)
        extra = report.get("lists", {}).get("extra", [])
        settings = data.get("ui_settings") if isinstance(data.get("ui_settings"), dict) else {}
        retire = settings.get("retire") if isinstance(settings.get("retire"), dict) else {}
        max_count = max(1, _int(retire.get("maxCount"), 100))
        max_pct = max(1, min(100, _int(retire.get("maxPct"), 25)))
        mode = _s(body.get("action") or body.get("mode") or retire.get("mode") or "report")
        pct = round(len(extra) * 100 / max(1, len(rows)), 2)
        if not apply_now or mode == "report":
            return ok(preview=True, candidates=extra, count=len(extra), mode=mode,
                      percent=pct, safety={"maxCount": max_count, "maxPct": max_pct},
                      message=f"{len(extra)} محصول در مقصد هست که در منبع نیست. "
                              "برای اجرا confirm=APPLY بفرستید.")
        if len(extra) > max_count or pct > max_pct:
            return jsonify(ok=False, error="ترمز ایمنی بازنشستگی فعال شد.", count=len(extra),
                           percent=pct, maxCount=max_count, maxPct=max_pct), 409
        changed, failed = 0, []
        for row in extra:
            item_id = _s(row.get("id"))
            try:
                if key == "woocommerce":
                    if mode in {"trash", "delete"}:
                        core.woo_request("DELETE", f"products/{item_id}?force=false")
                    elif mode in {"outofstock", "out-of-stock", "stock"}:
                        core.woo_request("PUT", f"products/{item_id}",
                                         {"manage_stock": True, "stock_quantity": 0,
                                          "stock_status": "outofstock"})
                    else:
                        core.woo_request("PUT", f"products/{item_id}", {"status": "draft"})
                else:
                    core.basalam_request("PATCH", f"/v1/products/{item_id}",
                                             json_data={"status": 4184 if mode in {"archive", "trash", "delete"} else 3790})
                changed += 1
            except Exception as exc:  # noqa: BLE001
                failed.append({"id": item_id, "error": str(exc)[:400]})
        return ok(preview=False, mode=mode, count=len(extra), changed=changed,
                  failed=failed, failedCount=len(failed), percent=pct)

    @app.post("/api/maintenance/recon-unified")
    @app.post("/api/maintenance/recon-unified/apply")
    def node_recon_unified():
        """Compare and optionally synchronize every configured destination account."""
        body = _body()
        apply_now = request.path.endswith("/apply") and _s(body.get("confirm")) == "APPLY"
        data = load()
        wanted = _s(body.get("profileId"))
        local_all = _recon_local_rows(data, wanted)
        eligible = [row for row in local_all if _has_code_suffix(row["title"])]
        accounts: list[dict[str, Any]] = []
        woo = data.get("woocommerce") if isinstance(data.get("woocommerce"), dict) else {}
        if woo.get("url") and woo.get("consumer_key") and woo.get("consumer_secret"):
            accounts.append({"target": "woo", "key": "default", "name": "ووکامرس",
                             "pricePercent": _num(woo.get("price_percent"))})
        for shop in _basalam_shop_configs():
            if shop.get("token") and shop.get("vendor_id"):
                cfg = shop.get("cfg") or {}
                pct = _num(cfg.get("price_val")) if _s(cfg.get("price_mode")) == "percent" else 0
                accounts.append({"target": "basalam", "key": shop["id"],
                                 "name": "باسلام — " + shop["name"],
                                 "pricePercent": pct, "shop": shop})

        rows: list[dict[str, Any]] = []
        failures: list[dict[str, Any]] = []
        for account in accounts:
            try:
                if account["target"] == "woo":
                    remote, _ = _destination_rows("woocommerce", "all")
                else:
                    remote, _ = _destination_rows("basalam", account["key"])
                rows.extend(_recon_account(
                    local_all, remote, account["target"], account["key"], account["name"],
                    account.get("pricePercent", 0), account["target"] == "basalam", True))
            except Exception as exc:  # noqa: BLE001
                message = str(exc)[:600]
                failures.append({"account": account["name"], "error": message})
                for local in eligible:
                    rows.append({"target": account["target"], "accountKey": account["key"],
                                 "accountName": account["name"],
                                 "pricePercent": account.get("pricePercent", 0),
                                 "profileId": local["profile_id"], "profileName": local["profile_name"],
                                 "sourceKey": local["source_key"], "bucket": "unreachable",
                                 "title": local["title"], "remoteTitle": "", "remoteId": None,
                                 "sourcePrice": local["price"] or None, "expectedPrice": None,
                                 "remotePrice": None, "delta": None, "matchedBy": "none",
                                 "status": "unreachable", "why": "مقصد پاسخ نداد: " + message,
                                 "duplicateCount": 0})

        actions: list[dict[str, Any]] = []
        for row in rows:
            if row["bucket"] == "priceDiff" and row.get("remoteId") and row.get("expectedPrice"):
                actions.append({"kind": "updatePrice", **{key: row.get(key) for key in
                                ("target", "accountKey", "accountName", "profileId", "sourceKey",
                                 "title", "remoteId")}, "fromPrice": row.get("remotePrice"),
                                "toPrice": row.get("expectedPrice")})
            elif row["bucket"] == "missing" and row.get("profileId") and row.get("sourceKey"):
                actions.append({"kind": "create", **{key: row.get(key) for key in
                                ("target", "accountKey", "accountName", "profileId", "sourceKey",
                                 "title", "remoteId")}, "fromPrice": None,
                                "toPrice": row.get("expectedPrice")})
        limit = max(1, min(1000, _int(body.get("limit"), 200)))
        actions = actions[:limit]
        changed = 0
        failed: list[dict[str, Any]] = []

        def remember(action: dict[str, Any], remote_id: Any) -> None:
            if _int(remote_id) <= 0:
                return
            profile = (data.get("profiles") or {}).get(action["profileId"])
            if not isinstance(profile, dict):
                return
            product = next((item for item in profile.get("saved_products") or []
                            if isinstance(item, dict) and
                            _s(item.get("source_key") or item.get("sourceKey") or
                               core.product_identity_key(item)) == action["sourceKey"]), None)
            if not product:
                return
            maps = product.setdefault("destination_maps", {})
            if isinstance(maps, dict):
                maps[f"{action['target']}:{action['accountKey']}"] = {
                    "id": _int(remote_id), "updated_at": int(time.time())}
            map_target = "woocommerce" if action["target"] == "woo" else "basalam"
            profile_map = profile.setdefault("remote_map", {})
            if isinstance(profile_map, dict) and action["accountKey"] == "default":
                profile_map.setdefault(map_target, {})[action["sourceKey"]] = {
                    "id": _int(remote_id), "updated_at": int(time.time())}

        if apply_now:
            local_index = {(row["profile_id"], row["source_key"]): row for row in local_all}
            for action in actions:
                try:
                    remote_id = action.get("remoteId")
                    if action["kind"] == "updatePrice":
                        if action["target"] == "woo":
                            core.woo_request("PUT", f"products/{remote_id}",
                                             {"regular_price": str(_int(action["toPrice"]))})
                        else:
                            context, _shop = _shop_context(action["accountKey"])
                            with context:
                                core.basalam_request("PATCH", f"/v1/products/{remote_id}",
                                                         json_data={"primary_price": _int(action["toPrice"])})
                    else:
                        source = local_index.get((action["profileId"], action["sourceKey"]))
                        if not source:
                            raise ValueError("محصول منبع پیدا نشد")
                        product = copy.deepcopy(source["product"])
                        if action["target"] == "woo":
                            if action.get("toPrice"):
                                product["price"] = str(_int(action["toPrice"]))
                            result = core.woo_send_one(product,
                                                       _s(product.get("destination_status") or "draft"), True)
                        else:
                            context, shop = _shop_context(action["accountKey"])
                            with context:
                                result = core.basalam_send_one(product, shop.get("cfg"))
                        remote_id = result.get("id") if isinstance(result, dict) else None
                    remember(action, remote_id)
                    changed += 1
                except Exception as exc:  # noqa: BLE001
                    failed.append({"title": action.get("title"),
                                   "account": action.get("accountName"),
                                   "error": str(exc)[:500]})
            save(data)

        summary = _recon_summary(rows)
        account_rows = []
        for account in accounts:
            selected = [row for row in rows if row["target"] == account["target"] and
                        _s(row["accountKey"]) == _s(account["key"])]
            account_rows.append({"key": f"{account['target']}:{account['key']}",
                                 "target": account["target"], "accountKey": account["key"],
                                 "name": account["name"],
                                 "pricePercent": account.get("pricePercent", 0),
                                 **_recon_summary(selected)})
        profiles = []
        for pid in dict.fromkeys(row["profileId"] for row in rows if row.get("profileId")):
            selected = [row for row in rows if row.get("profileId") == pid]
            profiles.append({"profileId": pid, "profileName": selected[0].get("profileName") or pid,
                             **_recon_summary(selected)})
        return jsonify({"ok": not failures and not failed, "dryRun": not apply_now,
                        "at": _iso(), "profileId": wanted, "local": len(eligible),
                        "localAll": len(local_all), "skippedNoCode": len(local_all) - len(eligible),
                        "accounts": len(accounts), **summary, "planned": len(actions),
                        "actions": actions[:200], "changed": changed, "applied": changed,
                        "failed": failed[:20], "failures": failures,
                        "accountsBreakdown": account_rows, "profiles": profiles, "rows": rows})

    @app.post("/api/maintenance/photo-fix")
    def node_photo_fix():
        body = _body()
        apply_now = _s(body.get("confirm")) == "APPLY"
        data = load()
        name = _s(body.get("profileId")) or _s(data.get("active_profile"))
        locals_ = _recon_local_rows(data, name)
        try:
            remote = core.destination_remote_rows("woocommerce")
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400
        by_id = {_int(row.get("id")): row for row in remote if isinstance(row, dict) and _int(row.get("id"))}
        items: list[dict[str, Any]] = []
        for local in locals_:
            product = local["product"]
            image = _s(product.get("image"))
            if not image and isinstance(product.get("images"), list):
                image = next((_s(value) for value in product["images"] if _s(value)), "")
            remote_id = _mapped_remote_id(local, "woo", "default")
            row = by_id.get(remote_id)
            images = row.get("images") if isinstance(row, dict) and isinstance(row.get("images"), list) else []
            if image and row is not None and not images:
                items.append({"id": remote_id, "title": local["title"], "image": image,
                              "profileId": local["profile_id"], "sourceKey": local["source_key"]})
        if not apply_now:
            return ok(dryRun=True, items=items[:200], count=len(items), profile=name,
                      message=f"{len(items)} محصول ووکامرس بدون تصویر پیدا شد.")
        changed, failed = 0, []
        for item in items:
            try:
                core.woo_request("PUT", f"products/{item['id']}",
                                 {"images": [{"src": item["image"]}]})
                changed += 1
            except Exception as exc:  # noqa: BLE001
                failed.append({**item, "error": str(exc)[:500]})
        return ok(dryRun=False, items=items[:200], count=len(items), profile=name,
                  changed=changed, failed=failed[:20], failedCount=len(failed))

    @app.post("/api/maintenance/recon/<target>")
    def node_maintenance_recon(target: str):
        body = _body()
        data = load()
        name = _s(body.get("profileId")) or _s(data.get("active_profile"))
        profile = (data.get("profiles") or {}).get(name)
        if not isinstance(profile, dict):
            return jsonify(ok=False, error="پروفایل پیدا نشد."), 404
        try:
            key = dest_key(target)
            rows, _shops = _destination_rows(key, _s(body.get("shopId")) or "all")
            report = core.build_destination_report(name, key, profile, rows)
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400
        return ok(target=key, profileId=name, report=report,
                  counts=report.get("counts", {}), lists=report.get("lists", {}))

    @app.post("/api/maintenance/rebuild/<target>")
    def node_maintenance_rebuild(target: str):
        body = _body()
        data = load()
        name = _s(body.get("profileId")) or _s(data.get("active_profile"))
        profile = (data.get("profiles") or {}).get(name)
        if not isinstance(profile, dict):
            return jsonify(ok=False, error="پروفایل پیدا نشد."), 404
        try:
            key = dest_key(target)
            rows, _shops = _destination_rows(key, _s(body.get("shopId")) or "all")
            report = core.build_destination_report(name, key, profile, rows)
            learned = report.get("learned") if isinstance(report.get("learned"), dict) else {}
            remote_map = profile.setdefault("remote_map", {})
            if isinstance(remote_map, dict):
                remote_map[key] = dict(learned)
            save(data)
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400
        return ok(target=key, profileId=name, rebuilt=len(learned), map=learned,
                  report=report)

    @app.post("/api/maintenance/bulk/<target>")
    def node_maintenance_bulk(target: str):
        body = _body()
        apply_now = _s(body.get("confirm")) == "APPLY"
        query = _s(body.get("query")).strip().lower()
        try:
            key = dest_key(target)
            raw_rows, _shops = _destination_rows(key, _s(body.get("shopId")) or "all")
            views = [_destination_view(row, key) for row in raw_rows]
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400
        if query:
            views = [row for row in views if query in
                     (_s(row.get("title")) + " " + _s(row.get("sku")) + " " +
                      _s(row.get("id"))).lower()]
        views = views[:200]
        prefix, suffix = _s(body.get("prefix")), _s(body.get("suffix"))
        price_pct = _num(body.get("pricePercent"))
        stock = body.get("stock")
        items, failed, changed = [], [], 0
        for view in views:
            item_id, shop_id = _s(view.get("id")), _s(view.get("shopId"))
            payload: dict[str, Any] = {}
            if prefix or suffix:
                payload["name" if key == "woocommerce" else "title"] = (
                    prefix + _s(view.get("title")) + suffix)
            if price_pct:
                new_price = max(0, int(round(_num(view.get("price")) *
                                             (1 + price_pct / 100))))
                payload["regular_price" if key == "woocommerce" else "price"] = (
                    str(new_price) if key == "woocommerce" else new_price)
            if stock not in (None, ""):
                payload["stock_quantity" if key == "woocommerce" else "stock"] = _int(stock)
            row = {"id": item_id, "shopId": shop_id or "default",
                   "title": view.get("title"), "changes": payload}
            if not payload:
                row["skipped"] = True
            elif apply_now:
                try:
                    if key == "woocommerce":
                        core.woo_request("PUT", f"products/{item_id}", payload)
                    else:
                        context, _shop = _shop_context(shop_id)
                        with context:
                            core.basalam_request("PATCH", f"/v1/products/{item_id}",
                                                     json_data=payload)
                    row["done"] = True
                    changed += 1
                except Exception as exc:  # noqa: BLE001
                    row["error"] = str(exc)[:400]
                    failed.append(row)
            items.append(row)
        return ok(target=key, dryRun=not apply_now, count=len(items), total=len(items),
                  changed=changed, failed=failed, failedCount=len(failed), items=items,
                  message=("پیش‌نمایش آماده شد؛ تغییری اعمال نشد."
                           if not apply_now else f"{changed} محصول ویرایش شد."))

    # ── AI panels ────────────────────────────────────────────────────────
    @app.post("/api/ai/chat")
    def node_ai_chat():
        body = _body()
        messages = body.get("messages")
        if isinstance(messages, list) and messages:
            prompt = "\n".join(
                _s(m.get("content")) for m in messages if isinstance(m, dict)
            )
        else:
            prompt = _s(body.get("prompt") or body.get("message"))
        if not prompt.strip():
            return jsonify(ok=False, error="متن پیام خالی است."), 400
        model_key = _s(body.get("modelKey") or body.get("model"))
        provider, _, model = model_key.partition("::")
        try:
            answer = core.ai_chat(prompt, provider, model)
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400
        return ok(reply=answer, content=answer,
                  message={"role": "assistant", "content": answer})

    @app.route("/api/ai/diagnose", methods=["GET", "POST"])
    def node_ai_diagnose():
        data = load()
        ai = data.get("ai") or {}
        providers = data.get("ai_providers") or {}
        checks = [
            {"name": "کلید API", "ok": bool(ai.get("api_key")) or bool(providers),
             "detail": "کلید ثبت شده است" if ai.get("api_key") or providers
                       else "هیچ کلیدی ثبت نشده است"},
            {"name": "مدل", "ok": bool(ai.get("model")),
             "detail": _s(ai.get("model")) or "مدلی انتخاب نشده"},
            {"name": "آدرس سرویس", "ok": bool(ai.get("endpoint")),
             "detail": _s(ai.get("endpoint")) or "—"},
        ]
        if all(c["ok"] for c in checks):
            try:
                reply = core.ai_chat("سلام. فقط بنویس: OK")
                checks.append({"name": "تماس آزمایشی", "ok": True,
                               "detail": _s(reply)[:120]})
            except Exception as exc:  # noqa: BLE001
                checks.append({"name": "تماس آزمایشی", "ok": False,
                               "detail": str(exc)[:200]})
        return ok(checks=checks, healthy=all(c["ok"] for c in checks))

    def _leaderboard(votes: dict[str, Any]) -> list[dict[str, Any]]:
        items = [{"model": key, "key": key, "wins": _int(value.get("wins", value.get("up"))),
                  "appearances": _int(value.get("appearances", value.get("up"))) + _int(value.get("down")),
                  "up": _int(value.get("up", value.get("wins"))),
                  "down": _int(value.get("down")),
                  "score": _int(value.get("wins", value.get("up"))) - _int(value.get("down"))}
                 for key, value in votes.items() if isinstance(value, dict)]
        items.sort(key=lambda item: (-item["score"], -item["wins"], item["model"]))
        return items

    @app.post("/api/ai/vote")
    def node_ai_vote():
        body = _body()
        data = load()
        votes = data.setdefault("ai_votes", {})
        winner = _s(body.get("winner"))
        candidates = [_s(x) for x in body.get("candidates") or [] if _s(x)]
        key = winner or _s(body.get("modelKey") or body.get("model"))
        if not key:
            return jsonify(ok=False, error="مدل مشخص نشده است."), 400
        if not candidates:
            candidates = [key]
        for candidate in dict.fromkeys(candidates):
            row = votes.setdefault(candidate, {"wins": 0, "appearances": 0, "up": 0, "down": 0})
            row["appearances"] = _int(row.get("appearances")) + 1
            if candidate == key:
                row["wins"] = _int(row.get("wins")) + 1
                row["up"] = _int(row.get("up")) + 1
            elif _s(body.get("vote")) == "down":
                row["down"] = _int(row.get("down")) + 1
        save(data)
        board = _leaderboard(votes)
        return ok(votes=votes, model=key, leaderboard=board)

    @app.get("/api/ai/leaderboard")
    def node_ai_leaderboard():
        items = _leaderboard(load().get("ai_votes") or {})
        return ok(items=items, leaderboard=items)

    @app.get("/api/ai/chat-models")
    @app.get("/api/agent/models")
    def node_ai_models():
        data = load()
        models = []
        providers = data.get("ai_providers") or {}
        if hasattr(core, "normalize_ai_providers"):
            try:
                providers = core.normalize_ai_providers(providers)
            except Exception:  # noqa: BLE001
                providers = data.get("ai_providers") or {}
        for pid, provider in (providers or {}).items():
            if not isinstance(provider, dict):
                continue
            for model in provider.get("models") or []:
                mid = _s(model.get("id") if isinstance(model, dict) else model)
                if mid:
                    models.append({"key": f"{pid}::{mid}", "provider": pid,
                                   "id": mid, "label": f"{pid} · {mid}"})
        ai = data.get("ai") or {}
        if not models and ai.get("model"):
            pid = _s(ai.get("provider")) or "default"
            models.append({"key": f"{pid}::{ai['model']}", "provider": pid,
                           "id": _s(ai["model"]),
                           "label": f"{pid} · {ai['model']}"})
        return ok(models=models, items=models)

    # AI batch test runs — persistent checkpoints, real provider/model calls.
    AI_RUN: dict[str, Any] = {}
    AI_RUN_LOCK = threading.RLock()
    # Reset is allowed while a provider call is in flight. Tombstones prevent
    # that worker from resurrecting the cleared checkpoint when it returns.
    AI_CANCELLED_RUNS: set[str] = set()

    def _ai_run_models(only_candidates: bool = False) -> list[dict[str, str]]:
        data = load()
        providers = data.get("ai_providers") or {}
        try:
            providers = core.normalize_ai_providers(providers)
        except Exception:  # noqa: BLE001
            providers = providers if isinstance(providers, dict) else {}
        wanted = {_s(value) for value in data.get("ai_candidates") or []}
        rows: list[dict[str, str]] = []
        for pid, provider in providers.items():
            if not isinstance(provider, dict) or provider.get("enabled") is False:
                continue
            for raw in provider.get("models") or []:
                if isinstance(raw, dict):
                    if raw.get("enabled") is False:
                        continue
                    model = _s(raw.get("id") or raw.get("name"))
                else:
                    model = _s(raw)
                key = f"{pid}::{model}"
                if model and (not only_candidates or key in wanted or model in wanted):
                    rows.append({"key": key, "provider": _s(pid), "model": model,
                                 "providerName": _s(provider.get("name") or pid)})
        ai = data.get("ai") if isinstance(data.get("ai"), dict) else {}
        if not rows and _s(ai.get("model")):
            pid, model = _s(ai.get("provider")) or "default", _s(ai.get("model"))
            rows.append({"key": f"{pid}::{model}", "provider": pid,
                         "model": model, "providerName": pid})
        return rows

    def _ai_run_save(run: dict[str, Any]) -> bool:
        with AI_RUN_LOCK:
            run_id = _s(run.get("id"))
            if run_id and run_id in AI_CANCELLED_RUNS:
                AI_CANCELLED_RUNS.discard(run_id)
                return False
            AI_RUN.clear()
            AI_RUN.update(copy.deepcopy(run))
            data = load()
            data["ai_test_run"] = copy.deepcopy(run)
            save(data)
            return True

    def _ai_run_get() -> Optional[dict[str, Any]]:
        with AI_RUN_LOCK:
            if AI_RUN:
                return copy.deepcopy(AI_RUN)
            stored = load().get("ai_test_run")
            if isinstance(stored, dict):
                AI_RUN.update(copy.deepcopy(stored))
                return copy.deepcopy(stored)
        return None

    def _ai_test_message(row: dict[str, str], prompt: str) -> dict[str, Any]:
        started = time.monotonic()
        try:
            answer = core.ai_chat(prompt, row["provider"],
                                  re.sub(r"::k\d+$", "", row["model"]))
            return {**row, "ok": True, "text": _s(answer), "prompt": prompt,
                    "latencyMs": int((time.monotonic() - started) * 1000)}
        except Exception as exc:  # noqa: BLE001
            return {**row, "ok": False, "text": "", "prompt": prompt,
                    "latencyMs": int((time.monotonic() - started) * 1000),
                    "error": str(exc)[:1200]}

    def _ai_test_category(row: dict[str, str], title: str,
                          categories: list[dict[str, Any]]) -> dict[str, Any]:
        if not title:
            return {"ok": False, "skipped": True, "error": "عنوان دسته خالی است."}
        names = [_s(value.get("path") or value.get("name"))
                 for value in categories[:350] if isinstance(value, dict) and
                 _s(value.get("path") or value.get("name"))]
        if not names:
            return {"ok": False, "skipped": True, "error": "فهرست دسته در دسترس نیست."}
        prompt = ("برای این عنوان فقط JSON معتبر با کلید category بده؛ مقدار باید دقیقاً "
                  "یکی از گزینه‌ها باشد.\nعنوان: " + title + "\nگزینه‌ها: " + " | ".join(names))
        result = _ai_test_message(row, prompt)
        if not result.get("ok"):
            return {"ok": False, "error": result.get("error"), "text": result.get("text", "")}
        suggestion = _s(result.get("text")).strip()
        try:
            parsed = core.ai_parse_json_object(suggestion)
            suggestion = _s(parsed.get("category") or parsed.get("categoryName") or suggestion)
        except Exception:  # noqa: BLE001
            pass
        found = core.ai_match_category(suggestion, categories)
        if not found:
            return {"ok": False, "error": "پاسخ با دسته معتبر منطبق نشد.",
                    "text": result.get("text"), "suggestion": suggestion}
        return {"ok": True, "categoryId": _int(found.get("id")),
                "categoryName": _s(found.get("name") or suggestion),
                "categoryPath": _s(found.get("path") or found.get("name")),
                "text": result.get("text")}

    def _ai_test_worker(run_id: str) -> None:
        run = _ai_run_get()
        if not run or run.get("id") != run_id:
            return
        try:
            run.update(status="running", phase="testing", error="", updatedAt=_iso())
            if not _ai_run_save(run):
                return
            categories = []
            if run.get("categoryTitle"):
                try:
                    categories = core.ai_load_category_rows()
                except Exception:  # noqa: BLE001
                    categories = []
            models = run.get("models") if isinstance(run.get("models"), list) else []
            results = ((run.get("result") or {}).get("results")
                       if isinstance(run.get("result"), dict) else [])
            results = list(results) if isinstance(results, list) else []
            cursor = min(len(models), max(0, _int(run.get("cursor"))))
            delay = max(0, min(60000, _int(run.get("delayMs")))) / 1000
            for index in range(cursor, len(models)):
                latest = _ai_run_get() or run
                if latest.get("stopRequested"):
                    run.update(status="paused", phase="paused", cursor=index,
                               processed=index, updatedAt=_iso())
                    _ai_run_save(run)
                    return
                row = models[index]
                run.update(currentKey=row.get("key"), currentStartedAt=_iso(),
                           processed=index, cursor=index, updatedAt=_iso())
                if not _ai_run_save(run):
                    return
                result = _ai_test_message(row, run["prompt"])
                if run.get("categoryTitle"):
                    result["categoryTitle"] = run["categoryTitle"]
                    result["categoryResult"] = _ai_test_category(
                        row, run["categoryTitle"], categories)
                results = [old for old in results if old.get("key") != row.get("key")]
                results.append(result)
                payload = {"ok": True, "prompt": run["prompt"],
                           "categoryTitle": run.get("categoryTitle", ""),
                           "results": results, "total": len(models),
                           "tested": index + 1, "okCount": sum(bool(x.get("ok")) for x in results),
                           "failed": sum(not bool(x.get("ok")) for x in results),
                           "categoryListAvailable": bool(categories), "done": False}
                run.update(result=payload, cursor=index + 1, processed=index + 1,
                           updatedAt=_iso(), currentKey="")
                if not _ai_run_save(run):
                    return
                if delay and index + 1 < len(models):
                    time.sleep(delay)
            successful = [_s(row.get("key")) for row in results if row.get("ok")]
            data = load()
            existing = [_s(value) for value in data.get("ai_candidates") or [] if _s(value)]
            added = [key for key in successful if key and key not in existing]
            data["ai_candidates"] = list(dict.fromkeys([*existing, *successful]))
            payload = {**(run.get("result") or {}), "done": True,
                       "autoCandidatesAdded": added, "tested": len(results),
                       "total": len(models)}
            run.update(status="done", phase="done", cursor=len(models),
                       processed=len(models), result=payload, finishedAt=_iso(),
                       updatedAt=_iso(), currentKey="")
            data["ai_test_results"] = {**payload, "at": _iso()}
            save(data)
            _ai_run_save(run)
        except Exception as exc:  # noqa: BLE001
            run = _ai_run_get() or run
            run.update(status="failed", phase="failed", error=str(exc)[:1000],
                       finishedAt=_iso(), updatedAt=_iso())
            _ai_run_save(run)

    @app.post("/api/ai/test-runs")
    def node_ai_test_start():
        body = _body()
        prompt = _s(body.get("prompt")).strip() or "Reply with exactly: SCRAPER4_OK"
        title = _s(body.get("categoryTitle")).strip()
        existing = _ai_run_get()
        if existing and existing.get("status") in {"queued", "running"}:
            return ok(run=existing, existing=True)
        models = _ai_run_models(bool(body.get("onlyCandidates")))
        if not models:
            return jsonify(ok=False, error="هیچ مدل فعالی برای آزمایش ثبت نشده است."), 400
        run = {"id": "ai-" + secrets.token_hex(8), "status": "queued", "phase": "queued",
               "prompt": prompt, "categoryTitle": title, "onlyCandidates": bool(body.get("onlyCandidates")),
               "delayMs": max(0, min(60000, _int(body.get("delayMs")))),
               "models": models, "total": len(models), "processed": 0, "cursor": 0,
               "stopRequested": False, "createdAt": _iso(), "updatedAt": _iso(),
               "result": {"ok": True, "prompt": prompt, "categoryTitle": title,
                          "results": [], "total": len(models), "tested": 0, "done": False},
               "error": ""}
        _ai_run_save(run)
        threading.Thread(target=_ai_test_worker, args=(run["id"],),
                         name="ai-model-tests", daemon=True).start()
        return ok(run=run, existing=False), 202

    @app.get("/api/ai/test-runs/current")
    def node_ai_test_current():
        return ok(run=_ai_run_get())

    @app.post("/api/ai/test-runs/control")
    def node_ai_test_control():
        action = "resume" if _s(_body().get("action")) == "resume" else "stop"
        run = _ai_run_get()
        if not run:
            return ok(run=None)
        if action == "stop" and run.get("status") in {"queued", "running"}:
            run.update(stopRequested=True, phase="stopping", updatedAt=_iso())
            _ai_run_save(run)
        elif action == "resume" and run.get("status") in {"paused", "failed"}:
            run.update(stopRequested=False, status="queued", phase="queued", error="", updatedAt=_iso())
            _ai_run_save(run)
            threading.Thread(target=_ai_test_worker, args=(run["id"],),
                             name="ai-model-tests", daemon=True).start()
        return ok(run=_ai_run_get())

    @app.post("/api/ai/test-runs/reset")
    def node_ai_test_reset():
        run = _ai_run_get()
        with AI_RUN_LOCK:
            run_id = _s((run or {}).get("id"))
            if run_id and (run or {}).get("status") in {"queued", "running"}:
                AI_CANCELLED_RUNS.add(run_id)
            AI_RUN.clear()
            data = load()
            data.pop("ai_test_run", None)
            save(data)
        return ok(run=None)

    @app.post("/api/ai/test-runs/retry")
    def node_ai_test_retry():
        body = _body()
        key, part = _s(body.get("key")), _s(body.get("part"))
        run = _ai_run_get()
        if not run:
            return jsonify(ok=False, error="اجرای آزمایشی پیدا نشد."), 404
        row = next((value for value in run.get("models") or [] if value.get("key") == key), None)
        if not row:
            return jsonify(ok=False, error="مدل پیدا نشد."), 404
        payload = dict(run.get("result") or {})
        results = list(payload.get("results") or [])
        old = next((value for value in results if value.get("key") == key), {**row})
        if part == "category":
            try:
                categories = core.ai_load_category_rows()
            except Exception:  # noqa: BLE001
                categories = []
            old["categoryResult"] = _ai_test_category(
                row, _s(run.get("categoryTitle")), categories)
        else:
            replacement = _ai_test_message(row, _s(run.get("prompt")))
            category = old.get("categoryResult")
            old = replacement
            if category is not None:
                old["categoryResult"] = category
        results = [value for value in results if value.get("key") != key] + [old]
        payload["results"] = results
        run["result"] = payload
        run["updatedAt"] = _iso()
        _ai_run_save(run)
        return jsonify({**payload, "ok": True, "part": part})

    @app.get("/api/ai/test-results")
    def node_ai_test_results():
        result = load().get("ai_test_results")
        if not isinstance(result, dict):
            run = _ai_run_get()
            result = dict((run or {}).get("result") or {})
        return jsonify({**result, "ok": True, "items": result.get("results") or []})

    # ── agent: multi-step AI flows with real tools ───────────────────────
    # A run is a loop: ask the model what to do next, execute one tool, feed
    # the result back, repeat until it answers FINAL or maxSteps is reached.
    # State lives in memory (one run at a time) and is checkpointed so the
    # stop/resume buttons in the drawer actually work.
    AGENT: dict[str, Any] = {}
    AGENT_LOCK = threading.Lock()

    def agent_tools() -> dict[str, Any]:
        """Tools the agent may call. Each takes a string arg, returns text."""

        def t_profiles(_arg: str) -> str:
            rows = [profile_to_node(name, cfg) for name, cfg in
                    (load().get("profiles") or {}).items() if isinstance(cfg, dict)]
            return "\n".join(
                f"{p.get('id')}: {p.get('name')} ({p.get('url')})" for p in rows
            ) or "هیچ پروفایلی ثبت نشده است."

        def t_products(arg: str) -> str:
            name = _s(arg).strip() or _s(load().get("active_profile"))
            rows = profile_products(name)[:40]
            return "\n".join(
                f"- {_s(r.get('title'))} | {_s(r.get('price'))}" for r in rows
            ) or "محصولی ذخیره نشده است."

        def t_jobs(_arg: str) -> str:
            rows = live_tasks()[:20]
            return "\n".join(
                f"{_s(t.get('id'))}: {_s(t.get('status'))} {_int(t.get('percent'))}%"
                for t in rows) or "هیچ کاری در جریان نیست."

        def t_scrape(arg: str) -> str:
            pid = _s(arg).strip() or _s(load().get("active_profile"))
            if not pid:
                return "پروفایل مشخص نشده است."
            _start_scrape(pid)
            return f"استخراج پروفایل {pid} شروع شد."

        def t_fetch(arg: str) -> str:
            url = _s(arg).strip()
            if not url.startswith("http"):
                return "آدرس معتبر نیست."
            try:
                fetcher = core.Fetcher(load().get("network") or {})
                res = fetcher.get(url)
                text = core.clean_text(
                    core.BeautifulSoup(res.text[:200000], "html.parser")
                    .get_text(" ", strip=True))
                return text[:3000]
            except Exception as exc:  # noqa: BLE001
                return f"خطا در دریافت صفحه: {exc}"

        def t_stats(_arg: str) -> str:
            data = load()
            profiles = data.get("profiles") or {}
            total = sum(len(p.get("saved_products") or [])
                        for p in profiles.values() if isinstance(p, dict))
            return (f"پروفایل‌ها: {len(profiles)} · مجموع محصولات ذخیره‌شده: {total} "
                    f"· نسخه: {core.APP_VERSION}")

        return {
            "list_profiles": t_profiles, "list_products": t_products,
            "list_jobs": t_jobs, "start_scrape": t_scrape,
            "fetch_page": t_fetch, "stats": t_stats,
        }

    AGENT_TOOL_HELP = {
        "list_profiles": "فهرست پروفایل‌ها",
        "list_products": "محصولات ذخیره‌شدهٔ یک پروفایل (ورودی: نام پروفایل)",
        "list_jobs": "وضعیت کارهای در جریان",
        "start_scrape": "شروع استخراج یک پروفایل (ورودی: شناسهٔ پروفایل)",
        "fetch_page": "خواندن متن یک صفحهٔ وب (ورودی: آدرس)",
        "stats": "آمار کلی سامانه",
    }

    def agent_worker(run: dict[str, Any]) -> None:
        tools = agent_tools()
        allowed = [t for t in (run.get("tools") or list(tools)) if t in tools]
        if not allowed:
            allowed = list(tools)
        catalogue = "\n".join(f"- {t}: {AGENT_TOOL_HELP.get(t, '')}" for t in allowed)
        transcript: list[str] = []
        provider, _, model = _s(run.get("modelKey")).partition("::")
        provider = provider or _s(run.get("providerId"))
        model = model or _s(run.get("model"))
        try:
            for step in range(1, max(1, _int(run.get("maxSteps"), 6)) + 1):
                if run.get("stop"):
                    run["status"] = "paused"
                    run["log"].append("⏸ در checkpoint متوقف شد.")
                    return
                run["step"] = step
                prompt = (
                    "تو یک دستیار عملیاتی برای یک سامانهٔ استخراج محصول هستی.\n"
                    "ابزارهای موجود:\n" + catalogue + "\n\n"
                    "برای استفاده از ابزار دقیقاً یک خط بنویس:\n"
                    "TOOL: <نام ابزار> | <ورودی>\n"
                    "وقتی به پاسخ نهایی رسیدی بنویس:\n"
                    "FINAL: <پاسخ نهایی به فارسی>\n\n"
                    "خواستهٔ کاربر: " + _s(run.get("prompt")) + "\n\n"
                    + ("آنچه تا حالا انجام شده:\n" + "\n".join(transcript)
                       if transcript else "")
                )
                reply = _s(core.ai_chat(prompt, provider, model)).strip()
                run["log"].append(f"🤖 گام {step}: {reply[:400]}")
                final = re.search(r"FINAL:\s*(.+)", reply, re.S)
                if final:
                    run["result"] = final.group(1).strip()
                    run["status"] = "done"
                    return
                call = re.search(r"TOOL:\s*([a-z_]+)\s*(?:\|\s*(.*))?", reply)
                if not call:
                    run["result"] = reply
                    run["status"] = "done"
                    return
                name, arg = call.group(1), _s(call.group(2)).strip()
                if name not in tools:
                    observation = f"ابزار «{name}» وجود ندارد."
                else:
                    try:
                        observation = _s(tools[name](arg))[:3000]
                    except Exception as exc:  # noqa: BLE001
                        observation = f"خطای ابزار: {exc}"
                run["log"].append(f"🔧 {name}({arg}) → {observation[:300]}")
                transcript.append(f"گام {step}: {name}({arg}) نتیجه: {observation}")
            run["status"] = "done"
            run["result"] = run.get("result") or "به سقف گام‌ها رسید."
        except Exception as exc:  # noqa: BLE001
            run["status"] = "failed"
            run["error"] = str(exc)[:400]
        finally:
            run["finished_at"] = int(time.time())
            if run.get("status") not in ("paused",):
                history = load()
                rows = history.setdefault("agent_runs", [])
                if isinstance(rows, list):
                    rows.append({k: run.get(k) for k in
                                 ("id", "name", "prompt", "status", "result",
                                  "error", "started_at", "finished_at", "promptId")})
                    history["agent_runs"] = rows[-50:]
                    save(history)

    @app.get("/api/agent/tools")
    def node_agent_tools():
        return ok(tools=[{"id": k, "label": v} for k, v in AGENT_TOOL_HELP.items()],
                  items=[{"id": k, "label": v} for k, v in AGENT_TOOL_HELP.items()])

    @app.get("/api/agent/runs")
    def node_agent_runs():
        rows = load().get("agent_runs") or []
        return ok(items=list(reversed(rows)), runs=list(reversed(rows)))

    def _agent_start(body: dict[str, Any]):
        prompt = _s(body.get("prompt")).strip()
        if not prompt:
            return jsonify(ok=False, error="متن درخواست خالی است."), 400
        with AGENT_LOCK:
            if AGENT.get("status") in ("running", "queued"):
                return ok(run=dict(AGENT), existing=True)
            AGENT.clear()
            AGENT.update({
                "id": "agent-" + _s(int(time.time())),
                "name": _s(body.get("name")) or "اجرای دستی",
                "prompt": prompt, "promptId": _s(body.get("promptId")),
                "tools": body.get("tools") or [],
                "maxSteps": _int(body.get("maxSteps"), 6) or 6,
                "providerId": _s(body.get("providerId")),
                "model": _s(body.get("model")),
                "modelKey": _s(body.get("modelKey")),
                "status": "running", "step": 0, "log": [], "result": "",
                "error": "", "stop": False, "started_at": int(time.time()),
            })
        threading.Thread(target=agent_worker, args=(AGENT,),
                         name="ui-agent", daemon=True).start()
        return ok(run=dict(AGENT))

    @app.post("/api/agent/runs")
    def node_agent_run_start():
        return _agent_start(_body())

    @app.get("/api/agent/runs/current")
    def node_agent_current():
        return ok(run=dict(AGENT) if AGENT else None)

    @app.post("/api/agent/runs/control")
    def node_agent_control():
        action = _s(_body().get("action"))
        if not AGENT:
            return ok(run=None)
        if action == "stop":
            AGENT["stop"] = True
            AGENT["status"] = "stopping"
        elif action == "resume" and AGENT.get("status") == "paused":
            AGENT["stop"] = False
            AGENT["status"] = "running"
            threading.Thread(target=agent_worker, args=(AGENT,),
                             name="ui-agent", daemon=True).start()
        return ok(run=dict(AGENT))

    @app.post("/api/agent/runs/reset")
    def node_agent_reset():
        AGENT["stop"] = True
        AGENT.clear()
        return ok(run=None)

    @app.get("/api/agent/runs/<path:run_id>")
    def node_agent_run(run_id: str):
        if AGENT.get("id") == run_id:
            return ok(run=dict(AGENT))
        row = next((r for r in load().get("agent_runs") or []
                    if isinstance(r, dict) and r.get("id") == run_id), None)
        return ok(run=row, id=run_id)

    @app.delete("/api/agent/runs/<path:run_id>")
    def node_agent_run_delete(run_id: str):
        data = load()
        rows = [r for r in data.get("agent_runs") or []
                if isinstance(r, dict) and r.get("id") != run_id]
        data["agent_runs"] = rows
        save(data)
        return ok(deleted=run_id)

    # Saved prompts (reusable agent tasks).
    @app.get("/api/agent/prompts")
    def node_agent_prompts():
        return ok(prompts=load().get("agent_prompts") or [],
                  items=load().get("agent_prompts") or [])

    @app.post("/api/agent/prompts")
    def node_agent_prompt_save():
        body = _body()
        text = _s(body.get("prompt")).strip()
        if not text:
            return jsonify(ok=False, error="متن پرامپت خالی است."), 400
        data = load()
        rows = data.get("agent_prompts")
        if not isinstance(rows, list):
            rows = []
        pid = _s(body.get("id")) or "p" + _s(int(time.time()))
        row = {"id": pid, "name": _s(body.get("name")) or "پرامپت",
               "prompt": text, "tools": body.get("tools") or [],
               "maxSteps": _int(body.get("maxSteps"), 6) or 6,
               "updated_at": int(time.time())}
        rows = [r for r in rows if isinstance(r, dict) and r.get("id") != pid]
        rows.append(row)
        data["agent_prompts"] = rows
        save(data)
        return ok(prompt=row, prompts=rows)

    @app.get("/api/agent/prompts/<path:prompt_id>")
    def node_agent_prompt(prompt_id: str):
        row = next((r for r in load().get("agent_prompts") or []
                    if isinstance(r, dict) and r.get("id") == prompt_id), None)
        return ok(prompt=row, id=prompt_id)

    @app.delete("/api/agent/prompts/<path:prompt_id>")
    def node_agent_prompt_delete(prompt_id: str):
        data = load()
        data["agent_prompts"] = [
            r for r in data.get("agent_prompts") or []
            if isinstance(r, dict) and r.get("id") != prompt_id]
        save(data)
        return ok(deleted=prompt_id)

    @app.get("/api/agent/templates")
    def node_agent_templates():
        return ok(templates=[
            {"id": 1, "name": "گزارش وضعیت",
             "prompt": "وضعیت کلی سامانه، پروفایل‌ها و کارهای در جریان را خلاصه کن."},
            {"id": 2, "name": "بررسی کیفیت داده",
             "prompt": "محصولات پروفایل فعال را بررسی کن و بگو کدام‌ها عنوان یا "
                       "قیمت مشکوک دارند."},
            {"id": 3, "name": "تحلیل یک صفحه",
             "prompt": "این آدرس را باز کن و بگو چه محصولاتی دارد: "},
        ])

    @app.get("/api/agent/tasks")
    def node_agent_tasks():
        return ok(tasks=load().get("agent_prompts") or [])

    # ── Basalam chat panel ───────────────────────────────────────────────
    @app.get("/api/basalam/chats")
    def node_basalam_chats():
        limit = min(100, _int(request.args.get("limit"), 50) or 50)
        try:
            payload = core.basalam_request(
                "GET", "/v1/chats", params={"per_page": limit})
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400
        rows = payload if isinstance(payload, list) else (
            payload.get("data") or payload.get("items") or []
            if isinstance(payload, dict) else [])
        return ok(items=rows)

    @app.get("/api/basalam/chats/<path:chat_id>/messages")
    def node_basalam_chat_messages(chat_id: str):
        limit = min(100, _int(request.args.get("limit"), 50) or 50)
        try:
            payload = core.basalam_request(
                "GET", f"/v1/chats/{chat_id}/messages", params={"per_page": limit})
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400
        rows = payload if isinstance(payload, list) else (
            payload.get("data") or payload.get("items") or []
            if isinstance(payload, dict) else [])
        return ok(items=rows, chatId=chat_id)

    # ── auto-reply ───────────────────────────────────────────────────────
    def _autoreply_config(data: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        settings = data.get("ui_settings") if isinstance(data.get("ui_settings"), dict) else {}
        cfg = settings.get("autoreply") if isinstance(settings.get("autoreply"), dict) else {}
        rules = cfg.get("rules") if isinstance(cfg.get("rules"), list) else data.get("autoreply_rules")
        return cfg, [row for row in (rules or []) if isinstance(row, dict)]

    def _autoreply_generate(text: str, cfg: dict[str, Any],
                            rules: list[dict[str, Any]]) -> dict[str, Any]:
        lowered = text.lower()
        for rule in rules:
            if rule.get("enabled") is False:
                continue
            raw = rule.get("triggers") or rule.get("keywords") or []
            triggers = ([_s(value).strip().lower() for value in raw]
                        if isinstance(raw, list) else
                        [value.strip().lower() for value in re.split(r"[,،\n]", _s(raw))])
            triggers = [value for value in triggers if value]
            if any(value in lowered for value in triggers):
                reply = _s(rule.get("reply") or rule.get("response")).strip()
                if reply:
                    return {"text": reply,
                            "source": "rule:" + _s(rule.get("id") or rule.get("name") or "rule")}
        order = _s(cfg.get("order") or cfg.get("reply_order") or "rules_first")
        if order not in {"rules_only", ""}:
            try:
                system = (_s(cfg.get("systemText")).strip()
                          if _s(cfg.get("systemMode")) == "custom" else
                          "تو پشتیبان مؤدب و دقیق فروشگاه هستی.")
                answer = core.ai_chat(system + "\nبه فارسی، کوتاه و فقط پاسخ نهایی را بنویس.\nپیام مشتری: " + text)
                if _s(answer).strip():
                    return {"text": _s(answer).strip(), "source": "ai"}
            except Exception:  # noqa: BLE001 - no AI means no automatic reply
                pass
        return {"text": "", "source": "none"}

    @app.post("/api/autoreply/test")
    @app.post("/api/autoreply/run")
    def node_autoreply():
        body = _body()
        data = load()
        cfg, rules = _autoreply_config(data)
        if request.path.endswith("/test"):
            text = _s(body.get("text") or body.get("message")).strip()
            if not text:
                return jsonify(ok=False, error="متن پیام را بنویسید."), 400
            result = _autoreply_generate(text, cfg, rules)
            return ok(result=result, matched=bool(result["text"]),
                      reply=result["text"], source=result["source"])

        dry_run = _s(body.get("confirm")) != "APPLY"
        if not dry_run and cfg.get("enabled") is False:
            return jsonify(ok=False, error="پاسخ خودکار فعال نیست."), 400
        scan_limit = min(50, max(1, _int(cfg.get("scanLimit"), 20)))
        max_per_run = min(50, max(1, _int(cfg.get("maxPerRun"), 5)))
        try:
            payload = core.basalam_request("GET", "/v1/chats",
                                               params={"limit": scan_limit,
                                                       "order_by": "updated_at"})
            chats = core.basalam_api_rows(payload)[:scan_limit]
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400
        state = data.get("autoreply_state") if isinstance(data.get("autoreply_state"), dict) else {}
        chat_state = state.get("chats") if isinstance(state.get("chats"), dict) else {}
        items: list[dict[str, Any]] = []
        replied = skipped = failed = 0
        for chat in chats[:max_per_run]:
            chat_id = _int(chat.get("id") or chat.get("chat_id"))
            if not chat_id:
                skipped += 1
                continue
            try:
                messages_payload = core.basalam_request(
                    "GET", f"/v1/chats/{chat_id}/messages", params={"per_page": 20})
                messages = core.basalam_api_rows(messages_payload)
                last = next((message for message in messages
                             if isinstance(message, dict) and
                             not bool(message.get("is_mine") or message.get("mine") or
                                      (message.get("sender") or {}).get("is_vendor"))), None)
                if not last:
                    skipped += 1
                    continue
                content = last.get("content") if isinstance(last.get("content"), dict) else {}
                text = _s(content.get("text") or last.get("text") or last.get("message")).strip()
                message_id = _s(last.get("id") or last.get("message_id"))
                previous = chat_state.get(_s(chat_id)) if isinstance(chat_state.get(_s(chat_id)), dict) else {}
                if not text or (message_id and _s(previous.get("msgId")) == message_id):
                    skipped += 1
                    continue
                result = _autoreply_generate(text, cfg, rules)
                item = {"chatId": chat_id, "messageId": message_id, "text": text,
                        "reply": result["text"], "source": result["source"],
                        "customer": _s((chat.get("contact") or {}).get("name")
                                       if isinstance(chat.get("contact"), dict) else chat.get("customer"))}
                if not result["text"]:
                    item["skip"] = "پاسخ معتبری ساخته نشد"
                    skipped += 1
                elif not dry_run:
                    send_payload = {"chat_id": chat_id,
                                    "content": {"text": result["text"]},
                                    "message_type": "text", "temp_id": int(time.time() * 1000)}
                    core.basalam_request("POST", f"/v1/chats/{chat_id}/messages",
                                             json_data=send_payload)
                    chat_state[_s(chat_id)] = {"msgId": message_id, "at": int(time.time())}
                    log = data.get("autoreply_log")
                    if not isinstance(log, list):
                        log = []
                    log.append({"chat_id": chat_id, "customer": item["customer"],
                                "input_text": text, "output_text": result["text"],
                                "source": result["source"], "created_at": _iso()})
                    data["autoreply_log"] = log[-5000:]
                    item["sent"] = True
                    replied += 1
                items.append(item)
            except Exception as exc:  # noqa: BLE001
                failed += 1
                items.append({"chatId": chat_id, "error": str(exc)[:400]})
        state["chats"] = chat_state
        data["autoreply_state"] = state
        if not dry_run:
            save(data)
        return ok(dryRun=dry_run, items=items, replied=replied, skipped=skipped,
                  failed=failed, scanned=len(chats))

    # ── category learning ────────────────────────────────────────────────
    @app.get("/api/category-learning")
    def node_cat_learning_list():
        return ok(items=load().get("category_learning") or [])

    @app.post("/api/category-learning/record")
    def node_cat_learning_record():
        body = _body()
        title = _s(body.get("title")).strip()
        if not title:
            return jsonify(ok=False, error="عنوان لازم است."), 400
        data = load()
        rows = data.setdefault("category_learning", [])
        if not isinstance(rows, list):
            rows = data["category_learning"] = []
        rows.append({"title": title, "categoryId": _int(body.get("categoryId")),
                     "words": _s(body.get("words")), "at": int(time.time())})
        data["category_learning"] = rows[-500:]
        save(data)
        return ok(items=data["category_learning"], saved=True)

    @app.post("/api/category-learning/test")
    def node_cat_learning_test():
        title = _s(_body().get("title")).strip().lower()
        if not title:
            return jsonify(ok=False, error="عنوان لازم است."), 400
        best, score = None, 0
        for row in load().get("category_learning") or []:
            if not isinstance(row, dict):
                continue
            words = [w for w in re.split(r"[\s,،]+",
                     _s(row.get("words")) or _s(row.get("title")).lower()) if w]
            hits = sum(1 for w in words if w and w in title)
            if hits > score:
                best, score = row, hits
        return ok(match=best, score=score,
                  categoryId=_int((best or {}).get("categoryId")))

    @app.post("/api/category-learning/import")
    def node_cat_learning_import():
        body = _body()
        rows = body if isinstance(body, list) else body.get("items")
        if not isinstance(rows, list):
            return jsonify(ok=False, error="ساختار ورودی نامعتبر است."), 400
        data = load()
        current = data.get("category_learning")
        if not isinstance(current, list):
            current = []
        current.extend(r for r in rows if isinstance(r, dict))
        data["category_learning"] = current[-500:]
        save(data)
        return ok(imported=len(rows), items=data["category_learning"])

    # ── GitHub branch browser / deployer ─────────────────────────────────
    def _deploy_token() -> str:
        cfg = core.deploy_config() if hasattr(core, "deploy_config") else {}
        return _s(cfg.get("github_token")) or _s(os.environ.get("GITHUB_TOKEN"))

    # Short-lived caches so the version panel can auto-populate on every page
    # load without hammering GitHub (ls-remote per scan, file probe per branch).
    BRANCH_SCAN_CACHE: dict[str, Any] = {"ts": 0.0, "repo": "", "payload": {}}
    BRANCH_VERSION_CACHE: dict[str, Any] = {}  # "repo@branch" -> (ts, version)

    def _probe_branch_version(repo: str, branch: str, path: str, token: str) -> str:
        """APP_VERSION published on one branch (best-effort, cached 10 min)."""
        key = repo + "@" + branch
        now = time.time()
        hit = BRANCH_VERSION_CACHE.get(key)
        if hit and now - hit[0] < 600:
            return _s(hit[1])
        version = ""
        try:
            info = core.github_file_for(repo, branch, path, token, True)
            found = _s(info.get("version"))
            if found and found != "unknown":
                version = found
        except Exception:  # noqa: BLE001 - probing must never break the scan
            version = ""
        BRANCH_VERSION_CACHE[key] = (now, version)
        return version

    @app.get("/api/deployer/branches")
    def node_deployer_branches():
        quick = _s(request.args.get("quick")).lower() in ("1", "true", "yes", "on")
        force = _s(request.args.get("refresh")).lower() in ("1", "true", "yes", "on")
        cfg = core.deploy_config() if hasattr(core, "deploy_config") else {}
        repo = (_s(request.args.get("repo")) or _s(cfg.get("repo"))
                or _s(getattr(core, "DEPLOY_DEFAULT_REPO", "fazilatma/new")))
        now = time.time()
        if (not force and BRANCH_SCAN_CACHE.get("repo") == repo
                and BRANCH_SCAN_CACHE.get("payload")
                and now - BRANCH_SCAN_CACHE.get("ts", 0.0) < 120):
            payload = dict(BRANCH_SCAN_CACHE["payload"])
            payload["cached"] = True
            return jsonify(payload)
        try:
            branches = core.github_branch_list(repo, _deploy_token())
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400
        running = _s(getattr(core, "APP_VERSION", ""))
        head = ""
        try:
            if git_available():
                code, out = git("rev-parse", "--abbrev-ref", "HEAD")
                if not code:
                    head = out.strip()
        except Exception:  # noqa: BLE001
            head = ""
        names = [_s(b.get("name")) for b in branches]
        configured = [_s(x) for x in (cfg.get("branches") or [])]
        # Probe versions only for the branches that matter (configured, HEAD,
        # first listed); each probe is a cached shallow fetch.
        probe: list[str] = []
        for cand in (_s(cfg.get("branch")), head, *(names[:1] if names else [])):
            if cand and cand in names and cand not in probe:
                probe.append(cand)
        versions: dict[str, str] = {}
        if not quick:
            path = _s(cfg.get("path")) or _s(
                getattr(core, "DEPLOY_DEFAULT_PATH", "python-scraper4/scraper4.py"))
            for cand in probe[:3]:
                versions[cand] = _probe_branch_version(repo, cand, path, _deploy_token())
        latest, best = "", ""
        for name, ver in versions.items():
            if ver and (not best or core.compare_versions(ver, best) > 0):
                best, latest = ver, name
        if not latest:
            wanted = _s(cfg.get("branch"))
            latest = wanted if wanted in names else (names[0] if names else "")
        items = []
        for b in branches:
            name = _s(b.get("name"))
            ver = versions.get(name, "")
            status = ""
            if ver and running:
                cmp = core.compare_versions(ver, running)
                status = "newer" if cmp > 0 else ("older" if cmp < 0 else "equal")
            items.append({"name": name, "protected": bool(b.get("protected")),
                          "version": ver, "status": status,
                          "configured": name in configured, "head": bool(name and name == head)})
        payload = {
            "ok": True, "repo": repo, "branches": items, "items": names,
            "running": running, "latest": latest, "cached": False, "quick": quick,
            "head": head, "checkedAt": int(now),
            "deploy": {"repo": repo, "branch": _s(cfg.get("branch")),
                       "branches": configured},
        }
        BRANCH_SCAN_CACHE.update(ts=now, repo=repo, payload=payload)
        return jsonify(payload)

    def _safe_backup_path(value: Any, allow_empty: bool = False) -> str:
        path = _s(value).strip().replace("\\", "/").strip("/")
        if not path and allow_empty:
            return ""
        if (not path or len(path) > 400 or
                any(part in {"", ".", ".."} for part in path.split("/")) or
                not re.fullmatch(r"[A-Za-z0-9_.@/-]+", path)):
            raise ValueError("مسیر بکاپ نامعتبر یا ناامن است.")
        return path

    def _github_tree(repo: str, branch: str) -> list[dict[str, Any]]:
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
            raise ValueError("repo باید owner/name باشد.")
        clean = core.clean_branch(branch)
        if not clean:
            raise ValueError("نام branch معتبر نیست.")
        value = core.github_api_json(
            "https://api.github.com/repos/" + repo + "/git/trees/" + quote(clean, safe=""),
            _deploy_token(), params={"recursive": 1}, timeout=45)
        if not isinstance(value, dict) or not isinstance(value.get("tree"), list):
            raise ValueError("GitHub فهرست فایل معتبری برنگرداند.")
        if value.get("truncated"):
            raise ValueError("فهرست GitHub ناقص است؛ پوشه بکاپ را کوچک‌تر کنید.")
        return [node for node in value["tree"] if isinstance(node, dict)]

    def _github_blob(repo: str, sha: str, max_size: int = 5 * 1024 * 1024) -> bytes:
        value = core.github_api_json(
            "https://api.github.com/repos/" + repo + "/git/blobs/" + quote(sha, safe=""),
            _deploy_token(), timeout=45)
        if not isinstance(value, dict) or _s(value.get("encoding")) != "base64":
            raise ValueError("محتوای فایل GitHub قابل خواندن نیست.")
        size = _int(value.get("size"))
        if size > max_size:
            raise ValueError("فایل بکاپ بزرگ‌تر از ۵ مگابایت است.")
        try:
            raw = base64.b64decode(_s(value.get("content")).replace("\n", ""), validate=True)
        except (ValueError, TypeError) as exc:
            raise ValueError("کدگذاری فایل GitHub خراب است.") from exc
        if len(raw) > max_size:
            raise ValueError("فایل بکاپ بزرگ‌تر از ۵ مگابایت است.")
        return raw

    @app.get("/api/branch-files")
    def node_branch_files():
        repo = _s(request.args.get("repo"))
        branch = _s(request.args.get("branch"))
        try:
            prefix = _safe_backup_path(request.args.get("path") or "backups", allow_empty=True)
            tree = _github_tree(repo, branch)
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400
        base = prefix + "/" if prefix else ""
        files: list[dict[str, Any]] = []
        folders: list[dict[str, Any]] = []
        folder_seen: set[str] = set()
        for node in tree:
            if node.get("type") != "blob":
                continue
            path = _s(node.get("path"))
            if not path.startswith(base):
                continue
            relative = path[len(base):]
            if not relative:
                continue
            if relative.lower().endswith("/manifest.json"):
                folder_path = path[:-len("/manifest.json")]
                if folder_path not in folder_seen:
                    folder_seen.add(folder_path)
                    folders.append({"name": folder_path.rsplit("/", 1)[-1],
                                    "path": folder_path, "size": _int(node.get("size")),
                                    "sha": _s(node.get("sha")), "kind": "split-backup"})
            elif "/" not in relative and relative.lower().endswith(".json"):
                files.append({"name": relative, "path": path,
                              "size": _int(node.get("size")), "sha": _s(node.get("sha")),
                              "kind": "json"})
        files.sort(key=lambda row: row["name"], reverse=True)
        folders.sort(key=lambda row: row["name"], reverse=True)
        return ok(repo=repo, branch=branch, path=prefix, files=files[:200],
                  folders=folders[:200], items=[*folders[:200], *files[:200]])

    @app.get("/api/branch-file")
    def node_branch_file():
        repo = _s(request.args.get("repo"))
        branch = _s(request.args.get("branch"))
        try:
            path = _safe_backup_path(request.args.get("path"))
            tree = _github_tree(repo, branch)
            blobs = {_s(node.get("path")): node for node in tree
                     if node.get("type") == "blob" and _s(node.get("sha"))}
            if path.lower().endswith(".json"):
                node = blobs.get(path)
                if not node:
                    raise ValueError("فایل بکاپ در این branch پیدا نشد.")
                raw = _github_blob(repo, _s(node.get("sha")))
                bundle = json.loads(raw.decode("utf-8-sig"))
                if not isinstance(bundle, dict):
                    raise ValueError("فایل انتخاب‌شده یک bundle معتبر نیست.")
                return ok(repo=repo, branch=branch, path=path,
                          name=path.rsplit("/", 1)[-1], size=len(raw), bundle=bundle)
            manifest_path = path + "/manifest.json"
            manifest_node = blobs.get(manifest_path)
            if not manifest_node:
                raise ValueError("پوشه manifest.json معتبر ندارد.")
            manifest_raw = _github_blob(repo, _s(manifest_node.get("sha")), 1024 * 1024)
            manifest = json.loads(manifest_raw.decode("utf-8-sig"))
            if (not isinstance(manifest, dict) or manifest.get("kind") != "split-backup" or
                    manifest.get("format") != "scraper4-split-1" or
                    not isinstance(manifest.get("parts"), list)):
                raise ValueError("manifest مربوط به بکاپ بخش‌بخش Scraper4 نیست.")
            files: dict[str, Any] = {}
            total = 0
            for raw_name in manifest["parts"]:
                name = _s(raw_name)
                if (not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.@-]*\.json", name) or
                        name == "manifest.json"):
                    raise ValueError(f"نام بخش ناامن است: {name[:80]}")
                node = blobs.get(path + "/" + name)
                if not node:
                    raise ValueError(f"بخش {name} در branch پیدا نشد.")
                raw = _github_blob(repo, _s(node.get("sha")))
                try:
                    json.loads(raw.decode("utf-8-sig"))
                except (ValueError, UnicodeDecodeError) as exc:
                    raise ValueError(f"بخش {name} JSON معتبر نیست.") from exc
                total += len(raw)
                if total > 5 * 1024 * 1024:
                    raise ValueError("مجموع بکاپ بزرگ‌تر از ۵ مگابایت است.")
                files[name] = {"size": len(raw),
                               "b64": base64.b64encode(raw).decode("ascii")}
            bundle = {"app": _s(manifest.get("app")) or "scraper4-python",
                      "version": _s(manifest.get("version")),
                      "created_at": manifest.get("created_at"),
                      "created_at_h": manifest.get("created_at_h"),
                      "host": manifest.get("host"), "kind": "settings-export",
                      "format": "scraper4-php-compatible", "files": files,
                      "total_files": len(files), "total_bytes": total}
            return ok(repo=repo, branch=branch, path=path, name=path.rsplit("/", 1)[-1],
                      size=total, bundle=bundle, manifest=manifest)
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400

    @app.get("/api/deployer/local/status")
    @app.route("/api/deployer/local/<path:action>", methods=["GET", "POST"])
    def node_deployer_local(action: str = "status"):
        """Report the local deployer4 service state.

        deployer4 runs as its own service on :8001. The dashboard's local
        deployer panel polls this; answer with the facts we can see from here
        rather than 404-ing the whole panel.
        """
        target = os.path.abspath(getattr(core, "__file__", "scraper4.py"))
        backup = target + ".bak"
        auto = os.environ.get("SCRAPER_AUTO_UPDATE", "1").lower() not in {
            "0", "false", "off", "no"}
        return ok(
            action=action,
            status={
                "target": target,
                "version": core.APP_VERSION,
                "autoUpdate": auto,
                "hasBackup": os.path.isfile(backup),
                "uiBridge": globals().get("_BRIDGE_OK", True),
                "note": "به‌روزرسانی خودکار عمداً خاموش است تا داشبورد پاک نشود؛ "
                        "نصب نسخهٔ جدید با git روی سرور انجام می‌شود.",
            },
        )

    # ── git-based self update ────────────────────────────────────────────
    # The old updater downloaded a single scraper4.py from another repo and
    # overwrote the live file — that is what deleted the dashboard twice. This
    # one is fundamentally different: it runs `git pull` inside THIS checkout,
    # so every file moves together and nothing can be half-replaced. It only
    # ever touches the branch it is already on, and it refuses to run if the
    # working tree is dirty (local edits would be clobbered).
    # Where the code actually runs from (systemd installs a *copy* into
    # /opt/scraper4, which is not a git repo) and where the git checkout
    # lives. They are usually different, so after pulling we sync the files
    # across; if they are the same directory the copy is a no-op.
    APP_DIR = os.path.dirname(os.path.abspath(__file__))

    def _find_repo() -> str:
        explicit = _s(os.environ.get("SCRAPER_REPO_DIR"))
        if explicit and os.path.isdir(os.path.join(explicit, ".git")):
            return explicit
        # Walk up from this file, then try the usual clone locations.
        path = APP_DIR
        for _ in range(4):
            if os.path.isdir(os.path.join(path, ".git")):
                return path
            path = os.path.dirname(path)
        for guess in ("/root/new", "/home/user/new",
                      os.path.expanduser("~/new")):
            candidate = os.path.join(guess, "python-scraper4")
            if os.path.isdir(os.path.join(guess, ".git")) and \
                    os.path.isdir(candidate):
                return guess
        return ""

    REPO_DIR = _find_repo()
    # Files the running install needs; kept in sync after every pull.
    SYNC_FILES = ("scraper4.py", "deployer4.py", "ui_bridge.py", "parity_ext.py",
                  "parity-manifest.json", "ai_providers.json")

    def sync_from_repo() -> list[str]:
        """Copy updated files from the git checkout into the live app dir."""
        if not REPO_DIR:
            return []
        source = os.path.join(REPO_DIR, "python-scraper4")
        if not os.path.isdir(source):
            source = REPO_DIR
        if os.path.abspath(source) == os.path.abspath(APP_DIR):
            return []
        import shutil
        copied = []
        for name in SYNC_FILES:
            src = os.path.join(source, name)
            if os.path.isfile(src):
                shutil.copy2(src, os.path.join(APP_DIR, name))
                copied.append(name)
        src_ui = os.path.join(source, "ui")
        if os.path.isdir(src_ui):
            dst_ui = os.path.join(APP_DIR, "ui")
            os.makedirs(dst_ui, exist_ok=True)
            for name in os.listdir(src_ui):
                if name.endswith((".html", ".js", ".css", ".json", ".png", ".woff2")):
                    shutil.copy2(os.path.join(src_ui, name),
                                 os.path.join(dst_ui, name))
                    copied.append("ui/" + name)
        return copied

    UPDATE: dict[str, Any] = {"status": "idle", "log": [], "last_check": 0,
                              "behind": 0, "local": "", "remote": ""}

    def git(*args: str, timeout: int = 120) -> tuple[int, str]:
        try:
            proc = subprocess.run(
                ("git", "-C", REPO_DIR) + args, capture_output=True,
                text=True, timeout=timeout)
            return proc.returncode, (proc.stdout + proc.stderr).strip()
        except Exception as exc:  # noqa: BLE001
            return 1, str(exc)

    def git_available() -> bool:
        return bool(REPO_DIR) and os.path.isdir(os.path.join(REPO_DIR, ".git"))

    def update_check() -> dict[str, Any]:
        """Compare local HEAD with the tracked remote branch."""
        if not git_available():
            UPDATE.update(status="unavailable",
                          error="این نصب یک مخزن git نیست.")
            return UPDATE
        code, branch = git("rev-parse", "--abbrev-ref", "HEAD")
        if code:
            UPDATE.update(status="error", error=branch)
            return UPDATE
        branch = branch.strip()
        code, out = git("fetch", "--quiet", "origin", branch)
        if code:
            UPDATE.update(status="error", error=out or "git fetch ناموفق بود.")
            return UPDATE
        _, local = git("rev-parse", "HEAD")
        _, remote = git("rev-parse", f"origin/{branch}")
        _, behind = git("rev-list", "--count", f"HEAD..origin/{branch}")
        _, subject = git("log", "-1", "--format=%s", f"origin/{branch}")
        UPDATE.update(status="idle", branch=branch, local=local.strip()[:8],
                      remote=remote.strip()[:8], behind=_int(behind.strip()),
                      remoteSubject=subject.strip(), error="",
                      last_check=int(time.time()))
        return UPDATE

    def update_apply() -> dict[str, Any]:
        state = update_check()
        if state.get("status") in ("unavailable", "error"):
            return state
        if not state.get("behind"):
            UPDATE["log"] = ["نسخهٔ نصب‌شده به‌روز است."]
            return UPDATE
        code, dirty = git("status", "--porcelain")
        if code == 0 and dirty.strip():
            UPDATE.update(status="blocked",
                          error="تغییرات محلی ذخیره‌نشده وجود دارد؛ "
                                "به‌روزرسانی خودکار انجام نشد.")
            return UPDATE
        branch = _s(state.get("branch"))
        UPDATE["status"] = "updating"
        code, out = git("merge", "--ff-only", f"origin/{branch}")
        UPDATE["log"] = [out][:1]
        if code:
            UPDATE.update(status="error",
                          error="fast-forward ناموفق بود: " + out[:300])
            return UPDATE
        _, new_head = git("rev-parse", "HEAD")
        copied = sync_from_repo()
        UPDATE.update(status="updated", local=new_head.strip()[:8], error="",
                      synced=copied, updated_at=int(time.time()))
        # The new code is on disk but this process still runs the old one.
        # Touching the reload file makes gunicorn/systemd pick it up; if the
        # service is managed by systemd we ask for a restart instead.
        threading.Thread(target=update_restart, name="ui-update-restart",
                         daemon=True).start()
        return UPDATE

    def update_restart() -> None:
        time.sleep(1.5)  # let the HTTP response flush first
        unit = os.environ.get("SCRAPER_SERVICE_NAME", "scraper4")
        try:
            subprocess.run(["systemctl", "restart", unit], timeout=30,
                           capture_output=True)
            return
        except Exception:  # noqa: BLE001 - not systemd, fall through
            pass
        try:  # gunicorn reloads its workers on SIGHUP
            os.kill(os.getppid(), 1)
        except Exception:  # noqa: BLE001
            pass

    def update_loop() -> None:
        """Check the branch every minute and fast-forward when it moves."""
        interval = max(30, _int(os.environ.get("SCRAPER_UPDATE_INTERVAL"), 60))
        time.sleep(20)
        while True:
            try:
                if _s(os.environ.get("SCRAPER_GIT_AUTO_UPDATE", "1")).lower() \
                        not in ("0", "false", "off", "no"):
                    state = update_check()
                    if state.get("behind"):
                        update_apply()
            except Exception as exc:  # noqa: BLE001 - never kill the thread
                UPDATE["error"] = str(exc)[:200]
            time.sleep(interval)

    def _origin_repo_name() -> str:
        """owner/repo of this checkout's git origin (for auto-populating UI)."""
        try:
            if not git_available():
                return ""
            code, url = git("remote", "get-url", "origin")
            if code:
                return ""
            m = re.search(r"github\.com[:/]([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?)(?:\.git)?/?\s*$", url.strip())
            return m.group(1) if m else ""
        except Exception:  # noqa: BLE001
            return ""

    @app.get("/api/update/status")
    def node_update_status():
        # Report the branch even before the first check, otherwise the panel
        # shows an empty "branch —" on a fresh boot.
        if git_available() and not UPDATE.get("branch"):
            code, branch = git("rev-parse", "--abbrev-ref", "HEAD")
            if not code:
                UPDATE["branch"] = branch.strip()
            head_code, head = git("rev-parse", "HEAD")
            if not head_code and not UPDATE.get("local"):
                UPDATE["local"] = head.strip()[:8]
        elif not git_available():
            UPDATE["status"] = "unavailable"
        cfg = core.deploy_config() if hasattr(core, "deploy_config") else {}
        return ok(update=dict(UPDATE),
                  autoUpdate=_s(os.environ.get("SCRAPER_GIT_AUTO_UPDATE", "1")
                                ).lower() not in ("0", "false", "off", "no"),
                  repo=REPO_DIR,
                  version=_s(getattr(core, "APP_VERSION", "")),
                  repoName=_origin_repo_name() or _s(cfg.get("repo"))
                  or _s(getattr(core, "DEPLOY_DEFAULT_REPO", "fazilatma/new")),
                  defaultBranch=_s(cfg.get("branch"))
                  or _s(getattr(core, "DEPLOY_DEFAULT_BRANCH", "")),
                  configuredBranches=[_s(x) for x in (cfg.get("branches") or [])])

    @app.post("/api/update/check")
    def node_update_check():
        return ok(update=update_check())

    @app.post("/api/update/apply")
    def node_update_apply():
        return ok(update=update_apply())

    if _s(os.environ.get("SCRAPER_GIT_AUTO_UPDATE", "1")).lower() \
            not in ("0", "false", "off", "no") and git_available():
        threading.Thread(target=update_loop, name="ui-update", daemon=True).start()

    @app.post("/api/deployer/install-branch")
    def node_deployer_install():
        """Switch this checkout to another branch of the same repo."""
        branch = _s(_body().get("branch")).strip()
        if not branch:
            return jsonify(ok=False, error="نام برنچ لازم است."), 400
        if not git_available():
            return jsonify(ok=False, error="این نصب یک مخزن git نیست."), 400
        code, dirty = git("status", "--porcelain")
        if code == 0 and dirty.strip():
            return jsonify(
                ok=False,
                error="تغییرات محلی ذخیره‌نشده وجود دارد؛ ابتدا آن‌ها را "
                      "commit یا پاک کنید."), 409
        code, out = git("fetch", "origin", branch)
        if code:
            return jsonify(ok=False, error="git fetch ناموفق: " + out[:300]), 400
        code, out = git("checkout", "-B", branch, f"origin/{branch}")
        if code:
            return jsonify(ok=False, error="checkout ناموفق: " + out[:300]), 400
        _, head = git("rev-parse", "HEAD")
        sync_from_repo()
        threading.Thread(target=update_restart, name="ui-update-restart",
                         daemon=True).start()
        return ok(branch=branch, head=head.strip()[:8],
                  message=f"به برنچ {branch} منتقل شد؛ سرویس در حال راه‌اندازی مجدد است.")

    # ── misc small endpoints the UI polls ────────────────────────────────
    @app.post("/api/queue-watchdog")
    def node_queue_watchdog_post():
        body = _body()
        minutes = max(1, min(1440, _int(body.get("minutes"), 5)))
        cutoff = time.time() - minutes * 60
        auto_continue = body.get("autoContinue", True) is not False
        running, stale, recovered = [], [], []
        for task in live_tasks():
            if _s(task.get("status")) not in ("waiting", "running"):
                continue
            running.append(task)
            if _num(task.get("updated_at")) >= cutoff:
                continue
            task = dict(task)
            task.update(status="interrupted", updated_at=int(time.time()),
                        step="نگهبان صف وظیفهٔ گیرکرده را بست",
                        error=task.get("error") or f"بیش از {minutes} دقیقه بدون heartbeat")
            with core.LIVE_TASK_LOCK:
                core.LIVE_TASKS[_s(task.get("id"))] = task
            core.live_task_disk_write(task)
            stale.append(task_to_job(task))
            profile = _s(task.get("profile"))
            if auto_continue and profile in (load().get("profiles") or {}):
                data = load()
                config = dict(data["profiles"][profile])
                config.update(_profile_name=profile, workflow="full")
                replacement = core.live_task_create("scrape", "ادامهٔ خودکار · " + profile,
                                                    private=False)
                replacement.update(profile=profile, workflow="full", recoveredFrom=task.get("id"))
                with core.LIVE_TASK_LOCK:
                    core.LIVE_TASKS[replacement["id"]] = replacement
                core.live_task_disk_write(replacement)
                core.threading.Thread(target=core.scrape_live_worker,
                                      args=(replacement["id"], config),
                                      name="watchdog-recovery", daemon=True).start()
                recovered.append(task_to_job(replacement))
        return ok(watchdog={"running": len(running), "stalled": len(stale)},
                  stalled=stale, recovered=len(recovered), jobs=recovered,
                  reaped=len(stale), autoContinue=auto_continue, minutes=minutes)

    @app.delete("/api/jobs")
    def node_jobs_clear():
        removed = 0
        for task in live_tasks():
            if _s(task.get("status")) in ("completed", "failed", "cancelled", "interrupted"):
                path = os.path.join(core.LIVE_TASK_DIR, _s(task.get("id")) + ".json")
                try:
                    os.unlink(path)
                    removed += 1
                except OSError:
                    pass
                with core.LIVE_TASK_LOCK:
                    core.LIVE_TASKS.pop(_s(task.get("id")), None)
        return ok(deleted=removed)

    @app.delete("/api/jobs/<job_id>")
    def node_job_delete(job_id: str):
        path = os.path.join(core.LIVE_TASK_DIR, job_id + ".json")
        try:
            os.unlink(path)
        except OSError:
            pass
        with core.LIVE_TASK_LOCK:
            core.LIVE_TASKS.pop(job_id, None)
        return ok(deleted=job_id)

    @app.post("/api/jobs/<job_id>/<action>")
    def node_job_action(job_id: str, action: str):
        if action in ("stop", "cancel"):
            return node_job_stop(job_id)
        if action == "retry" and hasattr(core, "live_task_read"):
            task = core.live_task_read(job_id)
            if not task:
                return jsonify(ok=False, error="Job not found"), 404
            profile = _s(task.get("profile"))
            if profile:
                return _start_scrape(profile)
        return ok(job=None, action=action)

    @app.post("/api/import/analyze")
    def node_import_analyze():
        """Analyse an uploaded CSV/JSON before import."""
        raw = request.get_data() or b""
        name = _s(request.args.get("name"))
        fmt = _s(request.args.get("format")) or ("json" if name.endswith(".json") else "csv")
        text = raw.decode("utf-8", errors="replace").lstrip("\ufeff")
        if not text.strip():
            return jsonify(ok=False, error="فایل خالی است."), 400
        headers: list[str] = []
        samples: list[dict[str, Any]] = []
        if fmt == "json" or text.lstrip()[:1] in "[{":
            try:
                parsed = json.loads(text)
            except ValueError as exc:
                return jsonify(ok=False, error=f"JSON نامعتبر: {exc}"), 400
            rows = parsed if isinstance(parsed, list) else [parsed]
            samples = [r for r in rows[:100] if isinstance(r, dict)]
            for row in samples:
                for key in row:
                    if key not in headers:
                        headers.append(key)
            total = len(rows)
        else:
            import csv as _csv
            reader = list(_csv.reader(io.StringIO(text)))
            if not reader:
                return jsonify(ok=False, error="CSV خالی است."), 400
            headers = [h.strip() for h in reader[0]]
            body_rows = reader[1:]
            total = len(body_rows)
            samples = [dict(zip(headers, r)) for r in body_rows[:100]]
        # Guess which column maps to which product field.
        guesses = {
            "title": ("title", "name", "عنوان", "نام"),
            "price": ("price", "قیمت", "amount"),
            "url": ("url", "link", "آدرس", "لینک"),
            "image": ("image", "img", "photo", "تصویر", "عکس"),
            "sku": ("sku", "code", "کد"),
            "stock": ("stock", "qty", "quantity", "موجودی"),
        }
        mapping = []
        for column in headers:
            low = column.strip().lower()
            field = next((f for f, keys in guesses.items()
                          if any(k == low or k in low for k in keys)), "")
            mapping.append({"column": column, "field": field})
        missing_title = sum(
            1 for r in samples
            if not _s(r.get(next((m["column"] for m in mapping
                                  if m["field"] == "title"), ""))).strip())
        return ok(format=fmt, total=total, headers=headers, mapping=mapping,
                  samples=samples,
                  issues={"missingTitle": missing_title, "checked": len(samples)})

    # Integration-heavy parity routes live in a separate module so this bridge
    # remains reviewable. They share these closures rather than creating a
    # second state/destination implementation.
    try:
        from parity_ext import install_parity_extensions
        install_parity_extensions(app, core, {
            "load": load, "save": save, "ok": ok,
            "profile_products": profile_products, "product_to_node": product_to_node,
            "profile_to_node": profile_to_node, "start_scrape": _start_scrape,
            "task_to_job": task_to_job, "live_tasks": live_tasks,
            "bundle_files": _bundle_files, "destination_rows": _destination_rows,
            "destination_view": _destination_view, "dest_key": dest_key,
            "shop_context": _shop_context, "agent_start": _agent_start,
        })
    except Exception as exc:  # Fail boot loudly: silent parity stubs hid defects.
        raise RuntimeError(f"installing Python/Node parity routes failed: {exc}") from exc
