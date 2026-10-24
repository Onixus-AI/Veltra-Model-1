import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
import {Sandbox} from '@vercel/sandbox';
import {POST} from '../app/api/build/verify/route';
const ID='00000000-0000-4000-8000-000000000001';
test('repository verification requires owned completed task and claim, then fetches source with caller auth',async t=>{
 const env={AI_GATEWAY_URL:'https://gateway.test',VELTRA_MAIL_URL:'https://mail.test',NEXT_PUBLIC_SUPABASE_URL:'https://fixture.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture',VELTRA_TASK_ACCESS_ENABLED:'false'};
 const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 let mode='missing',sandboxes=0,snapshots=0,finished=0;
 const files=[{path:'flag.mjs',content:'export const flag=false;'},{path:'flag.test.mjs',content:"import assert from 'node:assert/strict'; import {flag} from './flag.mjs'; assert.equal(flag,false);"}];
 const fetchMock=t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);assert.equal((init?.headers as any)?.Authorization??new Headers(init?.headers).get('authorization'),'Bearer fixture-user');
  if(url.includes('/v1/agent-runs/'))return mode==='missing'?Response.json({detail:'Not found'},{status:404}):Response.json({id:ID,status:'completed',state:{artifacts:{files}}});
  if(url.includes('/auth/v1/user'))return Response.json({id:ID,aud:'authenticated',role:'authenticated',is_anonymous:false});
  if(url.includes('/rpc/claim_agent_verification'))return Response.json(mode!=='claimed');
  if(url.includes('/rpc/finish_agent_verification')){finished++;return Response.json(null);}
  assert.equal(url,'https://mail.test/chat/connections/github/verification-files');snapshots++;assert.deepEqual(JSON.parse(String(init?.body)),{paths:files.map(f=>f.path)});return Response.json({repository:'owner/repo',branch:'main',base_sha:'a'.repeat(40),files:[{path:'flag.mjs',content:'export const flag=true;'},{path:'flag.test.mjs',content:null}]});
 });
 const sandboxMock=t.mock.method(Sandbox,'create',async()=>{sandboxes++;return {mkDir:async()=>{},writeFiles:async()=>{},runCommand:async()=>({exitCode:0,stdout:async()=>'',stderr:async()=>''}),stop:async()=>{}} as any;});
 const request=()=>new NextRequest('https://web.test/api/build/verify',{method:'POST',headers:{Authorization:'Bearer fixture-user','Content-Type':'application/json'},body:JSON.stringify({run_id:ID,repository:true,test_path:'flag.test.mjs'})});
 try{
  assert.equal((await POST(request())).status,404);assert.equal(sandboxes,0);
  mode='claimed';assert.equal((await POST(request())).status,409);assert.equal(sandboxes,0);assert.equal(snapshots,0);
  mode='allowed';const response=await POST(request());assert.equal(response.status,200);const receipt=await response.json();assert.equal(receipt.before_failed_after_passed,false);assert.equal(receipt.can_publish,false);assert.equal(receipt.checks.length,2);assert.equal(sandboxes,2);assert.equal(snapshots,1);assert.equal(finished,1);
 }finally{fetchMock.mock.restore();sandboxMock.mock.restore();for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
