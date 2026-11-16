-- Private, immutable identity binding for verified Onixus client handoffs.
-- An email match alone must never grant access to an existing Workspace user.
create table if not exists public.onixus_workspace_identities (
  onixus_user_id uuid primary key,
  workspace_user_id uuid not null unique references auth.users(id) on delete restrict,
  organization_id uuid not null unique references public.organizations(id) on delete restrict,
  crm_workspace_id uuid not null unique references public.crm_workspaces(id) on delete restrict,
  email text not null,
  created_at timestamptz not null default now(),
  last_issued_at timestamptz
);

alter table public.onixus_workspace_identities enable row level security;
revoke all on public.onixus_workspace_identities from anon, authenticated;

-- A handoff is rate limited per verified source user. Service role only.
create or replace function public.onixus_claim_workspace_handoff(p_onixus_user uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare claimed boolean;
begin
  update public.onixus_workspace_identities
     set last_issued_at = now()
   where onixus_user_id = p_onixus_user
     and (last_issued_at is null or last_issued_at < now() - interval '60 seconds')
  returning true into claimed;
  return coalesce(claimed, false);
end;
$$;
revoke all on function public.onixus_claim_workspace_handoff(uuid) from public, anon, authenticated;
grant execute on function public.onixus_claim_workspace_handoff(uuid) to service_role;
