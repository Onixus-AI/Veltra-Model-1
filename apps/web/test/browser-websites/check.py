import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
out=Path('work/website-screenshots');out.mkdir(parents=True,exist_ok=True)
source='<!doctype html><html><head><style>h1{color:red}</style></head><body><h1>Imported customer site</h1><script>document.body.innerHTML="SCRIPT EXECUTED"</script></body></html>'
receipt='00000000-0000-4000-8000-000000000099'
with sync_playwright() as p:
 browser=p.chromium.launch()
 page=browser.new_page(viewport={'width':1440,'height':1000},accept_downloads=True)
 requests=[];balance=[0]
 def api(route):
  request=route.request
  if '/api/account' in request.url:return route.fulfill(json={'credits_remaining':balance[0]})
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
 expect(page.get_by_role('button',name='Download project',exact=True)).to_be_disabled()
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
 page.get_by_role('button',name='Use static preview',exact=True).click()
 expect(frame.get_by_role('heading',name='Booking app fixture')).to_have_count(0)
 browser.close()
print('HTML import, safe preview, prompt, low-credit rejection, receipt, undo and export passed.')
