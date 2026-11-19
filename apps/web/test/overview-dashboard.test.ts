import test from 'node:test';
import assert from 'node:assert/strict';
import {change,onyxInsight,pipelineStages,replyRate,smoothPath,trendGeometry,type Metrics} from '../lib/overview-dashboard';
import {navigationCounts} from '../lib/use-navigation-counts';

const base=():Metrics=>({leads:{total:0,discovery_imports:0},pipeline:{currencies:['USD'],open_by_stage:{},won:0,lost:0},outreach:{threads_sent:0,replies_received:0,awaiting_approval:0},bookings:{scheduled:0,upcoming:0},payments:{known:false,collected_cents:0,outstanding_cents:0},commitments:{overdue:0,due_today:0},failures:{failed_sends:0,dead_jobs:0,sync_problems:0,paused:false}});

test('change badges compare with the previous period and never invent a trend',()=>{
 assert.deepEqual(change(28,22),{text:'↗ +27%',tone:'up'});
 assert.deepEqual(change(10,20),{text:'↘ -50%',tone:'down'});
 assert.deepEqual(change(10,20,false),{text:'↘ -50%',tone:'up'},'lower is better when asked');
 assert.equal(change(5,undefined).tone,'neutral');
 assert.equal(change(5,0).text,'New');assert.equal(change(0,0).text,'No change');
});

test('reply rate is replies over sent threads and absent when nothing was sent',()=>{
 const m=base();assert.equal(replyRate(m),null);
 m.outreach.threads_sent=1318;m.outreach.replies_received=311;assert.equal(replyRate(m),24);
 m.outreach.replies_received=5000;assert.equal(replyRate(m),100,'clamped');
});

test('pipeline stages follow the sales order and scale to the busiest stage',()=>{
 const m=base();m.pipeline.open_by_stage={quoted:{count:142,value_cents:1},lead:{count:34,value_cents:1},lost:{count:19,value_cents:0},custom:{count:0,value_cents:0}};
 const s=pipelineStages(m,16);
 assert.deepEqual(s.map(x=>x.name),['lead','quoted','lost','custom']);
 assert.equal(s.find(x=>x.name==='quoted')!.filled,16);
 assert.equal(s.find(x=>x.name==='custom')!.filled,0);
 assert.ok(s.find(x=>x.name==='lead')!.filled>=1);
});

test('trend geometry stays inside its box and the path starts at the first point',()=>{
 const trend=[{at:'a',sent:10,completed:4,contacts:2},{at:'b',sent:30,completed:9,contacts:5},{at:'c',sent:0,completed:0,contacts:0}];
 const g=trendGeometry(trend,600,200);
 for(const [x,y] of [...g.sent,...g.completed]){assert.ok(x>=0&&x<=600);assert.ok(y>=0&&y<=200);}
 assert.equal(g.peak,30);
 assert.ok(smoothPath(g.sent).startsWith(`M${g.sent[0][0].toFixed(1)},${g.sent[0][1].toFixed(1)} C`));
 assert.equal(g.sent[1][1],14,'the peak sits on the top padding');
 assert.equal(smoothPath([]),'');
});

test('Onyx points at the most urgent queue first',()=>{
 const m=base();assert.match(onyxInsight(m).headline,/Nothing urgent/);
 m.failures.failed_sends=2;assert.match(onyxInsight(m).headline,/2 jobs need a retry/);
 m.commitments.overdue=23;assert.match(onyxInsight(m).headline,/23 commitments are overdue/);
 m.outreach.awaiting_approval=127;const i=onyxInsight(m);assert.match(i.headline,/127 drafts are waiting/);assert.equal(i.action,'Review 127 drafts');
 m.failures.paused=true;assert.match(onyxInsight(m).headline,/paused/);
});

test('sidebar counts show only real, non-zero queues',()=>{
 assert.deepEqual(navigationCounts(null),{});
 assert.deepEqual(navigationCounts({outreach:{awaiting_approval:0},commitments:{overdue:'x'}}),{});
 const c=navigationCounts({outreach:{awaiting_approval:127},commitments:{overdue:23}});
 assert.equal(c.mail?.value,127);assert.equal(c.mail?.tone,'warn');assert.equal(c.crm?.value,23);assert.equal(c.crm?.tone,'urgent');
});
