import json
import unittest
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

    def test_live_smoke_requires_pinned_source_and_gated_root(self):
        payload = {
            "source": {"version": pa_helper.SOURCE_VERSION, "branch": pa_helper.SOURCE_BRANCH},
            "deployable": False,
        }

        def fake_request(url, timeout=25):
            if url.endswith("/api/port-status"):
                return 200, payload
            return 503, None

        with patch.object(pa_helper, "request_status", side_effect=fake_request):
            result = pa_helper.live_smoke("example.invalid", 10)
        self.assertTrue(result["passed"])
        self.assertTrue(result["root_503_is_expected"])


if __name__ == "__main__":
    unittest.main()
