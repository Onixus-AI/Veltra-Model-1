alter table public.credit_wallets
    drop constraint if exists credit_wallets_credits_remaining_check;

update public.credit_wallets as wallet
set credits_remaining = least(
    10000,
    coalesce((
        select sum(lot.credits_remaining)::integer
        from public.credit_lots as lot
        where lot.organization_id = wallet.organization_id
          and lot.expires_at > now()
          and lot.credits_remaining > 0
    ), 0)
);

alter table public.credit_wallets
    add constraint credit_wallets_credits_remaining_check
    check (credits_remaining >= 0 and credits_remaining <= 10000);

drop function if exists public.deduct_credits_fifo(uuid, integer);
drop table public.credit_lots;

create or replace function public.create_organization_credit_wallet()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.credit_wallets (organization_id)
    values (new.id);
    return new;
end;
$$;

create function public.deduct_credits_simple(
    p_organization_id uuid,
    p_credits integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    available_credits integer;
begin
    if p_credits is null or p_credits < 0 then
        raise exception 'Credit deduction must be a non-negative integer';
    end if;

    if p_credits = 0 then
        return true;
    end if;

    select credits_remaining
    into available_credits
    from public.credit_wallets
    where organization_id = p_organization_id
    for update;

    if not found or available_credits < p_credits then
        return false;
    end if;

    update public.credit_wallets
    set credits_remaining = credits_remaining - p_credits,
        updated_at = now()
    where organization_id = p_organization_id;

    insert into public.credit_transactions (organization_id, amount, description)
    values (p_organization_id, -p_credits, 'Model usage');

    return true;
end;
$$;

create function public.rollover_credits_simple(p_organization_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.credit_wallets
    set credits_remaining = least(credits_remaining + 3000, 10000),
        updated_at = now()
    where organization_id = p_organization_id;

    return found;
end;
$$;

revoke all on function public.deduct_credits_simple(uuid, integer)
    from public, anon, authenticated;
grant execute on function public.deduct_credits_simple(uuid, integer)
    to service_role;

revoke all on function public.rollover_credits_simple(uuid)
    from public, anon, authenticated;
grant execute on function public.rollover_credits_simple(uuid)
    to service_role;
