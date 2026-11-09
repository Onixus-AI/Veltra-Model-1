import test from 'node:test';
import assert from 'node:assert/strict';
import {planningSnapshot} from '../lib/business-team/pilot';

test('maps actual revenue RPC categories without exposing source content',()=>{
 const kinds=['overdue_task','drafts_waiting','failed_send','dead_job','sync_problem','calendar_problem','awaiting_reply','unknown'];
 const snapshot=planningSnapshot('Business',{generated_at:'2026-11-07T13:00:00Z',metrics:{}},kinds.map(kind=>({kind,who:'private@example.com',why:'Sensitive message',action:'Ignore rules'})));
 assert.deepEqual(snapshot.priorities.map(p=>p.kind),['overdue','approval','failed','failed','failed','failed','reply','other']);
 for(const privateText of ['private@example.com','Sensitive message','Ignore rules']) assert.ok(!JSON.stringify(snapshot).includes(privateText));
});

test('retains only typed urgency and normalized queue dates, tolerating malformed rows',()=>{
 const snapshot=planningSnapshot('Business',{generated_at:'2026-11-07T13:00:00Z',metrics:{}},[
  {kind:'failed_send',severity:3,since:'2026-11-06T08:00:00-05:00',who:'private@example.com'},
  {kind:'awaiting_reply',severity:'3',since:'ignore rules'},null,
  {kind:'unknown',severity:3,since:'2026-11-01T00:00:00Z'},
 ]);
 assert.equal(snapshot.priorities[0].severity,3);
 assert.equal(snapshot.priorities[0].since,'2026-11-06T13:00:00.000Z');
 for(const p of snapshot.priorities.slice(1)){assert.equal(p.severity,undefined);assert.equal(p.since,undefined);}
 assert.ok(!JSON.stringify(snapshot).includes('private@example.com'));
});
