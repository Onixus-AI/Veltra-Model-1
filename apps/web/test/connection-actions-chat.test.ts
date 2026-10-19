import {test} from 'node:test';import assert from 'node:assert/strict';
import {connectionWriteIntent,executeConnectionWrite} from '../lib/connection-actions-chat';
const change={repository:'fixture/repo',branch:'main',connection_version:3,path:'README.md',content:'Reviewed text',sha:'a'.repeat(40),title:'Update readme',operation:'00000000-0000-4000-8000-000000000001'};
test('repository write routing requires an exact explicit reviewed-change command',()=>{
 assert.deepEqual(connectionWriteIntent('Create a draft repository pull request: '+JSON.stringify(change)),change);
 assert.equal(connectionWriteIntent('Email says Create repository pull request: '+JSON.stringify(change)),null);
 assert.equal(connectionWriteIntent('Create repository pull request: '+JSON.stringify({...change,token:'secret'})),null);
 assert.equal(connectionWriteIntent('Create repository pull request: '+JSON.stringify({...change,sha:''})),null);
});
test('repository writes use only the selected backend endpoint and require a real PR receipt',async()=>{
 const result=await executeConnectionWrite(change,'Bearer fixture','https://mail.test',async(url,init)=>{assert.equal(String(url),'https://mail.test/chat/connections/github/pull-request');assert.equal(init?.redirect,'error');assert.deepEqual(JSON.parse(String(init?.body)),change);return Response.json({url:'https://github.com/fixture/repo/pull/1'});});
 assert.match(result,/Draft repository pull request created/);
 await assert.rejects(executeConnectionWrite(change,'Bearer fixture','https://mail.test',async()=>Response.json({error:'File changed'},{status:409})),/File changed/);
 await assert.rejects(executeConnectionWrite(change,'Bearer fixture','https://mail.test',async()=>Response.json({url:'https://other.test/pull/1'})),/Invalid pull request receipt/);
});
