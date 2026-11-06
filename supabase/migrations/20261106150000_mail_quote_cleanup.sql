-- Quote request cleanup (2026-11): a rate request whose thread has been quiet for N days
-- (Mail setting quote_cleanup_days, e.g. 10; null = off) is moved to Gmail's Trash. Only the
-- other side's messages are trashed; our sent quotes stay in Sent. A thread with newer activity
-- waits until it has been quiet for N days. Gmail empties its Trash after 30 days by itself.
-- Old rate requests from before Mail was connected are found once by a Gmail search and listed
-- for the owner: none of those is trashed until the owner approves it.

create or replace function crm_private.mail_settings_valid(s jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(s) = 'object'
    and jsonb_typeof(s->'auto_clean') = 'boolean' and jsonb_typeof(s->'delete_junk') = 'boolean' and jsonb_typeof(s->'unsubscribe') = 'boolean'
    and jsonb_typeof(s->'auto_send') = 'array'
    and not exists (select 1 from jsonb_array_elements_text(s->'auto_send') k where k not in ('QUESTION','QUOTE_REQUEST','DOCUMENT'))
    and (s->'tms_org_id' is null or jsonb_typeof(s->'tms_org_id') = 'null' or (s->>'tms_org_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    and crm_private.mail_rate_card_valid(s->'rate_card')
    and (s->'signature' is null or jsonb_typeof(s->'signature') = 'null' or (jsonb_typeof(s->'signature') = 'string' and length(s->>'signature') <= 600))
    and (s->'quote_valid_days' is null or jsonb_typeof(s->'quote_valid_days') = 'null'
      or (jsonb_typeof(s->'quote_valid_days') = 'number' and (s->>'quote_valid_days')::numeric between 1 and 60))
    and (s->'quote_cleanup_days' is null or jsonb_typeof(s->'quote_cleanup_days') = 'null'
      or (jsonb_typeof(s->'quote_cleanup_days') = 'number' and (s->>'quote_cleanup_days')::numeric in (3, 5, 7, 10, 14, 21, 30, 45, 60)))
$$;
revoke all on function crm_private.mail_settings_valid(jsonb) from public, anon, authenticated;

alter table crm_private.mail_google add column if not exists quote_backlog_searched_at timestamptz;

create table if not exists crm_private.mail_quote_cleanup (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  account_id uuid not null references crm_private.mail_google(account_id) on delete cascade,
  thread_id text not null check (length(thread_id) between 1 and 100),
  -- tagged: Mail sorted it as a rate request (cleaned automatically); backlog: found by search (owner approves).
  source text not null check (source in ('tagged','backlog')),
  status text not null check (status in ('proposed','approved','waiting','trashed','kept','failed')),
  subject text not null default '',
  from_email text not null default '',
  last_message_at timestamptz,
  check_after timestamptz not null default now(),
  trashed integer not null default 0,
  detail text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, thread_id)
);
create index if not exists mail_quote_cleanup_due on crm_private.mail_quote_cleanup(account_id, status, check_after);
revoke all on crm_private.mail_quote_cleanup from public, anon, authenticated;

create or replace function crm_private.mail_cleanup_days(p_account uuid) returns integer
language sql stable set search_path = '' as $$
  select case when jsonb_typeof(settings->'quote_cleanup_days') = 'number' then (settings->>'quote_cleanup_days')::integer end
  from crm_private.mail_google where account_id = p_account and status = 'active'
$$;

/** Threads to look at now: rate requests Mail sorted that are old enough, plus approved backlog. */
create or replace function public.mail_quote_cleanup_due(p_account uuid, p_token text, p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w uuid := crm_private.mail_workspace(p_account, p_token); days integer := crm_private.mail_cleanup_days(p_account);
begin
  if days is null then return jsonb_build_object('days', null, 'threads', '[]'::jsonb, 'search_backlog', false); end if;
  insert into crm_private.mail_quote_cleanup(workspace_id, account_id, thread_id, source, status, subject, from_email)
  select distinct on (i.thread_id) w, p_account, i.thread_id, 'tagged', 'approved', left(coalesce(i.subject, ''), 300), left(coalesce(i.from_email, ''), 254)
    from crm_private.mail_items i
   where i.account_id = p_account and i.category = 'QUOTE_REQUEST' and i.thread_id is not null and i.created_at < now() - make_interval(days => days)
   order by i.thread_id, i.created_at
  on conflict (account_id, thread_id) do nothing;
  return jsonb_build_object('days', days,
    'search_backlog', (select quote_backlog_searched_at is null from crm_private.mail_google where account_id = p_account),
    'threads', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'thread_id', c.thread_id) order by c.check_after)
      from (select * from crm_private.mail_quote_cleanup where account_id = p_account and status in ('approved','waiting') and check_after <= now()
             order by check_after limit least(greatest(coalesce(p_limit, 15), 1), 50)) c), '[]'::jsonb));
