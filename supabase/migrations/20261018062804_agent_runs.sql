-- Bounded coding jobs: durable queue, owner-scoped receipts, atomic credit reservations.
begin;
create table public.agent_runs (
 id uuid primary key,
 organization_id uuid not null references public.organizations(id),
 user_id uuid not null references auth.users(id),
 status text not null default 'queued' check(status in('queued','running','completed','failed','cancelled','interrupted')),
 stage text not null default 'queued',
 payload jsonb not null check(octet_length(payload::text)<=2500000),
 state jsonb not null default '{}',
 credits_reserved integer not null check(credits_reserved between 1000 and 20000),
 credits_used integer not null default 0 check(credits_used>=0),
 cancel_requested boolean not null default false,
 worker_id uuid,
 lease_until timestamptz,
 error text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index agent_runs_queue on public.agent_runs(status,created_at);
create index agent_runs_owner on public.agent_runs(user_id,created_at desc);
alter table public.agent_runs enable row level security;
revoke all on public.agent_runs from anon,authenticated;
grant select on public.agent_runs to authenticated;
create policy agent_runs_own on public.agent_runs for select to authenticated using(user_id=(select auth.uid()) and organization_id=coalesce(auth.jwt()->'app_metadata'->>'org_id',auth.jwt()->'app_metadata'->>'organization_id')::uuid);
grant all on public.agent_runs to service_role;

create function public.reserve_agent_run(p_id uuid,p_org uuid,p_user uuid,p_payload jsonb,p_budget integer)
returns public.agent_runs language plpgsql security invoker set search_path='' as $$
declare r public.agent_runs; balance integer;
begin
 select credits_remaining into balance from public.credit_wallets where organization_id=p_org for update;
 if not found then raise exception 'Wallet not found'; end if;
 select * into r from public.agent_runs where id=p_id;
 if found then
  if r.organization_id<>p_org or r.user_id<>p_user or r.payload<>p_payload or r.credits_reserved<>p_budget then raise exception 'Operation ID conflict'; end if;
  return r;
 end if;
 if p_budget is null or p_budget<1000 or p_budget>20000 then raise exception 'Invalid task budget'; end if;
 if balance<p_budget then raise exception 'Insufficient credits'; end if;
 if (select count(*) from public.agent_runs where organization_id=p_org and status in('queued','running'))>=2 then raise exception 'Two tasks are already active'; end if;
 insert into public.agent_runs(id,organization_id,user_id,payload,credits_reserved) values(p_id,p_org,p_user,p_payload,p_budget) returning * into r;
 update public.credit_wallets set credits_remaining=credits_remaining-p_budget,updated_at=now() where organization_id=p_org;
 insert into public.credit_transactions(organization_id,amount,description) values(p_org,-p_budget,'Coding task reservation: '||p_id);
 return r;
end $$;

create function public.claim_agent_run(p_worker uuid)
returns setof public.agent_runs language plpgsql security invoker set search_path='' as $$
begin
 -- Do not silently repeat a provider call after a worker disappears.
 update public.agent_runs set status='interrupted',error='Worker interrupted. Credits remain reserved pending usage reconciliation.',updated_at=now()
 where status='running' and lease_until<now();
 return query update public.agent_runs set status='running',worker_id=p_worker,lease_until=now()+interval '5 minutes',updated_at=now()
 where id=(select id from public.agent_runs where status='queued' order by created_at for update skip locked limit 1) returning *;
end $$;

create function public.finish_agent_run(p_id uuid,p_worker uuid,p_used integer,p_state jsonb,p_success boolean,p_error text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.agent_runs; refund integer;
begin
 select * into r from public.agent_runs where id=p_id and worker_id=p_worker and status='running' for update;
 if not found then return false; end if;
 if p_used<r.credits_used or p_used>r.credits_reserved then raise exception 'Invalid usage settlement'; end if;
 refund:=r.credits_reserved-p_used;
 update public.agent_runs set status=case when cancel_requested then 'cancelled' when p_success then 'completed' else 'failed' end,
 stage='finished',credits_used=p_used,state=p_state,error=left(p_error,500),payload=payload-'screenshot',lease_until=null,updated_at=now() where id=p_id;
 update public.credit_wallets set credits_remaining=credits_remaining+refund,updated_at=now() where organization_id=r.organization_id;
 if refund>0 then insert into public.credit_transactions(organization_id,amount,description) values(r.organization_id,refund,'Unused coding task reservation: '||p_id); end if;
 return true;
end $$;
-- One bounded sandbox verification per task; no general browser write grants.
alter table public.agent_runs add column verification_claimed_at timestamptz;
create schema if not exists veltra_private;
create function veltra_private.claim_agent_verification(p_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then return false; end if;
 update public.agent_runs set verification_claimed_at=now()
 where id=p_id and user_id=(select auth.uid()) and status='completed' and verification_claimed_at is null
 and organization_id=coalesce(auth.jwt()->'app_metadata'->>'org_id',auth.jwt()->'app_metadata'->>'organization_id')::uuid;
 return found;
end $$;
revoke all on function veltra_private.claim_agent_verification(uuid) from public,anon;
grant usage on schema veltra_private to authenticated;
grant execute on function veltra_private.claim_agent_verification(uuid) to authenticated;
create function public.claim_agent_verification(p_id uuid) returns boolean language sql security invoker set search_path='' as $$
 select veltra_private.claim_agent_verification(p_id)
$$;
revoke all on function public.claim_agent_verification(uuid) from public,anon;
grant execute on function public.claim_agent_verification(uuid) to authenticated;

revoke all on function public.reserve_agent_run(uuid,uuid,uuid,jsonb,integer) from public,anon,authenticated;
revoke all on function public.claim_agent_run(uuid) from public,anon,authenticated;
revoke all on function public.finish_agent_run(uuid,uuid,integer,jsonb,boolean,text) from public,anon,authenticated;
grant execute on function public.reserve_agent_run(uuid,uuid,uuid,jsonb,integer),public.claim_agent_run(uuid),public.finish_agent_run(uuid,uuid,integer,jsonb,boolean,text) to service_role;
commit;
