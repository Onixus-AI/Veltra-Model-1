import unittest
from unittest.mock import AsyncMock
from model_routing import routing_options, image_provider

class CostPolicyTests(unittest.TestCase):
    def test_no_override_or_fallback_can_escape_allowlist(self):
        for model in ['openai/gpt-5', 'anthropic/claude-opus', 'google/gemma:free', 'x-ai/grok',
                      'openrouter/free', 'openrouter/auto', '~openai/gpt-luna-latest',
                      'nvidia/nemotron-3-ultra-550b-a55b', 'unknown/model']:
            with self.subTest(model=model), self.assertRaises(ValueError):
                routing_options(model)
            with self.subTest(fallback=model), self.assertRaises(ValueError):
                routing_options('inclusionai/ling-3.0-flash', [model])
    def test_free_first_and_price_caps_also_apply_to_tools(self):
        options = routing_options('xiaomi/mimo-v2.6-flash', ['nvidia/nemotron-3.5-lightning:free'], tools=True)
        self.assertTrue(options['models'][0].endswith(':free'))
        self.assertTrue(options['provider']['require_parameters'])
        self.assertEqual(options['provider']['max_price'], {'prompt': .5, 'completion': 1})

class ImagePolicyTests(unittest.IsolatedAsyncioTestCase):
    async def test_live_pricing_is_checked_and_only_cheap_endpoint_is_allowed(self):
        class Response:
            def raise_for_status(self): pass
            def json(self): return {'endpoints': [
                {'provider_slug': 'recraft', 'pricing': [{'billable': 'output_image', 'unit': 'image', 'cost_usd': .007}]},
                {'provider_slug': 'expensive', 'pricing': [{'billable': 'output_image', 'unit': 'image', 'cost_usd': .03}]}]}
        client = AsyncMock(); client.get.return_value = Response()
        self.assertEqual((await image_provider(client, 'recraft/recraft-v4.1-flash'))['only'], ['recraft'])
        client.get.assert_awaited_once()
    async def test_unknown_megapixel_and_price_increase_fail_closed(self):
        class Response:
            def raise_for_status(self): pass
            def json(self): return {'endpoints': [{'provider_slug': 'recraft', 'pricing': self.pricing}]}
        response = Response(); client = AsyncMock(); client.get.return_value = response
        for pricing in [[], [{'billable': 'output_image', 'unit': 'image', 'cost_usd': .021}],
                        [{'billable': 'output_image', 'unit': 'megapixel', 'cost_usd': .001}],
                        [{'billable': 'output_image', 'unit': 'image', 'cost_usd': 'NaN'}]]:
            response.pricing = pricing
            with self.assertRaises(ValueError): await image_provider(client, 'recraft/recraft-v4.1-flash')
        with self.assertRaises(ValueError): await image_provider(client, 'google/image-model')
