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
 state={'status':'draft','campaign':'paused','failed':False,'actions':[],'config':None,'has_campaign':False,'defaults':None}
 W='11111111-1111-4111-8111-111111111111'
 def outreach(route):
  req=route.request
  if req.method=='POST':
   data=req.post_data_json;assert data['workspace_id']==W
   assert data['action'] in ['create','launch','save_defaults'],data
   if data['action']=='save_defaults':state['defaults']=data['profile']
   else:state['actions'].append(data['action'])
   if data['action']=='create':
    assert data['follow_up_mode']=='automatic'
    assert data['customers']==['a']
    assert 'branding' not in data,'Customers must not inherit Onixus branding'
    assert 'http://127.0.0.1:3188/book?calendar=fixture' in data['steps'][0]['body']
    state['config']=data;state['has_campaign']=True
   if data['action']=='launch':
    assert data['review_token']=='a'*64
    state['status']='approved';state['campaign']='active'
  else:assert req.method=='GET' and W in req.url
  if state['failed']:return route.fulfill(status=503,json={'error':'Mail connection unavailable'})
  config=state['config'];status=state['status']
  campaigns=[{'id':'campaign','name':config['name'],'status':state['campaign'],'review_token':'a'*64,'config':config}] if config else []
  messages=[{'id':'message','campaign_id':'campaign','customer_id':'a','name':'Alex Morgan','company':'Northstar Studio','email':'alex@example.com','subject':config['steps'][0]['subject'].replace('{{company}}','Northstar Studio'),'body':config['steps'][0]['body'].replace('{{name}}','Alex Morgan').replace('{{company}}','Northstar Studio')+'\n\n'+config['postal_address']+'\nTo stop these messages, reply STOP or unsubscribe.','step':0,'status':status,'due_at':'2026-10-21T09:00:00Z','provider_id':'receipt-1' if status=='sent' else None,'last_error':None}] if config else []
  route.fulfill(json={'defaults':state['defaults'],'worker':{'last_checked_at':None,'last_success_at':None,'last_error':None,'interval_seconds':30},'campaigns':campaigns,'messages':messages,'daily':{'day':'2026-10-21','time_zone':'UTC','sent_today':1 if status=='sent' else 0,'awaiting_review':1 if config and status=='draft' else 0,'needs_attention':0,'approved_due':0,'awaiting_receipt':0}})
 context.route('**/api/crm/outreach**',outreach)
 context.route('https://fixture.supabase.co/rest/v1/crm_customers*',lambda route:route.fulfill(json=[{'id':'a','workspace_id':W,'company':'Northstar Studio','name':'Alex Morgan','email':'alex@example.com','industry':'Design services','suppressed':False,'identity_review_required':False}]))
 page=context.new_page();page.clock.install();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
 page.goto('http://127.0.0.1:3188/?outreach');page.wait_for_load_state('networkidle')
 expect(page.get_by_role('heading',name='Start with one useful conversation.')).to_be_visible()
 page.get_by_label('Business name',exact=True).fill('Example Studio')
 page.get_by_label('Default offer or next step',exact=True).fill('A website consultation for your next launch.')
 page.get_by_label('Business postal address',exact=True).fill('100 Example Road, Test City')
 page.get_by_label('Booking page link',exact=True).fill('https://calendar.google.com/calendar/appointments/schedules/fixture')
 page.get_by_role('button',name='Save business details',exact=True).click()
 expect(page.get_by_role('status')).to_contain_text('Business details saved')
 assert state['defaults']['business_name']=='Example Studio'
 page.get_by_role('button',name='New campaign',exact=True).click()
 expect(page.get_by_role('heading',name='What would you like to do?')).to_be_visible()
 page.screenshot(path=str(out/'campaign-goals.png'),full_page=True)
 page.get_by_role('button',name='Introduce your business',exact=False).click()
 expect(page.get_by_label('Business name',exact=True)).to_have_value('Example Studio')
 expect(page.get_by_label('What are you offering',exact=False)).to_have_value('A website consultation for your next launch.')
 expect(page.get_by_label('Business postal address')).to_have_value('100 Example Road, Test City')
 expect(page.get_by_label('Booking link (optional)',exact=True)).to_have_value(state['defaults']['booking_url'])
 expect(page.get_by_text('1 selected',exact=True)).to_be_visible()
 page.clock.run_for(300)
 expect(page.get_by_role('button',name='Prepare messages',exact=False)).to_be_enabled()
 page.get_by_role('button',name='Prepare messages',exact=False).click()
 expect(page.get_by_label('Run this exact follow-up',exact=False)).to_be_checked()
 page.get_by_role('button',name='Review setup',exact=False).click()
 expect(page.get_by_role('heading',name='Preview for Northstar Studio')).to_be_visible()
 assert state['actions']==[],'Setup and previews must not save or send'
 page.get_by_role('button',name='Save for final review').click()
 expect(page.get_by_role('heading',name='Introduce your business',exact=True)).to_be_visible()
 run=page.get_by_role('button',name='Run campaign',exact=True)
 expect(run).to_be_disabled()
 assert state['actions']==['create'],'Saving must leave the campaign paused'
 expect(page.get_by_text('Hi Alex Morgan,',exact=False).first).to_be_visible()
 page.screenshot(path=str(out/'campaign-review.png'),full_page=True)
 page.get_by_label('I reviewed this audience',exact=False).check()
 run.click()
 expect(page.get_by_role('status')).to_contain_text('Campaign is running')
 assert state['actions']==['create','launch'],'One launch after explicit review; never separate hidden approvals'
 state['status']='sent'
 page.clock.fast_forward(21000)
 expect(page.get_by_text('Provider receipt: receipt-1')).to_be_visible()
 page.get_by_role('button',name='Results',exact=True).click()
 results=page.get_by_role('region',name='Outreach results')
 expect(results).to_contain_text('Provider receipts are recorded')
 state['failed']=True
 page.get_by_role('button',name='Refresh campaigns').click()
 expect(results).to_contain_text('last results may be out of date')
 expect(page.get_by_role('alert')).to_contain_text('Mail connection unavailable')
 page.set_viewport_size({'width':390,'height':844})
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'Campaigns must fit mobile'
 page.screenshot(path=str(out/'campaign-mobile.png'),full_page=True)
 assert not errors,errors
 browser.close()
