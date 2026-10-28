"""Real CRM route must render campaigns without requesting a full customer snapshot."""
import base64,json,time
from urllib.parse import urlparse,parse_qs
from playwright.sync_api import sync_playwright,expect
W='11111111-1111-4111-8111-111111111111';U='00000000-0000-4000-8000-000000000003'
encode=lambda v:base64.urlsafe_b64encode(json.dumps(v).encode()).decode().rstrip('=')
expiry=int(time.time())+3600
session={'access_token':encode({'alg':'HS256'})+'.'+encode({'sub':U,'exp':expiry,'role':'authenticated'})+'.fixture','refresh_token':'fixture-refresh','expires_at':expiry,'expires_in':3600,'token_type':'bearer','user':{'id':U,'aud':'authenticated','role':'authenticated','email':'owner@example.test','app_metadata':{},'user_metadata':{}}}
with sync_playwright() as p:
 browser=p.chromium.launch();context=browser.new_context(viewport={'width':1280,'height':1000})
 context.add_init_script('localStorage.setItem("sb-fixture-auth-token",'+json.dumps(json.dumps(session))+')')
 customer_queries=[];unexpected=[]
 def database(route):
  url=urlparse(route.request.url);table=url.path.split('/')[-1];query=parse_qs(url.query)
  if url.path=='/auth/v1/user':return route.fulfill(json=session['user'])
  if table=='crm_workspaces':return route.fulfill(json=[{'id':W,'name':'Test business','industry':'Logistics'}])
  if table=='crm_customers' and route.request.method=='HEAD':
   assert query.get('workspace_id')==['eq.'+W]
   return route.fulfill(status=200,headers={'content-range':'0-0/92258'})
  if table=='crm_customers':
   customer_queries.append(query)
   assert query.get('workspace_id')==['eq.'+W]
   assert query.get('limit')==['100'],'Campaigns must never fetch all customers'
   assert query.get('suppressed')==['eq.false']
   return route.fulfill(json=[{'id':'a','workspace_id':W,'company':'Northstar Studio','name':'Alex','email':'info@example.test','industry':'Logistics','suppressed':False,'identity_review_required':False}])
  if table in ['crm_deals','crm_tasks','crm_memories','crm_activity'] and query.get('select')==['*']:unexpected.append(table)
  return route.fulfill(json=[])
 context.route('https://fixture.supabase.co/**',database)
 context.route('**/api/**',lambda route:route.fulfill(json={'connected':False,'campaigns':[],'messages':[],'sources':[],'events':[],'unavailable':[]}))
 page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:3188/?live-crm&view=Automation&workspace='+W)
 expect(page.get_by_role('button',name='New campaign',exact=True)).to_be_enabled(timeout=10000)
 assert not customer_queries and not unexpected,'Campaign landing must not load any CRM snapshot tables'
 page.get_by_role('button',name='New campaign',exact=True).click()
 page.get_by_role('button',name='Introduce your business',exact=False).click()
 expect(page.get_by_text('Northstar Studio',exact=True)).to_be_visible()
 assert len(customer_queries)==1 and not unexpected
 page.get_by_label('Find customers',exact=True).fill('logistics')
 expect(page.get_by_text('Searching customers…')).not_to_be_visible()
 expect(page.get_by_text('Northstar Studio',exact=True)).to_be_visible()
 assert not errors,errors
 browser.close()
