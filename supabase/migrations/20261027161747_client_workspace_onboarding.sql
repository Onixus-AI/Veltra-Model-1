-- Client-owned onboarding. A request grants no CRM access until the verified recipient accepts.
create schema if not exists crm_private;
create table crm_private.client_invitations (
 id uuid primary key default gen_random_uuid(),
 inviter uuid not null references auth.users(id),
 email text not null check(email=lower(trim(email)) and length(email)<=254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 business_name text not null check(length(trim(business_name)) between 1 and 120),
 industry text not null check(length(trim(industry)) between 1 and 120),
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '7 days',
 revoked_at timestamptz, accepted_at timestamptz, accepted_by uuid references auth.users(id),
 workspace_id uuid references public.crm_workspaces(id)
);
create unique index client_invitation_pending on crm_private.client_invitations(inviter,email) where accepted_at is null and revoked_at is null;
create index client_invitation_recipient on crm_private.client_invitations(email);
alter table crm_private.client_invitations enable row level security;
revoke all on crm_private.client_invitations from public,anon,authenticated;

-- Only database-verified identity; never user_metadata or caller-supplied email claims.
create or replace function crm_private.onboarding_email() returns text language plpgsql stable security definer set search_path='' as $$
declare e text; begin
 select lower(trim(email)) into e from auth.users where id=auth.uid() and email_confirmed_at is not null and not coalesce(is_anonymous,false);
 if e is null then raise exception 'Verify your Workspace email before continuing.' using errcode='42501'; end if;
 return e;
end $$;
revoke all on function crm_private.onboarding_email() from public,anon,authenticated;

create or replace function public.crm_client_invite(p_email text,p_name text,p_industry text) returns uuid language plpgsql security invoker set search_path='' as $$
 begin return crm_private.client_invite(p_email,p_name,p_industry); end $$;
create or replace function crm_private.client_invite(p_email text,p_name text,p_industry text) returns uuid language plpgsql security definer set search_path='' as $$
declare i uuid; begin
 perform crm_private.onboarding_email();
 if not exists(select 1 from public.crm_workspaces where owner_id=auth.uid()) then raise exception 'Only a workspace owner can invite a client.' using errcode='42501'; end if;
 p_email:=lower(trim(p_email)); p_name:=trim(p_name); p_industry:=trim(p_industry);
 if p_email=crm_private.onboarding_email() then raise exception 'Use the client’s email, not your own.'; end if;
 if p_email is null or p_name is null or p_industry is null then raise exception 'Enter a client email, business name and industry.'; end if;
 -- Repeating a pending request reuses its ID; expired requests are renewed, accepted requests are retained.
 insert into crm_private.client_invitations(inviter,email,business_name,industry) values(auth.uid(),p_email,p_name,p_industry)
 on conflict(inviter,email) where accepted_at is null and revoked_at is null do update set
 business_name=excluded.business_name,industry=excluded.industry,expires_at=now()+interval '7 days' returning id into i;
 return i;
end $$;

create or replace function crm_private.client_invitations_list() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e text:=crm_private.onboarding_email(); begin
 return coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'business_name',i.business_name,'industry',i.industry,
 'expires_at',i.expires_at,'revoked_at',i.revoked_at,'accepted_at',i.accepted_at,'workspace_id',i.workspace_id,
 'incoming',i.email=e,'inviter_email',u.email) order by i.created_at desc)
 from crm_private.client_invitations i join auth.users u on u.id=i.inviter where i.inviter=auth.uid() or i.email=e),'[]'::jsonb);
end $$;
create or replace function public.crm_client_invitations() returns jsonb language sql security invoker set search_path='' as $$ select crm_private.client_invitations_list() $$;

