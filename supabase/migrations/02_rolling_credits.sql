create table public.credit_lots (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    credits_remaining integer not null check (credits_remaining >= 0),
    source text not null default 'monthly_allocation',
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '30 days'),
    check (expires_at > created_at)
);

create index credit_lots_fifo_idx
    on public.credit_lots(organization_id, expires_at, created_at)
    where credits_remaining > 0;

alter table public.credit_wallets
    alter column plan_name set default 'Veltra Business OS';

update public.credit_wallets
set plan_name = 'Veltra Business OS';

insert into public.credit_lots (organization_id, credits_remaining, source)
select organization_id, credits_remaining, 'migration_initial_balance'
from public.credit_wallets
where credits_remaining > 0;

create or replace function public.create_organization_credit_wallet()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    initial_credits integer;
begin
    insert into public.credit_wallets (organization_id)
    values (new.id)
    returning credits_remaining into initial_credits;

    if initial_credits > 0 then
        insert into public.credit_lots (organization_id, credits_remaining, source)
        values (new.id, initial_credits, 'monthly_allocation');
    end if;

    return new;
end;
$$;

alter table public.credit_lots enable row level security;

create function public.deduct_credits_fifo(
    p_organization_id uuid,
    p_credits integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    lot record;
    remaining_to_deduct integer := p_credits;
    lot_deduction integer;
    available_credits integer;
begin
    if p_credits is null or p_credits < 0 then
        raise exception 'Credit deduction must be a non-negative integer';
    end if;
    if p_credits = 0 then
        return true;
    end if;

    perform 1
    from public.credit_wallets
    where organization_id = p_organization_id
    for update;

    if not found then
        return false;
    end if;

    select coalesce(sum(credits_remaining), 0)::integer
    into available_credits
    from public.credit_lots
    where organization_id = p_organization_id
      and expires_at > now()
      and credits_remaining > 0;

    if available_credits < p_credits then
        return false;
    end if;

    for lot in
        select id, credits_remaining
        from public.credit_lots
        where organization_id = p_organization_id
          and expires_at > now()
          and credits_remaining > 0
        order by expires_at, created_at, id
        for update
    loop
        exit when remaining_to_deduct = 0;
        lot_deduction := least(lot.credits_remaining, remaining_to_deduct);
        update public.credit_lots
        set credits_remaining = credits_remaining - lot_deduction
        where id = lot.id;
        remaining_to_deduct := remaining_to_deduct - lot_deduction;
    end loop;

    update public.credit_wallets
    set credits_remaining = available_credits - p_credits,
        updated_at = now()
    where organization_id = p_organization_id;

    insert into public.credit_transactions (organization_id, amount, description)
    values (p_organization_id, -p_credits, 'Model usage');

    return true;
end;
$$;

revoke all on function public.deduct_credits_fifo(uuid, integer) from public, anon, authenticated;
grant execute on function public.deduct_credits_fifo(uuid, integer) to service_role;
