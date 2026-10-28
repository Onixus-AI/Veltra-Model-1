import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AGENT_TOOLS} from '../lib/agent-tool-catalog';
import {toolSessionError,toolSessionReference} from '../lib/onyx-action-capabilities';
import {agentAction} from '../lib/agent-actions';
import {runBrain,recallBrain} from '../lib/shared-brain';
import {fixture,U} from './helpers/brain-fixture';
const advertised=(...names:string[])=>names.map(name=>({type:'function',function:{name}}));
test('memory approval is advertised without proposal-only required fields',()=>{
 const tool=AGENT_TOOLS.find(t=>t.function.name==='brain_change')!;
 assert.deepEqual(tool.function.parameters.required,['action']);
 assert.deepEqual((tool.function.parameters.properties.action as any).enum,['propose','approve','correct','forget']);
 assert.match(toolSessionReference(advertised('brain_change','github_develop')),/approval_arguments.*action.*id/);
});
test('old development tabs must refresh instead of using obsolete policy',()=>{
 assert.match(toolSessionError(advertised('github_review_proposal'))??'',/Refresh Workspace/);
 assert.equal(toolSessionError(advertised('github_develop')),null);
 assert.equal(toolSessionError(undefined),null);
 assert.doesNotMatch(toolSessionReference([]),/"tool":"github_develop"/);
});
test('agent approval needs only action and id, waits for review and returns receipt',async()=>{
 const f=fixture();
 const p=await runBrain({...f,plan:{action:'propose',content:'Use actual execution receipts',source_ref:'Owner instruction'}});
 await runBrain({...f,review_id:p.review_id});const id=f.tables.veltra_memories[0].id;
 const base={...f,authorization:'Bearer fixture-user'};
 const review=await agentAction({...base,name:'brain_change',args:{action:'approve',id}});
 assert.ok(review.proposal?.agent_review);assert.equal(f.tables.veltra_memories[0].status,'proposed');
 const result=await agentAction({...base,name:'confirm',args:{},confirm:review.proposal!.agent_review});
 const receipt=JSON.parse(result.content);assert.equal(receipt.status,'completed');assert.equal(receipt.approval,'confirmed');
 assert.equal(f.tables.veltra_memories[0].status,'approved');assert.equal((await recallBrain(f.client,U,f.scope)).length,1);
});
