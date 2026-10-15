-- Applied and transaction-tested on live Supabase; server access only.
create table if not exists public.image_requests (
 id uuid primary key, organization_id uuid not null references public.organizations(id),
 status text not null default 'pending' check (status in ('pending','succeeded','failed')),
 credits integer not null default 100 check(credits=100),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.image_requests enable row level security;
revoke all on public.image_requests from public,anon,authenticated;
grant select,insert,update on public.image_requests to service_role;

create or replace function public.reserve_image_credits(p_id uuid,p_org_id uuid)
returns integer language plpgsql security invoker set search_path='' as $$
begin
 update public.credit_wallets set credits_remaining=credits_remaining-100,updated_at=now()
 where organization_id=p_org_id and credits_remaining>=100;
 if not found then return -1; end if;
 insert into public.image_requests(id,organization_id) values(p_id,p_org_id);
 return 100;
end; $$;

create or replace function public.finish_image_credits(p_id uuid,p_success boolean)
returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.image_requests%rowtype;
begin
 select * into r from public.image_requests where id=p_id for update;
 if not found then return false; end if;
 if r.status<>'pending' then return r.status=case when p_success then 'succeeded' else 'failed' end; end if;
 if p_success then
  insert into public.usage_logs(organization_id,category,model_used,tokens_consumed,credits_deducted)
  values(r.organization_id,'image','qwen/qwen-image-3',0,r.credits);
  insert into public.credit_transactions(organization_id,amount,description)
  values(r.organization_id,-r.credits,'Image generation');
 else
  update public.credit_wallets set credits_remaining=least(10000,credits_remaining+r.credits),updated_at=now()
  where organization_id=r.organization_id;
 end if;
 update public.image_requests set status=case when p_success then 'succeeded' else 'failed' end,updated_at=now() where id=p_id;
 return true;
end; $$;
revoke all on function public.reserve_image_credits(uuid,uuid) from public,anon,authenticated;
revoke all on function public.finish_image_credits(uuid,boolean) from public,anon,authenticated;
grant execute on function public.reserve_image_credits(uuid,uuid) to service_role;
grant execute on function public.finish_image_credits(uuid,boolean) to service_role;