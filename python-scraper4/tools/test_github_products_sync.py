#!/usr/bin/env python3
"""Regression tests for 10.248: per-profile products push/pull on a GitHub
branch (push extracted products to the profile's branch; pull them back and
dispatch to WooCommerce/Basalam).

    python3 tools/test_github_products_sync.py

Offline: GitHub API calls are faked through core.outbound_request; no
network, no real token, no real dispatch.
"""
from __future__ import annotations

import importlib.util
import json
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


PRODUCTS = [{"title": f"کفش {i}", "price": f"{1000000 + i} تومان",
             "link": f"https://example.com/p/{i}", "image": f"https://example.com/i/{i}.jpg"}
            for i in range(1, 6)]


class FakeGHResponse:
    def __init__(self, status=200, payload=None, content=b""):
        self.status_code = status
        self.ok = status < 400
        self._payload = payload
        self.content = content
        self.text = content.decode("utf-8", "replace")

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


class FakeGitHub:
    """Routes the git-data + contents calls the feature makes."""

    def __init__(self):
        self.calls: list[tuple[str, str, dict]] = []
        self.remote_files: dict[str, bytes] = {}
        self.fail_statuses = False

    def __call__(self, method, url, **kwargs):
        self.calls.append((method, url, dict(kwargs)))
        if self.fail_statuses:
            return FakeGHResponse(403, {"message": "forbidden"})
        if method == "GET" and "/git/ref/heads/" in url:
            return FakeGHResponse(200, {"object": {"sha": "parent1"}})
        if method == "GET" and "/git/commits/parent1" in url:
            return FakeGHResponse(200, {"tree": {"sha": "tree1"}})
        if method == "POST" and url.endswith("/git/blobs"):
            return FakeGHResponse(200, {"sha": "blob1"})
        if method == "POST" and url.endswith("/git/trees"):
            return FakeGHResponse(200, {"sha": "tree2"})
        if method == "POST" and url.endswith("/git/commits"):
            return FakeGHResponse(200, {"sha": "commit9"})
        if method == "PATCH" and "/git/refs/heads/" in url:
            return FakeGHResponse(200, {"object": {"sha": "commit9"}})
        if method == "GET" and "/contents/" in url:
            path = url.split("/contents/", 1)[1].split("?")[0]
            raw = self.remote_files.get(path)
            if raw is None:
                return FakeGHResponse(404, {"message": "Not Found"})
            return FakeGHResponse(200, content=raw)
        return FakeGHResponse(404, {"message": f"unexpected {method} {url}"})


