-- Run after revenue-bootstrap.sql and the revenue migrations, on an isolated database.
-- Reply threading: the Message-ID columns are additive and nullable, hold only well-formed ids,
-- stay inside the workspace, and the send lease threads on the latest message in the thread.
\set ON_ERROR_STOP 1
begin;
do $$ begin
 if (select count(*) from information_schema.columns where table_schema='public' and table_name='revenue_messages'
     and column_name in ('message_id_header','references_header') and is_nullable='YES' and column_default is null)<>2 then
  raise exception 'threading columns must exist, be nullable and have no default';
 end if;
end $$;

insert into auth.users(id) values ('a1000000-0000-4000-8000-000000000001'),('a1000000-0000-4000-8000-000000000002'),('a1000000-0000-4000-8000-000000000003');
insert into public.crm_workspaces(id,name,owner_id) values
 ('b1000000-0000-4000-8000-000000000001','Threads A','a1000000-0000-4000-8000-000000000001'),
 ('b1000000-0000-4000-8000-000000000002','Threads B','a1000000-0000-4000-8000-000000000003');
insert into public.crm_memberships values
 ('b1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','owner',now()),
 ('b1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','viewer',now()),
 ('b1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000003','owner',now());
insert into public.crm_mail_connections(account_id,workspace_id,token_hash,connected_by) values
 ('c1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001',encode(sha256(convert_to(repeat('t',48),'UTF8')),'hex'),'a1000000-0000-4000-8000-000000000001');

-- Mail ingests through its link token (anon role, as PostgREST runs it).
set local role anon;
do $$ declare acct uuid := 'c1000000-0000-4000-8000-000000000001'; begin
 perform public.revenue_ingest_mail_event(acct,repeat('t',48),jsonb_build_object('type','message.inbound','provider_message_id','g1','thread_id','th1','to','sales@a.example',
  'from_email','pat@customer.example','from_name','Pat','subject','Quote','text','Hi','occurred_at',now()-interval '2 hours','message_id_header','<root@customer.example>'));
 perform public.revenue_ingest_mail_event(acct,repeat('t',48),jsonb_build_object('type','message.outbound_observed','provider_message_id','g2','thread_id','th1','to','pat@customer.example',
  'from_email','sales@a.example','subject','Re: Quote','text','Sure','occurred_at',now()-interval '1 hour','message_id_header','<ours@a.example>',
  'in_reply_to','<root@customer.example>','references','<root@customer.example>'));
 perform public.revenue_ingest_mail_event(acct,repeat('t',48),jsonb_build_object('type','message.inbound','provider_message_id','g3','thread_id','th1','to','sales@a.example',
  'from_email','pat@customer.example','subject','Re: Quote','text','Thanks','occurred_at',now()-interval '10 minutes',
  'message_id_header',E'<latest@customer.example>\r\nBcc: evil@x.example','in_reply_to','<ours@a.example>','references',E'<root@customer.example>\r\n <ours@a.example> junk'));
 perform public.revenue_ingest_mail_event(acct,repeat('t',48),jsonb_build_object('type','message.inbound','provider_message_id','g4','thread_id','th2','to','sales@a.example',
  'from_email','pat@customer.example','subject','No id','text','Hi','occurred_at',now()-interval '5 minutes','message_id_header','not an id','in_reply_to','18c2f0a9b3'));
 -- A bad token writes nothing.
 begin perform public.revenue_ingest_mail_event(acct,repeat('x',48),'{"type":"message.inbound","provider_message_id":"g9","thread_id":"th1","message_id_header":"<x@y>"}'); raise exception 'bad token ingested';
 exception when insufficient_privilege then null; end;
 begin perform revenue_private.msg_ids('<a@b>'); raise exception 'anon reached a private threading function';
 exception when insufficient_privilege then null; end;
end $$;
reset role;

do $$ declare r record; begin
 select message_id_header,in_reply_to,references_header into r from public.revenue_messages where provider_message_id='g3';
 if r.message_id_header is distinct from '<latest@customer.example>' or r.in_reply_to is distinct from '<ours@a.example>'
   or r.references_header is distinct from '<root@customer.example> <ours@a.example>' then raise exception 'inbound ids not sanitized: %', row_to_json(r); end if;
 select message_id_header,in_reply_to into r from public.revenue_messages where provider_message_id='g4';
 if r.message_id_header is not null or r.in_reply_to is not null then raise exception 'malformed ids were stored'; end if;
 if (select message_id_header from public.revenue_messages where provider_message_id='g2')<>'<ours@a.example>' then raise exception 'observed outbound id not stored'; end if;
 -- The constraints refuse anything but well-formed ids, even for privileged writers.
 begin update public.revenue_messages set message_id_header=E'<a@b>\r\nBcc: x@y' where provider_message_id='g4'; raise exception 'CRLF Message-ID accepted';
 exception when check_violation then null; end;
 begin update public.revenue_messages set references_header='<a@b> text' where provider_message_id='g4'; raise exception 'malformed References accepted';
 exception when check_violation then null; end;
end $$;

-- A re-synced message fills a missing Message-ID but never overwrites one.
set local role anon;
select public.revenue_ingest_mail_event('c1000000-0000-4000-8000-000000000001',repeat('t',48),jsonb_build_object('type','message.inbound','provider_message_id','g4','thread_id','th2',
 'from_email','pat@customer.example','subject','No id','text','Hi','occurred_at',now()-interval '5 minutes','message_id_header','<late@customer.example>'))->>'duplicate' as resynced;
