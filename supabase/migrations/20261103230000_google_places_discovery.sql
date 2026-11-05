-- Business discovery: unstick saves, add Google Places as a source.
--
-- 1. The save step looks up each lead's email with `email = mail`. The only email indexes are on
--    lower(email) and a normalized form, so with ~112k customers every lookup scanned the table and
--    the worker's anon role (3 s statement timeout) cancelled the save. FMCSA inboxes failed 36 times
--    in a row with "Discovery result could not be saved." Emails are stored lowercase (see
--    crm_customers_email_check), so a plain (workspace_id, email) index serves the lookup. Measured on
--    production in a rolled-back transaction: the stuck page saved in 0.53 s with this index.
-- 2. google_places: each source has a free-text search ("plumbers in Broward County, FL"). One run
--    reads up to 3 pages (60 businesses), then rests 24 hours. At most 10 Places runs per 24 hours
--    across all workspaces (≤ 30 Text Search calls/day), inside Google's 1,000 free calls a month.
-- 3. The job functions below were live in production but not in this repository; they are now.

create index if not exists crm_customers_workspace_email
 on public.crm_customers(workspace_id, email) where email is not null;

alter table public.crm_discovery_sources add column if not exists search_text text;
alter table public.crm_discovery_sources drop constraint if exists crm_discovery_sources_search_text_check;
alter table public.crm_discovery_sources add constraint crm_discovery_sources_search_text_check
 check (search_text is null or length(trim(search_text)) between 3 and 160);
alter table public.crm_discovery_sources drop constraint if exists crm_discovery_sources_provider_check;
alter table public.crm_discovery_sources add constraint crm_discovery_sources_provider_check
 check (provider = any (array['openstreetmap','fmcsa','fmcsa_contacts','ny_registry','google_places']));
alter table public.crm_discovery_sources drop constraint if exists crm_discovery_sources_category_check;
alter table public.crm_discovery_sources add constraint crm_discovery_sources_category_check
 check (category = any (array['logistics','warehouses','manufacturers','retailers','offices','local_businesses']));
alter table public.crm_discovery_sources drop constraint if exists crm_discovery_sources_places_search_check;
alter table public.crm_discovery_sources add constraint crm_discovery_sources_places_search_check
 check (provider <> 'google_places' or search_text is not null);

create or replace function public.crm_start_discovery_job(p_job uuid, p_token text)
 returns jsonb language plpgsql security definer set search_path to '' as $function$
declare j crm_private.discovery_runs;s public.crm_discovery_sources;
begin
 if length(p_token)<>72 then return null;end if;
 update crm_private.discovery_runs set status='running'
 where id=p_job and token_hash=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token,'UTF8')),'hex')
 and status='dispatched' and lease_until>now() returning * into j;
 if j.id is null then return null;end if;
 select * into s from public.crm_discovery_sources where id=j.source_id and enabled and phase<3;
 if s.id is null then update crm_private.discovery_runs set status='expired' where id=j.id;return null;end if;
 return jsonb_build_object('provider',s.provider,'category',s.category,'bounds',s.bounds,'phase',s.phase,'cursor',s.cursor_id,'search_text',s.search_text);
end $function$;

create or replace function crm_private.prepare_discovery()
 returns jsonb language plpgsql security definer set search_path to '' as $function$
declare s public.crm_discovery_sources;r uuid;t text;places_full boolean;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm-discovery-dispatch',0));
 update crm_private.discovery_runs set status='expired' where status in('dispatched','running') and lease_until<now();
 update public.crm_discovery_sources set phase=0,cursor_id=case when provider='openstreetmap' then 0 else cursor_id end,exhausted_at=null where enabled and phase=3 and next_run_at<=now();
 if (select count(*) from crm_private.discovery_runs where created_at>now()-interval '24 hours')>=120 then return null;end if;
 select count(*)>=10 into places_full from crm_private.discovery_runs j join public.crm_discovery_sources x on x.id=j.source_id
  where x.provider='google_places' and j.created_at>now()-interval '24 hours';
 select x.* into s from public.crm_discovery_sources x
 where x.enabled and x.phase<3 and x.next_run_at<=now()
 and not (x.provider='google_places' and places_full)
 and not exists(select 1 from crm_private.discovery_runs j where j.source_id=x.id and j.status in('dispatched','running') and j.lease_until>now())
 order by x.next_run_at,x.id limit 1 for update skip locked;
 if s.id is null then return null;end if;
 t:=pg_catalog.gen_random_uuid()::text||pg_catalog.gen_random_uuid()::text;
 insert into crm_private.discovery_runs(source_id,token_hash,status,lease_until)
 values(s.id,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(t,'UTF8')),'hex'),'dispatched',now()+interval '10 minutes') returning id into r;
 update public.crm_discovery_sources set next_run_at=now()+interval '15 minutes' where id=s.id;
 return jsonb_build_object('job_id',r,'token',t);
end $function$;

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
  insert into public.crm_discovery_imports(workspace_id,source_key,customer_id,source_url) values(s.workspace_id,l->>'source_key',c,l->>'source_url');
  if mail is not null then insert into public.crm_contact_evidence(workspace_id,customer_id,email,source_url,source_kind) values(s.workspace_id,c,mail,l->>'source_url',case when s.provider='openstreetmap' then 'map_listing' else 'official_registry' end) on conflict do nothing;end if;
 end loop;
 update crm_private.discovery_runs set status='completed',completed_at=now() where id=j.id;
 update public.crm_discovery_sources set phase=nextphase,cursor_id=nextcursor,imported=imported+added,duplicates=duplicates+dupes,enriched=enriched+enriched_count,
 failures=0,last_error=null,last_run_at=now(),next_run_at=case when nextphase=3 then now()+interval '24 hours' else next_run_at end,exhausted_at=case when nextphase=3 then now() else null end where id=s.id;
 return jsonb_build_object('imported',added,'duplicates',dupes,'enriched',enriched_count,'exhausted',nextphase=3);
end $function$;
