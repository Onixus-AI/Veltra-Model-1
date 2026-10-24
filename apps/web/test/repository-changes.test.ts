import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runAgentTurn} from '../lib/chat-tools';
import type {TaskAccessClient} from '../lib/task-access-client';
test('coordinated repository changes show complete file review and publish only after approval',async t=>{
 const previous=(globalThis as any).window;(globalThis as any).window={sessionStorage:{getItem:()=> 'fixture-user'}};
 try{for(const approved of [false,true]){
  let turns=0,writes=0,reviewed=false;const files=[{path:'src/existing.ts',content:'updated'},{path:'src/new.ts',content:''}];
  const mock=t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
   const body=init?.body?JSON.parse(String(init.body)):null;
   if(input==='/api/chat')return Response.json({choices:[{message:turns++===0?{tool_calls:[{id:'change',type:'function',function:{name:'github_propose_changes',arguments:JSON.stringify({title:'Fix two files',files})}}]}:{content:'Review handled.'}}]});
   if(input==='/api/connections/github/change-set'){assert.equal(writes,0);return Response.json({repository:'owner/repo',branch:'main',connection_version:3,base_sha:'a'.repeat(40),title:body.title,files,before:[{path:'src/existing.ts',content:'old'},{path:'src/new.ts',content:null}]});}
   assert.equal(input,'/api/connections/github/pull-request-set');assert.equal(reviewed,true);assert.equal(approved,true);assert.deepEqual(body.files,files);assert.equal(body.base_sha,'a'.repeat(40));assert.equal('before' in body,false);writes++;return Response.json({url:'https://github.com/owner/repo/pull/7'});
  });
  const access={id:'fixture-task',fetch:globalThis.fetch} as TaskAccessClient;
  await runAgentTurn([{role:'user',content:'Fix these two files'}],'veltra-agent',{},async proposal=>{assert.equal(writes,0);assert.deepEqual(proposal.repository_review,[{path:'src/existing.ts',before:'old',after:'updated'},{path:'src/new.ts',before:null,after:''}]);reviewed=true;return approved;},()=>{},()=>{},access);
  assert.equal(writes,approved?1:0);mock.mock.restore();
 }
 }finally{if(previous===undefined)delete (globalThis as any).window;else (globalThis as any).window=previous;}
});
