import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from background import FreeQuota, ResponseCache, run_groups
from model_routing import POLICY, request_groups

BLOCKED = ['openai', 'anthropic', 'google-ai-studio', 'google-vertex', 'xai']


def provider_error(status, message='error'):
    cause = Exception(message)
    cause.status_code = status
    try:
        raise HTTPException(status_code=502, detail='failed') from cause
    except HTTPException as error:
        return error


def completion(model):
    return SimpleNamespace(model_dump=lambda: {'model': model, 'choices': [], 'usage': {'total_tokens': 7}})


class GroupTests(unittest.TestCase):
    def test_background_routes_split_free_without_deny_then_paid_with_deny(self):
        import main
        for alias, config in main.MODELS.items():
            if alias in POLICY['chat_routes']:
                continue
            groups = request_groups(config['model'], main.MODEL_CONFIG['chat_fallbacks'].get(alias, []), route=alias)
            free = [body for is_free, body in groups if is_free]
            paid = [body for is_free, body in groups if not is_free]
            self.assertTrue(free and paid, alias)
            self.assertTrue(groups[0][0], alias)
            for body in free:
                self.assertTrue(all(m in POLICY['free_models'] for m in body['models']))
                self.assertNotIn('data_collection', body['provider'])
            for body in paid:
                self.assertFalse(any(m in POLICY['free_models'] for m in body['models']))
                self.assertEqual(body['provider']['data_collection'], 'deny')
            for _, body in groups:
                self.assertLessEqual(len(body['models']), 3)
                self.assertEqual(body['provider']['max_price'], {'prompt': .5, 'completion': 1})
                for excluded in BLOCKED:
                    self.assertIn(excluded, body['provider']['ignore'])

    def test_chat_routes_stay_one_deny_group_with_deepseek_first(self):
        import main
        for alias in ['veltra-fast', 'veltra-logic', 'veltra-agent']:
            groups = request_groups(main.MODELS[alias]['model'], main.MODEL_CONFIG['chat_fallbacks'][alias], route=alias)
            self.assertEqual(len(groups), 1)
            free, body = groups[0]
            self.assertFalse(free)
            self.assertEqual(body['models'][0], 'deepseek/deepseek-v4-pro-0813')
            self.assertEqual(body['provider']['data_collection'], 'deny')

    def test_free_models_are_filtered_by_tool_choice_support(self):
        chain = ['thinkingmachines/inkling:free', 'poolside/laguna-s-2.1:free', 'cohere/north-mini-code:free',
                 'inclusionai/ling-3.0-flash']
        auto = request_groups('nvidia/nemotron-3.5-lightning:free', chain, tools=True, route='veltra-free')
        self.assertEqual(auto[0][1]['models'], ['nvidia/nemotron-3.5-lightning:free', 'poolside/laguna-s-2.1:free',
                                                'cohere/north-mini-code:free'])
        self.assertTrue(auto[0][1]['provider']['require_parameters'])
        required = request_groups('nvidia/nemotron-3.5-lightning:free', chain, tools=True, tool_choice='required', route='veltra-free')
        self.assertEqual(required[0][1]['models'], ['nvidia/nemotron-3.5-lightning:free', 'cohere/north-mini-code:free'])
        plain = request_groups('thinkingmachines/inkling:free', [], route='veltra-free')
        self.assertEqual(plain, [(True, plain[0][1])])
        self.assertEqual(set(POLICY['free_tool_choice']), set(POLICY['free_models']))

    def test_blocked_models_still_rejected(self):
        for model in ['openai/gpt-5', 'anthropic/claude-opus', 'google/gemma:free', 'x-ai/grok', 'openrouter/auto']:
            with self.subTest(model=model), self.assertRaises(ValueError):
                request_groups('nvidia/nemotron-3.5-lightning:free', [model], route='veltra-free')


