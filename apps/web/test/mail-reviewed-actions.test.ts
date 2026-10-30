import {test} from 'node:test';import assert from 'node:assert/strict';
import {agentAction} from '../lib/agent-actions';import {toolsForMessages} from '../lib/chat-tools';import {appsForTool} from '../lib/task-access-policy';
const W='00000000-0000-4000-8000-000000000001',M='00000000-0000-4000-8000-000000000002';
test('mail writes are task scoped and advertised without exceeding gateway limits',()=>{
 for(const name of ['mail_send','mail_trash'])assert.deepEqual(appsForTool(name),['mail']);
 const tools=toolsForMessages([{role:'user',content:'Search my email, send a reply, delete selected mail and import CSV'}]);assert.ok(tools.length<=32);for(const name of ['mail_send','mail_trash'])assert.ok(tools.some(t=>t.function.name===name));
});
test('exact Mail preview waits for confirmation; context changes and replay are denied',async t=>{
 let row:any=null,confirmed=0;
 const client:any={from:()=>{const filters:any={};let update:any;const q:any={select:()=>q,eq:(k:string,v:any)=>{filters[k]=v;return q;},insert:(v:any)=>{row={...v,revision:0};return q;},update:(v:any)=>{update=v;return q;},single:async()=>({data:{id:row.id}}),maybeSingle:async()=>{if(!row||row.id!==filters.id||row.user_id!==filters.user_id||filters.revision!==undefined&&row.revision!==filters.revision)return {data:null};if(update)Object.assign(row,update);return {data:row};},then:(resolve:any)=>{if(update)Object.assign(row,update);return Promise.resolve({error:null}).then(resolve);}};return q;}};
 const identity={account_id:'mail-A',link_version:1,mailbox:{provider:'gmail',email:'owner@example.test'}};
 t.mock.method(globalThis,'fetch',async(_url:any,init:any)=>{const {name,arguments:a}=JSON.parse(init.body).params;let result:any;
  if(name==='mail_identity')result=identity;
  else if(name==='prepare_mail_action'){assert.deepEqual(a.expected_identity,identity);result={status:'awaiting_review',review_id:M,expires_at:Date.now()+600000,action:a.input,mailbox:identity.mailbox};}
  else{assert.equal(name,'confirm_mail_action');assert.equal(a.review_id,M);assert.deepEqual(a.expected_identity,identity);confirmed++;result={status:'provider_accepted',provider_message_id:'provider-1'};}
  return Response.json({result:{content:[{type:'text',text:JSON.stringify(result)}]}});
 });
 const run=(scope:any={workspace_id:W},confirm?:any)=>agentAction({client,user:'owner',scope,name:confirm?'confirm':'mail_send',args:confirm?{}:{to:'client@example.test',subject:'Hello',body:'Exact reviewed content'},confirm,authorization:'Bearer owner',mailOrigin:'https://mail.example.test'});
 const proposal=await run();assert.equal(confirmed,0);assert.match(proposal.proposal!.summary,/Exact reviewed content/);assert.match(proposal.proposal!.summary,/client@example.test/);
 await assert.rejects(run({workspace_id:'other'},proposal.proposal!.agent_review),/scope changed/);assert.equal(confirmed,0);
 const result=await run(undefined,proposal.proposal!.agent_review);assert.match(result.content,/provider_accepted/);assert.equal(confirmed,1);await assert.rejects(run(undefined,proposal.proposal!.agent_review),/used/);assert.equal(confirmed,1);
});
