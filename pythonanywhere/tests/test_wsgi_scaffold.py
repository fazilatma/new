import unittest

from application import app


class WsgiScaffoldTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_port_status_is_pinned_to_latest_alias(self):
        response = self.client.get("/api/port-status")
        self.assertEqual(200, response.status_code)
        data = response.get_json()
        self.assertEqual("10.599", data["source"]["version"])
        self.assertEqual("arena/01a0ebf7-new", data["source"]["branch"])
        self.assertFalse(data["deployable"])

    def test_root_is_gated_until_full_parity(self):
        response = self.client.get("/")
        self.assertEqual(503, response.status_code)
        self.assertFalse(response.get_json()["deployable"])

    def test_pagination_preview_uses_compatibility_builder(self):
        response = self.client.get(
            "/api/pagination/preview?url=https://t.test/shop~page~1"
            "&base_url=https://t.test/shop~page~1&type=path_pattern"
            "&value=~page~%7Bpage%7D&from=2&count=2"
        )
        self.assertEqual(200, response.status_code)
        self.assertEqual(
            ["https://t.test/shop~page~2", "https://t.test/shop~page~3"],
            response.get_json()["urls"],
        )

    def test_unknown_feature_is_not_silently_simulated(self):
        response = self.client.get("/bsl_queue_add")
        self.assertEqual(501, response.status_code)
        self.assertEqual("route_not_ported", response.get_json()["error"])


if __name__ == "__main__":
    unittest.main()
