import os
import json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
out=Path('work/operations-screenshots');out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(channel=os.environ.get('VELTRA_TEST_BROWSER_CHANNEL') or None);page=browser.new_page(viewport={'width':1280,'height':900})
 page.add_init_script("sessionStorage.setItem('veltra-api-key','fixture-access')")
 tasks={};provider={'calls':0};errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
 def consent(route):
  b=route.request.post_data_json;task=b['task_id'];action=b['action']
  if action=='start':tasks[task]={'decision':None,'ended':False};return route.fulfill(json={'task_id':task})
  assert task in tasks
  if action=='finish':tasks[task]['ended']=True;return route.fulfill(json={'completed':True})
  if action=='decide':tasks[task]['decision']=b['allowed'];return route.fulfill(json={'allowed':b['allowed']})
  decision=tasks[task]['decision']
  if decision is None:return route.fulfill(status=428,json={'access_required':{'app':'mail'}})
  route.fulfill(status=200 if decision else 403,json={'allowed':decision})
 def mail(route):
  task=route.request.post_data_json['task_id'];state=tasks.get(task)
  if not state or state['decision'] is None:return route.fulfill(status=428,json={'access_required':{'app':'mail','reason':'Read matching Mail records for this task.'}})
  assert not state['ended']
  if not state['decision']:return route.fulfill(status=403,json={'error':'Denied'})
  provider['calls']+=1;route.fulfill(json={'receipt':'Mail record checked'})
 page.route('**/api/ai-access',consent);page.route('**/fixture/mail',mail)
 page.goto('http://127.0.0.1:3188/?task-consent');page.wait_for_load_state('networkidle')
 run=page.get_by_role('button',name='Run Mail task',exact=True)
 run.click();dialog=page.get_by_role('dialog',name='Allow access to Veltra Mail?',exact=True)
 expect(dialog.get_by_role('button',name='Deny',exact=True)).to_be_focused()
 assert provider['calls']==0
 expect(page.get_by_text('Background Mail automation remains running.')).to_be_attached()
 page.screenshot(path=str(out/'task-mail-permission-desktop.png'))
 dialog.get_by_role('button',name='Deny',exact=True).click()
 expect(page.get_by_role('status')).to_have_text('Access denied. No Mail action ran.')
 expect(run).to_be_enabled()
 assert provider['calls']==0;assert all(t['ended'] for t in tasks.values())
 run.click();expect(dialog).to_be_visible();dialog.get_by_role('button',name='Allow for this task',exact=True).click()
 expect(page.get_by_role('status')).to_have_text('Mail task complete.')
 expect(run).to_be_enabled()
 assert provider['calls']==2;assert len(tasks)==2;assert all(t['ended'] for t in tasks.values())
 page.set_viewport_size({'width':390,'height':844});run.click();expect(dialog).to_be_visible()
 box=dialog.bounding_box();assert box['x']>=0 and box['x']+box['width']<=390
 page.screenshot(path=str(out/'task-mail-permission-mobile.png'))
 page.keyboard.press('Escape');expect(dialog).not_to_be_visible()
 expect(page.get_by_role('status')).to_have_text('Access denied. No Mail action ran.')
 expect(run).to_be_enabled()
 assert len(tasks)==3;assert provider['calls']==2;assert all(t['ended'] for t in tasks.values())
 assert not errors,errors
 browser.close()
