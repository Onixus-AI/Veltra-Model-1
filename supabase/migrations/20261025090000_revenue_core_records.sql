-- Onixus revenue system, Phase 1, part 1: shared customer records, identity resolution,
-- reversible merges, configurable pipeline, ownership, consent, memory provenance and the
-- typed customer timeline.
--
-- Additive only. Populated tables (crm_customers ~63k, crm_activity ~64k) receive nullable
-- columns without defaults (metadata-only) and expression indexes; no row is rewritten.
-- crm_workspaces.environment uses a constant default (metadata-only since Postgres 11).
-- New tables are read-only to `authenticated` through RLS; all writes go through
-- SECURITY DEFINER functions that re-check the caller's workspace role.
begin;

create schema if not exists revenue_private;
revoke all on schema revenue_private from public;
grant usage on schema revenue_private to authenticated, anon;

-- Errors use "<http status>:<message>" so the web layer can map them without leaking internals.
create or replace function revenue_private.require_role(p_workspace uuid, p_min text)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare r text; u uuid := auth.uid();
begin
 if u is null then raise exception '401:Sign in to Onixus Workspace.' using errcode='42501'; end if;
 select role into r from public.crm_memberships where workspace_id=p_workspace and user_id=u;
 if r is null then raise exception '404:Workspace not found.' using errcode='42501'; end if;
 if (case r when 'owner' then 3 when 'member' then 2 else 1 end) < (case p_min when 'owner' then 3 when 'member' then 2 else 1 end) then
  raise exception '403:Your workspace role does not allow this action.' using errcode='42501';
 end if;
 return u;
end $$;
revoke all on function revenue_private.require_role(uuid,text) from public;
grant execute on function revenue_private.require_role(uuid,text) to authenticated;

create or replace function revenue_private.is_member(p_workspace uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.crm_memberships where workspace_id=p_workspace and user_id=auth.uid())
$$;
create or replace function revenue_private.is_owner(p_workspace uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.crm_memberships where workspace_id=p_workspace and user_id=auth.uid() and role='owner')
$$;
revoke all on function revenue_private.is_member(uuid), revenue_private.is_owner(uuid) from public;
grant execute on function revenue_private.is_member(uuid), revenue_private.is_owner(uuid) to authenticated;

-- Identity normalization. Gmail ignores dots and +tags, so those collapse; other domains keep
-- the local part exactly (only case and whitespace are normalized).
create or replace function public.revenue_normalize_email(p text)
returns text language sql immutable parallel safe set search_path='' as $$
 select case
  when p is null or position('@' in p)=0 then null
  else (
   with e as (select lower(trim(regexp_replace(p,'^mailto:','','i'))) v),
   parts as (select split_part(v,'@',1) l, split_part(v,'@',2) d from e)
   select case when d in ('gmail.com','googlemail.com')
    then replace(split_part(l,'+',1),'.','')||'@gmail.com'
    else l||'@'||d end
   from parts where l<>'' and d ~ '^[^[:space:]@]+\.[^[:space:]@]+$'
  ) end
$$;
create or replace function public.revenue_normalize_phone(p text)
returns text language sql immutable parallel safe set search_path='' as $$
 select case
  when d is null then null
  when length(d)=10 and left(coalesce(p,''),1)<>'+' then '+1'||d
  when length(d) between 8 and 15 then '+'||d
  else null end
 from (select nullif(regexp_replace(coalesce(p,''),'[^0-9]','','g'),'') d) x
$$;
create or replace function public.revenue_email_domain(p text)
returns text language sql immutable parallel safe set search_path='' as $$
 select nullif(split_part(public.revenue_normalize_email(p),'@',2),'')
$$;
grant execute on function public.revenue_normalize_email(text), public.revenue_normalize_phone(text), public.revenue_email_domain(text) to authenticated, anon;

-- Workspace environment keeps demo/test data out of production metrics.
alter table public.crm_workspaces add column if not exists environment text not null default 'production';
do $$ begin
 if not exists(select 1 from pg_constraint where conname='crm_workspaces_environment_check') then
  alter table public.crm_workspaces add constraint crm_workspaces_environment_check check(environment in ('production','demo','test'));
 end if;
end $$;

-- Customer ownership, company links and merge pointers (nullable, no defaults).
alter table public.crm_customers
 add column if not exists owner_id uuid references auth.users(id),
 add column if not exists company_customer_id uuid,
 add column if not exists merged_into_id uuid,
 add column if not exists merged_at timestamptz,
 add column if not exists source_detail jsonb;
create index if not exists crm_customers_email_canonical on public.crm_customers(workspace_id, public.revenue_normalize_email(email)) where email is not null;
create index if not exists crm_customers_phone_e164 on public.crm_customers(workspace_id, public.revenue_normalize_phone(phone)) where phone<>'';
create index if not exists crm_customers_name_company on public.crm_customers(workspace_id, lower(trim(name)), lower(trim(company)));

-- Opportunities: ownership, close date, configurable stages.
alter table public.crm_deals
 add column if not exists owner_id uuid references auth.users(id),
 add column if not exists expected_close_at timestamptz,
 add column if not exists stage_changed_at timestamptz,
 add column if not exists lost_reason text,
 add column if not exists source text,
 add column if not exists updated_at timestamptz;
