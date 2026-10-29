begin;
create table public.workspace_team_schedule(
 workspace_id uuid primary key references public.crm_workspaces(id) on delete cascade,
 enabled boolean not null default false, authorized_by uuid not null, updated_at timestamptz not null default now(), last_day date
);
alter table public.workspace_team_schedule enable row level security;
revoke all on public.workspace_team_schedule from public,anon,authenticated;
grant select on public.workspace_team_schedule to authenticated,service_role;
create policy team_schedule_members on public.workspace_team_schedule for select to authenticated using(exists(select 1 from public.crm_memberships m where m.workspace_id=workspace_team_schedule.workspace_id and m.user_id=(select auth.uid())));
create function public.workspace_team_schedule_set(p_workspace uuid,p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.crm_memberships where workspace_id=p_workspace and user_id=auth.uid() and role='owner') then raise exception 'Business owner required';end if;
 insert into public.workspace_team_schedule(workspace_id,enabled,authorized_by) values(p_workspace,p_enabled,auth.uid()) on conflict(workspace_id) do update set enabled=excluded.enabled,authorized_by=excluded.authorized_by,updated_at=now();
end $$;
revoke all on function public.workspace_team_schedule_set(uuid,boolean) from public,anon;
grant execute on function public.workspace_team_schedule_set(uuid,boolean) to authenticated;
create function public.workspace_team_daily_start(p_workspace uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.workspace_team_schedule; j public.workspace_team_jobs; today date:=(now() at time zone 'UTC')::date;
begin
 perform pg_advisory_xact_lock(hashtextextended('team:'||p_workspace::text,0));
 select * into cfg from public.workspace_team_schedule where workspace_id=p_workspace for update;
 if not found or not cfg.enabled or cfg.last_day=today then return null;end if;
 if not exists(select 1 from public.crm_memberships where workspace_id=p_workspace and user_id=cfg.authorized_by and role='owner') then update public.workspace_team_schedule set enabled=false where workspace_id=p_workspace;return null;end if;
 update public.workspace_team_jobs set status='failed',failure='Worker timed out; inspect before retrying.',finished_at=now() where workspace_id=p_workspace and status='running' and created_at<now()-interval '2 minutes';
 if exists(select 1 from public.workspace_team_jobs where workspace_id=p_workspace and status='running') then return null;end if;
 if (select count(*) from public.workspace_team_jobs where workspace_id=p_workspace and created_at>=today::timestamp at time zone 'UTC')>=3 then update public.workspace_team_schedule set last_day=today where workspace_id=p_workspace;return null;end if;
 update public.workspace_team_schedule set last_day=today where workspace_id=p_workspace;
 insert into public.workspace_team_jobs(workspace_id,requested_by,request_key) values(p_workspace,cfg.authorized_by,gen_random_uuid()) returning * into j;
 return to_jsonb(j);
end $$;
revoke all on function public.workspace_team_daily_start(uuid) from public,anon,authenticated;
grant execute on function public.workspace_team_daily_start(uuid) to service_role;
commit;
