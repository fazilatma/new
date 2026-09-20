#!/usr/bin/env python3
"""Guard the versioning convention in scraper4.py.

scraper4.py carries the rule in a comment:

    Every APP_VERSION bump must add a new top CHANGELOG row.

Nothing enforced it, and ten releases worth of work shipped while
APP_VERSION sat at 10.149. This script makes the rule checkable:

    python3 tools/check_version.py

It parses the file with ast (no import, so no side effects) and verifies:
  * APP_VERSION equals the newest CHANGELOG entry
  * versions are unique and strictly descending
  * every entry has a date (YYYY-MM-DD), a title and at least one item

Exits non-zero with a specific message on the first problem found.
"""
from __future__ import annotations

import ast
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TARGET = ROOT / "scraper4.py"
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def parts(version: str) -> tuple[int, ...]:
    return tuple(int(p) for p in version.split("."))


def main() -> int:
    tree = ast.parse(TARGET.read_text(encoding="utf-8"))
    found: dict[str, object] = {}
    for node in tree.body:
        if isinstance(node, ast.Assign):
            name = getattr(node.targets[0], "id", "")
            if name in ("APP_VERSION", "CHANGELOG"):
                found[name] = ast.literal_eval(node.value)

    for key in ("APP_VERSION", "CHANGELOG"):
        if key not in found:
            print(f"FAIL: {key} not found in {TARGET.name}")
            return 1

    version = found["APP_VERSION"]
    log = found["CHANGELOG"]
    if not log:
        print("FAIL: CHANGELOG is empty")
        return 1

    if log[0]["version"] != version:
        print(f"FAIL: APP_VERSION is {version} but the top CHANGELOG entry "
              f"is {log[0]['version']}. Add a new row at the top when bumping.")
        return 1

    versions = [entry["version"] for entry in log]
    if len(set(versions)) != len(versions):
        dupes = {v for v in versions if versions.count(v) > 1}
        print(f"FAIL: duplicate CHANGELOG versions: {', '.join(sorted(dupes))}")
        return 1

    for older, newer in zip(versions[1:], versions):
        if parts(newer) <= parts(older):
            print(f"FAIL: CHANGELOG must be newest-first, but {newer} "
                  f"is not above {older}")
            return 1

    for entry in log:
        tag = entry["version"]
        if not DATE_RE.match(str(entry.get("date", ""))):
            print(f"FAIL: {tag} has an invalid date {entry.get('date')!r} "
                  "(expected YYYY-MM-DD)")
            return 1
        if not str(entry.get("title", "")).strip():
            print(f"FAIL: {tag} has no title")
            return 1
        items = entry.get("items") or []
        if not items or not all(str(x).strip() for x in items):
            print(f"FAIL: {tag} has no items (or an empty one)")
            return 1

    print(f"OK: APP_VERSION {version} matches the top of {len(log)} "
          "well-formed CHANGELOG entries.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
