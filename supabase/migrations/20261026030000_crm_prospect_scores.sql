-- Prospect scores: which businesses to work first, and why.
--
-- The CRM rule (docs/perfect-crm.md, Qualification): a score explains its evidence,
-- freshness and missing data. It prioritises work; it is not a buying guarantee, and a
-- high score never means contacted, consented or ready to charge. So every point here
-- comes from a field or event that exists on the record, each one is listed in
-- `reasons`, and every gap is listed in `missing`. Nothing is inferred or invented.
--
-- Re-runnable: CI applies every migration twice.

create table if not exists public.crm_prospect_scores(
 workspace_id uuid not null,
 customer_id uuid not null,
 score smallint not null check(score between 0 and 100),
 tier text not null check(tier in ('ready','good','nurture','research','do_not_contact')),
 outreach_ready boolean not null,
 reasons jsonb not null default '[]'::jsonb,
 missing jsonb not null default '[]'::jsonb,
 scored_at timestamptz not null default now(),
 primary key(workspace_id,customer_id),
 foreign key(workspace_id,customer_id) references public.crm_customers(workspace_id,id) on delete cascade
);
create index if not exists crm_prospect_scores_rank on public.crm_prospect_scores(workspace_id,score desc,customer_id);
create index if not exists crm_prospect_scores_tier on public.crm_prospect_scores(workspace_id,tier,score desc);

alter table public.crm_prospect_scores enable row level security;
revoke all on public.crm_prospect_scores from public,anon,authenticated;
grant select on public.crm_prospect_scores to authenticated;
grant all on public.crm_prospect_scores to service_role;
drop policy if exists prospect_scores_read on public.crm_prospect_scores;
create policy prospect_scores_read on public.crm_prospect_scores for select to authenticated
 using(workspace_id in(select workspace_id from public.crm_memberships where user_id=(select auth.uid())));

-- Free mailbox providers: a reachable inbox, but not evidence of a business domain.
create or replace function revenue_private.is_free_mail_domain(p_domain text) returns boolean
language sql immutable set search_path='' as $$
 select lower(coalesce(p_domain,'')) = any(array['gmail.com','googlemail.com','yahoo.com','ymail.com','hotmail.com','outlook.com','live.com','msn.com',
  'aol.com','icloud.com','me.com','mac.com','comcast.net','att.net','sbcglobal.net','verizon.net','bellsouth.net','cox.net','charter.net',
  'earthlink.net','protonmail.com','proton.me','mail.com','gmx.com','zoho.com'])
$$;

