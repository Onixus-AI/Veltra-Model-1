create extension if not exists pgcrypto;

create table public.organizations (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    slug text not null unique,
    created_at timestamptz not null default now()
);

create table public.api_keys (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    name text not null,
    key_prefix text not null,
    key_hash text not null unique,
    created_at timestamptz not null default now(),
    last_used_at timestamptz,
    revoked_at timestamptz
);

create index api_keys_organization_id_idx on public.api_keys(organization_id);

create table public.credit_wallets (
    organization_id uuid primary key references public.organizations(id) on delete cascade,
    plan_name text not null default 'Veltra $59/month',
    monthly_price_cents integer not null default 5900 check (monthly_price_cents >= 0),
    monthly_credit_allowance integer not null default 3000 check (monthly_credit_allowance >= 0),
    credits_remaining integer not null default 3000 check (
        credits_remaining >= 0 and credits_remaining <= monthly_credit_allowance
    ),
    billing_period_start timestamptz not null default now(),
    billing_period_end timestamptz not null default (now() + interval '1 month'),
    updated_at timestamptz not null default now(),
    check (billing_period_end > billing_period_start)
);

create table public.credit_transactions (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    amount integer not null check (amount <> 0),
    description text not null,
    created_at timestamptz not null default now()
);

create index credit_transactions_organization_id_created_at_idx
    on public.credit_transactions(organization_id, created_at desc);

create function public.create_organization_credit_wallet()
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

create trigger organizations_create_credit_wallet
after insert on public.organizations
for each row execute function public.create_organization_credit_wallet();

alter table public.organizations enable row level security;
alter table public.api_keys enable row level security;
alter table public.credit_wallets enable row level security;
alter table public.credit_transactions enable row level security;
