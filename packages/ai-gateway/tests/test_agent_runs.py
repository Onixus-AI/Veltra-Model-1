import asyncio
import json
import os
import unittest
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.security import HTTPBearer
from fastapi.testclient import TestClient

from agent_runs import TaskRequest, design_artifacts, build_graph, create_router, execute_run, provider_completion, safe_path, validate_artifacts


class ValidationTests(unittest.TestCase):
    def test_design_accepts_raw_html_and_rejects_partial_output(self):
        page='<!doctype html><html><body><h1>Website</h1></body></html>'
        self.assertEqual(design_artifacts('```html\n'+page+'\n```')['files'][0]['content'],page)
        with self.assertRaises(ValueError):
            design_artifacts('<!doctype html><html><body>incomplete')

    def test_paths_cannot_escape_or_overwrite_private_files(self):
        for path in ['../x.py', '/tmp/x.py', '.env', 'src/.env', 'a//b.js', 'src/../x.js', 'node_modules/x.js', 'secrets/token']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                safe_path(path)
        self.assertEqual(safe_path('src/component.tsx'), 'src/component.tsx')

    def test_files_and_browser_actions_are_bounded(self):
        with self.assertRaises(ValueError):
            validate_artifacts({'files': [{'path': 'x.py', 'content': ''}]*2})
        with self.assertRaises(ValueError):
            validate_artifacts({'files': [{'path': 'x.py', 'content': ''}], 'browser_actions': [{'type': 'navigate', 'selector': 'https://example.com'}]})

    def test_screenshots_must_be_image_bytes(self):
        with self.assertRaises(ValueError):
            TaskRequest(id=uuid4(), task='test', screenshot='data:image/png;base64,SGVsbG8=')


