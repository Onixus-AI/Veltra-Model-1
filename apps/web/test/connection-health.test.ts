import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectionHealth} from '../lib/connection-health';
test('connection checks distinguish access, setup and verified links without certifying operations',()=>{
 assert.equal(connectionHealth('crm',200,{connected:true,available:true,has_workspace:true}).state,'linked');
 assert.equal(connectionHealth('crm',200,{connected:false,available:true,has_workspace:true}).state,'disconnected');
 assert.equal(connectionHealth('crm',200,{connected:true,available:true,has_workspace:false}).state,'setup');
 assert.equal(connectionHealth('mail',200,{connected:false}).state,'disconnected');
 const mail=connectionHealth('mail',200,{connected:true,mailbox:{email:'fixture@example.test'}});assert.equal(mail.state,'linked');assert.match(mail.detail,/sending still need separate verification/);
 assert.equal(connectionHealth('mail',401,{}).state,'signin');
 assert.equal(connectionHealth('crm',403,{}).state,'denied');
});
test('failed or malformed checks never masquerade as a disconnected or healthy account',()=>{
 for(const status of [0,429,500,502,503])assert.equal(connectionHealth('mail',status,{connected:true}).state,'unavailable');
 for(const value of [null,{},'html error',{connected:'true'},{connected:true},{connected:true,mailbox:{email:''}}])assert.equal(connectionHealth('mail',200,value).state,'unavailable');
 assert.equal(connectionHealth('crm',200,{connected:true,available:false,has_workspace:true}).state,'unavailable');
 assert.equal(connectionHealth('crm',200,{connected:true}).state,'unavailable');
});
