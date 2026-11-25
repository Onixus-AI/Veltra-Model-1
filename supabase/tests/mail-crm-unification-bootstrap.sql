-- ISOLATED TEST DATABASE ONLY. No production data.
-- Stubs the objects that supabase/migrations/20261125020000_mail_crm_unification.sql depends on,
-- with the column shapes inspected read-only on production (project cohmkgctiqcedkuisbqh, 2026-11-25).
-- Roles, the owner check and the stage outcome are simplified; the mail-link, thread and task
-- functions under test are the real migration, not stubs.

do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists crm_private;
create schema if not exists revenue_private;
create schema if not exists auth;
create table if not exists auth.users(id uuid primary key);

-- Owner check: the session must set app.workspace_id and app.workspace_role = 'owner'.
create or replace function revenue_private.require_role(p_workspace uuid, p_min text) returns void
language plpgsql as $$ begin
  if current_setting('app.workspace_id', true) is distinct from p_workspace::text
     or current_setting('app.workspace_role', true) is distinct from p_min then
    raise exception '403:Owner role required.';
  end if;
end $$;

create or replace function revenue_private.stage_outcome(p_workspace uuid, p_stage text) returns text
language sql immutable as $$
  select case p_stage when 'won' then 'won' when 'lost' then 'lost' else 'open' end
$$;

create table public.crm_customers(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  company text not null,
  name text not null default '',
  email text,
  industry text not null default '',
  source text not null default 'manual',
  suppressed boolean not null default false,
  identity_review_required boolean not null default false,
  phone text not null default '',
  website text not null default '',
  location text not null default '',
  job_title text not null default '',
  record_type text not null default 'company',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, id)
);

create table public.crm_deals(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  customer_id uuid not null,
  stage text not null,
  created_at timestamptz not null default now()
);

create table public.crm_mail_threads(
  workspace_id uuid not null,
  account_id uuid not null,
  thread_id text not null,
  customer_id uuid not null,
  subject text not null,
  last_event_at timestamptz not null,
  quote_outcome jsonb,
  primary key (workspace_id, account_id, thread_id),
  foreign key (workspace_id, customer_id) references public.crm_customers(workspace_id, id)
);

create table public.crm_tasks(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  customer_id uuid not null,
  title text not null,
  due_at timestamptz,
  status text not null default 'open' check (status in ('open','done')),
  created_at timestamptz not null default now(),
  action_key uuid,
  unique (workspace_id, action_key),
  foreign key (workspace_id, customer_id) references public.crm_customers(workspace_id, id)
);

create table crm_private.mail_google(
  account_id uuid not null,
  workspace_id uuid not null,
  mailbox text not null,
  crm_token_secret uuid not null,
  status text not null,
  primary key (workspace_id, account_id)
);

-- Token-checked lookup used by the cleanup function; returns the workspace the mailbox belongs to.
create function crm_private.mail_workspace(p_account uuid, p_token text) returns uuid
language sql stable as $$
  select workspace_id from crm_private.mail_google
  where account_id = p_account and crm_token_secret::text = p_token and status = 'active'
$$;

create table crm_private.mail_items(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  account_id uuid not null,
  status text not null default 'pending',
  needs_owner boolean not null default false,
  created_at timestamptz not null default now()
);

create table crm_private.mail_quote_cleanup(
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  thread_id text not null
);


-- Production still has the two-argument overload that the migration replaces.
create function public.mail_items_list(p_workspace uuid, p_status text) returns jsonb
language sql stable as $$ select '[]'::jsonb $$;
