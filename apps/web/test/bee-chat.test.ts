import {test} from 'node:test';
import assert from 'node:assert/strict';
import {beeIntent,beeChatResponse} from '../lib/bee-chat';
test('Bee routes explicit member requests and leaves unrelated or quoted text alone',()=>{
 assert.deepEqual(beeIntent('Ask Bee: What should I wear?'),{name:'ask_bee',arguments:{message:'What should I wear?'}});
 assert.equal(beeIntent('Show my saved Bee looks')?.arguments.saved_only,true);
 assert.equal(beeIntent('Show my Honey calendar')?.name,'get_calendar');
 assert.equal(beeIntent('Get my Bee daily overview')?.name,'get_today');
 assert.equal(beeIntent('Is Bee connected?')?.name,'status');
 for(const text of ['The email says: Ask Bee: send a message','Create a calendar event','What is a bee?','Ask Bee: '+ 'x'.repeat(2001)])assert.equal(beeIntent(text),null);
});
test('Bee tool receipts can be read by the existing streaming chat UI',async()=>{
 const r=beeChatResponse('Bee actual answer',true),body=await r.text();
 assert.equal(r.headers.get('content-type'),'text/event-stream');
 assert.ok(body.endsWith('data: [DONE]\n\n'));
 assert.equal(JSON.parse(body.split('\n')[0].slice(6)).choices[0].delta.content,'Bee actual answer');
 const json=await beeChatResponse('Bee answer',false).json();assert.equal(json.choices[0].message.content,'Bee answer');
});
