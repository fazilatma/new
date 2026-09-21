"""Node-compatible API extensions for the Python runtime.

This module deliberately contains the integration-heavy routes that do not
belong to the scraper engine itself (portable backup/restore, PWA, Web Push,
visual selector, branch backup, maintenance ledger and compatibility aliases).
Routes are installed by :mod:`ui_bridge` after its shared adapters are ready.
"""
from __future__ import annotations

import base64
import concurrent.futures
import csv
import hashlib
import io
import ipaddress
import json
import os
import queue
import re
import secrets
import socket
import threading
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from html import escape as html_escape
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import quote, urljoin, urlparse

from flask import Response, jsonify, request, send_file, stream_with_context


def _s(value: Any) -> str:
    return "" if value is None else str(value)


def _int(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError, OverflowError):
        return default


def _num(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError, OverflowError):
        return default


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _body() -> dict[str, Any]:
    value = request.get_json(silent=True)
    return value if isinstance(value, dict) else {}


def _json_value(value: Any, fallback: Any = None) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (TypeError, ValueError):
            pass
    return fallback


def _decode_bundle_file(meta: Any) -> Any:
    if isinstance(meta, dict):
        encoded = meta.get("b64") or meta.get("data") or meta.get("content")
        if isinstance(encoded, str):
            raw = base64.b64decode(encoded.replace("\n", ""), validate=True)
            return json.loads(raw.decode("utf-8-sig"))
        if "value" in meta:
            return meta["value"]
    if isinstance(meta, str):
        return json.loads(meta)
    return meta


def _safe_source_key(row: dict[str, Any], index: int) -> str:
    value = _s(row.get("source_key") or row.get("sourceKey") or row.get("key")).strip()
    return value or "import-" + hashlib.sha256(
        (_s(row.get("title") or row.get("name")) + ":" + _s(index)).encode("utf-8")
    ).hexdigest()[:20]


