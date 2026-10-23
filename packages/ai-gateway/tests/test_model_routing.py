import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from model_routing import routing_options


class RoutingTests(unittest.TestCase):
    def test_primary_is_first_and_duplicates_are_removed(self):
        route = routing_options('openrouter/nvidia/nemotron-3.5-lightning:free', ['nvidia/nemotron-3.5-lightning:free', 'inclusionai/ling-3.0-flash'], tools=True)
        self.assertEqual(route['models'], ['nvidia/nemotron-3.5-lightning:free', 'inclusionai/ling-3.0-flash'])
        self.assertTrue(route['provider']['require_parameters'])
        self.assertEqual(route['provider']['data_collection'], 'deny')


class ChatRoutingTests(unittest.IsolatedAsyncioTestCase):
    async def test_coding_roles_forward_fallbacks_and_record_served_model(self):
        import agent_runs
        import main
        calls = []
        async def database(table, **kwargs):
            calls.append((table, kwargs))
            return True if table.startswith('rpc/') else [{'cancel_requested': False}]
        outputs = ['Plan', '{"summary":"Built","files":[{"path":"index.html","content":"<h1>Test</h1>"}]}',
                   '{"approved":true,"summary":"Reviewed","issues":[]}']
        responses = [SimpleNamespace(model_dump=lambda text=text: {
            'model': 'backup/actual', 'id': 'synthetic', 'usage': {'total_tokens': 10},
            'choices': [{'message': {'content': text}}]}) for text in outputs]
        completion = AsyncMock(side_effect=responses)
        with patch.dict(os.environ, {'OPENROUTER_API_KEY': 'test-only'}, clear=True), \
             patch('agent_runs.litellm.token_counter', return_value=10), \
             patch('agent_runs.litellm.acompletion', completion):
            await agent_runs.execute_run({'id': 'synthetic', 'payload': {'task': 'Synthetic site'}, 'credits_reserved': 10000},
                                         'worker', database, main.MODEL_CONFIG['coding_team'], main.MODEL_CONFIG['coding_fallbacks'])
        self.assertEqual(completion.await_count, 3)
        self.assertEqual(completion.call_args_list[1].kwargs['extra_body']['models'],
                         ['cohere/north-mini-code:free', 'inception/mercury-3', 'qwen/qwen3.8-flash'])
        states = [kwargs['payload']['state'] for table, kwargs in calls if 'state' in kwargs.get('payload', {})]
        self.assertEqual(states[-1]['receipts'][0]['model'], 'backup/actual')

    async def test_tools_preserve_nvidia_first_and_settle_returned_usage(self):
        import main
        result = {'model': 'backup/served', 'choices': [], 'usage': {'total_tokens': 12}}
        call = AsyncMock(return_value=SimpleNamespace(model_dump=lambda: result))
        settle = AsyncMock()
        request = main.ChatCompletionRequest(model='veltra-agent', messages=[{'role': 'user', 'content': 'Synthetic test'}],
                                             tools=[{'type': 'function', 'function': {'name': 'test', 'parameters': {'type': 'object'}}}])
        with patch.dict(os.environ, {'OPENROUTER_API_KEY': 'test-only'}), \
             patch('main.get_authenticated_principal', AsyncMock(return_value={'organization_id': 'test'})), \
             patch('main.get_wallet', AsyncMock(return_value={'credits_remaining': 10000})), \
             patch('main.call_model', call), patch('main.settle_credits', settle):
            response = await main.create_chat_completion(request, None)
        body = call.call_args.args[0]['extra_body']
        self.assertEqual(body['models'][0], 'nvidia/nemotron-3.5-super-vl:free')
        self.assertEqual(body['models'][1], 'xiaomi/mimo-v2.6-flash')
        self.assertTrue(body['provider']['require_parameters'])
        self.assertEqual(response['model'], 'backup/served')
        settle.assert_awaited_once_with('test', 12, 'veltra-agent')

    async def test_every_default_route_is_free_first_and_within_policy(self):
        import main
        for alias, config in main.MODELS.items():
            options = routing_options(config['model'], main.MODEL_CONFIG['chat_fallbacks'].get(alias, []))
            self.assertTrue(options['models'][0].endswith(':free'))
            self.assertEqual(options['provider']['max_price'], {'prompt': .5, 'completion': 1})
        for role, primary in main.MODEL_CONFIG['coding_team'].items():
            self.assertTrue(primary.endswith(':free'))
            routing_options(primary, main.MODEL_CONFIG['coding_fallbacks'][role])
