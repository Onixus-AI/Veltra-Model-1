import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatCrmReply} from '../lib/crm/chat-format';
test('audit replies retain totals, observation time and actionable receipt IDs',()=>{
 const text=formatCrmReply({kind:'read',reply:'233 overdue tasks; showing 100. More records are available.',observed_at:'2026-10-28T03:00:00Z',details:[{id:'task-1',title:'Review email',customer_id:'customer-1'}]});
 assert.match(text,/233 overdue/);assert.match(text,/showing 100/);assert.match(text,/Observed: 2026-10-28/);assert.match(text,/Record ID: task-1/);
});
test('approved outreach remains distinct from provider acceptance and carries waiting reason',()=>{
 const text=formatCrmReply({kind:'read',reply:'Campaign results',details:{worker:{last_checked_at:'2026-10-28T03:00:00Z',last_success_at:'2026-10-28T03:00:00Z'},daily:{provider_accepted_total:0,approved_due:18},messages:[{id:'message-1',status:'approved',delivery:{reason:'outside_sending_window',window_opens_at:'2026-10-28T13:00:00Z'}}]}});
 assert.match(text,/Provider-accepted total: 0/);assert.match(text,/Approval is not delivery/);assert.match(text,/outside.sending.window/);assert.match(text,/2026-10-28T13:00:00Z/);
});