end $$;

create or replace function public.mail_quote_cleanup_result(p_account uuid, p_token text, p_id uuid, p_status text, p_last_message_at timestamptz, p_trashed integer, p_detail text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w uuid := crm_private.mail_workspace(p_account, p_token); days integer := coalesce(crm_private.mail_cleanup_days(p_account), 10); c crm_private.mail_quote_cleanup;
begin
  if p_status not in ('trashed','waiting','kept','failed') then raise exception '400:Invalid cleanup result.'; end if;
  update crm_private.mail_quote_cleanup set status = p_status, last_message_at = coalesce(p_last_message_at, last_message_at),
    trashed = trashed + greatest(coalesce(p_trashed, 0), 0), detail = left(coalesce(p_detail, ''), 300), updated_at = now(),
    -- A thread that is still active is looked at again once it has been quiet for the full period.
    check_after = case when p_status = 'waiting' then greatest(coalesce(p_last_message_at, now()) + make_interval(days => days), now() + interval '1 hour')
                       when p_status = 'failed' then now() + interval '6 hours' else check_after end
   where id = p_id and account_id = p_account and status in ('approved','waiting') returning * into c;
  if c.id is null then raise exception '409:This thread was already handled.'; end if;
  return jsonb_build_object('id', c.id, 'status', c.status);
end $$;

/** The one-time search for old rate requests: listed as proposals for the owner, never trashed without approval. */
create or replace function public.mail_quote_backlog_add(p_account uuid, p_token text, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w uuid := crm_private.mail_workspace(p_account, p_token); n integer;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 500 then raise exception '400:Send up to 500 threads.'; end if;
  insert into crm_private.mail_quote_cleanup(workspace_id, account_id, thread_id, source, status, subject, from_email, last_message_at)
  select w, p_account, x->>'thread_id', 'backlog', 'proposed', left(coalesce(x->>'subject', ''), 300), left(coalesce(x->>'from_email', ''), 254), (x->>'last_message_at')::timestamptz
    from jsonb_array_elements(p_items) x where length(coalesce(x->>'thread_id', '')) between 1 and 100
  on conflict (account_id, thread_id) do nothing;
  get diagnostics n = row_count;
  update crm_private.mail_google set quote_backlog_searched_at = now() where account_id = p_account;
  return jsonb_build_object('added', n);
end $$;

-- Owner: see the old rate requests the search found, and approve or keep them.
create or replace function public.mail_quote_cleanup_list(p_workspace uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform revenue_private.require_role(p_workspace, 'member');
  return jsonb_build_object(
    'proposed', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'mailbox', g.mailbox, 'subject', c.subject, 'from_email', c.from_email, 'last_message_at', c.last_message_at)
                 order by c.last_message_at desc nulls last) from crm_private.mail_quote_cleanup c join crm_private.mail_google g on g.account_id = c.account_id
                 where c.workspace_id = p_workspace and c.status = 'proposed'), '[]'::jsonb),
    'trashed', (select count(*) from crm_private.mail_quote_cleanup where workspace_id = p_workspace and status = 'trashed'),
    'waiting', (select count(*) from crm_private.mail_quote_cleanup where workspace_id = p_workspace and status in ('approved','waiting')),
    'failed', (select count(*) from crm_private.mail_quote_cleanup where workspace_id = p_workspace and status = 'failed'));
end $$;

create or replace function public.mail_quote_cleanup_decide(p_workspace uuid, p_ids uuid[], p_approve boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform revenue_private.require_role(p_workspace, 'owner');
  if p_approve is null then raise exception '400:Choose approve or keep.'; end if;
  update crm_private.mail_quote_cleanup set status = case when p_approve then 'approved' else 'kept' end, check_after = now(), updated_at = now(),
    detail = case when p_approve then 'Approved by the owner.' else 'Kept by the owner.' end
   where workspace_id = p_workspace and status = 'proposed' and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return jsonb_build_object('updated', n);
end $$;

revoke all on function public.mail_quote_cleanup_due(uuid, text, integer), public.mail_quote_cleanup_result(uuid, text, uuid, text, timestamptz, integer, text),
  public.mail_quote_backlog_add(uuid, text, jsonb), public.mail_quote_cleanup_list(uuid), public.mail_quote_cleanup_decide(uuid, uuid[], boolean) from public, anon, authenticated;
revoke all on function crm_private.mail_cleanup_days(uuid) from public, anon, authenticated;
-- Like the other pass functions: callable with the mailbox's own token, which is checked inside.
grant execute on function public.mail_quote_cleanup_due(uuid, text, integer), public.mail_quote_cleanup_result(uuid, text, uuid, text, timestamptz, integer, text),
  public.mail_quote_backlog_add(uuid, text, jsonb) to anon, authenticated;
grant execute on function public.mail_quote_cleanup_list(uuid), public.mail_quote_cleanup_decide(uuid, uuid[], boolean) to authenticated;