select public.revenue_ingest_mail_event('c1000000-0000-4000-8000-000000000001',repeat('t',48),jsonb_build_object('type','message.inbound','provider_message_id','g4','thread_id','th2',
 'from_email','pat@customer.example','subject','No id','text','Hi','occurred_at',now()-interval '5 minutes','message_id_header','<other@customer.example>'))->>'duplicate' as resynced_again;
reset role;
do $$ begin
 if (select message_id_header from public.revenue_messages where provider_message_id='g4')<>'<late@customer.example>' then raise exception 'missing Message-ID not filled once'; end if;
end $$;

-- Members read the ids; other workspaces see nothing; nobody writes them directly.
set local role authenticated;
do $$ declare n integer; begin
 perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
 select count(*) into n from public.revenue_messages where message_id_header is not null; if n<>4 then raise exception 'viewer sees % threaded messages, expected 4',n; end if;
 begin update public.revenue_messages set message_id_header='<forged@x.example>'; raise exception 'direct Message-ID update';
 exception when insufficient_privilege then null; end;
 begin perform revenue_private.references_chain(array['<a@b>']); raise exception 'authenticated reached a private threading function';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000003',true);
 select count(*) into n from public.revenue_messages; if n<>0 then raise exception 'cross-workspace message read'; end if;
 -- The owner drafts and approves replies (one per thread).
 perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
 perform public.revenue_approve_message('b1000000-0000-4000-8000-000000000001',(public.revenue_draft_message('b1000000-0000-4000-8000-000000000001',
  '{"to":"pat@customer.example","subject":"","body":"Here you go","account_id":"c1000000-0000-4000-8000-000000000001","thread_id":"th1","idempotency_key":"reply-th1"}')->>'message_id')::uuid);
 perform public.revenue_approve_message('b1000000-0000-4000-8000-000000000001',(public.revenue_draft_message('b1000000-0000-4000-8000-000000000001',
  '{"to":"pat@customer.example","subject":"Hello","body":"New topic","account_id":"c1000000-0000-4000-8000-000000000001","thread_id":"th3","in_reply_to":"18c2f0a9b3","idempotency_key":"reply-th3"}')->>'message_id')::uuid);
end $$;
reset role;

-- The lease threads the reply on the latest message in the thread; without a valid id there are no threading headers.
set local role anon;
create temp table leased as select jsonb_array_elements(public.revenue_mail_claim('c1000000-0000-4000-8000-000000000001',repeat('t',48),'threading-test',10)->'jobs')->'message' as m;
reset role;
do $$ declare r jsonb; begin
 if (select count(*) from leased)<>2 then raise exception 'expected 2 leased sends, got %',(select count(*) from leased); end if;
 select m into r from leased where m->>'thread_id'='th1';
 if r->>'in_reply_to' is distinct from '<latest@customer.example>' or r->>'references' is distinct from '<root@customer.example> <ours@a.example> <latest@customer.example>'
   or r->>'subject' is distinct from 'Re: Quote' then raise exception 'reply not threaded: %', r; end if;
 select m into r from leased where m->>'thread_id'='th3';
 if r->'in_reply_to'<>'null'::jsonb or r->'references'<>'null'::jsonb or r->>'subject'<>'Hello' then raise exception 'unthreaded send got headers: %', r; end if;
 if (select in_reply_to from public.revenue_messages where idempotency_key='reply-th3')<>'18c2f0a9b3' then raise exception 'unthreaded draft was rewritten'; end if;
 if (select references_header from public.revenue_messages where idempotency_key='reply-th1')<>'<root@customer.example> <ours@a.example> <latest@customer.example>' then raise exception 'reply references not recorded'; end if;
end $$;

-- Completing the send records the Message-ID Mail sent with; a malformed one is ignored.
create temp table sends as select m.idempotency_key k, rj.id job from public.revenue_jobs rj join public.revenue_messages m on m.id=rj.message_id where m.idempotency_key in ('reply-th1','reply-th3');
grant select on sends to public;
set local role anon;
do $$ begin
 perform public.revenue_mail_complete('c1000000-0000-4000-8000-000000000001',repeat('t',48),(select job from sends where k='reply-th1'),'threading-test',
  '{"ok":true,"provider_message_id":"g10","provider_thread_id":"th1","message_id_header":"<onixus-x@onixus.mail>"}');
 perform public.revenue_mail_complete('c1000000-0000-4000-8000-000000000001',repeat('t',48),(select job from sends where k='reply-th3'),'threading-test',
  jsonb_build_object('ok',true,'provider_message_id','g11','provider_thread_id','th3','message_id_header',E'bad\r\nBcc: x'));
end $$;
reset role;
do $$ begin
 if (select message_id_header from public.revenue_messages where idempotency_key='reply-th1')<>'<onixus-x@onixus.mail>' then raise exception 'sent Message-ID not recorded'; end if;
 if (select message_id_header from public.revenue_messages where idempotency_key='reply-th3') is not null then raise exception 'malformed sent Message-ID recorded'; end if;
end $$;
rollback;
\echo 'revenue threading tests passed'
