import unittest
from datetime import datetime, timezone
from usage_reporting import usage_report

class UsageTests(unittest.IsolatedAsyncioTestCase):
    async def test_scoped_totals_do_not_count_reservations_as_spend(self):
        calls=[]
        async def db(table, params):
            calls.append((table,params))
            return {
                'usage_logs':[{'id':'old','category':'chat','credits_deducted':7,'created_at':'2026-10-27T10:00:00Z'},{'id':'new','category':'workspace.crm','credits_deducted':3,'created_at':'2026-10-27T11:00:00Z'}],
                'agent_runs':[{'id':'run','status':'running','credits_reserved':100,'credits_used':20,'created_at':'2026-10-27T12:00:00Z'}],
                'credit_transactions':[{'id':'grant','amount':2000000,'description':'Grant','created_at':'2026-10-27T12:00:00Z'}]
            }[table]
        result=await usage_report(db,'owner-org',datetime(2026,10,28,tzinfo=timezone.utc))
        self.assertEqual(result['used'],30)
        self.assertEqual(result['reserved_remaining'],80)
        apps={a['id']:a for a in result['apps']}
        self.assertEqual(apps['unassigned']['credits'],7)
        self.assertEqual(apps['crm']['credits'],3)
        self.assertEqual(apps['mail']['coverage'],'no_attributed_records')
        self.assertEqual(len(result['ledger']),1)
        for _,params in calls:
            self.assertEqual(params['organization_id'],'eq.owner-org')
            self.assertEqual(params['limit'],'500')

    async def test_missing_source_is_visible_and_pagination_is_bounded(self):
        async def db(table, params):
            if table=='agent_runs':raise RuntimeError('private database detail')
            if table=='credit_transactions':return []
            return [{'id':str(i),'category':'workspace.chat','credits_deducted':1,'created_at':'2026-10-27T12:00:00Z'} for i in range(500)] if params['offset']=='0' else []
        result=await usage_report(db,'owner-org')
        self.assertEqual(result['used'],500)
        self.assertEqual(len(result['events']),250)
        self.assertEqual(result['event_count'],500)
        self.assertIn('agent_runs: receipts unavailable; totals may be incomplete',result['warnings'])
        self.assertNotIn('private database detail',str(result))