alter table public.crm_tasks
 add column if not exists owner_id uuid references auth.users(id),
 add column if not exists kind text,
 add column if not exists deal_id uuid,
 add column if not exists source_event_id uuid,
 add column if not exists completed_at timestamptz;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='crm_tasks_kind_check') then
  alter table public.crm_tasks add constraint crm_tasks_kind_check check(kind is null or kind in ('task','commitment','follow_up','onboarding','review'));
 end if;
end $$;

create table if not exists public.revenue_pipeline_stages(
 workspace_id uuid not null references public.crm_workspaces(id),
 key text not null check(key ~ '^[a-z][a-z0-9_]{1,39}$'),
 label text not null check(length(trim(label)) between 1 and 60),
 position integer not null check(position between 0 and 100),
 outcome text not null default 'open' check(outcome in ('open','won','lost')),
 probability integer check(probability between 0 and 100),
 archived boolean not null default false,
 primary key(workspace_id,key)
);

-- Built-in stages apply until a workspace configures its own.
create or replace function revenue_private.default_stages()
returns table(key text,label text,"position" integer,outcome text,probability integer) language sql immutable set search_path='' as $$
 values ('new','New',0,'open',10),('qualified','Qualified',1,'open',25),('meeting','Meeting',2,'open',40),
        ('proposal','Proposal',3,'open',60),('won','Won',4,'won',100),('lost','Lost',5,'lost',0)
$$;
create or replace function revenue_private.stage_outcome(p_workspace uuid, p_stage text)
returns text language sql stable security definer set search_path='' as $$
 select coalesce(
  (select outcome from public.revenue_pipeline_stages where workspace_id=p_workspace and key=p_stage and not archived),
  case when exists(select 1 from public.revenue_pipeline_stages where workspace_id=p_workspace and not archived) then null
       else (select d.outcome from revenue_private.default_stages() d where d.key=p_stage) end)
$$;
-- The fixed CHECK becomes a workspace-aware trigger (crm_deals has 0 rows in production).
alter table public.crm_deals drop constraint if exists crm_deals_stage_check;
create or replace function revenue_private.check_deal_stage() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if revenue_private.stage_outcome(new.workspace_id,new.stage) is null then
  raise exception '400:Choose a stage configured for this workspace.' using errcode='23514';
 end if;
 if tg_op='INSERT' or new.stage is distinct from old.stage then new.stage_changed_at:=now(); end if;
 new.updated_at:=now();
 return new;
end $$;
drop trigger if exists revenue_deal_stage on public.crm_deals;
create trigger revenue_deal_stage before insert or update on public.crm_deals for each row execute function revenue_private.check_deal_stage();

-- Memory provenance. Facts are human-confirmed; inferences come from AI and need review.
alter table public.crm_memories
 add column if not exists kind text,
 add column if not exists confidence numeric(4,3),
 add column if not exists visibility text,
 add column if not exists source_ref text,
 add column if not exists source_event_id uuid,
 add column if not exists created_by uuid references auth.users(id),
 add column if not exists decided_by uuid references auth.users(id),
 add column if not exists decided_at timestamptz,
 add column if not exists corrected_from uuid,
 add column if not exists decision_reason text;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='crm_memories_kind_check') then
  alter table public.crm_memories add constraint crm_memories_kind_check check(kind is null or kind in ('fact','inference'));
  alter table public.crm_memories add constraint crm_memories_visibility_check check(visibility is null or visibility in ('workspace','owners'));
  alter table public.crm_memories add constraint crm_memories_confidence_check check(confidence is null or confidence between 0 and 1);
 end if;
end $$;

create table if not exists public.revenue_identity_reviews(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.crm_workspaces(id),
 customer_id uuid not null,
 candidate_ids uuid[] not null,
 reason text not null,
 evidence jsonb not null default '{}',
 status text not null default 'open' check(status in ('open','merged','distinct')),
 resolved_by uuid references auth.users(id),
 resolved_at timestamptz,
 created_at timestamptz not null default now(),
 foreign key(workspace_id,customer_id) references public.crm_customers(workspace_id,id)
);
create index if not exists revenue_identity_reviews_open on public.revenue_identity_reviews(workspace_id,status,created_at desc);

create table if not exists public.revenue_merges(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.crm_workspaces(id),
 survivor_id uuid not null,
 merged_id uuid not null,
 moved jsonb not null,
 survivor_before jsonb not null,
 merged_by uuid not null references auth.users(id),
 merged_at timestamptz not null default now(),
 reverted_by uuid references auth.users(id),
 reverted_at timestamptz
);
create index if not exists revenue_merges_ws on public.revenue_merges(workspace_id,merged_at desc);

create table if not exists public.revenue_consents(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.crm_workspaces(id),
 customer_id uuid not null,
 channel text not null check(channel in ('email','sms','phone','whatsapp')),
 purpose text not null check(purpose in ('marketing','transactional')),
 status text not null check(status in ('granted','revoked')),
 source text not null check(length(source) between 1 and 200),
 evidence text check(length(evidence)<=2000),
 recorded_by uuid references auth.users(id),
 recorded_at timestamptz not null default clock_timestamp(),
 foreign key(workspace_id,customer_id) references public.crm_customers(workspace_id,id)
);
create index if not exists revenue_consents_customer on public.revenue_consents(workspace_id,customer_id,channel,purpose,recorded_at desc);

