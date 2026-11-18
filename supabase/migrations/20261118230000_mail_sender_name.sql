-- Sender name per mailbox (2026-11): mail Workspace sends shows "Omar Harris <o.harris@…>"
-- instead of a bare address. Gmail's send-as API returns an empty name unless one was set there,
-- so the owner sets it here; when unset, the Gmail send-as name (if any) is still used.

alter table crm_private.mail_google add column if not exists sender_name text
  check (sender_name is null or (length(sender_name) between 1 and 80 and sender_name !~ '[\r\n<>"\\]'));

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
    'sender_name', g.sender_name,
    'business', (select jsonb_build_object('name', w.name, 'industry', w.industry) from public.crm_workspaces w where w.id = g.workspace_id),
    'refresh_token', (select decrypted_secret from vault.decrypted_secrets where id = g.refresh_secret),
    'crm_token', (select decrypted_secret from vault.decrypted_secrets where id = g.crm_token_secret));
end $$;

-- Owner: the name each connected mailbox sends under (null clears it).
create or replace function public.mail_sender_names(p_workspace uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform revenue_private.require_role(p_workspace, 'member');
  return coalesce((select jsonb_agg(jsonb_build_object('mailbox', mailbox, 'sender_name', sender_name) order by connected_at)
    from crm_private.mail_google where workspace_id = p_workspace and status = 'active'), '[]'::jsonb);
end $$;

create or replace function public.mail_sender_name_set(p_workspace uuid, p_mailbox text, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n text := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), ''); g crm_private.mail_google;
begin
  perform revenue_private.require_role(p_workspace, 'owner');
  if n is not null and (length(n) > 80 or n ~ '[<>"\\]') then raise exception '400:Use a plain name up to 80 characters, without < > " or \.'; end if;
  update crm_private.mail_google set sender_name = n
   where workspace_id = p_workspace and lower(mailbox) = lower(trim(p_mailbox)) and status = 'active' returning * into g;
  if g.account_id is null then raise exception '404:That mailbox is not connected to this business.'; end if;
  return public.mail_sender_names(p_workspace);
end $$;

revoke all on function public.mail_sender_names(uuid), public.mail_sender_name_set(uuid, text, text) from public, anon;
grant execute on function public.mail_sender_names(uuid), public.mail_sender_name_set(uuid, text, text) to authenticated;
