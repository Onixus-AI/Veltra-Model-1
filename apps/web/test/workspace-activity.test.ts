import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceActions,type SignalOverview} from '../lib/workspace-activity';
import type {Operations} from '../lib/crm/operations';
const operations:Operations={sources:[],events:[{id:'event',title:'Agent handoff recorded',kind:'handoff',created_at:'2026-10-29T10:00:00Z'}],customers:1,openTasks:1,proposals:0,outreach:{campaigns:[],messages:[{id:'mail',company:'Customer',subject:'Review',status:'approved',due_at:'2026-10-29',last_error:null}]},checkedAt:'2026-10-29',unavailable:[]};
const signal:SignalOverview={workspace:'business-a',policy:null,items:[{id:'asset',caption:'Campaign',platform:'linkedin',status:'published',created_at:'2026-10-29T12:00:00Z'}],unavailable:[],checked_at:'2026-10-29',limit:30};
test('Signal from another business is excluded',()=>assert.equal(workspaceActions('business-b',null,signal).length,0));
test('approval and queue status never establish delivery',()=>{
 const rows=workspaceActions('business-a',operations,signal);
 assert.match(rows.find(r=>r.source==='Mail')!.detail,/not a send receipt/);
 assert.match(rows.find(r=>r.source==='Signal')!.detail,/provider confirmation/);
 assert.equal(rows.find(r=>r.source==='Mail')!.at,null);
});
test('preserves receipt IDs, chronology and selected business links',()=>{
 const rows=workspaceActions('business-a',operations,signal);
 assert.equal(rows[0].id,'signal:asset');assert.equal(rows[1].receipt,'crm_activity:event');
 assert.ok(rows.every(r=>r.href.includes('business-a')));
 assert.equal(rows[1].snapshot,false);assert.equal(rows[0].snapshot,true);
});
test('missing activity stays empty and invalid times are excluded',()=>{
 assert.deepEqual(workspaceActions('business-a',null,null),[]);
 assert.deepEqual(workspaceActions('business-a',{...operations,events:[{...operations.events![0],created_at:'invalid'}],outreach:null},null),[]);
});
