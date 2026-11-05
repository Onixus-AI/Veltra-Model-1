-- Mail as an employee (2026-11). Each new email gets one work item: what it is (the model labels,
-- code decides), what Mail plans to do (tidy it, unsubscribe, reply, quote) and whether a person
-- approved it. Nothing irreversible happens on the model's say-so: an item waits for the owner
-- unless the owner put that kind of work on autopilot in the mailbox settings.

create table if not exists crm_private.mail_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  account_id uuid not null references crm_private.mail_google(account_id) on delete cascade,
  provider_message_id text not null,
  thread_id text,
  from_email text not null,
  from_name text,
  subject text not null default '',
  category text check (category in ('JUNK','NEWSLETTER','COLD_OUTREACH','NOTIFICATION','QUESTION','QUOTE_REQUEST','DOCUMENT','PERSONAL','OTHER')),
  confidence numeric check (confidence between 0 and 1),
  summary text not null default '',
  priority text not null default 'NORMAL' check (priority in ('URGENT','HIGH','NORMAL','LOW')),
  needs_owner boolean not null default false,
  owner_reason text,
  plan jsonb,
  attempts integer not null default 0,
  draft text,
  status text not null default 'unsorted' check (status in ('unsorted','pending','approved','done','skipped','failed','info')),
  result jsonb,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, provider_message_id)
);
create index if not exists mail_items_queue on crm_private.mail_items(workspace_id, status, created_at desc);
create index if not exists mail_items_due on crm_private.mail_items(account_id) where status = 'approved';
create index if not exists mail_items_unsorted on crm_private.mail_items(account_id, created_at) where status = 'unsorted';
revoke all on crm_private.mail_items from public, anon, authenticated;

-- Autopilot switches per mailbox. Everything starts off: Mail sorts and proposes; the owner approves.
alter table crm_private.mail_google add column if not exists settings jsonb not null default
  '{"auto_clean":false,"delete_junk":true,"unsubscribe":false,"auto_send":[]}'::jsonb;

