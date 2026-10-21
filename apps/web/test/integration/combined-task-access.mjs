/** Real Mail HTTP/session proxy + actual Next CRM/Chat routes; identity/Data API are fixtures.
 * Run from apps/web with VELTRA_MAIL_SOURCE, VELTRA_CRM_SOURCE, VELTRA_ESBUILD set.
 * No live credentials, provider calls, environment-file reads or production changes.
 */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),web=process.cwd();
for(const key of ['VELTRA_MAIL_SOURCE','VELTRA_CRM_SOURCE','VELTRA_ESBUILD'])assert.ok(process.env[key],`Set ${key} for the sibling checkout or esbuild executable.`);
const mailRoot=resolve(process.env.VELTRA_MAIL_SOURCE),crmRoot=resolve(process.env.VELTRA_CRM_SOURCE);
function bundle(root,name,exports){
 const work=join(root,'work','task-access-integration');mkdirSync(work,{recursive:true});
 const entry=join(work,name+'.js'),output=join(work,name+'.cjs');
 writeFileSync(entry,exports.map(([file,names])=>`export {${names}} from ${JSON.stringify(join(root,file))};`).join('\n'));
 const result=spawnSync(process.env.VELTRA_ESBUILD,[entry,'--bundle','--platform=node','--format=cjs','--packages=external',`--alias:@=${root}`,`--outfile=${output}`],{encoding:'utf8',cwd:root});
 assert.equal(result.status,0,result.stderr);return require(output);
}
const mail=bundle(mailRoot,'mail',[['src/web.ts','createWeb'],['src/accounts.ts','memoryAccounts'],['src/approvals.ts','memoryApprovals'],['src/contacts.ts','memoryContacts'],['src/crypto.ts','sign'],['src/business.ts','business']]);
const workspace=bundle(web,'workspace',[['app/api/crm/assistant/route.ts','POST as assistant'],['app/api/ai-access/route.ts','POST as access'],['app/api/chat/route.ts','POST as chat'],['node_modules/next/server.js','NextRequest']]);
const standalone=bundle(crmRoot,'crm',[['app/api/crm/assistant/route.ts','POST as assistant'],['app/api/ai-access/route.ts','POST as access']]);
const U='00000000-0000-4000-8000-000000000001',W='00000000-0000-4000-8000-000000000002',C='00000000-0000-4000-8000-000000000003';
const originalFetch=globalThis.fetch,env={...process.env};
process.env.NEXT_PUBLIC_SUPABASE_URL='https://integration-identity.test';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='fixture-public';delete process.env.VELTRA_MAIL_URL;
try{for(const [name,app] of [['workspace',workspace],['standalone',standalone]]){
 process.env.VELTRA_TASK_ACCESS_ENABLED='true';
 const tables={veltra_ai_tasks:[],veltra_ai_task_access:[],crm_memberships:[{workspace_id:W,user_id:U,role:'owner'}],crm_customers:[{id:C,workspace_id:W,company:'Fixture company'}],crm_conversations:[],veltra_memories:[]};
 let customerReads=0,permissionCalls=0;
 globalThis.fetch=async(input,init)=>{
  const url=new URL(String(input));if(url.hostname==='127.0.0.1')return originalFetch(input,init);
  assert.equal(url.origin,'https://integration-identity.test','Unexpected external call');
  const headers=new Headers(init?.headers);assert.equal(headers.get('authorization'),'Bearer integration-owner');
  if(url.pathname==='/auth/v1/user')return Response.json({id:U,aud:'authenticated',role:'authenticated',is_anonymous:false,email:'owner@test.invalid',app_metadata:{},user_metadata:{}});
  const body=init?.body?JSON.parse(String(init.body)):null;
  if(url.pathname==='/rest/v1/rpc/veltra_task_access'){
   permissionCalls++;const {p_action:action,p_task:id,p_app:app,p_allowed:allowed}=body;let task=tables.veltra_ai_tasks.find(t=>t.id===id);
   if(action==='start'&&!task){task={id,user_id:U,expires_at:new Date(Date.now()+3600000).toISOString(),completed_at:null};tables.veltra_ai_tasks.push(task);}
   if(!task)return Response.json({message:'Task not found'},{status:400});
   if(action==='finish'){task.completed_at=new Date().toISOString();return Response.json({completed:true});}
   if(task.completed_at||Date.parse(task.expires_at)<=Date.now())return Response.json({message:'Task ended'},{status:400});
   if(action==='start')return Response.json({task_id:id,expires_at:task.expires_at});
   assert.equal(action,'decide');let grant=tables.veltra_ai_task_access.find(g=>g.task_id===id&&g.app===app);
   if(!grant){grant={task_id:id,user_id:U,app,allowed};tables.veltra_ai_task_access.push(grant);}return Response.json({allowed:grant.allowed});
  }
  const table=url.pathname.split('/').at(-1);assert.ok(table in tables,`Unexpected table ${table}`);
  if(table.startsWith('veltra_ai_')){permissionCalls++;assert.equal(url.searchParams.get('user_id'),'eq.'+U);}
  if(table==='crm_customers')customerReads++;
  const filters=[...url.searchParams].filter(([k])=>!['select','order','limit','or'].includes(k));
  let rows=tables[table].filter(row=>filters.every(([key,value])=>value.startsWith('eq.')?String(row[key])===value.slice(3):true));
  if(init?.method==='POST'){const record={revision:0,...body};tables[table].push(record);rows=[record];}
  if(init?.method==='PATCH')for(const row of rows)Object.assign(row,body);
  const fields=url.searchParams.get('select');rows=rows.map(row=>fields&&fields!=='*'?Object.fromEntries(fields.split(',').map(k=>[k,row[k]])):structuredClone(row));
  return Response.json(headers.get('accept')?.includes('vnd.pgrst.object')?(rows[0]??null):rows);
 };
 const secret='integration-fixture-session-key-1234567890',accounts=mail.memoryAccounts(secret),owner=await accounts.create('mail@test.invalid',mail.business.parse({name:'Fixture'}));
 const upstream=async(input,init)=>{
  const url=new URL(String(input));
  if(url.pathname==='/auth/v1/token')return Response.json({access_token:'integration-owner',refresh_token:'private-refresh',expires_in:3600});
  assert.equal(url.origin,'https://selected-crm.test');assert.equal(new Headers(init?.headers).get('authorization'),'Bearer integration-owner');
  if(url.pathname==='/api/crm/workspaces')return Response.json({workspaces:[{id:W,name:'Fixture workspace'}]});
  const request=new Request(url,init);
  if(url.pathname==='/api/ai-access')return app.access(request);
  assert.equal(url.pathname,'/api/crm/assistant');return app.assistant(request);
 };
 const server=mail.createWeb({secret,apiKey:'fixture',publicUrl:'http://mail.test',google:{clientId:'fixture',clientSecret:'fixture'},accounts,approvals:mail.memoryApprovals(),contacts:mail.memoryContacts(),platform:{},webDir:'/fixture-no-files',fetch:upstream,chat:{origin:'https://selected-crm.test',supabaseUrl:'https://integration-identity.test',publicKey:'fixture-public',links:{}}}).listen(0);
 await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
 const base=`http://127.0.0.1:${server.address().port}/api/crm-chat`;
 let cookie='veltra_session='+encodeURIComponent(mail.sign(secret,{acct:owner.id,email:owner.login_email,exp:Date.now()+60000}));
 const post=(path,body)=>originalFetch(base+path,{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  const login=await post('/session',{email:'owner@test.invalid',password:'fixture-password'});assert.equal(login.status,200);cookie+='; '+login.headers.get('set-cookie').split(';')[0];
  const start=async()=>{const id=crypto.randomUUID(),r=await post('/task-access',{task_id:id,action:'start',purpose:'Read and propose memory'});assert.equal(r.status,200);return id;};
  const decide=(id,app,allowed)=>post('/task-access',{task_id:id,action:'decide',app,allowed});
  const ask=(id,message)=>post('/assistant',{task_id:id,workspace_id:W,message});
  const denied=await start();let response=await ask(denied,'Show customers');assert.equal(response.status,428);assert.equal((await response.json()).access_required.app,'crm');assert.equal(customerReads,0);
  assert.equal((await decide(denied,'crm',false)).status,200);assert.equal((await ask(denied,'Show customers')).status,403);assert.equal(customerReads,0);
  await decide(denied,'crm',true);assert.equal((await ask(denied,'Show customers')).status,403,'Deny must not be silently changed');
  const active=await start();await decide(active,'crm',true);response=await ask(active,'Show customers');assert.equal(response.status,200);assert.equal((await response.json()).details[0].company,'Fixture company');
  if(name==='workspace'){
   const chat=await app.chat(new app.NextRequest('https://workspace.test/api/chat',{method:'POST',headers:{Authorization:'Bearer integration-owner','Content-Type':'application/json'},body:JSON.stringify({task_id:active,crm_scope:{workspace_id:W},messages:[{role:'user',content:'Show customers'}]})}));assert.equal(chat.status,200);assert.match(await chat.text(),/Fixture company/);
  }
  response=await ask(active,'Remember for business: Support hours are 9–5');assert.equal(response.status,428);assert.equal((await response.json()).access_required.app,'brain');assert.equal(tables.veltra_memories.length,0);
  await decide(active,'brain',true);response=await ask(active,'Remember for business: Support hours are 9–5');assert.equal(response.status,200);const preview=await response.json();assert.equal(preview.kind,'preview');assert.equal(tables.veltra_memories.length,0);
  const confirm=()=>post('/assistant',{task_id:active,workspace_id:W,review_id:preview.review_id});assert.equal((await confirm()).status,200);assert.equal(tables.veltra_memories.length,1);assert.equal(tables.veltra_memories[0].source_app,'mail');assert.equal(tables.veltra_memories[0].status,'proposed');assert.equal((await confirm()).status,409);
  assert.equal((await post('/task-access',{task_id:active,action:'finish'})).status,200);const before=customerReads;assert.equal((await ask(active,'Show customers')).status,403);assert.equal(customerReads,before);
  const expired=await start();await decide(expired,'crm',true);tables.veltra_ai_tasks.find(t=>t.id===expired).expires_at=new Date(0).toISOString();assert.equal((await ask(expired,'Show customers')).status,403);assert.equal(customerReads,before);
  process.env.VELTRA_TASK_ACCESS_ENABLED='false';const calls=permissionCalls;assert.equal((await post('/assistant',{workspace_id:W,message:'Show customers'})).status,200);assert.equal(permissionCalls,calls,'Disabled mode must not consult permissions');
  console.log(`${name}: Mail HTTP/SSO proxy → real task API → real CRM API → SDK fixture passed; denial, separate app grants, preview/confirm, replay, completion, expiry and disabled mode.`);
 }finally{await new Promise(resolve=>server.close(resolve));}
}}
finally{globalThis.fetch=originalFetch;for(const key of ['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','VELTRA_MAIL_URL','VELTRA_TASK_ACCESS_ENABLED']){if(env[key]===undefined)delete process.env[key];else process.env[key]=env[key];}}
