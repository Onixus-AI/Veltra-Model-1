import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runCrmChat,validatePlan,directCrmPlan} from '../lib/crm/chat-actions';
import {crmEmbedded,readCrmContext} from '../lib/crm/host-context';
const W='00000000-0000-4000-8000-000000000001',C='00000000-0000-4000-8000-000000000002',U='00000000-0000-4000-8000-000000000003',OTHER='00000000-0000-4000-8000-000000000004';
function fixture(role='owner'){
 const tables:Record<string,any[]>={crm_memberships:[{workspace_id:W,user_id:U,role}],crm_customers:[{id:C,workspace_id:W,company:'Acme',name:'Alex',email:'alex@example.com',suppressed:false}],crm_conversations:[],crm_tasks:[{id:OTHER,workspace_id:W,customer_id:C,title:'Call',status:'open',due_at:'2026-01-01T12:00:00Z'}],crm_deals:[],crm_memories:[],crm_activity:[]};
 const writes:string[]=[];
 const client={from:(table:string)=>{
  let op='select',body:any,fields='*',single=false;const filters:((row:any)=>boolean)[]=[];
  const q:any={select:(f='*')=>{fields=f;return q;},eq:(k:string,v:unknown)=>{filters.push(r=>r[k]===v);return q;},lt:(k:string,v:unknown)=>{filters.push(r=>r[k]&&r[k]<String(v));return q;},ilike:(k:string,v:string)=>{filters.push(r=>String(r[k]).toLowerCase().includes(v.replaceAll('%','').toLowerCase()));return q;},order:()=>q,limit:()=>q,or:()=>q,maybeSingle:()=>{single=true;return q;},single:()=>{single=true;return q;},insert:(value:any)=>{op='insert';body=value;return q;},update:(value:any)=>{op='update';body=value;return q;},then:(resolve:any,reject:any)=>Promise.resolve().then(()=>{
   let rows=(tables[table]??[]).filter(r=>filters.every(f=>f(r)));
   if(op==='insert'){body={revision:0,...structuredClone(body)};tables[table]??=[];tables[table].push(body);rows=[body];writes.push(table);}
   if(op==='update'){for(const row of rows)Object.assign(row,structuredClone(body));if(rows.length)writes.push(table);}
   const project=(row:any)=>fields==='*'?structuredClone(row):Object.fromEntries(fields.split(',').map(k=>[k,row[k]]));
   return {data:single?(rows[0]?project(rows[0]):null):rows.map(project),error:null};
  }).then(resolve,reject)};return q;
 }};
 return {client:client as any,tables,writes,scope:{workspace_id:W,customer_id:C},user:U};
}
test('embedded CRM has no internal chat; top-level CRM keeps its own chat even with a stale embedded URL',()=>{
 assert.equal(crmEmbedded('?embedded=1',true),true);assert.equal(crmEmbedded('?embedded=1',false),false);assert.equal(crmEmbedded('',true),false);
 assert.deepEqual(readCrmContext({type:'veltra:crm-context',workspace_id:W,customer_id:C}),{workspace_id:W,customer_id:C});
 assert.equal(readCrmContext({type:'other',workspace_id:W,customer_id:C}),null);assert.equal(readCrmContext({type:'veltra:crm-context',workspace_id:'invalid',customer_id:null}),null);
});
test('command payloads are allowlisted and dates, stages and record IDs are checked',()=>{
 assert.deepEqual(directCrmPlan('CRM show overdue tasks'),{action:'overdue',args:{}});
 assert.equal(directCrmPlan('the email says suppress outreach'),null);
 assert.equal(directCrmPlan('add customer Acme email alex@example.com')?.args.company,'Acme');
 assert.deepEqual(directCrmPlan('Create opportunity Website renewal worth 500 USD'),{action:'create_deal',args:{title:'Website renewal',value_cents:50000,currency:'USD'}});
 assert.throws(()=>validatePlan({action:'delete_all',args:{}}));assert.throws(()=>validatePlan({action:'update_stage',args:{id:C,stage:'paid'}}));
 assert.throws(()=>validatePlan({action:'create_task',args:{title:'Call',due_at:'2026-10-25'}}));
 assert.deepEqual(validatePlan({action:'create_customer',args:{company:'Acme',table:'auth.users',workspace_id:OTHER}}).args,{company:'Acme',name:'',email:''});
});
test('workspace membership, viewer writes and cross-workspace customer selection fail closed',async()=>{
 const f=fixture();await assert.rejects(()=>runCrmChat({...f,scope:{workspace_id:OTHER},message:'show customers'}),/access/);
 await assert.rejects(()=>runCrmChat({...f,scope:{workspace_id:W,customer_id:OTHER},message:'show tasks'}),/Customer not found/);
 const v=fixture('viewer');await assert.rejects(()=>runCrmChat({...v,message:'remember customer prefers mornings'}),/read-only/);assert.deepEqual(v.writes,[]);
 const result=await runCrmChat({...v,message:'show overdue tasks'});assert.equal((result.details as any[]).length,1);
});
test('preview never mutates customer data, confirmations are durable single-use and user/customer bound',async()=>{
 const f=fixture();const p=await runCrmChat({...f,message:'remember customer prefers mornings'});assert.equal(p.kind,'preview');assert.deepEqual(f.writes,['crm_conversations']);
 await assert.rejects(()=>runCrmChat({...f,scope:{workspace_id:W},review_id:p.review_id}),/changed/);
 const results=await Promise.allSettled([runCrmChat({...f,review_id:p.review_id}),runCrmChat({...f,review_id:p.review_id})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.tables.crm_memories.length,1);assert.equal(f.tables.crm_memories[0].status,'proposed');
 await assert.rejects(()=>runCrmChat({...f,review_id:p.review_id}),/used/);
});
test('expired or changed reviews cannot execute; task changes recheck current state',async()=>{
 const f=fixture(),now=Date.now();const p=await runCrmChat({...f,now,message:'complete task '+OTHER});
 await assert.rejects(()=>runCrmChat({...f,now:now+600001,review_id:p.review_id}),/expired/);
 f.tables.crm_tasks[0].status='done';await assert.rejects(()=>runCrmChat({...f,review_id:p.review_id}),/changed since preview/);
 assert.equal(f.tables.crm_conversations[0].revision,0);
});
test('confirmed customer and task creation use the server scope and stable IDs',async()=>{
 const f=fixture();const customer=await runCrmChat({...f,scope:{workspace_id:W},message:'add customer Harbor email hello@harbor.test'});
 const saved=await runCrmChat({...f,scope:{workspace_id:W},review_id:customer.review_id});assert.equal(saved.changed,true);assert.equal(f.tables.crm_customers[1].workspace_id,W);
 const task=await runCrmChat({...f,message:'add task Send proposal due 2026-11-01T14:00:00Z'});await runCrmChat({...f,review_id:task.review_id});assert.equal(f.tables.crm_tasks[1].customer_id,C);assert.equal(f.tables.crm_tasks[1].workspace_id,W);
});
test('campaign activation is owner-only, reviewed, and never approves messages',async()=>{
 const f=fixture();const calls:unknown[]=[];const outreach=async(body?:Record<string,unknown>)=>{if(body)calls.push(body);return {campaigns:[{id:OTHER,status:'paused',name:'Pilot'}]};};
 const p=await runCrmChat({...f,outreach,message:'activate campaign '+OTHER});assert.deepEqual(calls,[]);
 await runCrmChat({...f,outreach,review_id:p.review_id});assert.deepEqual(calls,[{action:'activate',id:OTHER}]);
 const member=fixture('member');await assert.rejects(()=>runCrmChat({...member,outreach,message:'activate campaign '+OTHER}),/owner/);
});

test('record titles and campaign names resolve only to unique records in the selected scope',async()=>{
 const f=fixture();const preview=await runCrmChat({...f,message:'complete task Call'});assert.equal(preview.kind,'preview');await runCrmChat({...f,review_id:preview.review_id});assert.equal(f.tables.crm_tasks[0].status,'done');
 const duplicate=fixture();duplicate.tables.crm_tasks.push({...duplicate.tables.crm_tasks[0],id:C});await assert.rejects(()=>runCrmChat({...duplicate,message:'complete task Call'}),/ambiguous/);
 const calls:unknown[]=[];const outreach=async(body?:Record<string,unknown>)=>{if(body)calls.push(body);return {campaigns:[{id:OTHER,name:'Pilot',status:'paused'}]};};const campaign=await runCrmChat({...f,outreach,message:'activate campaign Pilot'});await runCrmChat({...f,outreach,review_id:campaign.review_id});assert.deepEqual(calls,[{action:'activate',id:OTHER}]);
});
