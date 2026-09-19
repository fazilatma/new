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

import json
import os
import re
import time
import uuid
from typing import Any, Callable

from flask import Response, jsonify, request, send_from_directory

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
ENGINES = (
    "auto", "cheerio", "htmlrewriter", "jsonld", "next_data", "metadata",
    "script_json", "heuristic", "structural", "playwright", "puppeteer",
    "crawlee_playwright", "network_api",
)
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
            "extractionEngine": engine if engine in ENGINES else "auto",
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
    @app.get("/ui/")
    def node_dashboard():
        """Serve the Node dashboard HTML verbatim."""
        return send_from_directory(UI_DIR, "dashboard.html")

    @app.get("/ui/dashboard.js")
    @app.get("/dashboard.js")
    def node_dashboard_js():
        response: Response = send_from_directory(UI_DIR, "dashboard.js")
        response.headers["content-type"] = "application/javascript; charset=utf-8"
        return response

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
        return ok(parity={"php": getattr(core, "PHP_PARITY", ""), "python": core.APP_VERSION})

    @app.get("/api/settings")
    def node_settings_get():
        data = load()
        return ok(settings={
            "network": data.get("network") or {},
            "maxPages": getattr(core, "MAX_PAGES_HARD", 0),
            "maxProducts": core.MAX_PRODUCTS_HARD,
            "activeProfile": _s(data.get("active_profile")),
            "autoUpdate": bool(data.get("auto_update", True)),
        })

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
    @app.get("/api/settings-export")
    def node_settings_export():
        return Response(
            json.dumps(load(), ensure_ascii=False, indent=2),
            mimetype="application/json",
            headers={"content-disposition": 'attachment; filename="scraper4-settings.json"'},
        )

    @app.post("/api/settings-import")
    def node_settings_import():
        body = _body()
        payload = body.get("settings") if isinstance(body.get("settings"), dict) else body
        if not isinstance(payload, dict) or not payload:
            return jsonify(ok=False, error="فایل تنظیمات نامعتبر است."), 400
        data = load()
        for key in ("profiles", "woocommerce", "basalam", "network", "ai", "ai_providers"):
            if isinstance(payload.get(key), dict):
                data[key] = payload[key]
        save(data)
        return ok(imported=True)

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

    # ── graceful stubs so optional panels stay quiet ─────────────────────
    def _empty(payload: dict[str, Any]) -> Callable[..., Any]:
        def view(*_args: Any, **_kwargs: Any):
            return ok(**payload)
        return view

    stubs: dict[str, dict[str, Any]] = {
        "/api/ai/providers": {"providers": []},
        "/api/ai/chat-models": {"models": []},
        "/api/ai/leaderboard": {"items": []},
        "/api/ai/test-results": {"items": []},
        "/api/ai/test-runs/current": {"run": None},
        "/api/ai/description-settings": {"settings": {}},
        "/api/ai/workers-catalog": {"items": []},
        "/api/agent/models": {"models": []},
        "/api/agent/prompts": {"prompts": []},
        "/api/agent/tasks": {"tasks": []},
        "/api/agent/templates": {"templates": []},
        "/api/agent/runs": {"runs": []},
        "/api/agent/runs/current": {"run": None},
        "/api/autoreply/log": {"items": []},
        "/api/basalam/orders": {"items": []},
        "/api/bootstrap/status": {"status": "ready"},
        "/api/category-fix-status": {"status": {}},
        "/api/category-learning": {"items": []},
        "/api/destination/basalam/category-runs/current": {"run": None},
        "/api/destination/basalam/category-tried": {"items": []},
        "/api/digest": {"digest": {}},
        "/api/github/token-status": {"hasToken": bool(os.environ.get("GITHUB_TOKEN"))},
        "/api/libraries": {"items": []},
        "/api/runtime/libraries": {"items": []},
        "/api/maintenance/duplicates": {"items": []},
        "/api/maintenance/ledger": {"items": []},
        "/api/maintenance/ledger/missing": {"items": []},
        "/api/maintenance/ledger/products": {"items": []},
        "/api/maintenance/recon-unified": {"items": []},
        "/api/notifications/test": {"sent": False},
        "/api/selftest": {"checks": []},
        "/api/web-push/config": {"enabled": False, "publicKey": ""},
        "/api/visual-ticket": {"ticket": ""},
        "/api/branch-push-status": {"status": "idle"},
    }
    for path, payload in stubs.items():
        endpoint = "node_stub_" + re.sub(r"[^a-z0-9]+", "_", path.strip("/").lower())
        app.add_url_rule(path, endpoint, _empty(payload), methods=["GET", "POST"])
