import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runAgentTurn} from '../lib/chat-tools';
import type {TaskAccessClient} from '../lib/task-access-client';
const tool=(index:number)=>({id:'read-'+index,type:'function',function:{name:'github_read_file',arguments:JSON.stringify({path:`src/file-${index}.ts`})}});
test('an investigation can finish after the old six-round cutoff',async t=>{
 const previous=(globalThis as any).window;(globalThis as any).window={sessionStorage:{getItem:()=>''}};
 let rounds=0,reads=0;
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL)=>{
  if(input==='/api/chat')return Response.json({choices:[{message:rounds++<7?{tool_calls:[tool(rounds)]}:{content:'Checked seven source files; here is the evidence.'}}]});
  reads++;return Response.json({repository:'owner/repo',branch:'main',path:`src/file-${reads}.ts`,content:'source evidence'});
 });
 try{const result=await runAgentTurn([{role:'user',content:'Trace the helpers'}],'veltra-logic',{},async()=>false,()=>{},()=>{},{id:'task',fetch:globalThis.fetch} as TaskAccessClient);assert.match(result,/Checked seven/);assert.equal(reads,7);assert.equal(rounds,8);}
 finally{if(previous===undefined)delete (globalThis as any).window;else (globalThis as any).window=previous;}
});
test('budget exhaustion summarizes the collected transcript without executable tools, and safely falls back on failure',async t=>{
 const previous=(globalThis as any).window;(globalThis as any).window={sessionStorage:{getItem:()=>''}};
 try{for(const mode of ['summary','provider-failure','unexpected-tool','batch-limit','cancel'] as const){
  let rounds=0,reads=0,finals=0,approvals=0,cancelled=false;
  const mock=t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
   if(input==='/api/chat'){
    const body=JSON.parse(String(init?.body));assert.equal(body.model,'veltra-logic');assert.equal(body.task_id,'fixture-task');
    if(body.tools.length){rounds++;return Response.json({choices:[{message:{tool_calls:mode==='batch-limit'?Array.from({length:30},(_,i)=>tool(i)):[tool(rounds)]}}]});}
    finals++;assert.equal(body.tool_choice,'none');assert.deepEqual(body.tools,[]);assert.equal(body.max_tokens,2000);
    const collected=body.messages.filter((m:any)=>m.role==='tool');assert.equal(collected.length,mode==='batch-limit'?30:12);assert.match(collected[0].content,/source evidence/);
    assert.match(body.messages.at(-1).content,/Separate verified observations/);
    if(mode==='provider-failure')return Response.json({detail:'Unavailable'},{status:502});
    if(mode==='unexpected-tool')return Response.json({choices:[{message:{tool_calls:[{id:'write',type:'function',function:{name:'github_propose_commit',arguments:'{}'}}]}}]});
    return Response.json({choices:[{message:{content:'Verified: src/file-1.ts was read. Unknown: downstream behavior; inspect its caller next.'}}]});
   }
   assert.ok(String(input).startsWith('/api/connections/github/file?'));reads++;if(mode==='cancel'&&reads===12)cancelled=true;
   return Response.json({repository:'owner/repo',branch:'main',path:'src/file.ts',content:'source evidence'});
  });
  const run=()=>runAgentTurn([{role:'user',content:'Investigate'}],'veltra-logic',{},async()=>{approvals++;return false;},()=>{},()=>{},{id:'fixture-task',fetch:globalThis.fetch} as TaskAccessClient,{cancelled:()=>cancelled,event:()=>{}});
  if(mode==='cancel'){await assert.rejects(run,/stopped/);assert.equal(finals,0);}
  else{const result=await run();assert.equal(finals,1);if(['provider-failure','unexpected-tool'].includes(mode)){assert.match(result,/execution receipts, not confirmed findings/);assert.match(result,/src\/file-1.ts/);}else assert.match(result,/Partial investigation/);}
  assert.equal(approvals,0);assert.equal(reads,mode==='batch-limit'?24:12);assert.equal(rounds,mode==='batch-limit'?1:12);mock.mock.restore();
 }}finally{if(previous===undefined)delete (globalThis as any).window;else (globalThis as any).window=previous;}
});
