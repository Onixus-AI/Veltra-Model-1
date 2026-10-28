import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CHAT_TOOLS,runToolCall} from '../lib/chat-tools';
import type {TaskAccessClient} from '../lib/task-access-client';
test('publishing tools are hidden and stale calls cannot contact a provider',async t=>{
 assert(CHAT_TOOLS.some(t=>t.function.name==='github_develop'));
 for(const name of ['github_propose_commit','github_propose_changes']){
  assert(!CHAT_TOOLS.some(t=>t.function.name===name));
  const mock=t.mock.method(globalThis,'fetch',async()=>{throw Error('Unexpected network request');});
  const result=await runToolCall({id:'paused',type:'function',function:{name,arguments:'{}'}});
  assert.equal(result.failed,true);assert.match(result.content,/legacy publishing tool is retired/);assert.equal(result.proposal,undefined);assert.equal(mock.mock.callCount(),0);mock.mock.restore();
 }
});
test('proposal evidence preserves host verification limits without a write approval',async()=>{
 const previous=(globalThis as any).window;(globalThis as any).window={sessionStorage:{getItem:()=> 'fixture-user'}};
 try{
 const args={sources:[{path:'src/config.ts',quote:'export const enabled = true;'}],observed_behavior:'Observed current behavior',intended_behavior:'Different intended behavior',verification:{directory:'.',command:'npm run check',expected_before:'Current expectation fails',expected_after:'Changed expectation passes'}};
 const evidence={...args,repository:'owner/repo',base_sha:'a'.repeat(40),sources:[{...args.sources[0],line_start:2,line_end:2}],diagnosis_status:'unverified',can_publish:false,verification:{...args.verification,execution_status:'not_run',script_check:'exists'}};
 let requests=0;
 const access={id:'fixture-task',fetch:async(input:RequestInfo|URL,init?:RequestInit)=>{requests++;assert.equal(input,'/api/connections/github/proposal-evidence');assert.equal(init?.method,'POST');assert.deepEqual(JSON.parse(String(init?.body)),args);return Response.json(evidence);}} as TaskAccessClient;
 const result=await runToolCall({id:'evidence',type:'function',function:{name:'github_review_proposal',arguments:JSON.stringify(args)}},{},access);
 assert.equal(requests,1);assert.equal(result.proposal,undefined);assert.deepEqual(result.data,evidence);assert.match(result.canvas?.content??'',/Diagnosis unverified. Tests not run. Publishing paused/);assert.match(result.canvas?.content??'',/lines 2–2/);
 }finally{if(previous===undefined)delete (globalThis as any).window;else (globalThis as any).window=previous;}
});
test('release approval is separate, declined releases never execute, and merge is not deployment',async()=>{
 const {runAgentTurn}=await import('../lib/chat-tools');const old=(globalThis as any).window;(globalThis as any).window={sessionStorage:{getItem:()=> 'fixture'}};
 try{for(const approve of [false,true]){let turns=0,merges=0,reviewed=false;
 const access={id:'task',fetch:async(input:any,init?:RequestInit)=>{
  if(input==='/api/chat'){if(turns++===0)return Response.json({choices:[{message:{tool_calls:[{id:'release',type:'function',function:{name:'github_develop',arguments:JSON.stringify({action:'release',args:{pull_request:7}})}}]}}]});return Response.json({choices:[{message:{content:approve?'I merged and deployed it.':'Cancelled.'}}]});}
  if(input==='/api/connections/github/release-review')return Response.json({ticket:'opaque-ticket',repository:'owner/repo',pull_request:7,commit_sha:'a'.repeat(40),summary:'Merge this exact head after approval; pipeline may deploy.'});
  assert.equal(input,'/api/connections/github/release');assert.equal(reviewed,true);assert.equal(approve,true);merges++;return Response.json({status:'completed',action:'merge_reviewed_pr',approval:'confirmed',receipt:{merge_sha:'b'.repeat(40)},deployment_status:'unverified'});
 }} as TaskAccessClient;
 const answer=await runAgentTurn([{role:'user',content:'Prepare release'}],'fixture',{},async p=>{assert.ok(p.release);assert.equal(merges,0);reviewed=true;return approve;},()=>{},()=>{},access);
 assert.equal(merges,approve?1:0);if(approve){assert.match(answer,/deployment_status.*unverified/);assert.doesNotMatch(answer,/I merged and deployed it/);}
 }}finally{if(old===undefined)delete(globalThis as any).window;else(globalThis as any).window=old;}
});
