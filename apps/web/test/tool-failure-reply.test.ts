import {test} from 'node:test';import assert from 'node:assert/strict';import {capabilityFailureReply} from '../lib/tool-failure-reply';
test('Mail failure gives a clear next step without exposing tool instructions or claiming a send',()=>{
 const r=capabilityFailureReply([{tool:'mail_health',failed:true,content:'Tool mail_health failed: Mail could not complete this command. Tell the user; do not guess the result.'}]);
 assert.match(r,/cannot verify the queue or confirm any email was sent/);assert.match(r,/Open Mail/);assert.doesNotMatch(r,/Tell the user|Tool mail_health|capability claim/);
 assert.match(capabilityFailureReply([{tool:'mail_health',failed:true,content:'Connect Onixus Mail in Connections first.'}]),/Workspace → Connections/);
});
