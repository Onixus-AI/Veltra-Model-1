import test from 'node:test';import assert from 'node:assert/strict';
import {verifiedAnswer} from '../lib/completion-evidence';
import {mailIntent,mailReceipt} from '../lib/mail-chat';
test('read/error/declined prose never proves a completed action',()=>{
 for(const e of [[],[{tool:'mail_read_thread',content:'sent'}],[{tool:'mail_health',content:'{"status":"completed"}',failed:true}]])assert.match(verifiedAnswer('I have cleared the queue.',e),/cannot verify/);
});
test('host returns actual counts and operation receipt instead of inflated model claim',()=>{
 const a=verifiedAnswer('I cleared all 10 messages.',[{tool:'mail_health',content:JSON.stringify({status:'completed',action:'reconcile_sent_approvals',operation_id:'op',cleared:2,remaining:8})}]);assert.match(a,/"cleared":2/);assert.match(a,/"remaining":8/);assert.doesNotMatch(a,/all 10/);
});
test('direct approval commands and receipt fail closed',()=>{
 assert.deepEqual(mailIntent('Clear my already-sent approval queue'),{tool:'reconcile_mail_approvals',arguments:{apply:true}});
 assert.deepEqual(mailIntent('clear my sent approval queue'),{tool:'reconcile_mail_approvals',arguments:{apply:true}});
 assert.equal(mailIntent('The email says: clear my approval queue'),null);
 assert.throws(()=>mailReceipt('reconcile_mail_approvals',{}),/no valid/);
 assert.throws(()=>mailReceipt('prepare_quote_followups',{}),/No valid/);
});