create table if not exists public.revenue_suppressions(
 workspace_id uuid not null references public.crm_workspaces(id),
 email_canonical text not null,
 reason text not null check(reason in ('unsubscribe','bounce','complaint','manual','do_not_contact')),
 source text not null,
 detail text,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 primary key(workspace_id,email_canonical)
);

-- Typed timeline. One row per real-world occurrence; dedupe_key makes ingestion idempotent.
create table if not exists public.revenue_events(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.crm_workspaces(id),
 customer_id uuid,
 deal_id uuid,
 kind text not null check(kind ~ '^[a-z_]+\.[a-z_]+$'),
 source text not null check(source in ('gmail','mail','calendar','form','crm','chat','stripe','onboarding','automation','system')),
 actor_type text not null check(actor_type in ('user','customer','provider','automation','system')),
 actor_id uuid,
 actor_label text,
 occurred_at timestamptz not null,
 recorded_at timestamptz not null default clock_timestamp(),
 status text not null default 'recorded',
 subject_type text,
 subject_id uuid,
 summary text not null check(length(summary) between 1 and 500),
 detail jsonb not null default '{}',
 related jsonb not null default '{}',
 error jsonb,
 recovery text,
 dedupe_key text not null check(length(dedupe_key) between 1 and 300),
 unique(workspace_id,dedupe_key),
 foreign key(workspace_id,customer_id) references public.crm_customers(workspace_id,id)
);
create index if not exists revenue_events_customer on public.revenue_events(workspace_id,customer_id,occurred_at desc);
create index if not exists revenue_events_ws on public.revenue_events(workspace_id,occurred_at desc);
create index if not exists revenue_events_subject on public.revenue_events(workspace_id,subject_type,subject_id);

create table if not exists public.revenue_audit_log(
 id bigint generated always as identity primary key,
 workspace_id uuid not null,
 actor_type text not null,
 actor_id uuid,
 action text not null,
 target_type text not null,
 target_id text,
 detail jsonb not null default '{}',
 at timestamptz not null default now()
);
create index if not exists revenue_audit_ws on public.revenue_audit_log(workspace_id,at desc);

create or replace function revenue_private.audit(p_workspace uuid,p_actor_type text,p_action text,p_target_type text,p_target_id text,p_detail jsonb default '{}')
returns void language sql security definer set search_path='' as $$
 insert into public.revenue_audit_log(workspace_id,actor_type,actor_id,action,target_type,target_id,detail)
 values(p_workspace,p_actor_type,auth.uid(),p_action,p_target_type,p_target_id,coalesce(p_detail,'{}'))
$$;