-- Score every live (unmerged) record in one workspace. Returns how many were scored.
-- Points (100 max before engagement):
--   reachable inbox 30 · business domain 15 (free mail 5) · named person 10 · website 10
--   phone 5 · industry 10 · evidence freshness up to 20
-- Engagement from real message events: a reply +25, a bounce -40.
create or replace function revenue_private.score_prospects(p_workspace uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 with base as (
  select c.workspace_id,c.id customer_id,c.company,c.suppressed,c.identity_review_required,
   nullif(trim(c.email),'') email,nullif(trim(c.name),'') person,nullif(trim(c.website),'') site,
   nullif(trim(c.phone),'') phone,nullif(trim(c.industry),'') industry,
   split_part(nullif(trim(c.email),''),'@',2) domain,
   greatest(c.created_at,(select max(e.observed_at) from public.crm_contact_evidence e where e.workspace_id=c.workspace_id and e.customer_id=c.id)) seen,
   (select max(m.replied_at) from public.revenue_messages m where m.workspace_id=c.workspace_id and m.customer_id=c.id) replied,
   exists(select 1 from public.revenue_messages m where m.workspace_id=c.workspace_id and m.customer_id=c.id and m.failure->>'reason'='bounce') bounced
  from public.crm_customers c
  where c.workspace_id=p_workspace and c.merged_into_id is null
 ), parts as (
  select b.*, (extract(epoch from now()-b.seen)/86400)::integer age_days,
   case when b.email is null then 0 else 30 end p_email,
   case when b.email is null then 0 when revenue_private.is_free_mail_domain(b.domain) then 5 else 15 end p_domain,
   case when b.person is null then 0 else 10 end p_person,
   case when b.site is null then 0 else 10 end p_site,
   case when b.phone is null then 0 else 5 end p_phone,
   case when b.industry is null then 0 else 10 end p_industry,
   case when now()-b.seen<=interval '30 days' then 20 when now()-b.seen<=interval '90 days' then 10 else 0 end p_fresh
  from base b
 ), scored as (
  select p.*,
   greatest(0,least(100,p_email+p_domain+p_person+p_site+p_phone+p_industry+p_fresh
    +case when p.replied is not null then 25 else 0 end-case when p.bounced then 40 else 0 end)) raw
  from parts p
 ), final as (
  select s.*,
   case when s.email is null then least(s.raw,25) else s.raw end total,
   case
    when s.suppressed then 'do_not_contact'
    when s.email is null then 'research'
    when s.raw>=75 then 'ready'
    when s.raw>=55 then 'good'
    else 'nurture' end tier
  from scored s
 )
 insert into public.crm_prospect_scores(workspace_id,customer_id,score,tier,outreach_ready,reasons,missing,scored_at)
 select f.workspace_id,f.customer_id,f.total,f.tier,
  f.tier in ('ready','good') and not f.identity_review_required and not f.bounced,
  to_jsonb(array_remove(array[
   case when f.email is not null then 'Reachable inbox: '||f.email end,
   case when f.email is not null and f.p_domain=15 then 'Business email domain ('||f.domain||')' when f.email is not null then 'Personal email provider ('||f.domain||')' end,
   case when f.person is not null then 'Named contact: '||f.person end,
   case when f.site is not null then 'Website on record' end,
   case when f.phone is not null then 'Phone on record' end,
   case when f.industry is not null then 'Industry: '||f.industry end,
   case when f.p_fresh=20 then 'Evidence seen in the last 30 days' when f.p_fresh=10 then 'Evidence seen in the last 90 days' end,
   case when f.replied is not null then 'Replied on '||to_char(f.replied at time zone 'UTC','YYYY-MM-DD') end,
   case when f.bounced then 'An email to this address bounced' end
  ],null)),
  to_jsonb(array_remove(array[
   case when f.email is null then 'email' end,
   case when f.person is null then 'contact name' end,
   case when f.site is null then 'website' end,
   case when f.phone is null then 'phone' end,
   case when f.industry is null then 'industry' end,
   case when f.p_fresh=0 then 'recent evidence' end,
   case when f.identity_review_required then 'identity review (required before outreach)' end
  ],null)),
  now()
 from final f
 on conflict(workspace_id,customer_id) do update set
  score=excluded.score,tier=excluded.tier,outreach_ready=excluded.outreach_ready,
  reasons=excluded.reasons,missing=excluded.missing,scored_at=excluded.scored_at;
 get diagnostics n=row_count;
 -- Records merged away since the last run no longer have a score of their own.
 delete from public.crm_prospect_scores s using public.crm_customers c
  where s.workspace_id=p_workspace and c.workspace_id=s.workspace_id and c.id=s.customer_id and c.merged_into_id is not null;
 return n;
end $$;

-- Every workspace, for the scheduled rescore.
create or replace function revenue_private.score_all_prospects() returns integer
language plpgsql security definer set search_path='' as $$
declare w uuid; total integer:=0;
begin
 for w in select id from public.crm_workspaces loop
  total:=total+revenue_private.score_prospects(w);
 end loop;
 return total;
end $$;
revoke all on function revenue_private.score_prospects(uuid),revenue_private.score_all_prospects(),revenue_private.is_free_mail_domain(text) from public,anon,authenticated;

-- Rescore now (members and owners).
create or replace function public.revenue_score_prospects(p_workspace uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform revenue_private.require_role(p_workspace,'member');
 return jsonb_build_object('scored',revenue_private.score_prospects(p_workspace));
end $$;

-- The ranked list (anyone in the workspace). Tier filter optional; search on company/email.
create or replace function public.revenue_prospects(p_workspace uuid,p_tier text default null,p_limit integer default 100,p_offset integer default 0,p_q text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare lim integer:=greatest(1,least(coalesce(p_limit,100),1000)); off integer:=greatest(0,coalesce(p_offset,0)); q text:=nullif(trim(coalesce(p_q,'')),'');
begin
 perform revenue_private.require_role(p_workspace,'viewer');
 if p_tier is not null and p_tier not in ('ready','good','nurture','research','do_not_contact','outreach_ready') then
  raise exception '400:Unknown tier.' using errcode='22023';
 end if;
 return jsonb_build_object(
  'counts',(select coalesce(jsonb_object_agg(tier,n),'{}'::jsonb) from (select tier,count(*) n from public.crm_prospect_scores where workspace_id=p_workspace group by tier) t),
  'outreach_ready',(select count(*) from public.crm_prospect_scores where workspace_id=p_workspace and outreach_ready),
  'scored_at',(select max(scored_at) from public.crm_prospect_scores where workspace_id=p_workspace),
  'rows',coalesce((select jsonb_agg(r) from (
   select s.customer_id,c.company,c.name,c.email,c.industry,c.location,c.source,s.score,s.tier,s.outreach_ready,s.reasons,s.missing,s.scored_at
   from public.crm_prospect_scores s join public.crm_customers c on c.workspace_id=s.workspace_id and c.id=s.customer_id
   where s.workspace_id=p_workspace
    and (p_tier is null or (p_tier='outreach_ready' and s.outreach_ready) or s.tier=p_tier)
    and (q is null or c.company ilike '%'||q||'%' or c.email ilike '%'||q||'%')
   order by s.score desc,c.company,s.customer_id
   limit lim offset off) r),'[]'::jsonb)
 );
end $$;
revoke all on function public.revenue_score_prospects(uuid),public.revenue_prospects(uuid,text,integer,integer,text) from public,anon;
grant execute on function public.revenue_score_prospects(uuid),public.revenue_prospects(uuid,text,integer,integer,text) to authenticated;

-- Hourly rescore, so new discoveries, replies and bounces are reflected. Only where pg_cron exists.
do $$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  if exists(select 1 from cron.job where jobname='crm-prospect-scoring') then perform cron.unschedule('crm-prospect-scoring'); end if;
  perform cron.schedule('crm-prospect-scoring','41 * * * *','select revenue_private.score_all_prospects();');
 end if;
end $$;
