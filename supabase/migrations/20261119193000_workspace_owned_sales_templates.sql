-- The original seed copied Onixus sales copy into client workspaces. Replace
-- only untouched copies; a client-edited subject or body is never overwritten.
create or replace function revenue_private.seed_sales_workspace()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.name like '[TEST ONLY]%' then return new; end if;
 insert into public.revenue_pipeline_stages(workspace_id,key,label,position,outcome,probability)
 select new.id,d.key,d.label,d."position",d.outcome,d.probability from revenue_private.default_stages() d
 on conflict(workspace_id,key) do nothing;
 if new.id='8350462c-2cca-4541-b299-acbc4c5f1162'::uuid then
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

update public.revenue_templates t set
 subject='A conversation with '||w.name,
 body='Hello, I am reaching out from '||w.name||'. We work in '||coalesce(nullif(w.industry,''),'our field')||'. Tell us what you need and we can confirm which of our current services fit. Would a short conversation be useful?'
from public.crm_workspaces w
where t.workspace_id=w.id and w.id<>'8350462c-2cca-4541-b299-acbc4c5f1162'::uuid
 and w.name not like '[TEST ONLY]%'
 and t.name='First contact — more clients' and t.subject='A clearer path from inquiry to customer'
 and t.body='We Build, We Grow, We Automate. Onixus helps businesses create a clearer path from the first inquiry to the next customer conversation. If following up with new leads is taking too much time, we can map the current handoff and identify one practical improvement. Would a short conversation be useful?';

update public.revenue_templates t set
 subject='Following up from '||w.name,
 body='Following up from '||w.name||' about your request. If it is still a priority, reply with the specific outcome you need and we can confirm a practical next step.'
from public.crm_workspaces w
where t.workspace_id=w.id and w.id<>'8350462c-2cca-4541-b299-acbc4c5f1162'::uuid
 and w.name not like '[TEST ONLY]%'
 and t.name='Follow-up — practical next step' and t.subject='Following up on your workflow'
 and t.body='We Build, We Grow, We Automate. Following up on the workflow we discussed: a clear owner, a useful customer record, and a timely next step can make it easier to respond to new opportunities. If this is still a priority, we can review the current process together.';
