from pathlib import Path
from playwright.sync_api import sync_playwright,expect
out=Path('work/operations-screenshots');out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch();page=browser.new_page(viewport={'width':1100,'height':650});errors=[];calls=[]
 page.on('pageerror',lambda error:errors.append(str(error)))
 mode='outage'
 def api(route):
  app=route.request.url.rsplit('/',1)[-1];calls.append((route.request.method,app));assert route.request.method=='GET'
  if mode=='signin':return route.fulfill(status=401,json={'error':'Sign in'})
  if app=='crm':return route.fulfill(json={'connected':True,'available':True,'has_workspace':True})
  if mode=='outage':return route.fulfill(status=502,json={'error':'Unavailable'})
  return route.fulfill(json={'connected':False})
 page.route('**/api/health-fixture/*',api)
 page.goto('http://127.0.0.1:3188/?connection-health');page.wait_for_load_state('networkidle')
 crm=page.get_by_role('article',name='CRM connection health');mail=page.get_by_role('article',name='Mail connection health')
 expect(crm).to_contain_text('Workspace link verified');expect(mail).to_contain_text('Service unavailable')
 assert page.locator('.connection-health').evaluate('el=>getComputedStyle(el).backgroundColor')=='rgb(0, 0, 0)'
 assert crm.locator('.health-signal').evaluate('el=>getComputedStyle(el).animationName')=='none'
 page.screenshot(path=str(out/'connection-health-desktop.png'),full_page=True)
 mode='disconnected';page.get_by_role('button',name='Recheck connections').click();expect(mail).to_contain_text('Not connected')
 mode='signin';page.get_by_role('button',name='Recheck connections').click();expect(crm).to_contain_text('Sign in required');expect(mail).to_contain_text('Sign in required')
 expect(crm).not_to_contain_text('Workspace link verified')
 page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 page.screenshot(path=str(out/'connection-health-mobile.png'),full_page=True)
 # Hold checks in flight to inspect motion, then verify reduced-motion handling.
 page.unroute('**/api/health-fixture/*',api)
 held=[]
 page.route('**/api/health-fixture/*',lambda route:held.append(route))
 page.get_by_role('button',name='Recheck connections').click();expect(page.get_by_role('button',name='Checking…')).to_be_disabled()
 signal=crm.locator('.health-signal')
 assert signal.evaluate('el=>getComputedStyle(el).animationName')=='health-signal-travel'
 page.screenshot(path=str(out/'connection-health-checking.png'),full_page=True)
 page.emulate_media(reduced_motion='reduce');assert signal.evaluate('el=>getComputedStyle(el).animationName')=='none'
 expect(crm.get_by_role('img',name='CRM: Checking…')).to_be_visible()
 assert not errors,errors
 browser.close()
print('Connection health verified: independent states, read-only checks, recheck, mobile and reduced motion.')
