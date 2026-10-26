-- Run after revenue-bootstrap.sql, the revenue migrations and the prospect-score migration.
-- Every point must come from a field on the record, every gap must be listed, and only
-- workspace members can see scores.
\set ON_ERROR_STOP 1
begin;
insert into auth.users(id) values ('d0000000-0000-4000-8000-000000000001'),('d0000000-0000-4000-8000-000000000002'),('d0000000-0000-4000-8000-000000000003');
insert into public.crm_workspaces(id,name,owner_id) values
 ('e0000000-0000-4000-8000-000000000001','Scores A','d0000000-0000-4000-8000-000000000001'),
 ('e0000000-0000-4000-8000-000000000002','Scores B','d0000000-0000-4000-8000-000000000002');
insert into public.crm_memberships values
 ('e0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','owner',now()),
 ('e0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000003','viewer',now()),
 ('e0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000002','owner',now());
insert into public.crm_customers(id,workspace_id,company,name,email,industry,website,phone,identity_review_required,suppressed) values
 -- Everything present, business domain, reviewed: 30+15+10+10+5+10+20 = 100.
 ('f0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001','Full Co','Pat Lee','pat@fullco.com','Trucking','https://fullco.com','555-0100',false,false),
 -- Registry-style: inbox on a business domain + industry + fresh, needs identity review: 75.
 ('f0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001','Registry Haulers','','office@haulers.com','Transportation registrant','','',true,false),
 -- Free mail: 30+5+10+20 = 65 → good.
 ('f0000000-0000-4000-8000-000000000003','e0000000-0000-4000-8000-000000000001','Free Mail Shop','','shop@gmail.com','Retail','','',false,false),
 -- No email: research tier, capped at 25.
 ('f0000000-0000-4000-8000-000000000004','e0000000-0000-4000-8000-000000000001','No Inbox LLC','',null,'Business registry','','',true,false),
 -- Suppressed: do not contact.
 ('f0000000-0000-4000-8000-000000000005','e0000000-0000-4000-8000-000000000001','Opted Out Inc','','out@optedout.com','Retail','','',false,true),
 ('f0000000-0000-4000-8000-000000000006','e0000000-0000-4000-8000-000000000002','Other Tenant','','x@other.com','Retail','','',false,false);

select revenue_private.score_all_prospects();

do $$ declare r record; begin
 select * into r from public.crm_prospect_scores where customer_id='f0000000-0000-4000-8000-000000000001';
 if r.score<>100 or r.tier<>'ready' or not r.outreach_ready or jsonb_array_length(r.missing)<>0 then raise exception 'full record scored %/%/%',r.score,r.tier,r.missing; end if;
 select * into r from public.crm_prospect_scores where customer_id='f0000000-0000-4000-8000-000000000002';
 if r.score<>75 or r.tier<>'ready' or r.outreach_ready then raise exception 'registry record scored %/%/% (review must block outreach)',r.score,r.tier,r.outreach_ready; end if;
 if not r.missing ? 'identity review (required before outreach)' or not r.missing ? 'website' or not r.reasons ? 'Business email domain (haulers.com)' then raise exception 'registry reasons/missing wrong: % / %',r.reasons,r.missing; end if;
 select * into r from public.crm_prospect_scores where customer_id='f0000000-0000-4000-8000-000000000003';
 if r.score<>65 or r.tier<>'good' or not r.outreach_ready or not r.reasons ? 'Personal email provider (gmail.com)' then raise exception 'free mail scored %/%/%',r.score,r.tier,r.reasons; end if;
 select * into r from public.crm_prospect_scores where customer_id='f0000000-0000-4000-8000-000000000004';
 if r.score>25 or r.tier<>'research' or r.outreach_ready or not r.missing ? 'email' then raise exception 'no-inbox scored %/%',r.score,r.tier; end if;
 select * into r from public.crm_prospect_scores where customer_id='f0000000-0000-4000-8000-000000000005';
 if r.tier<>'do_not_contact' or r.outreach_ready then raise exception 'suppressed scored %',r.tier; end if;
end $$;

-- A bounce lowers the score and blocks outreach; a reply raises it.
insert into public.revenue_messages(workspace_id,customer_id,direction,purpose,status,to_email,failure,idempotency_key)
 values('e0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000003','outbound','marketing','failed','shop@gmail.com','{"reason":"bounce"}','test-bounce-1');
select revenue_private.score_prospects('e0000000-0000-4000-8000-000000000001');
do $$ declare r record; begin
 select * into r from public.crm_prospect_scores where customer_id='f0000000-0000-4000-8000-000000000003';
 if r.score<>25 or r.outreach_ready or not r.reasons ? 'An email to this address bounced' then raise exception 'bounce scored %/%',r.score,r.reasons; end if;
end $$;

set local role authenticated;
-- The viewer sees their workspace, ranked, and nothing from the other tenant.
set local request.jwt.claim.sub='d0000000-0000-4000-8000-000000000003';
do $$ declare j jsonb; begin
 j:=public.revenue_prospects('e0000000-0000-4000-8000-000000000001');
 if jsonb_array_length(j->'rows')<>5 or j->'rows'->0->>'company'<>'Full Co' then raise exception 'viewer list wrong: %',j; end if;
 if (j->>'outreach_ready')::integer<>1 then raise exception 'outreach_ready count %',j->>'outreach_ready'; end if;
 j:=public.revenue_prospects('e0000000-0000-4000-8000-000000000001','research');
 if jsonb_array_length(j->'rows')<>1 then raise exception 'tier filter wrong: %',j; end if;
 if (select count(*) from public.crm_prospect_scores)<>5 then raise exception 'RLS leaked another workspace'; end if;
 begin perform public.revenue_prospects('e0000000-0000-4000-8000-000000000002'); raise exception 'cross-tenant read allowed';
 exception when insufficient_privilege then null; end;
 -- Viewers cannot trigger a rescore.
 begin perform public.revenue_score_prospects('e0000000-0000-4000-8000-000000000001'); raise exception 'viewer rescore allowed';
 exception when insufficient_privilege then null; end;
 begin insert into public.crm_prospect_scores(workspace_id,customer_id,score,tier,outreach_ready) values('e0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000004',99,'ready',true); raise exception 'direct write allowed';
 exception when insufficient_privilege then null; end;
end $$;
-- The owner can rescore.
set local request.jwt.claim.sub='d0000000-0000-4000-8000-000000000001';
select public.revenue_score_prospects('e0000000-0000-4000-8000-000000000001');
rollback;
\echo prospect scores: all checks passed
