-- Do not spend a fresh research attempt on the same unchanged website after a
-- completed or failed attempt. Owners can still explicitly request a retry.
create or replace function crm_private.prepare_contact_research() returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare j public.crm_contact_research; t text;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('contact-queue',0));
 update public.crm_contact_research r set status='expired',last_error='Worker lease expired; review before retrying',completed_at=now()
 where status in('running','dispatched') and exists(select 1 from crm_private.contact_capabilities c where c.job_id=r.id and c.lease_until<now());
 if (select count(*) from public.crm_contact_research where started_at>now()-interval '24 hours')>=30 then return null;end if;
 if not exists(select 1 from public.crm_contact_research where status='queued') then
  insert into public.crm_contact_research(workspace_id,customer_id,website)
  select c.workspace_id,c.id,c.website from public.crm_customers c join public.crm_enrichment_settings s on s.workspace_id=c.workspace_id and s.enabled
  where not c.suppressed and nullif(trim(c.email),'') is null and c.website ~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}(/[^[:space:]]*)?$'
   and not exists(select 1 from public.crm_contact_research r where r.customer_id=c.id and (r.status in('queued','dispatched','running') or r.created_at>now()-interval '24 hours'))
   and not exists(select 1 from public.crm_contact_research r where r.customer_id=c.id and r.website=c.website and r.status in('completed','failed','expired'))
  order by c.created_at limit 1;
 end if;
 select * into j from public.crm_contact_research where status='queued' order by created_at,id limit 1 for update skip locked;
 if j.id is null then return null;end if;
 t:=pg_catalog.gen_random_uuid()::text||pg_catalog.gen_random_uuid()::text;
 insert into crm_private.contact_capabilities values(j.id,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(t,'UTF8')),'hex'),now()+interval '5 minutes');
 update public.crm_contact_research set status='dispatched',started_at=now() where id=j.id;
 return jsonb_build_object('job_id',j.id,'token',t);
end $function$;
