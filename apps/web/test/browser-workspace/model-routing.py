"""Exercise the real selector through a read-only tool round trip."""
import base64
import json
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    requests = []
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))

    def api(route):
        path = route.request.url
        if '/api/chat' in path:
            body = route.request.post_data_json
            requests.append(body)
            assert any(tool['function']['name'] == 'current_time' for tool in body['tools'])
            if body['messages'][-1]['role'] == 'tool':
                data = {'choices': [{'message': {'content': 'Routing verified.'}}]}
            else:
                # Assert the control stays locked until every tool round finishes.
                expect(page.locator('.model-selector')).to_be_disabled()
                data = {'choices': [{'message': {'tool_calls': [{'id': 'clock', 'type': 'function', 'function': {'name': 'current_time', 'arguments': '{"time_zone":"America/New_York"}'}}]}}]}
        elif '/api/agent/tools' in path:
            assert route.request.post_data_json['name'] == 'current_time'
            data = {'content': '{"source":"fixture clock","time":"12:00"}'}
        else:
            data = {'connected': False, 'items': [], 'conversations': []}
        route.fulfill(status=200, content_type='application/json', body=json.dumps(data))

    page.route('**/api/**', api)
    page.route('https://fixture.supabase.co/**', lambda route: route.fulfill(status=200, content_type='application/json', body='{}'))
    page.goto('http://127.0.0.1:3187/?mode=personal')
    page.wait_for_load_state('networkidle')

    def send(expected):
        before = len(requests)
        page.get_by_role('textbox', name='Message Veltra').fill('Check the current clock for this routing test')
        page.get_by_role('button', name='Send message', exact=True).click()
        expect(page.locator('.model-selector')).to_be_enabled(timeout=15000)
        assert len(requests) == before + 2, requests[before:]
        assert [body['model'] for body in requests[before:]] == [expected, expected]
        assert requests[-1]['messages'][-1]['role'] == 'tool'

    for index, alias in enumerate(['veltra-fast', 'veltra-logic', 'veltra-agent']):
        page.locator('.model-selector').click()
        page.locator('.model-menu button').nth(index).click()
        send(alias)

    page.locator('.model-selector').click()
    page.locator('.model-menu button').nth(1).click()
    page.locator('input[type="file"][accept="image/*"]').set_input_files({
        'name': 'pixel.png', 'mimeType': 'image/png',
        'buffer': base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=')})
    expect(page.locator('.image-tray')).to_be_visible()
    send('veltra-vision')
    send('veltra-vision')  # Retained images still require vision on later turns.
    page.locator('.new-chat-button').click()
    send('veltra-logic')
    assert not errors, errors
    browser.close()
