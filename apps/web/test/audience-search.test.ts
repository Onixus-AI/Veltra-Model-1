import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {searchAudience} from '../lib/crm/audience-search';
test('audience queries are scoped, bounded, ordered and preserve eligibility filters',async()=>{
 const requests:URL[]=[];
 const client=createClient('https://fixture.supabase.co','fixture-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input)=>{requests.push(new URL(String(input)));return Response.json([{id:'returned',company:'Acme'}]);}}});
 const signal=new AbortController().signal;
 assert.equal((await searchAudience(client,'business-one','logistics),workspace_id.eq.other%',signal)).length,1);
 const url=requests[0];assert.equal(url.searchParams.get('workspace_id'),'eq.business-one');assert.equal(url.searchParams.get('limit'),'100');assert.equal(url.searchParams.get('email'),'not.is.null');assert.equal(url.searchParams.get('suppressed'),'eq.false');assert.equal(url.searchParams.get('identity_review_required'),'eq.false');assert.equal(url.searchParams.get('order'),'company.asc,id.asc');assert.doesNotMatch(url.searchParams.get('or')??'',/workspace_id\.eq/);
 await searchAudience(client,'business-two','',signal,'selected-record');assert.equal(requests[1].searchParams.get('id'),'eq.selected-record');assert.equal(requests[1].searchParams.get('workspace_id'),'eq.business-two');assert.equal(requests[1].searchParams.get('or'),null);assert.equal(requests.length,2);
});
test('failed audience reads are never returned as an empty eligible audience',async()=>{
 const client=createClient('https://fixture.supabase.co','fixture-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async()=>Response.json({message:'Denied'},{status:403})}});
 await assert.rejects(searchAudience(client,'business','',new AbortController().signal),/could not load/);
});
