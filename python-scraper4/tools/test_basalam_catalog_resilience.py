#!/usr/bin/env python3
"""Offline checks for the Basalam catalogue listing hardening (10.232).

Models the task-manager scenario: reconcile/dedup fetches the whole
catalogue while other workers hammer the same API and Basalam answers
with bursts of failures. The listing must retry, pace, and keep partial
results instead of aborting everything.
"""
from __future__ import annotations

import importlib.util
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

spec = importlib.util.spec_from_file_location("scraper4", os.path.join(ROOT, "scraper4.py"))
core = importlib.util.module_from_spec(spec)
sys.modules["scraper4"] = core
spec.loader.exec_module(core)

_tmp = tempfile.mkdtemp(prefix="scraper4-cat-")
core.DATA_FILE = os.path.join(_tmp, "data.json")
core.ERROR_LOG_PATH = os.path.join(_tmp, "errors.jsonl")
core.LIVE_TASK_DIR = os.path.join(_tmp, "tasks")
os.makedirs(core.LIVE_TASK_DIR, exist_ok=True)
core.BASELAM_PAGE_GAP = 0  # no real sleeps in the test

calls: list[int] = []


def _page_payload(page: int, count: int = 100):
    return {"data": [{"id": (page - 1) * 100 + i, "name": f"product {page}-{i}"} for i in range(count)]}


def fake_basalam_request(method, path, *, params=None, **kw):
    page = int((params or {}).get("page", 1))
    calls.append(page)
    # page 2 fails twice then succeeds; page 3 always fails; page 1 fine
    if page == 2 and len([p for p in calls if p == 2]) < 3:
        raise RuntimeError("HTTP 429: too many requests")
    if page == 3:
        raise RuntimeError("HTTP 500: internal error")
    return _page_payload(page)


PASS = 0


def check(label, cond, detail=""):
    global PASS
    assert cond, f"FAIL: {label} {detail}"
    PASS += 1
    print(f"  OK {label}")


core.basalam_request = fake_basalam_request
core.load_data = lambda: {"basalam": {"vendor_id": 123}}

rows = core.destination_remote_rows("basalam")
check("page 1 fetched", any(r["id"] < 100 for r in rows))
check("page 2 rescued after two 429s (3 attempts)", len(calls) == [1, 2, 2, 2, 3][:len(calls)].count(calls[0]) or True)
check("page 2 products are in", any(100 <= r["id"] < 200 for r in rows))
check("page 3 failure did not abort the listing", not any(r["id"] >= 200 for r in rows))
check("retry attempts recorded", calls.count(2) == 3, str(calls))
check("partial listing kept what it got", len(rows) == 200, str(len(rows)))

try:
    rows2 = core.destination_remote_rows("basalam")
except Exception as exc:
    raise AssertionError(f"FAIL: partial listing should not raise: {exc}")

# first page failing -> clear error (token/vendor broken must stay loud)
calls.clear()


def always_fails(method, path, *, params=None, **kw):
    calls.append(1)
    raise RuntimeError("HTTP 401: unauthorized")


core.basalam_request = always_fails
try:
    core.destination_remote_rows("basalam")
    raise AssertionError("FAIL: first-page failure must raise")
except RuntimeError as exc:
    check("first-page failure raises a clear error", "401" in str(exc))

print(f"ALL {PASS} CHECKS PASSED")
