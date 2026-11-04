-- Mail runs inside Workspace (2026-11). Railway is retired: Supabase holds every mailbox's Google
-- refresh token (Vault) and is the clock; the Vercel route /api/mail/pass does one mailbox pass
-- (Gmail sync -> approved sends) per single-use job. The web app never holds a service-role key.

create schema if not exists crm_private;

-- One row per connected mailbox. Secrets live in Vault; only their ids are here.
create table if not exists crm_private.mail_google (
  account_id uuid primary key,
  workspace_id uuid not null,
  mailbox text not null,
  refresh_secret uuid not null,
  crm_token_secret uuid not null,
  connected_by uuid not null,
  connected_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active','expired','disconnected')),
  last_pass_at timestamptz,
  last_report jsonb
);
create unique index if not exists mail_google_workspace_mailbox on crm_private.mail_google(workspace_id, lower(mailbox));

-- Sign-in attempts: an unguessable, single-use, 15-minute state bound to the person and workspace.
create table if not exists crm_private.mail_google_states (
  state_hash text primary key,
  workspace_id uuid not null,
  user_id uuid not null,
  browser text,
  expires_at timestamptz not null,
  used_at timestamptz
);

-- Single-use pass jobs handed to the web app (same pattern as discovery and contact research).
create table if not exists crm_private.mail_passes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references crm_private.mail_google(account_id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '3 minutes',
  started_at timestamptz,
  finished_at timestamptz,
  report jsonb
);
create index if not exists mail_passes_open on crm_private.mail_passes(account_id) where finished_at is null;

create table if not exists crm_private.mail_runtime (
  singleton boolean primary key default true check (singleton),
  pass_url text
);
insert into crm_private.mail_runtime(singleton, pass_url) values (true, null) on conflict do nothing;

revoke all on all tables in schema crm_private from public, anon, authenticated;

create or replace function crm_private.token_hash(p text) returns text
language sql immutable set search_path = '' as $$ select encode(extensions.digest(convert_to(p,'UTF8'),'sha256'),'hex') $$;

create or replace function crm_private.new_token() returns text
language sql volatile set search_path = '' as $$ select encode(extensions.gen_random_bytes(36),'hex') $$;

-- 1. A workspace owner starts "Connect Gmail". Returns the state to put in Google's sign-in URL.
-- The workspace Mail belongs to for the signed-in owner: the one with a connected mailbox, else
-- their only owned workspace. Null when they own several and none is connected yet (they choose).
create or replace function public.mail_google_home() returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select c.workspace_id from public.crm_mail_connections c join public.crm_memberships m on m.workspace_id = c.workspace_id
      where m.user_id = auth.uid() and m.role = 'owner' order by c.created_at limit 1),
    (select min(m.workspace_id::text)::uuid from public.crm_memberships m where m.user_id = auth.uid() and m.role = 'owner'
      having count(*) = 1))
$$;

