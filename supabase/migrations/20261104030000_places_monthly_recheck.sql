-- Google Places sources rest 30 days between searches instead of 24 hours.
-- Onixus searches small businesses nationally; at <= 10 Places runs a day, re-checking every search daily would
-- spend the free tier re-reading the same cities. With a 30-day rest the daily budget moves through new
-- trade + city searches, and each one is re-checked monthly for new businesses. Registry and map sources keep 24 hours.
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
 failures=0,last_error=null,last_run_at=now(),next_run_at=case when nextphase=3 then now()+case when s.provider='google_places' then interval '30 days' else interval '24 hours' end else next_run_at end,exhausted_at=case when nextphase=3 then now() else null end where id=s.id;
 return jsonb_build_object('imported',added,'duplicates',dupes,'enriched',enriched_count,'exhausted',nextphase=3);
end $function$;
