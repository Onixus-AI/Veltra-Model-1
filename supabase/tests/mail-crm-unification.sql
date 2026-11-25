-- Mail <-> CRM unification behaviour. Run after the bootstrap and the migration:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/mail-crm-unification-bootstrap.sql
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261125020000_mail_crm_unification.sql
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/mail-crm-unification.sql
-- Every check raises on failure, so ON_ERROR_STOP makes the run fail.

\set ON_ERROR_STOP on
insert into crm_private.mail_google(account_id, workspace_id, mailbox, crm_token_secret, status) values
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a1','info@a.test','00000000-0000-0000-0000-0000000000c1','active'),
 ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000b1','info@b.test','00000000-0000-0000-0000-0000000000c2','active');

create or replace function pg_temp.expect_error(p_sql text, p_expect text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL: expected error containing %', p_expect;
exception when others then
  if sqlerrm not like '%' || p_expect || '%' then
    raise exception 'FAIL: expected % but got %', p_expect, sqlerrm;
  end if;
end $$;

-- Workspace A, owner session.
select set_config('app.workspace_id', '00000000-0000-0000-0000-0000000000a1', false);
select set_config('app.workspace_role', 'owner', false);

-- 1. Sender matching: a new customer is created from an email, with its company kept.
do $$
declare r jsonb; ws uuid := '00000000-0000-0000-0000-0000000000a1'; acct uuid := '00000000-0000-0000-0000-00000000000a';
begin
  r := public.mail_thread_link_customer(ws, acct, 'thr-1', 'Quote request', null, 'Acme Co', 'Buyer@Acme.test');
  if r->'customer'->>'company' is distinct from 'Acme Co' then raise exception 'FAIL 1a: company lost on create: %', r; end if;
  if r->'customer'->>'email' is distinct from 'buyer@acme.test' then raise exception 'FAIL 1b: email not normalised: %', r; end if;
end $$;

-- 2. Sender matching: the same email on another thread reuses that customer, no duplicate.
do $$
declare first_id uuid; second_id uuid; n integer; ws uuid := '00000000-0000-0000-0000-0000000000a1'; acct uuid := '00000000-0000-0000-0000-00000000000a';
begin
  select id into first_id from public.crm_customers where workspace_id = ws and email = 'buyer@acme.test';
  second_id := (public.mail_thread_link_customer(ws, acct, 'thr-2', 'Follow up', null, 'Acme Co', 'buyer@acme.test')->'customer'->>'id')::uuid;
  select count(*) into n from public.crm_customers where workspace_id = ws and email = 'buyer@acme.test';
  if second_id is distinct from first_id then raise exception 'FAIL 2a: duplicate customer created'; end if;
  if n <> 1 then raise exception 'FAIL 2b: % customers with that email', n; end if;
end $$;

-- 3. Sender matching: an unmatched email with a company keeps the company (regression for the variable overwrite).
do $$
declare r jsonb; ws uuid := '00000000-0000-0000-0000-0000000000a1'; acct uuid := '00000000-0000-0000-0000-00000000000a';
begin
  r := public.mail_thread_link_customer(ws, acct, 'thr-3', 'New lead', null, 'Newco', 'new@newco.test');
  if r->'customer'->>'company' is distinct from 'Newco' then raise exception 'FAIL 3: company overwritten: %', r; end if;
end $$;

-- 4. Sender matching: no company and no match is refused.
select pg_temp.expect_error($q$select public.mail_thread_link_customer('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000000a','thr-4','No co',null,null,'nobody@nowhere.test')$q$, '400:Company name is required');

-- 5. Shared thread state: a quote outcome logged before a customer exists is kept after linking.
do $$
declare ws uuid := '00000000-0000-0000-0000-0000000000a1'; acct uuid := '00000000-0000-0000-0000-00000000000a'; row_ public.crm_mail_threads;
begin
  perform public.mail_thread_log_quote_outcome(ws, acct, 'thr-5', 'Quote 5', 'won', 'Customer said yes');
  select * into row_ from public.crm_mail_threads where workspace_id = ws and account_id = acct and thread_id = 'thr-5';
  if row_.customer_id is not null then raise exception 'FAIL 5a: expected null customer before link'; end if;
  if row_.quote_outcome->>'status' is distinct from 'won' then raise exception 'FAIL 5b: outcome not stored'; end if;
  perform public.mail_thread_link_customer(ws, acct, 'thr-5', 'Quote 5', null, 'Late Co', 'late@co.test');
  select * into row_ from public.crm_mail_threads where workspace_id = ws and account_id = acct and thread_id = 'thr-5';
  if row_.customer_id is null then raise exception 'FAIL 5c: customer not linked'; end if;
  if row_.quote_outcome->>'status' is distinct from 'won' then raise exception 'FAIL 5d: linking erased the outcome'; end if;
end $$;

-- 6. Thread context finds the customer by sender email when the thread has none yet.
do $$
declare r jsonb; ws uuid := '00000000-0000-0000-0000-0000000000a1'; acct uuid := '00000000-0000-0000-0000-00000000000a';
begin
  perform public.mail_thread_log_quote_outcome(ws, acct, 'thr-6', 'Quote 6', 'pending', 'Waiting');
  r := public.mail_thread_crm_context(ws, acct, 'thr-6', array['buyer@acme.test']);
  if r->'customer'->>'email' is distinct from 'buyer@acme.test' then raise exception 'FAIL 6: context did not match sender: %', r; end if;
end $$;

-- 7. Account and workspace isolation: workspace B's mailbox cannot act in workspace A.
select pg_temp.expect_error($q$select public.mail_thread_link_customer('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000000b','thr-7','x',null,'X Co','x@x.test')$q$, '403:Mailbox does not belong');
select pg_temp.expect_error($q$select public.mail_thread_crm_context('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000000b','thr-7','{}')$q$, '403:Mailbox does not belong');

-- 8. Isolation by role: a session that is not owner of workspace A is refused.
select set_config('app.workspace_role', 'member', false);
select pg_temp.expect_error($q$select public.mail_items_list('00000000-0000-0000-0000-0000000000a1', null)$q$, '403:Owner role required');
select set_config('app.workspace_role', 'owner', false);

-- 9. Overload: the two-argument call resolves to the three-argument version with its default.
do $$ begin
  perform public.mail_items_list('00000000-0000-0000-0000-0000000000a1', null);
end $$;

-- 10. Won-deal quote cleanup: a thread tied to a won deal is not eligible; one without is.
do $$
declare ws uuid := '00000000-0000-0000-0000-0000000000a1'; acct uuid := '00000000-0000-0000-0000-00000000000a';
  cust uuid; cleanup_id uuid; cleanup_clear uuid;
begin
  cust := (public.mail_thread_link_customer(ws, acct, 'thr-10', 'Clean up', null, 'Won Co', 'won@co.test')->'customer'->>'id')::uuid;
  insert into crm_private.mail_quote_cleanup(account_id, thread_id) values (acct, 'thr-10') returning id into cleanup_id;
  insert into crm_private.mail_quote_cleanup(account_id, thread_id) values (acct, 'thr-clear') returning id into cleanup_clear;
  perform public.mail_thread_link_customer(ws, acct, 'thr-clear', 'Clear', null, 'Clear Co', 'clear@co.test');
  if not public.mail_quote_cleanup_eligible(acct, '00000000-0000-0000-0000-0000000000c1', cleanup_clear) then
    raise exception 'FAIL 10a: thread with no won deal should be eligible';
  end if;
  insert into public.crm_deals(workspace_id, customer_id, stage) values (ws, cust, 'won');
  if public.mail_quote_cleanup_eligible(acct, '00000000-0000-0000-0000-0000000000c1', cleanup_id) then
    raise exception 'FAIL 10b: thread tied to a won deal must not be eligible';
  end if;
end $$;

-- 11. Tasks: the same follow-up twice yields one row; a different title is a different task.
do $$
declare ws uuid := '00000000-0000-0000-0000-0000000000a1'; acct uuid := '00000000-0000-0000-0000-00000000000a';
  cust uuid; r1 jsonb; r2 jsonb; r3 jsonb; n integer;
begin
  cust := (select id from public.crm_customers where workspace_id = ws and email = 'buyer@acme.test');
  r1 := public.mail_thread_create_task(ws, acct, 'thr-11', cust, 'Call back', now(), null);
  r2 := public.mail_thread_create_task(ws, acct, 'thr-11', cust, 'Call back', now(), null);
  r3 := public.mail_thread_create_task(ws, acct, 'thr-11', cust, 'Send pricing', now(), null);
  if r1->>'receipt_id' is distinct from r2->>'receipt_id' then raise exception 'FAIL 11a: retry created a second task'; end if;
  if r1->>'receipt_id' = r3->>'receipt_id' then raise exception 'FAIL 11b: different task shares a key'; end if;
  select count(*) into n from public.crm_tasks where workspace_id = ws and customer_id = cust;
  if n <> 2 then raise exception 'FAIL 11c: expected 2 tasks, found %', n; end if;
end $$;

-- 12. The migration made the thread's customer optional, and the schema matches what the functions need.
do $$
begin
  if (select is_nullable from information_schema.columns where table_schema='public' and table_name='crm_mail_threads' and column_name='customer_id') <> 'YES' then
    raise exception 'FAIL 12: crm_mail_threads.customer_id still NOT NULL';
  end if;
end $$;

select 'mail-crm-unification: all checks passed' as result;
