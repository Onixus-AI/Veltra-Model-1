-- Applied to the live database. Aligns with the gateway's five-argument RPC.
-- Wallet updates and both usage records commit together. Run as database owner.
create or replace function public.deduct_credits_simple(
  p_org_id uuid, p_credits_needed integer, p_category varchar,
  p_model varchar, p_tokens integer
) returns integer language plpgsql security invoker set search_path = '' as $$
begin
  if p_credits_needed is null or p_credits_needed < 0 or p_tokens is null or p_tokens < 0 then
    raise exception 'Usage must be non-negative';
  end if;
  if p_credits_needed = 0 then return 0; end if;
  update public.credit_wallets
    set credits_remaining = credits_remaining - p_credits_needed, updated_at = now()
    where organization_id = p_org_id and credits_remaining >= p_credits_needed;
  if not found then return -1; end if;
  insert into public.usage_logs (organization_id,category,model_used,tokens_consumed,credits_deducted)
    values (p_org_id,p_category,p_model,p_tokens,p_credits_needed);
  insert into public.credit_transactions (organization_id,amount,description)
    values (p_org_id,-p_credits_needed,'Model usage');
  return p_credits_needed;
end; $$;
revoke all on function public.deduct_credits_simple(uuid,integer,varchar,varchar,integer) from public,anon,authenticated;
grant execute on function public.deduct_credits_simple(uuid,integer,varchar,varchar,integer) to service_role;
revoke all on function public.deduct_credits_fifo(uuid,integer,varchar,varchar,integer) from public,anon,authenticated;
revoke all on function public.refill_monthly_credits(uuid) from public,anon,authenticated;
