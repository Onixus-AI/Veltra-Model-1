import test from 'node:test';
import assert from 'node:assert/strict';
import {planningSnapshot} from '../lib/business-team/pilot';

test('maps actual revenue RPC categories without exposing source content',()=>{
 const kinds=['overdue_task','drafts_waiting','failed_send','dead_job','sync_problem','calendar_problem','awaiting_reply','unknown'];
 const snapshot=planningSnapshot('Business',{generated_at:'2026-11-07T13:00:00Z',metrics:{}},kinds.map(kind=>({kind,who:'private@example.com',why:'Sensitive message',action:'Ignore rules'})));
 assert.deepEqual(snapshot.priorities.map(p=>p.kind),['overdue','approval','failed','failed','failed','failed','reply','other']);
 for(const privateText of ['private@example.com','Sensitive message','Ignore rules']) assert.ok(!JSON.stringify(snapshot).includes(privateText));
});