create or replace function revenue_private.record_event(
 p_workspace uuid, p_customer uuid, p_deal uuid, p_kind text, p_source text, p_actor_type text, p_actor_label text,
 p_occurred timestamptz, p_status text, p_subject_type text, p_subject_id uuid, p_summary text, p_detail jsonb,
 p_related jsonb, p_dedupe text, p_error jsonb default null, p_recovery text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e uuid;
begin
 insert into public.revenue_events(workspace_id,customer_id,deal_id,kind,source,actor_type,actor_id,actor_label,occurred_at,status,subject_type,subject_id,summary,detail,related,error,recovery,dedupe_key)
 values(p_workspace,p_customer,p_deal,p_kind,p_source,p_actor_type,case when p_actor_type='user' then auth.uid() end,left(p_actor_label,200),
        coalesce(p_occurred,now()),coalesce(p_status,'recorded'),p_subject_type,p_subject_id,left(coalesce(nullif(trim(p_summary),''),p_kind),500),
        coalesce(p_detail,'{}'),coalesce(p_related,'{}'),p_error,p_recovery,p_dedupe)
 on conflict(workspace_id,dedupe_key) do nothing returning id into e;
 if e is null then
  select id into e from public.revenue_events where workspace_id=p_workspace and dedupe_key=p_dedupe;
  return jsonb_build_object('event_id',e,'duplicate',true);
 end if;
 return jsonb_build_object('event_id',e,'duplicate',false);
end $$;

-- Identity resolution. High confidence (one exact canonical email) links automatically;
-- anything uncertain creates a provisional record flagged for review, never a silent duplicate.
create or replace function revenue_private.resolve_identity(
 p_workspace uuid, p_email text, p_phone text, p_name text, p_company text, p_source text, p_source_detail jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare em text := public.revenue_normalize_email(p_email);
 ph text := public.revenue_normalize_phone(p_phone);
 nm text := left(trim(coalesce(p_name,'')),160);
 co text := left(trim(coalesce(p_company,'')),200);
 ids uuid[]; c uuid; review uuid; reason text;
begin
 if em is null and ph is null then raise exception '400:An email address or phone number is required to identify the customer.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('revenue-identity:'||p_workspace::text||':'||coalesce(em,ph),0));
 if em is not null then
  select array_agg(id order by created_at,id) into ids from public.crm_customers
   where workspace_id=p_workspace and merged_into_id is null and email is not null and public.revenue_normalize_email(email)=em;
  if coalesce(array_length(ids,1),0)=1 then
   return jsonb_build_object('customer_id',ids[1],'outcome','matched','confidence','high','reason','exact_email');
  elsif coalesce(array_length(ids,1),0)>1 then
   select r.id into review from public.revenue_identity_reviews r where r.workspace_id=p_workspace and r.status='open' and r.customer_id=ids[1] and r.reason='multiple_email_matches';
   if review is null then
    insert into public.revenue_identity_reviews(workspace_id,customer_id,candidate_ids,reason,evidence)
    values(p_workspace,ids[1],ids[2:],'multiple_email_matches',jsonb_build_object('email',em,'source',p_source)) returning id into review;
   end if;
   return jsonb_build_object('customer_id',ids[1],'outcome','review','confidence','medium','reason','multiple_email_matches','review_id',review);
  end if;
 end if;
 select array_agg(id order by created_at,id) into ids from public.crm_customers
  where workspace_id=p_workspace and merged_into_id is null and (
   (ph is not null and phone<>'' and public.revenue_normalize_phone(phone)=ph)
   or (nm<>'' and co<>'' and lower(trim(name))=lower(nm) and lower(trim(company))=lower(co)));
 reason := case when ids is null then null when ph is not null and exists(select 1 from public.crm_customers where id=any(ids) and public.revenue_normalize_phone(phone)=ph) then 'phone_match' else 'name_company_match' end;
 insert into public.crm_customers(workspace_id,company,name,email,phone,source,record_type,identity_review_required,source_detail)
 values(p_workspace,coalesce(nullif(co,''),nullif(nm,''),em,ph),nm,case when em is null then null else lower(trim(regexp_replace(p_email,'^mailto:','','i'))) end,coalesce(p_phone,''),left(coalesce(p_source,'manual'),60),
        case when nm<>'' then 'person' else 'company' end, ids is not null, p_source_detail)
 returning id into c;
 if ids is not null then
  insert into public.revenue_identity_reviews(workspace_id,customer_id,candidate_ids,reason,evidence)
  values(p_workspace,c,ids,reason,jsonb_build_object('email',em,'phone',ph,'name',nm,'company',co,'source',p_source)) returning id into review;
  return jsonb_build_object('customer_id',c,'outcome','review','confidence','low','reason',reason,'review_id',review);
 end if;
 return jsonb_build_object('customer_id',c,'outcome','created','confidence','high','reason','no_match');
end $$;

create or replace function public.revenue_upsert_customer(p_workspace uuid, p_customer jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'member'); r jsonb;
begin
 r := revenue_private.resolve_identity(p_workspace,p_customer->>'email',p_customer->>'phone',p_customer->>'name',p_customer->>'company',coalesce(p_customer->>'source','manual'),jsonb_build_object('entered_by',u));
 if r->>'outcome'='created' or (r->>'outcome'='review' and r->>'reason'<>'multiple_email_matches') then
  update public.crm_customers set owner_id=coalesce(owner_id,u) where id=(r->>'customer_id')::uuid;
  perform revenue_private.record_event(p_workspace,(r->>'customer_id')::uuid,null,'customer.created','crm','user',null,now(),'recorded','customer',(r->>'customer_id')::uuid,
   'Customer record created',jsonb_build_object('identity',r),'{}','customer.created:'||(r->>'customer_id'));
 end if;
 perform revenue_private.audit(p_workspace,'user','customer.upsert','customer',r->>'customer_id',r);
 return r;
end $$;

-- Reversible merge: every moved reference is recorded so revenue_unmerge_customers can restore it.
create or replace function public.revenue_merge_customers(p_workspace uuid, p_survivor uuid, p_merged uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'member'); moved jsonb := '{}'; ids jsonb; m uuid; s public.crm_customers; d public.crm_customers; t text;
begin
 if p_survivor=p_merged then raise exception '400:Choose two different customers.'; end if;
 select * into s from public.crm_customers where workspace_id=p_workspace and id=p_survivor and merged_into_id is null for update;
 select * into d from public.crm_customers where workspace_id=p_workspace and id=p_merged and merged_into_id is null for update;
 if s.id is null or d.id is null then raise exception '404:Customer not found or already merged.'; end if;
 foreach t in array array['crm_deals','crm_tasks','crm_memories','crm_inquiries','crm_activity','revenue_events','revenue_consents','revenue_messages','revenue_meetings','revenue_proposals','revenue_payments','revenue_onboardings','revenue_engagements','revenue_jobs'] loop
  if to_regclass('public.'||t) is not null then
   execute format('with x as (update public.%I set customer_id=$1 where workspace_id=$2 and customer_id=$3 returning id) select coalesce(jsonb_agg(id),''[]'') from x',t) into ids using p_survivor,p_workspace,p_merged;
   if jsonb_array_length(ids)>0 then moved:=moved||jsonb_build_object(t,ids); end if;
  end if;
 end loop;
 with x as (update public.crm_mail_threads set customer_id=p_survivor where workspace_id=p_workspace and customer_id=p_merged returning account_id,thread_id)
 select coalesce(jsonb_agg(jsonb_build_object('account_id',account_id,'thread_id',thread_id)),'[]') into ids from x;
 if jsonb_array_length(ids)>0 then moved:=moved||jsonb_build_object('crm_mail_threads',ids); end if;
 with x as (update public.crm_external_records set customer_id=p_survivor where workspace_id=p_workspace and customer_id=p_merged returning source_system,external_id)
 select coalesce(jsonb_agg(jsonb_build_object('source_system',source_system,'external_id',external_id)),'[]') into ids from x;
 if jsonb_array_length(ids)>0 then moved:=moved||jsonb_build_object('crm_external_records',ids); end if;
 update public.crm_customers set
  email=coalesce(s.email,d.email), phone=case when s.phone='' then d.phone else s.phone end,
  name=case when s.name='' then d.name else s.name end, owner_id=coalesce(s.owner_id,d.owner_id),
  suppressed=s.suppressed or d.suppressed, identity_review_required=false
 where id=p_survivor;
 update public.crm_customers set merged_into_id=p_survivor, merged_at=now(), email=null, identity_review_required=false where id=p_merged;
 insert into public.revenue_merges(workspace_id,survivor_id,merged_id,moved,survivor_before,merged_by)
 values(p_workspace,p_survivor,p_merged,moved,jsonb_build_object('survivor',to_jsonb(s),'merged',to_jsonb(d)),u) returning id into m;
 update public.revenue_identity_reviews set status='merged',resolved_by=u,resolved_at=now()
  where workspace_id=p_workspace and status='open' and (customer_id in (p_survivor,p_merged)) and (p_survivor=any(candidate_ids) or p_merged=any(candidate_ids) or customer_id=p_survivor);
 perform revenue_private.record_event(p_workspace,p_survivor,null,'customer.merged','crm','user',null,now(),'recorded','merge',m,
  'Merged a duplicate customer record into this customer',jsonb_build_object('merged_id',p_merged,'moved',moved),'{}','customer.merged:'||m);
 perform revenue_private.audit(p_workspace,'user','customer.merge','customer',p_survivor::text,jsonb_build_object('merge_id',m,'merged_id',p_merged));
 return jsonb_build_object('merge_id',m,'moved',moved);
end $$;

create or replace function public.revenue_unmerge_customers(p_workspace uuid, p_merge uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'member'); r public.revenue_merges; t text; before jsonb; mb jsonb;
begin
 select * into r from public.revenue_merges where workspace_id=p_workspace and id=p_merge for update;
 if r.id is null then raise exception '404:Merge not found.'; end if;
 if r.reverted_at is not null then raise exception '409:This merge was already reverted.'; end if;
 for t in select jsonb_object_keys(r.moved) loop
  if t='crm_mail_threads' then
   update public.crm_mail_threads x set customer_id=r.merged_id from jsonb_array_elements(r.moved->t) k
    where x.workspace_id=p_workspace and x.account_id=(k->>'account_id')::uuid and x.thread_id=k->>'thread_id';
  elsif t='crm_external_records' then
   update public.crm_external_records x set customer_id=r.merged_id from jsonb_array_elements(r.moved->t) k
    where x.workspace_id=p_workspace and x.source_system=k->>'source_system' and x.external_id=k->>'external_id';
  else
   execute format('update public.%I set customer_id=$1 where workspace_id=$2 and id in (select (jsonb_array_elements_text($3))::uuid)',t) using r.merged_id,p_workspace,r.moved->t;
  end if;
 end loop;
 before := r.survivor_before->'survivor'; mb := r.survivor_before->'merged';
 update public.crm_customers set email=before->>'email', phone=before->>'phone', name=before->>'name',
  owner_id=(before->>'owner_id')::uuid, suppressed=(before->>'suppressed')::boolean where id=r.survivor_id;
 update public.crm_customers set merged_into_id=null, merged_at=null, email=mb->>'email' where id=r.merged_id;
 update public.revenue_merges set reverted_by=u, reverted_at=now() where id=p_merge;
 perform revenue_private.record_event(p_workspace,r.survivor_id,null,'customer.unmerged','crm','user',null,now(),'recorded','merge',p_merge,
  'Reverted a customer merge',jsonb_build_object('restored_id',r.merged_id),'{}','customer.unmerged:'||p_merge);
 perform revenue_private.audit(p_workspace,'user','customer.unmerge','merge',p_merge::text,'{}');
 return jsonb_build_object('restored_customer_id',r.merged_id);
end $$;

create or replace function public.revenue_resolve_review(p_workspace uuid, p_review uuid, p_decision text, p_survivor uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'member'); r public.revenue_identity_reviews; res jsonb;
begin
 select * into r from public.revenue_identity_reviews where workspace_id=p_workspace and id=p_review for update;
 if r.id is null then raise exception '404:Review not found.'; end if;
 if r.status<>'open' then raise exception '409:This review was already resolved.'; end if;
 if p_decision='distinct' then
  update public.revenue_identity_reviews set status='distinct',resolved_by=u,resolved_at=now() where id=p_review;
  update public.crm_customers set identity_review_required=false where workspace_id=p_workspace and id=r.customer_id;
  res := jsonb_build_object('status','distinct');
 elsif p_decision='merge' then
  if p_survivor is null or not (p_survivor=any(r.candidate_ids)) then raise exception '400:Choose one of the candidate customers to keep.'; end if;
  res := public.revenue_merge_customers(p_workspace,p_survivor,r.customer_id);
  update public.revenue_identity_reviews set status='merged',resolved_by=u,resolved_at=now() where id=p_review;
 else raise exception '400:Choose merge or distinct.'; end if;
 perform revenue_private.audit(p_workspace,'user','identity.review','identity_review',p_review::text,jsonb_build_object('decision',p_decision));
 return res;
end $$;

create or replace function public.revenue_assign(p_workspace uuid, p_target text, p_id uuid, p_owner uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'member'); n integer;
begin
 if p_owner is not null and not exists(select 1 from public.crm_memberships where workspace_id=p_workspace and user_id=p_owner and role in ('owner','member')) then
  raise exception '400:Assign work to a workspace owner or member.';
 end if;
 if p_target='customer' then update public.crm_customers set owner_id=p_owner where workspace_id=p_workspace and id=p_id;
 elsif p_target='deal' then update public.crm_deals set owner_id=p_owner where workspace_id=p_workspace and id=p_id;
 elsif p_target='task' then update public.crm_tasks set owner_id=p_owner where workspace_id=p_workspace and id=p_id;
 else raise exception '400:Unsupported assignment.'; end if;
 get diagnostics n=row_count;
 if n=0 then raise exception '404:Record not found.'; end if;
 perform revenue_private.audit(p_workspace,'user','assign',p_target,p_id::text,jsonb_build_object('owner_id',p_owner));
 return jsonb_build_object('assigned',true);
end $$;

create or replace function public.revenue_save_stages(p_workspace uuid, p_stages jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'owner'); s jsonb; n integer := 0;
begin
 if jsonb_typeof(p_stages)<>'array' or jsonb_array_length(p_stages) not between 2 and 20 then raise exception '400:Configure between 2 and 20 stages.'; end if;
 if not exists(select 1 from jsonb_array_elements(p_stages) x where x->>'outcome'='won') or not exists(select 1 from jsonb_array_elements(p_stages) x where x->>'outcome'='lost') then
  raise exception '400:Include at least one won and one lost stage.';
 end if;
 update public.revenue_pipeline_stages set archived=true where workspace_id=p_workspace;
 for s in select * from jsonb_array_elements(p_stages) loop
  insert into public.revenue_pipeline_stages(workspace_id,key,label,position,outcome,probability,archived)
  values(p_workspace,s->>'key',s->>'label',n,coalesce(s->>'outcome','open'),(s->>'probability')::integer,false)
  on conflict(workspace_id,key) do update set label=excluded.label,position=excluded.position,outcome=excluded.outcome,probability=excluded.probability,archived=false;
  n := n+1;
 end loop;
 if exists(select 1 from public.crm_deals d where d.workspace_id=p_workspace and not exists(select 1 from public.revenue_pipeline_stages p where p.workspace_id=p_workspace and p.key=d.stage and not p.archived)) then
  raise exception '409:Move opportunities out of a stage before removing it.';
 end if;
 perform revenue_private.audit(p_workspace,'user','pipeline.stages','workspace',p_workspace::text,jsonb_build_object('stages',p_stages));
 return jsonb_build_object('stages',n);
end $$;

create or replace function public.revenue_pipeline(p_workspace uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform revenue_private.require_role(p_workspace,'viewer');
 return jsonb_build_object(
  'stages', coalesce((select jsonb_agg(jsonb_build_object('key',key,'label',label,'position',position,'outcome',outcome,'probability',probability) order by position) from public.revenue_pipeline_stages where workspace_id=p_workspace and not archived),
                     (select jsonb_agg(jsonb_build_object('key',key,'label',label,'position',"position",'outcome',outcome,'probability',probability) order by "position") from revenue_private.default_stages())),
  'deals', coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'customer_id',d.customer_id,'company',c.company,'title',d.title,'stage',d.stage,'value_cents',d.value_cents,'currency',d.currency,
     'owner_id',d.owner_id,'expected_close_at',d.expected_close_at,'stage_changed_at',d.stage_changed_at,'created_at',d.created_at,
     'next_task',(select jsonb_build_object('id',t.id,'title',t.title,'due_at',t.due_at) from public.crm_tasks t where t.workspace_id=p_workspace and t.customer_id=d.customer_id and t.status='open' order by t.due_at nulls last limit 1),
     'last_customer_reply_at',(select max(occurred_at) from public.revenue_events e where e.workspace_id=p_workspace and e.customer_id=d.customer_id and e.kind='email.received'))
    order by d.created_at desc) from public.crm_deals d join public.crm_customers c on c.workspace_id=d.workspace_id and c.id=d.customer_id where d.workspace_id=p_workspace),'[]'::jsonb));
