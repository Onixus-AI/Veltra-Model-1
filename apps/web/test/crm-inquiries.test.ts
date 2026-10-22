import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {inquiryDraft,inquiryService} from '../lib/crm/inquiries';
const draft={id:'00000000-0000-4000-8000-000000000001',subject:' Quote request ',message:' Please quote transport. ',source:'phone',received_at:'2026-10-22T10:00:00Z'};
test('enquiry details are bounded and preserve the supplied source and timestamp',()=>{
 assert.equal(inquiryDraft(draft).subject,'Quote request');
 for(const change of [{subject:' '},{message:'x'.repeat(4001)},{source:'invented'},{received_at:'invalid'}])assert.throws(()=>inquiryDraft({...draft,...change}),/Check the enquiry/);
});
test('enquiry writes keep the exact workspace/customer and retry ID; stale updates are rejected',async()=>{
 const requests:{url:URL;method:string;body:any}[]=[];let attempt=0;
 const row={...inquiryDraft(draft),workspace_id:'workspace',customer_id:'customer',status:'new',created_at:draft.received_at};
 const client=createClient('https://fixture.supabase.co','fixture-public-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(url,init)=>{
  const method=init?.method??'GET';requests.push({url:new URL(String(url)),method,body:init?.body?JSON.parse(String(init.body)):null});
  if(method==='POST'){attempt++;return attempt===1?Response.json(row):Response.json({code:'23505',message:'duplicate'},{status:409});}
  if(method==='PATCH')return Response.json(null);
  return Response.json(row);
 }}}),service=inquiryService(client);
 const created=await service.create('workspace','customer',draft);assert.equal(created.id,draft.id);
 const retry=await service.create('workspace','customer',draft);assert.equal(retry.id,draft.id);
 assert.equal(requests.filter(r=>r.method==='POST').length,2);assert.equal(requests[0].body.workspace_id,'workspace');assert.equal(requests[0].body.customer_id,'customer');assert.equal(requests[0].body.created_by,undefined);
 const lookup=requests.find(r=>r.method==='GET')!;assert.equal(lookup.url.searchParams.get('workspace_id'),'eq.workspace');assert.equal(lookup.url.searchParams.get('customer_id'),'eq.customer');
 await assert.rejects(service.status('workspace','customer',created,'closed'),/changed or access/);
 const update=requests.find(r=>r.method==='PATCH')!;assert.deepEqual(update.body,{status:'closed'});assert.equal(update.url.searchParams.get('status'),'eq.new');
 await assert.rejects(service.create('workspace','customer',{...draft,message:'Changed after an uncertain save'}),/could not be confirmed/);
});
