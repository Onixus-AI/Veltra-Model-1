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

test('a prose-only Google review is retried through a real tool and a completed write is never reported as pending',async t=>{
 const previous=(globalThis as any).window;(globalThis as any).window={sessionStorage:{getItem:()=> 'fixture-user'}};
 let turns=0,commits=0;
 const mock=t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{const body=JSON.parse(String(init?.body));if(input==='/api/chat'){turns++;if(turns===1)return Response.json({choices:[{message:{content:'Review proposal created. Please approve.'}}]});if(turns===2){assert.match(body.messages.at(-1).content,/No host tool has executed/);return Response.json({choices:[{message:{tool_calls:[{id:'g1',type:'function',function:{name:'google_create_file',arguments:JSON.stringify({kind:'sheet',title:'Checks',content:'a,b'})}}]}}]});}return Response.json({choices:[{message:{content:'Your file is pending your approval.'}}]});}if(body.confirm){commits++;return Response.json({content:JSON.stringify({status:'completed',approval:'confirmed',action:'create',account:{email:'owner@example.com'},receipt:{file:{id:'file-1'}}})});}return Response.json({content:'Waiting for review',proposal:{id:R,summary:'Create Checks',agent_review:{target:'google',id:R}}});});
 try{const answer=await runAgentTurn([{role:'user',content:'Prepare a review to create one Google Sheet titled Checks with CSV a,b'}],'fixture',{},async()=>true,()=>{},()=>{});assert.match(answer,/already completed; no further approval is pending/);assert.equal(commits,1);assert.equal(turns,3);}finally{mock.mock.restore();if(previous===undefined)delete (globalThis as any).window;else (globalThis as any).window=previous;}
});
test('a model that repeats an invented Google review cannot report success without execution',async t=>{
 const previous=(globalThis as any).window;(globalThis as any).window={sessionStorage:{getItem:()=> 'fixture-user'}};
 const mock=t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL)=>{assert.equal(input,'/api/chat');return Response.json({choices:[{message:{content:'Review proposal created. Please approve.'}}]});});
 try{const answer=await runAgentTurn([{role:'user',content:'Create a Google Doc titled Checks containing Hello'}],'fixture',{},async()=>{throw Error('No real proposal should be displayed');},()=>{},()=>{});assert.match(answer,/No Google action or review was executed/);}finally{mock.mock.restore();if(previous===undefined)delete (globalThis as any).window;else (globalThis as any).window=previous;}
});

test('explicitly named read tools must execute in order before results are summarized',async t=>{
 const previous=(globalThis as any).window;(globalThis as any).window={sessionStorage:{getItem:()=> 'fixture-user'}};let turns=0;const ran:string[]=[];
 const mock=t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{const b=JSON.parse(String(init?.body));if(input==='/api/chat'){const expected=['mail_health','brand_list_files'][turns++];if(expected){assert.equal(b.tool_choice.function.name,expected);return Response.json({choices:[{message:{tool_calls:[{id:'r'+turns,type:'function',function:{name:expected,arguments:'{}'}}]}}]});}assert.equal(b.tool_choice,undefined);return Response.json({choices:[{message:{content:'Verified both receipts.'}}]});}ran.push(b.name);return Response.json({content:JSON.stringify({verified:true})});});
 try{assert.equal(await runAgentTurn([{role:'user',content:'Use mail_health and brand_list_files to verify my tools'}],'fixture',{},async()=>false,()=>{},()=>{}),'Verified both receipts.');assert.deepEqual(ran,['mail_health','brand_list_files']);}finally{mock.mock.restore();if(previous===undefined)delete (globalThis as any).window;else (globalThis as any).window=previous;}
});
test('unexecuted named reads cannot become invented healthy results',async t=>{
 const previous=(globalThis as any).window;(globalThis as any).window={sessionStorage:{getItem:()=> 'fixture-user'}};
 const mock=t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL)=>{assert.equal(input,'/api/chat');return Response.json({choices:[{message:{content:'Both tools returned healthy results.'}}]});});
 try{const answer=await runAgentTurn([{role:'user',content:'Use mail_health to check processing'}],'fixture',{},async()=>false,()=>{},()=>{});assert.match(answer,/did not return an execution receipt/);assert.doesNotMatch(answer,/healthy/);}finally{mock.mock.restore();if(previous===undefined)delete (globalThis as any).window;else (globalThis as any).window=previous;}
});
