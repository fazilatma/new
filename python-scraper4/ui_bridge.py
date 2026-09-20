"""Node-dashboard compatibility layer for the Python Scraper 4 backend.

The Node.js project (``cloudflare-scraper4`` on branch ``arena/01a0aa17-new``)
ships a single-page dashboard built from two string constants inside
``worker-src/dashboard.ts``: ``DASHBOARD`` (the HTML shell, including all CSS)
and ``DASHBOARD_JS`` (the client script). Those two payloads were extracted
verbatim into ``ui/dashboard.html`` and ``ui/dashboard.js`` so the Python app
renders a *pixel-identical* interface — same topbar, drawer, six-pane tab bar,
theme tokens and Persian copy.

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
  * Unknown/unsupported endpoints answer with a valid empty payload rather
    than 404, so optional dashboard panels degrade quietly instead of
    spraying red error toasts.
"""

from __future__ import annotations

import base64
import importlib.metadata
import importlib.util
import io
import json
import os
import re
import subprocess
import sys
import threading
import time
from typing import Any, Callable, Optional

from flask import (
    Response, jsonify, redirect, request, send_from_directory, url_for,
)

UI_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ui")

# Mirror of DEFAULT_SELECTORS / Selectors in worker-src/types.ts.
NODE_SELECTOR_KEYS = (
    "container", "title", "price", "link", "image", "shortDesc", "longDesc",
    "sku", "brand", "stock", "weight", "category", "tags", "detailImage",
    "gallery", "variations", "specs",
)
PAGINATIONS = (
    "query_page", "query_custom", "path_page", "path_pattern",
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
    "query": "query_page", "query_page": "query_page", "path": "path_page",
    "path_page": "path_page", "pattern": "full_pattern", "custom": "query_custom",
    "next": "next_selector", "none": "none", "scroll": "scroll",
}
PAG_NODE_TO_PY = {
    "query_page": "query", "query_custom": "custom", "path_page": "path",
    "path_pattern": "path", "full_pattern": "pattern",
    "next_selector": "next", "none": "none", "scroll": "scroll",
}


def _s(value: Any) -> str:
    return "" if value is None else str(value)


