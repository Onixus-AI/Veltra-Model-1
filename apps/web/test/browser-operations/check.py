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
 def database(route):
  from urllib.parse import urlparse,parse_qs
  req=route.request;url=urlparse(req.url);query=parse_qs(url.query);table=url.path.split('/')[-1]
  if req.method=='OPTIONS':return route.fulfill(status=200,headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,HEAD,OPTIONS'})
  assert req.method in ['GET','HEAD'], 'Monitor must be read only'
  assert query.get('workspace_id') in [['eq.'+W],['eq.'+W2]], 'Every read must select a business'
  state['requests'].append(req.url)
  second=query['workspace_id']==['eq.'+W2]
  headers={'access-control-allow-origin':'*','access-control-expose-headers':'content-range','content-range':'0-0/'+('0' if second else '3')}
  if table=='crm_discovery_sources' and state['failed']:return route.fulfill(status=503,json={'message':'unavailable'},headers=headers)
  rows=[]
  if not second and table=='crm_discovery_sources':rows=[{'id':'s','label':'Published business research','enabled':True,'imported':18,'enriched':7,'last_error':'Research provider needs attention' if state['research_error'] else None,'last_run_at':'2026-10-20T12:00:00Z','next_run_at':'2026-10-21T09:00:00Z','exhausted_at':None}]
  if not second and table=='crm_activity':rows=[{'id':'event-1','title':'Acme Studio customer record updated','kind':'customer_update','created_at':'2026-10-20T12:00:00Z'}]
  route.fulfill(status=200,body='' if req.method=='HEAD' else json.dumps(rows),headers={**headers,'content-type':'application/json'})
 def outreach(route):
  assert route.request.method=='GET'
  second=W2 in route.request.url
  route.fulfill(json={'campaigns':[],'messages':[] if second else [{'id':'draft','company':'Acme Studio','subject':'Introduction','status':'draft','due_at':'2026-10-21T09:00:00Z','last_error':None}]})
 context.route('https://fixture.supabase.co/**',database)
 context.route('**/api/crm/outreach?*',outreach)
 page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
 page.goto('http://127.0.0.1:3188');page.wait_for_load_state('networkidle')
 expect(page.get_by_text('Acme Studio customer record updated',exact=True)).to_be_visible()
 expect(page.get_by_text('1 messages await approval',exact=True)).to_be_visible()
 assert page.locator('.ops-toast').count()==0, 'Existing alerts must not flood popups on arrival'
 expect(page.get_by_text('Scheduled · 18 imported · 7 enriched',exact=True)).to_be_visible()
 page.screenshot(path=str(out/'desktop.png'),full_page=True)
 state['research_error']=True;page.get_by_role('button',name='Refresh business activity').click()
 expect(page.locator('.ops-toast')).to_contain_text('Research needs attention')
 page.get_by_role('button',name='Dismiss activity notification').click()
 page.get_by_role('button',name='Refresh business activity').click();page.wait_for_load_state('networkidle')
 assert page.locator('.ops-toast').count()==0, 'Unchanged alert must not repeat'
 page.get_by_role('button',name='Pause live view').click();expect(page.get_by_text('View paused',exact=True)).to_be_visible()
 assert page.get_by_role('button',name='Refresh business activity').is_disabled()
 page.get_by_role('button',name='Resume live view').click();page.wait_for_load_state('networkidle')
 state['failed']=True;page.get_by_role('button',name='Refresh business activity').click()
 expect(page.get_by_text('Could not check:',exact=False)).to_contain_text('Research')
 assert page.get_by_text('Published business research',exact=True).count()==0, 'Failed source cannot display old success'
 page.get_by_label('Test business').select_option(W2);page.wait_for_load_state('networkidle')
 assert page.get_by_text('Acme Studio customer record updated',exact=True).count()==0, 'No cross-business receipts'
 assert page.locator('.ops-toast').count()==0
 state['failed']=False;page.get_by_label('Test business').select_option(W);page.wait_for_load_state('networkidle')
 page.get_by_role('button',name='Review',exact=False).first.click();expect(page.locator('#destination')).to_have_text('Memory')
 page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(out/'mobile.png'),full_page=True)
 assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'No horizontal overflow on mobile'
 page.goto('http://127.0.0.1:3188/?compact&working');page.wait_for_load_state('networkidle')
 expect(page.get_by_text('Chat is working',exact=True)).to_be_visible()
 assert page.get_by_role('heading',name='Work receipts').count()==0
 page.get_by_role('button',name='Show activity details').click();expect(page.get_by_role('heading',name='Work receipts')).to_be_visible()
 page.screenshot(path=str(out/'compact.png'),full_page=True)
 assert not errors, errors
 assert state['requests']
 browser.close()
 print('Operations browser checks passed: real data, read-only scoped reads, review navigation, notification deduplication, pause, failures, business switch, mobile and compact Chat.')
