import test from 'node:test';
import assert from 'node:assert/strict';
import {operationAlerts,researchState,type Operations,type ResearchSource} from '../lib/crm/operations.ts';
const source:ResearchSource={id:'s',label:'Published businesses',enabled:true,imported:4,enriched:2,last_error:null,last_run_at:null,next_run_at:'2026-10-21T09:00:00Z',exhausted_at:null};
const empty:Operations={sources:[],events:[],customers:null,openTasks:null,proposals:null,outreach:null,checkedAt:'2026-10-20T12:00:00Z',unavailable:['Outreach']};
test('an enabled source is scheduled, never assumed running',()=>{assert.equal(researchState(source),'Scheduled');assert.equal(researchState({...source,enabled:false}),'Paused');assert.equal(researchState({...source,exhausted_at:'2026-10-20'}),'Source complete');assert.equal(researchState({...source,last_error:'Retry needed'}),'Needs attention');});
test('missing queues do not invent reviews or success alerts',()=>assert.deepEqual(operationAlerts(empty),[]));
test('review alerts preserve source errors and exact outreach problems',()=>{
 const data:Operations={...empty,sources:[{...source,last_error:'Provider unavailable'}],proposals:2,outreach:{campaigns:[],messages:[{id:'m',company:'Example',subject:'Hello',status:'uncertain',due_at:'2026-10-20',last_error:'Check provider receipt'},{id:'d',company:'Other',subject:'Draft',status:'draft',due_at:'2026-10-20',last_error:null}]}};
 const alerts=operationAlerts(data);assert.equal(alerts.length,4);assert.equal(alerts[0].destination,'Sources');assert.equal(alerts[0].detail,'Provider unavailable');assert.equal(alerts[1].detail,'Check provider receipt');assert.equal(alerts[2].destination,'Automation');assert.equal(alerts[3].destination,'Memory');assert.equal(new Set(alerts.map(a=>a.id)).size,4);
});
test('approved and provider accepted messages are not flagged for approval',()=>assert.deepEqual(operationAlerts({...empty,outreach:{campaigns:[{id:'c',name:'Paused campaign',status:'paused'}],messages:['approved','sent','stopped'].map((status,i)=>({id:String(i),company:'Example',subject:'Hello',status,due_at:'2026-10-20',last_error:null}))}}),[]));
