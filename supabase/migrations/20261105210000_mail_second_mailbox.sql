-- A second Gmail in one workspace (2026-11: o.harris@ for carrier outreach next to info@) inherits
-- the workspace's Mail settings (rate card, signature, autopilot) when it is first connected.
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
    -- A second mailbox in the workspace (e.g. an outreach inbox) starts with the same rates,
    -- signature and autopilot choices as the one already connected.
    insert into crm_private.mail_google(account_id, workspace_id, mailbox, refresh_secret, crm_token_secret, connected_by, settings)
    values (acct, st.workspace_id, mbox, rs, ts, st.user_id,
      coalesce((select o.settings from crm_private.mail_google o where o.workspace_id = st.workspace_id and o.status <> 'disconnected'
        order by o.connected_at desc limit 1), '{"auto_clean":false,"delete_junk":true,"unsubscribe":false,"auto_send":[]}'::jsonb));
  end if;

  insert into public.crm_mail_connections(account_id, workspace_id, token_hash, connected_by)
  values (acct, st.workspace_id, crm_private.token_hash(tok), st.user_id)
  on conflict (workspace_id, account_id) do update set token_hash = excluded.token_hash, connected_by = excluded.connected_by;
  return jsonb_build_object('mailbox', mbox, 'workspace_id', st.workspace_id, 'browser', st.browser);
end $$;
