-- Give every unconfigured business a visible, editable sales pipeline.
-- Existing custom pipelines and deals are left untouched. Templates are
-- drafts only; this migration creates no send jobs or autopilot permissions.
create or replace function revenue_private.default_stages()
returns table(key text,label text,"position" integer,outcome text,probability integer)
language sql immutable set search_path='' as $$
 values ('new','New lead',0,'open',10),
        ('contacted','Contacted',1,'open',20),
        ('replied','Replied',2,'open',35),
        ('meeting','Meeting',3,'open',50),
        ('proposal','Proposal',4,'open',70),
        ('won','Won',5,'won',100),
        ('lost','Lost',6,'lost',0)
$$;

create or replace function revenue_private.seed_sales_workspace()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.revenue_pipeline_stages(workspace_id,key,label,position,outcome,probability)
 select new.id,d.key,d.label,d."position",d.outcome,d.probability
 from revenue_private.default_stages() d
 on conflict(workspace_id,key) do nothing;
 insert into public.revenue_templates(workspace_id,name,subject,body)
 values
 (new.id,'First contact — more clients','A clearer path from inquiry to customer',
  'We Build, We Grow, We Automate. Onixus helps businesses create a clearer path from the first inquiry to the next customer conversation. If following up with new leads is taking too much time, we can map the current handoff and identify one practical improvement. Would a short conversation be useful?'),
 (new.id,'Follow-up — practical next step','Following up on your workflow',
  'We Build, We Grow, We Automate. Following up on the workflow we discussed: a clear owner, a useful customer record, and a timely next step can make it easier to respond to new opportunities. If this is still a priority, we can review the current process together.');
 return new;
end $$;

do $$ begin
 if not exists (select 1 from pg_trigger where tgrelid='public.crm_workspaces'::regclass and tgname='revenue_seed_sales_workspace') then
  create trigger revenue_seed_sales_workspace after insert on public.crm_workspaces
  for each row execute function revenue_private.seed_sales_workspace();
 end if;
end $$;

-- Seed existing businesses once. Do not replace a workspace's chosen stages.
insert into public.revenue_pipeline_stages(workspace_id,key,label,position,outcome,probability)
select w.id,d.key,d.label,d."position",d.outcome,d.probability
from public.crm_workspaces w cross join revenue_private.default_stages() d
where not exists(select 1 from public.revenue_pipeline_stages p where p.workspace_id=w.id)
on conflict(workspace_id,key) do nothing;

insert into public.revenue_templates(workspace_id,name,subject,body)
select w.id,t.name,t.subject,t.body
from public.crm_workspaces w cross join (values
 ('First contact — more clients','A clearer path from inquiry to customer',
  'We Build, We Grow, We Automate. Onixus helps businesses create a clearer path from the first inquiry to the next customer conversation. If following up with new leads is taking too much time, we can map the current handoff and identify one practical improvement. Would a short conversation be useful?'),
 ('Follow-up — practical next step','Following up on your workflow',
  'We Build, We Grow, We Automate. Following up on the workflow we discussed: a clear owner, a useful customer record, and a timely next step can make it easier to respond to new opportunities. If this is still a priority, we can review the current process together.')
) t(name,subject,body)
where not exists(select 1 from public.revenue_templates x where x.workspace_id=w.id and x.name=t.name);
