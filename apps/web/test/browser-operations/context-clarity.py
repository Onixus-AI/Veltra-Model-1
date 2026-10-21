import base64,json,time
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
out=Path('work/operations-screenshots');out.mkdir(parents=True,exist_ok=True)
encode=lambda value:base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
expiry=int(time.time())+3600
session={'access_token':encode({'alg':'HS256'})+'.'+encode({'sub':'00000000-0000-4000-8000-000000000003','exp':expiry,'role':'authenticated'})+'.fixture','refresh_token':'fixture-refresh','expires_at':expiry,'expires_in':3600,'token_type':'bearer','user':{'id':'00000000-0000-4000-8000-000000000003','aud':'authenticated','role':'authenticated','email':'owner@example.test','app_metadata':{},'user_metadata':{}}}
with sync_playwright() as p:
 browser=p.chromium.launch();context=browser.new_context(viewport={'width':1280,'height':1000})
 context.add_init_script('localStorage.setItem("sb-fixture-auth-token",'+json.dumps(json.dumps(session))+')')
 page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
 page.route('**/api/**',lambda route:route.fulfill(json={'connected':False,'items':[],'campaigns':[],'messages':[]}))
 page.goto('http://127.0.0.1:3188/?memory-states');page.wait_for_load_state('networkidle')
 state=page.get_by_label('Memory state',exact=True)
 state.select_option('active');expect(page.locator('.crm-memory-card')).to_have_count(1)
 expect(page.locator('.crm-memory-card')).to_contain_text('Illustrative discovery call')
 state.select_option('expired');expect(page.locator('.crm-memory-card')).to_have_count(1)
 expect(page.locator('.crm-memory-card')).to_contain_text('Not included in customer context.')
 state.select_option('all');page.get_by_role('textbox',name='Search memory').fill('Northstar');expect(page.locator('.crm-memory-card')).to_have_count(3)
 page.get_by_role('textbox',name='Search memory').fill('No matching fact');expect(page.get_by_text('No facts match these filters.')).to_be_visible()
 page.goto('http://127.0.0.1:3188/?shell&embedded=1');page.wait_for_load_state('networkidle')
 nav=page.get_by_role('navigation',name='Main navigation')
 nav.get_by_role('button',name='Memory',exact=True).click();page.screenshot(path=str(out/'crm-memory-library.png'),full_page=True)
 nav.get_by_role('button',name='Connections',exact=True).click()
 expect(page.get_by_text('Preview · not checked',exact=True)).to_be_visible()
 expect(page.get_by_role('heading',name='Integration roadmap')).to_be_visible()
 logo=page.locator('img[src="/brands/stripe.svg"]');page.wait_for_function('()=>document.querySelector(\'img[src="/brands/stripe.svg"]\')?.naturalWidth>0')
 assert logo.evaluate('(el)=>getComputedStyle(el).filter')=='none'
 page.screenshot(path=str(out/'crm-connections-roadmap.png'),full_page=True)
 nav.get_by_role('button',name='Sources',exact=True).click()
 expect(page.get_by_text('Preview · research connection not checked.',exact=True)).to_be_visible()
 page.wait_for_function('()=>document.querySelector(\'img[src="/brands/googlemaps.png"]\')?.naturalWidth>0')
 held=[];failed={'value':False}
 def mail(route):
  if failed['value']:route.fulfill(status=503,json={'error':'Provider unavailable'})
  else:held.append(route)
 page.route('**/api/crm/mail',mail)
 page.goto('http://127.0.0.1:3188/?mail-connection');page.wait_for_load_state('domcontentloaded')
 expect(page.get_by_text('Checking connection…',exact=True)).to_be_visible()
 expect(page.get_by_role('button',name='Connect Mail',exact=True)).to_be_disabled()
 page.wait_for_timeout(50);assert held
 held.pop(0).fulfill(json={'connected':True,'workspace_id':'11111111-1111-4111-8111-111111111111','pending':2,'blocked':1})
 expect(page.get_by_text('Connected to this workspace',exact=True)).to_be_visible()
 failed['value']=True;page.get_by_role('button',name='Refresh status',exact=True).click()
 expect(page.get_by_text('Status unavailable',exact=True)).to_be_visible()
 expect(page.get_by_role('button',name='Disconnect',exact=True)).to_be_disabled()
 page.get_by_role('button',name='Switch test business').click()
 expect(page.get_by_text('Connected to this workspace',exact=True)).to_have_count(0)
 page.set_viewport_size({'width':390,'height':844});page.goto('http://127.0.0.1:3188/?shell&embedded=1');page.wait_for_load_state('networkidle')
 page.get_by_role('navigation',name='Main navigation').get_by_role('button',name='Memory',exact=True).click()
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 assert not errors,errors
 browser.close()
