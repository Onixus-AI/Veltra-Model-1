from playwright.sync_api import sync_playwright,expect
W='00000000-0000-4000-8000-000000000001'
with sync_playwright() as p:
 browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':900});calls=[]
 def api(route):
  b=route.request.post_data_json;calls.append((route.request.url,b))
  if route.request.url.endswith('business-search'):
   assert b=={'workspace':W,'industry':'Trucking & logistics','country':'Canada','city':'Toronto'}
   return route.fulfill(json={'results':[{'url':'https://example.test/transport','title':'Example Transport','description':'Published business source'}]})
  if b['action']=='prepare':
   assert b['rows'][0]['company']=='Example Transport';assert b['rows'][0]['source']=='https://example.test/transport'
   return route.fulfill(json={'proposal':{'id':'review-1','summary':'Example Transport · Canada · source https://example.test/transport'}})
  assert b=={'action':'confirm','workspace':W,'review_id':'review-1'}
  return route.fulfill(json={'imported':1,'skipped':0})
 page.route('**/api/crm/**',api)
 page.goto('http://127.0.0.1:3188/?industry-search')
 page.get_by_text('Browse industry categories',exact=True).click();page.get_by_role('button',name='Trucking & logistics',exact=True).click()
 expect(page.get_by_label('Industry',exact=True)).to_have_value('Trucking & logistics')
 page.get_by_label('Country',exact=True).fill('Canada');page.get_by_label('City or region (optional)',exact=True).fill('Toronto')
 page.get_by_role('button',name='Search businesses',exact=True).click()
 expect(page.get_by_role('link',name='Example Transport')).to_be_visible()
 assert len(calls)==1,'Search must not import automatically'
 page.get_by_label('Add this business',exact=True).check()
 expect(page.get_by_role('button',name='Review 1 selected',exact=True)).to_be_disabled()
 page.get_by_label('Confirmed company name',exact=True).fill('Example Transport');page.get_by_role('button',name='Review 1 selected',exact=True).click()
 expect(page.get_by_role('dialog',name='Review CRM import',exact=True)).to_be_visible();assert len(calls)==2
 page.get_by_role('button',name='Add to CRM',exact=True).click();expect(page.get_by_role('status')).to_have_text('1 added to CRM. 0 existing records skipped.');assert len(calls)==3
 page.get_by_label('Country',exact=True).fill('Japan');expect(page.get_by_role('link',name='Example Transport')).to_have_count(0)
 page.screenshot(path='work/operations-screenshots/industry-search.png',full_page=True)
 browser.close()
