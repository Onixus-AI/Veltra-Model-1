"""Read-only, organization-scoped credit receipts. Unknown history stays unassigned."""
from datetime import datetime, timedelta, timezone

APPS = {'chat':'Chat','crm':'CRM','mail':'Mail','signal':'Signal','business_os':'Business OS','code':'Code','images':'Images','voice':'Voice','unassigned':'Unassigned history'}

async def usage_report(database, organization, now=None):
    now = now or datetime.now(timezone.utc)
    since = (now-timedelta(days=30)).isoformat()
    warnings=[]
    async def read(table, fields):
        rows=[]
        try:
            for offset in range(0, 10000, 500):
                page=await database(table,params={'select':fields,'organization_id':f'eq.{organization}','created_at':f'gte.{since}','order':'created_at.desc,id.desc','limit':'500','offset':str(offset)})
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
        app=category.removeprefix('workspace.') if category.startswith('workspace.') else 'images' if category=='image' else 'voice' if str(row.get('model_used','')).startswith('elevenlabs-') else 'unassigned'
        if app not in APPS:app='unassigned'
        events.append({'id':str(row['id']),'app':app,'task':{'images':'Image generation','voice':'Voice processing','unassigned':'Model request (historical app not recorded)'}.get(app,APPS[app]+' model request'),'status':'charged','credits':max(0,int(row.get('credits_deducted') or 0)),'tokens':max(0,int(row.get('tokens_consumed') or 0)),'model':row.get('model_used'),'at':row['created_at']})
    for row in runs:
        used=max(0,int(row.get('credits_used') or 0));pending=row.get('status') in ['queued','running','interrupted']
        if pending:reserved+=max(0,int(row.get('credits_reserved') or 0)-used)
        events.append({'id':str(row['id']),'app':'code','task':'Coding task '+str(row['id'])[:8],'status':row.get('status','unknown'),'credits':used,'tokens':None,'model':None,'at':row['created_at']})
    events.sort(key=lambda row:(row['at'],row['id']),reverse=True)
    apps=[{'id':key,'label':label,'credits':sum(e['credits'] for e in events if e['app']==key),'tasks':sum(1 for e in events if e['app']==key),'coverage':'recorded' if any(e['app']==key for e in events) else 'no_attributed_records'} for key,label in APPS.items()]
    daily={}
    for event in events:
        day=event['at'][:10];daily[day]=daily.get(day,0)+event['credits']
    return {'since':since,'until':now.isoformat(),'time_zone':'UTC','apps':apps,'events':events[:250],'event_count':len(events),'event_limit':250,'consumption':[{'date':day,'credits':daily[day]} for day in sorted(daily)],'used':sum(e['credits'] for e in events),'reserved_remaining':reserved,'ledger':ledger[:100],'warnings':warnings,'note':'Recorded charges and coding usage; reservations are separate. No attributed records does not mean an app was unused or free. Mail and Signal may meter through separate services. Task labels are operation types; historical prompts were not recorded.'}
