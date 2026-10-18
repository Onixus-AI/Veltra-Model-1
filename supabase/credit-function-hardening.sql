-- Existing trigger behavior and service-only credit access are preserved.
begin;
alter function public.refill_monthly_credits(uuid) set search_path='';
alter function public.deduct_credits_fifo(uuid,integer,character varying,character varying,integer) set search_path='';
revoke execute on function public.create_organization_credit_wallet() from public,anon,authenticated;
revoke execute on function public.provision_user_organization() from public,anon,authenticated;
commit;
