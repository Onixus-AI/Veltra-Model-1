from playwright.sync_api import sync_playwright,expect
from pathlib import Path
out=Path('work/operations-screenshots');out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':1000},reduced_motion='reduce')
 page.add_init_script("sessionStorage.setItem('veltra-api-key','fixture-access')")
 settings={'mode':'held','permission':False};held=[];counts={'writes':0,'tools':0};grants={};errors=[]
 page.on('pageerror',lambda error:errors.append(str(error)))
 def access(route):
  b=route.request.post_data_json;task=b['task_id']
  if b['action']=='start':grants[task]=None;return route.fulfill(json={'task_id':task})
  if b['action']=='finish':return route.fulfill(json={'completed':True})
  if b['action']=='decide':grants[task]=b['allowed'];return route.fulfill(json={'allowed':b['allowed']})
  grant=grants[task];route.fulfill(status=428 if grant is None else 200 if grant else 403,json={'allowed':grant,'error':'Access denied'})
 def release_quotes():
  for _ in range(100):
   if held:return quotes(held.pop())
   page.wait_for_timeout(20)
  raise AssertionError('No pending quote request arrived')
 def quotes(route):route.fulfill(json={'content':'{"items":[{"subject":"Customer quote","to":"customer@example.test"}],"scope":"Current page of sent mail","next_cursor":"more"}'})
 def tools(route):
  counts['tools']+=1;b=route.request.post_data_json
  if settings['permission'] and grants.get(b['task_id'])!=True:return route.fulfill(status=428,json={'access_required':{'app':'crm','reason':'Read customer records for matching.'}})
  if b['name']=='crm_read':return route.fulfill(json={'content':'Read receipt','data':[{'company':'Fixture customer','email':'customer@example.test'}]})
  if b['name']=='mail_find_followups':
   if settings['mode']=='failed':return route.fulfill(status=503,json={'error':'Mail unavailable. Check the connection before starting another request.'})
   if settings['mode']=='held':held.append(route);return
   return quotes(route)
  if b['name']=='mail_prepare_followups':return route.fulfill(json={'content':'No drafts prepared','proposal':{'id':'review','summary':'Mailbox identity checked.','agent_review':{'target':'mail','id':'review'}}})
  assert b['name']=='confirm';counts['writes']+=1;route.fulfill(json={'content':'{"drafted":["draft-1"],"scope":"Mail overdue scan","next_cursor":null}'})
 page.route('**/api/agent/tools',tools);page.route('**/api/ai-access',access)
 page.goto('http://127.0.0.1:3188/?task-center');page.wait_for_load_state('networkidle')
 center=page.get_by_role('region',name='Veltra task center');start=center.get_by_role('button',name='Prepare follow-ups',exact=True)
 start.click();expect(center.get_by_role('status')).to_have_text('Working');page.wait_for_function('document.querySelectorAll(".task-step").length===2');assert counts['writes']==0
 assert center.evaluate('(el)=>getComputedStyle(el).backgroundColor')=='rgb(0, 0, 0)'
 assert 'sans-serif' in center.evaluate('(el)=>getComputedStyle(el).fontFamily')
 page.screenshot(path=str(out/'task-center-working.png'))
 release_quotes();review=page.get_by_role('dialog',name='Review connected action');expect(review).to_be_visible();expect(center.get_by_role('status')).to_have_text('Needs review');expect(review).to_contain_text('not restricted to the CRM matches')
 page.screenshot(path=str(out/'task-center-review.png'));review.get_by_role('button',name='Cancel').click();expect(center.get_by_role('status')).to_have_text('Completed');assert counts['writes']==0
 settings['mode']='normal';start.click();expect(review).to_be_visible();review.get_by_role('button',name='Confirm').click();expect(center.get_by_role('status')).to_have_text('Completed');assert counts['writes']==1
 expect(page.get_by_label('Task response')).to_contain_text('1 draft receipt');expect(center.get_by_role('button',name='Open Mail',exact=True)).to_be_visible()
 settings['mode']='failed';start.click();expect(center.get_by_role('status')).to_have_text('Needs attention');expect(center).to_contain_text('Mail unavailable');before=counts['tools'];center.get_by_role('button',name='Review request again').click();expect(page.get_by_label('Request to review')).to_contain_text('Find customers');assert counts['tools']==before;assert counts['writes']==1
 settings['mode']='held';start.click();page.wait_for_function('document.querySelectorAll(".task-step").length===2');center.get_by_role('button',name='Stop pending work').click();expect(center.get_by_role('status')).to_have_text('Stopped');release_quotes();expect(start).to_be_enabled();assert counts['writes']==1;expect(review).not_to_be_visible()
 settings['mode']='normal';settings['permission']=True;page.set_viewport_size({'width':390,'height':844});start.click();permission=page.get_by_role('dialog',name='Allow access to Veltra CRM?');expect(permission).to_be_visible();expect(center.get_by_role('status')).to_have_text('Needs permission');permission.get_by_role('button',name='Allow for this task',exact=True).click();expect(review).to_be_visible();expect(center.get_by_role('status')).to_have_text('Needs review');assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 page.screenshot(path=str(out/'task-center-mobile.png'));review.get_by_role('button',name='Cancel').click();expect(center.get_by_role('status')).to_have_text('Completed');assert counts['writes']==1
 assert not errors,errors
 browser.close()
