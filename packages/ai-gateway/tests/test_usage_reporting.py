import unittest
from datetime import datetime, timezone
from usage_reporting import usage_report

class UsageTests(unittest.IsolatedAsyncioTestCase):
    async def test_scoped_totals_do_not_count_reservations_as_spend(self):
        calls=[]
        async def db(table, params):
            calls.append((table,params))
            return {
                'mail_credit_requests':[],
                'usage_logs':[{'id':'old','category':'chat','credits_deducted':7,'created_at':'2026-10-27T10:00:00Z'},{'id':'new','category':'workspace.crm','credits_deducted':3,'created_at':'2026-10-27T11:00:00Z'}],
                'agent_runs':[{'id':'run','status':'running','credits_reserved':100,'credits_used':20,'created_at':'2026-10-27T12:00:00Z'}],
                'credit_transactions':[{'id':'grant','amount':2000000,'description':'Grant','created_at':'2026-10-27T12:00:00Z'}]
            }[table]
        result=await usage_report(db,'owner-org',datetime(2026,10,28,tzinfo=timezone.utc))
        self.assertEqual(result['used'],30)
        self.assertEqual(result['reserved_remaining'],80)
        apps={a['id']:a for a in result['apps']}
        self.assertEqual(apps['chat']['credits'],7)
        self.assertEqual(apps['chat']['legacy_credits'],7)
        self.assertEqual(apps['unassigned']['credits'],0)
        self.assertEqual(apps['crm']['credits'],3)
        self.assertEqual(apps['mail']['coverage'],'no_attributed_records')
        self.assertEqual(len(result['ledger']),1)
        self.assertEqual(len(result['consumption']),31)
        self.assertEqual(sum(d['credits'] for d in result['consumption']),result['used'])
        day=next(d for d in result['consumption'] if d['date']=='2026-10-27')
        self.assertEqual(day['apps']['chat'],7)
        self.assertEqual(day['apps']['crm'],3)
        self.assertEqual(day['apps']['code'],20)
        self.assertEqual(sum(day['apps'].values()),day['credits'])
        for _,params in calls:
            self.assertEqual(params['organization_id'],'eq.owner-org')
            self.assertEqual(params['limit'],'500')

    async def test_missing_source_is_visible_and_pagination_is_bounded(self):
        async def db(table, params):
            if table=='agent_runs':raise RuntimeError('private database detail')
            if table=='credit_transactions':return []
            return [{'id':str(i),'category':'workspace.chat','credits_deducted':1,'created_at':'2026-10-27T12:00:00Z'} for i in range(500)] if params['offset']=='0' else []
        result=await usage_report(db,'owner-org',datetime(2026,10,28,tzinfo=timezone.utc))
        self.assertEqual(result['used'],500)
        self.assertEqual(len(result['events']),250)
        self.assertEqual(result['event_count'],500)
        self.assertIn('agent_runs: receipts unavailable; totals may be incomplete',result['warnings'])
        self.assertNotIn('private database detail',str(result))

    async def test_voice_is_not_reclassified_as_chat_and_unknowns_are_retained(self):
        async def db(table, params):
            if table!='usage_logs':return []
            return [{'id':'voice','category':'chat','model_used':'elevenlabs-stt','credits_deducted':10,'created_at':'2026-10-27T12:00:00Z'},
                    {'id':'unknown','category':'future-service','credits_deducted':5,'created_at':'2026-10-27T13:00:00Z'},
                    {'id':'exact','category':'workspace.chat','credits_deducted':20,'created_at':'2026-10-27T14:00:00Z'}]
        result=await usage_report(db,'owner-org',datetime(2026,10,28,tzinfo=timezone.utc))
        apps={a['id']:a for a in result['apps']}
        self.assertEqual(apps['voice']['credits'],10)
        self.assertEqual(apps['chat']['credits'],20)
        self.assertEqual(apps['chat']['legacy_credits'],0)
        self.assertEqual(apps['unassigned']['credits'],5)
        self.assertEqual(result['used'],35)

    async def test_selected_month_is_bounded_and_day_filters_receipts_only(self):
        calls=[]
        async def db(table,params):
            calls.append(params)
            if table!='usage_logs':return []
            return [{'id':'first','category':'workspace.chat','credits_deducted':5,'created_at':'2024-02-01T00:00:00Z'}, {'id':'last','category':'workspace.crm','credits_deducted':7,'created_at':'2024-02-29T23:59:59Z'}]
        result=await usage_report(db,'org',month='2024-02',day='2024-02-29')
        self.assertEqual(len(result['consumption']),29)
        self.assertEqual(result['used'],12)
        self.assertEqual(result['event_count'],2)
        self.assertEqual(result['filtered_event_count'],1)
        self.assertEqual(result['events'][0]['id'],'last')
        for params in calls:
            self.assertEqual(params['created_at'],'gte.2024-02-01T00:00:00+00:00')
            self.assertEqual(params['and'],'(created_at.lt.2024-03-01T00:00:00+00:00)')
        for month,day in [('2024-13',None),('2024-2',None),('2024-02','2024-02-30'),('2024-02','2024-03-01')]:
            with self.assertRaises(ValueError):await usage_report(db,'org',month=month,day=day)

    async def test_mail_holds_are_not_spend(self):
        async def db(table,params):
            return [{'id':'mail-hold','status':'reserved','credits_reserved':9000,'created_at':'2026-10-27T12:00:00Z'}] if table=='mail_credit_requests' else []
        result=await usage_report(db,'client-org',month='2026-10')
        self.assertEqual(result['reserved_remaining'],9000)
        self.assertEqual(result['mail_reserved_remaining'],9000)
        self.assertEqual(result['used'],0)
