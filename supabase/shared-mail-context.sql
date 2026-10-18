-- Shared customer facts for a Mail account explicitly linked by the workspace owner.
-- Retains the existing account-bound token authorization and recipient suppression checks.
begin;
create or replace function public.crm_mail_policy(p_account uuid,p_token text,p_email text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid;c uuid;n integer;blocked boolean;context jsonb;
begin
 w:=crm_private.mail_workspace(p_account,p_token);
 select count(*),coalesce(bool_or(suppressed),false) into n,blocked from public.crm_customers where workspace_id=w and email=lower(trim(p_email));
 if n>1 then raise exception 'Ambiguous customer identity: review matching records'; end if;
 select id into c from public.crm_customers where workspace_id=w and email=lower(trim(p_email));
 if c is not null and not blocked then
  select jsonb_build_object('company',company,'name',name,'industry',industry) into context from public.crm_customers where workspace_id=w and id=c;
  context:=context||jsonb_build_object(
   'approved_memory',coalesce((select jsonb_agg(x) from (select content,source from public.crm_memories where workspace_id=w and customer_id=c and status='approved' and (expires_at is null or expires_at>now()) order by created_at desc limit 20)x),'[]'::jsonb),
   'open_tasks',coalesce((select jsonb_agg(x) from (select title,due_at from public.crm_tasks where workspace_id=w and customer_id=c and status='open' order by due_at limit 20)x),'[]'::jsonb),
   'recent_activity',coalesce((select jsonb_agg(x) from (select kind,title,created_at from public.crm_activity where workspace_id=w and customer_id=c order by created_at desc limit 15)x),'[]'::jsonb),
   'deals',coalesce((select jsonb_agg(x) from (select title,stage,value_cents,currency from public.crm_deals where workspace_id=w and customer_id=c order by created_at desc limit 20)x),'[]'::jsonb));
 end if;
 return jsonb_build_object('suppressed',blocked,'customer_context',context);
end $$;
revoke all on function public.crm_mail_policy(uuid,text,text) from public;
grant execute on function public.crm_mail_policy(uuid,text,text) to anon,authenticated;
commit;