class GraphTests(unittest.IsolatedAsyncioTestCase):
    async def test_models_receive_each_others_outputs_in_order(self):
        roles, checkpoints = [], []
        async def call(role, system, content, limit):
            roles.append(role)
            if role == 'planner':
                self.assertIn('observations', content.lower())
                text = 'Use an accessible form.'
            elif role == 'coder':
                self.assertIn('accessible form', content)
                text = json.dumps({'summary': 'Created form', 'files': [{'path': 'index.html', 'content': '<button>Add</button>'}]})
            elif role == 'reviewer':
                self.assertIn('<button>Add</button>', content)
                text = json.dumps({'approved': True, 'summary': 'Reviewed source', 'issues': []})
            else:
                text = 'Screenshot observations'
            return text, {'role': role, 'credits': 10}
        async def checkpoint(stage, state):
            checkpoints.append(stage)
        result = await build_graph(call, checkpoint, {'task': 'Create a form', 'screenshot': 'test-image'}).ainvoke({})
        self.assertEqual(roles, ['vision', 'planner', 'coder', 'reviewer'])
        self.assertEqual(checkpoints, ['vision', 'planning', 'building', 'reviewing'])
        self.assertFalse(result['review']['tests_executed'])
        self.assertEqual(len(result['receipts']), 4)

    async def test_design_keeps_full_source_for_builder_and_bounds_planning_context(self):
        reference='x'*12000
        seen={}
        async def call(role, system, content, limit):
            seen[role]=(json.loads(content) if role=='planner' else content,limit)
            if role=='planner':text='Plan a polished site.'
            elif role=='coder':text='<!doctype html><html><body><h1>Site</h1></body></html>'
            else:text=json.dumps({'approved':True,'summary':'Reviewed','issues':[]})
            return text,{'role':role,'credits':1}
        await build_graph(call,AsyncMock(),{'task':'Build a studio site','context':reference,'mode':'design'}).ainvoke({})
        self.assertEqual(len(seen['planner'][0]['reference']),2500)
        self.assertIn(reference,seen['coder'][0])
        self.assertEqual(seen['coder'][1],4000)

    async def test_design_finishes_a_truncated_document_once_and_keeps_both_receipts(self):
        builders=0
        async def call(role, system, content, limit):
            nonlocal builders
            if role=='planner':text='Plan'
            elif role=='coder':
                builders+=1
                text='<html><body><h1>Site</h1>' if builders==1 else '</body></html>'
            else:text=json.dumps({'approved':True,'summary':'Reviewed','issues':[]})
            return text,{'role':role,'credits':1}
        result=await build_graph(call,AsyncMock(),{'task':'Build a site','mode':'design'}).ainvoke({})
        self.assertEqual(builders,2)
        self.assertTrue(result['artifacts']['files'][0]['content'].endswith('</body></html>'))
        self.assertEqual(len(result['receipts']),4)

    async def test_confirmed_rate_limit_retries_once_but_unknown_failure_does_not(self):
        class Limited(Exception):
            status_code=429
        waiting=AsyncMock()
        with patch('agent_runs.asyncio.sleep',new_callable=AsyncMock) as sleep, patch('agent_runs.litellm.acompletion',new=AsyncMock(side_effect=[Limited(), 'result'])) as model:
            self.assertEqual(await provider_completion({},waiting),'result')
            self.assertEqual(model.await_count,2)
            sleep.assert_awaited_once()
        with patch('agent_runs.asyncio.sleep',new_callable=AsyncMock) as sleep, patch('agent_runs.litellm.acompletion',new=AsyncMock(side_effect=TimeoutError)) as model:
            with self.assertRaises(TimeoutError):await provider_completion({},waiting)
            self.assertEqual(model.await_count,1)
            sleep.assert_not_awaited()

    async def test_rejected_review_cannot_trigger_image_tool(self):
        async def call(role, *_):
            text = 'plan' if role == 'planner' else json.dumps({'files': [{'path': 'x.js', 'content': 'bad'}]}) if role == 'coder' else json.dumps({'approved': False, 'issues': ['Not correct']})
            return text, {'role': role}
        image = AsyncMock()
        await build_graph(call, AsyncMock(), {'task': 'Build', 'create_image': True}, image).ainvoke({})
        image.assert_not_awaited()

    async def test_cancelled_task_settles_without_model_calls(self):
        calls=[]
        async def db(table, **kwargs):
            calls.append((table, kwargs))
            return True if table.startswith('rpc/') else [{'cancel_requested': True}]
        with patch('agent_runs.litellm.acompletion', new_callable=AsyncMock) as model:
            await execute_run({'id': str(uuid4()), 'payload': {'task': 'Build'}, 'credits_reserved': 1000}, str(uuid4()), db, {})
            model.assert_not_awaited()
        settlement = next(kwargs['payload'] for table, kwargs in calls if table == 'rpc/finish_agent_run')
        self.assertEqual(settlement['p_used'], 0)
        self.assertFalse(settlement['p_success'])

    async def test_provider_failure_holds_reservation_and_never_claims_success(self):
        calls=[]
        async def db(table, **kwargs):
            calls.append((table, kwargs))
            return [{'cancel_requested': False}]
        with patch.dict(os.environ, {'OPENROUTER_API_KEY': 'test-only'}), patch('agent_runs.litellm.token_counter', return_value=10), patch('agent_runs.litellm.acompletion', new=AsyncMock(side_effect=TimeoutError)):
            await execute_run({'id': str(uuid4()), 'payload': {'task': 'Build'}, 'credits_reserved': 6000}, str(uuid4()), db, {'planner': 'test'})
        self.assertFalse(any(table == 'rpc/finish_agent_run' for table, _ in calls))
        self.assertEqual(calls[-1][1]['payload']['status'], 'interrupted')

    async def test_explicit_provider_rejection_settles_unused_credits(self):
        class Rejected(Exception):
            status_code = 402
        calls=[]
        async def db(table, **kwargs):
            calls.append((table, kwargs))
            return True if table.startswith('rpc/') else [{'cancel_requested': False}]
        with patch.dict(os.environ, {'OPENROUTER_API_KEY': 'test-only'}), patch('agent_runs.litellm.token_counter', return_value=10), patch('agent_runs.litellm.acompletion', new=AsyncMock(side_effect=Rejected)):
            await execute_run({'id': str(uuid4()), 'payload': {'task': 'Build'}, 'credits_reserved': 6000}, str(uuid4()), db, {'planner': 'test'})
        settlement=next(kwargs['payload'] for table, kwargs in calls if table=='rpc/finish_agent_run')
        self.assertEqual(settlement['p_used'],0)
        self.assertFalse(settlement['p_success'])


class AccessTests(unittest.TestCase):
    def setUp(self):
        self.calls=[]
        async def authenticate(credentials):
            if credentials is None:
                raise HTTPException(401)
            return {'user_id': 'owner-user', 'organization_id': 'owner-org'}
        async def db(table, **kwargs):
            self.calls.append((table, kwargs))
            return []
        app=FastAPI()
        app.include_router(create_router(authenticate, HTTPBearer(auto_error=False), db))
        self.client=TestClient(app)

    def test_anonymous_access_is_denied(self):
        self.assertEqual(self.client.get('/v1/agent-runs').status_code, 401)
        self.assertFalse(self.calls)

    def test_read_and_cancel_are_scoped_to_both_user_and_org(self):
        for suffix in ['', '/cancel']:
            path='/v1/agent-runs/'+str(uuid4())+suffix
            response=self.client.post(path, headers={'Authorization':'Bearer test'}) if suffix else self.client.get(path,headers={'Authorization':'Bearer test'})
            self.assertEqual(response.status_code,404)
            params=self.calls[-1][1]['params']
            self.assertEqual(params['user_id'],'eq.owner-user')
            self.assertEqual(params['organization_id'],'eq.owner-org')


if __name__ == '__main__':
    unittest.main()
