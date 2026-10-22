import {test} from 'node:test';
import assert from 'node:assert/strict';
import {brainManagerHandler} from '../lib/brain-manager-server';
import {recallBrain} from '../lib/shared-brain';
import {memorySourceUrl} from '../lib/brain-manager-client';
import {fixture,W,C,U,X} from './helpers/brain-fixture';
function manager(role='owner'){
 const f=fixture(role),handler=brainManagerHandler((async(request:Request)=>{if(request.headers.get('authorization')!=='Bearer test-owner')throw Error('401:Sign in again.');return {client:f.client,user:{id:U}};}) as any);
 const call=(body:Record<string,unknown>,headers:Record<string,string>={})=>handler(new Request('https://veltra.test/api/brain',{method:'POST',headers:{Authorization:'Bearer test-owner','Content-Type':'application/json',...headers},body:JSON.stringify({business:true,...body})}));
 return {...f,call};
}
test('manager lists within scope, includes expired only on request and does not change automatic recall',async()=>{
 const f=manager();f.tables.veltra_memories.push(
  {id:C,user_id:U,workspace_id:W,customer_id:null,content:'Approved',status:'approved',expires_at:null},
  {id:X,user_id:U,workspace_id:W,customer_id:null,content:'Expired',status:'approved',expires_at:'2000-01-01T00:00:00Z'},
  {id:U,user_id:U,workspace_id:W,customer_id:null,content:'Proposed',status:'proposed',expires_at:null},
  {id:W,user_id:U,workspace_id:X,customer_id:null,content:'Other business',status:'approved',expires_at:null});
 const body={action:'search',crm_scope:{workspace_id:W}};
 const normal=await (await f.call(body)).json();assert.deepEqual(normal.records.map((r:any)=>r.content),['Approved','Proposed']);assert.equal(normal.can_write,true);
 const all=await (await f.call({...body,include_expired:true})).json();assert.equal(all.records.length,3);
 assert.deepEqual((await recallBrain(f.client,U,{workspace_id:W})).map(item=>item.content),['Approved']);
 assert.equal((await f.call({action:'search'})).status,400);
 assert.equal((await f.call({...body,business:false})).status,409);
 assert.equal((await f.call({action:'search',crm_scope:{workspace_id:X}})).status,403);
});
test('manager writes require a server review, scope binding and single-use confirmation',async()=>{
 const f=manager(),scope={crm_scope:{workspace_id:W}};
 const preview=await (await f.call({...scope,action:'propose',content:'Hours are 9–5',source_ref:'Owner instruction',kind:'preference'})).json();
 assert.equal(preview.kind,'preview');assert.equal(f.tables.veltra_memories.length,0);
 assert.equal((await f.call({...scope,action:'confirm',review_id:preview.review_id,crm_scope:{workspace_id:W,customer_id:C}})).status,409);
 assert.equal((await f.call({...scope,action:'confirm',review_id:preview.review_id})).status,200);
 assert.equal(f.tables.veltra_memories[0].status,'proposed');
 assert.equal((await f.call({...scope,action:'confirm',review_id:preview.review_id})).status,409);
 const approval=await (await f.call({...scope,action:'approve',id:f.tables.veltra_memories[0].id})).json();
 assert.equal(f.tables.veltra_memories[0].status,'proposed');
 await f.call({...scope,action:'confirm',review_id:approval.review_id});assert.equal(f.tables.veltra_memories[0].status,'approved');
});
test('viewer roles, authentication, origin, invalid actions and input bounds are enforced',async()=>{
 const f=manager('viewer'),scope={crm_scope:{workspace_id:W}};
 const list=await (await f.call({...scope,action:'search'})).json();assert.equal(list.can_write,false);
 assert.equal((await f.call({...scope,action:'propose',content:'No',source_ref:'Owner'})).status,403);
 assert.equal((await f.call({...scope,action:'search'},{Authorization:''})).status,401);
 assert.equal((await f.call({...scope,action:'search'},{Origin:'https://outside.test'})).status,403);
 assert.equal((await f.call({...scope,action:'execute'})).status,400);
 assert.equal((await f.call({...scope,action:'search',query:'x'.repeat(201)})).status,400);
 assert.equal((await f.call({...scope,action:'search',query:123})).status,400);
 assert.equal((await f.call({...scope,action:'confirm'})).status,400);
 assert.equal((await f.call({...scope,action:'search',query:'x'.repeat(17000)})).status,413);
 assert.equal(memorySourceUrl('javascript:alert(1)'),null);assert.equal(memorySourceUrl('https://user:password@example.test'),null);
 assert.equal(memorySourceUrl('Owner instruction'),null);assert.equal(memorySourceUrl('https://example.test/source'),'https://example.test/source');
});
