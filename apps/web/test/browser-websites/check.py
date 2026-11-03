import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
out=Path('work/website-screenshots');out.mkdir(parents=True,exist_ok=True)
source='<!doctype html><html><head><style>h1{color:red}</style></head><body><h1>Imported customer site</h1><script>document.body.innerHTML="SCRIPT EXECUTED"</script></body></html>'
receipt='00000000-0000-4000-8000-000000000099'
with sync_playwright() as p:
 browser=p.chromium.launch()
 page=browser.new_page(viewport={'width':1440,'height':1000},accept_downloads=True)
 requests=[];balance=[0];saved={};publishing=[False];deployed=[False];merges=[];website_limit=[60000]
 def api(route):
  request=route.request
  if '/api/account' in request.url:return route.fulfill(json={'credits_remaining':balance[0]})
  if '/api/brand/upload' in request.url:
   import base64
   payload=request.post_data_json;text=base64.b64decode(payload['data']).decode();saved.update(text=text,file={'id':receipt,'name':payload['name'],'size':len(text.encode()),'created_at':'2026-11-03','deleted_at':None})
   return route.fulfill(json={'file':saved['file']})
  if '/api/brand/files' in request.url:return route.fulfill(json={'files':[saved['file']] if saved else []})
  if '/api/brand/download' in request.url:return route.fulfill(body=saved['text'],content_type='application/json')
  if '/api/connections/status' in request.url:return route.fulfill(json={'connections':[{'provider':'github','connected':True,'selection':{'id':'owner/site','name':'owner/site','branch':'main'}},{'provider':'vercel','connected':True,'selection':{'id':'project','name':'Booking site'}}]})
  if '/api/connections/github/development-policy' in request.url:return route.fulfill(json={'publishing_enabled':publishing[0],'website_artifact_max_bytes':website_limit[0]})
  if '/api/connections/github/change-set' in request.url:
   payload=request.post_data_json
   return route.fulfill(json={'repository':'owner/site','branch':'main','connection_version':1,'base_sha':'a'*40,'title':payload['title'],'files':payload['files'],'before':[{'path':'index.html','content':None}]})
  if '/api/connections/github/pull-request-set' in request.url:return route.fulfill(json={'url':'https://github.com/owner/site/pull/7'})
  if '/api/connections/github/release-review' in request.url:return route.fulfill(json={'ticket':'fixture-ticket','repository':'owner/site','pull_request':7,'commit_sha':'a'*40,'summary':'Merge this exact reviewed head after approval.'})
  if '/api/connections/github/release-status' in request.url:return route.fulfill(json={'status':'completed' if deployed[0] else 'unverified','receipt':{'repository':'owner/site','pull_request':7,'commit_sha':'b'*40,'target':'production','state':'READY','url':'https://booking-preview.vercel.app'} if deployed[0] else None})
  if '/api/connections/github/release' in request.url:
   merges.append(request.post_data_json);return route.fulfill(json={'status':'completed','receipt':{'repository':'owner/site','pull_request':7,'reviewed_head':'a'*40,'merge_sha':'b'*40}})
  if '/api/agent-runs' in request.url:
   if request.method=='POST':
    payload=request.post_data_json;requests.append(payload)
    assert 'Imported customer site' in payload['context']
    assert payload['mode']=='design' and payload['create_image'] is False
    return route.fulfill(json={'id':receipt,'status':'queued','stage':'queued','credits_used':0})
   return route.fulfill(json={'id':receipt,'status':'completed','stage':'review','credits_used':321,'state':{'artifacts':{'files':[{'path':'index.html','content':'<!doctype html><html><body><h1>Revised by Onyx fixture</h1></body></html>'}]}}})
  route.fulfill(json={'connected':False})
 page.route('**/api/**',api)
 page.goto('http://127.0.0.1:3190/');page.wait_for_load_state('networkidle')
 with page.expect_file_chooser() as chooser:page.get_by_role('button',name='Import HTML',exact=True).click()
 chooser.value.set_files({'name':'customer.html','mimeType':'text/html','buffer':source.encode()})
 frame=page.frame_locator('iframe[title="Imported HTML preview"]')
 expect(frame.get_by_role('heading',name='Imported customer site')).to_be_visible()
 assert frame.locator('script').count()==0
 expect(page.get_by_role('button',name='Download project',exact=True)).to_be_enabled()
 page.get_by_role('button',name='Edit HTML',exact=True).click()
 expect(page.get_by_label('Website HTML source')).to_have_value(source)
 page.get_by_label('What should Onyx do?',exact=True).fill('Make the heading more clear.')
 page.get_by_role('button',name='Ask Onyx',exact=True).click()
 expect(page.get_by_role('alert')).to_contain_text('Nothing has started')
 assert not requests, 'Insufficient credits must stop before starting a task'
 balance[0]=100000
 page.get_by_role('button',name='Ask Onyx',exact=True).click()
 expect(page.get_by_text('HTML revision received',exact=True)).to_be_visible(timeout=15000)
 expect(frame.get_by_role('heading',name='Revised by Onyx fixture')).to_be_visible()
 assert len(requests)==1
 expect(page.get_by_text('321 credits used',exact=False)).to_be_visible()
 page.get_by_role('button',name='Undo Onyx revision',exact=True).click()
 expect(frame.get_by_role('heading',name='Imported customer site')).to_be_visible()
 with page.expect_download() as download:page.get_by_role('button',name='Export HTML',exact=True).click()
 assert Path(download.value.path()).read_text()==source, 'Export preserves original HTML, including original scripts'
 page.set_viewport_size({'width':390,'height':844})
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 assert page.locator('.website-onyx-sidebar').bounding_box()['y'] < page.locator('.website-workbench-canvas').bounding_box()['y'], 'Mobile prompt must precede the tall website preview'
 page.screenshot(path=str(out/'html-import-mobile.png'),full_page=True)
 # Script-rendered .htm imports stay inert until isolated preview is enabled.
 app_source='<!doctype html><html lang="en" class="dark"><body style="background:#101010;color:white"><div id="root"></div><script type="module">document.getElementById(\'root\').innerHTML=\'<h1>Booking app fixture</h1><button id="count">Bookings: 0</button>\';let count=0;document.getElementById(\'count\').onclick=()=>document.getElementById(\'count\').textContent=\'Bookings: \'+(++count);try{window.parent.document.body.setAttribute(\'data-preview-escaped\',\'yes\')}catch{};fetch(\'http://127.0.0.1:3190/blocked-preview-probe\').catch(()=>{});</script></body></html>'
 probes=[]
 page.route('**/blocked-preview-probe',lambda route:(probes.append(route.request.url),route.fulfill(status=200,body='blocked probe unexpectedly reached server')))
 before=len(requests)
 with page.expect_file_chooser() as chooser:page.get_by_role('button',name='Import HTML',exact=True).click()
 chooser.value.set_files({'name':'booking-app.htm','mimeType':'text/html','buffer':app_source.encode()})
 expect(page.get_by_text('This file contains scripts.',exact=False)).to_be_visible()
 expect(frame.get_by_role('heading',name='Booking app fixture')).to_have_count(0)
 page.get_by_role('button',name='Enable interactive preview',exact=True).click()
 expect(frame.get_by_role('heading',name='Booking app fixture')).to_be_visible()
 frame.get_by_role('button',name='Bookings: 0',exact=True).click()
 expect(frame.get_by_role('button',name='Bookings: 1',exact=True)).to_be_visible()
 assert page.locator('iframe[title="Imported HTML preview"]').get_attribute('sandbox')=='allow-scripts'
 assert page.locator('body').get_attribute('data-preview-escaped') is None
 assert not probes, 'Imported scripts cannot make network requests'
 assert len(requests)==before, 'Previewing an imported app must not start an AI task'
 assert frame.locator('body').evaluate('(body)=>getComputedStyle(body).backgroundColor')=='rgb(16, 16, 16)'
 page.get_by_role('button',name='View website',exact=True).click()
 assert page.locator('#website-preview').evaluate('(node)=>node===document.activeElement')
 page.screenshot(path=str(out/'interactive-htm-mobile.png'),full_page=True)
 with page.expect_download() as project_download:page.get_by_role('button',name='Download project',exact=True).click()
 project_text=Path(project_download.value.path()).read_text()
 assert json.loads(project_text)['document']['source']==app_source
 with page.expect_file_chooser() as chooser:page.get_by_role('button',name='Open project',exact=True).click()
 chooser.value.set_files({'name':'website.onixus.json','mimeType':'application/json','buffer':project_text.encode()})
 expect(frame.get_by_role('heading',name='Booking app fixture')).to_have_count(0)
 page.get_by_role('button',name='Enable interactive preview',exact=True).click()
 expect(frame.get_by_role('heading',name='Booking app fixture')).to_be_visible()
 page.get_by_role('button',name='Use static preview',exact=True).click()
 expect(frame.get_by_role('heading',name='Booking app fixture')).to_have_count(0)
 page.get_by_text('Saved website projects',exact=True).click()
 page.get_by_role('button',name='Save to Workspace',exact=True).click()
 expect(page.get_by_text('Saved and verified:',exact=False)).to_be_visible()
 page.get_by_role('button',name='Open saved project',exact=True).click()
 expect(frame.get_by_role('heading',name='Booking app fixture')).to_have_count(0)
 page.get_by_role('button',name='Enable interactive preview',exact=True).click()
 expect(frame.get_by_role('heading',name='Booking app fixture')).to_be_visible()
 assert json.loads(saved['text'])['document']['source']==app_source
 page.get_by_text('Launch from Workspace',exact=True).click()
 page.get_by_role('button',name='Check launch connections',exact=True).click()
 expect(page.get_by_role('button',name='Review launch',exact=True)).to_be_disabled()
 page.get_by_role('button',name='Review website files for GitHub',exact=True).click()
 dialog=page.get_by_role('dialog',name='Review all repository files')
 expect(dialog.get_by_role('button',name='Create draft pull request',exact=True)).to_be_disabled()
 dialog.get_by_role('button',name='Cancel',exact=True).click()
 publishing[0]=True
 page.get_by_role('button',name='Check launch connections',exact=True).click()
 page.get_by_role('button',name='Review website files for GitHub',exact=True).click()
 dialog.get_by_role('button',name='Create draft pull request',exact=True).click()
 expect(dialog.get_by_text('Draft pull request created.',exact=False)).to_be_visible()
 dialog.get_by_role('button',name='Done',exact=True).click()
 expect(page.get_by_label('Website pull request number')).to_have_value('7')
 page.get_by_role('button',name='Review launch',exact=True).click()
 expect(page.get_by_role('region',name='Website release approval')).to_be_visible()
 assert not merges
 page.get_by_role('button',name='Approve merge of reviewed code',exact=True).click()
 expect(page.get_by_text('Deployment is not yet verified.',exact=False)).to_be_visible()
 assert len(merges)==1
 page.get_by_role('button',name='Verify live deployment',exact=True).click()
 expect(page.get_by_text('No production deployment has been verified',exact=False)).to_be_visible()
 deployed[0]=True
 page.get_by_role('button',name='Verify live deployment',exact=True).click()
 expect(page.get_by_role('link',name='Open deployed website',exact=True)).to_have_attribute('href','https://booking-preview.vercel.app/')
 page.screenshot(path=str(out/'website-project-launch.png'),full_page=True)
 large_site='<html><body>'+('x'*203000)+'</body></html>'
 with page.expect_file_chooser() as chooser:page.get_by_role('button',name='Import HTML',exact=True).click()
 chooser.value.set_files({'name':'large-site.html','mimeType':'text/html','buffer':large_site.encode()})
 page.get_by_role('button',name='Check launch connections',exact=True).click()
 expect(page.get_by_text('must be updated before reviewing this file.',exact=False)).to_be_visible()
 expect(page.get_by_role('button',name='Review website files for GitHub',exact=True)).to_be_disabled()
 website_limit[0]=250000
 page.get_by_role('button',name='Check launch connections',exact=True).click()
 expect(page.get_by_role('button',name='Review website files for GitHub',exact=True)).to_be_enabled()
 browser.close()
print('HTML import, safe preview, prompt, low-credit rejection, receipt, undo and export passed.')
