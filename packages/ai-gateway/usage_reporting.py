"""Read-only, organization-scoped credit receipts. Unknown history stays unassigned."""
from datetime import datetime, timedelta, timezone

APPS = {'chat':'Chat','crm':'CRM','mail':'Mail','signal':'Signal','business_os':'Business OS','code':'Code','images':'Images','voice':'Voice','unassigned':'Unassigned history'}

async def usage_report(database, organization, now=None, month=None, day=None):
    now = now or datetime.now(timezone.utc)
    import re
    month = month or now.strftime('%Y-%m')
    if not re.fullmatch(r'\d{4}-\d{2}',month): raise ValueError('Month must use YYYY-MM.')
    year,number=map(int,month.split('-'))
    if not 2000<=year<=9998 or not 1<=number<=12: raise ValueError('Invalid month.')
    start=datetime(year,number,1,tzinfo=timezone.utc)
    end=datetime(year+1,1,1,tzinfo=timezone.utc) if number==12 else datetime(year,number+1,1,tzinfo=timezone.utc)
    if day:
        try: selected=datetime.strptime(day,'%Y-%m-%d').date().isoformat()
        except ValueError: raise ValueError('Day must use YYYY-MM-DD.')
        if selected!=day or not day.startswith(month+'-'): raise ValueError('Day must belong to the selected month.')
    since = start.isoformat()
    warnings=[]
    async def read(table, fields):
        rows=[]
        try:
            for offset in range(0, 10000, 500):
                page=await database(table,params={'select':fields,'organization_id':f'eq.{organization}','created_at':f'gte.{since}','and':f'(created_at.lt.{end.isoformat()})','order':'created_at.desc,id.desc','limit':'500','offset':str(offset)})
                if not isinstance(page,list): raise ValueError('Invalid receipt collection')
                rows.extend(page)
                if len(page)<500:return rows
            warnings.append(f'{table}: limited to latest 10,000 receipts')
        except Exception:
            warnings.append(f'{table}: receipts unavailable; totals may be incomplete')
        return rows
    import asyncio
    logs,runs,ledger=await asyncio.gather(read('usage_logs','id,category,model_used,tokens_consumed,credits_deducted,created_at'),read('agent_runs','id,status,stage,credits_reserved,credits_used,created_at'),read('credit_transactions','id,amount,description,created_at'))
    events=[];reserved=0
    for row in logs:
        category=str(row.get('category') or '')
        model = str(row.get('model_used') or '')
        # The old gateway wrote category=chat for its shared completion endpoint,
        # including embedded assistants. Preserve this provenance rather than
        # claiming we recovered the original product surface.
        legacy_chat = category == 'chat' and not model.startswith('elevenlabs-')
        app = (category.removeprefix('workspace.') if category.startswith('workspace.')
               else 'voice' if model.startswith('elevenlabs-')
               else {'chat':'chat','crm':'crm','mail':'mail','signal':'signal',
                     'business_os':'business_os','image':'images','images':'images','voice':'voice'}.get(category,'unassigned'))
        if app not in APPS: app='unassigned'
        task = ('Chat completion (legacy shared endpoint)' if legacy_chat else
                {'images':'Image generation','voice':'Voice processing','unassigned':'Model request (source not recorded)'}.get(app,APPS[app]+' model request'))
        events.append({'id':str(row['id']),'app':app,'task':task,'attribution':'legacy_shared_endpoint' if legacy_chat else 'recorded_category',
                       'status':'charged','credits':max(0,int(row.get('credits_deducted') or 0)),
                       'tokens':max(0,int(row.get('tokens_consumed') or 0)),'model':row.get('model_used'),'at':row['created_at']})
    for row in runs:
        used=max(0,int(row.get('credits_used') or 0));pending=row.get('status') in ['queued','running','interrupted']
        if pending:reserved+=max(0,int(row.get('credits_reserved') or 0)-used)
        events.append({'id':str(row['id']),'app':'code','task':'Coding task '+str(row['id'])[:8],'status':row.get('status','unknown'),'credits':used,'tokens':None,'model':None,'at':row['created_at']})
    events.sort(key=lambda row:(row['at'],row['id']),reverse=True)
    apps=[{'id':key,'label':label,'credits':sum(e['credits'] for e in events if e['app']==key),'tasks':sum(1 for e in events if e['app']==key),'legacy_credits':sum(e['credits'] for e in events if e['app']==key and e.get('attribution')=='legacy_shared_endpoint'),'coverage':'recorded' if any(e['app']==key for e in events) else 'no_attributed_records'} for key,label in APPS.items()]
    daily={(start+timedelta(days=i)).date().isoformat():{'date':(start+timedelta(days=i)).date().isoformat(),'credits':0,'apps':{key:0 for key in APPS}} for i in range((end-start).days)}
    for event in events:
        day_key=datetime.fromisoformat(event['at'].replace('Z','+00:00')).astimezone(timezone.utc).date().isoformat()
        if day_key in daily:
            daily[day_key]['credits']+=event['credits']
            daily[day_key]['apps'][event['app']]+=event['credits']
    visible_events=[e for e in events if not day or datetime.fromisoformat(e['at'].replace('Z','+00:00')).astimezone(timezone.utc).date().isoformat()==day]
    return {'month':month,'selected_day':day,'period_end':end.isoformat(),'filtered_event_count':len(visible_events),'since':since,'until':now.isoformat(),'time_zone':'UTC','apps':apps,'events':visible_events[:250],'event_count':len(events),'event_limit':250,'consumption':list(daily.values()),'used':sum(e['credits'] for e in events),'reserved_remaining':reserved,'ledger':ledger[:100],'warnings':warnings,'note':'Chat includes historical charges recorded by the shared chat-completion endpoint; its embedded assistants cannot be separated retroactively. New Workspace Chat and CRM requests record their source explicitly. Truly unknown categories stay unassigned. Mail and Signal may meter through separate services. Reservations are separate from spend; task labels describe operation types, not historical prompts.'}
