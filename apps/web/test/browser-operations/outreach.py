import base64, json, os, time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

W='00000000-0000-4000-8000-000000000001'
W2='00000000-0000-4000-8000-000000000002'
U='00000000-0000-4000-8000-000000000003'
expiry=int(time.time())+3600
encode=lambda value:base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
token=encode({'alg':'HS256'})+'.'+encode({'sub':U,'exp':expiry,'role':'authenticated'})+'.fixture'
session={'access_token':token,'refresh_token':'fixture-refresh','expires_at':expiry,'expires_in':3600,'token_type':'bearer','user':{'id':U,'aud':'authenticated','role':'authenticated','email':'owner@example.test','app_metadata':{},'user_metadata':{}}}
state={'failed':False,'research_error':False,'requests':[]}
out=Path(os.environ.get('OPERATIONS_SCREENSHOTS','work/operations-screenshots'));out.mkdir(parents=True,exist_ok=True)
import urllib.request
for attempt in range(40):
 try:
  urllib.request.urlopen('http://127.0.0.1:3188',timeout=1).close();break
 except OSError:
  time.sleep(.25)
else:
 raise RuntimeError('Browser fixture server did not start')
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 context=browser.new_context(viewport={'width':1280,'height':1000},reduced_motion='reduce')
 context.add_init_script('localStorage.setItem("sb-fixture-auth-token",'+json.dumps(json.dumps(session))+')')
 state={'status':'draft','campaign':'paused','failed':False,'actions':[]}
 W='11111111-1111-4111-8111-111111111111'
 def outreach(route):
  req=route.request
  if req.method=='POST':
   data=req.post_data_json;assert data['workspace_id']==W
   assert data['action'] in ['approve','activate'],data
   state['actions'].append(data['action'])
   if data['action']=='approve':state['status']='approved'
   if data['action']=='activate':state['campaign']='active'
  else:assert req.method=='GET' and W in req.url
  if state['failed']:return route.fulfill(status=503,json={'error':'Mail connection unavailable'})
  status=state['status']
  route.fulfill(json={'campaigns':[{'id':'campaign','name':'Launch','status':state['campaign'],'config':{'daily_limit':10,'timezone':'America/New_York'}}],'messages':[{'id':'message','campaign_id':'campaign','company':'Northstar Studio','email':'alex@example.com','subject':'Introduction','body':'A draft for review.','step':0,'status':status,'due_at':'2026-10-21T09:00:00Z','provider_id':'receipt-1' if status=='sent' else None,'last_error':None}],'daily':{'day':'2026-10-21','time_zone':'UTC','sent_today':1 if status=='sent' else 0,'awaiting_review':1 if status=='draft' else 0,'needs_attention':0,'approved_due':0,'awaiting_receipt':0}})
 context.route('**/api/crm/outreach**',outreach)
 page=context.new_page();page.clock.install();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
 page.goto('http://127.0.0.1:3188/?outreach');page.wait_for_load_state('networkidle')
 expect(page.get_by_text('1 selected',exact=False)).to_be_visible()
 results=page.get_by_role('region',name='Outreach results')
 expect(results).to_contain_text('Review each exact draft')
 page.get_by_role('button',name='Approve this exact message').click()
 expect(results).to_contain_text('Approved messages are waiting in a paused campaign')
 assert state['actions']==['approve'],'Approval alone must not activate or send'
 page.get_by_role('button',name='Activate approved delivery').click()
 expect(results).to_contain_text('Watch the next delivery receipt')
 assert state['actions']==['approve','activate']
 state['status']='sent'
 page.clock.fast_forward(21000)
 expect(page.get_by_text('Provider receipt: receipt-1')).to_be_visible()
 page.screenshot(path=str(out/'outreach-results.png'),full_page=True)
 state['failed']=True
 page.get_by_role('button',name='Refresh automation').click()
 expect(results).to_contain_text('last results may be out of date')
 expect(page.get_by_role('alert')).to_contain_text('Mail connection unavailable')
 page.set_viewport_size({'width':390,'height':844})
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'Outreach must fit mobile'
 page.screenshot(path=str(out/'outreach-mobile.png'),full_page=True)
 assert not errors,errors
 browser.close()
