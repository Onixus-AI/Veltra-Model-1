import json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
out=Path('work/workspace-screenshots');out.mkdir(parents=True,exist_ok=True)
BUSINESS='11111111-1111-4111-8111-111111111111'
with sync_playwright() as p:
 browser=p.chromium.launch()
 page=browser.new_page(viewport={'width':1440,'height':1000})
 errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
 def api(route):
  path=route.request.url
  if '/api/agent-runs' in path:data={'runs':[]}
  elif '/api/crm/connection' in path:data={'connected':False}
  else:data={'connected':False,'items':[],'conversations':[]}
  route.fulfill(status=200,content_type='application/json',body=json.dumps(data))
 page.route('**/api/**',api)
 page.goto('http://127.0.0.1:3187/?mode=business&workspace='+BUSINESS);page.wait_for_load_state('networkidle')
 nav=page.get_by_role('navigation',name='Workspace tools',exact=True)
 preset=page.get_by_role('combobox',name='Workspace preset',exact=True)
 expect(nav).to_be_visible()
 expect(page.get_by_role('button',name='Collapse sidebar',exact=True)).to_be_visible()
 assert page.locator('.workspace').evaluate('(el)=>getComputedStyle(el).backgroundColor')=='rgb(0, 0, 0)'
 assert page.locator('.workspace-topbar').evaluate('(el)=>getComputedStyle(el).backgroundImage')=='none'
 for name in ['Overview','Build & Growth','Business team','Onyx','CRM','Mail','Calendar','Signal','Docs & Sheets','Websites','Connections','Settings']:
  link=nav.get_by_role('link',name=name,exact=True)
  expect(link).to_be_visible()
  assert 'workspace='+BUSINESS in link.get_attribute('href'),name
 nav.get_by_role('button',name='Customize tools',exact=True).click()
 layout=page.get_by_role('dialog',name='Your workspace',exact=True)
 layout.get_by_label('Workspace name',exact=True).fill('Operations workspace')
 layout.get_by_role('checkbox',name='Calendar',exact=True).uncheck()
 layout.get_by_role('button',name='Save workspace',exact=True).click()
 expect(layout).not_to_be_visible();expect(nav.get_by_text('Operations workspace',exact=True)).to_be_visible()
 expect(nav.get_by_role('link',name='Calendar',exact=True)).to_have_count(0)
 page.reload();page.wait_for_load_state('networkidle')
 expect(nav.get_by_text('Operations workspace',exact=True)).to_be_visible()
 expect(nav.get_by_role('link',name='Calendar',exact=True)).to_have_count(0)
 nav.get_by_role('button',name='Customize tools',exact=True).click()
 layout.get_by_role('button',name='Reset tools',exact=True).click()
 layout.get_by_role('button',name='Save workspace',exact=True).click()
 expect(nav.get_by_role('link',name='Calendar',exact=True)).to_be_visible()
 page.wait_for_function('()=>document.querySelector(`img[alt="Onyx logo"]`)?.naturalWidth>0')
 page.screenshot(path=str(out/'workspace-initial.png'))
 page.locator('.workspace-more-tools > summary').click()
 preset.select_option('dev')
 for provider,asset in [('github','github.svg'),('vercel','vercel.svg'),('supabase','supabase.svg'),('railway','railway.svg'),('n8n','n8n.svg')]:
  mark=page.locator(f'#workspace-sidebar button[title="{provider}"] img')
  expect(mark).to_have_attribute('src',f'/brands/{asset}')
  page.wait_for_function('(src)=>{const el=document.querySelector(`img[src="${src}"]`);return el?.complete&&el.naturalWidth>0}',arg=f'/brands/{asset}')
  assert mark.evaluate('(el)=>getComputedStyle(el).filter')=='none'
 preset.select_option('business')
 nav.get_by_role('button',name='Customize appearance',exact=True).click()
 appearance=page.get_by_role('dialog',name='Appearance',exact=True)
 for accent in ['orange','red']:
  appearance.get_by_role('button',name=accent,exact=True).click()
  assert page.locator('html').get_attribute('data-workspace-accent')==accent
  assert page.evaluate("JSON.parse(localStorage.getItem('veltra-appearance-v1')).accent")==accent
 appearance.get_by_role('button',name='Reset appearance',exact=True).click()
 appearance.get_by_role('button',name='Done',exact=True).click()
 draft=page.get_by_role('textbox',name='Message Onixus Workspace')
 draft.fill('Keep this business draft')
 preset.select_option('creator')
 expect(page.get_by_role('heading',name='What will you create?')).to_be_visible()
 expect(draft).to_have_value('Keep this business draft')
 preset.select_option('business');expect(draft).to_have_value('Keep this business draft')
 preset.select_option('personal');expect(draft).to_have_value('Keep this business draft')
 expect(nav.get_by_role('link',name='CRM',exact=True)).to_be_visible()
 preset.select_option('creator')
 expect(page.get_by_role('button',name='Project files',exact=True)).to_be_visible()
 page.screenshot(path=str(out/'workspace-creator.png'))
 nav.get_by_role('link',name='CRM',exact=True).click()
 expect(page.locator('.workspace')).to_have_class(__import__('re').compile('canvas-full'))
 expect(page.locator('.chat-panel')).not_to_be_visible()
 preset.select_option('business')
 expect(page.locator('.canvas-heading')).to_contain_text('Onixus CRM')
 expect(page.locator('.workspace')).to_have_class(__import__('re').compile('canvas-full'))
 page.get_by_role('button',name='Collapse sidebar',exact=True).click()
 page.screenshot(path=str(out/'workspace-crm.png'))
 page.get_by_role('button',name='Ask Onyx',exact=True).click();expect(page.locator('.chat-panel')).to_be_visible()
 expect(draft).to_have_value('Keep this business draft')
 page.get_by_role('button',name='Hide Onyx',exact=True).click();expect(page.locator('.chat-panel')).not_to_be_visible()
 page.keyboard.press('Control+k');expect(page.get_by_role('dialog',name='Go anywhere')).to_be_visible()
 page.get_by_role('textbox',name='Find a workspace action').fill('Open Mail');page.keyboard.press('Enter')
 expect(page.get_by_role('dialog',name='Go anywhere')).not_to_be_visible();expect(page.locator('.canvas-heading')).to_contain_text('Onixus Mail')
 page.keyboard.press('Control+k');page.keyboard.press('Escape');expect(page.get_by_role('dialog',name='Go anywhere')).not_to_be_visible()
 page.get_by_role('button',name='Expand sidebar',exact=True).click()
 page.wait_for_function('()=>document.querySelector(`img[alt="Onixus Mail logo"]`)?.naturalWidth>0')
 page.screenshot(path=str(out/'workspace-mail.png'))
 page.set_viewport_size({'width':390,'height':844})
 if page.get_by_role('dialog',name='Workspace sidebar').count():page.keyboard.press('Escape')
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'Mobile shell must fit viewport'
 page.screenshot(path=str(out/'workspace-mobile.png'))
 page.get_by_role('button',name='Search workspace actions',exact=True).click()
 expect(page.get_by_role('dialog',name='Go anywhere')).to_be_visible()
 box=page.get_by_role('dialog',name='Go anywhere').bounding_box();assert box['x']>=0 and box['x']+box['width']<=390
 page.get_by_role('textbox',name='Find a workspace action').fill('nonsense')
 expect(page.get_by_role('dialog',name='Go anywhere').get_by_role('status')).to_contain_text('No matching actions')
 page.screenshot(path=str(out/'workspace-search-mobile.png'))
 page.goto('http://127.0.0.1:3187/?canvas=build&mode=dev')
 expect(page.get_by_role('heading',name='Give the team a task.')).to_be_visible()
 expect(page.get_by_role('button',name='Start team',exact=True)).to_be_disabled()
 page.screenshot(path=str(out/'workspace-super-coder.png'))
 assert not errors,errors
 browser.close()