create or replace function crm_private.client_invitation_accept(p_invitation uuid,p_workspace uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare i crm_private.client_invitations; w uuid; e text:=crm_private.onboarding_email(); begin
 select * into i from crm_private.client_invitations where id=p_invitation for update;
 if i.id is null or i.email<>e then raise exception 'Invitation not available for this verified email.' using errcode='42501'; end if;
 if i.revoked_at is not null then raise exception 'This invitation was revoked.'; end if;
 if i.accepted_at is not null then
  if i.accepted_by<>auth.uid() then raise exception 'Invitation already accepted.' using errcode='42501'; end if;
  return i.workspace_id;
 end if;
 if i.expires_at<=now() then raise exception 'This invitation expired. Ask your agency for a new invitation.'; end if;
 if p_workspace is not null then
  perform 1 from public.crm_workspaces where id=p_workspace and owner_id=auth.uid() for update;
  if not found then raise exception 'Choose a workspace you own.' using errcode='42501'; end if;
  w:=p_workspace;
 else
  -- Reuse the existing creation contract so its industry/default setup is preserved.
  w:=public.crm_create_workspace(i.business_name,i.industry);
  if not exists(select 1 from public.crm_workspaces where id=w and owner_id=auth.uid()) then raise exception 'Client workspace creation could not be confirmed.'; end if;
 end if;
 insert into public.crm_memberships(workspace_id,user_id,role) values(w,auth.uid(),'owner') on conflict(workspace_id,user_id) do update set role='owner';
 -- Agency receives editing access, never ownership or authority to link the client’s mailbox.
 insert into public.crm_memberships(workspace_id,user_id,role) values(w,i.inviter,'member') on conflict(workspace_id,user_id) do nothing;
 update crm_private.client_invitations set accepted_at=now(),accepted_by=auth.uid(),workspace_id=w where id=i.id;
 return w;
end $$;
create or replace function public.crm_client_invitation_accept(p_invitation uuid,p_workspace uuid default null) returns uuid language sql security invoker set search_path='' as $$ select crm_private.client_invitation_accept(p_invitation,p_workspace) $$;
create or replace function crm_private.client_invitation_revoke(p_invitation uuid) returns void language plpgsql security definer set search_path='' as $$ begin
 perform crm_private.onboarding_email();
 update crm_private.client_invitations set revoked_at=now() where id=p_invitation and inviter=auth.uid() and accepted_at is null;
 if not found then raise exception 'Pending invitation not found.' using errcode='42501'; end if;
end $$;
create or replace function public.crm_client_invitation_revoke(p_invitation uuid) returns void language sql security invoker set search_path='' as $$ select crm_private.client_invitation_revoke(p_invitation) $$;

-- A verified Signal receipt is written only by the server after consuming a Signal code.
create table public.crm_signal_connections (
 workspace_id uuid primary key references public.crm_workspaces(id),
 signal_client_id uuid not null unique, signal_organization_id uuid,
 business_name text not null, connected_by uuid not null references auth.users(id), connected_at timestamptz not null default now()
);
alter table public.crm_signal_connections enable row level security;
revoke all on public.crm_signal_connections from public,anon,authenticated;
grant select on public.crm_signal_connections to authenticated;
grant select,insert,delete on public.crm_signal_connections to service_role;
create policy signal_connection_read on public.crm_signal_connections for select to authenticated using(
 exists(select 1 from public.crm_memberships m where m.workspace_id=crm_signal_connections.workspace_id and m.user_id=auth.uid()));

-- Definers are private, fixed search_path, explicit identity checks and narrow execution grants.
revoke all on function crm_private.client_invite(text,text,text),crm_private.client_invitations_list(),crm_private.client_invitation_accept(uuid,uuid),crm_private.client_invitation_revoke(uuid) from public,anon;
grant usage on schema crm_private to authenticated;
grant execute on function crm_private.client_invite(text,text,text),crm_private.client_invitations_list(),crm_private.client_invitation_accept(uuid,uuid),crm_private.client_invitation_revoke(uuid) to authenticated;
revoke all on function public.crm_client_invite(text,text,text),public.crm_client_invitations(),public.crm_client_invitation_accept(uuid,uuid),public.crm_client_invitation_revoke(uuid) from public,anon;
grant execute on function public.crm_client_invite(text,text,text),public.crm_client_invitations(),public.crm_client_invitation_accept(uuid,uuid),public.crm_client_invitation_revoke(uuid) to authenticated;

create or replace function crm_private.client_access(p_workspace uuid,p_remove uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform crm_private.onboarding_email();
 perform 1 from public.crm_workspaces where id=p_workspace and owner_id=auth.uid() for update;
 if not found then raise exception 'Only the workspace owner can manage access.' using errcode='42501'; end if;
 if p_remove is not null then
  delete from public.crm_memberships where workspace_id=p_workspace and user_id=p_remove and user_id<>auth.uid() and role<>'owner';
  if not found then raise exception 'Only non-owner members can be removed.'; end if;
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email,'role',m.role)) from public.crm_memberships m join auth.users u on u.id=m.user_id where m.workspace_id=p_workspace),'[]'::jsonb);
end $$;
create or replace function public.crm_client_access(p_workspace uuid,p_remove uuid default null) returns jsonb language sql security invoker set search_path='' as $$ select crm_private.client_access(p_workspace,p_remove) $$;
revoke all on function crm_private.client_access(uuid,uuid),public.crm_client_access(uuid,uuid) from public,anon;
grant execute on function crm_private.client_access(uuid,uuid),public.crm_client_access(uuid,uuid) to authenticated;

-- Server-only atomic ownership check + receipt write. A private provider receipt is not a general write API.
create or replace function crm_private.confirm_signal_connection(p_user uuid,p_workspace uuid,p_client uuid,p_organization uuid,p_name text,p_email text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.crm_signal_connections; begin
 perform 1 from public.crm_workspaces where id=p_workspace and owner_id=p_user for update;
 if not found or not exists(select 1 from auth.users where id=p_user and lower(trim(email))=p_email and email_confirmed_at is not null and not coalesce(is_anonymous,false)) then raise exception 'Workspace ownership or verified email changed.' using errcode='42501'; end if;
 insert into public.crm_signal_connections(workspace_id,signal_client_id,signal_organization_id,business_name,connected_by)
 values(p_workspace,p_client,p_organization,p_name,p_user) returning * into c;
 return jsonb_build_object('business_name',c.business_name,'signal_client_id',c.signal_client_id,'connected_at',c.connected_at);
end $$;
create or replace function public.crm_confirm_signal_connection(p_user uuid,p_workspace uuid,p_client uuid,p_organization uuid,p_name text,p_email text) returns jsonb language sql security invoker set search_path='' as $$ select crm_private.confirm_signal_connection(p_user,p_workspace,p_client,p_organization,p_name,p_email) $$;
revoke all on function crm_private.confirm_signal_connection(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant usage on schema crm_private to service_role;
grant execute on function crm_private.confirm_signal_connection(uuid,uuid,uuid,uuid,text,text) to service_role;
revoke all on function public.crm_confirm_signal_connection(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.crm_confirm_signal_connection(uuid,uuid,uuid,uuid,text,text) to service_role;
