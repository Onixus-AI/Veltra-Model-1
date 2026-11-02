import test from 'node:test';
import assert from 'node:assert/strict';
import {readBusinessOverview} from './client.mjs';
const workspace='11111111-1111-4111-8111-111111111111';
const options={origin:'https://workspace.test',token:'fixture-user-token',workspace};
const receipt={workspace,period:'month',overview:{metrics:{payments:{known:false},leads:{total:3}},unknowns:['payments']},completed:null,tasks:null};
test('the headless example reads one fixed route with the caller identity and preserves unknown results',async()=>{
 let calls=0;
 const result=await readBusinessOverview({...options,fetcher:async(url,init)=>{
  calls++;assert.equal(url.origin,options.origin);assert.equal(url.pathname,'/api/workspace/overview');assert.equal(url.searchParams.get('workspace'),workspace);assert.equal(url.searchParams.get('period'),'month');assert.equal(url.searchParams.has('token'),false);assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,'Bearer fixture-user-token');assert.equal(init.body,undefined);return Response.json(receipt);
 }});
 assert.equal(calls,1);assert.deepEqual(result,receipt);assert.equal(result.overview.metrics.payments.collected_cents,undefined);assert.equal(result.completed,null);assert.equal(result.tasks,null);
});
test('invalid configuration never transmits an account token',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return Response.json(receipt);};
 for(const override of [{origin:'http://remote.test'},{origin:'https://user:password@remote.test'},{origin:'https://remote.test/extra'},{origin:'https://remote.test/?target=x'},{token:'veltra_sk_fixture'},{token:'Bearer token'},{workspace:'other'},{period:'year'}])await assert.rejects(()=>readBusinessOverview({...options,...override,fetcher}));
 assert.equal(calls,0);
 await readBusinessOverview({...options,origin:'http://127.0.0.1:3000',fetcher});assert.equal(calls,1);
});
test('denied, malformed, wrong-business and unavailable responses never become a successful overview',async()=>{
 for(const status of [401,403,429,503]){
  let calls=0;
  await assert.rejects(()=>readBusinessOverview({...options,fetcher:async()=>{calls++;return Response.json({error:'private upstream details fixture-secret'},{status});}}),(error)=>!error.message.includes('fixture-secret'));
  assert.equal(calls,1,'failed requests are not retried automatically');
 }
 for(const response of [Response.json({...receipt,workspace:'another-business'}),Response.json({...receipt,period:'week'}),Response.json({...receipt,overview:null}),new Response('<html>sign in</html>',{headers:{'content-type':'text/html'}})])await assert.rejects(()=>readBusinessOverview({...options,fetcher:async()=>response}));
 await assert.rejects(()=>readBusinessOverview({...options,fetcher:async()=>{throw Error('fixture-token in upstream error');}}),/could not be reached/);
});