end $$;

create or replace function public.revenue_create_deal(p_workspace uuid, p_customer uuid, p_title text, p_value_cents bigint, p_currency text, p_stage text default 'new', p_source text default 'crm')
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'member'); d uuid;
begin
 if not exists(select 1 from public.crm_customers where workspace_id=p_workspace and id=p_customer and merged_into_id is null) then raise exception '404:Customer not found.'; end if;
 insert into public.crm_deals(workspace_id,customer_id,title,stage,value_cents,currency,owner_id,source)
 values(p_workspace,p_customer,p_title,coalesce(p_stage,'new'),coalesce(p_value_cents,0),upper(coalesce(p_currency,'USD')),u,p_source) returning id into d;
 perform revenue_private.record_event(p_workspace,p_customer,d,'opportunity.created','crm','user',null,now(),'recorded','deal',d,'Opportunity created: '||p_title,'{}','{}','opportunity.created:'||d);
 perform revenue_private.audit(p_workspace,'user','deal.create','deal',d::text,'{}');
 return jsonb_build_object('deal_id',d);
end $$;

-- Stage moves are human decisions; the reason is recorded on the timeline.
create or replace function public.revenue_move_deal(p_workspace uuid, p_deal uuid, p_stage text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'member'); d public.crm_deals;
begin
 select * into d from public.crm_deals where workspace_id=p_workspace and id=p_deal for update;
 if d.id is null then raise exception '404:Opportunity not found.'; end if;
 if d.stage=p_stage then return jsonb_build_object('stage',p_stage,'changed',false); end if;
 update public.crm_deals set stage=p_stage, lost_reason=case when revenue_private.stage_outcome(p_workspace,p_stage)='lost' then left(p_reason,500) else lost_reason end where id=p_deal;
 perform revenue_private.record_event(p_workspace,d.customer_id,p_deal,'opportunity.stage_changed','crm','user',null,now(),'recorded','deal',p_deal,
  'Stage moved from '||d.stage||' to '||p_stage,jsonb_build_object('from',d.stage,'to',p_stage,'reason',left(p_reason,500)),'{}','opportunity.stage:'||p_deal||':'||extract(epoch from clock_timestamp())::text);
 perform revenue_private.audit(p_workspace,'user','deal.move','deal',p_deal::text,jsonb_build_object('from',d.stage,'to',p_stage));
 return jsonb_build_object('stage',p_stage,'changed',true);
