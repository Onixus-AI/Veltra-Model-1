import {test} from 'node:test';import assert from 'node:assert/strict';import {usageActivity} from '../lib/usage-activity';
test('activity counts use the signed-in Mail account and an owned CRM workspace, never a supplied tenant',async t=>{
 const keys=['VELTRA_MAIL_URL','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const,old=keys.map(k=>process.env[k]);
 process.env.VELTRA_MAIL_URL='https://mail.example.test';process.env.NEXT_PUBLIC_SUPABASE_URL='https://fixture.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='fixture';
 const workspace='00000000-0000-4000-8000-000000000001',user='00000000-0000-4000-8000-000000000002';let owned=true;
 const mock=t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(String(input));assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer fixture-user');
  if(url.hostname==='mail.example.test')return Response.json({month:'2026-10',operations:20,model_requests:2,known_tokens:100,workspace_id:workspace,daily:[{date:'2026-10-27',operations:20}]});
  if(url.pathname==='/auth/v1/user')return Response.json({id:user,is_anonymous:false});
  if(url.pathname.endsWith('crm_workspaces')){assert.equal(url.searchParams.get('owner_id'),'eq.'+user);return Response.json(owned?{id:workspace}:null);}
  assert.equal(url.searchParams.get('workspace_id'),'eq.'+workspace);assert.match(url.searchParams.get('created_at')??'',/^gte\.2026-10-/);assert.match(url.search,/lt\./);
  if(url.pathname.endsWith('crm_customers'))return new Response(null,{headers:{'Content-Range':'0-8/9'}});
  assert.equal(init?.method,'HEAD');return new Response(null,{headers:{'Content-Range':url.searchParams.get('created_at')==='gte.2026-10-27T00:00:00Z'?'0-95001/95002':'*/0'}});
 });
 try{const request=new Request('https://workspace.example/api/usage?workspace_id=hostile',{headers:{Authorization:'Bearer fixture-user'}}),period={month:'2026-10',since:'2026-10-01T00:00:00Z',period_end:'2026-11-01T00:00:00Z'};
  const result=await usageActivity(request,period);assert.equal(result.activity.mail.operations,20);assert.equal(result.activity.crm.operations,95002);assert.equal(result.activity.crm.records_created,9);assert.equal(result.activity_daily['2026-10-27'].mail,20);assert.equal(result.activity_daily['2026-10-27'].crm,95002);
  owned=false;const denied=await usageActivity(request,period);assert.equal(denied.activity.mail.status,'verified');assert.equal(denied.activity.crm.status,'unavailable');assert.equal(denied.activity_daily['2026-10-27'].crm,undefined);
 }finally{mock.mock.restore();keys.forEach((k,i)=>{if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i];});}
});
