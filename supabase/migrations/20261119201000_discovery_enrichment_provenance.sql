-- Provenance links contact research to the discovery source that imported the customer.
-- Historical rows are backfilled only when the source is uniquely established.
alter table public.crm_discovery_imports add column if not exists source_id uuid references public.crm_discovery_sources(id) on delete set null;
alter table public.crm_contact_research add column if not exists source_id uuid references public.crm_discovery_sources(id) on delete set null;
create index if not exists crm_discovery_imports_source_id on public.crm_discovery_imports(source_id);
create index if not exists crm_contact_research_source_id on public.crm_contact_research(source_id);

update public.crm_discovery_imports i set source_id=s.id
from public.crm_customers c join public.crm_discovery_sources s on s.workspace_id=c.workspace_id
 and s.provider='google_places' and lower(s.search_text)=lower(c.industry)
where i.customer_id=c.id and i.workspace_id=c.workspace_id and i.source_id is null
 and i.source_key like 'google_places/%' and c.source like 'google_places:%';

update public.crm_contact_research r set source_id=src.source_id
from (select i.workspace_id,i.customer_id,min(i.source_id::text)::uuid source_id
      from public.crm_discovery_imports i where i.source_id is not null
      group by 1,2 having count(distinct i.source_id)=1) src
where r.workspace_id=src.workspace_id and r.customer_id=src.customer_id and r.source_id is null;

create or replace function crm_private.link_contact_research_source()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 select min(i.source_id::text)::uuid into new.source_id from public.crm_discovery_imports i
 where i.workspace_id=new.workspace_id and i.customer_id=new.customer_id and i.source_id is not null
 having count(distinct i.source_id)=1;
 return new;
end $$;
drop trigger if exists crm_link_contact_research_source on public.crm_contact_research;
create trigger crm_link_contact_research_source before insert on public.crm_contact_research
for each row execute function crm_private.link_contact_research_source();

-- A clean completed job means the contact was newly added by the research function.
-- Count it once per customer and source, regardless of retries or repeated research.
create or replace function crm_private.count_contact_research_enrichment()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='completed' and new.last_error is null and new.source_id is not null
    and (old.status is distinct from 'completed' or old.last_error is not null)
    and not exists (select 1 from public.crm_contact_research r where r.id<>new.id
      and r.workspace_id=new.workspace_id and r.customer_id=new.customer_id
      and r.source_id=new.source_id and r.status='completed' and r.last_error is null) then
   update public.crm_discovery_sources set enriched=enriched+1 where id=new.source_id and workspace_id=new.workspace_id;
 end if;
 return new;
end $$;
drop trigger if exists crm_count_contact_research_enrichment on public.crm_contact_research;
create trigger crm_count_contact_research_enrichment after update of status,last_error on public.crm_contact_research
for each row execute function crm_private.count_contact_research_enrichment();

update public.crm_discovery_sources s set enriched=greatest(s.enriched,x.n)
from (select source_id,count(distinct customer_id)::integer n
      from public.crm_contact_research
      where source_id is not null and status='completed' and last_error is null
      group by source_id) x where s.id=x.source_id;

-- Preserve the existing discovery lease and validation logic; only attach source_id on import.
create or replace function public.crm_finish_discovery_job(p_job uuid, p_token text, p_page jsonb, p_error text default null)
 returns jsonb language plpgsql security definer set search_path to '' as $function$
