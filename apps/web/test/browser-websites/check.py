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
 expect(page.get_by_text('321 credits recorded',exact=False)).to_be_visible()
 page.get_by_role('button',name='Undo Onyx revision',exact=True).click()
 expect(frame.get_by_role('heading',name='Imported customer site')).to_be_visible()
 with page.expect_download() as download:page.get_by_role('button',name='Export HTML',exact=True).click()
 assert Path(download.value.path()).read_text()==source, 'Export preserves original HTML, including original scripts'
 page.set_viewport_size({'width':390,'height':844})
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 page.screenshot(path=str(out/'html-import-mobile.png'),full_page=True)
 browser.close()
print('HTML import, safe preview, prompt, low-credit rejection, receipt, undo and export passed.')