class QuotaTests(unittest.IsolatedAsyncioTestCase):
    async def test_free_429_skips_free_until_utc_midnight_and_falls_to_paid(self):
        quota = FreeQuota()
        groups = request_groups('nvidia/nemotron-3.5-lightning:free', ['recursive/flint-v1.0:free',
                                'inclusionai/ling-3.0-flash'], route='veltra-free')
        call = AsyncMock(side_effect=[provider_error(429, 'free-models-per-day-high-balance'), completion('paid'),
                                      completion('paid-again')])
        self.assertEqual((await run_groups(groups, {}, call, quota)).model_dump()['model'], 'paid')
        self.assertFalse(quota.is_open())
        self.assertEqual((await run_groups(groups, {}, call, quota)).model_dump()['model'], 'paid-again')
        self.assertEqual([c.args[0]['extra_body']['models'][0] for c in call.call_args_list],
                         ['nvidia/nemotron-3.5-lightning:free', 'inclusionai/ling-3.0-flash', 'inclusionai/ling-3.0-flash'])
        self.assertEqual(call.call_args_list[1].args[0]['model'], 'openrouter/inclusionai/ling-3.0-flash')

    def test_quota_windows(self):
        quota = FreeQuota()
        quota.trip('free-models-per-min', now=1000)
        self.assertTrue(quota.is_open(now=1061))
        quota = FreeQuota()
        noon = 1793016000  # 2026-10-26T12:00:00Z
        quota.trip('free-models-per-day', now=noon)
        self.assertFalse(quota.is_open(now=noon + 11 * 3600))
        self.assertTrue(quota.is_open(now=noon + 12 * 3600))

    async def test_other_free_failures_fall_through_without_closing_quota(self):
        quota = FreeQuota()
        groups = request_groups('nvidia/nemotron-3.5-lightning:free', ['inclusionai/ling-3.0-flash'], route='veltra-free')
        call = AsyncMock(side_effect=[provider_error(404), completion('paid')])
        await run_groups(groups, {}, call, quota)
        self.assertTrue(quota.is_open())


class CacheTests(unittest.IsolatedAsyncioTestCase):
    async def run_request(self, model, call, settle):
        import main
        request = main.ChatCompletionRequest(model=model, messages=[{'role': 'user', 'content': 'Classify: invoice'}])
        with patch.dict(os.environ, {'OPENROUTER_API_KEY': 'test-only'}), \
             patch('main.get_authenticated_principal', AsyncMock(return_value={'organization_id': 'org'})), \
             patch('main.get_wallet', AsyncMock(return_value={'credits_remaining': 10000})), \
             patch('main.call_model', call), patch('main.settle_credits', settle), \
             patch('main.BACKGROUND_CACHE', self.cache), patch('main.FREE_QUOTA', FreeQuota()):
            return await main.create_chat_completion(request, None)

    async def test_identical_background_requests_call_and_charge_once(self):
        self.cache = ResponseCache()
        call, settle = AsyncMock(return_value=completion('nvidia/nemotron-3.5-lightning:free')), AsyncMock()
        first = await self.run_request('veltra-free', call, settle)
        second = await self.run_request('veltra-free', call, settle)
        self.assertEqual(first, second)
        self.assertEqual(call.await_count, 1)
        settle.assert_awaited_once_with('org', 7, 'veltra-free')
        body = call.call_args.args[0]['extra_body']
        self.assertTrue(body['models'][0].endswith(':free'))
        self.assertNotIn('data_collection', body['provider'])

    async def test_chat_is_never_cached(self):
        self.cache = ResponseCache()
        call, settle = AsyncMock(return_value=completion('deepseek/deepseek-v4-pro-0813')), AsyncMock()
        await self.run_request('veltra-fast', call, settle)
        await self.run_request('veltra-fast', call, settle)
        self.assertEqual(call.await_count, 2)
        self.assertEqual(call.call_args.args[0]['extra_body']['provider']['data_collection'], 'deny')

    async def test_failures_are_not_cached(self):
        cache = ResponseCache()
        compute = AsyncMock(side_effect=[HTTPException(status_code=502), {'ok': 1}])
        with self.assertRaises(HTTPException):
            await cache.fetch('k', compute)
        self.assertEqual(await cache.fetch('k', compute), ({'ok': 1}, True))
