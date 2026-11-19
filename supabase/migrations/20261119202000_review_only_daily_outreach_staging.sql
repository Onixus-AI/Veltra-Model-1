-- One disabled-by-default staging schedule per production workspace. It only
-- creates draft messages; revenue_stage_top_prospect never approves or sends.
create table if not exists revenue_private.outreach_staging_settings (
 workspace_id uuid primary key references public.crm_workspaces(id) on delete cascade,
 enabled boolean not null default false,
 daily_limit integer not null default 5 check (daily_limit between 1 and 5),
 last_run_date date,
 last_run_at timestamptz,
 last_result jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now()
);
revoke all on revenue_private.outreach_staging_settings from public,anon,authenticated;
insert into revenue_private.outreach_staging_settings(workspace_id)
select id from public.crm_workspaces where environment='production' and name not like '[TEST ONLY]%'
on conflict do nothing;

create or replace function revenue_private.seed_outreach_staging()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.environment='production' and new.name not like '[TEST ONLY]%' then
  insert into revenue_private.outreach_staging_settings(workspace_id) values(new.id) on conflict do nothing;
 end if;
 return new;
end $$;
drop trigger if exists revenue_seed_outreach_staging on public.crm_workspaces;
create trigger revenue_seed_outreach_staging after insert on public.crm_workspaces
for each row execute function revenue_private.seed_outreach_staging();

create or replace function public.revenue_outreach_staging_status(p_workspace uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s revenue_private.outreach_staging_settings;
begin
 perform revenue_private.require_role(p_workspace,'member');
 select * into s from revenue_private.outreach_staging_settings where workspace_id=p_workspace;
 if s.workspace_id is null then return jsonb_build_object('enabled',false,'available',false,'reason','Only production workspaces can schedule outreach drafts.'); end if;
 return jsonb_build_object('enabled',s.enabled,'available',true,'daily_limit',s.daily_limit,
  'last_run_date',s.last_run_date,'last_run_at',s.last_run_at,'last_result',s.last_result);
end $$;
revoke all on function public.revenue_outreach_staging_status(uuid) from public,anon;
grant execute on function public.revenue_outreach_staging_status(uuid) to authenticated;

create or replace function public.revenue_outreach_staging_set(p_workspace uuid,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s revenue_private.outreach_staging_settings;
begin
 perform revenue_private.require_role(p_workspace,'owner');
 if p_enabled is null then raise exception '400:Choose on or off.'; end if;
 update revenue_private.outreach_staging_settings
 set enabled=p_enabled,updated_at=now() where workspace_id=p_workspace returning * into s;
 if s.workspace_id is null then raise exception '409:Review-only outreach staging is unavailable for this workspace.'; end if;
 return jsonb_build_object('enabled',s.enabled,'daily_limit',s.daily_limit,'last_run_at',s.last_run_at);
end $$;
revoke all on function public.revenue_outreach_staging_set(uuid,boolean) from public,anon;
grant execute on function public.revenue_outreach_staging_set(uuid,boolean) to authenticated;

create or replace function revenue_private.run_daily_outreach_staging()
returns jsonb language plpgsql security definer set search_path='' as $$
declare s revenue_private.outreach_staging_settings; actor uuid; result jsonb; made integer; details jsonb;
 local_day date := (now() at time zone 'America/New_York')::date;
begin
 if (now() at time zone 'America/New_York')::time < time '09:00' then
  return jsonb_build_object('status','before_window');
 end if;
 for s in select x.* from revenue_private.outreach_staging_settings x
   join public.crm_workspaces w on w.id=x.workspace_id
   where x.enabled and x.last_run_date is distinct from local_day
     and w.environment='production' and w.name not like '[TEST ONLY]%' for update of x skip locked loop
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('outreach-staging:'||s.workspace_id::text,0));
  select user_id into actor from public.crm_memberships
    where workspace_id=s.workspace_id and role='owner' order by user_id limit 1;
  made:=0;details:='[]'::jsonb;
  if actor is null then
   details:=jsonb_build_array(jsonb_build_object('status','blocked','reason','No workspace owner.'));
  else
   perform pg_catalog.set_config('request.jwt.claim.sub',actor::text,true);
   for i in 1..s.daily_limit loop
    begin
     result:=public.revenue_stage_top_prospect(s.workspace_id);
     details:=details||jsonb_build_array(result);
     if result->>'status'='drafted' then made:=made+1; else exit; end if;
    exception when others then
     details:=details||jsonb_build_array(jsonb_build_object('status','failed','reason',left(sqlerrm,300)));
     exit;
    end;
   end loop;
   perform pg_catalog.set_config('request.jwt.claim.sub','',true);
  end if;
  update revenue_private.outreach_staging_settings set last_run_date=local_day,last_run_at=now(),
   last_result=jsonb_build_object('drafted',made,'items',details),updated_at=now()
   where workspace_id=s.workspace_id;
 end loop;
 return jsonb_build_object('status','checked','local_date',local_day);
end $$;
revoke all on function revenue_private.run_daily_outreach_staging() from public,anon,authenticated;

do $$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.schedule('revenue-review-only-outreach-staging','7 * * * *',
   'select revenue_private.run_daily_outreach_staging();');
 end if;
end $$;
