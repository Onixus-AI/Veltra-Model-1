import {test} from 'node:test';
import assert from 'node:assert/strict';
import {POST as accessRoute} from '../app/api/ai-access/route';
import {POST as toolRoute} from '../app/api/agent/tools/route';
import {POST as chatRoute} from '../app/api/chat/route';
import {GET as connectionProxy} from '../app/api/connections/[...path]/route';
import {mailProxy} from '../lib/mail-proxy';
import {NextRequest} from 'next/server';
const TASK='00000000-0000-4000-8000-000000000001',USER='00000000-0000-4000-8000-000000000002';
test('AI tool and direct-chat routes stop before Mail provider access unless this user and task have Allow',async t=>{
 const oldFlag=process.env.VELTRA_TASK_ACCESS_ENABLED;process.env.VELTRA_TASK_ACCESS_ENABLED='true';
 const before={url:process.env.NEXT_PUBLIC_SUPABASE_URL,key:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,mail:process.env.VELTRA_MAIL_URL};
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://permission-fixture.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='fixture-public';process.env.VELTRA_MAIL_URL='https://mail.example.test';
 try{for(const mode of ['missing','deny','expired','allow','disabled']){
  process.env.VELTRA_TASK_ACCESS_ENABLED=mode==='disabled'?'false':'true';
  let providers=0;
  const mock=t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL)=>{const url=String(input);
   if(url.includes('/auth/v1/user'))return Response.json({id:USER,aud:'authenticated',role:'authenticated',is_anonymous:false,email:'owner@example.test',app_metadata:{},user_metadata:{}});
   if(url.includes('/rest/v1/veltra_ai_tasks')){assert.ok(url.includes('user_id=eq.'+USER));return Response.json(mode==='missing'?null:{id:TASK,expires_at:new Date(mode==='expired'?0:Date.now()+60000).toISOString(),completed_at:null});}
   if(url.includes('/rest/v1/veltra_ai_task_access')){assert.ok(url.includes('app=eq.mail'));assert.ok(url.includes('user_id=eq.'+USER));return Response.json({allowed:mode==='allow'});}
   assert.equal(url,'https://mail.example.test/chat/mail-mcp');providers++;return Response.json({result:{content:[{type:'text',text:JSON.stringify({items:[],scope:'Verified Mail receipt'})}]}});
  });
  const tool=await toolRoute(new Request('https://veltra.example/api/agent/tools',{method:'POST',headers:{Authorization:'Bearer fixture-access','Content-Type':'application/json'},body:JSON.stringify({task_id:TASK,name:'mail_search',args:{query:'quote'}})}));
  assert.equal(tool.status,mode==='missing'?428:(mode==='allow'||mode==='disabled')?200:403);
  const direct=await chatRoute(new NextRequest('https://veltra.example/api/chat',{method:'POST',headers:{Authorization:'Bearer fixture-access','Content-Type':'application/json'},body:JSON.stringify({task_id:TASK,messages:[{role:'user',content:'Search my mail for quote'}]})}));
  assert.equal(direct.status,mode==='missing'?428:(mode==='allow'||mode==='disabled')?200:403);assert.equal(providers,(mode==='allow'||mode==='disabled')?2:0);mock.mock.restore();
 }}finally{if(oldFlag===undefined)delete process.env.VELTRA_TASK_ACCESS_ENABLED;else process.env.VELTRA_TASK_ACCESS_ENABLED=oldFlag;for(const [key,value] of Object.entries({NEXT_PUBLIC_SUPABASE_URL:before.url,NEXT_PUBLIC_SUPABASE_ANON_KEY:before.key,VELTRA_MAIL_URL:before.mail})){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

test('disabled rollout does not authenticate, create a task, or contact an app',async t=>{
 const old=process.env.VELTRA_TASK_ACCESS_ENABLED;delete process.env.VELTRA_TASK_ACCESS_ENABLED;
 const mock=t.mock.method(globalThis,'fetch',async()=>{throw Error('Disabled permissions must not call a service');});
 try{const response=await accessRoute(new Request('https://veltra.example/api/ai-access',{method:'POST',body:'{}'}));assert.equal(response.status,200);assert.deepEqual(await response.json(),{enabled:false});assert.equal(mock.mock.callCount(),0);}
 finally{mock.mock.restore();if(old===undefined)delete process.env.VELTRA_TASK_ACCESS_ENABLED;else process.env.VELTRA_TASK_ACCESS_ENABLED=old;}
});

test('task-marked developer and commerce proxy reads require their named app while manual navigation stays independent',async t=>{
 const keys=['VELTRA_TASK_ACCESS_ENABLED','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','VELTRA_MAIL_URL'] as const;
 const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));Object.assign(process.env,{VELTRA_TASK_ACCESS_ENABLED:'true',NEXT_PUBLIC_SUPABASE_URL:'https://permission-fixture.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture-public',VELTRA_MAIL_URL:'https://mail.example.test'});
 try{for(const [app,path,kind] of [['github','github/tree','developer'],['vercel','vercel/deployments','developer'],['supabase','supabase/project','developer'],['railway','railway/project','developer'],['n8n','n8n/project','developer'],['connections','status','developer'],['shopify','shopify/catalog','mail'],['tms','tms','mail'],['mail','inbox','mail']] as const){
  for(const mode of ['missing','denied','allow','manual']){
   let providers=0,permissionReads=0;const mock=t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL)=>{const url=new URL(String(input));
    if(url.pathname==='/auth/v1/user')return Response.json({id:USER,aud:'authenticated',role:'authenticated',is_anonymous:false,app_metadata:{},user_metadata:{}});
    if(url.pathname==='/rest/v1/veltra_ai_tasks'){permissionReads++;assert.equal(url.searchParams.get('user_id'),'eq.'+USER);return Response.json(mode==='missing'?null:{id:TASK,expires_at:new Date(Date.now()+60000).toISOString(),completed_at:null});}
    if(url.pathname==='/rest/v1/veltra_ai_task_access'){assert.equal(url.searchParams.get('app'),'eq.'+app);return Response.json({allowed:mode==='allow'});}
    assert.equal(url.origin,'https://mail.example.test');providers++;return Response.json({receipt:'Verified scoped provider result'});
   });
   const request=new NextRequest('https://workspace.test/api/'+path,{headers:{Authorization:'Bearer fixture-owner',...(mode==='manual'?{}:{'x-veltra-task':TASK})}});
   const response=kind==='developer'?await connectionProxy(request,{params:Promise.resolve({path:path.split('/')})}):await mailProxy(request,path as 'inbox'|'tms'|'shopify/catalog');
   assert.equal(response.status,mode==='missing'?428:mode==='denied'?403:200,app+':'+mode);assert.equal(providers,['allow','manual'].includes(mode)?1:0);if(mode==='manual')assert.equal(permissionReads,0);mock.mock.restore();
  }
 }}finally{for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}}
});
test('capabilities do not probe connected apps, and Bee or browser requests stop on Deny',async t=>{
 const keys=['VELTRA_TASK_ACCESS_ENABLED','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','VELTRA_MAIL_URL'] as const;
 const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));Object.assign(process.env,{VELTRA_TASK_ACCESS_ENABLED:'true',NEXT_PUBLIC_SUPABASE_URL:'https://permission-fixture.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture-public',VELTRA_MAIL_URL:'https://mail.example.test'});
 let providerCalls=0;const mock=t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL)=>{const url=new URL(String(input));
  if(url.pathname==='/auth/v1/user')return Response.json({id:USER,aud:'authenticated',role:'authenticated',is_anonymous:false,app_metadata:{},user_metadata:{}});
  if(url.pathname==='/rest/v1/veltra_ai_tasks')return Response.json({id:TASK,expires_at:new Date(Date.now()+60000).toISOString(),completed_at:null});
  if(url.pathname==='/rest/v1/veltra_ai_task_access')return Response.json({allowed:false});
  providerCalls++;throw Error('No connected service may be probed here');
 });
 try{
  const capabilities=await toolRoute(new Request('https://workspace.test/api/agent/tools',{method:'POST',headers:{Authorization:'Bearer fixture-owner','Content-Type':'application/json'},body:JSON.stringify({name:'veltra_capabilities',args:{}})}));assert.equal(capabilities.status,200);assert.equal(providerCalls,0);
  const browser=await toolRoute(new Request('https://workspace.test/api/agent/tools',{method:'POST',headers:{Authorization:'Bearer fixture-owner','Content-Type':'application/json'},body:JSON.stringify({task_id:TASK,name:'browser_inspect',args:{url:'https://example.test'}})}));assert.equal(browser.status,403);assert.equal(providerCalls,0);
  const bee=await chatRoute(new NextRequest('https://workspace.test/api/chat',{method:'POST',headers:{Authorization:'Bearer fixture-owner','Content-Type':'application/json'},body:JSON.stringify({task_id:TASK,messages:[{role:'user',content:'Is Bee connected?'}]})}));assert.equal(bee.status,403);assert.equal(providerCalls,0);
 }finally{mock.mock.restore();for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}}
});
