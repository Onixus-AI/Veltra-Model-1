-- Run after revenue-bootstrap.sql and the revenue migrations, on an isolated database.
-- Verifies tenant isolation, role checks, write paths and secret visibility.
\set ON_ERROR_STOP 1
begin;
insert into auth.users(id) values
 ('a0000000-0000-4000-8000-000000000001'),('a0000000-0000-4000-8000-000000000002'),
 ('a0000000-0000-4000-8000-000000000003'),('a0000000-0000-4000-8000-000000000004');
insert into public.crm_workspaces(id,name,owner_id) values
 ('b0000000-0000-4000-8000-000000000001','Workspace A','a0000000-0000-4000-8000-000000000001'),
 ('b0000000-0000-4000-8000-000000000002','Workspace B','a0000000-0000-4000-8000-000000000004');
insert into public.crm_memberships values
 ('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','owner',now()),
 ('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002','member',now()),
 ('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000003','viewer',now()),
 ('b0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000004','owner',now());
insert into public.crm_mail_connections(account_id,workspace_id,token_hash,connected_by) values
 ('c0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001',encode(sha256(convert_to(repeat('m',48),'UTF8')),'hex'),'a0000000-0000-4000-8000-000000000001');

set local role authenticated;
-- Member creates a customer and an owner-only memory is recorded by the owner.
set local request.jwt.claim.sub='a0000000-0000-4000-8000-000000000002';
create temp table ids as select (public.revenue_upsert_customer('b0000000-0000-4000-8000-000000000001','{"email":"Pat@Example.com","name":"Pat Lee","company":"Example Co"}')->>'customer_id')::uuid as customer;
grant select on ids to public;
set local request.jwt.claim.sub='a0000000-0000-4000-8000-000000000001';
select public.revenue_record_memory('b0000000-0000-4000-8000-000000000001',(select customer from ids),'Prefers invoices in EUR','fact','Owner note','note:1',null,'owners');
select public.revenue_record_memory('b0000000-0000-4000-8000-000000000001',(select customer from ids),'Budget approved for Q1','fact','Owner call','call:1',null,'workspace');

do $$ declare n integer; begin
 -- Member sees workspace memory but not owner-only memory, in tables and in shared context.
 perform set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000002',true);
 select count(*) into n from public.crm_memories; if n<>1 then raise exception 'member sees % memories, expected 1',n; end if;
 if jsonb_array_length(public.revenue_customer_context('b0000000-0000-4000-8000-000000000001',(select customer from ids))->'memory'->'facts')<>1 then raise exception 'context leaked owner-only memory'; end if;
 -- Viewer cannot write.
 perform set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000003',true);
 begin perform public.revenue_draft_message('b0000000-0000-4000-8000-000000000001','{"to":"pat@example.com","subject":"x","body":"y"}'); raise exception 'viewer drafted';
 exception when insufficient_privilege then null; end;
 if (select count(*) from public.revenue_events)=0 then raise exception 'viewer cannot read timeline'; end if;
 -- Member cannot change owner controls.
 perform set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000002',true);
 begin perform public.revenue_set_controls('b0000000-0000-4000-8000-000000000001',true,'test'); raise exception 'member paused automation';
 exception when insufficient_privilege then null; end;
 begin perform public.revenue_set_workflow('b0000000-0000-4000-8000-000000000001','follow_up_no_reply',true,true); raise exception 'member authorized auto-send';
 exception when insufficient_privilege then null; end;
 -- Direct writes to new tables are refused for every role.
 begin insert into public.revenue_events(workspace_id,kind,source,actor_type,occurred_at,summary,dedupe_key) values('b0000000-0000-4000-8000-000000000001','x.y','crm','user',now(),'x','x'); raise exception 'direct event insert';
 exception when insufficient_privilege then null; end;
 begin update public.revenue_messages set status='delivered'; raise exception 'direct message update';
 exception when insufficient_privilege then null; end;
 -- Other workspace owner sees nothing and cannot act on workspace A.
 perform set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000004',true);
 select count(*) into n from public.crm_customers; if n<>0 then raise exception 'cross-workspace customer read'; end if;
 select count(*) into n from public.revenue_events; if n<>0 then raise exception 'cross-workspace event read'; end if;
 select count(*) into n from public.crm_memories; if n<>0 then raise exception 'cross-workspace memory read'; end if;
 begin perform public.revenue_customer_context('b0000000-0000-4000-8000-000000000001',(select customer from ids)); raise exception 'cross-workspace context';
 exception when insufficient_privilege then null; end;
 begin perform public.revenue_overview('b0000000-0000-4000-8000-000000000001',null,null); raise exception 'cross-workspace overview';
 exception when insufficient_privilege then null; end;
 begin perform public.revenue_merge_customers('b0000000-0000-4000-8000-000000000001',(select customer from ids),(select customer from ids)); raise exception 'cross-workspace merge';
 exception when insufficient_privilege then null; end;
 -- Workspace B cannot attach workspace A's customer to its own records.
 begin perform public.revenue_create_proposal('b0000000-0000-4000-8000-000000000002',(select customer from ids),null,'Steal',1000,'USD'); raise exception 'cross-workspace proposal';
 exception when raise_exception then if sqlerrm not like '404:%' then raise; end if; end;
