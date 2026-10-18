alter table public.crm_discovery_requests add column results jsonb not null default '[]' check(jsonb_typeof(results)='array' and jsonb_array_length(results)<=50);
alter table public.crm_discovery_requests add column last_error text;
alter table public.crm_discovery_requests add column started_at timestamptz;
-- Serializes the per-owner daily limit across workspaces and concurrent server instances.
create function public.crm_claim_discovery(p_request uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare w uuid;n integer;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('discovery:'||auth.uid()::text,0));
 select r.workspace_id into w from public.crm_discovery_requests r join public.crm_workspaces s on s.id=r.workspace_id where r.id=p_request and s.owner_id=auth.uid() and r.status='requested';
 if w is null then return false; end if;
 select count(*) into n from public.crm_discovery_requests r join public.crm_workspaces s on s.id=r.workspace_id where s.owner_id=auth.uid() and r.started_at>=current_date;
 if n>=5 then return false; end if;
 update public.crm_discovery_requests set status='running',started_at=now() where id=p_request and status='requested';
 return found;
end $$;
revoke all on function public.crm_claim_discovery(uuid) from public,anon;
grant execute on function public.crm_claim_discovery(uuid) to authenticated;

create function public.crm_finish_discovery(p_request uuid,p_success boolean,p_results jsonb,p_error text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.crm_discovery_requests r join public.crm_workspaces s on s.id=r.workspace_id where r.id=p_request and s.owner_id=auth.uid() and r.status='running') then raise exception 'Only the owner can finish running research'; end if;
 if jsonb_typeof(p_results)<>'array' or jsonb_array_length(p_results)>50 or pg_catalog.pg_column_size(p_results)>150000 then raise exception 'Invalid research results'; end if;
 update public.crm_discovery_requests set status=case when p_success then 'review' else 'failed' end,results=p_results,last_error=left(p_error,500) where id=p_request and status='running';
end $$;
revoke all on function public.crm_finish_discovery(uuid,boolean,jsonb,text) from public,anon;
grant execute on function public.crm_finish_discovery(uuid,boolean,jsonb,text) to authenticated;
