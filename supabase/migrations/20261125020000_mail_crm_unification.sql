-- Mail <-> CRM Unification (2026-11)
-- Verified against production schema:
-- 1. crm_mail_threads has PK (workspace_id, account_id, thread_id), customer_id (FK to crm_customers(workspace_id, id)), quote_outcome (jsonb).
-- 2. crm_customers has id, workspace_id, company (NOT NULL), email (nullable), website, location, archived_at, created_at.
-- 3. crm_tasks has workspace_id, customer_id, action_key (uuid, unique with workspace_id), title, due_at.
-- 4. Legacy crm_mail_connections sync trigger removed; /api/mail/link is the single source of truth.

-- 1. Drop the legacy sync trigger and function
drop trigger if exists trg_sync_mail_to_crm_connection on crm_private.mail_google;
drop function if exists crm_private.sync_mail_to_crm_connection();

-- 2. Allow logging quote outcomes before a CRM customer is linked
alter table public.crm_mail_threads
  alter column customer_id drop not null;

-- 3. Replace 2-arg mail_items_list with 3-arg version defaulting p_account to null
drop function if exists public.mail_items_list(uuid, text);

create or replace function public.mail_items_list(p_workspace uuid, p_status text, p_account uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform revenue_private.require_role(p_workspace, 'owner');
  return coalesce((select jsonb_agg(to_jsonb(i) - 'workspace_id' order by (i.status = 'pending') desc, i.needs_owner desc, i.created_at desc)
    from (
      select * from crm_private.mail_items
      where workspace_id = p_workspace
        and (p_status is null or status = p_status)
        and (p_account is null or account_id = p_account)
      order by created_at desc
      limit 200
    ) i), '[]'::jsonb);
end $$;

-- 4. Read unified CRM context for a thread (strictly keyed by workspace_id + account_id)
create or replace function public.mail_thread_crm_context(
  p_workspace uuid,
  p_account uuid,
  p_thread_id text,
  p_emails text[] default '{}'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_thread record;
  v_customer record;
  v_deals jsonb := '[]'::jsonb;
  v_norm_emails text[];
  v_customer_found boolean := false;
begin
  perform revenue_private.require_role(p_workspace, 'owner');

  if not exists (
    select 1 from crm_private.mail_google
    where account_id = p_account and workspace_id = p_workspace and status = 'active'
  ) then
    raise exception '403:Mailbox does not belong to this workspace.';
  end if;

  select array_agg(distinct lower(btrim(e)))
    into v_norm_emails
    from unnest(coalesce(p_emails, '{}')) e
    where nullif(btrim(e), '') is not null;

  select thread_id, subject, customer_id, quote_outcome, last_event_at
    into v_thread
    from public.crm_mail_threads
    where workspace_id = p_workspace
      and account_id = p_account
      and thread_id = p_thread_id
    limit 1;

  if v_thread.customer_id is not null then
    select id, company, email, website, location
      into v_customer
      from public.crm_customers
      where workspace_id = p_workspace
        and id = v_thread.customer_id
        and archived_at is null
      limit 1;
    v_customer_found := found;
  end if;

  if not v_customer_found and coalesce(array_length(v_norm_emails, 1), 0) > 0 then
    select id, company, email, website, location
      into v_customer
      from public.crm_customers
      where workspace_id = p_workspace
        and archived_at is null
        and lower(btrim(email)) = any(v_norm_emails)
      order by created_at desc
      limit 1;
    v_customer_found := found;
  end if;

  if v_customer_found and to_regclass('public.crm_deals') is not null then
    select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb)
      into v_deals
      from (
        select *
        from public.crm_deals
        where workspace_id = p_workspace
          and customer_id = v_customer.id
          and coalesce(revenue_private.stage_outcome(p_workspace, stage), 'open') not in ('won', 'lost')
        order by created_at desc
        limit 10
      ) d;
  end if;

  return jsonb_build_object(
    'customer', case when v_customer_found then jsonb_build_object(
      'id', v_customer.id,
      'company', v_customer.company,
      'email', v_customer.email,
      'website', v_customer.website,
      'location', v_customer.location
    ) else null end,
    'deals', v_deals,
    'thread', case when v_thread.thread_id is not null then jsonb_build_object(
      'thread_id', v_thread.thread_id,
      'subject', v_thread.subject,
      'customer_id', v_thread.customer_id,
      'quote_outcome', v_thread.quote_outcome
    ) else null end
  );
end $$;

-- 5. Link an existing CRM customer (by ID or matching email) or create a new one without erasing input variables
create or replace function public.mail_thread_link_customer(
  p_workspace uuid,
  p_account uuid,
  p_thread_id text,
  p_subject text,
  p_customer_id uuid default null,
  p_company text default null,
  p_email text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_customer_id uuid;
  v_company text;
  v_email text;
  v_existing record;
begin
  perform revenue_private.require_role(p_workspace, 'owner');

  if not exists (
    select 1 from crm_private.mail_google
    where account_id = p_account and workspace_id = p_workspace and status = 'active'
  ) then
    raise exception '403:Mailbox does not belong to this workspace.';
  end if;

  if p_customer_id is not null then
    select id, company, email into v_existing
      from public.crm_customers
      where id = p_customer_id and workspace_id = p_workspace and archived_at is null
      limit 1;
    if v_existing.id is null then
      raise exception '404:Customer not found in this workspace.';
    end if;
    v_customer_id := v_existing.id;
    v_company := v_existing.company;
    v_email := v_existing.email;
  else
    v_company := nullif(btrim(coalesce(p_company, '')), '');
    v_email := nullif(lower(btrim(coalesce(p_email, ''))), '');

    -- Use a separate record variable so v_company and v_email are preserved if no row matches
    if v_email is not null then
      select id, company, email into v_existing
        from public.crm_customers
        where workspace_id = p_workspace
          and archived_at is null
          and lower(btrim(email)) = v_email
        order by created_at desc
        limit 1;
    end if;

    if v_existing.id is not null then
      v_customer_id := v_existing.id;
      v_company := v_existing.company;
      v_email := v_existing.email;
    else
      if v_company is null then
        raise exception '400:Company name is required.';
      end if;
      insert into public.crm_customers (workspace_id, company, email)
      values (p_workspace, left(v_company, 200), left(v_email, 320))
      returning id, company, email into v_customer_id, v_company, v_email;
    end if;
  end if;

  insert into public.crm_mail_threads (workspace_id, account_id, thread_id, subject, customer_id, last_event_at)
  values (p_workspace, p_account, left(p_thread_id, 200), left(coalesce(nullif(btrim(p_subject), ''), '(no subject)'), 500), v_customer_id, now())
  on conflict (workspace_id, account_id, thread_id) do update
    set customer_id = excluded.customer_id,
        subject = coalesce(nullif(btrim(p_subject), ''), public.crm_mail_threads.subject),
        last_event_at = now();

  return jsonb_build_object(
    'customer', jsonb_build_object('id', v_customer_id, 'company', v_company, 'email', v_email)
  );
end $$;

-- 6. Log a quote outcome on the unified crm_mail_threads row (works when customer_id is null)
create or replace function public.mail_thread_log_quote_outcome(
  p_workspace uuid,
  p_account uuid,
  p_thread_id text,
  p_subject text,
  p_status text,
  p_reason text,
  p_reason_source text default 'owner_assessment',
  p_evidence text default '',
  p_source_message_id text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_outcome jsonb;
begin
  perform revenue_private.require_role(p_workspace, 'owner');

  if not exists (
    select 1 from crm_private.mail_google
    where account_id = p_account and workspace_id = p_workspace and status = 'active'
  ) then
    raise exception '403:Mailbox does not belong to this workspace.';
  end if;

  if p_status not in ('won', 'lost', 'pending', 'declined', 'unknown') then
    raise exception '400:Invalid quote outcome status.';
  end if;

  v_outcome := jsonb_build_object(
    'status', p_status,
    'reason', left(coalesce(nullif(btrim(p_reason), ''), 'Updated in Mail'), 300),
    'reason_source', case when p_reason_source in ('customer_statement', 'owner_assessment') then p_reason_source else 'owner_assessment' end,
    'evidence', left(coalesce(btrim(p_evidence), ''), 2000),
    'source_message_id', nullif(left(coalesce(p_source_message_id, ''), 200), ''),
    'updated_at', now()
  );

  insert into public.crm_mail_threads (workspace_id, account_id, thread_id, subject, customer_id, quote_outcome, last_event_at)
  values (p_workspace, p_account, left(p_thread_id, 200), left(coalesce(nullif(btrim(p_subject), ''), '(no subject)'), 500), null, v_outcome, now())
  on conflict (workspace_id, account_id, thread_id) do update
    set quote_outcome = excluded.quote_outcome,
        subject = coalesce(nullif(btrim(p_subject), ''), public.crm_mail_threads.subject),
        last_event_at = now();

  return jsonb_build_object('quote_outcome', v_outcome);
end $$;

-- 7. Create a follow-up CRM task directly from a Mail thread (action_key is strictly uuid, deterministic fallback if null)
create or replace function public.mail_thread_create_task(
  p_workspace uuid,
  p_account uuid,
  p_thread_id text,
  p_customer_id uuid,
  p_title text,
  p_due_at timestamptz,
  p_action_key uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_task_id uuid;
  v_key uuid;
begin
  perform revenue_private.require_role(p_workspace, 'owner');

  if not exists (
    select 1 from crm_private.mail_google
    where account_id = p_account and workspace_id = p_workspace and status = 'active'
  ) then
    raise exception '403:Mailbox does not belong to this workspace.';
  end if;

  if nullif(btrim(coalesce(p_title, '')), '') is null or length(p_title) > 300 then
    raise exception '400:Enter a task title up to 300 characters.';
  end if;

  if not exists (
    select 1 from public.crm_customers
    where id = p_customer_id and workspace_id = p_workspace and archived_at is null
  ) then
    raise exception '400:Link a CRM customer before creating a follow-up task.';
  end if;

  v_key := coalesce(
    p_action_key,
    md5(p_workspace::text || ':' || p_account::text || ':' || p_thread_id || ':' || p_customer_id::text || ':' || lower(btrim(p_title)))::uuid
  );

  insert into public.crm_tasks (workspace_id, customer_id, action_key, title, due_at)
  values (p_workspace, p_customer_id, v_key, left(btrim(p_title), 300), p_due_at)
  on conflict (workspace_id, action_key) do nothing;

  select id into v_task_id
    from public.crm_tasks
    where workspace_id = p_workspace and action_key = v_key;

  return jsonb_build_object('receipt_id', v_task_id, 'status', 'saved');
end $$;

-- 8. Ensure quote-cleanup refuses threads tied to a won deal via revenue_private.stage_outcome
create or replace function public.mail_quote_cleanup_eligible(p_account uuid, p_token text, p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  w uuid := crm_private.mail_workspace(p_account, p_token);
  v_thread_id text;
  v_customer_id uuid;
  v_outcome text;
begin
  select thread_id into v_thread_id
    from crm_private.mail_quote_cleanup
    where id = p_id and account_id = p_account;
  if v_thread_id is null then
    return false;
  end if;

  select customer_id, quote_outcome->>'status'
    into v_customer_id, v_outcome
    from public.crm_mail_threads
    where workspace_id = w and account_id = p_account and thread_id = v_thread_id;

  if v_outcome = 'won' then
    return false;
  end if;

  if v_customer_id is not null and to_regclass('public.crm_deals') is not null then
    if exists (
      select 1 from public.crm_deals d
      where d.workspace_id = w
        and d.customer_id = v_customer_id
        and revenue_private.stage_outcome(w, d.stage) = 'won'
    ) then
      return false;
    end if;
  end if;

  return true;
end $$;

-- Explicit permissions matching existing public.mail_* patterns
revoke execute on function public.mail_items_list(uuid, text, uuid) from public, anon;
grant execute on function public.mail_items_list(uuid, text, uuid) to authenticated;

revoke execute on function public.mail_thread_crm_context(uuid, uuid, text, text[]) from public, anon;
grant execute on function public.mail_thread_crm_context(uuid, uuid, text, text[]) to authenticated;

revoke execute on function public.mail_thread_link_customer(uuid, uuid, text, text, uuid, text, text) from public, anon;
grant execute on function public.mail_thread_link_customer(uuid, uuid, text, text, uuid, text, text) to authenticated;

revoke execute on function public.mail_thread_log_quote_outcome(uuid, uuid, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.mail_thread_log_quote_outcome(uuid, uuid, text, text, text, text, text, text, text) to authenticated;

revoke execute on function public.mail_thread_create_task(uuid, uuid, text, uuid, text, timestamptz, uuid) from public, anon;
grant execute on function public.mail_thread_create_task(uuid, uuid, text, uuid, text, timestamptz, uuid) to authenticated;

revoke execute on function public.mail_quote_cleanup_eligible(uuid, text, uuid) from public;
grant execute on function public.mail_quote_cleanup_eligible(uuid, text, uuid) to anon, authenticated;