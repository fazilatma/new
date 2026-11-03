"""PythonAnywhere WSGI entry point for the v10.599 migration.

This scaffold is intentionally feature-gated until full PHP route/UI parity is
complete; see MIGRATION_STATUS.md.
"""
from __future__ import annotations

import json
from pathlib import Path

from flask import Flask, jsonify, request

from scraper4_port.compat.pagination import build_page_url_custom

ROOT = Path(__file__).resolve().parent
MANIFEST = json.loads((ROOT / "migration" / "source_manifest.json").read_text(encoding="utf-8"))
PORT_PARITY_COMPLETE = False


def create_app() -> Flask:
    app = Flask(__name__)
    app.config.update(JSON_AS_ASCII=False, MAX_CONTENT_LENGTH=16 * 1024 * 1024)

    @app.get("/api/port-status")
    def port_status():
        source = MANIFEST["source"]
        counts = MANIFEST["inventory_counts"]
        return jsonify({
            "ok": True,
            "deployable": PORT_PARITY_COMPLETE,
            "migration": "in_progress",
            "source": source,
            "inventory": counts,
            "implemented_compat_helpers": [
                "pagination.build_page_url_custom",
                "text.persian_to_english",
                "text.normalize_text",
                "text.normalize_html",
                "text.extract_price",
                "urls.make_absolute_url",
                "urls.profile_key",
                "product_key.product_key",
            ],
            "notice": "Not a production replacement. Full route and UI parity has not been completed.",
        }), 200

    @app.get("/api/pagination/preview")
    def pagination_preview():
        current = request.args.get("url", "")
        base = request.args.get("base_url", current)
        kind = request.args.get("type", "query_page")
        value = request.args.get("value", "")
        try:
            first = int(request.args.get("from", "2"))
            count = max(1, min(50, int(request.args.get("count", "3"))))
        except ValueError:
            return jsonify({"ok": False, "error": "from/count must be integers"}), 400
        if not current or not base:
            return jsonify({"ok": False, "error": "url and base_url are required"}), 400
        return jsonify({
            "ok": True,
            "urls": [
                build_page_url_custom(current, base, page, kind, value)
                for page in range(first, first + count)
            ],
        })

    @app.get("/")
    def not_ready():
        return jsonify({
            "ok": False,
            "deployable": PORT_PARITY_COMPLETE,
            "error": "Python port is incomplete; do not route production traffic here yet.",
            "status_url": "/api/port-status",
        }), 503

    @app.route("/<path:unknown>", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    def not_migrated(unknown: str):
        return jsonify({
            "ok": False,
            "error": "route_not_ported",
            "route": "/" + unknown,
            "deployable": PORT_PARITY_COMPLETE,
        }), 501

    return app


app = create_app()
