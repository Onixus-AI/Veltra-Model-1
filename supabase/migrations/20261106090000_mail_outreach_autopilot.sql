-- Outreach autopilot (2026-11): a mailbox (e.g. o.harris@ for carrier outreach) sends a few
-- first-touch emails a day by itself, weekdays 9:00–16:00 Eastern, spaced out like a person
-- would. Off until the owner switches it on, and per mailbox, so info@ never sends outreach.
-- Each queued email is sent once at most: a row being sent is never retried automatically.
-- Anyone who already wrote to us, replied, bounced or said "no thanks" is not emailed.

alter table crm_private.mail_google add column if not exists outreach jsonb not null default '{"enabled":false,"daily_limit":10}'::jsonb;

create table if not exists crm_private.mail_outreach (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  account_id uuid not null references crm_private.mail_google(account_id) on delete cascade,
  customer_id uuid references public.crm_customers(id) on delete set null,
  to_email text not null check (to_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and length(to_email) <= 254),
  subject text not null default '' check (length(subject) <= 300),
  body text check (body is null or length(body) <= 20000),
  -- When set, the Gmail draft is what gets sent, so the owner's edits apply and a deleted draft is skipped.
  gmail_draft_id text check (gmail_draft_id is null or gmail_draft_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  campaign text not null default '',
  status text not null default 'queued' check (status in ('queued','sending','sent','skipped','failed','replied','bounced')),
  detail text not null default '',
  provider_message_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  check (body is not null or gmail_draft_id is not null)
);
create unique index if not exists mail_outreach_once on crm_private.mail_outreach(account_id, lower(to_email));
create index if not exists mail_outreach_queue on crm_private.mail_outreach(account_id, status, created_at);
revoke all on crm_private.mail_outreach from public, anon, authenticated;

create or replace function crm_private.mail_domain(e text) returns text language sql immutable set search_path = '' as $$
  select lower(split_part(e, '@', 2))
$$;
-- Shared mail providers: a reply from someone@gmail.com says nothing about another gmail.com address.
create or replace function crm_private.mail_shared_domain(d text) returns boolean language sql immutable set search_path = '' as $$
  select d ~ '^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|aol|icloud|me|mac|comcast|verizon|att|sbcglobal|bellsouth|cox|charter|proton|protonmail)\.'
$$;

-- The clock the sending window uses (a function so tests can set the time).
create or replace function crm_private.mail_now() returns timestamptz language sql stable set search_path = '' as $$ select now() $$;

/** The next outreach email this mailbox may send now, claimed as 'sending'; null with a reason otherwise. */
create or replace function public.mail_outreach_next(p_account uuid, p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w uuid := crm_private.mail_workspace(p_account, p_token); g crm_private.mail_google; o crm_private.mail_outreach;
  t timestamptz := crm_private.mail_now(); local timestamp := t at time zone 'America/New_York'; lim integer; gap interval; today integer; last timestamptz; why text; tries integer := 0;
begin
  select * into g from crm_private.mail_google where account_id = p_account and status = 'active';
  if g.account_id is null or coalesce((g.outreach->>'enabled')::boolean, false) is not true then return jsonb_build_object('reason', 'off'); end if;
  if extract(isodow from local) > 5 or local::time < time '09:00' or local::time >= time '16:00' then return jsonb_build_object('reason', 'outside hours'); end if;
  lim := least(greatest(coalesce((g.outreach->>'daily_limit')::integer, 10), 1), 25);
  gap := make_interval(mins => greatest(15, 420 / lim));
  select count(*) into today from crm_private.mail_outreach
   where account_id = p_account and status in ('sending','sent','replied','bounced')
     and (coalesce(sent_at, updated_at) at time zone 'America/New_York')::date = local::date;
  select max(coalesce(sent_at, updated_at)) into last from crm_private.mail_outreach where account_id = p_account and status in ('sending','sent','replied','bounced');
  if today >= lim then return jsonb_build_object('reason', 'daily limit reached'); end if;
  if last is not null and last > t - gap then return jsonb_build_object('reason', 'spacing'); end if;
  loop
    tries := tries + 1;
    if tries > 25 then return jsonb_build_object('reason', 'nothing sendable'); end if;
    select * into o from crm_private.mail_outreach where account_id = p_account and status = 'queued' order by created_at, id limit 1 for update skip locked;
    if o.id is null then return jsonb_build_object('reason', 'queue empty'); end if;
    why := null;
    if o.customer_id is not null and exists (select 1 from public.crm_customers c where c.id = o.customer_id and (c.suppressed or c.archived_at is not null or c.merged_into_id is not null)) then
      why := 'Company is suppressed or archived in the CRM.';
    elsif exists (select 1 from crm_private.mail_outreach x where x.workspace_id = w and x.id <> o.id and lower(x.to_email) = lower(o.to_email) and x.status in ('sending','sent','replied','bounced')) then
      why := 'Already emailed from another mailbox.';
    elsif exists (select 1 from crm_private.mail_items i where i.workspace_id = w and (lower(i.from_email) = lower(o.to_email)
        or (not crm_private.mail_shared_domain(crm_private.mail_domain(o.to_email)) and crm_private.mail_domain(i.from_email) = crm_private.mail_domain(o.to_email)))) then
      why := 'They have already written to us: answer them instead of sending outreach.';
    end if;
    if why is null then
      update crm_private.mail_outreach set status = 'sending', updated_at = t where id = o.id;
      return jsonb_build_object('id', o.id, 'to_email', o.to_email, 'subject', o.subject, 'body', o.body, 'gmail_draft_id', o.gmail_draft_id);
    end if;
    update crm_private.mail_outreach set status = 'skipped', detail = why, updated_at = now() where id = o.id;
  end loop;
end $$;

create or replace function public.mail_outreach_done(p_account uuid, p_token text, p_id uuid, p_status text, p_detail text, p_provider_message_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w uuid := crm_private.mail_workspace(p_account, p_token); o crm_private.mail_outreach;
begin
  if p_status not in ('sent','skipped','failed') then raise exception '400:Invalid outreach result.'; end if;
  update crm_private.mail_outreach set status = p_status, detail = left(coalesce(p_detail, ''), 300), provider_message_id = left(p_provider_message_id, 200),
    sent_at = case when p_status = 'sent' then crm_private.mail_now() end, updated_at = crm_private.mail_now()
   where id = p_id and account_id = p_account and status = 'sending' returning * into o;
  if o.id is null then raise exception '409:This outreach email was already handled.'; end if;
  if p_status = 'sent' and o.customer_id is not null then
    insert into public.crm_activity(workspace_id, customer_id, kind, title)
    values (w, o.customer_id, 'email', left('Outreach sent to ' || o.to_email || coalesce(': ' || nullif(o.subject, ''), ''), 300));
  end if;
  return jsonb_build_object('id', o.id, 'status', o.status);
end $$;

/** New inbound mail: a reply stops outreach to that company; "no thanks" and bounces also suppress it in the CRM. */
create or replace function public.mail_outreach_replies(p_account uuid, p_token text, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w uuid := crm_private.mail_workspace(p_account, p_token); x jsonb; n integer := 0; k integer; dom text; addr text; stop boolean;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then raise exception '400:Send up to 200 messages.'; end if;
  for x in select * from jsonb_array_elements(p_items) loop
    addr := lower(coalesce(x->>'bounce_recipient', x->>'from_email', ''));
    if addr !~ '@' then continue; end if;
    dom := crm_private.mail_domain(addr);
    if x->>'bounce_recipient' is not null then
      with b as (update crm_private.mail_outreach set status = 'bounced', detail = 'Bounced: the address does not accept mail.', updated_at = now()
                  where workspace_id = w and lower(to_email) = addr and status in ('sent','sending','queued') returning customer_id)
      update public.crm_customers c set suppressed = true from b where c.id = b.customer_id;
      get diagnostics k = row_count; n := n + k; continue;
    end if;
    stop := coalesce((x->>'opt_out')::boolean, false);
    with r as (update crm_private.mail_outreach set status = case when status = 'queued' then 'skipped' else 'replied' end,
                  detail = case when stop then 'Replied: asked not to be emailed.' else 'Replied: answer them in Mail.' end, updated_at = now()
                where workspace_id = w and status in ('queued','sending','sent')
                  and (lower(to_email) = addr or (not crm_private.mail_shared_domain(dom) and crm_private.mail_domain(to_email) = dom))
                returning customer_id)
    update public.crm_customers c set suppressed = true from r where stop and c.id = r.customer_id;
    get diagnostics k = row_count; n := n + k;
  end loop;
  return jsonb_build_object('updated', n);
end $$;

-- Owner controls: switch a mailbox's outreach autopilot on or off and set its daily number.
create or replace function public.mail_outreach_set(p_workspace uuid, p_mailbox text, p_enabled boolean, p_daily_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g crm_private.mail_google;
begin
  perform revenue_private.require_role(p_workspace, 'owner');
  if p_enabled is null or p_daily_limit is null or p_daily_limit not between 1 and 25 then raise exception '400:Choose between 1 and 25 emails a day.'; end if;
  update crm_private.mail_google set outreach = jsonb_build_object('enabled', p_enabled, 'daily_limit', p_daily_limit)
   where workspace_id = p_workspace and lower(mailbox) = lower(trim(p_mailbox)) and status = 'active' returning * into g;
  if g.account_id is null then raise exception '404:That mailbox is not connected to this business.'; end if;
  return public.mail_outreach_status(p_workspace);
end $$;

create or replace function public.mail_outreach_status(p_workspace uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform revenue_private.require_role(p_workspace, 'member');
  return coalesce((select jsonb_agg(jsonb_build_object(
      'mailbox', g.mailbox, 'enabled', coalesce((g.outreach->>'enabled')::boolean, false), 'daily_limit', coalesce((g.outreach->>'daily_limit')::integer, 10),
      'queued', (select count(*) from crm_private.mail_outreach o where o.account_id = g.account_id and o.status = 'queued'),
      'sent_today', (select count(*) from crm_private.mail_outreach o where o.account_id = g.account_id and o.status in ('sending','sent','replied','bounced')
                      and (coalesce(o.sent_at, o.updated_at) at time zone 'America/New_York')::date = (now() at time zone 'America/New_York')::date),
      'sent', (select count(*) from crm_private.mail_outreach o where o.account_id = g.account_id and o.status in ('sent','replied','bounced')),
      'replied', (select count(*) from crm_private.mail_outreach o where o.account_id = g.account_id and o.status = 'replied'),
      'needs_look', (select count(*) from crm_private.mail_outreach o where o.account_id = g.account_id and (o.status = 'failed' or (o.status = 'sending' and o.updated_at < now() - interval '10 minutes'))),
      'recent', (select coalesce(jsonb_agg(r order by r.t desc), '[]'::jsonb) from (select o.to_email, o.status, o.detail, coalesce(o.sent_at, o.updated_at) t
                   from crm_private.mail_outreach o where o.account_id = g.account_id and o.status <> 'queued' order by coalesce(o.sent_at, o.updated_at) desc limit 8) r))
      order by g.connected_at)
    from crm_private.mail_google g where g.workspace_id = p_workspace and g.status = 'active'), '[]'::jsonb);
end $$;

revoke all on function public.mail_outreach_next(uuid, text), public.mail_outreach_done(uuid, text, uuid, text, text, text), public.mail_outreach_replies(uuid, text, jsonb),
  public.mail_outreach_set(uuid, text, boolean, integer), public.mail_outreach_status(uuid) from public, anon, authenticated;
-- Like the other pass functions: callable with the mailbox's own token, which is checked inside.
grant execute on function public.mail_outreach_next(uuid, text), public.mail_outreach_done(uuid, text, uuid, text, text, text), public.mail_outreach_replies(uuid, text, jsonb) to anon, authenticated;
grant execute on function public.mail_outreach_set(uuid, text, boolean, integer), public.mail_outreach_status(uuid) to authenticated;
