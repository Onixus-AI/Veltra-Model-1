import re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
out=Path('work/operations-screenshots');out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch()
 page=browser.new_page(viewport={'width':1280,'height':1000})
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:3188/?dialog');page.wait_for_load_state('networkidle')
 trigger=page.get_by_role('button',name='Add test customer',exact=True)
 trigger.click()
 dialog=page.get_by_role('dialog',name='Add a customer',exact=True)
 company=dialog.get_by_role('textbox',name='Company Required',exact=True)
 expect(company).to_be_focused()
 assert dialog.evaluate('(el)=>el.matches(":modal")'),'Customer entry must be a native modal'
 assert dialog.evaluate('(el)=>getComputedStyle(el).backgroundColor')=='rgb(0, 0, 0)'
 for _ in range(18):
  page.keyboard.press('Tab');expect(trigger).not_to_be_focused()
 dialog.get_by_role('button',name='Save customer',exact=True).click()
 expect(dialog).to_be_visible();assert not company.evaluate('(el)=>el.validity.valid')
 company.fill('Retry Studio')
 dialog.get_by_label('Email',exact=True).fill('person@example.test')
 dialog.get_by_role('button',name='Save customer',exact=True).click()
 expect(dialog.get_by_role('button',name='Close customer form')).to_be_disabled()
 page.keyboard.press('Escape');expect(dialog).to_be_visible()
 expect(dialog.get_by_role('alert')).to_contain_text('Your entries are still here.')
 expect(company).to_have_value('Retry Studio')
 expect(dialog.get_by_label('Email',exact=True)).to_have_value('person@example.test')
 page.screenshot(path=str(out/'crm-customer-form-error.png'))
 company.fill('New Studio')
 dialog.get_by_role('button',name='Save customer',exact=True).click()
 expect(dialog).not_to_be_visible();expect(trigger).to_be_focused()
 expect(page.locator('output')).to_have_text('New Studio')
 trigger.click();page.keyboard.press('Escape')
 expect(dialog).not_to_be_visible();expect(trigger).to_be_focused()
 trigger.click();dialog.get_by_role('button',name='Cancel',exact=True).click()
 expect(dialog).not_to_be_visible();expect(trigger).to_be_focused()
 page.set_viewport_size({'width':390,'height':844});trigger.click()
 expect(company).to_be_focused()
 box=dialog.bounding_box();assert box['x']>=0 and box['x']+box['width']<=390
 assert dialog.evaluate('(el)=>el.scrollWidth<=el.clientWidth'),'Form must not overflow horizontally'
 for label in ['Email','Business phone','Website','Location']:
  assert dialog.get_by_label(label,exact=True).bounding_box()['height']>=44
 page.screenshot(path=str(out/'crm-customer-form-mobile.png'))
 assert not errors,errors
 browser.close()
