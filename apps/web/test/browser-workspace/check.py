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
  elif '/api/agent-runs' in path:data={'runs':[]}
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
 assert page.locator('#workspace-sidebar nav img').count()==0,'Navigation uses line icons, not product logos'
 icons=page.locator('#workspace-sidebar > nav:first-child > button svg,#workspace-sidebar > nav:first-child > a svg').evaluate_all('(els)=>els.map(el=>el.innerHTML)')
 assert len(icons)==len(set(icons)),'Each workspace destination needs a distinct icon'
 assert page.locator('.workspace-topbar').evaluate('(el)=>getComputedStyle(el).backgroundImage')=='none','Header must use a solid background'
 # Veltra shell surfaces remain opaque black; external provider marks retain identity.
 for selector in ['.workspace-sidebar','.composer','.workspace-modes']:
  assert page.locator(selector).first.evaluate('(el)=>getComputedStyle(el).backgroundColor')=='rgb(0, 0, 0)',selector
 page.get_by_role('button',name='Dev',exact=True).click()
 for provider,asset in [('github','github.svg'),('vercel','vercel.svg'),('supabase','supabase.svg'),('railway','railway.svg'),('n8n','n8n.svg')]:
  mark=page.locator(f'#workspace-sidebar button[title="{provider}"] img')
  expect(mark).to_have_attribute('src',f'/brands/{asset}')
  expect(mark).to_be_attached()
  page.wait_for_function('(src)=>{const el=document.querySelector(`img[src="${src}"]`);return el?.complete&&el.naturalWidth>0}',arg=f'/brands/{asset}')
  assert mark.evaluate('(el)=>getComputedStyle(el).filter')=='none'
 page.get_by_role('button',name='Business',exact=True).click()
 page.get_by_role('button',name='Customize workspace',exact=True).click()
 appearance=page.get_by_role('dialog',name='Make it yours.')
 for accent in ['orange','red']:
  appearance.get_by_role('button',name=accent,exact=True).click()
  assert page.locator('html').get_attribute('data-workspace-accent')==accent
  assert page.evaluate("JSON.parse(localStorage.getItem('veltra-appearance-v1')).accent")==accent
 appearance.get_by_role('button',name='Reset appearance',exact=True).click()
 appearance.get_by_role('button',name='Done',exact=True).click()
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
 page.goto('http://127.0.0.1:3187/?canvas=build&mode=dev')
 expect(page.get_by_role('heading',name='Give the team a task.')).to_be_visible()
 expect(page.get_by_role('button',name='Start team',exact=True)).to_be_disabled()
 page.screenshot(path=str(out/'workspace-super-coder.png'))
 assert not errors,errors
 browser.close()
