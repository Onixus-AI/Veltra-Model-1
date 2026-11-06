import {test} from 'node:test';import assert from 'node:assert/strict';import {toolFailureSummary} from '../lib/business-team/tool-failures';
test('daily failure intake distinguishes unavailable data and bounded metadata counts',()=>{
 assert.equal(toolFailureSummary(null).count,null);assert.equal(toolFailureSummary([]).count,0);
 const r=toolFailureSummary([{tool:'mail_health'},{tool:'mail_health'},{tool:'secret@example.test'}]);assert.deepEqual(r.tools,[{tool:'mail_health',count:2},{tool:'unknown',count:1}]);
 assert.equal(toolFailureSummary(Array.from({length:501},()=>({tool:'mail_health'}))).truncated,true);
});
