#!/usr/bin/env python3
"""Verify the Python runtime's declared Node API parity contract.

The route inventory is pinned in ``parity-manifest.json`` to the reviewed Node
commit, so this check is deterministic and does not need a network or a remote
Git ref in production/CI.
"""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "parity-manifest.json"


def normalize(path: str) -> str:
    path = re.sub(r"<(?:path:|int:|float:|uuid:|string:)?[^>]+>", "<>", path)
    path = re.sub(r":([A-Za-z_][\w]*)(?:\([^)]*\))?", "<>", path)
    path = re.sub(r"/+", "/", path)
    return path.rstrip("/") or "/"


def version_tuple(value: str) -> tuple[int, ...]:
    return tuple(int(part) for part in re.findall(r"\d+", value)[:4])


def main() -> int:
    failures: list[str] = []
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if manifest.get("schema") != 1:
        failures.append("unsupported parity manifest schema")
    routes = manifest.get("requiredRoutes")
    if not isinstance(routes, list) or not routes:
        failures.append("manifest has no requiredRoutes")
        routes = []
    expected = {(str(row.get("method", "")).upper(), normalize(str(row.get("path", ""))))
                for row in routes if isinstance(row, dict)}
    if len(expected) != len(routes):
        failures.append("manifest contains duplicate/invalid route entries")

    with tempfile.TemporaryDirectory(prefix="scraper4-parity-") as tmp:
        os.environ.setdefault("SCRAPER_DATA_FILE", str(Path(tmp) / "data.json"))
        os.environ.setdefault("SCRAPER_LIVE_DIR", str(Path(tmp) / "tasks"))
        os.environ.setdefault("SCRAPER_GIT_AUTO_UPDATE", "0")
        os.environ.setdefault("SCRAPER_AUTO_UPDATE", "0")
        os.environ.setdefault("SCRAPER_DISABLE_SCHEDULERS", "1")
        sys.path.insert(0, str(ROOT))
        import scraper4  # pylint: disable=import-outside-toplevel

        actual: set[tuple[str, str]] = set()
        exact_rules: dict[tuple[str, str], list[str]] = defaultdict(list)
        for rule in scraper4.app.url_map.iter_rules():
            for method in rule.methods - {"HEAD", "OPTIONS"}:
                actual.add((method, normalize(rule.rule)))
                exact_rules[(method, rule.rule)].append(rule.endpoint)
        missing = sorted(expected - actual)
        if missing:
            failures.append("missing routes: " + ", ".join(f"{m} {p}" for m, p in missing))
        duplicates = [(method, path, endpoints) for (method, path), endpoints in exact_rules.items()
                      if len(endpoints) > 1]
        if duplicates:
            failures.append("duplicate Flask rules: " + ", ".join(
                f"{method} {path} ({'/'.join(endpoints)})" for method, path, endpoints in duplicates))

        minimum = str((manifest.get("target") or {}).get("minimumVersion") or "0")
        if version_tuple(scraper4.APP_VERSION) < version_tuple(minimum):
            failures.append(f"APP_VERSION {scraper4.APP_VERSION} is below {minimum}")
        changelog = getattr(scraper4, "CHANGELOG", [])
        if not changelog or str(changelog[0].get("version")) != scraper4.APP_VERSION:
            failures.append("top CHANGELOG version does not equal APP_VERSION")

    required_files = [
        ROOT / "parity_ext.py", ROOT / "ui" / "dashboard.html",
        ROOT / "ui" / "dashboard.js", ROOT / "ui" / "workers-ai-catalog.json",
        ROOT / "ui" / "app-icon-192.png", ROOT / "ui" / "app-icon-512.png",
    ]
    absent = [str(path.relative_to(ROOT)) for path in required_files if not path.is_file()]
    if absent:
        failures.append("missing parity assets: " + ", ".join(absent))
    contract_file = ROOT / "tools" / "test_node_parity_contracts.py"
    contract_source = contract_file.read_text(encoding="utf-8") if contract_file.is_file() else ""
    contracts = manifest.get("behavioralContracts")
    if not isinstance(contracts, list) or not contracts:
        failures.append("manifest has no behavioral contracts")
    else:
        for row in contracts:
            reference = str(row.get("test", "")) if isinstance(row, dict) else ""
            method = reference.rsplit(".", 1)[-1]
            if not method or not re.search(rf"^\s+def\s+{re.escape(method)}\s*\(",
                                           contract_source, re.MULTILINE):
                failures.append(f"behavioral contract test is missing: {reference or row!r}")

    result = {
        "ok": not failures,
        "sourceCommit": (manifest.get("source") or {}).get("commit"),
        "requiredRoutes": len(expected),
        "coveredRoutes": len(expected) - len(expected - actual),
        "pythonRoutes": len(actual),
        "behavioralContracts": len(contracts) if isinstance(contracts, list) else 0,
        "failures": failures,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
