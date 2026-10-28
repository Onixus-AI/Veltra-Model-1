import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GET,POST} from '../app/api/workspace/signal/mail-signature/route';
const workspace='11111111-1111-4111-8111-111111111111',client='22222222-2222-4222-8222-222222222222',user='33333333-3333-4333-8333-333333333333',accountId='44444444-4444-4444-8444-444444444444';
test('Mail signature requires matching tenant, verified owner and current receipt; preserves other business fields',async t=>{
 const keys=['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','VELTRA_MAIL_URL'] as const,old=keys.map(k=>process.env[k]);process.env.NEXT_PUBLIC_SUPABASE_URL='https://workspace.test';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='public-test';process.env.VELTRA_MAIL_URL='https://mail.test';
 let mailboxWorkspace=workspace,owner=true,verified=true,puts=0,matchingReceipt=true,business={name:'Client Business',signature:'Old sign-off',tone:'professional',unchanged:'keep'};
 t.mock.method(globalThis,'fetch',async(input:any,init?:RequestInit)=>{
  const url=new URL(typeof input==='string'?input:input.url),method=init?.method||input.method||'GET';
  if(url.pathname==='/auth/v1/user')return Response.json({id:user,email:'owner@client.test',email_confirmed_at:verified?'2026-01-01':null});
  if(url.pathname==='/rest/v1/crm_workspaces')return Response.json(owner?{id:workspace}:null);
  if(url.pathname==='/rest/v1/crm_signal_connections')return Response.json({workspace_id:workspace,signal_client_id:client});
  if(url.pathname==='/chat/crm')return Response.json({connected:true,workspace_id:mailboxWorkspace});
  if(url.pathname==='/chat/platform/api/me')return Response.json({account:{id:accountId,business,mailbox:{email:'owner@client.test'}}});
  if(url.pathname==='/chat/platform/api/business'&&method==='PUT'){puts++;const saved=JSON.parse(String(init?.body));assert.equal(saved.unchanged,'keep');assert.equal(saved.name,'Client Business');business=saved;return Response.json({account:{id:accountId,business:matchingReceipt?business:{...business,signature:'not-saved'}}});}
  throw Error('Unexpected request '+url);
 });
 const headers={authorization:'Bearer user-token',origin:'https://workspace.app',host:'workspace.app','Content-Type':'application/json'};
 const get=(signalClient=client)=>GET(new Request(`https://workspace.app/api/workspace/signal/mail-signature?workspace=${workspace}&client=${signalClient}`,{headers}));
 const post=(fingerprint:string)=>POST(new Request('https://workspace.app/api/workspace/signal/mail-signature',{method:'POST',headers,body:JSON.stringify({workspace,client,signature:'New sign-off',fingerprint,confirmed:true})}));
 try{
  assert.equal((await get(user)).status,403);assert.equal(puts,0);
  owner=false;assert.equal((await get()).status,403);owner=true;
  verified=false;assert.equal((await get()).status,403);verified=true;
  mailboxWorkspace=user;assert.equal((await get()).status,409);mailboxWorkspace=workspace;
  const review=await (await get()).json();assert.equal(review.signature,'Old sign-off');assert.equal(review.business,undefined);
  assert.equal((await post('stale')).status,409);assert.equal(puts,0);
  const saved=await post(review.fingerprint);assert.equal(saved.status,200);assert.equal((await saved.json()).saved,true);assert.equal(puts,1);
  assert.equal((await post(review.fingerprint)).status,409);assert.equal(puts,1);
  const second=await (await get()).json();matchingReceipt=false;assert.equal((await post(second.fingerprint)).status,503);
 }finally{keys.forEach((k,i)=>old[i]===undefined?delete process.env[k]:process.env[k]=old[i]);}
});
