-- ISOLATED TEST DATABASE ONLY. Minimal existing CRM/auth contract for migration tests.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth,public to authenticated,anon;
create table auth.users(id uuid primary key);
create table public.crm_workspaces(id uuid primary key);
create table public.crm_memberships(workspace_id uuid,user_id uuid,role text,primary key(workspace_id,user_id));
alter table public.crm_memberships enable row level security;
grant select on public.crm_memberships to authenticated;
create policy memberships_read on public.crm_memberships for select to authenticated using(user_id=(select auth.uid()));
create table public.crm_customers(id uuid,workspace_id uuid,created_at timestamptz default now(),primary key(workspace_id,id));
create table public.crm_deals(id uuid,workspace_id uuid,created_at timestamptz);
create table public.crm_tasks(id uuid,workspace_id uuid,created_at timestamptz);
create table public.crm_memories(id uuid,workspace_id uuid,created_at timestamptz);
create table public.crm_activity(id uuid,workspace_id uuid,created_at timestamptz);
insert into auth.users values
 ('00000000-0000-4000-8000-000000000001'),
 ('00000000-0000-4000-8000-000000000002'),
 ('00000000-0000-4000-8000-000000000003'),
 ('00000000-0000-4000-8000-000000000004');
insert into public.crm_workspaces values ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
insert into public.crm_memberships values
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','owner'),
 ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','owner'),
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','member'),
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','viewer');
insert into public.crm_customers(id,workspace_id) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002');
