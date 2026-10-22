import json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
out=Path('work/operations-screenshots');out.mkdir(parents=True,exist_ok=True)
records=[];attempts=[];viewer=False;workspace_fail=True;save_fail=True
with sync_playwright() as p:
 browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':1000});errors=[]
 page.on('pageerror',lambda error:errors.append(str(error)))
 def workspace_api(route):
  global workspace_fail
  body=route.request.post_data_json
  if workspace_fail:workspace_fail=False;return route.fulfill(status=503,json={'error':'Could not confirm workspace. Reload before retrying.'})
  return route.fulfill(json={'id':'fixture-new-workspace','name':body['name']})
 def enquiry_api(route):
  global save_fail
  if route.request.method=='GET':return route.fulfill(json={'items':records,'canWrite':not viewer})
  body=route.request.post_data_json;assert body['workspace_id']=='fixture-workspace' and body['customer_id']=='fixture-customer'
  if route.request.method=='POST':
   attempts.append(body)
   if save_fail:save_fail=False;return route.fulfill(status=502,json={'error':'Save could not be confirmed. Entries retained.'})
   row={**body,'status':'new','created_at':body['received_at']};records.append(row);return route.fulfill(json=row)
  row=next(item for item in records if item['id']==body['id']);assert row['status']==body['before'];row['status']=body['status'];return route.fulfill(json=row)
 page.route('**/api/workspace-fixture',workspace_api);page.route('**/api/intake-fixture*',enquiry_api)
 page.goto('http://127.0.0.1:3188/?crm-intake');page.wait_for_load_state('networkidle')
 page.get_by_role('button',name='New workspace',exact=True).click();dialog=page.get_by_role('dialog',name='New workspace')
 expect(dialog.get_by_label('Business name')).to_be_focused();dialog.get_by_label('Business name').fill('Fictional Transport Pilot');dialog.get_by_label('Industry',exact=True).fill('Transport')
 dialog.get_by_role('button',name='Create workspace').click();expect(dialog.get_by_role('alert')).to_contain_text('Could not confirm');expect(dialog.get_by_label('Business name')).to_have_value('Fictional Transport Pilot')
 dialog.get_by_role('button',name='Create workspace').click();expect(dialog).not_to_be_visible();expect(page.get_by_label('Selected workspace')).to_have_text('Fictional Transport Pilot')
 panel=page.get_by_role('region',name='Customer enquiries');panel.get_by_label('Enquiry subject').fill('Fictional transport quote');panel.get_by_label('Customer request').fill('Please quote a local collection. Fictional test data.')
 panel.get_by_role('button',name='Save enquiry').click();expect(panel.get_by_role('alert')).to_contain_text('Save could not be confirmed');expect(panel.get_by_label('Customer request')).to_have_value('Please quote a local collection. Fictional test data.')
 panel.get_by_role('button',name='Save enquiry').click();expect(panel.get_by_role('status')).to_contain_text('Enquiry saved');assert attempts[0]['id']==attempts[1]['id'];assert len(records)==1
 page.reload();page.wait_for_load_state('networkidle');expect(panel.get_by_role('heading',name='Fictional transport quote')).to_be_visible()
 panel.get_by_label('Status for Fictional transport quote').select_option('closed');expect(panel.get_by_role('status')).to_contain_text('status saved')
 page.screenshot(path=str(out/'crm-enquiries-desktop.png'),full_page=True)
 viewer=True;page.reload();page.wait_for_load_state('networkidle');expect(panel.get_by_role('button',name='Save enquiry')).to_be_disabled();expect(panel.get_by_label('Status for Fictional transport quote')).to_be_disabled()
 page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 page.get_by_role('button',name='New workspace',exact=True).click();expect(dialog).to_be_visible();page.screenshot(path=str(out/'crm-workspace-mobile.png'),full_page=True);page.keyboard.press('Escape');expect(dialog).not_to_be_visible()
 assert not errors,errors
 browser.close()
print('CRM intake verified: workspace form, failed saves, stable retry ID, enquiry reload/status, viewer and mobile.')
