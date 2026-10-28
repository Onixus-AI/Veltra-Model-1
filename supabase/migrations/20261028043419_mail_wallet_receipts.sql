-- Service-only reservations: ordinary app roles cannot select a payer or mutate credits.
create table public.mail_credit_requests(
 id uuid primary key,account_id uuid not null,workspace_id uuid not null references public.crm_workspaces(id),
 organization_id uuid not null references public.organizations(id),request_digest text not null,
 status text not null check(status in ('reserved','succeeded','failed')),
 credits_reserved integer not null check(credits_reserved between 1 and 120000),credits_used integer,
 response jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.mail_credit_requests enable row level security;
revoke all on public.mail_credit_requests from public,anon,authenticated;
grant select,insert,update on public.mail_credit_requests to service_role;
create index mail_credit_requests_org on public.mail_credit_requests(organization_id,created_at);

create function public.reserve_mail_credits(p_id uuid,p_account uuid,p_workspace uuid,p_org uuid,p_digest text,p_budget integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.mail_credit_requests; begin
 if p_budget not between 1 and 120000 then raise exception 'Invalid Mail budget'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,0));
 select * into r from public.mail_credit_requests where id=p_id;
 if found then
  if r.account_id<>p_account or r.workspace_id<>p_workspace or r.organization_id<>p_org or r.request_digest<>p_digest then raise exception 'Mail receipt identity mismatch'; end if;
  return jsonb_build_object('status',case when r.status='reserved' then 'claimed' else r.status end,'response',r.response);
 end if;
 update public.credit_wallets set credits_remaining=credits_remaining-p_budget,updated_at=now() where organization_id=p_org and credits_remaining>=p_budget;
 if not found then return jsonb_build_object('status','insufficient'); end if;
 insert into public.mail_credit_requests(id,account_id,workspace_id,organization_id,request_digest,status,credits_reserved) values(p_id,p_account,p_workspace,p_org,p_digest,'reserved',p_budget);
 return jsonb_build_object('status','reserved');
end $$;
create function public.finish_mail_credits(p_id uuid,p_tokens integer,p_model text,p_response jsonb,p_status text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.mail_credit_requests; begin
 select * into r from public.mail_credit_requests where id=p_id for update;
 if not found then return false; end if;
 if r.status<>'reserved' then return r.status=p_status and r.credits_used=p_tokens; end if;
 if p_status not in ('succeeded','failed') or p_tokens not between 0 and r.credits_reserved or (p_status='failed' and p_tokens<>0) or (p_status='succeeded' and p_response is null) then raise exception 'Invalid Mail settlement'; end if;
 update public.credit_wallets set credits_remaining=credits_remaining+r.credits_reserved-p_tokens,updated_at=now() where organization_id=r.organization_id;
 if p_status='succeeded' then
 insert into public.usage_logs(organization_id,category,model_used,tokens_consumed,credits_deducted) values(r.organization_id,'workspace.mail',p_model,p_tokens,p_tokens);
 insert into public.credit_transactions(organization_id,amount,description) values(r.organization_id,-p_tokens,'Mail AI usage · receipt '||p_id::text);
 end if;
 update public.mail_credit_requests set status=p_status,credits_used=p_tokens,response=p_response,updated_at=now() where id=p_id;
 return true;
end $$;
revoke all on function public.reserve_mail_credits(uuid,uuid,uuid,uuid,text,integer) from public,anon,authenticated;
revoke all on function public.finish_mail_credits(uuid,integer,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.reserve_mail_credits(uuid,uuid,uuid,uuid,text,integer) to service_role;
grant execute on function public.finish_mail_credits(uuid,integer,text,jsonb,text) to service_role;
