-- Applies to the Zee Supabase project (dpcqgnpoznisqkwkkzhx), not to Workspace.
-- Lets the workspace-zee function match a verified Workspace email to a confirmed
-- Zee login and its admin role. Only the service role may call it.
create or replace function public.workspace_zee_identity(p_email text)
returns table(user_id uuid, is_admin boolean)
language sql stable security definer set search_path = public, auth as $$
  select u.id, exists(select 1 from public.user_roles r where r.user_id = u.id and r.role = 'admin')
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
    and u.email_confirmed_at is not null
    and coalesce(u.is_anonymous, false) = false
    and (u.banned_until is null or u.banned_until <= now())
  limit 1
$$;
revoke all on function public.workspace_zee_identity(text) from public, anon, authenticated;
grant execute on function public.workspace_zee_identity(text) to service_role;