def main() -> int:
    tmpdir = tempfile.mkdtemp(prefix="s4-test-248-")
    os.environ["SCRAPER_DATA_FILE"] = os.path.join(tmpdir, "scraper4_data.json")
    os.environ["SCRAPER4_AUTO_INSTALL"] = "0"
    os.environ["GH_BACKUP_TOKEN"] = "test-token-248"
    import scraper4 as core  # noqa: E402  (registers ui_bridge + parity routes)

    fake = FakeGitHub()
    real_outbound = core.outbound_request
    core.outbound_request = fake
    dispatch_calls: list[tuple] = []
    real_dispatch = core.start_profile_dispatch

    def fake_dispatch(pid, body):
        dispatch_calls.append((pid, dict(body)))
        return {"id": "task-gh-1", "status": "queued", "profile": pid}

    core.start_profile_dispatch = fake_dispatch

    def make_profile(pid: str, **over):
        data = core.load_data()
        cfg = {"name": pid, "url": "https://example.com/list", "selectors": {},
               "saved_products": list(PRODUCTS), "github_branch": "main"}
        cfg.update(over)
        data.setdefault("profiles", {})[pid] = cfg
        core.save_data(data)

    try:
        client = core.app.test_client()

        print("== A: push products to the branch (non-live) ==")
        make_profile("shop1")
        r = client.post("/api/profiles/shop1/products-push", json={})
        data = r.get_json()
        check("A1 HTTP 200 ok", r.status_code == 200 and data.get("ok") is True,
              f"{r.status_code} {data}")
        check("A1 branch from the profile", data.get("branch") == "main")
        check("A1 path lands in scraper4-products",
              data.get("path", "").startswith("scraper4-products/")
              and data.get("path", "").endswith(".json"), data.get("path"))
        check("A1 count reported", data.get("count") == len(PRODUCTS))
        methods = [c[0] for c in fake.calls]
        check("A1 atomic chain order",
              methods == ["GET", "GET", "POST", "POST", "POST", "PATCH"], str(methods))
        blob_payload = fake.calls[2][2].get("json")
        import base64
        pushed_raw = base64.b64decode(blob_payload["content"])
        pushed = json.loads(pushed_raw.decode("utf-8"))
        check("A1 file is the products document",
              pushed.get("kind") == "scraper4-products"
              and pushed.get("count") == len(PRODUCTS)
              and pushed.get("products") == PRODUCTS)
        check("A1 commit message names the profile",
              "products: shop1" in fake.calls[4][2]["json"]["message"])
        tree_entry = fake.calls[3][2]["json"]["tree"][0]
        check("A1 tree entry path matches", tree_entry["path"] == data.get("path"))
        check("A1 ref update is non-forced",
              fake.calls[5][2]["json"] == {"sha": "commit9", "force": False})
        prof = core.load_data()["profiles"]["shop1"]
        check("A1 last push recorded on the profile",
              isinstance(prof.get("products_push"), dict)
              and prof["products_push"].get("branch") == "main"
              and prof["products_push"].get("count") == len(PRODUCTS))

        print("== B: push live stream ==")
        fake.calls = []
        r = client.post("/api/profiles/shop1/products-push?live=1", json={"branch": "main"})
        check("B1 ndjson content type", "x-ndjson" in (r.content_type or ""))
        events = [json.loads(line) for line in
                  r.get_data(as_text=True).splitlines() if line.strip()]
        progress = [e for e in events if e.get("type") == "progress"]
        results = [e for e in events if e.get("type") == "result"]
        check("B1 progress events streamed", len(progress) >= 2)
        check("B1 progress carries elapsedMs",
              all(isinstance(e.get("elapsedMs"), int) for e in progress))
        check("B1 single result report", len(results) == 1
              and results[0]["report"].get("ok") is True)

        print("== C: push errors ==")
        r = client.post("/api/profiles/shop1/products-push", json={"branch": ""})
        # branch falls back to the profile's github_branch → still ok; force
        # the failure by clearing the profile field.
        data = core.load_data()
        data["profiles"]["shop1"]["github_branch"] = ""
        core.save_data(data)
        r = client.post("/api/profiles/shop1/products-push", json={})
        data = r.get_json()
        check("C1 no branch configured → 400 with a clear error",
              r.status_code == 400 and "برنچ" in data.get("error", ""), str(data))
        data = core.load_data()
        data["profiles"]["empty"] = {"name": "empty", "url": "https://example.com",
                                     "saved_products": [], "github_branch": "main"}
        core.save_data(data)
        r = client.post("/api/profiles/empty/products-push", json={})
        data = r.get_json()
        check("C2 no saved products → 400", r.status_code == 400
              and "محصول" in data.get("error", ""))
        r = client.post("/api/profiles/ghost/products-push", json={})
        check("C3 unknown profile → 400", r.status_code == 400)
        # The sandbox (or a real server) may carry GITHUB_TOKEN in the
        # environment — github_token() reads it too, so clear both.
        saved_env = {k: os.environ.pop(k) for k in ("GH_BACKUP_TOKEN", "GITHUB_TOKEN")
                     if k in os.environ}
        try:
            r = client.post("/api/profiles/shop1/products-push", json={"branch": "main"})
            data = r.get_json()
            check("C4 no token → 400 with a clear error", r.status_code == 400
                  and "توکن" in data.get("error", ""), str(data))
        finally:
            os.environ.update(saved_env)

        print("== D: pull (dry-run, save, dispatch) ==")
        # Restore branch + seed the remote file from the pushed document.
        data = core.load_data()
        data["profiles"]["shop1"]["github_branch"] = "main"
        data["profiles"]["shop1"]["saved_products"] = []
        core.save_data(data)
        fake.remote_files[data["profiles"]["shop1"]["products_push"]["path"]] = pushed_raw

        r = client.post("/api/profiles/shop1/products-pull",
                        json={"dryRun": True})
        d = r.get_json()
        check("D1 dry-run ok", r.status_code == 200 and d.get("ok") is True
              and d.get("dryRun") is True, str(d))
        check("D1 dry-run reports the remote count", d.get("count") == len(PRODUCTS))
        check("D1 dry-run did not touch saved products",
              core.load_data()["profiles"]["shop1"]["saved_products"] == [])

        r = client.post("/api/profiles/shop1/products-pull", json={})
        d = r.get_json()
        check("D2 pull ok", r.status_code == 200 and d.get("ok") is True, str(d))
        prof = core.load_data()["profiles"]["shop1"]
        check("D2 products replaced from the branch",
              prof["saved_products"] == PRODUCTS)
        check("D2 last pull recorded",
              isinstance(prof.get("products_pull"), dict)
              and prof["products_pull"].get("count") == len(PRODUCTS)
              and prof["products_pull"].get("branch") == "main")

        dispatch_calls.clear()
        r = client.post("/api/profiles/shop1/products-pull",
                        json={"dispatch": True, "destinations": ["basalam"],
                              "wooStatus": "publish"})
        d = r.get_json()
        check("D3 pull+dispatch ok", r.status_code == 200 and d.get("ok") is True)
        check("D3 dispatch started with the chosen destination",
              dispatch_calls == [("shop1", {"destinations": ["basalam"],
                                            "woo_status": "publish"})],
              str(dispatch_calls))
        check("D3 task returned to the UI", d.get("task", {}).get("id") == "task-gh-1")

        dispatch_calls.clear()
        r = client.post("/api/profiles/shop1/products-pull", json={"dispatch": True})
        d = r.get_json()
        check("D4 default destinations are both",
              dispatch_calls and dispatch_calls[0][1]["destinations"]
              == ["woocommerce", "basalam"], str(dispatch_calls))

        print("== E: pull errors ==")
        fake.remote_files.clear()
        r = client.post("/api/profiles/shop1/products-pull", json={})
        d = r.get_json()
        check("E1 missing remote file → 404-style error", r.status_code == 400
              and "پیدا نشد" in d.get("error", ""), str(d))
        # Wrong content in the file.
        data = core.load_data()
        path = data["profiles"]["shop1"]["products_push"]["path"]
        fake.remote_files[path] = b'{"kind": "something-else", "products": []}'
        r = client.post("/api/profiles/shop1/products-pull", json={})
        d = r.get_json()
        check("E2 non-products file rejected", r.status_code == 400
              and "Scraper4" in d.get("error", ""))
        fake.remote_files[path] = b"not json at all"
        r = client.post("/api/profiles/shop1/products-pull", json={})
        check("E3 invalid json rejected", r.status_code == 400)
        fake.remote_files.clear()
        fake.fail_statuses = True
        r = client.post("/api/profiles/shop1/products-pull", json={})
        d = r.get_json()
        check("E4 API failure surfaces a token/permission error",
              r.status_code == 400 and "توکن" in d.get("error", ""), str(d))
        fake.fail_statuses = False

        print("== F: path safety + repo resolution ==")
        make_profile("../evil/../pid", **{"github_branch": "main"})
        r = client.post("/api/profiles/../evil/../pid/products-push", json={})
        # Flask normalizes the URL before routing; hit the raw id directly.
        d = None
        try:
            d = push_direct(core, "../evil/../pid")
        except Exception as exc:  # noqa: BLE001
            d = {"error": str(exc)}
        pushed_path = d.get("path", "") if isinstance(d, dict) else ""
        check("F1 traversal id slugified (no .. or /)",
              ".." not in pushed_path and "/" not in pushed_path.split("/")[-1]
              and pushed_path.startswith("scraper4-products/"), pushed_path)
        make_profile("ایمالز-کفش زنانه")
        d = push_direct(core, "ایمالز-کفش زنانه")
        check("F2 Persian id keeps a readable slug",
              "کفش" in d.get("path", "") or "ایمالز" in d.get("path", ""),
              d.get("path", ""))
        check("F3 digest appended for uniqueness",
              len(d.get("path", "").rsplit("-", 1)[-1].split(".")[0]) == 8)
        data = core.load_data()
        data["deploy"] = {"repo": "fazilatma/new"}
        core.save_data(data)
        d = push_direct(core, "shop1")
        check("F4 repo resolved from deploy config",
              any(c[1].startswith("https://api.github.com/repos/fazilatma/new/")
                  for c in fake.calls))
        r = client.post("/api/profiles/shop1/products-push",
                        json={"repo": "not a repo"})
        d = r.get_json()
        check("F5 invalid repo rejected", r.status_code == 400
              and "Repo" in d.get("error", ""), str(d))

        print("== G: profile mapping (githubBranch round-trip) ==")
        r = client.post("/api/profiles", json={
            "id": "mapped", "name": "mapped", "url": "https://example.com/m",
            "githubBranch": "arena/01a0c9ea-new", "enabled": True})
        check("G1 profile saved", r.status_code == 200, r.get_data(as_text=True)[:150])
        prof = core.load_data()["profiles"].get("mapped")
        check("G2 github_branch stored", prof.get("github_branch") == "arena/01a0c9ea-new",
              str(prof.get("github_branch")))
        r = client.get("/api/profiles")
        rows = r.get_json().get("profiles") or r.get_json().get("items") or []
        mapped = next((p for p in rows if p.get("id") == "mapped"), None)
        check("G3 githubBranch exposed to the dashboard",
              mapped and mapped.get("githubBranch") == "arena/01a0c9ea-new",
              json.dumps(mapped or {}, ensure_ascii=False)[:200])
        check("G4 productsPush/productsPull exposed",
              mapped is not None and "productsPush" in mapped and "productsPull" in mapped)
    finally:
        core.outbound_request = real_outbound
        core.start_profile_dispatch = real_dispatch
        os.environ.pop("GH_BACKUP_TOKEN", None)

    print("== H: dashboard wiring ==")
    html = open(os.path.join(ROOT, "ui", "dashboard.html"), encoding="utf-8").read()
    js = open(os.path.join(ROOT, "ui", "dashboard.js"), encoding="utf-8").read()
    px = open(os.path.join(ROOT, "parity_ext.py"), encoding="utf-8").read()
    check("settings card present", 'id="githubBranch"' in html
          and 'id="ghProductsPush"' in html and 'id="ghProductsPull"' in html
          and 'id="ghPullTarget"' in html)
    check("push route wired", "/api/profiles/'+encodeURIComponent(id)+'/products-push?live=1" in js
          or "products-push?live=1" in js)
    check("pull route wired", "products-pull" in js)
    check("branch options loaded on demand", "loadGithubBranchOptions" in js)
    check("profile form carries githubBranch",
          "githubBranch:$('githubBranch')?.value||''" in js
          and "'githubBranch'" in js)
    check("status text renders push/pull history", "githubProductsStatusText" in js)
    check("bindings registered",
          "$('ghProductsPush')?.addEventListener('click',()=>pushProductsToGithub());" in js)
    check("parity registers both endpoints",
          '@app.post("/api/profiles/<path:pid>/products-push")' in px
          and '@app.post("/api/profiles/<path:pid>/products-pull")' in px)
    check("raw media type used for large files",
          "application/vnd.github.raw" in px)
    check("atomic commit chain implemented",
          "git/blobs" in px and "git/trees" in px and "git/refs/heads/" in px)

    if os.path.exists("/usr/bin/node") or os.path.exists("/usr/local/bin/node"):
        import subprocess
        proc = subprocess.run(["node", "--check", os.path.join(ROOT, "ui", "dashboard.js")],
                              capture_output=True, text=True, timeout=60)
        check("dashboard.js passes node --check", proc.returncode == 0,
              proc.stderr[:200])
    else:
        print("  (node not available — syntax check skipped)")

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): " + ", ".join(FAILURES))
        return 1
    print("All checks passed.")
    return 0


def push_direct(core, pid: str) -> dict:
    """Call the live push with the token set (helper for path-safety tests)."""
    os.environ["GH_BACKUP_TOKEN"] = "test-token-248"
    client = core.app.test_client()
    try:
        r = client.post(f"/api/profiles/{pid}/products-push", json={"branch": "main"})
        return r.get_json()
    finally:
        os.environ.pop("GH_BACKUP_TOKEN", None)


if __name__ == "__main__":
    raise SystemExit(main())
