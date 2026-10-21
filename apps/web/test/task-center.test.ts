import {test} from 'node:test';
import assert from 'node:assert/strict';
import {taskProgress,type TaskRun,type TaskEvent} from '../lib/task-progress';
import {followupEvidence,runFollowupTask} from '../lib/followup-task';
import {runAgentTurn} from '../lib/chat-tools';
import {TaskAccessClient} from '../lib/task-access-client';
const fresh=():TaskRun=>({id:'fixture',purpose:'Prepare follow-ups',state:'running',steps:[]});
test('task state preserves failure without steps, review, skipped actions and late receipts after stopping',()=>{
 let run=fresh();run=taskProgress(run,{type:'fail',detail:'No business selected'});assert.equal(taskProgress(run,{type:'finish'}).state,'failed');
 run=taskProgress(fresh(),{type:'step',id:'one',title:'Check mail',app:'Mail'});run=taskProgress(run,{type:'permission',app:'Mail',reason:'Read quotes'});assert.equal(run.state,'permission');
 run=taskProgress(run,{type:'resume'});run=taskProgress(run,{type:'review',id:'one',detail:'Review exact change'});assert.equal(run.state,'review');
 run=taskProgress(run,{type:'result',id:'one',state:'skipped',detail:'Declined'});run=taskProgress(run,{type:'finish'});assert.match(run.note!,/skipped/);
 run=taskProgress(taskProgress(fresh(),{type:'step',id:'late',title:'Read mail',app:'Mail'}),{type:'cancel'});assert.equal(run.steps[0].state,'skipped');
 run=taskProgress(run,{type:'result',id:'late',state:'completed',detail:'Actual late receipt'});assert.equal(run.state,'cancelled');assert.equal(run.steps[0].state,'completed');assert.equal(taskProgress(run,{type:'finish'}).state,'cancelled');
 let long=fresh();for(let i=0;i<32;i++){long=taskProgress(long,{type:'step',id:String(i),title:'Read',app:'Mail'});long=taskProgress(long,{type:'result',id:String(i),state:i===0?'failed':'completed',detail:'Receipt'});}assert.equal(long.omitted,2);assert.equal(taskProgress(long,{type:'finish'}).state,'failed');
});
test('candidate matching requires a unique exact email and preserves bounded page limitations',()=>{
 const result=followupEvidence([{company:'A',email:'a@example.test'},{company:'Duplicate',email:'a@example.test'},{company:'B',email:'b@example.test'}],{items:[{to:'A <a@example.test>',subject:'Ambiguous'},{to:'b@example.test',subject:'Quote B'}],scope:'Current page',next_cursor:'more'});
 assert.match(result.summary,/No unique match/);assert.match(result.summary,/CRM: B/);assert.match(result.summary,/No response is not evidence/);assert.equal(result.more,true);assert.throws(()=>followupEvidence([],{drafted:[]}),/incomplete/);
});
test('follow-up workflow requires a separate review, uses actual receipts, and stops safely on denial, failure or cancellation',async t=>{
 const previous=(globalThis as any).window;(globalThis as any).window={sessionStorage:{getItem:()=> 'fixture-user'}};
 try{for(const mode of ['approve','decline','empty','read-fails','stop','malformed-receipt']){
  let writes=0,stopped=false,run=fresh();const events:TaskEvent[]=[];
  const mock=t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{assert.equal(input,'/api/agent/tools');const b=JSON.parse(String(init?.body));
   if(b.name==='crm_read')return Response.json({content:'Customer read receipt',data:[{company:'Fixture',email:'customer@example.test'}]});
   if(b.name==='mail_find_followups'){if(mode==='read-fails')return Response.json({error:'Mail unavailable'},{status:503});return Response.json({content:JSON.stringify({items:mode==='empty'?[]:[{subject:'Quote',to:'customer@example.test'}],scope:'One page only',next_cursor:'more'})});}
   if(b.name==='mail_prepare_followups')return Response.json({content:'Nothing prepared',proposal:{id:'review',summary:'Verify mailbox',agent_review:{target:'mail',id:'review'}}});
   assert.equal(b.name,'confirm');assert.deepEqual(b.confirm,{target:'mail',id:'review'});writes++;return Response.json({content:JSON.stringify(mode==='malformed-receipt'?{}:{drafted:['draft-1'],scope:'Mail scan'})});
  });
  const observer={event:(e:TaskEvent)=>{events.push(e);run=taskProgress(run,e);if(mode==='stop'&&e.type==='result'&&e.id==='quotes')stopped=true;},cancelled:()=>stopped};
  const access=new TaskAccessClient('Follow-ups',async()=>{throw Error('Fixture does not request access');});
  const promise=runFollowupTask({crm_scope:{workspace_id:'business',customer_id:null}},async p=>{assert.equal(writes,0);assert.match(p.summary,/not restricted to the CRM matches/);assert.equal(run.state,'review');return mode!=='decline';},access,observer);
  if(['read-fails','stop','malformed-receipt'].includes(mode))await assert.rejects(promise,mode==='read-fails'?/Mail unavailable/:mode==='stop'?/stopped/:/could not be confirmed/);
  else {const answer=await promise;assert.match(answer,mode==='decline'?/declined/:mode==='empty'?/No draft preparation was requested/:/1 draft receipt/);}
  assert.equal(writes,['approve','malformed-receipt'].includes(mode)?1:0);assert.equal(events.filter(e=>e.type==='result'&&e.id==='drafts'&&e.state==='completed').length,mode==='approve'?1:0);mock.mock.restore();
 }
 const access=new TaskAccessClient('Customer',async()=>false);await assert.rejects(()=>runFollowupTask({crm_scope:{customer_id:'selected'}},async()=>true,access,{event:()=>{},cancelled:()=>false}),/All customers/);
 }finally{if(previous===undefined)delete (globalThis as any).window;else (globalThis as any).window=previous;}
});

test('a failed tool receipt cannot become a green completed task even if a model returns a final answer',async t=>{
 const previous=(globalThis as any).window;(globalThis as any).window={sessionStorage:{getItem:()=> 'fixture-user'}};let calls=0,run=fresh();
 const mock=t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL)=>{if(input==='/api/chat')return Response.json({choices:[{message:calls++===0?{tool_calls:[{id:'mail',type:'function',function:{name:'mail_search',arguments:'{"query":"quote"}'}}]}:{content:'The mailbox request could not finish.'}}]});return Response.json({error:'Mail unavailable'},{status:503});});
 try{await runAgentTurn([{role:'user',content:'Find quote mail'}],'fixture',{},async()=>false,()=>{},()=>{},undefined,{event:e=>{run=taskProgress(run,e);},cancelled:()=>false});run=taskProgress(run,{type:'finish'});assert.equal(run.state,'failed');assert.equal(run.steps[0].state,'failed');}
 finally{mock.mock.restore();if(previous===undefined)delete (globalThis as any).window;else (globalThis as any).window=previous;}
});
