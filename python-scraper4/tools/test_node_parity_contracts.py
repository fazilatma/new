#!/usr/bin/env python3
"""Offline contract tests for the Python ↔ latest Node compatibility layer.

No real shop, AI provider, push service or GitHub repository is modified. Every
external side effect is monkeypatched at the core adapter boundary while Flask
request/response shapes and persisted state are exercised end to end.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import secrets
import shutil
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
TMP = Path(tempfile.mkdtemp(prefix="scraper4-contracts-"))
os.environ.update({
    "SCRAPER_DATA_FILE": str(TMP / "data.json"),
    "SCRAPER_LIVE_DIR": str(TMP / "tasks"),
    "SCRAPER_GIT_AUTO_UPDATE": "0",
    "SCRAPER_AUTO_UPDATE": "0",
    "SCRAPER_DISABLE_SCHEDULERS": "1",
})
sys.path.insert(0, str(ROOT))
import scraper4 as core  # noqa: E402


class FakeResponse:
    def __init__(self, payload=None, status=200, text=""):
        self._payload = payload
        self.status_code = status
        self.ok = 200 <= status < 300
        self.text = text or (json.dumps(payload) if payload is not None else "")
        self.headers = {}

    def json(self):
        return self._payload


class NodeParityContracts(unittest.TestCase):
    maxDiff = 3000

    def setUp(self):
        core.save_data(core.default_data())
        with core.LIVE_TASK_LOCK:
            core.LIVE_TASKS.clear()
        shutil.rmtree(core.LIVE_TASK_DIR, ignore_errors=True)
        os.makedirs(core.LIVE_TASK_DIR, exist_ok=True)
        self.client = core.app.test_client()

    def data(self):
        return core.load_data()

    def save(self, value):
        core.save_data(value)

    def assert_ok(self, response, status=200):
        self.assertEqual(response.status_code, status, response.get_data(as_text=True)[:1000])
        payload = response.get_json()
        self.assertIsInstance(payload, dict)
        self.assertTrue(payload.get("ok"), payload)
        return payload

    def test_manifest_routes_are_exactly_covered(self):
        manifest = json.loads((ROOT / "parity-manifest.json").read_text(encoding="utf-8"))

        def norm(path):
            path = re.sub(r"<(?:path:|int:|float:|uuid:|string:)?[^>]+>", "<>", path)
            return re.sub(r"/+", "/", path).rstrip("/") or "/"

        actual = {(method, norm(rule.rule)) for rule in core.app.url_map.iter_rules()
                  for method in rule.methods - {"HEAD", "OPTIONS"}}
        expected = {(row["method"], row["path"]) for row in manifest["requiredRoutes"]}
        self.assertEqual(expected - actual, set())
        exact = {}
        for rule in core.app.url_map.iter_rules():
            for method in rule.methods - {"HEAD", "OPTIONS"}:
                key = (method, rule.rule)
                self.assertNotIn(key, exact, f"duplicate Flask rule {key}")
                exact[key] = rule.endpoint

    def test_settings_and_connection_vault(self):
        data = self.data()
        data["ui_settings"] = {"appearance": {"theme": "dark", "future": 7},
                               "unknownGroup": {"keep": True}}
        data["network"]["futureTransport"] = "keep-me"
        data["woocommerce"].update(url="https://shop.example", consumer_key="ck-real",
                                   consumer_secret="cs-real")
        data["node_connections"] = {"future": {"nested": 9},
                                    "woo": {"secret": "cs-real", "unknown": "keep"}}
        self.save(data)
        result = self.assert_ok(self.client.post("/api/settings", json={"settings": {
            "appearance": {"fontScale": 1.2}, "network": {"timeout": 33}}}))
        self.assertEqual(result["settings"]["appearance"]["future"], 7)
        persisted = self.data()
        self.assertEqual(persisted["ui_settings"]["unknownGroup"], {"keep": True})
        self.assertEqual(persisted["network"]["futureTransport"], "keep-me")
        self.assertEqual(persisted["network"]["timeout"], 33)

        vault = self.assert_ok(self.client.get("/api/connections"))["connections"]
        self.assertEqual(vault["woo"]["key"], "ck-real")
        self.assertEqual(vault["woo"]["secret"], "cs-real")
        vault["woo"]["secret"] = "••••••••"
        vault["woo"]["key"] = "********stored"
        vault["future"]["new"] = 10
        self.assert_ok(self.client.post("/api/connections", json={"connections": vault}))
        persisted = self.data()
        self.assertEqual(persisted["woocommerce"]["consumer_key"], "ck-real")
        self.assertEqual(persisted["woocommerce"]["consumer_secret"], "cs-real")
        self.assertEqual(persisted["node_connections"]["future"], {"nested": 9, "new": 10})
        status = self.assert_ok(self.client.get("/api/status"))
        self.assertIsInstance(status["connections"]["woo"], bool)
        self.assertNotIn("consumer_secret", json.dumps(status))

    def test_backup_restore_round_trip(self):
        data = self.data()
        data["profiles"]["p1"] = {"name": "One", "url": "https://example.com",
                                    "saved_products": [{"source_key": "a", "title": "A", "price": 12}]}
        data["future_state"] = {"preserve": [1, 2, 3]}
        self.save(data)
        response = self.client.get("/api/backup")
        self.assertEqual(response.status_code, 200)
        backup = response.get_json()
        self.assertEqual(backup["app"], "scraper4-backup")
        changed = self.data()
        changed["profiles"] = {}
        changed.pop("future_state", None)
        self.save(changed)
        restored = self.assert_ok(self.client.post("/api/restore", json=backup))
        self.assertEqual(restored["result"]["mode"], "replace-native")
        self.assertEqual(self.data()["profiles"]["p1"]["saved_products"][0]["title"], "A")
        self.assertEqual(self.data()["future_state"], {"preserve": [1, 2, 3]})
        legacy = self.assert_ok(self.client.get("/legacy/backup"))
        self.assertIn("data", legacy)

    def test_profile_import_and_product_sync(self):
        self.assert_ok(self.client.post("/api/profiles", json={
            "id": "p1", "name": "One", "url": "https://example.com"}))
        imported = self.assert_ok(self.client.post("/api/profiles/p1/import", json={"rows": [
            {"sourceKey": "sku/a", "title": "A", "price": "12,500", "sku": "A-1"},
            {"sourceKey": "bad", "title": "No price", "price": ""},
        ]}))
        self.assertEqual(imported["imported"], 1)
        self.assertEqual(imported["skipped"], 1)
        with patch.object(core, "woo_send_one", return_value={"id": 91}) as send:
            result = self.assert_ok(self.client.post("/api/products/p1/sku%2Fa/sync/woo"))
        self.assertEqual(result["result"]["id"], 91)
        send.assert_called_once()

    def test_destination_and_duplicate_contracts(self):
        data = self.data()
        data["woocommerce"].update(url="https://shop.example", consumer_key="ck",
                                   consumer_secret="cs")
        self.save(data)
        rows = [
            {"id": 1, "name": "کالا (کد ۱)", "regular_price": "100", "status": "publish", "sku": "a"},
            {"id": 2, "name": "کالا (کد ۲)", "regular_price": "200", "status": "publish", "sku": "b"},
            {"id": 3, "name": "تک", "regular_price": "300", "status": "draft", "sku": "c"},
        ]
        writes = []

        def woo(method, endpoint, payload=None):
            writes.append((method, endpoint, payload))
            if method == "GET" and endpoint.startswith("products/categories"):
                return FakeResponse([{"id": 4, "name": "Cat", "parent": 0, "count": 2}])
            if method == "GET" and endpoint.startswith("products/"):
                item = next(row for row in rows if str(row["id"]) == endpoint.split("/")[1])
                return FakeResponse(item)
            return FakeResponse({"id": int(re.search(r"\d+", endpoint).group()),
                                 "name": (payload or {}).get("name", "Updated"),
                                 "regular_price": (payload or {}).get("regular_price", "100"),
                                 "status": "publish"})

        with patch.object(core, "destination_remote_rows", return_value=rows), \
                patch.object(core, "woo_request", side_effect=woo):
            listing = self.assert_ok(self.client.get("/api/destination/woo/products?per_page=2&page=1&counts=1"))
            self.assertEqual(listing["total"], 3)
            self.assertEqual(listing["totalPages"], 2)
            self.assertIn("shops", listing)
            categories = self.assert_ok(self.client.get("/api/categories/woo"))
            self.assertEqual(categories["items"][0]["id"], 4)
            preview = self.assert_ok(self.client.post("/api/destination/woo/1/update", json={"title": "New"}))
            self.assertTrue(preview["dryRun"])
            self.assertFalse(any(method == "PUT" for method, _, _ in writes))
            applied = self.assert_ok(self.client.post("/api/destination/woo/1/update", json={
                "title": "New", "confirm": "APPLY"}))
            self.assertFalse(applied["dryRun"])
            dupes = self.assert_ok(self.client.post("/api/maintenance/duplicates", json={
                "keep": "expensive", "limit": 20}))
            self.assertEqual(dupes["planned"], 1)
            applied_dupes = self.assert_ok(self.client.post("/api/maintenance/duplicates", json={
                "keep": "expensive", "limit": 20, "confirm": "APPLY"}))
            self.assertEqual(applied_dupes["deleted"], 1)
        self.assertTrue(any(method == "PUT" for method, _, _ in writes))
        self.assertTrue(any(method == "DELETE" for method, _, _ in writes))

    def test_reconciliation_photo_and_persistent_dedup_apply(self):
        data = self.data()
        data["woocommerce"].update(url="https://shop.example", consumer_key="ck",
                                   consumer_secret="cs")
        data["profiles"]["p1"] = {"name": "One", "saved_products": [
            {"source_key": "a", "title": "کالا (کد:1)", "price": "100",
             "image": "https://cdn.example/a.jpg", "remote_woo_id": 1},
            {"source_key": "b", "title": "کالا (کد:2)", "price": "200",
             "image": "https://cdn.example/b.jpg"},
        ]}
        self.save(data)
        remote = [
            {"id": 1, "name": "کالا (کد:1)", "regular_price": "90", "status": "publish",
             "images": [], "sku": ""},
            {"id": 3, "name": "اضافی (کد:9)", "regular_price": "300", "status": "publish",
             "images": [{"src": "https://cdn.example/x.jpg"}], "sku": "x"},
        ]
        writes = []

        def woo(method, endpoint, payload=None):
            writes.append((method, endpoint, payload))
            return FakeResponse({"id": int(re.search(r"\d+", endpoint).group()) if re.search(r"\d+", endpoint) else 99})

        with patch.object(core, "destination_remote_rows", return_value=remote), \
                patch.object(core, "woo_request", side_effect=woo), \
                patch.object(core, "woo_send_one", return_value={"id": 22}) as create:
            preview = self.assert_ok(self.client.post("/api/maintenance/recon-unified", json={
                "profileId": "p1", "limit": 20}))
            self.assertTrue(preview["dryRun"])
            self.assertEqual(preview["priceDiff"], 1)
            self.assertEqual(preview["missing"], 1)
            self.assertEqual(preview["extra"], 1)
            self.assertEqual(preview["planned"], 2)
            applied = self.assert_ok(self.client.post("/api/maintenance/recon-unified/apply", json={
                "profileId": "p1", "limit": 20, "confirm": "APPLY"}))
            self.assertEqual(applied["changed"], 2)
            create.assert_called_once()
            photo = self.assert_ok(self.client.post("/api/maintenance/photo-fix", json={
                "profileId": "p1", "confirm": "APPLY"}))
            self.assertEqual(photo["changed"], 1)
        self.assertTrue(any(method == "PUT" and endpoint == "products/1" and
                            "regular_price" in (payload or {}) for method, endpoint, payload in writes))
        self.assertTrue(any(method == "PUT" and endpoint == "products/1" and
                            "images" in (payload or {}) for method, endpoint, payload in writes))
        mapped = self.data()["profiles"]["p1"]["saved_products"][1]["destination_maps"]
        self.assertEqual(mapped["woo:default"]["id"], 22)

        duplicate_rows = [
            {"id": 10, "name": "یکی (کد:1)", "regular_price": "100", "status": "publish"},
            {"id": 11, "name": "یکی (کد:2)", "regular_price": "200", "status": "publish"},
        ]
        dedup_writes = []

        def dedup_woo(method, endpoint, payload=None):
            dedup_writes.append((method, endpoint, payload))
            return FakeResponse({"id": 10})

        with patch.object(core, "destination_remote_rows", return_value=duplicate_rows), \
                patch.object(core, "woo_request", side_effect=dedup_woo):
            started = self.assert_ok(self.client.post("/api/destination/woo/dedup-runs", json={
                "apply": True, "keep": "expensive", "suffixFormats": "(کد:x)"}), status=202)
            self.assertEqual(started["run"]["status"], "queued")
            deadline = time.time() + 3
            run = None
            while time.time() < deadline:
                run = self.assert_ok(self.client.get("/api/destination/woo/dedup-runs/current"))["run"]
                if run and run["status"] in {"done", "failed"}:
                    break
                time.sleep(.02)
        self.assertEqual(run["status"], "done", run)
        self.assertEqual(run["duplicates"], 1)
        self.assertEqual(run["removed"], 1)
        self.assertTrue(any(method == "DELETE" and "products/10" in endpoint
                            for method, endpoint, _ in dedup_writes))

    def test_connection_diagnostics_make_authenticated_probes(self):
        data = self.data()
        data["woocommerce"].update(url="https://example.com", consumer_key="ck-secret",
                                   consumer_secret="cs-secret")
        self.save(data)
        response = FakeResponse([{"id": 7, "name": "Sample", "status": "publish"}])
        response.headers = {"content-type": "application/json"}
        with patch.object(core, "outbound_request", return_value=response) as probe:
            result = self.client.post("/api/test-connection/woo", json={}).get_json()
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["summary"]["sampleProductId"], 7)
        self.assertNotIn("ck-secret", json.dumps(result))
        self.assertNotIn("cs-secret", json.dumps(result))
        self.assertEqual(probe.call_args.kwargs["auth"], ("ck-secret", "cs-secret"))

    def test_watchdog_recovers_stale_task(self):
        data = self.data()
        data["profiles"]["p1"] = {"name": "One", "url": "https://example.com",
                                    "saved_products": []}
        self.save(data)
        stale = core.live_task_create("scrape", "Old", private=False)
        stale.update(status="running", profile="p1", updated_at=int(time.time()) - 600,
                     pid=99999999)
        with core.LIVE_TASK_LOCK:
            core.LIVE_TASKS[stale["id"]] = stale
        core.live_task_disk_write(stale)
        with patch.object(core, "scrape_live_worker", return_value=None):
            result = self.assert_ok(self.client.post("/api/queue-watchdog", json={
                "minutes": 2, "autoContinue": True}))
            deadline = time.time() + 2
            while result["recovered"] != 1 and time.time() < deadline:
                time.sleep(.01)
        self.assertEqual(result["reaped"], 1)
        self.assertEqual(result["recovered"], 1)
        self.assertEqual(core.live_task_read(stale["id"])["status"], "interrupted")

    def test_dns_and_redirect_ssrf_guard(self):
        private_answer = [(core.socket.AF_INET, core.socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))]
        with patch.object(core.socket, "getaddrinfo", return_value=private_answer):
            with self.assertRaisesRegex(ValueError, "خصوصی"):
                core.public_http_url("https://attacker.example/path")

        public_answer = [(core.socket.AF_INET, core.socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]
        redirect = FakeResponse(None, status=302)
        redirect.headers = {"Location": "http://127.0.0.1/admin"}
        with patch.object(core.socket, "getaddrinfo", return_value=public_answer), \
                patch.object(core.requests, "request", return_value=redirect) as request_mock:
            with self.assertRaisesRegex(ValueError, "خصوصی"):
                core.outbound_request("GET", "https://safe.example/start")
        request_mock.assert_called_once()
        self.assertFalse(request_mock.call_args.kwargs["allow_redirects"])

    def test_visual_ticket_is_secure_and_consume_once(self):
        class Page:
            url = "https://example.com/shop/"
            text = """<html><head><script>alert(1)</script><meta http-equiv='refresh' content='0'></head>
            <body onload='bad()'><form><input></form><div class='card'><a href='/p/1' onclick='x()'>
            <img src='/one.jpg' onerror='x()'><span class='title'>One</span></a></div>
            <div class='card'><span class='title'>Two</span></div><iframe src='https://bad.test'></iframe></body></html>"""

        with patch.object(core, "picker_http_fetch", return_value=Page()):
            ticket = self.assert_ok(self.client.post("/api/visual-ticket", json={
                "url": "https://example.com", "engine": "html"}))
            self.assertRegex(ticket["channel"], r"^[a-f0-9]{48}$")
            response = self.client.get(f"/visual?ticket={ticket['ticket']}&context=list")
        self.assertEqual(response.status_code, 200)
        html = response.get_data(as_text=True)
        self.assertNotIn("alert(1)", html)
        self.assertNotIn("<iframe", html)
        self.assertNotIn("<form", html)
        self.assertNotIn("onload=", html)
        self.assertIn('data-s4-href="https://example.com/p/1"', html)
        self.assertIn('src="https://example.com/one.jpg"', html)
        self.assertIn(ticket["channel"], html)
        csp = response.headers["content-security-policy"]
        self.assertIn("sandbox allow-scripts", csp)
        script = core.BeautifulSoup(html, "html.parser").find_all("script")[-1].string
        digest = base64.b64encode(hashlib.sha256(script.encode()).digest()).decode()
        self.assertIn(digest, csp)
        self.assertEqual(self.client.get(f"/visual?ticket={ticket['ticket']}").status_code, 400)

    def test_pwa_and_encrypted_push_subscription(self):
        self.assertEqual(self.client.get("/manifest.webmanifest").status_code, 200)
        self.assertIn("service-worker-allowed", {k.lower(): v for k, v in self.client.get("/sw.js").headers})
        icon_response = self.client.get("/app-icon-192.png")
        self.assertEqual(icon_response.status_code, 200)
        icon_response.close()
        os.environ.update(WEB_PUSH_PUBLIC_KEY="A" * 87, WEB_PUSH_PRIVATE_KEY="B" * 43,
                          WEB_PUSH_SUBJECT="mailto:test@example.com")
        config = self.assert_ok(self.client.get("/api/web-push/config"))
        self.assertTrue(config["configured"])
        encoded = lambda value: base64.urlsafe_b64encode(value).decode().rstrip("=")
        endpoint = "https://fcm.googleapis.com/fcm/send/capability-secret"
        subscription = {"endpoint": endpoint, "keys": {
            "p256dh": encoded(b"\x04" + secrets.token_bytes(64)),
            "auth": encoded(secrets.token_bytes(16)),
        }}
        saved = self.assert_ok(self.client.post("/api/web-push/subscribe", json=subscription))
        stored = json.dumps(self.data().get("web_push_subscriptions"))
        self.assertNotIn(endpoint, stored)
        self.assertRegex(saved["id"], r"^[a-f0-9]{64}$")
        self.assert_ok(self.client.post("/api/web-push/unsubscribe", json={"id": saved["id"]}))

    def test_persistent_category_run(self):
        data = self.data()
        data["basalam"].update(token="token", vendor_id=77, shop_name="Shop")
        data["ai_master"] = "provider::model"
        self.save(data)
        products = [{"id": 12, "title": "عطر تست", "primary_price": 1000,
                     "status": 3567, "category_id": 1}]
        calls = []

        def basalam(method, path, **kwargs):
            calls.append((method, path, kwargs))
            return {"data": {"id": 12, "title": "عطر تست", "status": 3567}}

        with patch.object(core, "destination_remote_rows", return_value=products), \
                patch.object(core, "ai_load_category_rows", return_value=[
                    {"id": 1, "name": "قدیمی", "path": "قدیمی"},
                    {"id": 9, "name": "عطر و ادکلن", "path": "زیبایی > عطر و ادکلن"},
                ]), patch.object(core, "ai_chat", return_value='{"category":"عطر و ادکلن"}'), \
                patch.object(core, "basalam_api_request", side_effect=basalam):
            started = self.assert_ok(self.client.post(
                "/api/destination/basalam/category-runs", json={"mode": "master"}), status=202)
            self.assertEqual(started["run"]["status"], "queued")
            deadline = time.time() + 5
            run = None
            while time.time() < deadline:
                run = self.assert_ok(self.client.get(
                    "/api/destination/basalam/category-runs/current"))["run"]
                if run and run["status"] in {"done", "failed"}:
                    break
                time.sleep(.03)
        self.assertEqual(run["status"], "done", run)
        self.assertEqual(run["changed"], 1)
        self.assertTrue(any(call[0] == "PATCH" and call[2]["json_data"]["category_id"] == 9
                            for call in calls))
        self.assertEqual(self.data()["category_run"]["status"], "done")

    def test_ai_call_and_batch(self):
        data = self.data()
        data["ai_providers"] = {"p": {"id": "p", "name": "Provider", "enabled": True,
                                                   "url": "https://ai.example/v1", "apiKeys": [{"key": "x"}],
                                                   "models": [{"id": "m", "enabled": True}]}}
        data["ai"].update(provider="p", model="m", endpoint="https://ai.example/v1", api_key="x")
        self.save(data)
        with patch.object(core, "ai_chat", return_value="SCRAPER4_OK"):
            direct = self.assert_ok(self.client.post("/api/ai/call", json={
                "provider": "p", "model": "m", "prompt": "hello"}))
            batch = self.assert_ok(self.client.post("/api/ai/test-all", json={"prompt": "hello"}))
        self.assertEqual(direct["text"], "SCRAPER4_OK")
        self.assertEqual(batch["total"], 1)
        self.assertEqual(batch["results"][0]["key"], "p::m")

    def test_ai_reset_does_not_resurrect_inflight_run(self):
        data = self.data()
        data["ai_providers"] = {"p": {"id": "p", "name": "Provider", "enabled": True,
                                                   "url": "https://ai.example/v1", "apiKeys": [{"key": "x"}],
                                                   "models": [{"id": "m", "enabled": True}]}}
        self.save(data)
        entered, release, returned = threading.Event(), threading.Event(), threading.Event()

        def slow_ai(*_args, **_kwargs):
            entered.set()
            release.wait(2)
            returned.set()
            return "SCRAPER4_OK"

        with patch.object(core, "ai_chat", side_effect=slow_ai):
            started = self.assert_ok(self.client.post("/api/ai/test-runs", json={
                "prompt": "hello"}), status=202)
            self.assertTrue(started["run"]["id"])
            self.assertTrue(entered.wait(2), "AI worker never entered provider call")
            self.assert_ok(self.client.post("/api/ai/test-runs/reset"))
            release.set()
            self.assertTrue(returned.wait(2))
            time.sleep(.05)  # let the worker hit the cancellation tombstone
        self.assertIsNone(self.assert_ok(self.client.get("/api/ai/test-runs/current"))["run"])
        self.assertNotIn("ai_test_run", self.data())

    def test_atomic_branch_push_contract(self):
        os.environ["GH_BACKUP_TOKEN"] = "test-token"
        calls = []
        blobs = []

        def github(method, url, **kwargs):
            calls.append((method, url, kwargs.get("json")))
            if method == "GET" and "/git/ref/heads/" in url:
                return FakeResponse({"object": {"sha": "parent"}})
            if method == "GET" and "/git/commits/parent" in url:
                return FakeResponse({"tree": {"sha": "base-tree"}})
            if method == "POST" and url.endswith("/git/blobs"):
                sha = f"blob-{len(blobs)}"
                blobs.append(kwargs["json"])
                return FakeResponse({"sha": sha})
            if method == "POST" and url.endswith("/git/trees"):
                return FakeResponse({"sha": "new-tree"})
            if method == "POST" and url.endswith("/git/commits"):
                return FakeResponse({"sha": "new-commit"})
            if method == "PATCH" and "/git/refs/heads/" in url:
                return FakeResponse({"object": {"sha": "new-commit"}})
            raise AssertionError((method, url))

        bundle = self.client.get("/api/settings-export").get_json()
        with patch.object(core, "outbound_request", side_effect=github):
            pushed = self.assert_ok(self.client.post("/api/branch-push", json={
                "repo": "owner/repo", "branch": "arena/test", "path": "backups",
                "name": "backup.json", "bundle": bundle}))
        self.assertEqual(pushed["sha"], "new-commit")
        self.assertEqual(pushed["database"], "skipped:not-sqlite")
        tree_call = next(payload for method, url, payload in calls
                         if method == "POST" and url.endswith("/git/trees"))
        paths = {row["path"] for row in tree_call["tree"]}
        self.assertIn("backups/backup/manifest.json", paths)
        self.assertIn("backups/backup/profiles.json", paths)
        commit_call = next(payload for method, url, payload in calls
                           if method == "POST" and url.endswith("/git/commits"))
        self.assertEqual(commit_call["parents"], ["parent"])
        ref_call = next(payload for method, url, payload in calls if method == "PATCH")
        self.assertFalse(ref_call["force"])


if __name__ == "__main__":
    try:
        unittest.main(verbosity=2)
    finally:
        shutil.rmtree(TMP, ignore_errors=True)
