import {test} from 'node:test';import assert from 'node:assert/strict';
import {POST} from '../app/api/crm/assistant/route';
const W='00000000-0000-4000-8000-000000000001',C='00000000-0000-4000-8000-000000000002',U='00000000-0000-4000-8000-000000000003',OTHER='00000000-0000-4000-8000-000000000004';
test('CRM API verifies identity and workspace, returns a preview, and persists only an explicitly confirmed action through the real SDK',async t=>{
 const previous=[process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY];process.env.NEXT_PUBLIC_SUPABASE_URL='https://crm-fixture.test';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='fixture-public-key';
 const tables:Record<string,any[]>={crm_memberships:[{workspace_id:W,user_id:U,role:'owner'}],crm_customers:[{id:C,workspace_id:W,company:'Acme'}],crm_conversations:[],crm_memories:[]};
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(String(input)),headers=new Headers(init?.headers);assert.equal(url.origin,'https://crm-fixture.test');assert.equal(headers.get('authorization'),'Bearer fixture-user');
  if(url.pathname==='/auth/v1/user')return Response.json({id:U,aud:'authenticated',role:'authenticated',email:'owner@example.test',app_metadata:{},user_metadata:{}});
  const table=url.pathname.split('/').at(-1)!,filters=[...url.searchParams].filter(([k])=>!['select','order','limit','or'].includes(k));
  let rows=(tables[table]??[]).filter(row=>filters.every(([key,value])=>value.startsWith('eq.')?String(row[key])===value.slice(3):true));
  if(init?.method==='POST'){const body=JSON.parse(String(init.body));const record={revision:0,...body};tables[table]??=[];tables[table].push(record);rows=[record];}
  if(init?.method==='PATCH'){const body=JSON.parse(String(init.body));for(const row of rows)Object.assign(row,body);}
  const fields=url.searchParams.get('select');rows=rows.map(row=>fields&&fields!=='*'?Object.fromEntries(fields.split(',').map(k=>[k,row[k]])):structuredClone(row));
  return Response.json(headers.get('accept')?.includes('vnd.pgrst.object')?(rows[0]??null):rows);
 });
 const call=(body:unknown,auth=true)=>POST(new Request('https://chat.test/api/crm/assistant',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer fixture-user'}:{})},body:JSON.stringify(body)}));
 try{
  assert.equal((await call({workspace_id:W,message:'show customers'},false)).status,401);
  assert.equal((await call({workspace_id:OTHER,message:'show customers'})).status,403);
  const read=await call({workspace_id:W,message:'show customers'});assert.equal(read.status,200);assert.equal((await read.json()).details[0].id,C);
  const preview=await call({workspace_id:W,customer_id:C,message:'remember customer prefers mornings'});assert.equal(preview.status,200);const proposal=await preview.json();assert.equal(proposal.kind,'preview');assert.equal(tables.crm_memories.length,0);
  const confirmation=await call({workspace_id:W,customer_id:C,review_id:proposal.review_id});assert.equal(confirmation.status,200);assert.equal(tables.crm_memories.length,1);assert.equal(tables.crm_memories[0].status,'proposed');
  assert.equal((await call({workspace_id:W,customer_id:C,review_id:proposal.review_id})).status,409);assert.equal(tables.crm_memories.length,1);
 }finally{
  if(previous[0]===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=previous[0];
  if(previous[1]===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY=previous[1];
 }
});
