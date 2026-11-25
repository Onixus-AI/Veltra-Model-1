-- Live Mail (2026-11): Workspace Mail shows the real Gmail inbox (folders, threads, compose) instead
-- of a dashboard. Reading and sending happen when a person opens Mail, so the web server needs the
-- mailbox's Google access for that request only.
--
-- This function is callable ONLY by the service role (the Workspace server). The server passes the
-- user id it verified from the person's own session; the function re-checks that this person owns
-- the business and that the mailbox is an active connection of it. The browser can never call it,
-- so the refresh token never leaves the server.

create or replace function public.mail_live_access(p_user uuid, p_workspace uuid, p_mailbox text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r text; g crm_private.mail_google;
begin
  if p_user is null or p_workspace is null then raise exception '401:Sign in to Onixus Workspace.'; end if;
  select role into r from public.crm_memberships where workspace_id = p_workspace and user_id = p_user;
  if r is null then raise exception '404:Workspace not found.'; end if;
  if r <> 'owner' then raise exception '403:Only the business owner can open this mailbox.'; end if;
  select * into g from crm_private.mail_google
   where workspace_id = p_workspace and status = 'active'
     and (p_mailbox is null or mailbox = lower(btrim(p_mailbox)))
   order by connected_at limit 1;
  if g.account_id is null then raise exception '409:Connect Gmail first, then open Mail.'; end if;
  return jsonb_build_object('account_id', g.account_id, 'mailbox', g.mailbox, 'sender_name', g.sender_name,
    'mailboxes', (select coalesce(jsonb_agg(x.mailbox order by x.connected_at), '[]'::jsonb) from crm_private.mail_google x where x.workspace_id = p_workspace and x.status = 'active'),
    'refresh_token', (select decrypted_secret from vault.decrypted_secrets where id = g.refresh_secret));
end $$;

revoke all on function public.mail_live_access(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.mail_live_access(uuid, uuid, text) to service_role;