end $$;

-- Integration secrets are not readable, even by owners.
set local request.jwt.claim.sub='a0000000-0000-4000-8000-000000000001';
select public.revenue_create_integration('b0000000-0000-4000-8000-000000000001','form','Website',encode(sha256(convert_to(repeat('f',48),'UTF8')),'hex'));
do $$ begin
 begin perform token_hash from public.revenue_integrations; raise exception 'token hash readable';
 exception when insufficient_privilege then null; end;
 if (select count(*) from public.revenue_integrations)<>1 then raise exception 'owner cannot see integration status'; end if;
end $$;
reset role;

-- Anonymous callers: only token-authorized ingestion is reachable, and bad tokens are refused.
set local role anon;
do $$ begin
 begin perform public.revenue_upsert_customer('b0000000-0000-4000-8000-000000000001','{"email":"x@example.com"}'); raise exception 'anon upsert';
 exception when insufficient_privilege then null; end;
 begin perform public.revenue_ingest_mail_event('c0000000-0000-4000-8000-000000000001',repeat('x',48),'{"type":"sync.status","status":"healthy"}'); raise exception 'bad mail token accepted';
 exception when insufficient_privilege then null; end;
 begin perform public.revenue_worker_claim(repeat('w',48),'w',1); raise exception 'bad worker token accepted';
 exception when insufficient_privilege then null; end;
 begin perform public.revenue_ingest_form(gen_random_uuid(),repeat('f',48),'{}'); raise exception 'bad form integration accepted';
 exception when insufficient_privilege then null; end;
 begin perform public.revenue_mail_claim('c0000000-0000-4000-8000-000000000001',repeat('x',48),'w',1); raise exception 'bad mail token claimed sends';
 exception when insufficient_privilege then null; end;
 begin perform public.revenue_mail_complete('c0000000-0000-4000-8000-000000000001',repeat('x',48),gen_random_uuid(),'w','{"ok":true}'); raise exception 'bad mail token completed a send';
 exception when insufficient_privilege then null; end;
 begin perform public.revenue_mail_account_state('c0000000-0000-4000-8000-000000000001',repeat('x',48)); raise exception 'bad mail token read sync state';
 exception when insufficient_privilege then null; end;
 begin perform public.revenue_mail_calendar_event('c0000000-0000-4000-8000-000000000001',repeat('x',48),'{}'); raise exception 'bad mail token recorded a meeting';
 exception when insufficient_privilege then null; end;
 begin perform public.revenue_mail_calendar_status('c0000000-0000-4000-8000-000000000001',repeat('x',48),'{"status":"healthy"}'); raise exception 'bad mail token changed calendar health';
 exception when insufficient_privilege then null; end;
 begin perform public.revenue_ingest_calendar_event(gen_random_uuid(),repeat('c',48),'{}'); raise exception 'bad calendar integration accepted';
 exception when insufficient_privilege then null; end;
 begin perform revenue_private.ingest_calendar('b0000000-0000-4000-8000-000000000001','google_calendar','x','{}','{}',true,true); raise exception 'anon reached a private calendar function';
 exception when insufficient_privilege then null; end;
 begin perform revenue_private.complete_job(gen_random_uuid(),'w','{"ok":true}'); raise exception 'anon reached a private job function';
 exception when insufficient_privilege then null; end;
 begin perform * from public.revenue_calendar_sync_state; raise exception 'anon read calendar sync state';
 exception when insufficient_privilege then null; end;
 perform public.revenue_ingest_mail_event('c0000000-0000-4000-8000-000000000001',repeat('m',48),'{"type":"sync.status","status":"healthy","mailbox":"sales@a.example"}');
 perform public.revenue_mail_calendar_status('c0000000-0000-4000-8000-000000000001',repeat('m',48),'{"status":"healthy","sync_token":"tok-1"}');
 if (public.revenue_mail_account_state('c0000000-0000-4000-8000-000000000001',repeat('m',48))->'calendar'->>'status')<>'healthy' then raise exception 'valid mail token cannot read its own state'; end if;
end $$;
reset role;
do $$ begin
 if (select status from public.revenue_sync_state)<>'healthy' then raise exception 'valid mail token was refused'; end if;
end $$;
-- Calendar sync state: members of the workspace read health (never the sync token); others see nothing.
set local role authenticated;
do $$ declare n integer; begin
 perform set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000003',true);
 select count(*) into n from public.revenue_calendar_sync_state; if n<>1 then raise exception 'viewer cannot see calendar health'; end if;
 begin perform sync_token from public.revenue_calendar_sync_state; raise exception 'calendar sync token readable';
 exception when insufficient_privilege then null; end;
 begin update public.revenue_calendar_sync_state set status='healthy'; raise exception 'direct calendar state update';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000004',true);
 select count(*) into n from public.revenue_calendar_sync_state; if n<>0 then raise exception 'cross-workspace calendar health read'; end if;
end $$;
reset role;
rollback;
\echo 'revenue isolation tests passed'
