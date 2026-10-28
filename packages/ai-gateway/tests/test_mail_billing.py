import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from fastapi import FastAPI
import httpx
from mail_billing import create_router

ACCOUNT='00000000-0000-4000-8000-000000000001'
REQUEST='00000000-0000-4000-8000-000000000002'
class MailBillingTests(unittest.IsolatedAsyncioTestCase):
 async def request(self,state='reserved',provider=None,links=True,owner='client-owner',settled=True):
  calls=[]
  async def db(table,**kw):
   calls.append((table,kw))
   if table=='crm_mail_connections':return [{'workspace_id':'client-workspace','connected_by':'client-owner'}] if links else []
   if table=='crm_workspaces':return [{'owner_id':owner}]
   if table=='rpc/reserve_mail_credits':return {'status':state,'response':{'id':'cached-provider-result'}}
   if table=='rpc/finish_mail_credits':return settled
   raise AssertionError(table)
  call=AsyncMock(side_effect=provider) if isinstance(provider,Exception) else AsyncMock(return_value=SimpleNamespace(model_dump=lambda:{'id':'provider-result','model':'inclusionai/ling-3.0-flash','usage':{'total_tokens':12},'choices':[]}))
  app=FastAPI();app.include_router(create_router(db,call))
  payload={'account_id':ACCOUNT,'request_id':REQUEST,'operation':'classify','organization_id':'ATTACKER-ORG','completion':{'model':'inclusionai/ling-3.0-flash','messages':[{'role':'user','content':'fixture'}],'max_tokens':100}}
  with patch('mail_billing.owner_organization',AsyncMock(return_value='client-org')),patch.dict('os.environ',{'OPENROUTER_API_KEY':'server-provider-key'}):
   async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='https://fixture') as client:r=await client.post('/v1/mail/completions',json=payload,headers={'Authorization':'Bearer account-capability'})
  return r,calls,call
 async def test_tenant_is_derived_and_receipt_precedes_response(self):
  r,calls,call=await self.request();self.assertEqual(r.status_code,200)
  reserve=next(k['payload'] for t,k in calls if t=='rpc/reserve_mail_credits');self.assertEqual(reserve['p_org'],'client-org');self.assertEqual(reserve['p_account'],ACCOUNT)
  finish=next(k['payload'] for t,k in calls if t=='rpc/finish_mail_credits');self.assertEqual(finish['p_tokens'],12);self.assertEqual(finish['p_status'],'succeeded');self.assertEqual(r.json()['onixus_receipt']['credits'],12);self.assertEqual(call.await_count,1)
 async def test_no_balance_no_provider_and_cached_replay_no_second_charge(self):
  r,_,call=await self.request(state='insufficient');self.assertEqual(r.status_code,402);call.assert_not_called()
  r,calls,call=await self.request(state='succeeded');self.assertEqual(r.json()['id'],'cached-provider-result');call.assert_not_called();self.assertFalse(any(t=='rpc/finish_mail_credits' for t,_ in calls))
 async def test_invalid_link_changed_owner_and_uncertain_request_fail_closed(self):
  for kw in ({'links':False},{'owner':'agency-owner'}):
   r,calls,call=await self.request(**kw);self.assertEqual(r.status_code,403);call.assert_not_called();self.assertFalse(any(t.startswith('rpc/') for t,_ in calls))
  r,calls,_=await self.request(provider=TimeoutError());self.assertEqual(r.status_code,409);self.assertFalse(any(t=='rpc/finish_mail_credits' for t,_ in calls))
 async def test_settlement_failure_never_returns_unbilled_content(self):
  r,_,_=await self.request(settled=False);self.assertEqual(r.status_code,409);self.assertNotIn('choices',r.json())
