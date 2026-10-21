import json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
out=Path('work/workspace-screenshots');out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch()
 page=browser.new_page(viewport={'width':1440,'height':1000})
 errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
 def api(route):
  path=route.request.url
  if 'fixture.supabase.co' in path: data={}
  elif '/api/crm/connection' in path:data={'connected':False}
  else:data={'connected':False,'items':[],'conversations':[]}
  route.fulfill(status=200,content_type='application/json',body=json.dumps(data))
 page.route('**/api/**',api);page.route('https://fixture.supabase.co/**',api)
 page.goto('http://127.0.0.1:3187/?mode=business');page.wait_for_load_state('networkidle')
 page.screenshot(path=str(out/'workspace-initial.png'))
 assert not errors,errors
 expect(page.get_by_role('button',name='Expand sidebar',exact=True)).to_be_visible()
 assert page.locator('.workspace').evaluate('(el)=>getComputedStyle(el).backgroundColor')=='rgb(0, 0, 0)'
 assert page.locator('.workspace-sidebar nav svg').first.evaluate('(el)=>getComputedStyle(el).color')=='rgb(0, 229, 239)','Sidebar line icons must use Veltra cyan'
 page.get_by_role('textbox',name='Message Veltra').fill('Business draft to keep')
 page.get_by_role('button',name='Creator',exact=True).click()
 expect(page.get_by_role('heading',name='What will you create?')).to_be_visible()
 expect(page.get_by_role('textbox',name='Message Veltra')).to_have_value('')
 page.get_by_role('textbox',name='Message Veltra').fill('Creator draft to keep')
 page.get_by_role('button',name='Business',exact=True).click()
 expect(page.get_by_role('textbox',name='Message Veltra')).to_have_value('Business draft to keep')
 page.get_by_role('button',name='Creator',exact=True).click()
 expect(page.get_by_role('textbox',name='Message Veltra')).to_have_value('Creator draft to keep')
 page.get_by_role('button',name='Expand sidebar',exact=True).click()
 expect(page.get_by_role('button',name='Project files',exact=True)).to_be_visible()
 assert page.get_by_role('button',name='Veltra CRM',exact=True).count()==0
 page.screenshot(path=str(out/'workspace-creator.png'))
 page.get_by_role('button',name='Collapse sidebar',exact=True).click()
 page.get_by_role('button',name='Business',exact=True).click()
 page.get_by_role('button',name='Veltra CRM',exact=True).click()
 expect(page.locator('.workspace')).to_have_class(__import__('re').compile('canvas-full'))
 expect(page.locator('.chat-panel')).not_to_be_visible()
 page.screenshot(path=str(out/'workspace-crm.png'))
 page.get_by_role('button',name='Ask Veltra',exact=True).click()
 expect(page.locator('.chat-panel')).to_be_visible()
 page.get_by_role('button',name='Hide Chat',exact=True).click()
 expect(page.locator('.chat-panel')).not_to_be_visible()
 page.keyboard.press('Control+k')
 expect(page.get_by_role('dialog',name='Go anywhere')).to_be_visible()
 page.get_by_role('textbox',name='Find a workspace action').fill('Open Mail')
 page.keyboard.press('Enter')
 expect(page.get_by_role('dialog')).not_to_be_visible()
 expect(page.locator('.canvas-heading')).to_contain_text('Veltra Mail')
 page.keyboard.press('Control+k');page.keyboard.press('Escape')
 expect(page.get_by_role('dialog')).not_to_be_visible()
 page.get_by_role('button',name='Expand sidebar',exact=True).click()
 expect(page.get_by_role('button',name='Collapse sidebar',exact=True)).to_be_visible()
 page.screenshot(path=str(out/'workspace-mail.png'))
 page.set_viewport_size({'width':390,'height':844})
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'Mobile shell must fit viewport'
 page.screenshot(path=str(out/'workspace-mobile.png'))
 page.get_by_role('button',name='Search workspace actions',exact=True).click()
 expect(page.get_by_role('dialog')).to_be_visible()
 box=page.get_by_role('dialog').bounding_box();assert box['x']>=0 and box['x']+box['width']<=390
 page.get_by_role('textbox',name='Find a workspace action').fill('nonsense')
 expect(page.get_by_role('dialog').get_by_role('status')).to_contain_text('No matching actions')
 page.screenshot(path=str(out/'workspace-search-mobile.png'))
 assert not errors,errors
 browser.close()
