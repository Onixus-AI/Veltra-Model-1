import unittest

from supabase_headers import service_headers


class SupabaseHeadersTests(unittest.TestCase):
    def test_modern_secret_key_is_not_sent_as_a_bearer_token(self):
        self.assertEqual(service_headers("sb_secret_test"), {"apikey": "sb_secret_test"})

    def test_legacy_service_role_jwt_remains_supported(self):
        key = "header.payload.signature"
        self.assertEqual(service_headers(key), {"apikey": key, "Authorization": "Bearer " + key})
