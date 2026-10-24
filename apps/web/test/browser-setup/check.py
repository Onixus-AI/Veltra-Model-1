"""Exercise the real setup component against an isolated preference-store fixture."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

out = Path('work/setup-screenshots')
out.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1280, 'height': 1000})
    page.goto('http://127.0.0.1:3189/')
    page.get_by_role('button', name='Run my business', exact=False).click()
    expect(page.get_by_role('heading', name='What would make today easier?')).to_be_visible()
    page.get_by_role('textbox', name='Your first goal', exact=True).fill('Organize follow-ups')
    page.get_by_role('button', name='Continue', exact=True).click()
    expect(page.get_by_role('heading', name='Let’s get your time right.')).to_be_visible()
    page.get_by_role('button', name='Change', exact=True).click()
    page.get_by_role('combobox', name='Timezone', exact=True).fill('America/New_York')
    page.get_by_role('button', name='Use this timezone', exact=True).click()
    expect(page.get_by_role('heading', name='Bring your work into the conversation.')).to_be_visible()
    page.get_by_role('button', name='Open Mail', exact=True).click()
    expect(page.get_by_role('dialog')).not_to_be_visible()
    expect(page.locator('[aria-label="Opened tool"]')).to_have_text('mail')
    page.get_by_role('button', name='Continue setup', exact=True).click()
    page.get_by_role('button', name='Do this later', exact=True).click()
    page.reload()
    expect(page.get_by_role('heading', name='Bring your work into the conversation.')).to_be_visible()
    page.get_by_role('button', name='Continue', exact=True).click()
    expect(page.get_by_role('button', name='Open my first task', exact=True)).to_be_disabled()
    for scenario, message in [('mail-disconnected', 'Connect your email account'), ('mail-error', 'Couldn’t verify your inbox')]:
        page.goto('http://127.0.0.1:3189/?business-ready&' + scenario)
        expect(page.get_by_role('button', name='Open my first task', exact=True)).to_be_disabled()
        expect(page.get_by_role('status').filter(has_text=message)).to_be_visible()
        expect(page.get_by_role('button', name='Check again', exact=True)).to_be_enabled()
    page.goto('http://127.0.0.1:3189/?business-ready')
    page.get_by_role('button', name='Open my first task', exact=True).click()
    expect(page.get_by_role('textbox', name='Prepared task', exact=True)).to_have_value('Find customers who need a follow-up and prepare drafts.')
    expect(page.get_by_role('dialog')).not_to_be_visible()
    page.screenshot(path=str(out / 'setup-complete.png'))
    page.goto('http://127.0.0.1:3189/?fail')
    page.get_by_role('button', name='Edit setup', exact=True).click()
    page.get_by_role('button', name='Run my business', exact=False).click()
    expect(page.get_by_role('alert')).to_contain_text('not saved')
    expect(page.locator('[aria-label="Saved goal"]')).to_have_text('Organize follow-ups')
    expect(page.get_by_role('heading', name='What brings you to Veltra?')).to_be_visible()
    page.screenshot(path=str(out / 'setup-save-failure.png'))
    for choice in ['Make everyday life easier', 'Build software', 'Create something']:
        context = browser.new_context(viewport={'width': 390, 'height': 844})
        mobile = context.new_page()
        mobile.goto('http://127.0.0.1:3189/')
        mobile.get_by_role('button', name=choice, exact=False).click()
        mobile.get_by_role('textbox', name='Your first goal', exact=True).fill('Help with my first project')
        mobile.get_by_role('button', name='Continue', exact=True).click()
        mobile.get_by_role('button', name='Change', exact=True).click()
        mobile.get_by_role('combobox', name='Timezone', exact=True).fill('Asia/Tokyo')
        mobile.get_by_role('button', name='Use this timezone', exact=True).click()
        if choice == 'Build software':
            mobile.get_by_role('button', name='Continue', exact=True).click()
        expect(mobile.get_by_role('heading', name='Let’s do something useful.')).to_be_visible()
        assert mobile.evaluate('document.documentElement.scrollWidth<=innerWidth')
        mobile.screenshot(path=str(out / f'setup-{choice.split()[0]}-mobile.png'))
        mobile.get_by_role('button', name='Open my first task', exact=True).click()
        expect(mobile.get_by_role('textbox', name='Prepared task', exact=True)).not_to_have_value('')
        context.close()
    publish_calls=[]
    def repository_api(route):
        if route.request.url.endswith('/github/development-policy'):
            route.fulfill(status=200,content_type='application/json',body=__import__('json').dumps({'publishing_enabled':'publish-paused' not in page.url}))
            return
        body=route.request.post_data_json
        if route.request.url.endswith('/github/change-set'):
            data={'repository':'owner/repo','branch':'main','connection_version':3,'base_sha':'a'*40,'title':body['title'],'files':body['files'],'before':[{'path':'src/existing.ts','content':'old'},{'path':'src/new.ts','content':None}]}
        else:
            publish_calls.append(body)
            data={'url':'https://github.com/owner/repo/pull/7'}
        route.fulfill(status=200,content_type='application/json',body=__import__('json').dumps(data))
    page.route('**/api/connections/github/*',repository_api)
    page.goto('http://127.0.0.1:3189/?repository-review')
    expect(page.get_by_role('dialog',name='Review all repository files')).to_be_visible()
    expect(page.get_by_role('button',name='Create draft pull request',exact=True)).to_be_enabled()
    expect(page.get_by_role('alert')).not_to_be_visible()
    page.get_by_text('Update: src/existing.ts',exact=True).click()
    page.get_by_text('New file: src/new.ts',exact=True).click()
    expect(page.get_by_text('old',exact=True)).to_be_visible()
    expect(page.get_by_text('export const ready=true;',exact=True)).to_be_visible()
    assert not publish_calls,'Loading the review must not publish code'
    page.screenshot(path=str(out/'repository-files-before-confirmation.png'))
    page.set_viewport_size({'width':390,'height':844})
    box=page.get_by_role('dialog',name='Review all repository files').bounding_box()
    assert box['x']>=0 and box['x']+box['width']<=390
    page.screenshot(path=str(out/'repository-review-mobile.png'))
    page.set_viewport_size({'width':1280,'height':1000})
    page.get_by_role('button',name='Cancel',exact=True).click()
    assert not publish_calls,'Cancel must not publish code'
    page.goto('http://127.0.0.1:3189/?repository-review')
    page.get_by_role('button',name='Create draft pull request',exact=True).click()
    expect(page.get_by_role('status')).to_contain_text('Draft pull request created')
    assert len(publish_calls)==1 and len(publish_calls[0]['files'])==2
    assert 'before' not in publish_calls[0]
    page.screenshot(path=str(out/'repository-change-review.png'))
    page.goto('http://127.0.0.1:3189/?repository-review&publish-paused')
    expect(page.get_by_role('button',name='Create draft pull request',exact=True)).to_be_disabled()
    expect(page.get_by_role('status')).to_contain_text('Publishing is paused')
    assert len(publish_calls)==1,'Paused review must not publish code'
    page.screenshot(path=str(out/'repository-publishing-paused.png'))
    run_id='00000000-0000-4000-8000-000000000001'
    run={'id':run_id,'status':'completed','stage':'complete','created_at':'2026-10-24T12:00:00Z','credits_used':0,'credits_reserved':0,'verification_attempts':0,'state':{'artifacts':{'summary':'Comparison fixture','files':[{'path':'src/flag.mjs','content':'export const enabled=false;'}, {'path':'flag.test.mjs','content':'import assert from "node:assert/strict";'}]}}}
    page.route('**/api/agent-runs*',lambda route:route.fulfill(json={'runs':[run]}))
    page.route('**/api/agent-runs/*',lambda route:route.fulfill(json=run))
    comparisons=[]
    def verify_repository(route):
        comparisons.append(route.request.post_data_json)
        route.fulfill(json={'receipt_id':'fixture-receipt','base_sha':'a'*40,'checks_passed':True,'before_failed_after_passed':True,'scope':'Selected text files only. Publishing remains paused.','checks':[{'name':'Before · same Node test','exit_code':1,'stdout':'assertion failed','stderr':''},{'name':'After · same Node test','exit_code':0,'stdout':'test passed','stderr':''}]})
    page.route('**/api/build/verify',verify_repository)
    page.goto('http://127.0.0.1:3189/?repository-verify')
    page.get_by_role('button').filter(has_text='completed · 0 credits').click()
    page.get_by_role('checkbox',name='Compare with selected repository').check()
    expect(page.get_by_label('Comparison test')).to_have_value('flag.test.mjs')
    page.get_by_role('button',name='Run before & after tests').click()
    expect(page.get_by_text('The test failed before and passed after.',exact=False)).to_be_visible()
    assert comparisons==[{'run_id':run_id,'repository':True,'test_path':'flag.test.mjs'}]
    page.get_by_text('Before · same Node test · failed',exact=True).click()
    page.get_by_text('After · same Node test · passed',exact=True).click()
    page.screenshot(path=str(out/'repository-before-after.png'))
    browser.close()
