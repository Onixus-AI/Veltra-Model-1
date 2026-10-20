import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runAgentTurn} from '../lib/chat-tools';
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
