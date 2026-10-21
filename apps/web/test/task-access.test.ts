import {test} from 'node:test';
import assert from 'node:assert/strict';
import {taskDecision} from '../lib/task-access';
import {appsForTool} from '../lib/task-access-policy';
import {TaskAccessClient} from '../lib/task-access-client';
import {runAgentTurn} from '../lib/chat-tools';
const TASK='00000000-0000-4000-8000-000000000001';
function database(task:unknown,grant:unknown,error:unknown=null){const reads:string[]=[];return {reads,from:(table:string)=>{reads.push(table);const q:any={select:()=>q,eq:(key:string,value:string)=>{if(key==='user_id')assert.equal(value,'owner');return q;},maybeSingle:async()=>({data:table==='veltra_ai_tasks'?task:grant,error})};return q;}};}
test('task access fails closed on denial, expiry, completion, missing grants and database errors',async()=>{
 const active={id:TASK,expires_at:new Date(20000).toISOString(),completed_at:null};
 for(const [task,grant,expected] of [[active,null,'ask'],[active,{allowed:false},'deny'],[active,{allowed:true},'allow'],[{...active,completed_at:'now'},{allowed:true},'ended'],[{...active,expires_at:new Date(1).toISOString()},{allowed:true},'ended']] as const){const db=database(task,grant);assert.equal(await taskDecision(db as any,'owner',TASK,'mail',10000),expected);if(expected==='ended')assert.equal(db.reads.length,1);}
 await assert.rejects(()=>taskDecision(database(null,null,Error('offline')) as any,'owner',TASK,'mail'),/permissions are unavailable/);
 assert.deepEqual(appsForTool('mail_search'),['mail']);assert.deepEqual(appsForTool('crm_read',{action:'outreach'}),['crm','mail']);assert.deepEqual(appsForTool('github_read_file'),['github']);assert.deepEqual(appsForTool('confirm',{}, {target:'crm'}),['crm']);
});
test('Allow runs Mail only for its task; Deny never reaches the provider and completion closes access',async t=>{
 const previous=(globalThis as any).window;(globalThis as any).window={sessionStorage:{getItem:()=> 'fixture-user'}};
 try{for(const allowed of [false,true]){
  let decision:boolean|undefined,started=false,ended=false,prompts=0,providerCalls=0,modelTurns=0;
  const access=new TaskAccessClient('Search my mailbox',async request=>{prompts++;assert.equal(request.app,'mail');return allowed;});
  const mock=t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body));
   if(input==='/api/ai-access'){
    assert.equal(body.task_id,access.id);
    if(body.action==='start'){started=true;return Response.json({task_id:access.id});}
    assert.equal(started,true);
    if(body.action==='finish'){ended=true;return Response.json({completed:true});}
    if(body.action==='decide'){decision=body.allowed;return Response.json({allowed:decision});}
    if(decision!==undefined)return Response.json(decision?{allowed:true}:{error:'denied'},{status:decision?200:403});
    return Response.json({access_required:{app:'mail'}},{status:428});
   }
   if(input==='/api/chat'){
    assert.equal(body.task_id,access.id);
    if(modelTurns++===0)return Response.json({choices:[{message:{tool_calls:[{id:'mail-1',type:'function',function:{name:'mail_search',arguments:JSON.stringify({query:'quote'})}}]}}]});
    assert.match(body.messages.at(-1).content,allowed?/Verified Mail receipt/:/denied/);return Response.json({choices:[{message:{content:'Task complete.'}}]});
   }
   assert.equal(input,'/api/agent/tools');assert.equal(body.task_id,access.id);
   if(decision!==true)return Response.json({access_required:{app:'mail',reason:'Search Mail for this task.'}},{status:428});
   providerCalls++;assert.equal(ended,false);return Response.json({content:'Verified Mail receipt'});
  });
  assert.equal(await runAgentTurn([{role:'user',content:'Search mail'}],'fixture',{},async()=>false,()=>{},()=>{},access),'Task complete.');
  assert.equal(prompts,1);assert.equal(providerCalls,allowed?1:0);await access.finish();assert.equal(ended,true);await assert.rejects(()=>access.fetch('/api/agent/tools'),/task has ended/);mock.mock.restore();
 }}finally{if(previous===undefined)delete (globalThis as any).window;else (globalThis as any).window=previous;}
});

test('stopping while task creation is in flight closes the new task without opening a late permission dialog',async t=>{
 const previous=(globalThis as any).window;(globalThis as any).window={sessionStorage:{getItem:()=> 'fixture-user'}};
 let release!:(value:Response)=>void,started!:()=>void,finished=0,prompts=0;const seen=new Promise<void>(resolve=>{started=resolve;});
 const mock=t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{assert.equal(input,'/api/ai-access');const body=JSON.parse(String(init?.body));if(body.action==='start'){started();return new Promise<Response>(resolve=>{release=resolve;});}assert.equal(body.action,'finish');finished++;return Response.json({completed:true});});
 try{const task=new TaskAccessClient('Read mail',async()=>{prompts++;return true;});const request=task.require('mail','Read for this task');await seen;await task.finish();release(Response.json({task_id:task.id}));await assert.rejects(request,/has ended/);assert.equal(prompts,0);assert.equal(finished,1);}
 finally{mock.mock.restore();if(previous===undefined)delete (globalThis as any).window;else (globalThis as any).window=previous;}
});
