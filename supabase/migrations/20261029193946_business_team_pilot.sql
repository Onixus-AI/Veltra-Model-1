begin;
create table public.workspace_team_jobs (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.crm_workspaces(id) on delete cascade,
 requested_by uuid not null, request_key uuid not null, scope text not null default 'internal_daily_plan' check(scope='internal_daily_plan'),
 status text not null default 'running' check(status in ('running','completed','failed')),
 plan jsonb, receipts jsonb not null default '[]', failure text, created_at timestamptz not null default now(), finished_at timestamptz,
 unique(workspace_id,requested_by,request_key)
);
alter table public.workspace_team_jobs enable row level security;
revoke all on public.workspace_team_jobs from public,anon,authenticated;
grant select on public.workspace_team_jobs to authenticated;
grant select,insert,update on public.workspace_team_jobs to service_role;
create policy team_jobs_members on public.workspace_team_jobs for select to authenticated using(exists(select 1 from public.crm_memberships m where m.workspace_id=workspace_team_jobs.workspace_id and m.user_id=(select auth.uid())));
create index team_jobs_recent on public.workspace_team_jobs(workspace_id,created_at desc);
create or replace function public.workspace_team_start(p_workspace uuid,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); j public.workspace_team_jobs;
begin
 if uid is null or not exists(select 1 from public.crm_memberships where workspace_id=p_workspace and user_id=uid and role='owner') then raise exception 'Business owner required';end if;
 if p_request is null then raise exception 'Request key required';end if;
 perform pg_advisory_xact_lock(hashtextextended('team:'||p_workspace::text,0));
 select * into j from public.workspace_team_jobs where workspace_id=p_workspace and requested_by=uid and request_key=p_request;
 if found then return to_jsonb(j)||jsonb_build_object('replayed',true);end if;
 -- An abandoned HTTP run never becomes a silently successful receipt.
 update public.workspace_team_jobs set status='failed',failure='Worker timed out. Review before retrying.',finished_at=now() where workspace_id=p_workspace and status='running' and created_at<now()-interval '2 minutes';
 if exists(select 1 from public.workspace_team_jobs where workspace_id=p_workspace and status='running') then raise exception 'A planning job is already running';end if;
 if (select count(*) from public.workspace_team_jobs where workspace_id=p_workspace and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=3 then raise exception 'Daily pilot limit reached';end if;
 insert into public.workspace_team_jobs(workspace_id,requested_by,request_key) values(p_workspace,uid,p_request) returning * into j;
 return to_jsonb(j)||jsonb_build_object('replayed',false);
end $$;
revoke all on function public.workspace_team_start(uuid,uuid) from public,anon;
grant execute on function public.workspace_team_start(uuid,uuid) to authenticated;
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.workspace_team_jobs;end if;
end $$;
commit;
