import copy,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
out=Path('work/operations-screenshots');out.mkdir(parents=True,exist_ok=True)
workspace='00000000-0000-4000-8000-000000000001'
base={'id':'00000000-0000-4000-8000-000000000002','content':'Northstar requires a deposit before shipping.','kind':'fact','source_app':'mail','source_ref':'https://example.test/quote/42','status':'approved','revision':1,'expires_at':None,'updated_at':'2026-10-22T00:00:00Z','workspace_id':workspace,'customer_id':None}
pending={**base,'id':'00000000-0000-4000-8000-000000000003','content':'Prefers Tuesday follow-ups.','status':'proposed','source_app':'chat','source_ref':'Owner instruction'}
old={**base,'id':'00000000-0000-4000-8000-000000000004','content':'Old renewal deadline.','expires_at':'2000-01-01T00:00:00Z'}
records=[copy.deepcopy(base),copy.deepcopy(pending),copy.deepcopy(old)];calls=[];reviews={};writes=[];reject=False
with sync_playwright() as p:
 browser=p.chromium.launch();page=browser.new_page(viewport={'width':1440,'height':1000},reduced_motion='reduce');errors=[]
 page.on('pageerror',lambda error:errors.append(str(error)))
 def api(route):
  global reject
  body=route.request.post_data_json;calls.append(body);assert body['crm_scope']['workspace_id']==workspace
  action=body['action']
  if action=='search':
   result=[item for item in records if body.get('include_expired') or item['id']!=old['id']]
   query=body.get('query','').lower();result=[item for item in result if not query or query in item['content'].lower()]
   return route.fulfill(json={'records':result,'scope':{'workspace_id':workspace,'customer_id':None},'can_write':True,'limit':30})
  if action=='confirm':
   if reject:reject=False;return route.fulfill(status=409,json={'error':'Memory changed since review. Refresh before trying again.'})
   proposal=reviews.pop(body['review_id']);writes.append(proposal)
   if proposal['action']=='approve':next(item for item in records if item['id']==proposal['id'])['status']='approved'
   if proposal['action']=='forget':records[:]=[item for item in records if item['id']!=proposal['id']]
   return route.fulfill(json={'kind':'result','changed':True,'reply':'Memory approved for shared recall.'})
  review_id='review-'+str(len(reviews));reviews[review_id]=body
  route.fulfill(json={'kind':'preview','review_id':review_id,'reply':'Nothing has changed yet. Review expires in ten minutes.','details':{'action':'brain_'+action,'content':body.get('content'),'source':body.get('source_ref'),'scope':'Business workspace','before':next((item for item in records if item['id']==body.get('id')),None),'expires_at':body.get('expires_at')}})
 page.route('**/api/brain',api)
 page.goto('http://127.0.0.1:3188/?brain-manager');page.wait_for_load_state('networkidle')
 page.get_by_role('button',name='Open shared brain').click()
 dialog=page.get_by_role('dialog',name='Shared brain');expect(dialog).to_be_visible()
 saved=page.get_by_role('region',name='Saved memories');detail=page.get_by_role('region',name='Memory details')
 expect(saved.get_by_role('button').filter(has_text=base['content'])).to_be_visible()
 expect(detail.get_by_role('link')).to_have_attribute('href',base['source_ref'])
 saved.get_by_role('button').filter(has_text=pending['content']).click()
 page.get_by_role('button',name='Review approval',exact=True).click()
 review=page.get_by_role('region',name='Memory change review');expect(review).to_be_visible()
 expect(page.get_by_role('button',name='Cancel review')).to_be_focused();assert len(writes)==0
 page.get_by_role('button',name='Cancel review').click();assert len(writes)==0
 page.get_by_role('button',name='Review approval',exact=True).click()
 page.get_by_role('button',name='Confirm memory change').dblclick();expect(page.get_by_role('status').filter(has_text='approved')).to_be_visible()
 assert len(writes)==1,'Confirmation must apply once'
 page.get_by_role('button',name='Correct',exact=True).click();page.get_by_label('Memory',exact=True).fill('Corrected follow-up preference.')
 page.get_by_role('button',name='Review memory',exact=True).click();expect(review).to_contain_text('Corrected follow-up preference.');assert len(writes)==1
 page.get_by_role('button',name='Cancel review').click()
 page.get_by_role('checkbox',name='Include expired').check();expect(saved.get_by_role('button').filter(has_text=old['content'])).to_be_visible()
 saved.get_by_role('button').filter(has_text=old['content']).click();page.get_by_role('button',name='Forget',exact=True).click();reject=True
 page.get_by_role('button',name='Confirm memory change').click();expect(page.get_by_role('alert')).to_contain_text('Memory changed');assert len(writes)==1
 page.get_by_role('button',name='Refresh memories').click();expect(page.get_by_role('alert')).to_have_count(0)
 page.screenshot(path=str(out/'brain-manager-desktop.png'),full_page=True)
 page.get_by_placeholder('Search facts, preferences, projects…').fill('Northstar');page.get_by_role('button',name='Search',exact=True).click()
 expect(saved.get_by_role('button').filter(has_text=pending['content'])).to_have_count(0)
 page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(out/'brain-manager-mobile.png'),full_page=True)
 assert dialog.evaluate('(el)=>el.scrollWidth<=el.clientWidth'),'Memory manager must fit mobile'
 page.keyboard.press('Escape');expect(dialog).to_have_count(0);expect(page.get_by_role('button',name='Open shared brain')).to_be_focused()
 assert not errors,errors
 browser.close()
print('Shared-brain manager verified: sources, review/cancel/confirm, stale review, filters, keyboard and mobile.')
