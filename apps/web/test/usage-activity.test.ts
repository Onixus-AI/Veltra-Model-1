import {test} from 'node:test';import assert from 'node:assert/strict';import {usageActivity} from '../lib/usage-activity';
test('CRM and linked Signal usage are owner-scoped, deduplicated and independent of Mail availability',async t=>{
 const keys=['VELTRA_MAIL_URL','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SIGNAL_SUPABASE_PUBLISHABLE_KEY'] as const,old=keys.map(k=>process.env[k]);
 process.env.VELTRA_MAIL_URL='https://mail.example.test';process.env.NEXT_PUBLIC_SUPABASE_URL='https://fixture.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='fixture';process.env.SIGNAL_SUPABASE_PUBLISHABLE_KEY='signal-public';
 const workspace='00000000-0000-4000-8000-000000000001',user='00000000-0000-4000-8000-000000000002';let owned=true,signalCalls=0;
 const mock=t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(String(input));assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer fixture-user');
  if(url.hostname==='mail.example.test')return Response.json({error:'down'},{status:503});
  if(url.hostname==='rjwbfkuzgusaoizcmmgf.supabase.co'){signalCalls++;const b=JSON.parse(String(init?.body));assert.deepEqual(b,{workspace,action:'usage',month:'2026-10'});return Response.json({ok:true,scope:{workspace_id:workspace},receipt:{metering:{measured_ai_credits:42,model_generations:1,token_receipts:1,unmetered_generations:0,provider_cost_usd:.0001,cost_receipts:1,pending_generations:0,receipts:[]},month:'2026-10',status:'verified',operations:7,published:2,model_requests:3,provider_cost_cents:12,provider_cost_receipts:3,image_provider_cost_usd:0,image_cost_receipts:0,signal_credits_used:9,signal_credits_returned:1,daily:[{date:'2026-10-27',operations:7}],warnings:[]}});}
  if(url.pathname==='/auth/v1/user')return Response.json({id:user,is_anonymous:false});
  if(url.pathname.endsWith('crm_workspaces')){assert.equal(url.searchParams.get('owner_id'),'eq.'+user);return Response.json(owned?[{id:workspace}]:[]);}
  assert.equal(url.searchParams.get('workspace_id'),'in.('+workspace+')');
  if(url.pathname.endsWith('crm_signal_connections'))return Response.json([{workspace_id:workspace,signal_client_id:user},{workspace_id:workspace,signal_client_id:user}]);
  assert.match(url.searchParams.get('created_at')??'',/^gte\.2026-10-/);assert.match(url.search,/lt\./);
  if(url.pathname.endsWith('crm_customers'))return new Response(null,{headers:{'Content-Range':'0-8/9'}});
  assert.equal(init?.method,'HEAD');return new Response(null,{headers:{'Content-Range':url.searchParams.get('created_at')==='gte.2026-10-27T00:00:00Z'?'0-95001/95002':'*/0'}});
 });
 try{const request=new Request('https://workspace.example/api/usage?workspace_id=hostile',{headers:{Authorization:'Bearer fixture-user'}}),period={month:'2026-10',since:'2026-10-01T00:00:00Z',period_end:'2026-11-01T00:00:00Z'};
  const r=await usageActivity(request,period);assert.equal(r.activity.mail.status,'unavailable');assert.equal(r.activity.crm.operations,95002);assert.equal(r.activity.crm.records_created,9);assert.equal(r.activity.signal.operations,7);assert.equal(r.activity.signal.metering?.measured_ai_credits,42);assert.equal(r.activity.signal.metering?.provider_cost_usd,.0001);assert.equal(r.activity.signal.signal_credits_used,9);assert.equal(r.activity.signal.provider_cost_cents,12);assert.equal(r.activity_daily['2026-10-27'].signal,7);assert.equal(signalCalls,1);
  owned=false;const denied=await usageActivity(request,period);assert.equal(denied.activity.crm.operations,0);assert.equal(denied.activity.signal.status,'unavailable');assert.equal(signalCalls,1);
 }finally{mock.mock.restore();keys.forEach((k,i)=>{if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i];});}
});
