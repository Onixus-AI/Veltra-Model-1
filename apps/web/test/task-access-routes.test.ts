import {test} from 'node:test';
import assert from 'node:assert/strict';
import {POST as accessRoute} from '../app/api/ai-access/route';
import {POST as toolRoute} from '../app/api/agent/tools/route';
import {POST as chatRoute} from '../app/api/chat/route';
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
