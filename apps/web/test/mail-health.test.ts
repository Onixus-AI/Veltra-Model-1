import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mailHealthSummary} from '../lib/mail-health';
test('a connection does not hide paused, failed, stalled or unknown mail processing',()=>{
 const now=Date.parse('2026-10-26T18:00:00Z'),at=new Date(now-30000).toISOString();
 assert.equal(mailHealthSummary(null,now).healthy,false);assert.equal(mailHealthSummary({paused:true,health:{at}},now).label,'Processing paused');
 assert.equal(mailHealthSummary({health:{at,error:'model unavailable'}},now).healthy,false);
 const active=mailHealthSummary({health:{at,error:'old failure',running:true,started_at:at,current_handled:4}},now);assert.match(active.label,/Processing inbox · 4/);assert.equal(active.healthy,false);
 assert.equal(mailHealthSummary({health:{at:new Date(now-700000).toISOString(),running:true}},now).label,'Scan needs attention');
 assert.equal(mailHealthSummary({health:{at:new Date(now-700000).toISOString()}},now).healthy,false);
 assert.equal(mailHealthSummary({health:{at}},now).healthy,true);
});
