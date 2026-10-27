import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {verifySignalCode} from '../lib/crm/signal-link';
const db=new PGlite();const agency=randomUUID(),a=randomUUID(),b=randomUUID(),unverified=randomUUID(),root=randomUUID();
async function as<T=any>(user:string|null,sql:string,params:unknown[]=[]){await db.exec('begin');try{await db.exec('set local role '+(user?'authenticated':'anon'));await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user??'']);const result=await db.query<T>(sql,params);await db.exec('commit');return result.rows;}catch(e){await db.exec('rollback');throw e;}}
async function invite(email='a@client.test'){return (await as(agency,"select public.crm_client_invite($1,'Client business','Services') as id",[email]))[0].id as string;}
async function accept(id:string,user=a,workspace:string|null=null){return (await as(user,'select public.crm_client_invitation_accept($1,$2) as id',[id,workspace]))[0].id as string;}
before(async()=>{
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
 create schema auth;grant usage on schema auth,public to anon,authenticated;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create table public.crm_workspaces(id uuid primary key default gen_random_uuid(),name text not null,industry text not null,owner_id uuid not null references auth.users(id),created_at timestamptz default now());
 create table public.crm_memberships(workspace_id uuid references public.crm_workspaces(id),user_id uuid references auth.users(id),role text check(role in('owner','member','viewer')),primary key(workspace_id,user_id));
 alter table public.crm_workspaces enable row level security;alter table public.crm_memberships enable row level security;
 grant select on public.crm_workspaces,public.crm_memberships to authenticated;
 create function public.crm_create_workspace(p_name text,p_industry text) returns uuid language plpgsql security definer set search_path='' as $$ declare w uuid; begin insert into public.crm_workspaces(name,industry,owner_id) values(p_name,p_industry,auth.uid()) returning id into w; return w; end $$;
 create policy membership_self on public.crm_memberships for select to authenticated using(user_id=auth.uid());
 create policy workspace_members on public.crm_workspaces for select to authenticated using(owner_id=auth.uid() or id in(select workspace_id from public.crm_memberships where user_id=auth.uid()));`);
 for(const [id,email,confirmed] of [[agency,'agency@test.test',true],[a,'a@client.test',true],[b,'b@client.test',true],[unverified,'unverified@client.test',false]] as const)await db.query('insert into auth.users values($1,$2,$3,false)',[id,email,confirmed?new Date():null]);
 await db.query("insert into public.crm_workspaces(id,name,industry,owner_id) values($1,'Agency','Services',$2)",[root,agency]);
 await db.exec(readFileSync(new URL('../../../supabase/migrations/20261027161747_client_workspace_onboarding.sql',import.meta.url),'utf8'));
});
after(()=>db.close());
test('invitation is reused and creates no workspace before acceptance',async()=>{const id=await invite();assert.equal(await invite(),id);assert.equal((await db.query('select * from public.crm_workspaces')).rows.length,1);const visible=await as<any>(b,'select public.crm_client_invitations() as rows');assert.deepEqual(visible[0].rows,[]);});
test('only owners can invite; anonymous and unverified users cannot accept or read invites',async()=>{await assert.rejects(invite.call(null,'bad email'));await assert.rejects(as(a,"select public.crm_client_invite('x@test.test','X','Services')"),/owner/);await assert.rejects(as(null,'select public.crm_client_invitations()'));await assert.rejects(as(unverified,'select public.crm_client_invitations()'),/Verify/);});
let wa:string;
test('wrong recipient denied; verified acceptance creates client ownership and agency member, replay is idempotent',async()=>{const id=await invite();await assert.rejects(accept(id,b),/verified email/);wa=await accept(id);assert.equal(await accept(id),wa);const w=(await db.query<any>('select owner_id from public.crm_workspaces where id=$1',[wa])).rows[0];assert.equal(w.owner_id,a);const roles=(await db.query<any>('select user_id,role from public.crm_memberships where workspace_id=$1',[wa])).rows;assert.equal(roles.find(r=>r.user_id===a).role,'owner');assert.equal(roles.find(r=>r.user_id===agency).role,'member');assert.equal((await as(b,'select * from public.crm_workspaces where id=$1',[wa])).length,0);});
test('client can reuse an existing owned workspace; cannot choose someone else’s',async()=>{const id=await invite('b@client.test');await assert.rejects(accept(id,b,wa),/own/);const wb=randomUUID();await db.query("insert into public.crm_workspaces(id,name,industry,owner_id) values($1,'Existing B','Services',$2)",[wb,b]);const n=(await db.query('select * from public.crm_workspaces')).rows.length;assert.equal(await accept(id,b,wb),wb);assert.equal((await db.query('select * from public.crm_workspaces')).rows.length,n);});
test('expired and revoked requests never grant access',async()=>{const id=await invite('unverified@client.test');await db.query("update crm_private.client_invitations set expires_at=now()-interval '1 minute' where id=$1",[id]);await db.query('update auth.users set email_confirmed_at=now() where id=$1',[unverified]);await assert.rejects(accept(id,unverified),/expired/);await as(agency,'select public.crm_client_invitation_revoke($1)',[id]);await assert.rejects(accept(id,unverified),/revoked/);});
test('agency cannot enumerate members or revoke another owner; client can remove agency membership',async()=>{await assert.rejects(as(agency,'select public.crm_client_access($1)',[wa]),/owner/);await assert.rejects(as(a,'select public.crm_client_access($1,$2)',[wa,a]),/non-owner/);await as(a,'select public.crm_client_access($1,$2)',[wa,agency]);assert.equal((await as(agency,'select * from public.crm_workspaces where id=$1',[wa])).length,0);});
test('private invitation rows and privileged Signal receipts cannot be written by authenticated users',async()=>{await assert.rejects(as(a,'select * from crm_private.client_invitations'));await assert.rejects(as(a,"select public.crm_confirm_signal_connection($1,$2,$3,null,'Forged','a@client.test')",[a,wa,randomUUID()]));await assert.rejects(as(a,"insert into public.crm_signal_connections values($1,$2,null,'Forged',$3,now())",[wa,randomUUID(),a]));});
test('Signal proof validates provider, recipient, workspace, shape and failed verification',async()=>{const id=randomUUID();const data={client_id:id,organization_id:null,business_name:'Existing client',email:'a@client.test',workspace_id:wa};const options={url:'https://rjwbfkuzgusaoizcmmgf.supabase.co',key:'public-key',fetcher:async()=>Response.json(data)};
 assert.equal((await verifySignalCode('a'.repeat(64),wa,'a@client.test',options)).client_id,id);
 await assert.rejects(verifySignalCode('a'.repeat(64),wa,'b@client.test',options),/receipt/);
 await assert.rejects(verifySignalCode('a'.repeat(64),randomUUID(),'a@client.test',options),/receipt/);
 await assert.rejects(verifySignalCode('a'.repeat(64),wa,'a@client.test',{...options,url:'https://example.com'}),/configured/);
 await assert.rejects(verifySignalCode('a'.repeat(64),wa,'a@client.test',{...options,fetcher:async()=>new Response('',{status:403})}),/verify/);
});

test('server-only receipt commit rechecks owner and verified identity, and enforces one workspace per Signal client',async()=>{
 const client=randomUUID();
 async function confirm(user:string,workspace:string,email:string){await db.exec('begin;set local role service_role');try{const result=await db.query<any>("select public.crm_confirm_signal_connection($1,$2,$3,null,'Existing client',$4) as r",[user,workspace,client,email]);await db.exec('commit');return result.rows[0].r;}catch(e){await db.exec('rollback');throw e;}}
 await assert.rejects(confirm(agency,wa,'agency@test.test'),/ownership/);
 await assert.rejects(confirm(a,wa,'b@client.test'),/email/);
 assert.equal((await confirm(a,wa,'a@client.test')).signal_client_id,client);
 const wb=(await db.query<any>('select id from public.crm_workspaces where owner_id=$1',[b])).rows[0].id;
 await assert.rejects(confirm(b,wb,'b@client.test'),/unique/);
 assert.equal((await as(b,'select * from public.crm_signal_connections where workspace_id=$1',[wa])).length,0);
});