create or replace function crm_private.mail_settings_valid(s jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(s) = 'object'
    and jsonb_typeof(s->'auto_clean') = 'boolean' and jsonb_typeof(s->'delete_junk') = 'boolean' and jsonb_typeof(s->'unsubscribe') = 'boolean'
    and jsonb_typeof(s->'auto_send') = 'array'
    and not exists (select 1 from jsonb_array_elements_text(s->'auto_send') k where k not in ('QUESTION','QUOTE_REQUEST','DOCUMENT'))
    and (s->'tms_org_id' is null or jsonb_typeof(s->'tms_org_id') = 'null' or (s->>'tms_org_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
$$;

-- During sync, every new inbound email is noted as 'unsorted' (cheap), so an email is never lost
-- when a pass runs out of time; later passes sort a few at a time.
create or replace function public.mail_items_note(p_account uuid, p_token text, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w uuid := crm_private.mail_workspace(p_account, p_token); n integer;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then raise exception '400:Send up to 200 messages.'; end if;
  insert into crm_private.mail_items(workspace_id, account_id, provider_message_id, thread_id, from_email, from_name, subject, status)
  select w, p_account, left(x->>'provider_message_id', 200), left(x->>'thread_id', 200), lower(left(x->>'from_email', 320)), left(x->>'from_name', 200), left(coalesce(x->>'subject', ''), 500), 'unsorted'
    from jsonb_array_elements(p_items) x where nullif(x->>'provider_message_id', '') is not null and nullif(x->>'from_email', '') is not null
  on conflict (account_id, provider_message_id) do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('noted', n);
end $$;

create or replace function public.mail_items_unsorted(p_account uuid, p_token text, p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w uuid := crm_private.mail_workspace(p_account, p_token);
begin
  -- Three tries per email; after that it is shown to the owner unsorted instead of retried forever.
  update crm_private.mail_items set status = 'failed', result = jsonb_build_object('error', 'Could not sort this email after 3 tries.'), updated_at = now()
   where account_id = p_account and status = 'unsorted' and attempts >= 3;
  return coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'provider_message_id', i.provider_message_id) order by i.created_at)
    from (select * from crm_private.mail_items where account_id = p_account and status = 'unsorted' order by created_at limit least(greatest(coalesce(p_limit, 5), 1), 20)) i), '[]'::jsonb);
end $$;

create or replace function public.mail_item_attempt(p_account uuid, p_token text, p_id uuid, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
declare w uuid := crm_private.mail_workspace(p_account, p_token);
begin
  update crm_private.mail_items set attempts = attempts + 1, result = jsonb_build_object('error', left(p_error, 300)), updated_at = now()
   where id = p_id and account_id = p_account and status = 'unsorted';
end $$;

-- The pass records each new email's item. Authorized by the mailbox's CRM token, like every Mail RPC.
create or replace function public.mail_item_record(p_account uuid, p_token text, p_item jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w uuid := crm_private.mail_workspace(p_account, p_token); s jsonb; auto boolean; k text := p_item->>'category'; id uuid; st text;
begin
  if k is null or jsonb_typeof(p_item->'plan') <> 'object' then raise exception '400:A sorted item needs a category and a plan.'; end if;
  select settings into s from crm_private.mail_google where account_id = p_account;
  -- Autopilot is decided here from the owner's settings, never by the caller.
  auto := case
    when k in ('JUNK','NEWSLETTER','COLD_OUTREACH','NOTIFICATION') then coalesce((s->>'auto_clean')::boolean, false) and not coalesce((p_item->>'needs_owner')::boolean, false)
    when k in ('QUESTION','QUOTE_REQUEST','DOCUMENT') then (s->'auto_send') ? k and nullif(p_item->>'draft','') is not null
         and not coalesce((p_item->>'needs_owner')::boolean, false) and coalesce((p_item->'plan'->>'needs_review')::boolean, false) = false
    else false end;
  st := case when p_item->'plan'->>'action' = 'none' then 'info' when auto then 'approved' else 'pending' end;
  insert into crm_private.mail_items(workspace_id, account_id, provider_message_id, thread_id, from_email, from_name, subject, category, confidence, summary,
    priority, needs_owner, owner_reason, plan, draft, status)
  values (w, p_account, left(p_item->>'provider_message_id', 200), left(p_item->>'thread_id', 200), lower(left(p_item->>'from_email', 320)), left(p_item->>'from_name', 200),
    left(coalesce(p_item->>'subject', ''), 500), k, least(greatest(coalesce((p_item->>'confidence')::numeric, 0), 0), 1), left(coalesce(p_item->>'summary', ''), 500),
    coalesce(p_item->>'priority', 'NORMAL'), coalesce((p_item->>'needs_owner')::boolean, false), left(p_item->>'owner_reason', 300), p_item->'plan', left(p_item->>'draft', 8000), st)
  on conflict (account_id, provider_message_id) do update set category = excluded.category, confidence = excluded.confidence, summary = excluded.summary,
    priority = excluded.priority, needs_owner = excluded.needs_owner, owner_reason = excluded.owner_reason, plan = excluded.plan, draft = excluded.draft,
    status = excluded.status, thread_id = coalesce(excluded.thread_id, crm_private.mail_items.thread_id), result = null, updated_at = now()
   where crm_private.mail_items.status = 'unsorted'
  returning mail_items.id into id;
  return jsonb_build_object('id', id, 'status', st, 'duplicate', id is null);
end $$;

-- Approved items the pass should carry out now (owner-approved or autopilot).
create or replace function public.mail_items_due(p_account uuid, p_token text, p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w uuid := crm_private.mail_workspace(p_account, p_token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'provider_message_id', i.provider_message_id, 'thread_id', i.thread_id, 'from_email', i.from_email,
      'subject', i.subject, 'category', i.category, 'plan', i.plan, 'draft', i.draft) order by i.created_at)
    from (select * from crm_private.mail_items where account_id = p_account and status = 'approved' order by created_at limit least(greatest(coalesce(p_limit, 10), 1), 25)) i), '[]'::jsonb);
end $$;

create or replace function public.mail_item_done(p_account uuid, p_token text, p_id uuid, p_ok boolean, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w uuid := crm_private.mail_workspace(p_account, p_token);
begin
  update crm_private.mail_items set status = case when p_ok then 'done' else 'failed' end, result = p_result, updated_at = now()
   where id = p_id and account_id = p_account and status = 'approved';
  return jsonb_build_object('ok', found);
end $$;

-- What the owner sees: items waiting for a decision, and what Mail did recently.
create or replace function public.mail_items_list(p_workspace uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform revenue_private.require_role(p_workspace, 'owner');
  return coalesce((select jsonb_agg(to_jsonb(i) - 'workspace_id' order by (i.status = 'pending') desc, i.needs_owner desc, i.created_at desc)
    from (select * from crm_private.mail_items where workspace_id = p_workspace and (p_status is null or status = p_status) order by created_at desc limit 200) i), '[]'::jsonb);
end $$;

-- Approve (optionally with an edited reply) or skip one item. Only pending items can be decided.
create or replace function public.mail_item_decide(p_workspace uuid, p_id uuid, p_decision text, p_draft text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := revenue_private.require_role(p_workspace, 'owner'); i crm_private.mail_items;
begin
  if p_decision not in ('approve', 'skip') then raise exception '400:Choose approve or skip.'; end if;
  if p_draft is not null and (length(btrim(p_draft)) = 0 or length(p_draft) > 8000) then raise exception '400:The reply must have text (up to 8,000 characters).'; end if;
  update crm_private.mail_items set status = case when p_decision = 'approve' then 'approved' else 'skipped' end,
    draft = case when p_decision = 'approve' and p_draft is not null and plan->>'action' = 'reply' then p_draft else draft end,
    decided_by = u, decided_at = now(), updated_at = now()
   where id = p_id and workspace_id = p_workspace and status = 'pending' returning * into i;
  if i.id is null then raise exception '409:This item was already handled.'; end if;
  return jsonb_build_object('id', i.id, 'status', i.status);
end $$;

create or replace function public.mail_settings(p_workspace uuid, p_settings jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb;
begin
  perform revenue_private.require_role(p_workspace, 'owner');
  if p_settings is not null then
    if not crm_private.mail_settings_valid(p_settings) then raise exception '400:Invalid Mail settings.'; end if;
    update crm_private.mail_google set settings = p_settings where workspace_id = p_workspace and status <> 'disconnected';
  end if;
  select settings into s from crm_private.mail_google where workspace_id = p_workspace and status = 'active' order by connected_at desc limit 1;
  return coalesce(s, '{"auto_clean":false,"delete_junk":true,"unsubscribe":false,"auto_send":[]}'::jsonb);
end $$;

-- The pass needs the mailbox settings to plan cleanup (delete junk? unsubscribe?).
create or replace function public.mail_pass_start(p_job uuid, p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p crm_private.mail_passes; g crm_private.mail_google;
begin
  if p_token is null or length(p_token) <> 72 then raise exception '403:Pass unavailable.'; end if;
  update crm_private.mail_passes set started_at = now()
   where id = p_job and token_hash = crm_private.token_hash(p_token) and started_at is null and finished_at is null and expires_at > now()
   returning * into p;
  if p.id is null then raise exception '403:Pass unavailable.'; end if;
  select * into g from crm_private.mail_google where account_id = p.account_id and status = 'active';
  if g.account_id is null then raise exception '403:Pass unavailable.'; end if;
  return jsonb_build_object('account_id', g.account_id, 'workspace_id', g.workspace_id, 'mailbox', g.mailbox, 'settings', g.settings,
    'business', (select jsonb_build_object('name', w.name, 'industry', w.industry) from public.crm_workspaces w where w.id = g.workspace_id),
    'refresh_token', (select decrypted_secret from vault.decrypted_secrets where id = g.refresh_secret),
    'crm_token', (select decrypted_secret from vault.decrypted_secrets where id = g.crm_token_secret));
end $$;

-- The pass report also says what the employee did (sorted, done, failed, AI configured or not).
create or replace function public.mail_pass_finish(p_job uuid, p_token text, p_report jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p crm_private.mail_passes; r text := left(coalesce(p_report->>'result', 'error'), 40);
begin
  update crm_private.mail_passes set finished_at = now(), report = jsonb_build_object('result', r, 'detail', left(coalesce(p_report->>'detail',''), 500),
      'ingested', p_report->'ingested', 'sent', p_report->'sent',
      'employee', case when jsonb_typeof(p_report->'employee') = 'object' and length((p_report->'employee')::text) < 2000 then p_report->'employee' end)
   where id = p_job and token_hash = crm_private.token_hash(p_token) and started_at is not null and finished_at is null returning * into p;
  if p.id is null then raise exception '403:Pass unavailable.'; end if;
  update crm_private.mail_google set last_pass_at = now(), last_report = p.report,
    status = case when r = 'expired' then 'expired' else status end where account_id = p.account_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.mail_items_note(uuid,text,jsonb), public.mail_items_unsorted(uuid,text,integer), public.mail_item_attempt(uuid,text,uuid,text) from public, anon, authenticated;
revoke all on function public.mail_item_record(uuid,text,jsonb), public.mail_items_due(uuid,text,integer), public.mail_item_done(uuid,text,uuid,boolean,jsonb),
  public.mail_items_list(uuid,text), public.mail_item_decide(uuid,uuid,text,text), public.mail_settings(uuid,jsonb), crm_private.mail_settings_valid(jsonb)
  from public, anon, authenticated;
grant execute on function public.mail_items_note(uuid,text,jsonb), public.mail_items_unsorted(uuid,text,integer), public.mail_item_attempt(uuid,text,uuid,text) to anon, authenticated;
grant execute on function public.mail_item_record(uuid,text,jsonb), public.mail_items_due(uuid,text,integer), public.mail_item_done(uuid,text,uuid,boolean,jsonb) to anon, authenticated;
grant execute on function public.mail_items_list(uuid,text), public.mail_item_decide(uuid,uuid,text,text), public.mail_settings(uuid,jsonb) to authenticated;
