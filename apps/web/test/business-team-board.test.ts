import test from 'node:test';
import assert from 'node:assert/strict';
import {workStage,blockerText,type OperationalJob} from '../lib/business-team/work-board';
const job={id:'j',kind:'mail.send',run_at:'2026-10-29',updated_at:'2026-10-29',finished_at:null,attempts:1,max_attempts:3,last_error:null,cancel_reason:null} as OperationalJob;
test('business outcomes require a successful source job; dead and cancelled work stays blocked',()=>{
 assert.equal(workStage({...job,status:'succeeded'}),'Complete');
 for(const status of ['dead','cancelled','failed'])assert.equal(workStage({...job,status}),'Blocked');
 assert.equal(workStage({...job,status:'running'}),'Working');assert.equal(workStage({...job,status:'queued'}),'Scheduled');
 assert.equal(blockerText({...job,status:'dead',last_error:{message:'Reconnect mailbox'}}),'Reconnect mailbox');
});
