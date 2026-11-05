-- Contact research accepts the address a small business publishes on its own website.
--
-- Before: only role inboxes (info@, sales@, office@ ...) at the company's domain were accepted. Onixus now looks
-- for small businesses nationally (barbers, cleaners, handymen), which mostly publish a Gmail-style or owner-name
-- address, so most found addresses were discarded (3 emails from 17 Google Places businesses on 2026-11-04).
-- After: an address seen on the business's own site is accepted when it is at the site's own domain (any mailbox)
-- or at a personal mail provider. Addresses at other domains (a web designer's credit, a platform inbox) and
-- no-reply mailboxes are still rejected. Nothing is derived or guessed. When several are published, a single
-- role inbox is preferred; otherwise the only address is used; anything else stays for review.
-- The function was live in production but not in this repository; it is now (copied from production, 2026-11-04,
-- with only the rules above changed). Discovery imports from registries/map data keep the role-inbox rule.

create or replace function crm_private.website_email_allowed(p_email text, p_website text)
 returns boolean language sql immutable set search_path to '' as $function$
 select p_email is not null and length(p_email)<=254
  and p_email ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]{1,64}@[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$'
  and split_part(p_email,'@',1) !~ '^(no-?reply|do-?not-?reply|mailer-daemon|postmaster)$'
  and split_part(p_email,'@',2) !~ '\.(png|jpe?g|gif|webp|svg|css|js)$'
  and (
   split_part(p_email,'@',2) = any(array['gmail.com','googlemail.com','yahoo.com','ymail.com','rocketmail.com','outlook.com','hotmail.com','live.com','msn.com','aol.com','icloud.com','me.com','mac.com','comcast.net','att.net','sbcglobal.net','bellsouth.net','verizon.net','cox.net','charter.net','protonmail.com','proton.me','zoho.com','gmx.com','mail.com'])
   or split_part(p_email,'@',2) = regexp_replace(lower(substring(p_website from '^https://([^/?#:]+)')),'^www\.','')
   or regexp_replace(lower(substring(p_website from '^https://([^/?#:]+)')),'^www\.','') like '%.'||split_part(p_email,'@',2)
   or split_part(p_email,'@',2) like '%.'||regexp_replace(lower(substring(p_website from '^https://([^/?#:]+)')),'^www\.','')
  );
$function$;
revoke all on function crm_private.website_email_allowed(text,text) from public;

create or replace function public.crm_finish_contact_job(p_job uuid, p_token text, p_result jsonb, p_error text default null)
 returns jsonb language plpgsql security definer set search_path to '' as $function$
declare j public.crm_contact_research;x jsonb;mail text;origin text;one_email text;count_emails integer;role_count integer;role_email text;n integer:=0;updated boolean:=false;
begin
 select r.* into j from public.crm_contact_research r where r.id=p_job and r.status='running'
 and exists(select 1 from crm_private.contact_capabilities c where c.job_id=r.id and length(p_token)=72 and c.token_hash=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token,'UTF8')),'hex') and c.lease_until>now()) for update;
 if j.id is null then raise exception 'Contact research lease unavailable' using errcode='42501';end if;
 if p_error is not null then update public.crm_contact_research set status='failed',last_error=left(p_error,500),completed_at=now() where id=j.id;return jsonb_build_object('status','failed');end if;
 if jsonb_typeof(p_result->'contacts') is distinct from 'array' or jsonb_array_length(p_result->'contacts')>30 or jsonb_typeof(p_result->'pages') is distinct from 'array' or jsonb_array_length(p_result->'pages')>3 or pg_column_size(p_result)>30000 then raise exception 'Invalid contact research result';end if;
 origin:=substring(j.website from '^(https://[^/?#]+)');
 if exists(select 1 from jsonb_array_elements_text(p_result->'pages') p where p not like origin||'/%') then raise exception 'Cross-domain research page';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('contact-customer:'||j.customer_id::text,0));
 for x in select * from jsonb_array_elements(p_result->'contacts') loop
  mail:=x->>'email';
  if not crm_private.website_email_allowed(mail,j.website)
   or x->>'source_url' is null or length(x->>'source_url')>1000 or (x->>'source_url') not like origin||'/%'
   or not (p_result->'pages' ? (x->>'source_url')) then raise exception 'Invalid published contact evidence';end if;
  insert into public.crm_contact_evidence(workspace_id,customer_id,email,source_url,source_kind) values(j.workspace_id,j.customer_id,mail,x->>'source_url','company_website') on conflict do nothing;
  if found then n:=n+1;end if;
 end loop;
 select count(distinct v->>'email'),min(v->>'email') into count_emails,one_email from jsonb_array_elements(p_result->'contacts') v;
 select count(distinct v->>'email'),min(v->>'email') into role_count,role_email from jsonb_array_elements(p_result->'contacts') v
  where v->>'email' ~ '^(info|sales|dispatch|contact|office|support|hello|enquiries|inquiries|quotes|rates|freight|shipping|logistics|operations|customerservice|customer-service|service|admin|general|booking|bookings|warehouse)@';
 if count_emails>1 and role_count=1 then one_email:=role_email;count_emails:=1;end if;
 if count_emails=1 then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(j.workspace_id::text||':'||one_email,0));
  update public.crm_customers set email=one_email,identity_review_required=true where workspace_id=j.workspace_id and id=j.customer_id and website=j.website and not suppressed and nullif(trim(email),'') is null
   and not exists(select 1 from public.crm_customers where workspace_id=j.workspace_id and email=one_email and id<>j.customer_id);
  updated:=found;
 end if;
 update public.crm_contact_research set status='completed',completed_at=now(),pages=p_result->'pages',last_error=case when jsonb_array_length(p_result->'contacts')=0 then 'No published business email found' when count_emails>1 then 'Several published emails found; choose after reviewing sources' when not updated then 'Evidence saved; existing contact retained or identity needs review' else null end where id=j.id;
 return jsonb_build_object('status','completed','evidence_saved',n,'contact_added',updated,'review_required',true);
end $function$;
