#!/usr/bin/env python3
"""Regression tests for 10.244: selector suggest/test render modes, per-profile
sub-steps, and the concurrent AI model tester.

Run with the project dependencies installed:

    python3 tools/test_steps_render_airun.py

Offline checks only (fixtures, no network, no live AI calls).
"""
from __future__ import annotations

import inspect
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ✓ {name}")
    else:
        FAILURES.append(name)
        print(f"  ✕ {name}" + (f" — {detail}" if detail else ""))


def main() -> int:
    tmpdir = tempfile.mkdtemp(prefix="s4-test-244-")
    os.environ["SCRAPER_DATA_FILE"] = os.path.join(tmpdir, "scraper4_data.json")
    import scraper4 as core  # noqa: E402

    print("== A: engine-aware selector suggest/test (scraper4 core) ==")
    sig = inspect.signature(core.auto_selectors)
    check("auto_selectors accepts render", "render" in sig.parameters)
    check("preview_selector exists", callable(getattr(core, "preview_selector", None)))
    if callable(getattr(core, "preview_selector", None)):
        sig = inspect.signature(core.preview_selector)
        check("preview_selector(url, selector, kind, render)", list(sig.parameters) == ["url", "selector", "kind", "render"],
              str(list(sig.parameters)))
        try:
            core.preview_selector("https://example.com/x", "", "text")
            check("empty selector rejected", False)
        except Exception:
            check("empty selector rejected", True)
        try:
            core.preview_selector("https://example.com/x", "a >> bad >> {", "text")
            check("invalid selector rejected", False)
        except Exception:
            check("invalid selector rejected", True)
    src = open(os.path.join(ROOT, "scraper4.py"), encoding="utf-8").read()
    check("auto_selectors renders with the browser first when asked",
          'if rl in ("playwright", "browser"):' in src)
    check("selector test uses the browser chain (playwright + selenium)",
          'got = picker_browser_fetch(source, fetcher.timeout, 4, errors)' in src
          and 'picker_browser_fetch(source, fetcher.timeout, 4, errors, engine="selenium")' in src)
    check("per-profile AI content gate in ai_content_worker",
          'این پروفایل توضیح‌ساز هوش مصنوعی را در تنظیمات پروفایل خاموش کرده است' in src)

    print("== B: ui_bridge wiring ==")
    ub = open(os.path.join(ROOT, "ui_bridge.py"), encoding="utf-8").read()
    check("suggest-selectors passes render", "core.auto_selectors(url, mode, render)" in ub)
    check("test-selector passes render", "core.preview_selector(url, selector, kind, render)" in ub)
    check("empty candidate list falls back to ALL models",
          "return _ai_run_models(False)" in ub)
    check("AI worker tests models concurrently",
          "ThreadPoolExecutor(max_workers=concurrency" in ub)
    check("AI worker honors skipTimeoutMs (stalled model skipped)",
          "مهلت رد مدل گیرکرده" in ub)
    check("AI worker keeps stop semantics", 'latest.get("stopRequested")' in ub)
    check("test-runs accepts concurrency + skipTimeoutMs",
          '_int(body.get("concurrency")) or 6' in ub and '_int(body.get("skipTimeoutMs")) or 30000' in ub)
    check("profile mapping stores detail_extract",
          '"detail_extract": node.get("detailExtract", True) is not False' in ub)
    check("profile mapping returns detailExtract",
          '"detailExtract": cfg.get("detail_extract", True) is not False' in ub)
    check("full sync honors the per-profile detail toggle",
          'config["enrich"] = cfg.get("detail_extract", True) is not False' in ub)
    check("ai-descriptions endpoint honors the profile toggle",
          'توضیح‌ساز برای این پروفایل در تنظیمات خاموش است' in ub)

    print("== C: dashboard frontend ==")
    js = open(os.path.join(ROOT, "ui", "dashboard.js"), encoding="utf-8").read()
    check("suggest list/detail + selector tests send the render mode",
          js.count("render:$('extractionEngine')?.value||'auto'") == 5,
          str(js.count("render:$('extractionEngine')?.value||'auto'")))
    check("profile field set includes detailExtract",
          "'aiDescriptions','detailExtract'" in js and "'galMode'" in js)
    # 10.248: the per-profile GitHub branch rides the same field set.
    check("profile field set includes githubBranch",
          "'detailExtract','githubBranch'" in js)
    check("clearForm/editProfile/profileBody wire detailExtract",
          "if($('detailExtract'))$('detailExtract').checked=true;" in js
          and "$('detailExtract').checked=p.detailExtract!==false;" in js
          and "detailExtract:$('detailExtract')?.checked!==false" in js)
    check("AI test run sends concurrency + skipTimeoutMs",
          "concurrency:Math.max(1,Math.min(16,Number($('aiTestConcurrency')?.value)||6))" in js
          and "skipTimeoutMs:Math.max(1000,Math.min(300000,Number($('aiSkipTimeoutMs')?.value)||30000))" in js)
    check("AI panel has the concurrency input",
          "mInput('اجرای موازی (مدل‌های همزمان):','aiTestConcurrency'" in js)
    html = open(os.path.join(ROOT, "ui", "dashboard.html"), encoding="utf-8").read()
    check("settings page has the detail-extraction toggle",
          '<input id="detailExtract" type="checkbox" checked><span>استخراج جزئیات محصول در همگام‌سازی</span>' in html)

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILED: " + ", ".join(FAILURES))
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