def _num(value: Any, fallback: float = 0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
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
            "priceMode": _s(rules.get("price_mode")) or "none",
            "priceValue": _num(rules.get("price_val")),
            "roundPrice": _num(rules.get("round_price")),
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
        rules.update({
            "title_suffix": _s(node.get("titleSuffix")),
            "price_mode": _s(node.get("priceMode")) or "none",
            "price_val": _num(node.get("priceValue")),
            "round_price": _num(node.get("roundPrice")),
            "min_price": _num(node.get("minPrice")),
            "woo_category_id": _int(node.get("wooCategoryId")),
            "bsl_category_id": _int(node.get("basalamCategoryId")),
            "bsl_fallback_cat_ids": node.get("basalamFallbackCategoryIds") or [],
        })
        cfg.update({
            "display_name": _s(node.get("name")),
            "url": _s(node.get("url")),
            "enabled": node.get("enabled", True) is not False,
            "pages": max(1, _int(node.get("pages"), 1)),
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
        return {
            "sourceKey": _s(row.get("source_key") or row.get("sourceKey") or row.get("url") or index),
            "title": _s(row.get("title")),
            "price": _num(price),
            "priceText": _s(row.get("price_text") or row.get("priceText") or price),
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

    def profile_products(name: str) -> list[dict[str, Any]]:
        data = load()
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
        return {
            "id": _s(task.get("id")),
            "profileId": _s(task.get("profile")),
            "kind": "scrape" if _s(task.get("kind")) == "scrape" else "sync",
            "target": _s(task.get("target")) or "none",
            "status": status_map.get(_s(task.get("status")), "queued"),
            "phase": _s(task.get("step")),
            "total": _int(counts.get("total") or task.get("total")),
            "processed": _int(counts.get("done") or task.get("progress")),
            "added": _int(counts.get("added")),
            "updated": _int(counts.get("updated")),
            "failed": _int(counts.get("failed")),
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

    def connections_payload() -> dict[str, Any]:
        data = load()
        woo = data.get("woocommerce") or {}
        bsl = data.get("basalam") or {}
        ai = data.get("ai") or {}
        return {
            "woo": {
                "url": _s(woo.get("url")),
                "key": _s(woo.get("consumer_key")),
                "secret": "***" if woo.get("consumer_secret") else "",
                "configured": bool(woo.get("url") and woo.get("consumer_key") and woo.get("consumer_secret")),
            },
            "basalam": {
                "token": "***" if bsl.get("token") else "",
                "vendorId": _int(bsl.get("vendor_id")),
                "shops": bsl.get("vendors") or [],
                "configured": bool(bsl.get("token") and bsl.get("vendor_id")),
            },
            "ai": {
                "provider": _s(ai.get("provider")),
                "model": _s(ai.get("model")),
                "key": "***" if ai.get("api_key") else "",
                "configured": bool(ai.get("api_key")),
            },
        }

    def ok(**payload: Any):
        return jsonify(ok=True, **payload)

    # ── static dashboard shell ───────────────────────────────────────────
    @app.get("/ui")
    def node_dashboard():
        """Serve the Node dashboard HTML verbatim."""
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
        return ok(
            profiles=len(data.get("profiles") or {}),
            jobs=[task_to_job(t) for t in live_tasks()[:10]],
            connections=connections_payload(),
            queue=True,
            storage={"d1": True, "r2": False},
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
        return ok(parity={
            "python": core.APP_VERSION,
            "releases": len(log),
            "latest": (log[0].get("version") if log else core.APP_VERSION),
            "latestDate": (log[0].get("date") if log else ""),
            "runtime": f"python {sys.version.split()[0]} · flask",
            "dashboard": bool(globals().get("_BRIDGE_OK", True)),
            "engines": engines,
            "engineCount": len(engines),
        })

    # Dashboard preference groups that live under ui_settings in the data
    # file. They were previously dropped on save and never returned on load,
    # so the font/theme picker reset to the default on every refresh.
    UI_SETTING_GROUPS = ("appearance", "general", "watchdog", "notifications",
                         "retire", "dedup", "agent", "ai")

    @app.get("/api/settings")
    def node_settings_get():
        data = load()
        stored = data.get("ui_settings")
        if not isinstance(stored, dict):
            stored = {}
        settings = {
            "network": data.get("network") or {},
            "maxPages": getattr(core, "MAX_PAGES_HARD", 0),
            "maxProducts": core.MAX_PRODUCTS_HARD,
            "activeProfile": _s(data.get("active_profile")),
            "autoUpdate": bool(data.get("auto_update", True)),
        }
        for group in UI_SETTING_GROUPS:
            if isinstance(stored.get(group), dict):
                settings[group] = stored[group]
        return ok(settings=settings)

    @app.post("/api/settings")
    def node_settings_post():
        body = _body()
        data = load()
        incoming = body.get("settings") if isinstance(body.get("settings"), dict) else body
        if isinstance(incoming.get("network"), dict):
            network = dict(data.get("network") or {})
            network.update(incoming["network"])
            data["network"] = network
        if "activeProfile" in incoming:
            data["active_profile"] = _s(incoming["activeProfile"])
        # Persist the dashboard preference groups (font, theme, queue limits,
        # watchdog…). Merge per group so a partial save does not wipe siblings.
        stored = data.get("ui_settings")
        if not isinstance(stored, dict):
            stored = {}
        for group in UI_SETTING_GROUPS:
            if isinstance(incoming.get(group), dict):
                merged = dict(stored.get(group) or {})
                merged.update(incoming[group])
                stored[group] = merged
        data["ui_settings"] = stored
        save(data)
        return ok(settings=incoming)

    @app.get("/api/connections")
    def node_connections_get():
        return ok(connections=connections_payload())

    @app.post("/api/connections")
    def node_connections_post():
        body = _body()
        incoming = body.get("connections") if isinstance(body.get("connections"), dict) else body
        data = load()
        woo_in = incoming.get("woo") or {}
        if woo_in:
            woo = dict(data.get("woocommerce") or {})
            if _s(woo_in.get("url")):
                woo["url"] = _s(woo_in["url"])
            if _s(woo_in.get("key")):
                woo["consumer_key"] = _s(woo_in["key"])
            secret = _s(woo_in.get("secret"))
            if secret and secret != "***":
                woo["consumer_secret"] = secret
            data["woocommerce"] = woo
        bsl_in = incoming.get("basalam") or {}
        if bsl_in:
            bsl = dict(data.get("basalam") or {})
            token = _s(bsl_in.get("token"))
            if token and token != "***":
                bsl["token"] = token
            if bsl_in.get("vendorId"):
                bsl["vendor_id"] = _int(bsl_in["vendorId"])
            data["basalam"] = bsl
        ai_in = incoming.get("ai") or {}
        if ai_in:
            ai = dict(data.get("ai") or {})
            key = _s(ai_in.get("key"))
            if key and key != "***":
                ai["api_key"] = key
            for src, dst in (("provider", "provider"), ("model", "model"), ("endpoint", "endpoint")):
                if _s(ai_in.get(src)):
                    ai[dst] = _s(ai_in[src])
            data["ai"] = ai
        save(data)
        return ok(connections=connections_payload())

    # ── profiles ─────────────────────────────────────────────────────────
    @app.get("/api/profiles")
    def node_profiles_list():
        data = load()
        return ok(profiles=[profile_to_node(n, c) for n, c in (data.get("profiles") or {}).items()])

    @app.post("/api/profiles")
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
        rows = profile_products(pid)
        if query:
            rows = [r for r in rows if query in _s(r.get("title")).lower()]
        total = len(rows)
        page = [product_to_node(r, offset + i) for i, r in enumerate(rows[offset:offset + limit])]
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
        config = dict(cfg)
        config["_profile_name"] = pid
        data["active_profile"] = pid
        save(data)
        task = core.live_task_create("scrape", f"استخراج محصولات · {pid}", private=False)
        task["profile"] = pid
        with core.LIVE_TASK_LOCK:
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

    def _diag_fetch(config: dict[str, Any], url: str, engine: str) -> Any:
        """One page fetch with a specific engine, via the real Fetcher."""
        fetcher = core.Fetcher(load().get("network") or {})
        return fetcher.get(url, engine=engine)

    @app.post("/api/profiles/<path:pid>/benchmark-engines")
    def node_benchmark_engines(pid: str):
        """Time every installed fetch engine against the profile's first page."""
        data = load()
        cfg = (data.get("profiles") or {}).get(pid)
        if not isinstance(cfg, dict):
            return jsonify(ok=False, error="پروفایل پیدا نشد."), 404
        url = _s(cfg.get("url"))
        if not url:
            return jsonify(ok=False, error="آدرس پروفایل خالی است."), 400
        # Benchmark both stages: every installed fetch engine, then every parse
        # strategy against one cached response so the comparison is fair and we
        # do not hammer the site once per parser.
        engines = [e for e in core.KNOWN_ENGINES
                   if core.fetch_engine_installed(e)]
        results, best, best_rate = [], "", -1.0
        best_text = best_url = ""
        for engine in engines:
            row: dict[str, Any] = {"engine": engine, "ok": False,
                                   "pagesScanned": 0, "products": 0,
                                   "elapsedMs": 0, "productsPerMinute": 0,
                                   "error": ""}
            started = time.time()
            try:
                res = _diag_fetch(cfg, url, engine)
                rows, _soup, _stats = core.parse_html(
                    res.text, res.url, cfg.get("selectors") or {})
                elapsed = max(1, int((time.time() - started) * 1000))
                rate = round(len(rows) / (elapsed / 60000.0), 1) if rows else 0
                row.update(ok=True, pagesScanned=1, products=len(rows),
                           elapsedMs=elapsed, productsPerMinute=rate)
                if rate > best_rate:
                    best, best_rate = engine, rate
                if not best_text:
                    best_text, best_url = res.text, res.url
            except Exception as exc:  # noqa: BLE001 - reported per engine
                row["elapsedMs"] = max(1, int((time.time() - started) * 1000))
                row["error"] = str(exc)[:240]
                row["diagnosis"] = {"hint": _engine_hint(engine, str(exc))}
            results.append(row)
        # Parse stage: reuse the HTML already downloaded above.
        parse_results = []
        if best_text:
            for strategy in getattr(core, "PARSE_ENGINES", ()):
                prow = {"engine": strategy, "stage": "parse", "ok": False,
                        "products": 0, "elapsedMs": 0, "error": ""}
                t0 = time.time()
                try:
                    rows, _s2, _d2 = core.parse_html(
                        best_text, best_url, cfg.get("selectors") or {}, strategy)
                    prow.update(ok=True, products=len(rows),
                                elapsedMs=max(1, int((time.time() - t0) * 1000)))
                except Exception as exc:  # noqa: BLE001 - per strategy
                    prow["error"] = str(exc)[:200]
                    prow["elapsedMs"] = max(1, int((time.time() - t0) * 1000))
                parse_results.append(prow)
        # Remember the winner so the profile uses it next run.
        if best:
            cfg["fetch_engine_master"] = best
            data["profiles"][pid] = cfg
            save(data)
        return ok(profile=pid, results=results + parse_results, best=best,
                  fetchResults=results, parseResults=parse_results,
                  engines=[r["engine"] for r in results],
                  summary=(f"سریع‌ترین موتور: {best}" if best
                           else "هیچ موتوری موفق نشد."))

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

        def stage(name: str, good: bool, summary: str, **extra: Any) -> None:
            stages.append({"name": name, "ok": good, "summary": summary, **extra})

        url = _s(cfg.get("url"))
        selectors = cfg.get("selectors") or {}
        filled = {k: v for k, v in selectors.items() if _s(v).strip()}
        stage("configuration", bool(url),
              f"آدرس: {url or '—'} · سلکتورهای پرشده: {len(filled)}"
              + ("" if url else " · آدرس خالی است"),
              url=url, selectors=filled,
              pagination=_s(cfg.get("pagination")) or "none")
        if not url:
            return ok(profile=pid, stages=stages, healthy=False,
                      summary="آدرس پروفایل تنظیم نشده است.")

        engine = _s(cfg.get("fetch_engine")) or "auto"
        res = None
        try:
            res = _diag_fetch(cfg, url, engine if engine != "auto" else "requests")
            body = _s(getattr(res, "text", ""))
            stage("network", True,
                  f"HTTP {getattr(res, 'status', 200)} · {len(body):,} بایت "
                  f"· موتور {engine}", bytes=len(body),
                  finalUrl=_s(getattr(res, "url", url)))
        except Exception as exc:  # noqa: BLE001
            stage("network", False, f"دریافت صفحه ناموفق بود: {exc}"[:300])
            return ok(profile=pid, stages=stages, healthy=False,
                      summary="صفحه دریافت نشد؛ موتور یا پروکسی را بررسی کنید.")

        try:
            rows, soup, stats = core.parse_html(res.text, res.url, selectors)
        except Exception as exc:  # noqa: BLE001
            stage("list-extraction", False, f"خطای تجزیهٔ صفحه: {exc}"[:300])
            return ok(profile=pid, stages=stages, healthy=False,
                      summary="صفحه تجزیه نشد.")
        stage("list-extraction", bool(rows),
              f"{len(rows)} محصول از فهرست استخراج شد"
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

        if not rows:
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

        detail_sel = cfg.get("detail_selectors") or {}
        if rows and detail_sel:
            link = next((_s(r.get("link")) for r in rows if _s(r.get("link"))), "")
            if link:
                try:
                    dres = _diag_fetch(cfg, link, engine if engine != "auto" else "requests")
                    dsoup = core.BeautifulSoup(dres.text, "html.parser")
                    fields = core.parse_detail_fields(dsoup, dres.url, detail_sel)
                    got = {k: v for k, v in fields.items() if _s(v).strip()}
                    stage("detail-extraction", bool(got),
                          f"{len(got)} فیلد از صفحهٔ جزئیات خوانده شد",
                          fields=list(got))
                except Exception as exc:  # noqa: BLE001
                    stage("detail-extraction", False,
                          f"صفحهٔ جزئیات خوانده نشد: {exc}"[:240])

        healthy = all(s["ok"] for s in stages)
        return ok(profile=pid, stages=stages, healthy=healthy,
                  summary=("همه‌چیز سالم است."
                           if healthy else
                           "مشکل در: " + "، ".join(
                               s["name"] for s in stages if not s["ok"])))

    @app.post("/api/profiles/<path:pid>/sync")
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
        stats = {}
        for name, cfg in (data.get("profiles") or {}).items():
            rows = cfg.get("saved_products") if isinstance(cfg, dict) else []
            stats[name] = {
                "products": len(rows) if isinstance(rows, list) else 0,
                "lastRunAt": (cfg or {}).get("last_run_at"),
            }
        return ok(stats=stats)

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
            task["step"] = "درخواست توقف ثبت شد"
            task["updated_at"] = int(time.time())
            core.LIVE_TASKS[job_id] = task
            core.live_task_disk_write(task)
        return ok(job=task_to_job(task), forced=False)

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
        running = [t for t in live_tasks() if _s(t.get("status")) in ("waiting", "running")]
        return ok(watchdog={"running": len(running), "stalled": 0})

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

    @app.post("/api/suggest-selectors")
    def node_suggest_selectors():
        body = _body()
        url = _s(body.get("url"))
        if not url:
            return jsonify(ok=False, error="آدرس لازم است."), 400
        try:
            result = core.auto_selectors(url)
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
        data = load()
        if target == "woo":
            woo = data.get("woocommerce") or {}
            done = bool(woo.get("url") and woo.get("consumer_key") and woo.get("consumer_secret"))
            return ok(target=target, connected=done,
                      message="اتصال ووکامرس تنظیم شده است." if done else "اطلاعات ووکامرس کامل نیست.")
        if target == "basalam":
            bsl = data.get("basalam") or {}
            done = bool(bsl.get("token"))
            return ok(target=target, connected=done,
                      message="توکن باسلام ثبت شده است." if done else "توکن باسلام ثبت نشده است.")
        ai = data.get("ai") or {}
        done = bool(ai.get("api_key"))
        return ok(target=target, connected=done,
                  message="کلید هوش مصنوعی ثبت شده است." if done else "کلید هوش مصنوعی ثبت نشده است.")

    @app.get("/api/categories/<target>")
    def node_categories(target: str):
        return ok(items=[], total=0, target=target)

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
            rows.append({
                "id": eid, "label": label, "stage": stage,
                "module": module, "installed": installed,
                # Browser engines additionally need a downloaded browser binary.
                "needsBrowser": eid in ("playwright", "selenium"),
            })
        return rows

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

    @app.get("/api/destination/<target>/overview")
    def node_dest_overview(target: str):
        try:
            key = dest_key(target)
            rows = core.destination_remote_rows(key)
        except Exception as exc:  # noqa: BLE001 - shown in the panel
            return jsonify(ok=False, error=str(exc)), 400
        data = load()
        name = _s(data.get("active_profile"))
        profile = (data.get("profiles") or {}).get(name) or {}
        report = core.build_destination_report(name, key, profile, rows)
        return ok(overview=report, counts=report.get("counts", {}),
                  remoteTotal=report.get("remote_total", 0),
                  localTotal=report.get("local_total", 0))

    @app.get("/api/destination/<target>/products")
    def node_dest_products(target: str):
        limit = min(500, _int(request.args.get("limit"), 100) or 100)
        try:
            key = dest_key(target)
            rows = core.destination_remote_rows(key)
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400
        items = [core.remote_product_view(r, key) for r in rows[:limit]]
        return ok(items=items, total=len(rows))

    @app.post("/api/destination/<target>/<path:item_id>/status")
    def node_dest_status(target: str, item_id: str):
        body = _body()
        if _s(body.get("confirm")) != "APPLY":
            return jsonify(ok=False, error="برای اعمال تغییر، confirm=APPLY لازم است."), 400
        status = _s(body.get("status")) or "draft"
        try:
            key = dest_key(target)
            if key != "woocommerce":
                return jsonify(ok=False, error="تغییر وضعیت فقط برای ووکامرس پشتیبانی می‌شود."), 400
            response = core.woo_request("PUT", f"products/{item_id}", {"status": status})
            return ok(item=response.json(), status=status)
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400

    @app.delete("/api/destination/<target>/<path:item_id>")
    def node_dest_delete(target: str, item_id: str):
        if request.args.get("confirm") != "DELETE":
            return jsonify(ok=False, error="برای حذف، confirm=DELETE لازم است."), 400
        try:
            key = dest_key(target)
            if key != "woocommerce":
                return jsonify(ok=False, error="حذف فقط برای ووکامرس پشتیبانی می‌شود."), 400
            core.woo_request("DELETE", f"products/{item_id}?force=true")
            return ok(deleted=item_id)
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400

    @app.post("/api/destination/<target>/dedup-runs")
    def node_dedup_start(target: str):
        """Find duplicate remote products by normalised title."""
        try:
            key = dest_key(target)
            rows = core.destination_remote_rows(key)
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400
        groups: dict[str, list[dict[str, Any]]] = {}
        for raw in rows:
            view = core.remote_product_view(raw, key)
            title = _s(view.get("title")).strip().lower()
            if title:
                groups.setdefault(title, []).append(view)
        dupes = [{"title": t, "count": len(v), "items": v}
                 for t, v in groups.items() if len(v) > 1]
        dupes.sort(key=lambda x: -x["count"])
        run = {"id": "dedup-" + _s(int(time.time())), "target": key,
               "status": "done", "scanned": len(rows),
               "groups": dupes[:200], "duplicates": len(dupes)}
        DEDUP_RUNS[key] = run
        return ok(run=run, groups=run["groups"])

    DEDUP_RUNS: dict[str, dict[str, Any]] = {}

    @app.get("/api/destination/<target>/dedup-runs/current")
    def node_dedup_current(target: str):
        try:
            key = dest_key(target)
        except ValueError as exc:
            return jsonify(ok=False, error=str(exc)), 400
        return ok(run=DEDUP_RUNS.get(key))

    @app.post("/api/destination/<target>/dedup-runs/control")
    @app.post("/api/destination/<target>/dedup-runs/reset")
    def node_dedup_control(target: str):
        try:
            key = dest_key(target)
        except ValueError as exc:
            return jsonify(ok=False, error=str(exc)), 400
        if request.path.endswith("/reset"):
            DEDUP_RUNS.pop(key, None)
            return ok(run=None)
        return ok(run=DEDUP_RUNS.get(key))

    @app.post("/api/destination/<target>/bulk")
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
        ids = [_s(i) for i in (body.get("ids") or []) if _s(i)]
        ops = body.get("ops") if isinstance(body.get("ops"), dict) else {}
        if not ids:
            return jsonify(ok=False, error="هیچ محصولی انتخاب نشده است."), 400
        if len(ids) > 20:
            return jsonify(ok=False, error="حداکثر ۲۰ محصول در هر نوبت."), 400
        dry = _s(body.get("confirm")) != "APPLY"
        remove = bool(ops.get("delete"))

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
        for item_id in ids:
            entry: dict[str, Any] = {"id": item_id}
            try:
                if key == "woocommerce":
                    current = core.woo_request("GET", f"products/{item_id}").json()
                else:
                    current = core.basalam_api_request(
                        "GET", f"/v1/products/{item_id}") or {}
                view = core.remote_product_view(
                    current if isinstance(current, dict) else {}, key)
                entry["title"] = view.get("title")
                if remove:
                    entry["action"] = ("بایگانی" if key == "basalam" else "حذف")
                    if not dry:
                        if key == "woocommerce":
                            core.woo_request("DELETE", f"products/{item_id}?force=true")
                        else:
                            core.basalam_api_request(
                                "PATCH", f"/v1/products/{item_id}",
                                json_data={"status": 3400})
                        entry["done"] = True
                else:
                    payload: dict[str, Any] = {}
                    price = new_price(view.get("price"))
                    if price is not None:
                        entry["oldPrice"], entry["newPrice"] = view.get("price"), price
                        payload["regular_price" if key == "woocommerce"
                                else "price"] = (str(price) if key == "woocommerce"
                                                 else price)
                    if ops.get("stock") not in (None, ""):
                        payload["stock_quantity" if key == "woocommerce"
                                else "inventory"] = _int(ops.get("stock"))
                    if _s(ops.get("status")):
                        payload["status"] = _s(ops.get("status"))
                    title = _s(view.get("title"))
                    if _s(ops.get("titlePrefix")) or _s(ops.get("titleSuffix")):
                        title = (_s(ops.get("titlePrefix")) + title
                                 + _s(ops.get("titleSuffix")))
                        payload["name" if key == "woocommerce" else "title"] = title
                        entry["newTitle"] = title
                    if _s(ops.get("shortDescription")):
                        payload["short_description"] = _s(ops.get("shortDescription"))
                    if _s(ops.get("description")):
                        payload["description"] = _s(ops.get("description"))
                    if not payload:
                        entry["skipped"] = "تغییری مشخص نشده است"
                    else:
                        entry["changes"] = payload
                        if not dry:
                            if key == "woocommerce":
                                core.woo_request("PUT", f"products/{item_id}", payload)
                            else:
                                core.basalam_api_request(
                                    "PATCH", f"/v1/products/{item_id}",
                                    json_data=payload)
                            entry["done"] = True
            except Exception as exc:  # noqa: BLE001 - reported per item
                entry["error"] = str(exc)[:200]
                errors.append(entry["error"])
            items.append(entry)
        return ok(items=items, dryRun=dry, target=key, count=len(items),
                  errors=errors,
                  message=("پیش‌نمایش؛ هیچ تغییری اعمال نشد."
                           if dry else f"{len(items)} محصول پردازش شد."))

    @app.post("/api/destination/basalam/category/suggest")
    def node_basalam_cat_suggest():
        body = _body()
        title = _s(body.get("title")).strip()
        if not title:
            return jsonify(ok=False, error="عنوان محصول لازم است."), 400
        model_key = _s(body.get("modelKey"))
        provider, _, model = model_key.partition("::")
        prompt = (
            "برای این محصول فقط نام مناسب‌ترین دستهٔ فروشگاهی را به فارسی بنویس. "
            "فقط نام دسته را بنویس بدون توضیح.\n\nعنوان محصول: " + title
        )
        try:
            answer = core.ai_chat(prompt, provider, model)
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400
        return ok(suggestion=_s(answer).strip(), title=title,
                  items=[{"name": _s(answer).strip()}])

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
    @app.post("/api/maintenance/recon-table/<target>")
    @app.post("/api/maintenance/recon-unified/<target>")
    def node_recon_table(target: str):
        body = _body()
        data = load()
        name = _s(body.get("profileId")) or _s(data.get("active_profile"))
        profile = (data.get("profiles") or {}).get(name) or {}
        try:
            key = dest_key(target)
            rows = core.destination_remote_rows(key)
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400
        report = core.build_destination_report(name, key, profile, rows)
        lists = report.get("lists", {})
        return ok(report=report, counts=report.get("counts", {}),
                  items=lists.get("mismatch", []) + lists.get("missing", []),
                  rows=lists)

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
        if not apply_now:
            return ok(preview=True, candidates=extra, count=len(extra),
                      message=f"{len(extra)} محصول در مقصد هست که در منبع نیست. "
                              "برای اجرا confirm=APPLY بفرستید.")
        return jsonify(ok=False,
                       error="اجرای حذف گروهی در این نسخه غیرفعال است؛ "
                             "از فهرست پیش‌نمایش استفاده کنید."), 501

    @app.post("/api/maintenance/recon-unified")
    @app.post("/api/maintenance/recon-unified/apply")
    def node_recon_unified():
        """Reconcile the active (or all) profiles against every destination."""
        body = _body()
        apply_now = request.path.endswith("/apply")
        data = load()
        wanted = _s(body.get("profileId"))
        names = [wanted] if wanted else list((data.get("profiles") or {}).keys())
        reports, planned, errors = [], 0, []
        for name in names:
            profile = (data.get("profiles") or {}).get(name) or {}
            for key in ("woocommerce", "basalam"):
                try:
                    rows = core.destination_remote_rows(key)
                except Exception as exc:  # noqa: BLE001 - destination may be off
                    errors.append(f"{key}: {exc}")
                    continue
                report = core.build_destination_report(name, key, profile, rows)
                counts = report.get("counts", {})
                planned += _int(counts.get("mismatch")) + _int(counts.get("missing"))
                reports.append({"profile": name, "destination": key,
                                "counts": counts,
                                "lists": report.get("lists", {})})
                # Persist the learned source→remote id map so later runs match
                # by id instead of guessing from the title.
                learned = report.get("learned") or {}
                if learned and isinstance(profile, dict):
                    remote_map = profile.setdefault("remote_map", {})
                    if isinstance(remote_map, dict):
                        remote_map.setdefault(key, {}).update(learned)
        if not reports and errors:
            return jsonify(ok=False, error="؛ ".join(errors[:3])), 400
        save(data)
        return ok(items=reports, reports=reports, planned=planned,
                  applied=0 if not apply_now else 0, errors=errors,
                  dryRun=not apply_now,
                  message=("پیش‌نمایش مغایرت‌ها آماده شد."
                           if not apply_now else
                           "نگاشت شناسه‌ها ذخیره شد؛ برای ارسال تغییرات از "
                           "«ارسال به مقصد» استفاده کنید."))

    @app.post("/api/maintenance/photo-fix")
    def node_photo_fix():
        data = load()
        name = _s(_body().get("profileId")) or _s(data.get("active_profile"))
        rows = profile_products(name)
        missing = [product_to_node(r, i) for i, r in enumerate(rows)
                   if not _s(r.get("image"))]
        return ok(items=missing, count=len(missing), profile=name,
                  message=f"{len(missing)} محصول بدون تصویر پیدا شد.")

    @app.post("/api/maintenance/<kind>/<target>")
    def node_maintenance_generic(kind: str, target: str):
        return ok(kind=kind, target=target, items=[],
                  message="این عملیات نگهداری در نسخهٔ پایتون پیاده‌سازی نشده است.")

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

    @app.post("/api/ai/diagnose")
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

    @app.post("/api/ai/vote")
    def node_ai_vote():
        body = _body()
        data = load()
        votes = data.setdefault("ai_votes", {})
        key = _s(body.get("modelKey") or body.get("model"))
        if not key:
            return jsonify(ok=False, error="مدل مشخص نشده است."), 400
        row = votes.setdefault(key, {"up": 0, "down": 0})
        if _s(body.get("vote")) == "down":
            row["down"] = _int(row.get("down")) + 1
        else:
            row["up"] = _int(row.get("up")) + 1
        save(data)
        return ok(votes=votes, model=key)

    @app.get("/api/ai/leaderboard")
    def node_ai_leaderboard():
        votes = load().get("ai_votes") or {}
        items = [{"model": k, "up": _int(v.get("up")), "down": _int(v.get("down")),
                  "score": _int(v.get("up")) - _int(v.get("down"))}
                 for k, v in votes.items() if isinstance(v, dict)]
        items.sort(key=lambda x: -x["score"])
        return ok(items=items)

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

    # AI batch test runs — kept in memory, driven by the real ai_chat().
    AI_RUN: dict[str, Any] = {}

    @app.post("/api/ai/test-runs")
    def node_ai_test_start():
        body = _body()
        prompt = _s(body.get("prompt")).strip()
        title = _s(body.get("categoryTitle")).strip()
        if not prompt and not title:
            return jsonify(ok=False, error="متن آزمایش را بنویسید."), 400
        text = prompt or ("دستهٔ مناسب برای این محصول: " + title)
        model_key = _s(body.get("modelKey"))
        provider, _, model = model_key.partition("::")
        started = time.time()
        try:
            answer = core.ai_chat(text, provider, model)
            AI_RUN.update({"id": "ai-" + _s(int(started)), "status": "done",
                           "prompt": text, "result": _s(answer),
                           "ms": int((time.time() - started) * 1000),
                           "error": ""})
        except Exception as exc:  # noqa: BLE001
            AI_RUN.update({"id": "ai-" + _s(int(started)), "status": "failed",
                           "prompt": text, "result": "", "error": str(exc)[:300]})
        return ok(run=dict(AI_RUN))

    @app.get("/api/ai/test-runs/current")
    def node_ai_test_current():
        return ok(run=dict(AI_RUN) if AI_RUN else None)

    @app.post("/api/ai/test-runs/control")
    @app.post("/api/ai/test-runs/reset")
    @app.post("/api/ai/test-runs/retry")
    def node_ai_test_control():
        if request.path.endswith("/reset"):
            AI_RUN.clear()
            return ok(run=None)
        return ok(run=dict(AI_RUN) if AI_RUN else None)

    @app.get("/api/ai/test-results")
    def node_ai_test_results():
        return ok(items=[dict(AI_RUN)] if AI_RUN else [])

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
            rows = [f"{p.get('id')}: {p.get('name')} ({p.get('url')})"
                    for p in node_profiles_list()]
            return "\n".join(rows) or "هیچ پروفایلی ثبت نشده است."

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

    @app.post("/api/agent/runs")
    def node_agent_run_start():
        body = _body()
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
            payload = core.basalam_api_request(
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
            payload = core.basalam_api_request(
                "GET", f"/v1/chats/{chat_id}/messages", params={"per_page": limit})
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400
        rows = payload if isinstance(payload, list) else (
            payload.get("data") or payload.get("items") or []
            if isinstance(payload, dict) else [])
        return ok(items=rows, chatId=chat_id)

    # ── auto-reply ───────────────────────────────────────────────────────
    @app.post("/api/autoreply/test")
    @app.post("/api/autoreply/run")
    def node_autoreply():
        body = _body()
        text = _s(body.get("text") or body.get("message")).strip()
        if not text:
            return jsonify(ok=False, error="متن پیام را بنویسید."), 400
        rules = load().get("autoreply_rules") or []
        for rule in rules if isinstance(rules, list) else []:
            if not isinstance(rule, dict):
                continue
            triggers = [t.strip().lower() for t in
                        _s(rule.get("triggers")).split(",") if t.strip()]
            if any(t in text.lower() for t in triggers):
                return ok(matched=True, reply=_s(rule.get("reply")),
                          rule=rule.get("name") or rule.get("id"))
        return ok(matched=False, reply="",
                  message="هیچ قاعده‌ای با این متن مطابقت نداشت.")

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

    @app.get("/api/deployer/branches")
    def node_deployer_branches():
        repo = _s(request.args.get("repo"))
        if not repo:
            cfg = core.deploy_config() if hasattr(core, "deploy_config") else {}
            repo = _s(cfg.get("repo"))
        try:
            branches = core.github_branch_list(repo, _deploy_token())
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400
        return ok(repo=repo, branches=branches,
                  items=[_s(b.get("name")) for b in branches])

    @app.get("/api/branch-files")
    def node_branch_files():
        repo = _s(request.args.get("repo"))
        branch = _s(request.args.get("branch"))
        if not repo or not branch:
            return jsonify(ok=False, error="repo و branch لازم است."), 400
        try:
            files = core.github_python_files(repo, branch, _deploy_token())
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400
        return ok(repo=repo, branch=branch, files=files, items=files)

    @app.get("/api/branch-file")
    def node_branch_file():
        repo = _s(request.args.get("repo"))
        branch = _s(request.args.get("branch"))
        path = _s(request.args.get("path"))
        if not (repo and branch and path):
            return jsonify(ok=False, error="repo، branch و path لازم است."), 400
        try:
            info = core.github_file_for(repo, branch, path, _deploy_token(), True)
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400
        content = info.get("content")
        if isinstance(content, bytes):
            content = content.decode("utf-8", errors="replace")
        return ok(repo=repo, branch=branch, path=path,
                  sha=_s(info.get("sha")), content=content or "")

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
    SYNC_FILES = ("scraper4.py", "deployer4.py", "ui_bridge.py",
                  "ai_providers.json")

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
                if name.endswith((".html", ".js", ".css")):
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
        return ok(update=dict(UPDATE),
                  autoUpdate=_s(os.environ.get("SCRAPER_GIT_AUTO_UPDATE", "1")
                                ).lower() not in ("0", "false", "off", "no"),
                  repo=REPO_DIR)

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
        running = [t for t in live_tasks() if _s(t.get("status")) in ("waiting", "running")]
        return ok(watchdog={"running": len(running), "stalled": 0})

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

    # ── graceful stubs so optional panels stay quiet ─────────────────────
    def _empty(payload: dict[str, Any]) -> Callable[..., Any]:
        def view(*_args: Any, **_kwargs: Any):
            return ok(**payload)
        return view

    stubs: dict[str, dict[str, Any]] = {
        "/api/ai/providers": {"providers": []},
        "/api/ai/description-settings": {"settings": {}},
        "/api/ai/workers-catalog": {"items": []},
        "/api/autoreply/log": {"items": []},
        "/api/basalam/orders": {"items": []},
        "/api/bootstrap/status": {"status": "ready"},
        "/api/category-fix-status": {"status": {}},
        "/api/destination/basalam/category-runs/current": {"run": None},
        "/api/destination/basalam/category-tried": {"items": []},
        "/api/digest": {"digest": {}},
        "/api/github/token-status": {"hasToken": bool(os.environ.get("GITHUB_TOKEN"))},
        "/api/maintenance/duplicates": {"items": []},
        "/api/maintenance/ledger": {"items": []},
        "/api/maintenance/ledger/missing": {"items": []},
        "/api/maintenance/ledger/products": {"items": []},
        "/api/notifications/test": {"sent": False},
        "/api/selftest": {"checks": []},
        "/api/web-push/config": {"enabled": False, "publicKey": ""},
        "/api/visual-ticket": {"ticket": ""},
        "/api/branch-push-status": {"status": "idle"},
    }
    for path, payload in stubs.items():
        endpoint = "node_stub_" + re.sub(r"[^a-z0-9]+", "_", path.strip("/").lower())
        app.add_url_rule(path, endpoint, _empty(payload), methods=["GET", "POST"])
