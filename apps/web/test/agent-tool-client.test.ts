import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runAgentTurn,CHAT_TOOLS} from '../lib/chat-tools';
test('advertised tools fit the deployed gateway’s 32-tool limit',()=>{assert.ok(CHAT_TOOLS.length<=32);});
const W='00000000-0000-4000-8000-000000000001',R='00000000-0000-4000-8000-000000000002';
test('the model tool loop waits for review, carries selected context and uses the actual action receipt',async t=>{
 const previous=(globalThis as any).window;(globalThis as any).window={sessionStorage:{getItem:()=> 'fixture-user'}};
 try{for(const approved of [false,true]){
  let modelTurns=0,confirmed=0,reviewed=false;
  const mock=t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body));
   if(input==='/api/chat'){
    if(modelTurns++===0)return Response.json({choices:[{message:{role:'assistant',tool_calls:[{id:'tool-1',type:'function',function:{name:'crm_change',arguments:JSON.stringify({action:'create_customer',args:{company:'Harbor'}})}}]}}]});
    const result=body.messages.at(-1);assert.equal(result.role,'tool');assert.equal(result.tool_call_id,'tool-1');assert.match(result.content,approved?/Verified customer created/:/declined/);
    return Response.json({choices:[{message:{content:approved?'Saved with a verified receipt.':'Cancelled.'}}]});
   }
   assert.equal(input,'/api/agent/tools');assert.deepEqual(body.crm_scope,{workspace_id:W,customer_id:null});
   if(body.confirm){assert.equal(reviewed,true);confirmed++;assert.deepEqual(body.confirm,{target:'crm',id:R});return Response.json({content:'Verified customer created'});}
   assert.equal(body.name,'crm_change');assert.deepEqual(body.args,{action:'create_customer',args:{company:'Harbor'}});
   return Response.json({content:'Nothing changed.',proposal:{id:R,summary:'Create Harbor in selected business.',agent_review:{target:'crm',id:R}}});
  });
  const answer=await runAgentTurn([{role:'user',content:'Add Harbor to CRM'}],'fixture-model',{crm_scope:{workspace_id:W,customer_id:null}},async p=>{assert.equal(p.id,R);assert.equal(confirmed,0);reviewed=true;return approved;},()=>{},()=>{});
  assert.equal(confirmed,approved?1:0);assert.equal(answer,approved?'Saved with a verified receipt.':'Cancelled.');mock.mock.restore();
 }}finally{if(previous===undefined)delete (globalThis as any).window;else (globalThis as any).window=previous;}
});

test('Google creation uses the actual review target and never commits a declined proposal',async t=>{
 const previous=(globalThis as any).window;(globalThis as any).window={sessionStorage:{getItem:()=> 'fixture-user'}};
 try{for(const approved of [false,true]){let turns=0,commits=0;
 const mock=t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{const body=JSON.parse(String(init?.body));if(input==='/api/chat'){if(turns++===0)return Response.json({choices:[{message:{tool_calls:[{id:'g1',type:'function',function:{name:'google_create_file',arguments:JSON.stringify({kind:'doc',title:'Plan',content:'Exact content'})}}]}}]});assert.match(body.messages.at(-1).content,approved?/file-receipt/:/declined/);return Response.json({choices:[{message:{content:'Finished'}}]});}assert.equal(input,'/api/agent/tools');if(body.confirm){commits++;assert.deepEqual(body.confirm,{target:'google',id:R});return Response.json({content:'file-receipt'});}assert.equal(body.name,'google_create_file');return Response.json({content:'Waiting for review',proposal:{id:R,summary:'Create Plan for owner@example.com',agent_review:{target:'google',id:R}}});});
 await runAgentTurn([{role:'user',content:'Create my plan in Google Docs'}],'fixture',{crm_scope:{workspace_id:W}},async()=>approved,()=>{},()=>{});assert.equal(commits,approved?1:0);mock.mock.restore();}
 }finally{if(previous===undefined)delete (globalThis as any).window;else (globalThis as any).window=previous;}
});
