-- Identify the platform business by data, not by a workspace UUID in the seed function.
alter table public.crm_workspaces add column if not exists is_platform_owner boolean not null default false;
create unique index if not exists crm_workspaces_one_platform_owner
 on public.crm_workspaces(is_platform_owner) where is_platform_owner;
update public.crm_workspaces set is_platform_owner=(id='8350462c-2cca-4541-b299-acbc4c5f1162'::uuid)
 where id='8350462c-2cca-4541-b299-acbc4c5f1162'::uuid or is_platform_owner;

create or replace function revenue_private.seed_sales_workspace()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.name like '[TEST ONLY]%' then return new; end if;
 insert into public.revenue_pipeline_stages(workspace_id,key,label,position,outcome,probability)
 select new.id,d.key,d.label,d."position",d.outcome,d.probability from revenue_private.default_stages() d
 on conflict(workspace_id,key) do nothing;
 if new.is_platform_owner then
   insert into public.revenue_templates(workspace_id,name,subject,body) values
   (new.id,'First contact — more clients','A clearer path from inquiry to customer',
    'We Build, We Grow, We Automate. Onixus helps businesses create a clearer path from the first inquiry to the next customer conversation. If following up with new leads is taking too much time, we can map the current handoff and identify one practical improvement. Would a short conversation be useful?'),
   (new.id,'Follow-up — practical next step','Following up on your workflow',
    'We Build, We Grow, We Automate. Following up on the workflow we discussed: a clear owner, a useful customer record, and a timely next step can make it easier to respond to new opportunities. If this is still a priority, we can review the current process together.');
 else
   insert into public.revenue_templates(workspace_id,name,subject,body) values
   (new.id,'First contact — more clients','A conversation with '||new.name,
    'Hello, I am reaching out from '||new.name||'. We work in '||coalesce(nullif(new.industry,''),'our field')||'. Tell us what you need and we can confirm which of our current services fit. Would a short conversation be useful?'),
   (new.id,'Follow-up — practical next step','Following up from '||new.name,
    'Following up from '||new.name||' about your request. If it is still a priority, reply with the specific outcome you need and we can confirm a practical next step.');
 end if;
 return new;
end $$;