declare j crm_private.discovery_runs;s public.crm_discovery_sources;l jsonb;c uuid;n integer;added integer:=0;dupes integer:=0;mail text;nextphase integer;nextcursor bigint;enriched_count integer:=0;existing uuid;
begin
 select * into j from crm_private.discovery_runs where id=p_job
 and token_hash=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token,'UTF8')),'hex')
 and length(p_token)=72 and status='running' and lease_until>now() for update;
 if j.id is null then raise exception 'Discovery lease unavailable' using errcode='42501';end if;
 select * into s from public.crm_discovery_sources where id=j.source_id for update;
 if not s.enabled then update crm_private.discovery_runs set status='expired',completed_at=now() where id=j.id;return jsonb_build_object('paused',true);end if;
 if p_error is not null then
  update crm_private.discovery_runs set status='failed',completed_at=now() where id=j.id;
  update public.crm_discovery_sources set failures=failures+1,last_error=left(p_error,500),last_run_at=now(),
   next_run_at=now()+least(360,15*power(2,least(failures,4)))::integer*interval '1 minute' where id=s.id;
  return jsonb_build_object('retry_scheduled',true);
 end if;
 if jsonb_typeof(p_page->'leads') is distinct from 'array' or jsonb_array_length(p_page->'leads')>100 or pg_column_size(p_page)>250000 then raise exception 'Invalid discovery page';end if;
 nextphase:=(p_page->>'next_phase')::integer;nextcursor:=(p_page->>'next_cursor')::bigint;
 if nextphase is null or nextcursor is null or not(nextphase=s.phase and nextcursor>s.cursor_id or nextphase=s.phase+1 and nextcursor=0 or s.provider<>'openstreetmap' and nextphase=3 and nextcursor>=s.cursor_id) then raise exception 'Invalid discovery continuation';end if;
 for l in select * from jsonb_array_elements(p_page->'leads') loop
  if not (
  s.provider='openstreetmap' and l->>'source_key' ~ '^(node|way|relation)/[1-9][0-9]*$' and l->>'source_url'='https://www.openstreetmap.org/'||(l->>'source_key')
  or s.provider in('fmcsa','fmcsa_contacts') and l->>'source_key' ~ '^fmcsa/[1-9][0-9]*$' and l->>'source_url'='https://data.transportation.gov/resource/az4n-8mr2.json?dot_number='||split_part(l->>'source_key','/',2)
  or s.provider='ny_registry' and l->>'source_key' ~ '^ny_registry/[1-9][0-9]*$' and l->>'source_url'='https://data.ny.gov/resource/n9v6-gdp6.json?dos_id='||split_part(l->>'source_key','/',2)
  or s.provider='google_places' and l->>'source_key' ~ '^google_places/[A-Za-z0-9_-]{10,255}$' and l->>'source_url'='https://www.google.com/maps/place/?q=place_id:'||split_part(l->>'source_key','/',2)
  )
  or length(trim(coalesce(l->>'company','')))=0 or length(l->>'company')>200 then raise exception 'Invalid business evidence';end if;
  mail:=nullif(lower(trim(l->>'email')),'');
  if mail is not null and s.provider='google_places' then raise exception 'Google Places does not supply email';end if;
  if mail is not null and (length(mail)>254 or mail !~ '^[^[:space:]@;,]+@[^[:space:]@;,]+\.[^[:space:]@;,]+$') then raise exception 'Invalid published email';end if;
  if mail is not null and mail !~ '^(info|sales|dispatch|contact|office|support|hello|enquiries|inquiries|quotes|rates|freight|shipping|logistics|operations|customerservice|customer-service|service|admin|general|booking|bookings|warehouse)@[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$' then raise exception 'Only published organizational inboxes are accepted';end if;
  select customer_id into existing from public.crm_discovery_imports where workspace_id=s.workspace_id and source_key=l->>'source_key';
  if existing is not null then
   dupes:=dupes+1;
   if mail is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s.workspace_id::text||':'||mail,0));
    update public.crm_customers set email=mail,identity_review_required=true where workspace_id=s.workspace_id and id=existing and nullif(trim(email),'') is null
     and not exists(select 1 from public.crm_customers where workspace_id=s.workspace_id and email=mail and id<>existing);
    if found then enriched_count:=enriched_count+1;end if;
    insert into public.crm_contact_evidence(workspace_id,customer_id,email,source_url,source_kind)
     values(s.workspace_id,existing,mail,l->>'source_url',case when s.provider='openstreetmap' then 'map_listing' else 'official_registry' end) on conflict do nothing;
   end if;
   continue;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s.workspace_id::text||':'||coalesce(mail,l->>'source_key'),0));
  select count(*) into n from public.crm_customers where workspace_id=s.workspace_id and mail is not null and email=mail;
  if n>1 then dupes:=dupes+1;continue;end if;
  c:=null;
  if n=1 then select id into c from public.crm_customers where workspace_id=s.workspace_id and email=mail;dupes:=dupes+1;
  else
   insert into public.crm_customers(workspace_id,company,email,website,phone,location,industry,source,identity_review_required)
   values(s.workspace_id,l->>'company',mail,left(coalesce(l->>'website',''),1000),left(coalesce(l->>'phone',''),80),left(coalesce(l->>'location',''),200),
   case s.provider when 'fmcsa' then 'Transportation registrant' when 'fmcsa_contacts' then 'Transportation registrant' when 'ny_registry' then 'Business registry' when 'google_places' then left(s.search_text,120) else s.category end,s.provider||': '||(l->>'source_url'),true) returning id into c;added:=added+1;
  end if;
  insert into public.crm_discovery_imports(workspace_id,source_key,customer_id,source_url,source_id) values(s.workspace_id,l->>'source_key',c,l->>'source_url',s.id);
  if mail is not null then insert into public.crm_contact_evidence(workspace_id,customer_id,email,source_url,source_kind) values(s.workspace_id,c,mail,l->>'source_url',case when s.provider='openstreetmap' then 'map_listing' else 'official_registry' end) on conflict do nothing;end if;
 end loop;
 update crm_private.discovery_runs set status='completed',completed_at=now() where id=j.id;
 update public.crm_discovery_sources set phase=nextphase,cursor_id=nextcursor,imported=imported+added,duplicates=duplicates+dupes,enriched=enriched+enriched_count,
 failures=0,last_error=null,last_run_at=now(),next_run_at=case when nextphase=3 then now()+case when s.provider='google_places' then interval '30 days' else interval '24 hours' end else next_run_at end,exhausted_at=case when nextphase=3 then now() else null end where id=s.id;
 return jsonb_build_object('imported',added,'duplicates',dupes,'enriched',enriched_count,'exhausted',nextphase=3);
end $function$;
