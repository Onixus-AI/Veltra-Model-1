begin;
create function public.workspace_business_trend(p_workspace uuid,p_from timestamptz,p_to timestamptz,p_bins integer default 12) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform revenue_private.require_role(p_workspace,'viewer');
 if p_from is null or p_to is null or p_to<=p_from or p_to-p_from>interval '32 days' or p_bins not between 1 and 32 then raise exception 'Invalid reporting range';end if;
 return (select jsonb_agg(jsonb_build_object('at',s,'sent',(select count(*) from public.revenue_messages where workspace_id=p_workspace and direction='outbound' and coalesce(automation_key,'')<>'owner_daily_report' and provider_accepted_at>=s and provider_accepted_at<e),'completed',(select count(*) from public.revenue_jobs where workspace_id=p_workspace and status='succeeded' and coalesce(workflow_key,'')<>'owner_daily_report' and finished_at>=s and finished_at<e),'contacts',(select count(*) from public.crm_customers where workspace_id=p_workspace and merged_into_id is null and created_at>=s and created_at<e)) order by s) from (select p_from+(p_to-p_from)*i/p_bins s,p_from+(p_to-p_from)*(i+1)/p_bins e from generate_series(0,p_bins-1)i) bins);
end $$;
revoke all on function public.workspace_business_trend(uuid,timestamptz,timestamptz,integer) from public,anon;
grant execute on function public.workspace_business_trend(uuid,timestamptz,timestamptz,integer) to authenticated;
commit;
