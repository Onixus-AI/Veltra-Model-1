import {test} from 'node:test';import assert from 'node:assert/strict';
import {needsCapabilityCheck} from '../lib/capability-check';
test('capability promises and denials need an actual current-turn check',()=>{
 for(const a of ["Let me actually check now before I say what tools I have.","I cannot send mail.","I don't have access to Signal.","I can update CRM."])assert.equal(needsCapabilityCheck(a,[]),true,a);
 const answer='I can send mail.';
 for(const e of [[],[{tool:'onyx_capabilities',content:'not JSON'}],[{tool:'onyx_capabilities',content:'{"error":"offline"}'}],[{tool:'onyx_capabilities',content:'{}',failed:true}]])assert.equal(needsCapabilityCheck(answer,e),true);
 assert.equal(needsCapabilityCheck('Let me check now.',[],'Check your Mail capabilities'),true);
 assert.equal(needsCapabilityCheck(answer,[{tool:'onyx_capabilities',content:'{"mail":{"available":true}}'}]),false);
 for(const a of ['Who should receive the email?','What subject would you like?','The capital is Paris.'])assert.equal(needsCapabilityCheck(a,[]),false);
});