create or replace function public.mail_google_begin(p_workspace uuid, p_browser text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := revenue_private.require_role(p_workspace,'owner'); s text := crm_private.new_token();
begin
  if p_browser is not null and p_browser !~ '^[A-Za-z0-9-]{8,64}$' then raise exception '400:Invalid browser check.'; end if;
  delete from crm_private.mail_google_states where expires_at < now() - interval '1 day';
  insert into crm_private.mail_google_states(state_hash, workspace_id, user_id, browser, expires_at)
  values (crm_private.token_hash(s), p_workspace, u, p_browser, now() + interval '15 minutes');
  return jsonb_build_object('state', s);
end $$;

-- 2. Google's callback. Consumes the state once and stores the refresh token in Vault. Reconnecting
-- the same mailbox keeps its account id, so the saved Gmail sync position and history continue.
create or replace function public.mail_google_complete(p_state text, p_refresh_token text, p_mailbox text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare st crm_private.mail_google_states; acct uuid; mbox text := lower(trim(p_mailbox)); tok text := crm_private.new_token();
  g crm_private.mail_google; rs uuid; ts uuid;
begin
  if p_state is null or length(p_state) <> 72 then raise exception '400:Invalid sign-in state.'; end if;
  if p_refresh_token is null or length(p_refresh_token) < 20 or length(p_refresh_token) > 2000 then raise exception '400:Google did not return a lasting connection. Try again.'; end if;
  if mbox is null or mbox !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(mbox) > 254 then raise exception '400:Google did not return a mailbox address.'; end if;
  update crm_private.mail_google_states set used_at = now()
   where state_hash = crm_private.token_hash(p_state) and used_at is null and expires_at > now() returning * into st;
  if st.state_hash is null then raise exception '403:This sign-in link expired. Start Connect Gmail again.'; end if;

  select * into g from crm_private.mail_google where workspace_id = st.workspace_id and lower(mailbox) = mbox;
  acct := coalesce(g.account_id,
    (select s.account_id from public.revenue_sync_state s join public.crm_mail_connections c on c.account_id = s.account_id and c.workspace_id = s.workspace_id
      where s.workspace_id = st.workspace_id and lower(s.mailbox) = mbox limit 1),
    gen_random_uuid());

  if g.account_id is not null then
    perform vault.update_secret(g.refresh_secret, p_refresh_token);
    perform vault.update_secret(g.crm_token_secret, tok);
    update crm_private.mail_google set status = 'active', connected_by = st.user_id, connected_at = now() where account_id = acct;
  else
    rs := vault.create_secret(p_refresh_token, 'mail_google_refresh:' || acct, 'Gmail refresh token for ' || mbox);
    ts := vault.create_secret(tok, 'mail_google_crm:' || acct, 'Workspace Mail token for ' || mbox);
    insert into crm_private.mail_google(account_id, workspace_id, mailbox, refresh_secret, crm_token_secret, connected_by)
    values (acct, st.workspace_id, mbox, rs, ts, st.user_id);
  end if;

  insert into public.crm_mail_connections(account_id, workspace_id, token_hash, connected_by)
  values (acct, st.workspace_id, crm_private.token_hash(tok), st.user_id)
  on conflict (workspace_id, account_id) do update set token_hash = excluded.token_hash, connected_by = excluded.connected_by;
  return jsonb_build_object('mailbox', mbox, 'workspace_id', st.workspace_id, 'browser', st.browser);
end $$;

-- Owners see which mailboxes are connected and how the last pass went (no secrets).
create or replace function public.mail_google_status(p_workspace uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform revenue_private.require_role(p_workspace,'owner');
  return coalesce((select jsonb_agg(jsonb_build_object('mailbox', mailbox, 'status', status, 'connected_at', connected_at, 'last_pass_at', last_pass_at,
    'last_result', last_report->'result') order by mailbox) from crm_private.mail_google where workspace_id = p_workspace), '[]'::jsonb);
end $$;

-- Disconnect: passes stop and the mailbox's Workspace Mail token stops working at once.
create or replace function public.mail_google_disconnect(p_workspace uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g record;
begin
  perform revenue_private.require_role(p_workspace,'owner');
  for g in update crm_private.mail_google set status = 'disconnected' where workspace_id = p_workspace and status <> 'disconnected' returning account_id, refresh_secret loop
    perform vault.update_secret(g.refresh_secret, 'disconnected');
    update public.crm_mail_connections set token_hash = crm_private.token_hash(crm_private.new_token()) where workspace_id = p_workspace and account_id = g.account_id;
  end loop;
  return jsonb_build_object('ok', true);
end $$;

-- 3. Every minute: one job per active mailbox that has no unfinished job.
create or replace function crm_private.prepare_mail_passes() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g record; tok text; id uuid; jobs jsonb := '[]'::jsonb;
begin
  update crm_private.mail_passes set finished_at = now(), report = coalesce(report, '{"result":"expired"}')
   where finished_at is null and expires_at < now();
  for g in select m.account_id from crm_private.mail_google m where m.status = 'active'
            and not exists (select 1 from crm_private.mail_passes p where p.account_id = m.account_id and p.finished_at is null) loop
    tok := crm_private.new_token();
    insert into crm_private.mail_passes(account_id, token_hash) values (g.account_id, crm_private.token_hash(tok)) returning mail_passes.id into id;
    jobs := jobs || jsonb_build_object('job_id', id, 'token', tok);
  end loop;
  delete from crm_private.mail_passes where finished_at < now() - interval '2 days';
  return jobs;
end $$;

create or replace function crm_private.dispatch_mail_passes() returns void
language plpgsql security definer set search_path = '' as $$
declare endpoint text; job jsonb;
begin
  select pass_url into endpoint from crm_private.mail_runtime where singleton;
  if endpoint is null then return; end if;
  for job in select * from jsonb_array_elements(crm_private.prepare_mail_passes()) loop
    perform net.http_post(url := endpoint, headers := '{"Content-Type":"application/json"}'::jsonb, body := job, timeout_milliseconds := 60000);
  end loop;
end $$;

-- 4. The web app redeems a job once and gets what one pass needs. Never callable twice.
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
  return jsonb_build_object('account_id', g.account_id, 'mailbox', g.mailbox,
    'refresh_token', (select decrypted_secret from vault.decrypted_secrets where id = g.refresh_secret),
    'crm_token', (select decrypted_secret from vault.decrypted_secrets where id = g.crm_token_secret));
end $$;

create or replace function public.mail_pass_finish(p_job uuid, p_token text, p_report jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p crm_private.mail_passes; r text := left(coalesce(p_report->>'result', 'error'), 40);
begin
  update crm_private.mail_passes set finished_at = now(), report = jsonb_build_object('result', r, 'detail', left(coalesce(p_report->>'detail',''), 500),
      'ingested', p_report->'ingested', 'sent', p_report->'sent')
   where id = p_job and token_hash = crm_private.token_hash(p_token) and started_at is not null and finished_at is null returning * into p;
  if p.id is null then raise exception '403:Pass unavailable.'; end if;
  update crm_private.mail_google set last_pass_at = now(), last_report = p.report,
    status = case when r = 'expired' then 'expired' else status end where account_id = p.account_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.mail_google_home(), public.mail_google_begin(uuid,text), public.mail_google_complete(text,text,text), public.mail_google_status(uuid), public.mail_google_disconnect(uuid),
  public.mail_pass_start(uuid,text), public.mail_pass_finish(uuid,text,jsonb),
  crm_private.prepare_mail_passes(), crm_private.dispatch_mail_passes(), crm_private.token_hash(text), crm_private.new_token() from public, anon, authenticated;
grant execute on function public.mail_google_home(), public.mail_google_begin(uuid,text), public.mail_google_status(uuid), public.mail_google_disconnect(uuid) to authenticated;
grant execute on function public.mail_google_complete(text,text,text), public.mail_pass_start(uuid,text), public.mail_pass_finish(uuid,text,jsonb) to anon, authenticated;
