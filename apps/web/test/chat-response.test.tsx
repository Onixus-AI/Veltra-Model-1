import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ChatResponse from '../components/chat-response';
import {chatPreview} from '../lib/chat-preview';
test('short answers stay fully visible without another click',()=>{const html=renderToStaticMarkup(createElement(ChatResponse,{content:'Done. Your draft is ready.'}));assert.ok(html.includes('Your draft is ready.'));assert.ok(!html.includes('<details'));});
test('long deliverables have a bounded preview and retain complete code in collapsed details',()=>{const content='Your implementation is ready.\n\n```ts\n'+('const line = "preserve me";\n'.repeat(60))+'// final line\n```';const result=chatPreview(content);assert.ok(result.long);assert.ok(result.preview.length<=360);const html=renderToStaticMarkup(createElement(ChatResponse,{content}));assert.ok(html.includes('<details class="chat-response-details">'));assert.ok(html.includes('final line'));assert.ok(!html.includes('<details open'));assert.ok(content.endsWith('```'));});
test('a code-only answer has a useful summary and hostile markup stays inert',()=>{assert.ok(chatPreview('```html\n'+('x'.repeat(1000))+'\n```').preview.includes('Open details'));const html=renderToStaticMarkup(createElement(ChatResponse,{content:'<script>alert(1)</script>'}));assert.ok(!html.includes('<script>'));});
