-- Onixus revenue system, reply threading: replies sent through the Onixus Mail relay carry
-- In-Reply-To and References, so they thread for the recipient as well as in the sending Gmail.
--
--  * revenue_messages.message_id_header / references_header (new, nullable): the RFC 5322
--    Message-ID and References of each synced or sent message. Existing rows are not touched;
--    a message synced again later fills a missing Message-ID.
--  * lease_send threads a reply on the latest received or sent message in the same mailbox thread
--    that has a Message-ID; with none it falls back to the draft's own in_reply_to, and with
--    neither the message is sent without threading headers, as before.
--  * complete_job records the Message-ID Mail sent with.
-- Only well-formed <id@domain> values are stored or sent, so a header value cannot carry CR/LF.
begin;

alter table public.revenue_messages add column if not exists message_id_header text;
alter table public.revenue_messages add column if not exists references_header text;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.revenue_messages'::regclass and conname='revenue_messages_message_id_header_check') then
  alter table public.revenue_messages add constraint revenue_messages_message_id_header_check
   check(message_id_header is null or (length(message_id_header)<=250 and message_id_header ~ '^<[!-;=?-~]+@[!-;=?-~]+>$'));
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.revenue_messages'::regclass and conname='revenue_messages_references_header_check') then
  alter table public.revenue_messages add constraint revenue_messages_references_header_check
   check(references_header is null or (length(references_header)<=5100 and references_header ~ '^<[!-;=?-~]+@[!-;=?-~]+>( <[!-;=?-~]+@[!-;=?-~]+>)*$'));
 end if;
end $$;

-- Well-formed msg-ids in a header value, first occurrence order, duplicates removed.
create or replace function revenue_private.msg_ids(p text) returns text[] language sql immutable set search_path='' as $$
 select coalesce(array_agg(id order by first),'{}') from (
  select r.m[1] id, min(r.o) first from regexp_matches(left(coalesce(p,''),20000),'<[!-;=?-~]+@[!-;=?-~]+>','g') with ordinality r(m,o)
  where length(r.m[1])<=250 group by r.m[1]) s
$$;
-- A References chain of at most 20 ids: the thread root is kept, then the most recent ones.
create or replace function revenue_private.references_chain(p_ids text[]) returns text language sql immutable set search_path='' as $$
 select nullif(array_to_string(case when cardinality(p_ids)<=20 then p_ids else p_ids[1:1]||p_ids[cardinality(p_ids)-18:cardinality(p_ids)] end,' '),'')
$$;

