-- ISOLATED TEST DATABASE ONLY.
-- Mirrors the production CRM contract that the revenue migration depends on (columns, keys,
-- checks, RLS and the activity trigger as inspected read-only on 2026-10-25). No production data.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key, email text, is_anonymous boolean not null default false);
create function auth.uid() returns uuid language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),(nullif(current_setting('request.jwt.claims',true),'')::jsonb)->>'sub')::uuid
$$;
grant usage on schema auth,public to authenticated,anon,service_role;
grant execute on function auth.uid() to authenticated,anon;
create schema crm_private;
grant usage on schema crm_private to authenticated;

create table public.crm_workspaces(
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 120),
 industry text not null default '' check(length(industry)<=120),
 owner_id uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create table public.crm_memberships(
 workspace_id uuid not null references public.crm_workspaces(id),
 user_id uuid not null references auth.users(id),
 role text not null check(role in ('owner','member','viewer')),
 created_at timestamptz not null default now(),
 primary key(workspace_id,user_id)
);
alter table public.crm_workspaces enable row level security;
alter table public.crm_memberships enable row level security;
grant select,insert on public.crm_workspaces,public.crm_memberships to authenticated;
create policy workspaces_read on public.crm_workspaces for select to authenticated using(owner_id=(select auth.uid()) or id in(select workspace_id from public.crm_memberships where user_id=(select auth.uid())));
create policy memberships_read on public.crm_memberships for select to authenticated using(user_id=(select auth.uid()));
create function crm_private.owns_workspace(p_workspace uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.crm_workspaces w where w.id=p_workspace and w.owner_id=auth.uid())
$$;
grant execute on function crm_private.owns_workspace(uuid) to authenticated;