def install_parity_extensions(app: Any, core: Any, helpers: dict[str, Any]) -> None:
    """Install the remaining Node-compatible routes on ``app``.

    The bridge passes closures for its canonical state and destination adapters;
    keeping one state implementation prevents subtle split-brain configuration.
    """

    load: Callable[[], dict[str, Any]] = helpers["load"]
    save: Callable[[dict[str, Any]], None] = helpers["save"]
    ok: Callable[..., Any] = helpers["ok"]
    profile_products: Callable[[str], list[dict[str, Any]]] = helpers["profile_products"]
    product_to_node: Callable[[dict[str, Any], int], dict[str, Any]] = helpers["product_to_node"]
    profile_to_node: Callable[[str, dict[str, Any]], dict[str, Any]] = helpers["profile_to_node"]
    start_scrape: Callable[[str], Any] = helpers["start_scrape"]
    task_to_job: Callable[[dict[str, Any]], dict[str, Any]] = helpers["task_to_job"]
    live_tasks: Callable[[], list[dict[str, Any]]] = helpers["live_tasks"]
    bundle_files: Callable[[dict[str, Any]], dict[str, Any]] = helpers["bundle_files"]
    destination_rows: Callable[[str, str], tuple[list[dict[str, Any]], list[dict[str, Any]]]] = helpers["destination_rows"]
    destination_view: Callable[[dict[str, Any], str], dict[str, Any]] = helpers["destination_view"]
    dest_key: Callable[[str], str] = helpers["dest_key"]
    shop_context: Callable[[Any], Any] = helpers["shop_context"]
    agent_start: Callable[[dict[str, Any]], Any] = helpers["agent_start"]

    # ------------------------------------------------------------------
    # Portable full backup / restore
    # ------------------------------------------------------------------
    def make_backup() -> dict[str, Any]:
        data = load()
        files = bundle_files(data)
        profiles, products = [], []
        for name, cfg in (data.get("profiles") or {}).items():
            if not isinstance(cfg, dict):
                continue
            profile = {k: v for k, v in cfg.items() if k != "saved_products"}
            profiles.append({"id": name, "data": profile, "enabled": bool(cfg.get("enabled", True)),
                             "interval_minutes": _int(cfg.get("interval_minutes") or cfg.get("interval"))})
            for index, row in enumerate(cfg.get("saved_products") or []):
                if not isinstance(row, dict):
                    continue
                products.append({"profile_id": name, "source_key": _safe_source_key(row, index),
                                 "data": row, "title": _s(row.get("title")),
                                 "price": _num(row.get("price")),
                                 "source_url": _s(row.get("url") or row.get("link"))})
        states = [{"key": key, "value": value} for key, value in data.items()
                  if key != "profiles"]
        return {
            "app": "scraper4-backup", "runtime": "python", "version": 1,
            "appVersion": _s(core.APP_VERSION), "createdAt": _now_iso(),
            "created_at": int(time.time()), "format": "scraper4-python-full-1",
            "profiles": profiles, "products": products, "states": states,
            "destinationMap": data.get("remote_map") or [],
            "categoryLearning": data.get("category_learning") or [],
            "autoreplyLog": data.get("autoreply_log") or [],
            "files": files, "total_files": len(files), "data": data,
        }

    def restore_backup(bundle: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(bundle, dict) or not bundle:
            raise ValueError("فایل بکاپ معتبر Scraper4 نیست.")
        data = load()
        profiles_count = products_count = states_count = categories_count = 0

        # Native Python full snapshot is lossless and preferred.
        snapshot = bundle.get("data")
        if isinstance(snapshot, dict) and isinstance(snapshot.get("profiles"), dict):
            restored = dict(snapshot)
            profiles_count = len(restored.get("profiles") or {})
            products_count = sum(len(cfg.get("saved_products") or [])
                                 for cfg in (restored.get("profiles") or {}).values()
                                 if isinstance(cfg, dict))
            states_count = len(restored) - 1
            categories_count = len(restored.get("category_learning") or [])
            save(restored)
            return {"profiles": profiles_count, "products": products_count,
                    "states": states_count, "categories": categories_count,
                    "mode": "replace-native"}

        # PHP-compatible settings bundle used by the dashboard and split backups.
        files = bundle.get("files") if isinstance(bundle.get("files"), dict) else None
        if files is not None:
            decoded: dict[str, Any] = {}
            for name, meta in files.items():
                try:
                    decoded[_s(name)] = _decode_bundle_file(meta)
                except (ValueError, TypeError, json.JSONDecodeError) as exc:
                    raise ValueError(f"بخش {name} بکاپ خراب است: {exc}") from exc
            raw_profiles = decoded.get("profiles.json") or {}
            raw_products = decoded.get("profile_products.json") or {}
            if isinstance(raw_profiles, list):
                raw_profiles = {_s(x.get("id") or x.get("name")): x
                                for x in raw_profiles if isinstance(x, dict)}
            if isinstance(raw_profiles, dict):
                for name, cfg in raw_profiles.items():
                    if not name or not isinstance(cfg, dict):
                        continue
                    current = dict((data.get("profiles") or {}).get(name) or {})
                    rows = ((raw_products.get(name) or []) if isinstance(raw_products, dict)
                            else current.get("saved_products") or [])
                    current.update(cfg)
                    current["saved_products"] = rows if isinstance(rows, list) else []
                    data.setdefault("profiles", {})[_s(name)] = current
                    profiles_count += 1
                    products_count += len(current["saved_products"])
            connections = decoded.get("connections.json")
            if isinstance(connections, dict):
                data["woocommerce"] = connections.get("woocommerce") or connections.get("woo") or data.get("woocommerce", {})
                data["basalam"] = connections.get("basalam") or data.get("basalam", {})
                ai = connections.get("ai") if isinstance(connections.get("ai"), dict) else {}
                if isinstance(ai.get("providers"), (dict, list)):
                    data["ai_providers"] = ai["providers"]
                if isinstance(ai.get("settings"), dict):
                    data["ai"] = ai["settings"]
                data["ai_candidates"] = ai.get("candidates") or data.get("ai_candidates", [])
                data["ai_master"] = ai.get("master") or data.get("ai_master", "")
                data["notifications"] = connections.get("notifications") or data.get("notifications", {})
                data["network"] = connections.get("network") or data.get("network", {})
                states_count += 1
            file_state = {
                "category_learning.json": "category_learning", "autoreply_rules.json": "autoreply_rules",
                "autoreply_log.json": "autoreply_log", "autoreply_state.json": "autoreply_state",
                "render_settings.json": "render_settings", "notification_settings.json": "notification_settings",
                "digest_state.json": "digest_state", "ai_votes.json": "ai_votes",
                "ai_providers.json": "ai_providers", "ai_candidates.json": "ai_candidates",
                "sync_state.json": "sync_state", "remote_map.json": "remote_map",
            }
            for filename, key in file_state.items():
                if filename in decoded:
                    data[key] = decoded[filename]
                    states_count += 1
            categories_count = len(data.get("category_learning") or [])
            if not profiles_count and not states_count:
                raise ValueError("فایل بکاپ هیچ بخش شناخته‌شده‌ای ندارد.")
            save(data)
            return {"profiles": profiles_count, "products": products_count,
                    "states": states_count, "categories": categories_count,
                    "mode": "merge-settings-bundle"}

        # Node Worker/Render relational backup. Convert rows to Python profiles.
        accepted = {"scraper4-backup", "scraper4-render", "scraper4-cloudflare"}
        if _s(bundle.get("app")) not in accepted:
            raise ValueError("شناسهٔ فایل بکاپ شناخته‌شده نیست.")
        raw_profiles = bundle.get("profiles") or []
        if not isinstance(raw_profiles, list):
            raise ValueError("فهرست پروفایل‌های بکاپ نامعتبر است.")
        for row in raw_profiles:
            if not isinstance(row, dict):
                continue
            name = _s(row.get("id") or row.get("name")).strip()
            cfg = _json_value(row.get("data"), row.get("data"))
            if not name or not isinstance(cfg, dict):
                continue
            current = dict((data.get("profiles") or {}).get(name) or {})
            current.update(cfg)
            current.setdefault("saved_products", [])
            data.setdefault("profiles", {})[name] = current
            profiles_count += 1
        for index, row in enumerate(bundle.get("products") or []):
            if not isinstance(row, dict):
                continue
            name = _s(row.get("profile_id") or row.get("profileId"))
            if name not in (data.get("profiles") or {}):
                continue
            product = _json_value(row.get("data"), row.get("data"))
            if not isinstance(product, dict):
                product = dict(row)
            product.setdefault("source_key", _safe_source_key(row, index))
            rows = data["profiles"][name].setdefault("saved_products", [])
            source = _s(product.get("source_key") or product.get("sourceKey"))
            rows[:] = [old for old in rows if _s(old.get("source_key") or old.get("sourceKey")) != source]
            rows.append(product)
            products_count += 1
        for row in bundle.get("states") or []:
            if not isinstance(row, dict) or not _s(row.get("key")):
                continue
            data[_s(row["key"])] = _json_value(row.get("value"), row.get("value"))
            states_count += 1
        if isinstance(bundle.get("categoryLearning"), list):
            data["category_learning"] = bundle["categoryLearning"]
            categories_count = len(bundle["categoryLearning"])
        if isinstance(bundle.get("autoreplyLog"), list):
            data["autoreply_log"] = bundle["autoreplyLog"]
        save(data)
        return {"profiles": profiles_count, "products": products_count,
                "states": states_count, "categories": categories_count,
                "mode": "merge-node-backup"}

    @app.get("/api/backup")
    def parity_backup():
        bundle = make_backup()
        return Response(json.dumps(bundle, ensure_ascii=False, indent=2),
                        mimetype="application/json",
                        headers={"cache-control": "no-store", "content-disposition":
                                 f'attachment; filename="scraper4-python-{int(time.time())}.json"'})

    @app.post("/api/restore")
    def parity_restore():
        try:
            result = restore_backup(_body())
            return ok(result=result, imported=result)
        except (ValueError, TypeError) as exc:
            return jsonify(ok=False, error=str(exc)), 400

    # ------------------------------------------------------------------
    # Legacy compatibility surface
    # ------------------------------------------------------------------
    @app.get("/legacy/profiles")
    def parity_legacy_profiles():
        data = load()
        rows = [profile_to_node(name, cfg) for name, cfg in
                (data.get("profiles") or {}).items() if isinstance(cfg, dict)]
        return jsonify(ok=True, data=rows)

    @app.get("/legacy/profiles/<path:profile_id>/products")
    def parity_legacy_products(profile_id: str):
        rows = [product_to_node(row, index) for index, row in
                enumerate(profile_products(profile_id)[:500])]
        return jsonify(ok=True, data=rows)

    @app.get("/legacy/jobs")
    def parity_legacy_jobs():
        return jsonify(ok=True, data=[task_to_job(task) for task in live_tasks()[:100]])

    @app.post("/legacy/profiles")
    def parity_legacy_profile_save():
        body = _body()
        name = _s(body.get("id") or body.get("name")).strip()
        if not name:
            return jsonify(ok=False, error="Profile id is required"), 400
        data = load()
        current = dict((data.get("profiles") or {}).get(name) or {})
        current.update({
            "name": _s(body.get("name")) or name, "url": _s(body.get("url")),
            "pages": max(1, _int(body.get("pages"), 1)),
            "enabled": body.get("enabled", True) is not False,
        })
        if isinstance(body.get("selectors"), dict):
            current["selectors"] = body["selectors"]
        current.setdefault("saved_products", [])
        data.setdefault("profiles", {})[name] = current
        save(data)
        return jsonify(ok=True, data=profile_to_node(name, current))

    @app.post("/legacy/profiles/<path:profile_id>/extract")
    def parity_legacy_extract(profile_id: str):
        return start_scrape(profile_id)

    @app.post("/legacy/profiles/<path:profile_id>/sync")
    def parity_legacy_sync(profile_id: str):
        return start_scrape(profile_id)

    @app.get("/legacy/backup")
    def parity_legacy_backup():
        return jsonify(ok=True, data=make_backup())

    @app.post("/legacy/restore")
    def parity_legacy_restore():
        try:
            return jsonify(ok=True, data=restore_backup(_body()))
        except (ValueError, TypeError) as exc:
            return jsonify(ok=False, error=str(exc)), 400

    # ------------------------------------------------------------------
    # Product import, one-product sync and explicit queue aliases
    # ------------------------------------------------------------------
    @app.post("/api/profiles/<path:profile_id>/import")
    def parity_profile_import(profile_id: str):
        body = _body()
        data = load()
        profile = (data.get("profiles") or {}).get(profile_id)
        if not isinstance(profile, dict):
            return jsonify(ok=False, error="Profile not found"), 404
        rows = body.get("rows") if isinstance(body.get("rows"), list) else []
        if not rows and isinstance(body.get("csv"), str):
            rows = list(csv.DictReader(io.StringIO(body["csv"].lstrip("\ufeff"))))
        if not isinstance(rows, list):
            return jsonify(ok=False, error="بدنه باید فیلد rows یا csv داشته باشد."), 400
        imported = failed = skipped = 0
        errors: list[str] = []
        existing = profile.setdefault("saved_products", [])
        mapping = body.get("mapping") if isinstance(body.get("mapping"), dict) else {}
        for index, raw in enumerate(rows):
            try:
                if not isinstance(raw, dict):
                    raise ValueError("row is not an object")
                row = {mapping.get(k, k): v for k, v in raw.items()}
                title = _s(row.get("title") or row.get("name")).strip()
                if not title:
                    if body.get("skipMissingTitle", True):
                        skipped += 1
                        continue
                    raise ValueError("title is empty")
                price_text = _s(row.get("price") or row.get("priceText"))
                price = _num(re.sub(r"[^\d.-]", "", price_text))
                if price <= 0 and body.get("skipMissingPrice", True):
                    skipped += 1
                    continue
                key = _safe_source_key(row, index)
                image = _s(row.get("image") or row.get("photo"))
                product = {
                    "source_key": key, "title": title, "price": price,
                    "price_text": price_text, "url": _s(row.get("url") or row.get("link")),
                    "image": image, "images": [image] if image else [],
                    "sku": _s(row.get("sku")), "brand": _s(row.get("brand")),
                    "category": _s(row.get("category")), "short_desc": _s(row.get("shortDesc")),
                    "long_desc": _s(row.get("longDesc")), "source_page": "import",
                    "scraped_at": _now_iso(),
                }
                if row.get("stock") not in (None, ""):
                    product["stock"] = _int(row.get("stock"))
                if row.get("weight") not in (None, ""):
                    product["weight"] = _num(row.get("weight"))
                old_index = next((i for i, old in enumerate(existing)
                                  if isinstance(old, dict) and
                                  _s(old.get("source_key") or old.get("sourceKey")) == key), -1)
                if old_index >= 0:
                    existing[old_index] = {**existing[old_index], **product}
                else:
                    existing.append(product)
                imported += 1
            except Exception as exc:  # noqa: BLE001
                failed += 1
                if len(errors) < 50:
                    errors.append(f"row {index + 1}: {exc}")
        history = data.setdefault("import_history", [])
        if isinstance(history, list):
            history.append({"fileName": _s(request.args.get("name") or body.get("name")),
                            "rows": len(rows), "imported": imported, "failed": failed,
                            "skipped": skipped, "at": _now_iso()})
            data["import_history"] = history[-100:]
        save(data)
        return jsonify(ok=failed == 0 and imported > 0, rows=len(rows), imported=imported,
                       failed=failed, skipped=skipped, errors=errors)

    @app.post("/api/products/<path:profile_id>/<path:source_key>/sync/<target>")
    def parity_product_sync(profile_id: str, source_key: str, target: str):
        data = load()
        profile = (data.get("profiles") or {}).get(profile_id)
        if not isinstance(profile, dict):
            return jsonify(ok=False, error="Product/profile not found"), 404
        product = next((row for row in profile.get("saved_products") or []
                        if isinstance(row, dict) and
                        _s(row.get("source_key") or row.get("sourceKey")) == source_key), None)
        if product is None:
            return jsonify(ok=False, error="Product/profile not found"), 404
        try:
            key = dest_key(target)
            if key == "woocommerce":
                result = core.woo_send_one(product,
                                           _s(product.get("destination_status") or "draft"), True)
            else:
                result = core.basalam_fanout_send(product)
            return ok(result=result)
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400

    @app.post("/api/jobs/<job_id>/start")
    def parity_job_start(job_id: str):
        task = next((row for row in live_tasks() if _s(row.get("id")) == job_id), None)
        if not task:
            return jsonify(ok=False, error="Job not found"), 404
        status = _s(task.get("status"))
        if status not in {"queued", "waiting"}:
            return jsonify(ok=False, error="Only queued jobs can be started"), 409
        profile = _s(task.get("profile") or task.get("profileId"))
        if not profile:
            return jsonify(ok=False, error="Queued job has no profile"), 409
        return start_scrape(profile)

    @app.post("/api/jobs/<job_id>/retry")
    def parity_job_retry(job_id: str):
        task = next((row for row in live_tasks() if _s(row.get("id")) == job_id), None)
        if not task:
            return jsonify(ok=False, error="Job cannot be retried"), 409
        profile = _s(task.get("profile") or task.get("profileId"))
        if not profile:
            return jsonify(ok=False, error="Job cannot be retried"), 409
        return start_scrape(profile)

    # ------------------------------------------------------------------
    # Direct AI calls, batch compatibility and description enrichment
    # ------------------------------------------------------------------
    def ai_models(only_candidates: bool = False) -> list[dict[str, str]]:
        data = load()
        providers = data.get("ai_providers") or {}
        try:
            providers = core.normalize_ai_providers(providers)
        except Exception:  # noqa: BLE001
            providers = providers if isinstance(providers, dict) else {}
        candidates = {_s(value) for value in data.get("ai_candidates") or []}
        rows: list[dict[str, str]] = []
        for pid, provider in providers.items():
            if not isinstance(provider, dict) or provider.get("enabled") is False:
                continue
            pname = _s(provider.get("name") or pid)
            for model in provider.get("models") or []:
                if isinstance(model, dict):
                    if model.get("enabled") is False:
                        continue
                    model_id = _s(model.get("id") or model.get("name"))
                else:
                    model_id = _s(model)
                key = f"{pid}::{model_id}"
                if model_id and (not only_candidates or key in candidates or model_id in candidates):
                    rows.append({"key": key, "provider": _s(pid),
                                 "providerName": pname, "model": model_id})
        ai = data.get("ai") if isinstance(data.get("ai"), dict) else {}
        if not rows and _s(ai.get("model")):
            pid = _s(ai.get("provider")) or "default"
            rows.append({"key": f"{pid}::{ai['model']}", "provider": pid,
                         "providerName": pid, "model": _s(ai["model"])})
        return rows

    def ai_call_one(provider: str, model: str, prompt: str) -> dict[str, Any]:
        # The ::kN suffix identifies a provider key in Node. The Python core
        # already rotates enabled keys on auth/rate failures, so strip only the
        # suffix while preserving the public key in responses.
        clean_model = re.sub(r"::k\d+$", "", _s(model))
        started = time.monotonic()
        try:
            text = core.ai_chat(prompt, provider, clean_model)
            return {"ok": True, "provider": provider, "model": clean_model,
                    "key": f"{provider}::{model}", "text": _s(text),
                    "latencyMs": int((time.monotonic() - started) * 1000)}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "provider": provider, "model": clean_model,
                    "key": f"{provider}::{model}", "text": "",
                    "latencyMs": int((time.monotonic() - started) * 1000),
                    "error": str(exc)[:1200]}

    @app.post("/api/ai/call")
    def parity_ai_call():
        body = _body()
        provider, model = _s(body.get("provider")), _s(body.get("model"))
        known = ai_models(False)
        if provider and not any(row["provider"] == provider for row in known):
            return jsonify(ok=False, error="Provider not found"), 404
        if not provider and "::" in model:
            provider, model = model.split("::", 1)
        if not provider:
            provider = _s((load().get("ai") or {}).get("provider"))
        if not model:
            model = _s((load().get("ai") or {}).get("model"))
        result = ai_call_one(provider, model,
                             _s(body.get("prompt")) or "Reply with exactly: SCRAPER4_OK")
        return jsonify(result), (200 if result.get("ok") else 400)

    def category_result(title: str, row: dict[str, Any], categories: list[dict[str, Any]]) -> dict[str, Any]:
        if not title:
            return {"ok": False, "skipped": True, "error": "category title is empty"}
        names = [_s(item.get("path") or item.get("name")) for item in categories[:300]
                 if isinstance(item, dict) and _s(item.get("path") or item.get("name"))]
        if not names:
            return {"ok": False, "skipped": True, "error": "category list unavailable"}
        prompt = ("برای عنوان محصول زیر فقط JSON با کلید category بده؛ مقدار category باید "
                  "دقیقاً یکی از دسته‌های فهرست باشد.\nعنوان: " + title +
                  "\nدسته‌ها: " + " | ".join(names))
        reply = ai_call_one(row["provider"], row["model"], prompt)
        if not reply.get("ok"):
            return {"ok": False, "error": reply.get("error"), "text": reply.get("text", "")}
        suggestion = _s(reply.get("text")).strip()
        try:
            obj = core.ai_parse_json_object(suggestion)
            suggestion = _s(obj.get("category") or obj.get("categoryName") or suggestion)
        except Exception:  # noqa: BLE001
            pass
        found = core.ai_match_category(suggestion, categories)
        if not found:
            return {"ok": False, "error": "پاسخ با دسته‌های معتبر منطبق نشد.",
                    "text": reply.get("text", ""), "suggestion": suggestion}
        return {"ok": True, "categoryId": _int(found.get("id")),
                "categoryName": _s(found.get("name") or suggestion),
                "categoryPath": _s(found.get("path") or found.get("name")),
                "text": reply.get("text", "")}

    def run_ai_batch(body: dict[str, Any]) -> dict[str, Any]:
        prompt = _s(body.get("prompt")) or "Reply with exactly: SCRAPER4_OK"
        title = _s(body.get("categoryTitle")).strip()
        rows = ai_models(bool(body.get("onlyCandidates")))
        cursor = max(0, _int(body.get("cursor")))
        rows = rows[cursor:]
        categories: list[dict[str, Any]] = []
        if title:
            try:
                categories = core.ai_load_category_rows()
            except Exception:  # noqa: BLE001
                categories = []

        def test(row: dict[str, str]) -> dict[str, Any]:
            result = ai_call_one(row["provider"], row["model"], prompt)
            result["providerName"] = row["providerName"]
            result["prompt"] = prompt
            if title:
                result["categoryTitle"] = title
                result["categoryResult"] = category_result(title, row, categories)
            return result

        results: list[dict[str, Any]] = []
        # Parallelise across providers, while serialising models belonging to
        # the same provider to avoid tripping per-provider limits.
        grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
        for row in rows:
            grouped[row["provider"]].append(row)

        def test_group(group: list[dict[str, str]]) -> list[dict[str, Any]]:
            delay = max(0, min(60_000, _int(body.get("delayMs")))) / 1000
            out = []
            for index, row in enumerate(group):
                if index and delay:
                    time.sleep(delay)
                out.append(test(row))
            return out

        with concurrent.futures.ThreadPoolExecutor(max_workers=min(5, max(1, len(grouped)))) as pool:
            future_rows = [pool.submit(test_group, group) for group in grouped.values()]
            for future in future_rows:
                results.extend(future.result())
        order = {row["key"]: index for index, row in enumerate(rows)}
        results.sort(key=lambda value: order.get(_s(value.get("key")), 1_000_000))
        return {"ok": True, "prompt": prompt, "categoryTitle": title,
                "results": results, "total": len(rows), "tested": len(results),
                "okCount": sum(bool(row.get("ok")) for row in results),
                "failed": sum(not bool(row.get("ok")) for row in results),
                "categoryListAvailable": bool(categories), "done": True,
                "nextCursor": cursor + len(results)}

    @app.post("/api/ai/test-all")
    def parity_ai_test_all():
        started = time.monotonic()
        result = run_ai_batch(_body())
        result["durationMs"] = int((time.monotonic() - started) * 1000)
        result["invocationPolicy"] = ("مدل‌های ارائه‌دهنده‌های مستقل هم‌زمان و مدل‌های هر "
                                      "ارائه‌دهنده به‌ترتیب آزمایش شدند.")
        data = load()
        data["ai_test_results"] = {**result, "at": _now_iso()}
        save(data)
        return jsonify(result)

    def master_model() -> tuple[str, str]:
        data = load()
        key = _s(data.get("ai_master") or (data.get("ai") or {}).get("master"))
        if "::" in key:
            return tuple(key.split("::", 1))  # type: ignore[return-value]
        ai = data.get("ai") if isinstance(data.get("ai"), dict) else {}
        return _s(ai.get("provider")), _s(ai.get("model"))

    @app.get("/api/ai/description-settings")
    def parity_ai_description_settings_get():
        data = load()
        settings = data.get("ai_description_settings")
        if not isinstance(settings, dict):
            settings = {"enabled": True}
        provider, model = master_model()
        return ok(settings={"enabled": settings.get("enabled", True) is not False},
                  master=({"provider": provider, "model": model} if model else None),
                  last=data.get("ai_description_last"))

    @app.post("/api/ai/description-settings")
    def parity_ai_description_settings_post():
        data = load()
        enabled = _body().get("enabled", True) not in (False, "false", 0, "0")
        data["ai_description_settings"] = {"enabled": enabled}
        save(data)
        return ok(settings={"enabled": enabled})

    @app.post("/api/profiles/<path:profile_id>/ai-descriptions")
    def parity_ai_descriptions(profile_id: str):
        body = _body()
        data = load()
        profile = (data.get("profiles") or {}).get(profile_id)
        if not isinstance(profile, dict):
            return jsonify(ok=False, error="پروفایل پیدا نشد."), 404
        provider, model = master_model()
        if not model:
            return jsonify(ok=False, error="هیچ مدل هوش مصنوعی فعالی پیدا نشد."), 400
        force = body.get("force") in (True, "true", 1, "1")
        limit = max(1, min(200, _int(body.get("limit"), 25)))
        rows = profile.get("saved_products") if isinstance(profile.get("saved_products"), list) else []
        targets = [(index, row) for index, row in enumerate(rows)
                   if isinstance(row, dict) and
                   (force or core.ai_product_needs_content(row))][:limit]
        filled = 0
        failures: list[dict[str, str]] = []
        for index, product in targets:
            prompt = ("برای محصول زیر فقط JSON معتبر با کلیدهای short_desc، long_desc_html و tags "
                      "برگردان. فارسی، دقیق و بدون ادعای ساختگی باشد:\n" +
                      json.dumps({key: product.get(key) for key in
                                  ("title", "brand", "category", "price", "variations_text")},
                                 ensure_ascii=False))
            try:
                obj = core.ai_parse_json_object(core.ai_chat(prompt, provider, model))
                changed = False
                short = _s(obj.get("short_desc") or obj.get("shortDesc")).strip()
                long_desc = _s(obj.get("long_desc_html") or obj.get("long_desc") or
                               obj.get("longDesc")).strip()
                if short and (force or not _s(product.get("short_desc") or product.get("shortDesc"))):
                    product["short_desc"] = short
                    changed = True
                if long_desc and (force or not _s(product.get("long_desc_html") or product.get("long_desc") or product.get("longDesc"))):
                    product["long_desc_html"] = long_desc
                    product["long_desc"] = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", long_desc)).strip()
                    changed = True
                if isinstance(obj.get("tags"), list):
                    product["tags"] = [_s(value).strip() for value in obj["tags"]
                                       if _s(value).strip()][:12]
                    changed = True
                if changed:
                    product["ai_content_at"] = int(time.time())
                    rows[index] = product
                    filled += 1
            except Exception as exc:  # noqa: BLE001
                failures.append({"title": _s(product.get("title")), "error": str(exc)[:500]})
        profile["saved_products"] = rows
        last = {"at": _now_iso(), "profileId": profile_id, "model": model,
                "candidates": len(targets), "filled": filled, "failed": len(failures)}
        data["ai_description_last"] = last
        save(data)
        return ok(profileId=profile_id, provider=provider, model=model,
                  candidates=len(targets), filled=filled, failed=len(failures),
                  failures=failures[:5])

    @app.get("/api/ai/workers-catalog")
    def parity_workers_catalog():
        path = Path(core.BASE_DIR) / "ui" / "workers-ai-catalog.json"
        try:
            rows = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            rows = []
        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in rows if isinstance(rows, list) else []:
            if isinstance(row, dict):
                item = dict(row)
                item.setdefault("status", "active")
                item["tags"] = item.get("tags") if isinstance(item.get("tags"), list) else []
                grouped[_s(item.get("task")) or "Other"].append(item)
        groups = [{"task": task, "models": models} for task, models in sorted(grouped.items())]
        return ok(groups=groups, total=sum(len(group["models"]) for group in groups))

    @app.post("/api/agent/prompts/<path:prompt_id>/run")
    def parity_agent_prompt_run(prompt_id: str):
        row = next((value for value in load().get("agent_prompts") or []
                    if isinstance(value, dict) and _s(value.get("id")) == prompt_id), None)
        if not row:
            return jsonify(ok=False, error="Prompt not found"), 404
        overrides = _body()
        payload = dict(row)
        payload.update({key: value for key, value in overrides.items()
                        if key in {"name", "prompt", "tools", "maxSteps", "providerId", "model", "modelKey"}})
        payload["promptId"] = prompt_id
        return agent_start(payload)

    # ------------------------------------------------------------------
    # Persistent Basalam category run (real listing, voting and PATCH)
    # ------------------------------------------------------------------
    category_lock = threading.RLock()
    category_thread: dict[str, Optional[threading.Thread]] = {"thread": None}

    def category_models(mode: str, requested: list[Any]) -> list[str]:
        data = load()
        master = _s(data.get("ai_master") or (data.get("ai") or {}).get("master"))
        if not master:
            provider, model = master_model()
            master = f"{provider}::{model}" if model else ""
        candidates = [_s(value) for value in data.get("ai_candidates") or [] if _s(value)]
        requested_rows = [_s(value) for value in requested if _s(value)]
        if mode == "master":
            rows = [master]
        elif mode == "master-candidates":
            rows = [master, *(requested_rows or candidates)]
        else:
            rows = requested_rows or candidates or [master]
        return list(dict.fromkeys(value for value in rows if "::" in value))[:5]

    def get_category_run() -> Optional[dict[str, Any]]:
        run = load().get("category_run")
        return dict(run) if isinstance(run, dict) else None

    def put_category_run(run: dict[str, Any]) -> None:
        with category_lock:
            data = load()
            data["category_run"] = dict(run)
            save(data)

    def category_suggestion(title: str, model_key: str,
                            categories: list[dict[str, Any]]) -> tuple[Optional[dict[str, Any]], str]:
        provider, model = model_key.split("::", 1)
        names = [_s(row.get("path") or row.get("name")) for row in categories[:500]
                 if isinstance(row, dict) and _s(row.get("path") or row.get("name"))]
        prompt = ("برای این محصول مناسب‌ترین دسته باسلام را انتخاب کن. فقط JSON معتبر با "
                  "کلید category برگردان؛ مقدار آن باید دقیقاً یکی از گزینه‌ها باشد.\n"
                  f"محصول: {title}\nگزینه‌ها: " + " | ".join(names))
        reply = core.ai_chat(prompt, provider, re.sub(r"::k\d+$", "", model))
        suggestion = _s(reply).strip()
        try:
            parsed = core.ai_parse_json_object(reply)
            suggestion = _s(parsed.get("category") or parsed.get("categoryName") or suggestion)
        except Exception:  # noqa: BLE001
            pass
        return core.ai_match_category(suggestion, categories), suggestion

    def category_worker(run_id: str) -> None:
        run = get_category_run()
        if not run or _s(run.get("id")) != run_id:
            return
        try:
            run.update(status="running", phase="listing", error="", updatedAt=_now_iso())
            put_category_run(run)
            raw_rows, _shops = destination_rows("basalam", "all")
            views = [destination_view(row, "basalam") for row in raw_rows]
            # Node's action is specifically for unapproved products. If a
            # destination omits status, include it rather than silently doing
            # nothing; explicit active/archive states are never included.
            products = [row for row in views if _int(row.get("status")) == 3567 or
                        _s(row.get("status")).lower() in {"", "unapproved", "pending_approval"}]
            run.update(phase="categorizing", total=len(products), totalPages=1, page=1,
                       updatedAt=_now_iso())
            put_category_run(run)
            categories = core.ai_load_category_rows()
            if not categories:
                raise ValueError("فهرست دسته‌های باسلام قابل دریافت نیست.")
            start = min(len(products), max(0, _int(run.get("cursor"))))
            for index in range(start, len(products)):
                latest = get_category_run() or run
                if _s(latest.get("id")) != run_id:
                    return
                if latest.get("stopRequested"):
                    run.update(status="paused", cursor=index, processed=index,
                               phase="paused", updatedAt=_now_iso())
                    put_category_run(run)
                    return
                row = products[index]
                item_id, shop_id = _s(row.get("id")), _s(row.get("shopId"))
                title = _s(row.get("title"))
                tried_key = f"{shop_id}:{item_id}"
                tried = {_int(value) for value in
                         (load().get("basalam_category_tried") or {}).get(tried_key, [])}
                current = _int(row.get("categoryId"))
                votes: Counter[int] = Counter()
                found_by_id: dict[int, dict[str, Any]] = {}
                alternatives: list[dict[str, Any]] = []
                errors: list[str] = []
                for model_key in run.get("modelKeys") or []:
                    try:
                        found, suggestion = category_suggestion(title, _s(model_key), categories)
                        cid = _int((found or {}).get("id"))
                        valid = bool(cid and cid != current and cid not in tried)
                        alternatives.append({"model": model_key, "ok": valid,
                                             "categoryId": cid,
                                             "categoryName": _s((found or {}).get("name")),
                                             "suggestion": suggestion})
                        if valid:
                            votes[cid] += 1
                            found_by_id[cid] = found or {}
                    except Exception as exc:  # noqa: BLE001
                        errors.append(f"{model_key}: {str(exc)[:180]}")
                        alternatives.append({"model": model_key, "ok": False,
                                             "error": str(exc)[:300]})
                winner = votes.most_common(1)[0] if votes else (0, 0)
                cid, vote_count = winner
                needed = 1 if run.get("mode") == "master" else max(1, len(run.get("modelKeys") or []) // 2 + 1)
                result: dict[str, Any] = {"id": item_id, "shopId": shop_id,
                                          "title": title, "ok": False,
                                          "alternatives": alternatives[-5:]}
                if cid and vote_count >= needed:
                    try:
                        context, _shop = shop_context(shop_id)
                        with context:
                            core.basalam_api_request("PATCH", f"/v1/products/{item_id}",
                                                     json_data={"category_id": cid})
                        found = found_by_id[cid]
                        confidence = round(vote_count * 100 / max(1, len(run.get("modelKeys") or [])))
                        result.update(ok=True, categoryId=cid,
                                      categoryName=_s(found.get("name")),
                                      source=f"رأی {vote_count} مدل", confidence=confidence)
                        run["changed"] = _int(run.get("changed")) + 1
                        data = load()
                        tried_rows = data.setdefault("basalam_category_tried", {})
                        tried_rows[tried_key] = list(dict.fromkeys([*tried, cid]))[-30:]
                        learned = data.setdefault("category_learning", [])
                        if isinstance(learned, list):
                            learned.append({"title": title, "phrase": title,
                                            "categoryId": cid,
                                            "categoryName": _s(found.get("name")),
                                            "source": "category-run", "at": _now_iso()})
                            data["category_learning"] = learned[-5000:]
                        save(data)
                    except Exception as exc:  # noqa: BLE001
                        result["error"] = str(exc)[:400]
                        run["failed"] = _int(run.get("failed")) + 1
                else:
                    result["error"] = ("رأی معتبر اکثریت به دست نیامد" +
                                       ((" — " + " | ".join(errors[:2])) if errors else ""))
                    run["failed"] = _int(run.get("failed")) + 1
                items = run.get("items") if isinstance(run.get("items"), list) else []
                items.append(result)
                run.update(items=items[-300:], processed=index + 1, cursor=index + 1,
                           updatedAt=_now_iso())
                put_category_run(run)
            run.update(status="done", phase="done", processed=len(products),
                       cursor=len(products), finishedAt=_now_iso(), updatedAt=_now_iso())
            put_category_run(run)
            data = load()
            data["category_fix_last"] = {"at": _now_iso(), "trigger": run.get("trigger", "manual"),
                                         "mode": run.get("mode"), "ok": True,
                                         "changed": run.get("changed"), "failed": run.get("failed")}
            save(data)
        except Exception as exc:  # noqa: BLE001
            run = get_category_run() or run
            run.update(status="failed", phase="failed", error=str(exc)[:800],
                       finishedAt=_now_iso(), updatedAt=_now_iso())
            put_category_run(run)
            data = load()
            data["category_fix_last"] = {"at": _now_iso(), "trigger": run.get("trigger", "manual"),
                                         "mode": run.get("mode"), "ok": False,
                                         "error": str(exc)[:800]}
            save(data)

    def launch_category(run: dict[str, Any]) -> None:
        thread = threading.Thread(target=category_worker, args=(_s(run.get("id")),),
                                  name="basalam-category-run", daemon=True)
        category_thread["thread"] = thread
        thread.start()

    @app.get("/api/destination/basalam/category-runs/current")
    def parity_category_current():
        return ok(run=get_category_run())

    def start_category_run(body: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        """Claim and launch a run for both HTTP and the periodic scheduler."""
        with category_lock:
            existing = get_category_run()
            if existing and existing.get("status") in {"queued", "running"}:
                return existing, True
            mode = _s(body.get("mode"))
            if mode not in {"master", "master-candidates", "ensemble"}:
                mode = "ensemble"
            models = category_models(mode, body.get("consensusModels") or [])
            if not models:
                raise ValueError("هیچ مدل گفتگویی فعالی برای دسته‌بندی تنظیم نشده است.")
            run = {"id": "category-" + secrets.token_hex(8), "status": "queued",
                   "phase": "queued", "mode": mode, "modelKeys": models,
                   "createdAt": _now_iso(), "updatedAt": _now_iso(),
                   "processed": 0, "total": 0, "changed": 0, "failed": 0,
                   "cursor": 0, "items": [], "stopRequested": False,
                   "trigger": _s(body.get("trigger")) or "manual", "error": ""}
            put_category_run(run)
            launch_category(run)
            return run, False

    @app.post("/api/destination/basalam/category-runs")
    def parity_category_start():
        try:
            run, existing = start_category_run(_body())
        except ValueError as exc:
            return jsonify(ok=False, error=str(exc)), 400
        return ok(run=run, existing=existing), (200 if existing else 202)

    @app.post("/api/destination/basalam/category-runs/control")
    def parity_category_control():
        action = "resume" if _s(_body().get("action")) == "resume" else "stop"
        with category_lock:
            run = get_category_run()
            if not run:
                return ok(run=None)
            if action == "stop" and run.get("status") in {"queued", "running"}:
                run["stopRequested"] = True
                run["phase"] = "stopping"
                put_category_run(run)
            elif action == "resume" and run.get("status") in {"paused", "failed"}:
                run.update(status="queued", phase="queued", stopRequested=False,
                           error="", updatedAt=_now_iso())
                put_category_run(run)
                launch_category(run)
        return ok(run=get_category_run())

    @app.post("/api/destination/basalam/category-runs/reset")
    def parity_category_reset():
        with category_lock:
            run = get_category_run()
            if run and run.get("status") in {"queued", "running"}:
                return jsonify(ok=False, error="اجرای فعال را ابتدا متوقف کنید.", run=run), 409
            data = load()
            data.pop("category_run", None)
            save(data)
        return ok(run=None)

    @app.get("/api/category-fix-status")
    def parity_category_fix_status():
        return ok(last=load().get("category_fix_last"))

    def category_schedule_tick() -> None:
        data = load()
        settings = data.get("ui_settings") if isinstance(data.get("ui_settings"), dict) else {}
        category_settings = settings.get("categoryFix") if isinstance(settings.get("categoryFix"), dict) else {}
        periodic = category_settings.get("periodic") if isinstance(category_settings.get("periodic"), dict) else {}
        if periodic.get("enabled") is not True:
            return
        hours = max(1, min(168, _int(periodic.get("everyHours"), 6)))
        last = data.get("category_fix_last") if isinstance(data.get("category_fix_last"), dict) else {}
        last_at = _s(last.get("at"))
        if last_at:
            try:
                stamp = datetime.fromisoformat(last_at.replace("Z", "+00:00")).timestamp()
                if time.time() - stamp < hours * 3600:
                    return
            except ValueError:
                pass
        run = get_category_run()
        if run and run.get("status") in {"queued", "running"}:
            return
        claim = {"at": _now_iso(), "trigger": "scheduled", "ok": None,
                 "status": "starting", "mode": _s(periodic.get("mode")) or "ensemble"}
        data["category_fix_last"] = claim
        save(data)
        try:
            started, existing = start_category_run({
                "mode": claim["mode"],
                "consensusModels": category_settings.get("consensusModels") or [],
                "trigger": "scheduled",
            })
            claim.update(status="running" if not existing else "already-running",
                         runId=started.get("id"))
        except Exception as exc:  # noqa: BLE001
            claim.update(ok=False, status="failed", error=str(exc)[:800])
        latest = load()
        current_last = latest.get("category_fix_last")
        # A very short run may already have written its final record. Do not
        # overwrite that completion with the scheduler's provisional claim.
        if (isinstance(current_last, dict) and current_last.get("at") == claim.get("at")
                and current_last.get("ok") is None):
            latest["category_fix_last"] = claim
            save(latest)

    def category_schedule_loop() -> None:
        interval = max(15, min(300, _int(os.environ.get("SCRAPER_CATEGORY_TICK_SECONDS"), 60)))
        while True:
            try:
                category_schedule_tick()
            except Exception as exc:  # noqa: BLE001
                try:
                    core.log_structured_error("category-scheduler", exc)
                except Exception:
                    pass
            time.sleep(interval)

    if os.environ.get("SCRAPER_DISABLE_SCHEDULERS", "").lower() not in {"1", "true", "yes"}:
        threading.Thread(target=category_schedule_loop, name="category-scheduler",
                         daemon=True).start()

    @app.route("/api/destination/basalam/category-tried", methods=["GET", "POST"])
    def parity_category_tried():
        if request.method == "POST":
            body = _body()
            shop_id, item_id = _s(body.get("shopId")), _s(body.get("id"))
            ids = [_int(value) for value in body.get("ids") or [] if _int(value) > 0]
        else:
            shop_id, item_id = _s(request.args.get("shopId")), _s(request.args.get("id"))
            ids = []
        if not item_id:
            return jsonify(ok=False, error="شناسه محصول لازم است."), 400
        key = f"{shop_id}:{item_id}"
        data = load()
        tried = data.setdefault("basalam_category_tried", {})
        current = [_int(value) for value in tried.get(key, []) if _int(value) > 0]
        if request.method == "POST":
            current = list(dict.fromkeys([*current, *ids]))[-30:]
            tried[key] = current
            save(data)
        return ok(tried=current)

    # ------------------------------------------------------------------
    # Destination ledger, account inventory and duplicate cleanup
    # ------------------------------------------------------------------
    def recon_accounts() -> list[dict[str, Any]]:
        data = load()
        accounts: list[dict[str, Any]] = []
        woo = data.get("woocommerce") if isinstance(data.get("woocommerce"), dict) else {}
        if _s(woo.get("url")) and _s(woo.get("consumer_key") or woo.get("key")):
            accounts.append({"target": "woo", "accountKey": "default",
                             "name": "ووکامرس", "pricePercent": _num(woo.get("price_percent"))})
        basalam = data.get("basalam") if isinstance(data.get("basalam"), dict) else {}
        shops: list[dict[str, Any]] = []
        if _s(basalam.get("token")) and _s(basalam.get("vendor_id")):
            shops.append({"vendor_id": basalam.get("vendor_id"),
                          "token": basalam.get("token"),
                          "name": basalam.get("shop_name") or "غرفهٔ پیش‌فرض",
                          "price_percent": basalam.get("price_percent")})
        shops.extend(row for row in basalam.get("vendors") or [] if isinstance(row, dict))
        seen: set[str] = set()
        for shop in shops:
            vendor = _s(shop.get("vendor_id") or shop.get("vendorId"))
            if not vendor or not _s(shop.get("token")) or vendor in seen:
                continue
            seen.add(vendor)
            accounts.append({"target": "basalam", "accountKey": vendor,
                             "name": "باسلام — " + (_s(shop.get("shop_name") or shop.get("name")) or vendor),
                             "pricePercent": _num(shop.get("price_percent") or shop.get("pricePercent")),
                             "toRial": True})
        return accounts

    def account_scope(target: str, account_key: str) -> str:
        return f"{target}:{account_key}"

    def ledger_status() -> dict[str, Any]:
        state = load().get("maintenance_ledger")
        if not isinstance(state, dict):
            state = {}
        stored = state.get("accounts") if isinstance(state.get("accounts"), dict) else {}
        now = time.time()
        items = []
        for account in recon_accounts():
            meta = stored.get(account_scope(account["target"], account["accountKey"]))
            ready = isinstance(meta, dict) and isinstance(meta.get("products"), list)
            completed = _s((meta or {}).get("completedAt"))
            stamp = _num((meta or {}).get("completedEpoch"))
            items.append({**account, "ready": ready, "complete": bool((meta or {}).get("complete")),
                          "stale": not ready or not stamp or now - stamp >= 6 * 3600,
                          "count": len((meta or {}).get("products") or []),
                          "startedAt": (meta or {}).get("startedAt"),
                          "completedAt": completed or None,
                          "durationMs": (meta or {}).get("durationMs"),
                          "error": (meta or {}).get("error")})
        return {"ok": True, "items": items, "maxAgeHours": 6,
                "lastRefresh": state.get("lastRefresh"),
                "lastFullRefresh": state.get("lastFullRefresh")}

    def refresh_ledger(force: bool = False) -> dict[str, Any]:
        del force  # Python stores one authoritative generation per account.
        started = time.monotonic()
        started_at = _now_iso()
        data = load()
        previous = data.get("maintenance_ledger")
        if not isinstance(previous, dict):
            previous = {"accounts": {}}
        previous_accounts = previous.get("accounts") if isinstance(previous.get("accounts"), dict) else {}
        next_accounts = dict(previous_accounts)
        items: list[dict[str, Any]] = []
        try:
            woo_raw, _ = destination_rows("woocommerce", "all")
            woo_views = [destination_view(row, "woocommerce") for row in woo_raw]
        except Exception as exc:  # noqa: BLE001
            woo_views = []
            woo_error = str(exc)
        else:
            woo_error = ""
        try:
            basalam_raw, _shops = destination_rows("basalam", "all")
            basalam_views = [destination_view(row, "basalam") for row in basalam_raw]
        except Exception as exc:  # noqa: BLE001
            basalam_views = []
            basalam_error = str(exc)
        else:
            basalam_error = ""
        for account in recon_accounts():
            account_started = time.monotonic()
            target, key = account["target"], account["accountKey"]
            error = woo_error if target == "woo" else basalam_error
            views = woo_views if target == "woo" else [row for row in basalam_views
                                                         if _s(row.get("shopId")) == _s(key)]
            if error:
                items.append({**account, "ok": False, "error": error})
                continue
            products = []
            at = _now_iso()
            for view in views:
                status = view.get("status")
                # Keep customer-visible Woo records and all non-archived
                # Basalam records. Unapproved rows are retained and marked.
                if target == "woo" and _s(status or view.get("statusLabel")) in {"trash", "auto-draft"}:
                    continue
                if target == "basalam" and _int(status) == 4184:
                    continue
                remote = {"id": view.get("id"), "name": view.get("title"),
                          "title": view.get("title"), "sku": view.get("sku"),
                          "price": _num(view.get("price")), "status": status,
                          "shopId": view.get("shopId"), "shopName": view.get("shopName"),
                          "raw": view.get("raw") or {}}
                products.append({"remote": remote, "at": at,
                                 "invalid": target == "basalam" and _int(status) == 3567})
            completed_at = _now_iso()
            meta = {**account, "products": products, "count": len(products),
                    "complete": True, "inventoryPolicy": "customer-visible-v1",
                    "startedAt": started_at, "completedAt": completed_at,
                    "completedEpoch": time.time(),
                    "durationMs": int((time.monotonic() - account_started) * 1000),
                    "generation": secrets.token_hex(8)}
            next_accounts[account_scope(target, key)] = meta
            items.append({key: value for key, value in meta.items() if key != "products"} |
                         {"ok": True, "ready": True})
        duration = int((time.monotonic() - started) * 1000)
        report = {"ok": all(item.get("ok") for item in items) if items else True,
                  "items": items, "maxAgeHours": 6, "startedAt": started_at,
                  "completedAt": _now_iso(), "durationMs": duration,
                  "durationMinutes": duration / 60_000,
                  "scannedAccounts": sum(bool(item.get("ok")) for item in items),
                  "cachedAccounts": 0}
        state = {"accounts": next_accounts, "lastRefresh": report,
                 "lastFullRefresh": (report if report["ok"] and items else previous.get("lastFullRefresh"))}
        data["maintenance_ledger"] = state
        save(data)
        return report

    @app.get("/api/maintenance/recon-accounts")
    def parity_recon_accounts():
        return ok(accounts=recon_accounts())

    @app.get("/api/maintenance/ledger")
    def parity_ledger_status():
        return jsonify(ledger_status())

    @app.post("/api/maintenance/ledger/refresh")
    def parity_ledger_refresh():
        try:
            return jsonify(refresh_ledger(_body().get("force", True) is not False))
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc)), 400

    @app.post("/api/maintenance/ledger/products")
    def parity_ledger_products():
        body = _body()
        target = "basalam" if _s(body.get("target")) == "basalam" else "woo"
        account_key = _s(body.get("accountKey")) or "default"
        offset = max(0, _int(body.get("offset")))
        state = load().get("maintenance_ledger") or {}
        meta = (state.get("accounts") or {}).get(account_scope(target, account_key))
        if not isinstance(meta, dict):
            return jsonify(ok=False, error="دفتر این مقصد هنوز ساخته نشده است."), 404
        rows = meta.get("products") if isinstance(meta.get("products"), list) else []
        page = rows[offset:offset + 50]
        return ok(account={key: value for key, value in meta.items() if key != "products"},
                  items=page, total=len(rows), offset=offset,
                  next=(offset + 50 if offset + 50 < len(rows) else None))

    def normalized_duplicate_title(value: Any) -> str:
        text = _s(value).translate(str.maketrans("يكى", "یکي")).strip().lower()
        text = re.sub(r"\s*[\[(](?:(?:کد|code|sku)\s*[:：]?\s*)?[0-9۰-۹]+[\])]\s*$", "", text,
                      flags=re.I)
        text = re.sub(r"\s+(?:copy|کپی)(?:\s+\d+)?\s*$", "", text, flags=re.I)
        return re.sub(r"\s+", " ", text).strip()

    def find_duplicate_actions(account_key_filter: str = "", keep: str = "expensive") -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        try:
            woo_raw, _ = destination_rows("woocommerce", "all")
            woo = [destination_view(row, "woocommerce") for row in woo_raw]
        except Exception as exc:  # noqa: BLE001
            woo, woo_error = [], str(exc)
        else:
            woo_error = ""
        try:
            basalam_raw, _ = destination_rows("basalam", "all")
            basalam = [destination_view(row, "basalam") for row in basalam_raw]
        except Exception as exc:  # noqa: BLE001
            basalam, basalam_error = [], str(exc)
        else:
            basalam_error = ""
        failures: list[dict[str, Any]] = []
        actions: list[dict[str, Any]] = []
        for account in recon_accounts():
            if account_key_filter and _s(account["accountKey"]) != account_key_filter:
                continue
            if account["target"] == "woo":
                rows, error = woo, woo_error
            else:
                rows = [row for row in basalam if _s(row.get("shopId")) == _s(account["accountKey"])]
                error = basalam_error
            if error:
                failures.append({"account": account["name"], "error": error})
                continue
            groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
            for row in rows:
                key = normalized_duplicate_title(row.get("title"))
                if key:
                    groups[key].append(row)
            for title_key, group in groups.items():
                if len(group) < 2:
                    continue
                reverse = keep != "cheapest"
                ordered = sorted(group, key=lambda row: (_num(row.get("price")), _int(row.get("id"))),
                                 reverse=reverse)
                keeper = ordered[0]
                for row in ordered[1:]:
                    actions.append({"target": account["target"],
                                    "accountKey": account["accountKey"],
                                    "accountName": account["name"],
                                    "remoteId": row.get("id"), "title": row.get("title"),
                                    "normalizedTitle": title_key, "price": _num(row.get("price")),
                                    "keepId": keeper.get("id"), "keepPrice": _num(keeper.get("price")),
                                    "groupSize": len(group), "shopId": row.get("shopId")})
        return actions, failures

    def duplicate_response(apply_now: bool, limit: int, keep: str,
                           account_key_filter: str = "") -> dict[str, Any]:
        actions, failures = find_duplicate_actions(account_key_filter, keep)
        capped = actions[:max(1, min(1000, limit or 200))]
        accounts = recon_accounts()
        by_destination = []
        for account in accounts:
            if account_key_filter and _s(account["accountKey"]) != account_key_filter:
                continue
            by_destination.append({"account": account["name"],
                                   "accountKey": account["accountKey"],
                                   "target": account["target"],
                                   "duplicates": sum(row["target"] == account["target"] and
                                                     _s(row["accountKey"]) == _s(account["accountKey"])
                                                     for row in actions)})
        if not apply_now:
            return {"ok": not failures, "dryRun": True, "keep": keep,
                    "planned": len(actions), "willDelete": len(capped),
                    "accounts": len(by_destination), "byDestination": by_destination,
                    "failures": failures, "actions": capped[:200]}
        deleted = archived = 0
        failed: list[dict[str, Any]] = []
        for action in capped:
            try:
                if action["target"] == "woo":
                    core.woo_request("DELETE", f"products/{action['remoteId']}?force=false")
                    deleted += 1
                else:
                    context, _shop = shop_context(action.get("shopId") or action["accountKey"])
                    with context:
                        core.basalam_api_request("PATCH", f"/v1/products/{action['remoteId']}",
                                                 json_data={"status": 4184})
                    archived += 1
            except Exception as exc:  # noqa: BLE001
                failed.append({**action, "error": str(exc)[:500]})
        return {"ok": not failures and not failed, "dryRun": False, "keep": keep,
                "planned": len(actions), "processed": len(capped), "deleted": deleted,
                "archived": archived, "accounts": len(by_destination),
                "byDestination": by_destination, "failures": failures,
                "failed": failed[:20], "actions": capped[:200]}

    @app.post("/api/maintenance/duplicates")
    def parity_maintenance_duplicates():
        body = _body()
        return jsonify(duplicate_response(_s(body.get("confirm")) == "APPLY",
                                          _int(body.get("limit"), 200),
                                          "cheapest" if _s(body.get("keep")) == "cheapest" else "expensive",
                                          _s(body.get("accountKey"))))

    @app.get("/api/destination/<target>/duplicates")
    def parity_destination_duplicates(target: str):
        try:
            key = dest_key(target)
        except ValueError as exc:
            return jsonify(ok=False, error=str(exc)), 400
        wanted = "woo" if key == "woocommerce" else "basalam"
        actions, failures = find_duplicate_actions(_s(request.args.get("shop")),
                                                   _s(request.args.get("keep")) or "expensive")
        actions = [row for row in actions if row["target"] == wanted]
        groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in actions:
            groups[row["normalizedTitle"]].append(row)
        return ok(target=wanted, count=len(actions), items=actions,
                  groups=[{"title": title, "items": rows,
                           "duplicates": len(rows)} for title, rows in groups.items()],
                  failures=failures)

    @app.post("/api/maintenance/ledger/missing")
    def parity_ledger_missing():
        body = _body()
        apply_now = _s(body.get("confirm")) == "APPLY"
        data = load()
        wanted = _s(body.get("profileId"))
        names = [wanted] if wanted else list((data.get("profiles") or {}).keys())
        settings = data.get("ui_settings") if isinstance(data.get("ui_settings"), dict) else {}
        retire = settings.get("retire") if isinstance(settings.get("retire"), dict) else {}
        mode = _s(retire.get("mode")) or "report"
        candidates: list[dict[str, Any]] = []
        failures: list[dict[str, str]] = []
        for account in recon_accounts():
            try:
                raw_rows, _shops = destination_rows(
                    "woocommerce" if account["target"] == "woo" else "basalam",
                    account["accountKey"] if account["target"] == "basalam" else "all")
            except Exception as exc:  # noqa: BLE001
                failures.append({"account": account["name"], "error": str(exc)})
                continue
            for name in names:
                profile = (data.get("profiles") or {}).get(name)
                if not isinstance(profile, dict):
                    continue
                report = core.build_destination_report(
                    name, "woocommerce" if account["target"] == "woo" else "basalam",
                    profile, raw_rows)
                for row in report.get("lists", {}).get("extra", []):
                    candidates.append({**row, "profileId": name, "target": account["target"],
                                       "accountKey": account["accountKey"],
                                       "accountName": account["name"],
                                       "shopId": row.get("shopId") or account["accountKey"]})
        unique: dict[tuple[str, str, str], dict[str, Any]] = {}
        for row in candidates:
            unique[(row["target"], _s(row["accountKey"]), _s(row.get("id")))] = row
        candidates = list(unique.values())
        max_count = max(1, min(1000, _int(retire.get("maxCount"), 100)))
        max_pct = max(1, min(100, _int(retire.get("maxPct"), 25)))
        total_remote = sum(item.get("count", 0) for item in ledger_status()["items"])
        pct = round(len(candidates) * 100 / max(1, total_remote), 2)
        preview = {"ok": not failures, "dryRun": not apply_now, "mode": mode,
                   "planned": len(candidates), "count": len(candidates),
                   "changed": 0, "candidates": candidates[:200], "failures": failures,
                   "percent": pct, "safety": {"maxCount": max_count, "maxPct": max_pct}}
        if not apply_now or mode == "report":
            return jsonify(preview)
        if len(candidates) > max_count or pct > max_pct:
            return jsonify({**preview, "ok": False,
                            "error": "ترمز ایمنی بازنشستگی فعال شد."}), 409
        failed: list[dict[str, Any]] = []
        changed = 0
        for row in candidates[:20]:
            try:
                item_id = _s(row.get("id"))
                if row["target"] == "woo":
                    if mode in {"trash", "delete"}:
                        core.woo_request("DELETE", f"products/{item_id}?force=false")
                    elif mode in {"outofstock", "out-of-stock", "stock"}:
                        core.woo_request("PUT", f"products/{item_id}",
                                         {"manage_stock": True, "stock_quantity": 0,
                                          "stock_status": "outofstock"})
                    else:
                        core.woo_request("PUT", f"products/{item_id}", {"status": "draft"})
                else:
                    context, _shop = shop_context(row.get("shopId"))
                    with context:
                        core.basalam_api_request("PATCH", f"/v1/products/{item_id}",
                                                 json_data={"status": 4184})
                changed += 1
            except Exception as exc:  # noqa: BLE001
                failed.append({**row, "error": str(exc)[:500]})
        return jsonify({**preview, "dryRun": False, "changed": changed,
                        "failed": failed, "ok": not failures and not failed})

    # ------------------------------------------------------------------
    # PWA assets and secure Web Push subscriptions
    # ------------------------------------------------------------------
    sw_source = r"""
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
  let data={};try{data=event.data?event.data.json():{}}catch{data={body:'اعلان تازه از اسکرپر'}}
  event.waitUntil(self.registration.showNotification(String(data.title||'Scraper4').slice(0,120),{
    body:String(data.body||'گزارش تازه آماده است.').slice(0,400),
    tag:String(data.tag||'scraper4').slice(0,120),
    icon:new URL('app-icon-192.png',self.registration.scope).href,
    data:{url:self.registration.scope}
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();const target=self.registration.scope;
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{
    const match=windows.find(w=>w.url.startsWith(target));
    if(match)return match.focus();return self.clients.openWindow(target);
  }));
});
""".strip()
    manifest = {
        "name": "Scraper4", "short_name": "Scraper4", "lang": "fa", "dir": "rtl",
        "id": "./", "start_url": "./", "scope": "./", "display": "standalone",
        "background_color": "#07111e", "theme_color": "#0f172a",
        "icons": [
            {"src": "app-icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "app-icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
        ],
    }
    icon_svg = ("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 192 192\">"
                "<rect width=\"192\" height=\"192\" rx=\"40\" fill=\"#0f172a\"/>"
                "<path d=\"M56 122h80l-12-16V78a28 28 0 0 0-56 0v28z\" fill=\"#22d3ee\"/>"
                "<circle cx=\"96\" cy=\"142\" r=\"10\" fill=\"#22d3ee\"/></svg>")

    @app.get("/manifest.webmanifest")
    def parity_manifest():
        return Response(json.dumps(manifest, ensure_ascii=False),
                        mimetype="application/manifest+json",
                        headers={"cache-control": "public, max-age=3600"})

    @app.get("/sw.js")
    def parity_service_worker():
        return Response(sw_source, mimetype="application/javascript",
                        headers={"cache-control": "no-store", "service-worker-allowed": "/"})

    @app.get("/app-icon.svg")
    def parity_icon_svg():
        return Response(icon_svg, mimetype="image/svg+xml",
                        headers={"cache-control": "public, max-age=86400"})

    @app.get("/app-icon-192.png")
    def parity_icon_192():
        return send_file(Path(core.BASE_DIR) / "ui" / "app-icon-192.png", mimetype="image/png",
                         max_age=86400)

    @app.get("/app-icon-512.png")
    def parity_icon_512():
        return send_file(Path(core.BASE_DIR) / "ui" / "app-icon-512.png", mimetype="image/png",
                         max_age=86400)

    @app.get("/setup")
    def parity_setup():
        body = f"""<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>راه‌اندازی Scraper4</title>
<style>body{{font-family:Tahoma,sans-serif;background:#07111e;color:#e2e8f0;max-width:760px;margin:6vh auto;padding:24px}}
main{{background:#0f172a;border:1px solid #334155;border-radius:16px;padding:28px}}a{{color:#67e8f9}}code{{direction:ltr;display:inline-block;background:#020617;padding:3px 7px;border-radius:5px}}</style>
<main><h1>Scraper4 Python {html_escape(_s(core.APP_VERSION))}</h1><p>ذخیره‌سازی محلی و API آماده است.</p>
<ul><li>فایل داده: <code>{html_escape(_s(core.DATA_FILE))}</code></li><li>محیط: Python / Flask</li>
<li>برای نصب همهٔ وابستگی‌ها: <code>pip install -r requirements.txt</code></li></ul>
<p><a href="./">بازگشت به داشبورد</a></p></main></html>"""
        return Response(body, mimetype="text/html", headers={"cache-control": "no-store"})

    def push_config() -> dict[str, Any]:
        public = _s(os.environ.get("WEB_PUSH_PUBLIC_KEY"))
        private = _s(os.environ.get("WEB_PUSH_PRIVATE_KEY"))
        subject = _s(os.environ.get("WEB_PUSH_SUBJECT"))
        try:
            import pywebpush  # noqa: F401
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # noqa: F401
            dependency = True
        except ImportError:
            dependency = False
        configured = (dependency and bool(_s(getattr(core, "PASSWORD", "")) or private) and
                      bool(re.fullmatch(r"[\w-]{87}", public)) and
                      bool(re.fullmatch(r"[\w-]{43}", private)) and
                      bool(re.match(r"^(?:mailto:|https://)", subject)))
        if configured:
            reason = ""
        elif not dependency:
            reason = "بسته‌های pywebpush و cryptography نصب نیستند."
        else:
            reason = ("SCRAPER_PASSWORD و WEB_PUSH_PUBLIC_KEY / WEB_PUSH_PRIVATE_KEY / "
                      "WEB_PUSH_SUBJECT را روی سرور تنظیم کنید.")
        return {"supported": True, "configured": configured,
                "publicKey": public if configured else "", "reason": reason}

    def push_cipher_key() -> bytes:
        secret = (_s(getattr(core, "PASSWORD", "")) or
                  _s(os.environ.get("WEB_PUSH_PRIVATE_KEY")))
        if not secret:
            raise ValueError("SCRAPER_PASSWORD برای رمزگذاری اشتراک Push لازم است.")
        return hashlib.sha256(("scraper4-web-push:" + secret).encode("utf-8")).digest()

    def seal_subscription(value: dict[str, Any]) -> dict[str, str]:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        nonce = secrets.token_bytes(12)
        encrypted = AESGCM(push_cipher_key()).encrypt(
            nonce, json.dumps(value, ensure_ascii=False).encode("utf-8"), b"scraper4-web-push")
        return {"nonce": base64.b64encode(nonce).decode("ascii"),
                "body": base64.b64encode(encrypted).decode("ascii")}

    def open_subscription(value: dict[str, Any]) -> dict[str, Any]:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        nonce = base64.b64decode(_s(value.get("nonce")), validate=True)
        body = base64.b64decode(_s(value.get("body")), validate=True)
        raw = AESGCM(push_cipher_key()).decrypt(nonce, body, b"scraper4-web-push")
        decoded = json.loads(raw.decode("utf-8"))
        if not isinstance(decoded, dict):
            raise ValueError("اشتراک Push خراب است.")
        return decoded

    def b64url_bytes(value: str) -> bytes:
        padded = value + "=" * (-len(value) % 4)
        return base64.urlsafe_b64decode(padded.encode("ascii"))

    def validate_push_subscription(raw: Any) -> dict[str, Any]:
        if not isinstance(raw, dict) or not isinstance(raw.get("endpoint"), str):
            raise ValueError("Invalid push subscription.")
        endpoint = raw["endpoint"]
        if len(endpoint) > 2048:
            raise ValueError("Invalid push subscription.")
        parsed = urlparse(endpoint)
        host = (parsed.hostname or "").lower()
        allowed = (host in {"fcm.googleapis.com", "updates.push.services.mozilla.com",
                            "web.push.apple.com"} or
                   host.endswith(".push.services.mozilla.com") or
                   host.endswith(".notify.windows.com"))
        if (parsed.scheme != "https" or parsed.port not in (None, 443) or parsed.username or
                parsed.password or parsed.fragment or not allowed):
            raise ValueError("Unsupported push-service endpoint.")
        # Reuse the scraper's DNS-aware SSRF guard.
        core.public_http_url(endpoint)
        keys = raw.get("keys") if isinstance(raw.get("keys"), dict) else {}
        p256dh, auth = _s(keys.get("p256dh")), _s(keys.get("auth"))
        try:
            valid_keys = (len(b64url_bytes(p256dh)) == 65 and len(b64url_bytes(auth)) == 16 and
                          bool(re.fullmatch(r"[\w-]+={0,2}", p256dh)) and
                          bool(re.fullmatch(r"[\w-]+={0,2}", auth)))
        except (ValueError, TypeError):
            valid_keys = False
        if not valid_keys:
            raise ValueError("Invalid subscription encryption keys.")
        return {"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}}

    def send_push(message: dict[str, Any], only_id: str = "") -> dict[str, Any]:
        cfg = push_config()
        if not cfg["configured"]:
            return {"ok": False, "sent": 0, "failed": 0, "removed": 0,
                    "reason": cfg["reason"] or "not-configured"}
        from pywebpush import WebPushException, webpush
        data = load()
        stored = data.get("web_push_subscriptions")
        if not isinstance(stored, dict):
            stored = {}
        ids = [only_id] if only_id else list(stored)[:100]
        sent = failed = removed = 0
        for subscription_id in ids:
            sealed = stored.get(subscription_id)
            if not isinstance(sealed, dict):
                continue
            try:
                record = open_subscription(sealed)
                subscription = validate_push_subscription(record.get("subscription"))
                payload = json.dumps({"title": _s(message.get("title"))[:120],
                                      "body": _s(message.get("body"))[:400],
                                      "tag": (_s(message.get("tag")) or "scraper4")[:120],
                                      "url": "./"}, ensure_ascii=False)
                with core.requests.Session() as push_session:
                    # pywebpush otherwise follows redirects without applying
                    # Scraper4's DNS/private-IP policy.
                    push_session.hooks.setdefault("response", []).append(
                        core.Fetcher._validate_redirect)
                    system_ca = next((path for path in (
                        os.environ.get("SSL_CERT_FILE", ""),
                        "/etc/ssl/certs/ca-certificates.crt",
                        "/etc/pki/tls/certs/ca-bundle.crt",
                    ) if path and os.path.isfile(path)), "")
                    if system_ca:
                        push_session.verify = system_ca
                    webpush(subscription_info=subscription, data=payload,
                            vapid_private_key=os.environ["WEB_PUSH_PRIVATE_KEY"],
                            vapid_claims={"sub": os.environ["WEB_PUSH_SUBJECT"]},
                            ttl=3600, timeout=8, requests_session=push_session)
                sent += 1
            except WebPushException as exc:
                status = getattr(getattr(exc, "response", None), "status_code", 0)
                if status in {404, 410}:
                    stored.pop(subscription_id, None)
                    removed += 1
                else:
                    failed += 1
            except Exception:  # noqa: BLE001
                failed += 1
        data["web_push_subscriptions"] = stored
        save(data)
        return {"ok": sent > 0 and failed == 0, "sent": sent,
                "failed": failed, "removed": removed}

    @app.get("/api/web-push/config")
    def parity_push_config():
        return ok(**push_config())

    @app.post("/api/web-push/subscribe")
    def parity_push_subscribe():
        cfg = push_config()
        if not cfg["configured"]:
            return jsonify(ok=False, error=cfg["reason"]), 400
        try:
            subscription = validate_push_subscription(_body())
            subscription_id = hashlib.sha256(subscription["endpoint"].encode("utf-8")).hexdigest()
            data = load()
            rows = data.get("web_push_subscriptions")
            if not isinstance(rows, dict):
                rows = {}
            if subscription_id not in rows and len(rows) >= 100:
                return jsonify(ok=False, error="Too many notification subscriptions."), 409
            rows[subscription_id] = seal_subscription({"subscription": subscription,
                                                        "createdAt": _now_iso()})
            data["web_push_subscriptions"] = rows
            save(data)
            return ok(id=subscription_id)
        except (ValueError, TypeError) as exc:
            return jsonify(ok=False, error=str(exc)), 400

    @app.post("/api/web-push/unsubscribe")
    def parity_push_unsubscribe():
        subscription_id = _s(_body().get("id"))
        if not re.fullmatch(r"[a-f0-9]{64}", subscription_id):
            return jsonify(ok=False, error="Invalid subscription ID."), 400
        data = load()
        rows = data.get("web_push_subscriptions")
        if isinstance(rows, dict):
            rows.pop(subscription_id, None)
        save(data)
        return ok()

    @app.post("/api/web-push/test")
    def parity_push_test():
        subscription_id = _s(_body().get("id"))
        if not re.fullmatch(r"[a-f0-9]{64}", subscription_id):
            return jsonify(ok=False, error="Subscribe this browser first."), 400
        result = send_push({"title": "Scraper4",
                            "body": "اعلان آزمایشی از سرور دریافت شد.",
                            "tag": "scraper4-test"}, subscription_id)
        return jsonify(result), (200 if result.get("sent") else 400)

    # ------------------------------------------------------------------
    # Consume-once visual selector tickets and sanitised snapshots
    # ------------------------------------------------------------------
    visual_lock = threading.RLock()
    visual_ttl = 300

    def private_resource(url: str) -> bool:
        try:
            parsed = urlparse(url)
            if parsed.scheme == "data":
                return False
            if parsed.scheme not in {"http", "https"}:
                return True
            # The sanitized page executes in the operator's browser. Resolve on
            # the server as well as checking literals so an injected asset URL
            # cannot casually probe localhost/RFC1918 through the iframe.
            core.public_http_url(url)
            return False
        except Exception:  # noqa: BLE001
            return True

    def visual_picker_js(context: str, channel: str) -> str:
        # Kept self-contained because the iframe is sandboxed and connect-src is
        # disabled. Field selectors become relative to the chosen list container.
        template = r"""(()=>{
const context='__CONTEXT__',channel='__CHANNEL__',bar=document.getElementById('__s4bar'),mode=document.getElementById('__s4mode'),label=document.getElementById('__s4selector'),count=document.getElementById('__s4count'),preview=document.getElementById('__s4preview'),saved={};let current=null,hover=null,picking=true,container='';
const esc=v=>{try{return CSS.escape(v)}catch{return String(v).replace(/[^a-zA-Z0-9_-]/g,'\\$&')}};
const stable=v=>v&&v.length<48&&!/^(__|active$|open$|show$|hide$|is-|js-|has-)/i.test(v)&&!/[a-f\d]{18,}/i.test(v);
function matches(s,root=document){try{return root.querySelectorAll(s).length}catch{return 0}}
function part(el,withNth=true){let s=el.tagName.toLowerCase(),classes=[...el.classList].filter(stable).slice(0,2);if(classes.length)s+='.'+classes.map(esc).join('.');if(withNth&&el.parentElement){const same=[...el.parentElement.children].filter(x=>x.tagName===el.tagName);if(same.length>1)s+=':nth-of-type('+(same.indexOf(el)+1)+')'}return s}
function absolute(el){if(!el||['HTML','BODY'].includes(el.tagName))return el?.tagName?.toLowerCase()||'body';if(el.id&&stable(el.id)){const s=el.tagName.toLowerCase()+'#'+esc(el.id);if(matches(s)===1)return s}const classes=[...el.classList].filter(stable).slice(0,3);for(let n=classes.length;n>0;n--){const s=el.tagName.toLowerCase()+classes.slice(0,n).map(x=>'.'+esc(x)).join('');if((context==='list'||mode.value==='container')?matches(s)>1:matches(s)===1)return s}let node=el,parts=[];while(node&&node!==document.body&&parts.length<5){parts.unshift(part(node));const s=parts.join(' > ');if(matches(s)===1)return s;node=node.parentElement}return parts.join(' > ')}
function relative(el){if(!container||mode.value==='container')return absolute(el);try{const card=el.closest(container);if(!card)return absolute(el);let node=el,parts=[];while(node&&node!==card&&parts.length<5){parts.unshift(part(node,node.parentElement!==card));node=node.parentElement}const s=parts.join(' > ');return node===card&&matches(s,card)?s:absolute(el)}catch{return absolute(el)}}
function target(el){if(mode.value==='link')return el.closest('a')||el.querySelector('a')||el;if(['image','detailImage','galleryOne'].includes(mode.value))return(el.tagName==='IMG'?el:el.querySelector('img'))||el;return el}
function sample(el){if(mode.value==='link')return el.getAttribute('data-s4-href')||'';if(['image','detailImage','galleryOne'].includes(mode.value))return el.currentSrc||el.src||el.getAttribute('data-src')||'';return(el.innerText||'').trim().replace(/\s+/g,' ').slice(0,250)}
function choose(el){el=target(el);if(current)current.classList.remove('__s4picked');current=el;current.classList.add('__s4picked');const s=relative(el),n=mode.value==='container'?matches(s):(container&&el.closest(container)?matches(s,el.closest(container)):matches(s));label.textContent=s;count.textContent=n+' مورد';preview.textContent=sample(el)||'پیش‌نمایشی پیدا نشد';saved[mode.value]={selector:s,count:n,preview:sample(el)}}
document.addEventListener('mouseover',e=>{if(!picking||bar.contains(e.target))return;if(hover&&hover!==current)hover.classList.remove('__s4hover');hover=e.target;if(hover!==current)hover.classList.add('__s4hover')},true);
document.addEventListener('mouseout',e=>{if(e.target?.classList&&e.target!==current)e.target.classList.remove('__s4hover')},true);
document.addEventListener('click',e=>{if(bar.contains(e.target)||!picking)return;e.preventDefault();e.stopPropagation();choose(e.target)},true);
document.getElementById('__s4pause').onclick=()=>{picking=!picking;document.getElementById('__s4pause').textContent=picking?'⏸ توقف انتخاب':'▶ ادامه انتخاب'};
document.getElementById('__s4up').onclick=()=>current?.parentElement&&!bar.contains(current.parentElement)&&choose(current.parentElement);
document.getElementById('__s4down').onclick=()=>current?.firstElementChild&&choose(current.firstElementChild);
document.getElementById('__s4prev').onclick=()=>current?.previousElementSibling&&choose(current.previousElementSibling);
document.getElementById('__s4next').onclick=()=>current?.nextElementSibling&&choose(current.nextElementSibling);
mode.onchange=()=>{const x=saved[mode.value];label.textContent=x?.selector||'روی عنصر مربوط کلیک کنید';count.textContent=x?x.count+' مورد':'۰ مورد';preview.textContent=x?.preview||'ثبت نشده'};
document.getElementById('__s4save').onclick=()=>{const x=saved[mode.value];if(!x)return;if(mode.value==='container')container=x.selector;parent.postMessage({type:'scraper4-selector',channel,mode:mode.value,...x},'*')};
const done=document.getElementById('__s4done');if(done)done.onclick=()=>parent.postMessage({type:'scraper4-detail-selectors',channel,selections:saved},'*');
window.addEventListener('message',e=>{if(e.source!==parent||e.data?.channel!==channel)return;if(e.data?.type==='scraper4-mode'&&e.data.mode)mode.value=e.data.mode;if(e.data?.type==='scraper4-container'&&typeof e.data.selector==='string')container=e.data.selector});
})();"""
        return template.replace("__CONTEXT__", context).replace("__CHANNEL__", channel)

    def visual_toolbar(context: str) -> str:
        list_options = [("container", "📦 کانتینر محصول"), ("title", "📝 عنوان"),
                        ("price", "💰 قیمت"), ("link", "🔗 لینک"),
                        ("image", "🖼 تصویر فهرست")]
        detail_options = [("shortDesc", "توضیحات کوتاه"), ("longDesc", "توضیحات بلند"),
                          ("sku", "SKU"), ("category", "دسته‌بندی"), ("tags", "برچسب‌ها"),
                          ("weight", "وزن"), ("stock", "موجودی"), ("brand", "برند"),
                          ("detailImage", "عکس اصلی"), ("variations", "تنوع‌ها"),
                          ("galleryBox", "باکس گالری"), ("galleryOne", "عکس گالری")]
        choices = detail_options if context == "detail" else list_options
        options = "".join(f'<option value="{key}">{html_escape(label)}</option>' for key, label in choices)
        done = '<button id="__s4done">✅ اتمام و اعمال همه</button>' if context == "detail" else ""
        return (f'<div id="__s4bar" data-context="{context}"><select id="__s4mode">{options}</select>'
                '<button id="__s4up">⬆ والد</button><button id="__s4down">⬇ فرزند</button>'
                '<button id="__s4prev">→ قبلی</button><button id="__s4next">← بعدی</button>'
                '<code id="__s4selector">روی عنصر مورد نظر کلیک کنید</code><span id="__s4count">۰ مورد</span>'
                '<button id="__s4pause">⏸ توقف انتخاب</button><button id="__s4save">✓ ثبت این فیلد</button>'
                f'{done}<span id="__s4preview">هنوز انتخاب نشده است.</span></div>')

    visual_css = """
#__s4bar{position:fixed!important;z-index:2147483647!important;top:0!important;left:0!important;right:0!important;min-height:56px!important;background:#0f172af2!important;color:#fff!important;border-bottom:2px solid #a855f7!important;display:flex!important;align-items:center!important;gap:6px!important;padding:7px 9px!important;flex-wrap:wrap!important;font:12px Tahoma,sans-serif!important;direction:rtl!important;box-shadow:0 4px 18px #0008!important}#__s4bar select,#__s4bar button{width:auto!important;min-width:0!important;background:#334155!important;color:#fff!important;border:1px solid #64748b!important;border-radius:6px!important;padding:7px 9px!important;font:11px Tahoma!important;cursor:pointer!important}#__s4bar #__s4save,#__s4bar #__s4done{background:#166534!important;border-color:#22c55e!important}#__s4selector{flex:1!important;direction:ltr!important;text-align:left!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;background:#020617!important;color:#f0abfc!important;padding:7px!important;border-radius:5px!important}#__s4preview{flex-basis:100%;color:#bbf7d0!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#__s4count{color:#67e8f9!important;white-space:nowrap!important}.__s4hover{outline:3px solid #a855f7!important;outline-offset:2px!important;cursor:crosshair!important}.__s4picked{outline:4px solid #22c55e!important;outline-offset:2px!important}body{padding-top:92px!important}
"""

    def consume_visual_ticket(ticket_id: str) -> dict[str, Any]:
        if not re.fullmatch(r"[a-f0-9]{48}", ticket_id):
            raise ValueError("لینک انتخاب بصری نامعتبر است.")
        with visual_lock:
            data = load()
            tickets = data.get("visual_tickets")
            if not isinstance(tickets, dict):
                tickets = {}
            ticket = tickets.pop(ticket_id, None)
            data["visual_tickets"] = {key: value for key, value in tickets.items()
                                      if isinstance(value, dict) and _num(value.get("expires")) > time.time()}
            save(data)  # consume before any network operation
        if not isinstance(ticket, dict) or _num(ticket.get("expires")) < time.time():
            raise ValueError("لینک انتخاب بصری منقضی یا قبلاً استفاده شده است.")
        return ticket

    def visual_public_url(value: Any) -> str:
        url = core.public_http_url(_s(value))
        parsed = urlparse(url)
        host = parsed.hostname or ""
        try:
            addresses = {row[4][0] for row in socket.getaddrinfo(
                host, parsed.port or (443 if parsed.scheme == "https" else 80),
                type=socket.SOCK_STREAM)}
        except socket.gaierror as exc:
            raise ValueError("نام میزبان قابل resolve نیست.") from exc
        if not addresses:
            raise ValueError("نام میزبان هیچ IP معتبری ندارد.")
        for address in addresses:
            ip = ipaddress.ip_address(address.split("%", 1)[0])
            if not ip.is_global:
                raise ValueError("میزبان به IP خصوصی/محلی resolve می‌شود.")
        return url

    @app.post("/api/visual-ticket")
    def parity_visual_ticket():
        body = _body()
        try:
            url = visual_public_url(body.get("url"))
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=f"Invalid visual selector URL: {exc}"), 400
        profile = (load().get("profiles") or {}).get(_s(body.get("profileId")))
        profile = profile if isinstance(profile, dict) else {}
        engine = _s(body.get("engine") or profile.get("fetch_engine") or
                    profile.get("extractionEngine") or "auto")
        indirect = bool(body.get("indirect", profile.get("network_indirect", False)))
        ticket_id, channel = secrets.token_hex(24), secrets.token_hex(24)
        data = load()
        tickets = data.get("visual_tickets")
        if not isinstance(tickets, dict):
            tickets = {}
        now = time.time()
        tickets = {key: value for key, value in tickets.items()
                   if isinstance(value, dict) and _num(value.get("expires")) > now}
        tickets[ticket_id] = {"url": url, "engine": engine, "indirect": indirect,
                              "channel": channel, "expires": now + visual_ttl,
                              "createdAt": _now_iso()}
        data["visual_tickets"] = tickets
        save(data)
        return ok(ticket=ticket_id, channel=channel, engine=engine, expiresIn=visual_ttl)

    @app.get("/visual")
    def parity_visual():
        try:
            ticket = consume_visual_ticket(_s(request.args.get("ticket")))
            context = "detail" if _s(request.args.get("context")) == "detail" else "list"
            engine = _s(ticket.get("engine")) or "auto"
            network = dict(load().get("network") or {})
            fetcher = core.Fetcher(network)
            errors: list[str] = []
            if engine in {"playwright", "selenium"}:
                result = core.picker_browser_fetch(ticket["url"], fetcher.timeout, 4, errors, engine)
            elif engine not in {"", "auto", "html", "requests"}:
                try:
                    result = fetcher.get(ticket["url"], engine=engine)
                except Exception as exc:  # noqa: BLE001
                    errors.append(str(exc))
                    result = None
            else:
                result = core.picker_http_fetch(ticket["url"], fetcher, errors)
            if result is None:
                raise ValueError("دریافت صفحه ناموفق بود" + ((" — " + " | ".join(errors[-3:])) if errors else ""))
            raw = _s(result.text)
            if len(raw.encode("utf-8")) > 6_000_000:
                raise ValueError("صفحه برای انتخاب بصری بزرگ‌تر از ۶ مگابایت است.")
            final_url = _s(getattr(result, "url", "")) or ticket["url"]
            soup = core.BeautifulSoup(raw, "html.parser")
            for tag in soup.find_all(["script", "iframe", "object", "embed", "form", "noscript", "base"]):
                tag.decompose()
            for tag in soup.find_all("meta"):
                if _s(tag.get("http-equiv")).lower() in {"refresh", "content-security-policy"}:
                    tag.decompose()
            for tag in soup.find_all(True):
                if _s(tag.get("id")).startswith("__s4"):
                    tag.attrs.pop("id", None)
                for name in list(tag.attrs):
                    if name.lower().startswith("on") or name.lower() in {"srcdoc", "nonce"}:
                        tag.attrs.pop(name, None)
                if tag.name == "a":
                    original = _s(tag.get("href"))
                    absolute = urljoin(final_url, original)
                    if original and not private_resource(absolute):
                        tag["data-s4-href"] = absolute
                    tag["href"] = "#"
                    tag.attrs.pop("target", None)
                for attr in ("src", "poster"):
                    value = _s(tag.get(attr))
                    if value:
                        absolute = urljoin(final_url, value)
                        if private_resource(absolute):
                            tag.attrs.pop(attr, None)
                        else:
                            tag[attr] = absolute
                if tag.name in {"link"} and tag.get("href"):
                    absolute = urljoin(final_url, _s(tag.get("href")))
                    if private_resource(absolute):
                        tag.attrs.pop("href", None)
                    else:
                        tag["href"] = absolute
                if tag.get("srcset"):
                    parts = []
                    for part in _s(tag.get("srcset")).split(","):
                        bits = part.strip().split(None, 1)
                        if not bits:
                            continue
                        absolute = urljoin(final_url, bits[0])
                        if not private_resource(absolute):
                            parts.append(absolute + ((" " + bits[1]) if len(bits) > 1 else ""))
                    if parts:
                        tag["srcset"] = ", ".join(parts)
                    else:
                        tag.attrs.pop("srcset", None)
            if soup.html is None:
                wrapper = core.BeautifulSoup("<html><head></head><body></body></html>", "html.parser")
                wrapper.body.append(soup)
                soup = wrapper
            if soup.head is None:
                head = soup.new_tag("head")
                soup.html.insert(0, head)
            if soup.body is None:
                body_tag = soup.new_tag("body")
                soup.html.append(body_tag)
            style = soup.new_tag("style")
            style.string = visual_css
            soup.head.append(style)
            toolbar = core.BeautifulSoup(visual_toolbar(context), "html.parser")
            soup.body.insert(0, toolbar)
            script_text = visual_picker_js(context, _s(ticket.get("channel")))
            script = soup.new_tag("script")
            script.string = script_text
            soup.body.append(script)
            digest = base64.b64encode(hashlib.sha256(script_text.encode("utf-8")).digest()).decode("ascii")
            csp = ("sandbox allow-scripts; default-src 'none'; img-src https: data: blob:; "
                   "style-src 'unsafe-inline' https:; font-src https: data:; "
                   f"script-src 'sha256-{digest}'; connect-src 'none'; frame-src 'none'; "
                   "object-src 'none'; frame-ancestors 'self'; form-action 'none'; base-uri 'none'")
            return Response(str(soup), mimetype="text/html",
                            headers={"cache-control": "no-store", "content-security-policy": csp,
                                     "x-content-type-options": "nosniff", "referrer-policy": "no-referrer"})
        except Exception as exc:  # noqa: BLE001
            message = html_escape(str(exc))
            return Response(f'<html dir="rtl"><body style="background:#0f172a;color:#fca5a5;font-family:Tahoma;padding:30px"><h2>خطای انتخاب‌گر بصری</h2><p>{message}</p></body></html>',
                            status=400, mimetype="text/html",
                            headers={"cache-control": "no-store", "content-security-policy":
                                     "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'"})

    # ------------------------------------------------------------------
    # Atomic split backup push to a GitHub branch
    # ------------------------------------------------------------------
    def github_token() -> str:
        data = load()
        settings = data.get("ui_settings") if isinstance(data.get("ui_settings"), dict) else {}
        deploy = data.get("deploy") if isinstance(data.get("deploy"), dict) else {}
        return (_s(os.environ.get("GH_BACKUP_TOKEN")) or
                _s(os.environ.get("GITHUB_TOKEN")) or
                _s(settings.get("githubBackupToken") or settings.get("github_backup_token")) or
                _s(data.get("githubBackupToken") or data.get("github_backup_token")) or
                _s(deploy.get("github_token")))

    def validate_repo_branch(repo: str, branch: str) -> tuple[str, str]:
        repo = repo.strip("/")
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
            raise ValueError("Repo must look like owner/name.")
        branch = branch.strip()
        if (not branch or len(branch) > 200 or branch.startswith(("/", ".")) or
                branch.endswith(("/", ".")) or ".." in branch or "//" in branch or
                not re.fullmatch(r"[A-Za-z0-9._/-]+", branch)):
            raise ValueError("Pick a valid branch first.")
        return repo, branch

    def safe_backup_path(value: Any, *, filename: bool = False) -> str:
        raw = _s(value).strip().replace("\\", "/").strip("/")
        if (not raw or len(raw) > 400 or any(part in {"", ".", ".."} for part in raw.split("/")) or
                not re.fullmatch(r"[A-Za-z0-9_.@/-]+", raw)):
            raise ValueError("Backup path is unsafe.")
        if filename and "/" in raw:
            raise ValueError("Backup name must not contain a folder.")
        return raw

    def github_request(method: str, repo: str, path: str, token: str,
                       payload: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        url = f"https://api.github.com/repos/{repo}/{path.lstrip('/')}"
        headers = {"accept": "application/vnd.github+json",
                   "x-github-api-version": "2022-11-28",
                   "user-agent": f"scraper4-python/{core.APP_VERSION}",
                   "authorization": "Bearer " + token}
        response = core.outbound_request(method, url, headers=headers, json=payload, timeout=60)
        if response.status_code in {401, 403}:
            raise ValueError("توکن GitHub نامعتبر است یا مجوز contents:write ندارد.")
        if response.status_code == 404:
            raise ValueError("ریپو یا برنچ پیدا نشد؛ توکن ریپوی خصوصی را نیز بررسی کنید.")
        if not response.ok:
            detail = ""
            try:
                detail = _s(response.json().get("message"))
            except Exception:  # noqa: BLE001
                detail = _s(response.text)[:300]
            raise ValueError(f"GitHub HTTP {response.status_code}: {detail}")
        try:
            value = response.json()
        except ValueError as exc:
            raise ValueError("GitHub پاسخ JSON معتبر برنگرداند.") from exc
        if not isinstance(value, dict):
            raise ValueError("ساختار پاسخ GitHub نامعتبر است.")
        return value

    def update_branch_status(value: dict[str, Any]) -> None:
        data = load()
        data["branch_push_status"] = value
        save(data)

    def push_split_backup(body: dict[str, Any], emit: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
        token = github_token()
        if not token:
            raise ValueError("توکن GitHub برای پوش به برنچ تنظیم نشده است.")
        repo, branch = validate_repo_branch(_s(body.get("repo")), _s(body.get("branch")))
        folder = safe_backup_path(body.get("path") or "backups")
        name = safe_backup_path(body.get("name") or
                                ("backup_push_" + time.strftime("%Y%m%d%H%M%S") + ".json"),
                                filename=True)
        if not name.lower().endswith(".json"):
            raise ValueError("Backup name must end in .json.")
        split_folder = folder + "/" + name[:-5]
        bundle = body.get("bundle")
        if not isinstance(bundle, dict) or not isinstance(bundle.get("files"), dict):
            raise ValueError("Backup bundle has no files.")
        files: dict[str, bytes] = {}
        parts: list[str] = []
        total = 0
        for raw_name, meta in bundle["files"].items():
            part_name = safe_backup_path(raw_name, filename=True)
            if part_name == "manifest.json" or not part_name.lower().endswith(".json"):
                raise ValueError(f"Unsafe backup part: {part_name}")
            encoded = meta.get("b64") if isinstance(meta, dict) else ""
            if not isinstance(encoded, str):
                raise ValueError(f"Backup part {part_name} has no base64 content.")
            try:
                raw = base64.b64decode(encoded.replace("\n", ""), validate=True)
                json.loads(raw.decode("utf-8-sig"))
            except (ValueError, TypeError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ValueError(f"Backup part {part_name} is invalid: {exc}") from exc
            if len(raw) > 5 * 1024 * 1024:
                raise ValueError(f"Backup part {part_name} is larger than 5 MB.")
            total += len(raw)
            if total > 48 * 1024 * 1024:
                raise ValueError("Split backup is larger than 48 MB.")
            files[f"{split_folder}/{part_name}"] = raw
            parts.append(part_name)
        manifest_data = {
            "kind": "split-backup", "format": "scraper4-split-1",
            "app": _s(bundle.get("app")) or "scraper4-python",
            "version": _s(bundle.get("version")) or _s(core.APP_VERSION),
            "created_at": _int(bundle.get("created_at"), int(time.time())),
            "created_at_h": _s(bundle.get("exported_at") or bundle.get("created_at_h")) or _now_iso(),
            "host": _s(bundle.get("host")) or _s(body.get("_requestHost")) or "unknown",
            "parts": parts, "total_files": len(parts), "total_bytes": total,
            "database": "skipped:not-sqlite",
        }
        files[f"{split_folder}/manifest.json"] = json.dumps(
            manifest_data, ensure_ascii=False, indent=2).encode("utf-8")
        emit({"stage": "reading"})
        ref = github_request("GET", repo, "git/ref/heads/" + quote(branch, safe=""), token)
        parent_sha = _s((ref.get("object") or {}).get("sha"))
        if not parent_sha:
            raise ValueError("GitHub branch ref has no commit SHA.")
        commit = github_request("GET", repo, "git/commits/" + parent_sha, token)
        base_tree = _s((commit.get("tree") or {}).get("sha"))
        if not base_tree:
            raise ValueError("GitHub commit has no tree SHA.")
        tree_entries = []
        uploaded = 0
        for path, raw in files.items():
            emit({"stage": "uploading", "bytes": uploaded})
            blob = github_request("POST", repo, "git/blobs", token,
                                  {"content": base64.b64encode(raw).decode("ascii"),
                                   "encoding": "base64"})
            blob_sha = _s(blob.get("sha"))
            if not blob_sha:
                raise ValueError(f"GitHub did not create blob for {path}.")
            tree_entries.append({"path": path, "mode": "100644", "type": "blob", "sha": blob_sha})
            uploaded += len(raw)
        emit({"stage": "uploading", "bytes": uploaded})
        tree = github_request("POST", repo, "git/trees", token,
                              {"base_tree": base_tree, "tree": tree_entries})
        tree_sha = _s(tree.get("sha"))
        created = github_request("POST", repo, "git/commits", token,
                                 {"message": f"backup: {name[:-5]}", "tree": tree_sha,
                                  "parents": [parent_sha]})
        commit_sha = _s(created.get("sha"))
        github_request("PATCH", repo, "git/refs/heads/" + quote(branch, safe=""), token,
                       {"sha": commit_sha, "force": False})
        return {"ok": True, "repo": repo, "branch": branch, "path": split_folder,
                "sha": commit_sha, "commit": commit_sha, "updated": False,
                "parts": len(parts), "bytes": total, "database": "skipped:not-sqlite"}

    @app.post("/api/branch-push")
    def parity_branch_push():
        body = {**_body(), "_requestHost": request.host}
        live = _s(request.args.get("live")) in {"1", "true", "yes"}

        def generate():
            events: queue.Queue[Optional[dict[str, Any]]] = queue.Queue()
            initial = {"at": _now_iso(), "ok": False, "stage": "starting",
                       "repo": _s(body.get("repo")), "branch": _s(body.get("branch"))}
            update_branch_status(initial)

            def worker() -> None:
                try:
                    result = push_split_backup(body, events.put)
                    last = {**result, "at": _now_iso(), "stage": "done"}
                    update_branch_status(last)
                    events.put(last)
                except Exception as exc:  # noqa: BLE001
                    failed = {**initial, "stage": "failed", "error": str(exc)[:1000],
                              "at": _now_iso(),
                              "skipped": ("no-token" if not github_token() else "")}
                    update_branch_status(failed)
                    events.put(failed)
                finally:
                    events.put(None)

            threading.Thread(target=worker, name="branch-backup-push", daemon=True).start()
            while True:
                frame = events.get()
                if frame is None:
                    break
                yield json.dumps(frame, ensure_ascii=False) + "\n"

        if live:
            return Response(stream_with_context(generate()), mimetype="application/x-ndjson",
                            headers={"cache-control": "no-store", "x-accel-buffering": "no"})
        lines = list(generate())
        final = json.loads(lines[-1]) if lines else {"ok": False, "error": "No result"}
        return jsonify(final), (200 if final.get("ok") else 400)

    @app.get("/api/branch-push-status")
    def parity_branch_push_status():
        return ok(last=load().get("branch_push_status"))

    branch_schedule_lock = threading.Lock()

    def branch_schedule_tick() -> None:
        data = load()
        settings = data.get("ui_settings") if isinstance(data.get("ui_settings"), dict) else {}
        cfg = settings.get("branchPush") if isinstance(settings.get("branchPush"), dict) else {}
        if cfg.get("enabled") is not True:
            return
        interval = max(5, min(10080, _int(cfg.get("intervalMin"), 360)))
        last = data.get("branch_push_status") if isinstance(data.get("branch_push_status"), dict) else {}
        if last.get("stage") in {"starting", "reading", "uploading"}:
            return
        stamp = _s(last.get("at"))
        if stamp:
            try:
                if time.time() - datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp() < interval * 60:
                    return
            except ValueError:
                pass
        if not branch_schedule_lock.acquire(blocking=False):
            return
        try:
            repo = _s(cfg.get("repo")) or _s((data.get("deploy") or {}).get("repo_name"))
            branch = _s(cfg.get("branch"))
            folder = _s(cfg.get("path")) or "backups"
            initial = {"at": _now_iso(), "ok": False, "stage": "starting",
                       "scheduled": True, "repo": repo, "branch": branch}
            if not github_token():
                update_branch_status({**initial, "stage": "skipped", "skipped": "no-token"})
                return
            if not repo or not branch:
                update_branch_status({**initial, "stage": "skipped", "skipped": "no-target"})
                return
            update_branch_status(initial)
            try:
                result = push_split_backup({"repo": repo, "branch": branch, "path": folder,
                                            "name": "scheduled-backup.json",
                                            "bundle": make_backup(), "_requestHost": "scheduled"},
                                           lambda frame: update_branch_status(
                                               {**initial, **frame, "at": _now_iso()}))
                update_branch_status({**result, "at": _now_iso(), "stage": "done",
                                      "scheduled": True})
            except Exception as exc:  # noqa: BLE001
                update_branch_status({**initial, "at": _now_iso(), "stage": "failed",
                                      "error": str(exc)[:1000]})
        finally:
            branch_schedule_lock.release()

    def branch_schedule_loop() -> None:
        while True:
            try:
                branch_schedule_tick()
            except Exception as exc:  # noqa: BLE001
                try:
                    core.log_structured_error("branch-backup-scheduler", exc)
                except Exception:
                    pass
            time.sleep(60)

    if os.environ.get("SCRAPER_DISABLE_SCHEDULERS", "").lower() not in {"1", "true", "yes"}:
        threading.Thread(target=branch_schedule_loop, name="branch-backup-scheduler",
                         daemon=True).start()

    # ------------------------------------------------------------------
    # Operational endpoints previously represented by empty placeholders
    # ------------------------------------------------------------------
    @app.get("/api/autoreply/log")
    def parity_autoreply_log():
        rows = load().get("autoreply_log") or []
        return ok(items=list(reversed(rows[-500:])) if isinstance(rows, list) else [])

    @app.get("/api/basalam/orders")
    def parity_basalam_orders():
        try:
            payload = core.basalam_api_request("GET", "/v1/vendor-parcels",
                                               params={"per_page": min(100, max(1, _int(request.args.get("limit"), 50)))})
            rows = core.basalam_api_rows(payload)
            return ok(items=rows, total=len(rows))
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, error=str(exc), items=[]), 400

    def send_notification(channel: str, text: str) -> dict[str, Any]:
        data = load()
        cfg = data.get("notifications") if isinstance(data.get("notifications"), dict) else {}
        channel = channel.lower().replace("baleh", "bale")
        if channel in {"bale", "telegram"}:
            prefix = "bale" if channel == "bale" else "telegram"
            token = _s(cfg.get(prefix + "Token") or cfg.get(prefix + "_token"))
            chat_id = _s(cfg.get(prefix + "ChatId") or cfg.get(prefix + "_chat_id"))
            if not token or not chat_id:
                raise ValueError(f"توکن و Chat ID {channel} کامل نیست.")
            base = "https://tapi.bale.ai" if channel == "bale" else "https://api.telegram.org"
            url = f"{base}/bot{token}/sendMessage"
            response = core.outbound_request("POST", url,
                                             json={"chat_id": chat_id, "text": text}, timeout=30)
        elif channel == "rubika":
            token = _s(cfg.get("rubikaToken") or cfg.get("rubika_token"))
            chat_id = _s(cfg.get("rubikaChatId") or cfg.get("rubika_chat_id"))
            if not token or not chat_id:
                raise ValueError("توکن و Chat ID روبیکا کامل نیست.")
            response = core.outbound_request(
                "POST", f"https://botapi.rubika.ir/v3/{token}/sendMessage",
                json={"chat_id": chat_id, "text": text}, timeout=30)
        elif channel in {"web-push", "push"}:
            return send_push({"title": "Scraper4", "body": text, "tag": "notification-test"})
        else:
            webhook = _s(cfg.get("webhook") or cfg.get("webhookUrl"))
            if not webhook:
                raise ValueError("کانال اعلان شناخته‌شده یا Webhook تنظیم نشده است.")
            response = core.outbound_request("POST", core.public_http_url(webhook),
                                             json={"text": text, "channel": channel}, timeout=30)
        if not response.ok:
            raise ValueError(f"سرویس اعلان HTTP {response.status_code}: {_s(response.text)[:300]}")
        try:
            payload = response.json()
        except ValueError:
            payload = {"status": response.status_code}
        return {"ok": True, "sent": True, "channel": channel, "response": payload}

    @app.post("/api/notifications/test")
    def parity_notification_test():
        body = _body()
        try:
            return jsonify(send_notification(_s(body.get("channel")),
                                             _s(body.get("text")) or "پیام آزمایشی اسکرپر ۴"))
        except Exception as exc:  # noqa: BLE001
            return jsonify(ok=False, sent=False, error=str(exc)), 400

    @app.route("/api/digest", methods=["GET", "POST"])
    def parity_digest():
        body = _body()
        data = load()
        profiles = data.get("profiles") or {}
        products = sum(len(cfg.get("saved_products") or []) for cfg in profiles.values()
                       if isinstance(cfg, dict))
        tasks = live_tasks()
        summary = (f"📊 گزارش Scraper4\nپروفایل‌ها: {len(profiles)}\nمحصولات ذخیره‌شده: {products}"
                   f"\nکارهای فعال: {sum(_s(row.get('status')) in {'running', 'waiting'} for row in tasks)}"
                   f"\nنسخه: {core.APP_VERSION}")
        result: dict[str, Any] = {"ok": True, "text": summary,
                                  "profiles": len(profiles), "products": products,
                                  "tasks": len(tasks), "sent": []}
        if _s(body.get("confirm")) == "SEND":
            cfg = data.get("notifications") if isinstance(data.get("notifications"), dict) else {}
            channels = []
            if cfg.get("baleEnabled") or cfg.get("bale_enabled"):
                channels.append("bale")
            if cfg.get("rubikaEnabled") or cfg.get("rubika_enabled"):
                channels.append("rubika")
            if cfg.get("telegramEnabled") or cfg.get("telegram_enabled"):
                channels.append("telegram")
            errors = []
            for channel in channels:
                try:
                    send_notification(channel, summary)
                    result["sent"].append(channel)
                except Exception as exc:  # noqa: BLE001
                    errors.append({"channel": channel, "error": str(exc)})
            result["errors"] = errors
            result["ok"] = not errors and bool(channels)
            if not channels:
                result["error"] = "هیچ کانال اعلان فعالی تنظیم نشده است."
            data["digest_state"] = {"at": _now_iso(), "sent": result["sent"],
                                    "errors": errors}
            save(data)
        return jsonify(result), (200 if result["ok"] else 400)

    @app.get("/api/github/token-status")
    def parity_github_token_status():
        env = bool(os.environ.get("GH_BACKUP_TOKEN") or os.environ.get("GITHUB_TOKEN"))
        token = github_token()
        return ok(active=("env" if env else "stored" if token else None), env=env,
                  stored=bool(token and not env), hasToken=bool(token),
                  hint=(token[-4:] if token else None))

    @app.get("/api/bootstrap/status")
    def parity_bootstrap_status():
        path = _s(os.environ.get("SCRAPER_BOOTSTRAP_FILE"))
        data = load()
        profiles = data.get("profiles") or {}
        return ok(supported=True, enabled=bool(path), fileFound=bool(path and os.path.isfile(path)),
                  fresh=not bool(profiles), reason=("SCRAPER_BOOTSTRAP_FILE تنظیم نشده است" if not path else ""),
                  lastRestored=data.get("bootstrap_last_restored"),
                  lastError=data.get("bootstrap_last_error"))

    @app.get("/api/selftest")
    def parity_selftest():
        rules = list(app.url_map.iter_rules())
        available = {(method, re.sub(r"<[^>]+>", "<>", rule.rule))
                     for rule in rules for method in rule.methods if method not in {"HEAD", "OPTIONS"}}
        required = [
            ("GET", "/api/settings"), ("GET", "/api/connections"),
            ("GET", "/api/profiles"), ("GET", "/api/jobs"),
            ("GET", "/api/backup"), ("POST", "/api/restore"),
            ("GET", "/manifest.webmanifest"), ("GET", "/visual"),
            ("POST", "/api/web-push/subscribe"),
        ]
        checks: list[dict[str, Any]] = []
        checks.append({"name": "data-readable", "ok": isinstance(load(), dict),
                       "detail": _s(core.DATA_FILE)})
        checks.append({"name": "ui-assets", "ok": (Path(core.BASE_DIR) / "ui" / "dashboard.js").is_file(),
                       "detail": _s(Path(core.BASE_DIR) / "ui")})
        missing = [f"{method} {path}" for method, path in required if (method, path) not in available]
        checks.append({"name": "required-routes", "ok": not missing, "detail": missing})
        checks.append({"name": "version", "ok": bool(re.fullmatch(r"\d+\.\d+", _s(core.APP_VERSION))),
                       "detail": _s(core.APP_VERSION)})
        checks.append({"name": "pwa-icons", "ok": all((Path(core.BASE_DIR) / "ui" / name).is_file()
                                                          for name in ("app-icon-192.png", "app-icon-512.png")),
                       "detail": "192/512"})
        return jsonify(ok=all(check["ok"] for check in checks), checks=checks,
                       runtime="python-flask", version=core.APP_VERSION)

    # Keep module intentionally side-effect free beyond route installation.