-- Leases one queued mail.send job, or returns null when it must not be sent now (message no longer
-- queued, recipient suppressed or without consent, daily send limit reached). p_account assigns a
-- message that has no mailbox yet to the mailbox that is sending it.
create or replace function revenue_private.lease_send(p_job public.revenue_jobs, p_worker text, p_account uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.revenue_messages; ctl public.revenue_controls; block text; sent integer; ident public.revenue_sender_identities;
 parent public.revenue_messages; irt text; refs text;
begin
 select * into m from public.revenue_messages where id=p_job.message_id for update;
 if m.status<>'queued' then
  update public.revenue_jobs set status='cancelled',cancel_reason='Message is '||m.status,finished_at=now(),updated_at=now() where id=p_job.id;
  return null;
 end if;
 block := revenue_private.block_reason(p_job.workspace_id,m.to_email,m.purpose);
 if block is not null then
  update public.revenue_jobs set status='cancelled',cancel_reason='Recipient blocked: '||block,finished_at=now(),updated_at=now() where id=p_job.id;
  perform revenue_private.transition_message(m.id,'cancelled',jsonb_build_object('failure',jsonb_build_object('reason',block)),'email.cancelled','Send stopped: recipient is '||replace(block,'_',' '),'automation','system','email.cancelled:'||m.id,
   'Review consent and suppression for this customer.');
  return null;
 end if;
 select * into ctl from public.revenue_controls where workspace_id=p_job.workspace_id;
 select count(*) into sent from public.revenue_messages where workspace_id=p_job.workspace_id and direction='outbound' and provider_accepted_at>=date_trunc('day',now()) and approval_source<>'external';
 sent := sent + (select count(*) from public.revenue_jobs where workspace_id=p_job.workspace_id and kind='mail.send' and status='running');
 if sent>=coalesce(ctl.daily_send_limit,200) then
  update public.revenue_jobs set run_at=date_trunc('day',now())+interval '1 day',last_error='Daily send limit reached',updated_at=now() where id=p_job.id;
  insert into public.revenue_job_runs(job_id,workspace_id,attempt,worker,finished_at,outcome,error) values(p_job.id,p_job.workspace_id,p_job.attempts,p_worker,now(),'deferred','Daily send limit reached');
  return null;
 end if;
 if p_account is not null and m.account_id is null then
  update public.revenue_messages set account_id=p_account,updated_at=now() where id=m.id;
  m.account_id := p_account;
 end if;
 update public.revenue_jobs set status='running',attempts=attempts+1,locked_by=p_worker,locked_until=now()+interval '5 minutes',updated_at=now() where id=p_job.id;
 insert into public.revenue_job_runs(job_id,workspace_id,attempt,worker,outcome) values(p_job.id,p_job.workspace_id,p_job.attempts+1,p_worker,'running');
 select * into ident from public.revenue_sender_identities where id=m.sender_identity_id;
 if m.account_id is not null and m.thread_id is not null then
  select * into parent from public.revenue_messages where workspace_id=m.workspace_id and account_id=m.account_id and thread_id=m.thread_id and id<>m.id
   and message_id_header is not null and status in ('received','provider_accepted','delivered','replied')
   order by coalesce(provider_accepted_at,occurred_at) desc, created_at desc limit 1;
 end if;
 if parent.id is not null then
  irt := parent.message_id_header;
  refs := revenue_private.references_chain(array(select x from unnest(revenue_private.msg_ids(coalesce(parent.references_header,parent.in_reply_to))) x where x<>irt)||irt);
 else
  irt := (revenue_private.msg_ids(m.in_reply_to))[1];
  refs := irt;
 end if;
 if irt is not null then
  update public.revenue_messages set in_reply_to=irt,references_header=refs,updated_at=now() where id=m.id;
 end if;
 return jsonb_build_object('job_id',p_job.id,'kind',p_job.kind,'workspace_id',p_job.workspace_id,'attempt',p_job.attempts+1,
  'message',jsonb_build_object('id',m.id,'account_id',m.account_id,'thread_id',m.thread_id,'to',m.to_email,'cc',m.cc,
   'subject',case when irt is not null and btrim(m.subject)='' and parent.id is not null then parent.subject else m.subject end,
   'body',m.body||case when coalesce(m.signature_snapshot,'')<>'' and position(m.signature_snapshot in m.body)=0 then E'\n\n'||m.signature_snapshot else '' end,
   'from_email',coalesce(ident.email,m.from_email),'from_name',ident.display_name,'reply_to',m.reply_to_snapshot,'in_reply_to',irt,'references',refs,
   'attachments',m.attachments,'idempotency_key','onixus-'||m.id));
end $$;

-- Records a send outcome. Success means "accepted by the provider" only; delivery needs an
-- explicit provider signal. Retryable failures back off 30s, 60s, ... capped at 1 hour.
create or replace function revenue_private.complete_job(p_job uuid, p_worker text, p_result jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.revenue_jobs; m public.revenue_messages; delay interval; code text := p_result->'error'->>'code'; msg text := left(p_result->'error'->>'message',500); final boolean;
begin
 select * into j from public.revenue_jobs where id=p_job for update;
 if j.id is null or j.status<>'running' or j.locked_by is distinct from p_worker then
  return jsonb_build_object('ignored','job_not_leased_by_worker');
 end if;
 select * into m from public.revenue_messages where id=j.message_id for update;
 if coalesce((p_result->>'ok')::boolean,false) then
  if nullif(p_result->>'provider_message_id','') is null then raise exception '400:A provider message id is required to record a send.'; end if;
  update public.revenue_jobs set status='succeeded',locked_by=null,locked_until=null,last_error=null,finished_at=now(),updated_at=now() where id=j.id;
  update public.revenue_job_runs set finished_at=now(),outcome='succeeded',detail=jsonb_build_object('provider_message_id',p_result->>'provider_message_id') where job_id=j.id and outcome='running';
  perform revenue_private.transition_message(m.id,'provider_accepted',jsonb_build_object('provider_message_id',p_result->>'provider_message_id','provider_thread_id',p_result->>'provider_thread_id',
    'detail',jsonb_build_object('provider_message_id',p_result->>'provider_message_id','delivery_confirmed',false)),
   'email.provider_accepted','Accepted by '||coalesce(p_result->>'provider','the mail provider')||'. Delivery is not confirmed yet.','gmail','provider','email.accepted:'||m.id);
  update public.revenue_messages set message_id_header=(revenue_private.msg_ids(p_result->>'message_id_header'))[1]
   where id=m.id and message_id_header is null and (revenue_private.msg_ids(p_result->>'message_id_header'))[1] is not null;
  if m.account_id is not null and m.customer_id is not null and coalesce(m.thread_id,p_result->>'provider_thread_id') is not null then
   insert into public.crm_mail_threads(account_id,thread_id,workspace_id,customer_id,subject,last_event_at,state,last_outbound_at)
   values(m.account_id,coalesce(m.thread_id,p_result->>'provider_thread_id'),m.workspace_id,m.customer_id,m.subject,now(),'waiting_on_customer',now())
   on conflict(workspace_id,account_id,thread_id) do update set last_outbound_at=now(),last_event_at=now(),
    state=case when public.crm_mail_threads.last_inbound_at>now() then public.crm_mail_threads.state else 'waiting_on_customer' end,
    reply_lock_by=null,reply_lock_until=null;
   update public.crm_tasks set status='done',completed_at=now() where workspace_id=m.workspace_id and action_key=md5('reply:'||m.account_id||':'||coalesce(m.thread_id,p_result->>'provider_thread_id'))::uuid and status='open';
  end if;
  return jsonb_build_object('job_id',j.id,'status','succeeded','message_status','provider_accepted');
 end if;
 final := not coalesce((p_result->>'retryable')::boolean,false) or j.attempts>=j.max_attempts;
 if final then
  update public.revenue_jobs set status='dead',locked_by=null,locked_until=null,last_error=coalesce(msg,code,'Send failed'),finished_at=now(),updated_at=now() where id=j.id;
  update public.revenue_job_runs set finished_at=now(),outcome='dead',error=coalesce(msg,code) where job_id=j.id and outcome='running';
  perform revenue_private.transition_message(m.id,'failed',jsonb_build_object('failure',jsonb_build_object('reason',coalesce(code,'send_failed'),'detail',msg,'attempts',j.attempts)),
   'email.failed','Send failed: '||coalesce(msg,code,'unknown error'),'gmail','provider','email.failed:'||m.id||':'||j.attempts||':'||now()::text,
   case code
    when 'auth_expired' then 'Reconnect Google in Onixus Mail, then retry this message.'
    when 'invalid_recipient' then 'Correct the recipient address, then retry this message.'
    when 'sender_not_allowed' then 'Choose a sender identity that matches the connected mailbox or one of its verified Gmail send-as addresses, then retry.'
    when 'provider_unavailable' then 'Connect the sending mailbox in Onixus Mail for this workspace, then retry.'
    when 'rate_limited' then 'Gmail kept rate limiting this mailbox. Retry later or lower the daily send limit.'
    else 'Check the error, fix the cause, then retry this message.' end);
  if code='auth_expired' and m.account_id is not null then
   insert into public.revenue_sync_state(workspace_id,account_id,status,last_attempt_at,last_error) values(m.workspace_id,m.account_id,'expired',now(),msg)
   on conflict(workspace_id,account_id) do update set status='expired',last_attempt_at=now(),last_error=excluded.last_error;
  end if;
  return jsonb_build_object('job_id',j.id,'status','dead','message_status','failed');
 end if;
 delay := least(make_interval(secs=>30*power(2,j.attempts-1)), interval '1 hour');
 update public.revenue_jobs set status='queued',locked_by=null,locked_until=null,run_at=now()+delay,last_error=coalesce(msg,code),updated_at=now() where id=j.id;
 update public.revenue_job_runs set finished_at=now(),outcome='retry',error=coalesce(msg,code) where job_id=j.id and outcome='running';
 update public.revenue_messages set failure=jsonb_build_object('reason',coalesce(code,'temporary'),'detail',msg,'retrying_at',now()+delay),updated_at=now() where id=m.id;
 return jsonb_build_object('job_id',j.id,'status','queued','retry_in_seconds',extract(epoch from delay));
end $$;

-- ---------- Onixus Mail service ingestion (account-bound token, existing pattern) ----------
create or replace function public.revenue_ingest_mail_event(p_account uuid, p_token text, p_event jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid := crm_private.mail_workspace(p_account,p_token); ty text := p_event->>'type'; r jsonb; c uuid; m uuid; prior public.revenue_messages;
 th text := nullif(p_event->>'thread_id',''); pid text := nullif(p_event->>'provider_message_id',''); at timestamptz := coalesce((p_event->>'occurred_at')::timestamptz,now());
 n integer; em text; t public.crm_mail_threads; j record;
 mid text := (revenue_private.msg_ids(p_event->>'message_id_header'))[1]; irt text := (revenue_private.msg_ids(p_event->>'in_reply_to'))[1];
 refs text := revenue_private.references_chain(revenue_private.msg_ids(p_event->>'references'));
begin
 if at>now()+interval '10 minutes' then raise exception '400:Event time is in the future.'; end if;
 if ty='message.inbound' then
  if pid is null or th is null then raise exception '400:Inbound messages need provider message and thread ids.'; end if;
  if exists(select 1 from public.revenue_messages where workspace_id=w and account_id=p_account and provider_message_id=pid) then
   update public.revenue_messages set message_id_header=mid,references_header=coalesce(references_header,refs)
    where workspace_id=w and account_id=p_account and provider_message_id=pid and message_id_header is null and mid is not null;
   return jsonb_build_object('duplicate',true);
  end if;
  select * into t from public.crm_mail_threads where workspace_id=w and account_id=p_account and thread_id=th;
  if coalesce((p_event->>'automated')::boolean,false) then
   if t.thread_id is null then return jsonb_build_object('ignored','automated_sender_without_customer_thread'); end if;
   c := t.customer_id;
  elsif t.thread_id is not null then
   c := t.customer_id;
  else
   r := revenue_private.resolve_identity(w,p_event->>'from_email',null,p_event->>'from_name',null,'Onixus Mail',jsonb_build_object('account_id',p_account,'thread_id',th));
   c := (r->>'customer_id')::uuid;
  end if;
  insert into public.revenue_messages(workspace_id,customer_id,account_id,thread_id,direction,purpose,status,to_email,from_email,subject,body,in_reply_to,attachments,untrusted,provider_message_id,idempotency_key,occurred_at,
         message_id_header,references_header)
  values(w,c,p_account,th,'inbound','inbound','received',lower(p_event->>'to'),lower(p_event->>'from_email'),left(coalesce(p_event->>'subject',''),500),left(coalesce(p_event->>'text',''),100000),
         irt,coalesce(p_event->'attachments','[]'),true,pid,'inbound:'||p_account||':'||pid,at,mid,refs) returning id into m;
  insert into public.crm_mail_threads(account_id,thread_id,workspace_id,customer_id,subject,last_event_at,state,last_inbound_at,unanswered_questions)
  values(p_account,th,w,c,left(coalesce(p_event->>'subject',''),500),at,'waiting_on_us',at,p_event->'analysis'->'questions')
  on conflict(workspace_id,account_id,thread_id) do update set last_event_at=greatest(public.crm_mail_threads.last_event_at,excluded.last_event_at),
   last_inbound_at=greatest(coalesce(public.crm_mail_threads.last_inbound_at,excluded.last_inbound_at),excluded.last_inbound_at),
   state=case when excluded.last_inbound_at>=coalesce(public.crm_mail_threads.last_outbound_at,'-infinity') then 'waiting_on_us' else public.crm_mail_threads.state end,
   unanswered_questions=coalesce(excluded.unanswered_questions,public.crm_mail_threads.unanswered_questions);
  perform revenue_private.record_event(w,c,null,'email.received','gmail','customer',p_event->>'from_email',at,'received','message',m,
   'Email received: '||left(coalesce(p_event->>'subject','(no subject)'),300),
   jsonb_build_object('from',p_event->>'from_email','automated',coalesce((p_event->>'automated')::boolean,false),'questions',coalesce(p_event->'analysis'->'questions','[]'),'identity',r,'untrusted_content',true),
   jsonb_build_object('thread_id',th,'account_id',p_account),'email.received:'||p_account||':'||pid);
  -- A reply marks our latest sent message as replied and stops pending follow-ups.
  if not coalesce((p_event->>'automated')::boolean,false) then
   for prior in select * from public.revenue_messages where workspace_id=w and account_id=p_account and thread_id=th and direction='outbound' and status in ('provider_accepted','delivered') and coalesce(provider_accepted_at,created_at)<=at loop
    perform revenue_private.transition_message(prior.id,'replied',jsonb_build_object('at',at),'email.replied','Customer replied','gmail','customer','email.replied:'||prior.id);
   end loop;
   for j in update public.revenue_jobs set status='cancelled',cancel_reason='Customer replied',finished_at=now(),updated_at=now()
     where workspace_id=w and kind='mail.follow_up' and status='queued' and (payload->>'thread_id'=th or customer_id=c) returning id,customer_id loop
    perform revenue_private.record_event(w,j.customer_id,null,'follow_up.cancelled','automation','system',null,now(),'cancelled','job',j.id,'Follow-up stopped because the customer replied','{}','{}','follow_up.cancelled:'||j.id);
   end loop;
   for prior in select * from public.revenue_messages where workspace_id=w and purpose='follow_up' and status in ('drafted','approved','queued') and (thread_id=th or customer_id=c) loop
    perform revenue_private.transition_message(prior.id,'cancelled',jsonb_build_object('failure',jsonb_build_object('reason','customer_replied')),'email.cancelled','Follow-up cancelled because the customer replied','automation','system','email.cancelled:'||prior.id);
    update public.revenue_jobs set status='cancelled',cancel_reason='Customer replied',finished_at=now(),updated_at=now() where message_id=prior.id and status='queued';
   end loop;
   if c is not null then
    insert into public.crm_tasks(workspace_id,customer_id,title,due_at,kind,action_key,source_event_id)
    values(w,c,left('Reply: '||coalesce(nullif(p_event->>'subject',''),'customer email'),300),at+interval '1 day','follow_up',md5('reply:'||p_account||':'||th)::uuid,null)
    on conflict(workspace_id,action_key) do update set status='open',due_at=least(public.crm_tasks.due_at,excluded.due_at),completed_at=null;
   end if;
  end if;
  return jsonb_build_object('duplicate',false,'message_id',m,'customer_id',c,'identity',r);
 elsif ty='message.outbound_observed' then
  if pid is null then raise exception '400:Provider message id required.'; end if;
  if exists(select 1 from public.revenue_messages where workspace_id=w and account_id=p_account and provider_message_id=pid) then
   update public.revenue_messages set message_id_header=mid,references_header=coalesce(references_header,refs)
    where workspace_id=w and account_id=p_account and provider_message_id=pid and message_id_header is null and mid is not null;
   return jsonb_build_object('duplicate',true);
  end if;
  select customer_id into c from public.crm_mail_threads where workspace_id=w and account_id=p_account and thread_id=th;
  insert into public.revenue_messages(workspace_id,customer_id,account_id,thread_id,direction,purpose,status,to_email,from_email,subject,body,approval_source,provider_message_id,provider_accepted_at,idempotency_key,occurred_at,
         in_reply_to,message_id_header,references_header)
  values(w,c,p_account,th,'outbound','reply','provider_accepted',lower(p_event->>'to'),lower(p_event->>'from_email'),left(coalesce(p_event->>'subject',''),500),left(coalesce(p_event->>'text',''),100000),'external',pid,at,'observed:'||p_account||':'||pid,at,
         irt,mid,refs) returning id into m;
  update public.crm_mail_threads set last_outbound_at=greatest(coalesce(last_outbound_at,at),at),state='waiting_on_customer',last_event_at=greatest(last_event_at,at) where workspace_id=w and account_id=p_account and thread_id=th;
  perform revenue_private.record_event(w,c,null,'email.sent_outside','gmail','user','Sent from the mailbox directly',at,'provider_accepted','message',m,'Reply sent from Gmail directly (not through Onixus Mail)','{}',jsonb_build_object('thread_id',th),'email.observed:'||p_account||':'||pid);
  return jsonb_build_object('duplicate',false,'message_id',m);
 elsif ty='message.bounced' then
  em := public.revenue_normalize_email(p_event->>'recipient');
  select * into prior from public.revenue_messages where workspace_id=w and account_id=p_account and direction='outbound' and status in ('provider_accepted','delivered','queued')
   and ((pid is not null and provider_message_id=pid) or (pid is null and public.revenue_normalize_email(to_email)=em)) order by created_at desc limit 1;
  if prior.id is null then return jsonb_build_object('ignored','no_matching_message'); end if;
  perform revenue_private.transition_message(prior.id,'failed',jsonb_build_object('at',at,'failure',jsonb_build_object('reason','bounce','status',p_event->>'status','detail',left(p_event->>'diagnostic',300))),
   'email.bounced','Delivery failed (bounce '||coalesce(p_event->>'status','unknown')||')','gmail','provider','email.bounced:'||prior.id,'Verify the address or reach the customer another way. The address is suppressed until reviewed.');
  if coalesce(p_event->>'status','5') like '5%' and em is not null then
   insert into public.revenue_suppressions(workspace_id,email_canonical,reason,source,detail) values(w,em,'bounce','Onixus Mail',p_event->>'status') on conflict do nothing;
  end if;
  return jsonb_build_object('message_id',prior.id,'status','failed');
 elsif ty='message.delivered' then
  select * into prior from public.revenue_messages where workspace_id=w and account_id=p_account and provider_message_id=pid;
  if prior.id is null then return jsonb_build_object('ignored','no_matching_message'); end if;
  perform revenue_private.transition_message(prior.id,'delivered',jsonb_build_object('at',at,'detail',jsonb_build_object('signal',p_event->>'signal')),'email.delivered','Delivery confirmed by the provider','gmail','provider','email.delivered:'||prior.id);
  return jsonb_build_object('message_id',prior.id);
 elsif ty='message.opened' then
  select * into prior from public.revenue_messages where workspace_id=w and account_id=p_account and provider_message_id=pid;
  if prior.id is null then return jsonb_build_object('ignored','no_matching_message'); end if;
  perform revenue_private.record_event(w,prior.customer_id,prior.deal_id,'email.opened','gmail','provider',null,at,'recorded','message',prior.id,
   'Open pixel loaded (not proof that a person read it)',jsonb_build_object('engagement_evidence',false),'{}','email.opened:'||prior.id||':'||at::text);
  return jsonb_build_object('message_id',prior.id,'recorded',true);
 elsif ty='unsubscribe' then
  em := public.revenue_normalize_email(p_event->>'email');
  if em is null then raise exception '400:Invalid email.'; end if;
  insert into public.revenue_suppressions(workspace_id,email_canonical,reason,source,detail) values(w,em,'unsubscribe','Onixus Mail',p_event->>'method') on conflict do nothing;
  update public.revenue_jobs rj set status='cancelled',cancel_reason='Recipient unsubscribed',finished_at=now(),updated_at=now()
   from public.revenue_messages x where rj.workspace_id=w and rj.message_id=x.id and rj.status='queued' and public.revenue_normalize_email(x.to_email)=em;
  perform revenue_private.cancel_for_recipient(w,em,'unsubscribed');
  select id into c from public.crm_customers where workspace_id=w and merged_into_id is null and email is not null and public.revenue_normalize_email(email)=em order by created_at limit 1;
  if c is not null then
   insert into public.revenue_consents(workspace_id,customer_id,channel,purpose,status,source,evidence) values(w,c,'email','marketing','revoked','Onixus Mail unsubscribe',p_event->>'method');
   perform revenue_private.record_event(w,c,null,'consent.revoked','mail','customer',null,at,'recorded','customer',c,'Customer unsubscribed from email','{}','{}','unsubscribe:'||em||':'||at::date);
  end if;
  return jsonb_build_object('suppressed',em);
 elsif ty='sync.status' then
  insert into public.revenue_sync_state(workspace_id,account_id,provider,mailbox,cursor,status,last_synced_at,last_attempt_at,last_error,messages_synced,backlog)
  values(w,p_account,coalesce(p_event->>'provider','gmail'),p_event->>'mailbox',p_event->>'cursor',p_event->>'status',case when p_event->>'status'='healthy' then at end,at,left(p_event->>'error',500),coalesce((p_event->>'messages_synced')::bigint,0),(p_event->>'backlog')::integer)
  on conflict(workspace_id,account_id) do update set status=excluded.status, mailbox=coalesce(excluded.mailbox,public.revenue_sync_state.mailbox),
   cursor=coalesce(excluded.cursor,public.revenue_sync_state.cursor), last_synced_at=coalesce(excluded.last_synced_at,public.revenue_sync_state.last_synced_at),
   last_attempt_at=excluded.last_attempt_at, last_error=excluded.last_error, messages_synced=public.revenue_sync_state.messages_synced+excluded.messages_synced, backlog=excluded.backlog;
  if p_event->>'status' in ('expired','error') then
   perform revenue_private.record_event(w,null,null,'sync.'||(p_event->>'status'),'mail','provider',null,at,'failed','mail_account',p_account,
    case when p_event->>'status'='expired' then 'Google connection expired; Mail sync stopped' else 'Mail sync failed' end,
    jsonb_build_object('error',left(p_event->>'error',300)),'{}','sync.'||(p_event->>'status')||':'||p_account||':'||to_char(at,'YYYY-MM-DD"T"HH24'),
    jsonb_build_object('error',left(p_event->>'error',300)),
    case when p_event->>'status'='expired' then 'Reconnect Google in Onixus Mail. Sync resumes from the saved position.' else 'Retry sync. If it keeps failing, check the Mail service logs.' end);
  end if;
  return jsonb_build_object('status',p_event->>'status');
 end if;
 raise exception '400:Unsupported Mail event.';
end $$;

do $$ declare f text; begin
 foreach f in array array['revenue_private.msg_ids(text)','revenue_private.references_chain(text[])',
  'revenue_private.lease_send(public.revenue_jobs,text,uuid)','revenue_private.complete_job(uuid,text,jsonb)'] loop
  execute 'revoke all on function '||f||' from public, anon, authenticated';
 end loop;
 execute 'revoke all on function public.revenue_ingest_mail_event(uuid,text,jsonb) from public';
 execute 'grant execute on function public.revenue_ingest_mail_event(uuid,text,jsonb) to anon, authenticated';
end $$;
commit;