end $$;

create or replace function public.revenue_create_task(p_workspace uuid, p_customer uuid, p_title text, p_due timestamptz, p_kind text default 'task', p_deal uuid default null, p_owner uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'member'); t uuid;
begin
 insert into public.crm_tasks(workspace_id,customer_id,title,due_at,kind,deal_id,owner_id) values(p_workspace,p_customer,p_title,p_due,coalesce(p_kind,'task'),p_deal,coalesce(p_owner,u)) returning id into t;
 perform revenue_private.audit(p_workspace,'user','task.create','task',t::text,'{}');
 return jsonb_build_object('task_id',t);
end $$;
create or replace function public.revenue_complete_task(p_workspace uuid, p_task uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'member'); t public.crm_tasks;
begin
 update public.crm_tasks set status='done',completed_at=now() where workspace_id=p_workspace and id=p_task and status='open' returning * into t;
 if t.id is null then raise exception '404:Open task not found.'; end if;
 perform revenue_private.record_event(p_workspace,t.customer_id,t.deal_id,'task.completed','crm','user',null,now(),'recorded','task',t.id,'Completed: '||t.title,'{}','{}','task.completed:'||t.id);
 return jsonb_build_object('task_id',t.id,'status','done');
end $$;

-- Memory: humans confirm facts; AI inferences stay proposed with confidence until reviewed.
create or replace function public.revenue_record_memory(p_workspace uuid, p_customer uuid, p_content text, p_kind text, p_source text, p_source_ref text,
 p_confidence numeric default null, p_visibility text default 'workspace', p_expires timestamptz default null, p_source_event uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'member'); m uuid; st text;
