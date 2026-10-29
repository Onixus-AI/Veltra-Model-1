begin;
create schema if not exists workspace_private;
revoke all on schema workspace_private from public,anon,authenticated;
create table if not exists workspace_private.search_limits(user_id uuid not null,day date not null,calls integer not null default 0,primary key(user_id,day));
alter table workspace_private.search_limits enable row level security;
create or replace function public.workspace_claim_web_search() returns boolean language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); result integer;
begin
 if uid is null then raise exception 'Sign in'; end if;
 insert into workspace_private.search_limits(user_id,day,calls) values(uid,(now() at time zone 'UTC')::date,1)
 on conflict(user_id,day) do update set calls=workspace_private.search_limits.calls+1 where workspace_private.search_limits.calls<20 returning calls into result;
 return result is not null;
end $$;
revoke all on function public.workspace_claim_web_search() from public,anon;
grant execute on function public.workspace_claim_web_search() to authenticated;
create or replace function public.crm_confirm_bulk_import(p_review uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare review public.crm_conversations%rowtype; payload jsonb; row jsonb; added integer:=0; skipped integer:=0; receipt jsonb;
begin
 select * into review from public.crm_conversations where id=p_review and user_id=auth.uid() for update;
 if not found then raise exception 'Import review not found';end if;
 if not exists(select 1 from public.crm_memberships where workspace_id=review.workspace_id and user_id=auth.uid() and role in ('owner','member')) then raise exception 'Business editor required';end if;
 payload:=(review.messages->0->>'content')::jsonb;
 if payload->>'type'<>'crm_bulk_import_review' or review.customer_id is not null then raise exception 'Invalid import review';end if;
 if review.revision=1 then return (review.messages->1->>'content')::jsonb;end if;
 if review.revision<>0 or (payload->>'expires_at')::numeric<extract(epoch from now())*1000 then raise exception 'Review expired';end if;
 if jsonb_typeof(payload->'rows')<>'array' or jsonb_array_length(payload->'rows') not between 1 and 500 then raise exception 'Import needs 1-500 records';end if;
 -- Serializes concurrent imports for this business; replay returns the stored receipt.
 perform pg_advisory_xact_lock(hashtextextended(review.workspace_id::text,0));
 for row in select value from jsonb_array_elements(payload->'rows') loop
  if coalesce(length(trim(row->>'company')),0) not between 1 and 250 or coalesce(length(row->>'source'),0) not between 1 and 1000 or coalesce(length(row->>'email'),0)>254 then raise exception 'Invalid business contact';end if;
  if exists(select 1 from public.crm_customers where workspace_id=review.workspace_id and lower(company)=lower(trim(row->>'company')) and lower(coalesce(email,''))=lower(coalesce(row->>'email',''))) then skipped:=skipped+1;
  else
   insert into public.crm_customers(workspace_id,company,name,email,phone,website,industry,location,source) values(review.workspace_id,trim(row->>'company'),coalesce(row->>'name',''),nullif(row->>'email',''),coalesce(row->>'phone',''),coalesce(row->>'website',''),coalesce(row->>'industry',''),coalesce(row->>'location',''),row->>'source');added:=added+1;
  end if;
 end loop;
 receipt:=jsonb_build_object('status','completed','review_id',review.id,'workspace_id',review.workspace_id,'imported',added,'skipped',skipped,'messages_sent',0);
 update public.crm_conversations set revision=1,messages=messages||jsonb_build_array(jsonb_build_object('role','assistant','content',receipt::text)),updated_at=now() where id=review.id;
 return receipt;
end $$;
revoke all on function public.crm_confirm_bulk_import(uuid) from public,anon;
grant execute on function public.crm_confirm_bulk_import(uuid) to authenticated;
-- Operational metadata only. Tool payloads, customer messages and private files are never copied here.
create table if not exists public.workspace_business_events(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.crm_workspaces(id) on delete cascade,
 actor_id uuid not null,tool text not null check(length(tool)<=100),status text not null check(status in ('observed','review','completed','failed')),created_at timestamptz not null default now());
alter table public.workspace_business_events enable row level security;
revoke all on public.workspace_business_events from public,anon,authenticated;
grant select on public.workspace_business_events to authenticated;
grant select,insert on public.workspace_business_events to service_role;
drop policy if exists workspace_business_events_members on public.workspace_business_events;
create policy workspace_business_events_members on public.workspace_business_events for select to authenticated using(exists(select 1 from public.crm_memberships m where m.workspace_id=workspace_business_events.workspace_id and m.user_id=(select auth.uid())));
create index if not exists workspace_business_events_recent on public.workspace_business_events(workspace_id,created_at desc);
-- Realtime carries only existing RLS-authorized CRM event records, to existing members.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  if not (select relrowsecurity from pg_class where oid='public.crm_activity'::regclass) then raise exception 'CRM activity RLS must be enabled';end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='crm_activity') then
   alter publication supabase_realtime add table public.crm_activity;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='workspace_business_events') then
   alter publication supabase_realtime add table public.workspace_business_events;
  end if;
 end if;
end $$;
commit;
