import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

import pa_helper


class FakeResponse:
    def __init__(self, status, body):
        self.status = status
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _limit):
        return self.body


class PythonAnywhereHelperTests(unittest.TestCase):
    def test_request_status_parses_json(self):
        with patch.object(pa_helper.urllib.request, "urlopen", return_value=FakeResponse(200, b'{"ok":true}')):
            self.assertEqual(pa_helper.request_status("https://example.invalid/status"), (200, {"ok": True}))

    def test_request_status_does_not_include_error_page(self):
        failure = HTTPError("https://example.invalid/", 503, "unavailable", {}, None)
        with patch.object(pa_helper.urllib.request, "urlopen", side_effect=failure):
            self.assertEqual(pa_helper.request_status("https://example.invalid/"), (503, None))

    def test_cleanup_preserves_checkout_data_and_reports(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            home = root / "home"
            repo = root / "new"
            pip_cache = home / ".cache" / "pip"
            bytecode = repo / "pythonanywhere" / "module" / "__pycache__"
            reports = repo / "pythonanywhere" / "reports"
            pip_cache.mkdir(parents=True)
            bytecode.mkdir(parents=True)
            reports.mkdir(parents=True)
            (pip_cache / "wheel.whl").write_text("cache")
            (bytecode / "module.pyc").write_text("cache")
            (reports / "result.json").write_text("keep")
            with patch.object(pa_helper.Path, "home", return_value=home):
                pa_helper.cleanup_generated_space(repo, home / ".virtualenvs" / "scraper4-pa")
            self.assertFalse(pip_cache.exists())
            self.assertFalse(bytecode.exists())
            self.assertTrue(reports.joinpath("result.json").exists())
            self.assertTrue(repo.exists())

    def test_manual_reload_needs_no_pythonanywhere_api_token(self):
        with patch.dict(os.environ, {"PA_API_TOKEN": ""}):
            with patch("builtins.input", return_value=""):
                result = pa_helper.reload_pythonanywhere("example", "example.pythonanywhere.com")
        self.assertEqual(result, (None, "manual reload confirmed by operator"))

    def test_github_token_is_passed_via_askpass_not_remote_url(self):
        token = "test-only-secret-token"
        observed = {}

        def capture_push(args, *, cwd=None, check=True, env=None):
            observed["args"] = args
            observed["askpass"] = Path(env["GIT_ASKPASS"]).read_text(encoding="utf-8")
            observed["env_token"] = env["GITHUB_TOKEN"]
            return None

        with patch.dict(os.environ, {"GITHUB_TOKEN": token}):
            with patch.object(pa_helper, "run", side_effect=capture_push):
                pa_helper.push_with_github_token(Path(tempfile.gettempdir()))

        self.assertEqual(observed["env_token"], token)
        self.assertNotIn(token, " ".join(observed["args"]))
        self.assertNotIn(token, observed["askpass"])
        self.assertIn("$GITHUB_TOKEN", observed["askpass"])
        self.assertIn(pa_helper.REPOSITORY_HTTPS, observed["args"])

    def test_live_smoke_requires_pinned_source_and_gated_root(self):
        payload = {
            "source": {"version": pa_helper.SOURCE_VERSION, "branch": pa_helper.SOURCE_BRANCH},
            "deployable": False,
        }

        def fake_request(url, timeout=25):
            if url.endswith("/api/port-status"):
                return 200, payload
            return 200, None

        with patch.object(pa_helper, "request_status", side_effect=fake_request):
            result = pa_helper.live_smoke("example.invalid", 10)
        self.assertTrue(result["passed"])
        self.assertTrue(result["initial_ui_served"])


if __name__ == "__main__":
    unittest.main()
