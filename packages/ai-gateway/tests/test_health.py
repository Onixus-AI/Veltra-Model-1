import asyncio
import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from main import health


class GatewayHealthTests(unittest.TestCase):
    def test_health_requires_operational_configuration(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(HTTPException) as result:
                asyncio.run(health())
            self.assertEqual(result.exception.status_code, 503)

    def test_health_reports_ready_with_required_configuration(self):
        with patch.dict(os.environ, {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "test-only",
            "OPENROUTER_API_KEY": "test-only",
        }, clear=True):
            self.assertEqual(asyncio.run(health()), {"status": "ok"})
