-- Onixus revenue system, live relay: Onixus Mail sends, syncs and reads Google Calendar for the
-- revenue tables using the per-account CRM token it already holds (crm_mail_connections), so the
-- Mail service never needs the global worker token or a service-role key.
--
--  * revenue_mail_claim / revenue_mail_complete: the #92 worker contract, scoped to mail.send jobs
--    whose message belongs to the calling mailbox (or has no mailbox yet and this is the
--    workspace's only connected mailbox). Pause, spend, suppression, consent and daily send
--    limits are enforced by the same private functions the global worker uses.
--  * revenue_mail_account_state: the saved Gmail history cursor and calendar sync position.
--  * revenue_mail_calendar_event / revenue_mail_calendar_status: Google Calendar ingestion and
--    connection health. Attendees go through resolve_identity; ambiguous ones open a review.
--  * Meetings: idempotent on (provider, event id) + provider updated time; stale and duplicate
--    updates are ignored; an opportunity is linked automatically only when exactly one is open.
begin;

create table if not exists public.revenue_calendar_sync_state(
 workspace_id uuid not null references public.crm_workspaces(id),
 account_id uuid not null,
 provider text not null default 'google_calendar' check(provider in ('google_calendar','microsoft_calendar')),
 calendar_id text not null default 'primary' check(length(calendar_id) between 1 and 300),
 sync_token text check(sync_token is null or length(sync_token)<=2000),
 page_token text check(page_token is null or length(page_token)<=2000),
 status text not null default 'unknown' check(status in ('unknown','healthy','expired','error','scope_missing','disabled')),
 last_synced_at timestamptz,
 last_attempt_at timestamptz,
 last_error text,
 events_synced bigint not null default 0,
 primary key(workspace_id,account_id)
);

-- ---------- shared job gates (global worker and Mail relay) ----------
create or replace function revenue_private.job_gate(p_job public.revenue_jobs, p_worker text) returns boolean
language plpgsql security definer set search_path='' as $$
declare ctl public.revenue_controls; spent bigint;
begin
 select * into ctl from public.revenue_controls where workspace_id=p_job.workspace_id;
 if coalesce(ctl.automation_paused,false) then
  update public.revenue_jobs set last_error='Workspace automation is paused',updated_at=now() where id=p_job.id and last_error is distinct from 'Workspace automation is paused';
  return false;
 end if;
 if p_job.cost_cents>0 then
  select coalesce(sum(cost_cents),0) into spent from public.revenue_jobs where workspace_id=p_job.workspace_id and status='succeeded' and finished_at>=date_trunc('day',now());
  if spent+p_job.cost_cents>coalesce(ctl.daily_spend_limit_cents,0) then
   update public.revenue_jobs set run_at=date_trunc('day',now())+interval '1 day',last_error='Daily spending limit reached',updated_at=now() where id=p_job.id;
   insert into public.revenue_job_runs(job_id,workspace_id,attempt,worker,finished_at,outcome,error) values(p_job.id,p_job.workspace_id,p_job.attempts,p_worker,now(),'deferred','Daily spending limit reached');
   return false;
  end if;
 end if;
 return true;
end $$;

-- Leases one queued mail.send job, or returns null when it must not be sent now (message no longer
-- queued, recipient suppressed or without consent, daily send limit reached). p_account assigns a
-- message that has no mailbox yet to the mailbox that is sending it.
create or replace function revenue_private.lease_send(p_job public.revenue_jobs, p_worker text, p_account uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.revenue_messages; ctl public.revenue_controls; block text; sent integer; ident public.revenue_sender_identities;
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
 return jsonb_build_object('job_id',p_job.id,'kind',p_job.kind,'workspace_id',p_job.workspace_id,'attempt',p_job.attempts+1,
  'message',jsonb_build_object('id',m.id,'account_id',m.account_id,'thread_id',m.thread_id,'to',m.to_email,'cc',m.cc,'subject',m.subject,
   'body',m.body||case when coalesce(m.signature_snapshot,'')<>'' and position(m.signature_snapshot in m.body)=0 then E'\n\n'||m.signature_snapshot else '' end,
   'from_email',coalesce(ident.email,m.from_email),'from_name',ident.display_name,'reply_to',m.reply_to_snapshot,'in_reply_to',m.in_reply_to,'attachments',m.attachments,'idempotency_key','onixus-'||m.id));
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

-- ---------- global worker (same contract as before, now on the shared helpers) ----------
create or replace function public.revenue_worker_claim(p_token text, p_worker text, p_limit integer default 10, p_send boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.revenue_jobs; out jsonb := '[]'; leased jsonb; block text;
 wf public.revenue_workflows; nm uuid; nj uuid; replied boolean; src public.revenue_messages; processed jsonb := '[]';
begin
 perform revenue_private.require_worker(p_token);
 update public.revenue_jobs set status='queued',locked_by=null,locked_until=null,last_error='Worker lease expired; retrying',updated_at=now()
  where status='running' and locked_until<now();
 for j in select * from public.revenue_jobs where status='queued' and run_at<=now() order by run_at limit greatest(1,least(p_limit,50))*4 for update skip locked loop
  exit when jsonb_array_length(out)>=greatest(1,least(p_limit,50));
  continue when j.kind='mail.send' and not coalesce(p_send,true);
  continue when not revenue_private.job_gate(j,p_worker);
  if j.kind='mail.send' then
   leased := revenue_private.lease_send(j,p_worker,null);
   if leased is not null then out := out || jsonb_build_array(leased); end if;
  elsif j.kind='mail.follow_up' then
   select * into src from public.revenue_messages where id=(j.payload->>'source_message_id')::uuid;
   select exists(select 1 from public.revenue_messages where workspace_id=j.workspace_id and direction='inbound' and
     ((src.thread_id is not null and thread_id=src.thread_id and account_id is not distinct from src.account_id) or customer_id=src.customer_id)
     and occurred_at>coalesce(src.provider_accepted_at,src.created_at)) into replied;
   if replied then
    update public.revenue_jobs set status='cancelled',cancel_reason='Customer replied',finished_at=now(),updated_at=now() where id=j.id;
    perform revenue_private.record_event(j.workspace_id,src.customer_id,null,'follow_up.cancelled','automation','system',null,now(),'cancelled','job',j.id,'Follow-up stopped because the customer replied','{}','{}','follow_up.cancelled:'||j.id);
    continue;
   end if;
   block := revenue_private.block_reason(j.workspace_id,src.to_email,'follow_up');
   if block is not null then
    update public.revenue_jobs set status='cancelled',cancel_reason='Recipient blocked: '||block,finished_at=now(),updated_at=now() where id=j.id;
    continue;
   end if;
   wf := revenue_private.workflow(j.workspace_id,'follow_up_no_reply');
   insert into public.revenue_messages(workspace_id,customer_id,deal_id,account_id,thread_id,direction,purpose,status,to_email,from_email,subject,body,sender_identity_id,in_reply_to,automation_key,follow_up_of,idempotency_key)
   values(j.workspace_id,src.customer_id,src.deal_id,src.account_id,src.thread_id,'outbound','follow_up','drafted',src.to_email,src.from_email,
          case when src.subject ~* '^re:' then src.subject else 'Re: '||src.subject end,j.payload->>'body',src.sender_identity_id,src.provider_message_id,'follow_up_no_reply',src.id,'follow_up_draft:'||j.id)
   on conflict(workspace_id,idempotency_key) do nothing returning id into nm;
   if nm is not null then
    perform revenue_private.record_event(j.workspace_id,src.customer_id,src.deal_id,'email.drafted','automation','automation','Follow-up workflow',now(),'drafted','message',nm,'Follow-up drafted (no reply yet)','{}',jsonb_build_object('thread_id',src.thread_id),'email.drafted:'||nm);
    if coalesce(wf.enabled,false) and coalesce(wf.auto_send_authorized,false) then
     perform revenue_private.transition_message(nm,'approved',jsonb_build_object('approval_source','automation','automation_key','follow_up_no_reply','signature',(select signature from public.revenue_sender_identities where id=src.sender_identity_id)),
      'email.approved','Approved by the authorized follow-up workflow','automation','automation','email.approved:'||nm);
     nj := revenue_private.enqueue(j.workspace_id,'mail.send','follow_up_no_reply','mail.send:'||nm,jsonb_build_object('message_id',nm),now(),src.customer_id,nm,j.chain_depth+1,j.id);
     perform revenue_private.transition_message(nm,'queued','{}','email.queued','Queued for sending','automation','system','email.queued:'||nm||':first');
    end if;
   end if;
   update public.revenue_jobs set status='succeeded',attempts=attempts+1,finished_at=now(),updated_at=now(),last_error=null where id=j.id;
   insert into public.revenue_job_runs(job_id,workspace_id,attempt,worker,finished_at,outcome,detail) values(j.id,j.workspace_id,j.attempts+1,p_worker,now(),'succeeded',jsonb_build_object('draft_id',nm,'auto_send',coalesce(wf.auto_send_authorized,false)));
   processed := processed || jsonb_build_array(jsonb_build_object('job_id',j.id,'kind',j.kind,'draft_id',nm));
  elsif j.kind in ('inquiry.acknowledge','onboarding.kickoff') then
   perform revenue_private.run_internal_job(j.id,p_worker);
   processed := processed || jsonb_build_array(jsonb_build_object('job_id',j.id,'kind',j.kind));
  end if;
 end loop;
 return jsonb_build_object('jobs',out,'processed',processed);
end $$;

create or replace function public.revenue_worker_complete(p_token text, p_job uuid, p_worker text, p_result jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform revenue_private.require_worker(p_token);
 return revenue_private.complete_job(p_job,p_worker,p_result);
end $$;

-- ---------- Onixus Mail relay (account-bound CRM token) ----------
-- Messages without a mailbox can only be sent by the workspace's single connected mailbox; with
-- several mailboxes a person must pick the sender identity, so nothing goes out from the wrong one.
create or replace function revenue_private.mail_may_send(p_workspace uuid, p_account uuid, p_message_account uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select p_message_account=p_account or (p_message_account is null and (select count(*) from public.crm_mail_connections where workspace_id=p_workspace)=1)
$$;

create or replace function public.revenue_mail_claim(p_account uuid, p_token text, p_worker text, p_limit integer default 10)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid := crm_private.mail_workspace(p_account,p_token); j public.revenue_jobs; out jsonb := '[]'; leased jsonb; lim integer := greatest(1,least(coalesce(p_limit,10),50));
begin
 if p_worker is null or p_worker !~ '^[A-Za-z0-9:._-]{1,120}$' then raise exception '400:Worker id is invalid.'; end if;
 update public.revenue_jobs rj set status='queued',locked_by=null,locked_until=null,last_error='Worker lease expired; retrying',updated_at=now()
  from public.revenue_messages m where rj.workspace_id=w and rj.kind='mail.send' and rj.status='running' and rj.locked_until<now()
   and m.id=rj.message_id and revenue_private.mail_may_send(w,p_account,m.account_id);
 for j in select rj.* from public.revenue_jobs rj join public.revenue_messages m on m.id=rj.message_id
   where rj.workspace_id=w and rj.kind='mail.send' and rj.status='queued' and rj.run_at<=now() and revenue_private.mail_may_send(w,p_account,m.account_id)
   order by rj.run_at limit lim*4 for update of rj skip locked loop
  exit when jsonb_array_length(out)>=lim;
  continue when not revenue_private.job_gate(j,p_worker);
  leased := revenue_private.lease_send(j,p_worker,p_account);
  if leased is not null then out := out || jsonb_build_array(leased); end if;
 end loop;
 return jsonb_build_object('jobs',out,'processed','[]'::jsonb);
end $$;

create or replace function public.revenue_mail_complete(p_account uuid, p_token text, p_job uuid, p_worker text, p_result jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid := crm_private.mail_workspace(p_account,p_token); acct uuid;
begin
 select m.account_id into acct from public.revenue_jobs rj join public.revenue_messages m on m.id=rj.message_id where rj.id=p_job and rj.workspace_id=w and rj.kind='mail.send';
 if acct is distinct from p_account then return jsonb_build_object('ignored','job_not_leased_by_worker'); end if;
 return revenue_private.complete_job(p_job,p_worker,p_result);
end $$;

create or replace function public.revenue_mail_account_state(p_account uuid, p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid := crm_private.mail_workspace(p_account,p_token);
begin
 return jsonb_build_object('workspace_id',w,
  'mail',(select jsonb_build_object('cursor',cursor,'status',status,'mailbox',mailbox,'last_synced_at',last_synced_at) from public.revenue_sync_state where workspace_id=w and account_id=p_account),
  'calendar',(select jsonb_build_object('sync_token',sync_token,'page_token',page_token,'status',status,'calendar_id',calendar_id,'last_synced_at',last_synced_at) from public.revenue_calendar_sync_state where workspace_id=w and account_id=p_account),
  'sends_waiting',(select count(*) from public.revenue_jobs rj join public.revenue_messages m on m.id=rj.message_id
    where rj.workspace_id=w and rj.kind='mail.send' and rj.status='queued' and revenue_private.mail_may_send(w,p_account,m.account_id)));
end $$;

-- ---------- meetings ----------
-- Idempotent on (provider, event id). An update whose provider time is not newer than the stored
-- one is ignored, so duplicates and out-of-order deliveries converge. p_auto_deal links the
-- customer's opportunity only when exactly one is open.
create or replace function revenue_private.save_meeting(p_workspace uuid, p_customer uuid, p_deal uuid, p_auto_deal boolean, p_title text, p_starts timestamptz, p_ends timestamptz,
 p_status text, p_provider text, p_event_id text, p_updated timestamptz, p_actor text, p_detail jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.revenue_meetings; prev public.revenue_meetings; d uuid := p_deal; ids uuid[]; src text := case when p_provider='manual' then 'crm' else 'calendar' end;
 stamp text := coalesce(to_char(p_updated at time zone 'UTC','YYYYMMDD"T"HH24MISS.US'),'manual');
begin
 select * into prev from public.revenue_meetings where workspace_id=p_workspace and provider=p_provider and provider_event_id=p_event_id for update;
 if prev.id is not null and p_updated is not null and prev.provider_updated_at is not null and p_updated<=prev.provider_updated_at then
  return jsonb_build_object('meeting_id',prev.id,'deal_id',prev.deal_id,'status',prev.status,'ignored','stale_update');
 end if;
 if prev.id is null and d is null and coalesce(p_auto_deal,false) then
  select array_agg(id) into ids from public.crm_deals where workspace_id=p_workspace and customer_id=p_customer and revenue_private.stage_outcome(p_workspace,stage)='open';
  if coalesce(array_length(ids,1),0)=1 then d := ids[1]; end if;
 end if;
 insert into public.revenue_meetings(workspace_id,customer_id,deal_id,title,starts_at,ends_at,status,provider,provider_event_id,provider_updated_at,created_by)
 values(p_workspace,p_customer,d,left(p_title,300),p_starts,p_ends,coalesce(p_status,'scheduled'),p_provider,p_event_id,p_updated,auth.uid())
 on conflict(workspace_id,provider,provider_event_id) do update set title=excluded.title,starts_at=excluded.starts_at,ends_at=excluded.ends_at,status=excluded.status,
  provider_updated_at=excluded.provider_updated_at,deal_id=coalesce(public.revenue_meetings.deal_id,excluded.deal_id)
 returning * into m;
 if prev.id is null or prev.status is distinct from m.status then
  perform revenue_private.record_event(p_workspace,m.customer_id,m.deal_id,'meeting.'||m.status,src,p_actor,null,now(),m.status,'meeting',m.id,
   case m.status when 'scheduled' then case when prev.id is null then 'Meeting booked: ' else 'Meeting restored: ' end when 'cancelled' then 'Meeting cancelled: ' else 'Meeting '||m.status||': ' end
    ||m.title||' ('||to_char(m.starts_at at time zone 'UTC','YYYY-MM-DD HH24:MI')||' UTC)',
   jsonb_build_object('starts_at',m.starts_at,'ends_at',m.ends_at,'provider',p_provider)||coalesce(p_detail,'{}'),jsonb_build_object('deal_id',m.deal_id),
   'meeting.'||m.status||':'||m.id||case when prev.id is null then '' else ':'||stamp end);
 elsif prev.starts_at is distinct from m.starts_at or prev.ends_at is distinct from m.ends_at then
  perform revenue_private.record_event(p_workspace,m.customer_id,m.deal_id,'meeting.rescheduled',src,p_actor,null,now(),m.status,'meeting',m.id,
   'Meeting moved: '||m.title||' (now '||to_char(m.starts_at at time zone 'UTC','YYYY-MM-DD HH24:MI')||' UTC, was '||to_char(prev.starts_at at time zone 'UTC','YYYY-MM-DD HH24:MI')||' UTC)',
   jsonb_build_object('starts_at',m.starts_at,'ends_at',m.ends_at,'previous_starts_at',prev.starts_at,'provider',p_provider)||coalesce(p_detail,'{}'),jsonb_build_object('deal_id',m.deal_id),
   'meeting.rescheduled:'||m.id||':'||stamp);
 end if;
 return jsonb_build_object('meeting_id',m.id,'deal_id',m.deal_id,'status',m.status,'created',prev.id is null);
end $$;

create or replace function revenue_private.upsert_meeting(p_workspace uuid, p_customer uuid, p_deal uuid, p_title text, p_starts timestamptz, p_ends timestamptz, p_status text, p_provider text, p_event_id text, p_updated timestamptz, p_actor text)
returns jsonb language sql security definer set search_path='' as $$
 select revenue_private.save_meeting(p_workspace,p_customer,p_deal,true,p_title,p_starts,p_ends,p_status,p_provider,p_event_id,p_updated,p_actor,'{}')
$$;

-- Calendar event -> meeting. Internal addresses (the mailbox, sender identities, workspace members,
-- resource calendars) are never treated as customers. Only attendees that already match a customer
-- are resolved (through resolve_identity, so duplicates open a review) unless p_create_unknown;
-- events from untrusted organizers (not internal, not a matched customer) are ignored so a stranger's
-- invite cannot write to a customer's timeline. Event titles are external text and stay untrusted.
create or replace function revenue_private.ingest_calendar(p_workspace uuid, p_provider text, p_source text, p_event jsonb, p_internal text[], p_trusted boolean, p_create_unknown boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare eid text := nullif(p_event->>'provider_event_id',''); upd timestamptz; starts timestamptz; ends timestamptz; st text;
 existing public.revenue_meetings; internal text[]; a jsonb; em text; r jsonb; last_r jsonb; review jsonb; matched uuid[] := '{}'; matched_emails text[] := '{}';
 org text := public.revenue_normalize_email(p_event->>'organizer_email'); trusted boolean := coalesce(p_trusted,false); first_unknown jsonb; chosen uuid;
 title text := left(coalesce(nullif(trim(p_event->>'title'),''),'Meeting'),300); detail jsonb;
begin
 if eid is null or length(eid)>1024 then raise exception '400:Calendar event id required.'; end if;
 begin
  upd := (p_event->>'updated_at')::timestamptz; starts := (p_event->>'starts_at')::timestamptz; ends := (p_event->>'ends_at')::timestamptz;
 exception when others then raise exception '400:Calendar event times are invalid.';
 end;
 if upd is null then raise exception '400:Calendar event update time required.'; end if;
 if upd>now()+interval '10 minutes' then raise exception '400:Event time is in the future.'; end if;
 st := case when p_event->>'status'='cancelled' then 'cancelled' else 'scheduled' end;
 detail := jsonb_build_object('untrusted_content',true,'source',p_source);
 perform pg_advisory_xact_lock(hashtextextended('revenue-calendar:'||p_workspace||':'||p_provider||':'||eid,0));
 select * into existing from public.revenue_meetings where workspace_id=p_workspace and provider=p_provider and provider_event_id=eid;
 if existing.id is not null then
  -- Cancellations in incremental sync may carry only the id; keep the stored times and title.
  return revenue_private.save_meeting(p_workspace,existing.customer_id,existing.deal_id,false,case when nullif(trim(p_event->>'title'),'') is null then existing.title else title end,
   coalesce(starts,existing.starts_at),coalesce(ends,existing.ends_at),st,p_provider,eid,upd,'provider',detail);
 end if;
 if st='cancelled' then return jsonb_build_object('ignored','cancelled_before_seen'); end if;
 if starts is null or ends is null or ends<=starts then raise exception '400:Calendar event needs a start and an end time.'; end if;
 internal := array(select public.revenue_normalize_email(x) from unnest(coalesce(p_internal,'{}'::text[])) x where public.revenue_normalize_email(x) is not null)
  || array(select public.revenue_normalize_email(email) from public.revenue_sender_identities where workspace_id=p_workspace)
  || array(select public.revenue_normalize_email(u.email) from auth.users u join public.crm_memberships ms on ms.user_id=u.id where ms.workspace_id=p_workspace and u.email is not null)
  || array(select public.revenue_normalize_email(mailbox) from public.revenue_sync_state where workspace_id=p_workspace and mailbox is not null);
 if coalesce((p_event->>'organizer_self')::boolean,false) or org=any(internal) then trusted := true; end if;
 for a in select value from jsonb_array_elements(case when jsonb_typeof(p_event->'attendees')='array' then p_event->'attendees' else '[]'::jsonb end) with ordinality x(value,n) order by n limit 100 loop
  em := public.revenue_normalize_email(a->>'email');
  continue when em is null or coalesce((a->>'self')::boolean,false) or coalesce((a->>'resource')::boolean,false) or em=any(internal) or em like '%calendar.google.com';
  if not exists(select 1 from public.crm_customers where workspace_id=p_workspace and merged_into_id is null and email is not null and public.revenue_normalize_email(email)=em) then
   first_unknown := coalesce(first_unknown,a);
   continue;
  end if;
  r := revenue_private.resolve_identity(p_workspace,a->>'email',null,a->>'name',null,p_source,jsonb_build_object('calendar_event',eid));
  last_r := coalesce(last_r,r);
  if r->>'outcome'='review' then review := coalesce(review,r); end if;
  if not ((r->>'customer_id')::uuid=any(matched)) then matched := matched||(r->>'customer_id')::uuid; end if;
  matched_emails := matched_emails||em;
 end loop;
 if cardinality(matched)=0 then
  if not (coalesce(p_create_unknown,false) and first_unknown is not null) then
   return jsonb_build_object('ignored',case when first_unknown is null then 'no_external_attendees' else 'no_known_attendee' end);
  end if;
  r := revenue_private.resolve_identity(p_workspace,first_unknown->>'email',null,first_unknown->>'name',null,p_source,jsonb_build_object('calendar_event',eid));
  last_r := r;
  if r->>'outcome'='review' then review := r; end if;
  matched := array[(r->>'customer_id')::uuid];
  matched_emails := array[public.revenue_normalize_email(first_unknown->>'email')];
 end if;
 if not trusted and not (org=any(matched_emails)) then return jsonb_build_object('ignored','organizer_not_trusted'); end if;
 chosen := coalesce((review->>'customer_id')::uuid,matched[1]);
 if review is not null then detail := detail||jsonb_build_object('identity_review_id',review->>'review_id'); end if;
 if cardinality(matched)>1 then detail := detail||jsonb_build_object('other_customers',to_jsonb(matched[2:])); end if;
 return revenue_private.save_meeting(p_workspace,chosen,null,review is null,title,starts,ends,st,p_provider,eid,upd,'provider',detail)
  ||jsonb_build_object('customer_id',chosen,'identity',coalesce(review,last_r),'matched_customers',cardinality(matched));
end $$;

-- Integration-token path (booking forms, other calendars posting through the web app). The
-- workspace issued the token, so the source is trusted and an unknown attendee becomes a customer.
create or replace function public.revenue_ingest_calendar_event(p_integration uuid, p_token text, p_event jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.revenue_integrations := revenue_private.integration(p_integration,p_token,'calendar'); r jsonb; ev jsonb := p_event;
 prov text := coalesce(nullif(p_event->>'provider',''),'google_calendar');
begin
 if prov not in ('google_calendar','microsoft_calendar','booking_form') then raise exception '400:Unsupported calendar provider.'; end if;
 if jsonb_typeof(ev->'attendees') is distinct from 'array' and nullif(ev->>'attendee_email','') is not null then
  ev := ev||jsonb_build_object('attendees',jsonb_build_array(jsonb_build_object('email',ev->>'attendee_email','name',ev->>'attendee_name')));
 end if;
 r := revenue_private.ingest_calendar(i.workspace_id,prov,'Calendar',ev,'{}',true,true);
 update public.revenue_integrations set last_success_at=now(),last_error=null where id=i.id;
 return r;
end $$;

create or replace function public.revenue_mail_calendar_event(p_account uuid, p_token text, p_event jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid := crm_private.mail_workspace(p_account,p_token);
begin
 return revenue_private.ingest_calendar(w,'google_calendar','Google Calendar',p_event,array[p_event->>'mailbox'],false,false);
end $$;

create or replace function public.revenue_mail_calendar_status(p_account uuid, p_token text, p_status jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid := crm_private.mail_workspace(p_account,p_token); st text := p_status->>'status'; reset boolean := coalesce((p_status->>'reset')::boolean,false);
begin
 if st is null or st not in ('healthy','expired','error','scope_missing','disabled') then raise exception '400:Unsupported calendar status.'; end if;
 insert into public.revenue_calendar_sync_state(workspace_id,account_id,calendar_id,sync_token,page_token,status,last_synced_at,last_attempt_at,last_error,events_synced)
 values(w,p_account,coalesce(nullif(p_status->>'calendar_id',''),'primary'),p_status->>'sync_token',p_status->>'page_token',st,case when st='healthy' then now() end,now(),left(p_status->>'error',500),
        greatest(coalesce((p_status->>'events_synced')::bigint,0),0))
 on conflict(workspace_id,account_id) do update set status=excluded.status,calendar_id=excluded.calendar_id,
  sync_token=case when st<>'healthy' then public.revenue_calendar_sync_state.sync_token when reset then excluded.sync_token else coalesce(excluded.sync_token,public.revenue_calendar_sync_state.sync_token) end,
  page_token=case when st='healthy' then excluded.page_token else public.revenue_calendar_sync_state.page_token end,
  last_synced_at=coalesce(excluded.last_synced_at,public.revenue_calendar_sync_state.last_synced_at),last_attempt_at=now(),last_error=excluded.last_error,
  events_synced=public.revenue_calendar_sync_state.events_synced+excluded.events_synced;
 if st in ('expired','error','scope_missing') then
  perform revenue_private.record_event(w,null,null,'calendar.'||st,'calendar','provider',null,now(),'failed','mail_account',p_account,
   case st when 'expired' then 'Google connection expired; Calendar sync stopped' when 'scope_missing' then 'Calendar access was not granted; meetings are not being recorded' else 'Calendar sync failed' end,
   jsonb_build_object('error',left(p_status->>'error',300)),'{}','calendar.'||st||':'||p_account||':'||to_char(now(),'YYYY-MM-DD"T"HH24'),
   jsonb_build_object('error',left(p_status->>'error',300)),
   case st when 'expired' then 'Reconnect Google in Onixus Mail. Calendar sync resumes from the saved position.'
    when 'scope_missing' then 'Reconnect Google in Onixus Mail and allow read access to Google Calendar events.'
    else 'Retry calendar sync. If it keeps failing, check the Mail service logs.' end);
 end if;
 return jsonb_build_object('status',st);
end $$;

-- ---------- calendar health in the overview and daily priorities ----------
create or replace function public.revenue_overview(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare env text; mail_connected boolean; stripe_connected boolean; f timestamptz := coalesce(p_from,now()-interval '30 days'); t timestamptz := coalesce(p_to,now());
begin
 perform revenue_private.require_role(p_workspace,'viewer');
 select environment into env from public.crm_workspaces where id=p_workspace;
 mail_connected := exists(select 1 from public.crm_mail_connections where workspace_id=p_workspace);
 stripe_connected := exists(select 1 from public.revenue_integrations where workspace_id=p_workspace and provider='stripe' and status='active');
 return jsonb_build_object(
  'period',jsonb_build_object('from',f,'to',t),
  'environment',env,
  'counts_in_production_reporting',env='production',
  'generated_at',now(),
  'freshness',jsonb_build_object(
    'latest_event_at',(select max(recorded_at) from public.revenue_events where workspace_id=p_workspace),
    'mail_sync',coalesce((select jsonb_agg(jsonb_build_object('account_id',account_id,'status',status,'last_synced_at',last_synced_at,'last_error',last_error,'mailbox',mailbox)) from public.revenue_sync_state where workspace_id=p_workspace),'[]'),
    'calendar_sync',coalesce((select jsonb_agg(jsonb_build_object('account_id',account_id,'status',status,'last_synced_at',last_synced_at,'last_error',last_error)) from public.revenue_calendar_sync_state where workspace_id=p_workspace),'[]'),
    'integrations',coalesce((select jsonb_agg(jsonb_build_object('provider',provider,'label',label,'status',status,'last_success_at',last_success_at,'last_error',last_error)) from public.revenue_integrations where workspace_id=p_workspace),'[]')),
  'metrics',jsonb_build_object(
   'leads',jsonb_build_object('definition','Customers created in the period from inquiries, forms, Mail or manual entry (merged duplicates excluded; bulk discovery imports listed separately).',
     'total',(select count(*) from public.crm_customers where workspace_id=p_workspace and merged_into_id is null and created_at>=f and created_at<t and source not ilike '%discovery%' and source not ilike '%openstreetmap%'),
     'discovery_imports',(select count(*) from public.crm_customers where workspace_id=p_workspace and created_at>=f and created_at<t and (source ilike '%discovery%' or source ilike '%openstreetmap%')),
     'by_source',coalesce((select jsonb_object_agg(source,n) from (select source,count(*) n from public.crm_customers where workspace_id=p_workspace and merged_into_id is null and created_at>=f and created_at<t group by source order by count(*) desc limit 12) x),'{}'),
     'inquiries',(select count(*) from public.crm_inquiries where workspace_id=p_workspace and received_at>=f and received_at<t),
     'drill','/revenue?view=customers&created_from='||f::date),
   'pipeline',jsonb_build_object('definition','Open opportunities now, by stage; conversion = won / (won + lost) among opportunities closed in the period.',
     'open_by_stage',coalesce((select jsonb_object_agg(stage,jsonb_build_object('count',n,'value_cents',v)) from (select stage,count(*) n,sum(value_cents) v from public.crm_deals where workspace_id=p_workspace and revenue_private.stage_outcome(p_workspace,stage)='open' group by stage) x),'{}'),
     'currencies',coalesce((select jsonb_agg(distinct currency) from public.crm_deals where workspace_id=p_workspace),'[]'),
     'won',(select count(*) from public.crm_deals where workspace_id=p_workspace and revenue_private.stage_outcome(p_workspace,stage)='won' and stage_changed_at>=f and stage_changed_at<t),
     'lost',(select count(*) from public.crm_deals where workspace_id=p_workspace and revenue_private.stage_outcome(p_workspace,stage)='lost' and stage_changed_at>=f and stage_changed_at<t),
     'drill','/revenue?view=pipeline'),
   'outreach',jsonb_build_object('definition','Messages sent through Onixus Mail in the period by actual status. Opens are excluded: they are not evidence of a person reading. Reply rate = threads with a customer reply after our message / threads we sent to.',
     'by_status',coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from public.revenue_messages where workspace_id=p_workspace and direction='outbound' and created_at>=f and created_at<t group by status) x),'{}'),
     'replies_received',(select count(*) from public.revenue_messages where workspace_id=p_workspace and direction='inbound' and occurred_at>=f and occurred_at<t),
     'threads_sent',(select count(distinct thread_id) from public.revenue_messages where workspace_id=p_workspace and direction='outbound' and provider_accepted_at>=f and provider_accepted_at<t),
     'threads_replied',(select count(distinct thread_id) from public.revenue_messages where workspace_id=p_workspace and direction='outbound' and provider_accepted_at>=f and provider_accepted_at<t and replied_at is not null),
     'awaiting_approval',(select count(*) from public.revenue_messages where workspace_id=p_workspace and status='drafted'),
     'drill','/revenue?view=mail'),
   'bookings',jsonb_build_object('definition','Meetings booked in the period (cancelled shown separately).',
     'scheduled',(select count(*) from public.revenue_meetings where workspace_id=p_workspace and created_at>=f and created_at<t and status<>'cancelled'),
     'cancelled',(select count(*) from public.revenue_meetings where workspace_id=p_workspace and created_at>=f and created_at<t and status='cancelled'),
     'upcoming',(select count(*) from public.revenue_meetings where workspace_id=p_workspace and status='scheduled' and starts_at>now())),
   'proposals',jsonb_build_object('definition','Proposals created in the period by current status.',
     'by_status',coalesce((select jsonb_object_agg(status,jsonb_build_object('count',n,'amount_cents',v)) from (select status,count(*) n,sum(amount_cents) v from public.revenue_proposals where workspace_id=p_workspace and created_at>=f and created_at<t group by status) x),'{}')),
   'payments',jsonb_build_object('definition','Amounts confirmed by signed provider webhooks only. Outstanding = sent or partially paid proposals minus collected.',
     'known',stripe_connected,
     'collected_cents',(select coalesce(sum(amount_received_cents),0) from public.revenue_payments where workspace_id=p_workspace and last_event_at>=f and last_event_at<t),
     'refunded_cents',(select coalesce(sum(amount_refunded_cents),0) from public.revenue_payments where workspace_id=p_workspace and last_event_at>=f and last_event_at<t),
     'failed',(select count(*) from public.revenue_payments where workspace_id=p_workspace and status='failed' and last_event_at>=f and last_event_at<t),
     'outstanding_cents',(select coalesce(sum(amount_cents-amount_paid_cents),0) from public.revenue_proposals where workspace_id=p_workspace and status in ('sent','partially_paid','payment_failed'))),
   'onboarding',jsonb_build_object('definition','Onboardings started in the period, and current state.',
     'started',(select count(*) from public.revenue_onboardings where workspace_id=p_workspace and started_at>=f and started_at<t),
     'active',(select count(*) from public.revenue_onboardings where workspace_id=p_workspace and status='active'),
     'on_hold',(select count(*) from public.revenue_onboardings where workspace_id=p_workspace and status='on_hold')),
   'commitments',jsonb_build_object('definition','Open tasks and commitments past their due time, now.',
     'overdue',(select count(*) from public.crm_tasks where workspace_id=p_workspace and status='open' and due_at<now()),
     'due_today',(select count(*) from public.crm_tasks where workspace_id=p_workspace and status='open' and due_at>=now() and due_at<date_trunc('day',now())+interval '1 day')),
   'failures',jsonb_build_object('definition','Items that need recovery now.',
     'failed_sends',(select count(*) from public.revenue_messages where workspace_id=p_workspace and status='failed'),
     'dead_jobs',(select count(*) from public.revenue_jobs where workspace_id=p_workspace and status='dead'),
     'retrying_jobs',(select count(*) from public.revenue_jobs where workspace_id=p_workspace and status='queued' and attempts>0),
     'sync_problems',(select count(*) from public.revenue_sync_state where workspace_id=p_workspace and status in ('expired','error'))
       +(select count(*) from public.revenue_calendar_sync_state where workspace_id=p_workspace and status in ('expired','error','scope_missing')),
     'paused',coalesce((select automation_paused from public.revenue_controls where workspace_id=p_workspace),false),
     'identity_reviews',(select count(*) from public.revenue_identity_reviews where workspace_id=p_workspace and status='open'))),
  'unknowns',(select coalesce(jsonb_agg(u),'[]') from (values
    (case when not mail_connected then 'Onixus Mail is not linked to this workspace: outreach and reply counts only include messages created here.' end),
    (case when not stripe_connected then 'No payment integration is connected: payments and collections are unknown, not zero.' end),
    (case when not exists(select 1 from public.revenue_integrations where workspace_id=p_workspace and provider='calendar' and status='active')
      and not exists(select 1 from public.revenue_calendar_sync_state where workspace_id=p_workspace and status='healthy') then 'No calendar integration: bookings only include meetings logged in Onixus CRM.' end),
    (case when (select count(distinct currency) from public.crm_deals where workspace_id=p_workspace)>1 then 'Pipeline values use several currencies and are not summed across currencies.' end),
    (case when env<>'production' then 'This is a '||env||' workspace. Its numbers are excluded from production reporting.' end)) v(u) where u is not null));
end $$;

create or replace function public.revenue_priorities(p_workspace uuid, p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform revenue_private.require_role(p_workspace,'viewer');
 return coalesce((select jsonb_agg(x order by x.severity desc, x.since) from (
  select * from (
   select 3 severity,'failed_send' kind,m.customer_id,c.company who,'A message to '||m.to_email||' failed: '||coalesce(m.failure->>'detail',m.failure->>'reason','unknown error') why,
    case when m.failure->>'reason'='bounce' then 'Verify the address or contact them another way' else 'Fix the cause, then retry the send' end action,m.failed_at since,'/revenue?view=mail&message='||m.id link
   from public.revenue_messages m left join public.crm_customers c on c.id=m.customer_id where m.workspace_id=p_workspace and m.status='failed'
   union all
   select 3,'sync_problem',null,coalesce(s.mailbox,'Mail account'),'Mail sync is '||s.status||coalesce(': '||s.last_error,''),case when s.status='expired' then 'Reconnect Google in Onixus Mail' else 'Retry sync and check Mail service health' end,s.last_attempt_at,'/revenue?view=mail'
   from public.revenue_sync_state s where s.workspace_id=p_workspace and s.status in ('expired','error')
   union all
   select 3,'calendar_problem',null,'Google Calendar','Calendar sync is '||replace(s.status,'_',' ')||coalesce(': '||s.last_error,''),
    case s.status when 'scope_missing' then 'Reconnect Google in Onixus Mail and allow Calendar access' when 'expired' then 'Reconnect Google in Onixus Mail' else 'Retry calendar sync and check Mail service health' end,s.last_attempt_at,'/revenue?view=automation'
   from public.revenue_calendar_sync_state s where s.workspace_id=p_workspace and s.status in ('expired','error','scope_missing')
   union all
   select 2,'send_unassigned',m.customer_id,coalesce(c.company,m.to_email),'An approved message to '||m.to_email||' is waiting because no sending mailbox is chosen','Pick a sender identity linked to a connected mailbox',m.queued_at,'/revenue?view=mail&message='||m.id
   from public.revenue_messages m left join public.crm_customers c on c.id=m.customer_id where m.workspace_id=p_workspace and m.status='queued' and m.account_id is null
    and m.queued_at<now()-interval '15 minutes' and (select count(*) from public.crm_mail_connections x where x.workspace_id=p_workspace)<>1
   union all
   select 3,'dead_job',j.customer_id,coalesce(c.company,'Workflow'),'Automation step '||j.kind||' failed after '||j.attempts||' attempts: '||coalesce(j.last_error,''),'Review the error and replay the job',j.finished_at,'/revenue?view=automation&job='||j.id
   from public.revenue_jobs j left join public.crm_customers c on c.id=j.customer_id where j.workspace_id=p_workspace and j.status='dead' and j.kind<>'mail.send'
   union all
   select 2,'payment_failed',p.customer_id,c.company,'Payment failed for "'||p.title||'"','Send a new payment link or contact the customer',p.updated_at,'/revenue?view=customer&customer='||p.customer_id
   from public.revenue_proposals p join public.crm_customers c on c.id=p.customer_id where p.workspace_id=p_workspace and p.status='payment_failed'
   union all
   select 2,'onboarding_hold',o.customer_id,c.company,'Onboarding is on hold: '||coalesce(o.hold_reason,''),'Review the refund or cancellation with the customer',o.started_at,'/revenue?view=customer&customer='||o.customer_id
   from public.revenue_onboardings o join public.crm_customers c on c.id=o.customer_id where o.workspace_id=p_workspace and o.status='on_hold'
   union all
   select 2,'awaiting_reply',t.customer_id,c.company,'Customer wrote "'||left(t.subject,120)||'" and is waiting for a reply'||case when jsonb_array_length(coalesce(t.unanswered_questions,'[]'))>0 then ' ('||jsonb_array_length(t.unanswered_questions)||' open question(s))' else '' end,
    'Draft and approve a reply',t.last_inbound_at,'/revenue?view=mail&thread='||t.thread_id
   from public.crm_mail_threads t join public.crm_customers c on c.id=t.customer_id where t.workspace_id=p_workspace and t.state='waiting_on_us' and t.last_inbound_at<now()-interval '4 hours'
   union all
   select 2,'overdue_task',k.customer_id,c.company,'"'||k.title||'" was due '||to_char(k.due_at at time zone 'UTC','YYYY-MM-DD'),'Complete it or set a new date',k.due_at,'/revenue?view=customer&customer='||k.customer_id
   from public.crm_tasks k join public.crm_customers c on c.id=k.customer_id where k.workspace_id=p_workspace and k.status='open' and k.due_at<now()
   union all
   select 1,'drafts_waiting',m.customer_id,c.company,'A draft to '||m.to_email||' is waiting for approval','Review and approve or cancel it',m.created_at,'/revenue?view=mail&message='||m.id
   from public.revenue_messages m left join public.crm_customers c on c.id=m.customer_id where m.workspace_id=p_workspace and m.status='drafted' and m.direction='outbound'
   union all
   select 1,'identity_review',r.customer_id,c.company,'Possible duplicate customer ('||replace(r.reason,'_',' ')||')','Merge or mark as different',r.created_at,'/revenue?view=reviews'
   from public.revenue_identity_reviews r join public.crm_customers c on c.id=r.customer_id where r.workspace_id=p_workspace and r.status='open'
   union all
   select 1,'proposal_unpaid',p.customer_id,c.company,'Proposal "'||p.title||'" sent '||to_char(p.sent_at at time zone 'UTC','YYYY-MM-DD')||' is not paid','Follow up on the proposal',p.sent_at,'/revenue?view=customer&customer='||p.customer_id
   from public.revenue_proposals p join public.crm_customers c on c.id=p.customer_id where p.workspace_id=p_workspace and p.status='sent' and p.sent_at<now()-interval '5 days'
  ) all_items order by severity desc, since nulls last limit greatest(1,least(p_limit,100))) x),'[]');
end $$;

do $$ begin
 alter table public.revenue_calendar_sync_state enable row level security;
 revoke all on public.revenue_calendar_sync_state from public,anon,authenticated;
 grant select(workspace_id,account_id,provider,calendar_id,status,last_synced_at,last_attempt_at,last_error,events_synced) on public.revenue_calendar_sync_state to authenticated;
 grant all on public.revenue_calendar_sync_state to service_role;
 drop policy if exists revenue_member_read on public.revenue_calendar_sync_state;
 create policy revenue_member_read on public.revenue_calendar_sync_state for select to authenticated using (workspace_id in (select workspace_id from public.crm_memberships where user_id=(select auth.uid())));
end $$;

do $$ declare f text; begin
 foreach f in array array['revenue_mail_claim(uuid,text,text,integer)','revenue_mail_complete(uuid,text,uuid,text,jsonb)','revenue_mail_account_state(uuid,text)',
  'revenue_mail_calendar_event(uuid,text,jsonb)','revenue_mail_calendar_status(uuid,text,jsonb)',
  'revenue_worker_claim(text,text,integer,boolean)','revenue_worker_complete(text,uuid,text,jsonb)','revenue_ingest_calendar_event(uuid,text,jsonb)'] loop
  execute 'revoke all on function public.'||f||' from public';
  execute 'grant execute on function public.'||f||' to anon, authenticated';
 end loop;
 foreach f in array array['revenue_overview(uuid,timestamptz,timestamptz)','revenue_priorities(uuid,integer)'] loop
  execute 'revoke all on function public.'||f||' from public, anon';
  execute 'grant execute on function public.'||f||' to authenticated';
 end loop;
 foreach f in array array['revenue_private.job_gate(public.revenue_jobs,text)','revenue_private.lease_send(public.revenue_jobs,text,uuid)','revenue_private.complete_job(uuid,text,jsonb)',
  'revenue_private.mail_may_send(uuid,uuid,uuid)','revenue_private.save_meeting(uuid,uuid,uuid,boolean,text,timestamptz,timestamptz,text,text,text,timestamptz,text,jsonb)',
  'revenue_private.upsert_meeting(uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,text,timestamptz,text)','revenue_private.ingest_calendar(uuid,text,text,jsonb,text[],boolean,boolean)'] loop
  execute 'revoke all on function '||f||' from public, anon, authenticated';
 end loop;
end $$;
commit;
