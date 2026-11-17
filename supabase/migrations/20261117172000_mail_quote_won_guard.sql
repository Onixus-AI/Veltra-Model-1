-- Keep quote conversations when the CRM has evidence of a sealed deal. The existing
-- seven-day quiet-period and Friday schedule still determine when other threads are due.
create or replace function public.mail_quote_cleanup_eligible(p_account uuid, p_token text, p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare w uuid := crm_private.mail_workspace(p_account, p_token); c crm_private.mail_quote_cleanup;
begin
  select * into c from crm_private.mail_quote_cleanup
   where id = p_id and account_id = p_account and workspace_id = w and status in ('approved', 'waiting');
  if c.id is null then raise exception '409:This quote cleanup item is not available.'; end if;

  -- Strongest evidence: a CRM deal explicitly linked to a message in this Gmail thread.
  if exists (
    select 1 from public.revenue_messages m join public.crm_deals d
      on d.workspace_id = m.workspace_id and d.id = m.deal_id
     where m.workspace_id = w and m.account_id = p_account and m.thread_id = c.thread_id
       and revenue_private.stage_outcome(w, d.stage) = 'won'
  ) then return false; end if;

  -- Older Mail conversations may not have a deal ID. Err toward retaining a broker's
  -- correspondence when that exact sender is a CRM customer with a won deal.
  if exists (
    select 1 from public.crm_customers customer join public.crm_deals d
      on d.workspace_id = customer.workspace_id and d.customer_id = customer.id
     where customer.workspace_id = w and customer.merged_into_id is null
       and public.revenue_normalize_email(customer.email) = public.revenue_normalize_email(c.from_email)
       and revenue_private.stage_outcome(w, d.stage) = 'won'
  ) then return false; end if;

  return true;
end $$;
revoke all on function public.mail_quote_cleanup_eligible(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.mail_quote_cleanup_eligible(uuid, text, uuid) to anon, authenticated;