begin
 if p_kind not in ('fact','inference') then raise exception '400:Memory must be a fact or an inference.'; end if;
 if p_kind='inference' and p_confidence is null then raise exception '400:Inferences need a confidence score.'; end if;
 st := case when p_kind='fact' then 'approved' else 'proposed' end;
 insert into public.crm_memories(workspace_id,customer_id,content,source,status,expires_at,kind,confidence,visibility,source_ref,source_event_id,created_by,decided_by,decided_at)
 values(p_workspace,p_customer,p_content,left(p_source,300),st,p_expires,p_kind,p_confidence,coalesce(p_visibility,'workspace'),left(p_source_ref,500),p_source_event,u,
        case when st='approved' then u end, case when st='approved' then now() end) returning id into m;
 perform revenue_private.audit(p_workspace,'user','memory.record','memory',m::text,jsonb_build_object('kind',p_kind,'status',st));
 return jsonb_build_object('memory_id',m,'status',st);
end $$;
create or replace function public.revenue_decide_memory(p_workspace uuid, p_memory uuid, p_decision text, p_reason text default null, p_corrected text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'member'); m public.crm_memories; nm uuid;
begin
 select * into m from public.crm_memories where workspace_id=p_workspace and id=p_memory for update;
 if m.id is null then raise exception '404:Memory not found.'; end if;
 if m.visibility='owners' and not revenue_private.is_owner(p_workspace) then raise exception '404:Memory not found.'; end if;
 if p_decision='approve' then
  update public.crm_memories set status='approved',kind='fact',decided_by=u,decided_at=now(),decision_reason=p_reason where id=p_memory;
 elsif p_decision='reject' then
  update public.crm_memories set status='rejected',decided_by=u,decided_at=now(),decision_reason=p_reason where id=p_memory;
 elsif p_decision='correct' then
  if p_corrected is null or length(trim(p_corrected))=0 then raise exception '400:Enter the corrected memory.'; end if;
  update public.crm_memories set status='rejected',decided_by=u,decided_at=now(),decision_reason='corrected' where id=p_memory;
  insert into public.crm_memories(workspace_id,customer_id,content,source,status,expires_at,kind,confidence,visibility,source_ref,created_by,decided_by,decided_at,corrected_from)
  values(p_workspace,m.customer_id,p_corrected,'Corrected by a workspace member','approved',m.expires_at,'fact',null,m.visibility,m.source_ref,u,u,now(),m.id) returning id into nm;
 elsif p_decision='expire' then
  update public.crm_memories set expires_at=now(),decided_by=u,decided_at=now(),decision_reason=p_reason where id=p_memory;
 elsif p_decision='delete' then
  delete from public.crm_memories where id=p_memory;
 else raise exception '400:Unsupported memory decision.'; end if;
 perform revenue_private.audit(p_workspace,'user','memory.'||p_decision,'memory',p_memory::text,jsonb_build_object('replacement',nm));
 return jsonb_build_object('memory_id',coalesce(nm,p_memory),'decision',p_decision);