create table public.crm_customers(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.crm_workspaces(id),
 company text not null check(length(trim(company)) between 1 and 200),
 name text not null default '' check(length(name)<=160),
 email text check(email is null or (email=lower(trim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
 industry text not null default '' check(length(industry)<=120),
 source text not null default 'manual',
 suppressed boolean not null default false,
 created_at timestamptz not null default now(),
 identity_review_required boolean not null default false,
 phone text not null default '' check(length(phone)<=80),
 website text not null default '' check(length(website)<=1000),
 location text not null default '' check(length(location)<=200),
 job_title text not null default '' check(length(job_title)<=160),
 record_type text not null default 'company' check(record_type in ('company','person','influencer')),
 unique(workspace_id,id)
);
create index crm_customer_email on public.crm_customers(workspace_id,lower(email));
create table public.crm_deals(
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, customer_id uuid not null,
 title text not null check(length(trim(title)) between 1 and 300),
 stage text not null default 'new' check(stage in ('new','qualified','meeting','proposal','won','lost')),
 value_cents bigint not null default 0 check(value_cents between 0 and 10000000000),
 currency text not null default 'USD' check(currency ~ '^[A-Z]{3}$'),
 created_at timestamptz not null default now(),
 foreign key(workspace_id,customer_id) references public.crm_customers(workspace_id,id)
);
create table public.crm_tasks(
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, customer_id uuid not null,
 title text not null check(length(trim(title)) between 1 and 300), due_at timestamptz,
 status text not null default 'open' check(status in ('open','done')),
 created_at timestamptz not null default now(), action_key uuid,
 foreign key(workspace_id,customer_id) references public.crm_customers(workspace_id,id)
);
create unique index crm_tasks_action on public.crm_tasks(workspace_id,action_key);
create table public.crm_memories(
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, customer_id uuid,
 content text not null check(length(trim(content)) between 1 and 2000),
 source text not null check(length(trim(source)) between 1 and 300),
 status text not null default 'proposed' check(status in ('proposed','approved','rejected')),
 expires_at timestamptz, created_at timestamptz not null default now(), action_key uuid,
 foreign key(workspace_id,customer_id) references public.crm_customers(workspace_id,id)
);
create unique index crm_memories_action on public.crm_memories(workspace_id,action_key);
create table public.crm_activity(
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, customer_id uuid not null,
 kind text not null, title text not null, actor_id uuid references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(workspace_id,customer_id) references public.crm_customers(workspace_id,id)
);
create table public.crm_workspace_activity(
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, kind text not null, title text not null,
 actor_id uuid, created_at timestamptz not null default now()
);
create table public.crm_external_records(
 workspace_id uuid not null, customer_id uuid not null, source_system text not null, external_id text not null,
 created_at timestamptz not null default now(), primary key(workspace_id,source_system,external_id),
 foreign key(workspace_id,customer_id) references public.crm_customers(workspace_id,id)
);
create table public.crm_mail_connections(
 account_id uuid not null, workspace_id uuid not null references public.crm_workspaces(id),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 connected_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 primary key(workspace_id,account_id)
);
create table public.crm_mail_threads(
 account_id uuid not null, thread_id text not null, workspace_id uuid not null, customer_id uuid not null,
 subject text not null default '', last_event_at timestamptz not null, quote_outcome jsonb,
 primary key(workspace_id,account_id,thread_id),
 foreign key(workspace_id,customer_id) references public.crm_customers(workspace_id,id)
);
create table public.crm_inquiries(
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, customer_id uuid not null,
 subject text not null check(length(trim(subject)) between 1 and 200),
 message text not null check(length(trim(message)) between 1 and 4000),
 source text not null check(source in ('phone','email','website','referral','other')),
 status text not null default 'new' check(status in ('new','reviewing','closed')),
 created_by uuid not null default auth.uid() references auth.users(id),
 received_at timestamptz not null default now(), created_at timestamptz not null default now(),
 foreign key(workspace_id,customer_id) references public.crm_customers(workspace_id,id)
);
create table public.crm_conversations(
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id),
 workspace_id uuid references public.crm_workspaces(id), customer_id uuid,
 title text not null default 'New conversation', messages jsonb not null default '[]', revision integer not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(workspace_id,customer_id) references public.crm_customers(workspace_id,id)
);

create function crm_private.record_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare row_data jsonb;customer uuid;label text;
begin
 row_data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 customer:=case when tg_table_name='crm_customers' then (row_data->>'id')::uuid else (row_data->>'customer_id')::uuid end;
 if customer is null then
  insert into public.crm_workspace_activity(workspace_id,kind,title,actor_id) values((row_data->>'workspace_id')::uuid,lower(tg_op),'Business memory '||lower(tg_op),auth.uid());
  return null; end if;
 if tg_op='DELETE' and tg_table_name='crm_customers' then return null; end if;
 label:=case tg_table_name when 'crm_customers' then 'Customer record' when 'crm_deals' then 'Opportunity' when 'crm_tasks' then 'Next action' else 'Customer memory' end;
 insert into public.crm_activity(workspace_id,customer_id,kind,title,actor_id) values((row_data->>'workspace_id')::uuid,customer,lower(tg_op),label||' '||lower(tg_op),auth.uid());
 return null;
end $$;

do $$ declare t text; begin
 foreach t in array array['crm_customers','crm_deals','crm_tasks','crm_memories','crm_activity','crm_mail_threads','crm_inquiries','crm_external_records'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('create policy tenant_read on public.%I for select to authenticated using (workspace_id in(select workspace_id from public.crm_memberships where user_id=(select auth.uid())))',t);
  if t in ('crm_customers','crm_deals','crm_tasks','crm_memories') then
   execute format('grant insert,update on public.%I to authenticated',t);
   execute format('create policy tenant_insert on public.%I for insert to authenticated with check (workspace_id in(select workspace_id from public.crm_memberships where user_id=(select auth.uid()) and role in(''owner'',''member'')))',t);
   execute format('create policy tenant_update on public.%I for update to authenticated using (workspace_id in(select workspace_id from public.crm_memberships where user_id=(select auth.uid()) and role in(''owner'',''member''))) with check (workspace_id in(select workspace_id from public.crm_memberships where user_id=(select auth.uid()) and role in(''owner'',''member'')))',t);
   execute format('create trigger crm_audit after insert or update or delete on public.%I for each row execute function crm_private.record_activity()',t);
  end if;
 end loop;
end $$;
alter table public.crm_conversations enable row level security;
grant select,insert,update,delete on public.crm_conversations to authenticated;
create policy conversations_own on public.crm_conversations for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

create function crm_private.mail_workspace(p_account uuid,p_token text) returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid;
begin
 if p_token is null or length(p_token)<40 or length(p_token)>200 then raise exception 'Invalid integration token' using errcode='42501'; end if;
 select workspace_id into w from public.crm_mail_connections where account_id=p_account and token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 if w is null then raise exception 'Mail connection is not authorized' using errcode='42501'; end if;
 return w;
end $$;