end $$;

create or replace function public.revenue_record_consent(p_workspace uuid, p_customer uuid, p_channel text, p_purpose text, p_status text, p_source text, p_evidence text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'member'); c uuid; em text;
begin
 insert into public.revenue_consents(workspace_id,customer_id,channel,purpose,status,source,evidence,recorded_by) values(p_workspace,p_customer,p_channel,p_purpose,p_status,p_source,p_evidence,u) returning id into c;
 if p_channel='email' and p_status='revoked' then
  select public.revenue_normalize_email(email) into em from public.crm_customers where workspace_id=p_workspace and id=p_customer;
  if em is not null then
   insert into public.revenue_suppressions(workspace_id,email_canonical,reason,source,created_by) values(p_workspace,em,'unsubscribe',p_source,u) on conflict do nothing;
  end if;
 end if;
 perform revenue_private.record_event(p_workspace,p_customer,null,'consent.'||p_status,'crm','user',null,now(),'recorded','consent',c,
  initcap(p_channel)||' '||p_purpose||' consent '||p_status,jsonb_build_object('source',p_source),'{}','consent:'||c);
 return jsonb_build_object('consent_id',c);
end $$;

-- RLS: members read; writes only through the functions above.
do $$ declare t text; begin
 foreach t in array array['revenue_pipeline_stages','revenue_identity_reviews','revenue_merges','revenue_consents','revenue_suppressions','revenue_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('drop policy if exists revenue_member_read on public.%I',t);
  execute format('create policy revenue_member_read on public.%I for select to authenticated using (workspace_id in (select workspace_id from public.crm_memberships where user_id=(select auth.uid())))',t);
 end loop;
end $$;
alter table public.revenue_audit_log enable row level security;
revoke all on public.revenue_audit_log from public,anon,authenticated;
grant select on public.revenue_audit_log to authenticated;
drop policy if exists revenue_owner_read on public.revenue_audit_log;
create policy revenue_owner_read on public.revenue_audit_log for select to authenticated using (workspace_id in (select workspace_id from public.crm_memberships where user_id=(select auth.uid()) and role='owner'));
-- Owner-only memory stays hidden from members and viewers.
drop policy if exists memories_owner_visibility on public.crm_memories;
create policy memories_owner_visibility on public.crm_memories as restrictive for select to authenticated using (visibility is distinct from 'owners' or revenue_private.is_owner(workspace_id));

do $$ declare f text; begin
 foreach f in array array[
  'revenue_upsert_customer(uuid,jsonb)','revenue_merge_customers(uuid,uuid,uuid)','revenue_unmerge_customers(uuid,uuid)','revenue_resolve_review(uuid,uuid,text,uuid)',
  'revenue_assign(uuid,text,uuid,uuid)','revenue_save_stages(uuid,jsonb)','revenue_pipeline(uuid)','revenue_create_deal(uuid,uuid,text,bigint,text,text,text)',
  'revenue_move_deal(uuid,uuid,text,text)','revenue_create_task(uuid,uuid,text,timestamptz,text,uuid,uuid)','revenue_complete_task(uuid,uuid)',
  'revenue_record_memory(uuid,uuid,text,text,text,text,numeric,text,timestamptz,uuid)','revenue_decide_memory(uuid,uuid,text,text,text)',
  'revenue_record_consent(uuid,uuid,text,text,text,text,text)'] loop
  execute 'revoke all on function public.'||f||' from public, anon';
  execute 'grant execute on function public.'||f||' to authenticated';
 end loop;
 foreach f in array array['revenue_private.resolve_identity(uuid,text,text,text,text,text,jsonb)',
  'revenue_private.record_event(uuid,uuid,uuid,text,text,text,text,timestamptz,text,text,uuid,text,jsonb,jsonb,text,jsonb,text)',
  'revenue_private.audit(uuid,text,text,text,text,jsonb)','revenue_private.stage_outcome(uuid,text)','revenue_private.check_deal_stage()'] loop
  execute 'revoke all on function '||f||' from public, anon, authenticated';
 end loop;
end $$;
commit;
